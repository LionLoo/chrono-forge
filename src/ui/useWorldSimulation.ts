import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  WORKER_PROTOCOL_VERSION,
  type UiToWorkerMessage,
  type QueuedCommand,
  type SocietyRelationshipEventProjection,
  type SocietyRelationshipProjection,
  type SocietyTimelineProjection,
  type WorkerEvent,
  type WorkerToUiMessage,
  type WorldFrameProjection,
} from '../protocol';
import { applyWorldFrameDelta } from '../protocol/frame-delta';
import type { FocusCheckpointProjection } from '../focus/session-review';
import type { WorldConfig, WorldSeed } from '../simulation/world';
import type { RuntimeActivityEvent, RuntimeActivityRecorder } from '../testing/runtime-activity';
import {
  MAX_RECENT_WORKER_EVENTS,
  OFFLINE_CATCH_UP_POLICY_VERSION,
} from '../workers/simulation-runtime';

export const DEMO_WORLD_SEED: WorldSeed = Object.freeze([
  0x4348_524f, 0x4e4f_464f, 0x5247_4531, 0x0000_0001,
]);
export const DEMO_WORLD_CONFIG: WorldConfig = Object.freeze({
  width: 96,
  height: 64,
  chunkSize: 32,
  societyYearTicks: 100_000,
});

export interface SimulationWorkerPort {
  onerror: ((event: ErrorEvent) => void) | null;
  onmessage: ((event: MessageEvent<WorkerToUiMessage>) => void) | null;
  postMessage(message: UiToWorkerMessage): void;
  terminate(): void;
}

export type SimulationWorkerFactory = () => SimulationWorkerPort;

const createBrowserWorker: SimulationWorkerFactory = () =>
  new Worker(new URL('../workers/simulation.worker.ts', import.meta.url), {
    name: 'chrono-forge-simulation',
    type: 'module',
  });

function postWorkerMessage(
  worker: SimulationWorkerPort,
  message: UiToWorkerMessage,
  activityRecorder: RuntimeActivityRecorder | undefined,
): void {
  worker.postMessage(message);
  recordRuntimeActivity(activityRecorder, {
    kind: 'worker-request',
    messageType: message.type,
    requestId: message.requestId,
  });
}

function recordRuntimeActivity(
  activityRecorder: RuntimeActivityRecorder | undefined,
  event: RuntimeActivityEvent,
): void {
  try {
    activityRecorder?.record(event);
  } catch {
    // Diagnostics must never change Worker delivery or authoritative UI state.
  }
}

interface PendingVoidRequest {
  readonly reject: (reason: Error) => void;
  readonly resolve: () => void;
}

interface PendingSaveRequest {
  readonly reject: (reason: Error) => void;
  readonly resolve: (snapshot: string) => void;
}

export interface FocusCheckpointResult {
  readonly snapshot: string;
  readonly checkpoint: FocusCheckpointProjection;
}

interface PendingFocusCheckpointRequest {
  readonly reject: (reason: Error) => void;
  readonly resolve: (result: FocusCheckpointResult) => void;
}

