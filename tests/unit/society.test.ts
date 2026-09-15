import {
  ACCELERATED_YEAR_TICKS,
  advanceSociety,
  assertSocietyInvariants,
  attachSocietyBiographyEventIds,
  createInitialSociety,
  societyDto,
  type SocietyPersonObservation,
  type SocietyPulseInput,
  type SocietyState,
} from '../../src/simulation/society';
import type { PlayerVisibleEventKind } from '../../src/simulation/events';

function observations(state?: SocietyState): readonly SocietyPersonObservation[] {
  if (state !== undefined) {
    return state.people.map((person) => ({
      id: person.id,
      alive: person.alive,
      health: person.health,
      tileIndex: person.tileIndex,
      traits: [45, 55, 65, 75] as const,
      skills:
        person.role === 'grower'
          ? ([90, 10, 10, 10] as const)
          : person.role === 'maker'
            ? ([10, 90, 10, 10] as const)
            : person.role === 'trader'
              ? ([10, 10, 90, 10] as const)
              : ([10, 10, 10, 90] as const),
      occupation: person.role,
      recentEventIds: [] as const,
    }));
  }
  return [1, 2, 3, 4].map((id) => ({
    id,
    alive: true,
    health: 100,
    tileIndex: 10 + id,
    traits: [20 + id * 10, 30 + id * 5, 40 + id * 3, 50 + id * 2] as const,
    skills:
      id === 1
        ? ([90, 10, 10, 10] as const)
        : id === 2
          ? ([10, 90, 10, 10] as const)
          : id === 3
            ? ([10, 10, 90, 10] as const)
            : ([10, 10, 10, 90] as const),
    occupation: 'generalist',
    recentEventIds: [] as const,
  }));
}

function initial(yearTicks = ACCELERATED_YEAR_TICKS): SocietyState {
  return createInitialSociety({
    seed: [1, 2, 3, 4],
    tick: 0,
    centerTileIndex: 10,
    yearTicks,
    people: observations(),
  });
}

function pulseInput(
  state: SocietyState,
  tick: number,
  food = 12,
  shelterCapacity = 64,
): SocietyPulseInput {
  return {
    tick,
    centerTileIndex: 10,
    worldWidth: 8,
    people: observations(state),
    communalStockpile: { food, timber: 2, stone: 2, water: 12 },
    shelterCapacity,
  };
}

function pulse(state: SocietyState, tick: number, food = 12, shelterCapacity = 64) {
  return advanceSociety(state, pulseInput(state, tick, food, shelterCapacity));
}

function advanceThrough(state: SocietyState, targetTick: number, food = 12, shelterCapacity = 64) {
  let current = state;
  let result = pulse(current, current.lastTick + 1_000, food, shelterCapacity);
  current = result.society;
  while (current.lastTick < targetTick) {
    result = pulse(current, current.lastTick + 1_000, food, shelterCapacity);
    current = result.society;
  }
  return result;
}

