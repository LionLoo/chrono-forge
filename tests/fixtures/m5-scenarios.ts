import type { WorldSeed } from '../../src/simulation/world';

export interface M5Scenario {
  readonly name: string;
  readonly purpose: 'technology-divergence' | 'crisis-recovery' | 'relationship-response';
  readonly seed: WorldSeed;
  readonly yearTicks: number;
  readonly checkpointYears: readonly [5, 25, 60];
  readonly expectedHashes: readonly [string, string, string];
}

export const M5_KNOWLEDGE_LOSS_SCENARIO = Object.freeze({
  name: 'iron-pollinators-loss-witness',
  seed: Object.freeze([337, 347, 349, 353] as const),
  yearTicks: 5_000,
  horizonYears: 60,
  expectedHash: '8dddaa19',
  expectedLossTick: 245_000,
});

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
    expectedHashes: Object.freeze(['7827fcb3', '3c0a752f', '6cb52cfb'] as const),
  }),
  Object.freeze({
    name: 'ore-council',
    purpose: 'technology-divergence',
    seed: Object.freeze([19, 23, 29, 31] as const),
    yearTicks: 5_000,
    checkpointYears: Object.freeze([5, 25, 60] as const),
    expectedHashes: Object.freeze(['96d98332', '3dbf876b', 'eb2b8873'] as const),
  }),
  Object.freeze({
    name: 'storm-kin',
    purpose: 'relationship-response',
    seed: Object.freeze([37, 41, 43, 47] as const),
    yearTicks: 5_000,
    checkpointYears: Object.freeze([5, 25, 60] as const),
    expectedHashes: Object.freeze(['896d1dc5', 'a787da6a', 'ec2ee45c'] as const),
  }),
  Object.freeze({
    name: 'renewed-observatory',
    purpose: 'crisis-recovery',
    seed: Object.freeze([53, 59, 61, 67] as const),
    yearTicks: 5_000,
    checkpointYears: Object.freeze([5, 25, 60] as const),
    expectedHashes: Object.freeze(['efeec5c9', 'c191920e', '4151b92a'] as const),
  }),
]);
