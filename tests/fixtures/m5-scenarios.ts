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
    expectedHashes: Object.freeze(['67b57f41', 'f300c305', '4f10ec0a'] as const),
  }),
  Object.freeze({
    name: 'ore-council',
    purpose: 'technology-divergence',
    seed: Object.freeze([19, 23, 29, 31] as const),
    yearTicks: 5_000,
    checkpointYears: Object.freeze([5, 25, 60] as const),
    expectedHashes: Object.freeze(['d2bb7f1c', '0b7a8db3', '9179d5ef'] as const),
  }),
  Object.freeze({
    name: 'storm-kin',
    purpose: 'relationship-response',
    seed: Object.freeze([37, 41, 43, 47] as const),
    yearTicks: 5_000,
    checkpointYears: Object.freeze([5, 25, 60] as const),
    expectedHashes: Object.freeze(['77f60371', 'c3858255', 'daef099c'] as const),
  }),
  Object.freeze({
    name: 'renewed-observatory',
    purpose: 'crisis-recovery',
    seed: Object.freeze([53, 59, 61, 67] as const),
    yearTicks: 5_000,
    checkpointYears: Object.freeze([5, 25, 60] as const),
    expectedHashes: Object.freeze(['9f18b8e1', '112b7bc4', '7f58d871'] as const),
  }),
]);
