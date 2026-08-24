import { ACCELERATED_YEAR_TICKS } from '../../src/simulation/society';
import {
  applyRecordedSupplyShortage,
  assertWorldInvariants,
  canonicalWorldJson,
  createInitialWorld,
  stepWorld,
  type WorldState,
} from '../../src/simulation/world';

const seed = [0x1234_5678, 0x9abc_def0, 0x0fed_cba9, 0x8765_4321] as const;

function goods(world: WorldState): readonly number[] {
  return world.civilization.society.households.flatMap((household) => [
    household.meals,
    household.tools,
  ]);
}

describe('recorded supply shortages', () => {
  it('rejects severities outside the canonical one through one hundred range', () => {
    const world = createInitialWorld(seed);

    for (const severity of [0, -1, 101, 1.5, Number.NaN]) {
      expect(() => applyRecordedSupplyShortage(world, severity)).toThrow(/severity/i);
    }
    expect(() => applyRecordedSupplyShortage({ ...world, tick: -1 }, 50)).toThrow(/invariant/i);
  });

  it('deterministically removes resources and records one immutable collapse transition', () => {
    const foundation = stepWorld(createInitialWorld(seed), 12_000);
    const shocked = applyRecordedSupplyShortage(foundation, 75);
    const repeated = applyRecordedSupplyShortage(shocked, 75);
    const repeat = applyRecordedSupplyShortage(foundation, 75);
    const beforeStockpile = foundation.civilization.stockpile;
    const afterStockpile = shocked.civilization.stockpile;

    expect(canonicalWorldJson(shocked)).toBe(canonicalWorldJson(repeat));
    expect(afterStockpile.food).toBeLessThanOrEqual(beforeStockpile.food);
    expect(afterStockpile.water).toBeLessThanOrEqual(beforeStockpile.water);
    expect(afterStockpile.timber).toBeLessThanOrEqual(beforeStockpile.timber);
    expect(afterStockpile.stone).toBeLessThanOrEqual(beforeStockpile.stone);
    expect(goods(shocked).every((value, index) => value <= goods(foundation)[index]!)).toBe(true);
    expect(goods(shocked).every((value) => value >= 0)).toBe(true);
    expect(new Set(goods(shocked)).size).toBeGreaterThan(1);
    expect(
      shocked.civilization.agents.every((agent, index) => {
        const before = foundation.civilization.agents[index]!;
        return !agent.alive || (agent.hunger >= before.hunger && agent.health <= before.health);
      }),
    ).toBe(true);

    const shortages = shocked.eventLog.filter((event) => event.kind === 'supply-shortage');
    const collapses = repeated.eventLog.filter((event) => event.kind === 'settlement-collapsed');
    expect(
      shocked.eventLog.slice(foundation.eventLog.length).map((event) => event.kind),
    ).toStrictEqual(['supply-shortage', 'settlement-collapsed']);
    expect(shocked.civilization.agents).toHaveLength(foundation.civilization.agents.length);
    expect(shortages).toHaveLength(1);
    expect(shortages[0]).toMatchObject({
      subjectKind: 'world',
      subjectId: 0,
      targetKind: 'institution',
      targetId: shocked.civilization.society.institution.id,
      amount: 75,
    });
    expect(Object.isFrozen(shortages[0])).toBe(true);
    expect(collapses).toHaveLength(1);
    expect(() => assertWorldInvariants(repeated)).not.toThrow();
  });

  it('leaves mortality, migration, and recovery to later normal pulses', () => {
    const foundation = stepWorld(
      createInitialWorld(seed, { societyYearTicks: ACCELERATED_YEAR_TICKS }),
      12_000,
    );
    const shocked = applyRecordedSupplyShortage(foundation, 100);
    const later = stepWorld(shocked, 80_000);
    const laterKinds = new Set(
      later.eventLog.slice(shocked.eventLog.length).map((event) => event.kind),
    );

    expect(shocked.civilization.agents.map((agent) => agent.alive)).toStrictEqual(
      foundation.civilization.agents.map((agent) => agent.alive),
    );
    expect(laterKinds.has('person-died')).toBe(true);
    expect(laterKinds.has('person-migrated')).toBe(true);
    expect(laterKinds.has('settlement-recovered')).toBe(true);
    expect(later.civilization.society.collapsed).toBe(false);
    expect(() => assertWorldInvariants(later)).not.toThrow();
  }, 30_000);
});
