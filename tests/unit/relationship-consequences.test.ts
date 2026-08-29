import {
  admitActiveRelationship,
  createInitialInterpersonalState,
  type ActiveRelationship,
} from '../../src/simulation/relationships';
import {
  ACCELERATED_YEAR_TICKS,
  advanceSociety,
  createInitialSociety,
  type SocietyPersonObservation,
  type SocietyPulseInput,
  type SocietyState,
} from '../../src/simulation/society';

const YEAR = ACCELERATED_YEAR_TICKS;

function observations(
  count: number,
  overrides: Readonly<Record<number, Partial<SocietyPersonObservation>>> = {},
): readonly SocietyPersonObservation[] {
  return Array.from({ length: count }, (_, index) => {
    const id = index + 1;
    return {
      id,
      alive: true,
      health: 100,
      tileIndex: 10 + id,
      traits: [50, 50, 50, 50] as const,
      skills: id === 1 ? ([100, 80, 80, 80] as const) : ([10, 10, 10, 10] as const),
      occupation: 'maker',
      recentEventIds: [] as const,
      ...overrides[id],
    };
  });
}

function state(
  count: number,
  tick = YEAR - 1_000,
  observationOverrides: Readonly<Record<number, Partial<SocietyPersonObservation>>> = {},
): SocietyState {
  return createInitialSociety({
    seed: [91, 17, 23, 47],
    tick,
    centerTileIndex: 10,
    yearTicks: YEAR,
    people: observations(count, observationOverrides),
  });
}

function input(
  current: SocietyState,
  overrides: Partial<SocietyPulseInput> = {},
): SocietyPulseInput {
  return {
    tick: current.lastTick + 1_000,
    centerTileIndex: 10,
    worldWidth: 8,
    people: observations(current.people.length),
    communalStockpile: { food: 20, timber: 2, stone: 2, water: 20 },
    shelterCapacity: 64,
    ...overrides,
  };
}

function edge(
  id: number,
  firstPersonId: number,
  secondPersonId: number,
  kind: ActiveRelationship['kind'] = 'friend',
  values: Partial<ActiveRelationship> = {},
): ActiveRelationship {
  const [first, second] = [firstPersonId, secondPersonId].sort((left, right) => left - right);
  const partner = kind === 'partner' || kind === 'long-term-partner';
  const adversarial = kind === 'rival' || kind === 'enemy';
  const former = kind === 'former-partner' || kind === 'widowed';
  return {
    id,
    firstPersonId: first!,
    secondPersonId: second!,
    firstRole: partner ? 'partner' : adversarial ? 'adversary' : former ? 'former-partner' : 'peer',
    secondRole: partner
      ? 'partner'
      : adversarial
        ? 'adversary'
        : former
          ? 'former-partner'
          : 'peer',
    kind,
    formedTick: 0,
    changedTick: 0,
    lastInteractionTick: 0,
    observedSinceTick: 0,
    trend: 'stable',
    firstToSecond: { affinity: 100, trust: 100, closeness: 100, commitment: 80, grievance: 0 },
    secondToFirst: { affinity: 100, trust: 100, closeness: 100, commitment: 80, grievance: 0 },
    sharedEvents: [],
    rng: [id, id + 1, id + 2, id + 3],
    legacySocietyCounters: null,
    ...values,
  };
}

function withEdges(current: SocietyState, ...edges: readonly ActiveRelationship[]): SocietyState {
  let interpersonal = current.interpersonal;
  const people = current.people.map((person) => ({
    id: person.id,
    alive: person.alive,
    birthTick: person.birthTick,
    parentIds: person.parentIds,
    householdId: person.householdId,
  }));
  for (const next of edges) interpersonal = admitActiveRelationship(interpersonal, people, next);
  return { ...current, interpersonal };
}

function withHouseholds(
  current: SocietyState,
  resources: Readonly<Record<number, Readonly<{ credits: number; meals: number; tools: number }>>>,
): SocietyState {
  return {
    ...current,
    households: current.households.map((household) =>
      resources[household.id] === undefined
        ? household
        : { ...household, ...resources[household.id] },
    ),
  };
}

function atMigrationBoundary(current: SocietyState): SocietyState {
  return {
    ...current,
    lastTick: YEAR * 10 - 1_000,
    interpersonal: { ...current.interpersonal, tick: YEAR * 10 - 1_000 },
  };
}

