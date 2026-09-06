import { findLocalPath, type LocalPathRequest, type PathStatus, type TilePoint } from './index';

/** The maximum number of completed route results retained by one authoritative cache. */
export const MAX_PATH_CACHE_ENTRIES = 128;
/** Oldest unique route demand retained while fixed-quota path work catches up. */
export const MAX_PENDING_PATH_REQUESTS = 128;

export type FlowDirection = 'north' | 'east' | 'south' | 'west' | 'arrived';

export interface PathCacheRequest {
  readonly width: number;
  readonly height: number;
  readonly chunkSize: number;
  readonly start: TilePoint;
  readonly goal: TilePoint;
  /** Per tile-search stage quota; hierarchical work has a fixed derived total bound. */
  readonly maxExpansions: number;
  readonly revision: number;
}

/**
 * Functions are supplied only at scheduled execution time. Requests and saved
 * cache state remain data-only, so callback order can never affect authority.
 */
export interface PathCacheTraversal {
  readonly isPassable?: LocalPathRequest['isPassable'];
  readonly movementCost?: LocalPathRequest['movementCost'];
}

export interface PendingPathRequest {
  readonly requestId: number;
  readonly key: string;
  readonly queuedAtTick: number;
  readonly request: PathCacheRequest;
  /** Present only after a bounded corridor attempt defers its full-quota direct fallback. */
  readonly stage?: 'direct-fallback';
  readonly fallbackExpansionOffset?: number;
  readonly fallbackEligibleTick?: number;
}

export interface CachedPathResult {
  readonly entryId: number;
  readonly key: string;
  readonly request: PathCacheRequest;
  readonly status: PathStatus;
  readonly expansions: number;
  /** Stable row-major tile IDs, not coordinates coupled to a viewport. */
  readonly tilePath: readonly number[];
  /** Ordered, deduplicated hierarchical chunk IDs visited by the tile path. */
  readonly chunkRoute: readonly number[];
  /** One direction per tile; the final successful tile is always `arrived`. */
  readonly flowDirections: readonly FlowDirection[];
  readonly completedAtTick: number;
  readonly lastUsedTick: number;
}

export interface PathCacheState {
  readonly terrainRevision: number;
  readonly logicalTick: number;
  readonly nextRequestId: number;
  readonly nextEntryId: number;
  readonly pending: readonly PendingPathRequest[];
  readonly completed: readonly CachedPathResult[];
  readonly backlog: number;
  readonly operationCount: number;
}

export interface PathCacheRequestOutcome {
  readonly state: PathCacheState;
  readonly kind: 'cache-hit' | 'queued' | 'saturated';
  readonly requestId?: number;
  readonly result?: CachedPathResult;
}

export interface PathCacheAdvanceResult {
  readonly state: PathCacheState;
  readonly completed: readonly CachedPathResult[];
}

export interface PathCacheCanonicalDto {
  readonly terrainRevision: number;
  readonly logicalTick: number;
  readonly nextRequestId: number;
  readonly nextEntryId: number;
  readonly pending: readonly PendingPathRequest[];
  readonly completed: readonly CachedPathResult[];
  readonly backlog: number;
  readonly operationCount: number;
}

function isRuntimeArray(value: unknown): boolean {
  return Array.isArray(value);
}

function assertSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer.`);
  }
}

function assertNonNegativeSafeInteger(value: number, name: string): void {
  assertSafeInteger(value, name);
  if (value < 0) {
    throw new RangeError(`${name} must be non-negative.`);
  }
}

function assertPoint(point: TilePoint, width: number, height: number, name: string): void {
  assertSafeInteger(point.x, `${name} x`);
  assertSafeInteger(point.y, `${name} y`);
  if (point.x < 0 || point.x >= width || point.y < 0 || point.y >= height) {
    throw new RangeError(`${name} must be inside the grid.`);
  }
}

function clonePoint(point: TilePoint): TilePoint {
  return Object.freeze({ x: point.x, y: point.y });
}

function cloneRequest(request: PathCacheRequest): PathCacheRequest {
  return Object.freeze({
    width: request.width,
    height: request.height,
    chunkSize: request.chunkSize,
    start: clonePoint(request.start),
    goal: clonePoint(request.goal),
    maxExpansions: request.maxExpansions,
    revision: request.revision,
  });
}

function assertRequest(request: PathCacheRequest): void {
  assertNonNegativeSafeInteger(request.revision, 'Terrain revision');
  assertSafeInteger(request.width, 'Grid width');
  assertSafeInteger(request.height, 'Grid height');
  if (
    request.width <= 0 ||
    request.height <= 0 ||
    request.width > Math.floor(Number.MAX_SAFE_INTEGER / request.height)
  ) {
    throw new RangeError('Grid dimensions must define a positive safe tile count.');
  }
  assertSafeInteger(request.chunkSize, 'Chunk size');
  if (request.chunkSize <= 0) {
    throw new RangeError('Chunk size must be positive.');
  }
  assertPoint(request.start, request.width, request.height, 'Start');
  assertPoint(request.goal, request.width, request.height, 'Goal');
  assertNonNegativeSafeInteger(request.maxExpansions, 'Maximum expansions');
}

function keyFor(request: PathCacheRequest): string {
  return [
    request.revision,
    request.width,
    request.height,
    request.chunkSize,
    request.start.x,
    request.start.y,
    request.goal.x,
    request.goal.y,
    request.maxExpansions,
  ].join(':');
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function comparePending(left: PendingPathRequest, right: PendingPathRequest): number {
  return (
    left.queuedAtTick - right.queuedAtTick ||
    compareKeys(left.key, right.key) ||
    left.requestId - right.requestId
  );
}

function compareCompleted(left: CachedPathResult, right: CachedPathResult): number {
  return compareKeys(left.key, right.key) || left.entryId - right.entryId;
}

function compareEviction(left: CachedPathResult, right: CachedPathResult): number {
  return (
    left.lastUsedTick - right.lastUsedTick ||
    compareKeys(left.key, right.key) ||
    left.entryId - right.entryId
  );
}

function freezeState(
  state: Omit<PathCacheState, 'backlog'> & { readonly backlog?: number },
): PathCacheState {
  const pending = Object.freeze([...state.pending].sort(comparePending));
  const completed = Object.freeze([...state.completed].sort(compareCompleted));
  return Object.freeze({
    terrainRevision: state.terrainRevision,
    logicalTick: state.logicalTick,
    nextRequestId: state.nextRequestId,
    nextEntryId: state.nextEntryId,
    pending,
    completed,
    backlog: pending.length,
    operationCount: state.operationCount,
  });
}

/** Constant-cost guard for trusted hot-path transitions; deep validation remains a boundary check. */
function assertTransitionState(state: PathCacheState): void {
  assertNonNegativeSafeInteger(state.terrainRevision, 'Terrain revision');
  assertNonNegativeSafeInteger(state.logicalTick, 'Logical tick');
  assertNonNegativeSafeInteger(state.nextRequestId, 'Next request ID');
  assertNonNegativeSafeInteger(state.nextEntryId, 'Next entry ID');
  assertNonNegativeSafeInteger(state.operationCount, 'Operation count');
  if (!isRuntimeArray(state.pending) || !isRuntimeArray(state.completed)) {
    throw new RangeError('Path cache queues must be arrays.');
  }
  if (state.backlog !== state.pending.length) {
    throw new RangeError('Path cache backlog must equal pending queue length.');
  }
  if (state.pending.length > MAX_PENDING_PATH_REQUESTS) {
    throw new RangeError('Path cache exceeds its pending-request limit.');
  }
  if (state.completed.length > MAX_PATH_CACHE_ENTRIES) {
    throw new RangeError('Path cache exceeds its completed-entry limit.');
  }
}

function assertTick(state: PathCacheState, logicalTick: number): void {
  assertNonNegativeSafeInteger(logicalTick, 'Logical tick');
  if (logicalTick < state.logicalTick) {
    throw new RangeError('Logical tick cannot move backwards.');
  }
}

function tileId(point: TilePoint, width: number): number {
  return point.y * width + point.x;
}

function chunkIdFor(tile: number, request: PathCacheRequest): number {
  const x = tile % request.width;
  const y = Math.floor(tile / request.width);
  const chunksWide = Math.ceil(request.width / request.chunkSize);
  return Math.floor(y / request.chunkSize) * chunksWide + Math.floor(x / request.chunkSize);
}

function chunkPointFor(point: TilePoint, request: PathCacheRequest): TilePoint {
  return Object.freeze({
    x: Math.floor(point.x / request.chunkSize),
    y: Math.floor(point.y / request.chunkSize),
  });
}

function chunkRouteForPath(
  path: readonly TilePoint[],
  request: PathCacheRequest,
): readonly number[] {
  const seenChunks = new Set<number>();
  return Object.freeze(
    path
      .map((point) => tileId(point, request.width))
      .filter((tile) => {
        const chunk = chunkIdFor(tile, request);
        if (seenChunks.has(chunk)) return false;
        seenChunks.add(chunk);
        return true;
      })
      .map((tile) => chunkIdFor(tile, request)),
  );
}

function corridorChunksForPath(
  path: readonly TilePoint[],
  chunksWide: number,
  chunksHigh: number,
): ReadonlySet<number> {
  const allowed = new Set<number>();
  for (const point of path) {
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      const y = point.y + offsetY;
      if (y < 0 || y >= chunksHigh) continue;
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        const x = point.x + offsetX;
        if (x >= 0 && x < chunksWide) allowed.add(y * chunksWide + x);
      }
    }
  }
  return allowed;
}

function withExpansionOffset(
  result: ReturnType<typeof findLocalPath>,
  expansionOffset: number,
): ReturnType<typeof findLocalPath> {
  return Object.freeze({ ...result, expansions: expansionOffset + result.expansions });
}

function maximumHierarchicalExpansions(request: PathCacheRequest): number {
  const chunksWide = Math.ceil(request.width / request.chunkSize);
  const chunksHigh = Math.ceil(request.height / request.chunkSize);
  if (chunksWide === 1 && chunksHigh === 1) return request.maxExpansions;
  const coarseLimit = Math.min(request.maxExpansions, chunksWide * chunksHigh);
  const maximum = coarseLimit + request.maxExpansions * 2;
  return Number.isSafeInteger(maximum) ? maximum : Number.MAX_SAFE_INTEGER;
}

interface HierarchicalPathAttempt {
  readonly result: ReturnType<typeof findLocalPath>;
  readonly needsDirectFallback: boolean;
}

/** Open chunk topology has no obstacles, so its exact A* route can be built without heap state. */
function findOpenChunkPath(
  start: TilePoint,
  goal: TilePoint,
  maxExpansions: number,
): ReturnType<typeof findLocalPath> {
  const distance = Math.abs(goal.x - start.x) + Math.abs(goal.y - start.y);
  if (distance > maxExpansions) {
    return Object.freeze({
      status: 'quota-exhausted',
      path: Object.freeze([]),
      expansions: maxExpansions,
    });
  }
  const path: TilePoint[] = [Object.freeze({ x: start.x, y: start.y })];
  let x = start.x;
  let y = start.y;
  while (x !== goal.x || y !== goal.y) {
    // This matches the A* tie-break `(f, h, rowMajorNodeId)` on an obstacle-free grid.
    if (y > goal.y) y -= 1;
    else if (x !== goal.x) x += x < goal.x ? 1 : -1;
    else y += 1;
    path.push(Object.freeze({ x, y }));
  }
  return Object.freeze({ status: 'complete', path: Object.freeze(path), expansions: distance });
}

/**
 * Coarse/corridor work gets one full tile-stage quota. If it cannot complete, the caller defers a
 * full-quota direct fallback to the next scheduled cache pulse. This preserves direct-search
 * reachability without doubling expensive tile work inside one fixed-quota pulse.
 */
function findHierarchicalPathAttempt(
  request: PathCacheRequest,
  traversal: PathCacheTraversal,
): HierarchicalPathAttempt {
  const chunksWide = Math.ceil(request.width / request.chunkSize);
  const chunksHigh = Math.ceil(request.height / request.chunkSize);
  const startChunk = chunkPointFor(request.start, request);
  const goalChunk = chunkPointFor(request.goal, request);
  const localRequest = (
    maxExpansions: number,
    allowedChunks?: ReadonlySet<number>,
  ): LocalPathRequest => ({
    width: request.width,
    height: request.height,
    start: request.start,
    goal: request.goal,
    maxExpansions,
    isPassable: (x, y) => {
      const chunk =
        Math.floor(y / request.chunkSize) * chunksWide + Math.floor(x / request.chunkSize);
      return (
        (allowedChunks === undefined || allowedChunks.has(chunk)) &&
        (traversal.isPassable?.(x, y) ?? true)
      );
    },
    ...(traversal.movementCost === undefined ? {} : { movementCost: traversal.movementCost }),
  });
  if (
    request.width * request.height <= request.maxExpansions ||
    (startChunk.x === goalChunk.x && startChunk.y === goalChunk.y)
  ) {
    return Object.freeze({
      result: findLocalPath(localRequest(request.maxExpansions)),
      needsDirectFallback: false,
    });
  }

  // Coarse topology deliberately treats every in-bounds chunk as traversable. Tile passability is
  // authoritative only in the bounded corridor search below.
  const coarse = findOpenChunkPath(
    startChunk,
    goalChunk,
    Math.min(request.maxExpansions, chunksWide * chunksHigh),
  );
  if (coarse.status === 'complete') {
    const allowedChunks = corridorChunksForPath(coarse.path, chunksWide, chunksHigh);
    const corridor = findLocalPath(localRequest(request.maxExpansions, allowedChunks));
    if (corridor.status === 'complete' || allowedChunks.size === chunksWide * chunksHigh) {
      return Object.freeze({
        result: withExpansionOffset(corridor, coarse.expansions),
        needsDirectFallback: false,
      });
    }
    return Object.freeze({
      result: withExpansionOffset(corridor, coarse.expansions),
      needsDirectFallback: true,
    });
  }
  return Object.freeze({ result: coarse, needsDirectFallback: true });
}

function findDirectPath(
  request: PathCacheRequest,
  traversal: PathCacheTraversal,
): ReturnType<typeof findLocalPath> {
  return findLocalPath({
    width: request.width,
    height: request.height,
    start: request.start,
    goal: request.goal,
    maxExpansions: request.maxExpansions,
    isPassable: (x, y) => traversal.isPassable?.(x, y) ?? true,
    ...(traversal.movementCost === undefined ? {} : { movementCost: traversal.movementCost }),
  });
}

function flowDirections(path: readonly TilePoint[]): readonly FlowDirection[] {
  if (path.length === 0) {
    return Object.freeze([]);
  }
  const directions: FlowDirection[] = [];
  for (let index = 0; index < path.length; index += 1) {
    const current = path[index];
    const next = path[index + 1];
    if (current === undefined) {
      throw new RangeError('Path must not contain gaps.');
    }
    if (next === undefined) {
      directions.push('arrived');
    } else if (next.x === current.x && next.y === current.y - 1) {
      directions.push('north');
    } else if (next.x === current.x + 1 && next.y === current.y) {
      directions.push('east');
    } else if (next.x === current.x && next.y === current.y + 1) {
      directions.push('south');
    } else if (next.x === current.x - 1 && next.y === current.y) {
      directions.push('west');
    } else {
      throw new RangeError('Local path contains a non-cardinal step.');
    }
  }
  return Object.freeze(directions);
}

function makeEntry(
  entryId: number,
  request: PathCacheRequest,
  result: ReturnType<typeof findLocalPath>,
  logicalTick: number,
): CachedPathResult {
  const tilePath = Object.freeze(result.path.map((point) => tileId(point, request.width)));
  const chunkRoute = chunkRouteForPath(result.path, request);
  return Object.freeze({
    entryId,
    key: keyFor(request),
    request,
    status: result.status,
    expansions: result.expansions,
    tilePath,
    chunkRoute,
    flowDirections: flowDirections(result.path),
    completedAtTick: logicalTick,
    lastUsedTick: logicalTick,
  });
}

function evictToLimit(entries: readonly CachedPathResult[]): readonly CachedPathResult[] {
  const retained = [...entries];
  while (retained.length > MAX_PATH_CACHE_ENTRIES) {
    let evictionIndex = 0;
    for (let index = 1; index < retained.length; index += 1) {
      const candidate = retained[index];
      const previous = retained[evictionIndex];
      if (
        candidate !== undefined &&
        previous !== undefined &&
        compareEviction(candidate, previous) < 0
      ) {
        evictionIndex = index;
      }
    }
    retained.splice(evictionIndex, 1);
  }
  return retained;
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function requestForPending(state: PathCacheState, key: string): PendingPathRequest | undefined {
  return state.pending.find((pending) => pending.key === key);
}

function resultForRequest(state: PathCacheState, key: string): CachedPathResult | undefined {
  return state.completed.find((entry) => entry.key === key);
}

/** Creates a data-only cache state. Every transition returns a new frozen value. */
export function createPathCacheState(terrainRevision = 0): PathCacheState {
  assertNonNegativeSafeInteger(terrainRevision, 'Terrain revision');
  return freezeState({
    terrainRevision,
    logicalTick: 0,
    nextRequestId: 1,
    nextEntryId: 1,
    pending: [],
    completed: [],
    operationCount: 0,
  });
}

/** Queues a data-only request, or returns a deterministic completed cache hit. */
export function requestPath(
  state: PathCacheState,
  request: PathCacheRequest,
  logicalTick: number,
): PathCacheRequestOutcome {
  assertTransitionState(state);
  assertRequest(request);
  assertTick(state, logicalTick);
  if (request.revision !== state.terrainRevision) {
    throw new RangeError('Path request revision must equal the current terrain revision.');
  }

  const key = keyFor(request);
  const cached = resultForRequest(state, key);
  if (cached !== undefined) {
    const result =
      cached.lastUsedTick === logicalTick
        ? cached
        : Object.freeze({ ...cached, lastUsedTick: logicalTick });
    const completed =
      result === cached
        ? state.completed
        : Object.freeze(
            state.completed.map((entry) => (entry.entryId === cached.entryId ? result : entry)),
          );
    const nextState =
      logicalTick === state.logicalTick && completed === state.completed
        ? state
        : Object.freeze({ ...state, logicalTick, completed });
    return Object.freeze({
      state: nextState,
      kind: 'cache-hit',
      requestId: cached.entryId,
      result,
    });
  }

  const pending = requestForPending(state, key);
  if (pending !== undefined) {
    const nextState =
      logicalTick === state.logicalTick ? state : Object.freeze({ ...state, logicalTick });
    return Object.freeze({ state: nextState, kind: 'queued', requestId: pending.requestId });
  }

  // Preserve the oldest already-authoritative demand. Repeated requests coalesce above; a new
  // unique request retries on a later settlement pulse after fixed-quota work frees capacity.
  if (state.pending.length >= MAX_PENDING_PATH_REQUESTS) {
    const nextState =
      logicalTick === state.logicalTick ? state : Object.freeze({ ...state, logicalTick });
    return Object.freeze({ state: nextState, kind: 'saturated' });
  }

  const queued = Object.freeze({
    requestId: state.nextRequestId,
    key,
    queuedAtTick: logicalTick,
    request: cloneRequest(request),
  });
  const nextState = freezeState({
    ...state,
    logicalTick,
    nextRequestId: state.nextRequestId + 1,
    pending: [...state.pending, queued],
  });
  return Object.freeze({ state: nextState, kind: 'queued', requestId: queued.requestId });
}

/**
 * Resolves at most `maximumRequestQuota` stable queued requests. The supplied
 * traversal functions are used only for this pure scheduled calculation.
 */
export function advancePathCache(
  state: PathCacheState,
  traversal: PathCacheTraversal,
  maximumRequestQuota: number,
  logicalTick: number,
): PathCacheAdvanceResult {
  assertTransitionState(state);
  assertNonNegativeSafeInteger(maximumRequestQuota, 'Maximum request quota');
  assertTick(state, logicalTick);

  const processed = state.pending
    .filter(
      (pending) =>
        pending.fallbackEligibleTick === undefined || pending.fallbackEligibleTick <= logicalTick,
    )
    .slice(0, maximumRequestQuota);
  if (processed.length === 0) {
    const nextState =
      logicalTick === state.logicalTick ? state : Object.freeze({ ...state, logicalTick });
    return Object.freeze({ state: nextState, completed: Object.freeze([]) });
  }
  const processedIds = new Set(processed.map((pending) => pending.requestId));
  const remaining = state.pending.filter((pending) => !processedIds.has(pending.requestId));
  const completed: CachedPathResult[] = [];
  const deferred: PendingPathRequest[] = [];
  let nextEntryId = state.nextEntryId;
  for (const pending of processed) {
    let result: ReturnType<typeof findLocalPath>;
    if (pending.stage === 'direct-fallback') {
      result = withExpansionOffset(
        findDirectPath(pending.request, traversal),
        pending.fallbackExpansionOffset ?? 0,
      );
    } else {
      const attempt = findHierarchicalPathAttempt(pending.request, traversal);
      if (attempt.needsDirectFallback) {
        if (logicalTick === Number.MAX_SAFE_INTEGER) {
          result = withExpansionOffset(
            findDirectPath(pending.request, traversal),
            attempt.result.expansions,
          );
        } else {
          deferred.push(
            Object.freeze({
              ...pending,
              stage: 'direct-fallback' as const,
              fallbackExpansionOffset: attempt.result.expansions,
              fallbackEligibleTick: logicalTick + 1,
            }),
          );
          continue;
        }
      } else {
        result = attempt.result;
      }
    }
    completed.push(makeEntry(nextEntryId, pending.request, result, logicalTick));
    nextEntryId += 1;
  }
  const nextState = freezeState({
    ...state,
    logicalTick,
    nextEntryId,
    pending: [...deferred, ...remaining],
    completed: evictToLimit([...state.completed, ...completed]),
    operationCount: state.operationCount + processed.length,
  });
  return Object.freeze({ state: nextState, completed: Object.freeze(completed) });
}

/**
 * Advances terrain authority. Results and pending requests from older terrain
 * revisions are stale; additionally remove any retained current-revision path
 * crossing one of the changed stable tile IDs.
 */
export function invalidatePathCache(
  state: PathCacheState,
  nextTerrainRevision: number,
  changedTileIds: readonly number[],
): PathCacheState {
  assertPathCacheInvariants(state);
  assertNonNegativeSafeInteger(nextTerrainRevision, 'Next terrain revision');
  if (nextTerrainRevision <= state.terrainRevision) {
    throw new RangeError('Terrain revision must advance monotonically.');
  }
  const changed = new Set<number>();
  for (const tile of changedTileIds) {
    assertNonNegativeSafeInteger(tile, 'Changed tile ID');
    changed.add(tile);
  }
  return freezeState({
    ...state,
    terrainRevision: nextTerrainRevision,
    pending: state.pending.filter((pending) => pending.request.revision >= nextTerrainRevision),
    completed: state.completed.filter(
      (entry) =>
        entry.request.revision >= nextTerrainRevision &&
        !entry.tilePath.some((tile) => changed.has(tile)),
    ),
  });
}

/** Throws when a persisted or reconstructed cache cannot be authoritative. */
export function assertPathCacheInvariants(state: PathCacheState): void {
  assertNonNegativeSafeInteger(state.terrainRevision, 'Terrain revision');
  assertNonNegativeSafeInteger(state.logicalTick, 'Logical tick');
  assertNonNegativeSafeInteger(state.nextRequestId, 'Next request ID');
  assertNonNegativeSafeInteger(state.nextEntryId, 'Next entry ID');
  assertNonNegativeSafeInteger(state.operationCount, 'Operation count');
  const pendingEntries: readonly PendingPathRequest[] = state.pending;
  const completedEntries: readonly CachedPathResult[] = state.completed;
  if (!isRuntimeArray(pendingEntries) || !isRuntimeArray(completedEntries)) {
    throw new RangeError('Path cache queues must be arrays.');
  }
  if (state.backlog !== pendingEntries.length) {
    throw new RangeError('Path cache backlog must equal pending queue length.');
  }
  if (pendingEntries.length > MAX_PENDING_PATH_REQUESTS) {
    throw new RangeError('Path cache exceeds its pending-request limit.');
  }
  if (completedEntries.length > MAX_PATH_CACHE_ENTRIES) {
    throw new RangeError('Path cache exceeds its completed-entry limit.');
  }

  const pendingKeys = new Set<string>();
  const pendingIds = new Set<number>();
  let priorPending: PendingPathRequest | undefined;
  for (const pending of pendingEntries) {
    assertNonNegativeSafeInteger(pending.requestId, 'Pending request ID');
    assertNonNegativeSafeInteger(pending.queuedAtTick, 'Pending queued tick');
    if (pending.queuedAtTick > state.logicalTick) {
      throw new RangeError('Pending request cannot be queued in the future.');
    }
    assertRequest(pending.request);
    if (
      (pending.stage === undefined &&
        (pending.fallbackExpansionOffset !== undefined ||
          pending.fallbackEligibleTick !== undefined)) ||
      (pending.stage !== undefined && pending.stage !== 'direct-fallback') ||
      (pending.stage === 'direct-fallback' &&
        (pending.fallbackExpansionOffset === undefined ||
          pending.fallbackEligibleTick === undefined))
    ) {
      throw new RangeError('Pending request has invalid fallback stage data.');
    }
    if (pending.fallbackExpansionOffset !== undefined) {
      assertNonNegativeSafeInteger(
        pending.fallbackExpansionOffset,
        'Pending fallback expansion offset',
      );
      if (
        pending.fallbackExpansionOffset >
        maximumHierarchicalExpansions(pending.request) - pending.request.maxExpansions
      ) {
        throw new RangeError('Pending fallback expansion offset exceeds its fixed work bound.');
      }
    }
    if (pending.fallbackEligibleTick !== undefined) {
      assertNonNegativeSafeInteger(pending.fallbackEligibleTick, 'Pending fallback eligible tick');
      if (
        pending.fallbackEligibleTick <= pending.queuedAtTick ||
        pending.fallbackEligibleTick > state.logicalTick + 1
      ) {
        throw new RangeError('Pending fallback eligible tick is outside its scheduled range.');
      }
    }
    if (
      pending.request.revision !== state.terrainRevision ||
      pending.key !== keyFor(pending.request)
    ) {
      throw new RangeError('Pending request has stale or invalid key data.');
    }
    if (pendingKeys.has(pending.key) || pendingIds.has(pending.requestId)) {
      throw new RangeError('Pending requests must be unique.');
    }
    if (priorPending !== undefined && comparePending(priorPending, pending) > 0) {
      throw new RangeError('Pending requests must use stable total ordering.');
    }
    pendingKeys.add(pending.key);
    pendingIds.add(pending.requestId);
    priorPending = pending;
  }

  const completedKeys = new Set<string>();
  const completedIds = new Set<number>();
  let priorCompleted: CachedPathResult | undefined;
  for (const entry of completedEntries) {
    assertNonNegativeSafeInteger(entry.entryId, 'Completed entry ID');
    assertNonNegativeSafeInteger(entry.expansions, 'Completed expansions');
    assertNonNegativeSafeInteger(entry.completedAtTick, 'Completed tick');
    assertNonNegativeSafeInteger(entry.lastUsedTick, 'Last-used tick');
    if (entry.completedAtTick > entry.lastUsedTick || entry.lastUsedTick > state.logicalTick) {
      throw new RangeError('Completed entry has invalid logical tick data.');
    }
    assertRequest(entry.request);
    if (entry.expansions > maximumHierarchicalExpansions(entry.request)) {
      throw new RangeError('Completed entry exceeds its fixed hierarchical work bound.');
    }
    if (entry.request.revision !== state.terrainRevision || entry.key !== keyFor(entry.request)) {
      throw new RangeError('Completed entry has stale or invalid key data.');
    }
    if (completedKeys.has(entry.key) || completedIds.has(entry.entryId)) {
      throw new RangeError('Completed entries must be unique.');
    }
    if (priorCompleted !== undefined && compareCompleted(priorCompleted, entry) > 0) {
      throw new RangeError('Completed entries must use canonical ordering.');
    }
    const expectedFlowLength = entry.status === 'complete' ? entry.tilePath.length : 0;
    if (
      entry.flowDirections.length !== expectedFlowLength ||
      (entry.status !== 'complete' &&
        (entry.tilePath.length !== 0 || entry.chunkRoute.length !== 0))
    ) {
      throw new RangeError('Completed entry path data does not match its status.');
    }
    for (const tile of entry.tilePath) {
      assertNonNegativeSafeInteger(tile, 'Path tile ID');
      if (tile >= entry.request.width * entry.request.height) {
        throw new RangeError('Path tile ID is outside its request grid.');
      }
    }
    if (!['complete', 'no-path', 'quota-exhausted'].includes(entry.status)) {
      throw new RangeError('Completed entry has an unknown path status.');
    }
    if (entry.status === 'complete') {
      const points = entry.tilePath.map((tile) =>
        Object.freeze({ x: tile % entry.request.width, y: Math.floor(tile / entry.request.width) }),
      );
      const first = points[0];
      const last = points[points.length - 1];
      if (
        first === undefined ||
        last === undefined ||
        first.x !== entry.request.start.x ||
        first.y !== entry.request.start.y ||
        last.x !== entry.request.goal.x ||
        last.y !== entry.request.goal.y
      ) {
        throw new RangeError('Completed path must connect its requested endpoints.');
      }
      const expectedChunks: number[] = [];
      const seenChunks = new Set<number>();
      for (const tile of entry.tilePath) {
        const chunk = chunkIdFor(tile, entry.request);
        if (!seenChunks.has(chunk)) {
          seenChunks.add(chunk);
          expectedChunks.push(chunk);
        }
      }
      if (
        !arraysEqual(entry.chunkRoute, expectedChunks) ||
        !arraysEqual(entry.flowDirections, flowDirections(points))
      ) {
        throw new RangeError('Completed entry has malformed chunk or flow data.');
      }
    }
    completedKeys.add(entry.key);
    completedIds.add(entry.entryId);
    priorCompleted = entry;
  }
}

/** Produces a serializable, key-sorted DTO suitable for canonical snapshots and hashes. */
export function toCanonicalPathCacheDto(state: PathCacheState): PathCacheCanonicalDto {
  assertPathCacheInvariants(state);
  return Object.freeze({
    terrainRevision: state.terrainRevision,
    logicalTick: state.logicalTick,
    nextRequestId: state.nextRequestId,
    nextEntryId: state.nextEntryId,
    pending: Object.freeze([...state.pending].sort(comparePending)),
    completed: Object.freeze([...state.completed].sort(compareCompleted)),
    backlog: state.backlog,
    operationCount: state.operationCount,
  });
}
