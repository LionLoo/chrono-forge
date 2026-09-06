// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';

import { hashCanonicalJson } from '../../src/simulation/canonical';
import {
  FIRST_ORDINARY_RESIDENT_ID,
  advancePopulationScale,
  createPopulationScale,
  populationScaleDto,
  reconcilePopulationLod,
  type AggregateCohortState,
  type AggregateTotals,
  type DetailedResidentState,
  type PopulationScaleState,
} from '../../src/simulation/scale';
import {
  assertWorldInvariants,
  createInitialWorld,
  initializeM8WorldAuthority,
} from '../../src/simulation/world';

const SCALE_SEED = [8_080, 5_000, 100_000, 7] as const;
const DETAILED_RESIDENT_COUNT = 5_000;
const AGGREGATE_RESIDENT_COUNT = 100_000;
const AGGREGATE_COHORT_COUNT = 100;
const RESIDENTS_PER_COHORT = AGGREGATE_RESIDENT_COUNT / AGGREGATE_COHORT_COUNT;
const WARM_UP_BATCHES = 10;
const MEASURED_BATCHES = 100;
const TICKS_PER_BATCH = 10;

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
  const totals = residentTotals(id);
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
    ...totals,
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
    (_, residentIndex) => firstResidentId + residentIndex,
  );
  const totals = residentIds.reduce<AggregateTotals>(
    (current, id) => addTotals(current, residentTotals(id)),
    { age: 0, health: 0, foodNeed: 0, waterNeed: 0, safety: 0, skill: 0 },
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
    totals,
    nextUpdateTick: 0,
    updateCount: 0,
    promotionCursor: 0,
  };
}

function createScaleScenario(): PopulationScaleState {
  return createPopulationScale(SCALE_SEED, 0, {
    detailedResidents: Array.from({ length: DETAILED_RESIDENT_COUNT }, (_, index) =>
      resident(index + 1),
    ),
    cohorts: Array.from({ length: AGGREGATE_COHORT_COUNT }, (_, index) => cohort(index)),
  });
}

function createProductionLodScenario(): PopulationScaleState {
  const initial = createInitialWorld(SCALE_SEED);
  const primarySettlement = initial.civilizations.settlements[0]!;
  const authoritativePopulation = {
    ...initial,
    civilizations: {
      ...initial.civilizations,
      settlements: initial.civilizations.settlements.map((settlement) =>
        settlement.id === primarySettlement.id
          ? { ...settlement, population: settlement.population + AGGREGATE_RESIDENT_COUNT }
          : settlement,
      ),
    },
  };
  const world = {
    ...authoritativePopulation,
    ...initializeM8WorldAuthority(authoritativePopulation),
  };
  assertWorldInvariants(world);
  return world.populationScale;
}

function canonicalHash(state: PopulationScaleState): string {
  return hashCanonicalJson(JSON.stringify(populationScaleDto(state)));
}

function combinedTotals(state: PopulationScaleState): AggregateTotals {
  return [
    ...state.detailedResidents.map((entry) => ({
      age: entry.age,
      health: entry.health,
      foodNeed: entry.foodNeed,
      waterNeed: entry.waterNeed,
      safety: entry.safety,
      skill: entry.skill,
    })),
    ...state.cohorts.map((entry) => entry.totals),
  ].reduce<AggregateTotals>(addTotals, {
    age: 0,
    health: 0,
    foodNeed: 0,
    waterNeed: 0,
    safety: 0,
    skill: 0,
  });
}

function percentile(samples: readonly number[], percentileValue: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil((percentileValue / 100) * sorted.length) - 1]!;
}

function commit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return process.env.GITHUB_SHA ?? 'unknown';
  }
}

