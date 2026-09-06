import { describe, expect, it } from 'vitest';

import { hashCanonicalJson } from '../../src/simulation/canonical';
import { FIRST_ORDINARY_RESIDENT_ID } from '../../src/simulation/scale';
import {
  deserializeWorldSnapshot,
  migrateWorldSnapshot,
  serializeWorldSnapshot,
  WORLD_SNAPSHOT_FORMAT,
} from '../../src/simulation/persistence';
import {
  assertWorldInvariants,
  createInitialWorld,
  hashWorldState,
  initializeM8WorldAuthority,
  reconcileWorldPopulationAuthority,
  stepWorld,
} from '../../src/simulation/world';
import { ACCELERATED_YEAR_TICKS } from '../../src/simulation/society';

const seed = [0x1234_5678, 0x9abc_def0, 0x0fed_cba9, 0x8765_4321] as const;

function v7Snapshot(world: ReturnType<typeof createInitialWorld>): string {
  const envelope = JSON.parse(serializeWorldSnapshot(world)) as {
    payload: Record<string, unknown>;
  };
  const payload = { ...envelope.payload };
  delete payload.populationScale;
  delete payload.pathCache;
  const payloadJson = JSON.stringify(payload);
  return JSON.stringify({
    checksum: hashCanonicalJson(payloadJson),
    contentVersion: 7,
    engineVersion: 7,
    format: WORLD_SNAPSHOT_FORMAT,
    formatVersion: 7,
    payload,
  });
}

function v8Snapshot(world: ReturnType<typeof createInitialWorld>): string {
  const envelope = JSON.parse(serializeWorldSnapshot(world)) as {
    payload: Record<string, unknown>;
  };
  const payload = structuredClone(envelope.payload);
  const scale = payload.populationScale as Record<string, unknown>;
  delete scale.nextResidentId;
  for (const cohort of scale.cohorts as Record<string, unknown>[]) delete cohort.promotionCursor;
  const payloadJson = JSON.stringify(payload);
  return JSON.stringify({
    checksum: hashCanonicalJson(payloadJson),
    contentVersion: 8,
    engineVersion: 8,
    format: WORLD_SNAPSHOT_FORMAT,
    formatVersion: 8,
    payload,
  });
}

function mutateChecksummedSnapshot(
  world: ReturnType<typeof createInitialWorld>,
  mutate: (payload: Record<string, unknown>) => void,
): string {
  const envelope = JSON.parse(serializeWorldSnapshot(world)) as {
    checksum: string;
    payload: Record<string, unknown>;
  };
  mutate(envelope.payload);
  envelope.checksum = hashCanonicalJson(JSON.stringify(envelope.payload));
  return JSON.stringify(envelope);
}

