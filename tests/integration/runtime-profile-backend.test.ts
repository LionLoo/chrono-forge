import {
  MAX_PATH_CACHE_ENTRIES,
  MAX_PENDING_PATH_REQUESTS,
  advancePathCache,
  assertPathCacheInvariants,
  createPathCacheState,
  requestPath,
  type PathCacheRequest,
  type PathCacheState,
} from '../../src/simulation/pathfinding/cache';
import { deserializeWorldSnapshot, serializeWorldSnapshot } from '../../src/simulation/persistence';
import { MAX_SCALE_TRANSFER_DELTAS, removeAnonymousResidents } from '../../src/simulation/scale';
import {
  SETTLEMENT_ACTION_PULSE_TICKS,
  SETTLEMENT_PATH_CACHE_REQUEST_QUOTA,
} from '../../src/simulation/settlement';
import {
  assertWorldInvariants,
  hashWorldState,
  isWalkableTile,
  stepWorld,
  type WorldState,
} from '../../src/simulation/world';
import {
  RUNTIME_PROFILE_AGGREGATE_RESIDENTS,
  RUNTIME_PROFILE_DETAILED_RESIDENTS,
  RUNTIME_PROFILE_WORLD_HEIGHT,
  RUNTIME_PROFILE_WORLD_WIDTH,
  assertRuntimeProfileFixtureContract,
  createRuntimeProfileWorld,
} from '../support/runtime-profile-fixture';

const STRESS_TICKS = SETTLEMENT_ACTION_PULSE_TICKS * 5;
const IRREGULAR_PARTITIONS = [37, 62, 1, 41, 58, 1, 173, 27, 100] as const;
const RECONCILIATION_REMOVALS = 5_000;
const SEEDED_PATH_OPERATIONS = 1;

function uniqueReleaseScaleRequest(index: number): PathCacheRequest {
  return Object.freeze({
    width: RUNTIME_PROFILE_WORLD_WIDTH,
    height: RUNTIME_PROFILE_WORLD_HEIGHT,
    chunkSize: 32,
    start: Object.freeze({ x: 0, y: index }),
    goal: Object.freeze({ x: RUNTIME_PROFILE_WORLD_WIDTH - 1, y: index }),
    maxExpansions: 64,
    revision: 0,
  });
}

function saturatedDeferredPathCache(): PathCacheState {
  let pathCache = requestPath(createPathCacheState(), uniqueReleaseScaleRequest(0), 0).state;
  pathCache = advancePathCache(
    pathCache,
    { isPassable: (x) => x !== RUNTIME_PROFILE_WORLD_WIDTH / 2 },
    1,
    0,
  ).state;
  expect(pathCache.pending[0]).toMatchObject({
    stage: 'direct-fallback',
    fallbackEligibleTick: 1,
  });

  const outcomes: string[] = [];
  for (let index = 1; index < MAX_PENDING_PATH_REQUESTS + 8; index += 1) {
    const outcome = requestPath(pathCache, uniqueReleaseScaleRequest(index), 0);
    outcomes.push(outcome.kind);
    pathCache = outcome.state;
  }
  expect(outcomes.slice(-8)).toStrictEqual(Array.from({ length: 8 }, () => 'saturated'));
  expect(pathCache.pending).toHaveLength(MAX_PENDING_PATH_REQUESTS);
  expect(pathCache.pending.filter((request) => request.stage === 'direct-fallback')).toHaveLength(
    1,
  );
  expect(() => assertPathCacheInvariants(pathCache)).not.toThrow();
  return pathCache;
}

function canonicalReload(world: WorldState): WorldState {
  return deserializeWorldSnapshot(serializeWorldSnapshot(world));
}

function residentIds(world: WorldState): readonly number[] {
  return [
    ...world.populationScale.detailedResidents.map((resident) => resident.id),
    ...world.populationScale.cohorts.flatMap((cohort) => cohort.residentIds),
  ].sort((left, right) => left - right);
}

