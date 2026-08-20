import { DEFAULT_TICKS_PER_SECOND, simulationTick } from '../../src/simulation/kernel';

describe('simulation kernel foundation', () => {
  it('uses the documented normal fixed-tick rate', () => {
    expect(DEFAULT_TICKS_PER_SECOND).toBe(10);
  });

  it.each([0, 1, Number.MAX_SAFE_INTEGER])('accepts safe non-negative tick %s', (value) => {
    expect(simulationTick(value)).toBe(value);
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid authoritative tick %s',
    (value) => {
      expect(() => simulationTick(value)).toThrow(RangeError);
    },
  );
});
