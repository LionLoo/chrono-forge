import {
  WORKER_PROTOCOL_VERSION,
  type WorkerToUiMessage,
  type WorldFrameProjection,
} from '../../src/protocol';
import { applyWorldFrameDelta } from '../../src/protocol/frame-delta';
import { createInitialWorld, hashWorldState, stepWorld } from '../../src/simulation/world';
import { createSimulationRuntime } from '../../src/workers/simulation-runtime';

const LONG_HORIZON = 1_000_000;
const seeds = [
  [1, 2, 3, 4],
  [101, 202, 303, 404],
  [0xffff_ffff, 0, 0x8000_0000, 17],
] as const;

function reconstructedFrame(messages: readonly WorkerToUiMessage[]): WorldFrameProjection {
  let frame: WorldFrameProjection | undefined;
  for (const message of messages) {
    if (message.type === 'ready') frame = message.frame;
    if (message.type === 'frameDelta') {
      if (frame === undefined) throw new Error('Worker sent a delta before ready.');
      frame = applyWorldFrameDelta(frame, message.delta);
    }
  }
  if (frame === undefined) throw new Error('Long worker frame is missing.');
  return frame;
}

describe('accelerated deterministic world horizon', () => {
  it('preserves generation fields and factual event references across large fixed-tick advances', () => {
    for (const seed of seeds) {
      const initial = createInitialWorld(seed);
      const advanced = stepWorld(initial, LONG_HORIZON);
      const repeated = stepWorld(createInitialWorld(seed), LONG_HORIZON);

      expect(advanced.tick).toBe(LONG_HORIZON);
      expect(advanced.elevation).toBe(initial.elevation);
      expect(advanced.eventLog.slice(0, 2)).toStrictEqual(initial.eventLog);
      expect(advanced.eventLog.map((event) => event.id)).toStrictEqual(
        Array.from({ length: advanced.eventLog.length }, (_, index) => index + 1),
      );
      expect(advanced.eventLog.every((event) => event.tick <= advanced.tick)).toBe(true);
      expect(advanced.nextEventId).toBe(advanced.eventLog.length + 1);
      expect(hashWorldState(advanced)).toBe(hashWorldState(repeated));
    }
  }, 180_000);

  it('keeps the worker checkpoint equal to the main runtime at the long horizon', () => {
    const responses: WorkerToUiMessage[] = [];
    const runtime = createSimulationRuntime((message) => responses.push(message));
    const seed = seeds[1];
    runtime.handleMessage({
      type: 'initialize',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'long-initialize',
      seed,
    });
    runtime.handleMessage({
      type: 'advanceTicks',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'long-advance',
      ticks: LONG_HORIZON,
    });

    const frame = reconstructedFrame(responses);
    expect(frame.tick).toBe(LONG_HORIZON);
    expect(frame.stateHash).toBe(hashWorldState(stepWorld(createInitialWorld(seed), LONG_HORIZON)));
  }, 120_000);
});
