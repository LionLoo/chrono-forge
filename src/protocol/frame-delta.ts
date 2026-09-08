import {
  WORKER_PROTOCOL_VERSION,
  type CivilizationsProjection,
  type DevelopmentProjection,
  type SettlementSummary,
  type SocietyProjection,
  type SpaceProjection,
  type WorkerProtocolVersion,
  type WorldFrameProjection,
} from './index';

/** The dense, transferable portion of one immutable world frame. */
export interface TerrainFrameLayer {
  readonly biome: Uint8Array;
  readonly resource: Uint16Array;
  readonly habitability: Uint8Array;
  readonly hazard: Uint8Array;
}

/** Stable-ID-sorted parallel arrays for the visible detailed population. */
export interface AgentFrameLayer {
  readonly ids: Uint32Array;
  readonly tiles: Uint32Array;
  readonly health: Uint16Array;
  readonly actions: Uint8Array;
}

/** Stable-ID-sorted parallel arrays for visible detailed structures. */
export interface StructureFrameLayer {
  readonly ids: Uint32Array;
  readonly tiles: Uint32Array;
  readonly kinds: Uint8Array;
  readonly states: Uint8Array;
  readonly progress: Uint16Array;
  readonly condition: Uint16Array;
}

/**
 * An ordered, self-describing patch from one worker projection to the next.
 * A missing layer is intentionally unchanged; a present zero-length layer is
 * an intentional clear. Deltas are independent of camera state.
 */
export interface WorldFrameDelta {
  readonly version: WorkerProtocolVersion;
  readonly width: number;
  readonly height: number;
  readonly baseTick: number;
  readonly tick: number;
  readonly stateHash: string;
  readonly terrain?: TerrainFrameLayer;
  readonly agents?: AgentFrameLayer;
  readonly structures?: StructureFrameLayer;
  readonly settlementSummary?: SettlementSummary;
  readonly society?: SocietyProjection;
  readonly development?: DevelopmentProjection;
  readonly civilizations?: CivilizationsProjection;
  readonly space?: SpaceProjection;
}

type TypedArray =
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array;

function fail(message: string): never {
  throw new Error(`Invalid world frame delta: ${message}`);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function checkedTileCount(width: number, height: number): number {
  if (!isSafeNonNegativeInteger(width) || width < 1) fail('width must be a positive safe integer.');
  if (!isSafeNonNegativeInteger(height) || height < 1)
    fail('height must be a positive safe integer.');
  const count = width * height;
  if (!Number.isSafeInteger(count)) fail('dimensions overflow a safe tile count.');
  return count;
}

function isTypedArray(value: unknown): value is TypedArray {
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

function equalTyped(left: TypedArray, right: TypedArray): boolean {
  if (left.constructor !== right.constructor || left.byteLength !== right.byteLength) return false;
  const first = new Uint8Array(left.buffer, left.byteOffset, left.byteLength);
  const second = new Uint8Array(right.buffer, right.byteOffset, right.byteLength);
  for (let index = 0; index < first.length; index += 1)
    if (first[index] !== second[index]) return false;
  return true;
}

function structuralEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (isTypedArray(left) || isTypedArray(right))
    return isTypedArray(left) && isTypedArray(right) && equalTyped(left, right);
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object')
    return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => structuralEqual(value, right[index]));
  }
  const first = left as Record<string, unknown>;
  const second = right as Record<string, unknown>;
  const firstKeys = Object.keys(first).sort();
  const secondKeys = Object.keys(second).sort();
  if (firstKeys.length !== secondKeys.length) return false;
  for (let index = 0; index < firstKeys.length; index += 1) {
    if (firstKeys[index] !== secondKeys[index]) return false;
    const key = firstKeys[index]!;
    if (!structuralEqual(first[key], second[key])) return false;
  }
  return true;
}

function copyTyped<T extends TypedArray>(source: T): T {
  return source.slice() as T;
}

function copyValue(value: unknown): unknown {
  if (isTypedArray(value)) return copyTyped(value);
  if (Array.isArray(value)) return Object.freeze(value.map((item) => copyValue(item)));
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) copy[key] = copyValue(source[key]);
    return Object.freeze(copy);
  }
  return value;
}

function copyProjectionValue<T>(value: T): T {
  return copyValue(value) as T;
}

