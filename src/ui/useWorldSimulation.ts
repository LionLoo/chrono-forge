import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  WORKER_PROTOCOL_VERSION,
  type UiToWorkerMessage,
  type WorkerToUiMessage,
  type WorldFrameProjection,
} from '../protocol';
import {
  createInitialWorld,
  hashWorldState,
  stepWorld,
  type WorldConfig,
  type WorldSeed,
} from '../simulation/world';

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

export interface WorldSimulationView {
  readonly advanceTicks: (ticks: number) => void;
  readonly error: string | null;
  readonly frame: WorldFrameProjection | null;
  readonly mainThreadHash: string | null;
  readonly status: 'booting' | 'ready' | 'faulted';
}

function mainThreadHashAt(tick: number): string {
  return hashWorldState(stepWorld(createInitialWorld(DEMO_WORLD_SEED, DEMO_WORLD_CONFIG), tick));
}

export function useWorldSimulation(
  workerFactory: SimulationWorkerFactory = createBrowserWorker,
): WorldSimulationView {
  const [frame, setFrame] = useState<WorldFrameProjection | null>(null);
  const [mainThreadHash, setMainThreadHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<SimulationWorkerPort | null>(null);
  const requestSequenceRef = useRef(0);

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
    worker.onmessage = (event) => {
      const message = event.data;
      if (message.protocolVersion !== WORKER_PROTOCOL_VERSION) {
        setError('The simulation worker protocol version is not supported.');
        return;
      }

      switch (message.type) {
        case 'ready':
        case 'frameDelta':
          setFrame(message.frame);
          setMainThreadHash(mainThreadHashAt(message.frame.tick));
          setError(null);
          return;
        case 'fault':
          setError(message.message);
          return;
        case 'commandAccepted':
        case 'eventBatch':
        case 'metrics':
        case 'saveSnapshot':
          return;
      }
    };
    worker.onerror = (event) => {
      setError(event.message || 'The simulation worker stopped unexpectedly.');
    };
    worker.postMessage({
      type: 'initialize',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: nextRequestId('initialize'),
      seed: DEMO_WORLD_SEED,
      config: DEMO_WORLD_CONFIG,
    });

    return () => {
      workerRef.current = null;
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };
  }, [nextRequestId, workerFactory]);

  const advanceTicks = useCallback(
    (ticks: number) => {
      workerRef.current?.postMessage({
        type: 'advanceTicks',
        protocolVersion: WORKER_PROTOCOL_VERSION,
        requestId: nextRequestId('advance'),
        ticks,
      });
    },
    [nextRequestId],
  );

  return useMemo(
    () => ({
      advanceTicks,
      error,
      frame,
      mainThreadHash,
      status: error === null ? (frame === null ? 'booting' : 'ready') : 'faulted',
    }),
    [advanceTicks, error, frame, mainThreadHash],
  );
}
