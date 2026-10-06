import { act, renderHook, waitFor } from '@testing-library/react';

import type { UiToWorkerMessage, WorkerToUiMessage } from '../../src/protocol';
import {
  createWorldFrameDelta,
  estimateFrameDeltaPayloadBytes,
} from '../../src/protocol/frame-delta';
import { deserializeWorldSnapshot, serializeWorldSnapshot } from '../../src/simulation/persistence';
import { createInitialWorld, stepWorld } from '../../src/simulation/world';
import {
  createTestRuntimeActivityRecorder,
  type RuntimeActivitySample,
} from '../../src/testing/runtime-activity';
import {
  DEMO_WORLD_CONFIG,
  useWorldSimulation,
  type SimulationWorkerPort,
} from '../../src/ui/useWorldSimulation';
import { createSimulationRuntime, projectWorldFrame } from '../../src/workers/simulation-runtime';

function createRuntimeWorker(failingPostType?: UiToWorkerMessage['type']): SimulationWorkerPort {
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
      if (message.type === failingPostType) {
        throw new Error(`Injected ${message.type} dispatch failure`);
      }
      runtime.handleMessage(message);
    },
    terminate() {
      active = false;
    },
  };
  return port;
}

function createControlledRuntimeWorker(): {
  readonly flush: () => void;
  readonly port: SimulationWorkerPort;
} {
  let active = true;
  const delivered: WorkerToUiMessage[] = [];
  const runtime = createSimulationRuntime((message: WorkerToUiMessage) => {
    delivered.push(message);
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
  return {
    flush() {
      while (active && delivered.length > 0) {
        const message = delivered.shift();
        if (message !== undefined) port.onmessage?.(new MessageEvent('message', { data: message }));
      }
    },
    port,
  };
}

function createLoadFaultWorker(
  code: 'protocol-version-mismatch' | 'world-error' = 'world-error',
): SimulationWorkerPort {
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
                  code,
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

function createRequestFaultWorker(
  targetType: 'queueCommand' | 'requestSave',
): SimulationWorkerPort {
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
      if (message.type === targetType) {
        queueMicrotask(() => {
          if (!active) return;
          port.onmessage?.(
            new MessageEvent('message', {
              data: {
                type: 'fault',
                protocolVersion: message.protocolVersion,
                requestId: message.requestId,
                code: 'world-error',
                message: `Injected ${targetType} failure`,
              } satisfies WorkerToUiMessage,
            }),
          );
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

function createStaleDeltaWorker(): SimulationWorkerPort {
  const initial = createInitialWorld([2, 3, 5, 7]);
  const initialFrame = projectWorldFrame(initial);
  const nextFrame = projectWorldFrame(stepWorld(initial, 1));
  const delta = createWorldFrameDelta(initialFrame, nextFrame);
  let active = true;
  const port: SimulationWorkerPort = {
    onerror: null,
    onmessage: null,
    postMessage(message: UiToWorkerMessage) {
      if (message.type === 'initialize') {
        queueMicrotask(() => {
          if (active)
            port.onmessage?.(
              new MessageEvent('message', {
                data: {
                  type: 'ready',
                  protocolVersion: message.protocolVersion,
                  requestId: message.requestId,
                  frame: initialFrame,
                } satisfies WorkerToUiMessage,
              }),
            );
        });
        return;
      }
      if (message.type === 'advanceTicks') {
        queueMicrotask(() => {
          if (active)
            port.onmessage?.(
              new MessageEvent('message', {
                data: {
                  type: 'frameDelta',
                  protocolVersion: message.protocolVersion,
                  requestId: message.requestId,
                  delta: { ...delta, baseTick: delta.baseTick + 1 },
                  payloadBytes: estimateFrameDeltaPayloadBytes(delta),
                } satisfies WorkerToUiMessage,
              }),
            );
        });
      }
    },
    terminate() {
      active = false;
    },
  };
  return port;
}

function createFalseRecoveryWorker(): SimulationWorkerPort {
  const initial = createInitialWorld([11, 13, 17, 19]);
  const initialFrame = projectWorldFrame(initial);
  const nextFrame = projectWorldFrame(stepWorld(initial, 1));
  const staleDelta = {
    ...createWorldFrameDelta(initialFrame, nextFrame),
    baseTick: initialFrame.tick + 1,
  };
  let active = true;
  const port: SimulationWorkerPort = {
    onerror: null,
    onmessage: null,
    postMessage(message: UiToWorkerMessage) {
      if (message.type === 'initialize') {
        queueMicrotask(() => {
          if (!active) return;
          port.onmessage?.(
            new MessageEvent('message', {
              data: {
                type: 'ready',
                protocolVersion: message.protocolVersion,
                requestId: message.requestId,
                frame: initialFrame,
              } satisfies WorkerToUiMessage,
            }),
          );
        });
        return;
      }
      if (message.type === 'advanceTicks') {
        queueMicrotask(() => {
          if (!active) return;
          port.onmessage?.(
            new MessageEvent('message', {
              data: {
                type: 'frameDelta',
                protocolVersion: message.protocolVersion,
                requestId: message.requestId,
                delta: staleDelta,
                payloadBytes: estimateFrameDeltaPayloadBytes(staleDelta),
              } satisfies WorkerToUiMessage,
            }),
          );
          if (!active) return;
          port.onmessage?.(
            new MessageEvent('message', {
              data: {
                type: 'ready',
                protocolVersion: message.protocolVersion,
                requestId: 'false-recovery',
                frame: nextFrame,
              } satisfies WorkerToUiMessage,
            }),
          );
        });
      }
    },
    terminate() {
      active = false;
    },
  };
  return port;
}

describe('world simulation UI gateway', () => {
  it('locks the release shell to the 256 by 192 shared homeworld', () => {
    expect(DEMO_WORLD_CONFIG).toStrictEqual({
      chunkSize: 32,
      height: 192,
      societyYearTicks: 100_000,
      width: 256,
    });
  });

  it('records deterministic Worker traffic, frame applications, idle silence, and control latency', async () => {
    let nowMs = 0;
    const activity = createTestRuntimeActivityRecorder(() => nowMs);
    const worker = createControlledRuntimeWorker();
    const workerFactory = () => worker.port;
    const { result } = renderHook(() => useWorldSimulation(workerFactory, activity));

    expect(activity.samples()).toMatchObject([
      { kind: 'worker-request', messageType: 'initialize', requestId: 'initialize-1' },
    ]);
    nowMs = 4;
    act(() => worker.flush());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(activity.latencyMs('initialize-1', 'frame-applied')).toBe(4);
    expect(activity.count('frame-applied')).toBe(1);

    const idleSampleCount = activity.samples().length;
    nowMs = 1_004;
    await act(async () => Promise.resolve());
    expect(activity.samples()).toHaveLength(idleSampleCount);

    act(() => result.current.advanceTicks(1));
    const advanceRequest = activity
      .samples()
      .find(
        (sample): sample is Extract<RuntimeActivitySample, { readonly kind: 'worker-request' }> =>
          sample.kind === 'worker-request' && sample.messageType === 'advanceTicks',
      );
    expect(advanceRequest).toBeDefined();
    nowMs = 1_010;
    act(() => worker.flush());
    await waitFor(() => expect(result.current.frame?.tick).toBe(1));

    expect(activity.latencyMs(advanceRequest!.requestId, 'worker-response')).toBe(6);
    expect(activity.latencyMs(advanceRequest!.requestId, 'frame-applied')).toBe(6);
    expect(activity.sequenceDistance(advanceRequest!.requestId, 'frame-applied')).toBe(2);
    expect(
      activity
        .samples()
        .filter(
          (
            sample,
          ): sample is Extract<RuntimeActivitySample, { readonly kind: 'worker-response' }> =>
            sample.kind === 'worker-response',
        )
        .map((sample) => sample.messageType),
    ).toEqual(['ready', 'eventBatch', 'frameDelta']);
    expect(activity.count('frame-applied')).toBe(2);
  });

  it('contains activity-recorder failures without altering Worker delivery or frame application', async () => {
    let recordAttempts = 0;
    const throwingRecorder = {
      record() {
        recordAttempts += 1;
        throw new Error('Injected activity-recorder failure');
      },
    };
    const worker = createControlledRuntimeWorker();
    const workerFactory = () => worker.port;
    const { result } = renderHook(() => useWorldSimulation(workerFactory, throwingRecorder));

    expect(() => act(() => worker.flush())).not.toThrow();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.frame?.tick).toBe(0);

    expect(() =>
      act(() => {
        result.current.advanceTicks(1);
        worker.flush();
      }),
    ).not.toThrow();
    await waitFor(() => expect(result.current.frame?.tick).toBe(1));
    expect(result.current.status).toBe('ready');
    expect(recordAttempts).toBeGreaterThan(0);
  });

  it('records outbound activity only after the Worker accepts the request', async () => {
    const activity = createTestRuntimeActivityRecorder(() => 0);
    const workerFactory = () => createRuntimeWorker('advanceTicks');
    const { result } = renderHook(() => useWorldSimulation(workerFactory, activity));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    const sampleCountBeforeFailure = activity.samples().length;

    expect(() => act(() => result.current.advanceTicks(1))).toThrow(
      'Injected advanceTicks dispatch failure',
    );
    expect(activity.samples()).toHaveLength(sampleCountBeforeFailure);
    expect(
      activity
        .samples()
        .some(
          (sample) => sample.kind === 'worker-request' && sample.messageType === 'advanceTicks',
        ),
    ).toBe(false);
    expect(result.current.status).toBe('ready');
    expect(result.current.frame?.tick).toBe(0);
  });

  it('retries a failed bootstrap but cannot replace an established authoritative frame', async () => {
    let attempts = 0;
    const workerFactory = () => {
      attempts += 1;
      if (attempts === 1) throw new Error('Injected bootstrap failure');
      return createRuntimeWorker();
    };
    const { result } = renderHook(() => useWorldSimulation(workerFactory));

    await waitFor(() => expect(result.current.status).toBe('faulted'));
    expect(result.current.frame).toBeNull();
    expect(result.current.error).toBe('Injected bootstrap failure');

    act(() => result.current.retryInitialization());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.frame?.tick).toBe(0);
    expect(attempts).toBe(2);

    act(() => result.current.retryInitialization());
    expect(attempts).toBe(2);
    expect(result.current.status).toBe('ready');
    expect(result.current.frame?.tick).toBe(0);
  });

  it('rejects a stale frame delta without replacing the authoritative UI projection', async () => {
    const activity = createTestRuntimeActivityRecorder(() => 0);
    const { result } = renderHook(() => useWorldSimulation(createStaleDeltaWorker, activity));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.frame?.tick).toBe(0);
    expect(activity.count('frame-applied')).toBe(1);

    act(() => result.current.advanceTicks(1));
    await waitFor(() => expect(result.current.status).toBe('faulted'));
    expect(result.current.error).toMatch(/base tick/i);
    expect(result.current.frame?.tick).toBe(0);
    expect(activity.count('frame-applied')).toBe(1);
  });

  it('fails closed after an invalid delta instead of accepting a later replacement frame', async () => {
    const { result } = renderHook(() => useWorldSimulation(createFalseRecoveryWorker));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => result.current.advanceTicks(1));
    await waitFor(() => expect(result.current.status).toBe('faulted'));
    await act(async () => Promise.resolve());

    expect(result.current.error).toMatch(/base tick/i);
    expect(result.current.frame?.tick).toBe(0);
    expect(result.current.status).toBe('faulted');
    await expect(result.current.requestSave()).rejects.toThrow('unavailable');
  });

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
    expect(result.current.latestRecordedEvents).toStrictEqual([]);
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
    const { result } = renderHook(() => useWorldSimulation(createRuntimeWorker));
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
  }, 30_000);

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
    expect(result.current.latestRecordedEvents).toMatchObject([
      { id: 3, tick: 5, type: 'offline-catch-up' },
    ]);
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
        tileIndex: 24704,
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
    expect(result.current.latestRecordedEvents).toStrictEqual([]);
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
        tileIndex: 24704,
        amount: 6,
      },
    ]);
  });

  it('returns a focus checkpoint and snapshot from the same authoritative Worker state', async () => {
    const { result } = renderHook(() => useWorldSimulation(createRuntimeWorker));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    const baseline = await act(async () => result.current.requestFocusCheckpoint(null));
    expect(baseline.checkpoint).toMatchObject({
      latestEventId: 2,
      moment: { tick: 0 },
      recapEntries: [],
    });
    act(() => result.current.advanceTicks(100));
    await waitFor(() => expect(result.current.frame?.tick).toBe(100));
    const completed = await act(async () =>
      result.current.requestFocusCheckpoint(baseline.checkpoint.latestEventId),
    );

    expect(deserializeWorldSnapshot(completed.snapshot).tick).toBe(100);
    expect(completed.checkpoint.moment.tick).toBe(100);
    expect(completed.checkpoint.recapEntries.map((entry) => entry.id)).toEqual([3]);
  });

  it('rejects invalid snapshots from the worker boundary', async () => {
    const { result } = renderHook(() => useWorldSimulation(createRuntimeWorker));
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    await act(async () => {
      await expect(result.current.loadSnapshot('{"not":"a snapshot"}')).rejects.toThrow('snapshot');
    });
    expect(result.current.frame?.tick).toBe(0);
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeNull();
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

    await act(async () => {
      await expect(result.current.loadSnapshot(initialSnapshot)).rejects.toThrow(
        'Injected load failure',
      );
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeNull();
    act(() => {
      result.current.advanceTicks(5);
    });
    await waitFor(() => {
      expect(result.current.frame?.tick).toBe(15);
    });
  });

  it('treats a matching pending request as fatal when its fault code is a protocol failure', async () => {
    const workerFactory = () => createLoadFaultWorker('protocol-version-mismatch');
    const { result } = renderHook(() => useWorldSimulation(workerFactory));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const snapshot = await result.current.requestSave();

    await act(async () => {
      await expect(result.current.loadSnapshot(snapshot)).rejects.toThrow('Injected load failure');
    });

    expect(result.current.status).toBe('faulted');
    expect(result.current.frame?.tick).toBe(0);
    await expect(result.current.requestSave()).rejects.toThrow('unavailable');
  });

  it('fails closed when a matching save request receives a world-error fault', async () => {
    const workerFactory = () => createRequestFaultWorker('requestSave');
    const { result } = renderHook(() => useWorldSimulation(workerFactory));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await expect(result.current.requestSave()).rejects.toThrow('Injected requestSave failure');
    });

    expect(result.current.status).toBe('faulted');
    expect(result.current.frame?.tick).toBe(0);
    await expect(result.current.requestSave()).rejects.toThrow('unavailable');
  });

  it('keeps a command world-error request-scoped and leaves the Worker ready', async () => {
    const workerFactory = () => createRequestFaultWorker('queueCommand');
    const { result } = renderHook(() => useWorldSimulation(workerFactory));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await expect(
        result.current.queueCommand({
          kind: 'intervention',
          payload: {
            interventionKind: 'protection',
            intensity: 20,
            polarity: 'supportive',
            targetTileIndex: 0,
          },
        }),
      ).rejects.toThrow('Injected queueCommand failure');
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeNull();
    await expect(result.current.requestSave()).resolves.toBeTypeOf('string');
  });
});
