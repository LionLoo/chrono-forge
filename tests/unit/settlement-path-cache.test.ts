import {
  SETTLEMENT_PATH_CACHE_REQUEST_QUOTA,
  advanceCivilizationWithPathCache,
  assertCivilizationInvariants,
  civilizationDto,
  createInitialCivilization,
  type CivilizationState,
  type SettlementTerrain,
} from '../../src/simulation/settlement';
import {
  assertPathCacheInvariants,
  createPathCacheState,
  requestPath,
  toCanonicalPathCacheDto,
  type PathCacheRequest,
  type PathCacheState,
} from '../../src/simulation/pathfinding/cache';

const WIDTH = 40;

function terrain(blockedTile = -1): SettlementTerrain {
  return {
    width: WIDTH,
    height: 1,
    food: new Uint16Array(WIDTH).fill(100),
    freshWater: new Uint16Array(WIDTH).fill(100),
    timber: new Uint16Array(WIDTH).fill(100),
    stone: new Uint16Array(WIDTH).fill(100),
    habitability: new Uint8Array(WIDTH).fill(100),
    hazard: new Uint8Array(WIDTH),
    isWalkable: (tileIndex) => tileIndex >= 0 && tileIndex < WIDTH && tileIndex !== blockedTile,
  };
}

function waitingCivilization(): CivilizationState {
  const initial = createInitialCivilization([17, 19, 23, 29], terrain());
  return {
    ...initial,
    agents: initial.agents.map((agent) => ({
      ...agent,
      action: 'rest' as const,
      tileIndex: 0,
      targetTileIndex: WIDTH - 1,
      route: Object.freeze([]),
      routeCursor: 0,
      plan: Object.freeze([
        Object.freeze({
          action: 'rest' as const,
          targetTileIndex: WIDTH - 1,
          targetStructureId: 0,
        }),
      ]),
      planIndex: 0,
    })),
  };
}

function cacheRequest(goalX: number): PathCacheRequest {
  return {
    width: WIDTH,
    height: 1,
    chunkSize: 32,
    start: { x: 0, y: 0 },
    goal: { x: goalX, y: 0 },
    maxExpansions: 64,
    revision: 0,
  };
}

function enqueue(state: PathCacheState, goals: readonly number[]): PathCacheState {
  return goals.reduce((next, goal) => requestPath(next, cacheRequest(goal), 0).state, state);
}

describe('settlement path-cache routing', () => {
  it('queues a coalesced miss, rebuilds it under quota, then uses the later hit to move', () => {
    const initial = waitingCivilization();
    const first = advanceCivilizationWithPathCache(initial, terrain(), 1, createPathCacheState());

    expect(first.civilization.agents.every((agent) => agent.tileIndex === 0)).toBe(true);
    expect(first.pathCache).toMatchObject({ logicalTick: 1, backlog: 0, operationCount: 1 });
    expect(first.pathCache.completed).toHaveLength(1);
    expect(first.pathCache.completed[0]?.request.chunkSize).toBe(32);
    expect(first.civilization.operationCount).toBe(
      initial.agents.length + (first.pathCache.completed[0]?.expansions ?? 0),
    );
    expect(() => assertPathCacheInvariants(first.pathCache)).not.toThrow();
    expect(() => assertCivilizationInvariants(first.civilization, terrain())).not.toThrow();

    const second = advanceCivilizationWithPathCache(
      first.civilization,
      terrain(),
      2,
      first.pathCache,
    );
    expect(second.civilization.agents.every((agent) => agent.tileIndex === 1)).toBe(true);
    expect(second.pathCache).toMatchObject({ logicalTick: 2, backlog: 0, operationCount: 1 });
    expect(() => assertPathCacheInvariants(second.pathCache)).not.toThrow();
  });

  it('coalesces stable-ID agent requests behind the fixed rebuild quota and preserves backlog', () => {
    const initial = waitingCivilization();
    const queued = enqueue(
      createPathCacheState(),
      Array.from({ length: SETTLEMENT_PATH_CACHE_REQUEST_QUOTA }, (_, index) => index + 1),
    );
    const first = advanceCivilizationWithPathCache(initial, terrain(), 1, queued);

    expect(first.pathCache.completed).toHaveLength(SETTLEMENT_PATH_CACHE_REQUEST_QUOTA);
    expect(first.pathCache).toMatchObject({
      backlog: 1,
      operationCount: SETTLEMENT_PATH_CACHE_REQUEST_QUOTA,
    });
    expect(first.civilization.agents.every((agent) => agent.tileIndex === 0)).toBe(true);

    const rebuilt = advanceCivilizationWithPathCache(
      first.civilization,
      terrain(),
      2,
      first.pathCache,
    );
    expect(rebuilt.pathCache).toMatchObject({ backlog: 0, operationCount: 33 });
    expect(rebuilt.civilization.agents.every((agent) => agent.tileIndex === 0)).toBe(true);

    const hit = advanceCivilizationWithPathCache(
      rebuilt.civilization,
      terrain(),
      3,
      rebuilt.pathCache,
    );
    expect(hit.civilization.agents.every((agent) => agent.tileIndex === 1)).toBe(true);
    expect(() => assertPathCacheInvariants(hit.pathCache)).not.toThrow();
  });

  it('never follows a retained route onto a newly unwalkable tile', () => {
    const initial = waitingCivilization();
    const routed: CivilizationState = {
      ...initial,
      agents: initial.agents.map((agent) => ({
        ...agent,
        route: Object.freeze([0, 1, 2]),
        routeCursor: 0,
      })),
    };
    const result = advanceCivilizationWithPathCache(routed, terrain(1), 1, createPathCacheState());

    expect(result.civilization.agents.every((agent) => agent.tileIndex === 0)).toBe(true);
    expect(result.civilization.agents.every((agent) => agent.route.length === 0)).toBe(true);
    expect(result.pathCache.completed[0]?.status).toBe('no-path');
  });

  it('is deterministic and partition-equivalent from equal cache checkpoints', () => {
    const goals = Array.from(
      { length: SETTLEMENT_PATH_CACHE_REQUEST_QUOTA },
      (_, index) => index + 1,
    );
    const wholeCheckpoint = enqueue(createPathCacheState(), goals);
    const partitionedCheckpoint = enqueue(
      enqueue(createPathCacheState(), goals.slice(0, 16)),
      goals.slice(16),
    );
    expect(toCanonicalPathCacheDto(partitionedCheckpoint)).toStrictEqual(
      toCanonicalPathCacheDto(wholeCheckpoint),
    );

    const run = (civilization: CivilizationState, pathCache: PathCacheState) =>
      [1, 2, 3].reduce(
        (state, tick) =>
          advanceCivilizationWithPathCache(state.civilization, terrain(), tick, state.pathCache),
        advanceCivilizationWithPathCache(civilization, terrain(), 0, pathCache),
      );
    const whole = run(waitingCivilization(), wholeCheckpoint);
    const reversedAgents = waitingCivilization();
    const partitioned = run(
      { ...reversedAgents, agents: [...reversedAgents.agents].reverse() },
      partitionedCheckpoint,
    );

    expect(civilizationDto(partitioned.civilization)).toStrictEqual(
      civilizationDto(whole.civilization),
    );
    expect(toCanonicalPathCacheDto(partitioned.pathCache)).toStrictEqual(
      toCanonicalPathCacheDto(whole.pathCache),
    );
    expect(() => assertPathCacheInvariants(partitioned.pathCache)).not.toThrow();
  });
});
