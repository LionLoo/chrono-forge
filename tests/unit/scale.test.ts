import { describe, expect, it } from 'vitest';

import {
  FIRST_ORDINARY_RESIDENT_ID,
  MAX_AGGREGATE_RESIDENTS,
  MAX_DETAILED_RESIDENTS,
  MAX_SCALE_COHORT_RESIDENTS,
  MAX_SCALE_TRANSFER_DELTAS,
  advancePopulationScale,
  aggregateResidents,
  assertPopulationScaleInvariants,
  createPopulationScale,
  deaggregateCohort,
  populationScaleDto,
  reconcileAnonymousPopulation,
  reconcilePopulationLod,
  removeAnonymousResidents,
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
    promotionCursor: 0,
  };
}

function fullAggregateCohorts(firstResidentId = MAX_DETAILED_RESIDENTS + 1) {
  return Array.from({ length: MAX_AGGREGATE_RESIDENTS / MAX_SCALE_COHORT_RESIDENTS }, (_, index) =>
    cohort(
      MAX_SCALE_COHORT_RESIDENTS,
      index + 1,
      firstResidentId + index * MAX_SCALE_COHORT_RESIDENTS,
    ),
  );
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
      cohorts: fullAggregateCohorts(),
    });

    expect(state.detailedResidents).toHaveLength(MAX_DETAILED_RESIDENTS);
    expect(state.cohorts).toHaveLength(100);
    expect(state.cohorts.flatMap((entry) => entry.residentIds)).toHaveLength(
      MAX_AGGREGATE_RESIDENTS,
    );
    expect(state.backlog).toStrictEqual({ detailedDue: 5_000, cohortDue: 100, totalDue: 5_100 });
  });

  it('allocates the full population without population-sized platform argument lists', () => {
    const nativeMaximum = Math.max;
    let widestCall = 0;
    Math.max = (...values: number[]) => {
      widestCall = nativeMaximum(widestCall, values.length);
      return nativeMaximum(...values);
    };

    try {
      const state = createPopulationScale(SEED, 0, {
        detailedResidents: Array.from({ length: MAX_DETAILED_RESIDENTS }, (_, index) =>
          resident(index + 1),
        ),
        cohorts: fullAggregateCohorts(),
      });

      expect(state.nextResidentId).toBe(FIRST_ORDINARY_RESIDENT_ID);
      expect(widestCall).toBeLessThanOrEqual(16);
    } finally {
      Math.max = nativeMaximum;
    }
  });

  it('is partition-equivalent with deterministic fixed-quota schedule and isolated RNGs', () => {
    const initial = createPopulationScale(SEED, 0, {
      detailedResidents: Array.from({ length: 300 }, (_, index) => resident(index + 1)),
      cohorts: [cohort(20)],
    });
    const initialDto = populationScaleDto(initial);
    expect(advancePopulationScale(initial, 0)).toBe(initial);
    const oneShot = advancePopulationScale(initial, 19);
    let partitioned = initial;
    for (const ticks of [1, 7, 2, 9]) partitioned = advancePopulationScale(partitioned, ticks);

    expect(populationScaleDto(initial)).toStrictEqual(initialDto);
    expect(populationScaleDto(partitioned)).toStrictEqual(populationScaleDto(oneShot));
    expect(oneShot.operationCount).toBeGreaterThan(0);
    expect(oneShot.backlog.totalDue).toBeLessThanOrEqual(5_256);
  });

  it('services every detailed resident under the full fixed-quota backlog without ID starvation', () => {
    const initial = createPopulationScale(SEED, 0, {
      detailedResidents: Array.from({ length: MAX_DETAILED_RESIDENTS }, (_, index) =>
        resident(index + 1),
      ),
    });
    const advanced = advancePopulationScale(initial, 40);

    expect(advanced.operationCount).toBe(MAX_DETAILED_RESIDENTS);
    expect(advanced.backlog.totalDue).toBe(0);
    expect(advanced.detailedResidents[0]?.updateCount).toBe(1);
    expect(advanced.detailedResidents.at(-1)?.updateCount).toBe(1);
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

  it('reports only the newly merged residents and totals in an aggregation transfer', () => {
    const initial = createPopulationScale(SEED, 10, {
      detailedResidents: [resident(1), resident(2)],
    });
    const first = aggregateResidents(initial, [1]);
    const merged = aggregateResidents(first, [2]);

    expect(merged.cohorts[0]?.residentIds).toStrictEqual([1, 2]);
    expect(merged.transfers.at(-1)).toMatchObject({
      kind: 'aggregated',
      residentCount: 1,
      firstResidentId: 2,
      lastResidentId: 2,
      totals: {
        age: resident(2).age,
        health: resident(2).health,
        foodNeed: resident(2).foodNeed,
        waterNeed: resident(2).waterNeed,
        safety: resident(2).safety,
        skill: resident(2).skill,
      },
    });
  });

  it('rotates an ordinary detailed sample through mature cohorts without touching protected lives', () => {
    const initial = createPopulationScale(SEED, 0, {
      detailedResidents: [
        resident(1, { importance: 1, updateCount: 1 }),
        resident(2, { updateCount: 1 }),
        resident(3, { updateCount: 1 }),
        resident(4, { updateCount: 1 }),
      ],
    });
    const beforeTotals = allTotals(initial);
    const collapsed = reconcilePopulationLod(initial, 0);

    expect(collapsed.detailedResidents.map((value) => value.id)).toStrictEqual([1]);
    expect(collapsed.cohorts[0]?.residentIds).toStrictEqual([2, 3, 4]);

    const mature = advancePopulationScale(collapsed, 16);
    const promoted = reconcilePopulationLod(mature, 1);
    expect(promoted.detailedResidents.map((value) => value.id)).toStrictEqual([1, 2]);
    expect(promoted.cohorts[0]?.residentIds).toStrictEqual([3, 4]);
    expect(allTotals(promoted)).toStrictEqual(beforeTotals);

    const rotated = reconcilePopulationLod(advancePopulationScale(promoted, 64), 2);
    expect(rotated.detailedResidents.map((value) => value.id)).toStrictEqual([1, 3]);
    expect(rotated.cohorts[0]?.residentIds).toStrictEqual([2, 4]);
    expect(allTotals(rotated)).toStrictEqual(beforeTotals);
    expect(() => assertPopulationScaleInvariants(rotated)).not.toThrow();
  });

  it('services more than one aggregation quota of classifications without starvation', () => {
    const initial = createPopulationScale(SEED, 0, {
      detailedResidents: Array.from({ length: 33 }, (_, index) =>
        resident(index + 1, { householdId: index + 1, updateCount: 1 }),
      ),
    });
    const first = reconcilePopulationLod(initial, 0);
    const second = reconcilePopulationLod(first, 1);
    let completed = second;
    for (let pulse = 2; pulse < 33; pulse += 1) {
      completed = reconcilePopulationLod(completed, pulse);
    }

    expect(first.cohorts).toHaveLength(1);
    expect(second.cohorts).toHaveLength(2);
    expect(completed.cohorts).toHaveLength(33);
    expect(completed.detailedResidents).toStrictEqual([]);
    expect(
      completed.cohorts.flatMap((entry) => entry.residentIds).sort((left, right) => left - right),
    ).toStrictEqual(Array.from({ length: 33 }, (_, index) => index + 1));
  });

  it('leaves valid authority at detail and aggregate capacity instead of over-promoting or collapsing', () => {
    const fullDetail = createPopulationScale(SEED, 0, {
      detailedResidents: Array.from({ length: MAX_DETAILED_RESIDENTS }, (_, index) =>
        resident(index + 1, { importance: 1 }),
      ),
      cohorts: [cohort(1, 1, MAX_DETAILED_RESIDENTS + 1)],
    });
    const fullAggregate = createPopulationScale(SEED, 0, {
      detailedResidents: [resident(1, { updateCount: 1 })],
      cohorts: fullAggregateCohorts(10_001),
    });

    expect(reconcilePopulationLod(fullDetail, 0)).toStrictEqual(fullDetail);
    expect(reconcilePopulationLod(fullAggregate, 0)).toStrictEqual(fullAggregate);
  });

  it('promotes every member even when cohort size shares a divisor with update cadence', () => {
    let state = createPopulationScale(SEED, 0, {
      detailedResidents: [],
      cohorts: [cohort(6)],
    });
    const promotedIds: number[] = [];

    for (let pulse = 0; pulse < 6; pulse += 1) {
      state = advancePopulationScale(state, pulse === 0 ? 16 : 64);
      state = reconcilePopulationLod(state, pulse);
      promotedIds.push(state.transfers.at(-1)!.firstResidentId);
    }

    expect(promotedIds).toStrictEqual([10_001, 10_002, 10_003, 10_004, 10_005, 10_006]);
    expect(() => assertPopulationScaleInvariants(state)).not.toThrow();
  });

  it('materializes and removes anonymous settlement surplus without reusing identities', () => {
    const initial = createPopulationScale(SEED, 0, { detailedResidents: [resident(1)] });
    const target = {
      settlementId: 1,
      civilizationId: 1,
      cultureId: 1,
      tileIndex: 9,
      residentCount: 5,
    };
    const materialized = reconcileAnonymousPopulation(initial, [target]);
    expect(materialized.cohorts[0]).toMatchObject({
      classification: { householdId: 0 },
      householdCount: 0,
      residentIds: Array.from({ length: 5 }, (_, index) => FIRST_ORDINARY_RESIDENT_ID + index),
    });
    expect(materialized.transfers.at(-1)?.kind).toBe('materialized');

    const reduced = reconcileAnonymousPopulation(materialized, [{ ...target, residentCount: 2 }]);
    expect(reduced.cohorts[0]?.residentIds).toStrictEqual([
      FIRST_ORDINARY_RESIDENT_ID,
      FIRST_ORDINARY_RESIDENT_ID + 1,
    ]);
    expect(reduced.transfers.at(-1)?.kind).toBe('removed');

    const regrown = reconcileAnonymousPopulation(reduced, [target]);
    expect(regrown.cohorts[0]?.residentIds).toStrictEqual([
      FIRST_ORDINARY_RESIDENT_ID,
      FIRST_ORDINARY_RESIDENT_ID + 1,
      FIRST_ORDINARY_RESIDENT_ID + 5,
      FIRST_ORDINARY_RESIDENT_ID + 6,
      FIRST_ORDINARY_RESIDENT_ID + 7,
    ]);
    expect(regrown.nextResidentId).toBe(FIRST_ORDINARY_RESIDENT_ID + 8);
    expect(() => assertPopulationScaleInvariants(regrown)).not.toThrow();
  });

  it('removes exact anonymous identities with conserved cohort totals and no allocator rewind', () => {
    const initial = createPopulationScale(SEED, 0, { detailedResidents: [] });
    const populated = reconcileAnonymousPopulation(initial, [
      {
        settlementId: 1,
        civilizationId: 1,
        cultureId: 1,
        tileIndex: 9,
        residentCount: 5,
      },
    ]);
    const ids = populated.cohorts[0]!.residentIds;
    const beforeNextResidentId = populated.nextResidentId;
    const transferred = removeAnonymousResidents(populated, [ids[1]!, ids[3]!]);

    expect(transferred.cohorts[0]!.residentIds).toStrictEqual([ids[0], ids[2], ids[4]]);
    expect(transferred.nextResidentId).toBe(beforeNextResidentId);
    expect(transferred.transfers.at(-1)).toMatchObject({
      kind: 'removed',
      cohortId: populated.cohorts[0]!.id,
      residentCount: 2,
      firstResidentId: ids[1],
      lastResidentId: ids[3],
    });
    expect(() => assertPopulationScaleInvariants(transferred)).not.toThrow();
    expect(() => removeAnonymousResidents(populated, [ids[0]!, ids[0]!])).toThrow(/sorted/i);
    expect(() => removeAnonymousResidents(populated, [999])).toThrow(/ordinary/i);
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