function assertResidentAuthority(world: WorldState, expectedResidentIds: readonly number[]) {
  assertWorldInvariants(world);
  expect(residentIds(world)).toStrictEqual(expectedResidentIds);
  expect(new Set(expectedResidentIds).size).toBe(expectedResidentIds.length);
  expect(
    world.civilizations.settlements.reduce((total, settlement) => total + settlement.population, 0),
  ).toBe(expectedResidentIds.length);
}

function assertReleaseScaleAuthority(world: WorldState, expectedResidentIds: readonly number[]) {
  assertRuntimeProfileFixtureContract(world);
  assertResidentAuthority(world, expectedResidentIds);
  expect(world.pathCache.pending.length).toBeLessThanOrEqual(MAX_PENDING_PATH_REQUESTS);
  expect(world.pathCache.completed.length).toBeLessThanOrEqual(MAX_PATH_CACHE_ENTRIES);
  expect(world.pathCache.backlog).toBe(world.pathCache.pending.length);
  expect(world.pathCache.operationCount).toBeLessThanOrEqual(
    SEEDED_PATH_OPERATIONS +
      Math.floor(world.tick / SETTLEMENT_ACTION_PULSE_TICKS) * SETTLEMENT_PATH_CACHE_REQUEST_QUOTA,
  );
  for (const entry of [...world.pathCache.pending, ...world.pathCache.completed]) {
    expect(entry.request).toMatchObject({
      width: RUNTIME_PROFILE_WORLD_WIDTH,
      height: RUNTIME_PROFILE_WORLD_HEIGHT,
      chunkSize: 32,
    });
  }
  for (const entry of world.pathCache.completed) {
    expect(entry.expansions).toBeLessThanOrEqual(entry.request.maxExpansions * 3);
    if (entry.status === 'complete') {
      expect(entry.tilePath.every((tile) => isWalkableTile(world, tile))).toBe(true);
    }
  }
}

function createReconciliationWorld(): {
  readonly world: WorldState;
  readonly expectedResidentIds: readonly number[];
} {
  const initial = createRuntimeProfileWorld();
  const removalIds = initial.populationScale.cohorts
    .flatMap((cohort) => cohort.residentIds)
    .slice(0, RECONCILIATION_REMOVALS);
  const removed = new Set(removalIds);
  const expectedResidentIds = residentIds(initial).filter((residentId) => !removed.has(residentId));
  let populationScale = initial.populationScale;
  for (let offset = 0; offset < removalIds.length; offset += MAX_SCALE_TRANSFER_DELTAS) {
    populationScale = removeAnonymousResidents(
      populationScale,
      removalIds.slice(offset, offset + MAX_SCALE_TRANSFER_DELTAS),
    );
  }
  const primarySettlement = initial.civilizations.settlements[0]!;
  const world: WorldState = Object.freeze({
    ...initial,
    civilizations: Object.freeze({
      ...initial.civilizations,
      settlements: Object.freeze(
        initial.civilizations.settlements.map((settlement) =>
          settlement.id === primarySettlement.id
            ? Object.freeze({
                ...settlement,
                population: settlement.population - removalIds.length,
              })
            : settlement,
        ),
      ),
    }),
    populationScale,
  });
  assertResidentAuthority(world, expectedResidentIds);
  expect(expectedResidentIds).toHaveLength(
    RUNTIME_PROFILE_DETAILED_RESIDENTS +
      RUNTIME_PROFILE_AGGREGATE_RESIDENTS -
      RECONCILIATION_REMOVALS,
  );
  return Object.freeze({ world, expectedResidentIds: Object.freeze(expectedResidentIds) });
}