describe('M8 scale performance evidence', () => {
  it('reconciles production LOD across 100,000 residents within fixed transfer and heap bounds', () => {
    const initial = createProductionLodScenario();
    const initialTotals = combinedTotals(initial);
    const protectedIds = initial.detailedResidents.map((entry) => entry.id);
    expect(initial.cohorts).toHaveLength(AGGREGATE_COHORT_COUNT);
    expect(
      initial.cohorts.every((entry) => entry.residentIds.length === RESIDENTS_PER_COHORT),
    ).toBe(true);
    let state = advancePopulationScale(initial, 16);
    let peakHeapBytes = process.memoryUsage().heapUsed;
    const durationsMs: number[] = [];
    const promotedCohortIds = new Set<number>();
    const promotedResidentIdsByCohort = new Map<number, Set<number>>();
    const pulses = 200;

    for (let pulse = 0; pulse < WARM_UP_BATCHES + pulses; pulse += 1) {
      const startedAt = performance.now();
      state = reconcilePopulationLod(state, pulse);
      const durationMs = performance.now() - startedAt;
      const transfer = state.transfers.at(-1);
      if (transfer?.kind === 'deaggregated') {
        promotedCohortIds.add(transfer.cohortId);
        const residentIds = promotedResidentIdsByCohort.get(transfer.cohortId) ?? new Set<number>();
        residentIds.add(transfer.firstResidentId);
        promotedResidentIdsByCohort.set(transfer.cohortId, residentIds);
      }
      state = advancePopulationScale(state, 64);
      if (pulse >= WARM_UP_BATCHES) durationsMs.push(durationMs);
      peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
    }

    const report = {
      ImageOS: process.env.ImageOS ?? 'unknown',
      ImageVersion: process.env.ImageVersion ?? 'unknown',
      Node: process.version,
      commit: commit(),
      warmupPulses: WARM_UP_BATCHES,
      samples: pulses,
      medianReconcileMs: percentile(durationsMs, 50),
      p95ReconcileMs: percentile(durationsMs, 95),
      p99ReconcileMs: percentile(durationsMs, 99),
      peakHeapMiB: peakHeapBytes / 1024 / 1024,
      canonicalHash: canonicalHash(state),
      operationCount: state.operationCount,
      promotedCohorts: promotedCohortIds.size,
      leastDistinctResidentsPerCohort: Math.min(
        ...[...promotedResidentIdsByCohort.values()].map((residentIds) => residentIds.size),
      ),
      transfersRetained: state.transfers.length,
    };
    console.info('M8 production LOD performance evidence', report);

    expect(report.p95ReconcileMs).toBeLessThan(50);
    expect(report.p99ReconcileMs).toBeLessThan(100);
    expect(peakHeapBytes).toBeLessThan(512 * 1024 * 1024);
    expect(combinedTotals(state)).toStrictEqual(initialTotals);
    expect(
      state.detailedResidents.slice(0, protectedIds.length).map((entry) => entry.id),
    ).toStrictEqual(protectedIds);
    expect(
      state.detailedResidents.every(
        (entry) =>
          protectedIds.includes(entry.id) ||
          (entry.id >= FIRST_ORDINARY_RESIDENT_ID && entry.importance === 0),
      ),
    ).toBe(true);
    expect(state.cohorts.flatMap((entry) => entry.residentIds)).toHaveLength(
      AGGREGATE_RESIDENT_COUNT - (state.detailedResidents.length - protectedIds.length),
    );
    expect(state.transfers.length).toBeLessThanOrEqual(256);
    expect(promotedCohortIds.size).toBe(AGGREGATE_COHORT_COUNT);
    expect(
      [...promotedResidentIdsByCohort.values()].every((residentIds) => residentIds.size >= 2),
    ).toBe(true);
    expect({
      canonicalHash: canonicalHash(state),
      operationCount: state.operationCount,
      promotedCohorts: promotedCohortIds.size,
      leastDistinctResidentsPerCohort: Math.min(
        ...[...promotedResidentIdsByCohort.values()].map((residentIds) => residentIds.size),
      ),
      transfersRetained: state.transfers.length,
    }).toStrictEqual({
      canonicalHash: '51b4a67a',
      operationCount: 85_576,
      promotedCohorts: 100,
      leastDistinctResidentsPerCohort: 2,
      transfersRetained: 256,
    });
  }, 180_000);

  it('sustains the fixed detailed and aggregate authority scenario with bounded deterministic work', () => {
    const initial = createScaleScenario();
    const initialTotals = combinedTotals(initial);
    const protectedReferences = initial.detailedResidents.slice(0, 4).map((entry) => ({
      id: entry.id,
      importance: entry.importance,
      relationshipIds: entry.relationshipIds,
      familyIds: entry.familyIds,
      eventIds: entry.eventIds,
    }));

    let warmed = initial;
    let maximumBacklog = initial.backlog.totalDue;
    for (let index = 0; index < WARM_UP_BATCHES; index += 1) {
      warmed = advancePopulationScale(warmed, TICKS_PER_BATCH);
      maximumBacklog = Math.max(maximumBacklog, warmed.backlog.totalDue);
    }

    let measured = warmed;
    let peakHeapBytes = process.memoryUsage().heapUsed;
    const durationsMs: number[] = [];
    for (let index = 0; index < MEASURED_BATCHES; index += 1) {
      const startedAt = performance.now();
      measured = advancePopulationScale(measured, TICKS_PER_BATCH);
      durationsMs.push(performance.now() - startedAt);
      peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
      maximumBacklog = Math.max(maximumBacklog, measured.backlog.totalDue);
    }

    let partitioned = initial;
    for (const ticks of [1, 19, 7, 113, 2, 431, 527]) {
      partitioned = advancePopulationScale(partitioned, ticks);
      peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
    }
    const oneShot = advancePopulationScale(initial, 1_100);
    peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
    const totalDurationMs = durationsMs.reduce((total, value) => total + value, 0);
    const throughputTicksPerSecond = (MEASURED_BATCHES * TICKS_PER_BATCH * 1_000) / totalDurationMs;
    const report = {
      ImageOS: process.env.ImageOS ?? 'unknown',
      ImageVersion: process.env.ImageVersion ?? 'unknown',
      Node: process.version,
      commit: commit(),
      warmupBatches: WARM_UP_BATCHES,
      samples: MEASURED_BATCHES,
      ticksPerSecond: throughputTicksPerSecond,
      medianTickMs: percentile(durationsMs, 50) / TICKS_PER_BATCH,
      p95TickMs: percentile(durationsMs, 95) / TICKS_PER_BATCH,
      p99TickMs: percentile(durationsMs, 99) / TICKS_PER_BATCH,
      peakHeapMiB: peakHeapBytes / 1024 / 1024,
      canonicalHash: canonicalHash(measured),
      operationCount: measured.operationCount,
      maximumBacklog,
    };
    console.info('M8 scale performance evidence', report);

    expect(throughputTicksPerSecond).toBeGreaterThanOrEqual(10);
    expect(report.p95TickMs).toBeLessThan(50);
    expect(report.p99TickMs).toBeLessThan(100);
    expect(peakHeapBytes).toBeLessThan(512 * 1024 * 1024);
    expect(measured.detailedResidents).toHaveLength(DETAILED_RESIDENT_COUNT);
    expect(measured.cohorts.flatMap((entry) => entry.residentIds)).toHaveLength(
      AGGREGATE_RESIDENT_COUNT,
    );
    expect(combinedTotals(measured)).toStrictEqual(initialTotals);
    expect(
      measured.detailedResidents.slice(0, 4).map((entry) => ({
        id: entry.id,
        importance: entry.importance,
        relationshipIds: entry.relationshipIds,
        familyIds: entry.familyIds,
        eventIds: entry.eventIds,
      })),
    ).toStrictEqual(protectedReferences);
    expect(populationScaleDto(partitioned)).toStrictEqual(populationScaleDto(oneShot));
    expect(maximumBacklog).toBeLessThanOrEqual(5_000 + AGGREGATE_COHORT_COUNT);
    expect({
      canonicalHash: canonicalHash(measured),
      operationCount: measured.operationCount,
      maxBacklog: maximumBacklog,
    }).toStrictEqual({
      canonicalHash: 'bbb077e3',
      operationCount: 93_048,
      maxBacklog: 5_100,
    });
  }, 180_000);

  it('soaks 10,000 ticks without inactivity, reference loss, conservation drift, or unbounded backlog', () => {
    const initial = createScaleScenario();
    const initialTotals = combinedTotals(initial);
    const initialReferences = initial.detailedResidents.slice(0, 4).map((entry) => ({
      id: entry.id,
      importance: entry.importance,
      relationshipIds: entry.relationshipIds,
      familyIds: entry.familyIds,
      eventIds: entry.eventIds,
    }));
    let state = initial;
    let priorOperationCount = state.operationCount;
    let maximumBacklog = state.backlog.totalDue;
    let peakHeapBytes = process.memoryUsage().heapUsed;

    for (let batch = 0; batch < 100; batch += 1) {
      state = advancePopulationScale(state, 100);
      expect(state.operationCount).toBeGreaterThan(priorOperationCount);
      priorOperationCount = state.operationCount;
      maximumBacklog = Math.max(maximumBacklog, state.backlog.totalDue);
      peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
    }

    const detailedUpdateCounts = state.detailedResidents.map((entry) => entry.updateCount);
    console.info('M8 scale soak evidence', {
      ImageOS: process.env.ImageOS ?? 'unknown',
      ImageVersion: process.env.ImageVersion ?? 'unknown',
      Node: process.version,
      commit: commit(),
      ticks: state.tick,
      operationCount: state.operationCount,
      maximumBacklog,
      minimumDetailedUpdates: Math.min(...detailedUpdateCounts),
      maximumDetailedUpdates: Math.max(...detailedUpdateCounts),
      peakHeapMiB: peakHeapBytes / 1024 / 1024,
      canonicalHash: canonicalHash(state),
    });

    expect(Math.min(...detailedUpdateCounts)).toBeGreaterThan(0);
    expect(
      Math.max(...detailedUpdateCounts) - Math.min(...detailedUpdateCounts),
    ).toBeLessThanOrEqual(1);
    expect(maximumBacklog).toBeLessThanOrEqual(5_000 + AGGREGATE_COHORT_COUNT);
    expect(peakHeapBytes).toBeLessThan(512 * 1024 * 1024);
    expect(combinedTotals(state)).toStrictEqual(initialTotals);
    expect({ hash: canonicalHash(state), operationCount: state.operationCount }).toStrictEqual({
      hash: '1d67d8e6',
      operationCount: 844_160,
    });
    expect(
      state.detailedResidents.slice(0, 4).map((entry) => ({
        id: entry.id,
        importance: entry.importance,
        relationshipIds: entry.relationshipIds,
        familyIds: entry.familyIds,
        eventIds: entry.eventIds,
      })),
    ).toStrictEqual(initialReferences);
  }, 180_000);
});
