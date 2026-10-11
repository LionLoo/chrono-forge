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
  readonly shortageSeverity: 70;
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
    shortageSeverity: 70,
    recoveryYears: 7,
    pressuredHash: '11e555e0',
    pressuredOperations: 10_059,
    pressuredLivingPeople: 25,
    recoveredHash: '565e7f6c',
    recoveredOperations: 14_331,
    recoveredLivingPeople: 25,
    estrangements: Object.freeze([
      Object.freeze({
        firstPersonId: 2,
        secondPersonId: 24,
        adverseEventId: 1_262,
        adverseTick: 200_000,
        reconciliationEventId: 1_502,
        reconciliationTick: 235_000,
      }),
      Object.freeze({
        firstPersonId: 6,
        secondPersonId: 23,
        adverseEventId: 1_265,
        adverseTick: 200_000,
        reconciliationEventId: 1_503,
        reconciliationTick: 235_000,
      }),
      Object.freeze({
        firstPersonId: 11,
        secondPersonId: 24,
        adverseEventId: 1_269,
        adverseTick: 200_000,
        reconciliationEventId: 1_504,
        reconciliationTick: 235_000,
      }),
      Object.freeze({
        firstPersonId: 22,
        secondPersonId: 24,
        adverseEventId: 1_281,
        adverseTick: 200_000,
        reconciliationEventId: 1_498,
        reconciliationTick: 230_000,
      }),
    ]),
  });
