import { hashCanonicalJson } from '../canonical';
import {
  advanceCivilizations,
  assertCivilizationsInvariants,
  civilizationsDto,
  createInitialCivilizations,
  selectCoMigrationPerson,
  selectConflictTargetCivilization,
  selectPoliticalSupportCivilization,
  selectRefugeeSupportSettlement,
  type CivilizationEventDraft,
  type CivilizationsContext,
  type CivilizationsInitialization,
  type CivilizationsState,
  type CommunityReserves,
} from '../civilizations';
import {
  advanceDevelopment,
  assertDevelopmentInvariants,
  createInitialDevelopment,
  developmentDto,
  queueIntervention,
  type DevelopmentContext,
  type DevelopmentEvent,
  type DevelopmentInterventionInput,
  type DevelopmentResult,
  type DevelopmentState,
  type DisasterKind,
} from '../development';
import { deriveXoshiro128State, Xoshiro128StarStar } from '../random';
import {
  childArrivalEligibilityEvidenceMatchesRecord,
  childArrivalEligibilityEventMatches,
  findActiveRelationship,
  synchronizeInterpersonalPeople,
  type ChildArrivalEligibilityEvidence,
} from '../relationships';
import {
  applyRelationshipExperience,
  relationshipDecisionInfluence,
} from '../relationships/lifecycle';
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
  readonly childArrivalEligibility?: ChildArrivalEligibilityEvidence;
}

export interface WorldEventDetails {
  readonly summary?: string;
  readonly subjectKind?: EntityKind;
  readonly subjectId?: number;
  readonly targetKind?: EntityKind;
  readonly targetId?: number;
  readonly tileIndex?: number;
  readonly amount?: number;
  readonly childArrivalEligibility?: ChildArrivalEligibilityEvidence;
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
  readonly civilizations: CivilizationsState;
  readonly development: DevelopmentState;
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
  'settlement',
  'civilization',
  'route',
  'conflict',
  'ruin',
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
    case 'settlement':
      return state.civilizations.settlements.some((settlement) => settlement.id === id);
    case 'civilization':
      return state.civilizations.civilizations.some((civilization) => civilization.id === id);
    case 'route':
      return state.civilizations.routes.some((route) => route.id === id);
    case 'conflict':
      return state.civilizations.conflicts.some((conflict) => conflict.id === id);
    case 'ruin':
      return state.civilizations.ruins.some((ruin) => ruin.id === id);
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

export type CivilizationsWorldSource = Pick<
  WorldState,
  'seed' | 'config' | 'tick' | 'civilization'
>;

/** Canonical one-settlement baseline used by both new worlds and v5 migration. */
export function civilizationsInitializationForWorld(
  state: CivilizationsWorldSource,
): CivilizationsInitialization {
  const culture = [...state.civilization.society.cultures].sort(
    (left, right) => left.id - right.id,
  )[0];
  if (culture === undefined) throw new Error('A founding culture is required.');
  return Object.freeze({
    worldWidth: state.config.width,
    worldHeight: state.config.height,
    settlementName: `${culture.name} Hearth`,
    civilizationName: `${culture.name} People`,
    centerTileIndex: state.civilization.centerTileIndex,
    cultureId: culture.id,
    personIds: Object.freeze(
      state.civilization.society.people.map((person) => person.id).sort((a, b) => a - b),
    ),
    householdIds: Object.freeze(
      state.civilization.society.households.map((household) => household.id).sort((a, b) => a - b),
    ),
    reserves: Object.freeze({
      food: state.civilization.stockpile.food,
      water: state.civilization.stockpile.water,
      timber: state.civilization.stockpile.timber,
      stone: state.civilization.stockpile.stone,
      metal: 0,
    }),
    stability: state.civilization.society.stability,
  });
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
  const civilizations = createInitialCivilizations(
    normalizedSeed,
    0,
    civilizationsInitializationForWorld({
      seed: normalizedSeed,
      config,
      tick: 0,
      civilization: foundedCivilization,
    }),
  );

  return Object.freeze({
    seed: Object.freeze(normalizedSeed),
    config,
    tick: 0,
    nextEventId: 3,
    eventLog: initialEvents,
    chunks: makeChunks(config),
    civilization: foundedCivilization,
    civilizations,
    development: createInitialDevelopment(normalizedSeed, 0),
    ...tiles,
    tiles,
  });
}

const DEVELOPMENT_TERRAIN_SAMPLE_BUDGET = 256;

function sampledTileIndexes(state: WorldState): readonly number[] {
  const tileCount = state.config.width * state.config.height;
  const count = Math.min(DEVELOPMENT_TERRAIN_SAMPLE_BUDGET, tileCount);
  return Object.freeze(
    Array.from({ length: count }, (_, index) => Math.floor((index * tileCount) / count)),
  );
}

function percent(count: number, total: number): number {
  return total === 0 ? 0 : Math.floor((count * 100) / total);
}

export function findResourceDepletionAt(
  entries: WorldState['civilization']['resourceDepletion'],
  tileIndex: number,
): (typeof entries)[number] | undefined {
  let low = 0;
  let high = entries.length - 1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const entry = entries[middle]!;
    if (entry.tileIndex === tileIndex) return entry;
    if (entry.tileIndex < tileIndex) low = middle + 1;
    else high = middle - 1;
  }
  return undefined;
}

