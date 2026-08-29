import {
  admitActiveRelationship,
  appendHouseholdMembershipInterval,
  assertChildArrivalRecord,
  assertInterpersonalInvariants,
  canonicalPair,
  createInitialInterpersonalState,
  findActiveRelationship,
  interpersonalDto,
  isExtendedKin,
  isProhibitedPartnerKin,
  isSibling,
  MAX_ACTIVE_RELATIONSHIPS_PER_PERSON,
  MAX_ARCHIVED_RELATIONSHIPS_PER_PERSON,
  MAX_HOUSEHOLD_INTERVALS_PER_PERSON,
  MAX_SHARED_EVENTS_PER_RELATIONSHIP,
  migrateLegacyInterpersonalState,
  parentIdsFor,
  retainSharedEventReferences,
  siblingIdsFor,
  synchronizeInterpersonalPeople,
  type ActiveRelationship,
  type InterpersonalPersonInput,
  type PersonHouseholdHistory,
} from '../../src/simulation/relationships';

const TICK = 100;

function people(count = 4): readonly InterpersonalPersonInput[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    alive: true,
    birthTick: -100,
    parentIds: [],
    householdId: 1,
  }));
}

function relationship(
  id: number,
  first: number,
  second: number,
  kind = 'friend',
): ActiveRelationship {
  const [firstPersonId, secondPersonId] = canonicalPair(first, second);
  const partnerState = kind === 'partner';
  return {
    id,
    firstPersonId,
    secondPersonId,
    firstRole: kind === 'partner' ? 'partner' : 'peer',
    secondRole: kind === 'partner' ? 'partner' : 'peer',
    kind: kind as ActiveRelationship['kind'],
    formedTick: 1,
    changedTick: TICK,
    lastInteractionTick: TICK,
    observedSinceTick: 1,
    trend: 'stable',
    firstToSecond: {
      affinity: 50,
      trust: partnerState ? 60 : 50,
      closeness: 0,
      commitment: partnerState ? 60 : 0,
      grievance: 0,
    },
    secondToFirst: {
      affinity: 50,
      trust: partnerState ? 60 : 50,
      closeness: 0,
      commitment: partnerState ? 60 : 0,
      grievance: 0,
    },
    sharedEvents: [],
    rng: [1, 2, 3, id],
    legacySocietyCounters: null,
  };
}

