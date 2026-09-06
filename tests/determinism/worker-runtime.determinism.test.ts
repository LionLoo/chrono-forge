import {
  WORKER_PROTOCOL_VERSION,
  type WorkerToUiMessage,
  type WorldFrameProjection,
} from '../../src/protocol';
import { applyWorldFrameDelta } from '../../src/protocol/frame-delta';
import { createInitialWorld, hashWorldState, stepWorld } from '../../src/simulation/world';
import {
  createSimulationRuntime,
  OFFLINE_CATCH_UP_POLICY_VERSION,
} from '../../src/workers/simulation-runtime';

describe('worker runtime determinism', () => {
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

  it('preserves the M6 projection across equivalent Worker tick partitions', () => {
    const run = (partitions: readonly number[]) => {
      const responses: WorkerToUiMessage[] = [];
      const runtime = createSimulationRuntime((message) => responses.push(message));
      runtime.handleMessage({
        type: 'initialize',
        protocolVersion: WORKER_PROTOCOL_VERSION,
        requestId: 'm6-initialize',
        seed: [37, 41, 43, 47],
        config: { societyYearTicks: 5_000 },
      });
      for (const [index, ticks] of partitions.entries()) {
        runtime.handleMessage({
          type: 'advanceTicks',
          protocolVersion: WORKER_PROTOCOL_VERSION,
          requestId: `m6-advance-${index}`,
          ticks,
        });
      }
      return reconstructedFrame(responses);
    };

    const direct = run([25_000]);
    const partitioned = run([1_337, 2_411, 5_000, 7_252, 9_000]);
    expect(partitioned.tick).toBe(direct.tick);
    expect(partitioned.stateHash).toBe(direct.stateHash);
    expect(partitioned.civilizations).toStrictEqual(direct.civilizations);
  });

  it('matches the main-runtime world hash for the same seed and fixed tick count', () => {
    const seed = [101, 202, 303, 404] as const;
    const mainRuntimeHash = hashWorldState(stepWorld(createInitialWorld(seed), 250));
    const responses: WorkerToUiMessage[] = [];
    const workerRuntime = createSimulationRuntime((message) => responses.push(message));

    workerRuntime.handleMessage({
      type: 'initialize',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'initialize',
      seed,
    });
    workerRuntime.handleMessage({
      type: 'advanceTicks',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'advance',
      ticks: 250,
    });

    expect(reconstructedFrame(responses).stateHash).toBe(mainRuntimeHash);
  });

  it('produces identical offline events, hashes, and snapshots for identical explicit inputs', () => {
    const run = () => {
      const responses: WorkerToUiMessage[] = [];
      const runtime = createSimulationRuntime((message) => responses.push(message));
      runtime.handleMessage({
        type: 'initialize',
        protocolVersion: WORKER_PROTOCOL_VERSION,
        requestId: 'initialize-offline',
        seed: [987, 654, 321, 123],
      });
      runtime.handleMessage({
        type: 'performOfflineCatchUp',
        protocolVersion: WORKER_PROTOCOL_VERSION,
        requestId: 'offline',
        elapsedMilliseconds: 12_345,
        rate: 7,
        policyVersion: OFFLINE_CATCH_UP_POLICY_VERSION,
      });
      runtime.handleMessage({
        type: 'requestSave',
        protocolVersion: WORKER_PROTOCOL_VERSION,
        requestId: 'save',
      });
      return responses;
    };

    const first = run();
    const second = run();
    expect(first).toStrictEqual(second);
    const offlineBatch = first.find(
      (message) =>
        message.type === 'eventBatch' &&
        message.events.some((event) => event.type === 'offline-catch-up'),
    );
    expect(offlineBatch).toMatchObject({
      events: [
        {
          id: 3,
          tick: 86,
          type: 'offline-catch-up',
          subjectId: 0,
          targetId: 0,
          tileIndex: -1,
          amount: 0,
        },
      ],
    });
  });
});
