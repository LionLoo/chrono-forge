import { hashCanonicalJson } from '../canonical';
import {
  Biome,
  canonicalWorldJson,
  type WorldChunk,
  type WorldConfig,
  type WorldEvent,
  type WorldSeed,
  type WorldState,
  type WorldTileFields,
} from '../world';

export const WORLD_SNAPSHOT_FORMAT = 'chrono-forge-world';
export const WORLD_SNAPSHOT_FORMAT_VERSION = 1;
export const WORLD_ENGINE_VERSION = 1;
export const WORLD_CONTENT_VERSION = 1;

const MAX_WORLD_TILES = 1_000_000;
const MAX_WORLD_SNAPSHOT_BYTES = 50 * 1024 * 1024;
const MAX_EVENT_KIND_LENGTH = 64;
const UINT32_MAX = 0xffff_ffff;

type UnknownRecord = Record<string, unknown>;

const PAYLOAD_KEYS = [
  'animals',
  'biome',
  'chunks',
  'config',
  'elevation',
  'eventLog',
  'food',
  'freshWater',
  'habitability',
  'hazard',
  'metal',
  'moisture',
  'nextEventId',
  'plants',
  'seed',
  'stone',
  'temperature',
  'tick',
  'timber',
  'water',
] as const;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function assertExactKeys(record: UnknownRecord, expected: readonly string[], name: string): void {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new Error(`${name} contains unexpected or missing fields.`);
  }
}

