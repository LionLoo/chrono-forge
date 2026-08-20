/**
 * Narrow persistence boundary for the UI. Native calls are validated before
 * their data is allowed into React state; the browser implementation is only a
 * deterministic preview/test substitute and is intentionally process-local.
 */

import { rehydrateFocusState, type FocusState } from '../focus';
import { deserializeWorldSnapshot } from '../simulation/persistence';

const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024;
const MAX_IMPORT_BYTES = MAX_SNAPSHOT_BYTES + 1024 * 1024;
const RETAINED_GENERATIONS = 3;
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export type FocusSessionStatus = 'active' | 'paused' | 'completed' | 'cancelled';

export interface SaveSlotSummary {
  readonly slotId: string;
  readonly name: string;
  readonly headGeneration: number | null;
}

export interface LoadedSave extends SaveSlotSummary {
  readonly recoveredGeneration: number;
  readonly recoveredFromCorruption: boolean;
  readonly snapshot: string;
  readonly checksum: string;
}

export interface FocusSession {
  readonly sessionId: string;
  readonly slotId: string | null;
  readonly startedAtMs: number;
  readonly endedAtMs: number | null;
  readonly plannedFocusMs: number;
  readonly focusedMs: number;
  readonly plannedBreakMs: number;
  readonly breakMs: number;
  readonly issuedSimulationTicks: number;
  readonly status: FocusSessionStatus;
  readonly stateJson: string;
  readonly recapEventIds: readonly number[];
}

export interface AppSettings {
  readonly focusToSimRatio: number;
  readonly defaultFocusMinutes: number;
  readonly defaultBreakMinutes: number;
  readonly volumePercent: number;
  readonly offlineProgressionEnabled: boolean;
  readonly maxOfflineHours: number;
  readonly calmMode: boolean;
  readonly notificationsEnabled: boolean;
  readonly soundEnabled: boolean;
  readonly breaksEnabled: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  focusToSimRatio: 10,
  defaultFocusMinutes: 25,
  defaultBreakMinutes: 5,
  volumePercent: 70,
  offlineProgressionEnabled: true,
  maxOfflineHours: 24,
  calmMode: false,
  notificationsEnabled: true,
  soundEnabled: true,
  breaksEnabled: false,
};

export interface PersistenceGateway {
  listSaveSlots(): Promise<readonly SaveSlotSummary[]>;
  loadSaveSlot(slotId: string): Promise<LoadedSave | null>;
  commitSaveSlot(slotId: string, name: string, snapshot: string): Promise<LoadedSave>;
  deleteSaveSlot(slotId: string): Promise<boolean>;
  exportSaveSlot(slotId: string): Promise<string>;
  importSaveSlot(savePackage: string): Promise<LoadedSave>;
  recordFocusSession(session: FocusSession, sourceEventIds: readonly number[]): Promise<void>;
  listFocusSessions(): Promise<readonly FocusSession[]>;
  loadSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
}

export type TauriInvoke = <Result>(
  command: string,
  arguments_?: Readonly<Record<string, unknown>>,
) => Promise<Result>;

async function loadNativeSemanticSave(
  invoke: TauriInvoke,
  slotId: string,
): Promise<LoadedSave | null> {
  const result = await invoke<unknown>('load_save_slot_candidates', { slotId });
  if (result === null) return null;
  if (!Array.isArray(result) || result.length === 0) {
    throw new TypeError('load_save_slot_candidates returned an invalid candidate list');
  }
  const failures: string[] = [];
  for (const candidate of result) {
    try {
      return parseLoadedSave(candidate);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : 'unknown validation error');
    }
  }
  throw new Error(`save slot has no semantically valid generation: ${failures.join('; ')}`);
}

