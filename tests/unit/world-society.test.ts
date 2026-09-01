import {
  ACCELERATED_YEAR_TICKS,
  NORMAL_YEAR_TICKS,
  type EntityKind,
} from '../../src/simulation/society';
import {
  assertWorldInvariants,
  createInitialWorld,
  stepWorld,
  type WorldEvent,
  type WorldState,
} from '../../src/simulation/world';

const seed = [0x1234_5678, 0x9abc_def0, 0x0fed_cba9, 0x8765_4321] as const;

const M4_EVENT_KINDS = new Set([
  'tools-crafted',
  'local-exchange',
  'person-died',
  'person-born',
  'person-migrated',
  'conflict',
  'theft',
  'reconciliation',
  'cooperation',
  'settlement-collapsed',
  'settlement-recovered',
  'government-changed',
]);

function m4Events(world: WorldState): readonly WorldEvent[] {
  return world.eventLog.filter((event) => M4_EVENT_KINDS.has(event.kind));
}

function referenceResolves(world: WorldState, kind: EntityKind, id: number): boolean {
  const society = world.civilization.society;
  switch (kind) {
    case 'person':
      return society.people.some((person) => person.id === id);
    case 'household':
      return society.households.some((household) => household.id === id);
    case 'culture':
      return society.cultures.some((culture) => culture.id === id);
    case 'group':
      return society.groups.some((group) => group.id === id);
    case 'institution':
      return society.institution.id === id;
    case 'structure':
      return world.civilization.structures.some((structure) => structure.id === id);
    case 'settlement':
      return world.civilizations.settlements.some((settlement) => settlement.id === id);
    case 'civilization':
      return world.civilizations.civilizations.some((civilization) => civilization.id === id);
    case 'route':
      return world.civilizations.routes.some((route) => route.id === id);
    case 'conflict':
      return world.civilizations.conflicts.some((conflict) => conflict.id === id);
    case 'ruin':
      return world.civilizations.ruins.some((ruin) => ruin.id === id);
    case 'world':
      return id === 0;
  }
}

function householdGoods(world: WorldState): number {
  return world.civilization.society.households.reduce(
    (total, household) => total + household.meals + household.tools,
    0,
  );
}

