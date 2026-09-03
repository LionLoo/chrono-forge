import { describe, expect, it } from 'vitest';

import { hashCanonicalJson } from '../../src/simulation/canonical';
import { aggregateResidents, createPopulationScale } from '../../src/simulation/scale';
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
  }, 30_000);

  it('conserves active detailed and cohort residents in settlement population without resetting to named residency', () => {
    const initial = createInitialWorld(seed);
    const template = initial.populationScale.detailedResidents[0]!;
    const ordinary = {
      ...template,
      id: 9_999,
      importance: 0,
      relationshipIds: [],
      familyIds: [],
      eventIds: [],
      rng: [1, 2, 3, 4] as const,
    };
    const scale = createPopulationScale(initial.populationScale.rng, initial.tick, {
      detailedResidents: [...initial.populationScale.detailedResidents, ordinary],
    });
    const aggregated = aggregateResidents(scale, [ordinary.id]);
    const world = {
      ...initial,
      populationScale: aggregated,
      civilizations: {
        ...initial.civilizations,
        settlements: initial.civilizations.settlements.map((settlement) => ({
          ...settlement,
          population:
            settlement.id === ordinary.settlementId
              ? settlement.population + 1
              : settlement.population,
        })),
      },
    };

    expect(aggregated.cohorts[0]?.residentIds).toStrictEqual([ordinary.id]);
    expect(world.civilizations.settlements[0]!.population).toBe(
      world.populationScale.detailedResidents.length +
        world.populationScale.cohorts[0]!.residentIds.length,
    );
    expect(() => assertWorldInvariants(world)).not.toThrow();
  });

  it('round-trips strict v8 authority and migrates v7 at the saved tick without invented scale or cache history', () => {
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