/** Creates the production gateway without importing Tauri into browser builds. */
export function createTauriPersistenceGateway(invoke: TauriInvoke): PersistenceGateway {
  return {
    async listSaveSlots() {
      const result = await invoke<unknown>('list_save_slots');
      if (!Array.isArray(result)) {
        throw new TypeError('list_save_slots returned a non-array result');
      }
      return result.map(parseSaveSlotSummary);
    },
    async loadSaveSlot(slotId) {
      validateIdentifier(slotId, 'slot ID');
      return loadNativeSemanticSave(invoke, slotId);
    },
    async commitSaveSlot(slotId, name, snapshot) {
      validateCommit(slotId, name, snapshot);
      return parseLoadedSave(await invoke<unknown>('commit_save_slot', { slotId, name, snapshot }));
    },
    async deleteSaveSlot(slotId) {
      validateIdentifier(slotId, 'slot ID');
      const result = await invoke<unknown>('delete_save_slot', { slotId });
      if (typeof result !== 'boolean') {
        throw new TypeError('delete_save_slot returned a non-boolean result');
      }
      return result;
    },
    async exportSaveSlot(slotId) {
      validateIdentifier(slotId, 'slot ID');
      const loaded = await loadNativeSemanticSave(invoke, slotId);
      if (loaded === null) throw new Error('save slot does not exist');
      const result = await invoke<unknown>('export_save_generation', {
        slotId,
        generation: loaded.recoveredGeneration,
      });
      if (typeof result !== 'string') {
        throw new TypeError('export_save_generation returned a non-string result');
      }
      const exported = parseSaveExport(result);
      if (exported.snapshot !== loaded.snapshot || exported.checksum !== loaded.checksum) {
        throw new TypeError('exported save generation does not match the validated candidate');
      }
      return result;
    },
    async importSaveSlot(savePackage) {
      parseSaveExport(savePackage);
      return parseLoadedSave(await invoke<unknown>('import_save_slot', { package: savePackage }));
    },
    async recordFocusSession(session, sourceEventIds) {
      validateFocusSession(session);
      validateRecapReferences(session, sourceEventIds);
      const result = await invoke<unknown>('record_focus_session', { session });
      if (result !== null && result !== undefined) {
        throw new TypeError('record_focus_session returned an unexpected result');
      }
    },
    async listFocusSessions() {
      const result = await invoke<unknown>('list_focus_sessions');
      if (!Array.isArray(result)) {
        throw new TypeError('list_focus_sessions returned a non-array result');
      }
      return result.map(parseFocusSession);
    },
    async loadSettings() {
      return parseAppSettings(await invoke<unknown>('load_settings'));
    },
    async saveSettings(settings) {
      validateAppSettings(settings);
      return parseAppSettings(await invoke<unknown>('save_settings', { settings }));
    },
  };
}

interface InMemoryGeneration {
  readonly generation: number;
  readonly snapshot: string;
  readonly checksum: string;
}

interface InMemorySlot {
  readonly slotId: string;
  name: string;
  headGeneration: number;
  readonly generations: InMemoryGeneration[];
}

/**
 * Process-local deterministic substitute for browser previews and tests. It is
 * deliberately not durable storage and must never be presented as a native save.
 */
