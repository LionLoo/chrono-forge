import type { WorldSeed } from '../../src/simulation/world';

export interface M10Scenario {
  readonly name: string;
  readonly seed: WorldSeed;
  readonly yearTicks: 5_000;
  readonly checkpointYears: readonly [5, 25, 60];
}

export interface M10Baseline {
  readonly name: string;
  readonly hash: string;
  readonly operations: Readonly<{
    readonly settlement: number;
    readonly society: number;
    readonly development: number;
    readonly civilizations: number;
    readonly scale: number;
    readonly space: number;
  }>;
}

/**
 * M10's integrated catalogue deliberately includes the established acceptance
 * seeds plus sixteen new worlds. Golden hashes and operation totals are added
 * only after every semantic assertion passes on the expanded content.
 */
export const M10_SCENARIOS: readonly M10Scenario[] = Object.freeze(
  [
    ['river-kin', [1, 2, 3, 4]],
    ['stone-weavers', [101, 202, 303, 404]],
    ['edge-of-seed', [0xffff_ffff, 0, 0x8000_0000, 17]],
    ['lean-market', [77, 88, 99, 111]],
    ['renewed-hearth', [31_337, 4_242, 9_001, 17]],
    ['concord-orbit', [7, 11, 13, 17]],
    ['ore-coexistence', [19, 23, 29, 31]],
    ['contested-frontier', [37, 41, 43, 47]],
    ['renewed-fracture', [53, 59, 61, 67]],
    ['willow-crossing', [71, 73, 79, 83]],
    ['copper-rain', [89, 97, 101, 103]],
    ['quiet-estuary', [107, 109, 113, 127]],
    ['granite-choir', [131, 137, 139, 149]],
    ['reed-observatory', [151, 157, 163, 167]],
    ['amber-current', [173, 179, 181, 191]],
    ['winter-orchard', [193, 197, 199, 211]],
    ['basalt-covenant', [223, 227, 229, 233]],
    ['moss-archive', [239, 241, 251, 257]],
    ['sunward-harbor', [263, 269, 271, 277]],
    ['thunder-library', [281, 283, 293, 307]],
    ['salt-lanterns', [311, 313, 317, 331]],
    ['iron-pollinators', [337, 347, 349, 353]],
    ['cloud-foundry', [359, 367, 373, 379]],
    ['night-canals', [383, 389, 397, 401]],
    ['far-horizon', [409, 419, 421, 431]],
  ].map(([name, seed]) =>
    Object.freeze({
      name: name as string,
      seed: Object.freeze(seed as unknown as WorldSeed),
      yearTicks: 5_000 as const,
      checkpointYears: Object.freeze([5, 25, 60] as const),
    }),
  ),
);

