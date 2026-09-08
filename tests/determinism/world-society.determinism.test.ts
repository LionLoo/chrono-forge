import { ACCELERATED_YEAR_TICKS } from '../../src/simulation/society';
import {
  canonicalWorldJson,
  createInitialWorld,
  hashWorldState,
  stepWorld,
} from '../../src/simulation/world';
import { deserializeWorldSnapshot, serializeWorldSnapshot } from '../../src/simulation/persistence';

const seed = [0xfeed_beef, 0x1020_3040, 0x5566_7788, 0x99aa_bbcc] as const;
const TOTAL_TICKS = 120_000;

function acceleratedWorld() {
  return createInitialWorld(seed, { societyYearTicks: ACCELERATED_YEAR_TICKS });
}

function advanceInPartitions(partitions: readonly number[]) {
  let world = acceleratedWorld();
  for (const ticks of partitions) world = stepWorld(world, ticks);
  return world;
}

describe('M4 society world determinism', () => {
  it('matches one-shot and irregular fixed tick partitions after relationship-grounded births', () => {
    const oneShot = stepWorld(acceleratedWorld(), TOTAL_TICKS);
    const partitioned = advanceInPartitions([
      1, 999, 17, 4_983, 1_001, 7_777, 23, 31_199, 10_000, 42_000, 22_000,
    ]);

    expect(partitioned.tick).toBe(TOTAL_TICKS);
    expect(partitioned.civilization.society.people.some((person) => person.generation >= 1)).toBe(
      true,
    );
    expect(hashWorldState(partitioned)).toBe(hashWorldState(oneShot));
    expect(canonicalWorldJson(partitioned)).toBe(canonicalWorldJson(oneShot));
  }, 60_000);

  it('matches a save-like canonical continuation through the same accelerated horizon', () => {
    const oneShot = stepWorld(acceleratedWorld(), TOTAL_TICKS);
    const firstHalf = stepWorld(acceleratedWorld(), 60_000);
    const restored = deserializeWorldSnapshot(serializeWorldSnapshot(firstHalf));
    const resumed = stepWorld(restored, 60_000);

    expect(resumed.civilization.society.people.some((person) => person.generation >= 1)).toBe(true);
    expect(hashWorldState(resumed)).toBe(hashWorldState(oneShot));
    expect(canonicalWorldJson(resumed)).toBe(canonicalWorldJson(oneShot));
  }, 60_000);
});