export function createInMemoryPersistenceGateway(): PersistenceGateway {
  const slots = new Map<string, InMemorySlot>();
  const sessions = new Map<string, FocusSession>();
  let settings = { ...DEFAULT_APP_SETTINGS };

  const load = (slotId: string): LoadedSave | null => {
    validateIdentifier(slotId, 'slot ID');
    const slot = slots.get(slotId);
    if (slot === undefined) {
      return null;
    }
    const generation = slot.generations.find(
      (candidate) => candidate.generation === slot.headGeneration,
    );
    if (generation?.checksum !== sha256Hex(generation?.snapshot ?? '')) {
      throw new Error('in-memory save slot has no verified head generation');
    }
    return {
      slotId: slot.slotId,
      name: slot.name,
      headGeneration: slot.headGeneration,
      recoveredGeneration: generation.generation,
      recoveredFromCorruption: false,
      snapshot: generation.snapshot,
      checksum: generation.checksum,
    };
  };

  const commit = (slotId: string, name: string, snapshot: string): LoadedSave => {
    validateCommit(slotId, name, snapshot);
    const existing = slots.get(slotId);
    const previousGeneration = existing?.generations.at(-1)?.generation ?? 0;
    const generation = previousGeneration + 1;
    const next: InMemoryGeneration = {
      generation,
      snapshot,
      checksum: sha256Hex(snapshot),
    };
    const slot: InMemorySlot = existing ?? {
      slotId,
      name,
      headGeneration: generation,
      generations: [],
    };
    slot.name = name;
    slot.generations.push(next);
    while (slot.generations.length > RETAINED_GENERATIONS) {
      slot.generations.shift();
    }
    slot.headGeneration = generation;
    slots.set(slotId, slot);
    return load(slotId) ?? fail('committed in-memory slot was not readable');
  };

  return {
    async listSaveSlots() {
      await Promise.resolve();
      return [...slots.values()]
        .sort((left, right) => compareStableText(left.slotId, right.slotId))
        .map((slot) => ({
          slotId: slot.slotId,
          name: slot.name,
          headGeneration: slot.headGeneration,
        }));
    },
    async loadSaveSlot(slotId) {
      await Promise.resolve();
      return load(slotId);
    },
    async commitSaveSlot(slotId, name, snapshot) {
      await Promise.resolve();
      return commit(slotId, name, snapshot);
    },
    async deleteSaveSlot(slotId) {
      await Promise.resolve();
      validateIdentifier(slotId, 'slot ID');
      const deleted = slots.delete(slotId);
      if (deleted) {
        for (const [sessionId, session] of sessions) {
          if (session.slotId === slotId) {
            sessions.set(sessionId, { ...session, slotId: null });
          }
        }
      }
      return deleted;
    },
    async exportSaveSlot(slotId) {
      await Promise.resolve();
      const loaded = load(slotId);
      if (loaded === null) {
        throw new Error('save slot does not exist');
      }
      return JSON.stringify({
        format: 'chrono-forge-save-export',
        version: 1,
        slotId: loaded.slotId,
        name: loaded.name,
        snapshot: loaded.snapshot,
        checksum: loaded.checksum,
      });
    },
    async importSaveSlot(savePackage) {
      await Promise.resolve();
      const exported = parseSaveExport(savePackage);
      return commit(exported.slotId, exported.name, exported.snapshot);
    },
    async recordFocusSession(session, sourceEventIds) {
      await Promise.resolve();
      validateFocusSession(session);
      validateRecapReferences(session, sourceEventIds);
      if (session.slotId !== null && !slots.has(session.slotId)) {
        throw new Error('focus session references a save slot that does not exist');
      }
      if (session.slotId !== null) {
        const sourceSave = load(session.slotId);
        const savedEventIds = new Set(
          sourceSave === null
            ? []
            : deserializeWorldSnapshot(sourceSave.snapshot).eventLog.map((event) => event.id),
        );
        if (session.recapEventIds.some((eventId) => !savedEventIds.has(eventId))) {
          throw new Error('focus recap references an event absent from its source save');
        }
      }
      sessions.set(session.sessionId, cloneFocusSession(session));
    },
    async listFocusSessions() {
      await Promise.resolve();
      return [...sessions.values()]
        .sort(
          (left, right) =>
            right.startedAtMs - left.startedAtMs ||
            compareStableText(left.sessionId, right.sessionId),
        )
        .map(cloneFocusSession);
    },
    async loadSettings() {
      await Promise.resolve();
      return { ...settings };
    },
    async saveSettings(nextSettings) {
      await Promise.resolve();
      validateAppSettings(nextSettings);
      settings = { ...nextSettings };
      return { ...settings };
    },
  };
}

function parseSaveSlotSummary(value: unknown): SaveSlotSummary {
  const record = expectRecord(value, 'save slot');
  expectExactKeys(record, ['slotId', 'name', 'headGeneration'], 'save slot');
  const slotId = expectString(record.slotId, 'save slot slotId');
  const name = expectString(record.name, 'save slot name');
  const headGeneration = expectNullablePositiveInteger(
    record.headGeneration,
    'save slot headGeneration',
  );
  validateIdentifier(slotId, 'slot ID');
  validateName(name);
  return { slotId, name, headGeneration };
}

