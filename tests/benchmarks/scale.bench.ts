import { bench, describe } from 'vitest';

import {
  advancePopulationScale,
  createPopulationScale,
  reconcilePopulationLod,
  type AggregateCohortState,
  type AggregateTotals,
  type DetailedResidentState,
} from '../../src/simulation/scale';
import { createInitialWorld, initializeM8WorldAuthority } from '../../src/simulation/world';

const SCALE_SEED = [8_080, 5_000, 100_000, 7] as const;
const DETAILED_RESIDENT_COUNT = 5_000;
const AGGREGATE_RESIDENT_COUNT = 100_000;
const AGGREGATE_COHORT_COUNT = 100;
const RESIDENTS_PER_COHORT = AGGREGATE_RESIDENT_COUNT / AGGREGATE_COHORT_COUNT;

function residentTotals(id: number): AggregateTotals {
  return {
    age: 18 + (id % 73),
    health: 50 + (id % 51),
    foodNeed: 2 + (id % 5),
    waterNeed: 1 + (id % 4),
    safety: 25 + (id % 61),
    skill: 1 + (id % 37),
  };
}

function resident(id: number): DetailedResidentState {
  const references =
    id === 1
      ? { relationshipIds: [101], familyIds: [201], eventIds: [301] }
      : id === 2
        ? { relationshipIds: [101], familyIds: [201], eventIds: [] }
        : id === 3
          ? { relationshipIds: [], familyIds: [201], eventIds: [301] }
          : id === 4
            ? { relationshipIds: [], familyIds: [], eventIds: [301] }
            : { relationshipIds: [], familyIds: [], eventIds: [] };
  return {
    id,
    settlementId: 1,
    civilizationId: 1,
    cultureId: 1,
    householdId: 1 + Math.floor((id - 1) / 5),
    tileIndex: id % 256,
    ...residentTotals(id),
    importance: id === 1 ? 1 : 0,
    nextUpdateTick: 0,
    updateCount: 0,
    rng: [id, (id * 17) >>> 0, (id * 31) >>> 0, (id * 43) >>> 0],
    ...references,
  };
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

function cohort(index: number): AggregateCohortState {
  const firstResidentId = DETAILED_RESIDENT_COUNT + index * RESIDENTS_PER_COHORT + 1;
  const residentIds = Array.from(
    { length: RESIDENTS_PER_COHORT },
    (_, offset) => firstResidentId + offset,
  );
  return {
    id: index + 1,
    classification: {
      settlementId: 2 + (index % 5),
      civilizationId: 1,
      cultureId: 1 + (index % 3),
      householdId: 10_000 + index,
      tileIndex: index,
    },
    residentIds,
    householdCount: 1,
    totals: residentIds.reduce<AggregateTotals>(
      (total, id) => addTotals(total, residentTotals(id)),
      { age: 0, health: 0, foodNeed: 0, waterNeed: 0, safety: 0, skill: 0 },
    ),
    nextUpdateTick: 0,
    updateCount: 0,
    promotionCursor: 0,
  };
}

const scenario = createPopulationScale(SCALE_SEED, 0, {
  detailedResidents: Array.from({ length: DETAILED_RESIDENT_COUNT }, (_, index) =>
    resident(index + 1),
  ),
  cohorts: Array.from({ length: AGGREGATE_COHORT_COUNT }, (_, index) => cohort(index)),
});
const productionWorld = createInitialWorld(SCALE_SEED);
const primarySettlement = productionWorld.civilizations.settlements[0]!;
const authoritativePopulation = {
  ...productionWorld,
  civilizations: {
    ...productionWorld.civilizations,
    settlements: productionWorld.civilizations.settlements.map((settlement) =>
      settlement.id === primarySettlement.id
        ? { ...settlement, population: settlement.population + AGGREGATE_RESIDENT_COUNT }
        : settlement,
    ),
  },
};
const productionLodScenario = advancePopulationScale(
  initializeM8WorldAuthority(authoritativePopulation).populationScale,
  16,
);

describe('M8 fixed scale scenario', () => {
  bench('advance 10 ticks for 5,000 detailed and 100,000 aggregate residents', () => {
    advancePopulationScale(scenario, 10);
  });

  bench('reconcile production LOD for 100,000 aggregate residents', () => {
    reconcilePopulationLod(productionLodScenario, 0);
  });
});