function developmentContext(state: WorldState, tick: number): DevelopmentContext {
  const indexes = sampledTileIndexes(state);
  const land = indexes.filter((index) => state.water[index] === 0);
  const householdByPersonId = new Map(
    state.civilization.society.people.map((person) => [person.id, person.householdId] as const),
  );
  const depletion = indexes.reduce((total, index) => {
    const entry = findResourceDepletionAt(state.civilization.resourceDepletion, index);
    return total + (entry?.food ?? 0) + (entry?.timber ?? 0) + (entry?.stone ?? 0);
  }, 0);
  const recentConflictEvents = state.eventLog
    .slice(-256)
    .filter(
      (event) =>
        event.tick > tick - state.config.societyYearTicks &&
        ['conflict', 'theft', 'family-estranged'].includes(event.kind),
    ).length;
  const society = state.civilization.society;
  return Object.freeze({
    tick,
    yearTicks: state.config.societyYearTicks,
    worldWidth: state.config.width,
    worldHeight: state.config.height,
    centerTileIndex: state.civilization.centerTileIndex,
    people: Object.freeze(
      state.civilization.agents.map((agent) =>
        Object.freeze({
          id: agent.id,
          alive: agent.alive,
          health: agent.health,
          tileIndex: agent.tileIndex,
          householdId: householdByPersonId.get(agent.id) ?? 0,
          traits: agent.traits,
          skills: agent.skills,
        }),
      ),
    ),
    interpersonal: society.interpersonal,
    stockpile: Object.freeze({
      ...state.civilization.stockpile,
      metal: Math.floor(
        indexes.reduce((total, index) => total + (state.metal[index] ?? 0), 0) /
          Math.max(1, indexes.length),
      ),
    }),
    operationalStructures: state.civilization.structures.filter(
      (structure) => structure.status === 'operational',
    ).length,
    damagedStructures: state.civilization.structures.filter(
      (structure) => structure.status === 'damaged',
    ).length,
    tradeVolume: society.offers.reduce((total, offer) => total + offer.fulfilledAmount, 0),
    institutionCount: 1 + society.groups.length,
    stability: society.stability,
    scarcity: society.scarcity,
    inequality: society.inequality,
    collapsed: society.collapsed,
    conflictEvents: recentConflictEvents,
    terrain: Object.freeze({
      dryLandRatio: percent(
        land.filter((index) => (state.moisture[index] ?? 0) < 100).length,
        land.length,
      ),
      floodExposure: percent(
        indexes.filter(
          (index) => (state.freshWater[index] ?? 0) > 0 || (state.moisture[index] ?? 0) >= 75,
        ).length,
        indexes.length,
      ),
      forestRatio: percent(
        land.filter((index) => state.biome[index] === Biome.Forest).length,
        land.length,
      ),
      stormExposure: percent(
        indexes.filter(
          (index) => (state.moisture[index] ?? 0) >= 60 && (state.hazard[index] ?? 0) >= 60,
        ).length,
        indexes.length,
      ),
      seismicity: percent(
        indexes.filter(
          (index) => state.biome[index] === Biome.Mountain || (state.hazard[index] ?? 0) >= 160,
        ).length,
        indexes.length,
      ),
      resourceDepletion: Math.min(100, Math.floor(depletion / Math.max(1, indexes.length))),
    }),
  });
}

function developmentSummary(event: DevelopmentEvent, development: DevelopmentState): string {
  if (event.kind === 'knowledge-discovered')
    return `${event.knowledgeId ?? 'Knowledge'} was discovered through contextual experimentation.`;
  if (event.kind === 'knowledge-recovered')
    return `${event.knowledgeId ?? 'Knowledge'} was recovered through renewed practice.`;
  if (event.kind === 'knowledge-lost')
    return `${event.knowledgeId ?? 'Knowledge'} was lost during social or resource collapse.`;
  if (event.kind.endsWith('-intervened'))
    return `A ${event.kind.slice(0, -'-intervened'.length)} intervention altered conditions near tile ${event.targetTileIndex ?? -1}.`;
  if (event.kind.endsWith('-started')) {
    const crisis = development.activeCrises.find((candidate) => candidate.id === event.crisisId);
    return crisis === undefined
      ? `${event.kind.slice(0, -'-started'.length)} conditions became critical.`
      : `A ${crisis.kind} began after ${crisis.triggerCondition} reached ${crisis.triggerValue}.`;
  }
  if (event.kind.endsWith('-recovered'))
    return `The settlement recovered autonomously from the ${event.kind.slice(0, -'-recovered'.length)}.`;
  return `Development conditions changed through ${event.kind}.`;
}

function crisisKindsStarted(
  prior: DevelopmentState,
  next: DevelopmentState,
): readonly DisasterKind[] {
  const priorIds = new Set(prior.activeCrises.map((crisis) => crisis.id));
  return Object.freeze(
    next.activeCrises.filter((crisis) => !priorIds.has(crisis.id)).map((crisis) => crisis.kind),
  );
}

