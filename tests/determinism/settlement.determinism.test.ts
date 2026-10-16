import { SETTLEMENT_ACTION_PULSE_TICKS, settlementSummary } from '../../src/simulation/settlement';
import { createInitialWorld, hashWorldState, stepWorld } from '../../src/simulation/world';

const DEMO_SEED = [0x1234_5678, 0x9abc_def0, 0x0fed_cba9, 0x8765_4321] as const;

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

  it('gives co-located demo founders distinct viable routes instead of moving as one clump', () => {
    let world = createInitialWorld(DEMO_SEED);
    world = stepWorld(world, SETTLEMENT_ACTION_PULSE_TICKS);
    const firstTargets = new Set(world.civilization.agents.map((agent) => agent.targetTileIndex));
    const firstAssignments = new Map<string, number>();
    for (const agent of world.civilization.agents) {
      const key = `${agent.action}:${agent.targetTileIndex}`;
      firstAssignments.set(key, (firstAssignments.get(key) ?? 0) + 1);
    }
    expect(firstTargets.size).toBeGreaterThanOrEqual(4);
    expect(Math.max(...firstAssignments.values())).toBeLessThanOrEqual(2);

    let fullyClumpedSamples = 0;
    let synchronizedActionSamples = 0;
    let wellSpreadSamples = 0;
    for (let sample = 0; sample < 150; sample += 1) {
      world = stepWorld(world, SETTLEMENT_ACTION_PULSE_TICKS);
      const living = world.civilization.agents.filter((agent) => agent.alive);
      const occupiedTiles = new Set(living.map((agent) => agent.tileIndex)).size;
      if (occupiedTiles === 1) fullyClumpedSamples += 1;
      if (occupiedTiles >= 4) wellSpreadSamples += 1;
      if (new Set(living.map((agent) => agent.action)).size === 1) synchronizedActionSamples += 1;
    }
    expect(fullyClumpedSamples).toBeLessThanOrEqual(5);
    expect(synchronizedActionSamples).toBeLessThanOrEqual(30);
    expect(wellSpreadSamples).toBeGreaterThanOrEqual(120);
  });
});