describe('M4.5 relationship consequences', () => {
  it('changes the selected voluntary resource recipient when only the helper relationship changes', () => {
    const base = withHouseholds(state(6), {
      1: { credits: 5, meals: 12, tools: 0 },
      2: { credits: 5, meals: 0, tools: 0 },
      3: { credits: 5, meals: 0, tools: 0 },
    });
    const toThree = advanceSociety(withEdges(base, edge(1, 1, 3)), input(base));
    const toFive = advanceSociety(withEdges(base, edge(1, 1, 5)), input(base));

    const recipient = (result: ReturnType<typeof advanceSociety>) =>
      result.events.find(
        (event) =>
          event.kind === 'resource-shared' &&
          event.subject.kind === 'person' &&
          event.subject.id === 1,
      )?.target.id;
    expect(recipient(toThree)).toBe(3);
    expect(recipient(toFive)).toBe(5);
  });

  it('changes child formation when only a persistent pair bond is present', () => {
    const initial = withHouseholds(state(2), { 1: { credits: 8, meals: 8, tools: 1 } });
    const base: SocietyState = {
      ...initial,
      households: initial.households.map((household) => ({
        ...household,
        lastChildArrivalTick: -YEAR * 2,
      })),
    };
    const partnered = advanceSociety(withEdges(base, edge(1, 1, 2, 'partner')), input(base));
    const unpartnered = advanceSociety(
      withEdges(
        base,
        edge(1, 1, 2, 'friend', {
          firstToSecond: { affinity: 55, trust: 55, closeness: 20, commitment: 0, grievance: 0 },
          secondToFirst: { affinity: 55, trust: 55, closeness: 20, commitment: 0, grievance: 0 },
        }),
      ),
      input(base),
    );

    expect(partnered.personBirthDrafts).toHaveLength(1);
    expect(unpartnered.personBirthDrafts).toHaveLength(0);
    expect(partnered.society.interpersonal.childArrivals).toStrictEqual([
      expect.objectContaining({
        policy: 'pair-bond',
        guardianIds: [1, 2],
        partnerRelationshipId: 1,
      }),
    ]);
    expect(partnered.personBirthDrafts[0]?.parentIds).toStrictEqual([1, 2]);
  });

  it('supports a culturally declared one-guardian communal child arrival', () => {
    const initial = state(1);
    const communal: SocietyState = {
      ...initial,
      people: initial.people.map((person) => ({ ...person, cultureId: 2 })),
      households: initial.households.map((household) => ({
        ...household,
        cultureId: 2,
        credits: 8,
        meals: 8,
        lastChildArrivalTick: -YEAR * 2,
      })),
      groups: initial.groups.map((group) => ({
        ...group,
        memberIds: group.cultureId === 2 ? [1] : [],
      })),
    };
    const result = advanceSociety(communal, input(communal));

    expect(result.personBirthDrafts).toHaveLength(1);
    expect(result.personBirthDrafts[0]?.parentIds).toStrictEqual([1, 0]);
    expect(result.society.interpersonal.childArrivals).toStrictEqual([
      expect.objectContaining({
        policy: 'communal-guardianship',
        guardianIds: [1],
        partnerRelationshipId: null,
      }),
    ]);
  });

  it('limits plural partnership household changes to one transition per person and pulse', () => {
    const base = state(4, YEAR * 2 - 1_000);
    const partnered = withEdges(
      base,
      edge(1, 1, 3, 'partner', {
        firstToSecond: { affinity: 90, trust: 90, closeness: 60, commitment: 70, grievance: 0 },
        secondToFirst: { affinity: 90, trust: 90, closeness: 60, commitment: 70, grievance: 0 },
      }),
      edge(2, 1, 4, 'partner', {
        firstToSecond: { affinity: 90, trust: 90, closeness: 60, commitment: 70, grievance: 0 },
        secondToFirst: { affinity: 90, trust: 90, closeness: 60, commitment: 70, grievance: 0 },
      }),
    );
    const result = advanceSociety(partnered, input(partnered));

    expect(
      result.events.filter((event) => event.kind === 'long-term-partnership-formed'),
    ).toHaveLength(2);
    expect(result.events.filter((event) => event.kind === 'household-formed')).toHaveLength(1);
    expect(result.society.interpersonal.householdHistories.get(1)?.intervals).toHaveLength(2);
  });

  it('selects and records a living household caregiver after both parents die', () => {
    const base = state(4);
    const people = base.people.map((person) =>
      person.id === 3
        ? {
            ...person,
            origin: 'birth' as const,
            birthTick: base.lastTick - YEAR * 5,
            generation: 1,
            parentIds: [1, 2] as const,
            householdId: 1,
            cultureId: 1,
          }
        : person.id === 4
          ? { ...person, householdId: 1, cultureId: 1 }
          : { ...person, cultureId: 1 },
    );
    const orphanScenario: SocietyState = {
      ...base,
      people,
      households: base.households.map((household) => ({
        ...household,
        adultIds: household.id === 1 ? [1, 2, 4] : [],
      })),
      groups: base.groups.map((group) => ({
        ...group,
        memberIds: group.cultureId === 1 ? [1, 2, 3, 4] : [],
      })),
      interpersonal: createInitialInterpersonalState(
        [91, 17, 23, 47],
        base.lastTick,
        people.map((person) => ({
          id: person.id,
          alive: person.alive,
          birthTick: person.birthTick,
          parentIds: person.parentIds,
          householdId: person.householdId,
        })),
      ),
    };
    const result = advanceSociety(
      orphanScenario,
      input(orphanScenario, {
        people: observations(4, {
          1: { alive: false, health: 0 },
          2: { alive: false, health: 0 },
        }),
      }),
    );

    expect(result.events).toContainEqual(
      expect.objectContaining({ kind: 'guardianship-formed', subject: { kind: 'person', id: 4 } }),
    );
    expect(result.society.interpersonal.familyBonds).toContainEqual(
      expect.objectContaining({ kind: 'guardian', parentId: 4, childId: 3 }),
    );
  });

  it('changes the selected migration companion when only the mover relationship changes', () => {
    const base = atMigrationBoundary(
      withHouseholds(state(6, 0), {
        1: { credits: 0, meals: 0, tools: 0 },
        2: { credits: 10, meals: 10, tools: 1 },
        3: { credits: 10, meals: 10, tools: 1 },
      }),
    );
    const scarce = input(base, { communalStockpile: { food: 0, timber: 2, stone: 2, water: 20 } });
    const withThree = advanceSociety(withEdges(base, edge(1, 1, 3)), scarce);
    const withFive = advanceSociety(withEdges(base, edge(1, 1, 5)), scarce);

    const companion = (result: ReturnType<typeof advanceSociety>) =>
      result.events.find((event) => event.kind === 'household-migrated' && event.subject.id === 1)
        ?.target.id;
    expect(companion(withThree)).toBe(3);
    expect(companion(withFive)).toBe(5);
  });

  it('changes the selected learner for authoritative knowledge transfer', () => {
    const base = state(3);
    const learnerTwo = advanceSociety(withEdges(base, edge(1, 1, 2, 'mentor')), input(base));
    const learnerThree = advanceSociety(withEdges(base, edge(1, 1, 3, 'mentor')), input(base));

    expect(learnerTwo.skillPatches).toContainEqual(
      expect.objectContaining({ personId: 2, amount: 1 }),
    );
    expect(learnerThree.skillPatches).toContainEqual(
      expect.objectContaining({ personId: 3, amount: 1 }),
    );
  });

  it('changes council leadership through relationship-ranked political support', () => {
    const base = withHouseholds(state(4), {
      1: { credits: 4, meals: 4, tools: 0 },
      2: { credits: 4, meals: 4, tools: 0 },
    });
    const forTwo = advanceSociety(
      withEdges(base, edge(1, 1, 2), edge(2, 2, 3), edge(3, 2, 4)),
      input(base),
    );
    const forThree = advanceSociety(
      withEdges(base, edge(1, 1, 3), edge(2, 2, 3), edge(3, 3, 4)),
      input(base),
    );

    expect(forTwo.society.institution.leaderId).toBe(2);
    expect(forThree.society.institution.leaderId).toBe(3);
  });

  it('changes the retaliation target when only grievance relationship state changes', () => {
    const base = withHouseholds(state(6), {
      1: { credits: 1, meals: 0, tools: 0 },
      2: { credits: 8, meals: 4, tools: 0 },
      3: { credits: 8, meals: 4, tools: 0 },
    });
    const hostile = (id: number, target: number) =>
      edge(id, 1, target, 'rival', {
        firstToSecond: { affinity: 0, trust: 0, closeness: 0, commitment: 0, grievance: 100 },
        secondToFirst: { affinity: 0, trust: 0, closeness: 0, commitment: 0, grievance: 100 },
      });
    const scarce = input(base, { communalStockpile: { food: 0, timber: 2, stone: 2, water: 20 } });
    const againstThree = advanceSociety(withEdges(base, hostile(1, 3)), scarce);
    const againstFive = advanceSociety(withEdges(base, hostile(1, 5)), scarce);

    const target = (result: ReturnType<typeof advanceSociety>) =>
      result.events.find(
        (event) =>
          event.kind === 'conflict' && event.subject.kind === 'person' && event.subject.id === 1,
      )?.target.id;
    expect(target(againstThree)).toBe(3);
    expect(target(againstFive)).toBe(5);
    expect(againstThree.events).toContainEqual(
      expect.objectContaining({
        kind: 'theft',
        subject: { kind: 'person', id: 1 },
        target: { kind: 'household', id: 2 },
        amount: 1,
      }),
    );
    expect(againstFive.events).toContainEqual(
      expect.objectContaining({
        kind: 'theft',
        subject: { kind: 'person', id: 1 },
        target: { kind: 'household', id: 3 },
        amount: 1,
      }),
    );
  });
});
