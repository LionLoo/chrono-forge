import type { WorldSeed } from '../../src/simulation/world';

export interface M4Scenario {
  readonly name: string;
  readonly purpose: 'viable-generations' | 'scarcity-control' | 'collapse-recovery';
  readonly seed: WorldSeed;
  readonly yearTicks: number;
  readonly horizonTicks: number;
  readonly expectedHash: string;
  readonly expectedOperations: number;
  readonly shock?: Readonly<{ tick: number; severity: number }>;
}

export const M4_SCENARIOS: readonly M4Scenario[] = Object.freeze([
  Object.freeze({
    name: 'river-kin',
    purpose: 'viable-generations',
    seed: Object.freeze([1, 2, 3, 4] as const),
    yearTicks: 5_000,
    horizonTicks: 600_000,
    expectedHash: '62af0ae6',
    expectedOperations: 245_962,
  }),
  Object.freeze({
    name: 'stone-weavers',
    purpose: 'viable-generations',
    seed: Object.freeze([101, 202, 303, 404] as const),
    yearTicks: 5_000,
    horizonTicks: 600_000,
    expectedHash: 'aeff8ea8',
    expectedOperations: 173_011,
  }),
  Object.freeze({
    name: 'ember-council',
    purpose: 'viable-generations',
    seed: Object.freeze([0xffff_ffff, 0, 0x8000_0000, 17] as const),
    yearTicks: 5_000,
    horizonTicks: 600_000,
    expectedHash: '99f86366',
    expectedOperations: 168_866,
  }),
  Object.freeze({
    name: 'lean-market',
    purpose: 'scarcity-control',
    seed: Object.freeze([77, 88, 99, 111] as const),
    yearTicks: 5_000,
    horizonTicks: 240_000,
    expectedHash: 'a7a1a351',
    expectedOperations: 36_392,
    shock: Object.freeze({ tick: 5_000, severity: 65 }),
  }),
  Object.freeze({
    name: 'renewed-hearth',
    purpose: 'collapse-recovery',
    seed: Object.freeze([31_337, 4_242, 9_001, 17] as const),
    yearTicks: 5_000,
    horizonTicks: 600_000,
    expectedHash: 'db90fc78',
    expectedOperations: 187_030,
    shock: Object.freeze({ tick: 240_000, severity: 100 }),
  }),
]);

export function scenariosFor(purpose: M4Scenario['purpose']): readonly M4Scenario[] {
  return M4_SCENARIOS.filter((scenario) => scenario.purpose === purpose);
}
