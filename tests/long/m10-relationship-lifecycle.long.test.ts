import { describe, expect, it } from 'vitest';

import { hashCanonicalJson } from '../../src/simulation/canonical';
import { deserializeWorldSnapshot, serializeWorldSnapshot } from '../../src/simulation/persistence';
import {
  childArrivalEligibilityEventMatches,
  childArrivalEligibilityEvidenceMatchesRecord,
  findActiveRelationship,
  MAX_ACTIVE_RELATIONSHIPS_PER_PERSON,
  MAX_ARCHIVED_RELATIONSHIPS_PER_PERSON,
  MAX_HOUSEHOLD_INTERVALS_PER_PERSON,
  MAX_SHARED_EVENTS_PER_RELATIONSHIP,
} from '../../src/simulation/relationships';
import {
  advanceSociety,
  assertSocietyInvariants,
  attachSocietyBiographyEventIds,
  createInitialSociety,
  MAX_BIOGRAPHY_EVENT_IDS,
  societyDto,
  type SocietyAuthoritativeEvent,
  type SocietyPersonObservation,
  type SocietyState,
} from '../../src/simulation/society';
import {
  applyRecordedSupplyShortage,
  assertWorldInvariants,
  createInitialWorld,
  hashWorldState,
  stepWorld,
  type WorldEvent,
  type WorldState,
} from '../../src/simulation/world';
import { M45_SCENARIOS, m45HorizonTicks } from '../fixtures/m45-scenarios';
import {
  M10_RELATIONSHIP_LIFECYCLE_SCENARIO,
  M10_WORLD_RELATIONSHIP_LIFECYCLE_SCENARIO,
  type M10RelationshipTransitionBaseline,
} from '../fixtures/m10-relationship-lifecycle';

interface ControlledSocietyRun {
  readonly society: SocietyState;
  readonly repeatableCheckpoints: Readonly<{
    pressured: SocietyState;
    estrangementReconciled: SocietyState;
    rivalryPending: SocietyState;
  }>;
  readonly history: readonly SocietyAuthoritativeEvent[];
}

function observations(state?: SocietyState): readonly SocietyPersonObservation[] {
  const scenario = M10_RELATIONSHIP_LIFECYCLE_SCENARIO;
  if (state !== undefined)
    return Object.freeze(
      state.people.map((person) =>
        Object.freeze({
          id: person.id,
          alive: person.alive,
          health: person.health,
          tileIndex: person.tileIndex,
          traits: [45, 55, 65, 75] as const,
          skills: [60, 60, 60, 60] as const,
          occupation: person.role,
          recentEventIds: Object.freeze([]),
        }),
      ),
    );
  return Object.freeze(
    Array.from({ length: scenario.founderCount }, (_, index) => {
      const id = index + 1;
      return Object.freeze({
        id,
        alive: true,
        health: 100,
        tileIndex: 10 + id,
        traits: [45, 55, 65, 75] as const,
        skills: [60, 60, 60, 60] as const,
        occupation: 'generalist',
        recentEventIds: Object.freeze([]),
      });
    }),
  );
}

function runControlledSociety(): ControlledSocietyRun {
  const scenario = M10_RELATIONSHIP_LIFECYCLE_SCENARIO;
  let society = createInitialSociety({
    seed: scenario.seed,
    tick: 0,
    centerTileIndex: 10,
    yearTicks: scenario.yearTicks,
    people: observations(),
  });
  const history: SocietyAuthoritativeEvent[] = [];
  let nextEventId = 1;
  const pulse = (food: number, shelterCapacity: number): void => {
    const tick = society.lastTick + scenario.pulseTicks;
    const result = advanceSociety(society, {
      tick,
      centerTileIndex: 10,
      worldWidth: 8,
      people: observations(society),
      communalStockpile: { food, timber: 200, stone: 200, water: 200 },
      shelterCapacity,
    });
    const sources = Object.freeze(
      result.events.map((draft) =>
        Object.freeze({
          id: nextEventId++,
          tick,
          kind: draft.kind,
          subject: draft.subject,
          target: draft.target,
          summary: draft.summary,
        }),
      ),
    );
    history.push(...sources);
    society = attachSocietyBiographyEventIds(result.society, sources, history);
  };
  const advanceToYear = (year: number, pressured: boolean): void => {
    while (society.lastTick < scenario.yearTicks * year)
      pulse(pressured ? 0 : 200, pressured ? 0 : 64);
  };

  advanceToYear(scenario.warmupYears, false);
  advanceToYear(scenario.warmupYears + scenario.pressureYears, true);
  const pressured = society;
  advanceToYear(scenario.estrangement.reconciliationTick / scenario.yearTicks, false);
  const estrangementReconciled = society;
  advanceToYear(scenario.rivalry.reconciliationTick / scenario.yearTicks - 1, false);
  const rivalryPending = society;
  advanceToYear(scenario.warmupYears + scenario.pressureYears + scenario.recoveryYears, false);

  return Object.freeze({
    society,
    repeatableCheckpoints: Object.freeze({
      pressured,
      estrangementReconciled,
      rivalryPending,
    }),
    history: Object.freeze(history),
  });
}