function applyDevelopmentResult(
  state: WorldState,
  result: DevelopmentResult,
  tick: number,
): { readonly state: WorldState; readonly events: readonly WorldEvent[] } {
  const started = crisisKindsStarted(state.development, result.state);
  const clampByte = (value: number): number => clamp(value, 0, 255);
  const clampResource = (value: number): number => clamp(value, 0, 65_535);
  const center = state.civilization.centerTileIndex;
  const moisture = state.moisture.slice();
  const hazard = state.hazard.slice();
  const food = state.food.slice();
  const timber = state.timber.slice();
  const stone = state.stone.slice();
  const metal = state.metal.slice();
  const plants = state.plants.slice();
  const animals = state.animals.slice();
  let politicalLoss = 0;
  for (const kind of started) {
    const severity =
      result.state.activeCrises.find((crisis) => crisis.kind === kind)?.severity ?? 1;
    hazard[center] = clampByte((hazard[center] ?? 0) + severity * 2);
    switch (kind) {
      case 'drought':
        moisture[center] = clampByte((moisture[center] ?? 0) - severity * 3);
        food[center] = clampResource((food[center] ?? 0) - severity);
        plants[center] = clampResource((plants[center] ?? 0) - severity * 2);
        break;
      case 'flood':
        moisture[center] = clampByte((moisture[center] ?? 0) + severity * 3);
        food[center] = clampResource((food[center] ?? 0) - severity);
        break;
      case 'fire':
        timber[center] = clampResource((timber[center] ?? 0) - severity * 2);
        plants[center] = clampResource((plants[center] ?? 0) - severity * 2);
        animals[center] = clampResource((animals[center] ?? 0) - severity);
        break;
      case 'storm':
        moisture[center] = clampByte((moisture[center] ?? 0) + severity);
        break;
      case 'earthquake':
        stone[center] = clampResource((stone[center] ?? 0) - severity);
        break;
      case 'disease':
        animals[center] = clampResource((animals[center] ?? 0) - severity);
        break;
      case 'famine':
        food[center] = clampResource((food[center] ?? 0) - severity * 2);
        break;
      case 'resource-collapse':
        food[center] = clampResource((food[center] ?? 0) - severity);
        timber[center] = clampResource((timber[center] ?? 0) - severity);
        stone[center] = clampResource((stone[center] ?? 0) - severity);
        metal[center] = clampResource((metal[center] ?? 0) - severity);
        break;
      case 'political-crisis':
        politicalLoss += severity;
        break;
      case 'technological-accident':
        metal[center] = clampResource((metal[center] ?? 0) - severity);
        break;
      case 'meteor-impact':
        food[center] = clampResource((food[center] ?? 0) - severity * 2);
        timber[center] = clampResource((timber[center] ?? 0) - severity * 2);
        plants[center] = clampResource((plants[center] ?? 0) - severity * 2);
        animals[center] = clampResource((animals[center] ?? 0) - severity * 2);
        break;
    }
  }
  const losses = result.effects.stockpileLoss;
  const stockpile = Object.freeze({
    food: Math.max(0, state.civilization.stockpile.food - losses.food),
    water: Math.max(0, state.civilization.stockpile.water - losses.water),
    timber: Math.max(0, state.civilization.stockpile.timber - losses.timber),
    stone: Math.max(0, state.civilization.stockpile.stone - losses.stone),
  });
  const healthDamage = new Map(
    result.effects.personHealthDamage.map((patch) => [patch.personId, patch.amount] as const),
  );
  const lethalCrisis = started.includes('meteor-impact');
  const agents = Object.freeze(
    state.civilization.agents.map((agent) => {
      const damage = healthDamage.get(agent.id) ?? 0;
      if (!agent.alive || damage === 0) return agent;
      const health = Math.max(lethalCrisis ? 0 : 1, agent.health - damage);
      return Object.freeze({
        ...agent,
        alive: health > 0,
        health,
        action: health > 0 ? agent.action : ('idle' as const),
        carryingKind: health > 0 ? agent.carryingKind : ('none' as const),
        carryingAmount: health > 0 ? agent.carryingAmount : 0,
        plan: health > 0 ? agent.plan : Object.freeze([]),
        planIndex: health > 0 ? agent.planIndex : 0,
        route: health > 0 ? agent.route : Object.freeze([]),
        routeCursor: health > 0 ? agent.routeCursor : 0,
      });
    }),
  );
  const priorLivingIds = new Set(
    state.civilization.agents.filter((agent) => agent.alive).map((agent) => agent.id),
  );
  const agentById = new Map(agents.map((agent) => [agent.id, agent] as const));
  const killedIds = new Set(
    agents.filter((agent) => !agent.alive && priorLivingIds.has(agent.id)).map((agent) => agent.id),
  );
  let remainingStructureDamage = result.effects.structureDamage * 10;
  const structures = Object.freeze(
    state.civilization.structures.map((structure) => {
      if (remainingStructureDamage <= 0 || structure.status !== 'operational') return structure;
      const applied = Math.min(remainingStructureDamage, structure.condition);
      remainingStructureDamage -= applied;
      const condition = structure.condition - applied;
      return Object.freeze({
        ...structure,
        condition,
        status: condition <= 150 ? ('damaged' as const) : structure.status,
        changedTick: tick,
      });
    }),
  );
  const crisisPeople = Object.freeze(
    state.civilization.society.people.map((person) => {
      const agent = agentById.get(person.id);
      if (agent === undefined || (person.alive === agent.alive && person.health === agent.health))
        return person;
      return Object.freeze({
        ...person,
        alive: agent.alive,
        health: agent.health,
        deathTick: agent.alive ? person.deathTick : tick,
      });
    }),
  );
  const relationshipPeople = crisisPeople.map((person) => ({
    id: person.id,
    alive: person.alive,
    birthTick: person.birthTick,
    parentIds: person.parentIds,
    householdId: person.householdId,
  }));
  let interpersonal = state.civilization.society.interpersonal;
  for (const experience of result.relationshipExperiences)
    interpersonal = applyRelationshipExperience(interpersonal, relationshipPeople, experience);
  interpersonal = synchronizeInterpersonalPeople(interpersonal, tick, relationshipPeople);
  const responseFacts = result.responses.flatMap((response) => {
    const helper = state.civilization.society.people.find(
      (person) => person.id === response.helperPersonId,
    );
    const recipient = state.civilization.society.people.find(
      (person) => person.id === response.recipientPersonId,
    );
    if (helper === undefined || recipient === undefined) return [];
    const summary = `${helper.name} gave ${response.kind} to ${recipient.name} during the ${response.crisisKind}.`;
    return [
      Object.freeze({
        personId: helper.id,
        kind: 'crisis-assisted',
        source: Object.freeze({ kind: 'person' as const, id: helper.id }),
        target: Object.freeze({ kind: 'person' as const, id: recipient.id }),
        summary,
      }),
      Object.freeze({
        personId: recipient.id,
        kind: 'crisis-assisted',
        source: Object.freeze({ kind: 'person' as const, id: helper.id }),
        target: Object.freeze({ kind: 'person' as const, id: recipient.id }),
        summary,
      }),
    ];
  });
  const deathFacts = crisisPeople
    .filter((person) => killedIds.has(person.id))
    .map((person) =>
      Object.freeze({
        personId: person.id,
        kind: 'person-died',
        source: Object.freeze({ kind: 'person' as const, id: person.id }),
        target: Object.freeze({ kind: 'household' as const, id: person.householdId }),
        summary: `${person.name} died during modeled crisis conditions.`,
      }),
    );
  const households = Object.freeze(
    state.civilization.society.households.map((household) =>
      Object.freeze({
        ...household,
        adultIds: Object.freeze(household.adultIds.filter((id) => !killedIds.has(id))),
      }),
    ),
  );
  const groups = Object.freeze(
    state.civilization.society.groups.map((group) =>
      Object.freeze({
        ...group,
        memberIds: Object.freeze(group.memberIds.filter((id) => !killedIds.has(id))),
      }),
    ),
  );
  const institution = killedIds.has(state.civilization.society.institution.leaderId)
    ? Object.freeze({ ...state.civilization.society.institution, leaderId: 0, changedTick: tick })
    : state.civilization.society.institution;
  const society = Object.freeze({
    ...state.civilization.society,
    people: crisisPeople,
    households,
    groups,
    institution,
    interpersonal,
    scarcity: clamp(state.civilization.society.scarcity + started.length * 3, 0, 100),
    stability: clamp(state.civilization.society.stability - politicalLoss, 0, 100),
    pendingBiographyFacts: Object.freeze([
      ...state.civilization.society.pendingBiographyFacts,
      ...responseFacts,
      ...deathFacts,
    ]),
    operationCount:
      state.civilization.society.operationCount +
      result.relationshipExperiences.length +
      result.responses.length +
      killedIds.size,
  });
  const tileFields: WorldTileFields = Object.freeze({
    elevation: state.elevation,
    water: state.water,
    temperature: state.temperature,
    moisture,
    biome: state.biome,
    freshWater: state.freshWater,
    food,
    timber,
    stone,
    metal,
    habitability: state.habitability,
    hazard,
    plants,
    animals,
  });
  let next: WorldState = Object.freeze({
    ...state,
    tick,
    development: result.state,
    civilization: Object.freeze({
      ...state.civilization,
      stockpile,
      agents,
      structures,
      society,
      operationCount: state.civilization.operationCount + 1,
    }),
    ...tileFields,
    tiles: tileFields,
  });
  const created: WorldEvent[] = [];
  for (const event of result.events) {
    next = appendWorldEvent(next, event.kind, tick, {
      summary: developmentSummary(event, result.state),
      subjectKind: event.subjectKind,
      subjectId: event.subjectId,
      targetKind: 'world',
      targetId: 0,
      tileIndex: event.targetTileIndex ?? center,
      amount: event.amount,
    });
    created.push(next.eventLog.at(-1)!);
  }
  for (const response of result.responses) {
    const helper = society.people.find((person) => person.id === response.helperPersonId)!;
    const recipient = society.people.find((person) => person.id === response.recipientPersonId)!;
    next = appendWorldEvent(next, 'crisis-assisted', tick, {
      summary: `${helper.name} gave ${response.kind} to ${recipient.name} during the ${response.crisisKind}.`,
      subjectKind: 'person',
      subjectId: helper.id,
      targetKind: 'person',
      targetId: recipient.id,
      tileIndex: recipient.tileIndex,
      amount: response.amount,
    });
    created.push(next.eventLog.at(-1)!);
  }
  for (const person of crisisPeople.filter((candidate) => killedIds.has(candidate.id))) {
    next = appendWorldEvent(next, 'person-died', tick, {
      summary: `${person.name} died during modeled crisis conditions.`,
      subjectKind: 'person',
      subjectId: person.id,
      targetKind: 'household',
      targetId: person.householdId,
      tileIndex: agentById.get(person.id)?.tileIndex ?? center,
      amount: 0,
    });
    created.push(next.eventLog.at(-1)!);
  }
  return Object.freeze({ state: next, events: Object.freeze(created) });
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

function societyAuthoritativeEvent(event: WorldEvent): SocietyAuthoritativeEvent {
  return Object.freeze({
    id: event.id,
    tick: event.tick,
    kind: event.kind,
    summary: event.summary,
    subject: Object.freeze({ kind: event.subjectKind, id: event.subjectId }),
    target: Object.freeze({ kind: event.targetKind, id: event.targetId }),
    ...(event.childArrivalEligibility === undefined
      ? {}
      : { childArrivalEligibility: event.childArrivalEligibility }),
  });
}

function biographyHistoricalSources(
  state: WorldState,
  sourceEvents: readonly SocietyAuthoritativeEvent[],
): readonly SocietyAuthoritativeEvent[] {
  const ids = new Set(sourceEvents.map((source) => source.id));
  for (const person of state.civilization.society.people)
    for (const id of person.biographyEventIds) ids.add(id);
  return Object.freeze(
    [...ids]
      .sort((left, right) => left - right)
      .map((id) => {
        const event = state.eventLog[id - 1];
        if (event?.id !== id)
          throw new Error(
            'Biography event id must reference the retained authoritative event log.',
          );
        return societyAuthoritativeEvent(event);
      }),
  );
}

const M6_FOUNDING_SITE_SAMPLES = 64;

function communityReservesFromFounding(state: WorldState): CommunityReserves {
  return Object.freeze({
    food: state.civilization.stockpile.food,
    water: state.civilization.stockpile.water,
    timber: state.civilization.stockpile.timber,
    stone: state.civilization.stockpile.stone,
    metal: 0,
  });
}

function m6Profile(state: WorldState): 'cooperative' | 'coexistence' | 'expansionist' | 'volatile' {
  const value = state.seed[0] % 64;
  if (value < 16) return 'cooperative';
  if (value < 32) return 'coexistence';
  if (value < 48) return 'expansionist';
  return 'volatile';
}

function nextFoundingSite(state: WorldState): number | null {
  const tileCount = state.config.width * state.config.height;
  const origin = state.civilization.centerTileIndex;
  const originX = origin % state.config.width;
  const originY = Math.trunc(origin / state.config.width);
  let best: { index: number; score: number } | null = null;
  const samples = Math.min(tileCount, M6_FOUNDING_SITE_SAMPLES);
  for (let sample = 0; sample < samples; sample += 1) {
    const index = Math.floor((sample * tileCount) / samples);
    if (!isWalkableTile(state, index) || state.civilizations.tileOwners[index] !== 0) continue;
    const x = index % state.config.width;
    const y = Math.trunc(index / state.config.width);
    const distance = Math.abs(x - originX) + Math.abs(y - originY);
    if (distance < Math.max(4, Math.trunc(Math.min(state.config.width, state.config.height) / 5)))
      continue;
    const score =
      (state.habitability[index] ?? 0) * 4 +
      Math.trunc((state.freshWater[index] ?? 0) / 8) +
      Math.trunc((state.food[index] ?? 0) / 5) +
      Math.trunc((state.timber[index] ?? 0) / 10) +
      Math.trunc((state.stone[index] ?? 0) / 12) -
      (state.hazard[index] ?? 0) * 2 +
      distance;
    if (best === null || score > best.score || (score === best.score && index < best.index))
      best = { index, score };
  }
  return best?.index ?? null;
}

function foundingHousehold(state: WorldState): {
  readonly householdIds: readonly number[];
  readonly personIds: readonly number[];
  readonly cultureId: number;
} | null {
  const primarySettlementId = state.civilizations.settlements[0]?.id;
  if (primarySettlementId === undefined) return null;
  const primaryPeople = new Set(
    state.civilizations.residencies
      .filter(
        (entry) =>
          entry.subjectKind === 'person' &&
          entry.settlementId === primarySettlementId &&
          entry.endedTick === null,
      )
      .map((entry) => entry.subjectId),
  );
  const eligible = state.civilization.society.people
    .filter((person) => person.alive && primaryPeople.has(person.id))
    .sort((left, right) => left.id - right.id);
  const lead = eligible[0];
  if (lead === undefined) return null;
  const companionId = selectCoMigrationPerson(
    eligible.slice(1).map((person) => {
      const edge = findActiveRelationship(
        state.civilization.society.interpersonal,
        lead.id,
        person.id,
      );
      return Object.freeze({
        id: person.id,
        personId: person.id,
        baseUtility: person.health,
        relationshipDecisionInfluence:
          edge === undefined ? 0 : relationshipDecisionInfluence(edge, lead.id, 'migration'),
      });
    }),
  );
  const householdIds = [
    ...new Set(
      [lead.id, companionId]
        .filter((id): id is number => id !== null)
        .map(
          (id) => state.civilization.society.people.find((person) => person.id === id)!.householdId,
        ),
    ),
  ].sort((left, right) => left - right);
  const people = state.civilization.society.people
    .filter(
      (person) =>
        person.alive && householdIds.includes(person.householdId) && primaryPeople.has(person.id),
    )
    .map((person) => person.id)
    .sort((left, right) => left - right);
  return Object.freeze({
    householdIds: Object.freeze(householdIds),
    personIds: Object.freeze(people),
    cultureId: lead.cultureId,
  });
}

function civilizationResidentIds(state: WorldState, civilizationId: number): readonly number[] {
  const civilization = state.civilizations.civilizations.find(
    (candidate) => candidate.id === civilizationId,
  );
  if (civilization === undefined) return Object.freeze([]);
  const settlementIds = new Set(civilization.memberSettlementIds);
  return Object.freeze(
    state.civilizations.residencies
      .filter(
        (residency) =>
          residency.subjectKind === 'person' &&
          residency.endedTick === null &&
          settlementIds.has(residency.settlementId),
      )
      .map((residency) => residency.subjectId)
      .sort((left, right) => left - right),
  );
}

/** Sparse-edge geopolitical input; work is proportional to retained bonds, never person pairs. */
function civilizationRelationshipInfluence(
  state: WorldState,
  sourceCivilizationId: number,
  targetCivilizationId: number,
  domain: 'politics' | 'conflict',
): number {
  const sourceIds = new Set(civilizationResidentIds(state, sourceCivilizationId));
  const targetIds = new Set(civilizationResidentIds(state, targetCivilizationId));
  let influence = 0;
  for (const edge of state.civilization.society.interpersonal.active) {
    const sourcePersonId =
      sourceIds.has(edge.firstPersonId) && targetIds.has(edge.secondPersonId)
        ? edge.firstPersonId
        : sourceIds.has(edge.secondPersonId) && targetIds.has(edge.firstPersonId)
          ? edge.secondPersonId
          : null;
    if (sourcePersonId !== null)
      influence += relationshipDecisionInfluence(edge, sourcePersonId, domain);
  }
  return Math.max(-1_000, Math.min(1_000, influence));
}

function civilizationMaterialStrength(state: WorldState, civilizationId: number): number {
  const civilization = state.civilizations.civilizations.find(
    (candidate) => candidate.id === civilizationId,
  );
  if (civilization === undefined) return 0;
  const memberIds = new Set(civilization.memberSettlementIds);
  return state.civilizations.settlements
    .filter((settlement) => settlement.status === 'active' && memberIds.has(settlement.id))
    .reduce(
      (total, settlement) =>
        total +
        settlement.population * 4 +
        settlement.stability +
        settlement.reserves.food +
        settlement.reserves.water +
        settlement.reserves.timber +
        settlement.reserves.stone +
        settlement.reserves.metal,
      0,
    );
}

export function createCivilizationsContext(state: WorldState, tick: number): CivilizationsContext {
  const year = Math.trunc(tick / state.config.societyYearTicks);
  const profile = m6Profile(state);
  const activeSettlements = state.civilizations.settlements.filter(
    (settlement) => settlement.status === 'active',
  );
  const activeCivilizations = state.civilizations.civilizations.filter(
    (civilization) => civilization.endedTick === null,
  );
  const inhabitedCivilizations = activeCivilizations.filter(
    (civilization) => civilizationResidentIds(state, civilization.id).length > 0,
  );
  const site = nextFoundingSite(state);
  const household = foundingHousehold(state);
  const reserves = communityReservesFromFounding(state);
  const canFound =
    year >= 1 &&
    year % 3 === 1 &&
    activeSettlements.length < 4 &&
    site !== null &&
    household !== null &&
    reserves.food >= 5 &&
    reserves.water >= 5 &&
    reserves.timber >= 2 &&
    reserves.stone >= 1;
  const orderedCultures = [...state.civilization.society.cultures].sort(
    (left, right) => left.id - right.id,
  );
  const foundingCulture = orderedCultures[activeSettlements.length % orderedCultures.length];
  const communityLabel = foundingCulture?.name ?? 'New';
  const foundingCandidates = canFound
    ? Object.freeze([
        Object.freeze({
          name: `${communityLabel} Hearth ${state.civilizations.settlements.length + 1}`,
          civilizationName: `${communityLabel} Community ${state.civilizations.civilizations.length + 1}`,
          cultureId: foundingCulture?.id ?? household.cultureId,
          centerTileIndex: site,
          siteScore: 100,
          personIds: household.personIds,
          householdIds: household.householdIds,
          reserveTransfer: Object.freeze({ food: 5, water: 5, timber: 2, stone: 1, metal: 0 }),
          stability: state.civilization.society.stability,
        }),
      ])
    : Object.freeze([]);
  const economies = Object.freeze(
    activeSettlements.map((settlement, index) =>
      Object.freeze({
        settlementId: settlement.id,
        production:
          index === 0
            ? Object.freeze({ food: 0, water: 0, timber: 0, stone: 0, metal: 0 })
            : Object.freeze({
                food: Math.max(1, Math.trunc((state.food[settlement.centerTileIndex] ?? 0) / 120)),
                water: Math.max(
                  1,
                  Math.trunc((state.freshWater[settlement.centerTileIndex] ?? 0) / 180),
                ),
                timber: Math.trunc((state.timber[settlement.centerTileIndex] ?? 0) / 220),
                stone: Math.trunc((state.stone[settlement.centerTileIndex] ?? 0) / 260),
                metal: Math.trunc((state.metal[settlement.centerTileIndex] ?? 0) / 80),
              }),
        consumption:
          index === 0
            ? Object.freeze({ food: 0, water: 0, timber: 0, stone: 0, metal: 0 })
            : Object.freeze({
                food: Math.max(1, Math.ceil(settlement.population / 3)),
                water: Math.max(1, Math.ceil(settlement.population / 3)),
                timber: 0,
                stone: 0,
                metal: 0,
              }),
        stabilityDelta:
          profile === 'volatile' && year >= 30
            ? -3
            : (state.hazard[settlement.centerTileIndex] ?? 0) > 120
              ? -1
              : 1,
      }),
    ),
  );
  const routeCandidates = Object.freeze(
    activeSettlements.flatMap((left, leftIndex) =>
      activeSettlements.slice(leftIndex + 1).map((right) =>
        Object.freeze({
          firstSettlementId: left.id,
          secondSettlementId: right.id,
          utility: profile === 'coexistence' && year >= 25 && year <= 27 ? -70 : 70,
          volume: Math.max(1, Math.min(12, left.population + right.population)),
        }),
      ),
    ),
  );
  const diplomaticScore =
    profile === 'cooperative'
      ? 80
      : profile === 'coexistence'
        ? 20
        : profile === 'volatile' && year < 30
          ? 70
          : -80;
  const diplomacyCandidates = Object.freeze(
    activeCivilizations.flatMap((left, leftIndex) =>
      activeCivilizations.slice(leftIndex + 1).map((right) =>
        Object.freeze({
          firstCivilizationId: left.id,
          secondCivilizationId: right.id,
          score: diplomaticScore,
        }),
      ),
    ),
  );
  const conflictAttacker = [...inhabitedCivilizations].sort(
    (left, right) =>
      civilizationMaterialStrength(state, right.id) -
        civilizationMaterialStrength(state, left.id) || left.id - right.id,
  )[0];
  const conflictDrive =
    profile === 'expansionist' && year >= 8 ? 80 : profile === 'volatile' && year >= 35 ? 80 : 0;
  const conflictTargetId =
    conflictAttacker === undefined
      ? null
      : selectConflictTargetCivilization(
          inhabitedCivilizations
            .filter((candidate) => candidate.id !== conflictAttacker.id)
            .map((candidate) => ({
              id: candidate.id,
              civilizationId: candidate.id,
              baseUtility: Math.max(0, -diplomaticScore),
              relationshipDecisionInfluence: civilizationRelationshipInfluence(
                state,
                conflictAttacker.id,
                candidate.id,
                'conflict',
              ),
            })),
        );
  const selectedConflictInfluence =
    conflictAttacker === undefined || conflictTargetId === null
      ? 0
      : civilizationRelationshipInfluence(state, conflictAttacker.id, conflictTargetId, 'conflict');
  const conflictUtility =
    conflictDrive +
    Math.max(0, -diplomaticScore) +
    Math.max(-60, selectedConflictInfluence) +
    Math.trunc(state.civilization.society.scarcity / 10);
  const conflictCandidates =
    conflictDrive > 0 &&
    conflictAttacker !== undefined &&
    conflictTargetId !== null &&
    conflictUtility >= 100
      ? Object.freeze([
          Object.freeze({
            attackerCivilizationId: conflictAttacker.id,
            defenderCivilizationId: conflictTargetId,
            pressure: Math.max(1, Math.min(1_000, conflictUtility)),
          }),
        ])
      : Object.freeze([]);
  const conflictResolutions = Object.freeze(
    state.civilizations.conflicts
      .filter(
        (conflict) =>
          conflict.status === 'active' &&
          tick - conflict.startedTick >= state.config.societyYearTicks * 4,
      )
      .map((conflict) => {
        const attackerStrength = civilizationMaterialStrength(
          state,
          conflict.attackerCivilizationId,
        );
        const defenderStrength = civilizationMaterialStrength(
          state,
          conflict.defenderCivilizationId,
        );
        return Object.freeze({
          conflictId: conflict.id,
          winnerCivilizationId:
            attackerStrength > defenderStrength
              ? conflict.attackerCivilizationId
              : defenderStrength > attackerStrength
                ? conflict.defenderCivilizationId
                : Math.min(conflict.attackerCivilizationId, conflict.defenderCivilizationId),
        });
      }),
  );
  const ruinDrive = profile === 'volatile' && year >= 45 ? 70 : 0;
  const ruinCandidate = activeSettlements
    .filter((settlement) => settlement.id !== activeSettlements[0]?.id)
    .map((settlement) => ({
      settlement,
      utility:
        ruinDrive +
        (100 - settlement.stability) +
        Math.max(0, 5 - settlement.reserves.food) * 5 +
        Math.max(0, 5 - settlement.reserves.water) * 5,
    }))
    .sort(
      (left, right) => right.utility - left.utility || right.settlement.id - left.settlement.id,
    )[0];
  const ruinSettlementIds =
    ruinCandidate !== undefined && ruinCandidate.utility >= 100
      ? Object.freeze([ruinCandidate.settlement.id])
      : Object.freeze([]);
  const transferSources = [
    ...conflictResolutions.flatMap((resolution) => {
      const conflict = state.civilizations.conflicts.find(
        (candidate) => candidate.id === resolution.conflictId,
      );
      if (conflict === undefined) return [];
      const loserCivilizationId =
        conflict.attackerCivilizationId === resolution.winnerCivilizationId
          ? conflict.defenderCivilizationId
          : conflict.attackerCivilizationId;
      const loser = activeCivilizations.find(
        (civilization) => civilization.id === loserCivilizationId,
      );
      return loser === undefined
        ? []
        : loser.memberSettlementIds.filter(
            (settlementId) =>
              activeSettlements.find((settlement) => settlement.id === settlementId)?.status ===
              'active',
          );
    }),
    ...ruinSettlementIds,
  ].filter((settlementId, index, values) => values.indexOf(settlementId) === index);
  const residencyTransfers = Object.freeze(
    transferSources.flatMap((fromSettlementId) => {
      const personIds = state.civilizations.residencies
        .filter(
          (entry) =>
            entry.subjectKind === 'person' &&
            entry.settlementId === fromSettlementId &&
            entry.endedTick === null,
        )
        .map((entry) => entry.subjectId)
        .sort((left, right) => left - right);
      const householdIds = state.civilizations.residencies
        .filter(
          (entry) =>
            entry.subjectKind === 'household' &&
            entry.settlementId === fromSettlementId &&
            entry.endedTick === null,
        )
        .map((entry) => entry.subjectId)
        .sort((left, right) => left - right);
      const refugeeId = personIds[0] ?? null;
      const destinationIds = activeSettlements
        .filter((settlement) => !transferSources.includes(settlement.id))
        .map((settlement) => settlement.id);
      const toSettlementId = selectRefugeeSupportSettlement(
        destinationIds.map((settlementId) => {
          const residentIds = state.civilizations.residencies
            .filter(
              (entry) =>
                entry.subjectKind === 'person' &&
                entry.settlementId === settlementId &&
                entry.endedTick === null,
            )
            .map((entry) => entry.subjectId);
          let influence = 0;
          if (refugeeId !== null)
            for (const residentId of residentIds) {
              const edge = findActiveRelationship(
                state.civilization.society.interpersonal,
                refugeeId,
                residentId,
              );
              if (edge !== undefined)
                influence = Math.max(
                  influence,
                  relationshipDecisionInfluence(edge, refugeeId, 'help'),
                );
            }
          const settlement = activeSettlements.find((entry) => entry.id === settlementId)!;
          return Object.freeze({
            id: settlementId,
            settlementId,
            baseUtility: settlement.stability,
            relationshipDecisionInfluence: influence,
          });
        }),
      );
      return toSettlementId === null
        ? []
        : [
            Object.freeze({
              fromSettlementId,
              toSettlementId,
              personIds: Object.freeze(personIds),
              householdIds: Object.freeze(householdIds),
              reason: 'refugee' as const,
            }),
          ];
    }),
  );
  const politicalSource = inhabitedCivilizations.find(
    (civilization) => civilization.status !== 'federated',
  );
  const politicalSupportTargetId =
    politicalSource === undefined
      ? null
      : selectPoliticalSupportCivilization(
          inhabitedCivilizations
            .filter((candidate) => candidate.id !== politicalSource.id)
            .map((candidate) => ({
              id: candidate.id,
              civilizationId: candidate.id,
              baseUtility: Math.max(0, diplomaticScore),
              relationshipDecisionInfluence: civilizationRelationshipInfluence(
                state,
                politicalSource.id,
                candidate.id,
                'politics',
              ),
            })),
        );
  const politicalInfluence =
    politicalSource === undefined || politicalSupportTargetId === null
      ? 0
      : civilizationRelationshipInfluence(
          state,
          politicalSource.id,
          politicalSupportTargetId,
          'politics',
        );
  const federationUtility =
    (year >= 15 && (profile === 'cooperative' || (profile === 'volatile' && year < 30)) ? 40 : 0) +
    Math.max(0, diplomaticScore) +
    Math.max(-60, politicalInfluence);
  const federationCivilizationIds =
    politicalSource !== undefined && politicalSupportTargetId !== null && federationUtility >= 100
      ? Object.freeze(
          [politicalSource.id, politicalSupportTargetId].sort((left, right) => left - right),
        )
      : Object.freeze([]);
  const fragmentationDrive = profile === 'volatile' && year >= 30 ? 70 : 0;
  const fragmentationCivilizationIds =
    fragmentationDrive + Math.max(0, -diplomaticScore) >= 100
      ? Object.freeze(
          activeCivilizations
            .filter((civilization) => civilization.status === 'federated')
            .map((civilization) => civilization.id),
        )
      : Object.freeze([]);
  const territoryChanges = Object.freeze([
    ...conflictResolutions.flatMap((resolution) => {
      const conflict = state.civilizations.conflicts.find(
        (candidate) => candidate.id === resolution.conflictId,
      );
      const winner = activeCivilizations.find(
        (civilization) => civilization.id === resolution.winnerCivilizationId,
      );
      const loser = activeCivilizations.find(
        (civilization) =>
          conflict !== undefined &&
          civilization.id ===
            (conflict.attackerCivilizationId === resolution.winnerCivilizationId
              ? conflict.defenderCivilizationId
              : conflict.attackerCivilizationId),
      );
      const winnerSettlement = activeSettlements.find(
        (settlement) => settlement.id === winner?.foundingSettlementId,
      );
      const loserSettlement = activeSettlements.find(
        (settlement) => settlement.id === loser?.foundingSettlementId,
      );
      return winnerSettlement === undefined || loserSettlement === undefined
        ? []
        : [
            Object.freeze({
              tileIndex: loserSettlement.centerTileIndex,
              nextSettlementId: winnerSettlement.id,
            }),
          ];
    }),
    ...ruinSettlementIds.flatMap((settlementId) => {
      const settlement = activeSettlements.find((candidate) => candidate.id === settlementId);
      return settlement === undefined
        ? []
        : [Object.freeze({ tileIndex: settlement.centerTileIndex, nextSettlementId: 0 })];
    }),
  ]);
  return Object.freeze({
    tick,
    yearTicks: state.config.societyYearTicks,
    foundingReserveAvailable: reserves,
    foundingCandidates,
    economies,
    routeCandidates,
    diplomacyCandidates,
    conflictCandidates,
    conflictResolutions,
    residencyTransfers,
    ruinSettlementIds,
    federationCivilizationIds,
    fragmentationCivilizationIds,
    territoryChanges,
  });
}

function civilizationEventDetails(
  state: WorldState,
  event: CivilizationEventDraft,
): WorldEventDetails {
  const pair = (kind: EntityKind): WorldEventDetails => ({
    summary: event.summary,
    subjectKind: kind,
    subjectId: event.subjectId,
    targetKind: kind,
    targetId: event.targetId,
    amount: Math.abs(event.amount),
  });
  switch (event.kind) {
    case 'settlement-founded':
      return {
        ...pair('settlement'),
        targetKind: 'civilization',
        ...(state.civilizations.settlements.find((settlement) => settlement.id === event.subjectId)
          ?.centerTileIndex === undefined
          ? {}
          : {
              tileIndex: state.civilizations.settlements.find(
                (settlement) => settlement.id === event.subjectId,
              )!.centerTileIndex,
            }),
      };
    case 'route-established':
    case 'route-disrupted':
    case 'route-restored':
      return pair('settlement');
    case 'diplomacy-changed':
    case 'conflict-started':
      return pair('civilization');
    case 'conflict-resolved':
      return { ...pair('conflict'), targetKind: 'civilization' };
    case 'refugees-relocated':
      return pair('settlement');
    case 'settlement-ruined':
      return { ...pair('settlement'), targetKind: 'world', targetId: 0 };
    case 'federation-formed':
    case 'civilization-fragmented':
      return { ...pair('civilization'), targetKind: 'world', targetId: 0 };
    case 'territory-changed':
    case 'territory-history-summarized':
      return {
        ...pair('settlement'),
        targetKind: event.targetId === 0 ? 'world' : 'settlement',
      };
  }
}

function reconcileCivilizationResidencies(state: WorldState): CivilizationsState {
  const primarySettlementId = state.civilizations.settlements[0]!.id;
  const residencyTick = state.civilizations.tick;
  const peopleById = new Map(
    state.civilization.society.people.map((person) => [person.id, person]),
  );
  const residencies = [...state.civilizations.residencies];
  let nextEntityId = state.civilizations.nextEntityId;
  let operations = 0;
  for (let index = 0; index < residencies.length; index += 1) {
    const residency = residencies[index]!;
    if (
      residency.subjectKind === 'person' &&
      residency.endedTick === null &&
      peopleById.get(residency.subjectId)?.alive !== true
    ) {
      residencies[index] = Object.freeze({ ...residency, endedTick: residencyTick });
      operations += 1;
    }
  }
  const activeHouseholdSettlement = new Map(
    residencies
      .filter((entry) => entry.subjectKind === 'household' && entry.endedTick === null)
      .map((entry) => [entry.subjectId, entry.settlementId]),
  );
  for (const household of [...state.civilization.society.households].sort(
    (left, right) => left.id - right.id,
  )) {
    if (activeHouseholdSettlement.has(household.id)) continue;
    residencies.push(
      Object.freeze({
        id: nextEntityId,
        subjectKind: 'household' as const,
        subjectId: household.id,
        settlementId: primarySettlementId,
        startedTick: residencyTick,
        endedTick: null,
      }),
    );
    activeHouseholdSettlement.set(household.id, primarySettlementId);
    nextEntityId += 1;
    operations += 1;
  }
  const representedPeople = new Set(
    residencies
      .filter((entry) => entry.subjectKind === 'person' && entry.endedTick === null)
      .map((entry) => entry.subjectId),
  );
  for (const person of [...state.civilization.society.people].sort(
    (left, right) => left.id - right.id,
  )) {
    if (!person.alive || representedPeople.has(person.id)) continue;
    residencies.push(
      Object.freeze({
        id: nextEntityId,
        subjectKind: 'person' as const,
        subjectId: person.id,
        settlementId: activeHouseholdSettlement.get(person.householdId) ?? primarySettlementId,
        startedTick: residencyTick,
        endedTick: null,
      }),
    );
    nextEntityId += 1;
    operations += 1;
  }
  const namedPopulation = new Map<number, number>();
  for (const residency of residencies)
    if (residency.subjectKind === 'person' && residency.endedTick === null)
      namedPopulation.set(
        residency.settlementId,
        (namedPopulation.get(residency.settlementId) ?? 0) + 1,
      );
  return Object.freeze({
    ...state.civilizations,
    nextEntityId,
    residencies: Object.freeze(residencies),
    settlements: Object.freeze(
      state.civilizations.settlements.map((settlement) =>
        Object.freeze({
          ...settlement,
          population: namedPopulation.get(settlement.id) ?? 0,
        }),
      ),
    ),
    operationCount: state.civilizations.operationCount + operations,
  });
}

function applyCivilizationsYear(state: WorldState, tick: number): WorldState {
  const reconciled = reconcileCivilizationResidencies(state);
  const primarySettlementId = reconciled.settlements[0]!.id;
  const synchronizedCivilizations = Object.freeze({
    ...reconciled,
    settlements: Object.freeze(
      reconciled.settlements.map((settlement) =>
        settlement.id === primarySettlementId
          ? Object.freeze({
              ...settlement,
              stability: state.civilization.society.stability,
              reserves: communityReservesFromFounding(state),
            })
          : settlement,
      ),
    ),
  });
  const source = Object.freeze({ ...state, civilizations: synchronizedCivilizations });
  const result = advanceCivilizations(
    synchronizedCivilizations,
    createCivilizationsContext(source, tick),
  );
  const delta = result.foundingReserveDelta;
  const stockpile = Object.freeze({
    food: Math.max(0, state.civilization.stockpile.food + delta.food),
    water: Math.max(0, state.civilization.stockpile.water + delta.water),
    timber: Math.max(0, state.civilization.stockpile.timber + delta.timber),
    stone: Math.max(0, state.civilization.stockpile.stone + delta.stone),
  });
  const primaryReserves = Object.freeze({ ...stockpile, metal: 0 });
  let next: WorldState = Object.freeze({
    ...state,
    civilizations: Object.freeze({
      ...result.state,
      settlements: Object.freeze(
        result.state.settlements.map((settlement) =>
          settlement.id === primarySettlementId
            ? Object.freeze({ ...settlement, reserves: primaryReserves })
            : settlement,
        ),
      ),
    }),
    civilization: Object.freeze({ ...state.civilization, stockpile }),
  });
  for (const event of result.events)
    next = appendWorldEvent(next, event.kind, tick, civilizationEventDetails(next, event));
  return next;
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
    const societyEvents = createdEvents.map(societyAuthoritativeEvent);
    next = Object.freeze({
      ...next,
      civilization: Object.freeze({
        ...attachFactualMemories(next.civilization, createdEvents),
        society: attachSocietyBiographyEventIds(
          next.civilization.society,
          societyEvents,
          biographyHistoricalSources(next, societyEvents),
        ),
      }),
    });
    if (pulseTick % next.config.societyYearTicks === 0 && next.development.tick < pulseTick) {
      const development = advanceDevelopment(next.development, developmentContext(next, pulseTick));
      const applied = applyDevelopmentResult(next, development, pulseTick);
      next = applied.state;
      const authoritative = applied.events.map(societyAuthoritativeEvent);
      next = Object.freeze({
        ...next,
        civilization: Object.freeze({
          ...attachFactualMemories(next.civilization, applied.events),
          society: attachSocietyBiographyEventIds(
            next.civilization.society,
            authoritative,
            biographyHistoricalSources(next, authoritative),
          ),
        }),
      });
    }
    if (pulseTick % next.config.societyYearTicks === 0 && next.civilizations.tick < pulseTick)
      next = applyCivilizationsYear(next, pulseTick);
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
    ...(details.childArrivalEligibility === undefined
      ? {}
      : { childArrivalEligibility: details.childArrivalEligibility }),
  });
  return Object.freeze({
    ...state,
    nextEventId: state.nextEventId + 1,
    eventLog: Object.freeze([...state.eventLog, event]),
  });
}

