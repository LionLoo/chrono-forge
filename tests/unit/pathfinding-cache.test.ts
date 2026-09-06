import {
  MAX_PENDING_PATH_REQUESTS,
  MAX_PATH_CACHE_ENTRIES,
  advancePathCache,
  assertPathCacheInvariants,
  createPathCacheState,
  invalidatePathCache,
  requestPath,
  toCanonicalPathCacheDto,
  type PathCacheRequest,
} from '../../src/simulation/pathfinding/cache';
import { findLocalPath } from '../../src/simulation/pathfinding';

const request = (overrides: Partial<PathCacheRequest> = {}): PathCacheRequest => ({
  width: 8,
  height: 8,
  chunkSize: 2,
  start: { x: 0, y: 0 },
  goal: { x: 7, y: 0 },
  maxExpansions: 80,
  revision: 0,
  ...overrides,
});

function resolve(
  state: ReturnType<typeof createPathCacheState>,
  entry: PathCacheRequest,
  tick = 1,
) {
  return advancePathCache(requestPath(state, entry, tick).state, {}, 1, tick).state;
}

describe('deterministic hierarchical path cache', () => {
  it('returns a completed repeat request from cache and exposes canonical tile, chunk, and flow data', () => {
    const first = resolve(createPathCacheState(), request(), 4);
    const hit = requestPath(first, request(), 7);

    expect(hit.kind).toBe('cache-hit');
    expect(hit.state.pending).toHaveLength(0);
    expect(hit.state.operationCount).toBe(1);
    expect(hit.result).toMatchObject({
      status: 'complete',
      tilePath: [0, 1, 2, 3, 4, 5, 6, 7],
      chunkRoute: [0, 1, 2, 3],
      flowDirections: ['east', 'east', 'east', 'east', 'east', 'east', 'east', 'arrived'],
      lastUsedTick: 7,
    });
    expect(toCanonicalPathCacheDto(hit.state)).toStrictEqual(toCanonicalPathCacheDto(hit.state));
  });

  it('uses a coarse chunk route to constrain local search before producing flow steps', () => {
    const entry = request({
      width: 8,
      height: 20,
      chunkSize: 2,
      goal: { x: 7, y: 0 },
      maxExpansions: 40,
    });
    const movementCost = (fromX: number, _fromY: number, toX: number, toY: number) =>
      fromX === toX || toY >= 18 ? 1 : 1_000;
    const direct = findLocalPath({ ...entry, movementCost });
    const completed = advancePathCache(
      requestPath(createPathCacheState(), entry, 1).state,
      { movementCost },
      1,
      1,
    ).completed[0]!;

    expect(direct.status).toBe('quota-exhausted');
    expect(completed.status).toBe('complete');
    expect(completed.chunkRoute).toStrictEqual([0, 1, 2, 3]);
    expect(completed.tilePath.every((tile) => Math.trunc(tile / entry.width) < 2)).toBe(true);
    expect(completed.flowDirections).toHaveLength(completed.tilePath.length);
    expect(completed.expansions).toBe(31);
  });

  it('preserves a reachable route when coarse work would consume part of its direct-search quota', () => {
    const entry = request({
      width: 65,
      height: 1,
      chunkSize: 32,
      goal: { x: 64, y: 0 },
      maxExpansions: 64,
    });
    const completed = advancePathCache(
      requestPath(createPathCacheState(), entry, 1).state,
      {},
      1,
      1,
    ).completed[0]!;

    expect(completed.status).toBe('complete');
    expect(completed.tilePath).toHaveLength(65);
    expect(completed.tilePath[0]).toBe(0);
    expect(completed.tilePath.at(-1)).toBe(64);
    expect(completed.chunkRoute).toStrictEqual([0, 1, 2]);
    expect(completed.expansions).toBe(66);
  });

  it('does not mislabel a bounded direct search when the preferred corridor has no gateway', () => {
    const entry = request({
      width: 6,
      height: 8,
      chunkSize: 2,
      goal: { x: 5, y: 0 },
      maxExpansions: 12,
    });
    const isPassable = (x: number, y: number) => !(x === 2 && y < 6);
    const direct = findLocalPath({ ...entry, isPassable });
    const first = advancePathCache(
      requestPath(createPathCacheState(), entry, 1).state,
      { isPassable },
      1,
      1,
    );
    const second = advancePathCache(first.state, { isPassable }, 1, 2);
    const completed = second.completed[0]!;

    expect(first.completed).toStrictEqual([]);
    expect(first.state.pending[0]).toMatchObject({
      stage: 'direct-fallback',
      fallbackExpansionOffset: 10,
      fallbackEligibleTick: 2,
    });
    expect(direct.status).toBe('quota-exhausted');
    expect(completed.status).toBe('quota-exhausted');
    expect(completed.chunkRoute).toStrictEqual([]);
    expect(completed.tilePath).toStrictEqual([]);
    expect(completed.expansions).toBeGreaterThan(direct.expansions);
  });

  it('sorts pending work by logical tick and stable key, then respects a fixed request quota and telemetry', () => {
    let state = createPathCacheState();
    state = requestPath(state, request({ start: { x: 1, y: 0 }, goal: { x: 7, y: 0 } }), 2).state;
    state = requestPath(state, request({ start: { x: 0, y: 1 }, goal: { x: 7, y: 1 } }), 3).state;
    state = requestPath(state, request({ start: { x: 4, y: 0 }, goal: { x: 7, y: 0 } }), 3).state;

    expect(state.pending.map((entry) => [entry.queuedAtTick, entry.key])).toStrictEqual([
      [2, '0:8:8:2:1:0:7:0:80'],
      [3, '0:8:8:2:0:1:7:1:80'],
      [3, '0:8:8:2:4:0:7:0:80'],
    ]);
    const first = advancePathCache(state, {}, 2, 3);
    expect(first.completed).toHaveLength(2);
    expect(first.state.backlog).toBe(1);
    expect(first.state.operationCount).toBe(2);
    expect(advancePathCache(first.state, {}, 1, 4).state).toMatchObject({
      backlog: 0,
      operationCount: 3,
    });
  });

  it('bounds sustained unique demand, coalesces repeats, and retries after quota frees capacity', () => {
    let state = createPathCacheState();
    const outcomes: string[] = [];
    const uniqueRequest = (index: number) =>
      request({
        width: 256,
        height: 1,
        chunkSize: 8,
        start: { x: index, y: 0 },
        goal: { x: 255, y: 0 },
        maxExpansions: 300,
      });
    for (let index = 0; index < MAX_PENDING_PATH_REQUESTS + 8; index += 1) {
      const outcome = requestPath(state, uniqueRequest(index), 1);
      outcomes.push(outcome.kind);
      state = outcome.state;
    }

    expect(state.pending).toHaveLength(MAX_PENDING_PATH_REQUESTS);
    expect(state.backlog).toBe(MAX_PENDING_PATH_REQUESTS);
    expect(state.nextRequestId).toBe(MAX_PENDING_PATH_REQUESTS + 1);
    expect(outcomes.slice(-8)).toStrictEqual(Array.from({ length: 8 }, () => 'saturated'));

    const repeated = requestPath(state, uniqueRequest(0), 2);
    expect(repeated.kind).toBe('queued');
    expect(repeated.state.pending).toHaveLength(MAX_PENDING_PATH_REQUESTS);
    expect(repeated.state.nextRequestId).toBe(MAX_PENDING_PATH_REQUESTS + 1);

    state = advancePathCache(repeated.state, {}, 32, 2).state;
    const retried = requestPath(state, uniqueRequest(MAX_PENDING_PATH_REQUESTS), 2);
    expect(retried.kind).toBe('queued');
    expect(retried.state.pending).toHaveLength(MAX_PENDING_PATH_REQUESTS - 31);
    expect(() => assertPathCacheInvariants(retried.state)).not.toThrow();
  });

  it('is exactly equivalent when a scheduled request budget is partitioned at the same logical tick', () => {
    const initial = createPathCacheState();
    const queued = [
      request({ start: { x: 0, y: 0 }, goal: { x: 5, y: 0 } }),
      request({ start: { x: 0, y: 1 }, goal: { x: 5, y: 1 } }),
      request({ start: { x: 0, y: 2 }, goal: { x: 5, y: 2 } }),
    ].reduce((state, item) => requestPath(state, item, 8).state, initial);

    const whole = advancePathCache(queued, {}, 3, 9).state;
    const partitioned = advancePathCache(advancePathCache(queued, {}, 1, 9).state, {}, 2, 9).state;
    expect(toCanonicalPathCacheDto(partitioned)).toStrictEqual(toCanonicalPathCacheDto(whole));
  });

  it('keeps deferred fallbacks partition-equivalent and ineligible until the next tick', () => {
    const traversal = { isPassable: (x: number, y: number) => !(x === 2 && y < 6) };
    const entries = [
      request({
        width: 6,
        height: 8,
        chunkSize: 2,
        goal: { x: 5, y: 0 },
        maxExpansions: 12,
      }),
      request({
        width: 6,
        height: 8,
        chunkSize: 2,
        start: { x: 0, y: 1 },
        goal: { x: 5, y: 1 },
        maxExpansions: 12,
      }),
    ];
    const queued = entries.reduce(
      (state, entry) => requestPath(state, entry, 5).state,
      createPathCacheState(),
    );

    const wholeDeferred = advancePathCache(queued, traversal, 2, 5).state;
    const partitionedDeferred = advancePathCache(
      advancePathCache(queued, traversal, 1, 5).state,
      traversal,
      1,
      5,
    ).state;
    expect(toCanonicalPathCacheDto(partitionedDeferred)).toStrictEqual(
      toCanonicalPathCacheDto(wholeDeferred),
    );
    expect(wholeDeferred.pending).toHaveLength(2);
    expect(wholeDeferred.pending.every((entry) => entry.fallbackEligibleTick === 6)).toBe(true);

    const wholeCompleted = advancePathCache(wholeDeferred, traversal, 2, 6).state;
    const partitionedCompleted = advancePathCache(
      advancePathCache(partitionedDeferred, traversal, 1, 6).state,
      traversal,
      1,
      6,
    ).state;
    expect(toCanonicalPathCacheDto(partitionedCompleted)).toStrictEqual(
      toCanonicalPathCacheDto(wholeCompleted),
    );
  });

  it('resolves a needed fallback coherently at the terminal logical tick', () => {
    const entry = request({
      width: 6,
      height: 8,
      chunkSize: 2,
      goal: { x: 5, y: 0 },
      maxExpansions: 12,
    });
    const traversal = { isPassable: (x: number, y: number) => !(x === 2 && y < 6) };
    const queued = requestPath(createPathCacheState(), entry, Number.MAX_SAFE_INTEGER).state;
    const resolved = advancePathCache(queued, traversal, 1, Number.MAX_SAFE_INTEGER).state;

    expect(resolved.pending).toStrictEqual([]);
    expect(resolved.completed[0]).toMatchObject({
      status: 'quota-exhausted',
      expansions: 22,
      completedAtTick: Number.MAX_SAFE_INTEGER,
    });
    expect(() => assertPathCacheInvariants(resolved)).not.toThrow();
  });

  it('invalidates stale paths on a monotonic terrain revision and rejects nonmonotonic revision changes', () => {
    const resolved = resolve(createPathCacheState(), request(), 2);
    const invalidated = invalidatePathCache(resolved, 1, [3]);
    expect(invalidated).toMatchObject({ terrainRevision: 1, backlog: 0, completed: [] });
    expect(() => invalidatePathCache(invalidated, 1, [])).toThrow(RangeError);
    expect(() => requestPath(invalidated, request(), 3)).toThrow('revision');
  });

  it('evicts deterministically by last use tick then stable cache key', () => {
    let state = createPathCacheState();
    for (let index = 0; index < MAX_PATH_CACHE_ENTRIES; index += 1) {
      state = resolve(
        state,
        request({
          width: 256,
          height: 1,
          chunkSize: 8,
          start: { x: index, y: 0 },
          goal: { x: 255, y: 0 },
          maxExpansions: 300,
        }),
        index + 1,
      );
    }
    const oldest = [...state.completed].sort(
      (left, right) =>
        left.lastUsedTick - right.lastUsedTick ||
        (left.key < right.key ? -1 : left.key > right.key ? 1 : 0),
    )[0];
    expect(oldest).toBeDefined();
    const next = resolve(
      state,
      request({
        width: 256,
        height: 1,
        chunkSize: 8,
        start: { x: 128, y: 0 },
        goal: { x: 255, y: 0 },
        maxExpansions: 300,
      }),
      200,
    );
    expect(next.completed).toHaveLength(MAX_PATH_CACHE_ENTRIES);
    expect(next.completed.some((entry) => entry.key === oldest?.key)).toBe(false);
    expect(next.completed.some((entry) => entry.lastUsedTick === 200)).toBe(true);
  });

  it('retains deterministic no-path and quota-exhausted results without callbacks in state', () => {
    const blocked = request({ width: 3, height: 1, goal: { x: 2, y: 0 } });
    const noPathAttempt = advancePathCache(
      requestPath(createPathCacheState(), blocked, 1).state,
      {
        isPassable: (x) => x === 0,
      },
      1,
      1,
    );
    const noPath = advancePathCache(noPathAttempt.state, { isPassable: (x) => x === 0 }, 1, 2).state
      .completed[0];
    const quotaAttempt = resolve(
      createPathCacheState(),
      request({ width: 3, height: 1, goal: { x: 2, y: 0 }, maxExpansions: 1 }),
    );
    const quota = advancePathCache(quotaAttempt, {}, 1, 2).state;

    expect(noPath).toMatchObject({
      status: 'no-path',
      tilePath: [],
      chunkRoute: [],
      flowDirections: [],
    });
    expect(quota.completed[0]).toMatchObject({
      status: 'quota-exhausted',
      tilePath: [],
      chunkRoute: [],
    });
    expect(JSON.stringify(toCanonicalPathCacheDto(quota))).not.toContain('function');
  });

  it('rejects malformed state and inputs before they can enter authoritative scheduling', () => {
    const valid = createPathCacheState();
    expect(() => requestPath(valid, request({ chunkSize: 0 }), 1)).toThrow(RangeError);
    expect(() => advancePathCache(valid, {}, -1, 0)).toThrow(RangeError);
    expect(() => requestPath(valid, request(), -1)).toThrow(RangeError);
    expect(() =>
      assertPathCacheInvariants({
        ...valid,
        backlog: 1,
      }),
    ).toThrow('backlog');
    const resolved = resolve(valid, request());
    const entry = resolved.completed[0];
    expect(entry).toBeDefined();
    expect(() =>
      assertPathCacheInvariants({
        ...resolved,
        completed: [{ ...entry!, flowDirections: [] }],
      }),
    ).toThrow('path data');
  });
});
