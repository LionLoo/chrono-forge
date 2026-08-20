import { deriveXoshiro128State, Xoshiro128StarStar } from '../../src/simulation/random';

describe('xoshiro128** 1.1', () => {
  it('matches the public-domain reference golden vector from state [1, 2, 3, 4]', () => {
    const random = new Xoshiro128StarStar([1, 2, 3, 4]);

    expect(Array.from({ length: 10 }, () => random.nextUint32())).toStrictEqual([
      0x00002d00, 0x00000000, 0x005a7080, 0x04389d80, 0x79199d9b, 0x61963b24, 0x4cb9b57a,
      0xde9d7431, 0xde458f35, 0xfdce1a54,
    ]);
  });

  it('rejects the forbidden all-zero state', () => {
    expect(() => new Xoshiro128StarStar([0, 0, 0, 0])).toThrow(RangeError);
    expect(() => new Xoshiro128StarStar([1, Number.NaN, 0, 0])).toThrow(RangeError);
  });

  it('restores an exact sequence checkpoint', () => {
    const random = new Xoshiro128StarStar([101, 202, 303, 404]);
    random.nextUint32();
    const checkpoint = random.save();
    const expected = Array.from({ length: 20 }, () => random.nextUint32());

    random.restore(checkpoint);

    expect(Array.from({ length: 20 }, () => random.nextUint32())).toStrictEqual(expected);
  });

  it('derives independent stable named streams', () => {
    const root = [5, 6, 7, 8] as const;

    expect(deriveXoshiro128State(root, 'terrain')).toStrictEqual(
      deriveXoshiro128State(root, 'terrain'),
    );
    expect(deriveXoshiro128State(root, 'terrain')).not.toStrictEqual(
      deriveXoshiro128State(root, 'disasters'),
    );
    expect(deriveXoshiro128State([0, 0, 0, 0], 'terrain')).not.toStrictEqual([0, 0, 0, 0]);
  });

  it('returns bounded integers including non-power-of-two maxima', () => {
    const random = new Xoshiro128StarStar([3, 1, 4, 1]);
    const values = Array.from({ length: 10_000 }, () => random.nextInt(37));

    expect(values.every((value) => value >= 0 && value < 37)).toBe(true);
  });
});