function eventFor(
  history: readonly SocietyAuthoritativeEvent[],
  eventId: number,
): SocietyAuthoritativeEvent {
  const event = history.find((candidate) => candidate.id === eventId);
  expect(event, `missing authoritative event ${eventId}`).toBeDefined();
  return event!;
}

function expectTransition(
  run: ControlledSocietyRun,
  baseline: M10RelationshipTransitionBaseline,
  adverseKind: 'rivalry-formed' | 'family-estranged',
): void {
  const adverse = eventFor(run.history, baseline.adverseEventId);
  const reconciled = eventFor(run.history, baseline.reconciliationEventId);
  const pair = [baseline.firstPersonId, baseline.secondPersonId];
  expect(adverse).toMatchObject({
    tick: baseline.adverseTick,
    kind: adverseKind,
    subject: { kind: 'person', id: pair[0] },
    target: { kind: 'person', id: pair[1] },
  });
  expect(reconciled).toMatchObject({
    tick: baseline.reconciliationTick,
    kind: 'relationship-reconciled',
    subject: { kind: 'person', id: pair[0] },
    target: { kind: 'person', id: pair[1] },
  });
  expect(reconciled.tick - adverse.tick).toBeGreaterThanOrEqual(
    M10_RELATIONSHIP_LIFECYCLE_SCENARIO.yearTicks * 10,
  );
  expect(Object.isFrozen(adverse)).toBe(true);
  expect(Object.isFrozen(reconciled)).toBe(true);
}

function expectGraphCaps(society: SocietyState): void {
  const interpersonal = society.interpersonal;
  for (const person of society.people) {
    expect(
      interpersonal.active.filter(
        (edge) => edge.firstPersonId === person.id || edge.secondPersonId === person.id,
      ).length,
    ).toBeLessThanOrEqual(MAX_ACTIVE_RELATIONSHIPS_PER_PERSON);
    expect(
      interpersonal.archived.filter(
        (edge) => edge.firstPersonId === person.id || edge.secondPersonId === person.id,
      ).length,
    ).toBeLessThanOrEqual(MAX_ARCHIVED_RELATIONSHIPS_PER_PERSON);
    expect(
      interpersonal.householdHistories.get(person.id)?.intervals.length ?? 0,
    ).toBeLessThanOrEqual(MAX_HOUSEHOLD_INTERVALS_PER_PERSON);
    expect(person.biographyEventIds.length).toBeLessThanOrEqual(MAX_BIOGRAPHY_EVENT_IDS);
  }
  for (const edge of [...interpersonal.active, ...interpersonal.archived])
    expect(edge.sharedEvents.length).toBeLessThanOrEqual(MAX_SHARED_EVENTS_PER_RELATIONSHIP);
}

function expectSourceBackedSocietyBiographies(
  society: SocietyState,
  history: readonly SocietyAuthoritativeEvent[],
): void {
  const sources = new Map(history.map((event) => [event.id, event]));
  for (const person of society.people) {
    for (const eventId of person.biographyEventIds) {
      const source = sources.get(eventId);
      expect(source, `${person.id} biography event ${eventId}`).toBeDefined();
      expect(
        [source!.subject, source!.target].some(
          (reference) => reference.kind === 'person' && reference.id === person.id,
        ),
      ).toBe(true);
    }
  }
}