function parseLoadedSave(value: unknown): LoadedSave {
  const record = expectRecord(value, 'loaded save');
  expectExactKeys(
    record,
    [
      'slotId',
      'name',
      'headGeneration',
      'recoveredGeneration',
      'recoveredFromCorruption',
      'snapshot',
      'checksum',
    ],
    'loaded save',
  );
  const summary = parseSaveSlotSummary({
    slotId: record.slotId,
    name: record.name,
    headGeneration: record.headGeneration,
  });
  const recoveredGeneration = expectPositiveInteger(
    record.recoveredGeneration,
    'recoveredGeneration',
  );
  const recoveredFromCorruption = expectBoolean(
    record.recoveredFromCorruption,
    'recoveredFromCorruption',
  );
  const snapshot = expectString(record.snapshot, 'snapshot');
  const checksum = expectString(record.checksum, 'checksum');
  validateSnapshot(snapshot);
  validateChecksum(checksum, snapshot);
  return { ...summary, recoveredGeneration, recoveredFromCorruption, snapshot, checksum };
}

function parseFocusSession(value: unknown): FocusSession {
  const record = expectRecord(value, 'focus session');
  expectExactKeys(
    record,
    [
      'sessionId',
      'slotId',
      'startedAtMs',
      'endedAtMs',
      'plannedFocusMs',
      'focusedMs',
      'plannedBreakMs',
      'breakMs',
      'issuedSimulationTicks',
      'status',
      'stateJson',
      'recapEventIds',
    ],
    'focus session',
  );
  const session: FocusSession = {
    sessionId: expectString(record.sessionId, 'focus session sessionId'),
    slotId: expectNullableString(record.slotId, 'focus session slotId'),
    startedAtMs: expectNonNegativeInteger(record.startedAtMs, 'focus session startedAtMs'),
    endedAtMs: expectNullableNonNegativeInteger(record.endedAtMs, 'focus session endedAtMs'),
    plannedFocusMs: expectPositiveInteger(record.plannedFocusMs, 'focus session plannedFocusMs'),
    focusedMs: expectNonNegativeInteger(record.focusedMs, 'focus session focusedMs'),
    plannedBreakMs: expectNonNegativeInteger(record.plannedBreakMs, 'focus session plannedBreakMs'),
    breakMs: expectNonNegativeInteger(record.breakMs, 'focus session breakMs'),
    issuedSimulationTicks: expectNonNegativeInteger(
      record.issuedSimulationTicks,
      'focus session issuedSimulationTicks',
    ),
    status: expectFocusStatus(record.status),
    stateJson: expectString(record.stateJson, 'focus session stateJson'),
    recapEventIds: expectNonNegativeIntegerArray(
      record.recapEventIds,
      'focus session recapEventIds',
    ),
  };
  validateFocusSession(session);
  return session;
}

function parseAppSettings(value: unknown): AppSettings {
  const record = expectRecord(value, 'settings');
  expectExactKeys(record, Object.keys(DEFAULT_APP_SETTINGS), 'settings');
  const settings: AppSettings = {
    focusToSimRatio: expectPositiveInteger(record.focusToSimRatio, 'focusToSimRatio'),
    defaultFocusMinutes: expectPositiveInteger(record.defaultFocusMinutes, 'defaultFocusMinutes'),
    defaultBreakMinutes: expectNonNegativeInteger(
      record.defaultBreakMinutes,
      'defaultBreakMinutes',
    ),
    volumePercent: expectNonNegativeInteger(record.volumePercent, 'volumePercent'),
    offlineProgressionEnabled: expectBoolean(
      record.offlineProgressionEnabled,
      'offlineProgressionEnabled',
    ),
    maxOfflineHours: expectNonNegativeInteger(record.maxOfflineHours, 'maxOfflineHours'),
    calmMode: expectBoolean(record.calmMode, 'calmMode'),
    notificationsEnabled: expectBoolean(record.notificationsEnabled, 'notificationsEnabled'),
    soundEnabled: expectBoolean(record.soundEnabled, 'soundEnabled'),
    breaksEnabled: expectBoolean(record.breaksEnabled, 'breaksEnabled'),
  };
  validateAppSettings(settings);
  return settings;
}

