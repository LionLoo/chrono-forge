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
  stepWorld,
} from '../../src/simulation/world';
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

  it.each([
    ['v0', JSON.stringify(legacyWorldV0)],
    ['v1', versionOneSnapshot(legacyWorldV0.worldJson)],
  ])(
    'migrates the committed legacy %s envelope to a founded v2 civilization',
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
          targetId: 0,
        },
      ]),
    );
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
  });

  it('rejects checksummed v2 snapshots with impossible life, social, or construction state', () => {
    const snapshot = serializeWorldSnapshot(stepWorld(createInitialWorld([1, 2, 3, 4]), 15_000));

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
          structures: { id: number; status: string; tileIndex: number }[];
        };
      };
    };
    const operational = completedConstruction.payload.civilization.structures.find(
      (structure) => structure.status === 'operational',
    );
    expect(operational).toBeDefined();
    completedConstruction.payload.civilization.agents[0]!.plan = [
      {
        action: 'construct',
        targetStructureId: operational!.id,
        targetTileIndex: operational!.tileIndex,
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
