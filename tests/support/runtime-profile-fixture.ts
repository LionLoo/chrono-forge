import {
  FIRST_ORDINARY_RESIDENT_ID,
  MAX_AGGREGATE_RESIDENTS,
  MAX_DETAILED_RESIDENTS,
  MAX_SCALE_COHORT_RESIDENTS,
  createPopulationScale,
  type AggregateCohortState,
  type AggregateTotals,
  type DetailedResidentState,
} from '../../src/simulation/scale';
import {
  assertWorldInvariants,
  createInitialWorld,
  initializeM8WorldAuthority,
  type WorldState,
} from '../../src/simulation/world';

export const RUNTIME_PROFILE_SEED = [8_080, 5_000, 100_000, 7] as const;
export const RUNTIME_PROFILE_WORLD_WIDTH = 256;
export const RUNTIME_PROFILE_WORLD_HEIGHT = 192;
export const RUNTIME_PROFILE_DETAILED_RESIDENTS = MAX_DETAILED_RESIDENTS;
export const RUNTIME_PROFILE_AGGREGATE_RESIDENTS = MAX_AGGREGATE_RESIDENTS;

type RuntimeProfileContract = Pick<WorldState, 'config' | 'populationScale'>;

function totalsForResident(id: number): AggregateTotals {
  return Object.freeze({
    age: 18 + (id % 73),
    health: 50 + (id % 51),
    foodNeed: 2 + (id % 5),
    waterNeed: 1 + (id % 4),
    safety: 25 + (id % 61),
    skill: 1 + (id % 37),
  });
}

function anonymousDetailedResident(
  id: number,
  settlement: WorldState['civilizations']['settlements'][number],
  tick: number,
): DetailedResidentState {
  return Object.freeze({
    id,
    settlementId: settlement.id,
    civilizationId: settlement.civilizationId,
    cultureId: settlement.cultureId,
    householdId: 0,
    tileIndex: settlement.centerTileIndex,
    ...totalsForResident(id),
    importance: 0,
    nextUpdateTick: tick,
    updateCount: 0,
    rng: [
      id >>> 0,
      (id ^ 0x9e37_79b9) >>> 0,
      (id ^ 0x243f_6a88) >>> 0,
      (id ^ 0xb7e1_5162) >>> 0,
    ] as const,
    relationshipIds: Object.freeze([]),
    familyIds: Object.freeze([]),
    eventIds: Object.freeze([]),
  });
}

function addTotals(left: AggregateTotals, right: AggregateTotals): AggregateTotals {
  return {
    age: left.age + right.age,
    health: left.health + right.health,
    foodNeed: left.foodNeed + right.foodNeed,
    waterNeed: left.waterNeed + right.waterNeed,
    safety: left.safety + right.safety,
    skill: left.skill + right.skill,
  };
}

function aggregateCohort(
  cohortIndex: number,
  firstResidentId: number,
  settlement: WorldState['civilizations']['settlements'][number],
  tick: number,
): AggregateCohortState {
  const residentIds = Object.freeze(
    Array.from({ length: MAX_SCALE_COHORT_RESIDENTS }, (_, offset) => firstResidentId + offset),
  );
  const totals = residentIds.reduce<AggregateTotals>(
    (sum, residentId) => addTotals(sum, totalsForResident(residentId)),
    { age: 0, health: 0, foodNeed: 0, waterNeed: 0, safety: 0, skill: 0 },
  );
  return Object.freeze({
    id: cohortIndex + 1,
    classification: Object.freeze({
      settlementId: settlement.id,
      civilizationId: settlement.civilizationId,
      cultureId: settlement.cultureId,
      householdId: 0,
      tileIndex: settlement.centerTileIndex,
    }),
    residentIds,
    householdCount: 0,
    totals: Object.freeze(totals),
    nextUpdateTick: tick,
    updateCount: 0,
    promotionCursor: 0,
  });
}

export function assertRuntimeProfileFixtureContract(world: RuntimeProfileContract): void {
  if (
    world.config.width !== RUNTIME_PROFILE_WORLD_WIDTH ||
    world.config.height !== RUNTIME_PROFILE_WORLD_HEIGHT
  ) {
    throw new Error(
      `Runtime profile world must be ${RUNTIME_PROFILE_WORLD_WIDTH}x${RUNTIME_PROFILE_WORLD_HEIGHT}.`,
    );
  }
  if (world.populationScale.detailedResidents.length !== RUNTIME_PROFILE_DETAILED_RESIDENTS) {
    throw new Error(
      `Runtime profile requires ${RUNTIME_PROFILE_DETAILED_RESIDENTS} detailed residents.`,
    );
  }
  const aggregateResidents = world.populationScale.cohorts.reduce(
    (total, cohort) => total + cohort.residentIds.length,
    0,
  );
  if (aggregateResidents !== RUNTIME_PROFILE_AGGREGATE_RESIDENTS) {
    throw new Error(
      `Runtime profile requires ${RUNTIME_PROFILE_AGGREGATE_RESIDENTS} aggregate residents.`,
    );
  }
}

export function createRuntimeProfileWorld(): WorldState {
  const initial = createInitialWorld(RUNTIME_PROFILE_SEED, {
    width: RUNTIME_PROFILE_WORLD_WIDTH,
    height: RUNTIME_PROFILE_WORLD_HEIGHT,
    chunkSize: 32,
  });
  const initialized = Object.freeze({ ...initial, ...initializeM8WorldAuthority(initial) });
  const primarySettlement = initialized.civilizations.settlements[0];
  if (primarySettlement === undefined) throw new Error('Profile world has no primary settlement.');
  const namedResidents = initialized.populationScale.detailedResidents;
  if (namedResidents.length > RUNTIME_PROFILE_DETAILED_RESIDENTS) {
    throw new Error('Profile world has more named residents than the detailed-resident budget.');
  }
  const anonymousDetailedCount = RUNTIME_PROFILE_DETAILED_RESIDENTS - namedResidents.length;
  const anonymousDetailed = Array.from({ length: anonymousDetailedCount }, (_, index) =>
    anonymousDetailedResident(FIRST_ORDINARY_RESIDENT_ID + index, primarySettlement, initial.tick),
  );
  const firstAggregateResidentId = FIRST_ORDINARY_RESIDENT_ID + anonymousDetailedCount;
  const cohortCount = RUNTIME_PROFILE_AGGREGATE_RESIDENTS / MAX_SCALE_COHORT_RESIDENTS;
  const cohorts = Array.from({ length: cohortCount }, (_, index) =>
    aggregateCohort(
      index,
      firstAggregateResidentId + index * MAX_SCALE_COHORT_RESIDENTS,
      primarySettlement,
      initial.tick,
    ),
  );
  const populationScale = createPopulationScale(initialized.populationScale.rng, initial.tick, {
    detailedResidents: [...namedResidents, ...anonymousDetailed],
    cohorts,
  });
  const world: WorldState = Object.freeze({
    ...initialized,
    civilizations: Object.freeze({
      ...initialized.civilizations,
      settlements: Object.freeze(
        initialized.civilizations.settlements.map((settlement) =>
          settlement.id === primarySettlement.id
            ? Object.freeze({
                ...settlement,
                population:
                  RUNTIME_PROFILE_DETAILED_RESIDENTS + RUNTIME_PROFILE_AGGREGATE_RESIDENTS,
              })
            : settlement,
        ),
      ),
    }),
    populationScale,
  });
  assertWorldInvariants(world);
  assertRuntimeProfileFixtureContract(world);
  return world;
}
