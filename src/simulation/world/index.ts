import { hashCanonicalJson } from '../canonical';
import { deriveXoshiro128State, Xoshiro128StarStar } from '../random';
import {
  ACCELERATED_YEAR_TICKS,
  NORMAL_YEAR_TICKS,
  attachSocietyBiographyEventIds,
  type EntityKind,
  type SocietyAuthoritativeEvent,
} from '../society';
import {
  advanceCivilization,
  assertCivilizationInvariants,
  attachFactualMemories,
  civilizationDto,
  createInitialCivilization,
  SETTLEMENT_ACTION_PULSE_TICKS,
  SETTLEMENT_FOUNDER_COUNT,
  type CivilizationState,
  type SettlementTerrain,
} from '../settlement';

export type WorldSeed = readonly [number, number, number, number];

export enum Biome {
  Water = 0,
  Tundra = 1,
  Grassland = 2,
  Forest = 3,
  Desert = 4,
  Wetland = 5,
  Mountain = 6,
}

export interface WorldConfig {
  readonly width: number;
  readonly height: number;
  readonly chunkSize: number;
  readonly societyYearTicks: number;
}

export interface WorldChunk {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WorldEvent {
  readonly id: number;
  readonly tick: number;
  readonly kind: string;
  readonly summary: string;
  readonly subjectKind: EntityKind;
  readonly subjectId: number;
  readonly targetKind: EntityKind;
  readonly targetId: number;
  readonly tileIndex: number;
  readonly amount: number;
}

export interface WorldEventDetails {
  readonly summary?: string;
  readonly subjectKind?: EntityKind;
  readonly subjectId?: number;
  readonly targetKind?: EntityKind;
  readonly targetId?: number;
  readonly tileIndex?: number;
  readonly amount?: number;
}

export interface WorldTileFields {
  readonly elevation: Int16Array;
  readonly water: Uint8Array;
  readonly temperature: Int16Array;
  readonly moisture: Uint8Array;
  readonly biome: Uint8Array;
  readonly freshWater: Uint16Array;
  readonly food: Uint16Array;
  readonly timber: Uint16Array;
  readonly stone: Uint16Array;
  readonly metal: Uint16Array;
  readonly habitability: Uint8Array;
  readonly hazard: Uint8Array;
  readonly plants: Uint16Array;
  readonly animals: Uint16Array;
}

export interface WorldState extends WorldTileFields {
  readonly seed: WorldSeed;
  readonly config: WorldConfig;
  readonly tick: number;
  readonly nextEventId: number;
  readonly eventLog: readonly WorldEvent[];
  readonly chunks: readonly WorldChunk[];
  readonly civilization: CivilizationState;
  /** Compatibility projection; it aliases the root-level authoritative fields. */
  readonly tiles: WorldTileFields;
}

const ENTITY_KINDS: readonly EntityKind[] = Object.freeze([
  'person',
  'structure',
  'household',
  'culture',
  'group',
  'institution',
  'world',
]);

function isEntityKind(value: unknown): value is EntityKind {
  return typeof value === 'string' && (ENTITY_KINDS as readonly string[]).includes(value);
}

function worldReferenceExists(state: WorldState, kind: EntityKind, id: number): boolean {
  switch (kind) {
    case 'world':
      return id === 0;
    case 'person':
      return state.civilization.agents.some((agent) => agent.id === id);
    case 'structure':
      return state.civilization.structures.some((structure) => structure.id === id);
    case 'household':
      return state.civilization.society.households.some((household) => household.id === id);
    case 'culture':
      return state.civilization.society.cultures.some((culture) => culture.id === id);
    case 'group':
      return state.civilization.society.groups.some((group) => group.id === id);
    case 'institution':
      return state.civilization.society.institution.id === id;
  }
}

export const DEFAULT_WORLD_CONFIG: WorldConfig = Object.freeze({
  width: 96,
  height: 64,
  chunkSize: 32,
  societyYearTicks: NORMAL_YEAR_TICKS,
});

const MAX_WORLD_TILES = 1_000_000;

function asUint32(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`${name} must be a uint32 integer.`);
  }

  return value >>> 0;
}

