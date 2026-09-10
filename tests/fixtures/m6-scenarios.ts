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
    expectedHashes: Object.freeze(['67b57f41', 'f300c305', '4f10ec0a', 'f302fe5d'] as const),
    expectedOperations: Object.freeze({
      settlement: 203_284,
      society: 39_118,
      development: 120,
      civilizations: 1_476,
      total: 243_998,
    }),
  }),
  Object.freeze({
    name: 'ore-coexistence',
    purpose: 'peaceful-coexistence',
    seed: Object.freeze([19, 23, 29, 31] as const),
    yearTicks: 5_000,
    checkpointYears: Object.freeze([5, 25, 60, 120] as const),
    expectedHashes: Object.freeze(['d2bb7f1c', '0b7a8db3', '9179d5ef', '32613ccb'] as const),
    expectedOperations: Object.freeze({
      settlement: 127_749,
      society: 20_627,
      development: 120,
      civilizations: 1_215,
      total: 149_711,
    }),
  }),
  Object.freeze({
    name: 'storm-conquest',
    purpose: 'conflict-conquest',
    seed: Object.freeze([37, 41, 43, 47] as const),
    yearTicks: 5_000,
    checkpointYears: Object.freeze([5, 25, 60, 120] as const),
    expectedHashes: Object.freeze(['77f60371', 'c3858255', 'daef099c', '2c80890d'] as const),
    expectedOperations: Object.freeze({
      settlement: 187_113,
      society: 33_573,
      development: 120,
      civilizations: 2_203,
      total: 223_009,
    }),
  }),
  Object.freeze({
    name: 'renewed-fracture',
    purpose: 'conflict-fragmentation',
    seed: Object.freeze([53, 59, 61, 67] as const),
    yearTicks: 5_000,
    checkpointYears: Object.freeze([5, 25, 60, 120] as const),
    expectedHashes: Object.freeze(['9f18b8e1', '112b7bc4', '7f58d871', '66e4f61c'] as const),
    expectedOperations: Object.freeze({
      settlement: 160_433,
      society: 24_235,
      development: 120,
      civilizations: 1_009,
      total: 185_797,
    }),
  }),
]);