function expectSourceBackedWorldBiographies(
  worldEvents: readonly WorldEvent[],
  society: SocietyState,
) {
  const sources = new Map(worldEvents.map((event) => [event.id, event]));
  for (const person of society.people) {
    for (const eventId of person.biographyEventIds) {
      const source = sources.get(eventId);
      expect(source, `${person.id} biography event ${eventId}`).toBeDefined();
      expect(
        (source!.subjectKind === 'person' && source!.subjectId === person.id) ||
          (source!.targetKind === 'person' && source!.targetId === person.id),
      ).toBe(true);
    }
  }
}

function createPressuredRelationshipWorld(): WorldState {
  const scenario = M10_WORLD_RELATIONSHIP_LIFECYCLE_SCENARIO;
  let world = stepWorld(
    createInitialWorld(scenario.seed, {
      width: scenario.width,
      height: scenario.height,
      chunkSize: scenario.chunkSize,
      societyYearTicks: scenario.yearTicks,
    }),
    scenario.yearTicks * scenario.warmupYears,
  );
  for (let year = 1; year <= scenario.pressureYears; year += 1) {
    world = stepWorld(world, scenario.yearTicks - 1);
    if (year % scenario.shortageIntervalYears === 0)
      world = applyRecordedSupplyShortage(world, scenario.shortageSeverity);
    world = stepWorld(world, 1);
  }
  return world;
}

