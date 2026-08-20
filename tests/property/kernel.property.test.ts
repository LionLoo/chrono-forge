import fc from 'fast-check';
import { simulationTick } from '../../src/simulation/kernel';

describe('simulation tick properties', () => {
  it('round-trips every generated non-negative safe integer', () => {
    fc.assert(
      fc.property(fc.maxSafeNat(), (value) => {
        expect(simulationTick(value)).toBe(value);
      }),
      { numRuns: 1_000 },
    );
  });
});
