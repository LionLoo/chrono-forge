import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  AppSettings,
  FocusRecapEntry,
  FocusSession,
  LoadedSave,
  SaveSlotSummary,
} from '../adapters/persistence';
import type { FocusAlerts } from '../adapters/focus-alerts';
import { type RuntimePersistence } from '../adapters/runtime-persistence';
import { rehydrateFocusState } from '../focus';
import type { WorkerEvent } from '../protocol';
import { deserializeWorldSnapshot } from '../simulation/persistence';
import { systemFocusClock, useFocusController, type FocusClock } from './useFocusController';
import type { WorldSimulationView } from './useWorldSimulation';

const PRIMARY_SLOT_ID = 'primary';
const PRIMARY_SLOT_NAME = 'Founding world';
const AUTOSAVE_INTERVAL_MS = 30_000;
const MAX_FACTUAL_RECAP_EVENTS = 12;
const MAX_OFFLINE_CATCH_UP_RATE = 1_000;

interface FocusPersistencePanelProps {
  readonly alerts: FocusAlerts;
  readonly clock?: FocusClock;
  readonly onReducedEffectsChange?: (reduced: boolean) => void;
  readonly runtime: RuntimePersistence;
  readonly simulation: WorldSimulationView;
}

interface WorkspaceData {
  readonly activeSave: LoadedSave;
  readonly history: readonly FocusSession[];
  readonly initialSession: FocusSession | null;
  readonly offlineCatchUpApplied: boolean;
  /** Latest event in the exact generation that restored the focus session. */
  readonly recapBaselineEventId: number;
  readonly settings: AppSettings;
  readonly slots: readonly SaveSlotSummary[];
}

function freshRecoverySlot(slots: readonly SaveSlotSummary[]): {
  readonly slotId: string;
  readonly name: string;
} {
  const existingIds = new Set(slots.map((slot) => slot.slotId));
  for (let index = 1; ; index += 1) {
    const slotId = `fresh-world-${index}`;
    if (!existingIds.has(slotId)) return { slotId, name: `Fresh world ${index}` };
  }
}

function selectRestorableSession(save: LoadedSave): FocusSession | null {
  const session = save.focusSession;
  if (
    session?.slotId !== save.slotId ||
    (session.status !== 'active' && session.status !== 'paused')
  ) {
    return null;
  }
  return session;
}

function restoresRunningFocus(session: FocusSession | null): boolean {
  return (
    session !== null &&
    rehydrateFocusState(JSON.parse(session.stateJson) as unknown).phase === 'focus-running'
  );
}

async function loadWorkspace(
  clock: FocusClock,
  runtime: RuntimePersistence,
  simulation: Pick<
    WorldSimulationView,
    'events' | 'loadSnapshot' | 'performOfflineCatchUp' | 'requestSave'
  >,
): Promise<WorkspaceData> {
  const [loadedSettings, listedSlots, history] = await Promise.all([
    runtime.gateway.loadSettings(),
    runtime.gateway.listSaveSlots(),
    runtime.gateway.listFocusSessions(),
  ]);
  let settings = loadedSettings;
  let slots = listedSlots;
  let activeSave: LoadedSave;
  let offlineCatchUpApplied = false;
  if (slots.length === 0) {
    const snapshot = await simulation.requestSave();
    activeSave = await runtime.gateway.commitSaveSlot(PRIMARY_SLOT_ID, PRIMARY_SLOT_NAME, snapshot);
    settings = await runtime.gateway.saveSettings({ ...settings, activeSlotId: PRIMARY_SLOT_ID });
    slots = await runtime.gateway.listSaveSlots();
  } else {
    const selected =
      (settings.activeSlotId === null
        ? undefined
        : slots.find((slot) => slot.slotId === settings.activeSlotId)) ??
      slots.find((slot) => slot.slotId === PRIMARY_SLOT_ID) ??
      slots[0];
    if (selected === undefined) throw new Error('No readable save slot is available.');
    const loaded = await runtime.gateway.loadSaveSlot(selected.slotId);
    if (loaded === null) throw new Error('The selected save slot has no valid generation.');
    activeSave = loaded;
    await simulation.loadSnapshot(loaded.snapshot);
    if (settings.activeSlotId !== loaded.slotId) {
      settings = await runtime.gateway.saveSettings({ ...settings, activeSlotId: loaded.slotId });
    }
    const initialSession = selectRestorableSession(loaded);
    if (
      settings.offlineProgressionEnabled &&
      loaded.savedAtMs > 0 &&
      !restoresRunningFocus(initialSession)
    ) {
      const elapsedMilliseconds = boundedOfflineElapsedMilliseconds(
        loaded.savedAtMs,
        clock.now(),
        settings.maxOfflineHours,
      );
      if (elapsedMilliseconds > 0) {
        await simulation.performOfflineCatchUp(
          elapsedMilliseconds,
          Math.min(settings.focusToSimRatio, MAX_OFFLINE_CATCH_UP_RATE),
        );
        const snapshot = await simulation.requestSave();
        activeSave =
          initialSession === null
            ? await runtime.gateway.commitSaveSlot(loaded.slotId, loaded.name, snapshot)
            : await runtime.gateway.commitFocusCheckpoint(
                loaded.slotId,
                loaded.name,
                snapshot,
                initialSession,
                simulation.events.map((event) => event.id),
              );
        slots = await runtime.gateway.listSaveSlots();
        offlineCatchUpApplied = true;
      }
    }
  }
  return {
    activeSave,
    history,
    initialSession: selectRestorableSession(activeSave),
    offlineCatchUpApplied,
    recapBaselineEventId: deserializeWorldSnapshot(activeSave.snapshot).eventLog.at(-1)?.id ?? 0,
    settings,
    slots,
  };
}

