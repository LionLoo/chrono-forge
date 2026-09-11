import type { WorldSeed } from '../../src/simulation/world';

export interface M10CollapseMetrics {
  readonly population: number;
  readonly shelterIntegrity: number;
  readonly production: number;
  readonly stability: number;
}

export interface M10CollapseCheckpoint {
  readonly tick: number;
  readonly hash: string;
  readonly operations: Readonly<{
    readonly settlement: number;
    readonly society: number;
    readonly development: number;
    readonly civilizations: number;
    readonly scale: number;
    readonly space: number;
  }>;
  readonly metrics: M10CollapseMetrics;
}

export interface M10CollapseBaseline {
  readonly preShock: M10CollapseCheckpoint;
  readonly lowPoint: M10CollapseCheckpoint;
  readonly recovery: M10CollapseCheckpoint;
  readonly final: M10CollapseCheckpoint;
  readonly troughs: M10CollapseMetrics;
}

export interface M10CollapseRecoveryScenario {
  readonly name: string;
  readonly seed: WorldSeed;
  readonly yearTicks: 5_000;
  readonly productionWindowTicks: 1_000;
  readonly preShockObservationWindows: 10;
  readonly shockTick: 150_000;
  readonly shockSeverity: 100;
  readonly horizonTick: 600_000;
  readonly expected: M10CollapseBaseline;
}

/**
 * A cooperative-profile seed prevents M6 conflict candidates. The controlled
 * checkpoint is chosen before the seed's later independent development crisis.
 * These values were locked only after every semantic assertion passed.
 */
export const M10_COLLAPSE_RECOVERY_SCENARIO: M10CollapseRecoveryScenario = Object.freeze({
  name: 'river-revival',
  seed: Object.freeze([1, 2, 3, 4] as const),
  yearTicks: 5_000,
  productionWindowTicks: 1_000,
  preShockObservationWindows: 10,
  shockTick: 150_000,
  shockSeverity: 100,
  horizonTick: 600_000,
  expected: Object.freeze({
    preShock: Object.freeze({
      tick: 150_000,
      hash: '374eda05',
      operations: Object.freeze({
        settlement: 16_080,
        society: 2_876,
        development: 30,
        civilizations: 461,
        scale: 48_294,
        space: 0,
      }),
      metrics: Object.freeze({
        population: 17,
        shelterIntegrity: 2_732,
        production: 923,
        stability: 100,
      }),
    }),
    lowPoint: Object.freeze({
      tick: 151_000,
      hash: '61afa044',
      operations: Object.freeze({
        settlement: 16_251,
        society: 2_919,
        development: 30,
        civilizations: 478,
        scale: 48_769,
        space: 0,
      }),
      metrics: Object.freeze({
        population: 0,
        shelterIntegrity: 2_129,
        production: 0,
        stability: 6,
      }),
    }),
    recovery: Object.freeze({
      tick: 160_000,
      hash: 'de15a579',
      operations: Object.freeze({
        settlement: 17_833,
        society: 3_147,
        development: 32,
        civilizations: 517,
        scale: 51_278,
        space: 0,
      }),
      metrics: Object.freeze({
        population: 2,
        shelterIntegrity: 2_102,
        production: 32,
        stability: 60,
      }),
    }),
    final: Object.freeze({
      tick: 600_000,
      hash: '71e06ffd',
      operations: Object.freeze({
        settlement: 229_803,
        society: 37_292,
        development: 120,
        civilizations: 1_730,
        scale: 373_848,
        space: 0,
      }),
      metrics: Object.freeze({
        population: 35,
        shelterIntegrity: 5_428,
        production: 2_257,
        stability: 90,
      }),
    }),
    troughs: Object.freeze({
      population: 0,
      shelterIntegrity: 2_105,
      production: 0,
      stability: 0,
    }),
  }),
});
