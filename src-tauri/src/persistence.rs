//! Narrow, local SQLite persistence for save generations and focus metadata.
//!
//! The WebView reaches this module only through typed Tauri commands.  It never
//! receives a SQL connection or a filesystem path.

use std::{
    collections::BTreeMap,
    error::Error,
    fmt::{Display, Formatter, Write},
    fs,
    path::Path,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

const DATABASE_FILE: &str = "chrono-forge.sqlite3";
const SCHEMA_VERSION: i64 = 4;
const MAX_ID_BYTES: usize = 64;
const MAX_NAME_BYTES: usize = 120;
const MAX_SNAPSHOT_BYTES: usize = 50 * 1024 * 1024;
const MAX_RECAP_EVENT_IDS: usize = 12;
const MAX_RECAP_ENTRY_SUMMARY_BYTES: usize = 160;
const MAX_JSON_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_FOCUS_STATE_BYTES: usize = 64 * 1024;
const RETAINED_GENERATIONS: i64 = 3;

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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusRecapEntry {
    pub id: u64,
    pub tick: u64,
    pub summary: String,
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
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub focus_to_sim_ratio: u32,
    pub default_focus_minutes: u32,
    pub default_break_minutes: u32,
    pub volume_percent: u32,
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
}

impl PersistenceState {
    pub fn open_app_local_data(app_local_data: &Path) -> Result<Self> {
        fs::create_dir_all(app_local_data)?;
        let database = PersistenceDatabase::open(&app_local_data.join(DATABASE_FILE))?;
        Ok(Self {
            database: Mutex::new(database),
        })
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, PersistenceDatabase>> {
        self.database
            .lock()
            .map_err(|_| PersistenceError::new("persistence database lock was poisoned"))
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
        Ok(self
            .load_slot_candidates(slot_id)?
            .and_then(|candidates| candidates.into_iter().next()))
    }

    fn load_slot_candidates(&self, slot_id: &str) -> Result<Option<Vec<LoadedSave>>> {
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
                let mut candidates = vec![head];
                candidates.extend(self.fallback_candidates(
                    slot_id,
                    &name,
                    Some(head_generation),
                    Some(head_generation),
                )?);
                return Ok(Some(candidates));
            }
        }

        let candidates = self.fallback_candidates(slot_id, &name, head_generation, None)?;
        if candidates.is_empty() {
            return Err(PersistenceError::new(
                "save slot has no generation with a verified snapshot",
            ));
        }
        Ok(Some(candidates))
    }

    fn fallback_candidates(
        &self,
        slot_id: &str,
        name: &str,
        head_generation: Option<i64>,
        excluded_generation: Option<i64>,
    ) -> Result<Vec<LoadedSave>> {
        let mut statement = self.connection.prepare(
            "SELECT generation, snapshot, checksum, saved_at_ms, focus_session_json
             FROM save_generations
             WHERE slot_id = ?1 AND (?2 IS NULL OR generation != ?2)
             ORDER BY generation DESC",
        )?;
        let generations = statement.query_map(params![slot_id, excluded_generation], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?;
        let mut candidates = Vec::new();
        for generation in generations {
            let (generation, snapshot, checksum, saved_at_ms, focus_session_json) = generation?;
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
        Ok(candidates)
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
        validate_focus_session(session)?;
        if session.slot_id.as_deref() != Some(slot_id) {
            return Err(PersistenceError::new(
                "focus checkpoint session must belong to its save slot",
            ));
        }
        validate_recap_event_references_in_snapshot(session, snapshot)?;
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
        validate_identifier(slot_id, "slot ID")?;
        validate_name(name)?;
        validate_snapshot(snapshot)?;
        if let Some(session) = focus_session {
            validate_focus_session(session)?;
            if session.slot_id.as_deref() != Some(slot_id) {
                return Err(PersistenceError::new(
                    "focus checkpoint session must belong to its save slot",
                ));
            }
            validate_recap_event_references_in_snapshot(session, snapshot)?;
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
        if inserted.0 != snapshot
            || inserted.1 != checksum
            || inserted.2 != focus_session_json
            || sha256_hex(&inserted.0) != inserted.1
        {
            return Err(PersistenceError::new(
                "inserted save generation did not verify",
            ));
        }
        if let Some(session) = focus_session {
            upsert_focus_session(&transaction, session)?;
        }
        if fail_before_head_update {
            return Err(PersistenceError::new(
                "injected commit failure before head update",
            ));
        }
        transaction.execute(
            "UPDATE save_slots SET head_generation = ?2 WHERE slot_id = ?1",
            params![slot_id, next_generation],
        )?;
        transaction.commit()?;

        // Retention is intentionally a separate best-effort transaction. A prune failure cannot
        // invalidate a durable head that has already been verified and committed.
        let _ = self.prune_old_generations(slot_id);
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

    fn prune_old_generations(&mut self, slot_id: &str) -> Result<()> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let generations = {
            let mut statement = transaction.prepare(
                "SELECT generation, snapshot, checksum, saved_at_ms, focus_session_json
                 FROM save_generations WHERE slot_id = ?1 ORDER BY generation DESC",
            )?;
            let rows = statement.query_map([slot_id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            })?;
            rows.collect::<std::result::Result<Vec<_>, _>>()?
        };
        let mut verified_count = 0;
        let mut generations_to_delete = Vec::new();
        for (generation, snapshot, checksum, saved_at_ms, focus_session_json) in generations {
            if validate_snapshot(&snapshot).is_ok()
                && checksum == sha256_hex(&snapshot)
                && saved_at_ms >= 0
                && parse_focus_checkpoint(slot_id, &snapshot, focus_session_json.as_deref()).is_ok()
            {
                if verified_count < RETAINED_GENERATIONS {
                    verified_count += 1;
                } else {
                    generations_to_delete.push(generation);
                }
            }
        }
        for generation in generations_to_delete {
            transaction.execute(
                "DELETE FROM save_generations WHERE slot_id = ?1 AND generation = ?2",
                params![slot_id, generation],
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
        upsert_focus_session(&transaction, session)?;
        transaction.commit()?;
        Ok(())
    }

    fn validate_recap_event_references(&self, session: &FocusSession) -> Result<()> {
        if session.recap_event_ids.is_empty() {
            return Ok(());
        }
        let slot_id = session.slot_id.as_deref().ok_or_else(|| {
            PersistenceError::new("focus recap event IDs require a source save slot")
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

    fn list_focus_sessions(&self) -> Result<Vec<FocusSession>> {
        let mut statement = self.connection.prepare(
            "SELECT session_id, slot_id, started_at_ms, ended_at_ms, planned_focus_ms, focused_ms,
                    planned_break_ms, break_ms, issued_simulation_ticks, status,
                    state_json, recap_event_ids_json, recap_entries_json
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
            Ok(FocusSession {
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
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    fn load_settings(&self) -> Result<AppSettings> {
        let settings = self
            .connection
            .query_row(
                "SELECT focus_to_sim_ratio, default_focus_minutes, default_break_minutes,
                        volume_percent, offline_progression_enabled, max_offline_hours, calm_mode,
                        notifications_enabled, sound_enabled, breaks_enabled, active_slot_id,
                        reduced_effects
                 FROM app_settings WHERE singleton = 1",
                [],
                |row| {
                    Ok(AppSettings {
                        focus_to_sim_ratio: row.get(0)?,
                        default_focus_minutes: row.get(1)?,
                        default_break_minutes: row.get(2)?,
                        volume_percent: row.get(3)?,
                        offline_progression_enabled: row.get::<_, i64>(4)? != 0,
                        max_offline_hours: row.get(5)?,
                        calm_mode: row.get::<_, i64>(6)? != 0,
                        notifications_enabled: row.get::<_, i64>(7)? != 0,
                        sound_enabled: row.get::<_, i64>(8)? != 0,
                        breaks_enabled: row.get::<_, i64>(9)? != 0,
                        active_slot_id: row.get(10)?,
                        reduced_effects: row.get::<_, i64>(11)? != 0,
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
               volume_percent, offline_progression_enabled, max_offline_hours, calm_mode,
               notifications_enabled, sound_enabled, breaks_enabled, active_slot_id, reduced_effects)
              VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(singleton) DO UPDATE SET
                 focus_to_sim_ratio = excluded.focus_to_sim_ratio,
                 default_focus_minutes = excluded.default_focus_minutes,
                 default_break_minutes = excluded.default_break_minutes,
                 volume_percent = excluded.volume_percent,
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

fn upsert_focus_session(
    transaction: &rusqlite::Transaction<'_>,
    session: &FocusSession,
) -> Result<()> {
    let event_ids = serde_json::to_string(&session.recap_event_ids)?;
    let entries = serde_json::to_string(&session.recap_entries)?;
    transaction.execute(
        "INSERT INTO focus_sessions
         (session_id, slot_id, started_at_ms, ended_at_ms, planned_focus_ms, focused_ms,
          planned_break_ms, break_ms, issued_simulation_ticks, status, state_json,
           recap_event_ids_json, recap_entries_json)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
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
              recap_entries_json = excluded.recap_entries_json",
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
        ],
    )?;
    Ok(())
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
    if session.recap_event_ids.is_empty() {
        return Ok(());
    }
    let source_events = world_events(snapshot)?;
    if session
        .recap_event_ids
        .iter()
        .any(|event_id| !source_events.contains_key(event_id))
    {
        return Err(PersistenceError::new(
            "focus recap references an event absent from its source save",
        ));
    }
    if session.recap_entries.iter().any(|entry| {
        source_events.get(&entry.id).is_none_or(|source| {
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

fn validate_snapshot(snapshot: &str) -> Result<()> {
    if snapshot.is_empty() || snapshot.len() > MAX_SNAPSHOT_BYTES {
        return Err(PersistenceError::new(format!(
            "snapshot must be nonempty and at most {MAX_SNAPSHOT_BYTES} bytes"
        )));
    }
    serde_json::from_str::<serde_json::Value>(snapshot)
        .map(|_| ())
        .map_err(|_| PersistenceError::new("snapshot must be valid JSON data"))
}

fn validate_settings(settings: &AppSettings) -> Result<()> {
    if !(1..=10_000).contains(&settings.focus_to_sim_ratio)
        || !(1..=1_440).contains(&settings.default_focus_minutes)
        || settings.default_break_minutes > 240
        || settings.volume_percent > 100
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
    validate_focus_state_summary(session)?;
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
    let state: serde_json::Value = serde_json::from_str(&session.state_json)?;
    let object = state
        .as_object()
        .ok_or_else(|| PersistenceError::new("focus state must be an object"))?;
    let phase = object
        .get("phase")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| PersistenceError::new("focus state phase is missing"))?;
    let expected_status = match phase {
        "focus-running" | "break-running" => FocusSessionStatus::Active,
        "focus-paused" | "break-paused" => FocusSessionStatus::Paused,
        "focus-completed" | "finished" => FocusSessionStatus::Completed,
        "focus-cancelled" => FocusSessionStatus::Cancelled,
        _ => {
            return Err(PersistenceError::new(
                "focus state phase is not persistable",
            ));
        }
    };
    let matches_summary = object.get("version").and_then(serde_json::Value::as_u64) == Some(1)
        && expected_status == session.status
        && json_i64(object, "startedAtEpochMs") == Some(session.started_at_ms)
        && json_nullable_i64(object, "endedAtEpochMs") == Some(session.ended_at_ms)
        && json_i64(object, "focusDurationMs") == Some(session.planned_focus_ms)
        && json_i64(object, "accumulatedFocusMs") == Some(session.focused_ms)
        && json_i64(object, "breakDurationMs") == Some(session.planned_break_ms)
        && json_i64(object, "accumulatedBreakMs") == Some(session.break_ms)
        && json_i64(object, "totalIssuedSimulationTicks") == Some(session.issued_simulation_ticks);
    if !matches_summary {
        return Err(PersistenceError::new(
            "focus session summary does not match its serialized focus state",
        ));
    }
    Ok(())
}

fn json_i64(object: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<i64> {
    object.get(key).and_then(serde_json::Value::as_i64)
}

fn json_nullable_i64(
    object: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Option<Option<i64>> {
    match object.get(key) {
        Some(serde_json::Value::Null) => Some(None),
        Some(value) => value.as_i64().map(Some),
        None => None,
    }
}

#[derive(Debug)]
struct SnapshotEventFact {
    tick: Option<u64>,
    summary: Option<String>,
}

fn world_events(snapshot: &str) -> Result<BTreeMap<u64, SnapshotEventFact>> {
    let envelope: serde_json::Value = serde_json::from_str(snapshot)?;
    let format_version = envelope
        .get("formatVersion")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| PersistenceError::new("source save has no format version"))?;
    let legacy_payload;
    let payload = if format_version == 0 {
        let world_json = envelope
            .get("worldJson")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| PersistenceError::new("legacy source save has no world payload"))?;
        legacy_payload = serde_json::from_str::<serde_json::Value>(world_json)?;
        &legacy_payload
    } else {
        envelope
            .get("payload")
            .ok_or_else(|| PersistenceError::new("source save has no world payload"))?
    };
    let events = payload
        .get("eventLog")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| PersistenceError::new("source save has no event log"))?;
    let mut events_by_id = BTreeMap::new();
    for event in events {
        let id = event
            .get("id")
            .and_then(serde_json::Value::as_u64)
            .filter(|id| *id > 0)
            .ok_or_else(|| PersistenceError::new("source save contains an invalid event ID"))?;
        if events_by_id
            .insert(
                id,
                SnapshotEventFact {
                    tick: event.get("tick").and_then(serde_json::Value::as_u64),
                    summary: event
                        .get("summary")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_owned),
                },
            )
            .is_some()
        {
            return Err(PersistenceError::new(
                "source save contains duplicate event IDs",
            ));
        }
    }
    Ok(events_by_id)
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
) -> std::result::Result<Option<Vec<LoadedSave>>, String> {
    state
        .lock()
        .and_then(|database| database.load_slot_candidates(&slot_id))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn commit_save_slot(
    state: State<'_, PersistenceState>,
    slot_id: String,
    name: String,
    snapshot: String,
) -> std::result::Result<LoadedSave, String> {
    state
        .lock()
        .and_then(|mut database| database.commit_slot(&slot_id, &name, &snapshot))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn commit_focus_checkpoint(
    state: State<'_, PersistenceState>,
    slot_id: String,
    name: String,
    snapshot: String,
    session: FocusSession,
) -> std::result::Result<LoadedSave, String> {
    state
        .lock()
        .and_then(|mut database| {
            database.commit_focus_checkpoint(&slot_id, &name, &snapshot, &session)
        })
        .map_err(|error| error.to_string())
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
) -> std::result::Result<Vec<FocusSession>, String> {
    state
        .lock()
        .and_then(|database| database.list_focus_sessions())
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

    fn snapshot(value: &str) -> String {
        format!(
            r#"{{"format":"chrono-forge-world","formatVersion":1,"payload":{{"eventLog":[{{"id":7,"tick":0,"summary":"Recorded factual event 7."}},{{"id":9,"tick":0,"summary":"Recorded factual event 9."}},{{"id":11,"tick":0,"summary":"Recorded factual event 11."}}],"test":"{value}"}}}}"#
        )
    }

    fn completed_focus_state_json() -> String {
        r#"{"version":1,"phase":"finished","focusDurationMs":100,"breakDurationMs":20,"accumulatedFocusMs":100,"accumulatedBreakMs":20,"totalIssuedSimulationTicks":1,"startedAtEpochMs":100,"endedAtEpochMs":220}"#.to_owned()
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
            database
                .commit_slot("alpha", "Alpha", &snapshot(value))
                .expect("commit");
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
            database
                .commit_slot("alpha", "Alpha", &snapshot(value))
                .expect("normal generation");
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
        database
            .commit_slot("alpha", "Alpha", &snapshot("five"))
            .expect("next generation");

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
        };
        database.record_focus_session(&session).expect("record");
        assert_eq!(database.list_focus_sessions().expect("list"), vec![session]);
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
        let invalid = AppSettings {
            volume_percent: 101,
            ..AppSettings::default()
        };
        assert!(database.save_settings(&invalid).is_err());
    }

    #[test]
    fn v3_to_v4_migration_preserves_legacy_recap_ids_without_inventing_entries() {
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
        database.migrate().expect("v4 migration");
        assert!(!database.load_settings().expect("settings").reduced_effects);
        assert_eq!(
            database.list_focus_sessions().expect("history")[0].recap_entries,
            Vec::<FocusRecapEntry>::new()
        );
    }

    #[test]
    fn v1_to_v4_migration_marks_existing_generations_and_defaults_new_fields() {
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
        assert_eq!(versions, vec![1, 2, 3, 4]);
    }
}