function boundedOfflineElapsedMilliseconds(
  savedAtMs: number,
  currentAtMs: number,
  maxOfflineHours: number,
): number {
  if (
    !Number.isSafeInteger(savedAtMs) ||
    savedAtMs <= 0 ||
    !Number.isSafeInteger(currentAtMs) ||
    currentAtMs < 0 ||
    !Number.isSafeInteger(maxOfflineHours) ||
    maxOfflineHours < 0
  ) {
    return 0;
  }
  const maximumElapsedMilliseconds = maxOfflineHours * 60 * 60 * 1_000;
  if (currentAtMs <= savedAtMs) return 0;
  if (savedAtMs <= currentAtMs - maximumElapsedMilliseconds) {
    return maximumElapsedMilliseconds;
  }
  return currentAtMs - savedAtMs;
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function recapEntry(event: WorkerEvent): FocusRecapEntry {
  return { id: event.id, tick: event.tick, summary: event.summary };
}

function isTerminalSession(session: FocusSession): boolean {
  return session.status === 'completed' || session.status === 'cancelled';
}

function focusHasEnded(session: FocusSession): boolean {
  return rehydrateFocusState(JSON.parse(session.stateJson) as unknown).focusEndedAtEpochMs !== null;
}

export function FocusPersistencePanel({
  alerts,
  clock = systemFocusClock,
  onReducedEffectsChange,
  runtime,
  simulation,
}: FocusPersistencePanelProps) {
  const bootstrapPromiseRef = useRef<Promise<WorkspaceData> | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveringFreshWorld, setRecoveringFreshWorld] = useState(false);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);

  useEffect(() => {
    if (simulation.status !== 'ready') return;
    let subscribed = true;
    bootstrapPromiseRef.current ??= loadWorkspace(clock, runtime, {
      events: simulation.events,
      loadSnapshot: simulation.loadSnapshot,
      performOfflineCatchUp: simulation.performOfflineCatchUp,
      requestSave: simulation.requestSave,
    });
    void bootstrapPromiseRef.current.then(
      (loaded) => {
        if (subscribed) setWorkspace((current) => current ?? loaded);
      },
      (error: unknown) => {
        if (subscribed) {
          setBootstrapError(
            error instanceof Error ? error.message : 'The local save store could not be opened.',
          );
        }
      },
    );
    return () => {
      subscribed = false;
    };
  }, [
    clock,
    runtime,
    simulation,
    simulation.events,
    simulation.loadSnapshot,
    simulation.performOfflineCatchUp,
    simulation.requestSave,
    simulation.status,
  ]);

  const replaceWorkspace = useCallback((next: WorkspaceData) => {
    setWorkspace(next);
    setWorkspaceRevision((current) => current + 1);
  }, []);

  const startFreshWorld = useCallback(async () => {
    setRecoveringFreshWorld(true);
    setRecoveryError(null);
    try {
      const [settings, slots] = await Promise.all([
        runtime.gateway.loadSettings(),
        runtime.gateway.listSaveSlots(),
      ]);
      const recoverySlot = freshRecoverySlot(slots);
      const snapshot = await simulation.requestSave();
      await runtime.gateway.commitSaveSlot(recoverySlot.slotId, recoverySlot.name, snapshot);
      await runtime.gateway.saveSettings({ ...settings, activeSlotId: recoverySlot.slotId });
      const recoveredWorkspace = await loadWorkspace(clock, runtime, {
        events: simulation.events,
        loadSnapshot: simulation.loadSnapshot,
        performOfflineCatchUp: simulation.performOfflineCatchUp,
        requestSave: simulation.requestSave,
      });
      bootstrapPromiseRef.current = Promise.resolve(recoveredWorkspace);
      setWorkspace(recoveredWorkspace);
      setBootstrapError(null);
      setWorkspaceRevision((current) => current + 1);
    } catch (error) {
      setRecoveryError(
        error instanceof Error ? error.message : 'A fresh local world could not be created.',
      );
    } finally {
      setRecoveringFreshWorld(false);
    }
  }, [
    clock,
    runtime,
    simulation.events,
    simulation.loadSnapshot,
    simulation.performOfflineCatchUp,
    simulation.requestSave,
  ]);

  if (bootstrapError !== null) {
    return (
      <section className="focus-card focus-card-error" aria-labelledby="focus-title">
        <h2 id="focus-title">Focus and local saves</h2>
        <p role="alert">Persistence fault: {bootstrapError}</p>
        <p>
          The affected slot is retained. You can start a separate fresh world while it is repaired.
        </p>
        <button
          disabled={recoveringFreshWorld}
          onClick={() => void startFreshWorld()}
          type="button"
        >
          {recoveringFreshWorld ? 'Creating fresh world…' : 'Start a fresh world'}
        </button>
        {recoveryError === null ? null : <p role="alert">Fresh-world fault: {recoveryError}</p>}
      </section>
    );
  }
  if (workspace === null) {
    return (
      <section className="focus-card" aria-labelledby="focus-title" aria-busy="true">
        <h2 id="focus-title">Focus and local saves</h2>
        <p role="status">Opening the local world archive…</p>
      </section>
    );
  }

  return (
    <FocusWorkspace
      alerts={alerts}
      clock={clock}
      initial={workspace}
      key={`${workspace.activeSave.slotId}-${workspaceRevision}`}
      onReplaceWorkspace={replaceWorkspace}
      runtime={runtime}
      simulation={simulation}
      {...(onReducedEffectsChange === undefined ? {} : { onReducedEffectsChange })}
    />
  );
}