describe('M4.5 sparse interpersonal graph foundation', () => {
  it('is deterministic and initializes only explicit family/household facts', () => {
    const input: readonly InterpersonalPersonInput[] = [
      { id: 1, alive: true, birthTick: -200, parentIds: [], householdId: 1 },
      { id: 2, alive: true, birthTick: -200, parentIds: [], householdId: 1 },
      { id: 3, alive: true, birthTick: -10, parentIds: [1, 2], householdId: 1 },
    ];
    const first = createInitialInterpersonalState([1, 2, 3, 4], TICK, input);
    expect(interpersonalDto(first)).toStrictEqual(
      interpersonalDto(createInitialInterpersonalState([1, 2, 3, 4], TICK, input)),
    );
    expect(first.active).toStrictEqual([]);
    expect(parentIdsFor(first, 3)).toStrictEqual([1, 2]);
    expect(first.familyBonds.every((bond) => bond.formedEventId === 0)).toBe(true);
  });

  it('migrates changed legacy contacts in the lower-canonical-id tie order only', () => {
    const state = migrateLegacyInterpersonalState([1, 2, 3, 4], TICK, people(4), [
      { firstPersonId: 3, secondPersonId: 4, affinity: 51 },
      { firstPersonId: 2, secondPersonId: 4, affinity: 51 },
      { firstPersonId: 1, secondPersonId: 4, affinity: 51 },
      { firstPersonId: 1, secondPersonId: 2, affinity: 50, trust: 50 },
    ]);
    expect(state.active.map((edge) => [edge.firstPersonId, edge.secondPersonId])).toStrictEqual([
      [1, 4],
      [2, 4],
      [3, 4],
    ]);
    expect(
      state.active.every(
        (edge) => edge.kind === 'legacy-contact' && edge.sharedEvents.length === 0,
      ),
    ).toBe(true);
  });

  it('derives direct sibling and extended kin only from parent bonds', () => {
    const state = createInitialInterpersonalState([1, 2, 3, 4], TICK, [
      { id: 1, alive: true, birthTick: -100, parentIds: [], householdId: 1 },
      { id: 2, alive: true, birthTick: -100, parentIds: [], householdId: 1 },
      { id: 3, alive: true, birthTick: -20, parentIds: [1, 2], householdId: 1 },
      { id: 4, alive: true, birthTick: -20, parentIds: [1, 2], householdId: 1 },
      { id: 5, alive: true, birthTick: -5, parentIds: [3], householdId: 2 },
      { id: 6, alive: true, birthTick: -5, parentIds: [4], householdId: 3 },
    ]);
    expect(isSibling(state, 3, 4)).toBe(true);
    expect(siblingIdsFor(state, 3)).toStrictEqual([4]);
    expect(isExtendedKin(state, 5, 6)).toBe(true);
    expect(isProhibitedPartnerKin(state, 5, 6)).toBe(true);
  });

  it('enforces shared-event, active/archive retention, and partner protection', () => {
    const events = retainSharedEventReferences(
      Array.from({ length: 20 }, (_, index) => ({
        eventId: index + 1,
        importance: 1,
        tick: index,
      })),
    );
    expect(events).toHaveLength(MAX_SHARED_EVENTS_PER_RELATIONSHIP);
    expect(events.map((event) => event.eventId)).toStrictEqual(
      Array.from({ length: 16 }, (_, i) => 20 - i),
    );
    const population = people(52);
    let state = createInitialInterpersonalState([1, 2, 3, 4], TICK, population);
    state = admitActiveRelationship(state, population, relationship(1, 1, 2, 'partner'));
    for (let id = 3; id <= 51; id += 1)
      state = admitActiveRelationship(state, population, relationship(id - 1, 1, id));
    expect(findActiveRelationship(state, 1, 2)?.kind).toBe('partner');
    expect(
      state.active.filter((edge) => edge.firstPersonId === 1 || edge.secondPersonId === 1),
    ).toHaveLength(MAX_ACTIVE_RELATIONSHIPS_PER_PERSON);
    expect(
      state.archived.filter((edge) => edge.firstPersonId === 1 || edge.secondPersonId === 1),
    ).toHaveLength(MAX_ARCHIVED_RELATIONSHIPS_PER_PERSON);
  });

  it('synchronizes factual people, parentage, and household transitions', () => {
    const initial = createInitialInterpersonalState([1, 2, 3, 4], TICK, people(2));
    const updated = synchronizeInterpersonalPeople(
      initial,
      TICK + 10,
      [
        { ...people(2)[0]!, householdId: 2 },
        people(2)[1]!,
        { id: 3, alive: true, birthTick: TICK + 5, parentIds: [1, 2], householdId: 2 },
      ],
      'child-arrival',
    );
    expect(parentIdsFor(updated, 3)).toStrictEqual([1, 2]);
    expect(
      updated.householdHistories.find((history) => history.personId === 1)?.intervals,
    ).toHaveLength(2);
    expect(
      updated.householdHistories.find((history) => history.personId === 3)?.intervals[0],
    ).toMatchObject({
      reason: 'child-arrival',
      householdId: 2,
    });
  });

  it('rejects invalid close ancestry, household history, and child-arrival evidence', () => {
    expect(() => canonicalPair(1, 1)).toThrow(/same person/i);
    expect(() =>
      createInitialInterpersonalState([1, 2, 3, 4], TICK, [
        { id: 1, alive: true, birthTick: -1, parentIds: [2], householdId: 1 },
        { id: 2, alive: true, birthTick: -1, parentIds: [1], householdId: 1 },
      ]),
    ).toThrow(/cycle/i);
    const history: PersonHouseholdHistory = {
      personId: 1,
      prefix: null,
      intervals: Array.from({ length: MAX_HOUSEHOLD_INTERVALS_PER_PERSON }, (_, index) => ({
        householdId: index + 1,
        startTick: index * 2,
        endTick: index * 2 + 1,
        provenance: 'recorded-household-event' as const,
        reason: 'join' as const,
      })),
    };
    expect(
      appendHouseholdMembershipInterval(history, {
        householdId: 17,
        startTick: 32,
        endTick: null,
        provenance: 'recorded-household-event',
        reason: 'join',
      }).prefix?.intervalCount,
    ).toBe(1);
    const population = people(3).map((person) =>
      person.id === 3 ? { ...person, birthTick: TICK } : person,
    );
    let state = createInitialInterpersonalState([1, 2, 3, 4], TICK, population);
    state = admitActiveRelationship(state, population, relationship(1, 1, 2, 'partner'));
    const validArrival = {
      childId: 3,
      tick: TICK,
      eventId: 1,
      eligibilityEventId: 0,
      policy: 'pair-bond' as const,
      cultureId: 1,
      householdId: 1,
      guardianIds: [1, 2],
      guardianBirthTicks: [-100, -100],
      guardianHouseholdIdsAtArrival: [1, 1],
      guardianHouseholdMembershipStartTicksAtArrival: [TICK, TICK],
      partnerRelationshipId: 1,
      partnerKindAtArrival: 'partner' as const,
      minimumPartnerTrustAtArrival: 60,
      minimumPartnerCommitmentAtArrival: 60,
      selectionScoreAtArrival: 170,
    };
    expect(() => assertChildArrivalRecord(validArrival, state, population)).not.toThrow();
    expect(() =>
      assertChildArrivalRecord(
        validArrival,
        { ...state, active: [{ ...state.active[0]!, kind: 'close-friend' }] },
        population,
      ),
    ).toThrow(/pair-bond relationship evidence/i);
    expect(() =>
      assertChildArrivalRecord(
        validArrival,
        {
          ...state,
          tick: TICK + 1,
          active: [{ ...state.active[0]!, kind: 'close-friend' }],
        },
        population,
      ),
    ).not.toThrow();
    const preArrivalPopulation = population.slice(0, 2);
    let preArrivalState = createInitialInterpersonalState([1, 2, 3, 4], TICK, preArrivalPopulation);
    preArrivalState = admitActiveRelationship(
      preArrivalState,
      preArrivalPopulation,
      relationship(1, 1, 2, 'partner'),
    );
    const movedPopulation = [
      { ...preArrivalPopulation[0]!, householdId: 2 },
      preArrivalPopulation[1]!,
      { ...population[2]!, birthTick: TICK + 1 },
    ];
    const movedAtArrivalTick = synchronizeInterpersonalPeople(
      preArrivalState,
      TICK + 1,
      movedPopulation,
      'child-arrival',
    );
    expect(() =>
      assertChildArrivalRecord(
        { ...validArrival, tick: TICK + 1 },
        movedAtArrivalTick,
        movedPopulation,
      ),
    ).toThrow(/historical household evidence/i);
    expect(() =>
      assertInterpersonalInvariants(
        { ...state, active: [{ ...state.active[0]!, secondPersonId: 99 }] },
        population,
      ),
    ).toThrow(/pair/i);
  });

  it('uses bounded per-arrival membership proof after household intervals are compacted', () => {
    let population = people(3).map((person) =>
      person.id === 3 ? { ...person, birthTick: TICK, parentIds: [1, 2] } : person,
    );
    let state = createInitialInterpersonalState([1, 2, 3, 4], TICK, population);
    state = admitActiveRelationship(state, population, relationship(1, 1, 2, 'partner'));
    for (let index = 1; index <= MAX_HOUSEHOLD_INTERVALS_PER_PERSON + 1; index += 1) {
      population = population.map((person) =>
        person.id === 1 ? { ...person, householdId: index + 1 } : person,
      );
      state = synchronizeInterpersonalPeople(state, TICK + index, population, 'join');
    }
    expect(state.householdHistories.get(1)?.prefix?.intervalCount).toBeGreaterThan(0);
    const recordedArrival = {
      childId: 3,
      tick: TICK,
      eventId: 1,
      eligibilityEventId: 2,
      policy: 'pair-bond' as const,
      cultureId: 1,
      householdId: 1,
      guardianIds: [1, 2],
      guardianBirthTicks: [-100, -100],
      guardianHouseholdIdsAtArrival: [1, 1],
      guardianHouseholdMembershipStartTicksAtArrival: [TICK, TICK],
      partnerRelationshipId: 1,
      partnerKindAtArrival: 'partner' as const,
      minimumPartnerTrustAtArrival: 60,
      minimumPartnerCommitmentAtArrival: 60,
      selectionScoreAtArrival: 170,
    };
    const withArrival = { ...state, childArrivals: [recordedArrival] };
    expect(() => assertInterpersonalInvariants(withArrival, population)).not.toThrow();
    expect(() =>
      assertInterpersonalInvariants(
        {
          ...withArrival,
          childArrivals: [{ ...recordedArrival, guardianHouseholdIdsAtArrival: [99, 1] }],
        },
        population,
      ),
    ).toThrow(/historical household evidence/i);
  });
});
