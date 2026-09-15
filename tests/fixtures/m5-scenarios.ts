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
    expectedHashes: Object.freeze(['b1b31224', '0dc1e8de', '9c77c57c'] as const),
  }),
  Object.freeze({
    name: 'ore-council',
    purpose: 'technology-divergence',
    seed: Object.freeze([19, 23, 29, 31] as const),
    yearTicks: 5_000,
    checkpointYears: Object.freeze([5, 25, 60] as const),
    expectedHashes: Object.freeze(['508eaa50', '688e29f1', '5f2ed79c'] as const),
  }),
  Object.freeze({
    name: 'storm-kin',
    purpose: 'relationship-response',
    seed: Object.freeze([37, 41, 43, 47] as const),
    yearTicks: 5_000,
    checkpointYears: Object.freeze([5, 25, 60] as const),
    expectedHashes: Object.freeze(['6f7060df', '9331b225', 'c50938c9'] as const),
  }),
  Object.freeze({
    name: 'renewed-observatory',
    purpose: 'crisis-recovery',
    seed: Object.freeze([53, 59, 61, 67] as const),
    yearTicks: 5_000,
    checkpointYears: Object.freeze([5, 25, 60] as const),
    expectedHashes: Object.freeze(['1f00e88e', 'd4095b1d', '9e721fb8'] as const),
  }),
]);