export interface WorldSimulationView {
  readonly advanceTicks: (ticks: number) => void;
  readonly error: string | null;
  readonly events: readonly WorkerEvent[];
  /** The latest events newly recorded after an authoritative advance, excluding load history. */
  readonly latestRecordedEvents: readonly WorkerEvent[];
  readonly frame: WorldFrameProjection | null;
  readonly loadSnapshot: (snapshot: string) => Promise<void>;
  readonly performOfflineCatchUp: (elapsedMilliseconds: number, rate: number) => Promise<void>;
  readonly queueCommand: (command: QueuedCommand) => Promise<void>;
  readonly requestSave: () => Promise<string>;
  readonly requestFocusCheckpoint: (
    baselineEventId: number | null,
  ) => Promise<FocusCheckpointResult>;
  readonly requestTimelinePage: (offset: number) => void;
  readonly requestRelationshipPage: (personId: number, offset: number) => void;
  readonly requestRelationshipEventPage: (
    personId: number,
    relationshipId: string,
    offset: number,
  ) => void;
  readonly retryInitialization: () => void;
  readonly relationshipPage: {
    readonly personId: number | null;
    readonly offset: number;
    readonly total: number;
    readonly relationships: readonly SocietyRelationshipProjection[];
  };
  readonly relationshipEventPage: {
    readonly personId: number | null;
    readonly relationshipId: string | null;
    readonly offset: number;
    readonly total: number;
    readonly events: readonly SocietyRelationshipEventProjection[];
  };
  readonly status: 'booting' | 'ready' | 'faulted';
  readonly timeline: {
    readonly entries: readonly SocietyTimelineProjection[];
    readonly offset: number;
    readonly total: number;
  };
}

function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
}