interface SaveExport {
  readonly slotId: string;
  readonly name: string;
  readonly snapshot: string;
  readonly checksum: string;
}

function parseSaveExport(savePackage: string): SaveExport {
  if (byteLength(savePackage) > MAX_IMPORT_BYTES) {
    throw new RangeError('import package exceeds the size limit');
  }
  let value: unknown;
  try {
    value = JSON.parse(savePackage) as unknown;
  } catch {
    throw new TypeError('save import must be valid JSON');
  }
  const record = expectRecord(value, 'save export');
  expectExactKeys(
    record,
    ['format', 'version', 'slotId', 'name', 'snapshot', 'checksum'],
    'save export',
  );
  if (record.format !== 'chrono-forge-save-export' || record.version !== 1) {
    throw new TypeError('unsupported save import format or version');
  }
  const exported: SaveExport = {
    slotId: expectString(record.slotId, 'save export slotId'),
    name: expectString(record.name, 'save export name'),
    snapshot: expectString(record.snapshot, 'save export snapshot'),
    checksum: expectString(record.checksum, 'save export checksum'),
  };
  validateCommit(exported.slotId, exported.name, exported.snapshot);
  validateChecksum(exported.checksum, exported.snapshot);
  return exported;
}

function validateCommit(slotId: string, name: string, snapshot: string): void {
  validateIdentifier(slotId, 'slot ID');
  validateName(name);
  validateSnapshot(snapshot);
}

function validateIdentifier(value: string, label: string): void {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new RangeError(`${label} must be 1-64 ASCII letters, digits, '.', '_' or '-'`);
  }
}

function validateName(value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || byteLength(value) > 120) {
    throw new RangeError('save name must be nonempty and at most 120 bytes');
  }
}

function validateSnapshot(value: string): void {
  if (typeof value !== 'string' || value.length === 0 || byteLength(value) > MAX_SNAPSHOT_BYTES) {
    throw new RangeError('snapshot must be nonempty and at most 50 MiB');
  }
  deserializeWorldSnapshot(value);
}

function validateChecksum(checksum: string, snapshot: string): void {
  if (!CHECKSUM_PATTERN.test(checksum) || checksum !== sha256Hex(snapshot)) {
    throw new TypeError('save checksum does not match its snapshot');
  }
}

function validateFocusSession(session: FocusSession): void {
  validateIdentifier(session.sessionId, 'focus session ID');
  if (session.slotId !== null) {
    validateIdentifier(session.slotId, 'save slot ID');
  }
  if (
    session.status !== 'active' &&
    session.status !== 'paused' &&
    session.status !== 'completed' &&
    session.status !== 'cancelled'
  ) {
    throw new TypeError('focus session status is invalid');
  }
  const terminal = session.status === 'completed' || session.status === 'cancelled';
  const focusState = validateFocusStateJson(session.stateJson);
  if (
    !Number.isSafeInteger(session.startedAtMs) ||
    session.startedAtMs < 0 ||
    (session.endedAtMs !== null && !Number.isSafeInteger(session.endedAtMs)) ||
    (session.endedAtMs !== null && session.endedAtMs < session.startedAtMs) ||
    terminal !== (session.endedAtMs !== null) ||
    !Number.isSafeInteger(session.plannedFocusMs) ||
    session.plannedFocusMs <= 0 ||
    !Number.isSafeInteger(session.focusedMs) ||
    session.focusedMs < 0 ||
    session.focusedMs > session.plannedFocusMs ||
    !Number.isSafeInteger(session.plannedBreakMs) ||
    session.plannedBreakMs < 0 ||
    !Number.isSafeInteger(session.breakMs) ||
    session.breakMs < 0 ||
    session.breakMs > session.plannedBreakMs ||
    !Number.isSafeInteger(session.issuedSimulationTicks) ||
    session.issuedSimulationTicks < 0 ||
    session.recapEventIds.length > 10_000 ||
    session.recapEventIds.some((eventId) => !Number.isSafeInteger(eventId) || eventId <= 0) ||
    session.recapEventIds.some(
      (eventId, index) => index > 0 && eventId <= session.recapEventIds[index - 1]!,
    )
  ) {
    throw new RangeError('focus session times, progress, status, or recap event IDs are invalid');
  }
  validateFocusStateMatchesSession(session, focusState);
}