function copyTerrain(frame: WorldFrameProjection): TerrainFrameLayer {
  return Object.freeze({
    biome: copyTyped(frame.biome),
    resource: copyTyped(frame.resource),
    habitability: copyTyped(frame.habitability),
    hazard: copyTyped(frame.hazard),
  });
}

function copyAgents(frame: WorldFrameProjection): AgentFrameLayer {
  return Object.freeze({
    ids: copyTyped(frame.agentIds),
    tiles: copyTyped(frame.agentTiles),
    health: copyTyped(frame.agentHealth),
    actions: copyTyped(frame.agentActions),
  });
}

function copyStructures(frame: WorldFrameProjection): StructureFrameLayer {
  return Object.freeze({
    ids: copyTyped(frame.structureIds),
    tiles: copyTyped(frame.structureTiles),
    kinds: copyTyped(frame.structureKinds),
    states: copyTyped(frame.structureStates),
    progress: copyTyped(frame.structureProgress),
    condition: copyTyped(frame.structureCondition),
  });
}

function validateTerrain(layer: TerrainFrameLayer, tiles: number): void {
  if (
    !(layer.biome instanceof Uint8Array) ||
    !(layer.resource instanceof Uint16Array) ||
    !(layer.habitability instanceof Uint8Array) ||
    !(layer.hazard instanceof Uint8Array)
  ) {
    fail('terrain has incompatible typed arrays.');
  }
  if (
    layer.biome.length !== tiles ||
    layer.resource.length !== tiles ||
    layer.habitability.length !== tiles ||
    layer.hazard.length !== tiles
  ) {
    fail('terrain array lengths do not match dimensions.');
  }
}

function validateAgents(layer: AgentFrameLayer, tiles: number): void {
  if (
    !(layer.ids instanceof Uint32Array) ||
    !(layer.tiles instanceof Uint32Array) ||
    !(layer.health instanceof Uint16Array) ||
    !(layer.actions instanceof Uint8Array)
  ) {
    fail('agent layer has incompatible typed arrays.');
  }
  const length = layer.ids.length;
  if (
    layer.tiles.length !== length ||
    layer.health.length !== length ||
    layer.actions.length !== length
  )
    fail('agent parallel arrays have different lengths.');
  for (let index = 0; index < length; index += 1) {
    if (layer.tiles[index]! >= tiles) fail('agent tile is outside dimensions.');
    if (index > 0 && layer.ids[index - 1]! >= layer.ids[index]!)
      fail('agent ids must be strictly ascending.');
  }
}

function validateStructures(layer: StructureFrameLayer, tiles: number): void {
  if (
    !(layer.ids instanceof Uint32Array) ||
    !(layer.tiles instanceof Uint32Array) ||
    !(layer.kinds instanceof Uint8Array) ||
    !(layer.states instanceof Uint8Array) ||
    !(layer.progress instanceof Uint16Array) ||
    !(layer.condition instanceof Uint16Array)
  ) {
    fail('structure layer has incompatible typed arrays.');
  }
  const length = layer.ids.length;
  if (
    layer.tiles.length !== length ||
    layer.kinds.length !== length ||
    layer.states.length !== length ||
    layer.progress.length !== length ||
    layer.condition.length !== length
  ) {
    fail('structure parallel arrays have different lengths.');
  }
  for (let index = 0; index < length; index += 1) {
    if (layer.tiles[index]! >= tiles) fail('structure tile is outside dimensions.');
    if (index > 0 && layer.ids[index - 1]! >= layer.ids[index]!)
      fail('structure ids must be strictly ascending.');
  }
}

function validateFrame(frame: WorldFrameProjection): void {
  if (frame.version !== WORKER_PROTOCOL_VERSION) fail('frame protocol version is unsupported.');
  const tiles = checkedTileCount(frame.width, frame.height);
  if (!isSafeNonNegativeInteger(frame.tick))
    fail('frame tick must be a non-negative safe integer.');
  if (typeof frame.stateHash !== 'string') fail('frame state hash must be a string.');
  validateTerrain(frame, tiles);
  validateAgents(
    {
      ids: frame.agentIds,
      tiles: frame.agentTiles,
      health: frame.agentHealth,
      actions: frame.agentActions,
    },
    tiles,
  );
  validateStructures(
    {
      ids: frame.structureIds,
      tiles: frame.structureTiles,
      kinds: frame.structureKinds,
      states: frame.structureStates,
      progress: frame.structureProgress,
      condition: frame.structureCondition,
    },
    tiles,
  );
  if (!(frame.civilizations.tileOwners instanceof Uint32Array))
    fail('civilizations tile ownership must be a Uint32Array.');
  if (frame.civilizations.tileOwners.length !== tiles)
    fail('civilizations tile ownership does not match dimensions.');
}

