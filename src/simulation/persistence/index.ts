import { hashCanonicalJson } from '../canonical';
import {
  attachFactualMemories,
  createCivilizationAtTick,
  MAX_AGENT_KNOWN_TILES,
  MAX_AGENT_MEMORIES,
  MAX_AGENT_PLAN_STEPS,
  MAX_AGENT_ROUTE_LENGTH,
  SETTLEMENT_FOUNDER_COUNT,
  type AgentAction,
  type AgentGoal,
  type AgentPlanStep,
  type CarriedResource,
  type CivilizationState,
  type Occupation,
  type StructureKind,
  type StructureStatus,
} from '../settlement';
import {
  ACCELERATED_YEAR_TICKS,
  NORMAL_YEAR_TICKS,
  assertSocietyInvariants,
  createInitialSociety,
  type EconomicRole,
  type EntityKind,
  type GovernmentKind,
  type OfferKind,
  type SocietyEntityRef,
  type SocietyState,
} from '../society';
import {
  Biome,
  assertWorldInvariants,
  canonicalWorldJson,
  type WorldChunk,
  type WorldConfig,
  type WorldEvent,
  type WorldSeed,
  type WorldState,
  type WorldTileFields,
} from '../world';

export const WORLD_SNAPSHOT_FORMAT = 'chrono-forge-world';
export const WORLD_SNAPSHOT_FORMAT_VERSION = 3;
export const WORLD_ENGINE_VERSION = 3;
export const WORLD_CONTENT_VERSION = 3;

const MAX_WORLD_TILES = 1_000_000;
const MAX_WORLD_SNAPSHOT_BYTES = 50 * 1024 * 1024;
const MAX_EVENT_KIND_LENGTH = 64;
const UINT32_MAX = 0xffff_ffff;

type UnknownRecord = Record<string, unknown>;

interface LegacyWorldState extends WorldTileFields {
  readonly seed: WorldSeed;
  readonly config: LegacyWorldConfig;
  readonly tick: number;
  readonly nextEventId: number;
  readonly eventLog: readonly {
    readonly id: number;
    readonly tick: number;
    readonly kind: string;
  }[];
  readonly chunks: readonly WorldChunk[];
  readonly tiles: WorldTileFields;
}

interface LegacyWorldConfig {
  readonly width: number;
  readonly height: number;
  readonly chunkSize: number;
}

interface LegacyM3Event {
  readonly id: number;
  readonly tick: number;
  readonly kind: string;
  readonly subjectId: number;
  readonly targetId: number;
  readonly tileIndex: number;
  readonly amount: number;
}

interface LegacyFactualMemory {
  readonly id: number;
  readonly eventId: number;
  readonly tick: number;
  readonly kind: string;
  readonly targetId: number;
}

interface LegacyCivilizationState extends Omit<CivilizationState, 'agents' | 'society'> {
  readonly agents: readonly (Omit<CivilizationState['agents'][number], 'memories'> & {
    readonly memories: readonly LegacyFactualMemory[];
  })[];
}

interface VersionTwoWorldState extends Omit<LegacyWorldState, 'eventLog'> {
  readonly eventLog: readonly LegacyM3Event[];
  readonly civilization: LegacyCivilizationState;
}

