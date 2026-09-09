import type { WorldSeed } from '../../src/simulation/world';

export interface M5Scenario {
  readonly name: string;
  readonly purpose: 'technology-divergence' | 'crisis-recovery' | 'relationship-response';
  readonly seed: WorldSeed;
  readonly yearTicks: number;
  readonly checkpointYears: readonly [5, 25, 60];
  readonly expectedHashes: readonly [string, string, string];
}

/**
 * Stable accelerated worlds for the M5 semantic and eventual golden gates.
 * Hashes and operation totals are locked only after the observable behavior is
 * accepted; the seeds and checkpoints are part of the pre-implementation contract.
 */
export const M5_SCENARIOS: readonly M5Scenario[] = Object.freeze([
  Object.freeze({
    name: 'river-inventors',
    purpose: 'technology-divergence',
    seed: Object.freeze([7, 11, 13, 17] as const),
    yearTicks: 5_000,
    checkpointYears: Object.freeze([5, 25, 60] as const),
    expectedHashes: Object.freeze(['c5a874d2', '6fd1de9c', 'a9e8787b'] as const),
  }),
  Object.freeze({
    name: 'ore-council',
    purpose: 'technology-divergence',
    seed: Object.freeze([19, 23, 29, 31] as const),
    yearTicks: 5_000,
    checkpointYears: Object.freeze([5, 25, 60] as const),
    expectedHashes: Object.freeze(['37dbedd1', '19c76416', 'bc453308'] as const),
  }),
  Object.freeze({
    name: 'storm-kin',
    purpose: 'relationship-response',
    seed: Object.freeze([37, 41, 43, 47] as const),
    yearTicks: 5_000,
    checkpointYears: Object.freeze([5, 25, 60] as const),
    expectedHashes: Object.freeze(['d3568609', 'fa6c9fd4', '134b4cf3'] as const),
  }),
  Object.freeze({
    name: 'renewed-observatory',
    purpose: 'crisis-recovery',
    seed: Object.freeze([53, 59, 61, 67] as const),
    yearTicks: 5_000,
    checkpointYears: Object.freeze([5, 25, 60] as const),
    expectedHashes: Object.freeze(['9754f770', '321db8ca', '4cde1b7a'] as const),
  }),
]);