export function useWorldSimulation(
  workerFactory: SimulationWorkerFactory = createBrowserWorker,
  activityRecorder?: RuntimeActivityRecorder,
): WorldSimulationView {
  const [frame, setFrame] = useState<WorldFrameProjection | null>(null);
  const [events, setEvents] = useState<readonly WorkerEvent[]>([]);
  const [latestRecordedEvents, setLatestRecordedEvents] = useState<readonly WorkerEvent[]>([]);
  const [timeline, setTimeline] = useState<WorldSimulationView['timeline']>({
    entries: [],
    offset: 0,
    total: 0,
  });
  const [relationshipPage, setRelationshipPage] = useState<WorldSimulationView['relationshipPage']>(
    {
      personId: null,
      offset: 0,
      total: 0,
      relationships: [],
    },
  );
  const [relationshipEventPage, setRelationshipEventPage] = useState<
    WorldSimulationView['relationshipEventPage']
  >({ personId: null, relationshipId: null, offset: 0, total: 0, events: [] });
  const [error, setError] = useState<string | null>(null);
  const [workerAttempt, setWorkerAttempt] = useState(0);
  const activityRecorderRef = useRef(activityRecorder);
  const frameRef = useRef<WorldFrameProjection | null>(null);
  const workerRef = useRef<SimulationWorkerPort | null>(null);
  const requestSequenceRef = useRef(0);
  const pendingSavesRef = useRef(new Map<string, PendingSaveRequest>());
  const pendingFocusCheckpointsRef = useRef(new Map<string, PendingFocusCheckpointRequest>());
  const pendingLoadsRef = useRef(new Map<string, PendingVoidRequest>());
  const pendingOfflineRef = useRef(new Map<string, PendingVoidRequest>());
  const pendingCommandsRef = useRef(new Map<string, PendingVoidRequest>());

  useEffect(() => {
    activityRecorderRef.current = activityRecorder;
  }, [activityRecorder]);

  const nextRequestId = useCallback((kind: string) => {
    requestSequenceRef.current += 1;
    return `${kind}-${requestSequenceRef.current}`;
  }, []);

  useEffect(() => {
    let disposed = false;
    let worker: SimulationWorkerPort;
    try {
      worker = workerFactory();
    } catch (workerError) {
      const reason =
        workerError instanceof Error ? workerError.message : 'Simulation worker unavailable.';
      queueMicrotask(() => {
        if (!disposed) setError(reason);
      });
      return () => {
        disposed = true;
      };
    }

    workerRef.current = worker;
    const pendingSaves = pendingSavesRef.current;
    const pendingFocusCheckpoints = pendingFocusCheckpointsRef.current;
    const pendingLoads = pendingLoadsRef.current;
    const pendingOffline = pendingOfflineRef.current;
    const pendingCommands = pendingCommandsRef.current;
    const historicalEventRequestIds = new Set<string>();
    const rejectRequest = (
      requestId: string,
      reason: Error,
    ): 'command' | 'focus-checkpoint' | 'load' | 'offline' | 'save' | null => {
      let rejected: 'command' | 'focus-checkpoint' | 'load' | 'offline' | 'save' | null = null;
      const pendingSave = pendingSaves.get(requestId);
      if (pendingSave !== undefined) {
        pendingSaves.delete(requestId);
        pendingSave.reject(reason);
        rejected = 'save';
      }
      const pendingFocusCheckpoint = pendingFocusCheckpoints.get(requestId);
      if (pendingFocusCheckpoint !== undefined) {
        pendingFocusCheckpoints.delete(requestId);
        pendingFocusCheckpoint.reject(reason);
        rejected = 'focus-checkpoint';
      }
      const pendingLoad = pendingLoads.get(requestId);
      if (pendingLoad !== undefined) {
        pendingLoads.delete(requestId);
        pendingLoad.reject(reason);
        rejected = 'load';
      }
      const offlineRequest = pendingOffline.get(requestId);
      if (offlineRequest !== undefined) {
        pendingOffline.delete(requestId);
        offlineRequest.reject(reason);
        rejected = 'offline';
      }
      const pendingCommand = pendingCommands.get(requestId);
      if (pendingCommand !== undefined) {
        pendingCommands.delete(requestId);
        pendingCommand.reject(reason);
        rejected = 'command';
      }
      return rejected;
    };
    const rejectAll = (reason: Error) => {
      for (const pending of pendingSaves.values()) pending.reject(reason);
      for (const pending of pendingFocusCheckpoints.values()) pending.reject(reason);
      for (const pending of pendingLoads.values()) pending.reject(reason);
      for (const pending of pendingOffline.values()) pending.reject(reason);
      for (const pending of pendingCommands.values()) pending.reject(reason);
      pendingSaves.clear();
      pendingFocusCheckpoints.clear();
      pendingLoads.clear();
      pendingOffline.clear();
      pendingCommands.clear();
    };
    const failWorker = (reason: Error) => {
      rejectAll(reason);
      if (workerRef.current === worker) workerRef.current = null;
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      setError(reason.message);
    };
    const applyFrame = (
      nextFrame: WorldFrameProjection,
      replaceEvents: boolean,
      requestId: string,
      source: 'delta' | 'ready',
    ) => {
      frameRef.current = nextFrame;
      setFrame(nextFrame);
      // A page belongs to an earlier authoritative state and must never be displayed as current.
      setRelationshipPage({ personId: null, offset: 0, total: 0, relationships: [] });
      setRelationshipEventPage({
        personId: null,
        relationshipId: null,
        offset: 0,
        total: 0,
        events: [],
      });
      setTimeline({
        entries: nextFrame.society.timeline,
        offset: nextFrame.society.timelineOffset,
        total: nextFrame.society.timelineTotal,
      });
      if (replaceEvents) setEvents([]);
      setError(null);
      recordRuntimeActivity(activityRecorderRef.current, {
        kind: 'frame-applied',
        requestId,
        source,
        tick: nextFrame.tick,
      });
    };

    worker.onmessage = (event) => {
      const message = event.data;
      recordRuntimeActivity(activityRecorderRef.current, {
        kind: 'worker-response',
        messageType: message.type,
        requestId: message.requestId,
      });
      if (message.protocolVersion !== WORKER_PROTOCOL_VERSION) {
        const reason = new Error('The simulation worker protocol version is not supported.');
        failWorker(reason);
        return;
      }

      switch (message.type) {
        case 'ready': {
          applyFrame(message.frame, true, message.requestId, 'ready');
          historicalEventRequestIds.add(message.requestId);
          setLatestRecordedEvents([]);
          const pendingLoad = pendingLoads.get(message.requestId);
          if (pendingLoad !== undefined) {
            pendingLoads.delete(message.requestId);
            pendingLoad.resolve();
          }
          return;
        }
        case 'frameDelta': {
          try {
            if (frameRef.current === null)
              throw new Error('Received a frame delta before a ready frame.');
            applyFrame(
              applyWorldFrameDelta(frameRef.current, message.delta),
              false,
              message.requestId,
              'delta',
            );
          } catch (deltaError) {
            const reason =
              deltaError instanceof Error
                ? deltaError
                : new Error('The simulation worker sent an invalid frame delta.');
            failWorker(reason);
          }
          return;
        }
        case 'eventBatch': {
          const isHistoricalBatch = historicalEventRequestIds.delete(message.requestId);
          setEvents((current) => {
            const byId = new Map(current.map((worldEvent) => [worldEvent.id, worldEvent]));
            for (const worldEvent of message.events) byId.set(worldEvent.id, worldEvent);
            return [...byId.values()]
              .sort((left, right) => left.tick - right.tick || left.id - right.id)
              .slice(-MAX_RECENT_WORKER_EVENTS);
          });
          if (!isHistoricalBatch) setLatestRecordedEvents(Object.freeze([...message.events]));
          return;
        }
        case 'timelinePage':
          setTimeline({
            entries: message.timeline,
            offset: message.offset,
            total: message.total,
          });
          return;
        case 'relationshipPage':
          setRelationshipEventPage({
            personId: null,
            relationshipId: null,
            offset: 0,
            total: 0,
            events: [],
          });
          setRelationshipPage({
            personId: message.personId,
            offset: message.offset,
            total: message.total,
            relationships: message.relationships,
          });
          return;
        case 'relationshipEventPage':
          setRelationshipEventPage({
            personId: message.personId,
            relationshipId: message.relationshipId,
            offset: message.offset,
            total: message.total,
            events: message.events,
          });
          return;
        case 'saveSnapshot': {
          const pending = pendingSaves.get(message.requestId);
          if (pending !== undefined) {
            pendingSaves.delete(message.requestId);
            pending.resolve(message.snapshot);
          }
          return;
        }
        case 'focusCheckpoint': {
          const pending = pendingFocusCheckpoints.get(message.requestId);
          if (pending !== undefined) {
            pendingFocusCheckpoints.delete(message.requestId);
            pending.resolve({ snapshot: message.snapshot, checkpoint: message.checkpoint });
          }
          return;
        }
        case 'metrics': {
          const pendingLoad = pendingLoads.get(message.requestId);
          if (pendingLoad !== undefined) {
            pendingLoads.delete(message.requestId);
            pendingLoad.resolve();
          }
          const pendingOfflineRequest = pendingOffline.get(message.requestId);
          if (pendingOfflineRequest !== undefined) {
            pendingOffline.delete(message.requestId);
            pendingOfflineRequest.resolve();
          }
          return;
        }
        case 'fault': {
          const reason = new Error(message.message);
          const requestKind = rejectRequest(message.requestId, reason);
          const isRecoverableRequestFault =
            message.code === 'world-error' && (requestKind === 'load' || requestKind === 'command');
          if (!isRecoverableRequestFault) {
            failWorker(reason);
          }
          return;
        }
        case 'commandAccepted': {
          const pending = pendingCommands.get(message.requestId);
          if (pending !== undefined) {
            pendingCommands.delete(message.requestId);
            pending.resolve();
          }
          return;
        }
      }
    };
    worker.onerror = (event) => {
      const reason = new Error(event.message || 'The simulation worker stopped unexpectedly.');
      failWorker(reason);
    };

    const requestId = nextRequestId('initialize');
    postWorkerMessage(
      worker,
      {
        type: 'initialize',
        protocolVersion: WORKER_PROTOCOL_VERSION,
        requestId,
        seed: DEMO_WORLD_SEED,
        config: DEMO_WORLD_CONFIG,
      },
      activityRecorderRef.current,
    );

    return () => {
      disposed = true;
      const reason = new Error('The simulation worker was closed before the request completed.');
      rejectAll(reason);
      workerRef.current = null;
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };
  }, [nextRequestId, workerAttempt, workerFactory]);

  const retryInitialization = useCallback(() => {
    // A retry is only safe before an authoritative frame exists. Once ready, persistence and
    // focus flows own any deliberate world replacement through the Worker load protocol.
    if (frameRef.current !== null) return;
    setError(null);
    setWorkerAttempt((attempt) => attempt + 1);
  }, []);

  const advanceTicks = useCallback(
    (ticks: number) => {
      assertNonNegativeSafeInteger(ticks, 'Advance ticks');
      const worker = workerRef.current;
      if (worker === null) return;
      const requestId = nextRequestId('advance');
      postWorkerMessage(
        worker,
        {
          type: 'advanceTicks',
          protocolVersion: WORKER_PROTOCOL_VERSION,
          requestId,
          ticks,
        },
        activityRecorderRef.current,
      );
    },
    [nextRequestId],
  );

  const requestSave = useCallback((): Promise<string> => {
    const worker = workerRef.current;
    if (worker === null) return Promise.reject(new Error('The simulation worker is unavailable.'));
    const requestId = nextRequestId('save');
    const promise = new Promise<string>((resolve, reject) => {
      pendingSavesRef.current.set(requestId, { resolve, reject });
    });
    postWorkerMessage(
      worker,
      {
        type: 'requestSave',
        protocolVersion: WORKER_PROTOCOL_VERSION,
        requestId,
      },
      activityRecorderRef.current,
    );
    return promise;
  }, [nextRequestId]);

  const requestFocusCheckpoint = useCallback(
    (baselineEventId: number | null): Promise<FocusCheckpointResult> => {
      if (baselineEventId !== null)
        assertNonNegativeSafeInteger(baselineEventId, 'Focus event baseline');
      const worker = workerRef.current;
      if (worker === null)
        return Promise.reject(new Error('The simulation worker is unavailable.'));
      const requestId = nextRequestId('focus-checkpoint');
      const promise = new Promise<FocusCheckpointResult>((resolve, reject) => {
        pendingFocusCheckpointsRef.current.set(requestId, { resolve, reject });
      });
      postWorkerMessage(
        worker,
        {
          type: 'requestFocusCheckpoint',
          protocolVersion: WORKER_PROTOCOL_VERSION,
          requestId,
          baselineEventId,
        },
        activityRecorderRef.current,
      );
      return promise;
    },
    [nextRequestId],
  );

  const requestTimelinePage = useCallback(
    (offset: number) => {
      assertNonNegativeSafeInteger(offset, 'Timeline offset');
      const worker = workerRef.current;
      if (worker === null) return;
      postWorkerMessage(
        worker,
        {
          type: 'requestTimelinePage',
          protocolVersion: WORKER_PROTOCOL_VERSION,
          requestId: nextRequestId('timeline'),
          offset,
        },
        activityRecorderRef.current,
      );
    },
    [nextRequestId],
  );

  const requestRelationshipPage = useCallback(
    (personId: number, offset: number) => {
      if (!Number.isSafeInteger(personId) || personId <= 0)
        throw new RangeError('Relationship person id must be a positive safe integer.');
      assertNonNegativeSafeInteger(offset, 'Relationship offset');
      const worker = workerRef.current;
      if (worker === null) return;
      postWorkerMessage(
        worker,
        {
          type: 'requestRelationshipPage',
          protocolVersion: WORKER_PROTOCOL_VERSION,
          requestId: nextRequestId('relationship'),
          personId,
          offset,
        },
        activityRecorderRef.current,
      );
    },
    [nextRequestId],
  );

  const requestRelationshipEventPage = useCallback(
    (personId: number, relationshipId: string, offset: number) => {
      if (!Number.isSafeInteger(personId) || personId <= 0)
        throw new RangeError('Relationship person id must be a positive safe integer.');
      if (relationshipId.length === 0 || relationshipId.length > 128)
        throw new RangeError('Relationship id must be between 1 and 128 characters.');
      assertNonNegativeSafeInteger(offset, 'Relationship event offset');
      const worker = workerRef.current;
      if (worker === null) return;
      postWorkerMessage(
        worker,
        {
          type: 'requestRelationshipEventPage',
          protocolVersion: WORKER_PROTOCOL_VERSION,
          requestId: nextRequestId('relationship-events'),
          personId,
          relationshipId,
          offset,
        },
        activityRecorderRef.current,
      );
    },
    [nextRequestId],
  );

  const loadSnapshot = useCallback(
    (snapshot: string): Promise<void> => {
      const worker = workerRef.current;
      if (worker === null)
        return Promise.reject(new Error('The simulation worker is unavailable.'));
      const requestId = nextRequestId('load');
      const promise = new Promise<void>((resolve, reject) => {
        pendingLoadsRef.current.set(requestId, { resolve, reject });
      });
      postWorkerMessage(
        worker,
        {
          type: 'load',
          protocolVersion: WORKER_PROTOCOL_VERSION,
          requestId,
          snapshot,
        },
        activityRecorderRef.current,
      );
      return promise;
    },
    [nextRequestId],
  );

  const performOfflineCatchUp = useCallback(
    (elapsedMilliseconds: number, rate: number): Promise<void> => {
      assertNonNegativeSafeInteger(elapsedMilliseconds, 'Offline elapsed milliseconds');
      assertNonNegativeSafeInteger(rate, 'Offline simulation rate');
      if (rate > 1_000) throw new RangeError('Offline simulation rate cannot exceed 1000.');
      const worker = workerRef.current;
      if (worker === null)
        return Promise.reject(new Error('The simulation worker is unavailable.'));
      const requestId = nextRequestId('offline');
      const promise = new Promise<void>((resolve, reject) => {
        pendingOfflineRef.current.set(requestId, { resolve, reject });
      });
      postWorkerMessage(
        worker,
        {
          type: 'performOfflineCatchUp',
          protocolVersion: WORKER_PROTOCOL_VERSION,
          requestId,
          elapsedMilliseconds,
          rate,
          policyVersion: OFFLINE_CATCH_UP_POLICY_VERSION,
        },
        activityRecorderRef.current,
      );
      return promise;
    },
    [nextRequestId],
  );

  const queueCommand = useCallback(
    (command: QueuedCommand): Promise<void> => {
      const worker = workerRef.current;
      if (worker === null)
        return Promise.reject(new Error('The simulation worker is unavailable.'));
      const requestId = nextRequestId('command');
      const promise = new Promise<void>((resolve, reject) => {
        pendingCommandsRef.current.set(requestId, { resolve, reject });
      });
      postWorkerMessage(
        worker,
        {
          type: 'queueCommand',
          protocolVersion: WORKER_PROTOCOL_VERSION,
          requestId,
          command,
        },
        activityRecorderRef.current,
      );
      return promise;
    },
    [nextRequestId],
  );

  return useMemo(
    () => ({
      advanceTicks,
      error,
      events,
      frame,
      latestRecordedEvents,
      loadSnapshot,
      performOfflineCatchUp,
      queueCommand,
      requestSave,
      requestFocusCheckpoint,
      relationshipEventPage,
      relationshipPage,
      requestRelationshipEventPage,
      requestRelationshipPage,
      requestTimelinePage,
      retryInitialization,
      status: error === null ? (frame === null ? 'booting' : 'ready') : 'faulted',
      timeline,
    }),
    [
      advanceTicks,
      error,
      events,
      frame,
      latestRecordedEvents,
      loadSnapshot,
      performOfflineCatchUp,
      queueCommand,
      requestSave,
      requestFocusCheckpoint,
      relationshipEventPage,
      relationshipPage,
      requestRelationshipEventPage,
      requestRelationshipPage,
      requestTimelinePage,
      retryInitialization,
      timeline,
    ],
  );
}
