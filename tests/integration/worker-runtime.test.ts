import {
  STRUCTURE_STATE_CODES,
  WORKER_PROTOCOL_VERSION,
  type UiToWorkerMessage,
  type WorkerToUiMessage,
} from '../../src/protocol';
import { serializeWorldSnapshot } from '../../src/simulation/persistence';
import { appendWorldEvent, createInitialWorld } from '../../src/simulation/world';
import {
  createSimulationRuntime,
  MAX_OFFLINE_CATCH_UP_MILLISECONDS,
  MAX_OFFLINE_CATCH_UP_TICKS,
  MAX_RECENT_WORKER_EVENTS,
  OFFLINE_CATCH_UP_POLICY_VERSION,
} from '../../src/workers/simulation-runtime';

function messageOfType<TType extends WorkerToUiMessage['type']>(
  messages: readonly WorkerToUiMessage[],
  type: TType,
): Extract<WorkerToUiMessage, { type: TType }> {
  const message = messages.find((candidate) => candidate.type === type);
  if (message === undefined) {
    throw new Error(`Expected ${type} response.`);
  }
  return message as Extract<WorkerToUiMessage, { type: TType }>;
}

function lastMessageOfType<TType extends WorkerToUiMessage['type']>(
  messages: readonly WorkerToUiMessage[],
  type: TType,
): Extract<WorkerToUiMessage, { type: TType }> {
  return messageOfType([...messages].reverse(), type);
}