describe('release-scale backend authority', () => {
  it('preserves max population and saturated deferred paths across pulses, partitions, and reloads', () => {
    const initial = createRuntimeProfileWorld();
    const source: WorldState = Object.freeze({
      ...initial,
      pathCache: saturatedDeferredPathCache(),
    });
    const expectedResidentIds = residentIds(source);
    expect(source.pathCache.operationCount).toBe(SEEDED_PATH_OPERATIONS);
    const sourceSnapshot = serializeWorldSnapshot(source);
    const restoredSource = deserializeWorldSnapshot(sourceSnapshot);
    expect(serializeWorldSnapshot(restoredSource)).toBe(sourceSnapshot);
    expect(restoredSource.pathCache.pending).toHaveLength(MAX_PENDING_PATH_REQUESTS);
    expect(
      restoredSource.pathCache.pending.filter((request) => request.stage === 'direct-fallback'),
    ).toHaveLength(1);

    const uninterrupted = stepWorld(source, STRESS_TICKS);
    let resumed = restoredSource;
    for (const ticks of IRREGULAR_PARTITIONS) {
      resumed = canonicalReload(stepWorld(resumed, ticks));
      assertReleaseScaleAuthority(resumed, expectedResidentIds);
    }

    expect(IRREGULAR_PARTITIONS.reduce((total, ticks) => total + ticks, 0)).toBe(STRESS_TICKS);
    expect(resumed.tick).toBe(STRESS_TICKS);
    expect(serializeWorldSnapshot(resumed)).toBe(serializeWorldSnapshot(uninterrupted));
    expect(hashWorldState(resumed)).toBe(hashWorldState(uninterrupted));
    expect(resumed.pathCache.operationCount).toBeGreaterThanOrEqual(
      MAX_PENDING_PATH_REQUESTS + SEEDED_PATH_OPERATIONS,
    );
    expect(resumed.pathCache.nextRequestId).toBeGreaterThan(source.pathCache.nextRequestId);
    assertReleaseScaleAuthority(uninterrupted, expectedResidentIds);
    assertReleaseScaleAuthority(resumed, expectedResidentIds);
  }, 60_000);

  it('repeatedly aggregates and promotes a near-capacity population across canonical reloads', () => {
    const { world: source, expectedResidentIds } = createReconciliationWorld();
    const baselineTransferCount = source.populationScale.transfers.length;
    expect(source.populationScale.detailedResidents).toHaveLength(
      RUNTIME_PROFILE_DETAILED_RESIDENTS,
    );
    expect(
      source.populationScale.cohorts.reduce(
        (total, cohort) => total + cohort.residentIds.length,
        0,
      ),
    ).toBe(RUNTIME_PROFILE_AGGREGATE_RESIDENTS - RECONCILIATION_REMOVALS);

    const uninterrupted = stepWorld(source, STRESS_TICKS);
    let resumed = canonicalReload(source);
    for (const ticks of IRREGULAR_PARTITIONS) {
      resumed = canonicalReload(stepWorld(resumed, ticks));
      assertResidentAuthority(resumed, expectedResidentIds);
    }

    const reconciliationTransfers =
      uninterrupted.populationScale.transfers.slice(baselineTransferCount);
    expect(
      reconciliationTransfers.filter((transfer) => transfer.kind === 'aggregated'),
    ).toHaveLength(5);
    expect(
      reconciliationTransfers.filter((transfer) => transfer.kind === 'deaggregated'),
    ).toHaveLength(5);
    expect(
      reconciliationTransfers
        .filter((transfer) => transfer.kind === 'aggregated')
        .map((transfer) => transfer.tick),
    ).toStrictEqual([100, 200, 300, 400, 500]);
    expect(
      reconciliationTransfers
        .filter((transfer) => transfer.kind === 'deaggregated')
        .map((transfer) => transfer.tick),
    ).toStrictEqual([100, 200, 300, 400, 500]);
    expect(serializeWorldSnapshot(resumed)).toBe(serializeWorldSnapshot(uninterrupted));
    expect(hashWorldState(resumed)).toBe(hashWorldState(uninterrupted));
    assertResidentAuthority(uninterrupted, expectedResidentIds);
    assertResidentAuthority(resumed, expectedResidentIds);
  }, 60_000);
});