describe('M4 society world integration', () => {
  it('aligns named founding people to authoritative agents and creates two valid cultures', () => {
    const world = createInitialWorld(seed);
    const society = world.civilization.society;

    expect(world.config.societyYearTicks).toBe(NORMAL_YEAR_TICKS);
    expect(society.people.map((person) => [person.id, person.name])).toStrictEqual(
      world.civilization.agents.map((agent) => [agent.id, agent.name]),
    );
    expect(society.people).toHaveLength(world.civilization.agents.length);
    expect(society.cultures).toHaveLength(2);
    expect(
      new Set(
        society.cultures.map(
          (culture) =>
            `${culture.preference}|${culture.belief}|${culture.tradition}|${culture.architectureStyle}`,
        ),
      ).size,
    ).toBe(2);
    expect(() => assertWorldInvariants(world)).not.toThrow();
  });

  it('keeps the normal focus window founding-scale and records only concise factual M4 summaries', () => {
    const atFifteenThousand = stepWorld(createInitialWorld(seed), 15_000);
    const atThirtySixThousand = stepWorld(atFifteenThousand, 21_000);
    const windowEvents = m4Events(atThirtySixThousand).filter(
      (event) => event.tick > atFifteenThousand.tick,
    );

    expect(atThirtySixThousand.config.societyYearTicks).toBe(NORMAL_YEAR_TICKS);
    expect(atThirtySixThousand.civilization.society.people).toHaveLength(6);
    expect(
      atThirtySixThousand.civilization.society.people.every((person) => person.generation === 0),
    ).toBe(true);
    expect(windowEvents.length).toBeGreaterThanOrEqual(1);
    expect(windowEvents.length).toBeLessThanOrEqual(4);
    for (const event of windowEvents) {
      expect(event.summary.length).toBeGreaterThan(0);
      expect(event.summary.length).toBeLessThanOrEqual(160);
      expect(Object.isFrozen(event)).toBe(true);
    }
    expect(() => assertWorldInvariants(atThirtySixThousand)).not.toThrow();
  });

  it('reaches aligned child and later-generation cohorts in the accelerated deterministic calendar', () => {
    const world = stepWorld(
      createInitialWorld(seed, { societyYearTicks: ACCELERATED_YEAR_TICKS }),
      120_000,
    );
    const society = world.civilization.society;
    const peopleById = new Map(society.people.map((person) => [person.id, person]));

    expect(society.people.some((person) => person.generation >= 1)).toBe(true);
    expect(society.people.some((person) => person.generation >= 2)).toBe(true);
    expect(society.people.some((person) => person.parentIds[0] !== 0)).toBe(true);
    expect(world.civilization.agents.map((agent) => [agent.id, agent.name])).toStrictEqual(
      society.people.map((person) => [person.id, person.name]),
    );
    for (const agent of world.civilization.agents) {
      const person = peopleById.get(agent.id);
      expect(person).toBeDefined();
      expect(person).toMatchObject({ alive: agent.alive, health: agent.health, name: agent.name });
    }
    expect(() => assertWorldInvariants(world)).not.toThrow();
  }, 30_000);

  it('carries parent traits and learned-skill foundations into the next generation', () => {
    let world = createInitialWorld(seed, { societyYearTicks: ACCELERATED_YEAR_TICKS });
    let childId = 0;
    while (world.tick < 120_000 && childId === 0) {
      world = stepWorld(world, 1_000);
      childId = world.eventLog.findLast((event) => event.kind === 'person-born')?.subjectId ?? 0;
    }
    const childPerson = world.civilization.society.people.find((person) => person.id === childId);
    const childAgent = world.civilization.agents.find((agent) => agent.id === childId);
    expect(childPerson).toBeDefined();
    expect(childAgent).toBeDefined();
    const parents = childPerson!.parentIds.map((parentId) =>
      world.civilization.agents.find((agent) => agent.id === parentId),
    );
    expect(parents.every((parent) => parent !== undefined)).toBe(true);
    for (let index = 0; index < 4; index += 1) {
      expect(childAgent!.traits[index]).toBe(
        Math.trunc((parents[0]!.traits[index]! + parents[1]!.traits[index]!) / 2),
      );
      expect(childAgent!.skills[index]).toBe(
        Math.max(0, Math.trunc((parents[0]!.skills[index]! + parents[1]!.skills[index]!) / 2) - 15),
      );
    }
  }, 30_000);

  it('keeps biographies and all typed event references factual and resolvable', () => {
    const world = stepWorld(
      createInitialWorld(seed, { societyYearTicks: ACCELERATED_YEAR_TICKS }),
      120_000,
    );
    const eventById = new Map(world.eventLog.map((event) => [event.id, event]));
    const society = world.civilization.society;

    for (const person of society.people) {
      for (const eventId of person.biographyEventIds) {
        const event = eventById.get(eventId);
        expect(event).toBeDefined();
        expect(event?.summary.length).toBeGreaterThan(0);
        expect(
          (event?.subjectKind === 'person' && event.subjectId === person.id) ||
            (event?.targetKind === 'person' && event.targetId === person.id),
        ).toBe(true);
      }
    }

    const allKinds: readonly EntityKind[] = [
      'person',
      'household',
      'culture',
      'group',
      'institution',
      'structure',
      'world',
    ];
    for (const kind of allKinds) {
      const id =
        kind === 'person'
          ? society.people[0]!.id
          : kind === 'household'
            ? society.households[0]!.id
            : kind === 'culture'
              ? society.cultures[0]!.id
              : kind === 'group'
                ? society.groups[0]!.id
                : kind === 'institution'
                  ? society.institution.id
                  : kind === 'structure'
                    ? world.civilization.structures[0]!.id
                    : 0;
      expect(referenceResolves(world, kind, id)).toBe(true);
    }
    for (const event of m4Events(world)) {
      expect(referenceResolves(world, event.subjectKind, event.subjectId)).toBe(true);
      expect(referenceResolves(world, event.targetKind, event.targetId)).toBe(true);
    }
  }, 30_000);

  it('makes economic events change authoritative stores, household goods, need relief, or transport', () => {
    const initial = createInitialWorld(seed, { societyYearTicks: ACCELERATED_YEAR_TICKS });
    const advanced = stepWorld(initial, 12_000);
    const economicEvents = m4Events(advanced).filter((event) =>
      ['tools-crafted', 'local-exchange'].includes(event.kind),
    );
    const stockpileChanged =
      initial.civilization.stockpile.food !== advanced.civilization.stockpile.food ||
      initial.civilization.stockpile.water !== advanced.civilization.stockpile.water ||
      initial.civilization.stockpile.timber !== advanced.civilization.stockpile.timber ||
      initial.civilization.stockpile.stone !== advanced.civilization.stockpile.stone;
    const initialAgentsById = new Map(
      initial.civilization.agents.map((agent) => [agent.id, agent]),
    );
    const reliefChanged = advanced.civilization.agents.some((agent) => {
      const before = initialAgentsById.get(agent.id);
      return before !== undefined && (agent.hunger < before.hunger || agent.thirst < before.thirst);
    });
    const transportChanged = advanced.civilization.agents.some((agent) => {
      const before = initialAgentsById.get(agent.id);
      return before !== undefined && agent.activity.transported > before.activity.transported;
    });

    expect(economicEvents.length).toBeGreaterThan(0);
    expect(
      stockpileChanged ||
        householdGoods(initial) !== householdGoods(advanced) ||
        reliefChanged ||
        transportChanged,
    ).toBe(true);
    expect(() => assertWorldInvariants(advanced)).not.toThrow();
  }, 30_000);
});
