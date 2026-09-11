import type { WorldSeed } from '../../src/simulation/world';

export interface M45Scenario {
  readonly name: string;
  readonly seed: WorldSeed;
  readonly yearTicks: number;
  readonly horizonYears: 60;
  readonly checkpointYears: readonly [5, 25, 60];
  readonly expectedHash: string;
  readonly expectedOperations: number;
}

/**
 * Fixed M4.5 long-horizon scenarios with independently reproducible canonical
 * hashes and relationship-operation baselines.
 */
export const M45_SCENARIOS: readonly M45Scenario[] = Object.freeze([
  Object.freeze({
    name: 'river-kinship',
    seed: Object.freeze([7, 11, 13, 17] as const),
    yearTicks: 5_000,
    horizonYears: 60,
    checkpointYears: Object.freeze([5, 25, 60] as const),
    expectedHash: '6f682930',
    expectedOperations: 17_562,
  }),
  Object.freeze({
    name: 'ember-households',
    seed: Object.freeze([19, 23, 29, 31] as const),
    yearTicks: 5_000,
    horizonYears: 60,
    checkpointYears: Object.freeze([5, 25, 60] as const),
    expectedHash: '19d73aca',
    expectedOperations: 10_667,
  }),
  Object.freeze({
    name: 'cinder-memories',
    seed: Object.freeze([37, 41, 43, 47] as const),
    yearTicks: 5_000,
    horizonYears: 60,
    checkpointYears: Object.freeze([5, 25, 60] as const),
    expectedHash: 'c4a19710',
    expectedOperations: 18_960,
  }),
]);

export function m45HorizonTicks(scenario: M45Scenario): number {
  return scenario.yearTicks * scenario.horizonYears;
}