interface FocusWorkspaceProps {
  readonly alerts: FocusAlerts;
  readonly clock: FocusClock;
  readonly initial: WorkspaceData;
  readonly onReducedEffectsChange?: (reduced: boolean) => void;
  readonly onReplaceWorkspace: (workspace: WorkspaceData) => void;
  readonly runtime: RuntimePersistence;
  readonly simulation: WorldSimulationView;
}

function FocusWorkspace({
  alerts,
  clock,
  initial,
  onReducedEffectsChange,
  onReplaceWorkspace,
  runtime,
  simulation,
}: FocusWorkspaceProps) {
  const [activeSave, setActiveSave] = useState(initial.activeSave);
  const [slots, setSlots] = useState(initial.slots);
  const [history, setHistory] = useState(initial.history);
  const [settings, setSettings] = useState(initial.settings);
  const [focusMinutesInput, setFocusMinutesInput] = useState(
    initial.settings.defaultFocusMinutes.toString(),
  );
  const [breakMinutesInput, setBreakMinutesInput] = useState(
    initial.settings.defaultBreakMinutes.toString(),
  );
  const [slotIdDraft, setSlotIdDraft] = useState('world-2');
  const [slotNameDraft, setSlotNameDraft] = useState('Second world');
  const [exportPackage, setExportPackage] = useState('');
  const [importPackage, setImportPackage] = useState('');
  const [notice, setNotice] = useState(
    initial.offlineCatchUpApplied
      ? 'Applied bounded offline progression.'
      : initial.activeSave.recoveredFromCorruption
        ? `Recovered generation ${initial.activeSave.recoveredGeneration} after rejecting a newer save.`
        : `Loaded ${initial.activeSave.name}.`,
  );
  const [operationError, setOperationError] = useState<string | null>(null);
  const operationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const activeSaveRef = useRef(activeSave);
  const latestSessionRef = useRef<FocusSession | null>(initial.initialSession);
  const recapSessionIdRef = useRef(initial.initialSession?.sessionId ?? null);
  const recapBaselineEventIdRef = useRef<number | null>(
    initial.initialSession === null ? null : initial.recapBaselineEventId,
  );
  const recapEventIdsRef = useRef<readonly number[]>(initial.initialSession?.recapEventIds ?? []);
  const recapEntriesRef = useRef<readonly FocusRecapEntry[]>(
    initial.initialSession?.recapEntries ?? [],
  );
  const autosaveTimerRef = useRef<number | null>(null);
  const alertedSessionIdsRef = useRef(
    new Set(
      initial.initialSession !== null && focusHasEnded(initial.initialSession)
        ? [initial.initialSession.sessionId]
        : [],
    ),
  );

  const enqueue = useCallback(<Result,>(operation: () => Promise<Result>): Promise<Result> => {
    const result = operationQueueRef.current.then(operation, operation);
    operationQueueRef.current = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }, []);

  const updateArchiveState = useCallback(
    async (loadedSave?: LoadedSave): Promise<void> => {
      const [nextSlots, nextHistory] = await Promise.all([
        runtime.gateway.listSaveSlots(),
        runtime.gateway.listFocusSessions(),
      ]);
      setSlots(nextSlots);
      setHistory(nextHistory);
      if (loadedSave !== undefined) {
        activeSaveRef.current = loadedSave;
        setActiveSave(loadedSave);
      }
    },
    [runtime.gateway],
  );

  const persistSession = useCallback(
    (session: FocusSession, reason: string): Promise<void> =>
      enqueue(async () => {
        try {
          const visibleEventsById = new Map(simulation.events.map((event) => [event.id, event]));
          const visibleEventIds = [...visibleEventsById.keys()];
          const latestEventId = visibleEventIds.at(-1) ?? 0;
          if (recapSessionIdRef.current !== session.sessionId) {
            recapSessionIdRef.current = session.sessionId;
            recapBaselineEventIdRef.current = latestEventId;
            recapEventIdsRef.current = [];
            recapEntriesRef.current = [];
          }
          recapBaselineEventIdRef.current ??= latestEventId;
          const newEventIds = visibleEventIds.filter(
            (eventId) => eventId > (recapBaselineEventIdRef.current ?? latestEventId),
          );
          recapBaselineEventIdRef.current = latestEventId;
          recapEventIdsRef.current = [...new Set([...recapEventIdsRef.current, ...newEventIds])]
            .sort((left, right) => left - right)
            .slice(-MAX_FACTUAL_RECAP_EVENTS);
          const storedEntriesById = new Map(
            recapEntriesRef.current.map((entry) => [entry.id, entry]),
          );
          const candidateEntries = recapEventIdsRef.current.flatMap((eventId) => {
            const visible = visibleEventsById.get(eventId);
            if (visible !== undefined) return [recapEntry(visible)];
            const stored = storedEntriesById.get(eventId);
            return stored === undefined ? [] : [stored];
          });
          // A legacy session may have IDs without durable text. Keep that migration marker empty
          // rather than inventing a partial recap; all new recap copies are paired one-for-one.
          recapEntriesRef.current =
            candidateEntries.length === recapEventIdsRef.current.length ? candidateEntries : [];
          const persistedSession = {
            ...session,
            recapEventIds: recapEventIdsRef.current,
            recapEntries: recapEntriesRef.current,
          };
          const sourceEventIds = [
            ...new Set([...visibleEventIds, ...recapEventIdsRef.current]),
          ].sort((left, right) => left - right);
          const snapshot = await simulation.requestSave();
          const slot = activeSaveRef.current;
          const committed = await runtime.gateway.commitFocusCheckpoint(
            slot.slotId,
            slot.name,
            snapshot,
            persistedSession,
            sourceEventIds,
          );
          await updateArchiveState(committed);
          setNotice(reason);
          setOperationError(null);
          if (
            persistedSession.status !== 'cancelled' &&
            focusHasEnded(persistedSession) &&
            !alertedSessionIdsRef.current.has(persistedSession.sessionId)
          ) {
            alertedSessionIdsRef.current.add(persistedSession.sessionId);
            await alerts.notifyCompletion(settings).catch(() => undefined);
          }
        } catch (error) {
          setOperationError(error instanceof Error ? error.message : 'Autosave failed.');
          throw error;
        }
      }),
    [alerts, enqueue, runtime.gateway, settings, simulation, updateArchiveState],
  );

  const onSessionState = useCallback(
    (session: FocusSession): void => {
      const previous = latestSessionRef.current;
      latestSessionRef.current = session;
      const mustPersistNow =
        previous?.sessionId !== session.sessionId ||
        session.status !== 'active' ||
        (previous !== null && !focusHasEnded(previous) && focusHasEnded(session));
      if (mustPersistNow) {
        if (autosaveTimerRef.current !== null) {
          window.clearTimeout(autosaveTimerRef.current);
          autosaveTimerRef.current = null;
        }
        void persistSession(
          session,
          isTerminalSession(session) ? 'Session recorded with a factual recap.' : 'Session saved.',
        ).catch(() => undefined);
        return;
      }
      autosaveTimerRef.current ??= window.setTimeout(() => {
        autosaveTimerRef.current = null;
        const latest = latestSessionRef.current;
        if (latest !== null) {
          void persistSession(latest, 'Focus and world autosaved.').catch(() => undefined);
        }
      }, AUTOSAVE_INTERVAL_MS);
    },
    [persistSession],
  );

  const focus = useFocusController({
    clock,
    initialSession: initial.initialSession,
    slotId: activeSave.slotId,
    onSimulationTicks: simulation.advanceTicks,
    onSessionState,
    createSessionId: () => `focus-${globalThis.crypto.randomUUID()}`,
  });

  useEffect(() => {
    document.documentElement.classList.toggle('calm-mode', settings.calmMode);
    document.documentElement.classList.toggle('reduced-effects', settings.reducedEffects);
    onReducedEffectsChange?.(settings.reducedEffects);
    return () => {
      document.documentElement.classList.remove('calm-mode');
      document.documentElement.classList.remove('reduced-effects');
      onReducedEffectsChange?.(false);
    };
  }, [onReducedEffectsChange, settings.calmMode, settings.reducedEffects]);

  useEffect(() => {
    const checkpointBeforeSuspension = () => {
      if (document.visibilityState !== 'hidden') return;
      queueMicrotask(() => {
        const latest = latestSessionRef.current;
        if (latest !== null) {
          void persistSession(latest, 'Focus and world saved before suspension.').catch(
            () => undefined,
          );
        }
      });
    };
    document.addEventListener('visibilitychange', checkpointBeforeSuspension);
    return () => {
      document.removeEventListener('visibilitychange', checkpointBeforeSuspension);
      if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current);
    };
  }, [persistSession]);

  const runOperation = useCallback(async (operation: () => Promise<void>): Promise<void> => {
    try {
      await operation();
      setOperationError(null);
    } catch (error) {
      setOperationError(
        error instanceof Error
          ? error.message
          : typeof error === 'string' && error.length > 0
            ? error
            : 'The operation failed.',
      );
    }
  }, []);

  const saveWorld = useCallback(
    (slotId: string, name: string, message: string): Promise<void> =>
      enqueue(async () => {
        const snapshot = await simulation.requestSave();
        const committed = await runtime.gateway.commitSaveSlot(slotId, name, snapshot);
        if (settings.activeSlotId !== slotId) {
          const savedSettings = await runtime.gateway.saveSettings({
            ...settings,
            activeSlotId: slotId,
          });
          setSettings(savedSettings);
        }
        await updateArchiveState(committed);
        setNotice(message);
      }),
    [enqueue, runtime.gateway, settings, simulation, updateArchiveState],
  );

  const saveCurrentWorld = useCallback(async (): Promise<void> => {
    focus.checkpoint();
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    const latest = latestSessionRef.current;
    if (latest !== null) {
      await persistSession(latest, 'World saved manually.');
      return;
    }
    await saveWorld(activeSave.slotId, activeSave.name, 'World saved manually.');
  }, [activeSave.name, activeSave.slotId, focus, persistSession, saveWorld]);

  const replaceWithSlot = useCallback(
    async (slotId: string): Promise<void> => {
      const loaded = await runtime.gateway.loadSaveSlot(slotId);
      if (loaded === null) throw new Error('The selected slot has no valid save.');
      await simulation.loadSnapshot(loaded.snapshot);
      const [loadedSettings, nextSlots, nextHistory] = await Promise.all([
        runtime.gateway.loadSettings(),
        runtime.gateway.listSaveSlots(),
        runtime.gateway.listFocusSessions(),
      ]);
      const nextSettings =
        loadedSettings.activeSlotId === loaded.slotId
          ? loadedSettings
          : await runtime.gateway.saveSettings({
              ...loadedSettings,
              activeSlotId: loaded.slotId,
            });
      onReplaceWorkspace({
        activeSave: loaded,
        history: nextHistory,
        initialSession: selectRestorableSession(loaded),
        offlineCatchUpApplied: false,
        recapBaselineEventId: deserializeWorldSnapshot(loaded.snapshot).eventLog.at(-1)?.id ?? 0,
        settings: nextSettings,
        slots: nextSlots,
      });
    },
    [onReplaceWorkspace, runtime.gateway, simulation],
  );

  const canSwitchWorld =
    focus.state.phase === 'idle' ||
    focus.state.phase === 'focus-completed' ||
    focus.state.phase === 'focus-cancelled' ||
    focus.state.phase === 'finished';
  const startNewSession = (): void => {
    focus.reset();
    latestSessionRef.current = null;
  };
  const phaseLabel = focus.state.phase.replaceAll('-', ' ');
  const focusMinutes = Number(focusMinutesInput);
  const breakMinutes = Number(breakMinutesInput);
  const focusDurationIsValid =
    focusMinutesInput.length > 0 &&
    Number.isSafeInteger(focusMinutes) &&
    focusMinutes >= 1 &&
    focusMinutes <= 1_440;
  const breakDurationIsValid =
    breakMinutesInput.length > 0 &&
    Number.isSafeInteger(breakMinutes) &&
    breakMinutes >= 0 &&
    breakMinutes <= 240;
  const configuredBreakIsValid = !settings.breaksEnabled || breakDurationIsValid;
  const settingsAreValid =
    Number.isSafeInteger(settings.focusToSimRatio) &&
    settings.focusToSimRatio >= 1 &&
    settings.focusToSimRatio <= 10_000 &&
    Number.isSafeInteger(settings.maxOfflineHours) &&
    settings.maxOfflineHours >= 0 &&
    settings.maxOfflineHours <= 168;
  const timerValue =
    focus.state.phase === 'break-running' || focus.state.phase === 'break-paused'
      ? focus.breakRemainingMs
      : focus.focusRemainingMs;
  const completedSessions = history.filter(
    (session) => session.status === 'completed' && session.slotId === activeSave.slotId,
  );
  const totalFocusedMs = completedSessions.reduce((total, session) => total + session.focusedMs, 0);
  const latestCompleted = completedSessions[0] ?? null;
  const recapEntries = latestCompleted?.recapEntries ?? [];

  return (
    <section className="focus-card" aria-labelledby="focus-title">
      <header className="card-heading focus-heading">
        <div>
          <p>Milestone 2 · local-first focus</p>
          <h2 id="focus-title">Focus forge</h2>
        </div>
        <span>
          {runtime.mode === 'native' ? 'SQLite archive' : 'Browser preview · not durable'}
        </span>
      </header>

      <div className="focus-layout">
        <div className="timer-panel">
          <p className="phase-label">{phaseLabel}</p>
          <output className="timer-readout" aria-label="Focus time remaining" role="timer">
            {focus.state.phase === 'idle'
              ? focusDurationIsValid
                ? formatDuration(focusMinutes * 60_000)
                : '--:--'
              : formatDuration(timerValue)}
          </output>
          <p className="timer-ratio">
            {settings.focusToSimRatio} simulation ticks per accepted focus second · interruptions
            are non-punitive
          </p>

          {focus.state.phase === 'idle' ? (
            <div className="focus-setup">
              <div className="preset-row" aria-label="Focus presets">
                {[25, 50, 90].map((minutes) => (
                  <button
                    aria-pressed={focusMinutes === minutes}
                    key={minutes}
                    onClick={() => setFocusMinutesInput(minutes.toString())}
                    type="button"
                  >
                    {minutes} min
                  </button>
                ))}
              </div>
              <label>
                Custom focus minutes
                <input
                  aria-invalid={!focusDurationIsValid}
                  max={1_440}
                  min={1}
                  onChange={(event) => setFocusMinutesInput(event.currentTarget.value)}
                  type="number"
                  value={focusMinutesInput}
                />
              </label>
              <label>
                Break minutes
                <input
                  aria-invalid={!breakDurationIsValid}
                  disabled={!settings.breaksEnabled}
                  max={240}
                  min={0}
                  onChange={(event) => setBreakMinutesInput(event.currentTarget.value)}
                  type="number"
                  value={breakMinutesInput}
                />
              </label>
              <button
                className="primary-action"
                disabled={
                  simulation.status !== 'ready' ||
                  !focusDurationIsValid ||
                  !configuredBreakIsValid ||
                  !settingsAreValid
                }
                onClick={() =>
                  focus.start({
                    focusDurationMs: focusMinutes * 60_000,
                    breakDurationMs: settings.breaksEnabled ? breakMinutes * 60_000 : 0,
                    simulationTicksPerFocusSecond: settings.focusToSimRatio,
                  })
                }
                type="button"
              >
                Start focus
              </button>
            </div>
          ) : (
            <div className="session-actions">
              {(focus.state.phase === 'focus-running' || focus.state.phase === 'break-running') && (
                <button onClick={() => focus.pause()} type="button">
                  Pause
                </button>
              )}
              {(focus.state.phase === 'focus-paused' || focus.state.phase === 'break-paused') && (
                <button className="primary-action" onClick={() => focus.resume()} type="button">
                  Resume
                </button>
              )}
              {(focus.state.phase === 'focus-running' || focus.state.phase === 'focus-paused') && (
                <>
                  <button onClick={() => focus.complete()} type="button">
                    Complete focus
                  </button>
                  <button onClick={() => focus.cancel()} type="button">
                    Cancel
                  </button>
                </>
              )}
              {(focus.state.phase === 'break-running' || focus.state.phase === 'break-paused') && (
                <button onClick={() => focus.skipBreak()} type="button">
                  End break
                </button>
              )}
              {canSwitchWorld && (
                <button onClick={startNewSession} type="button">
                  New session
                </button>
              )}
            </div>
          )}
        </div>

        <div className="archive-panel">
          <h3>World archive</h3>
          <p>
            Active slot: <strong>{activeSave.name}</strong> · generation{' '}
            {activeSave.recoveredGeneration}
          </p>
          <label>
            Load local slot
            <select
              disabled={!canSwitchWorld}
              onChange={(event) => {
                void runOperation(() => replaceWithSlot(event.currentTarget.value));
              }}
              value={activeSave.slotId}
            >
              {slots.map((slot) => (
                <option key={slot.slotId} value={slot.slotId}>
                  {slot.name}
                </option>
              ))}
            </select>
          </label>
          <div className="archive-actions">
            <button onClick={() => void runOperation(saveCurrentWorld)} type="button">
              Save now
            </button>
            <button
              onClick={() =>
                void runOperation(async () => {
                  setExportPackage(await runtime.gateway.exportSaveSlot(activeSave.slotId));
                  setNotice('Export package ready to copy.');
                })
              }
              type="button"
            >
              Export
            </button>
          </div>
          <details>
            <summary>Create another slot</summary>
            <label>
              Slot ID
              <input
                onChange={(event) => setSlotIdDraft(event.currentTarget.value)}
                value={slotIdDraft}
              />
            </label>
            <label>
              Slot name
              <input
                onChange={(event) => setSlotNameDraft(event.currentTarget.value)}
                value={slotNameDraft}
              />
            </label>
            <button
              disabled={!canSwitchWorld}
              onClick={() =>
                void runOperation(async () => {
                  if (focus.state.phase !== 'idle') startNewSession();
                  await saveWorld(slotIdDraft, slotNameDraft, 'New save slot created.');
                })
              }
              type="button"
            >
              Save as new slot
            </button>
          </details>
          <details>
            <summary>Import or export package</summary>
            <label>
              Export package
              <textarea readOnly rows={3} value={exportPackage} />
            </label>
            <label>
              Import package
              <textarea
                onChange={(event) => setImportPackage(event.currentTarget.value)}
                rows={3}
                value={importPackage}
              />
            </label>
            <button
              disabled={!canSwitchWorld || importPackage.trim().length === 0}
              onClick={() =>
                void runOperation(async () => {
                  const imported = await runtime.gateway.importSaveSlot(importPackage);
                  await replaceWithSlot(imported.slotId);
                })
              }
              type="button"
            >
              Validate and import
            </button>
          </details>
          <p className="local-data-note">
            Core worlds, focus history, and settings stay on this device. No account, cloud sync, or
            online service is required.
          </p>
        </div>
      </div>

      <div className="focus-lower-grid">
        <details className="settings-panel">
          <summary>Focus and accessibility settings</summary>
          <label>
            Accepted-focus simulation pace
            <input
              aria-invalid={
                !Number.isSafeInteger(settings.focusToSimRatio) ||
                settings.focusToSimRatio < 1 ||
                settings.focusToSimRatio > 10_000
              }
              max={10_000}
              min={1}
              onChange={(event) =>
                setSettings({ ...settings, focusToSimRatio: event.currentTarget.valueAsNumber })
              }
              type="number"
              value={Number.isFinite(settings.focusToSimRatio) ? settings.focusToSimRatio : ''}
            />
            <span>Applies only while accepted focus time is running.</span>
          </label>
          <label>
            Maximum offline hours
            <input
              aria-invalid={
                !Number.isSafeInteger(settings.maxOfflineHours) ||
                settings.maxOfflineHours < 0 ||
                settings.maxOfflineHours > 168
              }
              max={168}
              min={0}
              onChange={(event) =>
                setSettings({ ...settings, maxOfflineHours: event.currentTarget.valueAsNumber })
              }
              type="number"
              value={Number.isFinite(settings.maxOfflineHours) ? settings.maxOfflineHours : ''}
            />
          </label>
          <label>
            Volume percent
            <input
              max={100}
              min={0}
              onChange={(event) =>
                setSettings({ ...settings, volumePercent: event.currentTarget.valueAsNumber })
              }
              type="range"
              value={settings.volumePercent}
            />
            <output>{settings.volumePercent}%</output>
            <span>Changes the completion tone only.</span>
          </label>
          {(
            [
              ['calmMode', 'Calm focus mode'],
              ['reducedEffects', 'Reduce visual effects'],
              ['breaksEnabled', 'Optional breaks'],
              ['notificationsEnabled', 'Completion notifications'],
              ['soundEnabled', 'Completion sound'],
              ['offlineProgressionEnabled', 'Bounded offline progression'],
            ] as const
          ).map(([key, label]) => (
            <label className="checkbox-setting" key={key}>
              <input
                checked={settings[key]}
                onChange={(event) =>
                  setSettings({ ...settings, [key]: event.currentTarget.checked })
                }
                type="checkbox"
              />
              {label}
            </label>
          ))}
          <button
            disabled={!settingsAreValid}
            onClick={() =>
              void runOperation(async () => {
                const saved = await runtime.gateway.saveSettings(settings);
                setSettings(saved);
                setNotice('Settings saved locally.');
              })
            }
            type="button"
          >
            Save settings
          </button>
        </details>

        <section className="history-panel" aria-labelledby="history-title">
          <h3 id="history-title">Focus history</h3>
          <dl>
            <div>
              <dt>Completed sessions</dt>
              <dd>{completedSessions.length}</dd>
            </div>
            <div>
              <dt>Focused time</dt>
              <dd>{Math.floor(totalFocusedMs / 60_000)} min</dd>
            </div>
            <div>
              <dt>Issued world ticks</dt>
              <dd>
                {completedSessions.reduce(
                  (total, session) => total + session.issuedSimulationTicks,
                  0,
                )}
              </dd>
            </div>
          </dl>
          {latestCompleted === null ? (
            <p>Complete a focus session to create a factual world recap.</p>
          ) : (
            <div className="recap-panel">
              <h4>Latest factual recap</h4>
              <p>{formatDuration(latestCompleted.focusedMs)} of accepted focus time.</p>
              {recapEntries.length === 0 ? (
                <p>No factual event details were stored for this session.</p>
              ) : (
                <ul>
                  {recapEntries.map((entry) => (
                    <li aria-label={`Tick ${entry.tick}: ${entry.summary}`} key={entry.id}>
                      Tick {entry.tick}: {entry.summary}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>

      <div className="persistence-status" aria-live="polite" role="status">
        {operationError === null ? notice : `Save fault: ${operationError}`}
      </div>
    </section>
  );
}