function terrainChanged(previous: WorldFrameProjection, next: WorldFrameProjection): boolean {
  return !(
    equalTyped(previous.biome, next.biome) &&
    equalTyped(previous.resource, next.resource) &&
    equalTyped(previous.habitability, next.habitability) &&
    equalTyped(previous.hazard, next.hazard)
  );
}

function agentsChanged(previous: WorldFrameProjection, next: WorldFrameProjection): boolean {
  return !(
    equalTyped(previous.agentIds, next.agentIds) &&
    equalTyped(previous.agentTiles, next.agentTiles) &&
    equalTyped(previous.agentHealth, next.agentHealth) &&
    equalTyped(previous.agentActions, next.agentActions)
  );
}

function structuresChanged(previous: WorldFrameProjection, next: WorldFrameProjection): boolean {
  return !(
    equalTyped(previous.structureIds, next.structureIds) &&
    equalTyped(previous.structureTiles, next.structureTiles) &&
    equalTyped(previous.structureKinds, next.structureKinds) &&
    equalTyped(previous.structureStates, next.structureStates) &&
    equalTyped(previous.structureProgress, next.structureProgress) &&
    equalTyped(previous.structureCondition, next.structureCondition)
  );
}

/** Create a canonical ordered patch. Equal layer values are intentionally omitted. */
export function createWorldFrameDelta(
  previous: WorldFrameProjection,
  next: WorldFrameProjection,
): WorldFrameDelta {
  validateFrame(previous);
  validateFrame(next);
  if (previous.version !== next.version) fail('frames use different protocol versions.');
  if (previous.width !== next.width || previous.height !== next.height)
    fail('frames use different dimensions.');
  if (next.tick < previous.tick) fail('next frame tick precedes its base tick.');

  const delta: {
    version: WorkerProtocolVersion;
    width: number;
    height: number;
    baseTick: number;
    tick: number;
    stateHash: string;
    terrain?: TerrainFrameLayer;
    agents?: AgentFrameLayer;
    structures?: StructureFrameLayer;
    settlementSummary?: SettlementSummary;
    society?: SocietyProjection;
    development?: DevelopmentProjection;
    civilizations?: CivilizationsProjection;
    space?: SpaceProjection;
  } = {
    version: next.version,
    width: next.width,
    height: next.height,
    baseTick: previous.tick,
    tick: next.tick,
    stateHash: next.stateHash,
  };
  if (terrainChanged(previous, next)) delta.terrain = copyTerrain(next);
  if (agentsChanged(previous, next)) delta.agents = copyAgents(next);
  if (structuresChanged(previous, next)) delta.structures = copyStructures(next);
  if (!structuralEqual(previous.settlementSummary, next.settlementSummary))
    delta.settlementSummary = copyProjectionValue(next.settlementSummary);
  if (!structuralEqual(previous.society, next.society))
    delta.society = copyProjectionValue(next.society);
  if (!structuralEqual(previous.development, next.development))
    delta.development = copyProjectionValue(next.development);
  if (!structuralEqual(previous.civilizations, next.civilizations))
    delta.civilizations = copyProjectionValue(next.civilizations);
  if (!structuralEqual(previous.space, next.space)) delta.space = copyProjectionValue(next.space);
  return Object.freeze(delta);
}

function copyCivilizations(civilizations: CivilizationsProjection): CivilizationsProjection {
  return copyProjectionValue(civilizations);
}

