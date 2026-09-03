import { describe, expect, it } from 'vitest';

import {
  MAX_AGGREGATE_RESIDENTS,
  MAX_DETAILED_RESIDENTS,
  MAX_SCALE_TRANSFER_DELTAS,
  advancePopulationScale,
  aggregateResidents,
  assertPopulationScaleInvariants,
  createPopulationScale,
  deaggregateCohort,
  populationScaleDto,
  type AggregateCohortState,
  type DetailedResidentState,
} from '../../src/simulation/scale';

const SEED = [7, 11, 13, 17] as const;

function resident(
  id: number,
  overrides: Partial<DetailedResidentState> = {},
): DetailedResidentState {
  return {
    id,
    settlementId: 1,
    civilizationId: 1,
    cultureId: 1,
    householdId: 1,
    tileIndex: 9,
    age: 20 + (id % 5),
    health: 80,
    foodNeed: 3,
    waterNeed: 2,
    safety: 75,
    skill: 10 + (id % 7),
    importance: 0,
    nextUpdateTick: 0,
    updateCount: 0,
    rng: [id, id + 1, id + 2, id + 3],
    relationshipIds: [],
    familyIds: [],
    eventIds: [],
    ...overrides,
  };
}

function cohort(count: number, id = 1, firstResidentId = 10_001): AggregateCohortState {
  return {
    id,
    classification: {
      settlementId: 1,
      civilizationId: 1,
      cultureId: 1,
      householdId: 1,
      tileIndex: 9,
    },
    residentIds: Array.from({ length: count }, (_, index) => firstResidentId + index),
    householdCount: 1,
    totals: {
      age: count * 25,
      health: count * 80,
      foodNeed: count * 3,
      waterNeed: count * 2,
      safety: count * 75,
      skill: count * 12,
    },
    nextUpdateTick: 0,
    updateCount: 0,
  };
}

function allTotals(state: ReturnType<typeof createPopulationScale>) {
  const initial = { age: 0, health: 0, foodNeed: 0, waterNeed: 0, safety: 0, skill: 0 };
  for (const value of [...state.detailedResidents, ...state.cohorts]) {
    const totals = 'totals' in value ? value.totals : value;
    initial.age += totals.age;
    initial.health += totals.health;
    initial.foodNeed += totals.foodNeed;
    initial.waterNeed += totals.waterNeed;
    initial.safety += totals.safety;
    initial.skill += totals.skill;
  }
  return initial;
}

