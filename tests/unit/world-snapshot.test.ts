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

  it('migrates the committed legacy envelope to current canonical form', () => {
    const migrated = migrateWorldSnapshot(JSON.stringify(legacyWorldV0));

    expect(JSON.parse(migrated)).toMatchObject({ formatVersion: WORLD_SNAPSHOT_FORMAT_VERSION });
    expect(canonicalWorldJson(deserializeWorldSnapshot(migrated))).toBe(legacyWorldV0.worldJson);
    expect(migrateWorldSnapshot(migrated)).toBe(migrated);
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
  });

  it('rejects invalid JSON and tampered legacy data without mutation', () => {
    expect(() => deserializeWorldSnapshot('{')).toThrow(/valid JSON/i);
    const worldJson = canonicalWorldJson(createInitialWorld([4, 3, 2, 1], { width: 2, height: 2 }));
    const legacy = JSON.parse(legacySnapshot(worldJson)) as { worldJson: string };
    legacy.worldJson = `${legacy.worldJson} `;
    expect(() => migrateWorldSnapshot(JSON.stringify(legacy))).toThrow(/checksum/i);
  });
});
