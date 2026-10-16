import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  AppSettings,
  FocusRecapEntry,
  FocusSession,
  LoadedSave,
  SaveSlotSummary,
} from '../adapters/persistence';
import { latestSnapshotEventId } from '../adapters/persistence';
import type { FocusAlerts } from '../adapters/focus-alerts';
import { type RuntimePersistence } from '../adapters/runtime-persistence';
import { getGameSoundscape, type GameSoundscape } from '../adapters/soundscape';
import { rehydrateFocusState } from '../focus';
import {
  FOCUS_SESSION_REVIEW_VERSION,
  MAX_FOCUS_RECAP_EVENTS,
  validateFocusSessionReview,
  type FocusRevisitTarget,
  type FocusSessionReview,
} from '../focus/session-review';
import type { WorkerEvent } from '../protocol';
import type { WorldSeed } from '../simulation/world';
import { systemFocusClock, useFocusController, type FocusClock } from './useFocusController';
import {
  DEMO_WORLD_CONFIG,
  type SimulationAdvancePriority,
  type WorldSimulationView,
} from './useWorldSimulation';
import { createRandomWorldSeed, formatWorldSeed, parseWorldSeed } from './world-seed';

const PRIMARY_SLOT_ID = 'primary';
const PRIMARY_SLOT_NAME = 'Founding world';
const AUTOSAVE_INTERVAL_MS = 30_000;
const MAX_OFFLINE_CATCH_UP_RATE = 1_000;

interface FocusPersistencePanelProps {
  readonly alerts: FocusAlerts;
  readonly clock?: FocusClock;
  readonly createWorldSeed?: () => WorldSeed;
  readonly onReducedEffectsChange?: (reduced: boolean) => void;
  readonly onRevisitTarget?: (target: FocusRevisitTarget) => void;
  readonly onSettingsChange?: (settings: AppSettings) => void;
  readonly runtime: RuntimePersistence;
  readonly simulation: WorldSimulationView;
  readonly soundscape?: GameSoundscape;
}

interface WorkspaceData {
  readonly activeSave: LoadedSave;
  readonly history: readonly FocusSession[];
  readonly initialSession: FocusSession | null;
  readonly initialNotice?: string;
  readonly initialOperationError: string | null;
  readonly offlineCatchUpApplied: boolean;
  /** Latest event in the exact generation that restored the focus session. */
  readonly recapBaselineEventId: number;
  readonly settings: AppSettings;
  readonly slots: readonly SaveSlotSummary[];
}

type OperationEnqueuer = <Result>(operation: () => Promise<Result>) => Promise<Result>;
type WorkspaceRefUpdater = (update: (current: WorkspaceData) => WorkspaceData) => void;

const LIFECYCLE_OPERATIONS_BLOCKED_MESSAGE =
  'World controls are frozen until Chrono Forge is reopened.';

interface WorkspaceOperationError {
  readonly kind:
    'active-preference' | 'archive-operation' | 'focus-session-blocked' | 'settings-write';
  readonly message: string;
  readonly slotId: string;
}

