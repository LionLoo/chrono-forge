import type { WorldSeed } from '../../src/simulation/world';

export type M6ScenarioPurpose =
  'peaceful-federation' | 'peaceful-coexistence' | 'conflict-conquest' | 'conflict-fragmentation';

export interface M6Scenario {
  readonly name: string;
  readonly purpose: M6ScenarioPurpose;
  readonly seed: WorldSeed;
  readonly yearTicks: 5_000;
  readonly checkpointYears: readonly [5, 25, 60, 120];
  readonly expectedHashes: readonly [string, string, string, string];
  readonly expectedOperations: Readonly<{
    settlement: number;
    society: number;
    development: number;
    civilizations: number;
    total: number;
  }>;
}

/**
 * Locked pre-implementation M6 worlds. They deliberately continue the M5
 * catalogue so technology, crises, relationships, and geopolitics are tested
 * together rather than in isolated replacement worlds.
 */
export const M6_SCENARIOS: readonly M6Scenario[] = Object.freeze([
  Object.freeze({
    name: 'river-federation',
    purpose: 'peaceful-federation',
    seed: Object.freeze([7, 11, 13, 17] as const),
    yearTicks: 5_000,
    checkpointYears: Object.freeze([5, 25, 60, 120] as const),
    expectedHashes: Object.freeze(['7827fcb3', '3c0a752f', '6cb52cfb', '5e376661'] as const),
    expectedOperations: Object.freeze({
      settlement: 212_212,
      society: 38_654,
      development: 120,
      civilizations: 1_917,
      total: 252_903,
    }),
  }),
  Object.freeze({
    name: 'ore-coexistence',
    purpose: 'peaceful-coexistence',
    seed: Object.freeze([19, 23, 29, 31] as const),
    yearTicks: 5_000,
    checkpointYears: Object.freeze([5, 25, 60, 120] as const),
    expectedHashes: Object.freeze(['96d98332', '3dbf876b', 'eb2b8873', 'f18dad05'] as const),
    expectedOperations: Object.freeze({
      settlement: 187_625,
      society: 32_657,
      development: 120,
      civilizations: 1_680,
      total: 222_082,
    }),
  }),
  Object.freeze({
    name: 'storm-conquest',
    purpose: 'conflict-conquest',
    seed: Object.freeze([37, 41, 43, 47] as const),
    yearTicks: 5_000,
    checkpointYears: Object.freeze([5, 25, 60, 120] as const),
    expectedHashes: Object.freeze(['896d1dc5', 'a787da6a', 'ec2ee45c', 'be9ab2d9'] as const),
    expectedOperations: Object.freeze({
      settlement: 136_645,
      society: 20_410,
      development: 120,
      civilizations: 2_455,
      total: 159_630,
    }),
  }),
  Object.freeze({
    name: 'renewed-fracture',
    purpose: 'conflict-fragmentation',
    seed: Object.freeze([53, 59, 61, 67] as const),
    yearTicks: 5_000,
    checkpointYears: Object.freeze([5, 25, 60, 120] as const),
    expectedHashes: Object.freeze(['efeec5c9', 'c191920e', '4151b92a', '3650aeef'] as const),
    expectedOperations: Object.freeze({
      settlement: 157_296,
      society: 25_455,
      development: 120,
      civilizations: 1_307,
      total: 184_178,
    }),
  }),
]);
