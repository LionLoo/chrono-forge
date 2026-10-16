import {
  AGENT_ACTION_CODES,
  STRUCTURE_KIND_CODES,
  STRUCTURE_STATE_CODES,
  WORKER_PROTOCOL_VERSION,
  projectionTransferables,
  validateUiToWorkerMessage,
} from '../../src/protocol';
import { deriveXoshiro128State } from '../../src/simulation/random';
import {
  admitActiveRelationship,
  createInitialInterpersonalState,
  type ActiveRelationship,
} from '../../src/simulation/relationships';
import {
  MAX_ACTIVE_CIVILIZATIONS,
  MAX_ACTIVE_CONFLICTS,
  MAX_ACTIVE_ROUTES,
  MAX_ACTIVE_SETTLEMENTS,
  MAX_DIPLOMACY_PAIRS,
  MAX_HISTORICAL_COMMUNITIES,
  MAX_PROJECTED_RESIDENCIES,
  MAX_ROUTE_CONFLICT_SUMMARIES,
  MAX_RUINS,
} from '../../src/simulation/civilizations';
import { appendWorldEvent, createInitialWorld, stepWorld } from '../../src/simulation/world';
import {
  projectRelationshipEventPage,
  projectRelationshipPage,
  projectWorldFrame,
} from '../../src/workers/simulation-runtime';

