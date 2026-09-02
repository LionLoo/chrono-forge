import { hashCanonicalJson } from '../../src/simulation/canonical';
import {
  deserializeWorldSnapshot,
  migrateWorldSnapshot,
  serializeWorldSnapshot,
  WORLD_SNAPSHOT_FORMAT,
  WORLD_SNAPSHOT_FORMAT_VERSION,
} from '../../src/simulation/persistence';
import {
  canonicalWorldJson,
  createInitialWorld,
  hashWorldState,
  applyWorldIntervention,
  stepWorld,
} from '../../src/simulation/world';
import { ACCELERATED_YEAR_TICKS } from '../../src/simulation/society';
import { interpersonalDto } from '../../src/simulation/relationships';
import { createInitialDevelopment, developmentDto } from '../../src/simulation/development';
import legacyWorldV0 from '../fixtures/saves/world-v0.json';

function legacySnapshot(worldJson: string): string {
  return JSON.stringify({
    checksum: hashCanonicalJson(worldJson),
    engineVersion: 0,
    format: WORLD_SNAPSHOT_FORMAT,
    formatVersion: 0,
    worldJson,
  });
}

function versionOneSnapshot(worldJson: string): string {
  return JSON.stringify({
    checksum: hashCanonicalJson(worldJson),
    contentVersion: 1,
    engineVersion: 1,
    format: WORLD_SNAPSHOT_FORMAT,
    formatVersion: 1,
    payload: JSON.parse(worldJson) as unknown,
  });
}

function versionSixSnapshot(world: ReturnType<typeof createInitialWorld>): string {
  const envelope = JSON.parse(serializeWorldSnapshot(world)) as Record<string, unknown>;
  return JSON.stringify({
    ...envelope,
    contentVersion: 6,
    engineVersion: 6,
    formatVersion: 6,
  });
}

function versionTwoSnapshot(ticks = 15_000): {
  readonly snapshot: string;
  readonly source: ReturnType<typeof stepWorld>;
} {
  const source = stepWorld(createInitialWorld([31, 37, 41, 43]), ticks);
  const envelope = JSON.parse(serializeWorldSnapshot(source)) as {
    payload: Record<string, unknown>;
  };
  const payload = { ...envelope.payload };
  delete payload.civilizations;
  delete payload.development;
  const config = payload.config as Record<string, unknown>;
  payload.config = { chunkSize: config.chunkSize, height: config.height, width: config.width };
  const currentCivilization = payload.civilization as Record<string, unknown>;
  const agents = currentCivilization.agents as Record<string, unknown>[];
  const relationships = agents.flatMap((first, firstIndex) =>
    agents.slice(firstIndex + 1).map((second, secondOffset) => ({
      id: (firstIndex * (2 * agents.length - firstIndex - 1)) / 2 + secondOffset + 1,
      firstAgentId: first.id,
      secondAgentId: second.id,
      affinity: 50,
      trust: 50,
    })),
  );
  const legacyAgents = agents.map((agent) => ({
    ...agent,
    memories: (agent.memories as Record<string, unknown>[]).map((memory) => ({
      id: memory.id,
      eventId: memory.eventId,
      tick: memory.tick,
      kind: memory.kind,
      targetId: memory.targetId,
    })),
  }));
  payload.civilization = {
    agents: legacyAgents,
    centerTileIndex: currentCivilization.centerTileIndex,
    nextAgentId: currentCivilization.nextAgentId,
    nextMemoryId: currentCivilization.nextMemoryId,
    nextRelationshipId: relationships.length + 1,
    nextStructureId: currentCivilization.nextStructureId,
    operationCount: currentCivilization.operationCount,
    pathDemand: currentCivilization.pathDemand,
    relationships,
    resourceDepletion: currentCivilization.resourceDepletion,
    stockpile: currentCivilization.stockpile,
    structures: currentCivilization.structures,
    systemRng: currentCivilization.systemRng,
  };
  payload.eventLog = (payload.eventLog as Record<string, unknown>[]).map((event) => ({
    amount: event.amount,
    id: event.id,
    kind: event.kind,
    subjectId: event.subjectId,
    targetId: event.targetId,
    tick: event.tick,
    tileIndex: event.tileIndex,
  }));
  const payloadJson = JSON.stringify(payload);
  return {
    source,
    snapshot: JSON.stringify({
      checksum: hashCanonicalJson(payloadJson),
      contentVersion: 2,
      engineVersion: 2,
      format: WORLD_SNAPSHOT_FORMAT,
      formatVersion: 2,
      payload,
    }),
  };
}