describe('simulation worker runtime', () => {
  it('initializes and advances a world using only typed messages', () => {
    const responses: WorkerToUiMessage[] = [];
    const runtime = createSimulationRuntime((message) => responses.push(message));
    const initialize: UiToWorkerMessage = {
      type: 'initialize',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'initialize',
      seed: [10, 20, 30, 40],
    };
    runtime.handleMessage(initialize);

    const ready = messageOfType(responses, 'ready');
    expect(ready.frame.tick).toBe(0);
    expect(ready.frame.biome.length).toBe(ready.frame.width * ready.frame.height);
    expect(ready.frame.agentIds).toStrictEqual(new Uint32Array([1, 2, 3, 4, 5, 6]));
    expect(responses.slice(0, 3).map((response) => response.type)).toStrictEqual([
      'ready',
      'eventBatch',
      'metrics',
    ]);
    expect(messageOfType(responses, 'eventBatch').events).toEqual([
      expect.objectContaining({
        id: 1,
        type: 'world-generated',
        subjectId: 0,
        targetId: 0,
        tileIndex: -1,
        amount: 0,
      }),
      expect.objectContaining({
        id: 2,
        type: 'founders-arrived',
        subjectId: 0,
        targetId: 0,
        amount: 6,
      }),
    ]);

    runtime.handleMessage({
      type: 'advanceTicks',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'advance',
      ticks: 7,
    });
    const frame = messageOfType(responses, 'frameDelta');
    expect(frame.frame.tick).toBe(7);
    expect(lastMessageOfType(responses, 'metrics').metrics.tick).toBe(7);
  });

  it('projects M4 society facts and serves every history page through the Worker', () => {
    const responses: WorkerToUiMessage[] = [];
    const runtime = createSimulationRuntime((message) => responses.push(message));
    runtime.handleMessage({
      type: 'initialize',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'society-initialize',
      seed: [101, 202, 303, 404],
      config: { width: 12, height: 8, chunkSize: 4, societyYearTicks: 5_000 },
    });
    runtime.handleMessage({
      type: 'advanceTicks',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'society-advance',
      ticks: 30_000,
    });

    const society = lastMessageOfType(responses, 'frameDelta').frame.society;
    expect(society.dashboard.population).toBeGreaterThanOrEqual(6);
    expect(society.people).toHaveLength(society.dashboard.population);
    expect(society.cultures).toHaveLength(2);
    expect(society.timelineTotal).toBeGreaterThan(8);

    runtime.handleMessage({
      type: 'requestTimelinePage',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'history-first',
      offset: 0,
    });
    const first = lastMessageOfType(responses, 'timelinePage');
    expect(first.offset).toBe(0);
    expect(first.timeline).toHaveLength(8);
    expect(first.timeline[0]).toMatchObject({ id: 1, summary: 'The founding world formed.' });

    runtime.handleMessage({
      type: 'requestTimelinePage',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'history-last',
      offset: Number.MAX_SAFE_INTEGER,
    });
    const last = lastMessageOfType(responses, 'timelinePage');
    expect(last.total).toBe(first.total);
    expect(last.offset).toBe(Math.floor((last.total - 1) / 8) * 8);
    expect(last.timeline.at(-1)?.id).toBe(society.timeline.at(-1)?.id);
  });

  it('bounds recent event batches while keeping older history Worker-browsable', () => {
    let world = createInitialWorld([1, 2, 3, 4], { width: 4, height: 3, chunkSize: 2 });
    for (let index = 0; index < MAX_RECENT_WORKER_EVENTS + 12; index += 1) {
      world = appendWorldEvent(world, 'bounded-history-fixture', world.tick, {
        summary: `Recorded bounded history fixture ${index + 1}.`,
      });
    }
    const responses: WorkerToUiMessage[] = [];
    const runtime = createSimulationRuntime((message) => responses.push(message));
    runtime.handleMessage({
      type: 'load',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'bounded-load',
      snapshot: serializeWorldSnapshot(world),
    });

    expect(messageOfType(responses, 'eventBatch').events).toHaveLength(MAX_RECENT_WORKER_EVENTS);
    expect(messageOfType(responses, 'ready').frame.society.timelineTotal).toBe(
      MAX_RECENT_WORKER_EVENTS + 14,
    );
    runtime.handleMessage({
      type: 'requestTimelinePage',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'bounded-first-page',
      offset: 0,
    });
    expect(lastMessageOfType(responses, 'timelinePage').timeline[0]).toMatchObject({ id: 1 });
  });

  it('returns typed faults for uninitialized, unsupported, and wrong-version operations', () => {
    const responses: WorkerToUiMessage[] = [];
    const runtime = createSimulationRuntime((message) => responses.push(message));
    runtime.handleMessage({
      type: 'advanceTicks',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'uninitialized',
      ticks: 1,
    });
    runtime.handleMessage({
      type: 'queueCommand',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'command',
      command: { kind: 'focus-session', payload: {} },
    });
    runtime.handleMessage({
      type: 'requestSave',
      protocolVersion: WORKER_PROTOCOL_VERSION + 1,
      requestId: 'wrong-version',
    });

    expect(responses).toMatchObject([
      { type: 'fault', code: 'not-initialized' },
      { type: 'fault', code: 'unsupported-operation' },
      { type: 'fault', code: 'protocol-version-mismatch' },
    ]);
  });

  it('restores the same authoritative M3 projection and factual events after a shelter becomes operational', () => {
    const firstResponses: WorkerToUiMessage[] = [];
    const first = createSimulationRuntime((message) => firstResponses.push(message));
    first.handleMessage({
      type: 'initialize',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'initialize-save',
      seed: [5, 6, 7, 8],
      config: { width: 7, height: 5, chunkSize: 3 },
    });
    first.handleMessage({
      type: 'advanceTicks',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'advance-save',
      ticks: 15_000,
    });
    first.handleMessage({
      type: 'requestSave',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'save',
    });
    const saved = messageOfType(firstResponses, 'saveSnapshot');
    const expected = lastMessageOfType(firstResponses, 'frameDelta').frame;
    const expectedEvents = firstResponses
      .filter(
        (response): response is Extract<WorkerToUiMessage, { type: 'eventBatch' }> =>
          response.type === 'eventBatch',
      )
      .flatMap((response) => response.events);
    expect(expected.structureStates).toContain(STRUCTURE_STATE_CODES.operational);
    expect(expectedEvents).toContainEqual(expect.objectContaining({ type: 'shelter-operational' }));

    const loadedResponses: WorkerToUiMessage[] = [];
    const loaded = createSimulationRuntime((message) => loadedResponses.push(message));
    loaded.handleMessage({
      type: 'load',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'load',
      snapshot: saved.snapshot,
    });
    const ready = messageOfType(loadedResponses, 'ready');
    const restoredEvents = messageOfType(loadedResponses, 'eventBatch').events;
    expect(ready.frame.tick).toBe(15_000);
    expect(ready.frame.stateHash).toBe(expected.stateHash);
    expect(ready.frame.agentIds).toStrictEqual(expected.agentIds);
    expect(ready.frame.agentTiles).toStrictEqual(expected.agentTiles);
    expect(ready.frame.agentHealth).toStrictEqual(expected.agentHealth);
    expect(ready.frame.agentActions).toStrictEqual(expected.agentActions);
    expect(ready.frame.structureIds).toStrictEqual(expected.structureIds);
    expect(ready.frame.structureTiles).toStrictEqual(expected.structureTiles);
    expect(ready.frame.structureKinds).toStrictEqual(expected.structureKinds);
    expect(ready.frame.structureStates).toStrictEqual(expected.structureStates);
    expect(ready.frame.structureProgress).toStrictEqual(expected.structureProgress);
    expect(ready.frame.structureCondition).toStrictEqual(expected.structureCondition);
    expect(ready.frame.settlementSummary).toStrictEqual(expected.settlementSummary);
    expect(restoredEvents).toStrictEqual(expectedEvents);
  });

  it('performs deterministic bounded offline catch-up and emits only factual event ids', () => {
    const responses: WorkerToUiMessage[] = [];
    const runtime = createSimulationRuntime((message) => responses.push(message));
    runtime.handleMessage({
      type: 'initialize',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'offline-initialize',
      seed: [10, 20, 30, 40],
    });
    runtime.handleMessage({
      type: 'performOfflineCatchUp',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'offline',
      elapsedMilliseconds: 2_000,
      rate: 5,
      policyVersion: OFFLINE_CATCH_UP_POLICY_VERSION,
    });

    expect(lastMessageOfType(responses, 'frameDelta').frame.tick).toBe(10);
    expect(lastMessageOfType(responses, 'eventBatch').events).toStrictEqual([
      {
        id: 3,
        tick: 10,
        type: 'offline-catch-up',
        summary: 'Bounded offline progression reached tick 10.',
        subjectKind: 'world',
        subjectId: 0,
        targetKind: 'world',
        targetId: 0,
        tileIndex: -1,
        amount: 0,
      },
    ]);

    runtime.handleMessage({
      type: 'performOfflineCatchUp',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'offline-clamped',
      elapsedMilliseconds: MAX_OFFLINE_CATCH_UP_MILLISECONDS + 1,
      rate: 1_000,
      policyVersion: OFFLINE_CATCH_UP_POLICY_VERSION,
    });
    expect(lastMessageOfType(responses, 'frameDelta').frame.tick).toBe(
      10 + MAX_OFFLINE_CATCH_UP_TICKS,
    );
  }, 30_000);

  it('rejects invalid offline input and unsupported policy versions', () => {
    const responses: WorkerToUiMessage[] = [];
    const runtime = createSimulationRuntime((message) => responses.push(message));
    runtime.handleMessage({
      type: 'initialize',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'policy-initialize',
      seed: [1, 1, 2, 3],
    });
    runtime.handleMessage({
      type: 'performOfflineCatchUp',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'negative-elapsed',
      elapsedMilliseconds: -1,
      rate: 1,
      policyVersion: OFFLINE_CATCH_UP_POLICY_VERSION,
    });
    runtime.handleMessage({
      type: 'performOfflineCatchUp',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'unknown-policy',
      elapsedMilliseconds: 1_000,
      rate: 1,
      policyVersion: 99,
    });
    expect(responses.slice(-2)).toMatchObject([
      { type: 'fault', code: 'invalid-request', requestId: 'negative-elapsed' },
      { type: 'fault', code: 'unsupported-operation', requestId: 'unknown-policy' },
    ]);
  });

  it('contains malformed structured-clone input behind typed invalid-request faults', () => {
    const responses: WorkerToUiMessage[] = [];
    const runtime = createSimulationRuntime((message) => responses.push(message));
    const malformedMessages: readonly unknown[] = [
      null,
      {},
      { requestId: 'missing-type', protocolVersion: WORKER_PROTOCOL_VERSION },
      {
        requestId: 'bad-ticks',
        type: 'advanceTicks',
        protocolVersion: WORKER_PROTOCOL_VERSION,
        ticks: 'seven',
      },
      {
        requestId: 'bad-seed',
        type: 'initialize',
        protocolVersion: WORKER_PROTOCOL_VERSION,
        seed: [1, 2, 3],
      },
      {
        requestId: 'unknown-type',
        type: 'eraseWorld',
        protocolVersion: WORKER_PROTOCOL_VERSION,
      },
    ];

    for (const message of malformedMessages) {
      expect(() => runtime.handleMessage(message)).not.toThrow();
    }

    expect(responses).toMatchObject([
      { type: 'fault', code: 'invalid-request', requestId: 'invalid-request' },
      { type: 'fault', code: 'invalid-request', requestId: 'invalid-request' },
      { type: 'fault', code: 'invalid-request', requestId: 'missing-type' },
      { type: 'fault', code: 'invalid-request', requestId: 'bad-ticks' },
      { type: 'fault', code: 'invalid-request', requestId: 'bad-seed' },
      { type: 'fault', code: 'invalid-request', requestId: 'unknown-type' },
    ]);
  });

  it('preserves the version fault for numeric unsupported versions before request-specific validation', () => {
    const responses: WorkerToUiMessage[] = [];
    const runtime = createSimulationRuntime((message) => responses.push(message));

    expect(() =>
      runtime.handleMessage({
        requestId: 'old-client',
        type: 'advanceTicks',
        protocolVersion: 99,
        ticks: 'not checked for an unsupported protocol version',
      }),
    ).not.toThrow();

    expect(responses).toMatchObject([
      {
        type: 'fault',
        code: 'protocol-version-mismatch',
        requestId: 'old-client',
      },
    ]);
  });
});