describe('M8 deterministic population scale authority', () => {
  it('accepts the locked 5,000 detailed plus 100,000 aggregate population budgets', () => {
    const state = createPopulationScale(SEED, 0, {
      detailedResidents: Array.from({ length: MAX_DETAILED_RESIDENTS }, (_, index) =>
        resident(index + 1),
      ),
      cohorts: [cohort(MAX_AGGREGATE_RESIDENTS, 1, MAX_DETAILED_RESIDENTS + 1)],
    });

    expect(state.detailedResidents).toHaveLength(MAX_DETAILED_RESIDENTS);
    expect(state.cohorts[0]?.residentIds).toHaveLength(MAX_AGGREGATE_RESIDENTS);
    expect(state.backlog).toStrictEqual({ detailedDue: 5_000, cohortDue: 1, totalDue: 5_001 });
  });

  it('is partition-equivalent with deterministic fixed-quota schedule and isolated RNGs', () => {
    const initial = createPopulationScale(SEED, 0, {
      detailedResidents: Array.from({ length: 300 }, (_, index) => resident(index + 1)),
      cohorts: [cohort(20)],
    });
    const oneShot = advancePopulationScale(initial, 19);
    let partitioned = initial;
    for (const ticks of [1, 7, 2, 9]) partitioned = advancePopulationScale(partitioned, ticks);

    expect(populationScaleDto(partitioned)).toStrictEqual(populationScaleDto(oneShot));
    expect(oneShot.operationCount).toBeGreaterThan(0);
    expect(oneShot.backlog.totalDue).toBeLessThanOrEqual(5_256);
  });

  it('rejects protected historical, social, family, and event records from aggregation', () => {
    const cases = [
      resident(1, { importance: 1 }),
      resident(1, { relationshipIds: [2] }),
      resident(1, { familyIds: [2] }),
      resident(1, { eventIds: [2] }),
    ];
    for (const protectedResident of cases) {
      const state = createPopulationScale(SEED, 0, { detailedResidents: [protectedResident] });
      expect(() => aggregateResidents(state, [1])).toThrow(/cannot aggregate/i);
    }
  });

  it('conserves stable identities, population, and exact key totals through aggregate/deaggregate', () => {
    const initial = createPopulationScale(SEED, 10, {
      detailedResidents: [resident(3), resident(1), resident(2)],
    });
    const beforeTotals = allTotals(initial);
    const aggregated = aggregateResidents(initial, [1, 2, 3]);
    const restored = deaggregateCohort(aggregated, aggregated.cohorts[0]!.id, 3);

    expect(aggregated.detailedResidents).toStrictEqual([]);
    expect(restored.cohorts).toStrictEqual([]);
    expect(restored.detailedResidents.map((value) => value.id)).toStrictEqual([1, 2, 3]);
    expect(allTotals(restored)).toStrictEqual(beforeTotals);
    expect(restored.transfers.map((transfer) => transfer.kind)).toStrictEqual([
      'aggregated',
      'deaggregated',
    ]);
  });

  it('bounds structured transfers and reports deterministic due-work backlog', () => {
    let state = createPopulationScale(SEED, 0, { detailedResidents: [resident(1)] });
    for (let index = 0; index < MAX_SCALE_TRANSFER_DELTAS + 3; index += 1) {
      state = aggregateResidents(state, [1]);
      state = deaggregateCohort(state, state.cohorts[0]!.id, 1);
    }

    expect(state.transfers).toHaveLength(MAX_SCALE_TRANSFER_DELTAS);
    expect(state.transfers[0]!.id).toBe(
      (MAX_SCALE_TRANSFER_DELTAS + 3) * 2 - MAX_SCALE_TRANSFER_DELTAS + 1,
    );
    expect(state.transfers.at(-1)?.id).toBe((MAX_SCALE_TRANSFER_DELTAS + 3) * 2);
    expect(state.backlog).toStrictEqual({ detailedDue: 1, cohortDue: 0, totalDue: 1 });
  });

  it('rejects malformed persisted scale state rather than accepting fabricated authority', () => {
    const state = createPopulationScale(SEED, 0, { detailedResidents: [resident(1)] });
    expect(() =>
      assertPopulationScaleInvariants({
        ...state,
        backlog: { detailedDue: 0, cohortDue: 0, totalDue: 0 },
      }),
    ).toThrow(/backlog/i);
    expect(() =>
      assertPopulationScaleInvariants({
        ...state,
        detailedResidents: [{ ...state.detailedResidents[0]!, rng: [0, 0, 0, 0] }],
      }),
    ).toThrow(/xoshiro/i);
    expect(() =>
      assertPopulationScaleInvariants({
        ...state,
        detailedResidents: [{ ...state.detailedResidents[0]!, relationshipIds: [3, 2] }],
      }),
    ).toThrow(/sorted/i);
  });

  it('emits a canonical stable DTO independent of caller input order', () => {
    const first = createPopulationScale(SEED, 0, { detailedResidents: [resident(2), resident(1)] });
    const second = createPopulationScale(SEED, 0, {
      detailedResidents: [resident(1), resident(2)],
    });

    expect(JSON.stringify(populationScaleDto(first))).toBe(
      JSON.stringify(populationScaleDto(second)),
    );
    expect(populationScaleDto(first)).not.toBe(first);
  });

  it('fast-forwards a large empty logical batch without manufacturing scheduled work', () => {
    const initial = createPopulationScale(SEED, 0, { detailedResidents: [] });
    const advanced = advancePopulationScale(initial, 1_000_000);

    expect(advanced).toMatchObject({
      tick: 1_000_000,
      operationCount: 0,
      backlog: { detailedDue: 0, cohortDue: 0, totalDue: 0 },
    });
  });
});