describe.sequential('M10 relationship, household, and biography evidence catalogue', () => {
  it('holds factual rivalry and family estrangement until ordinary recovery reconciles them', () => {
    const scenario = M10_RELATIONSHIP_LIFECYCLE_SCENARIO;
    const run = runControlledSociety();
    const repeat = runControlledSociety();
    const { pressured, estrangementReconciled, rivalryPending } = run.repeatableCheckpoints;

    for (const state of [pressured, estrangementReconciled, rivalryPending, run.society])
      expect(() => assertSocietyInvariants(state)).not.toThrow();
    expectTransition(run, scenario.rivalry, 'rivalry-formed');
    expectTransition(run, scenario.estrangement, 'family-estranged');
    expect(
      findActiveRelationship(
        pressured.interpersonal,
        scenario.rivalry.firstPersonId,
        scenario.rivalry.secondPersonId,
      )?.kind,
    ).toBe('rival');
    expect(
      findActiveRelationship(
        rivalryPending.interpersonal,
        scenario.rivalry.firstPersonId,
        scenario.rivalry.secondPersonId,
      )?.kind,
    ).toBe('rival');
    expect(
      findActiveRelationship(
        run.society.interpersonal,
        scenario.rivalry.firstPersonId,
        scenario.rivalry.secondPersonId,
      )?.kind,
    ).toBe('reconciled');
    expect(
      findActiveRelationship(
        pressured.interpersonal,
        scenario.estrangement.firstPersonId,
        scenario.estrangement.secondPersonId,
      )?.kind,
    ).toBe('estranged');
    expect(
      findActiveRelationship(
        estrangementReconciled.interpersonal,
        scenario.estrangement.firstPersonId,
        scenario.estrangement.secondPersonId,
      )?.kind,
    ).toBe('reconciled');

    const familyEvents = run.history.filter(
      (event) =>
        event.subject.id === scenario.estrangement.firstPersonId &&
        event.target.id === scenario.estrangement.secondPersonId &&
        event.kind === 'family-estranged',
    );
    expect(familyEvents).toHaveLength(1);
    for (const baseline of [scenario.rivalry, scenario.estrangement]) {
      const reconciliation = eventFor(run.history, baseline.reconciliationEventId);
      for (const personId of [baseline.firstPersonId, baseline.secondPersonId])
        expect(
          run.society.people
            .find((person) => person.id === personId)
            ?.biographyEventIds.includes(reconciliation.id),
        ).toBe(true);
    }
    for (const eventId of [
      scenario.estrangement.adverseEventId,
      scenario.estrangement.reconciliationEventId,
    ])
      for (const personId of [
        scenario.estrangement.firstPersonId,
        scenario.estrangement.secondPersonId,
      ])
        expect(
          run.society.people
            .find((person) => person.id === personId)
            ?.biographyEventIds.includes(eventId),
        ).toBe(true);

    expectSourceBackedSocietyBiographies(run.society, run.history);
    expectGraphCaps(run.society);
    expect(hashCanonicalJson(JSON.stringify(societyDto(run.society)))).toBe(scenario.expectedHash);
    expect(run.society.interpersonal.operationCount).toBe(scenario.expectedOperations);
    expect(societyDto(repeat.society)).toStrictEqual(societyDto(run.society));
    expect(repeat.history).toStrictEqual(run.history);
  });

  it('reloads a production world while estranged and continues canonically through reconciliation', () => {
    const scenario = M10_WORLD_RELATIONSHIP_LIFECYCLE_SCENARIO;
    const pressured = createPressuredRelationshipWorld();
    const snapshot = serializeWorldSnapshot(pressured);
    const restored = deserializeWorldSnapshot(snapshot);

    expect(() => assertWorldInvariants(pressured)).not.toThrow();
    expect(() => assertWorldInvariants(restored)).not.toThrow();
    expect(hashWorldState(pressured)).toBe(scenario.pressuredHash);
    expect(pressured.civilization.society.interpersonal.operationCount).toBe(
      scenario.pressuredOperations,
    );
    expect(pressured.civilization.society.people.filter((person) => person.alive)).toHaveLength(
      scenario.pressuredLivingPeople,
    );
    expect(serializeWorldSnapshot(restored)).toBe(snapshot);

    const estrangements = pressured.eventLog.filter((event) => event.kind === 'family-estranged');
    expect(estrangements).toHaveLength(scenario.estrangements.length);
    for (const transition of scenario.estrangements)
      expect(
        pressured.eventLog.find((event) => event.id === transition.adverseEventId),
      ).toMatchObject({
        tick: transition.adverseTick,
        kind: 'family-estranged',
        subjectId: transition.firstPersonId,
        targetId: transition.secondPersonId,
      });
    for (const adverse of estrangements) {
      expect(adverse).toMatchObject({
        kind: 'family-estranged',
        subjectKind: 'person',
        targetKind: 'person',
      });
      const firstPersonId = adverse.subjectId;
      const secondPersonId = adverse.targetId;
      expect(
        findActiveRelationship(
          pressured.civilization.society.interpersonal,
          firstPersonId,
          secondPersonId,
        )?.kind,
      ).toBe('estranged');
      expect(
        pressured.eventLog.some(
          (event) =>
            event.kind === 'relationship-reconciled' &&
            ((event.subjectId === firstPersonId && event.targetId === secondPersonId) ||
              (event.subjectId === secondPersonId && event.targetId === firstPersonId)),
        ),
      ).toBe(false);
      for (const personId of [firstPersonId, secondPersonId])
        expect(
          pressured.civilization.society.people
            .find((person) => person.id === personId)
            ?.biographyEventIds.includes(adverse.id),
        ).toBe(true);
    }
    expectSourceBackedWorldBiographies(pressured.eventLog, pressured.civilization.society);
    expectGraphCaps(pressured.civilization.society);

    const direct = stepWorld(pressured, scenario.yearTicks * scenario.recoveryYears);
    const resumed = stepWorld(restored, scenario.yearTicks * scenario.recoveryYears);
    expect(() => assertWorldInvariants(resumed)).not.toThrow();
    expect(serializeWorldSnapshot(resumed)).toBe(serializeWorldSnapshot(direct));
    expect(hashWorldState(resumed)).toBe(scenario.recoveredHash);
    expect(resumed.civilization.society.interpersonal.operationCount).toBe(
      scenario.recoveredOperations,
    );
    expect(resumed.civilization.society.people.filter((person) => person.alive)).toHaveLength(
      scenario.recoveredLivingPeople,
    );
    for (const transition of scenario.estrangements)
      expect(
        resumed.eventLog.find((event) => event.id === transition.reconciliationEventId),
      ).toMatchObject({
        tick: transition.reconciliationTick,
        kind: 'relationship-reconciled',
        subjectId: transition.firstPersonId,
        targetId: transition.secondPersonId,
      });

    for (const adverse of estrangements) {
      const firstPersonId = adverse.subjectId;
      const secondPersonId = adverse.targetId;
      const reconciliation = resumed.eventLog.find(
        (event) =>
          event.kind === 'relationship-reconciled' &&
          event.tick > adverse.tick &&
          ((event.subjectId === firstPersonId && event.targetId === secondPersonId) ||
            (event.subjectId === secondPersonId && event.targetId === firstPersonId)),
      );
      expect(reconciliation).toMatchObject({
        kind: 'relationship-reconciled',
        subjectKind: 'person',
        targetKind: 'person',
      });
      expect(reconciliation!.tick).toBeGreaterThan(adverse.tick);
      const recoveredRelationship = findActiveRelationship(
        resumed.civilization.society.interpersonal,
        firstPersonId,
        secondPersonId,
      );
      expect(['reconciled', 'friend', 'close-friend']).toContain(recoveredRelationship?.kind);
      expect(recoveredRelationship!.changedTick).toBeGreaterThanOrEqual(reconciliation!.tick);
      expect(
        resumed.eventLog.filter(
          (event) =>
            event.kind === 'family-estranged' &&
            ((event.subjectId === firstPersonId && event.targetId === secondPersonId) ||
              (event.subjectId === secondPersonId && event.targetId === firstPersonId)),
        ),
      ).toHaveLength(1);
      for (const personId of [firstPersonId, secondPersonId]) {
        const biography = resumed.civilization.society.people.find(
          (person) => person.id === personId,
        )?.biographyEventIds;
        expect(biography).toContain(adverse.id);
        expect(biography).toContain(reconciliation!.id);
      }
    }
    expectSourceBackedWorldBiographies(resumed.eventLog, resumed.civilization.society);
    expectGraphCaps(resumed.civilization.society);
  }, 60_000);

  it('survives reload with a multi-decade friendship, dynamic family life, and bereavement', () => {
    const scenario = M45_SCENARIOS[0]!;
    const completed = stepWorld(
      createInitialWorld(scenario.seed, { societyYearTicks: scenario.yearTicks }),
      m45HorizonTicks(scenario),
    );
    const snapshot = serializeWorldSnapshot(completed);
    const world = deserializeWorldSnapshot(snapshot);
    const society = world.civilization.society;
    const interpersonal = society.interpersonal;
    const eventsById = new Map(world.eventLog.map((event) => [event.id, event]));

    expect(() => assertWorldInvariants(world)).not.toThrow();
    expect(hashWorldState(world)).toBe(scenario.expectedHash);
    expect(interpersonal.operationCount).toBe(scenario.expectedOperations);
    expect(serializeWorldSnapshot(world)).toBe(snapshot);

    const friendship = findActiveRelationship(interpersonal, 1, 2);
    expect(friendship).toMatchObject({
      id: 1,
      kind: 'close-friend',
      formedTick: 5_000,
      changedTick: 15_000,
      lastInteractionTick: 265_000,
    });
    expect(friendship!.lastInteractionTick - friendship!.formedTick).toBeGreaterThanOrEqual(
      scenario.yearTicks * 20,
    );
    expect(
      world.eventLog.some(
        (event) =>
          event.kind === 'close-friendship-formed' && event.subjectId === 1 && event.targetId === 2,
      ),
    ).toBe(true);
    for (const shared of friendship!.sharedEvents) {
      const source = eventsById.get(shared.eventId);
      expect(source).toMatchObject({
        tick: shared.tick,
        subjectKind: 'person',
        targetKind: 'person',
      });
      expect(new Set([source!.subjectId, source!.targetId])).toStrictEqual(new Set([1, 2]));
    }

    const partnership = world.eventLog.find(
      (event) => event.kind === 'long-term-partnership-formed',
    );
    const householdFormation = world.eventLog.find(
      (event) =>
        event.kind === 'household-formed' &&
        event.tick === partnership?.tick &&
        event.subjectId === partnership.subjectId &&
        event.targetId === partnership.targetId,
    );
    expect(partnership).toMatchObject({
      tick: 35_000,
      kind: 'long-term-partnership-formed',
      subjectKind: 'person',
      targetKind: 'person',
    });
    expect(householdFormation).toMatchObject({
      tick: 35_000,
      kind: 'household-formed',
      amount: 4,
    });
    for (const personId of [partnership!.subjectId, partnership!.targetId]) {
      expect(society.people.find((person) => person.id === personId)?.biographyEventIds).toContain(
        partnership!.id,
      );
      expect(
        interpersonal.householdHistories
          .get(personId)
          ?.intervals.some(
            (interval) =>
              interval.householdId === householdFormation!.amount &&
              interval.startTick === partnership!.tick,
          ),
      ).toBe(true);
    }
    expect(
      world.civilizations.residencies.some(
        (residency) =>
          residency.subjectKind === 'household' &&
          residency.subjectId === householdFormation!.amount &&
          residency.startedTick === householdFormation!.tick,
      ),
    ).toBe(true);

    const widowhood = world.eventLog.find((event) => event.kind === 'partner-widowed');
    const deceased = society.people.find((person) => person.id === widowhood?.subjectId)!;
    const survivor = society.people.find((person) => person.id === widowhood?.targetId)!;
    expect(widowhood).toMatchObject({
      tick: 270_000,
      kind: 'partner-widowed',
      subjectKind: 'person',
      subjectId: deceased.id,
      targetKind: 'person',
      targetId: survivor.id,
    });
    expect(deceased).toMatchObject({ alive: false, deathTick: 270_000 });
    expect(survivor.alive).toBe(true);
    expect(
      world.eventLog.some(
        (event) =>
          event.kind === 'person-died' &&
          event.subjectId === deceased.id &&
          event.tick === widowhood!.tick,
      ),
    ).toBe(true);
    expect(
      world.civilizations.residencies.some(
        (residency) =>
          residency.subjectKind === 'person' &&
          residency.subjectId === deceased.id &&
          residency.endedTick === deceased.deathTick,
      ),
    ).toBe(true);
    for (const person of [deceased, survivor])
      expect(person.biographyEventIds).toContain(widowhood!.id);

    const child = society.people.find(
      (person) =>
        person.alive &&
        person.generation === Math.max(...society.people.map(({ generation }) => generation)),
    )!;
    const arrival = interpersonal.childArrivals.find(
      (candidate) => candidate.childId === child.id,
    )!;
    expect(child).toMatchObject({
      origin: 'birth',
      alive: true,
      generation: 3,
    });
    expect(arrival).toMatchObject({
      tick: child.birthTick,
      policy: 'communal-guardianship',
      householdId: child.householdId,
      guardianIds: child.parentIds,
    });
    expect(child.biographyEventIds).toContain(arrival.eventId);
    expect(
      world.civilizations.residencies.some(
        (residency) =>
          residency.subjectKind === 'person' &&
          residency.subjectId === child.id &&
          residency.startedTick === child.birthTick,
      ),
    ).toBe(true);
    const arrivalEvent = eventsById.get(arrival.eventId)!;
    const eligibilityEvent = eventsById.get(arrival.eligibilityEventId)!;
    expect(arrivalEvent).toMatchObject({
      kind: 'person-born',
      tick: child.birthTick,
      subjectKind: 'person',
      subjectId: child.id,
    });
    expect(
      childArrivalEligibilityEventMatches(arrival, {
        kind: eligibilityEvent.kind,
        subjectKind: eligibilityEvent.subjectKind,
        subjectId: eligibilityEvent.subjectId,
        targetKind: eligibilityEvent.targetKind,
        targetId: eligibilityEvent.targetId,
      }),
    ).toBe(true);
    expect(
      childArrivalEligibilityEvidenceMatchesRecord(
        arrival,
        eligibilityEvent.childArrivalEligibility!,
      ),
    ).toBe(true);
    expect(
      interpersonal.familyBonds
        .filter((bond) => bond.childId === child.id)
        .map((bond) => bond.parentId),
    ).toStrictEqual(arrival.guardianIds);
    const lineage = new Set<number>();
    const pending = [child.id];
    while (pending.length > 0) {
      const personId = pending.pop()!;
      const person = society.people.find((candidate) => candidate.id === personId);
      if (person === undefined || lineage.has(person.id)) continue;
      lineage.add(person.id);
      pending.push(...person.parentIds.filter((id) => id !== 0));
    }
    expect(
      new Set(
        society.people
          .filter((person) => lineage.has(person.id))
          .map((person) => person.generation),
      ),
    ).toEqual(new Set([0, 1, 2, 3]));

    expectSourceBackedWorldBiographies(world.eventLog, society);
    expectGraphCaps(society);
  }, 60_000);
});
