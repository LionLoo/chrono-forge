import {
  canonicalWorldJson,
  createInitialWorld,
  hashWorldState,
  stepWorld,
} from '../../src/simulation/world';

describe('world determinism', () => {
  it('repeats matching initial and checkpoint hashes for identical input', () => {
    const seed = [7, 11, 13, 17] as const;
    const left = createInitialWorld(seed);
    const right = createInitialWorld(seed);

    expect(hashWorldState(left)).toBe(hashWorldState(right));
    expect(left.eventLog).toStrictEqual([{ id: 1, tick: 0, kind: 'world-generated' }]);
    expect(left.eventLog).toStrictEqual(right.eventLog);
    expect(left.nextEventId).toBe(2);
    expect(canonicalWorldJson(stepWorld(left, 10_000))).toBe(
      canonicalWorldJson(stepWorld(right, 10_000)),
    );
  });

  it('diverges world generation for different seeds', () => {
    expect(hashWorldState(createInitialWorld([1, 2, 3, 4]))).not.toBe(
      hashWorldState(createInitialWorld([4, 3, 2, 1])),
    );
  });
});