describe('deterministic living societies core', () => {
  it('initializes deterministic named people and seed-distinct cultures', () => {
    const first = initial();
    const repeat = initial();
    const distinct = createInitialSociety({
      seed: [9, 8, 7, 6],
      tick: 0,
      centerTileIndex: 10,
      yearTicks: ACCELERATED_YEAR_TICKS,
      people: observations(),
    });

    expect(societyDto(first)).toStrictEqual(societyDto(repeat));
    expect(first.people.every((person) => person.name.length > 0)).toBe(true);
    expect(first.cultures).toHaveLength(2);
    expect(first.cultures).not.toStrictEqual(distinct.cultures);
    for (const cultureSeed of [
      [0, 0, 0, 0],
      [1, 2, 3, 4],
      [0xffff_ffff, 0, 0x8000_0000, 17],
      [9, 8, 7, 6],
    ] as const) {
      const cultures = createInitialSociety({
        seed: cultureSeed,
        tick: 0,
        centerTileIndex: 10,
        yearTicks: ACCELERATED_YEAR_TICKS,
        people: observations(),
      }).cultures;
      expect(
        new Set(
          cultures.map((culture) =>
            [culture.preference, culture.belief, culture.tradition, culture.architectureStyle].join(
              '|',
            ),
          ),
        ).size,
      ).toBe(2);
      expect(new Set(cultures.map((culture) => culture.name)).size).toBe(2);
      expect(new Set(cultures.map((culture) => culture.name)).size).toBe(2);
    }
    expect(() =>
      assertSocietyInvariants({
        ...first,
        cultures: [first.cultures[0]!, { ...first.cultures[0]!, id: 2 }],
      }),
    ).toThrow(/distinct identities/i);
    expect(() =>
      assertSocietyInvariants({
        ...first,
        cultures: [first.cultures[0]!, { ...first.cultures[1]!, name: first.cultures[0]!.name }],
      }),
    ).toThrow(/names must be unique/i);
    expect(() => assertSocietyInvariants(first)).not.toThrow();
  });

  it('conserves declared recipes and settled local exchange', () => {
    const state = initial();
    const credits = state.households.reduce((total, household) => total + household.credits, 0);
    const meals = state.households.reduce((total, household) => total + household.meals, 0);
    const tools = state.households.reduce((total, household) => total + household.tools, 0);
    const result = pulse(state, 1_000, 4);

    expect(result.communalStockpile).toStrictEqual({ food: 0, timber: 0, stone: 0, water: 12 });
    expect(
      result.society.households.reduce((total, household) => total + household.credits, 0),
    ).toBe(credits);
    expect(result.society.households.reduce((total, household) => total + household.meals, 0)).toBe(
      meals + 4,
    );
    expect(result.society.households.reduce((total, household) => total + household.tools, 0)).toBe(
      tools + 2,
    );
    expect(result.society.offers.map((offer) => offer.kind)).toStrictEqual(['meal', 'tool']);
    expect(result.society.offers.every((offer) => offer.fulfilledAmount >= 0)).toBe(true);
    expect(() => assertSocietyInvariants(result.society)).not.toThrow();
  });

  it('requests an off-map adult migrant when a society falls below viable population', () => {
    const state = createInitialSociety({
      seed: [1, 2, 3, 4],
      tick: 0,
      centerTileIndex: 10,
      yearTicks: ACCELERATED_YEAR_TICKS,
      people: observations().slice(0, 1),
    });
    const result = advanceThrough(state, ACCELERATED_YEAR_TICKS, 20);

    expect(result.personMigrationDrafts).toHaveLength(1);
    expect(result.personMigrationDrafts[0]).toMatchObject({ origin: 'migration', generation: 0 });
  });

  it('produces valid accelerated generations and observed deaths', () => {
    let state = initial();
    let sawBirth = false;
    let sawGrandchild = false;
    for (let tick = 1_000; tick <= 300_000; tick += 1_000) {
      const result = pulse(state, tick, 200);
      state =
        result.society.pendingBiographyFacts.length === 0
          ? result.society
          : attachSocietyBiographyEventIds(
              result.society,
              result.events.map((draft, index) => ({
                id: tick * 100 + index + 1,
                tick,
                kind: draft.kind,
                subject: draft.subject,
                target: draft.target,
                summary: draft.summary,
              })),
            );
      sawBirth ||= result.personBirthDrafts.length > 0;
      sawGrandchild ||= result.personBirthDrafts.some((draft) => draft.generation >= 2);
      for (const draft of result.personBirthDrafts) {
        expect(
          draft.parentIds.every(
            (parentId) =>
              result.society.people.find((person) => person.id === parentId)?.householdId ===
              draft.householdId,
          ),
        ).toBe(true);
      }
    }
    const deceased = state.people.find((person) => person.alive)!;
    const death = advanceSociety(state, {
      tick: 301_000,
      centerTileIndex: 10,
      worldWidth: 8,
      people: observations(state).map((person) =>
        person.id === deceased.id ? { ...person, alive: false, health: 0 } : person,
      ),
      communalStockpile: { food: 20, timber: 2, stone: 2, water: 12 },
      shelterCapacity: 64,
    });

    expect(sawBirth).toBe(true);
    expect(sawGrandchild).toBe(true);
    expect(death.deathPersonIds).toContain(deceased.id);
    expect(death.society.people.find((person) => person.id === deceased.id)).toMatchObject({
      alive: false,
      deathTick: 301_000,
    });
  });

  it('propagates scarcity into conflict, collapse, and later recovery', () => {
    const state = initial();
    let current = state;
    let sawConflict = false;
    for (let tick = 1_000; tick <= 6_000; tick += 1_000) {
      const result = pulse(current, tick, 0, 0);
      current = result.society;
      sawConflict ||= result.events.some((event) =>
        ['conflict', 'rivalry-formed', 'enmity-formed'].includes(event.kind),
      );
    }
    expect(current.scarcity).toBeGreaterThanOrEqual(80);
    expect(sawConflict).toBe(true);
    expect(
      current.interpersonal.active.some(
        (edge) =>
          edge.kind === 'rival' ||
          edge.kind === 'enemy' ||
          edge.firstToSecond.grievance > 0 ||
          edge.secondToFirst.grievance > 0,
      ),
    ).toBe(true);
    expect(current.stability).toBeLessThan(state.stability);
    expect(current.collapsed).toBe(true);

    for (let tick = 7_000; tick <= 30_000; tick += 1_000)
      current = pulse(current, tick, 60).society;
    expect(current.collapsed).toBe(false);
    expect(current.stability).toBeGreaterThan(15);
    expect(current.institution.government).toBe('council');
  });

  it('attaches biography ids only to an exact authoritative source event', () => {
    let state = initial();
    for (let tick = 1_000; tick <= ACCELERATED_YEAR_TICKS; tick += 1_000)
      state = pulse(state, tick, 20).society;
    expect(state.pendingBiographyFacts.length).toBeGreaterThanOrEqual(3);
    expect(
      state.pendingBiographyFacts.some((fact) =>
        [
          'relationship-formed',
          'friendship-formed',
          'rivalry-formed',
          'mentorship-formed',
          'resource-shared',
        ].includes(fact.kind),
      ),
    ).toBe(true);
    const sources = state.pendingBiographyFacts.map((fact, index) => ({
      id: 91 + index,
      tick: state.lastTick,
      kind: fact.kind,
      subject: fact.source,
      target: fact.target,
      summary: fact.summary,
    }));
    const fact = state.pendingBiographyFacts[0]!;
    const attached = attachSocietyBiographyEventIds(state, sources);

    expect(
      attached.people.find((person) => person.id === fact.personId)?.biographyEventIds,
    ).toContain(91 + state.pendingBiographyFacts.indexOf(fact));
    expect(() =>
      attachSocietyBiographyEventIds(state, [{ ...sources[0]!, summary: 'invented history' }]),
    ).toThrow(/exact authoritative/i);
  });

  it('retains factual milestones from childhood through reconciliation across a long life', () => {
    let state = initial();
    const historical: {
      id: number;
      tick: number;
      kind: PlayerVisibleEventKind;
      subject: { kind: 'person'; id: number };
      target: { kind: 'person'; id: number };
      summary: string;
    }[] = [];
    const milestoneKinds = [
      'sibling-bond-formed',
      'friendship-formed',
      'partnership-formed',
      'family-estranged',
      'relationship-reconciled',
    ] as const;
    const allKinds: readonly PlayerVisibleEventKind[] = [
      ...milestoneKinds,
      ...Array.from({ length: 20 }, (_, index) =>
        index % 2 === 0 ? 'resource-shared' : 'knowledge-shared',
      ),
    ];

    for (const [index, kind] of allKinds.entries()) {
      const source = {
        id: 501 + index,
        tick: (index + 1) * ACCELERATED_YEAR_TICKS * 3,
        kind,
        subject: { kind: 'person' as const, id: 1 },
        target: { kind: 'person' as const, id: 2 },
        summary: `Factual ${kind} milestone ${index + 1}.`,
      };
      historical.push(source);
      state = attachSocietyBiographyEventIds(
        {
          ...state,
          pendingBiographyFacts: [
            {
              personId: 1,
              kind: source.kind,
              source: source.subject,
              target: source.target,
              summary: source.summary,
            },
          ],
        },
        [source],
        historical,
      );
    }

    const biography = state.people.find((person) => person.id === 1)!.biographyEventIds;
    expect(biography).toHaveLength(16);
    for (const kind of milestoneKinds) {
      const source = historical.find((event) => event.kind === kind)!;
      expect(biography, kind).toContain(source.id);
    }
    expect(biography).toStrictEqual([...biography].sort((left, right) => left - right));
  });

  it('rejects malformed family and household references', () => {
    const state = initial();
    const malformed: SocietyState = {
      ...state,
      people: [{ ...state.people[0]!, householdId: 999 }, ...state.people.slice(1)],
    };

    expect(() => assertSocietyInvariants(malformed)).toThrow(/household/i);
  });

  it('runs normal society changes only on its civil quarter and preserves the event budget', () => {
    const state = initial(100_000);
    let current = state;
    const meaningfulEvents: string[] = [];
    while (current.lastTick < 36_000) {
      const result = pulse(current, current.lastTick + 1_000, 20);
      current = result.society;
      if (current.lastTick > 15_000)
        meaningfulEvents.push(...result.events.map((event) => event.kind));
    }

    expect(meaningfulEvents.length).toBeGreaterThanOrEqual(1);
    expect(meaningfulEvents.length).toBeLessThanOrEqual(4);
    expect(current.people.every((person) => person.generation === 0)).toBe(true);
  });

  it('rejects invalid leaders, adult membership, parents, ids, and nonconsecutive pulses', () => {
    const state = initial();
    expect(() => advanceSociety(state, pulseInput(state, 2_000))).toThrow(/next consecutive/i);
    expect(() =>
      assertSocietyInvariants({ ...state, institution: { ...state.institution, leaderId: 999 } }),
    ).toThrow(/institution/i);
    expect(() =>
      assertSocietyInvariants({
        ...state,
        households: [{ ...state.households[0]!, adultIds: [3] }, ...state.households.slice(1)],
      }),
    ).toThrow(/adult/i);
    expect(() =>
      assertSocietyInvariants({
        ...state,
        people: [{ ...state.people[0]!, parentIds: [4, 0] }, ...state.people.slice(1)],
      }),
    ).toThrow(/parent/i);
    expect(() => assertSocietyInvariants({ ...state, nextPersonId: 1 })).toThrow(/next person/i);
    expect(() => assertSocietyInvariants({ ...state, nextHouseholdId: 1 })).toThrow(
      /next household/i,
    );
    expect(() => assertSocietyInvariants({ ...state, nextOfferId: 0 })).toThrow(/next offer/i);
  });
});