function versionThreeSnapshot(): string {
  const source = stepWorld(
    createInitialWorld([7, 11, 13, 17], { societyYearTicks: ACCELERATED_YEAR_TICKS }),
    120_000,
  );
  const envelope = JSON.parse(serializeWorldSnapshot(source)) as {
    payload: Record<string, unknown>;
  };
  const payload = { ...envelope.payload };
  delete payload.civilizations;
  delete payload.development;
  payload.eventLog = (payload.eventLog as Record<string, unknown>[]).filter(
    (event) =>
      !['settlement', 'civilization', 'route', 'conflict', 'ruin'].includes(
        event.subjectKind as string,
      ) &&
      !['settlement', 'civilization', 'route', 'conflict', 'ruin'].includes(
        event.targetKind as string,
      ),
  );
  const civilization = payload.civilization as Record<string, unknown>;
  const society = civilization.society as Record<string, unknown>;
  const { interpersonal: _interpersonal, ...legacySocietyBase } = society;
  void _interpersonal;
  const legacySociety = {
    ...legacySocietyBase,
    bonds: [
      {
        firstPersonId: 1,
        secondPersonId: 2,
        cooperation: 72,
        disagreement: 9,
        conflict: 4,
      },
    ],
    cultures: (society.cultures as Record<string, unknown>[]).map((culture) => {
      const {
        familyPolicy: _familyPolicy,
        partnershipLimit: _partnershipLimit,
        ...legacyCulture
      } = culture;
      void _familyPolicy;
      void _partnershipLimit;
      return legacyCulture;
    }),
    households: (society.households as Record<string, unknown>[]).map((household) => {
      const { lastChildArrivalTick: _lastChildArrivalTick, ...legacyHousehold } = household;
      void _lastChildArrivalTick;
      return legacyHousehold;
    }),
  };
  payload.civilization = {
    ...civilization,
    nextRelationshipId: 2,
    relationships: [{ id: 1, firstAgentId: 1, secondAgentId: 2, affinity: 71, trust: 63 }],
    society: legacySociety,
  };
  const payloadJson = JSON.stringify(payload);
  return JSON.stringify({
    checksum: hashCanonicalJson(payloadJson),
    contentVersion: 3,
    engineVersion: 3,
    format: WORLD_SNAPSHOT_FORMAT,
    formatVersion: 3,
    payload,
  });
}

function versionFourSnapshot(ticks = 4321): {
  readonly snapshot: string;
  readonly source: ReturnType<typeof stepWorld>;
} {
  const source = stepWorld(createInitialWorld([23, 29, 31, 37]), ticks);
  const current = JSON.parse(serializeWorldSnapshot(source)) as {
    payload: Record<string, unknown>;
  };
  const payload = { ...current.payload };
  delete payload.civilizations;
  delete payload.development;
  const payloadJson = JSON.stringify(payload);
  return {
    source,
    snapshot: JSON.stringify({
      checksum: hashCanonicalJson(payloadJson),
      contentVersion: 4,
      engineVersion: 4,
      format: WORLD_SNAPSHOT_FORMAT,
      formatVersion: 4,
      payload,
    }),
  };
}

function versionFiveSnapshot(ticks = 4321): {
  readonly snapshot: string;
  readonly source: ReturnType<typeof stepWorld>;
} {
  const source = stepWorld(
    createInitialWorld([41, 43, 47, 53], { societyYearTicks: ACCELERATED_YEAR_TICKS }),
    ticks,
  );
  const current = JSON.parse(serializeWorldSnapshot(source)) as {
    payload: Record<string, unknown>;
  };
  const payload = { ...current.payload };
  delete payload.civilizations;
  const payloadJson = JSON.stringify(payload);
  return {
    source,
    snapshot: JSON.stringify({
      checksum: hashCanonicalJson(payloadJson),
      contentVersion: 5,
      engineVersion: 5,
      format: WORLD_SNAPSHOT_FORMAT,
      formatVersion: 5,
      payload,
    }),
  };
}