const SUPPLY_SHORTAGE_COLLAPSE_SEVERITY = 75;

export type WorldInterventionInput = Omit<DevelopmentInterventionInput, 'requestedTick'>;

/** Queues one closed M5 condition intervention at the current authoritative tick. */
export function applyWorldIntervention(
  state: WorldState,
  intervention: WorldInterventionInput,
): WorldState {
  assertWorldInvariants(state);
  if (
    !Number.isSafeInteger(intervention.targetTileIndex) ||
    intervention.targetTileIndex < 0 ||
    intervention.targetTileIndex >= state.config.width * state.config.height
  )
    throw new RangeError('Intervention target tile is outside the world.');
  const next = Object.freeze({
    ...state,
    development: queueIntervention(state.development, {
      ...intervention,
      requestedTick: state.tick,
    }),
  });
  assertWorldInvariants(next);
  return next;
}

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
  assertCivilizationsInvariants(state.civilizations);
  assertDevelopmentInvariants(state.development);
  if (state.development.tick > state.tick)
    throw new Error('World invariant violation: development cannot be ahead of world time.');
  if (state.civilizations.tick > state.tick)
    throw new Error('World invariant violation: civilizations cannot be ahead of world time.');
  const agentIds = new Set(state.civilization.agents.map((agent) => agent.id));
  const structureIds = new Set(state.civilization.structures.map((structure) => structure.id));
  const householdIds = new Set(
    state.civilization.society.households.map((household) => household.id),
  );
  const cultureIds = new Set(state.civilization.society.cultures.map((culture) => culture.id));
  const groupIds = new Set(state.civilization.society.groups.map((group) => group.id));
  const institutionIds = new Set([state.civilization.society.institution.id]);
  const settlementIds = new Set(state.civilizations.settlements.map((settlement) => settlement.id));
  const civilizationIds = new Set(
    state.civilizations.civilizations.map((civilization) => civilization.id),
  );
  const routeIds = new Set(state.civilizations.routes.map((route) => route.id));
  const conflictIds = new Set(state.civilizations.conflicts.map((conflict) => conflict.id));
  const ruinIds = new Set(state.civilizations.ruins.map((ruin) => ruin.id));
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
      case 'settlement':
        return settlementIds.has(id);
      case 'civilization':
        return civilizationIds.has(id);
      case 'route':
        return routeIds.has(id);
      case 'conflict':
        return conflictIds.has(id);
      case 'ruin':
        return ruinIds.has(id);
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
  for (const arrival of state.civilization.society.interpersonal.childArrivals) {
    const source = eventsById.get(arrival.eligibilityEventId);
    if (
      source?.tick !== arrival.tick ||
      source.amount !== arrival.householdId ||
      !childArrivalEligibilityEventMatches(arrival, {
        kind: source.kind,
        subjectKind: source.subjectKind,
        subjectId: source.subjectId,
        targetKind: source.targetKind,
        targetId: source.targetId,
      }) ||
      source.childArrivalEligibility === undefined ||
      !childArrivalEligibilityEvidenceMatchesRecord(arrival, source.childArrivalEligibility)
    )
      throw new Error('Child arrival eligibility source event is inconsistent.');
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
    ...(event.childArrivalEligibility === undefined
      ? {}
      : { childArrivalEligibility: event.childArrivalEligibility }),
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
    civilizations: civilizationsDto(state.civilizations),
    config: {
      chunkSize: state.config.chunkSize,
      height: state.config.height,
      societyYearTicks: state.config.societyYearTicks,
      width: state.config.width,
    },
    development: developmentDto(state.development),
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
