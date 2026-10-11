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
    expectedHashes: Object.freeze(['b1b31224', '06e506ef', '2182b552', 'd2181c3a'] as const),
    expectedOperations: Object.freeze({
      settlement: 203_284,
      society: 39_118,
      development: 120,
      civilizations: 1_935,
      total: 244_457,
    }),
  }),
  Object.freeze({
    name: 'ore-coexistence',
    purpose: 'peaceful-coexistence',
    seed: Object.freeze([19, 23, 29, 31] as const),
    yearTicks: 5_000,
    checkpointYears: Object.freeze([5, 25, 60, 120] as const),
    expectedHashes: Object.freeze(['508eaa50', '9483c5c5', '1c5d4e12', 'fbf7a773'] as const),
    expectedOperations: Object.freeze({
      settlement: 128_649,
      society: 20_902,
      development: 120,
      civilizations: 1_646,
      total: 151_317,
    }),
  }),
  Object.freeze({
    name: 'storm-conquest',
    purpose: 'conflict-conquest',
    seed: Object.freeze([37, 41, 43, 47] as const),
    yearTicks: 5_000,
    checkpointYears: Object.freeze([5, 25, 60, 120] as const),
    expectedHashes: Object.freeze(['6f7060df', 'c9b0bbf1', 'afcfa13d', 'c13123f9'] as const),
    expectedOperations: Object.freeze({
      settlement: 187_113,
      society: 33_573,
      development: 120,
      civilizations: 2_692,
      total: 223_498,
    }),
  }),
  Object.freeze({
    name: 'renewed-fracture',
    purpose: 'conflict-fragmentation',
    seed: Object.freeze([53, 59, 61, 67] as const),
    yearTicks: 5_000,
    checkpointYears: Object.freeze([5, 25, 60, 120] as const),
    expectedHashes: Object.freeze(['59cd9799', 'bdaee725', '31fdc103', '43a1bd16'] as const),
    expectedOperations: Object.freeze({
      settlement: 160_433,
      society: 24_235,
      development: 120,
      civilizations: 1_277,
      total: 186_065,
    }),
  }),
]);