interface PublishedExport {
  readonly savePackage: string;
  readonly slotId: string;
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

async function loadWorkspace(
  clock: FocusClock,
  runtime: RuntimePersistence,
  simulation: Pick<
    WorldSimulationView,
    'events' | 'loadSnapshot' | 'performOfflineCatchUp' | 'requestSave'
  >,
): Promise<WorkspaceData> {
  const [loadedSettings, listedSlots] = await Promise.all([
    runtime.gateway.loadSettings(),
    runtime.gateway.listSaveSlots(),
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
    if (settings.offlineProgressionEnabled && loaded.savedAtMs > 0 && initialSession === null) {
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
  const history = await runtime.gateway.listFocusSessions(activeSave);
  return {
    activeSave,
    history,
    initialSession: selectRestorableSession(activeSave),
    initialOperationError: null,
    offlineCatchUpApplied,
    recapBaselineEventId: latestSnapshotEventId(activeSave),
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

function formatDelta(before: number, after: number): string {
  const delta = after - before;
  return delta > 0 ? `+${delta}` : delta.toString();
}

function recapEntry(event: WorkerEvent): FocusRecapEntry {
  return { id: event.id, tick: event.tick, summary: event.summary };
}

function isTerminalSession(session: FocusSession): boolean {
  return session.status === 'completed' || session.status === 'cancelled';
}

function canLeaveFocusSession(session: FocusSession | null): boolean {
  return session === null || isTerminalSession(session);
}

function focusHasEnded(session: FocusSession): boolean {
  return rehydrateFocusState(JSON.parse(session.stateJson) as unknown).focusEndedAtEpochMs !== null;
}

function isAlreadyDurableCheckpoint(
  save: LoadedSave,
  snapshot: string,
  session: FocusSession,
): boolean {
  return (
    save.snapshot === snapshot &&
    save.focusSession !== null &&
    JSON.stringify(save.focusSession) === JSON.stringify(session)
  );
}

function workspaceNotice(workspace: WorkspaceData): string {
  return (
    workspace.initialNotice ??
    (workspace.offlineCatchUpApplied
      ? 'Applied bounded offline progression.'
      : workspace.activeSave.recoveredFromCorruption
        ? `Recovered generation ${workspace.activeSave.recoveredGeneration} after rejecting a newer save.`
        : `Loaded ${workspace.activeSave.name}.`)
  );
}

export function FocusPersistencePanel({
  alerts,
  clock = systemFocusClock,
  createWorldSeed = createRandomWorldSeed,
  onReducedEffectsChange,
  onRevisitTarget,
  onSettingsChange,
  runtime,
  simulation,
  soundscape = getGameSoundscape(),
}: FocusPersistencePanelProps) {
  const bootstrapPromiseRef = useRef<Promise<WorkspaceData> | null>(null);
  const currentWorkspaceRef = useRef<WorkspaceData | null>(null);
  const lifecycleOperationsBlockedRef = useRef(false);
  const operationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const worldAuthorityTransitionsRef = useRef(0);
  const exclusiveWorldAuthorityTransitionsRef = useRef(0);
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [publishedExport, setPublishedExport] = useState<PublishedExport | null>(null);
  const [notice, setNotice] = useState('');
  const [workspaceOperationErrors, setWorkspaceOperationErrors] = useState<
    readonly WorkspaceOperationError[]
  >([]);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveringFreshWorld, setRecoveringFreshWorld] = useState(false);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [lifecycleOperationsBlocked, setLifecycleOperationsBlocked] = useState(false);
  const [worldAuthorityTransitionPending, setWorldAuthorityTransitionPending] = useState(false);
  const [exclusiveWorldAuthorityTransitionPending, setExclusiveWorldAuthorityTransitionPending] =
    useState(false);
  const enqueue = useCallback<OperationEnqueuer>((operation) => {
    const guardedOperation = (): ReturnType<typeof operation> => {
      if (lifecycleOperationsBlockedRef.current) {
        return Promise.reject(new Error(LIFECYCLE_OPERATIONS_BLOCKED_MESSAGE));
      }
      return operation();
    };
    const result = operationQueueRef.current.then(guardedOperation, guardedOperation);
    operationQueueRef.current = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }, []);
  const blockLifecycleOperations = useCallback((): void => {
    lifecycleOperationsBlockedRef.current = true;
    setLifecycleOperationsBlocked(true);
  }, []);
  const lifecycleOperationIsBlocked = useCallback(
    (): boolean => lifecycleOperationsBlockedRef.current,
    [],
  );
  const beginWorldAuthorityTransition = useCallback((exclusive = false): (() => void) => {
    worldAuthorityTransitionsRef.current += 1;
    setWorldAuthorityTransitionPending(true);
    if (exclusive) {
      exclusiveWorldAuthorityTransitionsRef.current += 1;
      setExclusiveWorldAuthorityTransitionPending(true);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      worldAuthorityTransitionsRef.current = Math.max(0, worldAuthorityTransitionsRef.current - 1);
      if (worldAuthorityTransitionsRef.current === 0) setWorldAuthorityTransitionPending(false);
      if (exclusive) {
        exclusiveWorldAuthorityTransitionsRef.current = Math.max(
          0,
          exclusiveWorldAuthorityTransitionsRef.current - 1,
        );
        if (exclusiveWorldAuthorityTransitionsRef.current === 0) {
          setExclusiveWorldAuthorityTransitionPending(false);
        }
      }
    };
  }, []);
  const worldAuthorityTransitionIsPending = useCallback(
    (): boolean => worldAuthorityTransitionsRef.current > 0,
    [],
  );
  const exclusiveWorldAuthorityTransitionIsPending = useCallback(
    (): boolean => exclusiveWorldAuthorityTransitionsRef.current > 0,
    [],
  );
  const getCurrentWorkspace = useCallback(() => currentWorkspaceRef.current, []);
  const updateCurrentWorkspaceRef = useCallback<WorkspaceRefUpdater>((update) => {
    if (currentWorkspaceRef.current !== null) {
      currentWorkspaceRef.current = update(currentWorkspaceRef.current);
    }
  }, []);

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
        if (subscribed && currentWorkspaceRef.current === null) {
          currentWorkspaceRef.current = loaded;
          setNotice(workspaceNotice(loaded));
          setWorkspace(loaded);
        }
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
    currentWorkspaceRef.current = next;
    setPublishedExport((current) => (current?.slotId === next.activeSave.slotId ? current : null));
    setNotice(workspaceNotice(next));
    setWorkspaceOperationErrors([]);
    setWorkspace(next);
    setWorkspaceRevision((current) => current + 1);
  }, []);
  const reportWorkspaceOperationError = useCallback(
    (slotId: string, message: string, kind: WorkspaceOperationError['kind']) => {
      if (currentWorkspaceRef.current?.activeSave.slotId === slotId) {
        setWorkspaceOperationErrors((current) => [
          ...current.filter((error) => error.slotId !== slotId || error.kind !== kind),
          { kind, message, slotId },
        ]);
      }
    },
    [],
  );
  const clearWorkspaceOperationError = useCallback(
    (slotId: string, kind: WorkspaceOperationError['kind']) => {
      setWorkspaceOperationErrors((current) =>
        current.filter((error) => error.slotId !== slotId || error.kind !== kind),
      );
    },
    [],
  );

  const startFreshWorld = useCallback(async () => {
    setRecoveringFreshWorld(true);
    setRecoveryError(null);
    try {
      const [settings, slots] = await Promise.all([
        runtime.gateway.loadSettings(),
        runtime.gateway.listSaveSlots(),
      ]);
      const recoverySlot = freshRecoverySlot(slots);
      const snapshot = await simulation.requestFreshWorldSnapshot(
        createWorldSeed(),
        DEMO_WORLD_CONFIG,
      );
      await runtime.gateway.commitSaveSlot(recoverySlot.slotId, recoverySlot.name, snapshot);
      await simulation.loadSnapshot(snapshot);
      await runtime.gateway.saveSettings({ ...settings, activeSlotId: recoverySlot.slotId });
      const recoveredWorkspace = await loadWorkspace(clock, runtime, {
        events: simulation.events,
        loadSnapshot: simulation.loadSnapshot,
        performOfflineCatchUp: simulation.performOfflineCatchUp,
        requestSave: simulation.requestSave,
      });
      bootstrapPromiseRef.current = Promise.resolve(recoveredWorkspace);
      currentWorkspaceRef.current = recoveredWorkspace;
      setPublishedExport(null);
      setNotice(workspaceNotice(recoveredWorkspace));
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
  }, [clock, createWorldSeed, runtime, simulation]);

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
      beginWorldAuthorityTransition={beginWorldAuthorityTransition}
      blockLifecycleOperations={blockLifecycleOperations}
      clearWorkspaceOperationError={clearWorkspaceOperationError}
      clock={clock}
      createWorldSeed={createWorldSeed}
      enqueue={enqueue}
      exclusiveWorldAuthorityTransitionIsPending={exclusiveWorldAuthorityTransitionIsPending}
      exclusiveWorldAuthorityTransitionPending={exclusiveWorldAuthorityTransitionPending}
      exportPackage={
        publishedExport?.slotId === workspace.activeSave.slotId ? publishedExport.savePackage : ''
      }
      externalOperationErrors={workspaceOperationErrors}
      getCurrentWorkspace={getCurrentWorkspace}
      initial={workspace}
      key={`${workspace.activeSave.slotId}-${workspaceRevision}`}
      lifecycleOperationIsBlocked={lifecycleOperationIsBlocked}
      lifecycleOperationsBlocked={lifecycleOperationsBlocked}
      notice={notice}
      onExportPackageChange={(slotId, savePackage) => setPublishedExport({ savePackage, slotId })}
      onNoticeChange={setNotice}
      onReplaceWorkspace={replaceWorkspace}
      reportWorkspaceOperationError={reportWorkspaceOperationError}
      runtime={runtime}
      simulation={simulation}
      soundscape={soundscape}
      updateCurrentWorkspaceRef={updateCurrentWorkspaceRef}
      worldAuthorityTransitionIsPending={worldAuthorityTransitionIsPending}
      worldAuthorityTransitionPending={worldAuthorityTransitionPending}
      {...(onReducedEffectsChange === undefined ? {} : { onReducedEffectsChange })}
      {...(onRevisitTarget === undefined ? {} : { onRevisitTarget })}
      {...(onSettingsChange === undefined ? {} : { onSettingsChange })}
    />
  );
}

interface FocusWorkspaceProps {
  readonly alerts: FocusAlerts;
  readonly beginWorldAuthorityTransition: (exclusive?: boolean) => () => void;
  readonly blockLifecycleOperations: () => void;
  readonly clearWorkspaceOperationError: (
    slotId: string,
    kind: WorkspaceOperationError['kind'],
  ) => void;
  readonly clock: FocusClock;
  readonly createWorldSeed: () => WorldSeed;
  readonly enqueue: OperationEnqueuer;
  readonly exclusiveWorldAuthorityTransitionIsPending: () => boolean;
  readonly exclusiveWorldAuthorityTransitionPending: boolean;
  readonly exportPackage: string;
  readonly externalOperationErrors: readonly WorkspaceOperationError[];
  readonly getCurrentWorkspace: () => WorkspaceData | null;
  readonly initial: WorkspaceData;
  readonly lifecycleOperationIsBlocked: () => boolean;
  readonly lifecycleOperationsBlocked: boolean;
  readonly notice: string;
  readonly onExportPackageChange: (slotId: string, savePackage: string) => void;
  readonly onNoticeChange: (notice: string) => void;
  readonly onReducedEffectsChange?: (reduced: boolean) => void;
  readonly onRevisitTarget?: (target: FocusRevisitTarget) => void;
  readonly onSettingsChange?: (settings: AppSettings) => void;
  readonly onReplaceWorkspace: (workspace: WorkspaceData) => void;
  readonly reportWorkspaceOperationError: (
    slotId: string,
    message: string,
    kind: WorkspaceOperationError['kind'],
  ) => void;
  readonly runtime: RuntimePersistence;
  readonly simulation: WorldSimulationView;
  readonly soundscape: GameSoundscape;
  readonly updateCurrentWorkspaceRef: WorkspaceRefUpdater;
  readonly worldAuthorityTransitionIsPending: () => boolean;
  readonly worldAuthorityTransitionPending: boolean;
}

function FocusWorkspace({
  alerts,
  beginWorldAuthorityTransition,
  blockLifecycleOperations,
  clearWorkspaceOperationError,
  clock,
  createWorldSeed,
  enqueue,
  exclusiveWorldAuthorityTransitionIsPending,
  exclusiveWorldAuthorityTransitionPending,
  exportPackage,
  externalOperationErrors,
  getCurrentWorkspace,
  initial,
  lifecycleOperationIsBlocked,
  lifecycleOperationsBlocked,
  notice,
  onExportPackageChange,
  onNoticeChange: setNotice,
  onReducedEffectsChange,
  onRevisitTarget,
  onSettingsChange,
  onReplaceWorkspace,
  reportWorkspaceOperationError,
  runtime,
  simulation,
  soundscape,
  updateCurrentWorkspaceRef,
  worldAuthorityTransitionIsPending,
  worldAuthorityTransitionPending,
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
  const [newWorldSeedDraft, setNewWorldSeedDraft] = useState(() =>
    formatWorldSeed(createWorldSeed()),
  );
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [importPackage, setImportPackage] = useState('');
  const [operationError, setOperationError] = useState<string | null>(
    initial.initialOperationError,
  );
  const visibleOperationError =
    externalOperationErrors.filter((error) => error.slotId === activeSave.slotId).at(-1)?.message ??
    operationError;
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
  const reviewRef = useRef<FocusSessionReview | null>(initial.initialSession?.review ?? null);
  const autosaveTimerRef = useRef<number | null>(null);
  const alertedSessionIdsRef = useRef(
    new Set(
      initial.initialSession !== null && focusHasEnded(initial.initialSession)
        ? [initial.initialSession.sessionId]
        : [],
    ),
  );

  const adoptWorkspaceRefs = useCallback((next: WorkspaceData): void => {
    activeSaveRef.current = next.activeSave;
    latestSessionRef.current = next.initialSession;
    recapSessionIdRef.current = next.initialSession?.sessionId ?? null;
    recapBaselineEventIdRef.current =
      next.initialSession === null ? null : next.recapBaselineEventId;
    recapEventIdsRef.current = next.initialSession?.recapEventIds ?? [];
    recapEntriesRef.current = next.initialSession?.recapEntries ?? [];
    reviewRef.current = next.initialSession?.review ?? null;
    alertedSessionIdsRef.current = new Set(
      next.initialSession !== null && focusHasEnded(next.initialSession)
        ? [next.initialSession.sessionId]
        : [],
    );
  }, []);

  const updateArchiveState = useCallback(
    async (loadedSave?: LoadedSave): Promise<void> => {
      const [nextSlots, nextHistory] = await Promise.all([
        runtime.gateway.listSaveSlots(),
        runtime.gateway.listFocusSessions(loadedSave ?? activeSaveRef.current),
      ]);
      setSlots(nextSlots);
      setHistory(nextHistory);
      const nextActiveSave = loadedSave ?? activeSaveRef.current;
      if (loadedSave !== undefined) {
        activeSaveRef.current = loadedSave;
        setActiveSave(loadedSave);
      }
      updateCurrentWorkspaceRef((current) => ({
        ...current,
        activeSave: nextActiveSave,
        history: nextHistory,
        initialSession: latestSessionRef.current,
        recapBaselineEventId: recapBaselineEventIdRef.current ?? current.recapBaselineEventId,
        slots: nextSlots,
      }));
    },
    [runtime.gateway, updateCurrentWorkspaceRef],
  );

  const persistSessionNow = useCallback(
    async (session: FocusSession, reason: string): Promise<void> => {
      const currentWorkspace = getCurrentWorkspace();
      if (currentWorkspace !== null && currentWorkspace.activeSave.slotId !== session.slotId) {
        return;
      }
      try {
        const existingReview = reviewRef.current;
        const isNewSession = recapSessionIdRef.current !== session.sessionId;
        if (isNewSession) {
          recapSessionIdRef.current = session.sessionId;
          reviewRef.current = null;
        }
        if (existingReview !== null || isNewSession || session.issuedSimulationTicks === 0) {
          const baselineEventId = isNewSession ? null : (existingReview?.baselineEventId ?? null);
          const { checkpoint, snapshot } = await simulation.requestFocusCheckpoint(baselineEventId);
          const review = validateFocusSessionReview(
            existingReview === null || isNewSession
              ? {
                  version: FOCUS_SESSION_REVIEW_VERSION,
                  baselineEventId: checkpoint.latestEventId,
                  before: checkpoint.moment,
                  after: checkpoint.moment,
                  revisitTarget: checkpoint.revisitTarget,
                }
              : {
                  ...existingReview,
                  after: checkpoint.moment,
                  revisitTarget: checkpoint.revisitTarget,
                },
          );
          const recapEntries = checkpoint.recapEntries;
          const recapEventIds = recapEntries.map((entry) => entry.id);
          const persistedSession: FocusSession = {
            ...session,
            recapEventIds,
            recapEntries,
            review,
          };
          reviewRef.current = review;
          recapBaselineEventIdRef.current = review.baselineEventId;
          recapEventIdsRef.current = recapEventIds;
          recapEntriesRef.current = recapEntries;
          latestSessionRef.current = persistedSession;
          const slot = activeSaveRef.current;
          if (isAlreadyDurableCheckpoint(slot, snapshot, persistedSession)) {
            setNotice(reason);
            setOperationError(null);
            return;
          }
          const committed = await runtime.gateway.commitFocusCheckpoint(
            slot.slotId,
            slot.name,
            snapshot,
            persistedSession,
            recapEventIds,
            { baselineEventId, checkpoint },
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
          return;
        }

        // Conservative compatibility path for an in-progress pre-M10.1 session: preserve its
        // existing recap contract without manufacturing a historical before-state.
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
          .slice(-MAX_FOCUS_RECAP_EVENTS);
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
        const sourceEventIds = [...new Set([...visibleEventIds, ...recapEventIdsRef.current])].sort(
          (left, right) => left - right,
        );
        const snapshot = await simulation.requestSave();
        const slot = activeSaveRef.current;
        if (isAlreadyDurableCheckpoint(slot, snapshot, persistedSession)) {
          setNotice(reason);
          setOperationError(null);
          return;
        }
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
        setOperationError(
          error instanceof Error
            ? error.message
            : typeof error === 'string' && error.length > 0
              ? error
              : 'Autosave failed.',
        );
        throw error;
      }
    },
    [
      alerts,
      getCurrentWorkspace,
      runtime.gateway,
      setNotice,
      settings,
      simulation,
      updateArchiveState,
    ],
  );

  const persistSession = useCallback(
    (session: FocusSession, reason: string): Promise<void> =>
      enqueue(() => persistSessionNow(session, reason)),
    [enqueue, persistSessionNow],
  );

  const onSessionState = useCallback(
    (session: FocusSession): void => {
      const previous = latestSessionRef.current;
      latestSessionRef.current = session;
      updateCurrentWorkspaceRef((current) =>
        current.activeSave.slotId === session.slotId
          ? { ...current, initialSession: session }
          : current,
      );
      if (session.slotId !== null && canLeaveFocusSession(session)) {
        clearWorkspaceOperationError(session.slotId, 'focus-session-blocked');
      }
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
    [clearWorkspaceOperationError, persistSession, updateCurrentWorkspaceRef],
  );

  const focusActionIsBlocked = useCallback(
    (): boolean => lifecycleOperationIsBlocked() || worldAuthorityTransitionIsPending(),
    [lifecycleOperationIsBlocked, worldAuthorityTransitionIsPending],
  );

  const advanceFocusTicks = useCallback(
    (ticks: number, priority: SimulationAdvancePriority): boolean => {
      if (focusActionIsBlocked()) return false;
      const currentWorkspace = getCurrentWorkspace();
      if (
        currentWorkspace !== null &&
        currentWorkspace.activeSave.slotId !== activeSaveRef.current.slotId
      ) {
        return false;
      }
      return simulation.advanceTicks(ticks, priority) !== false;
    },
    [getCurrentWorkspace, focusActionIsBlocked, simulation],
  );

  const focusFrozen =
    simulation.status === 'faulted' ||
    lifecycleOperationsBlocked ||
    worldAuthorityTransitionPending;
  const worldMutationFrozen =
    simulation.status === 'faulted' ||
    lifecycleOperationsBlocked ||
    exclusiveWorldAuthorityTransitionPending;
  const focus = useFocusController({
    clock,
    initialSession: initial.initialSession,
    slotId: activeSave.slotId,
    onSimulationTicks: advanceFocusTicks,
    onSessionState,
    createSessionId: () => `focus-${globalThis.crypto.randomUUID()}`,
    suspended: focusFrozen,
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
    onSettingsChange?.(settings);
  }, [onSettingsChange, settings]);

  useEffect(() => {
    if (focusFrozen) {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      return undefined;
    }
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
  }, [focusFrozen, persistSession]);

  const runOperation = useCallback(async (operation: () => Promise<void>): Promise<void> => {
    try {
      await operation();
      setOperationError(null);
    } catch (error) {
      if (error instanceof Error && error.message === LIFECYCLE_OPERATIONS_BLOCKED_MESSAGE) {
        return;
      }
      setOperationError(
        error instanceof Error
          ? error.message
          : typeof error === 'string' && error.length > 0
            ? error
            : 'The operation failed.',
      );
    }
  }, []);

  const enqueueWorldAuthorityTransition = useCallback<OperationEnqueuer>(
    (operation) => {
      if (exclusiveWorldAuthorityTransitionIsPending()) {
        return Promise.reject(new Error('Wait for the active world reset to finish.'));
      }
      const release = beginWorldAuthorityTransition();
      return enqueue(operation).finally(release);
    },
    [beginWorldAuthorityTransition, enqueue, exclusiveWorldAuthorityTransitionIsPending],
  );

  const enqueueExclusiveWorldAuthorityTransition = useCallback<OperationEnqueuer>(
    (operation) => {
      if (exclusiveWorldAuthorityTransitionIsPending()) {
        return Promise.reject(new Error('Wait for the active world reset to finish.'));
      }
      const release = beginWorldAuthorityTransition(true);
      return enqueue(operation).finally(release);
    },
    [beginWorldAuthorityTransition, enqueue, exclusiveWorldAuthorityTransitionIsPending],
  );

  const adoptCommittedWorld = useCallback(
    async (
      committed: LoadedSave,
      currentWorkspace: WorkspaceData,
      initialNotice: string,
      worldAlreadyLoaded = false,
    ): Promise<void> => {
      const recapBaselineEventId = latestSnapshotEventId(committed);
      const [nextSlots, nextHistory] = await Promise.all([
        runtime.gateway.listSaveSlots(),
        runtime.gateway.listFocusSessions(committed),
      ]);
      if (!worldAlreadyLoaded) await simulation.loadSnapshot(committed.snapshot);
      const selectedSettings = {
        ...currentWorkspace.settings,
        activeSlotId: committed.slotId,
      };
      onReplaceWorkspace({
        activeSave: committed,
        history: nextHistory,
        initialSession: selectRestorableSession(committed),
        initialNotice,
        initialOperationError: null,
        offlineCatchUpApplied: false,
        recapBaselineEventId,
        settings: selectedSettings,
        slots: nextSlots,
      });

      if (currentWorkspace.settings.activeSlotId !== committed.slotId) {
        try {
          const savedSettings = await runtime.gateway.saveSettings(selectedSettings);
          updateCurrentWorkspaceRef((current) =>
            current.activeSave.slotId === committed.slotId
              ? { ...current, initialOperationError: null, settings: savedSettings }
              : current,
          );
          clearWorkspaceOperationError(committed.slotId, 'active-preference');
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : typeof error === 'string' && error.length > 0
                ? error
                : 'The active slot preference could not be saved.';
          updateCurrentWorkspaceRef((current) =>
            current.activeSave.slotId === committed.slotId
              ? { ...current, initialOperationError: message }
              : current,
          );
          reportWorkspaceOperationError(committed.slotId, message, 'active-preference');
        }
      }
    },
    [
      clearWorkspaceOperationError,
      onReplaceWorkspace,
      reportWorkspaceOperationError,
      runtime.gateway,
      simulation,
      updateCurrentWorkspaceRef,
    ],
  );

  const assertNewSlotDestination = useCallback(
    (currentWorkspace: WorkspaceData, slotId: string): void => {
      if (currentWorkspace.slots.some((slot) => slot.slotId === slotId)) {
        throw new Error('Choose a new slot ID so an existing world is not replaced.');
      }
    },
    [],
  );

  const duplicateCurrentWorld = useCallback(
    (slotId: string, name: string): Promise<void> =>
      enqueueWorldAuthorityTransition(async () => {
        const currentWorkspace = getCurrentWorkspace();
        if (currentWorkspace === null) throw new Error('The active workspace is unavailable.');
        if (!canLeaveFocusSession(currentWorkspace.initialSession)) {
          throw new Error('Finish or cancel the active focus session before duplicating a world.');
        }
        assertNewSlotDestination(currentWorkspace, slotId);
        const snapshot = await simulation.requestSave();
        const committed = await runtime.gateway.commitSaveSlot(slotId, name, snapshot);
        await adoptCommittedWorld(
          committed,
          currentWorkspace,
          `Current world duplicated into ${committed.name}.`,
        );
      }),
    [
      adoptCommittedWorld,
      assertNewSlotDestination,
      enqueueWorldAuthorityTransition,
      getCurrentWorkspace,
      runtime.gateway,
      simulation,
    ],
  );

  const createNewWorld = useCallback(
    (slotId: string, name: string, seedText: string): Promise<void> =>
      enqueueWorldAuthorityTransition(async () => {
        const currentWorkspace = getCurrentWorkspace();
        if (currentWorkspace === null) throw new Error('The active workspace is unavailable.');
        if (!canLeaveFocusSession(currentWorkspace.initialSession)) {
          throw new Error('Finish or cancel the active focus session before creating a new world.');
        }
        assertNewSlotDestination(currentWorkspace, slotId);
        const seed = parseWorldSeed(seedText);
        if (seed === null) {
          throw new Error('Enter the seed as four groups of eight hexadecimal characters.');
        }
        const snapshot = await simulation.requestFreshWorldSnapshot(seed, DEMO_WORLD_CONFIG);
        const committed = await runtime.gateway.commitSaveSlot(slotId, name, snapshot);
        await adoptCommittedWorld(
          committed,
          currentWorkspace,
          `Fresh world ${committed.name} created.`,
        );
      }),
    [
      adoptCommittedWorld,
      assertNewSlotDestination,
      enqueueWorldAuthorityTransition,
      getCurrentWorkspace,
      runtime.gateway,
      simulation,
    ],
  );

  const resetActiveWorld = useCallback(
    (confirmation: string, seedText: string): Promise<void> =>
      enqueueExclusiveWorldAuthorityTransition(async () => {
        const currentWorkspace = getCurrentWorkspace();
        if (currentWorkspace === null) throw new Error('The active workspace is unavailable.');
        if (!canLeaveFocusSession(currentWorkspace.initialSession)) {
          throw new Error('Finish or cancel the active focus session before resetting this world.');
        }
        if (confirmation !== currentWorkspace.activeSave.name) {
          throw new Error(`Type ${currentWorkspace.activeSave.name} exactly to confirm the reset.`);
        }
        const seed = parseWorldSeed(seedText);
        if (seed === null) {
          throw new Error('Enter the seed as four groups of eight hexadecimal characters.');
        }
        const previousSnapshot = await simulation.requestSave();
        const freshSnapshot = await simulation.requestFreshWorldSnapshot(seed, DEMO_WORLD_CONFIG);
        await simulation.loadSnapshot(freshSnapshot);
        let committed: LoadedSave;
        try {
          committed = await runtime.gateway.commitSaveSlot(
            currentWorkspace.activeSave.slotId,
            currentWorkspace.activeSave.name,
            freshSnapshot,
          );
        } catch (error) {
          let durableAfterFailure: LoadedSave | null;
          try {
            durableAfterFailure = await runtime.gateway.loadSaveSlot(
              currentWorkspace.activeSave.slotId,
            );
          } catch (verificationError) {
            blockLifecycleOperations();
            const resetMessage = error instanceof Error ? error.message : 'The reset failed.';
            const verificationMessage =
              verificationError instanceof Error
                ? verificationError.message
                : 'the durable result could not be read';
            throw new Error(
              `${resetMessage} Reset outcome could not be verified: ${verificationMessage}. Reopen Chrono Forge before continuing.`,
              { cause: verificationError },
            );
          }
          if (durableAfterFailure?.snapshot === freshSnapshot) {
            // The immutable generation committed, but a later receipt/confirmation step failed.
            // The normal load boundary revalidated that exact snapshot, so finish adoption instead
            // of rolling Worker authority back behind its durable slot head.
            committed = durableAfterFailure;
          } else {
            const rollbackSnapshot = durableAfterFailure?.snapshot ?? previousSnapshot;
            try {
              await simulation.loadSnapshot(rollbackSnapshot);
            } catch (rollbackError) {
              blockLifecycleOperations();
              const resetMessage = error instanceof Error ? error.message : 'The reset failed.';
              const rollbackMessage =
                rollbackError instanceof Error ? rollbackError.message : 'the rollback failed';
              throw new Error(`${resetMessage} Worker rollback also failed: ${rollbackMessage}`, {
                cause: rollbackError,
              });
            }
            throw error;
          }
        }
        try {
          await adoptCommittedWorld(
            committed,
            currentWorkspace,
            `${committed.name} was reset with a fresh seed.`,
            true,
          );
        } catch (adoptionError) {
          blockLifecycleOperations();
          const adoptionMessage =
            adoptionError instanceof Error
              ? adoptionError.message
              : 'the committed world could not be adopted';
          throw new Error(
            `The reset committed, but the active workspace could not be synchronized: ${adoptionMessage}. Reopen Chrono Forge before continuing.`,
            { cause: adoptionError },
          );
        }
      }),
    [
      adoptCommittedWorld,
      blockLifecycleOperations,
      enqueueExclusiveWorldAuthorityTransition,
      getCurrentWorkspace,
      runtime.gateway,
      simulation,
    ],
  );

  const persistCurrentWorld = useCallback(
    async (reason: string): Promise<void> => {
      const currentWorkspace = getCurrentWorkspace();
      if (
        currentWorkspace !== null &&
        currentWorkspace.activeSave.slotId !== activeSaveRef.current.slotId
      ) {
        adoptWorkspaceRefs(currentWorkspace);
      }
      const latest = latestSessionRef.current;
      if (latest !== null) {
        await persistSessionNow(latest, reason);
        return;
      }
      const slot = activeSaveRef.current;
      const snapshot = await simulation.requestSave();
      const committed = await runtime.gateway.commitSaveSlot(slot.slotId, slot.name, snapshot);
      await updateArchiveState(committed);
      setNotice(reason);
    },
    [
      adoptWorkspaceRefs,
      getCurrentWorkspace,
      persistSessionNow,
      runtime.gateway,
      setNotice,
      simulation,
      updateArchiveState,
    ],
  );

  const checkpointFocusForArchiveOperation = useCallback((): void => {
    focus.checkpoint();
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }, [focus]);

  const saveCurrentWorld = useCallback(async (): Promise<void> => {
    if (exclusiveWorldAuthorityTransitionIsPending()) return;
    if (!worldAuthorityTransitionIsPending()) checkpointFocusForArchiveOperation();
    await enqueue(() => persistCurrentWorld('World saved manually.'));
  }, [
    checkpointFocusForArchiveOperation,
    enqueue,
    exclusiveWorldAuthorityTransitionIsPending,
    persistCurrentWorld,
    worldAuthorityTransitionIsPending,
  ]);

  const exportCurrentWorld = useCallback(async (): Promise<void> => {
    if (exclusiveWorldAuthorityTransitionIsPending()) return;
    if (simulation.status !== 'faulted' && !worldAuthorityTransitionIsPending()) {
      checkpointFocusForArchiveOperation();
    }
    await enqueue(async () => {
      try {
        if (simulation.status !== 'faulted') {
          await persistCurrentWorld('World saved before export.');
        } else {
          const currentWorkspace = getCurrentWorkspace();
          if (
            currentWorkspace !== null &&
            currentWorkspace.activeSave.slotId !== activeSaveRef.current.slotId
          ) {
            adoptWorkspaceRefs(currentWorkspace);
          }
        }
        const currentWorkspace = getCurrentWorkspace();
        if (currentWorkspace === null) throw new Error('The active workspace is unavailable.');
        const slotId = currentWorkspace.activeSave.slotId;
        const savePackage = await runtime.gateway.exportSaveSlot(slotId);
        onExportPackageChange(slotId, savePackage);
        clearWorkspaceOperationError(slotId, 'archive-operation');
        setNotice(
          simulation.status === 'faulted'
            ? 'Export package prepared from the last valid local checkpoint.'
            : 'Export package refreshed from the current world.',
        );
      } catch (error) {
        const currentWorkspace = getCurrentWorkspace();
        if (currentWorkspace !== null) {
          const message =
            error instanceof Error
              ? error.message
              : typeof error === 'string' && error.length > 0
                ? error
                : 'The export could not be prepared.';
          reportWorkspaceOperationError(
            currentWorkspace.activeSave.slotId,
            message,
            'archive-operation',
          );
        }
        throw error;
      }
    });
  }, [
    adoptWorkspaceRefs,
    checkpointFocusForArchiveOperation,
    clearWorkspaceOperationError,
    enqueue,
    exclusiveWorldAuthorityTransitionIsPending,
    getCurrentWorkspace,
    onExportPackageChange,
    persistCurrentWorld,
    reportWorkspaceOperationError,
    runtime.gateway,
    setNotice,
    simulation.status,
    worldAuthorityTransitionIsPending,
  ]);

  const saveCurrentSettings = useCallback(
    (draft: AppSettings, originatingSlotId: string): Promise<void> => {
      if (exclusiveWorldAuthorityTransitionIsPending()) return Promise.resolve();
      return enqueue(async () => {
        const currentWorkspace = getCurrentWorkspace();
        if (currentWorkspace === null) throw new Error('The active workspace is unavailable.');
        const slotId = currentWorkspace.activeSave.slotId;
        try {
          const saved = await runtime.gateway.saveSettings({
            ...draft,
            activeSlotId: slotId,
          });
          const nextWorkspace = {
            ...currentWorkspace,
            initialNotice: 'Settings saved locally.',
            initialOperationError: null,
            settings: saved,
          };
          clearWorkspaceOperationError(slotId, 'active-preference');
          clearWorkspaceOperationError(slotId, 'settings-write');
          if (slotId !== originatingSlotId) {
            onReplaceWorkspace(nextWorkspace);
            return;
          }
          setSettings(saved);
          updateCurrentWorkspaceRef((current) =>
            current.activeSave.slotId === slotId ? nextWorkspace : current,
          );
          setNotice('Settings saved locally.');
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : typeof error === 'string' && error.length > 0
                ? error
                : 'Settings could not be saved.';
          reportWorkspaceOperationError(slotId, message, 'settings-write');
          throw error;
        }
      });
    },
    [
      clearWorkspaceOperationError,
      enqueue,
      exclusiveWorldAuthorityTransitionIsPending,
      getCurrentWorkspace,
      onReplaceWorkspace,
      reportWorkspaceOperationError,
      runtime.gateway,
      setNotice,
      updateCurrentWorkspaceRef,
    ],
  );

  const replaceWithSlotNow = useCallback(
    async (slotId: string): Promise<void> => {
      const currentWorkspace = getCurrentWorkspace();
      if (currentWorkspace !== null && !canLeaveFocusSession(currentWorkspace.initialSession)) {
        const message = 'Finish or cancel the active focus session before switching worlds.';
        reportWorkspaceOperationError(
          currentWorkspace.activeSave.slotId,
          message,
          'focus-session-blocked',
        );
        throw new Error(message);
      }
      const loaded = await runtime.gateway.loadSaveSlot(slotId);
      if (loaded === null) throw new Error('The selected slot has no valid save.');
      const recapBaselineEventId = latestSnapshotEventId(loaded);
      const [loadedSettings, nextSlots, nextHistory] = await Promise.all([
        runtime.gateway.loadSettings(),
        runtime.gateway.listSaveSlots(),
        runtime.gateway.listFocusSessions(loaded),
      ]);

      const selectedSettings =
        loadedSettings.activeSlotId === loaded.slotId
          ? loadedSettings
          : { ...loadedSettings, activeSlotId: loaded.slotId };

      // No persistence read remains after this boundary. Once the Worker accepts the target,
      // synchronously transfer authority before any other awaited work can let an outgoing
      // focus controller issue ticks against the newly loaded world.
      await simulation.loadSnapshot(loaded.snapshot);
      const nextWorkspace: WorkspaceData = {
        activeSave: loaded,
        history: nextHistory,
        initialSession: selectRestorableSession(loaded),
        initialOperationError: null,
        offlineCatchUpApplied: false,
        recapBaselineEventId,
        settings: selectedSettings,
        slots: nextSlots,
      };
      onReplaceWorkspace(nextWorkspace);

      if (loadedSettings.activeSlotId !== loaded.slotId) {
        try {
          await runtime.gateway.saveSettings(selectedSettings);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : typeof error === 'string' && error.length > 0
                ? error
                : 'The active slot preference could not be saved.';
          updateCurrentWorkspaceRef((current) =>
            current.activeSave.slotId === loaded.slotId
              ? { ...current, initialOperationError: message }
              : current,
          );
          reportWorkspaceOperationError(loaded.slotId, message, 'active-preference');
        }
      }
    },
    [
      getCurrentWorkspace,
      onReplaceWorkspace,
      reportWorkspaceOperationError,
      runtime.gateway,
      simulation,
      updateCurrentWorkspaceRef,
    ],
  );

  const replaceWithSlot = useCallback(
    (slotId: string): Promise<void> =>
      enqueueWorldAuthorityTransition(() => replaceWithSlotNow(slotId)),
    [enqueueWorldAuthorityTransition, replaceWithSlotNow],
  );

  const importWorld = useCallback(
    (savePackage: string): Promise<void> =>
      enqueueWorldAuthorityTransition(async () => {
        const currentWorkspace = getCurrentWorkspace();
        if (currentWorkspace !== null && !canLeaveFocusSession(currentWorkspace.initialSession)) {
          const message = 'Finish or cancel the active focus session before switching worlds.';
          reportWorkspaceOperationError(
            currentWorkspace.activeSave.slotId,
            message,
            'focus-session-blocked',
          );
          throw new Error(message);
        }
        const imported = await runtime.gateway.importSaveSlot(savePackage);
        await replaceWithSlotNow(imported.slotId);
      }),
    [
      enqueueWorldAuthorityTransition,
      getCurrentWorkspace,
      replaceWithSlotNow,
      reportWorkspaceOperationError,
      runtime.gateway,
    ],
  );

  const canSwitchWorld =
    focus.state.phase === 'idle' ||
    focus.state.phase === 'focus-completed' ||
    focus.state.phase === 'focus-cancelled' ||
    focus.state.phase === 'finished';
  const startNewSession = (): void => {
    if (focusActionIsBlocked()) return;
    focus.reset();
    latestSessionRef.current = null;
    updateCurrentWorkspaceRef((current) => ({ ...current, initialSession: null }));
    clearWorkspaceOperationError(activeSaveRef.current.slotId, 'focus-session-blocked');
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
    settings.maxOfflineHours <= 168 &&
    [settings.volumePercent, settings.ambienceVolumePercent, settings.effectsVolumePercent].every(
      (value) => Number.isSafeInteger(value) && value >= 0 && value <= 100,
    );
  const parsedNewWorldSeed = parseWorldSeed(newWorldSeedDraft);
  const destinationSlotExists = slots.some((slot) => slot.slotId === slotIdDraft);
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
  const latestReview = latestCompleted?.review ?? null;
  const activeSettlement = simulation.frame?.civilizations.settlements
    .filter((settlement) => settlement.status === 'active')
    .slice()
    .sort((left, right) => left.id - right.id)[0];
  const reviewFacts =
    latestReview === null
      ? []
      : (
          [
            [
              'Detailed people',
              latestReview.before.detailedPopulation,
              latestReview.after.detailedPopulation,
            ],
            [
              'Surface population',
              latestReview.before.surfacePopulation,
              latestReview.after.surfacePopulation,
            ],
            ['Food stores', latestReview.before.food, latestReview.after.food],
            ['Water stores', latestReview.before.water, latestReview.after.water],
            ['Timber stores', latestReview.before.timber, latestReview.after.timber],
            ['Stone stores', latestReview.before.stone, latestReview.after.stone],
            [
              'Operational structures',
              latestReview.before.operationalStructures,
              latestReview.after.operationalStructures,
            ],
            [
              'Construction underway',
              latestReview.before.activeConstruction,
              latestReview.after.activeConstruction,
            ],
            ['Households', latestReview.before.households, latestReview.after.households],
            ['Scarcity', latestReview.before.scarcity, latestReview.after.scarcity],
            ['Stability', latestReview.before.stability, latestReview.after.stability],
            [
              'Settlements',
              latestReview.before.activeSettlements,
              latestReview.after.activeSettlements,
            ],
            [
              'Civilizations',
              latestReview.before.activeCivilizations,
              latestReview.after.activeCivilizations,
            ],
            ['Trade routes', latestReview.before.activeRoutes, latestReview.after.activeRoutes],
            [
              'Active conflicts',
              latestReview.before.activeConflicts,
              latestReview.after.activeConflicts,
            ],
            ['Active crises', latestReview.before.activeCrises, latestReview.after.activeCrises],
            ['Ruins', latestReview.before.ruins, latestReview.after.ruins],
            [
              'Offworld population',
              latestReview.before.offworldPopulation,
              latestReview.after.offworldPopulation,
            ],
            [
              'Active missions',
              latestReview.before.activeMissions,
              latestReview.after.activeMissions,
            ],
            [
              'Active colonies',
              latestReview.before.activeColonies,
              latestReview.after.activeColonies,
            ],
            [
              'Contacted aliens',
              latestReview.before.contactedAliens,
              latestReview.after.contactedAliens,
            ],
          ] as const
        )
          .filter(([, before, after]) => before !== after)
          .slice(0, 6);

  return (
    <section className="focus-card" aria-labelledby="focus-title">
      <header className="card-heading focus-heading">
        <div>
          <p>Session hearth · local-first</p>
          <h2 id="focus-title">Protect your time</h2>
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

          {simulation.status === 'faulted' ? (
            <p className="focus-runtime-fault" role="alert">
              Focus controls are frozen because the simulation Worker stopped. No additional focus
              time or world ticks will be issued. Reopen Chrono Forge to recover the last saved
              session state.
            </p>
          ) : null}
          {lifecycleOperationsBlocked ? (
            <p className="focus-runtime-fault" role="alert">
              World controls are frozen because the reset&apos;s durable outcome could not be safely
              synchronized. Reopen Chrono Forge before continuing; no further focus, save, load,
              import, export, or settings write will run.
            </p>
          ) : null}

          {focus.state.phase === 'idle' ? (
            <div className="focus-setup">
              <p className="focus-world-context">
                Focus with <strong>{activeSave.name}</strong> at tick{' '}
                {simulation.frame?.tick ?? '—'}
                {activeSettlement === undefined
                  ? '.'
                  : ` · ${activeSettlement.name}, ${activeSettlement.developmentStage.replaceAll('-', ' ')} stage.`}
              </p>
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
                  focusFrozen ||
                  !focusDurationIsValid ||
                  !configuredBreakIsValid ||
                  !settingsAreValid
                }
                onClick={() => {
                  if (focusActionIsBlocked()) return;
                  void soundscape.playCue('focus-start', settings);
                  focus.start({
                    focusDurationMs: focusMinutes * 60_000,
                    breakDurationMs: settings.breaksEnabled ? breakMinutes * 60_000 : 0,
                    simulationTicksPerFocusSecond: settings.focusToSimRatio,
                  });
                }}
                type="button"
              >
                Start focus
              </button>
            </div>
          ) : (
            <div className="session-actions">
              {(focus.state.phase === 'focus-running' || focus.state.phase === 'break-running') && (
                <button
                  disabled={focusFrozen}
                  onClick={() => {
                    if (focusActionIsBlocked()) return;
                    void soundscape.playCue('focus-pause', settings);
                    focus.pause();
                  }}
                  type="button"
                >
                  Pause
                </button>
              )}
              {(focus.state.phase === 'focus-paused' || focus.state.phase === 'break-paused') && (
                <button
                  className="primary-action"
                  disabled={focusFrozen}
                  onClick={() => {
                    if (focusActionIsBlocked()) return;
                    void soundscape.playCue('focus-resume', settings);
                    focus.resume();
                  }}
                  type="button"
                >
                  Resume
                </button>
              )}
              {(focus.state.phase === 'focus-running' || focus.state.phase === 'focus-paused') && (
                <>
                  <button
                    disabled={focusFrozen}
                    onClick={() => {
                      if (!focusActionIsBlocked()) focus.complete();
                    }}
                    type="button"
                  >
                    Complete focus
                  </button>
                  <button
                    disabled={focusFrozen}
                    onClick={() => {
                      if (!focusActionIsBlocked()) focus.cancel();
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                </>
              )}
              {(focus.state.phase === 'break-running' || focus.state.phase === 'break-paused') && (
                <button
                  disabled={focusFrozen}
                  onClick={() => {
                    if (!focusActionIsBlocked()) focus.skipBreak();
                  }}
                  type="button"
                >
                  End break
                </button>
              )}
              {canSwitchWorld && (
                <button disabled={focusFrozen} onClick={startNewSession} type="button">
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
          {simulation.frame === null ? null : (
            <p>
              Active seed: <code>{formatWorldSeed(simulation.frame.seed)}</code>
            </p>
          )}
          <label>
            Load local slot
            <select
              disabled={worldMutationFrozen || !canSwitchWorld}
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
            <button
              disabled={worldMutationFrozen}
              onClick={() => void runOperation(saveCurrentWorld)}
              type="button"
            >
              Save now
            </button>
            <button
              disabled={lifecycleOperationsBlocked || exclusiveWorldAuthorityTransitionPending}
              onClick={() => void runOperation(exportCurrentWorld)}
              type="button"
            >
              Export
            </button>
          </div>
          <details>
            <summary>World lifecycle</summary>
            <p>
              A new world starts at tick 0. A duplicate preserves the current world exactly in a
              separate slot.
            </p>
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
            {destinationSlotExists ? (
              <p role="status">Choose a new slot ID; existing worlds are never replaced here.</p>
            ) : null}
            <label>
              New world seed
              <input
                aria-invalid={parsedNewWorldSeed === null}
                onChange={(event) => setNewWorldSeedDraft(event.currentTarget.value)}
                spellCheck={false}
                value={newWorldSeedDraft}
              />
            </label>
            <button
              onClick={() => setNewWorldSeedDraft(formatWorldSeed(createWorldSeed()))}
              type="button"
            >
              Generate another seed
            </button>
            <div className="archive-actions">
              <button
                disabled={
                  worldMutationFrozen ||
                  !canSwitchWorld ||
                  parsedNewWorldSeed === null ||
                  destinationSlotExists
                }
                onClick={() =>
                  void runOperation(() =>
                    createNewWorld(slotIdDraft, slotNameDraft, newWorldSeedDraft),
                  )
                }
                type="button"
              >
                Create new world
              </button>
              <button
                disabled={worldMutationFrozen || !canSwitchWorld || destinationSlotExists}
                onClick={() =>
                  void runOperation(() => duplicateCurrentWorld(slotIdDraft, slotNameDraft))
                }
                type="button"
              >
                Duplicate current world
              </button>
            </div>
            <hr />
            <p>
              Reset permanently replaces only <strong>{activeSave.name}</strong> with a tick-zero
              world. Other slots are untouched.
            </p>
            <label>
              Reset confirmation
              <input
                onChange={(event) => setResetConfirmation(event.currentTarget.value)}
                placeholder={activeSave.name}
                value={resetConfirmation}
              />
            </label>
            <button
              disabled={
                worldMutationFrozen ||
                !canSwitchWorld ||
                parsedNewWorldSeed === null ||
                resetConfirmation !== activeSave.name
              }
              onClick={() =>
                void runOperation(() => resetActiveWorld(resetConfirmation, newWorldSeedDraft))
              }
              type="button"
            >
              Reset active world
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
              disabled={worldMutationFrozen || !canSwitchWorld || importPackage.trim().length === 0}
              onClick={() => void runOperation(() => importWorld(importPackage))}
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
          <p className="audio-settings-status" role="status">
            Audio: {settings.audioMuted ? 'muted' : `master ${settings.volumePercent}%`} · ambience{' '}
            {settings.ambienceEnabled ? `${settings.ambienceVolumePercent}%` : 'off'} · effects{' '}
            {settings.soundEnabled ? `${settings.effectsVolumePercent}%` : 'off'}.
          </p>
          <label>
            Master volume
            <input
              aria-label="Master volume percent"
              max={100}
              min={0}
              onChange={(event) =>
                setSettings({ ...settings, volumePercent: event.currentTarget.valueAsNumber })
              }
              type="range"
              value={settings.volumePercent}
            />
            <output>{settings.volumePercent}%</output>
            <span>Caps all optional local audio.</span>
          </label>
          <label>
            Ambience volume
            <input
              aria-label="Ambience volume percent"
              disabled={settings.audioMuted || !settings.ambienceEnabled}
              max={100}
              min={0}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  ambienceVolumePercent: event.currentTarget.valueAsNumber,
                })
              }
              type="range"
              value={settings.ambienceVolumePercent}
            />
            <output>{settings.ambienceVolumePercent}%</output>
            <span>Quiet Worker-factual atmosphere; off by default.</span>
          </label>
          <label>
            Effects volume
            <input
              aria-label="Effects volume percent"
              disabled={settings.audioMuted || !settings.soundEnabled}
              max={100}
              min={0}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  effectsVolumePercent: event.currentTarget.valueAsNumber,
                })
              }
              type="range"
              value={settings.effectsVolumePercent}
            />
            <output>{settings.effectsVolumePercent}%</output>
            <span>Restrained focus, selection, progress, danger, and discovery cues.</span>
          </label>
          {(
            [
              ['audioMuted', 'Mute all audio'],
              ['ambienceEnabled', 'Ambient soundscape'],
              ['soundEnabled', 'Sound effects'],
              ['calmMode', 'Calm focus mode'],
              ['reducedEffects', 'Reduce visual effects'],
              ['breaksEnabled', 'Optional breaks'],
              ['notificationsEnabled', 'Completion notifications'],
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
            disabled={
              !settingsAreValid ||
              settings.audioMuted ||
              !settings.soundEnabled ||
              settings.volumePercent === 0 ||
              settings.effectsVolumePercent === 0
            }
            onClick={() => {
              void soundscape.playCue('discovery', settings);
              setNotice('Audio preview requested; all important feedback remains visible in text.');
            }}
            type="button"
          >
            Preview audio
          </button>
          <button
            disabled={
              lifecycleOperationsBlocked ||
              exclusiveWorldAuthorityTransitionPending ||
              !settingsAreValid
            }
            onClick={() =>
              void runOperation(() => saveCurrentSettings(settings, activeSaveRef.current.slotId))
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
              {latestReview === null ? (
                <p>No retained authoritative before-and-after checkpoint is available.</p>
              ) : (
                <>
                  <p>
                    World tick {latestReview.before.tick} → {latestReview.after.tick} ·{' '}
                    {latestReview.after.tick - latestReview.before.tick} accepted-focus ticks
                  </p>
                  {reviewFacts.length === 0 ? (
                    <p>Tracked settlement facts were unchanged.</p>
                  ) : (
                    <dl className="recap-comparison" aria-label="Session before and after facts">
                      {reviewFacts.map(([label, before, after]) => (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd>
                            {before} → {after} <span>({formatDelta(before, after)})</span>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {latestReview.before.leadingSettlement?.developmentStage ===
                  latestReview.after.leadingSettlement?.developmentStage ? null : (
                    <p>
                      Leading settlement stage:{' '}
                      {latestReview.before.leadingSettlement?.developmentStage ?? 'none'} →{' '}
                      {latestReview.after.leadingSettlement?.developmentStage ?? 'none'}
                    </p>
                  )}
                </>
              )}
              {recapEntries.length === 0 ? (
                <p>No major event was recorded during this session.</p>
              ) : (
                <ul>
                  {recapEntries.map((entry) => (
                    <li aria-label={`Tick ${entry.tick}: ${entry.summary}`} key={entry.id}>
                      Tick {entry.tick}: {entry.summary}
                    </li>
                  ))}
                </ul>
              )}
              {latestReview?.revisitTarget === null ||
              latestReview?.revisitTarget === undefined ||
              onRevisitTarget === undefined ? null : (
                <button onClick={() => onRevisitTarget(latestReview.revisitTarget!)} type="button">
                  Revisit {latestReview.revisitTarget.label}
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      <div
        className="persistence-status"
        aria-live={visibleOperationError === null ? 'polite' : 'assertive'}
        role={visibleOperationError === null ? 'status' : 'alert'}
      >
        {visibleOperationError === null ? notice : `Archive fault: ${visibleOperationError}`}
      </div>
    </section>
  );
}
