import {
  admitActiveRelationship,
  createInitialInterpersonalState,
  findActiveRelationship,
  interpersonalDto,
  type ActiveRelationship,
  type InterpersonalState,
  type RelationshipKind,
} from '../../src/simulation/relationships';
import {
  applyRelationshipExperience,
  advanceInterpersonalLifecycle,
  relationshipDecisionInfluence,
  selectPreferredRelatedPerson,
  type RelationshipLifecycleInput,
  type RelationshipPersonContext,
} from '../../src/simulation/relationships/lifecycle';

const YEAR = 100;

function people(count = 3, householdId = 1): readonly RelationshipPersonContext[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    alive: true,
    birthTick: -20 * YEAR,
    parentIds: [] as const,
    householdId,
    name: `Person ${index + 1}`,
    cultureId: 1,
    tileIndex: 10 + index,
    traits: [60, 60, 60, 60] as const,
    skills: [60, 60, 60, 60] as const,
    occupation: 'maker',
    recentEventIds: [1] as const,
  }));
}

function input(
  population: readonly RelationshipPersonContext[],
  tick = 0,
  scarcity = 0,
  stability = 100,
): RelationshipLifecycleInput {
  return {
    tick,
    yearTicks: YEAR,
    worldWidth: 20,
    people: population,
    cultures: [{ id: 1, familyPolicy: 'pair-bond', partnershipLimit: 1 }],
    scarcity,
    stability,
  };
}

function edge(
  id: number,
  kind: RelationshipKind,
  values: Partial<ActiveRelationship> = {},
): ActiveRelationship {
  const partner = kind === 'partner' || kind === 'long-term-partner';
  return {
    id,
    firstPersonId: 1,
    secondPersonId: 2,
    firstRole: partner ? 'partner' : 'peer',
    secondRole: partner ? 'partner' : 'peer',
    kind,
    formedTick: 0,
    changedTick: 0,
    lastInteractionTick: 0,
    observedSinceTick: 0,
    trend: 'stable',
    firstToSecond: { affinity: 80, trust: 80, closeness: 45, commitment: 0, grievance: 0 },
    secondToFirst: { affinity: 80, trust: 80, closeness: 45, commitment: 0, grievance: 0 },
    sharedEvents: [],
    rng: [1, 2, 3, id + 4],
    legacySocietyCounters: null,
    ...values,
  };
}

function stateWith(
  population: readonly RelationshipPersonContext[],
  relationship: ActiveRelationship,
): InterpersonalState {
  return admitActiveRelationship(
    createInitialInterpersonalState([11, 12, 13, 14], 0, population),
    population,
    relationship,
  );
}

function at(state: InterpersonalState, tick: number): InterpersonalState {
  return { ...state, tick };
}