/** Apply a validated delta without mutating or exposing either input projection. */
export function applyWorldFrameDelta(
  previous: WorldFrameProjection,
  delta: WorldFrameDelta,
): WorldFrameProjection {
  validateFrame(previous);
  if (delta.version !== WORKER_PROTOCOL_VERSION || delta.version !== previous.version)
    fail('delta protocol version is unsupported or does not match the base frame.');
  const tiles = checkedTileCount(delta.width, delta.height);
  if (delta.width !== previous.width || delta.height !== previous.height)
    fail('delta dimensions do not match the base frame.');
  if (delta.baseTick !== previous.tick) fail('delta base tick does not match the base frame.');
  if (!isSafeNonNegativeInteger(delta.tick) || delta.tick < delta.baseTick)
    fail('delta tick is not monotonic from its base tick.');
  if (typeof delta.stateHash !== 'string') fail('delta state hash must be a string.');
  if (delta.terrain !== undefined) validateTerrain(delta.terrain, tiles);
  if (delta.agents !== undefined) validateAgents(delta.agents, tiles);
  if (delta.structures !== undefined) validateStructures(delta.structures, tiles);
  if (delta.civilizations !== undefined) {
    if (!(delta.civilizations.tileOwners instanceof Uint32Array))
      fail('delta civilizations tile ownership must be a Uint32Array.');
    if (delta.civilizations.tileOwners.length !== tiles)
      fail('delta civilizations tile ownership does not match dimensions.');
  }

  const terrain = delta.terrain;
  const agents = delta.agents;
  const structures = delta.structures;
  const civilizations = delta.civilizations ?? previous.civilizations;
  const applied: WorldFrameProjection = Object.freeze({
    version: delta.version,
    width: delta.width,
    height: delta.height,
    tick: delta.tick,
    stateHash: delta.stateHash,
    biome: copyTyped(terrain?.biome ?? previous.biome),
    resource: copyTyped(terrain?.resource ?? previous.resource),
    habitability: copyTyped(terrain?.habitability ?? previous.habitability),
    hazard: copyTyped(terrain?.hazard ?? previous.hazard),
    agentIds: copyTyped(agents?.ids ?? previous.agentIds),
    agentTiles: copyTyped(agents?.tiles ?? previous.agentTiles),
    agentHealth: copyTyped(agents?.health ?? previous.agentHealth),
    agentActions: copyTyped(agents?.actions ?? previous.agentActions),
    structureIds: copyTyped(structures?.ids ?? previous.structureIds),
    structureTiles: copyTyped(structures?.tiles ?? previous.structureTiles),
    structureKinds: copyTyped(structures?.kinds ?? previous.structureKinds),
    structureStates: copyTyped(structures?.states ?? previous.structureStates),
    structureProgress: copyTyped(structures?.progress ?? previous.structureProgress),
    structureCondition: copyTyped(structures?.condition ?? previous.structureCondition),
    settlementSummary: copyProjectionValue(delta.settlementSummary ?? previous.settlementSummary),
    society: copyProjectionValue(delta.society ?? previous.society),
    development: copyProjectionValue(delta.development ?? previous.development),
    civilizations: copyCivilizations(civilizations),
    space: copyProjectionValue(delta.space ?? previous.space),
  });
  validateFrame(applied);
  return applied;
}

function buffersFromLayer(
  layer: TerrainFrameLayer | AgentFrameLayer | StructureFrameLayer,
): readonly ArrayBuffer[] {
  return Object.values(layer).map((array) => (array as TypedArray).buffer as ArrayBuffer);
}

/** Buffers only from changed typed layers, in canonical protocol order. */
export function frameDeltaTransferables(delta: WorldFrameDelta): readonly ArrayBuffer[] {
  const buffers = [
    ...(delta.terrain === undefined ? [] : buffersFromLayer(delta.terrain)),
    ...(delta.agents === undefined ? [] : buffersFromLayer(delta.agents)),
    ...(delta.structures === undefined ? [] : buffersFromLayer(delta.structures)),
    ...(delta.civilizations === undefined
      ? []
      : [delta.civilizations.tileOwners.buffer as ArrayBuffer]),
  ];
  return Object.freeze([...new Set(buffers)]);
}

function metadataValue(value: unknown): unknown {
  if (isTypedArray(value))
    return Object.freeze({ $typedArray: value.constructor.name, byteLength: value.byteLength });
  if (Array.isArray(value)) return value.map((item) => metadataValue(item));
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) result[key] = metadataValue(record[key]);
    return result;
  }
  return value;
}

/** Exact transfer bytes plus stable UTF-8 metadata bytes, with typed data counted once. */
export function estimateFrameDeltaPayloadBytes(delta: WorldFrameDelta): number {
  const buffers = frameDeltaTransferables(delta);
  const transferBytes = buffers.reduce((total, buffer) => total + buffer.byteLength, 0);
  const metadataBytes = new TextEncoder().encode(JSON.stringify(metadataValue(delta))).byteLength;
  return transferBytes + metadataBytes;
}