/** Locked only after the complete semantic catalogue passed. */
export const M10_EXPECTED_BASELINES: readonly M10Baseline[] = Object.freeze([
  {
    name: 'river-kin',
    hash: 'b69398d7',
    operations: {
      settlement: 53791,
      society: 9305,
      development: 60,
      civilizations: 908,
      scale: 135443,
      space: 0,
    },
  },
  {
    name: 'stone-weavers',
    hash: 'ea3de57a',
    operations: {
      settlement: 47265,
      society: 8227,
      development: 60,
      civilizations: 1033,
      scale: 148592,
      space: 0,
    },
  },
  {
    name: 'edge-of-seed',
    hash: 'd9d2b03e',
    operations: {
      settlement: 48065,
      society: 8171,
      development: 60,
      civilizations: 962,
      scale: 129735,
      space: 0,
    },
  },
  {
    name: 'lean-market',
    hash: 'df44e590',
    operations: {
      settlement: 54994,
      society: 9788,
      development: 60,
      civilizations: 1007,
      scale: 138490,
      space: 0,
    },
  },
  {
    name: 'renewed-hearth',
    hash: 'aed2eb65',
    operations: {
      settlement: 47149,
      society: 7997,
      development: 60,
      civilizations: 1201,
      scale: 156358,
      space: 0,
    },
  },
  {
    name: 'concord-orbit',
    hash: '2182b552',
    operations: {
      settlement: 43774,
      society: 7787,
      development: 60,
      civilizations: 1061,
      scale: 118019,
      space: 4,
    },
  },
  {
    name: 'ore-coexistence',
    hash: '1c5d4e12',
    operations: {
      settlement: 30889,
      society: 5666,
      development: 60,
      civilizations: 806,
      scale: 89459,
      space: 0,
    },
  },
  {
    name: 'contested-frontier',
    hash: 'afcfa13d',
    operations: {
      settlement: 46782,
      society: 8485,
      development: 60,
      civilizations: 1016,
      scale: 161166,
      space: 0,
    },
  },
  {
    name: 'renewed-fracture',
    hash: '31fdc103',
    operations: {
      settlement: 50070,
      society: 8390,
      development: 60,
      civilizations: 1055,
      scale: 136454,
      space: 0,
    },
  },
  {
    name: 'willow-crossing',
    hash: '7b9df7cc',
    operations: {
      settlement: 36575,
      society: 6792,
      development: 60,
      civilizations: 977,
      scale: 104812,
      space: 0,
    },
  },
  {
    name: 'copper-rain',
    hash: 'ed67999e',
    operations: {
      settlement: 58096,
      society: 10327,
      development: 60,
      civilizations: 1009,
      scale: 143335,
      space: 0,
    },
  },
  {
    name: 'quiet-estuary',
    hash: 'e9e82500',
    operations: {
      settlement: 50602,
      society: 8491,
      development: 60,
      civilizations: 1253,
      scale: 166787,
      space: 0,
    },
  },
  {
    name: 'granite-choir',
    hash: 'a24de268',
    operations: {
      settlement: 50744,
      society: 8605,
      development: 60,
      civilizations: 988,
      scale: 128098,
      space: 0,
    },
  },
  {
    name: 'reed-observatory',
    hash: '8b7d7d20',
    operations: {
      settlement: 44442,
      society: 7566,
      development: 60,
      civilizations: 1006,
      scale: 120753,
      space: 0,
    },
  },
  {
    name: 'amber-current',
    hash: '369e9499',
    operations: {
      settlement: 49086,
      society: 8386,
      development: 60,
      civilizations: 820,
      scale: 153982,
      space: 0,
    },
  },
  {
    name: 'winter-orchard',
    hash: '3971e0aa',
    operations: {
      settlement: 55532,
      society: 9398,
      development: 60,
      civilizations: 911,
      scale: 139349,
      space: 0,
    },
  },
  {
    name: 'basalt-covenant',
    hash: '7fdac669',
    operations: {
      settlement: 52515,
      society: 9102,
      development: 60,
      civilizations: 1006,
      scale: 133331,
      space: 0,
    },
  },
  {
    name: 'moss-archive',
    hash: '332532ff',
    operations: {
      settlement: 51276,
      society: 8631,
      development: 60,
      civilizations: 991,
      scale: 170309,
      space: 0,
    },
  },
  {
    name: 'sunward-harbor',
    hash: '707ce4d7',
    operations: {
      settlement: 51172,
      society: 8877,
      development: 60,
      civilizations: 1116,
      scale: 132705,
      space: 0,
    },
  },
  {
    name: 'thunder-library',
    hash: '79e1ca72',
    operations: {
      settlement: 53844,
      society: 9716,
      development: 60,
      civilizations: 1016,
      scale: 136850,
      space: 0,
    },
  },
  {
    name: 'salt-lanterns',
    hash: 'a1e3796c',
    operations: {
      settlement: 52998,
      society: 8935,
      development: 60,
      civilizations: 1016,
      scale: 141064,
      space: 0,
    },
  },
  {
    name: 'iron-pollinators',
    hash: 'cbab7e59',
    operations: {
      settlement: 35552,
      society: 5825,
      development: 60,
      civilizations: 884,
      scale: 102704,
      space: 0,
    },
  },
  {
    name: 'cloud-foundry',
    hash: '8a5a4fa6',
    operations: {
      settlement: 35662,
      society: 6107,
      development: 60,
      civilizations: 1092,
      scale: 126022,
      space: 0,
    },
  },
  {
    name: 'night-canals',
    hash: '99cb1aa6',
    operations: {
      settlement: 37379,
      society: 6151,
      development: 60,
      civilizations: 868,
      scale: 102154,
      space: 0,
    },
  },
  {
    name: 'far-horizon',
    hash: '637d3704',
    operations: {
      settlement: 54395,
      society: 9563,
      development: 60,
      civilizations: 986,
      scale: 137553,
      space: 0,
    },
  },
]);
