import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  WORKER_PROTOCOL_VERSION,
  type UiToWorkerMessage,
  type WorkerEvent,
  type WorkerToUiMessage,
  type WorldFrameProjection,
} from '../protocol';
import { deserializeWorldSnapshot } from '../simulation/persistence';
import {
  appendWorldEvent,
  createInitialWorld,
  hashWorldState,
  stepWorld,
  type WorldConfig,
  type WorldSeed,
  type WorldState,
} from '../simulation/world';
import {
  MAX_OFFLINE_CATCH_UP_MILLISECONDS,
  MAX_OFFLINE_CATCH_UP_TICKS,
  OFFLINE_CATCH_UP_POLICY_VERSION,
} from '../workers/simulation-runtime';

export const DEMO_WORLD_SEED: WorldSeed = Object.freeze([
  0x4348_524f, 0x4e4f_464f, 0x5247_4531, 0x0000_0001,
]);
export const DEMO_WORLD_CONFIG: WorldConfig = Object.freeze({
  width: 96,
  height: 64,
  chunkSize: 32,
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

interface PendingVoidRequest {
  readonly reject: (reason: Error) => void;
  readonly resolve: () => void;
}

interface PendingSaveRequest {
  readonly reject: (reason: Error) => void;
  readonly resolve: (snapshot: string) => void;
}

export interface WorldSimulationView {
  readonly advanceTicks: (ticks: number) => void;
  readonly error: string | null;
  readonly events: readonly WorkerEvent[];
  readonly frame: WorldFrameProjection | null;
  readonly loadSnapshot: (snapshot: string) => Promise<void>;
  readonly mainThreadHash: string | null;
  readonly performOfflineCatchUp: (elapsedMilliseconds: number, rate: number) => Promise<void>;
  readonly requestSave: () => Promise<string>;
  readonly status: 'booting' | 'ready' | 'faulted';
}

function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
}

function mirrorOfflineCatchUp(
  world: WorldState,
  elapsedMilliseconds: number,
  rate: number,
): WorldState {
  const elapsed = Math.min(elapsedMilliseconds, MAX_OFFLINE_CATCH_UP_MILLISECONDS);
  const ticks = Math.min(Math.floor((elapsed * rate) / 1_000), MAX_OFFLINE_CATCH_UP_TICKS);
  return ticks === 0 ? world : appendWorldEvent(stepWorld(world, ticks), 'offline-catch-up');
}

export function useWorldSimulation(
  workerFactory: SimulationWorkerFactory = createBrowserWorker,
): WorldSimulationView {
  const [frame, setFrame] = useState<WorldFrameProjection | null>(null);
  const [mainThreadHash, setMainThreadHash] = useState<string | null>(null);
  const [events, setEvents] = useState<readonly WorkerEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<SimulationWorkerPort | null>(null);
  const mirrorWorldRef = useRef<WorldState | null>(null);
  const projectedWorldRef = useRef<WorldState | null>(null);
  const requestSequenceRef = useRef(0);
  const expectedWorldsRef = useRef(new Map<string, WorldState>());
  const pendingSavesRef = useRef(new Map<string, PendingSaveRequest>());
  const pendingLoadsRef = useRef(new Map<string, PendingVoidRequest>());
  const pendingOfflineRef = useRef(new Map<string, PendingVoidRequest>());

  const nextRequestId = useCallback((kind: string) => {
    requestSequenceRef.current += 1;
    return `${kind}-${requestSequenceRef.current}`;
  }, []);

  useEffect(() => {
    let worker: SimulationWorkerPort;
    try {
      worker = workerFactory();
    } catch (workerError) {
      const reason =
        workerError instanceof Error ? workerError.message : 'Simulation worker unavailable.';
      queueMicrotask(() => {
        setError(reason);
      });
      return;
    }

    workerRef.current = worker;
    const expectedWorlds = expectedWorldsRef.current;
    const pendingSaves = pendingSavesRef.current;
    const pendingLoads = pendingLoadsRef.current;
    const pendingOffline = pendingOfflineRef.current;
    const rejectRequest = (requestId: string, reason: Error) => {
      const pendingSave = pendingSaves.get(requestId);
      if (pendingSave !== undefined) {
        pendingSaves.delete(requestId);
        pendingSave.reject(reason);
      }
      const pendingLoad = pendingLoads.get(requestId);
      if (pendingLoad !== undefined) {
        pendingLoads.delete(requestId);
        pendingLoad.reject(reason);
      }
      const offlineRequest = pendingOffline.get(requestId);
      if (offlineRequest !== undefined) {
        pendingOffline.delete(requestId);
        offlineRequest.reject(reason);
      }
    };
    const rejectAll = (reason: Error) => {
      for (const pending of pendingSaves.values()) pending.reject(reason);
      for (const pending of pendingLoads.values()) pending.reject(reason);
      for (const pending of pendingOffline.values()) pending.reject(reason);
      pendingSaves.clear();
      pendingLoads.clear();
      pendingOffline.clear();
    };
    const applyFrame = (
      requestId: string,
      nextFrame: WorldFrameProjection,
      replaceEvents: boolean,
    ) => {
      const expectedWorld = expectedWorlds.get(requestId);
      setFrame(nextFrame);
      setMainThreadHash(expectedWorld === undefined ? null : hashWorldState(expectedWorld));
      if (expectedWorld !== undefined) {
        mirrorWorldRef.current = expectedWorld;
        expectedWorlds.delete(requestId);
        if (expectedWorlds.size === 0) projectedWorldRef.current = expectedWorld;
        if (replaceEvents) {
          setEvents(
            expectedWorld.eventLog.map((worldEvent) => ({
              id: worldEvent.id,
              tick: worldEvent.tick,
              type: worldEvent.kind,
              subjectId: 0,
            })),
          );
        }
      }
      if (expectedWorld !== undefined) setError(null);
    };

    worker.onmessage = (event) => {
      const message = event.data;
      if (message.protocolVersion !== WORKER_PROTOCOL_VERSION) {
        const reason = new Error('The simulation worker protocol version is not supported.');
        rejectAll(reason);
        setError(reason.message);
        return;
      }

      switch (message.type) {
        case 'ready': {
          applyFrame(message.requestId, message.frame, true);
          const pending = pendingLoads.get(message.requestId);
          if (pending !== undefined) {
            pendingLoads.delete(message.requestId);
            pending.resolve();
          }
          return;
        }
        case 'frameDelta':
          applyFrame(message.requestId, message.frame, false);
          return;
        case 'eventBatch':
          setEvents((current) => {
            const byId = new Map(current.map((worldEvent) => [worldEvent.id, worldEvent]));
            for (const worldEvent of message.events) byId.set(worldEvent.id, worldEvent);
            return [...byId.values()].sort(
              (left, right) => left.tick - right.tick || left.id - right.id,
            );
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
        case 'metrics': {
          const pending = pendingOffline.get(message.requestId);
          if (pending !== undefined) {
            pendingOffline.delete(message.requestId);
            pending.resolve();
          }
          return;
        }
        case 'fault': {
          const reason = new Error(message.message);
          expectedWorlds.clear();
          projectedWorldRef.current = mirrorWorldRef.current;
          rejectRequest(message.requestId, reason);
          rejectAll(reason);
          setError(message.message);
          return;
        }
        case 'commandAccepted':
          return;
      }
    };
    worker.onerror = (event) => {
      const reason = new Error(event.message || 'The simulation worker stopped unexpectedly.');
      rejectAll(reason);
      setError(reason.message);
    };

    const initialWorld = createInitialWorld(DEMO_WORLD_SEED, DEMO_WORLD_CONFIG);
    projectedWorldRef.current = initialWorld;
    const requestId = nextRequestId('initialize');
    expectedWorlds.set(requestId, initialWorld);
    worker.postMessage({
      type: 'initialize',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId,
      seed: DEMO_WORLD_SEED,
      config: DEMO_WORLD_CONFIG,
    });

    return () => {
      const reason = new Error('The simulation worker was closed before the request completed.');
      rejectAll(reason);
      expectedWorlds.clear();
      projectedWorldRef.current = null;
      mirrorWorldRef.current = null;
      workerRef.current = null;
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };
  }, [nextRequestId, workerFactory]);

  const advanceTicks = useCallback(
    (ticks: number) => {
      assertNonNegativeSafeInteger(ticks, 'Advance ticks');
      const worker = workerRef.current;
      const mirror = projectedWorldRef.current;
      if (worker === null || mirror === null) return;
      const nextMirror = stepWorld(mirror, ticks);
      projectedWorldRef.current = nextMirror;
      const requestId = nextRequestId('advance');
      expectedWorldsRef.current.set(requestId, nextMirror);
      worker.postMessage({
        type: 'advanceTicks',
        protocolVersion: WORKER_PROTOCOL_VERSION,
        requestId,
        ticks,
      });
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
    worker.postMessage({
      type: 'requestSave',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId,
    });
    return promise;
  }, [nextRequestId]);

  const loadSnapshot = useCallback(
    (snapshot: string): Promise<void> => {
      const worker = workerRef.current;
      if (worker === null)
        return Promise.reject(new Error('The simulation worker is unavailable.'));
      let mirror: WorldState;
      try {
        mirror = deserializeWorldSnapshot(snapshot);
      } catch (snapshotError) {
        return Promise.reject(
          snapshotError instanceof Error ? snapshotError : new Error('The snapshot is invalid.'),
        );
      }
      projectedWorldRef.current = mirror;
      const requestId = nextRequestId('load');
      expectedWorldsRef.current.set(requestId, mirror);
      const promise = new Promise<void>((resolve, reject) => {
        pendingLoadsRef.current.set(requestId, { resolve, reject });
      });
      worker.postMessage({
        type: 'load',
        protocolVersion: WORKER_PROTOCOL_VERSION,
        requestId,
        snapshot,
      });
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
      const mirror = projectedWorldRef.current;
      if (worker === null || mirror === null)
        return Promise.reject(new Error('The simulation worker is unavailable.'));
      const nextMirror = mirrorOfflineCatchUp(mirror, elapsedMilliseconds, rate);
      projectedWorldRef.current = nextMirror;
      const requestId = nextRequestId('offline');
      expectedWorldsRef.current.set(requestId, nextMirror);
      const promise = new Promise<void>((resolve, reject) => {
        pendingOfflineRef.current.set(requestId, { resolve, reject });
      });
      worker.postMessage({
        type: 'performOfflineCatchUp',
        protocolVersion: WORKER_PROTOCOL_VERSION,
        requestId,
        elapsedMilliseconds,
        rate,
        policyVersion: OFFLINE_CATCH_UP_POLICY_VERSION,
      });
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
      loadSnapshot,
      mainThreadHash,
      performOfflineCatchUp,
      requestSave,
      status: error === null ? (frame === null ? 'booting' : 'ready') : 'faulted',
    }),
    [
      advanceTicks,
      error,
      events,
      frame,
      loadSnapshot,
      mainThreadHash,
      performOfflineCatchUp,
      requestSave,
    ],
  );
}
