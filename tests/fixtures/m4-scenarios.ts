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
    expectedHash: '86af5e5c',
    expectedOperations: 436_530,
  }),
  Object.freeze({
    name: 'stone-weavers',
    purpose: 'viable-generations',
    seed: Object.freeze([101, 202, 303, 404] as const),
    yearTicks: 5_000,
    horizonTicks: 600_000,
    expectedHash: 'd71be8fc',
    expectedOperations: 433_105,
  }),
  Object.freeze({
    name: 'ember-council',
    purpose: 'viable-generations',
    seed: Object.freeze([0xffff_ffff, 0, 0x8000_0000, 17] as const),
    yearTicks: 5_000,
    horizonTicks: 600_000,
    expectedHash: 'f61d4ca4',
    expectedOperations: 451_502,
  }),
  Object.freeze({
    name: 'lean-market',
    purpose: 'scarcity-control',
    seed: Object.freeze([77, 88, 99, 111] as const),
    yearTicks: 5_000,
    horizonTicks: 240_000,
    expectedHash: '78a68790',
    expectedOperations: 109_522,
    shock: Object.freeze({ tick: 5_000, severity: 65 }),
  }),
  Object.freeze({
    name: 'renewed-hearth',
    purpose: 'collapse-recovery',
    seed: Object.freeze([31_337, 4_242, 9_001, 17] as const),
    yearTicks: 5_000,
    horizonTicks: 600_000,
    expectedHash: 'ebbc5fa1',
    expectedOperations: 339_060,
    shock: Object.freeze({ tick: 240_000, severity: 100 }),
  }),
]);

export function scenariosFor(purpose: M4Scenario['purpose']): readonly M4Scenario[] {
  return M4_SCENARIOS.filter((scenario) => scenario.purpose === purpose);
}
