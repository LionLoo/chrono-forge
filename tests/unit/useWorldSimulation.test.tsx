import { act, renderHook, waitFor } from '@testing-library/react';

import type { UiToWorkerMessage, WorkerToUiMessage } from '../../src/protocol';
import { useWorldSimulation, type SimulationWorkerPort } from '../../src/ui/useWorldSimulation';
import { createSimulationRuntime } from '../../src/workers/simulation-runtime';

function createRuntimeWorker(): SimulationWorkerPort {
  let active = true;
  const runtime = createSimulationRuntime((message: WorkerToUiMessage) => {
    queueMicrotask(() => {
      if (active) port.onmessage?.(new MessageEvent('message', { data: message }));
    });
  });
  const port: SimulationWorkerPort = {
    onerror: null,
    onmessage: null,
    postMessage(message: UiToWorkerMessage) {
      runtime.handleMessage(message);
    },
    terminate() {
      active = false;
    },
  };
  return port;
}

function createLoadFaultWorker(): SimulationWorkerPort {
  let active = true;
  const runtime = createSimulationRuntime((message: WorkerToUiMessage) => {
    queueMicrotask(() => {
      if (active) port.onmessage?.(new MessageEvent('message', { data: message }));
    });
  });
  const port: SimulationWorkerPort = {
    onerror: null,
    onmessage: null,
    postMessage(message: UiToWorkerMessage) {
      if (message.type === 'load') {
        queueMicrotask(() => {
          if (active) {
            port.onmessage?.(
              new MessageEvent('message', {
                data: {
                  type: 'fault',
                  protocolVersion: message.protocolVersion,
                  requestId: message.requestId,
                  code: 'world-error',
                  message: 'Injected load failure',
                } satisfies WorkerToUiMessage,
              }),
            );
          }
        });
        return;
      }
      runtime.handleMessage(message);
    },
    terminate() {
      active = false;
    },
  };
  return port;
}

describe('world simulation UI gateway', () => {
  it('round-trips saves and keeps offline catch-up mirrored and factual', async () => {
    const { result } = renderHook(() => useWorldSimulation(createRuntimeWorker));
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    let initialSnapshot = '';
    await act(async () => {
      initialSnapshot = await result.current.requestSave();
    });
    act(() => {
      result.current.advanceTicks(25);
    });
    await waitFor(() => {
      expect(result.current.frame?.tick).toBe(25);
    });

    await act(async () => {
      await result.current.loadSnapshot(initialSnapshot);
    });
    expect(result.current.frame?.tick).toBe(0);
    expect(result.current.frame?.stateHash).toBe(result.current.mainThreadHash);

    await act(async () => {
      await result.current.performOfflineCatchUp(1_000, 5);
    });
    expect(result.current.frame?.tick).toBe(5);
    expect(result.current.frame?.stateHash).toBe(result.current.mainThreadHash);
    expect(result.current.events).toStrictEqual([
      { id: 1, tick: 0, type: 'world-generated', subjectId: 0 },
      { id: 2, tick: 5, type: 'offline-catch-up', subjectId: 0 },
    ]);

    await act(async () => {
      await result.current.loadSnapshot(initialSnapshot);
    });
    expect(result.current.events).toStrictEqual([
      { id: 1, tick: 0, type: 'world-generated', subjectId: 0 },
    ]);
  });

  it('rejects invalid snapshots before crossing the worker boundary', async () => {
    const { result } = renderHook(() => useWorldSimulation(createRuntimeWorker));
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    await expect(result.current.loadSnapshot('{"not":"a snapshot"}')).rejects.toThrow('snapshot');
    expect(result.current.frame?.tick).toBe(0);
  });

  it('rolls speculative mirror state back when the worker rejects a load', async () => {
    const { result } = renderHook(() => useWorldSimulation(createLoadFaultWorker));
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    const initialSnapshot = await result.current.requestSave();
    act(() => {
      result.current.advanceTicks(10);
    });
    await waitFor(() => {
      expect(result.current.frame?.tick).toBe(10);
    });

    await expect(result.current.loadSnapshot(initialSnapshot)).rejects.toThrow(
      'Injected load failure',
    );
    act(() => {
      result.current.advanceTicks(5);
    });
    await waitFor(() => {
      expect(result.current.frame?.tick).toBe(15);
      expect(result.current.frame?.stateHash).toBe(result.current.mainThreadHash);
    });
  });
});
