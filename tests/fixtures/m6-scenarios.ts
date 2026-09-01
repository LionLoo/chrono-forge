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
    expectedHashes: Object.freeze(['4cc24c6d', 'b6662df2', 'f1e35f26', '417c61ba'] as const),
    expectedOperations: Object.freeze({
      settlement: 384_429,
      society: 37_960,
      development: 120,
      civilizations: 1_455,
      total: 423_964,
    }),
  }),
  Object.freeze({
    name: 'ore-coexistence',
    purpose: 'peaceful-coexistence',
    seed: Object.freeze([19, 23, 29, 31] as const),
    yearTicks: 5_000,
    checkpointYears: Object.freeze([5, 25, 60, 120] as const),
    expectedHashes: Object.freeze(['efe2c640', '58f89c87', 'a0465247', '5b54b8c6'] as const),
    expectedOperations: Object.freeze({
      settlement: 296_324,
      society: 27_482,
      development: 120,
      civilizations: 985,
      total: 324_911,
    }),
  }),
  Object.freeze({
    name: 'storm-conquest',
    purpose: 'conflict-conquest',
    seed: Object.freeze([37, 41, 43, 47] as const),
    yearTicks: 5_000,
    checkpointYears: Object.freeze([5, 25, 60, 120] as const),
    expectedHashes: Object.freeze(['822c317d', '1bd134dd', '3135639c', 'c2f4b3ec'] as const),
    expectedOperations: Object.freeze({
      settlement: 271_361,
      society: 23_136,
      development: 120,
      civilizations: 569,
      total: 295_186,
    }),
  }),
  Object.freeze({
    name: 'renewed-fracture',
    purpose: 'conflict-fragmentation',
    seed: Object.freeze([53, 59, 61, 67] as const),
    yearTicks: 5_000,
    checkpointYears: Object.freeze([5, 25, 60, 120] as const),
    expectedHashes: Object.freeze(['e1e02d78', 'dd8fa1ff', '47c11bd6', 'f538d979'] as const),
    expectedOperations: Object.freeze({
      settlement: 375_309,
      society: 38_844,
      development: 120,
      civilizations: 778,
      total: 415_051,
    }),
  }),
]);