describe('M8 world scale authority', () => {
  it('initializes every live named person as a protected detailed resident and conserves settlement population', () => {
    const world = createInitialWorld(seed);
    const namedIds = world.civilization.society.people
      .filter((person) => person.alive)
      .map((person) => person.id);

    expect(world.populationScale.detailedResidents.map((resident) => resident.id)).toStrictEqual(
      namedIds,
    );
    expect(
      world.populationScale.detailedResidents.every((resident) => resident.importance > 0),
    ).toBe(true);
    expect(world.populationScale.tick).toBe(world.tick);
    expect(world.pathCache.logicalTick).toBe(world.tick);
    expect(world.civilizations.settlements[0]!.population).toBe(namedIds.length);
    expect(() => assertWorldInvariants(world)).not.toThrow();
  });

  it('synchronizes named values while retaining scheduled counters and protected social references', () => {
    const initial = createInitialWorld(seed, { societyYearTicks: ACCELERATED_YEAR_TICKS });
    const before = stepWorld(initial, 100);
    const after = stepWorld(before, 100);
    const beforeById = new Map(
      before.populationScale.detailedResidents.map((resident) => [resident.id, resident]),
    );

    for (const agent of after.civilization.agents.filter((candidate) => candidate.alive)) {
      const resident = after.populationScale.detailedResidents.find(
        (candidate) => candidate.id === agent.id,
      );
      expect(resident).toMatchObject({
        importance: 1,
        health: agent.health,
        foodNeed: agent.hunger,
        waterNeed: agent.thirst,
        safety: agent.safety,
      });
      expect(resident!.updateCount).toBeGreaterThanOrEqual(beforeById.get(agent.id)!.updateCount);
    }

    const lived = stepWorld(after, 120_000);
    const relationship = lived.civilization.society.interpersonal.active[0];
    expect(relationship).toBeDefined();
    for (const personId of [relationship!.firstPersonId, relationship!.secondPersonId]) {
      const resident = lived.populationScale.detailedResidents.find(
        (candidate) => candidate.id === personId,
      );
      expect(resident?.importance).toBe(1);
      expect(resident?.relationshipIds).toContain(relationship!.id);
    }
    expect(() => assertWorldInvariants(lived)).not.toThrow();
    const snapshot = serializeWorldSnapshot(lived);
    const reloaded = deserializeWorldSnapshot(snapshot);
    expect(serializeWorldSnapshot(reloaded)).toBe(snapshot);
    expect(reloaded.civilization.society.people).toStrictEqual(lived.civilization.society.people);
    expect(reloaded.civilizations.residencies).toStrictEqual(lived.civilizations.residencies);

    const primarySettlement = lived.civilizations.settlements[0]!;
    const authoritativeSurplus = {
      ...lived,
      civilizations: {
        ...lived.civilizations,
        settlements: lived.civilizations.settlements.map((settlement) =>
          settlement.id === primarySettlement.id
            ? { ...settlement, population: settlement.population + 1 }
            : settlement,
        ),
      },
    };
    const relationshipHeavyWorld = {
      ...authoritativeSurplus,
      ...initializeM8WorldAuthority(authoritativeSurplus),
    };
    expect(relationshipHeavyWorld.populationScale.cohorts[0]?.residentIds).toStrictEqual([
      FIRST_ORDINARY_RESIDENT_ID,
    ]);
    for (const personId of [relationship!.firstPersonId, relationship!.secondPersonId]) {
      expect(
        relationshipHeavyWorld.populationScale.detailedResidents.some(({ id }) => id === personId),
      ).toBe(true);
    }
    expect(() => assertWorldInvariants(relationshipHeavyWorld)).not.toThrow();
    const relationshipHeavySnapshot = serializeWorldSnapshot(relationshipHeavyWorld);
    expect(serializeWorldSnapshot(deserializeWorldSnapshot(relationshipHeavySnapshot))).toBe(
      relationshipHeavySnapshot,
    );
  }, 30_000);

  it('uses the persisted configured path cache for live settlement pulses', () => {
    const initial = createInitialWorld(seed);
    const first = stepWorld(initial, 100);
    const second = stepWorld(first, 100);

    expect(first.pathCache.operationCount).toBeGreaterThan(0);
    expect(first.pathCache.completed.length).toBeGreaterThan(0);
    expect(
      first.pathCache.completed.every(
        (entry) => entry.request.chunkSize === initial.config.chunkSize,
      ),
    ).toBe(true);
    expect(second.pathCache.completed.some((entry) => entry.lastUsedTick === 200)).toBe(true);
    expect(second.pathCache.logicalTick).toBe(second.tick);
  });

  it('applies production LOD without camera input and conserves settlement population', () => {
    const initial = createInitialWorld(seed);
    const authoritativeSurplus = {
      ...initial,
      civilizations: {
        ...initial.civilizations,
        settlements: initial.civilizations.settlements.map((settlement) => ({
          ...settlement,
          population: settlement.population + 2,
        })),
      },
    };
    const prepared = {
      ...authoritativeSurplus,
      ...initializeM8WorldAuthority(authoritativeSurplus),
    };
    const ordinaryIds = [FIRST_ORDINARY_RESIDENT_ID, FIRST_ORDINARY_RESIDENT_ID + 1];

    expect(prepared.populationScale.cohorts[0]).toMatchObject({
      classification: { householdId: 0 },
      householdCount: 0,
      residentIds: ordinaryIds,
    });
    expect(prepared.populationScale.nextResidentId).toBe(FIRST_ORDINARY_RESIDENT_ID + 2);
    expect(() => assertWorldInvariants(prepared)).not.toThrow();

    const promoted = stepWorld(prepared, 100);
    expect(
      promoted.populationScale.detailedResidents.some(({ id }) => ordinaryIds.includes(id)),
    ).toBe(true);
    expect(promoted.civilizations.settlements[0]!.population).toBe(
      promoted.populationScale.detailedResidents.length +
        promoted.populationScale.cohorts.reduce(
          (total, cohort) => total + cohort.residentIds.length,
          0,
        ),
    );
    expect(() => assertWorldInvariants(promoted)).not.toThrow();

    const reducedInput = {
      ...promoted,
      civilizations: {
        ...promoted.civilizations,
        settlements: promoted.civilizations.settlements.map((settlement) => ({
          ...settlement,
          population: settlement.population - 2,
        })),
      },
    };
    const reduced = reconcileWorldPopulationAuthority(reducedInput);
    expect(
      reduced.populationScale.detailedResidents.some(({ id }) => ordinaryIds.includes(id)),
    ).toBe(false);
    expect(
      reduced.populationScale.cohorts.some(({ residentIds }) =>
        residentIds.some((id) => ordinaryIds.includes(id)),
      ),
    ).toBe(false);
    expect(reduced.populationScale.nextResidentId).toBe(FIRST_ORDINARY_RESIDENT_ID + 2);
    expect(reduced.populationScale.transfers.at(-1)?.kind).toBe('removed');
    expect(() => assertWorldInvariants(reduced)).not.toThrow();

    const oneShot = stepWorld(prepared, 200);
    const partitioned = stepWorld(stepWorld(prepared, 100), 100);
    expect(hashWorldState(partitioned)).toBe(hashWorldState(oneShot));

    const snapshot = serializeWorldSnapshot(reduced);
    const reloaded = deserializeWorldSnapshot(snapshot);
    expect(serializeWorldSnapshot(reloaded)).toBe(snapshot);
    expect(reloaded.civilizations.settlements[0]!.population).toBe(
      reduced.civilizations.settlements[0]!.population,
    );
  });

  it('round-trips strict v9 authority and migrates v8/v7 without invented scale or cache history', () => {
    const source = stepWorld(createInitialWorld(seed), 4_321);
    const snapshot = serializeWorldSnapshot(source);
    const loaded = deserializeWorldSnapshot(snapshot);
    expect(serializeWorldSnapshot(loaded)).toBe(snapshot);

    const malformed = JSON.parse(snapshot) as {
      checksum: string;
      payload: Record<string, unknown>;
    };
    delete (malformed.payload.pathCache as Record<string, unknown>).backlog;
    malformed.checksum = hashCanonicalJson(JSON.stringify(malformed.payload));
    expect(() => deserializeWorldSnapshot(JSON.stringify(malformed))).toThrow(
      /path cache.*fields|path cache.*keys/i,
    );

    const migrated = migrateWorldSnapshot(v7Snapshot(source));
    const legacyLoaded = deserializeWorldSnapshot(migrated);
    expect(legacyLoaded.eventLog).toStrictEqual(source.eventLog);
    expect(legacyLoaded.populationScale).toMatchObject({
      tick: source.tick,
      operationCount: 0,
      transfers: [],
    });
    expect(legacyLoaded.pathCache).toMatchObject({
      logicalTick: source.tick,
      operationCount: 0,
      pending: [],
      completed: [],
    });
    const versionEightLoaded = deserializeWorldSnapshot(migrateWorldSnapshot(v8Snapshot(source)));
    expect(versionEightLoaded.populationScale.nextResidentId).toBe(FIRST_ORDINARY_RESIDENT_ID);
    expect(versionEightLoaded.eventLog).toStrictEqual(source.eventLog);

    const extendedVersionEight = JSON.parse(v8Snapshot(source)) as {
      checksum: string;
      payload: Record<string, unknown>;
    };
    const legacyPathCache = extendedVersionEight.payload.pathCache as Record<string, unknown>;
    legacyPathCache.pending = [
      {
        requestId: 1,
        key: '0:6:8:2:0:0:5:0:12',
        queuedAtTick: source.tick,
        request: {
          width: 6,
          height: 8,
          chunkSize: 2,
          start: { x: 0, y: 0 },
          goal: { x: 5, y: 0 },
          maxExpansions: 12,
          revision: 0,
        },
        stage: 'direct-fallback',
        fallbackExpansionOffset: 10,
        fallbackEligibleTick: source.tick + 1,
      },
    ];
    legacyPathCache.backlog = 1;
    legacyPathCache.nextRequestId = 2;
    extendedVersionEight.checksum = hashCanonicalJson(JSON.stringify(extendedVersionEight.payload));
    expect(() => migrateWorldSnapshot(JSON.stringify(extendedVersionEight))).toThrow(
      /pending path 0.*fields/i,
    );
  });

  it('migrates a valid oversized v8 household cohort into bounded v9 anonymous cohorts', () => {
    const initial = createInitialWorld(seed);
    const settlement = initial.civilizations.settlements[0]!;
    const legacyPopulation = 2_500;
    const authoritativeSurplus = {
      ...initial,
      civilizations: {
        ...initial.civilizations,
        settlements: initial.civilizations.settlements.map((candidate) =>
          candidate.id === settlement.id
            ? { ...candidate, population: candidate.population + legacyPopulation }
            : candidate,
        ),
      },
    };
    const current = {
      ...authoritativeSurplus,
      ...initializeM8WorldAuthority(authoritativeSurplus),
    };
    const envelope = JSON.parse(serializeWorldSnapshot(current)) as {
      checksum: string;
      contentVersion: number;
      engineVersion: number;
      formatVersion: number;
      payload: Record<string, unknown>;
    };
    const scale = envelope.payload.populationScale as Record<string, unknown>;
    delete scale.nextResidentId;
    scale.nextCohortId = 2;
    scale.nextTransferId = 1;
    scale.cohorts = [
      {
        id: 1,
        classification: {
          settlementId: settlement.id,
          civilizationId: settlement.civilizationId,
          cultureId: settlement.cultureId,
          householdId: 77,
          tileIndex: settlement.centerTileIndex,
        },
        residentIds: Array.from({ length: legacyPopulation }, (_, index) => 100 + index),
        householdCount: 1,
        totals: {
          age: legacyPopulation * 25,
          health: legacyPopulation * 80,
          foodNeed: legacyPopulation * 3,
          waterNeed: legacyPopulation * 2,
          safety: legacyPopulation * 75,
          skill: legacyPopulation * 12,
        },
        nextUpdateTick: 0,
        updateCount: 0,
      },
    ];
    scale.transfers = [];
    scale.backlog = { detailedDue: 6, cohortDue: 1, totalDue: 7 };
    envelope.contentVersion = 8;
    envelope.engineVersion = 8;
    envelope.formatVersion = 8;
    envelope.checksum = hashCanonicalJson(JSON.stringify(envelope.payload));

    const migrated = migrateWorldSnapshot(JSON.stringify(envelope));
    const loaded = deserializeWorldSnapshot(migrated);
    expect(loaded.populationScale.cohorts.map((cohort) => cohort.residentIds.length)).toStrictEqual(
      [1_000, 1_000, 500],
    );
    expect(loaded.populationScale.cohorts.every((cohort) => cohort.householdCount === 0)).toBe(
      true,
    );
    expect(loaded.populationScale.cohorts.flatMap((cohort) => cohort.residentIds)).toStrictEqual(
      Array.from({ length: legacyPopulation }, (_, index) => FIRST_ORDINARY_RESIDENT_ID + index),
    );
    expect(loaded.populationScale.cohorts.reduce((sum, cohort) => sum + cohort.totals.age, 0)).toBe(
      legacyPopulation * 25,
    );
    expect(loaded.populationScale.nextResidentId).toBe(
      FIRST_ORDINARY_RESIDENT_ID + legacyPopulation,
    );
    expect(loaded.eventLog).toStrictEqual(initial.eventLog);
    expect(serializeWorldSnapshot(loaded)).toBe(migrated);
  });

  it('rejects checksummed v9 ordinary residents with orphaned or mismatched provenance', () => {
    const initial = createInitialWorld(seed);
    const settlement = initial.civilizations.settlements[0]!;
    const authoritativeSurplus = {
      ...initial,
      civilizations: {
        ...initial.civilizations,
        settlements: initial.civilizations.settlements.map((candidate) =>
          candidate.id === settlement.id
            ? { ...candidate, population: candidate.population + 2 }
            : candidate,
        ),
      },
    };
    const prepared = {
      ...authoritativeSurplus,
      ...initializeM8WorldAuthority(authoritativeSurplus),
    };
    const promoted = stepWorld(prepared, 100);
    const mutations = [
      { kind: 'detail', field: 'settlementId', value: 999_999 },
      { kind: 'detail', field: 'civilizationId', value: settlement.civilizationId + 1 },
      { kind: 'detail', field: 'cultureId', value: settlement.cultureId + 1 },
      { kind: 'detail', field: 'tileIndex', value: settlement.centerTileIndex + 1 },
      { kind: 'cohort', field: 'settlementId', value: 999_999 },
      { kind: 'cohort', field: 'civilizationId', value: settlement.civilizationId + 1 },
      { kind: 'cohort', field: 'cultureId', value: settlement.cultureId + 1 },
      { kind: 'cohort', field: 'tileIndex', value: settlement.centerTileIndex + 1 },
    ] as const;

    for (const mutation of mutations) {
      const source = mutation.kind === 'detail' ? promoted : prepared;
      const corrupted = mutateChecksummedSnapshot(source, (payload) => {
        const scale = payload.populationScale as {
          detailedResidents: Record<string, unknown>[];
          cohorts: { classification: Record<string, unknown> }[];
        };
        if (mutation.kind === 'detail') {
          const ordinary = scale.detailedResidents.find(
            (resident) => (resident.id as number) >= FIRST_ORDINARY_RESIDENT_ID,
          )!;
          ordinary[mutation.field] = mutation.value;
        } else {
          scale.cohorts[0]!.classification[mutation.field] = mutation.value;
        }
      });
      expect(() => deserializeWorldSnapshot(corrupted)).toThrow(/provenance/i);
    }
  });

  it('is partition-equivalent with no observation or camera input in the authoritative path', () => {
    const initial = createInitialWorld(seed);
    const oneShot = stepWorld(initial, 1_237);
    let partitioned = initial;
    for (const ticks of [1, 99, 100, 37, 1_000]) partitioned = stepWorld(partitioned, ticks);

    expect(hashWorldState(partitioned)).toBe(hashWorldState(oneShot));
    expect(partitioned.populationScale).toStrictEqual(oneShot.populationScale);
    expect(partitioned.pathCache).toStrictEqual(oneShot.pathCache);
  });
});