describe('versioned worker protocol', () => {
  it('creates a detached, transfer-ready projection from dense world tiles', () => {
    const state = createInitialWorld([1, 2, 3, 4], { width: 4, height: 3, chunkSize: 2 });
    const frame = projectWorldFrame(state);

    expect(frame.version).toBe(WORKER_PROTOCOL_VERSION);
    expect(frame.width).toBe(4);
    expect(frame.height).toBe(3);
    expect(frame.tick).toBe(0);
    expect(frame.biome).not.toBe(state.tiles.biome);
    expect(frame.biome).toStrictEqual(state.tiles.biome);
    expect(frame.resource[0]).toBe(
      Math.min(
        65_535,
        state.tiles.freshWater[0]! +
          state.tiles.food[0]! +
          state.tiles.timber[0]! +
          state.tiles.stone[0]! +
          state.tiles.metal[0]!,
      ),
    );
    expect(frame.agentIds).toStrictEqual(new Uint32Array([1, 2, 3, 4, 5, 6]));
    expect(frame.agentTiles).toHaveLength(frame.agentIds.length);
    expect(frame.agentHealth).toHaveLength(frame.agentIds.length);
    expect(frame.agentActions).toStrictEqual(
      new Uint8Array([
        AGENT_ACTION_CODES.idle,
        AGENT_ACTION_CODES.idle,
        AGENT_ACTION_CODES.idle,
        AGENT_ACTION_CODES.idle,
        AGENT_ACTION_CODES.idle,
        AGENT_ACTION_CODES.idle,
      ]),
    );
    expect(frame.structureIds).toHaveLength(0);
    expect(frame.structureTiles).toHaveLength(frame.structureIds.length);
    expect(frame.structureKinds).toHaveLength(frame.structureIds.length);
    expect(frame.structureStates).toHaveLength(frame.structureIds.length);
    expect(frame.structureProgress).toHaveLength(frame.structureIds.length);
    expect(frame.structureCondition).toHaveLength(frame.structureIds.length);
    expect(frame.settlementSummary).toStrictEqual({
      population: 6,
      food: 48,
      water: 48,
      timber: 25,
      stone: 5,
      operationalStructures: 0,
      shelterCapacity: 0,
      activeConstruction: 0,
    });
    expect(frame.society.dashboard).toMatchObject({
      population: 6,
      households: 3,
      government: 'council',
    });
    expect(frame.society.people.map((person) => person.id)).toStrictEqual([1, 2, 3, 4, 5, 6]);
    expect('relationships' in frame.society).toBe(false);
    expect(frame.society.cultures).toHaveLength(2);
    expect(frame.society.cultures.map((culture) => culture.familyPolicy)).toStrictEqual([
      'pair-bond',
      'communal-guardianship',
    ]);
    expect(frame.society.timeline).toStrictEqual([
      { id: 1, tick: 0, summary: 'The founding world formed.' },
      { id: 2, tick: 0, summary: '6 named founders established the first settlement.' },
    ]);
    expect(frame.society.timelineOffset).toBe(0);
    expect(frame.society.timelineTotal).toBe(2);
    expect(frame.development).toMatchObject({
      researchFocusId: null,
      recoveredCrisisCount: 0,
      activeCrises: [],
      operationCount: 0,
    });
    expect(
      frame.development.knowledge
        .filter((record) => record.status === 'known')
        .map((record) => record.id),
    ).toStrictEqual(['foraging-lore', 'shelter-craft', 'water-lore']);
    expect(frame.civilizations.operationCount).toBe(state.civilizations.operationCount);
    expect(frame.civilizations.settlements).toStrictEqual(
      state.civilizations.settlements.map((settlement) => ({
        ...settlement,
        reserves: { ...settlement.reserves },
        territoryHistory: settlement.territoryHistory.map((history) => ({ ...history })),
      })),
    );
    expect(frame.civilizations.civilizations).toStrictEqual(
      state.civilizations.civilizations.map((civilization) => ({
        ...civilization,
        memberSettlementIds: [...civilization.memberSettlementIds],
      })),
    );
    expect(frame.civilizations.residencies).toStrictEqual(state.civilizations.residencies);
    expect(frame.civilizations.activeResidencyCount).toBe(state.civilizations.residencies.length);
    expect(frame.civilizations.historicalResidencyCount).toBe(0);
    expect(frame.civilizations).toMatchObject({
      diplomacy: [],
      routes: [],
      conflicts: [],
      ruins: [],
    });
    expect(frame.civilizations.tileOwners).not.toBe(state.civilizations.tileOwners);
    expect(frame.civilizations.tileOwners).toStrictEqual(
      new Uint32Array(state.civilizations.tileOwners),
    );
    expect(frame.space).toMatchObject({
      tick: 0,
      operationCount: 0,
      offworldPopulation: 0,
      programs: [],
      spacecraft: [],
      missions: [],
      colonies: [],
      cargoTransfers: [],
      communications: [],
      aliens: [],
      relations: [],
    });
    expect(frame.space.bodies).toHaveLength(1);
    expect(frame.space.bodies[0]).toMatchObject({ id: 1, kind: 'home' });
    expect(projectionTransferables(frame)).toStrictEqual([
      frame.biome.buffer,
      frame.resource.buffer,
      frame.habitability.buffer,
      frame.hazard.buffer,
      frame.agentIds.buffer,
      frame.agentTiles.buffer,
      frame.agentHealth.buffer,
      frame.agentActions.buffer,
      frame.structureIds.buffer,
      frame.structureTiles.buffer,
      frame.structureKinds.buffer,
      frame.structureStates.buffer,
      frame.structureProgress.buffer,
      frame.structureCondition.buffer,
      frame.civilizations.tileOwners.buffer,
    ]);
  });

  it('copies a bounded, stable-ID-sorted M6 inspection projection', () => {
    const state = stepWorld(
      createInitialWorld([7, 11, 13, 17], { societyYearTicks: 5_000 }),
      25_000,
    );
    const projection = projectWorldFrame(state).civilizations;
    const ids = <T extends { readonly id: number }>(records: readonly T[]): readonly number[] =>
      records.map((record) => record.id);
    const expectStableIds = <T extends { readonly id: number }>(records: readonly T[]): void =>
      expect(ids(records)).toStrictEqual([...ids(records)].sort((left, right) => left - right));

    expectStableIds(projection.settlements);
    expectStableIds(projection.civilizations);
    expectStableIds(projection.residencies);
    expectStableIds(projection.diplomacy);
    expectStableIds(projection.routes);
    expectStableIds(projection.conflicts);
    expectStableIds(projection.ruins);
    expect(
      projection.settlements.filter((settlement) => settlement.status === 'active'),
    ).toHaveLength(
      Math.min(
        MAX_ACTIVE_SETTLEMENTS,
        state.civilizations.settlements.filter((settlement) => settlement.status === 'active')
          .length,
      ),
    );
    expect(
      projection.civilizations.filter((civilization) => civilization.endedTick === null),
    ).toHaveLength(
      Math.min(
        MAX_ACTIVE_CIVILIZATIONS,
        state.civilizations.civilizations.filter((civilization) => civilization.endedTick === null)
          .length,
      ),
    );
    expect(
      projection.settlements.filter((settlement) => settlement.status !== 'active').length +
        projection.civilizations.filter((civilization) => civilization.endedTick !== null).length,
    ).toBeLessThanOrEqual(MAX_HISTORICAL_COMMUNITIES);
    expect(projection.diplomacy).toHaveLength(
      Math.min(MAX_DIPLOMACY_PAIRS, state.civilizations.diplomacy.length),
    );
    expect(
      projection.routes.filter((route) => route.status !== 'ended').length,
    ).toBeLessThanOrEqual(MAX_ACTIVE_ROUTES);
    expect(
      projection.routes.filter((route) => route.status === 'ended').length +
        projection.conflicts.filter((conflict) => conflict.status === 'resolved').length,
    ).toBeLessThanOrEqual(MAX_ROUTE_CONFLICT_SUMMARIES);
    expect(
      projection.conflicts.filter((conflict) => conflict.status === 'active').length,
    ).toBeLessThanOrEqual(MAX_ACTIVE_CONFLICTS);
    expect(projection.ruins).toHaveLength(Math.min(MAX_RUINS, state.civilizations.ruins.length));
    expect(projection.residencies).toHaveLength(
      Math.min(
        MAX_PROJECTED_RESIDENCIES,
        state.civilizations.residencies.filter((residency) => residency.endedTick === null).length,
      ),
    );
    expect(projection.residencies.every((residency) => residency.endedTick === null)).toBe(true);
    expect(projection.activeResidencyCount).toBe(
      state.civilizations.residencies.filter((residency) => residency.endedTick === null).length,
    );
    expect(projection.historicalResidencyCount).toBe(
      state.civilizations.residencies.filter((residency) => residency.endedTick !== null).length,
    );
    expect(projection.tileOwners).toStrictEqual(new Uint32Array(state.civilizations.tileOwners));

    const residency = state.civilizations.residencies.find(
      (entry) => entry.subjectKind === 'household',
    )!;
    const capped = projectWorldFrame({
      ...state,
      civilizations: {
        ...state.civilizations,
        nextEntityId: 10_002,
        residencies: [
          { ...residency, id: 10_001, endedTick: 0 },
          ...Array.from({ length: MAX_PROJECTED_RESIDENCIES + 1 }, (_, index) => ({
            ...residency,
            id: 10_000 - index,
            subjectId: MAX_PROJECTED_RESIDENCIES + 1 - index,
            endedTick: null,
          })),
        ],
      },
    }).civilizations;
    expect(capped.residencies).toHaveLength(MAX_PROJECTED_RESIDENCIES);
    expect(capped.residencies.map((entry) => entry.id)).toStrictEqual(
      Array.from({ length: MAX_PROJECTED_RESIDENCIES }, (_, index) => 9_872 + index),
    );
    expect(capped.activeResidencyCount).toBe(MAX_PROJECTED_RESIDENCIES + 1);
    expect(capped.historicalResidencyCount).toBe(1);
  });

  it('maps construction strings to stable codes and rejects out-of-range projection values', () => {
    const state = createInitialWorld([1, 2, 3, 4], { width: 4, height: 3, chunkSize: 2 });
    const constructionFrame = projectWorldFrame(stepWorld(state, 100));
    expect(constructionFrame.structureIds).toStrictEqual(new Uint32Array([1]));
    expect(constructionFrame.structureKinds).toStrictEqual(
      new Uint8Array([STRUCTURE_KIND_CODES.shelter]),
    );
    expect(constructionFrame.structureStates).toStrictEqual(
      new Uint8Array([STRUCTURE_STATE_CODES.planned]),
    );
    expect(constructionFrame.structureProgress).toStrictEqual(new Uint16Array([0]));
    expect(constructionFrame.structureCondition).toStrictEqual(new Uint16Array([1_000]));
    expect(constructionFrame.settlementSummary.activeConstruction).toBe(1);

    const firstAgent = state.civilization.agents[0]!;
    const invalid = {
      ...state,
      civilization: {
        ...state.civilization,
        agents: [{ ...firstAgent, health: 101 }, ...state.civilization.agents.slice(1)],
      },
    };
    expect(() => projectWorldFrame(invalid)).toThrow('Agent health must be an integer');
  });

  it('projects sparse relationships with only event-log-resolved factual history', () => {
    const initial = createInitialWorld([1, 2, 3, 4], { width: 4, height: 3, chunkSize: 2 });
    const first = initial.civilization.society.people[0]!;
    const second = initial.civilization.society.people[1]!;
    const withSource = appendWorldEvent(initial, 'friendship-formed', 0, {
      subjectKind: 'person',
      subjectId: first.id,
      targetKind: 'person',
      targetId: second.id,
      summary: `${first.name} and ${second.name} formed a friendship.`,
    });
    const inputs = withSource.civilization.society.people.map((person) => ({
      id: person.id,
      alive: person.alive,
      birthTick: person.birthTick,
      parentIds: person.parentIds,
      householdId: person.householdId,
    }));
    const relationship: ActiveRelationship = {
      id: 1,
      firstPersonId: first.id,
      secondPersonId: second.id,
      firstRole: 'peer',
      secondRole: 'peer',
      kind: 'friend',
      formedTick: 0,
      changedTick: 0,
      lastInteractionTick: 0,
      observedSinceTick: 0,
      trend: 'improving',
      firstToSecond: { affinity: 82, trust: 77, closeness: 63, commitment: 0, grievance: 3 },
      secondToFirst: { affinity: 78, trust: 74, closeness: 59, commitment: 0, grievance: 4 },
      sharedEvents: [{ eventId: withSource.nextEventId - 1, importance: 2, tick: 0 }],
      rng: deriveXoshiro128State(withSource.seed, 'projection-relationship'),
      legacySocietyCounters: null,
    };
    const interpersonal = admitActiveRelationship(
      createInitialInterpersonalState(withSource.seed, 0, inputs),
      inputs,
      relationship,
    );
    const state = {
      ...withSource,
      civilization: {
        ...withSource.civilization,
        society: { ...withSource.civilization.society, interpersonal },
      },
    };

    expect('relationships' in projectWorldFrame(state).society).toBe(false);
    expect(projectRelationshipPage(state, first.id, 0).relationships).toStrictEqual([
      {
        id: 'social:1',
        category: 'social',
        status: 'active',
        kind: 'friend',
        firstPersonId: first.id,
        secondPersonId: second.id,
        firstRole: 'peer',
        secondRole: 'peer',
        trend: 'improving',
        formedTick: 0,
        changedTick: 0,
        endedTick: null,
        firstToSecond: { affinity: 82, trust: 77, closeness: 63, commitment: 0, grievance: 3 },
        secondToFirst: { affinity: 78, trust: 74, closeness: 59, commitment: 0, grievance: 4 },
        sharedEventTotal: 1,
        sharedEvents: [
          {
            eventId: withSource.nextEventId - 1,
            importance: 2,
            tick: 0,
            summary: `${first.name} and ${second.name} formed a friendship.`,
          },
        ],
      },
    ]);
  });

  it('pages every retained shared relationship event instead of hiding events after the first eight', () => {
    const initial = createInitialWorld([41, 43, 47, 53], { width: 4, height: 3, chunkSize: 2 });
    const first = initial.civilization.society.people[0]!;
    const second = initial.civilization.society.people[1]!;
    let withSources = initial;
    const sharedEvents: ActiveRelationship['sharedEvents'][number][] = [];
    for (let index = 0; index < 16; index += 1) {
      withSources = appendWorldEvent(withSources, 'resource-shared', 0, {
        subjectKind: 'person',
        subjectId: first.id,
        targetKind: 'person',
        targetId: second.id,
        summary: `${first.name} shared factual resource event ${index + 1} with ${second.name}.`,
      });
      sharedEvents.push({ eventId: withSources.nextEventId - 1, importance: 2, tick: 0 });
    }
    const inputs = withSources.civilization.society.people.map((person) => ({
      id: person.id,
      alive: person.alive,
      birthTick: person.birthTick,
      parentIds: person.parentIds,
      householdId: person.householdId,
    }));
    const relationship: ActiveRelationship = {
      id: 1,
      firstPersonId: first.id,
      secondPersonId: second.id,
      firstRole: 'peer',
      secondRole: 'peer',
      kind: 'close-friend',
      formedTick: 0,
      changedTick: 0,
      lastInteractionTick: 0,
      observedSinceTick: 0,
      trend: 'stable',
      firstToSecond: { affinity: 80, trust: 80, closeness: 80, commitment: 0, grievance: 0 },
      secondToFirst: { affinity: 80, trust: 80, closeness: 80, commitment: 0, grievance: 0 },
      sharedEvents,
      rng: deriveXoshiro128State(withSources.seed, 'paged-relationship-events'),
      legacySocietyCounters: null,
    };
    const interpersonal = admitActiveRelationship(
      createInitialInterpersonalState(withSources.seed, 0, inputs),
      inputs,
      relationship,
    );
    const state = {
      ...withSources,
      civilization: {
        ...withSources.civilization,
        society: { ...withSources.civilization.society, interpersonal },
      },
    };

    const relationshipPage = projectRelationshipPage(state, first.id, 0);
    const firstEventPage = projectRelationshipEventPage(state, first.id, 'social:1', 0);
    const secondEventPage = projectRelationshipEventPage(state, first.id, 'social:1', 8);
    expect(relationshipPage.relationships[0]).toMatchObject({ sharedEventTotal: 16 });
    expect(firstEventPage).toMatchObject({ offset: 0, total: 16 });
    expect(secondEventPage).toMatchObject({ offset: 8, total: 16 });
    expect(firstEventPage.events).toHaveLength(8);
    expect(secondEventPage.events).toHaveLength(8);
    expect(secondEventPage.events.map((event) => event.eventId)).not.toStrictEqual(
      firstEventPage.events.map((event) => event.eventId),
    );
  });

  it('projects exact child-arrival policy evidence for deliberate person inspection', () => {
    const state = stepWorld(
      createInitialWorld([19, 23, 29, 31], { societyYearTicks: 5_000 }),
      120_000,
    );
    const arrival = state.civilization.society.interpersonal.childArrivals[0]!;
    const person = projectWorldFrame(state).society.people.find(
      (candidate) => candidate.id === arrival.childId,
    );

    expect(person?.childArrival).toStrictEqual({
      tick: arrival.tick,
      eventId: arrival.eventId,
      eligibilityEventId: arrival.eligibilityEventId,
      policy: arrival.policy,
      householdId: arrival.householdId,
      guardianIds: arrival.guardianIds,
      partnerRelationshipId: arrival.partnerRelationshipId,
      partnerKindAtArrival: arrival.partnerKindAtArrival,
      minimumPartnerTrustAtArrival: arrival.minimumPartnerTrustAtArrival,
      minimumPartnerCommitmentAtArrival: arrival.minimumPartnerCommitmentAtArrival,
      selectionScoreAtArrival: arrival.selectionScoreAtArrival,
    });
  }, 20_000);

  it('projects an event-backed guardian bond without rejecting its factual formation source', () => {
    const initial = createInitialWorld([3, 5, 7, 11], { width: 4, height: 3, chunkSize: 2 });
    const guardian = initial.civilization.society.people[0]!;
    const child = initial.civilization.society.people[1]!;
    const withSource = appendWorldEvent(initial, 'guardianship-formed', 0, {
      subjectKind: 'person',
      subjectId: guardian.id,
      targetKind: 'person',
      targetId: child.id,
      summary: `${guardian.name} became ${child.name}'s guardian.`,
    });
    const eventId = withSource.nextEventId - 1;
    const interpersonal = {
      ...withSource.civilization.society.interpersonal,
      familyBonds: [
        {
          parentId: guardian.id,
          adultId: guardian.id,
          childId: child.id,
          kind: 'guardian' as const,
          provenance: 'recorded-guardianship' as const,
          stateProvenance: 'recorded' as const,
          formedEventId: eventId,
          formedTick: 0,
          changedTick: 0,
          lastInteractionTick: 0,
          trend: 'improving' as const,
          parentToChild: {
            affinity: 60,
            trust: 60,
            closeness: 50,
            commitment: 70,
            grievance: 0,
          },
          childToParent: {
            affinity: 60,
            trust: 60,
            closeness: 50,
            commitment: 70,
            grievance: 0,
          },
          sharedEvents: [{ eventId, importance: 3, tick: 0 }],
        },
      ],
    };
    const state = {
      ...withSource,
      civilization: {
        ...withSource.civilization,
        society: { ...withSource.civilization.society, interpersonal },
      },
    };

    const projected = projectRelationshipPage(state, guardian.id, 0).relationships.find(
      (relationship) => relationship.id === `family:guardian:${guardian.id}:${child.id}`,
    );
    expect(projected).toMatchObject({
      kind: 'guardian',
      firstRole: 'guardian',
      secondRole: 'child',
    });
    expect(projected?.sharedEvents[0]?.eventId).toBe(eventId);
    expect(projected?.sharedEvents[0]?.summary).toMatch(/guardian/);
  });

  it('validates relationship page requests and bounds stable, clamped responses to eight rows', () => {
    expect(
      validateUiToWorkerMessage({
        type: 'requestRelationshipPage',
        protocolVersion: WORKER_PROTOCOL_VERSION,
        requestId: 'relationship-page',
        personId: 1,
        offset: 0,
      }),
    ).toMatchObject({ kind: 'valid' });
    expect(
      validateUiToWorkerMessage({
        type: 'requestRelationshipEventPage',
        protocolVersion: WORKER_PROTOCOL_VERSION,
        requestId: 'relationship-event-page',
        personId: 1,
        relationshipId: 'social:1',
        offset: 8,
      }),
    ).toMatchObject({ kind: 'valid' });
    for (const invalid of [
      { personId: 0, offset: 0 },
      { personId: 1, offset: -1 },
      { personId: 1.5, offset: 0 },
      { personId: 1, offset: Number.POSITIVE_INFINITY },
    ])
      expect(
        validateUiToWorkerMessage({
          type: 'requestRelationshipPage',
          protocolVersion: WORKER_PROTOCOL_VERSION,
          requestId: 'invalid-relationship-page',
          ...invalid,
        }),
      ).toMatchObject({ kind: 'invalid' });
    expect(
      validateUiToWorkerMessage({
        type: 'requestRelationshipEventPage',
        protocolVersion: WORKER_PROTOCOL_VERSION,
        requestId: 'invalid-relationship-event-page',
        personId: 1,
        relationshipId: '',
        offset: 0,
      }),
    ).toMatchObject({ kind: 'invalid' });
  });

  it('validates the bounded focus-checkpoint baseline without accepting future event IDs', () => {
    expect(
      validateUiToWorkerMessage({
        type: 'requestFocusCheckpoint',
        protocolVersion: WORKER_PROTOCOL_VERSION,
        requestId: 'focus-checkpoint-start',
        baselineEventId: null,
      }),
    ).toMatchObject({ kind: 'valid' });
    expect(
      validateUiToWorkerMessage({
        type: 'requestFocusCheckpoint',
        protocolVersion: WORKER_PROTOCOL_VERSION,
        requestId: 'focus-checkpoint-progress',
        baselineEventId: 2,
      }),
    ).toMatchObject({ kind: 'valid' });
    for (const baselineEventId of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '2']) {
      expect(
        validateUiToWorkerMessage({
          type: 'requestFocusCheckpoint',
          protocolVersion: WORKER_PROTOCOL_VERSION,
          requestId: 'invalid-focus-checkpoint',
          baselineEventId,
        }),
      ).toMatchObject({ kind: 'invalid' });
    }
  });

  it('validates a fresh-world snapshot request with an explicit deterministic seed and config', () => {
    expect(
      validateUiToWorkerMessage({
        type: 'requestFreshWorldSnapshot',
        protocolVersion: WORKER_PROTOCOL_VERSION,
        requestId: 'fresh-world',
        seed: [101, 202, 303, 404],
        config: { width: 12, height: 8, chunkSize: 4, societyYearTicks: 5_000 },
      }),
    ).toStrictEqual({
      kind: 'valid',
      message: {
        type: 'requestFreshWorldSnapshot',
        protocolVersion: WORKER_PROTOCOL_VERSION,
        requestId: 'fresh-world',
        seed: [101, 202, 303, 404],
        config: { width: 12, height: 8, chunkSize: 4, societyYearTicks: 5_000 },
      },
    });

    for (const request of [
      { seed: [1, 2, 3] },
      { seed: [1, 2, 3, -1] },
      { seed: [1, 2, 3, 0x1_0000_0000] },
      { seed: [1, 2, 3, 4], config: { width: 0 } },
      { seed: [1, 2, 3, 4], config: { societyYearTicks: 7_500 } },
    ]) {
      expect(
        validateUiToWorkerMessage({
          type: 'requestFreshWorldSnapshot',
          protocolVersion: WORKER_PROTOCOL_VERSION,
          requestId: 'invalid-fresh-world',
          ...request,
        }),
      ).toMatchObject({ kind: 'invalid' });
    }
  });

  it('accepts only the closed typed M5 intervention command surface', () => {
    const valid = validateUiToWorkerMessage({
      type: 'queueCommand',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'weather',
      command: {
        kind: 'intervention',
        payload: {
          interventionKind: 'weather',
          intensity: 25,
          polarity: 'challenging',
          targetTileIndex: 3,
        },
      },
    });
    expect(valid).toMatchObject({ kind: 'valid' });

    for (const command of [
      { kind: 'focus-session', payload: {} },
      {
        kind: 'intervention',
        payload: {
          interventionKind: 'meteor-impact',
          intensity: 25,
          polarity: 'challenging',
          targetTileIndex: 3,
        },
      },
      {
        kind: 'intervention',
        payload: {
          interventionKind: 'weather',
          intensity: 0,
          polarity: 'challenging',
          targetTileIndex: 3,
        },
      },
    ])
      expect(
        validateUiToWorkerMessage({
          type: 'queueCommand',
          protocolVersion: WORKER_PROTOCOL_VERSION,
          requestId: 'invalid-command',
          command,
        }),
      ).toMatchObject({ kind: 'invalid' });
  });

  it('uses family/salience/stable-id order and never places every relationship edge on a frame', () => {
    const initial = createInitialWorld([13, 17, 19, 23], { width: 4, height: 3, chunkSize: 2 });
    const active = Array.from({ length: 9 }, (_, index): ActiveRelationship => ({
      id: index + 1,
      firstPersonId: 1,
      secondPersonId: index + 2,
      firstRole: 'peer',
      secondRole: 'peer',
      kind: 'friend',
      formedTick: 0,
      changedTick: 0,
      lastInteractionTick: 0,
      observedSinceTick: 0,
      trend: 'stable',
      firstToSecond: { affinity: 60, trust: 60, closeness: 10, commitment: 0, grievance: 0 },
      secondToFirst: { affinity: 60, trust: 60, closeness: 10, commitment: 0, grievance: 0 },
      sharedEvents: [],
      rng: deriveXoshiro128State(initial.seed, `page-${index}`),
      legacySocietyCounters: null,
    }));
    const state = {
      ...initial,
      civilization: {
        ...initial.civilization,
        society: {
          ...initial.civilization.society,
          interpersonal: { ...initial.civilization.society.interpersonal, active },
        },
      },
    };

    const page = projectRelationshipPage(state, 1, 999);
    expect(page).toMatchObject({ personId: 1, offset: 8, total: 9 });
    expect(page.relationships).toHaveLength(1);
    expect(page.relationships.map((relationship) => relationship.id)).toStrictEqual(['social:9']);
    expect(projectRelationshipPage(state, 1, 0).relationships).toHaveLength(8);
  });
});
