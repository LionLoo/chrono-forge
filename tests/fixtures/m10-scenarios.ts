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
    hash: '98d53c26',
    operations: {
      settlement: 53_791,
      society: 9_305,
      development: 60,
      civilizations: 683,
      scale: 135_443,
      space: 0,
    },
  },
  {
    name: 'stone-weavers',
    hash: '4d37ac4f',
    operations: {
      settlement: 47_265,
      society: 8_227,
      development: 60,
      civilizations: 835,
      scale: 148_592,
      space: 0,
    },
  },
  {
    name: 'edge-of-seed',
    hash: '5ba0a11b',
    operations: {
      settlement: 48_065,
      society: 8_171,
      development: 60,
      civilizations: 776,
      scale: 129_735,
      space: 0,
    },
  },
  {
    name: 'lean-market',
    hash: '51a70e8a',
    operations: {
      settlement: 54_994,
      society: 9_788,
      development: 60,
      civilizations: 779,
      scale: 138_490,
      space: 0,
    },
  },
  {
    name: 'renewed-hearth',
    hash: 'fdfdfca0',
    operations: {
      settlement: 47_149,
      society: 7_997,
      development: 60,
      civilizations: 990,
      scale: 156_358,
      space: 0,
    },
  },
  {
    name: 'concord-orbit',
    hash: '4f10ec0a',
    operations: {
      settlement: 43_774,
      society: 7_787,
      development: 60,
      civilizations: 842,
      scale: 118_019,
      space: 4,
    },
  },
  {
    name: 'ore-coexistence',
    hash: '9179d5ef',
    operations: {
      settlement: 30_889,
      society: 5_666,
      development: 60,
      civilizations: 614,
      scale: 89_459,
      space: 0,
    },
  },
  {
    name: 'contested-frontier',
    hash: 'daef099c',
    operations: {
      settlement: 46_782,
      society: 8_485,
      development: 60,
      civilizations: 827,
      scale: 161_166,
      space: 0,
    },
  },
  {
    name: 'renewed-fracture',
    hash: '7f58d871',
    operations: {
      settlement: 50_070,
      society: 8_390,
      development: 60,
      civilizations: 857,
      scale: 136_454,
      space: 0,
    },
  },
  {
    name: 'willow-crossing',
    hash: 'b1a144a4',
    operations: {
      settlement: 36_575,
      society: 6_792,
      development: 60,
      civilizations: 764,
      scale: 104_812,
      space: 0,
    },
  },
  {
    name: 'copper-rain',
    hash: '3f042aad',
    operations: {
      settlement: 58_096,
      society: 10_327,
      development: 60,
      civilizations: 781,
      scale: 143_335,
      space: 0,
    },
  },
  {
    name: 'quiet-estuary',
    hash: '14808725',
    operations: {
      settlement: 50_602,
      society: 8_491,
      development: 60,
      civilizations: 1_037,
      scale: 166_787,
      space: 0,
    },
  },
  {
    name: 'granite-choir',
    hash: '56177ccf',
    operations: {
      settlement: 50_744,
      society: 8_605,
      development: 60,
      civilizations: 772,
      scale: 128_098,
      space: 0,
    },
  },
  {
    name: 'reed-observatory',
    hash: '456fe1db',
    operations: {
      settlement: 44_442,
      society: 7_566,
      development: 60,
      civilizations: 781,
      scale: 120_753,
      space: 0,
    },
  },
  {
    name: 'amber-current',
    hash: '91ba1fe5',
    operations: {
      settlement: 49_086,
      society: 8_386,
      development: 60,
      civilizations: 657,
      scale: 153_982,
      space: 0,
    },
  },
  {
    name: 'winter-orchard',
    hash: '23e55375',
    operations: {
      settlement: 55_532,
      society: 9_398,
      development: 60,
      civilizations: 683,
      scale: 139_349,
      space: 0,
    },
  },
  {
    name: 'basalt-covenant',
    hash: 'efc25ea9',
    operations: {
      settlement: 52_515,
      society: 9_102,
      development: 60,
      civilizations: 781,
      scale: 133_331,
      space: 0,
    },
  },
  {
    name: 'moss-archive',
    hash: 'ee28e084',
    operations: {
      settlement: 51_276,
      society: 8_631,
      development: 60,
      civilizations: 796,
      scale: 170_309,
      space: 0,
    },
  },
  {
    name: 'sunward-harbor',
    hash: '89d32635',
    operations: {
      settlement: 51_172,
      society: 8_877,
      development: 60,
      civilizations: 888,
      scale: 132_705,
      space: 0,
    },
  },
  {
    name: 'thunder-library',
    hash: '174a5b77',
    operations: {
      settlement: 53_844,
      society: 9_716,
      development: 60,
      civilizations: 788,
      scale: 136_850,
      space: 0,
    },
  },
  {
    name: 'salt-lanterns',
    hash: 'e436b380',
    operations: {
      settlement: 52_998,
      society: 8_935,
      development: 60,
      civilizations: 818,
      scale: 141_064,
      space: 0,
    },
  },
  {
    name: 'iron-pollinators',
    hash: '8009f528',
    operations: {
      settlement: 35_552,
      society: 5_825,
      development: 60,
      civilizations: 674,
      scale: 102_704,
      space: 0,
    },
  },
  {
    name: 'cloud-foundry',
    hash: '474ebe94',
    operations: {
      settlement: 35_662,
      society: 6_107,
      development: 60,
      civilizations: 889,
      scale: 126_022,
      space: 0,
    },
  },
  {
    name: 'night-canals',
    hash: '08c41341',
    operations: {
      settlement: 37_379,
      society: 6_151,
      development: 60,
      civilizations: 701,
      scale: 102_154,
      space: 0,
    },
  },
  {
    name: 'far-horizon',
    hash: 'a09b2b61',
    operations: {
      settlement: 54_395,
      society: 9_563,
      development: 60,
      civilizations: 758,
      scale: 137_553,
      space: 0,
    },
  },
]);
