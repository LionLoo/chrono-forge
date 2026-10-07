import {
  MAX_ADVANCE_TICKS_PER_REQUEST,
  STRUCTURE_STATE_CODES,
  WORKER_PROTOCOL_VERSION,
  type UiToWorkerMessage,
  type WorkerToUiMessage,
  type WorldFrameProjection,
} from '../../src/protocol';
import {
  applyWorldFrameDelta,
  estimateFrameDeltaPayloadBytes,
  frameDeltaTransferables,
} from '../../src/protocol/frame-delta';
import { serializeWorldSnapshot } from '../../src/simulation/persistence';
import { appendWorldEvent, createInitialWorld, stepWorld } from '../../src/simulation/world';
import {
  createSimulationRuntime,
  MAX_OFFLINE_CATCH_UP_MILLISECONDS,
  MAX_OFFLINE_CATCH_UP_TICKS,
  MAX_RECENT_WORKER_EVENTS,
  OFFLINE_CATCH_UP_POLICY_VERSION,
  projectWorldFrame,
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

function reconstructedFrame(messages: readonly WorkerToUiMessage[]): WorldFrameProjection {
  let frame: WorldFrameProjection | undefined;
  for (const message of messages) {
    if (message.type === 'ready') frame = message.frame;
    if (message.type === 'frameDelta') {
      if (frame === undefined) throw new Error('Worker sent a delta before ready.');
      frame = applyWorldFrameDelta(frame, message.delta);
    }
  }
  if (frame === undefined) throw new Error('Worker did not emit a frame.');
  return frame;
}

describe('simulation worker runtime', () => {
  it('establishes a full ready base, then sends ordered reconstructable deltas with exact transfers', () => {
    const responses: WorkerToUiMessage[] = [];
    const transferByteLengths: number[][] = [];
    const runtime = createSimulationRuntime((message, transfer) => {
      transferByteLengths.push(transfer.map((buffer) => buffer.byteLength));
      responses.push(message);
    });
    runtime.handleMessage({
      type: 'initialize',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'delta-initialize',
      seed: [10, 20, 30, 40],
    });
    const ready = messageOfType(responses, 'ready');
    runtime.handleMessage({
      type: 'advanceTicks',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'delta-advance',
      ticks: 7,
    });
    const delta = lastMessageOfType(responses, 'frameDelta');

    expect(delta.delta).toMatchObject({ baseTick: ready.frame.tick, tick: 7 });
    expect(reconstructedFrame(responses)).toStrictEqual(
      projectWorldFrame(stepWorld(createInitialWorld([10, 20, 30, 40]), 7)),
    );
    expect(transferByteLengths[responses.lastIndexOf(delta)]).toStrictEqual(
      frameDeltaTransferables(delta.delta).map((buffer) => buffer.byteLength),
    );
    expect(delta.payloadBytes).toBe(estimateFrameDeltaPayloadBytes(delta.delta));

    runtime.handleMessage({
      type: 'advanceTicks',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'no-change-advance',
      ticks: 0,
    });
    const noChange = lastMessageOfType(responses, 'frameDelta');
    expect(noChange.delta).toMatchObject({ baseTick: 7, tick: 7 });
    expect(frameDeltaTransferables(noChange.delta)).toStrictEqual([]);
  });

  it('resets the ordered delta base after load', () => {
    const responses: WorkerToUiMessage[] = [];
    const runtime = createSimulationRuntime((message) => responses.push(message));
    const snapshot = serializeWorldSnapshot(stepWorld(createInitialWorld([11, 13, 17, 19]), 20));
    runtime.handleMessage({
      type: 'initialize',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'load-base-initialize',
      seed: [2, 3, 5, 7],
    });
    runtime.handleMessage({
      type: 'advanceTicks',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'before-load',
      ticks: 10,
    });
    runtime.handleMessage({
      type: 'load',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'reset-base-load',
      snapshot,
    });
    const loadedReady = lastMessageOfType(responses, 'ready');
    runtime.handleMessage({
      type: 'advanceTicks',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'after-load',
      ticks: 1,
    });
    const delta = lastMessageOfType(responses, 'frameDelta');

    expect(loadedReady.frame.tick).toBe(20);
    expect(delta.delta.baseTick).toBe(20);
    expect(reconstructedFrame(responses).tick).toBe(21);
  });

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
    expect(
      createInitialWorld([10, 20, 30, 40]).space.aliens.some(
        (alien) => alien.discoveredTick === null,
      ),
    ).toBe(true);
    expect(ready.frame.space.aliens).toStrictEqual([]);
    expect(responses.slice(0, 2).map((response) => response.type)).toStrictEqual([
      'ready',
      'eventBatch',
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
    const delta = messageOfType(responses, 'frameDelta');
    expect(delta.delta).toMatchObject({ baseTick: 0, tick: 7 });
    expect(reconstructedFrame(responses).tick).toBe(7);
  });

  it('emits only responses with UI consumers for ordinary interactive requests', () => {
    const responses: WorkerToUiMessage[] = [];
    const runtime = createSimulationRuntime((message) => responses.push(message));
    const responseTypes = (requestId: string) =>
      responses.filter((message) => message.requestId === requestId).map((message) => message.type);

    runtime.handleMessage({
      type: 'initialize',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'traffic-initialize',
      seed: [3, 5, 7, 11],
    });
    expect(responseTypes('traffic-initialize')).toStrictEqual(['ready', 'eventBatch']);

    runtime.handleMessage({
      type: 'setRunMode',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'traffic-run-mode',
      runMode: 'running',
    });
    expect(responseTypes('traffic-run-mode')).toStrictEqual(['metrics']);
    expect(lastMessageOfType(responses, 'metrics').metrics.runMode).toBe('running');

    runtime.handleMessage({
      type: 'advanceTicks',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'traffic-advance',
      ticks: 0,
    });
    expect(responseTypes('traffic-advance')).toStrictEqual(['frameDelta']);

    runtime.handleMessage({
      type: 'queueCommand',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'traffic-command',
      command: {
        kind: 'intervention',
        payload: {
          interventionKind: 'protection',
          intensity: 25,
          polarity: 'supportive',
          targetTileIndex: 0,
        },
      },
    });
    expect(responseTypes('traffic-command')).toStrictEqual(['commandAccepted']);

    runtime.handleMessage({
      type: 'load',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'traffic-load',
      snapshot: serializeWorldSnapshot(createInitialWorld([13, 17, 19, 23])),
    });
    expect(responseTypes('traffic-load')).toStrictEqual(['ready', 'eventBatch']);
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

    const society = reconstructedFrame(responses).society;
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

  it('matches the authoritative M6 read-only projection after Worker execution', () => {
    const seed = [7, 11, 13, 17] as const;
    const config = { societyYearTicks: 5_000 };
    const expected = projectWorldFrame(stepWorld(createInitialWorld(seed, config), 25_000));
    const responses: WorkerToUiMessage[] = [];
    const runtime = createSimulationRuntime((message) => responses.push(message));
    runtime.handleMessage({
      type: 'initialize',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'm6-initialize',
      seed,
      config,
    });
    runtime.handleMessage({
      type: 'advanceTicks',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'm6-advance',
      ticks: 25_000,
    });

    const frame = reconstructedFrame(responses);
    expect(frame.civilizations).toStrictEqual(expected.civilizations);
    expect(frame.civilizations.tileOwners).not.toBe(expected.civilizations.tileOwners);
    expect(frame.civilizations.settlements.map((settlement) => settlement.id)).toStrictEqual(
      [...frame.civilizations.settlements]
        .sort((left, right) => left.id - right.id)
        .map((settlement) => settlement.id),
    );
    expect(
      frame.civilizations.settlements.every((settlement) =>
        ['founding', 'village', 'town', 'city', 'advanced-city'].includes(
          settlement.developmentStage,
        ),
      ),
    ).toBe(true);
  });

  it('bounds recent event batches while keeping older history Worker-browsable', () => {
    let world = createInitialWorld([1, 2, 3, 4], { width: 4, height: 3, chunkSize: 2 });
    for (let index = 0; index < MAX_RECENT_WORKER_EVENTS + 12; index += 1) {
      world = appendWorldEvent(world, 'offline-catch-up', world.tick, {
        summary: `Bounded offline history fixture ${index + 1} reached tick ${world.tick}.`,
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
      { type: 'fault', code: 'invalid-request' },
      { type: 'fault', code: 'protocol-version-mismatch' },
    ]);
  });

  it('queues a condition-only intervention and applies it at the next civil-year boundary', () => {
    const responses: WorkerToUiMessage[] = [];
    const runtime = createSimulationRuntime((message) => responses.push(message));
    runtime.handleMessage({
      type: 'initialize',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'm5-initialize',
      seed: [53, 59, 61, 67],
      config: { societyYearTicks: 5_000 },
    });
    runtime.handleMessage({
      type: 'queueCommand',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'm5-intervention',
      command: {
        kind: 'intervention',
        payload: {
          interventionKind: 'protection',
          intensity: 30,
          polarity: 'supportive',
          targetTileIndex: 0,
        },
      },
    });
    expect(lastMessageOfType(responses, 'commandAccepted')).toMatchObject({
      sequence: 1,
      targetTick: 5_000,
    });

    runtime.handleMessage({
      type: 'advanceTicks',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'm5-advance',
      ticks: 5_000,
    });
    expect(reconstructedFrame(responses).development.conditions.protection).toBe(29);
    expect(lastMessageOfType(responses, 'eventBatch').events).toContainEqual(
      expect.objectContaining({ type: 'protection-intervened', tick: 5_000 }),
    );
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
    const expected = reconstructedFrame(firstResponses);
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

    expect(
      responses.filter((message) => message.requestId === 'offline').map((message) => message.type),
    ).toStrictEqual(['frameDelta', 'eventBatch', 'metrics']);
    expect(lastMessageOfType(responses, 'metrics').metrics.tick).toBe(10);
    expect(reconstructedFrame(responses).tick).toBe(10);
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
    expect(reconstructedFrame(responses).tick).toBe(10 + MAX_OFFLINE_CATCH_UP_TICKS);
    const clampedEvents = lastMessageOfType(responses, 'eventBatch').events;
    expect(clampedEvents.length).toBeLessThanOrEqual(MAX_RECENT_WORKER_EVENTS);
    expect(clampedEvents.at(-1)).toMatchObject({ type: 'offline-catch-up' });
  }, 120_000);

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
        requestId: 'excessive-ticks',
        type: 'advanceTicks',
        protocolVersion: WORKER_PROTOCOL_VERSION,
        ticks: MAX_ADVANCE_TICKS_PER_REQUEST + 1,
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
      { type: 'fault', code: 'invalid-request', requestId: 'excessive-ticks' },
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
