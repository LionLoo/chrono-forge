import { WORKER_PROTOCOL_VERSION, projectionTransferables } from '../../src/protocol';
import { createInitialWorld } from '../../src/simulation/world';
import { projectWorldFrame } from '../../src/workers/simulation-runtime';

describe('versioned worker protocol', () => {
  it('creates a detached, transfer-ready projection from dense world tiles', () => {
    const state = createInitialWorld([1, 2, 3, 4], { width: 4, height: 3, chunkSize: 2 });
    const frame = projectWorldFrame(state);

    expect(frame.version).toBe(WORKER_PROTOCOL_VERSION);
    expect(frame.width).toBe(4);
    expect(frame.height).toBe(3);
    expect(frame.tick).toBe(0);
    expect(frame.biome).not.toBe(state.tiles.biome);
    expect(frame.biome).toStrictEqual(state.tiles.biome);
    expect(frame.resource[0]).toBe(
      Math.min(
        65_535,
        state.tiles.freshWater[0]! +
          state.tiles.food[0]! +
          state.tiles.timber[0]! +
          state.tiles.stone[0]! +
          state.tiles.metal[0]!,
      ),
    );
    expect(projectionTransferables(frame)).toStrictEqual([
      frame.biome.buffer,
      frame.resource.buffer,
      frame.habitability.buffer,
      frame.hazard.buffer,
    ]);
  });
});