function validateFocusStateJson(stateJson: string): FocusState {
  if (
    typeof stateJson !== 'string' ||
    stateJson.length === 0 ||
    byteLength(stateJson) > 64 * 1024
  ) {
    throw new RangeError('focus state must be nonempty and at most 64 KiB');
  }
  let value: unknown;
  try {
    value = JSON.parse(stateJson) as unknown;
  } catch {
    throw new TypeError('focus state must be valid JSON data');
  }
  const state = rehydrateFocusState(value);
  if (JSON.stringify(state) !== stateJson) {
    throw new TypeError('focus state must use canonical JSON serialization');
  }
  return state;
}

function validateFocusStateMatchesSession(session: FocusSession, state: FocusState): void {
  const expectedStatus: FocusSessionStatus =
    state.phase === 'focus-running' || state.phase === 'break-running'
      ? 'active'
      : state.phase === 'focus-paused' || state.phase === 'break-paused'
        ? 'paused'
        : state.phase === 'focus-cancelled'
          ? 'cancelled'
          : state.phase === 'focus-completed' || state.phase === 'finished'
            ? 'completed'
            : fail('idle focus state cannot be persisted as a session');
  if (
    session.status !== expectedStatus ||
    session.startedAtMs !== state.startedAtEpochMs ||
    session.endedAtMs !== state.endedAtEpochMs ||
    session.plannedFocusMs !== state.focusDurationMs ||
    session.focusedMs !== state.accumulatedFocusMs ||
    session.plannedBreakMs !== state.breakDurationMs ||
    session.breakMs !== state.accumulatedBreakMs ||
    session.issuedSimulationTicks !== state.totalIssuedSimulationTicks
  ) {
    throw new TypeError('focus session summary does not match its canonical focus state');
  }
}

function validateRecapReferences(session: FocusSession, sourceEventIds: readonly number[]): void {
  const source = new Set<number>();
  for (const eventId of sourceEventIds) {
    if (!Number.isSafeInteger(eventId) || eventId <= 0 || source.has(eventId)) {
      throw new TypeError('source world event IDs must be unique positive safe integers');
    }
    source.add(eventId);
  }
  if (session.recapEventIds.some((eventId) => !source.has(eventId))) {
    throw new TypeError('focus recap references an event absent from the authoritative world');
  }
}

function validateAppSettings(settings: AppSettings): void {
  if (
    !Number.isSafeInteger(settings.focusToSimRatio) ||
    settings.focusToSimRatio < 1 ||
    settings.focusToSimRatio > 10_000 ||
    !Number.isSafeInteger(settings.defaultFocusMinutes) ||
    settings.defaultFocusMinutes < 1 ||
    settings.defaultFocusMinutes > 1_440 ||
    !Number.isSafeInteger(settings.defaultBreakMinutes) ||
    settings.defaultBreakMinutes < 0 ||
    settings.defaultBreakMinutes > 240 ||
    !Number.isSafeInteger(settings.volumePercent) ||
    settings.volumePercent < 0 ||
    settings.volumePercent > 100 ||
    !Number.isSafeInteger(settings.maxOfflineHours) ||
    settings.maxOfflineHours < 0 ||
    settings.maxOfflineHours > 168
  ) {
    throw new RangeError('settings contain a value outside its supported range');
  }
}

