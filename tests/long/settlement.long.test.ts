import { isViableSettlement } from '../../src/simulation/settlement';
import { assertWorldInvariants, createInitialWorld, stepWorld } from '../../src/simulation/world';

describe('settlement long horizon', () => {
  it('keeps the representative 15k-36k focus window factual, incremental, and founding-scale', () => {
    const seed = [1, 2, 3, 4] as const;
    const atFifteenThousand = stepWorld(createInitialWorld(seed), 15_000);
    const atThirtySixThousand = stepWorld(atFifteenThousand, 21_000);
    const windowEvents = atThirtySixThousand.eventLog.filter(
      (event) => event.tick > atFifteenThousand.tick,
    );

    expect(windowEvents.length).toBeGreaterThanOrEqual(1);
    expect(windowEvents.length).toBeLessThanOrEqual(4);
    expect(atFifteenThousand.civilization.structures).toContainEqual(
      expect.objectContaining({ kind: 'shelter', status: 'operational', progress: 1_000 }),
    );
    const storehouse = atThirtySixThousand.civilization.structures.find(
      (structure) => structure.kind === 'storehouse',
    );
    expect(storehouse).toBeDefined();
    expect(storehouse?.progress).toBeGreaterThanOrEqual(0);
    expect(
      atThirtySixThousand.civilization.structures.every(
        (structure) => structure.kind === 'shelter' || structure.kind === 'storehouse',
      ),
    ).toBe(true);
    expect(atThirtySixThousand.civilization.agents).toHaveLength(6);
    expect(() => assertWorldInvariants(atThirtySixThousand)).not.toThrow();
  });

  it.each([
    [1, 2, 3, 4],
    [101, 202, 303, 404],
    [0xffff_ffff, 0, 0x8000_0000, 17],
  ] as const)(
    'keeps seed %j viable, alive, and active without deadlock through one million ticks',
    (...seed) => {
      const world = stepWorld(createInitialWorld(seed), 1_000_000);
      expect(world.civilization.operationCount).toBeGreaterThan(0);
      expect(
        world.civilization.agents.filter((agent) => agent.alive).length,
      ).toBeGreaterThanOrEqual(6);
      expect(
        world.civilization.agents
          .filter((agent) => agent.id <= 6)
          .every((founder) => founder.alive),
      ).toBe(true);
      expect(
        world.civilization.agents.some(
          (agent) => agent.activity.foodGathered + agent.activity.waterGathered > 100,
        ),
      ).toBe(true);
      expect(world.civilization.agents.some((agent) => agent.activity.transported > 100)).toBe(
        true,
      );
      expect(isViableSettlement(world.civilization)).toBe(true);
      expect(world.civilization.structures).toContainEqual(
        expect.objectContaining({ kind: 'shelter', status: 'operational' }),
      );
      expect(() => assertWorldInvariants(world)).not.toThrow();
    },
    30_000,
  );
});
