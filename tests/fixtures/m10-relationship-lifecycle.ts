import type { WorldSeed } from '../../src/simulation/world';

export interface M10RelationshipTransitionBaseline {
  readonly firstPersonId: number;
  readonly secondPersonId: number;
  readonly adverseEventId: number;
  readonly adverseTick: number;
  readonly reconciliationEventId: number;
  readonly reconciliationTick: number;
}

export interface M10RelationshipLifecycleScenario {
  readonly name: string;
  readonly seed: WorldSeed;
  readonly founderCount: 6;
  readonly yearTicks: 5_000;
  readonly pulseTicks: 1_000;
  readonly warmupYears: 20;
  readonly pressureYears: 5;
  readonly recoveryYears: 14;
  readonly expectedHash: string;
  readonly expectedOperations: number;
  readonly rivalry: M10RelationshipTransitionBaseline;
  readonly estrangement: M10RelationshipTransitionBaseline;
}

export interface M10WorldRelationshipLifecycleScenario {
  readonly name: string;
  readonly seed: WorldSeed;
  readonly width: 32;
  readonly height: 32;
  readonly chunkSize: 16;
  readonly yearTicks: 5_000;
  readonly warmupYears: 20;
  readonly pressureYears: 20;
  readonly shortageIntervalYears: 2;
  readonly shortageSeverity: 80;
  readonly recoveryYears: 7;
  readonly pressuredHash: string;
  readonly pressuredOperations: number;
  readonly pressuredLivingPeople: number;
  readonly recoveredHash: string;
  readonly recoveredOperations: number;
  readonly recoveredLivingPeople: number;
  readonly estrangements: readonly M10RelationshipTransitionBaseline[];
}

/**
 * A healthy twenty-year society establishes real friendships, households, and
 * family bonds. Five observed scarcity years then create adversity; ordinary
 * healthy pulses must preserve each grudge until its factual reconciliation.
 * Baselines were locked only after semantic and provenance assertions passed.
 */
export const M10_RELATIONSHIP_LIFECYCLE_SCENARIO: M10RelationshipLifecycleScenario = Object.freeze({
  name: 'lean-seasons-reconciliation',
  seed: Object.freeze([1, 2, 3, 4] as const),
  founderCount: 6,
  yearTicks: 5_000,
  pulseTicks: 1_000,
  warmupYears: 20,
  pressureYears: 5,
  recoveryYears: 14,
  expectedHash: 'a77ef018',
  expectedOperations: 6_306,
  rivalry: Object.freeze({
    firstPersonId: 5,
    secondPersonId: 6,
    adverseEventId: 202,
    adverseTick: 125_000,
    reconciliationEventId: 607,
    reconciliationTick: 195_000,
  }),
  estrangement: Object.freeze({
    firstPersonId: 7,
    secondPersonId: 9,
    adverseEventId: 203,
    adverseTick: 125_000,
    reconciliationEventId: 438,
    reconciliationTick: 175_000,
  }),
});

/**
 * A settled production world receives only recorded supply-shortage events at
 * deterministic two-year intervals. The resulting factual family estrangements
 * are snapshotted before ordinary world simulation resumes and reconciles them.
 */
export const M10_WORLD_RELATIONSHIP_LIFECYCLE_SCENARIO: M10WorldRelationshipLifecycleScenario =
  Object.freeze({
    name: 'recorded-shortage-world-recovery',
    seed: Object.freeze([7, 11, 13, 17] as const),
    width: 32,
    height: 32,
    chunkSize: 16,
    yearTicks: 5_000,
    warmupYears: 20,
    pressureYears: 20,
    shortageIntervalYears: 2,
    shortageSeverity: 80,
    recoveryYears: 7,
    pressuredHash: 'db7df5d9',
    pressuredOperations: 10_667,
    pressuredLivingPeople: 23,
    recoveredHash: 'bd9d3d50',
    recoveredOperations: 14_543,
    recoveredLivingPeople: 25,
    estrangements: Object.freeze([
      Object.freeze({
        firstPersonId: 1,
        secondPersonId: 22,
        adverseEventId: 1_189,
        adverseTick: 190_000,
        reconciliationEventId: 1_401,
        reconciliationTick: 235_000,
      }),
      Object.freeze({
        firstPersonId: 2,
        secondPersonId: 22,
        adverseEventId: 1_191,
        adverseTick: 190_000,
        reconciliationEventId: 1_324,
        reconciliationTick: 220_000,
      }),
      Object.freeze({
        firstPersonId: 5,
        secondPersonId: 21,
        adverseEventId: 1_193,
        adverseTick: 190_000,
        reconciliationEventId: 1_335,
        reconciliationTick: 225_000,
      }),
      Object.freeze({
        firstPersonId: 10,
        secondPersonId: 22,
        adverseEventId: 1_196,
        adverseTick: 190_000,
        reconciliationEventId: 1_325,
        reconciliationTick: 220_000,
      }),
    ]),
  });