function safeInteger(value: unknown, name: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${name} must be a safe integer between ${minimum} and ${maximum}.`);
  }
  return value as number;
}

function numberArray(
  value: unknown,
  length: number,
  name: string,
  minimum: number,
  maximum: number,
): number[] {
  if (!isUnknownArray(value) || value.length !== length) {
    throw new Error(`${name} must contain exactly ${length} values.`);
  }
  return value.map((candidate, index) =>
    safeInteger(candidate, `${name}[${index}]`, minimum, maximum),
  );
}

function parseConfig(value: unknown): WorldConfig {
  if (!isRecord(value)) throw new Error('Snapshot config must be an object.');
  assertExactKeys(value, ['chunkSize', 'height', 'width'], 'Snapshot config');
  const config = Object.freeze({
    chunkSize: safeInteger(value.chunkSize, 'Snapshot chunk size', 1),
    height: safeInteger(value.height, 'Snapshot height', 1),
    width: safeInteger(value.width, 'Snapshot width', 1),
  });
  if (config.width > Math.floor(MAX_WORLD_TILES / config.height)) {
    throw new Error('Snapshot dimensions exceed the world tile limit.');
  }
  return config;
}

function expectedChunks(config: WorldConfig): readonly WorldChunk[] {
  const chunks: WorldChunk[] = [];
  let id = 0;
  for (let y = 0; y < config.height; y += config.chunkSize) {
    for (let x = 0; x < config.width; x += config.chunkSize) {
      chunks.push(
        Object.freeze({
          id,
          x,
          y,
          width: Math.min(config.chunkSize, config.width - x),
          height: Math.min(config.chunkSize, config.height - y),
        }),
      );
      id += 1;
    }
  }
  return Object.freeze(chunks);
}

function parseChunks(value: unknown, config: WorldConfig): readonly WorldChunk[] {
  const expected = expectedChunks(config);
  if (!isUnknownArray(value) || value.length !== expected.length) {
    throw new Error('Snapshot chunks do not match the configured world.');
  }
  for (let index = 0; index < expected.length; index += 1) {
    const candidate = value[index];
    const chunk = expected[index]!;
    if (!isRecord(candidate)) throw new Error(`Snapshot chunk ${index} must be an object.`);
    assertExactKeys(candidate, ['height', 'id', 'width', 'x', 'y'], `Snapshot chunk ${index}`);
    if (
      safeInteger(candidate.id, `Snapshot chunk ${index} id`) !== chunk.id ||
      safeInteger(candidate.x, `Snapshot chunk ${index} x`) !== chunk.x ||
      safeInteger(candidate.y, `Snapshot chunk ${index} y`) !== chunk.y ||
      safeInteger(candidate.width, `Snapshot chunk ${index} width`, 1) !== chunk.width ||
      safeInteger(candidate.height, `Snapshot chunk ${index} height`, 1) !== chunk.height
    ) {
      throw new Error(`Snapshot chunk ${index} is not canonical.`);
    }
  }
  return expected;
}

function parseEvents(value: unknown, tick: number, nextEventId: number): readonly WorldEvent[] {
  if (!isUnknownArray(value)) throw new Error('Snapshot eventLog must be an array.');
  const ids = new Set<number>();
  const events = value.map((candidate, index) => {
    if (!isRecord(candidate)) throw new Error(`Snapshot event ${index} must be an object.`);
    assertExactKeys(candidate, ['id', 'kind', 'tick'], `Snapshot event ${index}`);
    const id = safeInteger(candidate.id, `Snapshot event ${index} id`, 1);
    if (ids.has(id)) throw new Error(`Snapshot event id ${id} is duplicated.`);
    ids.add(id);
    const eventTick = safeInteger(candidate.tick, `Snapshot event ${index} tick`, 0, tick);
    if (
      typeof candidate.kind !== 'string' ||
      candidate.kind.length === 0 ||
      candidate.kind.length > MAX_EVENT_KIND_LENGTH
    ) {
      throw new Error(`Snapshot event ${index} kind is invalid.`);
    }
    return Object.freeze({ id, tick: eventTick, kind: candidate.kind });
  });
  const maximumId = events.reduce((maximum, event) => Math.max(maximum, event.id), 0);
  if (nextEventId <= maximumId) {
    throw new Error('Snapshot nextEventId must be greater than every event id.');
  }
  return Object.freeze(events);
}

function parseWorldPayload(value: unknown): WorldState {
  if (!isRecord(value)) throw new Error('Snapshot payload must be an object.');
  assertExactKeys(value, PAYLOAD_KEYS, 'Snapshot payload');
  const config = parseConfig(value.config);
  const tileCount = config.width * config.height;
  const tick = safeInteger(value.tick, 'Snapshot tick');
  const nextEventId = safeInteger(value.nextEventId, 'Snapshot nextEventId', 1);
  const seedValues = numberArray(value.seed, 4, 'Snapshot seed', 0, UINT32_MAX);
  const seed: WorldSeed = Object.freeze([
    seedValues[0]!,
    seedValues[1]!,
    seedValues[2]!,
    seedValues[3]!,
  ]);
  const biomeValues = numberArray(value.biome, tileCount, 'Snapshot biome', 0, Biome.Mountain);
  const tiles: WorldTileFields = Object.freeze({
    elevation: Int16Array.from(
      numberArray(value.elevation, tileCount, 'Snapshot elevation', -0x8000, 0x7fff),
    ),
    water: Uint8Array.from(numberArray(value.water, tileCount, 'Snapshot water', 0, 0xff)),
    temperature: Int16Array.from(
      numberArray(value.temperature, tileCount, 'Snapshot temperature', -0x8000, 0x7fff),
    ),
    moisture: Uint8Array.from(numberArray(value.moisture, tileCount, 'Snapshot moisture', 0, 0xff)),
    biome: Uint8Array.from(biomeValues),
    freshWater: Uint16Array.from(
      numberArray(value.freshWater, tileCount, 'Snapshot freshWater', 0, 0xffff),
    ),
    food: Uint16Array.from(numberArray(value.food, tileCount, 'Snapshot food', 0, 0xffff)),
    timber: Uint16Array.from(numberArray(value.timber, tileCount, 'Snapshot timber', 0, 0xffff)),
    stone: Uint16Array.from(numberArray(value.stone, tileCount, 'Snapshot stone', 0, 0xffff)),
    metal: Uint16Array.from(numberArray(value.metal, tileCount, 'Snapshot metal', 0, 0xffff)),
    habitability: Uint8Array.from(
      numberArray(value.habitability, tileCount, 'Snapshot habitability', 0, 0xff),
    ),
    hazard: Uint8Array.from(numberArray(value.hazard, tileCount, 'Snapshot hazard', 0, 0xff)),
    plants: Uint16Array.from(numberArray(value.plants, tileCount, 'Snapshot plants', 0, 0xffff)),
    animals: Uint16Array.from(numberArray(value.animals, tileCount, 'Snapshot animals', 0, 0xffff)),
  });
  return Object.freeze({
    seed,
    config,
    tick,
    nextEventId,
    eventLog: parseEvents(value.eventLog, tick, nextEventId),
    chunks: parseChunks(value.chunks, config),
    ...tiles,
    tiles,
  });
}

function parseEnvelope(snapshot: string): UnknownRecord {
  if (
    snapshot.length === 0 ||
    new TextEncoder().encode(snapshot).byteLength > MAX_WORLD_SNAPSHOT_BYTES
  ) {
    throw new Error('World snapshot size is invalid.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshot);
  } catch {
    throw new Error('World snapshot is not valid JSON.');
  }
  if (!isRecord(parsed)) throw new Error('World snapshot envelope must be an object.');
  if (parsed.format !== WORLD_SNAPSHOT_FORMAT) {
    throw new Error('World snapshot format is not supported.');
  }
  return parsed;
}

function deserializeVersionOne(envelope: UnknownRecord): WorldState {
  assertExactKeys(
    envelope,
    ['checksum', 'contentVersion', 'engineVersion', 'format', 'formatVersion', 'payload'],
    'World snapshot envelope',
  );
  if (
    envelope.formatVersion !== WORLD_SNAPSHOT_FORMAT_VERSION ||
    envelope.engineVersion !== WORLD_ENGINE_VERSION ||
    envelope.contentVersion !== WORLD_CONTENT_VERSION ||
    typeof envelope.checksum !== 'string'
  ) {
    throw new Error('World snapshot version metadata is invalid.');
  }
  const payloadJson = JSON.stringify(envelope.payload);
  if (hashCanonicalJson(payloadJson) !== envelope.checksum) {
    throw new Error('World snapshot checksum does not match its payload.');
  }
  const world = parseWorldPayload(envelope.payload);
  if (canonicalWorldJson(world) !== payloadJson) {
    throw new Error('World snapshot payload is not canonical.');
  }
  return world;
}

/** Serializes a canonical, versioned, internally checksummed simulation snapshot. */
export function serializeWorldSnapshot(state: WorldState): string {
  const payloadJson = canonicalWorldJson(state);
  const checksum = hashCanonicalJson(payloadJson);
  return `{"checksum":"${checksum}","contentVersion":${WORLD_CONTENT_VERSION},"engineVersion":${WORLD_ENGINE_VERSION},"format":"${WORLD_SNAPSHOT_FORMAT}","formatVersion":${WORLD_SNAPSHOT_FORMAT_VERSION},"payload":${payloadJson}}`;
}

/** Migrates every supported old envelope one version at a time to the current format. */
export function migrateWorldSnapshot(snapshot: string): string {
  const envelope = parseEnvelope(snapshot);
  const formatVersion = safeInteger(envelope.formatVersion, 'World snapshot formatVersion');
  if (formatVersion > WORLD_SNAPSHOT_FORMAT_VERSION) {
    throw new Error(`World snapshot version ${formatVersion} is newer than this application.`);
  }
  if (formatVersion === WORLD_SNAPSHOT_FORMAT_VERSION) {
    return serializeWorldSnapshot(deserializeVersionOne(envelope));
  }
  if (formatVersion !== 0)
    throw new Error(`World snapshot version ${formatVersion} is unsupported.`);

  assertExactKeys(
    envelope,
    ['checksum', 'engineVersion', 'format', 'formatVersion', 'worldJson'],
    'Legacy world snapshot envelope',
  );
  if (
    envelope.engineVersion !== 0 ||
    typeof envelope.worldJson !== 'string' ||
    typeof envelope.checksum !== 'string' ||
    hashCanonicalJson(envelope.worldJson) !== envelope.checksum
  ) {
    throw new Error('Legacy world snapshot metadata or checksum is invalid.');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(envelope.worldJson);
  } catch {
    throw new Error('Legacy world snapshot payload is not valid JSON.');
  }
  const world = parseWorldPayload(payload);
  if (canonicalWorldJson(world) !== envelope.worldJson) {
    throw new Error('Legacy world snapshot payload is not canonical.');
  }
  return serializeWorldSnapshot(world);
}

/** Loads and validates a supported snapshot without mutating its input. */
export function deserializeWorldSnapshot(snapshot: string): WorldState {
  const migrated = migrateWorldSnapshot(snapshot);
  return deserializeVersionOne(parseEnvelope(migrated));
}
