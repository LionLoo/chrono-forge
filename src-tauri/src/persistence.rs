//! Narrow, local SQLite persistence for save generations and focus metadata.
//!
//! The WebView reaches this module only through typed Tauri commands.  It never
//! receives a SQL connection or a filesystem path.

use std::{
    collections::BTreeMap,
    error::Error,
    fmt::{Display, Formatter, Write},
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

const DATABASE_FILE: &str = "chrono-forge.sqlite3";
const SCHEMA_VERSION: i64 = 8;
const MAX_ID_BYTES: usize = 64;
const MAX_NAME_BYTES: usize = 120;
const MAX_SNAPSHOT_BYTES: usize = 50 * 1024 * 1024;
const MAX_RECAP_EVENT_IDS: usize = 12;
const MAX_RECAP_ENTRY_SUMMARY_BYTES: usize = 160;
const MAX_FOCUS_REVISIT_LABEL_BYTES: usize = 80;
const MAX_JSON_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_FOCUS_STATE_BYTES: usize = 64 * 1024;
const RETAINED_GENERATIONS: i64 = 3;
const RETAINED_UNVERIFIED_GENERATIONS: i64 = 3;
const SAVE_CANDIDATE_SCAN_ROWS_PER_PAGE: i64 = 1;
#[cfg(feature = "desktop-e2e")]
const E2E_INTERRUPTED_CHECKPOINT_SLOT: &str = "ipc-interrupted-checkpoint";
#[cfg(feature = "desktop-e2e")]
const E2E_CORRUPT_RECOVERY_SLOT: &str = "ipc-corrupt-recovery";

#[derive(Debug)]
pub struct PersistenceError(String);

impl PersistenceError {
    fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl Display for PersistenceError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl Error for PersistenceError {}

impl From<rusqlite::Error> for PersistenceError {
    fn from(error: rusqlite::Error) -> Self {
        Self(error.to_string())
    }
}

impl From<serde_json::Error> for PersistenceError {
    fn from(error: serde_json::Error) -> Self {
        Self(error.to_string())
    }
}

impl From<std::io::Error> for PersistenceError {
    fn from(error: std::io::Error) -> Self {
        Self(error.to_string())
    }
}

type Result<T> = std::result::Result<T, PersistenceError>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveSlotSummary {
    pub slot_id: String,
    pub name: String,
    pub head_generation: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoadedSave {
    pub slot_id: String,
    pub name: String,
    pub head_generation: Option<i64>,
    pub recovered_generation: i64,
    pub recovered_from_corruption: bool,
    pub saved_at_ms: i64,
    pub focus_session: Option<FocusSession>,
    pub snapshot: String,
    pub checksum: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveCandidatePage {
    pub candidates: Vec<LoadedSave>,
    pub next_before_generation: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveCommitReceipt {
    pub slot_id: String,
    pub name: String,
    pub head_generation: i64,
    pub saved_at_ms: i64,
    pub checksum: String,
}

impl From<LoadedSave> for SaveCommitReceipt {
    fn from(loaded: LoadedSave) -> Self {
        Self {
            slot_id: loaded.slot_id,
            name: loaded.name,
            head_generation: loaded
                .head_generation
                .expect("a committed save always has a head generation"),
            saved_at_ms: loaded.saved_at_ms,
            checksum: loaded.checksum,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusSession {
    pub session_id: String,
    pub slot_id: Option<String>,
    pub started_at_ms: i64,
    pub ended_at_ms: Option<i64>,
    pub planned_focus_ms: i64,
    pub focused_ms: i64,
    pub planned_break_ms: i64,
    pub break_ms: i64,
    pub issued_simulation_ticks: i64,
    pub status: FocusSessionStatus,
    pub state_json: String,
    pub recap_event_ids: Vec<u64>,
    #[serde(default)]
    pub recap_entries: Vec<FocusRecapEntry>,
    #[serde(default)]
    pub review: Option<FocusSessionReview>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StoredFocusSession {
    pub session: FocusSession,
    pub authority_session: Option<FocusSession>,
    pub checkpoint_generation: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusRecapEntry {
    pub id: u64,
    pub tick: u64,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusSessionReview {
    pub version: u32,
    pub baseline_event_id: u64,
    pub before: FocusWorldMoment,
    pub after: FocusWorldMoment,
    pub revisit_target: Option<FocusRevisitTarget>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusWorldMoment {
    pub tick: u64,
    pub detailed_population: u64,
    pub surface_population: u64,
    pub food: u64,
    pub water: u64,
    pub timber: u64,
    pub stone: u64,
    pub operational_structures: u64,
    pub active_construction: u64,
    pub households: u64,
    pub scarcity: u64,
    pub stability: u64,
    pub active_settlements: u64,
    pub active_civilizations: u64,
    pub active_routes: u64,
    pub active_conflicts: u64,
    pub active_crises: u64,
    pub ruins: u64,
    pub leading_settlement: Option<FocusLeadingSettlement>,
    pub offworld_population: u64,
    pub active_missions: u64,
    pub active_colonies: u64,
    pub contacted_aliens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusLeadingSettlement {
    pub id: u64,
    pub name: String,
    pub development_stage: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusRevisitTarget {
    pub kind: FocusRevisitKind,
    pub id: u64,
    pub label: String,
    pub source_event_id: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FocusRevisitKind {
    Person,
    Structure,
    Settlement,
    Route,
    Ruin,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FocusSessionStatus {
    Active,
    Paused,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum FocusPhase {
    Idle,
    FocusRunning,
    FocusPaused,
    FocusCompleted,
    FocusCancelled,
    BreakRunning,
    BreakPaused,
    Finished,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum FocusOutcome {
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FocusState {
    version: u32,
    phase: FocusPhase,
    focus_duration_ms: Option<u64>,
    break_duration_ms: Option<u64>,
    simulation_ticks_per_focus_second: Option<u64>,
    accumulated_focus_ms: u64,
    accumulated_break_ms: u64,
    total_issued_simulation_ticks: u64,
    simulation_tick_remainder: u64,
    started_at_epoch_ms: Option<u64>,
    focus_started_at_epoch_ms: Option<u64>,
    focus_ended_at_epoch_ms: Option<u64>,
    break_started_at_epoch_ms: Option<u64>,
    break_ended_at_epoch_ms: Option<u64>,
    ended_at_epoch_ms: Option<u64>,
    active_segment_started_at_epoch_ms: Option<u64>,
    last_observed_epoch_ms: Option<u64>,
    outcome: Option<FocusOutcome>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppSettings {
    pub focus_to_sim_ratio: u32,
    pub default_focus_minutes: u32,
    pub default_break_minutes: u32,
    pub volume_percent: u32,
    pub audio_muted: bool,
    pub ambience_enabled: bool,
    pub ambience_volume_percent: u32,
    pub effects_volume_percent: u32,
    pub offline_progression_enabled: bool,
    pub max_offline_hours: u32,
    pub calm_mode: bool,
    #[serde(default)]
    pub reduced_effects: bool,
    pub notifications_enabled: bool,
    pub sound_enabled: bool,
    pub breaks_enabled: bool,
    pub active_slot_id: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            focus_to_sim_ratio: 10,
            default_focus_minutes: 25,
            default_break_minutes: 5,
            volume_percent: 70,
            audio_muted: false,
            ambience_enabled: false,
            ambience_volume_percent: 20,
            effects_volume_percent: 45,
            offline_progression_enabled: true,
            max_offline_hours: 24,
            calm_mode: false,
            reduced_effects: false,
            notifications_enabled: true,
            sound_enabled: true,
            breaks_enabled: false,
            active_slot_id: None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveExportEnvelope {
    format: String,
    version: u32,
    slot_id: String,
    name: String,
    snapshot: String,
    checksum: String,
}

pub struct PersistenceState {
    database: Mutex<PersistenceDatabase>,
    database_path: PathBuf,
}

impl PersistenceState {
    pub fn open_app_local_data(app_local_data: &Path) -> Result<Self> {
        fs::create_dir_all(app_local_data)?;
        let database_path = app_local_data.join(DATABASE_FILE);
        let database = PersistenceDatabase::open(&database_path)?;
        Ok(Self {
            database: Mutex::new(database),
            database_path,
        })
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, PersistenceDatabase>> {
        self.database
            .lock()
            .map_err(|_| PersistenceError::new("persistence database lock was poisoned"))
    }

    fn defer_prune(&self, slot_id: String, head_generation: i64) {
        let database_path = self.database_path.clone();
        let _ = std::thread::Builder::new()
            .name("chrono-forge-save-retention".to_owned())
            .spawn(move || {
                let Ok(mut database) = PersistenceDatabase::open_existing_for_prune(&database_path)
                else {
                    return;
                };
                let _ = database.prune_old_generations(&slot_id, head_generation);
            });
    }
}

struct PersistenceDatabase {
    connection: Connection,
}

impl PersistenceDatabase {
    fn open(path: &Path) -> Result<Self> {
        let connection = Connection::open(path)?;
        let mut database = Self { connection };
        database.migrate()?;
        Ok(database)
    }

    fn open_existing_for_prune(path: &Path) -> Result<Self> {
        let connection = Connection::open(path)?;
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;",
        )?;
        Ok(Self { connection })
    }

    #[cfg(test)]
    fn in_memory() -> Result<Self> {
        let connection = Connection::open_in_memory()?;
        let mut database = Self { connection };
        database.migrate()?;
        Ok(database)
    }

    fn migrate(&mut self) -> Result<()> {
        self.connection.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = FULL;
            PRAGMA busy_timeout = 5000;

            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_marker INTEGER NOT NULL
            );
            ",
        )?;

        let newest_version: Option<i64> =
            self.connection
                .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                    row.get(0)
                })?;
        if newest_version.is_some_and(|version| version > SCHEMA_VERSION) {
            return Err(PersistenceError::new(
                "database schema is newer than this Chrono Forge build",
            ));
        }

        self.connection.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS save_slots (
                slot_id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                head_generation INTEGER,
                FOREIGN KEY (slot_id, head_generation)
                    REFERENCES save_generations(slot_id, generation)
                    DEFERRABLE INITIALLY DEFERRED
            );

            CREATE TABLE IF NOT EXISTS save_generations (
                slot_id TEXT NOT NULL,
                generation INTEGER NOT NULL,
                snapshot TEXT NOT NULL,
                checksum TEXT NOT NULL,
                PRIMARY KEY (slot_id, generation),
                FOREIGN KEY (slot_id) REFERENCES save_slots(slot_id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_save_generations_newest
                ON save_generations (slot_id, generation DESC);

            CREATE TABLE IF NOT EXISTS focus_sessions (
                session_id TEXT PRIMARY KEY NOT NULL,
                slot_id TEXT,
                started_at_ms INTEGER NOT NULL,
                ended_at_ms INTEGER,
                planned_focus_ms INTEGER NOT NULL,
                focused_ms INTEGER NOT NULL,
                planned_break_ms INTEGER NOT NULL,
                break_ms INTEGER NOT NULL,
                issued_simulation_ticks INTEGER NOT NULL,
                status TEXT NOT NULL,
                state_json TEXT NOT NULL,
                recap_event_ids_json TEXT NOT NULL,
                FOREIGN KEY (slot_id) REFERENCES save_slots(slot_id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_focus_sessions_newest
                ON focus_sessions (started_at_ms DESC, session_id ASC);

            CREATE TABLE IF NOT EXISTS app_settings (
                singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                focus_to_sim_ratio INTEGER NOT NULL,
                default_focus_minutes INTEGER NOT NULL,
                default_break_minutes INTEGER NOT NULL,
                volume_percent INTEGER NOT NULL,
                offline_progression_enabled INTEGER NOT NULL
                    CHECK (offline_progression_enabled IN (0, 1)),
                max_offline_hours INTEGER NOT NULL,
                calm_mode INTEGER NOT NULL CHECK (calm_mode IN (0, 1)),
                notifications_enabled INTEGER NOT NULL CHECK (notifications_enabled IN (0, 1)),
                sound_enabled INTEGER NOT NULL CHECK (sound_enabled IN (0, 1)),
                breaks_enabled INTEGER NOT NULL CHECK (breaks_enabled IN (0, 1))
            );
            ",
        )?;
        self.connection.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, applied_marker) VALUES (1, 1)",
            [],
        )?;
        let newest_version: i64 =
            self.connection
                .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                    row.get(0)
                })?;
        if newest_version < 2 {
            let transaction = self
                .connection
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            transaction.execute_batch(
                "ALTER TABLE save_generations
                 ADD COLUMN saved_at_ms INTEGER NOT NULL DEFAULT 0;",
            )?;
            transaction.execute(
                "INSERT INTO schema_migrations (version, applied_marker) VALUES (2, 1)",
                [],
            )?;
            transaction.commit()?;
        }
        if newest_version < 3 {
            let transaction = self
                .connection
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            transaction.execute_batch(
                "ALTER TABLE save_generations ADD COLUMN focus_session_json TEXT;
                 ALTER TABLE app_settings ADD COLUMN active_slot_id TEXT;",
            )?;
            transaction.execute(
                "INSERT INTO schema_migrations (version, applied_marker) VALUES (3, 1)",
                [],
            )?;
            transaction.commit()?;
        }
        if newest_version < 4 {
            let transaction = self
                .connection
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            transaction.execute_batch(
                "ALTER TABLE focus_sessions ADD COLUMN recap_entries_json TEXT NOT NULL DEFAULT '[]';
                 ALTER TABLE app_settings ADD COLUMN reduced_effects INTEGER NOT NULL DEFAULT 0
                     CHECK (reduced_effects IN (0, 1));",
            )?;
            transaction.execute(
                "INSERT INTO schema_migrations (version, applied_marker) VALUES (4, 1)",
                [],
            )?;
            transaction.commit()?;
        }
        if newest_version < 5 {
            let transaction = self
                .connection
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            transaction.execute_batch("ALTER TABLE focus_sessions ADD COLUMN review_json TEXT;")?;
            transaction.execute(
                "INSERT INTO schema_migrations (version, applied_marker) VALUES (5, 1)",
                [],
            )?;
            transaction.commit()?;
        }
        if newest_version < 6 {
            let transaction = self
                .connection
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            transaction.execute_batch(
                "ALTER TABLE focus_sessions ADD COLUMN checkpoint_generation INTEGER;
                 ALTER TABLE focus_sessions ADD COLUMN review_authority_json TEXT;
                 ALTER TABLE focus_sessions ADD COLUMN review_authority_checksum TEXT;",
            )?;
            transaction.execute(
                "INSERT INTO schema_migrations (version, applied_marker) VALUES (6, 1)",
                [],
            )?;
            transaction.commit()?;
        }
        if newest_version < 7 {
            let transaction = self
                .connection
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            transaction.execute_batch(
                "ALTER TABLE app_settings ADD COLUMN audio_muted INTEGER NOT NULL DEFAULT 0
                     CHECK (audio_muted IN (0, 1));
                 ALTER TABLE app_settings ADD COLUMN ambience_enabled INTEGER NOT NULL DEFAULT 0
                     CHECK (ambience_enabled IN (0, 1));
                 ALTER TABLE app_settings ADD COLUMN ambience_volume_percent INTEGER NOT NULL DEFAULT 20;
                 ALTER TABLE app_settings ADD COLUMN effects_volume_percent INTEGER NOT NULL DEFAULT 45;",
            )?;
            transaction.execute(
                "INSERT INTO schema_migrations (version, applied_marker) VALUES (7, 1)",
                [],
            )?;
            transaction.commit()?;
        }
        if newest_version < 8 {
            let transaction = self
                .connection
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            transaction.execute_batch(
                "ALTER TABLE save_generations
                 ADD COLUMN semantically_verified INTEGER NOT NULL DEFAULT 0
                     CHECK (semantically_verified IN (0, 1));",
            )?;
            transaction.execute(
                "INSERT INTO schema_migrations (version, applied_marker) VALUES (8, 1)",
                [],
            )?;
            transaction.commit()?;
        }
        Ok(())
    }

    fn list_slots(&self) -> Result<Vec<SaveSlotSummary>> {
        let mut statement = self.connection.prepare(
            "SELECT slot_id, name, head_generation FROM save_slots ORDER BY slot_id ASC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(SaveSlotSummary {
                slot_id: row.get(0)?,
                name: row.get(1)?,
                head_generation: row.get(2)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    #[cfg(test)]
    fn load_slot(&self, slot_id: &str) -> Result<Option<LoadedSave>> {
        let Some(mut page) = self.load_slot_candidates(slot_id)? else {
            return Ok(None);
        };
        loop {
            if let Some(candidate) = page.candidates.into_iter().next() {
                return Ok(Some(candidate));
            }
            let Some(before_generation) = page.next_before_generation else {
                return Err(PersistenceError::new(
                    "save slot has no generation with a verified snapshot",
                ));
            };
            page = self
                .load_slot_fallback_candidates(slot_id, before_generation)?
                .ok_or_else(|| PersistenceError::new("save slot disappeared during recovery"))?;
        }
    }

    fn load_slot_candidates(&self, slot_id: &str) -> Result<Option<SaveCandidatePage>> {
        validate_identifier(slot_id, "slot ID")?;
        let slot = self
            .connection
            .query_row(
                "SELECT name, head_generation FROM save_slots WHERE slot_id = ?1",
                [slot_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<i64>>(1)?)),
            )
            .optional()?;
        let Some((name, head_generation)) = slot else {
            return Ok(None);
        };

        if let Some(head_generation) = head_generation {
            let head = self
                .connection
                .query_row(
                    "SELECT snapshot, checksum, saved_at_ms, focus_session_json FROM save_generations
                     WHERE slot_id = ?1 AND generation = ?2",
                    params![slot_id, head_generation],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, Option<String>>(3)?,
                        ))
                    },
                )
                .optional()?;
            if let Some((snapshot, checksum, saved_at_ms, focus_session_json)) = head
                && validate_snapshot(&snapshot).is_ok()
                && checksum == sha256_hex(&snapshot)
                && saved_at_ms >= 0
                && let Ok(focus_session) =
                    parse_focus_checkpoint(slot_id, &snapshot, focus_session_json.as_deref())
            {
                let head = LoadedSave {
                    slot_id: slot_id.to_owned(),
                    name: name.clone(),
                    head_generation: Some(head_generation),
                    recovered_generation: head_generation,
                    recovered_from_corruption: false,
                    saved_at_ms,
                    focus_session,
                    snapshot,
                    checksum,
                };
                // The common path returns only the verified head. Older generations are loaded
                // lazily only if the TypeScript semantic validator rejects this candidate.
                return Ok(Some(SaveCandidatePage {
                    candidates: vec![head],
                    next_before_generation: Some(head_generation),
                }));
            }
        }

        Ok(Some(self.fallback_candidate_page(
            slot_id,
            &name,
            head_generation,
            None,
        )?))
    }

    fn load_slot_fallback_candidates(
        &self,
        slot_id: &str,
        before_generation: i64,
    ) -> Result<Option<SaveCandidatePage>> {
        validate_identifier(slot_id, "slot ID")?;
        if before_generation < 1 {
            return Err(PersistenceError::new(
                "fallback generation boundary must be positive",
            ));
        }
        let slot = self
            .connection
            .query_row(
                "SELECT name, head_generation FROM save_slots WHERE slot_id = ?1",
                [slot_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<i64>>(1)?)),
            )
            .optional()?;
        let Some((name, head_generation)) = slot else {
            return Ok(None);
        };
        Ok(Some(self.fallback_candidate_page(
            slot_id,
            &name,
            head_generation,
            Some(before_generation),
        )?))
    }

    fn fallback_candidate_page(
        &self,
        slot_id: &str,
        name: &str,
        head_generation: Option<i64>,
        before_generation: Option<i64>,
    ) -> Result<SaveCandidatePage> {
        let mut statement = self.connection.prepare(
            "SELECT generation, snapshot, checksum, saved_at_ms, focus_session_json
             FROM save_generations
             WHERE slot_id = ?1 AND (?2 IS NULL OR generation < ?2)
             ORDER BY generation DESC
             LIMIT ?3",
        )?;
        let generations = statement.query_map(
            params![
                slot_id,
                before_generation,
                SAVE_CANDIDATE_SCAN_ROWS_PER_PAGE
            ],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            },
        )?;
        let mut candidates = Vec::new();
        let mut next_before_generation = None;
        for generation in generations {
            let (generation, snapshot, checksum, saved_at_ms, focus_session_json) = generation?;
            next_before_generation = Some(generation);
            if validate_snapshot(&snapshot).is_ok()
                && checksum == sha256_hex(&snapshot)
                && saved_at_ms >= 0
                && let Ok(focus_session) =
                    parse_focus_checkpoint(slot_id, &snapshot, focus_session_json.as_deref())
            {
                candidates.push(LoadedSave {
                    slot_id: slot_id.to_owned(),
                    name: name.to_owned(),
                    head_generation,
                    recovered_generation: generation,
                    recovered_from_corruption: true,
                    saved_at_ms,
                    focus_session,
                    snapshot,
                    checksum,
                });
            }
        }
        Ok(SaveCandidatePage {
            candidates,
            next_before_generation,
        })
    }

    fn commit_slot(&mut self, slot_id: &str, name: &str, snapshot: &str) -> Result<LoadedSave> {
        self.commit_slot_inner(slot_id, name, snapshot, None, false)
    }

    fn commit_focus_checkpoint(
        &mut self,
        slot_id: &str,
        name: &str,
        snapshot: &str,
        session: &FocusSession,
    ) -> Result<LoadedSave> {
        self.commit_slot_inner(slot_id, name, snapshot, Some(session), false)
    }

    fn commit_slot_inner(
        &mut self,
        slot_id: &str,
        name: &str,
        snapshot: &str,
        focus_session: Option<&FocusSession>,
        fail_before_head_update: bool,
    ) -> Result<LoadedSave> {
        #[cfg(feature = "desktop-e2e")]
        let fail_before_head_update =
            fail_before_head_update || slot_id == E2E_INTERRUPTED_CHECKPOINT_SLOT;
        validate_identifier(slot_id, "slot ID")?;
        validate_name(name)?;
        if let Some(session) = focus_session {
            validate_focus_session(session)?;
            if session.slot_id.as_deref() != Some(slot_id) {
                return Err(PersistenceError::new(
                    "focus checkpoint session must belong to its save slot",
                ));
            }
            validate_recap_event_references_in_snapshot(session, snapshot)?;
        } else {
            validate_snapshot(snapshot)?;
        }
        let saved_at_ms = current_unix_epoch_ms()?;
        let checksum = sha256_hex(snapshot);
        let focus_session_json = focus_session.map(serde_json::to_string).transpose()?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute(
            "INSERT INTO save_slots (slot_id, name, head_generation) VALUES (?1, ?2, NULL)
             ON CONFLICT(slot_id) DO UPDATE SET name = excluded.name",
            params![slot_id, name],
        )?;
        let has_semantically_verified_generation = transaction.query_row(
            "SELECT EXISTS(
                 SELECT 1 FROM save_generations
                 WHERE slot_id = ?1 AND semantically_verified = 1
             )",
            [slot_id],
            |row| row.get::<_, bool>(0),
        )?;
        let unverified_generation_count = transaction.query_row(
            "SELECT COUNT(*) FROM save_generations
             WHERE slot_id = ?1 AND semantically_verified = 0",
            [slot_id],
            |row| row.get::<_, i64>(0),
        )?;
        if !has_semantically_verified_generation
            && unverified_generation_count >= RETAINED_UNVERIFIED_GENERATIONS
        {
            return Err(PersistenceError::new(
                "save slot requires semantic validation before another generation can be committed",
            ));
        }
        let prior_generation: Option<i64> = transaction.query_row(
            "SELECT MAX(generation) FROM save_generations WHERE slot_id = ?1",
            [slot_id],
            |row| row.get(0),
        )?;
        let next_generation = prior_generation
            .unwrap_or(0)
            .checked_add(1)
            .ok_or_else(|| PersistenceError::new("save generation counter overflowed"))?;
        transaction.execute(
            "INSERT INTO save_generations
             (slot_id, generation, saved_at_ms, focus_session_json, snapshot, checksum)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                slot_id,
                next_generation,
                saved_at_ms,
                focus_session_json,
                snapshot,
                checksum
            ],
        )?;
        let inserted = transaction.query_row(
            "SELECT snapshot, checksum, focus_session_json FROM save_generations
             WHERE slot_id = ?1 AND generation = ?2",
            params![slot_id, next_generation],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )?;
        verify_inserted_generation(
            &inserted.0,
            &inserted.1,
            inserted.2.as_deref(),
            snapshot,
            &checksum,
            focus_session_json.as_deref(),
        )?;
        if let Some(session) = focus_session {
            upsert_focus_session(
                &transaction,
                session,
                Some((
                    next_generation,
                    focus_session_json
                        .as_deref()
                        .ok_or_else(|| PersistenceError::new("focus checkpoint JSON is missing"))?,
                )),
            )?;
        }
        if fail_before_head_update {
            return Err(PersistenceError::new(
                "injected commit failure before head update",
            ));
        }
        #[cfg(feature = "desktop-e2e")]
        if slot_id == E2E_CORRUPT_RECOVERY_SLOT && next_generation == 2 {
            transaction.execute(
                "UPDATE save_generations SET checksum = ?3
                 WHERE slot_id = ?1 AND generation = ?2",
                params![slot_id, next_generation, "0".repeat(64)],
            )?;
        }
        transaction.execute(
            "UPDATE save_slots SET head_generation = ?2 WHERE slot_id = ?1",
            params![slot_id, next_generation],
        )?;
        if has_semantically_verified_generation {
            // Semantic confirmation is deliberately best-effort after a durable commit so a
            // broker timeout cannot invite a duplicate write. Once a confirmed recovery baseline
            // exists, retain only the newest bounded unverified tail around that baseline.
            prune_unverified_generations(&transaction, slot_id)?;
        }
        transaction.commit()?;

        Ok(LoadedSave {
            slot_id: slot_id.to_owned(),
            name: name.to_owned(),
            head_generation: Some(next_generation),
            recovered_generation: next_generation,
            recovered_from_corruption: false,
            saved_at_ms,
            focus_session: focus_session.cloned(),
            snapshot: snapshot.to_owned(),
            checksum,
        })
    }

    fn confirm_semantically_valid_generation(
        &mut self,
        slot_id: &str,
        generation: i64,
        checksum: &str,
    ) -> Result<i64> {
        validate_identifier(slot_id, "slot ID")?;
        if generation <= 0 || !is_sha256_hex(checksum) {
            return Err(PersistenceError::new(
                "semantic save confirmation is malformed",
            ));
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let candidate = transaction
            .query_row(
                "SELECT snapshot, checksum, saved_at_ms, focus_session_json
                 FROM save_generations
                 WHERE slot_id = ?1 AND generation = ?2",
                params![slot_id, generation],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| PersistenceError::new("save generation does not exist"))?;
        if candidate.1 != checksum
            || sha256_hex(&candidate.0) != checksum
            || candidate.2 < 0
            || validate_snapshot(&candidate.0).is_err()
            || parse_focus_checkpoint(slot_id, &candidate.0, candidate.3.as_deref()).is_err()
        {
            return Err(PersistenceError::new(
                "semantic save confirmation does not match verified stored material",
            ));
        }
        transaction.execute(
            "UPDATE save_generations SET semantically_verified = 1
             WHERE slot_id = ?1 AND generation = ?2",
            params![slot_id, generation],
        )?;
        // Confirmation establishes a canonical recovery baseline, so migrated or outage-era
        // unverified material can now be bounded without risking the only recoverable generation.
        prune_unverified_generations(&transaction, slot_id)?;
        let head_generation = transaction
            .query_row(
                "SELECT head_generation FROM save_slots WHERE slot_id = ?1",
                [slot_id],
                |row| row.get::<_, Option<i64>>(0),
            )?
            .ok_or_else(|| PersistenceError::new("save slot has no head generation"))?;
        transaction.commit()?;
        Ok(head_generation)
    }

    fn prune_old_generations(&mut self, slot_id: &str, head_generation: i64) -> Result<()> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let oldest_retained_verified_generation = {
            let mut statement = transaction.prepare(
                "SELECT generation, snapshot, checksum, saved_at_ms, focus_session_json
                 FROM save_generations
                 WHERE slot_id = ?1 AND generation <= ?2 AND semantically_verified = 1
                 ORDER BY generation DESC",
            )?;
            let mut rows = statement.query(params![slot_id, head_generation])?;
            let mut verified_count = 0;
            let mut oldest_retained = None;
            while let Some(row) = rows.next()? {
                let generation = row.get::<_, i64>(0)?;
                let snapshot = row.get::<_, String>(1)?;
                let checksum = row.get::<_, String>(2)?;
                let saved_at_ms = row.get::<_, i64>(3)?;
                let focus_session_json = row.get::<_, Option<String>>(4)?;
                if validate_snapshot(&snapshot).is_ok()
                    && checksum == sha256_hex(&snapshot)
                    && saved_at_ms >= 0
                    && parse_focus_checkpoint(slot_id, &snapshot, focus_session_json.as_deref())
                        .is_ok()
                {
                    verified_count += 1;
                    if verified_count == RETAINED_GENERATIONS {
                        oldest_retained = Some(generation);
                        break;
                    }
                }
            }
            oldest_retained
        };
        if let Some(oldest_retained) = oldest_retained_verified_generation {
            // Only generations explicitly confirmed after the TypeScript canonical parser accepts
            // them can establish the cutoff. JSON/checksum-valid but semantically invalid rows may
            // remain as evidence, but they can never displace the three recoverable generations.
            transaction.execute(
                "DELETE FROM save_generations WHERE slot_id = ?1 AND generation < ?2",
                params![slot_id, oldest_retained],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    fn delete_slot(&mut self, slot_id: &str) -> Result<bool> {
        validate_identifier(slot_id, "slot ID")?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let deleted =
            transaction.execute("DELETE FROM save_slots WHERE slot_id = ?1", [slot_id])? > 0;
        if deleted {
            transaction.execute(
                "UPDATE app_settings SET active_slot_id = NULL WHERE active_slot_id = ?1",
                [slot_id],
            )?;
        }
        transaction.commit()?;
        Ok(deleted)
    }

    #[cfg(test)]
    fn export_slot(&self, slot_id: &str) -> Result<String> {
        let loaded = self
            .load_slot(slot_id)?
            .ok_or_else(|| PersistenceError::new("save slot does not exist"))?;
        serde_json::to_string(&SaveExportEnvelope {
            format: "chrono-forge-save-export".to_owned(),
            version: 1,
            slot_id: loaded.slot_id,
            name: loaded.name,
            snapshot: loaded.snapshot,
            checksum: loaded.checksum,
        })
        .map_err(Into::into)
    }

    fn export_generation(&self, slot_id: &str, generation: i64) -> Result<String> {
        validate_identifier(slot_id, "slot ID")?;
        if generation <= 0 {
            return Err(PersistenceError::new("save generation must be positive"));
        }
        let candidate = self
            .connection
            .query_row(
                "SELECT save_slots.name, save_generations.snapshot, save_generations.checksum
                 FROM save_generations
                 JOIN save_slots USING (slot_id)
                 WHERE save_generations.slot_id = ?1 AND save_generations.generation = ?2",
                params![slot_id, generation],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| PersistenceError::new("save generation does not exist"))?;
        if validate_snapshot(&candidate.1).is_err() || candidate.2 != sha256_hex(&candidate.1) {
            return Err(PersistenceError::new(
                "save generation failed checksum verification",
            ));
        }
        serde_json::to_string(&SaveExportEnvelope {
            format: "chrono-forge-save-export".to_owned(),
            version: 1,
            slot_id: slot_id.to_owned(),
            name: candidate.0,
            snapshot: candidate.1,
            checksum: candidate.2,
        })
        .map_err(Into::into)
    }

    fn import_slot(&mut self, package: &str) -> Result<LoadedSave> {
        if package.len() > MAX_SNAPSHOT_BYTES.saturating_add(1024 * 1024) {
            return Err(PersistenceError::new(
                "import package exceeds the size limit",
            ));
        }
        let export: SaveExportEnvelope = serde_json::from_str(package)?;
        if export.format != "chrono-forge-save-export" || export.version != 1 {
            return Err(PersistenceError::new(
                "unsupported save import format or version",
            ));
        }
        validate_identifier(&export.slot_id, "slot ID")?;
        validate_name(&export.name)?;
        validate_snapshot(&export.snapshot)?;
        if export.checksum != sha256_hex(&export.snapshot) {
            return Err(PersistenceError::new(
                "save import checksum does not match its snapshot",
            ));
        }
        self.commit_slot(&export.slot_id, &export.name, &export.snapshot)
    }

    fn record_focus_session(&mut self, session: &FocusSession) -> Result<()> {
        validate_focus_session(session)?;
        self.validate_recap_event_references(session)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        upsert_focus_session(&transaction, session, None)?;
        transaction.commit()?;
        Ok(())
    }

    fn validate_recap_event_references(&self, session: &FocusSession) -> Result<()> {
        if session.recap_event_ids.is_empty() && session.review.is_none() {
            return Ok(());
        }
        let slot_id = session.slot_id.as_deref().ok_or_else(|| {
            PersistenceError::new("focus review or recap requires a source save slot")
        })?;
        let snapshot = self
            .connection
            .query_row(
                "SELECT save_generations.snapshot
                 FROM save_slots
                 JOIN save_generations
                   ON save_generations.slot_id = save_slots.slot_id
                  AND save_generations.generation = save_slots.head_generation
                 WHERE save_slots.slot_id = ?1",
                [slot_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| PersistenceError::new("focus recap source save is unavailable"))?;
        validate_recap_event_references_in_snapshot(session, &snapshot)
    }

    fn list_focus_session_records(&self) -> Result<Vec<StoredFocusSession>> {
        let mut statement = self.connection.prepare(
            "SELECT session_id, slot_id, started_at_ms, ended_at_ms, planned_focus_ms, focused_ms,
                    planned_break_ms, break_ms, issued_simulation_ticks, status,
                    state_json, recap_event_ids_json, recap_entries_json, review_json,
                    checkpoint_generation, review_authority_json, review_authority_checksum
             FROM focus_sessions ORDER BY started_at_ms DESC, session_id ASC",
        )?;
        let rows = statement.query_map([], |row| {
            let status = focus_status_from_db(&row.get::<_, String>(9)?)?;
            let recap_event_ids =
                serde_json::from_str(&row.get::<_, String>(11)?).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        11,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;
            let recap_entries =
                serde_json::from_str(&row.get::<_, String>(12)?).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        12,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;
            let review = row
                .get::<_, Option<String>>(13)?
                .map(|json| serde_json::from_str(&json))
                .transpose()
                .map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        13,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;
            let session = FocusSession {
                session_id: row.get(0)?,
                slot_id: row.get(1)?,
                started_at_ms: row.get(2)?,
                ended_at_ms: row.get(3)?,
                planned_focus_ms: row.get(4)?,
                focused_ms: row.get(5)?,
                planned_break_ms: row.get(6)?,
                break_ms: row.get(7)?,
                issued_simulation_ticks: row.get(8)?,
                status,
                state_json: row.get(10)?,
                recap_event_ids,
                recap_entries,
                review,
            };
            let checkpoint_generation = row.get::<_, Option<i64>>(14)?;
            let authority_json = row.get::<_, Option<String>>(15)?;
            let authority_checksum = row.get::<_, Option<String>>(16)?;
            let authority_session = match (
                checkpoint_generation,
                authority_json.as_deref(),
                authority_checksum.as_deref(),
            ) {
                (Some(generation), Some(json), Some(checksum))
                    if generation > 0 && sha256_hex(json) == checksum =>
                {
                    serde_json::from_str::<FocusSession>(json)
                        .ok()
                        .filter(|authority| validate_focus_session(authority).is_ok())
                        .filter(|authority| has_same_checkpoint_identity(&session, authority))
                }
                _ => None,
            };
            Ok(StoredFocusSession {
                session,
                checkpoint_generation: authority_session.as_ref().and(checkpoint_generation),
                authority_session,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    #[cfg(test)]
    fn list_focus_sessions(&self) -> Result<Vec<FocusSession>> {
        Ok(self
            .list_focus_session_records()?
            .into_iter()
            .map(|record| record.session)
            .collect())
    }

    fn load_settings(&self) -> Result<AppSettings> {
        let settings = self
            .connection
            .query_row(
                "SELECT focus_to_sim_ratio, default_focus_minutes, default_break_minutes,
                        volume_percent, audio_muted, ambience_enabled, ambience_volume_percent,
                        effects_volume_percent, offline_progression_enabled, max_offline_hours,
                        calm_mode, notifications_enabled, sound_enabled, breaks_enabled,
                        active_slot_id, reduced_effects
                 FROM app_settings WHERE singleton = 1",
                [],
                |row| {
                    Ok(AppSettings {
                        focus_to_sim_ratio: row.get(0)?,
                        default_focus_minutes: row.get(1)?,
                        default_break_minutes: row.get(2)?,
                        volume_percent: row.get(3)?,
                        audio_muted: row.get::<_, i64>(4)? != 0,
                        ambience_enabled: row.get::<_, i64>(5)? != 0,
                        ambience_volume_percent: row.get(6)?,
                        effects_volume_percent: row.get(7)?,
                        offline_progression_enabled: row.get::<_, i64>(8)? != 0,
                        max_offline_hours: row.get(9)?,
                        calm_mode: row.get::<_, i64>(10)? != 0,
                        notifications_enabled: row.get::<_, i64>(11)? != 0,
                        sound_enabled: row.get::<_, i64>(12)? != 0,
                        breaks_enabled: row.get::<_, i64>(13)? != 0,
                        active_slot_id: row.get(14)?,
                        reduced_effects: row.get::<_, i64>(15)? != 0,
                    })
                },
            )
            .optional()?;
        let settings = settings.unwrap_or_default();
        validate_settings(&settings)?;
        Ok(settings)
    }

    fn save_settings(&mut self, settings: &AppSettings) -> Result<AppSettings> {
        validate_settings(settings)?;
        if let Some(active_slot_id) = &settings.active_slot_id {
            let exists = self.connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM save_slots WHERE slot_id = ?1)",
                [active_slot_id],
                |row| row.get::<_, i64>(0),
            )? != 0;
            if !exists {
                return Err(PersistenceError::new(
                    "active slot ID does not reference an existing save slot",
                ));
            }
        }
        self.connection.execute(
            "INSERT INTO app_settings
             (singleton, focus_to_sim_ratio, default_focus_minutes, default_break_minutes,
               volume_percent, audio_muted, ambience_enabled, ambience_volume_percent,
               effects_volume_percent, offline_progression_enabled, max_offline_hours, calm_mode,
               notifications_enabled, sound_enabled, breaks_enabled, active_slot_id, reduced_effects)
              VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
             ON CONFLICT(singleton) DO UPDATE SET
                 focus_to_sim_ratio = excluded.focus_to_sim_ratio,
                 default_focus_minutes = excluded.default_focus_minutes,
                 default_break_minutes = excluded.default_break_minutes,
                 volume_percent = excluded.volume_percent,
                 audio_muted = excluded.audio_muted,
                 ambience_enabled = excluded.ambience_enabled,
                 ambience_volume_percent = excluded.ambience_volume_percent,
                 effects_volume_percent = excluded.effects_volume_percent,
                 offline_progression_enabled = excluded.offline_progression_enabled,
                 max_offline_hours = excluded.max_offline_hours,
                 calm_mode = excluded.calm_mode,
                 notifications_enabled = excluded.notifications_enabled,
                  sound_enabled = excluded.sound_enabled,
                  breaks_enabled = excluded.breaks_enabled,
                  active_slot_id = excluded.active_slot_id,
                  reduced_effects = excluded.reduced_effects",
            params![
                settings.focus_to_sim_ratio,
                settings.default_focus_minutes,
                settings.default_break_minutes,
                settings.volume_percent,
                bool_to_db(settings.audio_muted),
                bool_to_db(settings.ambience_enabled),
                settings.ambience_volume_percent,
                settings.effects_volume_percent,
                bool_to_db(settings.offline_progression_enabled),
                settings.max_offline_hours,
                bool_to_db(settings.calm_mode),
                bool_to_db(settings.notifications_enabled),
                bool_to_db(settings.sound_enabled),
                bool_to_db(settings.breaks_enabled),
                settings.active_slot_id,
                bool_to_db(settings.reduced_effects),
            ],
        )?;
        Ok(settings.clone())
    }
}

fn prune_unverified_generations(
    transaction: &rusqlite::Transaction<'_>,
    slot_id: &str,
) -> Result<()> {
    transaction.execute(
        "DELETE FROM save_generations
         WHERE slot_id = ?1
           AND semantically_verified = 0
           AND generation NOT IN (
               SELECT generation FROM save_generations
               WHERE slot_id = ?1 AND semantically_verified = 0
               ORDER BY generation DESC
               LIMIT ?2
           )",
        params![slot_id, RETAINED_UNVERIFIED_GENERATIONS],
    )?;
    Ok(())
}

fn upsert_focus_session(
    transaction: &rusqlite::Transaction<'_>,
    session: &FocusSession,
    authority: Option<(i64, &str)>,
) -> Result<()> {
    validate_focus_session_update(transaction, session)?;
    let event_ids = serde_json::to_string(&session.recap_event_ids)?;
    let entries = serde_json::to_string(&session.recap_entries)?;
    let review = session
        .review
        .as_ref()
        .map(serde_json::to_string)
        .transpose()?;
    let checkpoint_generation = authority.map(|(generation, _)| generation);
    let authority_json = authority.map(|(_, json)| json);
    let authority_checksum = authority_json.map(sha256_hex);
    transaction.execute(
        "INSERT INTO focus_sessions
         (session_id, slot_id, started_at_ms, ended_at_ms, planned_focus_ms, focused_ms,
          planned_break_ms, break_ms, issued_simulation_ticks, status, state_json,
           recap_event_ids_json, recap_entries_json, review_json, checkpoint_generation,
           review_authority_json, review_authority_checksum)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                  ?15, ?16, ?17)
         ON CONFLICT(session_id) DO UPDATE SET
             slot_id = excluded.slot_id,
             started_at_ms = excluded.started_at_ms,
             ended_at_ms = excluded.ended_at_ms,
             planned_focus_ms = excluded.planned_focus_ms,
             focused_ms = excluded.focused_ms,
             planned_break_ms = excluded.planned_break_ms,
             break_ms = excluded.break_ms,
             issued_simulation_ticks = excluded.issued_simulation_ticks,
             status = excluded.status,
             state_json = excluded.state_json,
              recap_event_ids_json = excluded.recap_event_ids_json,
              recap_entries_json = excluded.recap_entries_json,
              review_json = excluded.review_json,
              checkpoint_generation = COALESCE(
                  excluded.checkpoint_generation,
                  focus_sessions.checkpoint_generation
              ),
              review_authority_json = COALESCE(
                  excluded.review_authority_json,
                  focus_sessions.review_authority_json
              ),
              review_authority_checksum = COALESCE(
                  excluded.review_authority_checksum,
                  focus_sessions.review_authority_checksum
              )",
        params![
            session.session_id,
            session.slot_id,
            session.started_at_ms,
            session.ended_at_ms,
            session.planned_focus_ms,
            session.focused_ms,
            session.planned_break_ms,
            session.break_ms,
            session.issued_simulation_ticks,
            focus_status_to_db(&session.status),
            session.state_json,
            event_ids,
            entries,
            review,
            checkpoint_generation,
            authority_json,
            authority_checksum,
        ],
    )?;
    Ok(())
}

struct StoredFocusSessionProgress {
    slot_id: Option<String>,
    started_at_ms: i64,
    ended_at_ms: Option<i64>,
    planned_focus_ms: i64,
    focused_ms: i64,
    planned_break_ms: i64,
    break_ms: i64,
    issued_simulation_ticks: i64,
    status: FocusSessionStatus,
    state_json: String,
    recap_event_ids_json: String,
    recap_entries_json: String,
    review_json: Option<String>,
}

fn validate_focus_session_update(
    transaction: &rusqlite::Transaction<'_>,
    session: &FocusSession,
) -> Result<()> {
    let prior = transaction
        .query_row(
            "SELECT slot_id, started_at_ms, ended_at_ms, planned_focus_ms, focused_ms,
                    planned_break_ms, break_ms, issued_simulation_ticks, status, state_json,
                    recap_event_ids_json, recap_entries_json, review_json
             FROM focus_sessions WHERE session_id = ?1",
            [&session.session_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, String>(10)?,
                    row.get::<_, String>(11)?,
                    row.get::<_, Option<String>>(12)?,
                ))
            },
        )
        .optional()?;
    let Some((
        slot_id,
        started_at_ms,
        ended_at_ms,
        planned_focus_ms,
        focused_ms,
        planned_break_ms,
        break_ms,
        issued_simulation_ticks,
        status,
        state_json,
        recap_event_ids_json,
        recap_entries_json,
        review_json,
    )) = prior
    else {
        return Ok(());
    };
    let prior = StoredFocusSessionProgress {
        slot_id,
        started_at_ms,
        ended_at_ms,
        planned_focus_ms,
        focused_ms,
        planned_break_ms,
        break_ms,
        issued_simulation_ticks,
        status: focus_status_from_db(&status)?,
        state_json,
        recap_event_ids_json,
        recap_entries_json,
        review_json,
    };
    let immutable_identity_changed = prior.slot_id != session.slot_id
        || prior.started_at_ms != session.started_at_ms
        || prior.planned_focus_ms != session.planned_focus_ms
        || prior.planned_break_ms != session.planned_break_ms;
    let accounting_regressed = session.focused_ms < prior.focused_ms
        || session.break_ms < prior.break_ms
        || session.issued_simulation_ticks < prior.issued_simulation_ticks;
    let prior_terminal = matches!(
        prior.status,
        FocusSessionStatus::Completed | FocusSessionStatus::Cancelled
    );
    let recap_event_ids_json = serde_json::to_string(&session.recap_event_ids)?;
    let recap_entries_json = serde_json::to_string(&session.recap_entries)?;
    let review_json = session
        .review
        .as_ref()
        .map(serde_json::to_string)
        .transpose()?;
    let terminal_changed = prior_terminal
        && (prior.status != session.status
            || prior.ended_at_ms != session.ended_at_ms
            || prior.focused_ms != session.focused_ms
            || prior.break_ms != session.break_ms
            || prior.issued_simulation_ticks != session.issued_simulation_ticks
            || prior.state_json != session.state_json
            || prior.recap_event_ids_json != recap_event_ids_json
            || prior.recap_entries_json != recap_entries_json
            || prior.review_json != review_json);
    if immutable_identity_changed || accounting_regressed || terminal_changed {
        return Err(PersistenceError::new(
            "focus session update is stale or changes immutable identity",
        ));
    }
    Ok(())
}

fn has_same_checkpoint_identity(session: &FocusSession, checkpoint: &FocusSession) -> bool {
    session.session_id == checkpoint.session_id
        && session.slot_id == checkpoint.slot_id
        && session.started_at_ms == checkpoint.started_at_ms
        && session.ended_at_ms == checkpoint.ended_at_ms
        && session.planned_focus_ms == checkpoint.planned_focus_ms
        && session.focused_ms == checkpoint.focused_ms
        && session.planned_break_ms == checkpoint.planned_break_ms
        && session.break_ms == checkpoint.break_ms
        && session.issued_simulation_ticks == checkpoint.issued_simulation_ticks
        && session.status == checkpoint.status
        && session.state_json == checkpoint.state_json
}

fn parse_focus_checkpoint(
    slot_id: &str,
    snapshot: &str,
    focus_session_json: Option<&str>,
) -> Result<Option<FocusSession>> {
    let Some(focus_session_json) = focus_session_json else {
        return Ok(None);
    };
    let session: FocusSession = serde_json::from_str(focus_session_json)?;
    validate_focus_session(&session)?;
    if session.slot_id.as_deref() != Some(slot_id) {
        return Err(PersistenceError::new(
            "focus checkpoint session must belong to its save slot",
        ));
    }
    validate_recap_event_references_in_snapshot(&session, snapshot)?;
    Ok(Some(session))
}

fn validate_recap_event_references_in_snapshot(
    session: &FocusSession,
    snapshot: &str,
) -> Result<()> {
    if session.recap_event_ids.is_empty() && session.review.is_none() {
        return validate_snapshot(snapshot);
    }
    let authority = parse_snapshot_authority(snapshot)?;
    validate_recap_event_references_in_snapshot_authority(session, &authority)
}

fn validate_recap_event_references_in_snapshot_authority(
    session: &FocusSession,
    authority: &SnapshotAuthority,
) -> Result<()> {
    if let Some(review) = &session.review
        && authority.tick != review.after.tick
    {
        return Err(PersistenceError::new(
            "focus review must describe the exact saved-world checkpoint",
        ));
    }
    if session.recap_event_ids.is_empty() {
        return Ok(());
    }
    if session
        .recap_event_ids
        .iter()
        .any(|event_id| !authority.events.contains_key(event_id))
    {
        return Err(PersistenceError::new(
            "focus recap references an event absent from its source save",
        ));
    }
    if session.recap_entries.iter().any(|entry| {
        authority.events.get(&entry.id).is_none_or(|source| {
            source.tick != Some(entry.tick)
                || source.summary.as_deref() != Some(entry.summary.as_str())
        })
    }) {
        return Err(PersistenceError::new(
            "focus recap copies do not match their authoritative source events",
        ));
    }
    Ok(())
}

fn validate_identifier(value: &str, label: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > MAX_ID_BYTES
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(PersistenceError::new(format!(
            "{label} must be 1-{MAX_ID_BYTES} ASCII letters, digits, '.', '_' or '-'"
        )));
    }
    Ok(())
}

fn validate_name(value: &str) -> Result<()> {
    if value.trim().is_empty() || value.len() > MAX_NAME_BYTES {
        return Err(PersistenceError::new(format!(
            "save name must be nonempty and at most {MAX_NAME_BYTES} bytes"
        )));
    }
    Ok(())
}

fn validate_snapshot_bounds(snapshot: &str) -> Result<()> {
    if snapshot.is_empty() || snapshot.len() > MAX_SNAPSHOT_BYTES {
        return Err(PersistenceError::new(format!(
            "snapshot must be nonempty and at most {MAX_SNAPSHOT_BYTES} bytes"
        )));
    }
    Ok(())
}

fn validate_snapshot(snapshot: &str) -> Result<()> {
    validate_snapshot_bounds(snapshot)?;
    serde_json::from_str::<serde::de::IgnoredAny>(snapshot)
        .map(|_| ())
        .map_err(|_| PersistenceError::new("snapshot must be valid JSON data"))
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

fn validate_settings(settings: &AppSettings) -> Result<()> {
    if !(1..=10_000).contains(&settings.focus_to_sim_ratio)
        || !(1..=1_440).contains(&settings.default_focus_minutes)
        || settings.default_break_minutes > 240
        || settings.volume_percent > 100
        || settings.ambience_volume_percent > 100
        || settings.effects_volume_percent > 100
        || settings.max_offline_hours > 168
    {
        return Err(PersistenceError::new(
            "settings contain a value outside its supported range",
        ));
    }
    if let Some(active_slot_id) = &settings.active_slot_id {
        validate_identifier(active_slot_id, "active slot ID")?;
    }
    Ok(())
}

fn validate_focus_session(session: &FocusSession) -> Result<()> {
    validate_identifier(&session.session_id, "focus session ID")?;
    if let Some(slot_id) = &session.slot_id {
        validate_identifier(slot_id, "save slot ID")?;
    }
    let terminal = matches!(
        session.status,
        FocusSessionStatus::Completed | FocusSessionStatus::Cancelled
    );
    if session.started_at_ms < 0
        || session
            .ended_at_ms
            .is_some_and(|ended_at_ms| ended_at_ms < session.started_at_ms)
        || terminal != session.ended_at_ms.is_some()
        || session.planned_focus_ms <= 0
        || session.focused_ms < 0
        || session.focused_ms > session.planned_focus_ms
        || session.planned_break_ms < 0
        || session.break_ms < 0
        || session.break_ms > session.planned_break_ms
        || session.issued_simulation_ticks < 0
        || session.state_json.is_empty()
        || session.state_json.len() > MAX_FOCUS_STATE_BYTES
        || serde_json::from_str::<serde_json::Value>(&session.state_json).is_err()
        || session.recap_event_ids.len() > MAX_RECAP_EVENT_IDS
        || session.recap_event_ids.contains(&0)
        || session
            .recap_event_ids
            .iter()
            .any(|event_id| *event_id > MAX_JSON_SAFE_INTEGER)
        || session
            .recap_event_ids
            .windows(2)
            .any(|event_ids| event_ids[0] >= event_ids[1])
    {
        return Err(PersistenceError::new(
            "focus session times, progress, status, or recap event IDs are invalid",
        ));
    }
    validate_recap_entries(session)?;
    validate_focus_session_review(session)?;
    validate_focus_state_summary(session)?;
    Ok(())
}

fn validate_focus_session_review(session: &FocusSession) -> Result<()> {
    let Some(review) = &session.review else {
        return Ok(());
    };
    if review.version != 1
        || review.baseline_event_id > MAX_JSON_SAFE_INTEGER
        || review.after.tick < review.before.tick
        || review.after.tick - review.before.tick != session.issued_simulation_ticks as u64
        || session
            .recap_event_ids
            .iter()
            .any(|event_id| *event_id <= review.baseline_event_id)
    {
        return Err(PersistenceError::new(
            "focus session review does not match its issued simulation ticks or event baseline",
        ));
    }
    validate_focus_world_moment(&review.before)?;
    validate_focus_world_moment(&review.after)?;
    if let Some(target) = &review.revisit_target
        && (target.id == 0
            || target.id > MAX_JSON_SAFE_INTEGER
            || target.label.trim().is_empty()
            || target.label.len() > MAX_FOCUS_REVISIT_LABEL_BYTES
            || target.source_event_id.is_some_and(|event_id| {
                event_id == 0
                    || event_id > MAX_JSON_SAFE_INTEGER
                    || !session.recap_event_ids.contains(&event_id)
            }))
    {
        return Err(PersistenceError::new(
            "focus revisit target is invalid or lacks its factual source event",
        ));
    }
    Ok(())
}

fn validate_focus_world_moment(moment: &FocusWorldMoment) -> Result<()> {
    let values = [
        moment.tick,
        moment.detailed_population,
        moment.surface_population,
        moment.food,
        moment.water,
        moment.timber,
        moment.stone,
        moment.operational_structures,
        moment.active_construction,
        moment.households,
        moment.scarcity,
        moment.stability,
        moment.active_settlements,
        moment.active_civilizations,
        moment.active_routes,
        moment.active_conflicts,
        moment.active_crises,
        moment.ruins,
        moment.offworld_population,
        moment.active_missions,
        moment.active_colonies,
        moment.contacted_aliens,
    ];
    if values.iter().any(|value| *value > MAX_JSON_SAFE_INTEGER) {
        return Err(PersistenceError::new(
            "focus world moment exceeds the JSON safe integer range",
        ));
    }
    if let Some(settlement) = &moment.leading_settlement
        && (settlement.id == 0
            || settlement.id > MAX_JSON_SAFE_INTEGER
            || settlement.name.trim().is_empty()
            || settlement.name.len() > MAX_FOCUS_REVISIT_LABEL_BYTES
            || !matches!(
                settlement.development_stage.as_str(),
                "founding" | "village" | "town" | "city" | "advanced-city"
            ))
    {
        return Err(PersistenceError::new("focus leading settlement is invalid"));
    }
    Ok(())
}

fn validate_recap_entries(session: &FocusSession) -> Result<()> {
    if session.recap_entries.is_empty() {
        return Ok(());
    }
    if session.recap_entries.len() != session.recap_event_ids.len()
        || session
            .recap_entries
            .iter()
            .zip(&session.recap_event_ids)
            .any(|(entry, event_id)| entry.id != *event_id)
        || session.recap_entries.iter().any(|entry| {
            entry.id == 0
                || entry.id > MAX_JSON_SAFE_INTEGER
                || entry.tick > MAX_JSON_SAFE_INTEGER
                || entry.summary.trim().is_empty()
                || entry.summary.len() > MAX_RECAP_ENTRY_SUMMARY_BYTES
        })
    {
        return Err(PersistenceError::new(
            "focus recap entries must exactly match bounded factual event IDs",
        ));
    }
    Ok(())
}

fn validate_focus_state_summary(session: &FocusSession) -> Result<()> {
    let state: FocusState = serde_json::from_str(&session.state_json).map_err(|_| {
        PersistenceError::new("focus state must contain exactly the supported fields")
    })?;
    validate_focus_state(&state)?;
    if serde_json::to_string(&state)? != session.state_json {
        return Err(PersistenceError::new(
            "focus state must use canonical JSON serialization",
        ));
    }
    let expected_status = match state.phase {
        FocusPhase::FocusRunning | FocusPhase::BreakRunning => FocusSessionStatus::Active,
        FocusPhase::FocusPaused | FocusPhase::BreakPaused => FocusSessionStatus::Paused,
        FocusPhase::FocusCompleted | FocusPhase::Finished => FocusSessionStatus::Completed,
        FocusPhase::FocusCancelled => FocusSessionStatus::Cancelled,
        FocusPhase::Idle => {
            return Err(PersistenceError::new(
                "idle focus state cannot be persisted as a session",
            ));
        }
    };
    let matches_summary = expected_status == session.status
        && i64_matches_u64(session.started_at_ms, state.started_at_epoch_ms)
        && nullable_i64_matches_u64(session.ended_at_ms, state.ended_at_epoch_ms)
        && i64_matches_u64(session.planned_focus_ms, state.focus_duration_ms)
        && i64_matches_u64(session.focused_ms, Some(state.accumulated_focus_ms))
        && i64_matches_u64(session.planned_break_ms, state.break_duration_ms)
        && i64_matches_u64(session.break_ms, Some(state.accumulated_break_ms))
        && i64_matches_u64(
            session.issued_simulation_ticks,
            Some(state.total_issued_simulation_ticks),
        );
    if !matches_summary {
        return Err(PersistenceError::new(
            "focus session summary does not match its canonical focus state",
        ));
    }
    Ok(())
}

fn i64_matches_u64(value: i64, candidate: Option<u64>) -> bool {
    u64::try_from(value).ok() == candidate
}

fn nullable_i64_matches_u64(value: Option<i64>, candidate: Option<u64>) -> bool {
    match (value, candidate) {
        (None, None) => true,
        (Some(value), Some(candidate)) => u64::try_from(value).ok() == Some(candidate),
        _ => false,
    }
}

fn validate_focus_state(state: &FocusState) -> Result<()> {
    let numeric_values = [
        state.focus_duration_ms,
        state.break_duration_ms,
        state.simulation_ticks_per_focus_second,
        Some(state.accumulated_focus_ms),
        Some(state.accumulated_break_ms),
        Some(state.total_issued_simulation_ticks),
        Some(state.simulation_tick_remainder),
        state.started_at_epoch_ms,
        state.focus_started_at_epoch_ms,
        state.focus_ended_at_epoch_ms,
        state.break_started_at_epoch_ms,
        state.break_ended_at_epoch_ms,
        state.ended_at_epoch_ms,
        state.active_segment_started_at_epoch_ms,
        state.last_observed_epoch_ms,
    ];
    if state.version != 1
        || numeric_values
            .into_iter()
            .flatten()
            .any(|value| value > MAX_JSON_SAFE_INTEGER)
        || state.simulation_tick_remainder >= 1_000
    {
        return Err(PersistenceError::new(
            "focus state contains an unsupported version or unsafe integer",
        ));
    }

    if matches!(state.phase, FocusPhase::Idle) {
        let idle = FocusState {
            version: 1,
            phase: FocusPhase::Idle,
            focus_duration_ms: None,
            break_duration_ms: None,
            simulation_ticks_per_focus_second: None,
            accumulated_focus_ms: 0,
            accumulated_break_ms: 0,
            total_issued_simulation_ticks: 0,
            simulation_tick_remainder: 0,
            started_at_epoch_ms: None,
            focus_started_at_epoch_ms: None,
            focus_ended_at_epoch_ms: None,
            break_started_at_epoch_ms: None,
            break_ended_at_epoch_ms: None,
            ended_at_epoch_ms: None,
            active_segment_started_at_epoch_ms: None,
            last_observed_epoch_ms: None,
            outcome: None,
        };
        if *state != idle {
            return Err(PersistenceError::new(
                "idle focus state must not contain session data",
            ));
        }
        return Ok(());
    }

    let (
        Some(focus_duration_ms),
        Some(break_duration_ms),
        Some(simulation_ticks_per_focus_second),
        Some(started_at_epoch_ms),
        Some(focus_started_at_epoch_ms),
        Some(last_observed_epoch_ms),
    ) = (
        state.focus_duration_ms,
        state.break_duration_ms,
        state.simulation_ticks_per_focus_second,
        state.started_at_epoch_ms,
        state.focus_started_at_epoch_ms,
        state.last_observed_epoch_ms,
    )
    else {
        return Err(PersistenceError::new(
            "configured focus state is missing required session data",
        ));
    };
    if focus_duration_ms == 0
        || simulation_ticks_per_focus_second == 0
        || state.accumulated_focus_ms > focus_duration_ms
        || state.accumulated_break_ms > break_duration_ms
    {
        return Err(PersistenceError::new(
            "focus state duration or accepted progress is invalid",
        ));
    }
    let issued_numerator =
        u128::from(state.accumulated_focus_ms) * u128::from(simulation_ticks_per_focus_second);
    let issued_ticks = issued_numerator / 1_000;
    let issued_remainder = issued_numerator % 1_000;
    if issued_ticks > u128::from(MAX_JSON_SAFE_INTEGER)
        || issued_ticks != u128::from(state.total_issued_simulation_ticks)
        || issued_remainder != u128::from(state.simulation_tick_remainder)
    {
        return Err(PersistenceError::new(
            "focus simulation tick accounting is inconsistent",
        ));
    }

    let running = matches!(
        state.phase,
        FocusPhase::FocusRunning | FocusPhase::BreakRunning
    );
    if running != state.active_segment_started_at_epoch_ms.is_some()
        || focus_started_at_epoch_ms != started_at_epoch_ms
        || last_observed_epoch_ms < started_at_epoch_ms
        || state
            .active_segment_started_at_epoch_ms
            .is_some_and(|started| {
                started < started_at_epoch_ms || started > last_observed_epoch_ms
            })
    {
        return Err(PersistenceError::new(
            "focus session timestamps are inconsistent",
        ));
    }
    if state
        .focus_ended_at_epoch_ms
        .is_some_and(|ended| ended < focus_started_at_epoch_ms || ended > last_observed_epoch_ms)
        || state
            .break_started_at_epoch_ms
            .is_some_and(|started| Some(started) != state.focus_ended_at_epoch_ms)
        || state.break_ended_at_epoch_ms.is_some_and(|ended| {
            state
                .break_started_at_epoch_ms
                .is_none_or(|started| ended < started)
        })
        || state
            .ended_at_epoch_ms
            .is_some_and(|ended| ended > last_observed_epoch_ms)
    {
        return Err(PersistenceError::new(
            "focus completion timestamps are inconsistent",
        ));
    }

    match state.phase {
        FocusPhase::FocusRunning | FocusPhase::FocusPaused => {
            if state.focus_ended_at_epoch_ms.is_some()
                || state.break_started_at_epoch_ms.is_some()
                || state.outcome.is_some()
                || state.accumulated_focus_ms >= focus_duration_ms
            {
                return Err(PersistenceError::new(
                    "incomplete focus phase contains completion history",
                ));
            }
        }
        FocusPhase::BreakRunning | FocusPhase::BreakPaused => {
            if state.focus_ended_at_epoch_ms.is_none()
                || state.break_started_at_epoch_ms.is_none()
                || state.outcome.is_some()
                || break_duration_ms == 0
                || state.accumulated_break_ms >= break_duration_ms
            {
                return Err(PersistenceError::new(
                    "break phase does not retain valid planned break time",
                ));
            }
        }
        FocusPhase::FocusCancelled => {
            if state.outcome != Some(FocusOutcome::Cancelled)
                || state.ended_at_epoch_ms.is_none()
                || state.focus_ended_at_epoch_ms.is_none()
                || state.break_started_at_epoch_ms.is_some()
                || state.break_ended_at_epoch_ms.is_some()
                || state.ended_at_epoch_ms != state.focus_ended_at_epoch_ms
            {
                return Err(PersistenceError::new(
                    "cancelled focus state has invalid completion history",
                ));
            }
        }
        FocusPhase::FocusCompleted | FocusPhase::Finished => {
            if state.outcome != Some(FocusOutcome::Completed)
                || state.ended_at_epoch_ms.is_none()
                || state.focus_ended_at_epoch_ms.is_none()
            {
                return Err(PersistenceError::new(
                    "completed focus state is missing completion history",
                ));
            }
        }
        FocusPhase::Idle => unreachable!("idle state returned above"),
    }
    if matches!(state.phase, FocusPhase::FocusCompleted)
        && (break_duration_ms != 0 || state.ended_at_epoch_ms != state.focus_ended_at_epoch_ms)
    {
        return Err(PersistenceError::new(
            "focus-completed state is invalid for the configured break",
        ));
    }
    if matches!(state.phase, FocusPhase::Finished)
        && ((break_duration_ms == 0 && state.accumulated_focus_ms != focus_duration_ms)
            || (break_duration_ms > 0 && state.break_ended_at_epoch_ms.is_none())
            || state.ended_at_epoch_ms
                != if break_duration_ms > 0 {
                    state.break_ended_at_epoch_ms
                } else {
                    state.focus_ended_at_epoch_ms
                })
    {
        return Err(PersistenceError::new(
            "finished focus state has inconsistent final-phase history",
        ));
    }
    Ok(())
}

#[derive(Debug)]
struct SnapshotEventFact {
    tick: Option<u64>,
    summary: Option<String>,
}

#[derive(Debug)]
struct SnapshotAuthority {
    tick: u64,
    events: BTreeMap<u64, SnapshotEventFact>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotAuthorityEnvelope {
    format_version: Option<u64>,
    payload: Option<SnapshotAuthorityPayload>,
    world_json: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotAuthorityPayload {
    tick: Option<u64>,
    event_log: Option<Vec<SnapshotAuthorityEvent>>,
}

#[derive(Deserialize)]
struct SnapshotAuthorityEvent {
    id: Option<u64>,
    tick: Option<u64>,
    summary: Option<String>,
}

fn parse_snapshot_authority(snapshot: &str) -> Result<SnapshotAuthority> {
    validate_snapshot_bounds(snapshot)?;
    let envelope: SnapshotAuthorityEnvelope = serde_json::from_str(snapshot)
        .map_err(|_| PersistenceError::new("snapshot must be valid JSON data"))?;
    let format_version = envelope
        .format_version
        .ok_or_else(|| PersistenceError::new("source save has no format version"))?;
    let payload = if format_version == 0 {
        let world_json = envelope
            .world_json
            .ok_or_else(|| PersistenceError::new("legacy source save has no world payload"))?;
        serde_json::from_str::<SnapshotAuthorityPayload>(&world_json)?
    } else {
        envelope
            .payload
            .ok_or_else(|| PersistenceError::new("source save has no world payload"))?
    };
    let tick = payload
        .tick
        .filter(|tick| *tick <= MAX_JSON_SAFE_INTEGER)
        .ok_or_else(|| PersistenceError::new("source save has no valid world tick"))?;
    let events = payload
        .event_log
        .ok_or_else(|| PersistenceError::new("source save has no event log"))?;
    let mut events_by_id = BTreeMap::new();
    for event in events {
        let id = event
            .id
            .filter(|id| *id > 0)
            .ok_or_else(|| PersistenceError::new("source save contains an invalid event ID"))?;
        if events_by_id
            .insert(
                id,
                SnapshotEventFact {
                    tick: event.tick,
                    summary: event.summary,
                },
            )
            .is_some()
        {
            return Err(PersistenceError::new(
                "source save contains duplicate event IDs",
            ));
        }
    }
    Ok(SnapshotAuthority {
        tick,
        events: events_by_id,
    })
}

fn sha256_hex(value: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(value.as_bytes());
    let digest = hash.finalize();
    let mut encoded = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(&mut encoded, "{byte:02x}").expect("writing to String cannot fail");
    }
    encoded
}

fn verify_inserted_generation(
    inserted_snapshot: &str,
    inserted_checksum: &str,
    inserted_focus_session_json: Option<&str>,
    expected_snapshot: &str,
    expected_checksum: &str,
    expected_focus_session_json: Option<&str>,
) -> Result<()> {
    if inserted_snapshot != expected_snapshot
        || inserted_checksum != expected_checksum
        || inserted_focus_session_json != expected_focus_session_json
        || sha256_hex(inserted_snapshot) != inserted_checksum
    {
        return Err(PersistenceError::new(
            "inserted save generation did not verify",
        ));
    }
    Ok(())
}

fn current_unix_epoch_ms() -> Result<i64> {
    let milliseconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| PersistenceError::new("system clock is before the Unix epoch"))?
        .as_millis();
    i64::try_from(milliseconds)
        .map_err(|_| PersistenceError::new("system clock exceeds supported Unix milliseconds"))
}

fn bool_to_db(value: bool) -> i64 {
    i64::from(value)
}

fn focus_status_to_db(status: &FocusSessionStatus) -> &'static str {
    match status {
        FocusSessionStatus::Active => "active",
        FocusSessionStatus::Paused => "paused",
        FocusSessionStatus::Completed => "completed",
        FocusSessionStatus::Cancelled => "cancelled",
    }
}

fn focus_status_from_db(value: &str) -> rusqlite::Result<FocusSessionStatus> {
    match value {
        "active" => Ok(FocusSessionStatus::Active),
        "paused" => Ok(FocusSessionStatus::Paused),
        "completed" => Ok(FocusSessionStatus::Completed),
        "cancelled" => Ok(FocusSessionStatus::Cancelled),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

#[tauri::command]
pub fn list_save_slots(
    state: State<'_, PersistenceState>,
) -> std::result::Result<Vec<SaveSlotSummary>, String> {
    state
        .lock()
        .and_then(|database| database.list_slots())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn load_save_slot_candidates(
    state: State<'_, PersistenceState>,
    slot_id: String,
) -> std::result::Result<Option<SaveCandidatePage>, String> {
    state
        .lock()
        .and_then(|database| database.load_slot_candidates(&slot_id))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn load_save_slot_fallback_candidates(
    state: State<'_, PersistenceState>,
    slot_id: String,
    before_generation: i64,
) -> std::result::Result<Option<SaveCandidatePage>, String> {
    state
        .lock()
        .and_then(|database| database.load_slot_fallback_candidates(&slot_id, before_generation))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn commit_save_slot(
    state: State<'_, PersistenceState>,
    slot_id: String,
    name: String,
    snapshot: String,
) -> std::result::Result<SaveCommitReceipt, String> {
    let committed = state
        .lock()
        .and_then(|mut database| database.commit_slot(&slot_id, &name, &snapshot))
        .map_err(|error| error.to_string())?;
    Ok(SaveCommitReceipt::from(committed))
}

#[tauri::command]
pub fn commit_focus_checkpoint(
    state: State<'_, PersistenceState>,
    slot_id: String,
    name: String,
    snapshot: String,
    session: FocusSession,
) -> std::result::Result<SaveCommitReceipt, String> {
    let committed = state
        .lock()
        .and_then(|mut database| {
            database.commit_focus_checkpoint(&slot_id, &name, &snapshot, &session)
        })
        .map_err(|error| error.to_string())?;
    Ok(SaveCommitReceipt::from(committed))
}

#[tauri::command]
pub fn confirm_semantically_valid_save_generation(
    window: tauri::WebviewWindow,
    state: State<'_, PersistenceState>,
    slot_id: String,
    generation: i64,
    checksum: String,
) -> std::result::Result<(), String> {
    validate_semantic_confirmation_caller(window.label()).map_err(|error| error.to_string())?;
    let head_generation = state
        .lock()
        .and_then(|mut database| {
            database.confirm_semantically_valid_generation(&slot_id, generation, &checksum)
        })
        .map_err(|error| error.to_string())?;
    state.defer_prune(slot_id, head_generation);
    Ok(())
}

fn validate_semantic_confirmation_caller(label: &str) -> Result<()> {
    if label != "persistence-broker" {
        return Err(PersistenceError::new(
            "semantic save confirmation requires the isolated persistence validator",
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn delete_save_slot(
    state: State<'_, PersistenceState>,
    slot_id: String,
) -> std::result::Result<bool, String> {
    state
        .lock()
        .and_then(|mut database| database.delete_slot(&slot_id))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn export_save_generation(
    state: State<'_, PersistenceState>,
    slot_id: String,
    generation: i64,
) -> std::result::Result<String, String> {
    state
        .lock()
        .and_then(|database| database.export_generation(&slot_id, generation))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn import_save_slot(
    state: State<'_, PersistenceState>,
    package: String,
) -> std::result::Result<LoadedSave, String> {
    state
        .lock()
        .and_then(|mut database| database.import_slot(&package))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn record_focus_session(
    state: State<'_, PersistenceState>,
    session: FocusSession,
) -> std::result::Result<(), String> {
    state
        .lock()
        .and_then(|mut database| database.record_focus_session(&session))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_focus_sessions(
    state: State<'_, PersistenceState>,
) -> std::result::Result<Vec<StoredFocusSession>, String> {
    state
        .lock()
        .and_then(|database| database.list_focus_session_records())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn load_settings(
    state: State<'_, PersistenceState>,
) -> std::result::Result<AppSettings, String> {
    state
        .lock()
        .and_then(|database| database.load_settings())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_settings(
    state: State<'_, PersistenceState>,
    settings: AppSettings,
) -> std::result::Result<AppSettings, String> {
    state
        .lock()
        .and_then(|mut database| database.save_settings(&settings))
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semantic_confirmation_requires_the_isolated_validator() {
        assert!(validate_semantic_confirmation_caller("persistence-broker").is_ok());
        assert!(
            validate_semantic_confirmation_caller("main")
                .expect_err("the visible webview must not authorize pruning")
                .to_string()
                .contains("isolated persistence validator")
        );
    }

    fn snapshot(value: &str) -> String {
        format!(
            r#"{{"format":"chrono-forge-world","formatVersion":1,"payload":{{"tick":1,"eventLog":[{{"id":7,"tick":0,"summary":"Recorded factual event 7."}},{{"id":9,"tick":0,"summary":"Recorded factual event 9."}},{{"id":11,"tick":0,"summary":"Recorded factual event 11."}}],"test":"{value}"}}}}"#
        )
    }

    fn confirm_and_prune(database: &mut PersistenceDatabase, loaded: &LoadedSave) {
        let head_generation = database
            .confirm_semantically_valid_generation(
                &loaded.slot_id,
                loaded.recovered_generation,
                &loaded.checksum,
            )
            .expect("semantic confirmation");
        database
            .prune_old_generations(&loaded.slot_id, head_generation)
            .expect("retention prune");
    }

    fn commit_semantically_verified_slot(
        database: &mut PersistenceDatabase,
        slot_id: &str,
        name: &str,
        snapshot: &str,
    ) -> LoadedSave {
        let loaded = database
            .commit_slot(slot_id, name, snapshot)
            .expect("verified save commit");
        confirm_and_prune(database, &loaded);
        loaded
    }

    fn collect_candidate_pages(database: &PersistenceDatabase, slot_id: &str) -> Vec<LoadedSave> {
        let Some(mut page) = database
            .load_slot_candidates(slot_id)
            .expect("initial candidate page")
        else {
            return Vec::new();
        };
        let mut candidates = Vec::new();
        let mut requested_before = None;
        loop {
            assert!(
                page.candidates.len() <= SAVE_CANDIDATE_SCAN_ROWS_PER_PAGE as usize,
                "native recovery pages must remain bounded"
            );
            if let Some(boundary) = requested_before {
                assert!(
                    page.candidates
                        .iter()
                        .all(|candidate| candidate.recovered_generation < boundary),
                    "fallback candidates must precede their requested boundary"
                );
            }
            candidates.extend(page.candidates);
            let Some(next_before_generation) = page.next_before_generation else {
                break;
            };
            if let Some(boundary) = requested_before {
                assert!(
                    next_before_generation < boundary,
                    "candidate page cursor must move backward"
                );
            }
            requested_before = Some(next_before_generation);
            page = database
                .load_slot_fallback_candidates(slot_id, next_before_generation)
                .expect("fallback candidate page")
                .expect("slot remains present during test recovery");
        }
        candidates
    }

    fn focus_world_moment(tick: u64) -> FocusWorldMoment {
        FocusWorldMoment {
            tick,
            detailed_population: 6,
            surface_population: 6,
            food: 10,
            water: 10,
            timber: 10,
            stone: 10,
            operational_structures: 0,
            active_construction: 0,
            households: 3,
            scarcity: 0,
            stability: 100,
            active_settlements: 1,
            active_civilizations: 1,
            active_routes: 0,
            active_conflicts: 0,
            active_crises: 0,
            ruins: 0,
            leading_settlement: Some(FocusLeadingSettlement {
                id: 1,
                name: "First Hearth".to_owned(),
                development_stage: "founding".to_owned(),
            }),
            offworld_population: 0,
            active_missions: 0,
            active_colonies: 0,
            contacted_aliens: 0,
        }
    }

    fn completed_focus_state_json() -> String {
        r#"{"version":1,"phase":"finished","focusDurationMs":100,"breakDurationMs":20,"simulationTicksPerFocusSecond":10,"accumulatedFocusMs":100,"accumulatedBreakMs":20,"totalIssuedSimulationTicks":1,"simulationTickRemainder":0,"startedAtEpochMs":100,"focusStartedAtEpochMs":100,"focusEndedAtEpochMs":200,"breakStartedAtEpochMs":200,"breakEndedAtEpochMs":220,"endedAtEpochMs":220,"activeSegmentStartedAtEpochMs":null,"lastObservedEpochMs":220,"outcome":"completed"}"#.to_owned()
    }

    fn stale_paused_focus_state_json() -> String {
        r#"{"version":1,"phase":"focus-paused","focusDurationMs":100,"breakDurationMs":20,"simulationTicksPerFocusSecond":10,"accumulatedFocusMs":50,"accumulatedBreakMs":0,"totalIssuedSimulationTicks":0,"simulationTickRemainder":500,"startedAtEpochMs":100,"focusStartedAtEpochMs":100,"focusEndedAtEpochMs":null,"breakStartedAtEpochMs":null,"breakEndedAtEpochMs":null,"endedAtEpochMs":null,"activeSegmentStartedAtEpochMs":null,"lastObservedEpochMs":150,"outcome":null}"#.to_owned()
    }

    fn completed_focus_session(slot_id: &str, recap_event_ids: Vec<u64>) -> FocusSession {
        FocusSession {
            session_id: "session-1".to_owned(),
            slot_id: Some(slot_id.to_owned()),
            started_at_ms: 100,
            ended_at_ms: Some(220),
            planned_focus_ms: 100,
            focused_ms: 100,
            planned_break_ms: 20,
            break_ms: 20,
            issued_simulation_ticks: 1,
            status: FocusSessionStatus::Completed,
            state_json: completed_focus_state_json(),
            recap_entries: recap_event_ids
                .iter()
                .map(|id| FocusRecapEntry {
                    id: *id,
                    tick: 0,
                    summary: format!("Recorded factual event {id}."),
                })
                .collect(),
            recap_event_ids,
            review: None,
        }
    }

    #[test]
    fn multiple_slots_are_independent_and_generations_are_immutable() {
        let mut database = PersistenceDatabase::in_memory().expect("database");
        let first = database
            .commit_slot("alpha", "Alpha", &snapshot("one"))
            .expect("first");
        let second = database
            .commit_slot("alpha", "Alpha", &snapshot("two"))
            .expect("second");
        database
            .commit_slot("beta", "Beta", &snapshot("other"))
            .expect("beta");

        assert_eq!(first.recovered_generation, 1);
        assert_eq!(second.recovered_generation, 2);
        assert_eq!(database.list_slots().expect("slots").len(), 2);
        let original: String = database
            .connection
            .query_row(
                "SELECT snapshot FROM save_generations WHERE slot_id = 'alpha' AND generation = 1",
                [],
                |row| row.get(0),
            )
            .expect("original generation");
        assert_eq!(original, snapshot("one"));
    }

    #[test]
    fn retention_keeps_the_newest_three_verified_generations() {
        let mut database = PersistenceDatabase::in_memory().expect("database");
        for value in ["one", "two", "three", "four"] {
            commit_semantically_verified_slot(&mut database, "alpha", "Alpha", &snapshot(value));
        }
        let generations: Vec<i64> = database
            .connection
            .prepare(
                "SELECT generation FROM save_generations WHERE slot_id = 'alpha' ORDER BY generation",
            )
            .expect("statement")
            .query_map([], |row| row.get(0))
            .expect("query")
            .collect::<std::result::Result<_, _>>()
            .expect("generations");
        assert_eq!(generations, vec![2, 3, 4]);
    }

    #[test]
    fn unavailable_semantic_broker_bounds_sustained_autosaves_and_preserves_recovery() {
        let mut database = PersistenceDatabase::in_memory().expect("database");
        let baseline = commit_semantically_verified_slot(
            &mut database,
            "alpha",
            "Alpha",
            &snapshot("confirmed-baseline"),
        );
        for generation in 2..=21 {
            database
                .commit_slot(
                    "alpha",
                    "Alpha",
                    &snapshot(&format!("unconfirmed-{generation}")),
                )
                .expect("durable autosave while broker is unavailable");
        }

        let retained: Vec<(i64, i64)> = database
            .connection
            .prepare(
                "SELECT generation, semantically_verified FROM save_generations
                 WHERE slot_id = 'alpha' ORDER BY generation",
            )
            .expect("retained statement")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("retained query")
            .collect::<std::result::Result<_, _>>()
            .expect("retained generations");
        assert_eq!(retained, vec![(1, 1), (19, 0), (20, 0), (21, 0)]);

        database
            .connection
            .execute(
                "UPDATE save_generations SET checksum = 'corrupt'
                 WHERE slot_id = 'alpha' AND semantically_verified = 0",
                [],
            )
            .expect("corrupt unconfirmed tail");
        let candidates = collect_candidate_pages(&database, "alpha");
        assert_eq!(
            candidates
                .iter()
                .map(|candidate| candidate.recovered_generation)
                .collect::<Vec<_>>(),
            vec![baseline.recovered_generation],
        );
        assert_eq!(candidates[0].snapshot, baseline.snapshot);
    }

    #[test]
    fn all_unverified_migrated_slot_refuses_to_delete_its_only_recovery_candidate() {
        let mut database = PersistenceDatabase::in_memory().expect("database");
        let baseline = database
            .commit_slot("alpha", "Alpha", &snapshot("migrated-baseline"))
            .expect("unverified migrated baseline");
        for generation in 2..=5 {
            let invalid_snapshot = format!(r#"{{"hello":"invalid-{generation}"}}"#);
            database
                .connection
                .execute(
                    "INSERT INTO save_generations
                     (slot_id, generation, saved_at_ms, focus_session_json, snapshot, checksum)
                     VALUES ('alpha', ?1, ?2, NULL, ?3, 'corrupt')",
                    params![generation, generation * 1_000, invalid_snapshot],
                )
                .expect("migrated unverified generation");
        }
        database
            .connection
            .execute(
                "UPDATE save_slots SET head_generation = 5 WHERE slot_id = 'alpha'",
                [],
            )
            .expect("migrated head");

        let error = database
            .commit_slot("alpha", "Alpha", &snapshot("must-not-displace-baseline"))
            .expect_err("an all-unverified backlog must fail closed");
        assert!(error.to_string().contains("requires semantic validation"));
        let unchanged_generations: Vec<i64> = database
            .connection
            .prepare(
                "SELECT generation FROM save_generations
                 WHERE slot_id = 'alpha' ORDER BY generation",
            )
            .expect("generation statement")
            .query_map([], |row| row.get(0))
            .expect("generation query")
            .collect::<std::result::Result<_, _>>()
            .expect("unchanged generations");
        assert_eq!(unchanged_generations, vec![1, 2, 3, 4, 5]);
        assert_eq!(
            database
                .load_slot("alpha")
                .expect("recover migrated slot")
                .expect("migrated slot")
                .recovered_generation,
            baseline.recovered_generation,
        );

        database
            .confirm_semantically_valid_generation(
                "alpha",
                baseline.recovered_generation,
                &baseline.checksum,
            )
            .expect("confirm recovered migrated baseline");
        let after_confirmation: Vec<(i64, i64)> = database
            .connection
            .prepare(
                "SELECT generation, semantically_verified FROM save_generations
                 WHERE slot_id = 'alpha' ORDER BY generation",
            )
            .expect("confirmed statement")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("confirmed query")
            .collect::<std::result::Result<_, _>>()
            .expect("confirmed generations");
        assert_eq!(after_confirmation, vec![(1, 1), (3, 0), (4, 0), (5, 0)]);

        let newest = database
            .commit_slot("alpha", "Alpha", &snapshot("post-confirmation"))
            .expect("commit after baseline confirmation");
        database
            .connection
            .execute(
                "UPDATE save_generations SET checksum = 'corrupt'
                 WHERE slot_id = 'alpha' AND generation = ?1",
                [newest.recovered_generation],
            )
            .expect("corrupt newest generation");
        assert_eq!(
            database
                .load_slot("alpha")
                .expect("recover confirmed baseline")
                .expect("slot after confirmation")
                .recovered_generation,
            baseline.recovered_generation,
        );
    }

    #[test]
    fn unconfirmed_semantic_failures_cannot_displace_the_last_recoverable_generation() {
        let mut database = PersistenceDatabase::in_memory().expect("database");
        let oldest = commit_semantically_verified_slot(
            &mut database,
            "alpha",
            "Alpha",
            &snapshot("canonical-oldest"),
        );
        for malformed in [r#"{"hello":"world-2"}"#, r#"{"hello":"world-3"}"#] {
            database
                .commit_slot("alpha", "Alpha", malformed)
                .expect("checksum-valid JSON generation");
        }
        let newest = commit_semantically_verified_slot(
            &mut database,
            "alpha",
            "Alpha",
            &snapshot("canonical-newest"),
        );

        let generations: Vec<i64> = database
            .connection
            .prepare(
                "SELECT generation FROM save_generations WHERE slot_id = 'alpha' ORDER BY generation",
            )
            .expect("statement")
            .query_map([], |row| row.get(0))
            .expect("query")
            .collect::<std::result::Result<_, _>>()
            .expect("generations");
        assert_eq!(generations, vec![1, 2, 3, 4]);

        database
            .connection
            .execute(
                "UPDATE save_generations SET checksum = 'corrupt'
                 WHERE slot_id = 'alpha' AND generation = ?1",
                [newest.recovered_generation],
            )
            .expect("corrupt newest head");
        let candidates = collect_candidate_pages(&database, "alpha");
        assert_eq!(
            candidates
                .iter()
                .map(|candidate| candidate.recovered_generation)
                .collect::<Vec<_>>(),
            vec![3, 2, 1]
        );
        assert_eq!(
            candidates
                .last()
                .map(|candidate| candidate.snapshot.as_str()),
            Some(oldest.snapshot.as_str())
        );
    }

    #[test]
    fn healthy_head_loads_without_eagerly_reading_fallback_generations() {
        let mut database = PersistenceDatabase::in_memory().expect("database");
        for value in ["one", "two", "three"] {
            database
                .commit_slot("alpha", "Alpha", &snapshot(value))
                .expect("commit");
        }

        let page = database
            .load_slot_candidates("alpha")
            .expect("load candidates")
            .expect("slot");
        assert_eq!(page.candidates.len(), 1);
        assert_eq!(page.candidates[0].recovered_generation, 3);
        assert!(!page.candidates[0].recovered_from_corruption);
        assert_eq!(page.next_before_generation, Some(3));

        let fallback_two = database
            .load_slot_fallback_candidates("alpha", 3)
            .expect("fallback candidates")
            .expect("slot");
        assert_eq!(fallback_two.candidates.len(), 1);
        assert_eq!(fallback_two.candidates[0].recovered_generation, 2);
        assert!(fallback_two.candidates[0].recovered_from_corruption);
        assert_eq!(fallback_two.next_before_generation, Some(2));

        let fallback_one = database
            .load_slot_fallback_candidates("alpha", 2)
            .expect("fallback candidates")
            .expect("slot");
        assert_eq!(fallback_one.candidates.len(), 1);
        assert_eq!(fallback_one.candidates[0].recovered_generation, 1);
        assert!(fallback_one.candidates[0].recovered_from_corruption);
        assert_eq!(fallback_one.next_before_generation, Some(1));
    }

    #[test]
    fn candidate_pages_bound_scans_across_corrupt_rows_without_deleting_evidence() {
        let mut database = PersistenceDatabase::in_memory().expect("database");
        commit_semantically_verified_slot(&mut database, "alpha", "Alpha", &snapshot("one"));
        let second = database
            .commit_slot("alpha", "Alpha", &snapshot("two"))
            .expect("second generation");
        database
            .confirm_semantically_valid_generation(
                "alpha",
                second.recovered_generation,
                &second.checksum,
            )
            .expect("confirm second generation");
        let third = database
            .commit_slot("alpha", "Alpha", &snapshot("three"))
            .expect("third generation");
        database
            .confirm_semantically_valid_generation(
                "alpha",
                third.recovered_generation,
                &third.checksum,
            )
            .expect("confirm third generation");
        let fourth = database
            .commit_focus_checkpoint(
                "alpha",
                "Alpha",
                &snapshot("four"),
                &completed_focus_session("alpha", vec![7]),
            )
            .expect("fourth generation");
        database
            .confirm_semantically_valid_generation(
                "alpha",
                fourth.recovered_generation,
                &fourth.checksum,
            )
            .expect("confirm fourth generation");
        database
            .commit_slot("alpha", "Alpha", r#"{"hello":"world-five"}"#)
            .expect("checksum-valid semantic failure");
        database
            .connection
            .execute(
                "UPDATE save_generations SET snapshot = '{'
                 WHERE slot_id = 'alpha' AND generation = 2",
                [],
            )
            .expect("truncate second generation");
        database
            .connection
            .execute(
                "UPDATE save_generations SET checksum = 'corrupt'
                 WHERE slot_id = 'alpha' AND generation = 3",
                [],
            )
            .expect("corrupt third generation checksum");
        database
            .connection
            .execute(
                "UPDATE save_generations SET focus_session_json = '{}'
                 WHERE slot_id = 'alpha' AND generation = 4",
                [],
            )
            .expect("corrupt fourth generation checkpoint");

        let mut page = database
            .load_slot_candidates("alpha")
            .expect("initial page")
            .expect("slot");
        let mut cursors = Vec::new();
        let mut candidate_generations = Vec::new();
        let mut requested_before = None;
        loop {
            assert!(page.candidates.len() <= 1);
            if let Some(boundary) = requested_before {
                assert!(
                    page.candidates
                        .iter()
                        .all(|candidate| candidate.recovered_generation < boundary)
                );
            }
            candidate_generations.extend(
                page.candidates
                    .iter()
                    .map(|candidate| candidate.recovered_generation),
            );
            let Some(next_before_generation) = page.next_before_generation else {
                break;
            };
            if let Some(boundary) = requested_before {
                assert!(next_before_generation < boundary);
            }
            cursors.push(next_before_generation);
            requested_before = Some(next_before_generation);
            page = database
                .load_slot_fallback_candidates("alpha", next_before_generation)
                .expect("fallback page")
                .expect("slot");
        }

        assert_eq!(cursors, vec![5, 4, 3, 2, 1]);
        assert_eq!(candidate_generations, vec![5, 1]);
        let row_count: i64 = database
            .connection
            .query_row(
                "SELECT COUNT(*) FROM save_generations WHERE slot_id = 'alpha'",
                [],
                |row| row.get(0),
            )
            .expect("row count");
        assert_eq!(row_count, 5);
    }

    #[test]
    fn corrupt_head_falls_back_without_deleting_evidence() {
        let mut database = PersistenceDatabase::in_memory().expect("database");
        let first = database
            .commit_slot("alpha", "Alpha", &snapshot("one"))
            .expect("one");
        database
            .commit_slot("alpha", "Alpha", &snapshot("two"))
            .expect("two");
        database.connection.execute(
            "UPDATE save_generations SET checksum = 'corrupt' WHERE slot_id = 'alpha' AND generation = 2",
            [],
        ).expect("corrupt head");

        let loaded = database.load_slot("alpha").expect("load").expect("present");
        assert_eq!(loaded.recovered_generation, 1);
        assert!(loaded.recovered_from_corruption);
        assert_eq!(loaded.saved_at_ms, first.saved_at_ms);
        let count: i64 = database
            .connection
            .query_row(
                "SELECT COUNT(*) FROM save_generations WHERE slot_id = 'alpha'",
                [],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(count, 2);
    }

    #[test]
    fn focus_checkpoint_commits_world_history_and_head_as_one_generation() {
        let mut database = PersistenceDatabase::in_memory().expect("database");
        let session = completed_focus_session("alpha", vec![7, 9]);

        let committed = database
            .commit_focus_checkpoint("alpha", "Alpha", &snapshot("checkpoint"), &session)
            .expect("checkpoint commit");

        assert_eq!(committed.recovered_generation, 1);
        assert_eq!(committed.focus_session, Some(session.clone()));
        assert_eq!(
            database.load_slot("alpha").expect("load").expect("present"),
            committed
        );
        assert_eq!(
            database.list_focus_sessions().expect("history"),
            vec![session]
        );
    }

    #[test]
    fn fallback_returns_the_checkpoint_stored_on_that_exact_generation() {
        let mut database = PersistenceDatabase::in_memory().expect("database");
        database
            .commit_slot("alpha", "Alpha", &snapshot("earlier"))
            .expect("earlier generation");
        let session = completed_focus_session("alpha", vec![7]);
        database
            .commit_focus_checkpoint("alpha", "Alpha", &snapshot("checkpoint"), &session)
            .expect("checkpoint generation");
        database
            .connection
            .execute(
                "UPDATE save_generations SET checksum = 'corrupt'
                 WHERE slot_id = 'alpha' AND generation = 2",
                [],
            )
            .expect("corrupt checkpoint head");

        let recovered = database.load_slot("alpha").expect("load").expect("present");
        assert_eq!(recovered.recovered_generation, 1);
        assert!(recovered.recovered_from_corruption);
        assert_eq!(recovered.focus_session, None);
        assert_eq!(
            database.list_focus_sessions().expect("history"),
            vec![session]
        );
    }

    #[test]
    fn invalid_checkpoint_material_skips_that_generation() {
        let mut database = PersistenceDatabase::in_memory().expect("database");
        database
            .commit_slot("alpha", "Alpha", &snapshot("earlier"))
            .expect("earlier generation");
        database
            .commit_focus_checkpoint(
                "alpha",
                "Alpha",
                &snapshot("checkpoint"),
                &completed_focus_session("alpha", vec![7]),
            )
            .expect("checkpoint generation");
        database
            .connection
            .execute(
                "UPDATE save_generations SET focus_session_json = '{}'
                 WHERE slot_id = 'alpha' AND generation = 2",
                [],
            )
            .expect("corrupt checkpoint");

        let recovered = database.load_slot("alpha").expect("load").expect("present");
        assert_eq!(recovered.recovered_generation, 1);
        assert_eq!(recovered.focus_session, None);
    }

    #[test]
    fn invalid_checkpoint_material_does_not_displace_recoverable_generations() {
        let mut database = PersistenceDatabase::in_memory().expect("database");
        for value in ["one", "two", "three"] {
            commit_semantically_verified_slot(&mut database, "alpha", "Alpha", &snapshot(value));
        }
        database
            .commit_focus_checkpoint(
                "alpha",
                "Alpha",
                &snapshot("checkpoint"),
                &completed_focus_session("alpha", vec![7]),
            )
            .expect("checkpoint generation");
        database
            .connection
            .execute(
                "UPDATE save_generations SET focus_session_json = '{}'
                 WHERE slot_id = 'alpha' AND generation = 4",
                [],
            )
            .expect("corrupt checkpoint");
        commit_semantically_verified_slot(&mut database, "alpha", "Alpha", &snapshot("five"));

        let generations: Vec<i64> = database
            .connection
            .prepare(
                "SELECT generation FROM save_generations WHERE slot_id = 'alpha' ORDER BY generation",
            )
            .expect("statement")
            .query_map([], |row| row.get(0))
            .expect("query")
            .collect::<std::result::Result<_, _>>()
            .expect("generations");
        assert_eq!(generations, vec![2, 3, 4, 5]);
    }

    #[test]
    fn missing_head_recovers_verified_material_and_reports_recovery() {
        let mut database = PersistenceDatabase::in_memory().expect("database");
        database
            .commit_slot("alpha", "Alpha", &snapshot("one"))
            .expect("one");
        database
            .connection
            .execute(
                "UPDATE save_slots SET head_generation = NULL WHERE slot_id = 'alpha'",
                [],
            )
            .expect("remove head");

        let loaded = database.load_slot("alpha").expect("load").expect("present");
        assert_eq!(loaded.recovered_generation, 1);
        assert!(loaded.recovered_from_corruption);
    }

    #[test]
    fn a_valid_slot_head_is_preferred_over_newer_unheaded_material() {
        let mut database = PersistenceDatabase::in_memory().expect("database");
        database
            .commit_slot("alpha", "Alpha", &snapshot("one"))
            .expect("one");
        database
            .commit_slot("alpha", "Alpha", &snapshot("two"))
            .expect("two");
        database
            .connection
            .execute(
                "UPDATE save_slots SET head_generation = 1 WHERE slot_id = 'alpha'",
                [],
            )
            .expect("replace head");

        let loaded = database.load_slot("alpha").expect("load").expect("present");
        assert_eq!(loaded.recovered_generation, 1);
        assert!(!loaded.recovered_from_corruption);
    }

    #[test]
    fn failed_commit_preserves_previous_verified_generation() {
        let mut database = PersistenceDatabase::in_memory().expect("database");
        database
            .commit_slot("alpha", "Alpha", &snapshot("one"))
            .expect("one");
        assert!(
            database
                .commit_slot_inner("alpha", "Alpha", &snapshot("two"), None, true)
                .is_err()
        );

        let loaded = database.load_slot("alpha").expect("load").expect("present");
        assert_eq!(loaded.snapshot, snapshot("one"));
        let count: i64 = database
            .connection
            .query_row(
                "SELECT COUNT(*) FROM save_generations WHERE slot_id = 'alpha'",
                [],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(count, 1);
    }

    #[test]
    fn interrupted_focus_checkpoint_rolls_back_world_history_and_generation_together() {
        let mut database = PersistenceDatabase::in_memory().expect("database");
        let first =
            commit_semantically_verified_slot(&mut database, "alpha", "Alpha", &snapshot("one"));
        let session = completed_focus_session("alpha", vec![7, 9]);

        assert!(
            database
                .commit_slot_inner(
                    "alpha",
                    "Alpha",
                    &snapshot("interrupted"),
                    Some(&session),
                    true,
                )
                .is_err()
        );

        let loaded = database.load_slot("alpha").expect("load").expect("present");
        assert_eq!(loaded.recovered_generation, first.recovered_generation);
        assert_eq!(loaded.snapshot, first.snapshot);
        assert!(database.list_focus_sessions().expect("history").is_empty());
        let row_count: i64 = database
            .connection
            .query_row(
                "SELECT COUNT(*) FROM save_generations WHERE slot_id = 'alpha'",
                [],
                |row| row.get(0),
            )
            .expect("row count");
        assert_eq!(row_count, 1);

        let committed = database
            .commit_focus_checkpoint("alpha", "Alpha", &snapshot("two"), &session)
            .expect("retry checkpoint");
        assert_eq!(committed.recovered_generation, 2);
        assert_eq!(
            database.list_focus_sessions().expect("history"),
            vec![session]
        );
    }

    #[test]
    fn stale_or_cross_slot_focus_checkpoint_rolls_back_the_whole_transaction() {
        let mut database = PersistenceDatabase::in_memory().expect("database");
        let completed = completed_focus_session("alpha", vec![7]);
        let first = database
            .commit_focus_checkpoint("alpha", "Alpha", &snapshot("one"), &completed)
            .expect("completed checkpoint");

        let mut stale = completed.clone();
        stale.ended_at_ms = None;
        stale.focused_ms = 50;
        stale.break_ms = 0;
        stale.issued_simulation_ticks = 0;
        stale.status = FocusSessionStatus::Paused;
        stale.state_json = stale_paused_focus_state_json();
        stale.recap_event_ids.clear();
        stale.recap_entries.clear();
        assert!(
            database
                .commit_focus_checkpoint("alpha", "Alpha", &snapshot("two"), &stale)
                .is_err()
        );

        let mut cross_slot = completed.clone();
        cross_slot.slot_id = Some("beta".to_owned());
        assert!(
            database
                .commit_focus_checkpoint("beta", "Beta", &snapshot("other"), &cross_slot)
                .is_err()
        );

        let mut rewritten_history = completed.clone();
        rewritten_history.recap_event_ids.clear();
        rewritten_history.recap_entries.clear();
        assert!(
            database
                .commit_focus_checkpoint("alpha", "Alpha", &snapshot("two"), &rewritten_history,)
                .is_err()
        );
        assert!(database.record_focus_session(&rewritten_history).is_err());

        let mut noncanonical = completed.clone();
        noncanonical.session_id = "session-noncanonical".to_owned();
        let mut state: serde_json::Value =
            serde_json::from_str(&noncanonical.state_json).expect("focus state");
        state
            .as_object_mut()
            .expect("focus state object")
            .insert("unexpectedAuthority".to_owned(), true.into());
        noncanonical.state_json = serde_json::to_string(&state).expect("focus state JSON");
        assert!(
            database
                .commit_focus_checkpoint("alpha", "Alpha", &snapshot("two"), &noncanonical)
                .is_err()
        );

        let loaded = database.load_slot("alpha").expect("load").expect("present");
        assert_eq!(loaded.recovered_generation, first.recovered_generation);
        assert_eq!(loaded.snapshot, first.snapshot);
        assert_eq!(
            database.list_focus_sessions().expect("history"),
            vec![completed]
        );
        assert_eq!(
            database.list_slots().expect("slots"),
            vec![SaveSlotSummary {
                slot_id: "alpha".to_owned(),
                name: "Alpha".to_owned(),
                head_generation: Some(1),
            }]
        );
    }

    #[test]
    fn inserted_generation_verification_rejects_same_length_snapshot_corruption() {
        let expected = "abcd";
        let inserted = "wxyz";
        assert_eq!(expected.len(), inserted.len());

        let result = verify_inserted_generation(
            inserted,
            &sha256_hex(expected),
            None,
            expected,
            &sha256_hex(expected),
            None,
        );

        assert!(result.is_err());
    }

    #[test]
    fn import_export_round_trips_and_rejects_tampering() {
        let mut source = PersistenceDatabase::in_memory().expect("source");
        source
            .commit_slot("alpha", "Alpha", &snapshot("one"))
            .expect("save");
        let export = source.export_slot("alpha").expect("export");
        let mut destination = PersistenceDatabase::in_memory().expect("destination");
        let imported = destination.import_slot(&export).expect("import");
        assert_eq!(imported.snapshot, snapshot("one"));

        let mut tampered: serde_json::Value = serde_json::from_str(&export).expect("json");
        tampered["checksum"] = serde_json::Value::String("0".repeat(64));
        assert!(destination.import_slot(&tampered.to_string()).is_err());
    }

    #[test]
    fn focus_history_round_trips_its_event_references() {
        let mut database = PersistenceDatabase::in_memory().expect("database");
        database
            .commit_slot("alpha", "Alpha", &snapshot("focus-source"))
            .expect("source save");
        let session = FocusSession {
            session_id: "session-1".to_owned(),
            slot_id: Some("alpha".to_owned()),
            started_at_ms: 100,
            ended_at_ms: Some(220),
            planned_focus_ms: 100,
            focused_ms: 100,
            planned_break_ms: 20,
            break_ms: 20,
            issued_simulation_ticks: 1,
            status: FocusSessionStatus::Completed,
            state_json: completed_focus_state_json(),
            recap_event_ids: vec![7, 9, 11],
            recap_entries: vec![
                FocusRecapEntry {
                    id: 7,
                    tick: 0,
                    summary: "Recorded factual event 7.".to_owned(),
                },
                FocusRecapEntry {
                    id: 9,
                    tick: 0,
                    summary: "Recorded factual event 9.".to_owned(),
                },
                FocusRecapEntry {
                    id: 11,
                    tick: 0,
                    summary: "Recorded factual event 11.".to_owned(),
                },
            ],
            review: None,
        };
        database.record_focus_session(&session).expect("record");
        assert_eq!(database.list_focus_sessions().expect("list"), vec![session]);
    }

    #[test]
    fn focus_review_round_trips_and_rejects_tick_or_provenance_tampering() {
        let mut database = PersistenceDatabase::in_memory().expect("database");
        database
            .commit_slot("alpha", "Alpha", &snapshot("focus-review"))
            .expect("source save");
        let mut session = completed_focus_session("alpha", vec![7]);
        session.review = Some(FocusSessionReview {
            version: 1,
            baseline_event_id: 6,
            before: focus_world_moment(0),
            after: focus_world_moment(1),
            revisit_target: Some(FocusRevisitTarget {
                kind: FocusRevisitKind::Settlement,
                id: 1,
                label: "First Hearth".to_owned(),
                source_event_id: Some(7),
            }),
        });
        database
            .commit_focus_checkpoint("alpha", "Alpha", &snapshot("focus-review"), &session)
            .expect("review checkpoint");
        assert_eq!(
            database.list_focus_sessions().expect("list"),
            vec![session.clone()]
        );

        let mut rewritten_review = session.clone();
        rewritten_review
            .review
            .as_mut()
            .expect("review")
            .revisit_target
            .as_mut()
            .expect("target")
            .label = "Renamed Hearth".to_owned();
        assert!(
            database
                .commit_focus_checkpoint(
                    "alpha",
                    "Alpha",
                    &snapshot("focus-review"),
                    &rewritten_review,
                )
                .is_err()
        );
        assert!(database.record_focus_session(&rewritten_review).is_err());

        let mut wrong_tick = session.clone();
        wrong_tick.review.as_mut().expect("review").after.tick = 2;
        assert!(
            database
                .commit_focus_checkpoint("alpha", "Alpha", &snapshot("focus-review"), &wrong_tick,)
                .is_err()
        );
        let mut wrong_source = session;
        wrong_source
            .review
            .as_mut()
            .expect("review")
            .revisit_target
            .as_mut()
            .expect("target")
            .source_event_id = Some(9);
        assert!(database.record_focus_session(&wrong_source).is_err());
    }

    #[test]
    fn focus_review_authority_survives_later_saves_and_rejects_copy_tampering() {
        let mut database = PersistenceDatabase::in_memory().expect("database");
        let mut session = completed_focus_session("alpha", vec![7]);
        session.review = Some(FocusSessionReview {
            version: 1,
            baseline_event_id: 6,
            before: focus_world_moment(0),
            after: focus_world_moment(1),
            revisit_target: Some(FocusRevisitTarget {
                kind: FocusRevisitKind::Settlement,
                id: 1,
                label: "First Hearth".to_owned(),
                source_event_id: Some(7),
            }),
        });
        database
            .commit_focus_checkpoint("alpha", "Alpha", &snapshot("focus-review"), &session)
            .expect("review checkpoint");
        let checkpoint = database
            .load_slot("alpha")
            .expect("load checkpoint")
            .expect("checkpoint");
        confirm_and_prune(&mut database, &checkpoint);
        for suffix in ["later-1", "later-2", "later-3", "later-4"] {
            commit_semantically_verified_slot(&mut database, "alpha", "Alpha", &snapshot(suffix));
        }
        let original_generation_exists: bool = database
            .connection
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM save_generations WHERE slot_id = 'alpha' AND generation = 1
                )",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("generation lookup")
            != 0;
        assert!(!original_generation_exists);

        let records = database
            .list_focus_session_records()
            .expect("verified history");
        assert_eq!(records[0].checkpoint_generation, Some(1));
        assert_eq!(records[0].authority_session, Some(session.clone()));

        let mut fabricated_review = session.review.clone().expect("review");
        fabricated_review.after.food += 1;
        database
            .connection
            .execute(
                "UPDATE focus_sessions SET review_json = ?1 WHERE session_id = ?2",
                params![
                    serde_json::to_string(&fabricated_review).expect("review JSON"),
                    session.session_id
                ],
            )
            .expect("tamper display copy");
        let tampered_copy = database
            .list_focus_session_records()
            .expect("history after copy tamper");
        assert_ne!(tampered_copy[0].session.review, session.review);
        assert_eq!(tampered_copy[0].authority_session, Some(session.clone()));

        database
            .connection
            .execute(
                "UPDATE focus_sessions SET review_authority_json = '{}'
                 WHERE session_id = ?1",
                [session.session_id],
            )
            .expect("tamper authority");
        let invalid_authority = database
            .list_focus_session_records()
            .expect("history after authority tamper");
        assert_eq!(invalid_authority[0].checkpoint_generation, None);
        assert_eq!(invalid_authority[0].authority_session, None);
    }

    #[test]
    fn focus_history_requires_matching_state_and_source_events() {
        let mut database = PersistenceDatabase::in_memory().expect("database");
        database
            .commit_slot("alpha", "Alpha", &snapshot("focus-source"))
            .expect("source save");
        let base = FocusSession {
            session_id: "session-1".to_owned(),
            slot_id: Some("alpha".to_owned()),
            started_at_ms: 100,
            ended_at_ms: Some(220),
            planned_focus_ms: 100,
            focused_ms: 100,
            planned_break_ms: 20,
            break_ms: 20,
            issued_simulation_ticks: 1,
            status: FocusSessionStatus::Completed,
            state_json: completed_focus_state_json(),
            recap_event_ids: vec![7],
            recap_entries: vec![FocusRecapEntry {
                id: 7,
                tick: 0,
                summary: "Recorded factual event 7.".to_owned(),
            }],
            review: None,
        };
        let mut mismatched = base.clone();
        mismatched.focused_ms = 99;
        assert!(database.record_focus_session(&mismatched).is_err());
        let mut tampered_tick = base.clone();
        tampered_tick.recap_entries[0].tick = 1;
        assert!(database.record_focus_session(&tampered_tick).is_err());
        let mut tampered_summary = base.clone();
        tampered_summary.recap_entries[0].summary = "Invented recap.".to_owned();
        assert!(database.record_focus_session(&tampered_summary).is_err());
        let mut absent_event = base;
        absent_event.recap_event_ids = vec![8];
        absent_event.recap_entries[0].id = 8;
        assert!(database.record_focus_session(&absent_event).is_err());
    }

    #[test]
    fn focus_history_rejects_inconsistent_status_progress_and_event_order() {
        let mut database = PersistenceDatabase::in_memory().expect("database");
        let invalid = FocusSession {
            session_id: "session-1".to_owned(),
            slot_id: None,
            started_at_ms: 100,
            ended_at_ms: None,
            planned_focus_ms: 100,
            focused_ms: 101,
            planned_break_ms: 20,
            break_ms: 0,
            issued_simulation_ticks: 1,
            status: FocusSessionStatus::Completed,
            state_json: completed_focus_state_json(),
            recap_event_ids: vec![9, 7],
            recap_entries: vec![
                FocusRecapEntry {
                    id: 9,
                    tick: 0,
                    summary: "Recorded factual event 9.".to_owned(),
                },
                FocusRecapEntry {
                    id: 7,
                    tick: 0,
                    summary: "Recorded factual event 7.".to_owned(),
                },
            ],
            review: None,
        };
        assert!(database.record_focus_session(&invalid).is_err());
    }

    #[test]
    fn typed_settings_have_defaults_and_persist_updates() {
        let mut database = PersistenceDatabase::in_memory().expect("database");
        assert_eq!(
            database.load_settings().expect("default"),
            AppSettings::default()
        );
        database
            .commit_slot("alpha", "Alpha", &snapshot("settings"))
            .expect("save slot");
        let updated = AppSettings {
            focus_to_sim_ratio: 35,
            default_focus_minutes: 50,
            default_break_minutes: 10,
            volume_percent: 40,
            audio_muted: true,
            ambience_enabled: true,
            ambience_volume_percent: 35,
            effects_volume_percent: 65,
            offline_progression_enabled: false,
            max_offline_hours: 12,
            calm_mode: true,
            reduced_effects: true,
            notifications_enabled: false,
            sound_enabled: false,
            breaks_enabled: true,
            active_slot_id: Some("alpha".to_owned()),
        };
        assert_eq!(database.save_settings(&updated).expect("save"), updated);
        assert_eq!(database.load_settings().expect("load"), updated);
    }

    #[test]
    fn deleting_the_active_slot_clears_the_persisted_identifier() {
        let mut database = PersistenceDatabase::in_memory().expect("database");
        database
            .commit_slot("alpha", "Alpha", &snapshot("one"))
            .expect("save");
        database
            .save_settings(&AppSettings {
                active_slot_id: Some("alpha".to_owned()),
                ..AppSettings::default()
            })
            .expect("active setting");

        assert!(database.delete_slot("alpha").expect("delete"));
        assert_eq!(
            database.load_settings().expect("settings").active_slot_id,
            None
        );
        assert!(
            database
                .save_settings(&AppSettings {
                    active_slot_id: Some("missing".to_owned()),
                    ..AppSettings::default()
                })
                .is_err()
        );
    }

    #[test]
    fn typed_settings_reject_out_of_range_values() {
        let mut database = PersistenceDatabase::in_memory().expect("database");
        for invalid in [
            AppSettings {
                volume_percent: 101,
                ..AppSettings::default()
            },
            AppSettings {
                ambience_volume_percent: 101,
                ..AppSettings::default()
            },
            AppSettings {
                effects_volume_percent: 101,
                ..AppSettings::default()
            },
        ] {
            assert!(database.save_settings(&invalid).is_err());
        }
    }

    #[test]
    fn typed_settings_reject_unknown_command_fields() {
        let mut value = serde_json::to_value(AppSettings::default()).expect("settings JSON");
        value.as_object_mut().expect("settings object").insert(
            "unexpectedAuthority".to_owned(),
            serde_json::Value::Bool(true),
        );

        assert!(serde_json::from_value::<AppSettings>(value).is_err());
    }

    struct HistoricalDatabaseFile {
        path: PathBuf,
    }

    impl HistoricalDatabaseFile {
        fn create(schema_version: i64) -> Self {
            assert!([2, 4, 5, 7].contains(&schema_version));
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("test clock")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "chrono-forge-m10-7-v{schema_version}-{}-{unique}.sqlite3",
                std::process::id()
            ));
            let connection = Connection::open(&path).expect("historical database");
            seed_historical_database(&connection, schema_version);
            drop(connection);
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for HistoricalDatabaseFile {
        fn drop(&mut self) {
            for path in [
                self.path.clone(),
                PathBuf::from(format!("{}-wal", self.path.display())),
                PathBuf::from(format!("{}-shm", self.path.display())),
            ] {
                let _ = fs::remove_file(path);
            }
        }
    }

    fn historical_focus_session(schema_version: i64) -> FocusSession {
        let mut session = completed_focus_session("alpha", vec![7]);
        if schema_version < 4 {
            session.recap_entries.clear();
        }
        if schema_version >= 5 {
            session.review = Some(FocusSessionReview {
                version: 1,
                baseline_event_id: 6,
                before: focus_world_moment(0),
                after: focus_world_moment(1),
                revisit_target: Some(FocusRevisitTarget {
                    kind: FocusRevisitKind::Settlement,
                    id: 1,
                    label: "First Hearth".to_owned(),
                    source_event_id: Some(7),
                }),
            });
        }
        session
    }

    fn seed_historical_database(connection: &Connection, schema_version: i64) {
        connection
            .execute_batch(
                "
                PRAGMA foreign_keys = ON;
                CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_marker INTEGER NOT NULL
                );
                INSERT INTO schema_migrations (version, applied_marker) VALUES (1, 1);
                CREATE TABLE save_slots (
                    slot_id TEXT PRIMARY KEY NOT NULL,
                    name TEXT NOT NULL,
                    head_generation INTEGER,
                    FOREIGN KEY (slot_id, head_generation)
                        REFERENCES save_generations(slot_id, generation)
                        DEFERRABLE INITIALLY DEFERRED
                );
                CREATE TABLE save_generations (
                    slot_id TEXT NOT NULL,
                    generation INTEGER NOT NULL,
                    snapshot TEXT NOT NULL,
                    checksum TEXT NOT NULL,
                    PRIMARY KEY (slot_id, generation),
                    FOREIGN KEY (slot_id) REFERENCES save_slots(slot_id) ON DELETE CASCADE
                );
                CREATE INDEX idx_save_generations_newest
                    ON save_generations (slot_id, generation DESC);
                CREATE TABLE focus_sessions (
                    session_id TEXT PRIMARY KEY NOT NULL,
                    slot_id TEXT,
                    started_at_ms INTEGER NOT NULL,
                    ended_at_ms INTEGER,
                    planned_focus_ms INTEGER NOT NULL,
                    focused_ms INTEGER NOT NULL,
                    planned_break_ms INTEGER NOT NULL,
                    break_ms INTEGER NOT NULL,
                    issued_simulation_ticks INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    state_json TEXT NOT NULL,
                    recap_event_ids_json TEXT NOT NULL,
                    FOREIGN KEY (slot_id) REFERENCES save_slots(slot_id) ON DELETE SET NULL
                );
                CREATE INDEX idx_focus_sessions_newest
                    ON focus_sessions (started_at_ms DESC, session_id ASC);
                CREATE TABLE app_settings (
                    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                    focus_to_sim_ratio INTEGER NOT NULL,
                    default_focus_minutes INTEGER NOT NULL,
                    default_break_minutes INTEGER NOT NULL,
                    volume_percent INTEGER NOT NULL,
                    offline_progression_enabled INTEGER NOT NULL
                        CHECK (offline_progression_enabled IN (0, 1)),
                    max_offline_hours INTEGER NOT NULL,
                    calm_mode INTEGER NOT NULL CHECK (calm_mode IN (0, 1)),
                    notifications_enabled INTEGER NOT NULL
                        CHECK (notifications_enabled IN (0, 1)),
                    sound_enabled INTEGER NOT NULL CHECK (sound_enabled IN (0, 1)),
                    breaks_enabled INTEGER NOT NULL CHECK (breaks_enabled IN (0, 1))
                );
                ",
            )
            .expect("v1 schema");

        for version in 2..=schema_version {
            let migration = match version {
                2 => {
                    "ALTER TABLE save_generations
                     ADD COLUMN saved_at_ms INTEGER NOT NULL DEFAULT 0;"
                }
                3 => {
                    "ALTER TABLE save_generations ADD COLUMN focus_session_json TEXT;
                     ALTER TABLE app_settings ADD COLUMN active_slot_id TEXT;"
                }
                4 => {
                    "ALTER TABLE focus_sessions
                         ADD COLUMN recap_entries_json TEXT NOT NULL DEFAULT '[]';
                     ALTER TABLE app_settings ADD COLUMN reduced_effects INTEGER NOT NULL DEFAULT 0
                         CHECK (reduced_effects IN (0, 1));"
                }
                5 => "ALTER TABLE focus_sessions ADD COLUMN review_json TEXT;",
                6 => {
                    "ALTER TABLE focus_sessions ADD COLUMN checkpoint_generation INTEGER;
                     ALTER TABLE focus_sessions ADD COLUMN review_authority_json TEXT;
                     ALTER TABLE focus_sessions ADD COLUMN review_authority_checksum TEXT;"
                }
                7 => {
                    "ALTER TABLE app_settings ADD COLUMN audio_muted INTEGER NOT NULL DEFAULT 0
                         CHECK (audio_muted IN (0, 1));
                     ALTER TABLE app_settings ADD COLUMN ambience_enabled INTEGER NOT NULL DEFAULT 0
                         CHECK (ambience_enabled IN (0, 1));
                     ALTER TABLE app_settings
                         ADD COLUMN ambience_volume_percent INTEGER NOT NULL DEFAULT 20;
                     ALTER TABLE app_settings
                         ADD COLUMN effects_volume_percent INTEGER NOT NULL DEFAULT 45;"
                }
                _ => unreachable!("bounded historical schema version"),
            };
            connection
                .execute_batch(migration)
                .unwrap_or_else(|error| panic!("v{version} schema: {error}"));
            connection
                .execute(
                    "INSERT INTO schema_migrations (version, applied_marker) VALUES (?1, 1)",
                    [version],
                )
                .unwrap_or_else(|error| panic!("v{version} marker: {error}"));
        }

        let legacy_snapshot = snapshot(&format!("legacy-v{schema_version}"));
        let legacy_checksum = sha256_hex(&legacy_snapshot);
        let session = historical_focus_session(schema_version);
        let session_json = serde_json::to_string(&session).expect("historical session JSON");
        connection
            .execute(
                "INSERT INTO save_slots (slot_id, name, head_generation)
                 VALUES ('alpha', 'Alpha', NULL)",
                [],
            )
            .expect("historical slot");
        if schema_version >= 3 {
            connection
                .execute(
                    "INSERT INTO save_generations
                     (slot_id, generation, snapshot, checksum, saved_at_ms, focus_session_json)
                     VALUES ('alpha', 1, ?1, ?2, ?3, ?4)",
                    params![
                        legacy_snapshot,
                        legacy_checksum,
                        1_000 + schema_version,
                        session_json
                    ],
                )
                .expect("historical generation with checkpoint");
        } else {
            connection
                .execute(
                    "INSERT INTO save_generations
                     (slot_id, generation, snapshot, checksum, saved_at_ms)
                     VALUES ('alpha', 1, ?1, ?2, ?3)",
                    params![legacy_snapshot, legacy_checksum, 1_000 + schema_version],
                )
                .expect("historical generation");
        }
        connection
            .execute(
                "UPDATE save_slots SET head_generation = 1 WHERE slot_id = 'alpha'",
                [],
            )
            .expect("historical head");
        connection
            .execute(
                "INSERT INTO app_settings
                 (singleton, focus_to_sim_ratio, default_focus_minutes, default_break_minutes,
                  volume_percent, offline_progression_enabled, max_offline_hours, calm_mode,
                  notifications_enabled, sound_enabled, breaks_enabled)
                 VALUES (1, 25, 50, 10, 60, 0, 12, 1, 0, 0, 1)",
                [],
            )
            .expect("historical settings");
        if schema_version >= 3 {
            connection
                .execute(
                    "UPDATE app_settings SET active_slot_id = 'alpha' WHERE singleton = 1",
                    [],
                )
                .expect("historical active slot");
        }
        if schema_version >= 4 {
            connection
                .execute(
                    "UPDATE app_settings SET reduced_effects = 1 WHERE singleton = 1",
                    [],
                )
                .expect("historical reduced effects");
        }
        if schema_version >= 7 {
            connection
                .execute(
                    "UPDATE app_settings
                     SET audio_muted = 1, ambience_enabled = 1,
                         ambience_volume_percent = 33, effects_volume_percent = 44
                     WHERE singleton = 1",
                    [],
                )
                .expect("historical audio settings");
        }

        connection
            .execute(
                "INSERT INTO focus_sessions
                 (session_id, slot_id, started_at_ms, ended_at_ms, planned_focus_ms, focused_ms,
                  planned_break_ms, break_ms, issued_simulation_ticks, status, state_json,
                  recap_event_ids_json)
                 VALUES ('session-1', 'alpha', 100, 220, 100, 100, 20, 20, 1,
                         'completed', ?1, '[7]')",
                [completed_focus_state_json()],
            )
            .expect("historical focus session");
        if schema_version >= 4 {
            connection
                .execute(
                    "UPDATE focus_sessions SET recap_entries_json = ?1
                     WHERE session_id = 'session-1'",
                    [serde_json::to_string(&session.recap_entries)
                        .expect("historical recap entries")],
                )
                .expect("historical recap entries");
        }
        if schema_version >= 5 {
            connection
                .execute(
                    "UPDATE focus_sessions SET review_json = ?1 WHERE session_id = 'session-1'",
                    [serde_json::to_string(&session.review).expect("historical review")],
                )
                .expect("historical review");
        }
        if schema_version >= 7 {
            connection
                .execute(
                    "UPDATE focus_sessions
                     SET checkpoint_generation = 1, review_authority_json = ?1,
                         review_authority_checksum = ?2
                     WHERE session_id = 'session-1'",
                    params![session_json, sha256_hex(&session_json)],
                )
                .expect("historical review authority");
        }
    }

    fn schema_fingerprint(database: &PersistenceDatabase) -> Vec<(String, String)> {
        database
            .connection
            .prepare(
                "SELECT type || ':' || name, COALESCE(sql, '')
                 FROM sqlite_schema
                 WHERE name NOT LIKE 'sqlite_%'
                 ORDER BY type, name",
            )
            .expect("schema statement")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("schema query")
            .collect::<std::result::Result<_, _>>()
            .expect("schema fingerprint")
    }

    #[test]
    fn historical_schema_matrix_migrates_idempotently_and_preserves_recovery_contracts() {
        for schema_version in [2, 4, 5, 7] {
            let file = HistoricalDatabaseFile::create(schema_version);
            let mut database = PersistenceDatabase::open(file.path())
                .unwrap_or_else(|error| panic!("open v{schema_version}: {error}"));
            let expected_session = historical_focus_session(schema_version);
            let expected_settings = AppSettings {
                focus_to_sim_ratio: 25,
                default_focus_minutes: 50,
                default_break_minutes: 10,
                volume_percent: 60,
                audio_muted: schema_version >= 7,
                ambience_enabled: schema_version >= 7,
                ambience_volume_percent: if schema_version >= 7 { 33 } else { 20 },
                effects_volume_percent: if schema_version >= 7 { 44 } else { 45 },
                offline_progression_enabled: false,
                max_offline_hours: 12,
                calm_mode: true,
                reduced_effects: schema_version >= 4,
                notifications_enabled: false,
                sound_enabled: false,
                breaks_enabled: true,
                active_slot_id: (schema_version >= 3).then(|| "alpha".to_owned()),
            };
            let schema_after_first_migration = schema_fingerprint(&database);
            let loaded_after_first_migration = database
                .load_slot("alpha")
                .expect("load migrated slot")
                .expect("migrated slot");
            let settings_after_first_migration =
                database.load_settings().expect("migrated settings");
            let focus_after_first_migration = database
                .list_focus_session_records()
                .expect("migrated focus history");

            database
                .migrate()
                .unwrap_or_else(|error| panic!("repeat v{schema_version} migration: {error}"));
            assert_eq!(schema_fingerprint(&database), schema_after_first_migration);
            assert_eq!(
                database.load_slot("alpha").expect("repeat load"),
                Some(loaded_after_first_migration.clone())
            );
            assert_eq!(
                database.load_settings().expect("repeat settings"),
                settings_after_first_migration
            );
            assert_eq!(
                database
                    .list_focus_session_records()
                    .expect("repeat focus history"),
                focus_after_first_migration
            );
            let versions: Vec<i64> = database
                .connection
                .prepare("SELECT version FROM schema_migrations ORDER BY version")
                .expect("version statement")
                .query_map([], |row| row.get(0))
                .expect("version query")
                .collect::<std::result::Result<_, _>>()
                .expect("schema versions");
            assert_eq!(versions, (1..=SCHEMA_VERSION).collect::<Vec<_>>());
            let foreign_key_failures: i64 = database
                .connection
                .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                    row.get(0)
                })
                .expect("foreign-key check");
            assert_eq!(foreign_key_failures, 0);

            assert_eq!(
                loaded_after_first_migration.snapshot,
                snapshot(&format!("legacy-v{schema_version}"))
            );
            assert_eq!(loaded_after_first_migration.recovered_generation, 1);
            assert_eq!(loaded_after_first_migration.head_generation, Some(1));
            assert!(!loaded_after_first_migration.recovered_from_corruption);
            assert_eq!(
                loaded_after_first_migration.checksum,
                sha256_hex(&loaded_after_first_migration.snapshot)
            );
            assert_eq!(
                loaded_after_first_migration.saved_at_ms,
                1_000 + schema_version
            );
            assert_eq!(
                loaded_after_first_migration.focus_session,
                (schema_version >= 3).then(|| expected_session.clone())
            );
            assert_eq!(settings_after_first_migration, expected_settings);
            assert_eq!(focus_after_first_migration.len(), 1);
            assert_eq!(focus_after_first_migration[0].session, expected_session);
            assert_eq!(
                focus_after_first_migration[0].checkpoint_generation,
                (schema_version >= 7).then_some(1)
            );
            assert_eq!(
                focus_after_first_migration[0].authority_session,
                (schema_version >= 7).then(|| expected_session.clone())
            );
            let legacy_semantic_marker: i64 = database
                .connection
                .query_row(
                    "SELECT semantically_verified FROM save_generations
                     WHERE slot_id = 'alpha' AND generation = 1",
                    [],
                    |row| row.get(0),
                )
                .expect("legacy semantic marker");
            assert_eq!(legacy_semantic_marker, 0);
            assert!(
                database
                    .confirm_semantically_valid_generation("alpha", 1, &"0".repeat(64),)
                    .is_err()
            );
            confirm_and_prune(&mut database, &loaded_after_first_migration);

            let current_snapshot = snapshot(&format!("current-v{schema_version}"));
            let committed = database
                .commit_slot("alpha", "Alpha", &current_snapshot)
                .expect("post-migration commit");
            assert_eq!(committed.recovered_generation, 2);
            assert_eq!(committed.head_generation, Some(2));
            assert_eq!(committed.checksum, sha256_hex(&current_snapshot));
            let exported: SaveExportEnvelope = serde_json::from_str(
                &database
                    .export_generation("alpha", 2)
                    .expect("post-migration export"),
            )
            .expect("export envelope");
            assert_eq!(exported.slot_id, "alpha");
            assert_eq!(exported.name, "Alpha");
            assert_eq!(exported.snapshot, current_snapshot);
            assert_eq!(exported.checksum, committed.checksum);
            confirm_and_prune(&mut database, &committed);

            database
                .connection
                .execute(
                    "UPDATE save_generations SET checksum = ?1
                     WHERE slot_id = 'alpha' AND generation = 2",
                    ["0".repeat(64)],
                )
                .expect("corrupt migrated head");
            let recovered = database
                .load_slot("alpha")
                .expect("recover migrated slot")
                .expect("recovered migrated slot");
            assert_eq!(recovered.recovered_generation, 1);
            assert!(recovered.recovered_from_corruption);
            assert_eq!(recovered.snapshot, loaded_after_first_migration.snapshot);

            for generation in 3..=5 {
                let replacement = snapshot(&format!("replacement-v{schema_version}-{generation}"));
                let loaded = database
                    .commit_slot("alpha", "Alpha", &replacement)
                    .expect("replacement commit");
                assert_eq!(loaded.recovered_generation, generation);
                confirm_and_prune(&mut database, &loaded);
                if generation < 5 {
                    let historical_candidate_count: i64 = database
                        .connection
                        .query_row(
                            "SELECT COUNT(*) FROM save_generations
                             WHERE slot_id = 'alpha' AND generation = 1",
                            [],
                            |row| row.get(0),
                        )
                        .expect("historical recovery candidate");
                    assert_eq!(historical_candidate_count, 1);
                }
            }
            let retained: Vec<(i64, i64)> = database
                .connection
                .prepare(
                    "SELECT generation, semantically_verified FROM save_generations
                     WHERE slot_id = 'alpha' ORDER BY generation",
                )
                .expect("retained statement")
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .expect("retained query")
                .collect::<std::result::Result<_, _>>()
                .expect("retained generations");
            assert_eq!(retained, vec![(3, 1), (4, 1), (5, 1)]);
            database
                .connection
                .execute(
                    "UPDATE save_generations SET checksum = ?1
                     WHERE slot_id = 'alpha' AND generation = 5",
                    ["f".repeat(64)],
                )
                .expect("corrupt retained head");
            let retained_recovery = database
                .load_slot("alpha")
                .expect("retained recovery")
                .expect("retained recovery candidate");
            assert_eq!(retained_recovery.recovered_generation, 4);
            assert!(retained_recovery.recovered_from_corruption);
            assert_eq!(
                retained_recovery.checksum,
                sha256_hex(&retained_recovery.snapshot)
            );
            let retained_export: SaveExportEnvelope = serde_json::from_str(
                &database
                    .export_generation("alpha", 4)
                    .expect("retained export"),
            )
            .expect("retained export envelope");
            assert_eq!(retained_export.snapshot, retained_recovery.snapshot);
            assert_eq!(retained_export.checksum, retained_recovery.checksum);
        }
    }

    #[test]
    fn v6_to_v7_migration_defaults_audio_settings_and_enforces_boolean_columns() {
        let connection = Connection::open_in_memory().expect("connection");
        connection
            .execute_batch(
                "
                CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_marker INTEGER NOT NULL
                );
                INSERT INTO schema_migrations (version, applied_marker)
                    VALUES (1, 1), (2, 1), (3, 1), (4, 1), (5, 1), (6, 1);
                CREATE TABLE app_settings (
                    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                    focus_to_sim_ratio INTEGER NOT NULL,
                    default_focus_minutes INTEGER NOT NULL,
                    default_break_minutes INTEGER NOT NULL,
                    volume_percent INTEGER NOT NULL,
                    offline_progression_enabled INTEGER NOT NULL
                        CHECK (offline_progression_enabled IN (0, 1)),
                    max_offline_hours INTEGER NOT NULL,
                    calm_mode INTEGER NOT NULL CHECK (calm_mode IN (0, 1)),
                    notifications_enabled INTEGER NOT NULL CHECK (notifications_enabled IN (0, 1)),
                    sound_enabled INTEGER NOT NULL CHECK (sound_enabled IN (0, 1)),
                    breaks_enabled INTEGER NOT NULL CHECK (breaks_enabled IN (0, 1)),
                    active_slot_id TEXT,
                    reduced_effects INTEGER NOT NULL DEFAULT 0
                        CHECK (reduced_effects IN (0, 1))
                );
                INSERT INTO app_settings (
                    singleton, focus_to_sim_ratio, default_focus_minutes, default_break_minutes,
                    volume_percent, offline_progression_enabled, max_offline_hours, calm_mode,
                    notifications_enabled, sound_enabled, breaks_enabled, active_slot_id,
                    reduced_effects
                ) VALUES (1, 25, 50, 10, 60, 0, 12, 1, 0, 0, 1, NULL, 1);
                ",
            )
            .expect("v6 schema");

        let mut database = PersistenceDatabase { connection };
        database.migrate().expect("v7 migration");
        assert_eq!(
            database.load_settings().expect("settings"),
            AppSettings {
                focus_to_sim_ratio: 25,
                default_focus_minutes: 50,
                default_break_minutes: 10,
                volume_percent: 60,
                audio_muted: false,
                ambience_enabled: false,
                ambience_volume_percent: 20,
                effects_volume_percent: 45,
                offline_progression_enabled: false,
                max_offline_hours: 12,
                calm_mode: true,
                reduced_effects: true,
                notifications_enabled: false,
                sound_enabled: false,
                breaks_enabled: true,
                active_slot_id: None,
            }
        );
        assert!(
            database
                .connection
                .execute("UPDATE app_settings SET audio_muted = 2", [])
                .is_err()
        );
        assert!(
            database
                .connection
                .execute("UPDATE app_settings SET ambience_enabled = 2", [])
                .is_err()
        );
    }

    #[test]
    fn v3_to_v7_migration_preserves_legacy_recap_ids_without_inventing_entries() {
        let connection = Connection::open_in_memory().expect("connection");
        connection
            .execute_batch(
                "
                PRAGMA foreign_keys = ON;
                CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_marker INTEGER NOT NULL
                );
                INSERT INTO schema_migrations (version, applied_marker) VALUES (1, 1), (2, 1), (3, 1);
                CREATE TABLE focus_sessions (
                    session_id TEXT PRIMARY KEY NOT NULL,
                    slot_id TEXT,
                    started_at_ms INTEGER NOT NULL,
                    ended_at_ms INTEGER,
                    planned_focus_ms INTEGER NOT NULL,
                    focused_ms INTEGER NOT NULL,
                    planned_break_ms INTEGER NOT NULL,
                    break_ms INTEGER NOT NULL,
                    issued_simulation_ticks INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    state_json TEXT NOT NULL,
                    recap_event_ids_json TEXT NOT NULL
                );
                CREATE TABLE app_settings (
                    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                    focus_to_sim_ratio INTEGER NOT NULL,
                    default_focus_minutes INTEGER NOT NULL,
                    default_break_minutes INTEGER NOT NULL,
                    volume_percent INTEGER NOT NULL,
                    offline_progression_enabled INTEGER NOT NULL,
                    max_offline_hours INTEGER NOT NULL,
                    calm_mode INTEGER NOT NULL,
                    notifications_enabled INTEGER NOT NULL,
                    sound_enabled INTEGER NOT NULL,
                    breaks_enabled INTEGER NOT NULL,
                    active_slot_id TEXT
                );
                INSERT INTO app_settings VALUES (1, 10, 25, 5, 70, 1, 24, 0, 1, 1, 0, NULL);
                ",
            )
            .expect("v3 schema");
        connection
            .execute(
                "INSERT INTO focus_sessions
                 (session_id, slot_id, started_at_ms, ended_at_ms, planned_focus_ms, focused_ms,
                  planned_break_ms, break_ms, issued_simulation_ticks, status, state_json,
                  recap_event_ids_json)
                 VALUES ('legacy-session', NULL, 100, 220, 100, 100, 20, 20, 1, 'completed', ?1, '[7]')",
                [completed_focus_state_json()],
            )
            .expect("legacy focus history");

        let mut database = PersistenceDatabase { connection };
        database.migrate().expect("v7 migration");
        assert!(!database.load_settings().expect("settings").reduced_effects);
        assert_eq!(
            database.list_focus_sessions().expect("history")[0].recap_entries,
            Vec::<FocusRecapEntry>::new()
        );
        assert_eq!(
            database.list_focus_sessions().expect("history")[0].review,
            None
        );
    }

    #[test]
    fn v1_to_v8_migration_defaults_existing_generations_to_semantically_unverified() {
        let connection = Connection::open_in_memory().expect("connection");
        connection
            .execute_batch(
                "
                PRAGMA foreign_keys = ON;
                CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_marker INTEGER NOT NULL
                );
                INSERT INTO schema_migrations (version, applied_marker) VALUES (1, 1);
                CREATE TABLE save_slots (
                    slot_id TEXT PRIMARY KEY NOT NULL,
                    name TEXT NOT NULL,
                    head_generation INTEGER,
                    FOREIGN KEY (slot_id, head_generation)
                        REFERENCES save_generations(slot_id, generation)
                        DEFERRABLE INITIALLY DEFERRED
                );
                CREATE TABLE save_generations (
                    slot_id TEXT NOT NULL,
                    generation INTEGER NOT NULL,
                    snapshot TEXT NOT NULL,
                    checksum TEXT NOT NULL,
                    PRIMARY KEY (slot_id, generation),
                    FOREIGN KEY (slot_id) REFERENCES save_slots(slot_id) ON DELETE CASCADE
                );
                INSERT INTO save_slots (slot_id, name, head_generation) VALUES ('alpha', 'Alpha', NULL);
                ",
            )
            .expect("v1 schema");
        let legacy_snapshot = snapshot("legacy");
        connection
            .execute(
                "INSERT INTO save_generations (slot_id, generation, snapshot, checksum)
                 VALUES (?1, 1, ?2, ?3)",
                params!["alpha", legacy_snapshot, sha256_hex(&snapshot("legacy"))],
            )
            .expect("legacy generation");
        connection
            .execute(
                "UPDATE save_slots SET head_generation = 1 WHERE slot_id = 'alpha'",
                [],
            )
            .expect("legacy head");

        let mut database = PersistenceDatabase { connection };
        database.migrate().expect("v2 migration");
        let loaded = database.load_slot("alpha").expect("load").expect("present");
        assert_eq!(loaded.saved_at_ms, 0);
        assert_eq!(loaded.focus_session, None);
        let semantically_verified: i64 = database
            .connection
            .query_row(
                "SELECT semantically_verified FROM save_generations
                 WHERE slot_id = 'alpha' AND generation = 1",
                [],
                |row| row.get(0),
            )
            .expect("semantic verification marker");
        assert_eq!(semantically_verified, 0);
        assert_eq!(
            database.load_settings().expect("settings").active_slot_id,
            None
        );
        database.migrate().expect("idempotent migration");

        let versions: Vec<i64> = database
            .connection
            .prepare("SELECT version FROM schema_migrations ORDER BY version")
            .expect("statement")
            .query_map([], |row| row.get(0))
            .expect("query")
            .collect::<std::result::Result<_, _>>()
            .expect("versions");
        assert_eq!(versions, vec![1, 2, 3, 4, 5, 6, 7, 8]);
    }
}