describe('versioned world snapshots', () => {
  it('round-trips canonical authority without sharing mutable arrays', () => {
    const original = stepWorld(createInitialWorld([7, 11, 13, 17], { width: 8, height: 6 }), 4321);
    const snapshot = serializeWorldSnapshot(original);
    const loaded = deserializeWorldSnapshot(snapshot);

    expect(JSON.parse(snapshot)).toMatchObject({
      format: WORLD_SNAPSHOT_FORMAT,
      formatVersion: WORLD_SNAPSHOT_FORMAT_VERSION,
    });
    expect(canonicalWorldJson(loaded)).toBe(canonicalWorldJson(original));
    expect(hashWorldState(loaded)).toBe(hashWorldState(original));
    expect(loaded.elevation).not.toBe(original.elevation);
    expect(loaded.tiles.elevation).toBe(loaded.elevation);
  });

  it('round-trips v6 development and civilization authority, including evidence and queued interventions', () => {
    const original = applyWorldIntervention(
      stepWorld(
        createInitialWorld([7, 11, 13, 17], { societyYearTicks: ACCELERATED_YEAR_TICKS }),
        ACCELERATED_YEAR_TICKS,
      ),
      { kind: 'protection', intensity: 12, polarity: 'supportive', targetTileIndex: 0 },
    );
    const snapshot = serializeWorldSnapshot(original);
    const loaded = deserializeWorldSnapshot(snapshot);

    expect(JSON.parse(snapshot)).toMatchObject({
      contentVersion: WORLD_SNAPSHOT_FORMAT_VERSION,
      engineVersion: WORLD_SNAPSHOT_FORMAT_VERSION,
      formatVersion: WORLD_SNAPSHOT_FORMAT_VERSION,
    });
    expect(developmentDto(loaded.development)).toStrictEqual(developmentDto(original.development));
    expect(canonicalWorldJson(loaded)).toBe(canonicalWorldJson(original));
    expect(serializeWorldSnapshot(loaded)).toBe(snapshot);
  });

  it('rejects checksummed malformed v6 development authority', () => {
    const envelope = JSON.parse(serializeWorldSnapshot(createInitialWorld([3, 5, 7, 11]))) as {
      checksum: string;
      payload: { development: { knowledge: Record<string, unknown>[] } };
    };
    delete envelope.payload.development.knowledge[0]!.evidence;
    envelope.checksum = hashCanonicalJson(JSON.stringify(envelope.payload));

    expect(() => deserializeWorldSnapshot(JSON.stringify(envelope))).toThrow(
      /development knowledge 0.*(?:fields|keys)/i,
    );
  });

  it('migrates v4 to the saved-tick M5/M6 founding baselines without inventing history', () => {
    const { snapshot, source } = versionFourSnapshot();
    const migrated = migrateWorldSnapshot(snapshot);
    const loaded = deserializeWorldSnapshot(migrated);

    expect(JSON.parse(migrated)).toMatchObject({
      contentVersion: WORLD_SNAPSHOT_FORMAT_VERSION,
      engineVersion: WORLD_SNAPSHOT_FORMAT_VERSION,
      formatVersion: WORLD_SNAPSHOT_FORMAT_VERSION,
    });
    expect(developmentDto(loaded.development)).toStrictEqual(
      developmentDto(createInitialDevelopment(source.seed, source.tick)),
    );
    expect(loaded.eventLog).toStrictEqual(source.eventLog);
    expect(loaded.civilizations.settlements[0]).toMatchObject({
      foundedTick: source.tick,
      provenance: 'v5-migration',
    });
    expect(loaded.civilizations.routes).toStrictEqual([]);
    expect(loaded.civilizations.conflicts).toStrictEqual([]);
    expect(serializeWorldSnapshot(loaded)).toBe(migrated);
  });

  it('migrates v5 to one saved-tick M6 baseline without inventing events or M6 history', () => {
    const { snapshot, source } = versionFiveSnapshot();
    const migrated = migrateWorldSnapshot(snapshot);
    const loaded = deserializeWorldSnapshot(migrated);

    expect(JSON.parse(migrated)).toMatchObject({
      contentVersion: WORLD_SNAPSHOT_FORMAT_VERSION,
      engineVersion: WORLD_SNAPSHOT_FORMAT_VERSION,
      formatVersion: WORLD_SNAPSHOT_FORMAT_VERSION,
    });
    expect(loaded.eventLog).toStrictEqual(source.eventLog);
    expect(loaded.civilizations).toMatchObject({ tick: source.tick, operationCount: 0 });
    expect(loaded.civilizations.settlements).toHaveLength(1);
    expect(loaded.civilizations.civilizations).toHaveLength(1);
    expect(loaded.civilizations.settlements[0]).toMatchObject({
      foundedTick: source.tick,
      provenance: 'v5-migration',
      territoryHistory: [],
    });
    expect(loaded.civilizations.civilizations[0]).toMatchObject({
      foundedTick: source.tick,
      provenance: 'v5-migration',
    });
    expect(loaded.civilizations.diplomacy).toStrictEqual([]);
    expect(loaded.civilizations.routes).toStrictEqual([]);
    expect(loaded.civilizations.conflicts).toStrictEqual([]);
    expect(loaded.civilizations.ruins).toStrictEqual([]);
    expect(serializeWorldSnapshot(loaded)).toBe(migrated);
  });

  it('round-trips a lived relationship graph and every source reference canonically', () => {
    const original = stepWorld(
      createInitialWorld([19, 23, 29, 31], { societyYearTicks: ACCELERATED_YEAR_TICKS }),
      120_000,
    );
    expect(original.civilization.society.interpersonal.active.length).toBeGreaterThan(0);
    const snapshot = serializeWorldSnapshot(original);
    const loaded = deserializeWorldSnapshot(snapshot);

    expect(canonicalWorldJson(loaded)).toBe(canonicalWorldJson(original));
    expect(interpersonalDto(loaded.civilization.society.interpersonal)).toStrictEqual(
      interpersonalDto(original.civilization.society.interpersonal),
    );
    expect(serializeWorldSnapshot(loaded)).toBe(snapshot);
  });

  it('rejects checksummed relationship authority with false arrival or event identity', () => {
    const original = stepWorld(
      createInitialWorld([19, 23, 29, 31], { societyYearTicks: ACCELERATED_YEAR_TICKS }),
      120_000,
    );
    const sourceEnvelope = JSON.parse(serializeWorldSnapshot(original)) as {
      checksum: string;
      payload: Record<string, unknown>;
    };
    const rejectMutation = (
      mutate: (payload: Record<string, unknown>) => void,
      expected: RegExp,
    ): void => {
      const envelope = structuredClone(sourceEnvelope);
      mutate(envelope.payload);
      envelope.checksum = hashCanonicalJson(JSON.stringify(envelope.payload));
      expect(() => deserializeWorldSnapshot(JSON.stringify(envelope))).toThrow(expected);
    };
    const interpersonalFor = (payload: Record<string, unknown>): Record<string, unknown> =>
      ((payload.civilization as Record<string, unknown>).society as Record<string, unknown>)
        .interpersonal as Record<string, unknown>;

    expect(original.civilization.society.interpersonal.childArrivals.length).toBeGreaterThan(0);
    rejectMutation((payload) => {
      const arrivals = interpersonalFor(payload).childArrivals as Record<string, unknown>[];
      const pairBond = arrivals.find((arrival) => arrival.policy === 'pair-bond');
      expect(pairBond).toBeDefined();
      const prior = Number(pairBond!.minimumPartnerTrustAtArrival);
      pairBond!.minimumPartnerTrustAtArrival = prior === 100 ? 99 : prior + 1;
    }, /child arrival eligibility (?:source event|event identity)/i);

    rejectMutation((payload) => {
      const arrivals = interpersonalFor(payload).childArrivals as Record<string, unknown>[];
      const pairBond = arrivals.find((arrival) => arrival.policy === 'pair-bond');
      expect(pairBond).toBeDefined();
      pairBond!.partnerKindAtArrival =
        pairBond!.partnerKindAtArrival === 'partner' ? 'long-term-partner' : 'partner';
    }, /child arrival eligibility (?:source event|event identity)/i);

    rejectMutation((payload) => {
      const arrivals = interpersonalFor(payload).childArrivals as Record<string, unknown>[];
      const pairBond = arrivals.find((arrival) => arrival.policy === 'pair-bond');
      expect(pairBond).toBeDefined();
      pairBond!.eligibilityEventId = pairBond!.eventId;
    }, /child arrival eligibility (?:source event|event identity)/i);

    rejectMutation((payload) => {
      const arrivals = interpersonalFor(payload).childArrivals as Record<string, unknown>[];
      const arrival = arrivals[0]!;
      const events = payload.eventLog as Record<string, unknown>[];
      const eligibility = events.find((event) => event.id === arrival.eligibilityEventId)!;
      eligibility.amount = Number(arrival.householdId) + 1;
    }, /child arrival eligibility (?:source event|event identity)/i);

    rejectMutation((payload) => {
      const arrivals = interpersonalFor(payload).childArrivals as Record<string, unknown>[];
      const pairBond = arrivals.find((arrival) => arrival.policy === 'pair-bond')!;
      const events = payload.eventLog as Record<string, unknown>[];
      const eligibility = events.find((event) => event.id === pairBond.eligibilityEventId)!;
      const evidence = eligibility.childArrivalEligibility as Record<string, unknown>;
      evidence.partnerRelationshipId = Number(evidence.partnerRelationshipId) + 1;
    }, /child arrival eligibility (?:source event|event identity)/i);

    rejectMutation((payload) => {
      const interpersonal = interpersonalFor(payload);
      const relationships = [
        ...(interpersonal.active as Record<string, unknown>[]),
        ...(interpersonal.archived as Record<string, unknown>[]),
      ];
      const relationship = relationships.find(
        (candidate) => (candidate.sharedEvents as unknown[]).length > 0,
      );
      expect(relationship).toBeDefined();
      const reference = (relationship!.sharedEvents as Record<string, unknown>[])[0]!;
      const events = payload.eventLog as Record<string, unknown>[];
      const unrelated = events.find(
        (event) =>
          event.tick === reference.tick &&
          event.id !== reference.eventId &&
          (event.subjectKind !== 'person' ||
            event.targetKind !== 'person' ||
            ![relationship!.firstPersonId, relationship!.secondPersonId].includes(
              event.subjectId,
            ) ||
            ![relationship!.firstPersonId, relationship!.secondPersonId].includes(event.targetId)),
      );
      expect(unrelated).toBeDefined();
      reference.eventId = unrelated!.id;
    }, /relationship event identity/i);

    rejectMutation((payload) => {
      const arrivals = interpersonalFor(payload).childArrivals as Record<string, unknown>[];
      const arrival = arrivals[0]!;
      const events = payload.eventLog as Record<string, unknown>[];
      const unrelated = events.find(
        (event) => event.tick === arrival.tick && event.id !== arrival.eventId,
      );
      expect(unrelated).toBeDefined();
      arrival.eventId = unrelated!.id;
    }, /(family bond|child arrival) event identity/i);
  });

  it('migrates real v3 social authority conservatively without inventing relationship history', () => {
    const migratedSnapshot = migrateWorldSnapshot(versionThreeSnapshot());
    const loaded = deserializeWorldSnapshot(migratedSnapshot);
    const interpersonal = loaded.civilization.society.interpersonal;

    expect(JSON.parse(migratedSnapshot)).toMatchObject({
      formatVersion: WORLD_SNAPSHOT_FORMAT_VERSION,
    });
    expect(interpersonal.active).toHaveLength(1);
    expect(interpersonal.active[0]).toMatchObject({
      firstPersonId: 1,
      secondPersonId: 2,
      kind: 'legacy-contact',
      observedSinceTick: loaded.tick,
      firstToSecond: { affinity: 71, trust: 63, closeness: 72, grievance: 4 },
      legacySocietyCounters: { cooperation: 72, disagreement: 9, conflict: 4 },
    });
    expect(interpersonal.active[0]?.sharedEvents).toStrictEqual([]);
    expect(interpersonal.archived).toStrictEqual([]);
    expect(interpersonal.lifetime).toStrictEqual([]);
    expect(interpersonal.childArrivals).toStrictEqual([]);
    expect(
      interpersonal.familyBonds.every(
        (bond) =>
          bond.provenance === 'migrated-parentage' &&
          bond.stateProvenance === 'migrated-unknown' &&
          bond.formedTick === null &&
          bond.formedEventId === 0,
      ),
    ).toBe(true);
    expect(
      interpersonal.householdHistories.every(
        (history) =>
          history.intervals.length === 1 &&
          history.intervals[0]?.startTick === null &&
          history.intervals[0]?.provenance === 'migrated-current-household',
      ),
    ).toBe(true);
    expect(serializeWorldSnapshot(loaded)).toBe(migratedSnapshot);
  });

  it.each([
    ['v0', JSON.stringify(legacyWorldV0)],
    ['v1', versionOneSnapshot(legacyWorldV0.worldJson)],
  ])(
    'migrates the committed legacy %s envelope to a founded v5 civilization',
    (_version, legacy) => {
      const migrated = migrateWorldSnapshot(legacy);
      const loaded = deserializeWorldSnapshot(migrated);

      expect(JSON.parse(migrated)).toMatchObject({ formatVersion: WORLD_SNAPSHOT_FORMAT_VERSION });
      expect(loaded.tick).toBe(0);
      expect(loaded.civilization.agents).toHaveLength(6);
      expect(loaded.eventLog.map((event) => event.kind)).toStrictEqual([
        'world-generated',
        'founders-arrived',
      ]);
      expect(loaded.eventLog[1]).toMatchObject({
        id: 2,
        tick: 0,
        subjectId: 0,
        targetId: 0,
        amount: 6,
      });
      expect(loaded.civilization.agents.map((agent) => agent.memories)).toStrictEqual(
        Array.from({ length: 6 }, (_, index) => [
          {
            id: index + 1,
            eventId: 2,
            tick: 0,
            kind: 'founders-arrived',
            summary: '6 named founders established the first settlement.',
            targetKind: 'world',
            targetId: 0,
          },
        ]),
      );
      const migratedEnvelope = JSON.parse(migrated) as { payload: unknown };
      expect(canonicalWorldJson(loaded)).toBe(JSON.stringify(migratedEnvelope.payload));
      expect(migrateWorldSnapshot(migrated)).toBe(migrated);
    },
  );

  it('founds a legacy civilization at a very large saved tick without inventing history', () => {
    const legacyPayload = JSON.parse(legacyWorldV0.worldJson) as { tick: number };
    legacyPayload.tick = Number.MAX_SAFE_INTEGER;

    const loaded = deserializeWorldSnapshot(
      migrateWorldSnapshot(legacySnapshot(JSON.stringify(legacyPayload))),
    );

    expect(loaded.tick).toBe(Number.MAX_SAFE_INTEGER);
    expect(loaded.eventLog.at(-1)).toMatchObject({
      tick: Number.MAX_SAFE_INTEGER,
      kind: 'founders-arrived',
      amount: 6,
    });
    expect(loaded.civilization.operationCount).toBe(0);
    expect(loaded.civilization.structures).toStrictEqual([]);
    expect(
      loaded.civilization.agents.every((agent) =>
        Object.values(agent.activity).every((total) => total === 0),
      ),
    ).toBe(true);
    expect(loaded.civilization.agents.map((agent) => agent.memories)).toStrictEqual(
      Array.from({ length: 6 }, (_, index) => [
        {
          id: index + 1,
          eventId: 2,
          tick: Number.MAX_SAFE_INTEGER,
          kind: 'founders-arrived',
          summary: '6 named founders established the first settlement.',
          targetKind: 'world',
          targetId: 0,
        },
      ]),
    );
  });

  it('migrates a canonical v2 fixture without changing event identities or agent names', () => {
    const { snapshot, source } = versionTwoSnapshot();
    const loaded = deserializeWorldSnapshot(migrateWorldSnapshot(snapshot));

    expect(JSON.parse(migrateWorldSnapshot(snapshot))).toMatchObject({
      formatVersion: WORLD_SNAPSHOT_FORMAT_VERSION,
    });
    expect(loaded.eventLog.map((event) => [event.id, event.kind])).toStrictEqual(
      source.eventLog.map((event) => [event.id, event.kind]),
    );
    expect(loaded.eventLog).toHaveLength(source.eventLog.length);
    expect(loaded.civilization.agents.map((agent) => agent.name)).toStrictEqual(
      source.civilization.agents.map((agent) => agent.name),
    );
    expect(loaded.civilization.society.people.map((person) => person.name)).toStrictEqual(
      source.civilization.agents.map((agent) => agent.name),
    );
  });

  it('migrates a canonical v6 envelope to the current version without changing authority', () => {
    const source = stepWorld(createInitialWorld([31, 37, 41, 43]), 15_000);
    const migrated = migrateWorldSnapshot(versionSixSnapshot(source));

    expect(JSON.parse(migrated)).toMatchObject({
      contentVersion: WORLD_SNAPSHOT_FORMAT_VERSION,
      engineVersion: WORLD_SNAPSHOT_FORMAT_VERSION,
      formatVersion: WORLD_SNAPSHOT_FORMAT_VERSION,
    });
    expect(hashWorldState(deserializeWorldSnapshot(migrated))).toBe(hashWorldState(source));
    expect(migrateWorldSnapshot(migrated)).toBe(migrated);
  });

  it('continues a v2 save created between society boundaries', () => {
    const { snapshot } = versionTwoSnapshot(15_050);
    const loaded = deserializeWorldSnapshot(migrateWorldSnapshot(snapshot));

    expect(loaded.civilization.society.lastTick).toBe(15_050);
    expect(() => stepWorld(loaded, 950)).not.toThrow();
    expect(stepWorld(loaded, 950).civilization.society.lastTick).toBe(16_000);
  });

  it.each([
    [
      'invalid parent reference',
      (payload: Record<string, unknown>) => {
        const people = (
          (payload.civilization as Record<string, unknown>).society as Record<string, unknown>
        ).people as Record<string, unknown>[];
        people[5]!.generation = 1;
        people[5]!.parentIds = [1, 999];
        people[5]!.birthTick = -1_800_000;
      },
      /parent/i,
    ],
    [
      'invalid household reference',
      (payload: Record<string, unknown>) => {
        const people = (
          (payload.civilization as Record<string, unknown>).society as Record<string, unknown>
        ).people as Record<string, unknown>[];
        people[0]!.householdId = 999;
      },
      /household/i,
    ],
    [
      'invalid group member reference',
      (payload: Record<string, unknown>) => {
        const groups = (
          (payload.civilization as Record<string, unknown>).society as Record<string, unknown>
        ).groups as Record<string, unknown>[];
        groups[0]!.memberIds = [999];
      },
      /group member/i,
    ],
    [
      'invalid institution reference',
      (payload: Record<string, unknown>) => {
        const institution = (
          (payload.civilization as Record<string, unknown>).society as Record<string, unknown>
        ).institution as Record<string, unknown>;
        institution.leaderId = 999;
      },
      /institution/i,
    ],
    [
      'invalid offer reference',
      (payload: Record<string, unknown>) => {
        const society = (payload.civilization as Record<string, unknown>).society as Record<
          string,
          unknown
        >;
        society.offers = [
          {
            amount: 1,
            buyerHouseholdId: 999,
            fulfilledAmount: 0,
            id: 1,
            kind: 'meal',
            price: 1,
            sellerHouseholdId: 1,
            transportDemand: 0,
          },
        ];
        society.nextOfferId = 2;
      },
      /offer household/i,
    ],
    [
      'invalid biography event reference',
      (payload: Record<string, unknown>) => {
        const people = (
          (payload.civilization as Record<string, unknown>).society as Record<string, unknown>
        ).people as Record<string, unknown>[];
        people[0]!.biographyEventIds = [999];
      },
      /biography/i,
    ],
    [
      'invalid pending biography structure reference',
      (payload: Record<string, unknown>) => {
        const society = (payload.civilization as Record<string, unknown>).society as Record<
          string,
          unknown
        >;
        society.pendingBiographyFacts = [
          {
            kind: 'recorded-structure',
            personId: 1,
            source: { id: 1, kind: 'person' },
            summary: 'Recorded an impossible structure.',
            target: { id: 999, kind: 'structure' },
          },
        ];
      },
      /unknown structure/i,
    ],
    [
      'invalid typed event reference',
      (payload: Record<string, unknown>) => {
        const events = payload.eventLog as Record<string, unknown>[];
        events[0]!.targetKind = 'person';
        events[0]!.targetId = 999;
      },
      /event target/i,
    ],
    [
      'unsorted society IDs',
      (payload: Record<string, unknown>) => {
        const cultures = (
          (payload.civilization as Record<string, unknown>).society as Record<string, unknown>
        ).cultures as Record<string, unknown>[];
        const first = cultures[0]!;
        cultures[0] = cultures[1]!;
        cultures[1] = first;
      },
      /sorted/i,
    ],
    [
      'invalid economy enum',
      (payload: Record<string, unknown>) => {
        const people = (
          (payload.civilization as Record<string, unknown>).society as Record<string, unknown>
        ).people as Record<string, unknown>[];
        people[0]!.role = 'invalid';
      },
      /role/i,
    ],
    [
      'invalid calendar',
      (payload: Record<string, unknown>) => {
        (payload.config as Record<string, unknown>).societyYearTicks = 17;
      },
      /calendar/i,
    ],
    [
      'invalid factual summary',
      (payload: Record<string, unknown>) => {
        (payload.eventLog as Record<string, unknown>[])[0]!.summary = '';
      },
      /summary/i,
    ],
  ])('rejects checksummed v3 authority with %s', (_label, mutate, expectedError) => {
    const record = JSON.parse(serializeWorldSnapshot(createInitialWorld([3, 5, 7, 11]))) as {
      checksum: string;
      payload: Record<string, unknown>;
    };
    mutate(record.payload);
    record.checksum = hashCanonicalJson(JSON.stringify(record.payload));
    expect(() => deserializeWorldSnapshot(JSON.stringify(record))).toThrow(expectedError);
  });

  it('rejects checksum corruption, noncanonical payloads, invalid fields, and future versions', () => {
    const snapshot = serializeWorldSnapshot(
      createInitialWorld([1, 2, 3, 4], { width: 3, height: 2 }),
    );
    const corrupt = JSON.parse(snapshot) as {
      checksum: string;
      formatVersion: number;
      payload: { biome: number[]; tick: number };
    };
    corrupt.payload.tick = 9;
    expect(() => deserializeWorldSnapshot(JSON.stringify(corrupt))).toThrow(/checksum/i);

    const invalid = JSON.parse(snapshot) as typeof corrupt;
    invalid.payload.biome[0] = 99;
    invalid.checksum = hashCanonicalJson(JSON.stringify(invalid.payload));
    expect(() => deserializeWorldSnapshot(JSON.stringify(invalid))).toThrow(/biome/i);

    const reordered = JSON.parse(snapshot) as Record<string, unknown>;
    const payload = reordered.payload as Record<string, unknown>;
    const reorderedPayload = { tick: payload.tick, ...payload };
    reordered.payload = reorderedPayload;
    reordered.checksum = hashCanonicalJson(JSON.stringify(reorderedPayload));
    expect(() => deserializeWorldSnapshot(JSON.stringify(reordered))).toThrow(/canonical/i);

    const future = JSON.parse(snapshot) as typeof corrupt;
    future.formatVersion = 99;
    expect(() => deserializeWorldSnapshot(JSON.stringify(future))).toThrow(/newer/i);

    const invalidCivilization = JSON.parse(snapshot) as {
      checksum: string;
      payload: { civilization: { agents: { rng: number[] }[] } };
    };
    invalidCivilization.payload.civilization.agents[0]!.rng = [0, 0, 0, 0];
    invalidCivilization.checksum = hashCanonicalJson(JSON.stringify(invalidCivilization.payload));
    expect(() => deserializeWorldSnapshot(JSON.stringify(invalidCivilization))).toThrow(/rng/i);

    const invalidPathDemand = JSON.parse(snapshot) as {
      checksum: string;
      payload: { civilization: { pathDemand: number[] } };
    };
    invalidPathDemand.payload.civilization.pathDemand.pop();
    invalidPathDemand.checksum = hashCanonicalJson(JSON.stringify(invalidPathDemand.payload));
    expect(() => deserializeWorldSnapshot(JSON.stringify(invalidPathDemand))).toThrow(
      /pathDemand/i,
    );

    const invalidCivilizations = JSON.parse(snapshot) as {
      checksum: string;
      payload: { civilizations: { settlements: Record<string, unknown>[] } };
    };
    delete invalidCivilizations.payload.civilizations.settlements[0]!.provenance;
    invalidCivilizations.checksum = hashCanonicalJson(JSON.stringify(invalidCivilizations.payload));
    expect(() => deserializeWorldSnapshot(JSON.stringify(invalidCivilizations))).toThrow(
      /snapshot settlement 0.*(?:fields|keys)/i,
    );
  });

  it('rejects checksummed v2 snapshots with impossible life, social, or construction state', () => {
    const { snapshot } = versionTwoSnapshot();

    const invalidLife = JSON.parse(snapshot) as {
      checksum: string;
      payload: { civilization: { agents: { action: string; alive: boolean }[] } };
    };
    invalidLife.payload.civilization.agents[0]!.alive = false;
    invalidLife.payload.civilization.agents[0]!.action = 'idle';
    invalidLife.checksum = hashCanonicalJson(JSON.stringify(invalidLife.payload));
    expect(() => deserializeWorldSnapshot(JSON.stringify(invalidLife))).toThrow(/life and health/i);

    const duplicateSocialPair = JSON.parse(snapshot) as {
      checksum: string;
      payload: {
        civilization: {
          relationships: { firstAgentId: number; secondAgentId: number }[];
        };
      };
    };
    const firstPair = duplicateSocialPair.payload.civilization.relationships[0]!;
    const secondPair = duplicateSocialPair.payload.civilization.relationships[1]!;
    secondPair.firstAgentId = firstPair.firstAgentId;
    secondPair.secondAgentId = firstPair.secondAgentId;
    duplicateSocialPair.checksum = hashCanonicalJson(JSON.stringify(duplicateSocialPair.payload));
    expect(() => deserializeWorldSnapshot(JSON.stringify(duplicateSocialPair))).toThrow(
      /relationship pairs/i,
    );

    const completedConstruction = JSON.parse(snapshot) as {
      checksum: string;
      payload: {
        civilization: {
          agents: {
            action: string;
            plan: { action: string; targetStructureId: number; targetTileIndex: number }[];
            planIndex: number;
          }[];
          structures: ({
            id: number;
            status: string;
            tileIndex: number;
            progress: number;
            plannedTick: number;
            completedTick: number;
            changedTick: number;
          } & Record<string, unknown>)[];
        };
      };
    };
    const operational = completedConstruction.payload.civilization.structures[0]!;
    operational.status = 'operational';
    operational.progress = 1_000;
    operational.completedTick = Math.max(1, operational.plannedTick);
    operational.changedTick = operational.completedTick;
    completedConstruction.payload.civilization.agents[0]!.plan = [
      {
        action: 'construct',
        targetStructureId: operational.id,
        targetTileIndex: operational.tileIndex,
      },
    ];
    completedConstruction.payload.civilization.agents[0]!.planIndex = 0;
    completedConstruction.payload.civilization.agents[0]!.action = 'construct';
    completedConstruction.checksum = hashCanonicalJson(
      JSON.stringify(completedConstruction.payload),
    );
    expect(() => deserializeWorldSnapshot(JSON.stringify(completedConstruction))).toThrow(
      /construction.*unfinished/i,
    );

    const duplicatePlacement = JSON.parse(snapshot) as {
      checksum: string;
      payload: {
        civilization: {
          nextStructureId: number;
          structures: ({ id: number; tileIndex: number } & Record<string, unknown>)[];
        };
      };
    };
    const occupied = duplicatePlacement.payload.civilization.structures[0]!;
    duplicatePlacement.payload.civilization.structures.push({
      ...occupied,
      id: duplicatePlacement.payload.civilization.nextStructureId,
    });
    duplicatePlacement.payload.civilization.nextStructureId += 1;
    duplicatePlacement.checksum = hashCanonicalJson(JSON.stringify(duplicatePlacement.payload));
    expect(() => deserializeWorldSnapshot(JSON.stringify(duplicatePlacement))).toThrow(
      /share a tile/i,
    );

    const falseMemory = JSON.parse(snapshot) as {
      checksum: string;
      payload: { civilization: { agents: { memories: { kind: string }[] }[] } };
    };
    falseMemory.payload.civilization.agents[0]!.memories[0]!.kind = 'fabricated-history';
    falseMemory.checksum = hashCanonicalJson(JSON.stringify(falseMemory.payload));
    expect(() => deserializeWorldSnapshot(JSON.stringify(falseMemory))).toThrow(
      /memory contradicts.*source event/i,
    );
  });

  it('rejects invalid JSON and tampered legacy data without mutation', () => {
    expect(() => deserializeWorldSnapshot('{')).toThrow(/valid JSON/i);
    const worldJson = canonicalWorldJson(createInitialWorld([4, 3, 2, 1], { width: 2, height: 2 }));
    const legacy = JSON.parse(legacySnapshot(worldJson)) as { worldJson: string };
    legacy.worldJson = `${legacy.worldJson} `;
    expect(() => migrateWorldSnapshot(JSON.stringify(legacy))).toThrow(/checksum/i);
  });
});
