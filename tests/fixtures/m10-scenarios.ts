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
    hash: 'd2b2dad1',
    operations: {
      settlement: 47561,
      society: 7888,
      development: 60,
      civilizations: 905,
      scale: 126378,
      space: 0,
    },
  },
  {
    name: 'stone-weavers',
    hash: 'e974c754',
    operations: {
      settlement: 44879,
      society: 7815,
      development: 60,
      civilizations: 921,
      scale: 131384,
      space: 0,
    },
  },
  {
    name: 'edge-of-seed',
    hash: 'c1eef0a3',
    operations: {
      settlement: 49881,
      society: 8293,
      development: 60,
      civilizations: 969,
      scale: 130524,
      space: 0,
    },
  },
  {
    name: 'lean-market',
    hash: '15757d19',
    operations: {
      settlement: 49026,
      society: 8374,
      development: 60,
      civilizations: 925,
      scale: 128643,
      space: 0,
    },
  },
  {
    name: 'renewed-hearth',
    hash: 'f4135bbe',
    operations: {
      settlement: 52056,
      society: 8758,
      development: 60,
      civilizations: 1012,
      scale: 168936,
      space: 0,
    },
  },
  {
    name: 'concord-orbit',
    hash: '6cb52cfb',
    operations: {
      settlement: 47991,
      society: 8648,
      development: 60,
      civilizations: 1035,
      scale: 125285,
      space: 4,
    },
  },
  {
    name: 'ore-coexistence',
    hash: 'eb2b8873',
    operations: {
      settlement: 40372,
      society: 7213,
      development: 60,
      civilizations: 792,
      scale: 105282,
      space: 0,
    },
  },
  {
    name: 'contested-frontier',
    hash: 'ec2ee45c',
    operations: {
      settlement: 43442,
      society: 7258,
      development: 60,
      civilizations: 893,
      scale: 145883,
      space: 0,
    },
  },
  {
    name: 'renewed-fracture',
    hash: '4151b92a',
    operations: {
      settlement: 46333,
      society: 8111,
      development: 60,
      civilizations: 1115,
      scale: 128587,
      space: 0,
    },
  },
  {
    name: 'willow-crossing',
    hash: '2c19ed1f',
    operations: {
      settlement: 39891,
      society: 7083,
      development: 60,
      civilizations: 1009,
      scale: 110047,
      space: 0,
    },
  },
  {
    name: 'copper-rain',
    hash: '2c858ba1',
    operations: {
      settlement: 46773,
      society: 7957,
      development: 60,
      civilizations: 962,
      scale: 125128,
      space: 0,
    },
  },
  {
    name: 'quiet-estuary',
    hash: '107dd6a4',
    operations: {
      settlement: 51915,
      society: 8732,
      development: 60,
      civilizations: 1177,
      scale: 165005,
      space: 0,
    },
  },
  {
    name: 'granite-choir',
    hash: '96ea6a79',
    operations: {
      settlement: 49389,
      society: 8938,
      development: 60,
      civilizations: 1022,
      scale: 127161,
      space: 0,
    },
  },
  {
    name: 'reed-observatory',
    hash: 'c66d16c7',
    operations: {
      settlement: 52103,
      society: 8455,
      development: 60,
      civilizations: 1028,
      scale: 133175,
      space: 0,
    },
  },
  {
    name: 'amber-current',
    hash: '4e8c6496',
    operations: {
      settlement: 53017,
      society: 8926,
      development: 60,
      civilizations: 955,
      scale: 164166,
      space: 0,
    },
  },
  {
    name: 'winter-orchard',
    hash: 'f4be5e84',
    operations: {
      settlement: 50716,
      society: 8471,
      development: 60,
      civilizations: 973,
      scale: 130753,
      space: 0,
    },
  },
  {
    name: 'basalt-covenant',
    hash: '2668fc7b',
    operations: {
      settlement: 46762,
      society: 8021,
      development: 60,
      civilizations: 1004,
      scale: 124892,
      space: 0,
    },
  },
  {
    name: 'moss-archive',
    hash: 'aa5167aa',
    operations: {
      settlement: 50366,
      society: 8505,
      development: 60,
      civilizations: 1112,
      scale: 157264,
      space: 0,
    },
  },
  {
    name: 'sunward-harbor',
    hash: 'a012c634',
    operations: {
      settlement: 52207,
      society: 8797,
      development: 60,
      civilizations: 942,
      scale: 133254,
      space: 0,
    },
  },
  {
    name: 'thunder-library',
    hash: '0a2e2a5d',
    operations: {
      settlement: 45846,
      society: 7951,
      development: 60,
      civilizations: 929,
      scale: 122550,
      space: 0,
    },
  },
  {
    name: 'salt-lanterns',
    hash: '625fba87',
    operations: {
      settlement: 51115,
      society: 8426,
      development: 60,
      civilizations: 1090,
      scale: 137391,
      space: 0,
    },
  },
  {
    name: 'iron-pollinators',
    hash: '8dddaa19',
    operations: {
      settlement: 38856,
      society: 6424,
      development: 60,
      civilizations: 871,
      scale: 109498,
      space: 0,
    },
  },
  {
    name: 'cloud-foundry',
    hash: '0c68239e',
    operations: {
      settlement: 37686,
      society: 6154,
      development: 60,
      civilizations: 916,
      scale: 119901,
      space: 0,
    },
  },
  {
    name: 'night-canals',
    hash: '07154bf8',
    operations: {
      settlement: 38978,
      society: 6459,
      development: 60,
      civilizations: 820,
      scale: 106765,
      space: 0,
    },
  },
  {
    name: 'far-horizon',
    hash: '62302f3f',
    operations: {
      settlement: 55016,
      society: 9272,
      development: 60,
      civilizations: 1036,
      scale: 137628,
      space: 0,
    },
  },
]);