function cloneFocusSession(session: FocusSession): FocusSession {
  return { ...session, recapEventIds: [...session.recapEventIds] };
}

function expectRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function expectExactKeys(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  label: string,
): void {
  const actualKeys = Object.keys(record);
  if (actualKeys.length !== keys.length || actualKeys.some((key) => !keys.includes(key))) {
    throw new TypeError(`${label} has unexpected or missing fields`);
  }
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} must be a string`);
  }
  return value;
}

function expectNullableString(value: unknown, label: string): string | null {
  return value === null ? null : expectString(value, label);
}

function expectBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${label} must be a boolean`);
  }
  return value;
}

function expectInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be a safe integer`);
  }
  return value;
}

function expectNonNegativeInteger(value: unknown, label: string): number {
  const integer = expectInteger(value, label);
  if (integer < 0) {
    throw new RangeError(`${label} must not be negative`);
  }
  return integer;
}

function expectPositiveInteger(value: unknown, label: string): number {
  const integer = expectNonNegativeInteger(value, label);
  if (integer === 0) {
    throw new RangeError(`${label} must be positive`);
  }
  return integer;
}

function expectNullableNonNegativeInteger(value: unknown, label: string): number | null {
  return value === null ? null : expectNonNegativeInteger(value, label);
}

function expectNullablePositiveInteger(value: unknown, label: string): number | null {
  return value === null ? null : expectPositiveInteger(value, label);
}

function expectNonNegativeIntegerArray(value: unknown, label: string): readonly number[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  return value.map((item) => expectNonNegativeInteger(item, label));
}

function expectFocusStatus(value: unknown): FocusSessionStatus {
  if (value === 'active' || value === 'paused' || value === 'completed' || value === 'cancelled') {
    return value;
  }
  throw new TypeError('focus session status is invalid');
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function compareStableText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(message: string): never {
  throw new Error(message);
}

/** Small synchronous SHA-256 implementation for deterministic browser previews. */
function sha256Hex(value: string): string {
  const source = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64;
  const data = new Uint8Array(paddedLength);
  data.set(source);
  data[source.length] = 0x80;
  const bitLength = source.length * 8;
  const view = new DataView(data.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const left = schedule[index - 15]!;
      const right = schedule[index - 2]!;
      schedule[index] =
        (smallSigma0(left) + schedule[index - 7]! + smallSigma1(right) + schedule[index - 16]!) >>>
        0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const first =
        (h! + bigSigma1(e!) + choose(e!, f!, g!) + constants[index]! + schedule[index]!) >>> 0;
      const second = (bigSigma0(a!) + majority(a!, b!, c!)) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d! + first) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (first + second) >>> 0;
    }
    hash[0] = (hash[0]! + a!) >>> 0;
    hash[1] = (hash[1]! + b!) >>> 0;
    hash[2] = (hash[2]! + c!) >>> 0;
    hash[3] = (hash[3]! + d!) >>> 0;
    hash[4] = (hash[4]! + e!) >>> 0;
    hash[5] = (hash[5]! + f!) >>> 0;
    hash[6] = (hash[6]! + g!) >>> 0;
    hash[7] = (hash[7]! + h!) >>> 0;
  }
  return hash.map((word) => word.toString(16).padStart(8, '0')).join('');
}

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

function choose(first: number, second: number, third: number): number {
  return (first & second) ^ (~first & third);
}

function majority(first: number, second: number, third: number): number {
  return (first & second) ^ (first & third) ^ (second & third);
}

function bigSigma0(value: number): number {
  return rotateRight(value, 2) ^ rotateRight(value, 13) ^ rotateRight(value, 22);
}

function bigSigma1(value: number): number {
  return rotateRight(value, 6) ^ rotateRight(value, 11) ^ rotateRight(value, 25);
}

function smallSigma0(value: number): number {
  return rotateRight(value, 7) ^ rotateRight(value, 18) ^ (value >>> 3);
}

function smallSigma1(value: number): number {
  return rotateRight(value, 17) ^ rotateRight(value, 19) ^ (value >>> 10);
}
