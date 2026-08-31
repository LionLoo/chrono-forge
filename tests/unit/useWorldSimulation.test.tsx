import { act, renderHook, waitFor } from '@testing-library/react';

import type { UiToWorkerMessage, WorkerToUiMessage } from '../../src/protocol';
import { serializeWorldSnapshot } from '../../src/simulation/persistence';
import { createInitialWorld, stepWorld } from '../../src/simulation/world';
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

function createLoadReadyOnlyWorker(): SimulationWorkerPort {
  let active = true;
  const runtime = createSimulationRuntime((message: WorkerToUiMessage) => {
    if (message.type === 'metrics' && message.requestId.startsWith('load-')) return;
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

describe('world simulation UI gateway', () => {
  it('queues a closed intervention and resolves only after Worker acceptance', async () => {
    const { result } = renderHook(() => useWorldSimulation(createRuntimeWorker));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await expect(
      act(async () =>
        result.current.queueCommand({
          kind: 'intervention',
          payload: {
            interventionKind: 'protection',
            intensity: 20,
            polarity: 'supportive',
            targetTileIndex: 0,
          },
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('loads and browses bounded factual history pages through the real Worker gateway', async () => {
    const { result } = renderHook(() => useWorldSimulation(createRuntimeWorker));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const snapshot = serializeWorldSnapshot(
      stepWorld(
        createInitialWorld([101, 202, 303, 404], {
          width: 12,
          height: 8,
          chunkSize: 4,
          societyYearTicks: 5_000,
        }),
        30_000,
      ),
    );

    await act(async () => result.current.loadSnapshot(snapshot));
    expect(result.current.timeline.total).toBeGreaterThan(8);
    expect(result.current.timeline.offset).toBeGreaterThan(0);
    act(() => result.current.requestTimelinePage(0));
    await waitFor(() => expect(result.current.timeline.offset).toBe(0));
    expect(result.current.timeline.entries[0]).toStrictEqual({
      id: 1,
      tick: 0,
      summary: 'The founding world formed.',
    });
  });

  it('treats a ready frame as the authoritative completion acknowledgement for a load', async () => {
    const { result } = renderHook(() => useWorldSimulation(createLoadReadyOnlyWorker));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const snapshot = serializeWorldSnapshot(stepWorld(createInitialWorld([5, 7, 11, 13]), 100));

    await expect(act(async () => result.current.loadSnapshot(snapshot))).resolves.toBeUndefined();
    expect(result.current.frame?.tick).toBe(100);
  });

  it('requests bounded relationship and shared-event pages, then clears both after a frame change', async () => {
    const { result } = renderHook(() => useWorldSimulation(createRuntimeWorker));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const lived = stepWorld(
      createInitialWorld([19, 23, 29, 31], { societyYearTicks: 5_000 }),
      120_000,
    );
    const relationship = [
      ...lived.civilization.society.interpersonal.active,
      ...lived.civilization.society.interpersonal.archived,
    ].find((candidate) => candidate.sharedEvents.length > 0)!;
    await act(async () => result.current.loadSnapshot(serializeWorldSnapshot(lived)));

    act(() => result.current.requestRelationshipPage(relationship.firstPersonId, 0));
    await waitFor(() =>
      expect(result.current.relationshipPage.personId).toBe(relationship.firstPersonId),
    );
    expect(result.current.relationshipPage.relationships.length).toBeGreaterThan(0);
    act(() =>
      result.current.requestRelationshipEventPage(
        relationship.firstPersonId,
        `social:${relationship.id}`,
        0,
      ),
    );
    await waitFor(() =>
      expect(result.current.relationshipEventPage.relationshipId).toBe(`social:${relationship.id}`),
    );
    expect(result.current.relationshipEventPage.events.length).toBeGreaterThan(0);

    act(() => result.current.advanceTicks(1));
    await waitFor(() => expect(result.current.frame?.tick).toBe(120_001));
    expect(result.current.relationshipPage).toStrictEqual({
      personId: null,
      offset: 0,
      total: 0,
      relationships: [],
    });
    expect(result.current.relationshipEventPage).toStrictEqual({
      personId: null,
      relationshipId: null,
      offset: 0,
      total: 0,
      events: [],
    });
  });

  it('round-trips worker saves and keeps offline catch-up factual', async () => {
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

    await act(async () => {
      await result.current.performOfflineCatchUp(1_000, 5);
    });
    expect(result.current.frame?.tick).toBe(5);
    expect(result.current.events).toStrictEqual([
      {
        id: 1,
        tick: 0,
        type: 'world-generated',
        summary: 'The founding world formed.',
        subjectKind: 'world',
        subjectId: 0,
        targetKind: 'world',
        targetId: 0,
        tileIndex: -1,
        amount: 0,
      },
      {
        id: 2,
        tick: 0,
        type: 'founders-arrived',
        summary: '6 named founders established the first settlement.',
        subjectKind: 'world',
        subjectId: 0,
        targetKind: 'world',
        targetId: 0,
        tileIndex: 3120,
        amount: 6,
      },
      {
        id: 3,
        tick: 5,
        type: 'offline-catch-up',
        summary: 'Bounded offline progression reached tick 5.',
        subjectKind: 'world',
        subjectId: 0,
        targetKind: 'world',
        targetId: 0,
        tileIndex: -1,
        amount: 0,
      },
    ]);

    await act(async () => {
      await result.current.loadSnapshot(initialSnapshot);
    });
    expect(result.current.events).toStrictEqual([
      {
        id: 1,
        tick: 0,
        type: 'world-generated',
        summary: 'The founding world formed.',
        subjectKind: 'world',
        subjectId: 0,
        targetKind: 'world',
        targetId: 0,
        tileIndex: -1,
        amount: 0,
      },
      {
        id: 2,
        tick: 0,
        type: 'founders-arrived',
        summary: '6 named founders established the first settlement.',
        subjectKind: 'world',
        subjectId: 0,
        targetKind: 'world',
        targetId: 0,
        tileIndex: 3120,
        amount: 6,
      },
    ]);
  });

  it('rejects invalid snapshots from the worker boundary', async () => {
    const { result } = renderHook(() => useWorldSimulation(createRuntimeWorker));
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    await expect(result.current.loadSnapshot('{"not":"a snapshot"}')).rejects.toThrow('snapshot');
    expect(result.current.frame?.tick).toBe(0);
  });

  it('keeps the last frame when the worker rejects a load', async () => {
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
    });
  });
});
