import { settlementSummary } from '../../src/simulation/settlement';
import { createInitialWorld, hashWorldState, stepWorld } from '../../src/simulation/world';

describe('settlement determinism', () => {
  it.each([
    [1, 2, 3, 4],
    [101, 202, 303, 404],
    [9, 8, 7, 6],
  ] as const)('repeats autonomous state for seed %j', (...seed) => {
    const first = stepWorld(createInitialWorld(seed), 60_000);
    const second = stepWorld(createInitialWorld(seed), 60_000);
    expect(hashWorldState(first)).toBe(hashWorldState(second));
    expect(settlementSummary(first.civilization)).toStrictEqual(
      settlementSummary(second.civilization),
    );
  });
});