function normalizeSeed(seed: WorldSeed): WorldSeed {
  if (seed.length !== 4) {
    throw new RangeError('World seed must contain exactly four uint32 words.');
  }

  return [
    asUint32(seed[0], 'World seed'),
    asUint32(seed[1], 'World seed'),
    asUint32(seed[2], 'World seed'),
    asUint32(seed[3], 'World seed'),
  ];
}

function normalizeConfig(partialConfig: Partial<WorldConfig> | undefined): WorldConfig {
  const config: WorldConfig = {
    width: partialConfig?.width ?? DEFAULT_WORLD_CONFIG.width,
    height: partialConfig?.height ?? DEFAULT_WORLD_CONFIG.height,
    chunkSize: partialConfig?.chunkSize ?? DEFAULT_WORLD_CONFIG.chunkSize,
    societyYearTicks: partialConfig?.societyYearTicks ?? DEFAULT_WORLD_CONFIG.societyYearTicks,
  };

  if (
    !Number.isSafeInteger(config.width) ||
    !Number.isSafeInteger(config.height) ||
    !Number.isSafeInteger(config.chunkSize) ||
    config.width < 1 ||
    config.height < 1 ||
    config.chunkSize < 1 ||
    (config.societyYearTicks !== NORMAL_YEAR_TICKS &&
      config.societyYearTicks !== ACCELERATED_YEAR_TICKS) ||
    config.width * config.height > MAX_WORLD_TILES
  ) {
    throw new RangeError('World dimensions must be positive integers within the tile limit.');
  }

  return Object.freeze(config);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}

