import { createRandomWorldSeed, formatWorldSeed, parseWorldSeed } from '../../src/ui/world-seed';

describe('world seed policy', () => {
  it('round-trips the exact visible 128-bit seed format', () => {
    const seed = [0, 0x89ab_cdef, 0x0123_4567, 0xffff_ffff] as const;
    const label = formatWorldSeed(seed);

    expect(label).toBe('00000000-89abcdef-01234567-ffffffff');
    expect(parseWorldSeed(label)).toStrictEqual(seed);
    expect(parseWorldSeed(label.toUpperCase())).toStrictEqual(seed);
  });

  it('rejects ambiguous or out-of-policy seed text', () => {
    for (const value of [
      '',
      '1-2-3-4',
      '00000000-00000000-00000000',
      '00000000_00000000_00000000_00000001',
      '00000000-00000000-00000000-0000000g',
      ' 00000000-00000000-00000000-00000001 ',
    ]) {
      expect(parseWorldSeed(value)).toBeNull();
    }
  });

  it('uses four generated uint32 words and avoids the all-zero sentinel', () => {
    const generated = createRandomWorldSeed((values) => {
      values.fill(0);
      return values;
    });

    expect(generated).toStrictEqual([0, 0, 0, 1]);
  });
});