describe('M4.5 deterministic relationship lifecycle', () => {
  it('applies bounded factual M5 crisis experiences to the existing sparse bond', () => {
    const population = people(2);
    const initial = stateWith(population, edge(1, 'friend'));
    const assisted = applyRelationshipExperience(initial, population, {
      tick: YEAR,
      firstPersonId: 1,
      secondPersonId: 2,
      kind: 'crisis-assistance',
      amount: 20,
    });
    const changed = findActiveRelationship(assisted, 1, 2)!;

    expect(changed.firstToSecond.trust).toBeGreaterThan(
      findActiveRelationship(initial, 1, 2)!.firstToSecond.trust,
    );
    expect(changed.secondToFirst.closeness).toBeGreaterThan(
      findActiveRelationship(initial, 1, 2)!.secondToFirst.closeness,
    );
    expect(changed.lastInteractionTick).toBe(YEAR);
    expect(changed.trend).toBe('improving');

    const abandoned = applyRelationshipExperience(assisted, population, {
      tick: YEAR * 2,
      firstPersonId: 1,
      secondPersonId: 2,
      kind: 'crisis-abandonment',
      amount: 30,
    });
    expect(findActiveRelationship(abandoned, 1, 2)!.firstToSecond.grievance).toBeGreaterThan(0);
    expect(findActiveRelationship(abandoned, 1, 2)!.trend).toBe('deteriorating');
  });

  it('is repeatable and bounds yearly candidate evaluations without a population pair scan', () => {
    const population = people(160);
    const first = createInitialInterpersonalState([11, 12, 13, 14], 0, population);
    const repeat = createInitialInterpersonalState([11, 12, 13, 14], 0, population);
    const firstResult = advanceInterpersonalLifecycle(first, input(population));
    const repeatResult = advanceInterpersonalLifecycle(repeat, input(population));

    expect(interpersonalDto(firstResult.state)).toStrictEqual(interpersonalDto(repeatResult.state));
    expect(firstResult.events).toStrictEqual(repeatResult.events);
    expect(firstResult.state.operationCount - first.operationCount).toBeLessThanOrEqual(
      population.length * 16,
    );
    expect(firstResult.events.every((event) => event.summary.length <= 160)).toBe(true);
  });

  it('forms and changes friendship, rivalry, reconciliation, and mentorship factually', () => {
    const population = people(2);
    const acquaintance = stateWith(population, edge(1, 'acquaintance'));
    const friendship = advanceInterpersonalLifecycle(acquaintance, input(population));
    expect(friendship.events.some((event) => event.kind === 'friendship-formed')).toBe(true);

    const weakened = stateWith(
      population,
      edge(1, 'friend', {
        firstToSecond: { affinity: 0, trust: 0, closeness: 5, commitment: 0, grievance: 80 },
        secondToFirst: { affinity: 0, trust: 0, closeness: 5, commitment: 0, grievance: 80 },
      }),
    );
    const ended = advanceInterpersonalLifecycle(weakened, input(population));
    expect(ended.events.some((event) => event.kind === 'friendship-ended')).toBe(true);
    expect(ended.state.archived).toHaveLength(1);

    const pressured = stateWith(
      population,
      edge(1, 'acquaintance', {
        firstToSecond: { affinity: 30, trust: 30, closeness: 10, commitment: 0, grievance: 55 },
        secondToFirst: { affinity: 30, trust: 30, closeness: 10, commitment: 0, grievance: 55 },
      }),
    );
    expect(
      advanceInterpersonalLifecycle(pressured, input(population)).events.some(
        (event) => event.kind === 'rivalry-formed',
      ),
    ).toBe(true);

    const rivalry = stateWith(
      population,
      edge(1, 'rival', {
        firstRole: 'adversary',
        secondRole: 'adversary',
        firstToSecond: { affinity: 85, trust: 85, closeness: 50, commitment: 0, grievance: 12 },
        secondToFirst: { affinity: 85, trust: 85, closeness: 50, commitment: 0, grievance: 12 },
      }),
    );
    expect(
      advanceInterpersonalLifecycle(rivalry, input(population)).events.some(
        (event) => event.kind === 'relationship-reconciled',
      ),
    ).toBe(true);

    const kinPeople = [
      { ...population[0]!, id: 1, parentIds: [10] as const },
      { ...population[1]!, id: 2, parentIds: [10] as const },
      { ...population[0]!, id: 10, birthTick: -50 * YEAR, parentIds: [] as const },
    ];
    const estranged = advanceInterpersonalLifecycle(
      stateWith(
        kinPeople,
        edge(1, 'friend', {
          firstToSecond: { affinity: 70, trust: 70, closeness: 40, commitment: 0, grievance: 40 },
          secondToFirst: { affinity: 70, trust: 70, closeness: 40, commitment: 0, grievance: 40 },
        }),
      ),
      input(kinPeople),
    );
    expect(estranged.events.some((event) => event.kind === 'family-estranged')).toBe(true);

    const stillEstranged = advanceInterpersonalLifecycle(
      at(estranged.state, YEAR),
      input(kinPeople, YEAR, 100, 0),
    );
    expect(findActiveRelationship(stillEstranged.state, 1, 2)?.kind).toBe('estranged');
    expect(
      stillEstranged.events.some((event) =>
        ['family-estranged', 'rivalry-formed', 'enmity-formed'].includes(event.kind),
      ),
    ).toBe(false);

    const mentorPeople = [
      { ...population[0]!, skills: [95, 10, 10, 10] as const },
      { ...population[1]!, skills: [10, 10, 10, 10] as const },
    ];
    const mentor = advanceInterpersonalLifecycle(
      stateWith(mentorPeople, edge(1, 'acquaintance')),
      input(mentorPeople),
    );
    expect(mentor.events.some((event) => event.kind === 'mentorship-formed')).toBe(true);
  });

  it('enforces kin and partner limits and supports partnership, separation, and widowhood', () => {
    const population = people(3);
    const committedFriend = edge(1, 'friend', {
      firstToSecond: { affinity: 90, trust: 90, closeness: 60, commitment: 60, grievance: 0 },
      secondToFirst: { affinity: 90, trust: 90, closeness: 60, commitment: 60, grievance: 0 },
    });
    const partnered = advanceInterpersonalLifecycle(
      stateWith(population, committedFriend),
      input(population),
    );
    expect(partnered.events.some((event) => event.kind === 'partnership-formed')).toBe(true);

    const longTerm = advanceInterpersonalLifecycle(
      at(
        stateWith(
          population,
          edge(1, 'partner', {
            firstToSecond: { affinity: 90, trust: 90, closeness: 60, commitment: 70, grievance: 0 },
            secondToFirst: { affinity: 90, trust: 90, closeness: 60, commitment: 70, grievance: 0 },
          }),
        ),
        YEAR * 2,
      ),
      input(population, YEAR * 2),
    );
    expect(longTerm.events.some((event) => event.kind === 'long-term-partnership-formed')).toBe(
      true,
    );

    const separated = advanceInterpersonalLifecycle(
      stateWith(
        population,
        edge(1, 'partner', {
          firstToSecond: { affinity: 20, trust: 20, closeness: 10, commitment: 70, grievance: 70 },
          secondToFirst: { affinity: 20, trust: 20, closeness: 10, commitment: 70, grievance: 70 },
        }),
      ),
      input(population),
    );
    expect(separated.events.some((event) => event.kind === 'partnership-separated')).toBe(true);

    const deadPartnerPeople = [
      { ...population[0]! },
      { ...population[1]!, alive: false },
      population[2]!,
    ];
    const widowed = advanceInterpersonalLifecycle(
      stateWith(deadPartnerPeople, edge(1, 'partner')),
      input(deadPartnerPeople),
    );
    expect(widowed.events.some((event) => event.kind === 'partner-widowed')).toBe(true);

    const kinPeople = [
      { ...population[0]!, id: 1, parentIds: [10] as const },
      { ...population[1]!, id: 2, parentIds: [10] as const },
      { ...population[2]!, id: 10, birthTick: -50 * YEAR, parentIds: [] as const },
    ];
    const kinFriend = advanceInterpersonalLifecycle(
      stateWith(kinPeople, committedFriend),
      input(kinPeople),
    );
    expect(findActiveRelationship(kinFriend.state, 1, 2)?.kind).not.toBe('partner');

    let limited = stateWith(population, edge(1, 'partner'));
    limited = admitActiveRelationship(
      limited,
      population,
      edge(2, 'friend', {
        firstPersonId: 1,
        secondPersonId: 3,
        firstToSecond: { affinity: 90, trust: 90, closeness: 60, commitment: 60, grievance: 0 },
        secondToFirst: { affinity: 90, trust: 90, closeness: 60, commitment: 60, grievance: 0 },
      }),
    );
    const limitChecked = advanceInterpersonalLifecycle(limited, input(population));
    expect(findActiveRelationship(limitChecked.state, 1, 3)?.kind).not.toBe('partner');
  });

  it('keeps a salient relationship alive for twenty years and changes every decision domain', () => {
    const population = people(3);
    let persistent = stateWith(
      population,
      edge(1, 'mentor', { firstRole: 'mentor', secondRole: 'protege' }),
    );
    for (let year = 1; year <= 20; year += 1) {
      persistent = advanceInterpersonalLifecycle(
        at(persistent, year * YEAR),
        input(population, year * YEAR),
      ).state;
    }
    expect(findActiveRelationship(persistent, 1, 2)?.kind).toBe('mentor');

    let influenced = stateWith(
      population,
      edge(1, 'friend', {
        firstToSecond: { affinity: 100, trust: 100, closeness: 100, commitment: 80, grievance: 0 },
        secondToFirst: { affinity: 100, trust: 100, closeness: 100, commitment: 80, grievance: 0 },
      }),
    );
    influenced = admitActiveRelationship(influenced, population, {
      ...edge(2, 'rival', {
        firstPersonId: 1,
        secondPersonId: 3,
        firstRole: 'adversary',
        secondRole: 'adversary',
        firstToSecond: { affinity: 0, trust: 0, closeness: 0, commitment: 0, grievance: 100 },
        secondToFirst: { affinity: 0, trust: 0, closeness: 0, commitment: 0, grievance: 100 },
      }),
    });
    const bases = new Map([
      [2, 100],
      [3, 100],
    ]);
    for (const domain of ['help', 'family', 'migration', 'knowledge', 'politics'] as const) {
      expect(selectPreferredRelatedPerson(influenced, 1, [2, 3], domain, bases)).toBe(2);
      expect(
        relationshipDecisionInfluence(findActiveRelationship(influenced, 1, 2)!, 1, domain),
      ).toBeGreaterThan(0);
    }
    expect(selectPreferredRelatedPerson(influenced, 1, [2, 3], 'conflict', bases)).toBe(3);
    expect(
      relationshipDecisionInfluence(findActiveRelationship(influenced, 1, 3)!, 1, 'conflict'),
    ).toBeGreaterThan(0);
  });
});