const LEGACY_PAYLOAD_KEYS = [
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

const CIVILIZATION_KEYS = [
  'agents',
  'centerTileIndex',
  'nextAgentId',
  'nextMemoryId',
  'nextRelationshipId',
  'nextStructureId',
  'operationCount',
  'pathDemand',
  'relationships',
  'resourceDepletion',
  'stockpile',
  'structures',
  'systemRng',
] as const;

const VERSION_THREE_CIVILIZATION_KEYS = [...CIVILIZATION_KEYS, 'society'] as const;

const AGENT_ACTIONS = new Set<AgentAction>([
  'idle',
  'forage',
  'collect-water',
  'gather-timber',
  'gather-stone',
  'transport',
  'construct',
  'repair',
  'rest',
]);
const AGENT_GOALS = new Set<AgentGoal>([
  'survive',
  'secure-shelter',
  'sustain-stores',
  'improve-settlement',
]);
const OCCUPATIONS = new Set<Occupation>([
  'generalist',
  'forager',
  'water-carrier',
  'woodcutter',
  'stone-gatherer',
  'builder',
]);
const CARRIED_RESOURCES = new Set<CarriedResource>(['none', 'food', 'water', 'timber', 'stone']);
const STRUCTURE_KINDS = new Set<StructureKind>(['shelter', 'storehouse']);
const STRUCTURE_STATUSES = new Set<StructureStatus>([
  'planned',
  'building',
  'operational',
  'damaged',
  'abandoned',
  'demolished',
]);
const ENTITY_KINDS = new Set<EntityKind>([
  'person',
  'structure',
  'household',
  'culture',
  'group',
  'institution',
  'world',
]);
const ECONOMIC_ROLES = new Set<EconomicRole>(['grower', 'maker', 'trader', 'caretaker']);
const GOVERNMENTS = new Set<GovernmentKind>(['council', 'stewardship']);
const OFFER_KINDS = new Set<OfferKind>(['meal', 'tool']);

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

function parseLegacyConfig(value: unknown): LegacyWorldConfig {
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

function expectedChunks(config: LegacyWorldConfig): readonly WorldChunk[] {
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

function parseChunks(value: unknown, config: LegacyWorldConfig): readonly WorldChunk[] {
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

function parseLegacyEvents(
  value: unknown,
  tick: number,
  nextEventId: number,
): LegacyWorldState['eventLog'] {
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

function parseEvents(
  value: unknown,
  tick: number,
  nextEventId: number,
  tileCount: number,
): readonly LegacyM3Event[] {
  if (!isUnknownArray(value)) throw new Error('Snapshot eventLog must be an array.');
  const ids = new Set<number>();
  const events = value.map((candidate, index) => {
    if (!isRecord(candidate)) throw new Error(`Snapshot event ${index} must be an object.`);
    assertExactKeys(
      candidate,
      ['amount', 'id', 'kind', 'subjectId', 'targetId', 'tick', 'tileIndex'],
      `Snapshot event ${index}`,
    );
    const id = safeInteger(candidate.id, `Snapshot event ${index} id`, 1);
    if (ids.has(id)) throw new Error(`Snapshot event id ${id} is duplicated.`);
    ids.add(id);
    return Object.freeze({
      id,
      tick: safeInteger(candidate.tick, `Snapshot event ${index} tick`, 0, tick),
      kind: finiteString(candidate.kind, `Snapshot event ${index} kind`),
      subjectId: safeInteger(candidate.subjectId, `Snapshot event ${index} subjectId`),
      targetId: safeInteger(candidate.targetId, `Snapshot event ${index} targetId`),
      tileIndex: safeInteger(
        candidate.tileIndex,
        `Snapshot event ${index} tileIndex`,
        -1,
        tileCount - 1,
      ),
      amount: safeInteger(candidate.amount, `Snapshot event ${index} amount`),
    });
  });
  const maximumId = events.reduce((maximum, event) => Math.max(maximum, event.id), 0);
  if (nextEventId <= maximumId)
    throw new Error('Snapshot nextEventId must be greater than every event id.');
  return Object.freeze(events);
}

function finiteString(value: unknown, name: string, maximumLength = MAX_EVENT_KIND_LENGTH): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength) {
    throw new Error(
      `${name} must be a non-empty string no longer than ${maximumLength} characters.`,
    );
  }
  return value;
}

function enumValue<T extends string>(value: unknown, values: ReadonlySet<T>, name: string): T {
  if (typeof value !== 'string' || !values.has(value as T)) {
    throw new Error(`${name} is invalid.`);
  }
  return value as T;
}

function tileIndexValue(value: unknown, tileCount: number, name: string): number {
  return safeInteger(value, name, 0, tileCount - 1);
}

function sortedUniqueIds<T extends { readonly id: number }>(
  entries: readonly T[],
  name: string,
): void {
  let previous = 0;
  for (const entry of entries) {
    if (entry.id <= previous) throw new Error(`${name} ids must be sorted and unique.`);
    previous = entry.id;
  }
}

function parseRng(value: unknown, name: string): readonly [number, number, number, number] {
  const values = numberArray(value, 4, name, 0, UINT32_MAX);
  if ((values[0]! | values[1]! | values[2]! | values[3]!) === 0) {
    throw new Error(`${name} must not be all zero.`);
  }
  return Object.freeze([values[0]!, values[1]!, values[2]!, values[3]!]);
}

function parseTuple(value: unknown, name: string): readonly [number, number, number, number] {
  const values = numberArray(value, 4, name, 0, 100);
  return Object.freeze([values[0]!, values[1]!, values[2]!, values[3]!]);
}

function parsePlan(
  value: unknown,
  tileCount: number,
  structures: ReadonlyMap<
    number,
    { readonly kind: StructureKind; readonly status: StructureStatus }
  >,
  name: string,
): readonly AgentPlanStep[] {
  if (!isUnknownArray(value) || value.length > MAX_AGENT_PLAN_STEPS) {
    throw new Error(`${name} must be a bounded array.`);
  }
  return Object.freeze(
    value.map((candidate, index) => {
      if (!isRecord(candidate)) throw new Error(`${name}[${index}] must be an object.`);
      assertExactKeys(
        candidate,
        ['action', 'targetStructureId', 'targetTileIndex'],
        `${name}[${index}]`,
      );
      const targetStructureId = safeInteger(
        candidate.targetStructureId,
        `${name}[${index}].targetStructureId`,
      );
      const structure = structures.get(targetStructureId);
      if (targetStructureId !== 0 && structure === undefined) {
        throw new Error(`${name}[${index}] references an unknown structure.`);
      }
      const action = enumValue(candidate.action, AGENT_ACTIONS, `${name}[${index}].action`);
      if ((action === 'construct' || action === 'repair') && structure === undefined) {
        throw new Error(`${name}[${index}] ${action} requires a structure reference.`);
      }
      return Object.freeze({
        action,
        targetTileIndex: tileIndexValue(
          candidate.targetTileIndex,
          tileCount,
          `${name}[${index}].targetTileIndex`,
        ),
        targetStructureId,
      });
    }),
  );
}

function parseCivilization(
  value: unknown,
  config: LegacyWorldConfig,
  tiles: WorldTileFields,
  eventsById: ReadonlyMap<number, LegacyM3Event>,
  tick: number,
): LegacyCivilizationState {
  if (!isRecord(value)) throw new Error('Snapshot civilization must be an object.');
  assertExactKeys(value, CIVILIZATION_KEYS, 'Snapshot civilization');
  const tileCount = config.width * config.height;
  const centerTileIndex = tileIndexValue(
    value.centerTileIndex,
    tileCount,
    'Civilization center tile',
  );
  const stockpileValue = value.stockpile;
  if (!isRecord(stockpileValue)) throw new Error('Civilization stockpile must be an object.');
  assertExactKeys(stockpileValue, ['food', 'stone', 'timber', 'water'], 'Civilization stockpile');
  const stockpile = Object.freeze({
    food: safeInteger(stockpileValue.food, 'Civilization stockpile food'),
    water: safeInteger(stockpileValue.water, 'Civilization stockpile water'),
    timber: safeInteger(stockpileValue.timber, 'Civilization stockpile timber'),
    stone: safeInteger(stockpileValue.stone, 'Civilization stockpile stone'),
  });
  if (!isUnknownArray(value.structures))
    throw new Error('Civilization structures must be an array.');
  const structures = value.structures.map((candidate, index) => {
    if (!isRecord(candidate)) throw new Error(`Civilization structure ${index} must be an object.`);
    assertExactKeys(
      candidate,
      [
        'capacity',
        'changedTick',
        'communalOwnership',
        'completedTick',
        'condition',
        'id',
        'kind',
        'level',
        'ownerId',
        'plannedTick',
        'progress',
        'status',
        'tileIndex',
      ],
      `Civilization structure ${index}`,
    );
    const status = enumValue(candidate.status, STRUCTURE_STATUSES, `Structure ${index} status`);
    const plannedTick = safeInteger(
      candidate.plannedTick,
      `Structure ${index} plannedTick`,
      0,
      tick,
    );
    const completedTick = safeInteger(
      candidate.completedTick,
      `Structure ${index} completedTick`,
      0,
      tick,
    );
    const changedTick = safeInteger(
      candidate.changedTick,
      `Structure ${index} changedTick`,
      0,
      tick,
    );
    const progress = safeInteger(candidate.progress, `Structure ${index} progress`, 0, 1_000);
    if (status === 'operational' && (progress !== 1_000 || completedTick === 0)) {
      throw new Error(`Operational structure ${index} must be complete.`);
    }
    if (completedTick !== 0 && completedTick < plannedTick) {
      throw new Error(`Structure ${index} completion precedes planning.`);
    }
    if (changedTick < plannedTick || (completedTick !== 0 && changedTick < completedTick)) {
      throw new Error(`Structure ${index} change tick is invalid.`);
    }
    if (
      (status === 'planned' && (progress !== 0 || completedTick !== 0)) ||
      (status === 'building' && (progress === 0 || progress === 1_000 || completedTick !== 0)) ||
      ((status === 'operational' ||
        status === 'damaged' ||
        status === 'abandoned' ||
        status === 'demolished') &&
        (progress !== 1_000 || completedTick === 0))
    ) {
      throw new Error(`Structure ${index} status, progress, and completion are inconsistent.`);
    }
    return Object.freeze({
      id: safeInteger(candidate.id, `Structure ${index} id`, 1),
      kind: enumValue(candidate.kind, STRUCTURE_KINDS, `Structure ${index} kind`),
      status,
      tileIndex: tileIndexValue(candidate.tileIndex, tileCount, `Structure ${index} tileIndex`),
      progress,
      condition: safeInteger(candidate.condition, `Structure ${index} condition`, 0, 1_000),
      level: safeInteger(candidate.level, `Structure ${index} level`, 1),
      capacity: safeInteger(candidate.capacity, `Structure ${index} capacity`, 1),
      communalOwnership:
        typeof candidate.communalOwnership === 'boolean'
          ? candidate.communalOwnership
          : (() => {
              throw new Error(`Structure ${index} communalOwnership is invalid.`);
            })(),
      ownerId: safeInteger(candidate.ownerId, `Structure ${index} ownerId`),
      plannedTick,
      completedTick,
      changedTick,
    });
  });
  sortedUniqueIds(structures, 'Civilization structure');
  const structureIds = new Set(structures.map((structure) => structure.id));
  const structuresById = new Map(structures.map((structure) => [structure.id, structure]));
  const isWalkable = (tileIndex: number) =>
    (tiles.water[tileIndex] ?? 1) === 0 &&
    (tiles.habitability[tileIndex] ?? 0) >= 80 &&
    (tiles.hazard[tileIndex] ?? 255) < 180;
  if (!isWalkable(centerTileIndex)) throw new Error('Civilization center tile must be walkable.');
  const occupiedStructures = new Set<number>();
  for (const structure of structures) {
    if (structure.status !== 'demolished') {
      if (!isWalkable(structure.tileIndex))
        throw new Error('Active structure placement must be walkable.');
      if (occupiedStructures.has(structure.tileIndex))
        throw new Error('Active structures cannot share a tile.');
      occupiedStructures.add(structure.tileIndex);
    }
  }
  if (!isUnknownArray(value.agents)) throw new Error('Civilization agents must be an array.');
  const agents = value.agents.map((candidate, index) => {
    if (!isRecord(candidate)) throw new Error(`Civilization agent ${index} must be an object.`);
    assertExactKeys(
      candidate,
      [
        'action',
        'activity',
        'ageTicks',
        'alive',
        'carryingAmount',
        'carryingKind',
        'communalGoal',
        'fatigue',
        'health',
        'homeStructureId',
        'hunger',
        'id',
        'knownTiles',
        'memories',
        'name',
        'occupation',
        'personalGoal',
        'plan',
        'planIndex',
        'rng',
        'route',
        'routeCursor',
        'safety',
        'skills',
        'targetTileIndex',
        'thirst',
        'tileIndex',
        'traits',
      ],
      `Civilization agent ${index}`,
    );
    const alive =
      typeof candidate.alive === 'boolean'
        ? candidate.alive
        : (() => {
            throw new Error(`Agent ${index} alive is invalid.`);
          })();
    const action = enumValue(candidate.action, AGENT_ACTIONS, `Agent ${index} action`);
    if (!alive && action !== 'idle') throw new Error(`Dead agent ${index} cannot act.`);
    if (
      !isUnknownArray(candidate.knownTiles) ||
      candidate.knownTiles.length > MAX_AGENT_KNOWN_TILES
    ) {
      throw new Error(`Agent ${index} knownTiles are invalid.`);
    }
    const knownTiles = candidate.knownTiles.map((tile, knownIndex) =>
      tileIndexValue(tile, tileCount, `Agent ${index} knownTiles[${knownIndex}]`),
    );
    for (let knownIndex = 1; knownIndex < knownTiles.length; knownIndex += 1) {
      if (knownTiles[knownIndex - 1]! >= knownTiles[knownIndex]!) {
        throw new Error(`Agent ${index} knownTiles must be sorted and unique.`);
      }
    }
    if (!isUnknownArray(candidate.route)) throw new Error(`Agent ${index} route is invalid.`);
    if (candidate.route.length > MAX_AGENT_ROUTE_LENGTH) {
      throw new Error(`Agent ${index} route exceeds the fixed path quota.`);
    }
    const route = candidate.route.map((tile, routeIndex) =>
      tileIndexValue(tile, tileCount, `Agent ${index} route[${routeIndex}]`),
    );
    const routeCursor = safeInteger(
      candidate.routeCursor,
      `Agent ${index} routeCursor`,
      0,
      Math.max(0, route.length - 1),
    );
    if (!isUnknownArray(candidate.memories) || candidate.memories.length > MAX_AGENT_MEMORIES) {
      throw new Error(`Agent ${index} memories are invalid.`);
    }
    const memories = candidate.memories.map((memory, memoryIndex) => {
      if (!isRecord(memory))
        throw new Error(`Agent ${index} memory ${memoryIndex} must be an object.`);
      assertExactKeys(
        memory,
        ['eventId', 'id', 'kind', 'targetId', 'tick'],
        `Agent ${index} memory ${memoryIndex}`,
      );
      const eventId = safeInteger(
        memory.eventId,
        `Agent ${index} memory ${memoryIndex} eventId`,
        1,
      );
      const sourceEvent = eventsById.get(eventId);
      if (sourceEvent === undefined)
        throw new Error(`Agent ${index} memory references an unknown event.`);
      const targetId = safeInteger(
        memory.targetId,
        `Agent ${index} memory ${memoryIndex} targetId`,
      );
      const memoryTick = safeInteger(
        memory.tick,
        `Agent ${index} memory ${memoryIndex} tick`,
        0,
        tick,
      );
      const kind = finiteString(memory.kind, `Agent ${index} memory ${memoryIndex} kind`);
      if (
        memoryTick !== sourceEvent.tick ||
        kind !== sourceEvent.kind ||
        targetId !== sourceEvent.targetId
      ) {
        throw new Error(`Agent ${index} memory contradicts its source event.`);
      }
      return Object.freeze({
        id: safeInteger(memory.id, `Agent ${index} memory ${memoryIndex} id`, 1),
        eventId,
        tick: memoryTick,
        kind,
        targetId,
      });
    });
    sortedUniqueIds(memories, `Agent ${index} memory`);
    const activityValue = candidate.activity;
    if (!isRecord(activityValue)) throw new Error(`Agent ${index} activity is invalid.`);
    assertExactKeys(
      activityValue,
      [
        'constructionWork',
        'foodGathered',
        'stoneGathered',
        'timberGathered',
        'transported',
        'waterGathered',
      ],
      `Agent ${index} activity`,
    );
    const carryingKind = enumValue(
      candidate.carryingKind,
      CARRIED_RESOURCES,
      `Agent ${index} carryingKind`,
    );
    const carryingAmount = safeInteger(candidate.carryingAmount, `Agent ${index} carryingAmount`);
    if ((carryingKind === 'none') !== (carryingAmount === 0)) {
      throw new Error(`Agent ${index} carrying kind and amount are inconsistent.`);
    }
    const homeStructureId = safeInteger(
      candidate.homeStructureId,
      `Agent ${index} homeStructureId`,
    );
    if (homeStructureId !== 0 && !structureIds.has(homeStructureId)) {
      throw new Error(`Agent ${index} home references an unknown structure.`);
    }
    const health = safeInteger(candidate.health, `Agent ${index} health`, 0, 100);
    if (alive !== health > 0) {
      throw new Error(`Agent ${index} life and health are inconsistent.`);
    }
    const plan = parsePlan(candidate.plan, tileCount, structuresById, `Agent ${index} plan`);
    const planIndex = safeInteger(candidate.planIndex, `Agent ${index} planIndex`, 0, plan.length);
    const activeStep = plan[planIndex];
    const activeStructure =
      activeStep === undefined ? undefined : structuresById.get(activeStep.targetStructureId);
    if (
      activeStep?.action === 'construct' &&
      activeStructure?.status !== 'planned' &&
      activeStructure?.status !== 'building'
    ) {
      throw new Error(`Agent ${index} construction must reference an unfinished structure.`);
    }
    if (activeStep?.action === 'repair' && activeStructure?.status !== 'damaged') {
      throw new Error(`Agent ${index} repair must reference a damaged structure.`);
    }
    return Object.freeze({
      id: safeInteger(candidate.id, `Agent ${index} id`, 1),
      name: finiteString(candidate.name, `Agent ${index} name`),
      alive,
      tileIndex: tileIndexValue(candidate.tileIndex, tileCount, `Agent ${index} tileIndex`),
      ageTicks: safeInteger(candidate.ageTicks, `Agent ${index} ageTicks`),
      health,
      hunger: safeInteger(candidate.hunger, `Agent ${index} hunger`, 0, 100),
      thirst: safeInteger(candidate.thirst, `Agent ${index} thirst`, 0, 100),
      fatigue: safeInteger(candidate.fatigue, `Agent ${index} fatigue`, 0, 100),
      safety: safeInteger(candidate.safety, `Agent ${index} safety`, 0, 100),
      traits: parseTuple(candidate.traits, `Agent ${index} traits`),
      skills: parseTuple(candidate.skills, `Agent ${index} skills`),
      action,
      targetTileIndex: tileIndexValue(
        candidate.targetTileIndex,
        tileCount,
        `Agent ${index} targetTileIndex`,
      ),
      route: Object.freeze(route),
      routeCursor,
      carryingKind,
      carryingAmount,
      plan,
      planIndex,
      homeStructureId,
      personalGoal: enumValue(candidate.personalGoal, AGENT_GOALS, `Agent ${index} personalGoal`),
      communalGoal: enumValue(candidate.communalGoal, AGENT_GOALS, `Agent ${index} communalGoal`),
      occupation: enumValue(candidate.occupation, OCCUPATIONS, `Agent ${index} occupation`),
      knownTiles: Object.freeze(knownTiles),
      memories: Object.freeze(memories),
      rng: parseRng(candidate.rng, `Agent ${index} rng`),
      activity: Object.freeze({
        foodGathered: safeInteger(activityValue.foodGathered, `Agent ${index} foodGathered`),
        waterGathered: safeInteger(activityValue.waterGathered, `Agent ${index} waterGathered`),
        timberGathered: safeInteger(activityValue.timberGathered, `Agent ${index} timberGathered`),
        stoneGathered: safeInteger(activityValue.stoneGathered, `Agent ${index} stoneGathered`),
        constructionWork: safeInteger(
          activityValue.constructionWork,
          `Agent ${index} constructionWork`,
        ),
        transported: safeInteger(activityValue.transported, `Agent ${index} transported`),
      }),
    });
  });
  sortedUniqueIds(agents, 'Civilization agent');
  const agentIds = new Set(agents.map((agent) => agent.id));
  const memoryIds = new Set<number>();
  for (const agent of agents) {
    if (!isWalkable(agent.tileIndex)) throw new Error('Agent placement must be walkable.');
    if (agent.route.length > 0) {
      if (
        agent.route[agent.routeCursor] !== agent.tileIndex ||
        agent.route.at(-1) !== agent.targetTileIndex
      ) {
        throw new Error('Agent route cursor, position, or target is inconsistent.');
      }
      for (let routeIndex = 0; routeIndex < agent.route.length; routeIndex += 1) {
        const tileIndex = agent.route[routeIndex]!;
        if (!isWalkable(tileIndex)) throw new Error('Agent route must remain walkable.');
        if (routeIndex > 0) {
          const previous = agent.route[routeIndex - 1]!;
          const distance =
            Math.abs((previous % config.width) - (tileIndex % config.width)) +
            Math.abs(Math.trunc(previous / config.width) - Math.trunc(tileIndex / config.width));
          if (distance !== 1) throw new Error('Agent route tiles must be adjacent.');
        }
      }
    } else if (agent.routeCursor !== 0) {
      throw new Error('Agent without a route must have a zero cursor.');
    }
    const home = structuresById.get(agent.homeStructureId);
    if (agent.homeStructureId !== 0 && (home?.kind !== 'shelter' || home.status === 'demolished')) {
      throw new Error('Agent home must reference a non-demolished shelter.');
    }
    for (const memory of agent.memories) {
      if (memoryIds.has(memory.id)) throw new Error('Civilization memory ids must be unique.');
      memoryIds.add(memory.id);
      if (
        memory.targetId !== 0 &&
        !agentIds.has(memory.targetId) &&
        !structureIds.has(memory.targetId)
      ) {
        throw new Error('Agent memory references an unknown target.');
      }
    }
  }
  for (const structure of structures) {
    if (structure.communalOwnership ? structure.ownerId !== 0 : !agentIds.has(structure.ownerId)) {
      throw new Error('Structure ownership is invalid.');
    }
  }
  if (!isUnknownArray(value.relationships))
    throw new Error('Civilization relationships must be an array.');
  const relationships = value.relationships.map((candidate, index) => {
    if (!isRecord(candidate))
      throw new Error(`Civilization relationship ${index} must be an object.`);
    assertExactKeys(
      candidate,
      ['affinity', 'firstAgentId', 'id', 'secondAgentId', 'trust'],
      `Civilization relationship ${index}`,
    );
    const firstAgentId = safeInteger(
      candidate.firstAgentId,
      `Relationship ${index} firstAgentId`,
      1,
    );
    const secondAgentId = safeInteger(
      candidate.secondAgentId,
      `Relationship ${index} secondAgentId`,
      1,
    );
    if (
      !agentIds.has(firstAgentId) ||
      !agentIds.has(secondAgentId) ||
      firstAgentId >= secondAgentId
    ) {
      throw new Error(`Relationship ${index} references are invalid.`);
    }
    return Object.freeze({
      id: safeInteger(candidate.id, `Relationship ${index} id`, 1),
      firstAgentId,
      secondAgentId,
      affinity: safeInteger(candidate.affinity, `Relationship ${index} affinity`, 0, 100),
      trust: safeInteger(candidate.trust, `Relationship ${index} trust`, 0, 100),
    });
  });
  sortedUniqueIds(relationships, 'Civilization relationship');
  const relationshipPairs = new Set<string>();
  for (const relationship of relationships) {
    const pair = `${relationship.firstAgentId}:${relationship.secondAgentId}`;
    if (relationshipPairs.has(pair)) {
      throw new Error('Civilization relationship pairs must be unique.');
    }
    relationshipPairs.add(pair);
  }
  if (!isUnknownArray(value.resourceDepletion))
    throw new Error('Civilization resourceDepletion must be an array.');
  const resourceDepletion = value.resourceDepletion.map((candidate, index) => {
    if (!isRecord(candidate)) throw new Error(`Resource depletion ${index} must be an object.`);
    assertExactKeys(
      candidate,
      ['food', 'stone', 'tileIndex', 'timber'],
      `Resource depletion ${index}`,
    );
    const tileIndex = tileIndexValue(
      candidate.tileIndex,
      tileCount,
      `Resource depletion ${index} tileIndex`,
    );
    return Object.freeze({
      tileIndex,
      food: safeInteger(
        candidate.food,
        `Resource depletion ${index} food`,
        0,
        tiles.food[tileIndex] ?? 0,
      ),
      timber: safeInteger(
        candidate.timber,
        `Resource depletion ${index} timber`,
        0,
        tiles.timber[tileIndex] ?? 0,
      ),
      stone: safeInteger(
        candidate.stone,
        `Resource depletion ${index} stone`,
        0,
        tiles.stone[tileIndex] ?? 0,
      ),
    });
  });
  let previousDepletionTile = -1;
  for (const entry of resourceDepletion) {
    if (entry.tileIndex <= previousDepletionTile)
      throw new Error('Resource depletion must be sorted and unique.');
    previousDepletionTile = entry.tileIndex;
  }
  const pathDemandValues = numberArray(
    value.pathDemand,
    tileCount,
    'Civilization pathDemand',
    0,
    0xffff,
  );
  const civilization: LegacyCivilizationState = Object.freeze({
    nextAgentId: safeInteger(value.nextAgentId, 'Civilization nextAgentId', 1),
    nextRelationshipId: safeInteger(value.nextRelationshipId, 'Civilization nextRelationshipId', 1),
    nextStructureId: safeInteger(value.nextStructureId, 'Civilization nextStructureId', 1),
    nextMemoryId: safeInteger(value.nextMemoryId, 'Civilization nextMemoryId', 1),
    centerTileIndex,
    stockpile,
    agents: Object.freeze(agents),
    relationships: Object.freeze(relationships),
    structures: Object.freeze(structures),
    resourceDepletion: Object.freeze(resourceDepletion),
    pathDemand: Uint16Array.from(pathDemandValues),
    systemRng: parseRng(value.systemRng, 'Civilization systemRng'),
    operationCount: safeInteger(value.operationCount, 'Civilization operationCount'),
  });
  const greatestAgentId = agents.at(-1)?.id ?? 0;
  const greatestRelationshipId = relationships.at(-1)?.id ?? 0;
  const greatestStructureId = structures.at(-1)?.id ?? 0;
  const greatestMemoryId = agents
    .flatMap((agent) => agent.memories)
    .reduce((greatest, memory) => Math.max(greatest, memory.id), 0);
  if (
    civilization.nextAgentId <= greatestAgentId ||
    civilization.nextRelationshipId <= greatestRelationshipId ||
    civilization.nextStructureId <= greatestStructureId ||
    civilization.nextMemoryId <= greatestMemoryId
  ) {
    throw new Error('Civilization next IDs must exceed all current IDs.');
  }
  return civilization;
}

function parseLegacyWorldPayload(value: unknown): LegacyWorldState {
  if (!isRecord(value)) throw new Error('Snapshot payload must be an object.');
  assertExactKeys(value, LEGACY_PAYLOAD_KEYS, 'Snapshot payload');
  const config = parseLegacyConfig(value.config);
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
    eventLog: parseLegacyEvents(value.eventLog, tick, nextEventId),
    chunks: parseChunks(value.chunks, config),
    ...tiles,
    tiles,
  });
}

function canonicalLegacyWorldJson(state: LegacyWorldState): string {
  return JSON.stringify({
    animals: Array.from(state.animals),
    biome: Array.from(state.biome),
    chunks: state.chunks.map((chunk) => ({
      height: chunk.height,
      id: chunk.id,
      width: chunk.width,
      x: chunk.x,
      y: chunk.y,
    })),
    config: {
      chunkSize: state.config.chunkSize,
      height: state.config.height,
      width: state.config.width,
    },
    elevation: Array.from(state.elevation),
    eventLog: state.eventLog.map((event) => ({ id: event.id, kind: event.kind, tick: event.tick })),
    food: Array.from(state.food),
    freshWater: Array.from(state.freshWater),
    habitability: Array.from(state.habitability),
    hazard: Array.from(state.hazard),
    metal: Array.from(state.metal),
    moisture: Array.from(state.moisture),
    nextEventId: state.nextEventId,
    plants: Array.from(state.plants),
    seed: [...state.seed],
    stone: Array.from(state.stone),
    temperature: Array.from(state.temperature),
    tick: state.tick,
    timber: Array.from(state.timber),
    water: Array.from(state.water),
  });
}

function parseVersionTwoWorldPayload(value: unknown): VersionTwoWorldState {
  if (!isRecord(value)) throw new Error('Snapshot payload must be an object.');
  assertExactKeys(value, [...LEGACY_PAYLOAD_KEYS, 'civilization'], 'Snapshot payload');
  if (!isUnknownArray(value.eventLog)) throw new Error('Snapshot eventLog must be an array.');
  const legacyPayload: UnknownRecord = { ...value };
  legacyPayload.eventLog = value.eventLog.map((event, index) => {
    if (!isRecord(event)) throw new Error(`Snapshot event ${index} must be an object.`);
    return { id: event.id, kind: event.kind, tick: event.tick };
  });
  delete legacyPayload.civilization;
  const legacy = parseLegacyWorldPayload(legacyPayload);
  const tileCount = legacy.config.width * legacy.config.height;
  const eventLog = parseEvents(value.eventLog, legacy.tick, legacy.nextEventId, tileCount);
  const eventsById = new Map(eventLog.map((event) => [event.id, event]));
  const civilization = parseCivilization(
    value.civilization,
    legacy.config,
    legacy.tiles,
    eventsById,
    legacy.tick,
  );
  for (const event of eventLog) {
    if (
      event.subjectId !== 0 &&
      !civilization.agents.some((agent) => agent.id === event.subjectId)
    ) {
      throw new Error('Snapshot event references an unknown subject.');
    }
    if (
      event.targetId !== 0 &&
      !civilization.agents.some((agent) => agent.id === event.targetId) &&
      !civilization.structures.some((structure) => structure.id === event.targetId)
    ) {
      throw new Error('Snapshot event references an unknown target.');
    }
  }
  return Object.freeze({ ...legacy, eventLog, civilization });
}

function parseVersionThreeConfig(value: unknown): WorldConfig {
  if (!isRecord(value)) throw new Error('Snapshot config must be an object.');
  assertExactKeys(value, ['chunkSize', 'height', 'societyYearTicks', 'width'], 'Snapshot config');
  const config = Object.freeze({
    chunkSize: safeInteger(value.chunkSize, 'Snapshot chunk size', 1),
    height: safeInteger(value.height, 'Snapshot height', 1),
    societyYearTicks: safeInteger(value.societyYearTicks, 'Snapshot society calendar', 1),
    width: safeInteger(value.width, 'Snapshot width', 1),
  });
  if (
    config.width > Math.floor(MAX_WORLD_TILES / config.height) ||
    (config.societyYearTicks !== NORMAL_YEAR_TICKS &&
      config.societyYearTicks !== ACCELERATED_YEAR_TICKS)
  ) {
    throw new Error('Snapshot dimensions or society calendar are invalid.');
  }
  return config;
}

function parseEntityRef(value: unknown, name: string): SocietyEntityRef {
  if (!isRecord(value)) throw new Error(`${name} must be an object.`);
  assertExactKeys(value, ['id', 'kind'], name);
  const kind = enumValue(value.kind, ENTITY_KINDS, `${name} kind`);
  const id = safeInteger(value.id, `${name} id`, kind === 'world' ? 0 : 1);
  if ((kind === 'world') !== (id === 0)) throw new Error(`${name} is invalid.`);
  return Object.freeze({ kind, id });
}

function parseSociety(value: unknown, tick: number, tileCount: number): SocietyState {
  if (!isRecord(value)) throw new Error('Civilization society must be an object.');
  assertExactKeys(
    value,
    [
      'bonds',
      'centerTileIndex',
      'collapsed',
      'cultures',
      'groups',
      'households',
      'inequality',
      'institution',
      'lastTick',
      'nextHouseholdId',
      'nextOfferId',
      'nextPersonId',
      'offers',
      'operationCount',
      'pendingBiographyFacts',
      'people',
      'rng',
      'scarcity',
      'stability',
      'yearTicks',
    ],
    'Civilization society',
  );
  const yearTicks = safeInteger(value.yearTicks, 'Society calendar', 1);
  if (yearTicks !== NORMAL_YEAR_TICKS && yearTicks !== ACCELERATED_YEAR_TICKS)
    throw new Error('Society calendar is invalid.');
  const lastTick = safeInteger(value.lastTick, 'Society last tick', 0, tick);
  const centerTileIndex = tileIndexValue(value.centerTileIndex, tileCount, 'Society center tile');
  if (!isUnknownArray(value.people)) throw new Error('Society people must be an array.');
  const people = value.people.map((candidate, index) => {
    if (!isRecord(candidate)) throw new Error(`Society person ${index} must be an object.`);
    assertExactKeys(
      candidate,
      [
        'alive',
        'biographyEventIds',
        'birthTick',
        'cultureId',
        'deathTick',
        'generation',
        'health',
        'householdId',
        'id',
        'name',
        'origin',
        'parentIds',
        'role',
        'tileIndex',
      ],
      `Society person ${index}`,
    );
    if (!isUnknownArray(candidate.biographyEventIds) || candidate.biographyEventIds.length > 16)
      throw new Error(`Society person ${index} biography is invalid.`);
    const parentIds = numberArray(
      candidate.parentIds,
      2,
      `Society person ${index} parents`,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    const shared = {
      id: safeInteger(candidate.id, `Society person ${index} id`, 1),
      name: finiteString(candidate.name, `Society person ${index} name`),
      birthTick: safeInteger(
        candidate.birthTick,
        `Society person ${index} birth tick`,
        Number.MIN_SAFE_INTEGER,
        tick,
      ),
      generation: safeInteger(candidate.generation, `Society person ${index} generation`),
      parentIds: Object.freeze([parentIds[0]!, parentIds[1]!] as [number, number]),
      householdId: safeInteger(candidate.householdId, `Society person ${index} household`, 1),
      cultureId: safeInteger(candidate.cultureId, `Society person ${index} culture`, 1),
      role: enumValue(candidate.role, ECONOMIC_ROLES, `Society person ${index} role`),
      tileIndex: tileIndexValue(candidate.tileIndex, tileCount, `Society person ${index} tile`),
    };
    const alive =
      typeof candidate.alive === 'boolean'
        ? candidate.alive
        : (() => {
            throw new Error(`Society person ${index} alive is invalid.`);
          })();
    const deathTick = safeInteger(
      candidate.deathTick,
      `Society person ${index} death tick`,
      0,
      tick,
    );
    const health = safeInteger(candidate.health, `Society person ${index} health`, 0, 100);
    const biographyEventIds = Object.freeze(
      candidate.biographyEventIds.map((id, biographyIndex) =>
        safeInteger(id, `Society person ${index} biography ${biographyIndex}`, 1),
      ),
    );
    if (
      candidate.origin !== 'founder' &&
      candidate.origin !== 'birth' &&
      candidate.origin !== 'migration'
    ) {
      throw new Error(`Society person ${index} origin is invalid.`);
    }
    if (candidate.origin !== 'founder') {
      return Object.freeze({
        ...shared,
        origin: candidate.origin,
        alive,
        deathTick,
        health,
        biographyEventIds,
      });
    }
    return Object.freeze({
      id: shared.id,
      name: shared.name,
      origin: 'founder' as const,
      alive,
      birthTick: shared.birthTick,
      deathTick,
      generation: shared.generation,
      parentIds: shared.parentIds,
      householdId: shared.householdId,
      cultureId: shared.cultureId,
      role: shared.role,
      tileIndex: shared.tileIndex,
      health,
      biographyEventIds,
    });
  });
  const parseIdCollection = <T extends { readonly id: number }>(
    raw: unknown,
    label: string,
    parser: (candidate: UnknownRecord, index: number) => T,
  ): readonly T[] => {
    if (!isUnknownArray(raw)) throw new Error(`${label} must be an array.`);
    return Object.freeze(
      raw.map((candidate, index) => {
        if (!isRecord(candidate)) throw new Error(`${label} ${index} must be an object.`);
        return parser(candidate, index);
      }),
    );
  };
  const households = parseIdCollection(
    value.households,
    'Society household',
    (candidate, index) => {
      assertExactKeys(
        candidate,
        ['adultIds', 'credits', 'cultureId', 'id', 'meals', 'tools'],
        `Society household ${index}`,
      );
      if (!isUnknownArray(candidate.adultIds))
        throw new Error(`Society household ${index} adults are invalid.`);
      return Object.freeze({
        id: safeInteger(candidate.id, `Society household ${index} id`, 1),
        cultureId: safeInteger(candidate.cultureId, `Society household ${index} culture`, 1),
        adultIds: Object.freeze(
          candidate.adultIds.map((id, adultIndex) =>
            safeInteger(id, `Society household ${index} adult ${adultIndex}`, 1),
          ),
        ),
        credits: safeInteger(candidate.credits, `Society household ${index} credits`),
        meals: safeInteger(candidate.meals, `Society household ${index} meals`),
        tools: safeInteger(candidate.tools, `Society household ${index} tools`),
      });
    },
  );
  const cultures = parseIdCollection(value.cultures, 'Society culture', (candidate, index) => {
    assertExactKeys(
      candidate,
      ['architectureStyle', 'belief', 'id', 'name', 'preference', 'tradition'],
      `Society culture ${index}`,
    );
    return Object.freeze({
      id: safeInteger(candidate.id, `Society culture ${index} id`, 1),
      name: finiteString(candidate.name, `Society culture ${index} name`),
      preference: enumValue(
        candidate.preference,
        ECONOMIC_ROLES,
        `Society culture ${index} preference`,
      ),
      belief: finiteString(candidate.belief, `Society culture ${index} belief`),
      tradition: finiteString(candidate.tradition, `Society culture ${index} tradition`),
      architectureStyle: finiteString(
        candidate.architectureStyle,
        `Society culture ${index} architecture`,
      ),
    });
  });
  const groups = parseIdCollection(value.groups, 'Society group', (candidate, index) => {
    assertExactKeys(candidate, ['cultureId', 'id', 'memberIds', 'name'], `Society group ${index}`);
    if (!isUnknownArray(candidate.memberIds))
      throw new Error(`Society group ${index} members are invalid.`);
    return Object.freeze({
      id: safeInteger(candidate.id, `Society group ${index} id`, 1),
      cultureId: safeInteger(candidate.cultureId, `Society group ${index} culture`, 1),
      name: finiteString(candidate.name, `Society group ${index} name`),
      memberIds: Object.freeze(
        candidate.memberIds.map((id, memberIndex) =>
          safeInteger(id, `Society group ${index} member ${memberIndex}`, 1),
        ),
      ),
    });
  });
  if (!isRecord(value.institution)) throw new Error('Society institution must be an object.');
  assertExactKeys(
    value.institution,
    ['changedTick', 'government', 'id', 'kind', 'leaderId'],
    'Society institution',
  );
  if (value.institution.kind !== 'council') throw new Error('Society institution kind is invalid.');
  const institution = Object.freeze({
    id: safeInteger(value.institution.id, 'Society institution id', 1),
    kind: 'council' as const,
    leaderId: safeInteger(value.institution.leaderId, 'Society institution leader'),
    government: enumValue(value.institution.government, GOVERNMENTS, 'Society government'),
    changedTick: safeInteger(
      value.institution.changedTick,
      'Society institution changed tick',
      0,
      lastTick,
    ),
  });
  const offers = parseIdCollection(value.offers, 'Society offer', (candidate, index) => {
    assertExactKeys(
      candidate,
      [
        'amount',
        'buyerHouseholdId',
        'fulfilledAmount',
        'id',
        'kind',
        'price',
        'sellerHouseholdId',
        'transportDemand',
      ],
      `Society offer ${index}`,
    );
    const amount = safeInteger(candidate.amount, `Society offer ${index} amount`);
    return Object.freeze({
      id: safeInteger(candidate.id, `Society offer ${index} id`, 1),
      kind: enumValue(candidate.kind, OFFER_KINDS, `Society offer ${index} kind`),
      sellerHouseholdId: safeInteger(
        candidate.sellerHouseholdId,
        `Society offer ${index} seller`,
        1,
      ),
      buyerHouseholdId: safeInteger(candidate.buyerHouseholdId, `Society offer ${index} buyer`, 1),
      amount,
      price: safeInteger(candidate.price, `Society offer ${index} price`, 1),
      fulfilledAmount: safeInteger(
        candidate.fulfilledAmount,
        `Society offer ${index} fulfilled`,
        0,
        amount,
      ),
      transportDemand: safeInteger(candidate.transportDemand, `Society offer ${index} transport`),
    });
  });
  if (!isUnknownArray(value.bonds)) throw new Error('Society bonds must be an array.');
  const bonds = Object.freeze(
    value.bonds.map((candidate, index) => {
      if (!isRecord(candidate)) throw new Error(`Society bond ${index} must be an object.`);
      assertExactKeys(
        candidate,
        ['conflict', 'cooperation', 'disagreement', 'firstPersonId', 'secondPersonId'],
        `Society bond ${index}`,
      );
      return Object.freeze({
        firstPersonId: safeInteger(candidate.firstPersonId, `Society bond ${index} first`, 1),
        secondPersonId: safeInteger(candidate.secondPersonId, `Society bond ${index} second`, 1),
        cooperation: safeInteger(
          candidate.cooperation,
          `Society bond ${index} cooperation`,
          0,
          100,
        ),
        disagreement: safeInteger(
          candidate.disagreement,
          `Society bond ${index} disagreement`,
          0,
          100,
        ),
        conflict: safeInteger(candidate.conflict, `Society bond ${index} conflict`, 0, 100),
      });
    }),
  );
  if (!isUnknownArray(value.pendingBiographyFacts))
    throw new Error('Society biography facts must be an array.');
  const pendingBiographyFacts = Object.freeze(
    value.pendingBiographyFacts.map((candidate, index) => {
      if (!isRecord(candidate))
        throw new Error(`Society biography fact ${index} must be an object.`);
      assertExactKeys(
        candidate,
        ['kind', 'personId', 'source', 'summary', 'target'],
        `Society biography fact ${index}`,
      );
      return Object.freeze({
        personId: safeInteger(candidate.personId, `Society biography fact ${index} person`, 1),
        kind: finiteString(candidate.kind, `Society biography fact ${index} kind`),
        source: parseEntityRef(candidate.source, `Society biography fact ${index} source`),
        target: parseEntityRef(candidate.target, `Society biography fact ${index} target`),
        summary: finiteString(candidate.summary, `Society biography fact ${index} summary`, 160),
      });
    }),
  );
  const society: SocietyState = Object.freeze({
    yearTicks,
    lastTick,
    centerTileIndex,
    nextPersonId: safeInteger(value.nextPersonId, 'Society next person id', 1),
    nextHouseholdId: safeInteger(value.nextHouseholdId, 'Society next household id', 1),
    nextOfferId: safeInteger(value.nextOfferId, 'Society next offer id', 1),
    people,
    households,
    cultures,
    groups,
    institution,
    offers,
    bonds,
    scarcity: safeInteger(value.scarcity, 'Society scarcity', 0, 100),
    inequality: safeInteger(value.inequality, 'Society inequality'),
    stability: safeInteger(value.stability, 'Society stability', 0, 100),
    collapsed:
      typeof value.collapsed === 'boolean'
        ? value.collapsed
        : (() => {
            throw new Error('Society collapsed is invalid.');
          })(),
    pendingBiographyFacts,
    rng: parseRng(value.rng, 'Society rng'),
    operationCount: safeInteger(value.operationCount, 'Society operation count'),
  });
  assertSocietyInvariants(society);
  return society;
}

function parseTypedEvents(
  value: unknown,
  tick: number,
  nextEventId: number,
  tileCount: number,
): readonly WorldEvent[] {
  if (!isUnknownArray(value)) throw new Error('Snapshot eventLog must be an array.');
  const events = value.map((candidate, index) => {
    if (!isRecord(candidate)) throw new Error(`Snapshot event ${index} must be an object.`);
    assertExactKeys(
      candidate,
      [
        'amount',
        'id',
        'kind',
        'subjectId',
        'subjectKind',
        'summary',
        'targetId',
        'targetKind',
        'tick',
        'tileIndex',
      ],
      `Snapshot event ${index}`,
    );
    const subjectKind = enumValue(
      candidate.subjectKind,
      ENTITY_KINDS,
      `Snapshot event ${index} subject kind`,
    );
    const targetKind = enumValue(
      candidate.targetKind,
      ENTITY_KINDS,
      `Snapshot event ${index} target kind`,
    );
    const subjectId = safeInteger(
      candidate.subjectId,
      `Snapshot event ${index} subject id`,
      subjectKind === 'world' ? 0 : 1,
    );
    const targetId = safeInteger(
      candidate.targetId,
      `Snapshot event ${index} target id`,
      targetKind === 'world' ? 0 : 1,
    );
    if (
      (subjectKind === 'world') !== (subjectId === 0) ||
      (targetKind === 'world') !== (targetId === 0)
    )
      throw new Error(`Snapshot event ${index} entity references are invalid.`);
    return Object.freeze({
      id: safeInteger(candidate.id, `Snapshot event ${index} id`, 1),
      tick: safeInteger(candidate.tick, `Snapshot event ${index} tick`, 0, tick),
      kind: finiteString(candidate.kind, `Snapshot event ${index} kind`),
      summary: finiteString(candidate.summary, `Snapshot event ${index} summary`, 160),
      subjectKind,
      subjectId,
      targetKind,
      targetId,
      tileIndex: safeInteger(
        candidate.tileIndex,
        `Snapshot event ${index} tile`,
        -1,
        tileCount - 1,
      ),
      amount: safeInteger(candidate.amount, `Snapshot event ${index} amount`),
    });
  });
  sortedUniqueIds(events, 'Snapshot event');
  if (nextEventId <= (events.at(-1)?.id ?? 0))
    throw new Error('Snapshot nextEventId must exceed every event id.');
  return Object.freeze(events);
}

function assertSocietyCrossWorldReferences(
  society: SocietyState,
  civilization: Pick<CivilizationState, 'structures'>,
): void {
  const structureIds = new Set(civilization.structures.map((structure) => structure.id));
  for (const fact of society.pendingBiographyFacts) {
    for (const reference of [fact.source, fact.target]) {
      if (reference.kind === 'structure' && !structureIds.has(reference.id)) {
        throw new Error('Society biography fact references an unknown structure.');
      }
    }
  }
}

function convertLegacyConfig(config: LegacyWorldConfig): WorldConfig {
  return Object.freeze({ ...config, societyYearTicks: NORMAL_YEAR_TICKS });
}

function legacyEntityKind(
  id: number,
  primary: 'agent' | 'structure',
  civilization: LegacyCivilizationState,
): EntityKind {
  if (id === 0) return 'world';
  const hasAgent = civilization.agents.some((agent) => agent.id === id);
  const hasStructure = civilization.structures.some((structure) => structure.id === id);
  if (primary === 'agent' && hasAgent) return 'person';
  if (primary === 'structure' && hasStructure) return 'structure';
  if (hasAgent) return 'person';
  if (hasStructure) return 'structure';
  throw new Error('Legacy event references an unknown entity.');
}

function legacyEventSummary(event: LegacyM3Event, civilization: LegacyCivilizationState): string {
  if (event.kind === 'world-generated') return 'The founding world formed.';
  if (event.kind === 'founders-arrived')
    return `${event.amount} named founders established the first settlement.`;
  const target = civilization.structures.find((structure) => structure.id === event.targetId);
  if (target !== undefined)
    return `${target.kind === 'shelter' ? 'Shelter' : 'Storehouse'} ${target.id}: ${event.kind} at tick ${event.tick}.`;
  return `Recorded ${event.kind} at tick ${event.tick}.`;
}

function typedLegacyEvents(state: VersionTwoWorldState): readonly WorldEvent[] {
  return Object.freeze(
    state.eventLog.map((event) =>
      Object.freeze({
        ...event,
        summary: legacyEventSummary(event, state.civilization),
        subjectKind: legacyEntityKind(event.subjectId, 'agent', state.civilization),
        targetKind: legacyEntityKind(event.targetId, 'structure', state.civilization),
      }),
    ),
  );
}

function societyForLegacy(state: VersionTwoWorldState): SocietyState {
  const initial = createInitialSociety({
    seed: state.seed,
    tick: state.tick,
    centerTileIndex: state.civilization.centerTileIndex,
    yearTicks: NORMAL_YEAR_TICKS,
    people: state.civilization.agents.map((agent) =>
      Object.freeze({
        id: agent.id,
        alive: agent.alive,
        health: agent.health,
        tileIndex: agent.tileIndex,
        skills: agent.skills,
        occupation: agent.occupation,
      }),
    ),
  });
  const names = new Map(state.civilization.agents.map((agent) => [agent.id, agent.name]));
  const society: SocietyState = Object.freeze({
    ...initial,
    nextPersonId: state.civilization.nextAgentId,
    people: Object.freeze(
      initial.people.map((person) =>
        Object.freeze({ ...person, name: names.get(person.id) ?? person.name }),
      ),
    ),
  });
  assertSocietyInvariants(society);
  return society;
}

function upgradeVersionTwo(state: VersionTwoWorldState): WorldState {
  const eventLog = typedLegacyEvents(state);
  const eventsById = new Map(eventLog.map((event) => [event.id, event]));
  const civilization: CivilizationState = Object.freeze({
    ...state.civilization,
    agents: Object.freeze(
      state.civilization.agents.map((agent) =>
        Object.freeze({
          ...agent,
          memories: Object.freeze(
            agent.memories.map((memory) => {
              const source = eventsById.get(memory.eventId);
              if (source === undefined)
                throw new Error('Legacy memory references an unknown event.');
              return Object.freeze({
                id: memory.id,
                eventId: memory.eventId,
                tick: memory.tick,
                kind: memory.kind,
                summary: source.summary,
                targetKind: source.targetKind,
                targetId: memory.targetId,
              });
            }),
          ),
        }),
      ),
    ),
    society: societyForLegacy(state),
  });
  const world: WorldState = Object.freeze({
    ...state,
    config: convertLegacyConfig(state.config),
    eventLog,
    civilization,
  });
  assertWorldInvariants(world);
  return world;
}

/** Applies the M3 founding migration, then the pure v2-to-v3 society migration. */
function upgradeLegacyWorld(state: LegacyWorldState): WorldState {
  const tileCount = state.config.width * state.config.height;
  const terrain = {
    width: state.config.width,
    height: state.config.height,
    food: state.food,
    freshWater: state.freshWater,
    timber: state.timber,
    stone: state.stone,
    habitability: state.habitability,
    hazard: state.hazard,
    isWalkable: (tileIndex: number) =>
      tileIndex >= 0 &&
      tileIndex < tileCount &&
      (state.water[tileIndex] ?? 1) === 0 &&
      (state.habitability[tileIndex] ?? 0) >= 80 &&
      (state.hazard[tileIndex] ?? 255) < 180,
  };
  const foundingCivilization = createCivilizationAtTick(state.seed, terrain, state.tick);
  const foundersTyped: WorldEvent = Object.freeze({
    id: state.nextEventId,
    tick: state.tick,
    kind: 'founders-arrived',
    summary: `${SETTLEMENT_FOUNDER_COUNT} named founders established the first settlement.`,
    subjectKind: 'world',
    subjectId: 0,
    targetKind: 'world',
    targetId: 0,
    tileIndex: foundingCivilization.centerTileIndex,
    amount: SETTLEMENT_FOUNDER_COUNT,
  });
  const civilization = attachFactualMemories(foundingCivilization, [foundersTyped]);
  const legacyEvents: readonly LegacyM3Event[] = Object.freeze([
    ...state.eventLog.map((event) =>
      Object.freeze({ ...event, subjectId: 0, targetId: 0, tileIndex: -1, amount: 0 }),
    ),
    Object.freeze({
      id: foundersTyped.id,
      tick: foundersTyped.tick,
      kind: foundersTyped.kind,
      subjectId: 0,
      targetId: 0,
      tileIndex: foundersTyped.tileIndex,
      amount: foundersTyped.amount,
    }),
  ]);
  const legacyCivilization = {
    ...civilization,
    agents: civilization.agents.map((agent) =>
      Object.freeze({
        ...agent,
        memories: agent.memories.map((memory) =>
          Object.freeze({
            id: memory.id,
            eventId: memory.eventId,
            tick: memory.tick,
            kind: memory.kind,
            targetId: memory.targetId,
          }),
        ),
      }),
    ),
  } as unknown as LegacyCivilizationState;
  const versionTwo: VersionTwoWorldState = Object.freeze({
    ...state,
    nextEventId: state.nextEventId + 1,
    eventLog: legacyEvents,
    civilization: legacyCivilization,
  });
  return upgradeVersionTwo(versionTwo);
}

function parseVersionThreeWorldPayload(value: unknown): WorldState {
  if (!isRecord(value)) throw new Error('Snapshot payload must be an object.');
  assertExactKeys(value, [...LEGACY_PAYLOAD_KEYS, 'civilization'], 'Snapshot payload');
  if (!isRecord(value.civilization)) throw new Error('Snapshot civilization must be an object.');
  assertExactKeys(value.civilization, VERSION_THREE_CIVILIZATION_KEYS, 'Snapshot civilization');
  const config = parseVersionThreeConfig(value.config);
  const legacyPayload: UnknownRecord = {
    ...value,
    config: { chunkSize: config.chunkSize, height: config.height, width: config.width },
  };
  legacyPayload.eventLog = isUnknownArray(value.eventLog)
    ? value.eventLog.map((event, index) => {
        if (!isRecord(event)) throw new Error(`Snapshot event ${index} must be an object.`);
        return { id: event.id, kind: event.kind, tick: event.tick };
      })
    : value.eventLog;
  delete legacyPayload.civilization;
  const legacy = parseLegacyWorldPayload(legacyPayload);
  const legacyCivilization: UnknownRecord = { ...value.civilization };
  legacyCivilization.agents = isUnknownArray(legacyCivilization.agents)
    ? legacyCivilization.agents.map((agent, index) => {
        if (!isRecord(agent)) throw new Error(`Civilization agent ${index} must be an object.`);
        const copied = { ...agent };
        copied.memories = isUnknownArray(agent.memories)
          ? agent.memories.map((memory, memoryIndex) => {
              if (!isRecord(memory))
                throw new Error(`Agent ${index} memory ${memoryIndex} must be an object.`);
              const legacyMemory = { ...memory };
              delete legacyMemory.summary;
              delete legacyMemory.targetKind;
              return legacyMemory;
            })
          : agent.memories;
        return copied;
      })
    : legacyCivilization.agents;
  delete legacyCivilization.society;
  const eventLog = parseTypedEvents(
    value.eventLog,
    legacy.tick,
    legacy.nextEventId,
    config.width * config.height,
  );
  const oldEvents = new Map(
    eventLog.map((event) => [
      event.id,
      {
        id: event.id,
        tick: event.tick,
        kind: event.kind,
        subjectId: event.subjectId,
        targetId: event.targetId,
        tileIndex: event.tileIndex,
        amount: event.amount,
      },
    ]),
  );
  const legacyCiv = parseCivilization(
    legacyCivilization,
    legacy.config,
    legacy.tiles,
    oldEvents,
    legacy.tick,
  );
  const eventsById = new Map(eventLog.map((event) => [event.id, event]));
  const society = parseSociety(
    value.civilization.society,
    legacy.tick,
    config.width * config.height,
  );
  if (society.yearTicks !== config.societyYearTicks) {
    throw new Error('Society calendar does not match the world calendar.');
  }
  const civilization: CivilizationState = Object.freeze({
    ...legacyCiv,
    agents: Object.freeze(
      legacyCiv.agents.map((agent) =>
        Object.freeze({
          ...agent,
          memories: Object.freeze(
            agent.memories.map((memory) => {
              const source = eventsById.get(memory.eventId);
              if (source === undefined)
                throw new Error('Agent memory references an unknown event.');
              return Object.freeze({
                id: memory.id,
                eventId: memory.eventId,
                tick: memory.tick,
                kind: memory.kind,
                summary: source.summary,
                targetKind: source.targetKind,
                targetId: memory.targetId,
              });
            }),
          ),
        }),
      ),
    ),
    society,
  });
  assertSocietyCrossWorldReferences(society, civilization);
  const world: WorldState = Object.freeze({ ...legacy, config, eventLog, civilization });
  assertWorldInvariants(world);
  return world;
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

function deserializeVersionOne(envelope: UnknownRecord): LegacyWorldState {
  assertExactKeys(
    envelope,
    ['checksum', 'contentVersion', 'engineVersion', 'format', 'formatVersion', 'payload'],
    'World snapshot envelope',
  );
  if (
    envelope.formatVersion !== 1 ||
    envelope.engineVersion !== 1 ||
    envelope.contentVersion !== 1 ||
    typeof envelope.checksum !== 'string'
  ) {
    throw new Error('World snapshot version metadata is invalid.');
  }
  const payloadJson = JSON.stringify(envelope.payload);
  if (hashCanonicalJson(payloadJson) !== envelope.checksum) {
    throw new Error('World snapshot checksum does not match its payload.');
  }
  const world = parseLegacyWorldPayload(envelope.payload);
  if (canonicalLegacyWorldJson(world) !== payloadJson) {
    throw new Error('World snapshot payload is not canonical.');
  }
  return world;
}

function deserializeVersionTwo(envelope: UnknownRecord): VersionTwoWorldState {
  assertExactKeys(
    envelope,
    ['checksum', 'contentVersion', 'engineVersion', 'format', 'formatVersion', 'payload'],
    'World snapshot envelope',
  );
  if (
    envelope.formatVersion !== 2 ||
    envelope.engineVersion !== 2 ||
    envelope.contentVersion !== 2 ||
    typeof envelope.checksum !== 'string'
  ) {
    throw new Error('World snapshot version metadata is invalid.');
  }
  const payloadJson = JSON.stringify(envelope.payload);
  if (hashCanonicalJson(payloadJson) !== envelope.checksum) {
    throw new Error('World snapshot checksum does not match its payload.');
  }
  const world = parseVersionTwoWorldPayload(envelope.payload);
  if (canonicalVersionTwoWorldJson(world) !== payloadJson) {
    throw new Error('World snapshot payload is not canonical.');
  }
  return world;
}

function deserializeVersionThree(envelope: UnknownRecord): WorldState {
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
  const world = parseVersionThreeWorldPayload(envelope.payload);
  if (canonicalWorldJson(world) !== payloadJson) {
    const canonical = canonicalWorldJson(world);
    let difference = 0;
    while (difference < canonical.length && canonical[difference] === payloadJson[difference])
      difference += 1;
    throw new Error(
      `World snapshot payload is not canonical at byte ${difference}: ${payloadJson.slice(difference, difference + 80)} != ${canonical.slice(difference, difference + 80)}.`,
    );
  }
  return world;
}

function canonicalVersionTwoWorldJson(state: VersionTwoWorldState): string {
  return JSON.stringify({
    animals: Array.from(state.animals),
    biome: Array.from(state.biome),
    chunks: state.chunks.map((chunk) => ({
      height: chunk.height,
      id: chunk.id,
      width: chunk.width,
      x: chunk.x,
      y: chunk.y,
    })),
    civilization: {
      agents: state.civilization.agents.map((agent) => ({
        action: agent.action,
        activity: { ...agent.activity },
        ageTicks: agent.ageTicks,
        alive: agent.alive,
        carryingAmount: agent.carryingAmount,
        carryingKind: agent.carryingKind,
        communalGoal: agent.communalGoal,
        fatigue: agent.fatigue,
        health: agent.health,
        homeStructureId: agent.homeStructureId,
        hunger: agent.hunger,
        id: agent.id,
        knownTiles: [...agent.knownTiles],
        memories: agent.memories.map((memory) => ({ ...memory })),
        name: agent.name,
        occupation: agent.occupation,
        personalGoal: agent.personalGoal,
        plan: agent.plan.map((step) => ({ ...step })),
        planIndex: agent.planIndex,
        rng: [...agent.rng],
        route: [...agent.route],
        routeCursor: agent.routeCursor,
        safety: agent.safety,
        skills: [...agent.skills],
        targetTileIndex: agent.targetTileIndex,
        thirst: agent.thirst,
        tileIndex: agent.tileIndex,
        traits: [...agent.traits],
      })),
      centerTileIndex: state.civilization.centerTileIndex,
      nextAgentId: state.civilization.nextAgentId,
      nextMemoryId: state.civilization.nextMemoryId,
      nextRelationshipId: state.civilization.nextRelationshipId,
      nextStructureId: state.civilization.nextStructureId,
      operationCount: state.civilization.operationCount,
      pathDemand: Array.from(state.civilization.pathDemand),
      relationships: state.civilization.relationships.map((relationship) => ({ ...relationship })),
      resourceDepletion: state.civilization.resourceDepletion.map((entry) => ({ ...entry })),
      stockpile: { ...state.civilization.stockpile },
      structures: state.civilization.structures.map((structure) => ({ ...structure })),
      systemRng: [...state.civilization.systemRng],
    },
    config: {
      chunkSize: state.config.chunkSize,
      height: state.config.height,
      width: state.config.width,
    },
    elevation: Array.from(state.elevation),
    eventLog: state.eventLog.map((event) => ({
      amount: event.amount,
      id: event.id,
      kind: event.kind,
      subjectId: event.subjectId,
      targetId: event.targetId,
      tick: event.tick,
      tileIndex: event.tileIndex,
    })),
    food: Array.from(state.food),
    freshWater: Array.from(state.freshWater),
    habitability: Array.from(state.habitability),
    hazard: Array.from(state.hazard),
    metal: Array.from(state.metal),
    moisture: Array.from(state.moisture),
    nextEventId: state.nextEventId,
    plants: Array.from(state.plants),
    seed: [...state.seed],
    stone: Array.from(state.stone),
    temperature: Array.from(state.temperature),
    tick: state.tick,
    timber: Array.from(state.timber),
    water: Array.from(state.water),
  });
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
    return serializeWorldSnapshot(deserializeVersionThree(envelope));
  }
  if (formatVersion === 2) {
    return serializeWorldSnapshot(upgradeVersionTwo(deserializeVersionTwo(envelope)));
  }
  if (formatVersion === 1) {
    return serializeWorldSnapshot(upgradeLegacyWorld(deserializeVersionOne(envelope)));
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
  const world = parseLegacyWorldPayload(payload);
  if (canonicalLegacyWorldJson(world) !== envelope.worldJson) {
    throw new Error('Legacy world snapshot payload is not canonical.');
  }
  return serializeWorldSnapshot(upgradeLegacyWorld(world));
}

/** Loads and validates a supported snapshot without mutating its input. */
export function deserializeWorldSnapshot(snapshot: string): WorldState {
  const migrated = migrateWorldSnapshot(snapshot);
  return deserializeVersionThree(parseEnvelope(migrated));
}