function makeChunks(config: WorldConfig): readonly WorldChunk[] {
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

function coordinateHash(keys: readonly number[], x: number, y: number, channel: number): number {
  let value = keys[channel % keys.length] ?? 0;
  value ^= Math.imul(x + 1, 0x9e3779b1);
  value ^= Math.imul(y + 1, 0x85ebca77);
  value ^= Math.imul(channel + 1, 0xc2b2ae3d);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function smoothLatticeWeight(offset: number, scale: number): number {
  const numerator = offset * offset * (3 * scale - 2 * offset) * 65_535;
  return Math.trunc(numerator / (scale * scale * scale));
}

function interpolateInteger(start: number, end: number, weight: number): number {
  return start + Math.trunc(((end - start) * weight) / 65_535);
}

/**
 * Integer-only value noise. Hashes supply lattice values, while smooth integer
 * interpolation creates coherent terrain-scale regions between those values.
 */
function latticeNoise(
  keys: readonly number[],
  x: number,
  y: number,
  channel: number,
  scale: number,
): number {
  const cellX = Math.trunc(x / scale);
  const cellY = Math.trunc(y / scale);
  const localX = x - cellX * scale;
  const localY = y - cellY * scale;
  const xWeight = smoothLatticeWeight(localX, scale);
  const yWeight = smoothLatticeWeight(localY, scale);
  const top = interpolateInteger(
    coordinateHash(keys, cellX, cellY, channel) & 0xffff,
    coordinateHash(keys, cellX + 1, cellY, channel) & 0xffff,
    xWeight,
  );
  const bottom = interpolateInteger(
    coordinateHash(keys, cellX, cellY + 1, channel) & 0xffff,
    coordinateHash(keys, cellX + 1, cellY + 1, channel) & 0xffff,
    xWeight,
  );
  return interpolateInteger(top, bottom, yWeight);
}

function multiScaleNoise(keys: readonly number[], x: number, y: number, channel: number): number {
  const continental = latticeNoise(keys, x, y, channel, 32);
  const regional = latticeNoise(keys, x, y, channel + 1, 12);
  const local = latticeNoise(keys, x, y, channel + 2, 4);
  return Math.trunc((continental * 6 + regional * 3 + local) / 10);
}

function isSanctuary(config: WorldConfig, x: number, y: number): boolean {
  const halfWidth = Math.max(1, Math.min(16, Math.trunc(config.width / 4)));
  const halfHeight = Math.max(1, Math.min(12, Math.trunc(config.height / 4)));
  const centerX = Math.trunc(config.width / 2);
  const centerY = Math.trunc(config.height / 2);
  return Math.abs(x - centerX) <= halfWidth && Math.abs(y - centerY) <= halfHeight;
}

function biomeFor(elevation: number, water: number, temperature: number, moisture: number): Biome {
  if (water > 0) {
    return Biome.Water;
  }
  if (elevation >= 840) {
    return Biome.Mountain;
  }
  if (temperature < 55) {
    return Biome.Tundra;
  }
  if (moisture >= 185) {
    return Biome.Wetland;
  }
  if (moisture < 70) {
    return Biome.Desert;
  }
  if (moisture >= 130) {
    return Biome.Forest;
  }
  return Biome.Grassland;
}

function compareEvents(left: WorldEvent, right: WorldEvent): number {
  if (left.id !== right.id) {
    return left.id - right.id;
  }
  if (left.tick !== right.tick) {
    return left.tick - right.tick;
  }
  if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1;
  if (left.subjectId !== right.subjectId) return left.subjectId - right.subjectId;
  if (left.targetId !== right.targetId) return left.targetId - right.targetId;
  if (left.tileIndex !== right.tileIndex) return left.tileIndex - right.tileIndex;
  return left.amount - right.amount;
}

function arrayDto(values: ArrayLike<number>): number[] {
  return Array.from(values);
}

/** Builds an immutable world snapshot from only a seed and integer configuration. */
export function createInitialWorld(
  seed: WorldSeed,
  partialConfig?: Partial<WorldConfig>,
): WorldState {
  const normalizedSeed = normalizeSeed(seed);
  const config = normalizeConfig(partialConfig);
  const tileCount = config.width * config.height;
  const stream = new Xoshiro128StarStar(deriveXoshiro128State(normalizedSeed, 'world-generation'));
  const keys = [stream.nextUint32(), stream.nextUint32(), stream.nextUint32(), stream.nextUint32()];
  const elevation = new Int16Array(tileCount);
  const water = new Uint8Array(tileCount);
  const temperature = new Int16Array(tileCount);
  const moisture = new Uint8Array(tileCount);
  const biome = new Uint8Array(tileCount);
  const freshWater = new Uint16Array(tileCount);
  const food = new Uint16Array(tileCount);
  const timber = new Uint16Array(tileCount);
  const stone = new Uint16Array(tileCount);
  const metal = new Uint16Array(tileCount);
  const habitability = new Uint8Array(tileCount);
  const hazard = new Uint8Array(tileCount);
  const plants = new Uint16Array(tileCount);
  const animals = new Uint16Array(tileCount);

  for (let y = 0; y < config.height; y += 1) {
    for (let x = 0; x < config.width; x += 1) {
      const index = y * config.width + x;
      const terrainNoise = Math.trunc((multiScaleNoise(keys, x, y, 0) * 1_000) / 65_535);
      const moistureNoise = Math.trunc((multiScaleNoise(keys, x, y, 3) * 255) / 65_535);
      const resourceNoise = coordinateHash(keys, x, y, 6);
      const latitude = Math.abs(y * 2 - (config.height - 1));
      const latitudePenalty = Math.trunc((latitude * 210) / Math.max(1, config.height - 1));
      const sanctuary = isSanctuary(config, x, y);
      const tileElevation = sanctuary ? 470 + (terrainNoise % 230) : terrainNoise;
      const tileWater =
        sanctuary || tileElevation >= 300 ? 0 : 1 + Math.trunc((300 - tileElevation) / 50);
      const tileTemperature = clamp(
        255 - latitudePenalty + ((resourceNoise >>> 8) % 61) - 30,
        -100,
        400,
      );
      const tileMoisture = clamp(moistureNoise + (tileWater > 0 ? 45 : 0), 0, 255);
      const tileBiome = biomeFor(tileElevation, tileWater, tileTemperature, tileMoisture);
      const nearWater = tileWater > 0 || (resourceNoise & 0x7) === 0;
      const tileFreshWater =
        tileWater > 0
          ? 700 + (resourceNoise % 301)
          : nearWater
            ? 80 + (resourceNoise % 260)
            : resourceNoise % 45;
      const tileFood =
        tileWater > 0
          ? 0
          : clamp(40 + tileMoisture + (resourceNoise % 70) - Math.trunc(tileElevation / 8), 0, 400);
      const tileTimber =
        tileBiome === Biome.Forest
          ? 260 + (resourceNoise % 241)
          : tileBiome === Biome.Wetland
            ? 110 + (resourceNoise % 130)
            : resourceNoise % 70;
      const tileStone = clamp(
        Math.trunc(tileElevation / 2) + ((resourceNoise >>> 16) % 100),
        0,
        600,
      );
      const tileMetal =
        tileElevation > 430 ? (resourceNoise >>> 22) % 130 : (resourceNoise >>> 25) % 20;
      const tileHazard = clamp(
        tileWater > 0
          ? 190 + (resourceNoise % 66)
          : Math.max(0, tileElevation - 700) + (resourceNoise % 30),
        0,
        255,
      );
      const tileHabitability =
        tileWater > 0
          ? 0
          : clamp(
              100 + Math.trunc(tileFood / 2) + Math.trunc(tileFreshWater / 6) - tileHazard,
              0,
              255,
            );

      elevation[index] = tileElevation;
      water[index] = tileWater;
      temperature[index] = tileTemperature;
      moisture[index] = tileMoisture;
      biome[index] = tileBiome;
      freshWater[index] = tileFreshWater;
      food[index] = tileFood;
      timber[index] = tileTimber;
      stone[index] = tileStone;
      metal[index] = tileMetal;
      habitability[index] = tileHabitability;
      hazard[index] = tileHazard;
      plants[index] = tileWater > 0 ? 0 : clamp(tileFood + Math.trunc(tileTimber / 2), 0, 600);
      animals[index] =
        tileWater > 0 ? 0 : clamp(Math.trunc(tileFood / 3) + (resourceNoise % 60), 0, 180);
    }
  }

  const hasFoundingTile = Array.from({ length: tileCount }, (_, index) => index).some(
    (index) =>
      water[index] === 0 && (habitability[index] ?? 0) >= 80 && (hazard[index] ?? 255) < 180,
  );
  if (!hasFoundingTile) {
    const index = Math.trunc(config.height / 2) * config.width + Math.trunc(config.width / 2);
    elevation[index] = Math.max(elevation[index] ?? 0, 160);
    water[index] = 0;
    biome[index] = Biome.Grassland;
    freshWater[index] = Math.max(freshWater[index] ?? 0, 120);
    food[index] = Math.max(food[index] ?? 0, 160);
    timber[index] = Math.max(timber[index] ?? 0, 80);
    stone[index] = Math.max(stone[index] ?? 0, 40);
    habitability[index] = Math.max(habitability[index] ?? 0, 100);
    hazard[index] = Math.min(hazard[index] ?? 255, 40);
    plants[index] = Math.max(plants[index] ?? 0, 180);
    animals[index] = Math.max(animals[index] ?? 0, 60);
  }

  const tiles: WorldTileFields = Object.freeze({
    elevation,
    water,
    temperature,
    moisture,
    biome,
    freshWater,
    food,
    timber,
    stone,
    metal,
    habitability,
    hazard,
    plants,
    animals,
  });
  const settlementTerrain: SettlementTerrain = Object.freeze({
    width: config.width,
    height: config.height,
    food,
    freshWater,
    timber,
    stone,
    habitability,
    hazard,
    isWalkable: (index: number) =>
      index >= 0 &&
      index < tileCount &&
      water[index] === 0 &&
      (habitability[index] ?? 0) >= 80 &&
      (hazard[index] ?? 255) < 180,
  });
  const civilization = createInitialCivilization(
    normalizedSeed,
    settlementTerrain,
    0,
    config.societyYearTicks,
  );
  const initialEvents: readonly WorldEvent[] = Object.freeze([
    Object.freeze({
      id: 1,
      tick: 0,
      kind: 'world-generated',
      summary: 'The founding world formed.',
      subjectKind: 'world',
      subjectId: 0,
      targetKind: 'world',
      targetId: 0,
      tileIndex: -1,
      amount: 0,
    }),
    Object.freeze({
      id: 2,
      tick: 0,
      kind: 'founders-arrived',
      summary: `${SETTLEMENT_FOUNDER_COUNT} named founders established the first settlement.`,
      subjectKind: 'world',
      subjectId: 0,
      targetKind: 'world',
      targetId: 0,
      tileIndex: civilization.centerTileIndex,
      amount: SETTLEMENT_FOUNDER_COUNT,
    }),
  ]);
  const foundedCivilization = attachFactualMemories(civilization, [initialEvents[1]!]);

  return Object.freeze({
    seed: Object.freeze(normalizedSeed),
    config,
    tick: 0,
    nextEventId: 3,
    eventLog: initialEvents,
    chunks: makeChunks(config),
    civilization: foundedCivilization,
    ...tiles,
    tiles,
  });
}

function settlementTerrain(state: WorldState): SettlementTerrain {
  return Object.freeze({
    width: state.config.width,
    height: state.config.height,
    food: state.food,
    freshWater: state.freshWater,
    timber: state.timber,
    stone: state.stone,
    habitability: state.habitability,
    hazard: state.hazard,
    isWalkable: (index: number) => isWalkableTile(state, index),
  });
}

/** Advances integer ticks and runs M3 systems only at deterministic action-pulse boundaries. */
export function stepWorld(state: WorldState, ticks = 1): WorldState {
  if (!Number.isSafeInteger(ticks) || ticks < 0 || state.tick + ticks > Number.MAX_SAFE_INTEGER) {
    throw new RangeError('World tick advancement must remain a non-negative safe integer.');
  }
  if (ticks === 0) {
    return state;
  }

  const endingTick = state.tick + ticks;
  let next = state;
  let pulseTick =
    (Math.floor(state.tick / SETTLEMENT_ACTION_PULSE_TICKS) + 1) * SETTLEMENT_ACTION_PULSE_TICKS;
  while (pulseTick <= endingTick) {
    const terrain = settlementTerrain(next);
    const pulse = advanceCivilization(next.civilization, terrain, pulseTick);
    next = Object.freeze({ ...next, tick: pulseTick, civilization: pulse.civilization });
    const createdEvents: WorldEvent[] = [];
    for (const draft of pulse.events) {
      next = appendWorldEvent(next, draft.kind, pulseTick, draft);
      createdEvents.push(next.eventLog.at(-1)!);
    }
    next = Object.freeze({
      ...next,
      civilization: Object.freeze({
        ...attachFactualMemories(next.civilization, createdEvents),
        society: attachSocietyBiographyEventIds(
          next.civilization.society,
          createdEvents.map((event): SocietyAuthoritativeEvent =>
            Object.freeze({
              id: event.id,
              kind: event.kind,
              summary: event.summary,
              subject: Object.freeze({ kind: event.subjectKind, id: event.subjectId }),
              target: Object.freeze({ kind: event.targetKind, id: event.targetId }),
            }),
          ),
        ),
      }),
    });
    assertWorldInvariants(next);
    pulseTick += SETTLEMENT_ACTION_PULSE_TICKS;
  }
  return next.tick === endingTick ? next : Object.freeze({ ...next, tick: endingTick });
}

/** Appends one factual event with the next stable id to an immutable world snapshot. */
export function appendWorldEvent(
  state: WorldState,
  kind: string,
  eventTick = state.tick,
  details: WorldEventDetails = {},
): WorldState {
  if (kind.length === 0 || kind.length > 64) {
    throw new RangeError('World event kind must contain 1 through 64 characters.');
  }
  if (
    !Number.isSafeInteger(eventTick) ||
    eventTick < 0 ||
    eventTick > state.tick ||
    !Number.isSafeInteger(state.nextEventId) ||
    state.nextEventId < 1 ||
    state.nextEventId >= Number.MAX_SAFE_INTEGER
  ) {
    throw new RangeError('World event id and tick must remain valid safe integers.');
  }
  const subjectId = details.subjectId ?? 0;
  const subjectKind = details.subjectKind ?? 'world';
  const targetId = details.targetId ?? 0;
  const targetKind = details.targetKind ?? 'world';
  const tileIndex = details.tileIndex ?? -1;
  const amount = details.amount ?? 0;
  const summary = details.summary ?? `Recorded ${kind} at tick ${eventTick}.`;
  if (
    !isEntityKind(subjectKind) ||
    !isEntityKind(targetKind) ||
    !Number.isSafeInteger(subjectId) ||
    subjectId < 0 ||
    !Number.isSafeInteger(targetId) ||
    targetId < 0 ||
    !Number.isSafeInteger(tileIndex) ||
    tileIndex < -1 ||
    tileIndex >= state.config.width * state.config.height ||
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    summary.length < 1 ||
    summary.length > 160 ||
    (subjectKind === 'world' ? subjectId !== 0 : subjectId === 0) ||
    (targetKind === 'world' ? targetId !== 0 : targetId === 0) ||
    !worldReferenceExists(state, subjectKind, subjectId) ||
    !worldReferenceExists(state, targetKind, targetId)
  ) {
    throw new RangeError('World event references must be canonical non-negative IDs and amounts.');
  }
  const event = Object.freeze({
    id: state.nextEventId,
    tick: eventTick,
    kind,
    summary,
    subjectKind,
    subjectId,
    targetKind,
    targetId,
    tileIndex,
    amount,
  });
  return Object.freeze({
    ...state,
    nextEventId: state.nextEventId + 1,
    eventLog: Object.freeze([...state.eventLog, event]),
  });
}

const SUPPLY_SHORTAGE_COLLAPSE_SEVERITY = 75;

function shortageRemainder(value: number, severity: number, protectedAmount = 0): number {
  const removed = Math.max(1, Math.ceil((value * severity) / 100));
  return Math.max(Math.min(value, protectedAmount), value - removed);
}

/**
 * Applies a recorded M4 economic supply shock without advancing logical time.
 * Recovery, migration, and mortality remain consequences of subsequent normal pulses.
 */
export function applyRecordedSupplyShortage(state: WorldState, severity: number): WorldState {
  assertWorldInvariants(state);
  if (!Number.isSafeInteger(severity) || severity < 1 || severity > 100) {
    throw new RangeError('Supply shortage severity must be an integer from 1 through 100.');
  }
  const stockpile = Object.freeze({
    food: shortageRemainder(state.civilization.stockpile.food, severity),
    water: shortageRemainder(state.civilization.stockpile.water, severity),
    timber: shortageRemainder(state.civilization.stockpile.timber, severity),
    stone: shortageRemainder(state.civilization.stockpile.stone, severity),
  });
  const households = Object.freeze(
    state.civilization.society.households.map((household) =>
      Object.freeze({
        ...household,
        meals: shortageRemainder(household.meals, severity, household.id % 2),
        tools: shortageRemainder(household.tools, severity, (household.id + 1) % 2),
      }),
    ),
  );
  const healthLoss = Math.max(1, severity - 1);
  const agents = Object.freeze(
    state.civilization.agents.map((agent) =>
      !agent.alive
        ? agent
        : Object.freeze({
            ...agent,
            hunger: clamp(agent.hunger + severity, 0, 100),
            thirst: clamp(agent.thirst + severity, 0, 100),
            health: Math.max(1, agent.health - healthLoss),
          }),
    ),
  );
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const people = Object.freeze(
    state.civilization.society.people.map((person) => {
      const agent = agentById.get(person.id);
      return agent === undefined
        ? person
        : Object.freeze({ ...person, alive: agent.alive, health: agent.health });
    }),
  );
  let damaged = false;
  const structures = Object.freeze(
    state.civilization.structures.map((structure) => {
      if (damaged || structure.kind !== 'shelter' || structure.status !== 'operational') {
        return structure;
      }
      damaged = true;
      const condition = clamp(structure.condition - Math.max(1, severity * 6), 0, 1_000);
      return Object.freeze({
        ...structure,
        condition,
        status: condition <= 150 ? 'damaged' : 'operational',
        changedTick: state.tick,
      });
    }),
  );
  const enteredCollapse =
    !state.civilization.society.collapsed && severity >= SUPPLY_SHORTAGE_COLLAPSE_SEVERITY;
  const society = Object.freeze({
    ...state.civilization.society,
    people,
    households,
    scarcity: Math.max(state.civilization.society.scarcity, severity),
    stability: clamp(state.civilization.society.stability - severity, 0, 100),
    collapsed:
      state.civilization.society.collapsed || severity >= SUPPLY_SHORTAGE_COLLAPSE_SEVERITY,
    operationCount: state.civilization.society.operationCount + 1,
  });
  const shocked: WorldState = Object.freeze({
    ...state,
    civilization: Object.freeze({
      ...state.civilization,
      stockpile,
      agents,
      structures,
      society,
      operationCount: state.civilization.operationCount + 1,
    }),
  });
  assertWorldInvariants(shocked);
  let recorded = appendWorldEvent(shocked, 'supply-shortage', state.tick, {
    summary: `A recorded supply shortage of severity ${severity} depleted settlement stores.`,
    subjectKind: 'world',
    subjectId: 0,
    targetKind: 'institution',
    targetId: society.institution.id,
    tileIndex: state.civilization.centerTileIndex,
    amount: severity,
  });
  if (enteredCollapse) {
    recorded = appendWorldEvent(recorded, 'settlement-collapsed', state.tick, {
      summary: 'The settlement collapsed under a recorded supply shortage.',
      subjectKind: 'institution',
      subjectId: society.institution.id,
      targetKind: 'world',
      targetId: 0,
      tileIndex: state.civilization.centerTileIndex,
      amount: severity,
    });
  }
  assertWorldInvariants(recorded);
  return recorded;
}

export function tileIndex(state: WorldState, x: number, y: number): number {
  if (
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= state.config.width ||
    y >= state.config.height
  ) {
    throw new RangeError('Tile coordinates are outside the world.');
  }
  return y * state.config.width + x;
}

export function tileCoordinates(state: WorldState, index: number): readonly [number, number] {
  if (!Number.isSafeInteger(index) || index < 0 || index >= state.elevation.length) {
    throw new RangeError('Tile index is outside the world.');
  }
  return [index % state.config.width, Math.trunc(index / state.config.width)];
}

export function isWalkableTile(state: WorldState, index: number): boolean {
  if (!Number.isSafeInteger(index) || index < 0 || index >= state.elevation.length) {
    return false;
  }
  const water = state.water[index];
  const habitability = state.habitability[index];
  const hazard = state.hazard[index];
  return (
    water === 0 &&
    habitability !== undefined &&
    habitability >= 80 &&
    hazard !== undefined &&
    hazard < 180
  );
}

export function assertWorldInvariants(state: WorldState): void {
  assertCivilizationInvariants(state.civilization, settlementTerrain(state));
  const agentIds = new Set(state.civilization.agents.map((agent) => agent.id));
  const structureIds = new Set(state.civilization.structures.map((structure) => structure.id));
  const householdIds = new Set(
    state.civilization.society.households.map((household) => household.id),
  );
  const cultureIds = new Set(state.civilization.society.cultures.map((culture) => culture.id));
  const groupIds = new Set(state.civilization.society.groups.map((group) => group.id));
  const institutionIds = new Set([state.civilization.society.institution.id]);
  const referenceExists = (kind: EntityKind, id: number): boolean => {
    switch (kind) {
      case 'world':
        return id === 0;
      case 'person':
        return agentIds.has(id);
      case 'structure':
        return structureIds.has(id);
      case 'household':
        return householdIds.has(id);
      case 'culture':
        return cultureIds.has(id);
      case 'group':
        return groupIds.has(id);
      case 'institution':
        return institutionIds.has(id);
    }
  };
  const eventsById = new Map<number, WorldEvent>();
  let previousEventId = 0;
  for (const event of state.eventLog) {
    if (
      !Number.isSafeInteger(event.id) ||
      event.id <= previousEventId ||
      !Number.isSafeInteger(event.tick) ||
      event.tick < 0 ||
      event.tick > state.tick ||
      typeof event.kind !== 'string' ||
      event.kind.length < 1 ||
      event.kind.length > 64 ||
      typeof event.summary !== 'string' ||
      event.summary.length < 1 ||
      event.summary.length > 160 ||
      !Number.isSafeInteger(event.subjectId) ||
      event.subjectId < 0 ||
      !Number.isSafeInteger(event.targetId) ||
      event.targetId < 0 ||
      !Number.isSafeInteger(event.tileIndex) ||
      event.tileIndex < -1 ||
      event.tileIndex >= state.config.width * state.config.height ||
      !Number.isSafeInteger(event.amount) ||
      event.amount < 0
    )
      throw new Error('World event invariant failed.');
    if (!referenceExists(event.subjectKind, event.subjectId))
      throw new Error('World event subject is invalid.');
    if (!referenceExists(event.targetKind, event.targetId))
      throw new Error('World event target is invalid.');
    eventsById.set(event.id, event);
    previousEventId = event.id;
  }
  for (const agent of state.civilization.agents) {
    for (const memory of agent.memories) {
      const sourceEvent = eventsById.get(memory.eventId);
      if (
        memory.tick !== sourceEvent?.tick ||
        memory.kind !== sourceEvent?.kind ||
        memory.summary !== sourceEvent?.summary ||
        memory.targetKind !== sourceEvent?.targetKind ||
        memory.targetId !== sourceEvent?.targetId
      ) {
        throw new Error('Agent memory must match its factual source event.');
      }
    }
  }
  for (const person of state.civilization.society.people) {
    let previousBiographyId = 0;
    for (const eventId of person.biographyEventIds) {
      const sourceEvent = eventsById.get(eventId);
      if (
        eventId <= previousBiographyId ||
        sourceEvent === undefined ||
        (sourceEvent.subjectKind !== 'person' && sourceEvent.targetKind !== 'person') ||
        (sourceEvent.subjectId !== person.id && sourceEvent.targetId !== person.id)
      )
        throw new Error('Society biography must reference a matching factual world event.');
      previousBiographyId = eventId;
    }
  }
  if (!Number.isSafeInteger(state.nextEventId) || state.nextEventId <= previousEventId)
    throw new Error('World nextEventId is invalid.');
}

/** Canonical DTO JSON with fixed key and array order, suitable for durable snapshots and hashes. */
export function canonicalWorldJson(state: WorldState): string {
  const eventLog = [...state.eventLog].sort(compareEvents).map((event) => ({
    amount: event.amount,
    id: event.id,
    kind: event.kind,
    subjectKind: event.subjectKind,
    subjectId: event.subjectId,
    summary: event.summary,
    targetKind: event.targetKind,
    targetId: event.targetId,
    tick: event.tick,
    tileIndex: event.tileIndex,
  }));
  return JSON.stringify({
    animals: arrayDto(state.animals),
    biome: arrayDto(state.biome),
    chunks: state.chunks.map((chunk) => ({
      height: chunk.height,
      id: chunk.id,
      width: chunk.width,
      x: chunk.x,
      y: chunk.y,
    })),
    civilization: civilizationDto(state.civilization),
    config: {
      chunkSize: state.config.chunkSize,
      height: state.config.height,
      societyYearTicks: state.config.societyYearTicks,
      width: state.config.width,
    },
    elevation: arrayDto(state.elevation),
    eventLog,
    food: arrayDto(state.food),
    freshWater: arrayDto(state.freshWater),
    habitability: arrayDto(state.habitability),
    hazard: arrayDto(state.hazard),
    metal: arrayDto(state.metal),
    moisture: arrayDto(state.moisture),
    nextEventId: state.nextEventId,
    plants: arrayDto(state.plants),
    seed: [...state.seed],
    stone: arrayDto(state.stone),
    temperature: arrayDto(state.temperature),
    tick: state.tick,
    timber: arrayDto(state.timber),
    water: arrayDto(state.water),
  });
}

export function hashWorldState(state: WorldState): string {
  return hashCanonicalJson(canonicalWorldJson(state));
}
