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
      hash: '5133fdbc',
      operations: Object.freeze({
        settlement: 16_149,
        society: 2_584,
        development: 30,
        civilizations: 461,
        scale: 49_231,
        space: 0,
      }),
      metrics: Object.freeze({
        population: 16,
        shelterIntegrity: 2_734,
        production: 715,
        stability: 100,
      }),
    }),
    lowPoint: Object.freeze({
      tick: 151_000,
      hash: 'd6b415c4',
      operations: Object.freeze({
        settlement: 16_310,
        society: 2_624,
        development: 30,
        civilizations: 477,
        scale: 49_690,
        space: 0,
      }),
      metrics: Object.freeze({
        population: 0,
        shelterIntegrity: 2_131,
        production: 0,
        stability: 6,
      }),
    }),
    recovery: Object.freeze({
      tick: 160_000,
      hash: 'ac2b61ac',
      operations: Object.freeze({
        settlement: 17_802,
        society: 2_835,
        development: 32,
        civilizations: 515,
        scale: 52_199,
        space: 0,
      }),
      metrics: Object.freeze({
        population: 2,
        shelterIntegrity: 2_104,
        production: 32,
        stability: 60,
      }),
    }),
    final: Object.freeze({
      tick: 600_000,
      hash: 'b9cb5c9a',
      operations: Object.freeze({
        settlement: 220_479,
        society: 34_627,
        development: 120,
        civilizations: 1_749,
        scale: 363_833,
        space: 0,
      }),
      metrics: Object.freeze({
        population: 38,
        shelterIntegrity: 5_211,
        production: 2_467,
        stability: 100,
      }),
    }),
    troughs: Object.freeze({
      population: 0,
      shelterIntegrity: 2_107,
      production: 0,
      stability: 0,
    }),
  }),
});
