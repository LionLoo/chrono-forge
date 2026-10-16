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
    expectedHash: '6cb52cfb',
    expectedOperations: 19_959,
  }),
  Object.freeze({
    name: 'ember-households',
    seed: Object.freeze([19, 23, 29, 31] as const),
    yearTicks: 5_000,
    horizonYears: 60,
    checkpointYears: Object.freeze([5, 25, 60] as const),
    expectedHash: 'eb2b8873',
    expectedOperations: 15_573,
  }),
  Object.freeze({
    name: 'cinder-memories',
    seed: Object.freeze([37, 41, 43, 47] as const),
    yearTicks: 5_000,
    horizonYears: 60,
    checkpointYears: Object.freeze([5, 25, 60] as const),
    expectedHash: 'ec2ee45c',
    expectedOperations: 16_674,
  }),
]);

export function m45HorizonTicks(scenario: M45Scenario): number {
  return scenario.yearTicks * scenario.horizonYears;
}
