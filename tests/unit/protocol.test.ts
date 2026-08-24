import {
  AGENT_ACTION_CODES,
  STRUCTURE_KIND_CODES,
  STRUCTURE_STATE_CODES,
  WORKER_PROTOCOL_VERSION,
  projectionTransferables,
} from '../../src/protocol';
import { createInitialWorld, stepWorld } from '../../src/simulation/world';
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
    expect(frame.agentIds).toStrictEqual(new Uint32Array([1, 2, 3, 4, 5, 6]));
    expect(frame.agentTiles).toHaveLength(frame.agentIds.length);
    expect(frame.agentHealth).toHaveLength(frame.agentIds.length);
    expect(frame.agentActions).toStrictEqual(
      new Uint8Array([
        AGENT_ACTION_CODES.idle,
        AGENT_ACTION_CODES.idle,
        AGENT_ACTION_CODES.idle,
        AGENT_ACTION_CODES.idle,
        AGENT_ACTION_CODES.idle,
        AGENT_ACTION_CODES.idle,
      ]),
    );
    expect(frame.structureIds).toHaveLength(0);
    expect(frame.structureTiles).toHaveLength(frame.structureIds.length);
    expect(frame.structureKinds).toHaveLength(frame.structureIds.length);
    expect(frame.structureStates).toHaveLength(frame.structureIds.length);
    expect(frame.structureProgress).toHaveLength(frame.structureIds.length);
    expect(frame.structureCondition).toHaveLength(frame.structureIds.length);
    expect(frame.settlementSummary).toStrictEqual({
      population: 6,
      food: 48,
      water: 48,
      timber: 25,
      stone: 5,
      operationalStructures: 0,
      shelterCapacity: 0,
      activeConstruction: 0,
    });
    expect(projectionTransferables(frame)).toStrictEqual([
      frame.biome.buffer,
      frame.resource.buffer,
      frame.habitability.buffer,
      frame.hazard.buffer,
      frame.agentIds.buffer,
      frame.agentTiles.buffer,
      frame.agentHealth.buffer,
      frame.agentActions.buffer,
      frame.structureIds.buffer,
      frame.structureTiles.buffer,
      frame.structureKinds.buffer,
      frame.structureStates.buffer,
      frame.structureProgress.buffer,
      frame.structureCondition.buffer,
    ]);
  });

  it('maps construction strings to stable codes and rejects out-of-range projection values', () => {
    const state = createInitialWorld([1, 2, 3, 4], { width: 4, height: 3, chunkSize: 2 });
    const constructionFrame = projectWorldFrame(stepWorld(state, 100));
    expect(constructionFrame.structureIds).toStrictEqual(new Uint32Array([1]));
    expect(constructionFrame.structureKinds).toStrictEqual(
      new Uint8Array([STRUCTURE_KIND_CODES.shelter]),
    );
    expect(constructionFrame.structureStates).toStrictEqual(
      new Uint8Array([STRUCTURE_STATE_CODES.planned]),
    );
    expect(constructionFrame.structureProgress).toStrictEqual(new Uint16Array([0]));
    expect(constructionFrame.structureCondition).toStrictEqual(new Uint16Array([1_000]));
    expect(constructionFrame.settlementSummary.activeConstruction).toBe(1);

    const firstAgent = state.civilization.agents[0]!;
    const invalid = {
      ...state,
      civilization: {
        ...state.civilization,
        agents: [{ ...firstAgent, health: 101 }, ...state.civilization.agents.slice(1)],
      },
    };
    expect(() => projectWorldFrame(invalid)).toThrow('Agent health must be an integer');
  });
});
