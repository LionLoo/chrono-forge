import { hashCanonicalJson } from '../canonical';
import {
  assertCivilizationsInvariants,
  migrateSingleSettlementCivilizations,
  type Civilization,
  type CivilizationsState,
  type CommunityReserves,
  type Conflict,
  type DiplomacyRelation,
  type Residency,
  type Ruin,
  type Settlement,
  type TerritoryHistoryRecord,
  type TradeRoute,
} from '../civilizations';
import type { Xoshiro128State } from '../random';
import {
  assertPopulationScaleInvariants,
  type AggregateCohortState,
  type AggregateTotals,
  type DetailedResidentState,
  type PopulationScaleState,
  type ScaleTransferDelta,
} from '../scale';
import {
  assertPathCacheInvariants,
  type CachedPathResult,
  type PathCacheRequest,
  type PathCacheState,
  type PendingPathRequest,
} from '../pathfinding/cache';
import {
  DISASTER_KINDS,
  KNOWLEDGE_DEFINITIONS,
  assertDevelopmentInvariants,
  createInitialDevelopment,
  type ActiveCrisis,
  type ConditionId,
  type DevelopmentIntervention,
  type DevelopmentState,
  type KnowledgeRecord,
} from '../development';
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
  childArrivalEligibilityEvidenceMatchesRecord,
  childArrivalEligibilityEventMatches,
  migrateLegacyInterpersonalState,
  relationshipEventMatchesFamilyBond,
  relationshipEventMatchesSocialEdge,
  type ActiveRelationship,
  type ArchivedRelationshipSummary,
  type ChildArrivalEligibilityEvidence,
  type HouseholdHistories,
  type InterpersonalState,
  type LegacyRelationshipContact,
  type PersonHouseholdHistory,
  type RelationshipDirectionalState,
  type SharedRelationshipEvent,
} from '../relationships';
import {
  Biome,
  assertWorldInvariants,
  canonicalWorldJson,
  civilizationsInitializationForWorld,
  initializeM8WorldAuthority,
  type WorldChunk,
  type WorldConfig,
  type WorldEvent,
  type WorldSeed,
  type WorldState,
  type WorldTileFields,
} from '../world';

export const WORLD_SNAPSHOT_FORMAT = 'chrono-forge-world';
// A strict persisted-payload shape change must increment all three values and retain a
// parser for the prior format below. This keeps development saves from silently being
// reinterpreted as a newer schema.
export const WORLD_SNAPSHOT_FORMAT_VERSION = 8;
export const WORLD_ENGINE_VERSION = 8;
export const WORLD_CONTENT_VERSION = 8;

const WORLD_SNAPSHOT_VERSION_SIX = 6;
const WORLD_SNAPSHOT_VERSION_SEVEN = 7;
const WORLD_SNAPSHOT_VERSION_EIGHT = 8;
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

interface LegacyRelationship {
  readonly id: number;
  readonly firstAgentId: number;
  readonly secondAgentId: number;
  readonly affinity: number;
  readonly trust: number;
}

interface LegacyCivilizationState {
  readonly nextAgentId: number;
  readonly nextRelationshipId: number;
  readonly nextStructureId: number;
  readonly nextMemoryId: number;
  readonly centerTileIndex: number;
  readonly stockpile: CivilizationState['stockpile'];
  readonly agents: readonly (Omit<CivilizationState['agents'][number], 'memories'> & {
    readonly memories: readonly LegacyFactualMemory[];
  })[];
  readonly relationships: readonly LegacyRelationship[];
  readonly structures: CivilizationState['structures'];
  readonly resourceDepletion: CivilizationState['resourceDepletion'];
  readonly pathDemand: Uint16Array;
  readonly systemRng: Xoshiro128State;
  readonly operationCount: number;
}

interface VersionTwoWorldState extends Omit<LegacyWorldState, 'eventLog'> {
  readonly eventLog: readonly LegacyM3Event[];
  readonly civilization: LegacyCivilizationState;
}

type PreM6WorldState = Omit<WorldState, 'civilizations' | 'populationScale' | 'pathCache'>;

function migratePreM6World(state: PreM6WorldState, validate = true): WorldState {
  const civilizations = migrateSingleSettlementCivilizations(
    state.seed,
    state.tick,
    civilizationsInitializationForWorld(state),
  );
  const world: WorldState = Object.freeze({
    ...state,
    civilizations,
    ...initializeM8WorldAuthority({ ...state, civilizations }),
  });
  if (validate) assertWorldInvariants(world);
  return world;
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

const VERSION_THREE_CIVILIZATION_KEYS = [
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
const VERSION_FOUR_CIVILIZATION_KEYS = [
  'agents',
  'centerTileIndex',
  'nextAgentId',
  'nextMemoryId',
  'nextStructureId',
  'operationCount',
  'pathDemand',
  'resourceDepletion',
  'society',
  'stockpile',
  'structures',
  'systemRng',
] as const;
const DEVELOPMENT_CONDITION_IDS = [
  'droughtPressure',
  'floodPressure',
  'firePressure',
  'stormPressure',
  'seismicPressure',
  'diseasePressure',
  'faminePressure',
  'resourcePressure',
  'politicalPressure',
  'accidentPressure',
  'meteorPressure',
  'protection',
] as const satisfies readonly ConditionId[];
const KNOWLEDGE_STATUSES = new Set(['unknown', 'known', 'lost']);
const INTERVENTION_KINDS = new Set([
  'weather',
  'resource',
  'organism',
  'omen',
  'artifact',
  'protection',
  'disaster',
  'alien-signal',
]);
const DISASTER_CONDITIONS = new Map(DISASTER_KINDS.map((entry) => [entry.kind, entry.condition]));

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
  'settlement',
  'civilization',
  'route',
  'conflict',
  'ruin',
  'world',
]);
const ECONOMIC_ROLES = new Set<EconomicRole>(['grower', 'maker', 'trader', 'caretaker']);
const GOVERNMENTS = new Set<GovernmentKind>(['council', 'stewardship']);
const OFFER_KINDS = new Set<OfferKind>(['meal', 'tool']);
const SETTLEMENT_STATUSES = new Set(['active', 'abandoned', 'conquered']);
const CIVILIZATION_STATUSES = new Set(['independent', 'federated', 'fragmented', 'collapsed']);
const DIPLOMACY_STATUSES = new Set(['neutral', 'allied', 'rival', 'at-war']);
const ROUTE_STATUSES = new Set(['active', 'disrupted', 'ended']);
const CONFLICT_STATUSES = new Set(['active', 'resolved']);
const RESIDENCY_SUBJECT_KINDS = new Set(['person', 'household']);
const RUIN_CAUSES = new Set(['abandoned', 'conquered', 'collapse']);
const CIVILIZATION_PROVENANCE = new Set(['initial', 'v5-migration', 'm6-founding']);

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

function parseDevelopment(value: unknown, worldTick: number, tileCount: number): DevelopmentState {
  if (!isRecord(value)) throw new Error('Snapshot development must be an object.');
  assertExactKeys(
    value,
    [
      'activeCrises',
      'conditions',
      'crisisHistory',
      'disasterRng',
      'knowledge',
      'nextCrisisId',
      'nextInterventionId',
      'operationCount',
      'pendingInterventions',
      'researchFocusId',
      'rng',
      'tick',
    ],
    'Snapshot development',
  );
  const tick = safeInteger(value.tick, 'Development tick', 0, worldTick);
  const nullableTick = (candidate: unknown, name: string): number | null =>
    candidate === null ? null : safeInteger(candidate, name, 0, tick);
  if (!isUnknownArray(value.knowledge) || value.knowledge.length !== KNOWLEDGE_DEFINITIONS.length)
    throw new Error('Development knowledge records are invalid.');
  const knowledge = Object.freeze(
    value.knowledge.map((candidate, index) => {
      if (!isRecord(candidate))
        throw new Error(`Development knowledge ${index} must be an object.`);
      assertExactKeys(
        candidate,
        ['discoveredTick', 'evidence', 'id', 'lostTick', 'progress', 'recoveredTick', 'status'],
        `Development knowledge ${index}`,
      );
      const definition = KNOWLEDGE_DEFINITIONS[index];
      if (
        definition === undefined ||
        candidate.id !== definition.id ||
        !KNOWLEDGE_STATUSES.has(candidate.status as string)
      )
        throw new Error('Development knowledge records are invalid.');
      const discoveredTick = nullableTick(
        candidate.discoveredTick,
        `Development knowledge ${index} discovered tick`,
      );
      const lostTick = nullableTick(candidate.lostTick, `Development knowledge ${index} lost tick`);
      const recoveredTick = nullableTick(
        candidate.recoveredTick,
        `Development knowledge ${index} recovered tick`,
      );
      const status = candidate.status as KnowledgeRecord['status'];
      const evidence = (() => {
        if (candidate.evidence === null) return null;
        if (!isRecord(candidate.evidence))
          throw new Error(`Development knowledge ${index} evidence must be an object.`);
        assertExactKeys(
          candidate.evidence,
          ['kind', 'prerequisiteIds', 'requirements', 'tick'],
          `Development knowledge ${index} evidence`,
        );
        if (
          candidate.evidence.kind !== 'founding' &&
          candidate.evidence.kind !== 'discovery' &&
          candidate.evidence.kind !== 'recovery'
        )
          throw new Error('Development knowledge evidence kind is invalid.');
        if (!isUnknownArray(candidate.evidence.prerequisiteIds))
          throw new Error('Development knowledge evidence prerequisites are invalid.');
        const prerequisiteIds = Object.freeze(
          candidate.evidence.prerequisiteIds.map((id, prerequisiteIndex) => {
            if (id !== definition.prerequisites[prerequisiteIndex])
              throw new Error('Development knowledge evidence prerequisites are invalid.');
            return id as KnowledgeRecord['id'];
          }),
        );
        if (prerequisiteIds.length !== definition.prerequisites.length)
          throw new Error('Development knowledge evidence prerequisites are invalid.');
        if (!isUnknownArray(candidate.evidence.requirements))
          throw new Error('Development knowledge evidence requirements are invalid.');
        const requirements = Object.freeze(
          candidate.evidence.requirements.map((requirement, requirementIndex) => {
            if (!isRecord(requirement))
              throw new Error('Development knowledge evidence requirements are invalid.');
            assertExactKeys(
              requirement,
              ['id', 'kind', 'minimum', 'value'],
              `Development knowledge ${index} evidence requirement ${requirementIndex}`,
            );
            const expected = definition.context[requirementIndex];
            if (
              expected === undefined ||
              requirement.kind !== expected.kind ||
              requirement.id !== expected.id ||
              requirement.minimum !== expected.minimum
            )
              throw new Error('Development knowledge evidence requirements are invalid.');
            return Object.freeze({
              kind: expected.kind,
              id: expected.id,
              minimum: expected.minimum,
              value: safeInteger(
                requirement.value,
                `Development knowledge ${index} evidence requirement ${requirementIndex} value`,
              ),
            });
          }),
        );
        if (requirements.length !== definition.context.length)
          throw new Error('Development knowledge evidence requirements are invalid.');
        return Object.freeze({
          kind: candidate.evidence.kind,
          tick: safeInteger(
            candidate.evidence.tick,
            `Development knowledge ${index} evidence tick`,
            0,
            tick,
          ),
          prerequisiteIds,
          requirements,
        });
      })();
      if (
        (status === 'unknown' &&
          (discoveredTick !== null ||
            lostTick !== null ||
            recoveredTick !== null ||
            evidence !== null)) ||
        (status === 'lost' && (discoveredTick === null || lostTick === null)) ||
        (status === 'known' && discoveredTick === null) ||
        (discoveredTick !== null && lostTick !== null && discoveredTick > lostTick)
      )
        throw new Error('Development knowledge dates are invalid.');
      return Object.freeze({
        id: definition.id,
        status,
        progress: safeInteger(
          candidate.progress,
          `Development knowledge ${index} progress`,
          0,
          definition.discoveryThreshold,
        ),
        discoveredTick,
        lostTick,
        recoveredTick,
        evidence,
      });
    }),
  );
  const parseCrisis = (candidate: unknown, name: string): ActiveCrisis => {
    if (!isRecord(candidate)) throw new Error(`${name} must be an object.`);
    assertExactKeys(
      candidate,
      [
        'id',
        'kind',
        'severity',
        'startedTick',
        'triggerCondition',
        'triggerThreshold',
        'triggerValue',
      ],
      name,
    );
    if (!DISASTER_CONDITIONS.has(candidate.kind as ActiveCrisis['kind']))
      throw new Error(`${name} kind is invalid.`);
    const kind = candidate.kind as ActiveCrisis['kind'];
    const triggerCondition = candidate.triggerCondition as ConditionId;
    if (triggerCondition !== DISASTER_CONDITIONS.get(kind))
      throw new Error(`${name} trigger condition is invalid.`);
    return Object.freeze({
      id: safeInteger(candidate.id, `${name} id`, 1),
      kind,
      triggerCondition,
      triggerValue: safeInteger(candidate.triggerValue, `${name} trigger value`, 80, 100),
      triggerThreshold: safeInteger(
        candidate.triggerThreshold,
        `${name} trigger threshold`,
        80,
        80,
      ),
      startedTick: safeInteger(candidate.startedTick, `${name} started tick`, 0, tick),
      severity: safeInteger(candidate.severity, `${name} severity`, 1, 100),
    });
  };
  if (!isUnknownArray(value.activeCrises))
    throw new Error('Development active crises must be an array.');
  const activeCrises = Object.freeze(
    value.activeCrises.map((candidate, index) =>
      parseCrisis(candidate, `Development crisis ${index}`),
    ),
  );
  if (!isUnknownArray(value.crisisHistory))
    throw new Error('Development crisis history must be an array.');
  const crisisHistory = Object.freeze(
    value.crisisHistory.map((candidate, index) => {
      if (!isRecord(candidate))
        throw new Error(`Development crisis history ${index} must be an object.`);
      assertExactKeys(
        candidate,
        [
          'endedTick',
          'id',
          'kind',
          'outcome',
          'startedTick',
          'triggerCondition',
          'triggerThreshold',
          'triggerValue',
        ],
        `Development crisis history ${index}`,
      );
      const active = parseCrisis(
        {
          id: candidate.id,
          kind: candidate.kind,
          triggerCondition: candidate.triggerCondition,
          triggerValue: candidate.triggerValue,
          triggerThreshold: candidate.triggerThreshold,
          startedTick: candidate.startedTick,
          severity: 1,
        },
        `Development crisis history ${index}`,
      );
      const endedTick = safeInteger(
        candidate.endedTick,
        `Development crisis history ${index} ended tick`,
        active.startedTick,
        tick,
      );
      if (candidate.outcome !== 'recovered')
        throw new Error('Development crisis history outcome is invalid.');
      return Object.freeze({
        id: active.id,
        kind: active.kind,
        triggerCondition: active.triggerCondition,
        triggerValue: active.triggerValue,
        triggerThreshold: active.triggerThreshold,
        startedTick: active.startedTick,
        endedTick,
        outcome: 'recovered' as const,
      });
    }),
  );
  if (!isUnknownArray(value.pendingInterventions))
    throw new Error('Development pending interventions must be an array.');
  const pendingInterventions = Object.freeze(
    value.pendingInterventions.map((candidate, index) => {
      if (!isRecord(candidate))
        throw new Error(`Development intervention ${index} must be an object.`);
      assertExactKeys(
        candidate,
        ['id', 'intensity', 'kind', 'polarity', 'requestedTick', 'targetTileIndex'],
        `Development intervention ${index}`,
      );
      if (!INTERVENTION_KINDS.has(candidate.kind as string))
        throw new Error('Development intervention kind is invalid.');
      if (candidate.polarity !== 'supportive' && candidate.polarity !== 'challenging')
        throw new Error('Development intervention polarity is invalid.');
      return Object.freeze({
        kind: candidate.kind as DevelopmentIntervention['kind'],
        intensity: safeInteger(
          candidate.intensity,
          `Development intervention ${index} intensity`,
          1,
          100,
        ),
        polarity: candidate.polarity,
        targetTileIndex: safeInteger(
          candidate.targetTileIndex,
          `Development intervention ${index} tile`,
          0,
          tileCount - 1,
        ),
        requestedTick: safeInteger(
          candidate.requestedTick,
          `Development intervention ${index} requested tick`,
          0,
          worldTick,
        ),
        id: safeInteger(candidate.id, `Development intervention ${index} id`, 1),
      });
    }),
  );
  const researchFocusId = value.researchFocusId;
  if (
    researchFocusId !== null &&
    !KNOWLEDGE_DEFINITIONS.some((entry) => entry.id === researchFocusId)
  )
    throw new Error('Development focus is invalid.');
  const conditionValue = value.conditions;
  if (!isRecord(conditionValue)) throw new Error('Development conditions must be an object.');
  assertExactKeys(conditionValue, DEVELOPMENT_CONDITION_IDS, 'Development conditions');
  const conditions = Object.freeze(
    Object.fromEntries(
      DEVELOPMENT_CONDITION_IDS.map((condition) => [
        condition,
        safeInteger(conditionValue[condition], `Development condition ${condition}`, 0, 100),
      ]),
    ) as Record<ConditionId, number>,
  );
  const state: DevelopmentState = Object.freeze({
    tick,
    nextCrisisId: safeInteger(value.nextCrisisId, 'Development next crisis id', 1),
    nextInterventionId: safeInteger(
      value.nextInterventionId,
      'Development next intervention id',
      1,
    ),
    disasterRng: parseRng(value.disasterRng, 'Development disaster rng'),
    rng: parseRng(value.rng, 'Development rng'),
    knowledge,
    researchFocusId: researchFocusId as DevelopmentState['researchFocusId'],
    conditions,
    activeCrises,
    crisisHistory,
    pendingInterventions,
    operationCount: safeInteger(value.operationCount, 'Development operation count'),
  });
  for (let index = 1; index < pendingInterventions.length; index += 1) {
    const previous = pendingInterventions[index - 1]!;
    const current = pendingInterventions[index]!;
    if (
      previous.requestedTick > current.requestedTick ||
      (previous.requestedTick === current.requestedTick && previous.id >= current.id)
    )
      throw new Error('Development interventions must be canonically sorted.');
  }
  assertDevelopmentInvariants(state);
  return state;
}

function parseCivilizations(
  value: unknown,
  worldTick: number,
  tileCount: number,
): CivilizationsState {
  if (!isRecord(value)) throw new Error('Snapshot civilizations must be an object.');
  assertExactKeys(
    value,
    [
      'civilizations',
      'conflicts',
      'diplomacy',
      'nextEntityId',
      'operationCount',
      'residencies',
      'rng',
      'routes',
      'ruins',
      'settlements',
      'tick',
      'tileOwners',
    ],
    'Snapshot civilizations',
  );
  const tick = safeInteger(value.tick, 'Civilizations tick', 0, worldTick);
  const exactArray = (candidate: unknown, name: string): unknown[] => {
    if (!isUnknownArray(candidate)) throw new Error(`${name} must be an array.`);
    return candidate;
  };
  const nullableInteger = (candidate: unknown, name: string): number | null =>
    candidate === null ? null : safeInteger(candidate, name, 0, tick);
  const parseReserves = (candidate: unknown, name: string): CommunityReserves => {
    if (!isRecord(candidate)) throw new Error(`${name} must be an object.`);
    assertExactKeys(candidate, ['food', 'metal', 'stone', 'timber', 'water'], name);
    return Object.freeze({
      food: safeInteger(candidate.food, `${name} food`),
      water: safeInteger(candidate.water, `${name} water`),
      timber: safeInteger(candidate.timber, `${name} timber`),
      stone: safeInteger(candidate.stone, `${name} stone`),
      metal: safeInteger(candidate.metal, `${name} metal`),
    });
  };
  const parseHistory = (candidate: unknown, name: string): TerritoryHistoryRecord => {
    if (!isRecord(candidate)) throw new Error(`${name} must be an object.`);
    assertExactKeys(
      candidate,
      ['id', 'nextSettlementId', 'previousSettlementId', 'tick', 'tileIndex'],
      name,
    );
    return Object.freeze({
      id: safeInteger(candidate.id, `${name} id`, 1),
      tick: safeInteger(candidate.tick, `${name} tick`, 0, tick),
      tileIndex: safeInteger(candidate.tileIndex, `${name} tile`, 0, tileCount - 1),
      previousSettlementId: safeInteger(
        candidate.previousSettlementId,
        `${name} previous settlement`,
      ),
      nextSettlementId: safeInteger(candidate.nextSettlementId, `${name} next settlement`),
    });
  };
  const settlements = Object.freeze(
    exactArray(value.settlements, 'Snapshot settlements').map((candidate, index): Settlement => {
      const name = `Snapshot settlement ${index}`;
      if (!isRecord(candidate)) throw new Error(`${name} must be an object.`);
      assertExactKeys(
        candidate,
        [
          'centerTileIndex',
          'civilizationId',
          'cultureId',
          'endedTick',
          'foundedTick',
          'id',
          'name',
          'population',
          'provenance',
          'reserves',
          'stability',
          'status',
          'territoryHistory',
          'territoryHistorySummaryCount',
        ],
        name,
      );
      return Object.freeze({
        id: safeInteger(candidate.id, `${name} id`, 1),
        civilizationId: safeInteger(candidate.civilizationId, `${name} civilization`, 1),
        name: finiteString(candidate.name, `${name} name`, 80),
        cultureId: safeInteger(candidate.cultureId, `${name} culture`, 1),
        centerTileIndex: safeInteger(
          candidate.centerTileIndex,
          `${name} center tile`,
          0,
          tileCount - 1,
        ),
        status: enumValue(
          candidate.status,
          SETTLEMENT_STATUSES,
          `${name} status`,
        ) as Settlement['status'],
        population: safeInteger(candidate.population, `${name} population`),
        stability: safeInteger(candidate.stability, `${name} stability`, 0, 100),
        reserves: parseReserves(candidate.reserves, `${name} reserves`),
        territoryHistory: Object.freeze(
          exactArray(candidate.territoryHistory, `${name} territory history`).map(
            (entry, historyIndex) =>
              parseHistory(entry, `${name} territory history ${historyIndex}`),
          ),
        ),
        territoryHistorySummaryCount: safeInteger(
          candidate.territoryHistorySummaryCount,
          `${name} territory history summary count`,
        ),
        foundedTick: safeInteger(candidate.foundedTick, `${name} founded tick`, 0, tick),
        endedTick: nullableInteger(candidate.endedTick, `${name} ended tick`),
        provenance: enumValue(
          candidate.provenance,
          CIVILIZATION_PROVENANCE,
          `${name} provenance`,
        ) as Settlement['provenance'],
      });
    }),
  );
  const civilizations = Object.freeze(
    exactArray(value.civilizations, 'Snapshot civilizations list').map(
      (candidate, index): Civilization => {
        const name = `Snapshot civilization ${index}`;
        if (!isRecord(candidate)) throw new Error(`${name} must be an object.`);
        assertExactKeys(
          candidate,
          [
            'cultureId',
            'endedTick',
            'foundedTick',
            'foundingSettlementId',
            'id',
            'memberSettlementIds',
            'name',
            'provenance',
            'status',
          ],
          name,
        );
        return Object.freeze({
          id: safeInteger(candidate.id, `${name} id`, 1),
          name: finiteString(candidate.name, `${name} name`, 80),
          cultureId: safeInteger(candidate.cultureId, `${name} culture`, 1),
          status: enumValue(
            candidate.status,
            CIVILIZATION_STATUSES,
            `${name} status`,
          ) as Civilization['status'],
          foundingSettlementId: safeInteger(
            candidate.foundingSettlementId,
            `${name} founding settlement`,
            1,
          ),
          memberSettlementIds: Object.freeze(
            exactArray(candidate.memberSettlementIds, `${name} members`).map((id, memberIndex) =>
              safeInteger(id, `${name} member ${memberIndex}`, 1),
            ),
          ),
          foundedTick: safeInteger(candidate.foundedTick, `${name} founded tick`, 0, tick),
          endedTick: nullableInteger(candidate.endedTick, `${name} ended tick`),
          provenance: enumValue(
            candidate.provenance,
            CIVILIZATION_PROVENANCE,
            `${name} provenance`,
          ) as Civilization['provenance'],
        });
      },
    ),
  );
  const residencies = Object.freeze(
    exactArray(value.residencies, 'Snapshot residencies').map((candidate, index): Residency => {
      const name = `Snapshot residency ${index}`;
      if (!isRecord(candidate)) throw new Error(`${name} must be an object.`);
      assertExactKeys(
        candidate,
        ['endedTick', 'id', 'settlementId', 'startedTick', 'subjectId', 'subjectKind'],
        name,
      );
      return Object.freeze({
        id: safeInteger(candidate.id, `${name} id`, 1),
        subjectKind: enumValue(
          candidate.subjectKind,
          RESIDENCY_SUBJECT_KINDS,
          `${name} subject kind`,
        ) as Residency['subjectKind'],
        subjectId: safeInteger(candidate.subjectId, `${name} subject`, 1),
        settlementId: safeInteger(candidate.settlementId, `${name} settlement`, 1),
        startedTick: safeInteger(candidate.startedTick, `${name} started tick`, 0, tick),
        endedTick: nullableInteger(candidate.endedTick, `${name} ended tick`),
      });
    }),
  );
  const diplomacy = Object.freeze(
    exactArray(value.diplomacy, 'Snapshot diplomacy').map((candidate, index): DiplomacyRelation => {
      const name = `Snapshot diplomacy ${index}`;
      if (!isRecord(candidate)) throw new Error(`${name} must be an object.`);
      assertExactKeys(
        candidate,
        ['changedTick', 'firstCivilizationId', 'id', 'score', 'secondCivilizationId', 'status'],
        name,
      );
      return Object.freeze({
        id: safeInteger(candidate.id, `${name} id`, 1),
        firstCivilizationId: safeInteger(
          candidate.firstCivilizationId,
          `${name} first civilization`,
          1,
        ),
        secondCivilizationId: safeInteger(
          candidate.secondCivilizationId,
          `${name} second civilization`,
          1,
        ),
        status: enumValue(
          candidate.status,
          DIPLOMACY_STATUSES,
          `${name} status`,
        ) as DiplomacyRelation['status'],
        score: safeInteger(candidate.score, `${name} score`, -1000, 1000),
        changedTick: safeInteger(candidate.changedTick, `${name} changed tick`, 0, tick),
      });
    }),
  );
  const routes = Object.freeze(
    exactArray(value.routes, 'Snapshot routes').map((candidate, index): TradeRoute => {
      const name = `Snapshot route ${index}`;
      if (!isRecord(candidate)) throw new Error(`${name} must be an object.`);
      assertExactKeys(
        candidate,
        [
          'endedTick',
          'firstSettlementId',
          'id',
          'secondSettlementId',
          'startedTick',
          'status',
          'volume',
        ],
        name,
      );
      return Object.freeze({
        id: safeInteger(candidate.id, `${name} id`, 1),
        firstSettlementId: safeInteger(candidate.firstSettlementId, `${name} first settlement`, 1),
        secondSettlementId: safeInteger(
          candidate.secondSettlementId,
          `${name} second settlement`,
          1,
        ),
        status: enumValue(
          candidate.status,
          ROUTE_STATUSES,
          `${name} status`,
        ) as TradeRoute['status'],
        volume: safeInteger(candidate.volume, `${name} volume`),
        startedTick: safeInteger(candidate.startedTick, `${name} started tick`, 0, tick),
        endedTick: nullableInteger(candidate.endedTick, `${name} ended tick`),
      });
    }),
  );
  const conflicts = Object.freeze(
    exactArray(value.conflicts, 'Snapshot conflicts').map((candidate, index): Conflict => {
      const name = `Snapshot conflict ${index}`;
      if (!isRecord(candidate)) throw new Error(`${name} must be an object.`);
      assertExactKeys(
        candidate,
        [
          'attackerCivilizationId',
          'defenderCivilizationId',
          'endedTick',
          'id',
          'pressure',
          'startedTick',
          'status',
          'winnerCivilizationId',
        ],
        name,
      );
      return Object.freeze({
        id: safeInteger(candidate.id, `${name} id`, 1),
        attackerCivilizationId: safeInteger(
          candidate.attackerCivilizationId,
          `${name} attacker`,
          1,
        ),
        defenderCivilizationId: safeInteger(
          candidate.defenderCivilizationId,
          `${name} defender`,
          1,
        ),
        status: enumValue(
          candidate.status,
          CONFLICT_STATUSES,
          `${name} status`,
        ) as Conflict['status'],
        pressure: safeInteger(candidate.pressure, `${name} pressure`, 0, 1000),
        startedTick: safeInteger(candidate.startedTick, `${name} started tick`, 0, tick),
        endedTick: nullableInteger(candidate.endedTick, `${name} ended tick`),
        winnerCivilizationId:
          candidate.winnerCivilizationId === null
            ? null
            : safeInteger(candidate.winnerCivilizationId, `${name} winner`, 1),
      });
    }),
  );
  const ruins = Object.freeze(
    exactArray(value.ruins, 'Snapshot ruins').map((candidate, index): Ruin => {
      const name = `Snapshot ruin ${index}`;
      if (!isRecord(candidate)) throw new Error(`${name} must be an object.`);
      assertExactKeys(candidate, ['cause', 'createdTick', 'id', 'settlementId'], name);
      return Object.freeze({
        id: safeInteger(candidate.id, `${name} id`, 1),
        settlementId: safeInteger(candidate.settlementId, `${name} settlement`, 1),
        createdTick: safeInteger(candidate.createdTick, `${name} created tick`, 0, tick),
        cause: enumValue(candidate.cause, RUIN_CAUSES, `${name} cause`) as Ruin['cause'],
      });
    }),
  );
  const tileOwners = Object.freeze(
    exactArray(value.tileOwners, 'Snapshot civilization tile owners').map((owner, index) =>
      safeInteger(owner, `Snapshot civilization tile owner ${index}`),
    ),
  );
  if (tileOwners.length !== tileCount)
    throw new Error('Snapshot civilization tile ownership length is invalid.');
  const assertStableIdOrder = (entries: readonly { readonly id: number }[], name: string): void => {
    for (let index = 1; index < entries.length; index += 1)
      if (entries[index - 1]!.id >= entries[index]!.id)
        throw new Error(`${name} must be stable-ID sorted.`);
  };
  const assertEndpointPairOrder = (
    entries: readonly {
      readonly firstCivilizationId?: number;
      readonly secondCivilizationId?: number;
      readonly firstSettlementId?: number;
      readonly secondSettlementId?: number;
    }[],
    name: string,
  ): void => {
    for (let index = 1; index < entries.length; index += 1) {
      const previous = entries[index - 1]!;
      const current = entries[index]!;
      const previousFirst = previous.firstCivilizationId ?? previous.firstSettlementId!;
      const previousSecond = previous.secondCivilizationId ?? previous.secondSettlementId!;
      const currentFirst = current.firstCivilizationId ?? current.firstSettlementId!;
      const currentSecond = current.secondCivilizationId ?? current.secondSettlementId!;
      if (
        previousFirst > currentFirst ||
        (previousFirst === currentFirst && previousSecond >= currentSecond)
      )
        throw new Error(`${name} must be endpoint-pair sorted.`);
    }
  };
  assertStableIdOrder(residencies, 'Snapshot residencies');
  assertStableIdOrder(conflicts, 'Snapshot conflicts');
  assertStableIdOrder(ruins, 'Snapshot ruins');
  assertEndpointPairOrder(diplomacy, 'Snapshot diplomacy');
  assertEndpointPairOrder(routes, 'Snapshot routes');
  const state: CivilizationsState = Object.freeze({
    tick,
    nextEntityId: safeInteger(value.nextEntityId, 'Civilizations next entity id', 1),
    rng: parseRng(value.rng, 'Civilizations rng'),
    settlements,
    civilizations,
    residencies,
    diplomacy,
    routes,
    conflicts,
    ruins,
    tileOwners,
    operationCount: safeInteger(value.operationCount, 'Civilizations operation count'),
  });
  assertCivilizationsInvariants(state);
  return state;
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
  assertExactKeys(value, VERSION_THREE_CIVILIZATION_KEYS, 'Snapshot civilization');
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

function stringEnum<T extends string>(value: unknown, values: readonly T[], name: string): T {
  if (typeof value !== 'string' || !values.includes(value as T))
    throw new Error(`${name} is invalid.`);
  return value as T;
}

function parseRelationshipDirection(value: unknown, name: string): RelationshipDirectionalState {
  if (!isRecord(value)) throw new Error(`${name} must be an object.`);
  assertExactKeys(value, ['affinity', 'closeness', 'commitment', 'grievance', 'trust'], name);
  return Object.freeze({
    affinity: safeInteger(value.affinity, `${name} affinity`, 0, 100),
    trust: safeInteger(value.trust, `${name} trust`, 0, 100),
    closeness: safeInteger(value.closeness, `${name} closeness`, 0, 100),
    commitment: safeInteger(value.commitment, `${name} commitment`, 0, 100),
    grievance: safeInteger(value.grievance, `${name} grievance`, 0, 100),
  });
}

function parseRelationshipEvents(value: unknown, name: string): readonly SharedRelationshipEvent[] {
  if (!isUnknownArray(value) || value.length > 16)
    throw new Error(`${name} shared events are invalid.`);
  return Object.freeze(
    value.map((candidate, index) => {
      if (!isRecord(candidate)) throw new Error(`${name} shared event ${index} must be an object.`);
      assertExactKeys(
        candidate,
        ['eventId', 'importance', 'tick'],
        `${name} shared event ${index}`,
      );
      return Object.freeze({
        eventId: safeInteger(candidate.eventId, `${name} shared event ${index} id`, 1),
        importance: safeInteger(candidate.importance, `${name} shared event ${index} importance`),
        tick: safeInteger(
          candidate.tick,
          `${name} shared event ${index} tick`,
          Number.MIN_SAFE_INTEGER,
        ),
      });
    }),
  );
}

function parseLegacyCounters(
  value: unknown,
  name: string,
): ActiveRelationship['legacySocietyCounters'] {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error(`${name} legacy counters are invalid.`);
  assertExactKeys(value, ['conflict', 'cooperation', 'disagreement'], `${name} legacy counters`);
  const nullable = (candidate: unknown, label: string): number | null =>
    candidate === null ? null : safeInteger(candidate, label, 0, 100);
  return Object.freeze({
    cooperation: nullable(value.cooperation, `${name} legacy cooperation`),
    disagreement: nullable(value.disagreement, `${name} legacy disagreement`),
    conflict: nullable(value.conflict, `${name} legacy conflict`),
  });
}

function parseRelationship(
  value: unknown,
  name: string,
  archived: boolean,
): ActiveRelationship | ArchivedRelationshipSummary {
  if (!isRecord(value)) throw new Error(`${name} must be an object.`);
  assertExactKeys(
    value,
    archived
      ? [
          'changedTick',
          'endedTick',
          'firstPersonId',
          'firstRole',
          'firstToSecond',
          'formedTick',
          'id',
          'kind',
          'lastInteractionTick',
          'legacySocietyCounters',
          'observedSinceTick',
          'rng',
          'secondPersonId',
          'secondRole',
          'secondToFirst',
          'sharedEvents',
          'trend',
        ]
      : [
          'changedTick',
          'firstPersonId',
          'firstRole',
          'firstToSecond',
          'formedTick',
          'id',
          'kind',
          'lastInteractionTick',
          'legacySocietyCounters',
          'observedSinceTick',
          'rng',
          'secondPersonId',
          'secondRole',
          'secondToFirst',
          'sharedEvents',
          'trend',
        ],
    name,
  );
  const base = {
    id: safeInteger(value.id, `${name} id`, 1),
    firstPersonId: safeInteger(value.firstPersonId, `${name} first person`, 1),
    secondPersonId: safeInteger(value.secondPersonId, `${name} second person`, 1),
    firstRole: stringEnum(
      value.firstRole,
      ['peer', 'mentor', 'protege', 'partner', 'former-partner', 'adversary'] as const,
      `${name} first role`,
    ),
    secondRole: stringEnum(
      value.secondRole,
      ['peer', 'mentor', 'protege', 'partner', 'former-partner', 'adversary'] as const,
      `${name} second role`,
    ),
    kind: stringEnum(
      value.kind,
      [
        'legacy-contact',
        'acquaintance',
        'friend',
        'close-friend',
        'rival',
        'enemy',
        'mentor',
        'partner',
        'long-term-partner',
        'former-partner',
        'estranged',
        'reconciled',
        'widowed',
      ] as const,
      `${name} kind`,
    ),
    formedTick: safeInteger(value.formedTick, `${name} formed tick`, Number.MIN_SAFE_INTEGER),
    changedTick: safeInteger(value.changedTick, `${name} changed tick`, Number.MIN_SAFE_INTEGER),
    lastInteractionTick: safeInteger(
      value.lastInteractionTick,
      `${name} interaction tick`,
      Number.MIN_SAFE_INTEGER,
    ),
    observedSinceTick: safeInteger(
      value.observedSinceTick,
      `${name} observed tick`,
      Number.MIN_SAFE_INTEGER,
    ),
    trend: stringEnum(
      value.trend,
      ['improving', 'stable', 'deteriorating'] as const,
      `${name} trend`,
    ),
    firstToSecond: parseRelationshipDirection(value.firstToSecond, `${name} first direction`),
    secondToFirst: parseRelationshipDirection(value.secondToFirst, `${name} second direction`),
    sharedEvents: parseRelationshipEvents(value.sharedEvents, name),
    rng: parseRng(value.rng, `${name} rng`),
    legacySocietyCounters: parseLegacyCounters(value.legacySocietyCounters, name),
  } as const;
  return archived
    ? Object.freeze({
        ...base,
        endedTick: safeInteger(value.endedTick, `${name} ended tick`, Number.MIN_SAFE_INTEGER),
      })
    : Object.freeze(base);
}

function householdHistoriesWithLookup(
  values: readonly PersonHouseholdHistory[],
): HouseholdHistories {
  const result = [...values] as PersonHouseholdHistory[] & {
    get?: (personId: number) => PersonHouseholdHistory | undefined;
  };
  result.get = (personId: number) => result.find((history) => history.personId === personId);
  return Object.freeze(result) as HouseholdHistories;
}

function parseInterpersonalState(value: unknown): InterpersonalState {
  if (!isRecord(value)) throw new Error('Society interpersonal state must be an object.');
  assertExactKeys(
    value,
    [
      'active',
      'archived',
      'childArrivals',
      'familyBonds',
      'householdHistories',
      'lifetime',
      'nextRelationshipId',
      'operationCount',
      'rng',
      'tick',
    ],
    'Society interpersonal state',
  );
  const parseCollection = <T>(
    raw: unknown,
    name: string,
    parser: (item: unknown, index: number) => T,
  ): readonly T[] => {
    if (!isUnknownArray(raw)) throw new Error(`${name} must be an array.`);
    return Object.freeze(raw.map(parser));
  };
  const active = parseCollection(value.active, 'Active relationships', (item, index) =>
    parseRelationship(item, `Active relationship ${index}`, false),
  );
  const archived = parseCollection(
    value.archived,
    'Archived relationships',
    (item, index) =>
      parseRelationship(
        item,
        `Archived relationship ${index}`,
        true,
      ) as ArchivedRelationshipSummary,
  );
  const lifetime = parseCollection(
    value.lifetime,
    'Relationship lifetime summaries',
    (item, index) => {
      if (!isRecord(item))
        throw new Error(`Relationship lifetime summary ${index} must be an object.`);
      assertExactKeys(
        item,
        ['count', 'firstTick', 'kind', 'lastTick', 'personId'],
        `Relationship lifetime summary ${index}`,
      );
      return Object.freeze({
        personId: safeInteger(item.personId, `Relationship lifetime summary ${index} person`, 1),
        kind: stringEnum(
          item.kind,
          [
            'legacy-contact',
            'acquaintance',
            'friend',
            'close-friend',
            'rival',
            'enemy',
            'mentor',
            'partner',
            'long-term-partner',
            'former-partner',
            'estranged',
            'reconciled',
            'widowed',
          ] as const,
          `Relationship lifetime summary ${index} kind`,
        ),
        count: safeInteger(item.count, `Relationship lifetime summary ${index} count`, 1),
        firstTick: safeInteger(
          item.firstTick,
          `Relationship lifetime summary ${index} first tick`,
          Number.MIN_SAFE_INTEGER,
        ),
        lastTick: safeInteger(
          item.lastTick,
          `Relationship lifetime summary ${index} last tick`,
          Number.MIN_SAFE_INTEGER,
        ),
      });
    },
  );
  const familyBonds = parseCollection(value.familyBonds, 'Family bonds', (item, index) => {
    if (!isRecord(item)) throw new Error(`Family bond ${index} must be an object.`);
    assertExactKeys(
      item,
      [
        'adultId',
        'changedTick',
        'childId',
        'childToParent',
        'formedEventId',
        'formedTick',
        'kind',
        'lastInteractionTick',
        'parentId',
        'parentToChild',
        'provenance',
        'sharedEvents',
        'stateProvenance',
        'trend',
      ],
      `Family bond ${index}`,
    );
    const nullableTick = (candidate: unknown, name: string): number | null =>
      candidate === null ? null : safeInteger(candidate, name, Number.MIN_SAFE_INTEGER);
    return Object.freeze({
      parentId: safeInteger(item.parentId, `Family bond ${index} parent`, 1),
      adultId: safeInteger(item.adultId, `Family bond ${index} adult`, 1),
      childId: safeInteger(item.childId, `Family bond ${index} child`, 1),
      kind: stringEnum(item.kind, ['parent', 'guardian'] as const, `Family bond ${index} kind`),
      provenance: stringEnum(
        item.provenance,
        [
          'initial-parentage',
          'migrated-parentage',
          'recorded-parentage',
          'recorded-guardianship',
        ] as const,
        `Family bond ${index} provenance`,
      ),
      stateProvenance: stringEnum(
        item.stateProvenance,
        ['neutral-initial', 'migrated-unknown', 'recorded'] as const,
        `Family bond ${index} state provenance`,
      ),
      formedEventId: safeInteger(item.formedEventId, `Family bond ${index} event id`, 0),
      formedTick: nullableTick(item.formedTick, `Family bond ${index} formed tick`),
      changedTick: safeInteger(
        item.changedTick,
        `Family bond ${index} changed tick`,
        Number.MIN_SAFE_INTEGER,
      ),
      lastInteractionTick: safeInteger(
        item.lastInteractionTick,
        `Family bond ${index} interaction tick`,
        Number.MIN_SAFE_INTEGER,
      ),
      trend: stringEnum(
        item.trend,
        ['improving', 'stable', 'deteriorating'] as const,
        `Family bond ${index} trend`,
      ),
      parentToChild: parseRelationshipDirection(
        item.parentToChild,
        `Family bond ${index} parent direction`,
      ),
      childToParent: parseRelationshipDirection(
        item.childToParent,
        `Family bond ${index} child direction`,
      ),
      sharedEvents: parseRelationshipEvents(item.sharedEvents, `Family bond ${index}`),
    });
  });
  const histories = parseCollection(
    value.householdHistories,
    'Household histories',
    (item, index) => {
      if (!isRecord(item)) throw new Error(`Household history ${index} must be an object.`);
      assertExactKeys(item, ['intervals', 'personId', 'prefix'], `Household history ${index}`);
      const prefix = item.prefix;
      if (prefix !== null && !isRecord(prefix))
        throw new Error(`Household history ${index} prefix is invalid.`);
      if (isRecord(prefix))
        assertExactKeys(
          prefix,
          ['firstKnownStartTick', 'intervalCount', 'lastKnownEndTick'],
          `Household history ${index} prefix`,
        );
      if (!isUnknownArray(item.intervals))
        throw new Error(`Household history ${index} intervals are invalid.`);
      const nullableTick = (candidate: unknown, name: string): number | null =>
        candidate === null ? null : safeInteger(candidate, name, Number.MIN_SAFE_INTEGER);
      return Object.freeze({
        personId: safeInteger(item.personId, `Household history ${index} person`, 1),
        prefix:
          prefix === null
            ? null
            : Object.freeze({
                intervalCount: safeInteger(
                  prefix.intervalCount,
                  `Household history ${index} prefix count`,
                  1,
                ),
                firstKnownStartTick: nullableTick(
                  prefix.firstKnownStartTick,
                  `Household history ${index} prefix first tick`,
                ),
                lastKnownEndTick: nullableTick(
                  prefix.lastKnownEndTick,
                  `Household history ${index} prefix last tick`,
                ),
              }),
        intervals: Object.freeze(
          item.intervals.map((interval, intervalIndex) => {
            if (!isRecord(interval))
              throw new Error(
                `Household history ${index} interval ${intervalIndex} must be an object.`,
              );
            assertExactKeys(
              interval,
              ['endTick', 'householdId', 'provenance', 'reason', 'startTick'],
              `Household history ${index} interval ${intervalIndex}`,
            );
            return Object.freeze({
              householdId: safeInteger(
                interval.householdId,
                `Household history ${index} interval ${intervalIndex} household`,
                1,
              ),
              startTick: nullableTick(
                interval.startTick,
                `Household history ${index} interval ${intervalIndex} start tick`,
              ),
              endTick: nullableTick(
                interval.endTick,
                `Household history ${index} interval ${intervalIndex} end tick`,
              ),
              provenance: stringEnum(
                interval.provenance,
                [
                  'initial-current-household',
                  'migrated-current-household',
                  'recorded-household-event',
                ] as const,
                `Household history ${index} interval ${intervalIndex} provenance`,
              ),
              reason: stringEnum(
                interval.reason,
                [
                  'initial-assignment',
                  'migration-current-household',
                  'formation',
                  'join',
                  'leave',
                  'split',
                  'merge',
                  'child-arrival',
                  'guardianship',
                ] as const,
                `Household history ${index} interval ${intervalIndex} reason`,
              ),
            });
          }),
        ),
      });
    },
  );
  const childArrivals = parseCollection(value.childArrivals, 'Child arrivals', (item, index) => {
    if (!isRecord(item)) throw new Error(`Child arrival ${index} must be an object.`);
    assertExactKeys(
      item,
      [
        'childId',
        'cultureId',
        'eligibilityEventId',
        'eventId',
        'guardianBirthTicks',
        'guardianHouseholdIdsAtArrival',
        'guardianHouseholdMembershipStartTicksAtArrival',
        'guardianIds',
        'householdId',
        'minimumPartnerCommitmentAtArrival',
        'minimumPartnerTrustAtArrival',
        'partnerKindAtArrival',
        'partnerRelationshipId',
        'policy',
        'selectionScoreAtArrival',
        'tick',
      ],
      `Child arrival ${index}`,
    );
    if (
      !isUnknownArray(item.guardianIds) ||
      !isUnknownArray(item.guardianBirthTicks) ||
      !isUnknownArray(item.guardianHouseholdIdsAtArrival) ||
      !isUnknownArray(item.guardianHouseholdMembershipStartTicksAtArrival)
    )
      throw new Error(`Child arrival ${index} guardian evidence is invalid.`);
    return Object.freeze({
      childId: safeInteger(item.childId, `Child arrival ${index} child`, 1),
      tick: safeInteger(item.tick, `Child arrival ${index} tick`, Number.MIN_SAFE_INTEGER),
      eventId: safeInteger(item.eventId, `Child arrival ${index} event id`, 0),
      eligibilityEventId: safeInteger(
        item.eligibilityEventId,
        `Child arrival ${index} eligibility event id`,
        0,
      ),
      policy: stringEnum(
        item.policy,
        ['pair-bond', 'communal-guardianship'] as const,
        `Child arrival ${index} policy`,
      ),
      cultureId: safeInteger(item.cultureId, `Child arrival ${index} culture`, 1),
      householdId: safeInteger(item.householdId, `Child arrival ${index} household`, 1),
      guardianIds: Object.freeze(
        item.guardianIds.map((id, guardianIndex) =>
          safeInteger(id, `Child arrival ${index} guardian ${guardianIndex}`, 1),
        ),
      ),
      guardianBirthTicks: Object.freeze(
        item.guardianBirthTicks.map((tick, guardianIndex) =>
          safeInteger(
            tick,
            `Child arrival ${index} guardian ${guardianIndex} birth tick`,
            Number.MIN_SAFE_INTEGER,
          ),
        ),
      ),
      guardianHouseholdIdsAtArrival: Object.freeze(
        item.guardianHouseholdIdsAtArrival.map((householdId, guardianIndex) =>
          safeInteger(householdId, `Child arrival ${index} guardian ${guardianIndex} household`, 1),
        ),
      ),
      guardianHouseholdMembershipStartTicksAtArrival: Object.freeze(
        item.guardianHouseholdMembershipStartTicksAtArrival.map((tick, guardianIndex) =>
          tick === null
            ? null
            : safeInteger(
                tick,
                `Child arrival ${index} guardian ${guardianIndex} membership start tick`,
                Number.MIN_SAFE_INTEGER,
              ),
        ),
      ),
      partnerRelationshipId:
        item.partnerRelationshipId === null
          ? null
          : safeInteger(
              item.partnerRelationshipId,
              `Child arrival ${index} partner relationship`,
              1,
            ),
      partnerKindAtArrival:
        item.partnerKindAtArrival === null
          ? null
          : stringEnum(
              item.partnerKindAtArrival,
              ['partner', 'long-term-partner'] as const,
              `Child arrival ${index} partner kind`,
            ),
      minimumPartnerTrustAtArrival:
        item.minimumPartnerTrustAtArrival === null
          ? null
          : safeInteger(
              item.minimumPartnerTrustAtArrival,
              `Child arrival ${index} partner trust`,
              0,
              100,
            ),
      minimumPartnerCommitmentAtArrival:
        item.minimumPartnerCommitmentAtArrival === null
          ? null
          : safeInteger(
              item.minimumPartnerCommitmentAtArrival,
              `Child arrival ${index} partner commitment`,
              0,
              100,
            ),
      selectionScoreAtArrival: safeInteger(
        item.selectionScoreAtArrival,
        `Child arrival ${index} selection score`,
        100,
      ),
    });
  });
  return Object.freeze({
    tick: safeInteger(value.tick, 'Interpersonal tick', Number.MIN_SAFE_INTEGER),
    nextRelationshipId: safeInteger(
      value.nextRelationshipId,
      'Interpersonal next relationship id',
      1,
    ),
    active,
    archived,
    lifetime,
    familyBonds,
    householdHistories: householdHistoriesWithLookup(histories),
    childArrivals,
    operationCount: safeInteger(value.operationCount, 'Interpersonal operation count'),
    rng: parseRng(value.rng, 'Interpersonal rng'),
  });
}

function parseSociety(
  value: unknown,
  tick: number,
  tileCount: number,
  legacyVersionThree: boolean,
  legacyContacts: readonly LegacyRelationshipContact[] = [],
): SocietyState {
  if (!isRecord(value)) throw new Error('Civilization society must be an object.');
  assertExactKeys(
    value,
    legacyVersionThree
      ? [
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
        ]
      : [
          'centerTileIndex',
          'collapsed',
          'cultures',
          'groups',
          'households',
          'inequality',
          'institution',
          'interpersonal',
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
        legacyVersionThree
          ? ['adultIds', 'credits', 'cultureId', 'id', 'meals', 'tools']
          : ['adultIds', 'credits', 'cultureId', 'id', 'lastChildArrivalTick', 'meals', 'tools'],
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
        lastChildArrivalTick: legacyVersionThree
          ? lastTick
          : safeInteger(
              candidate.lastChildArrivalTick,
              `Society household ${index} last child arrival tick`,
              Number.MIN_SAFE_INTEGER,
              lastTick,
            ),
      });
    },
  );
  const cultures = parseIdCollection(value.cultures, 'Society culture', (candidate, index) => {
    assertExactKeys(
      candidate,
      legacyVersionThree
        ? ['architectureStyle', 'belief', 'id', 'name', 'preference', 'tradition']
        : [
            'architectureStyle',
            'belief',
            'familyPolicy',
            'id',
            'name',
            'partnershipLimit',
            'preference',
            'tradition',
          ],
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
      familyPolicy: legacyVersionThree
        ? index === 0
          ? ('pair-bond' as const)
          : ('communal-guardianship' as const)
        : enumValue(
            candidate.familyPolicy,
            new Set(['pair-bond', 'communal-guardianship'] as const),
            `Society culture ${index} family policy`,
          ),
      partnershipLimit: legacyVersionThree
        ? index === 0
          ? (1 as const)
          : (2 as const)
        : candidate.partnershipLimit === 1 || candidate.partnershipLimit === 2
          ? candidate.partnershipLimit
          : (() => {
              throw new Error(`Society culture ${index} partnership limit is invalid.`);
            })(),
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
  const bonds = legacyVersionThree
    ? (() => {
        if (!isUnknownArray(value.bonds)) throw new Error('Society bonds must be an array.');
        return Object.freeze(
          value.bonds.map((candidate, index) => {
            if (!isRecord(candidate)) throw new Error(`Society bond ${index} must be an object.`);
            assertExactKeys(
              candidate,
              ['conflict', 'cooperation', 'disagreement', 'firstPersonId', 'secondPersonId'],
              `Society bond ${index}`,
            );
            return Object.freeze({
              firstPersonId: safeInteger(candidate.firstPersonId, `Society bond ${index} first`, 1),
              secondPersonId: safeInteger(
                candidate.secondPersonId,
                `Society bond ${index} second`,
                1,
              ),
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
      })()
    : Object.freeze([]);
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
  const societyRng = parseRng(value.rng, 'Society rng');
  const mergedLegacyContacts = (() => {
    const merged = new Map<string, LegacyRelationshipContact>();
    for (const contact of [
      ...legacyContacts,
      ...bonds.map((bond) => ({
        firstPersonId: bond.firstPersonId,
        secondPersonId: bond.secondPersonId,
        cooperation: bond.cooperation,
        disagreement: bond.disagreement,
        conflict: bond.conflict,
      })),
    ]) {
      const firstPersonId = Math.min(contact.firstPersonId, contact.secondPersonId);
      const secondPersonId = Math.max(contact.firstPersonId, contact.secondPersonId);
      const key = `${firstPersonId}:${secondPersonId}`;
      const prior = merged.get(key);
      merged.set(key, {
        ...prior,
        ...contact,
        firstPersonId,
        secondPersonId,
      });
    }
    return [...merged.values()];
  })();
  const interpersonal = legacyVersionThree
    ? migrateLegacyInterpersonalState(
        societyRng,
        lastTick,
        people.map((person) => ({
          id: person.id,
          alive: person.alive,
          birthTick: person.birthTick,
          parentIds: person.parentIds,
          householdId: person.householdId,
        })),
        mergedLegacyContacts,
      )
    : parseInterpersonalState(value.interpersonal);
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
    interpersonal,
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
    rng: societyRng,
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
    const hasEligibilityEvidence = candidate.childArrivalEligibility !== undefined;
    assertExactKeys(
      candidate,
      [
        'amount',
        ...(hasEligibilityEvidence ? ['childArrivalEligibility'] : []),
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
    const childArrivalEligibility = hasEligibilityEvidence
      ? parseChildArrivalEligibilityEvidence(
          candidate.childArrivalEligibility,
          `Snapshot event ${index} child arrival eligibility`,
        )
      : undefined;
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
      ...(childArrivalEligibility === undefined ? {} : { childArrivalEligibility }),
    });
  });
  sortedUniqueIds(events, 'Snapshot event');
  if (nextEventId <= (events.at(-1)?.id ?? 0))
    throw new Error('Snapshot nextEventId must exceed every event id.');
  return Object.freeze(events);
}

function parseChildArrivalEligibilityEvidence(
  value: unknown,
  label: string,
): ChildArrivalEligibilityEvidence {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  assertExactKeys(
    value,
    [
      'childId',
      'cultureId',
      'guardianBirthTicks',
      'guardianHouseholdIdsAtArrival',
      'guardianHouseholdMembershipStartTicksAtArrival',
      'guardianIds',
      'householdId',
      'minimumPartnerCommitmentAtArrival',
      'minimumPartnerTrustAtArrival',
      'partnerKindAtArrival',
      'partnerRelationshipId',
      'policy',
      'selectionScoreAtArrival',
    ],
    label,
  );
  if (
    !isUnknownArray(value.guardianIds) ||
    !isUnknownArray(value.guardianBirthTicks) ||
    !isUnknownArray(value.guardianHouseholdIdsAtArrival) ||
    !isUnknownArray(value.guardianHouseholdMembershipStartTicksAtArrival)
  )
    throw new Error(`${label} guardian evidence is invalid.`);
  return Object.freeze({
    childId: safeInteger(value.childId, `${label} child`, 1),
    policy: stringEnum(
      value.policy,
      ['pair-bond', 'communal-guardianship'] as const,
      `${label} policy`,
    ),
    cultureId: safeInteger(value.cultureId, `${label} culture`, 1),
    householdId: safeInteger(value.householdId, `${label} household`, 1),
    guardianIds: Object.freeze(
      value.guardianIds.map((id, index) => safeInteger(id, `${label} guardian ${index}`, 1)),
    ),
    guardianBirthTicks: Object.freeze(
      value.guardianBirthTicks.map((tick, index) =>
        safeInteger(tick, `${label} guardian ${index} birth tick`, Number.MIN_SAFE_INTEGER),
      ),
    ),
    guardianHouseholdIdsAtArrival: Object.freeze(
      value.guardianHouseholdIdsAtArrival.map((householdId, index) =>
        safeInteger(householdId, `${label} guardian ${index} household`, 1),
      ),
    ),
    guardianHouseholdMembershipStartTicksAtArrival: Object.freeze(
      value.guardianHouseholdMembershipStartTicksAtArrival.map((tick, index) =>
        tick === null
          ? null
          : safeInteger(
              tick,
              `${label} guardian ${index} membership start tick`,
              Number.MIN_SAFE_INTEGER,
            ),
      ),
    ),
    partnerRelationshipId:
      value.partnerRelationshipId === null
        ? null
        : safeInteger(value.partnerRelationshipId, `${label} partner relationship`, 1),
    partnerKindAtArrival:
      value.partnerKindAtArrival === null
        ? null
        : stringEnum(
            value.partnerKindAtArrival,
            ['partner', 'long-term-partner'] as const,
            `${label} partner kind`,
          ),
    minimumPartnerTrustAtArrival:
      value.minimumPartnerTrustAtArrival === null
        ? null
        : safeInteger(value.minimumPartnerTrustAtArrival, `${label} partner trust`, 0, 100),
    minimumPartnerCommitmentAtArrival:
      value.minimumPartnerCommitmentAtArrival === null
        ? null
        : safeInteger(
            value.minimumPartnerCommitmentAtArrival,
            `${label} partner commitment`,
            0,
            100,
          ),
    selectionScoreAtArrival: safeInteger(value.selectionScoreAtArrival, `${label} score`, 100),
  });
}

function assertSocietyCrossWorldReferences(
  society: SocietyState,
  civilization: Pick<CivilizationState, 'structures'>,
  eventLog: readonly WorldEvent[],
): void {
  const structureIds = new Set(civilization.structures.map((structure) => structure.id));
  const eventsById = new Map(eventLog.map((event) => [event.id, event]));
  for (const fact of society.pendingBiographyFacts) {
    for (const reference of [fact.source, fact.target]) {
      if (reference.kind === 'structure' && !structureIds.has(reference.id)) {
        throw new Error('Society biography fact references an unknown structure.');
      }
    }
  }
  const recordedEvent = (eventId: number, tick: number, label: string): WorldEvent | null => {
    if (eventId === 0) return null;
    const event = eventsById.get(eventId);
    if (event?.tick !== tick)
      throw new Error(`${label} references an unknown or inconsistent event.`);
    return event;
  };
  for (const relationship of [...society.interpersonal.active, ...society.interpersonal.archived]) {
    for (const reference of relationship.sharedEvents) {
      const source = recordedEvent(reference.eventId, reference.tick, 'Relationship');
      if (source === null || !relationshipEventMatchesSocialEdge(relationship, source))
        throw new Error('Relationship event identity is inconsistent.');
    }
  }
  for (const bond of society.interpersonal.familyBonds) {
    if (bond.formedEventId !== 0 && bond.formedTick === null)
      throw new Error('Family bond event requires a known formation tick.');
    if (bond.formedEventId !== 0) {
      const source = recordedEvent(bond.formedEventId, bond.formedTick!, 'Family bond');
      if (source === null || !relationshipEventMatchesFamilyBond(bond, source))
        throw new Error('Family bond formation event identity is inconsistent.');
    }
    for (const reference of bond.sharedEvents) {
      const source = recordedEvent(reference.eventId, reference.tick, 'Family bond');
      if (source === null || !relationshipEventMatchesFamilyBond(bond, source))
        throw new Error('Family bond event identity is inconsistent.');
    }
  }
  for (const arrival of society.interpersonal.childArrivals) {
    const source = recordedEvent(arrival.eventId, arrival.tick, 'Child arrival');
    if (
      source?.kind !== 'person-born' ||
      source.subjectKind !== 'person' ||
      source.subjectId !== arrival.childId ||
      source.targetKind !== 'household' ||
      source.targetId !== arrival.householdId
    )
      throw new Error('Child arrival event identity is inconsistent.');
    const eligibilitySource = recordedEvent(
      arrival.eligibilityEventId,
      arrival.tick,
      'Child arrival eligibility',
    );
    if (
      eligibilitySource === null ||
      !childArrivalEligibilityEventMatches(arrival, {
        kind: eligibilitySource.kind,
        subjectKind: eligibilitySource.subjectKind,
        subjectId: eligibilitySource.subjectId,
        targetKind: eligibilitySource.targetKind,
        targetId: eligibilitySource.targetId,
      }) ||
      eligibilitySource.childArrivalEligibility === undefined ||
      !childArrivalEligibilityEvidenceMatchesRecord(
        arrival,
        eligibilitySource.childArrivalEligibility,
      ) ||
      eligibilitySource.amount !== arrival.householdId
    )
      throw new Error('Child arrival eligibility event identity is inconsistent.');
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
        traits: agent.traits,
        skills: agent.skills,
        occupation: agent.occupation,
        recentEventIds: Object.freeze(
          agent.memories
            .map((memory) => memory.eventId)
            .sort((left, right) => left - right)
            .slice(-16),
        ),
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
  const world: PreM6WorldState = Object.freeze({
    ...state,
    config: convertLegacyConfig(state.config),
    eventLog,
    civilization,
    development: createInitialDevelopment(state.seed, state.tick),
  });
  return migratePreM6World(world);
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
  assertExactKeys(
    value.civilization,
    [...VERSION_THREE_CIVILIZATION_KEYS, 'society'],
    'Snapshot civilization',
  );
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
    true,
    legacyCiv.relationships.map((relationship) => ({
      firstPersonId: relationship.firstAgentId,
      secondPersonId: relationship.secondAgentId,
      affinity: relationship.affinity,
      trust: relationship.trust,
    })),
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
  assertSocietyCrossWorldReferences(society, civilization, eventLog);
  const world: PreM6WorldState = Object.freeze({
    ...legacy,
    config,
    eventLog,
    civilization,
    development: createInitialDevelopment(legacy.seed, legacy.tick),
  });
  return migratePreM6World(world);
}

/** Parses v4 authority before its conservative v5 development-baseline migration. */
function parseVersionFourWorldPayload(value: unknown, validate = true): WorldState {
  if (!isRecord(value)) throw new Error('Snapshot payload must be an object.');
  assertExactKeys(value, [...LEGACY_PAYLOAD_KEYS, 'civilization'], 'Snapshot payload');
  if (!isRecord(value.civilization)) throw new Error('Snapshot civilization must be an object.');
  assertExactKeys(value.civilization, VERSION_FOUR_CIVILIZATION_KEYS, 'Snapshot civilization');
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
  const legacyCivilization: UnknownRecord = {
    ...value.civilization,
    nextRelationshipId: 1,
    relationships: [],
  };
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
  const parsedLegacyCivilization = parseCivilization(
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
    false,
  );
  if (society.yearTicks !== config.societyYearTicks)
    throw new Error('Society calendar does not match the world calendar.');
  const {
    nextRelationshipId: _nextRelationshipId,
    relationships: _relationships,
    ...civilizationBase
  } = parsedLegacyCivilization;
  void _nextRelationshipId;
  void _relationships;
  const civilization: CivilizationState = Object.freeze({
    ...civilizationBase,
    agents: Object.freeze(
      parsedLegacyCivilization.agents.map((agent) =>
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
  assertSocietyCrossWorldReferences(society, civilization, eventLog);
  const world: PreM6WorldState = Object.freeze({
    ...legacy,
    config,
    eventLog,
    civilization,
    development: createInitialDevelopment(legacy.seed, legacy.tick),
  });
  return migratePreM6World(world, validate);
}

function parseVersionFiveWorldPayload(value: unknown, validate = true): WorldState {
  if (!isRecord(value)) throw new Error('Snapshot payload must be an object.');
  assertExactKeys(
    value,
    [...LEGACY_PAYLOAD_KEYS, 'civilization', 'development'],
    'Snapshot payload',
  );
  const versionFourPayload = { ...value };
  delete versionFourPayload.development;
  const world = parseVersionFourWorldPayload(versionFourPayload, false);
  const development = parseDevelopment(
    value.development,
    world.tick,
    world.config.width * world.config.height,
  );
  const current: WorldState = Object.freeze({ ...world, development });
  if (validate) assertWorldInvariants(current);
  return current;
}

function parseVersionSixWorldPayload(value: unknown): WorldState {
  if (!isRecord(value)) throw new Error('Snapshot payload must be an object.');
  assertExactKeys(
    value,
    [...LEGACY_PAYLOAD_KEYS, 'civilization', 'civilizations', 'development'],
    'Snapshot payload',
  );
  const versionFivePayload = { ...value };
  delete versionFivePayload.civilizations;
  const world = parseVersionFiveWorldPayload(versionFivePayload, false);
  const civilizations = parseCivilizations(
    value.civilizations,
    world.tick,
    world.config.width * world.config.height,
  );
  const current: WorldState = Object.freeze({
    ...world,
    civilizations,
    ...initializeM8WorldAuthority({ ...world, civilizations }),
  });
  assertWorldInvariants(current);
  return current;
}

function parseScaleIds(value: unknown, name: string): readonly number[] {
  if (!isUnknownArray(value)) throw new Error(`${name} must be an array.`);
  return Object.freeze(value.map((entry, index) => safeInteger(entry, `${name}[${index}]`, 1)));
}

function parseScaleTotals(value: unknown, name: string): AggregateTotals {
  if (!isRecord(value)) throw new Error(`${name} must be an object.`);
  assertExactKeys(value, ['age', 'foodNeed', 'health', 'safety', 'skill', 'waterNeed'], name);
  return Object.freeze({
    age: safeInteger(value.age, `${name}.age`),
    health: safeInteger(value.health, `${name}.health`),
    foodNeed: safeInteger(value.foodNeed, `${name}.foodNeed`),
    waterNeed: safeInteger(value.waterNeed, `${name}.waterNeed`),
    safety: safeInteger(value.safety, `${name}.safety`),
    skill: safeInteger(value.skill, `${name}.skill`),
  });
}

function parsePopulationScale(value: unknown, worldTick: number): PopulationScaleState {
  if (!isRecord(value)) throw new Error('Snapshot population scale must be an object.');
  assertExactKeys(
    value,
    [
      'backlog',
      'cohorts',
      'detailedResidents',
      'nextCohortId',
      'nextTransferId',
      'operationCount',
      'rng',
      'tick',
      'transfers',
    ],
    'Snapshot population scale',
  );
  if (
    !isUnknownArray(value.detailedResidents) ||
    !isUnknownArray(value.cohorts) ||
    !isUnknownArray(value.transfers)
  )
    throw new Error('Snapshot population scale collections must be arrays.');
  const detailedResidents = Object.freeze(
    value.detailedResidents.map((candidate, index): DetailedResidentState => {
      if (!isRecord(candidate))
        throw new Error(`Snapshot detailed resident ${index} must be an object.`);
      assertExactKeys(
        candidate,
        [
          'age',
          'civilizationId',
          'cultureId',
          'eventIds',
          'familyIds',
          'foodNeed',
          'health',
          'householdId',
          'id',
          'importance',
          'nextUpdateTick',
          'relationshipIds',
          'rng',
          'safety',
          'settlementId',
          'skill',
          'tileIndex',
          'updateCount',
          'waterNeed',
        ],
        `Snapshot detailed resident ${index}`,
      );
      return Object.freeze({
        id: safeInteger(candidate.id, `Snapshot detailed resident ${index} id`, 1),
        settlementId: safeInteger(
          candidate.settlementId,
          `Snapshot detailed resident ${index} settlement`,
          1,
        ),
        civilizationId: safeInteger(
          candidate.civilizationId,
          `Snapshot detailed resident ${index} civilization`,
          1,
        ),
        cultureId: safeInteger(
          candidate.cultureId,
          `Snapshot detailed resident ${index} culture`,
          1,
        ),
        householdId: safeInteger(
          candidate.householdId,
          `Snapshot detailed resident ${index} household`,
          1,
        ),
        tileIndex: safeInteger(candidate.tileIndex, `Snapshot detailed resident ${index} tile`),
        age: safeInteger(candidate.age, `Snapshot detailed resident ${index} age`),
        health: safeInteger(candidate.health, `Snapshot detailed resident ${index} health`),
        foodNeed: safeInteger(candidate.foodNeed, `Snapshot detailed resident ${index} food need`),
        waterNeed: safeInteger(
          candidate.waterNeed,
          `Snapshot detailed resident ${index} water need`,
        ),
        safety: safeInteger(candidate.safety, `Snapshot detailed resident ${index} safety`),
        skill: safeInteger(candidate.skill, `Snapshot detailed resident ${index} skill`),
        importance: safeInteger(
          candidate.importance,
          `Snapshot detailed resident ${index} importance`,
        ),
        nextUpdateTick: safeInteger(
          candidate.nextUpdateTick,
          `Snapshot detailed resident ${index} next update`,
        ),
        updateCount: safeInteger(
          candidate.updateCount,
          `Snapshot detailed resident ${index} updates`,
        ),
        rng: parseRng(candidate.rng, `Snapshot detailed resident ${index} rng`),
        relationshipIds: parseScaleIds(
          candidate.relationshipIds,
          `Snapshot detailed resident ${index} relationships`,
        ),
        familyIds: parseScaleIds(candidate.familyIds, `Snapshot detailed resident ${index} family`),
        eventIds: parseScaleIds(candidate.eventIds, `Snapshot detailed resident ${index} events`),
      });
    }),
  );
  const cohorts = Object.freeze(
    value.cohorts.map((candidate, index): AggregateCohortState => {
      if (!isRecord(candidate) || !isRecord(candidate.classification))
        throw new Error(`Snapshot scale cohort ${index} must be an object.`);
      assertExactKeys(
        candidate,
        [
          'classification',
          'householdCount',
          'id',
          'nextUpdateTick',
          'residentIds',
          'totals',
          'updateCount',
        ],
        `Snapshot scale cohort ${index}`,
      );
      assertExactKeys(
        candidate.classification,
        ['civilizationId', 'cultureId', 'householdId', 'settlementId', 'tileIndex'],
        `Snapshot scale cohort ${index} classification`,
      );
      return Object.freeze({
        id: safeInteger(candidate.id, `Snapshot scale cohort ${index} id`, 1),
        classification: Object.freeze({
          settlementId: safeInteger(
            candidate.classification.settlementId,
            `Snapshot scale cohort ${index} settlement`,
            1,
          ),
          civilizationId: safeInteger(
            candidate.classification.civilizationId,
            `Snapshot scale cohort ${index} civilization`,
            1,
          ),
          cultureId: safeInteger(
            candidate.classification.cultureId,
            `Snapshot scale cohort ${index} culture`,
            1,
          ),
          householdId: safeInteger(
            candidate.classification.householdId,
            `Snapshot scale cohort ${index} household`,
            1,
          ),
          tileIndex: safeInteger(
            candidate.classification.tileIndex,
            `Snapshot scale cohort ${index} tile`,
          ),
        }),
        residentIds: parseScaleIds(
          candidate.residentIds,
          `Snapshot scale cohort ${index} residents`,
        ),
        householdCount: safeInteger(
          candidate.householdCount,
          `Snapshot scale cohort ${index} household count`,
          1,
        ),
        totals: parseScaleTotals(candidate.totals, `Snapshot scale cohort ${index} totals`),
        nextUpdateTick: safeInteger(
          candidate.nextUpdateTick,
          `Snapshot scale cohort ${index} next update`,
        ),
        updateCount: safeInteger(candidate.updateCount, `Snapshot scale cohort ${index} updates`),
      });
    }),
  );
  const transfers = Object.freeze(
    value.transfers.map((candidate, index): ScaleTransferDelta => {
      if (!isRecord(candidate))
        throw new Error(`Snapshot scale transfer ${index} must be an object.`);
      assertExactKeys(
        candidate,
        [
          'cohortId',
          'firstResidentId',
          'id',
          'kind',
          'lastResidentId',
          'residentCount',
          'tick',
          'totals',
        ],
        `Snapshot scale transfer ${index}`,
      );
      if (candidate.kind !== 'aggregated' && candidate.kind !== 'deaggregated')
        throw new Error(`Snapshot scale transfer ${index} kind is invalid.`);
      return Object.freeze({
        id: safeInteger(candidate.id, `Snapshot scale transfer ${index} id`, 1),
        tick: safeInteger(candidate.tick, `Snapshot scale transfer ${index} tick`),
        kind: candidate.kind,
        cohortId: safeInteger(candidate.cohortId, `Snapshot scale transfer ${index} cohort`, 1),
        residentCount: safeInteger(
          candidate.residentCount,
          `Snapshot scale transfer ${index} residents`,
          1,
        ),
        firstResidentId: safeInteger(
          candidate.firstResidentId,
          `Snapshot scale transfer ${index} first resident`,
          1,
        ),
        lastResidentId: safeInteger(
          candidate.lastResidentId,
          `Snapshot scale transfer ${index} last resident`,
          1,
        ),
        totals: parseScaleTotals(candidate.totals, `Snapshot scale transfer ${index} totals`),
      });
    }),
  );
  if (!isRecord(value.backlog)) throw new Error('Snapshot scale backlog must be an object.');
  assertExactKeys(
    value.backlog,
    ['cohortDue', 'detailedDue', 'totalDue'],
    'Snapshot scale backlog',
  );
  const state: PopulationScaleState = Object.freeze({
    tick: safeInteger(value.tick, 'Snapshot population scale tick', 0, worldTick),
    nextCohortId: safeInteger(value.nextCohortId, 'Snapshot population scale next cohort', 1),
    nextTransferId: safeInteger(value.nextTransferId, 'Snapshot population scale next transfer', 1),
    rng: parseRng(value.rng, 'Snapshot population scale rng'),
    detailedResidents,
    cohorts,
    transfers,
    backlog: Object.freeze({
      detailedDue: safeInteger(value.backlog.detailedDue, 'Snapshot scale detailed backlog'),
      cohortDue: safeInteger(value.backlog.cohortDue, 'Snapshot scale cohort backlog'),
      totalDue: safeInteger(value.backlog.totalDue, 'Snapshot scale total backlog'),
    }),
    operationCount: safeInteger(value.operationCount, 'Snapshot population scale operations'),
  });
  assertPopulationScaleInvariants(state);
  return state;
}

function parsePathRequest(value: unknown, name: string): PathCacheRequest {
  if (!isRecord(value) || !isRecord(value.start) || !isRecord(value.goal))
    throw new Error(`${name} must be an object.`);
  assertExactKeys(
    value,
    ['chunkSize', 'goal', 'height', 'maxExpansions', 'revision', 'start', 'width'],
    name,
  );
  assertExactKeys(value.start, ['x', 'y'], `${name} start`);
  assertExactKeys(value.goal, ['x', 'y'], `${name} goal`);
  return Object.freeze({
    width: safeInteger(value.width, `${name} width`, 1),
    height: safeInteger(value.height, `${name} height`, 1),
    chunkSize: safeInteger(value.chunkSize, `${name} chunk size`, 1),
    start: Object.freeze({
      x: safeInteger(value.start.x, `${name} start x`),
      y: safeInteger(value.start.y, `${name} start y`),
    }),
    goal: Object.freeze({
      x: safeInteger(value.goal.x, `${name} goal x`),
      y: safeInteger(value.goal.y, `${name} goal y`),
    }),
    maxExpansions: safeInteger(value.maxExpansions, `${name} expansions`),
    revision: safeInteger(value.revision, `${name} revision`),
  });
}

function parsePathCache(value: unknown, worldTick: number): PathCacheState {
  if (!isRecord(value)) throw new Error('Snapshot path cache must be an object.');
  assertExactKeys(
    value,
    [
      'backlog',
      'completed',
      'logicalTick',
      'nextEntryId',
      'nextRequestId',
      'operationCount',
      'pending',
      'terrainRevision',
    ],
    'Snapshot path cache',
  );
  if (!isUnknownArray(value.pending) || !isUnknownArray(value.completed))
    throw new Error('Snapshot path cache collections must be arrays.');
  const pending = Object.freeze(
    value.pending.map((candidate, index): PendingPathRequest => {
      if (!isRecord(candidate))
        throw new Error(`Snapshot pending path ${index} must be an object.`);
      assertExactKeys(
        candidate,
        ['key', 'queuedAtTick', 'request', 'requestId'],
        `Snapshot pending path ${index}`,
      );
      if (typeof candidate.key !== 'string')
        throw new Error(`Snapshot pending path ${index} key is invalid.`);
      return Object.freeze({
        requestId: safeInteger(candidate.requestId, `Snapshot pending path ${index} id`, 1),
        key: candidate.key,
        queuedAtTick: safeInteger(candidate.queuedAtTick, `Snapshot pending path ${index} tick`),
        request: parsePathRequest(candidate.request, `Snapshot pending path ${index} request`),
      });
    }),
  );
  const completed = Object.freeze(
    value.completed.map((candidate, index): CachedPathResult => {
      if (
        !isRecord(candidate) ||
        !isUnknownArray(candidate.tilePath) ||
        !isUnknownArray(candidate.chunkRoute) ||
        !isUnknownArray(candidate.flowDirections)
      )
        throw new Error(`Snapshot completed path ${index} is malformed.`);
      assertExactKeys(
        candidate,
        [
          'chunkRoute',
          'completedAtTick',
          'entryId',
          'expansions',
          'flowDirections',
          'key',
          'lastUsedTick',
          'request',
          'status',
          'tilePath',
        ],
        `Snapshot completed path ${index}`,
      );
      if (
        typeof candidate.key !== 'string' ||
        !['complete', 'no-path', 'quota-exhausted'].includes(String(candidate.status))
      )
        throw new Error(`Snapshot completed path ${index} status is invalid.`);
      if (
        !candidate.flowDirections.every((direction) =>
          ['north', 'east', 'south', 'west', 'arrived'].includes(String(direction)),
        )
      )
        throw new Error(`Snapshot completed path ${index} flow is invalid.`);
      return Object.freeze({
        entryId: safeInteger(candidate.entryId, `Snapshot completed path ${index} id`, 1),
        key: candidate.key,
        request: parsePathRequest(candidate.request, `Snapshot completed path ${index} request`),
        status: candidate.status as CachedPathResult['status'],
        expansions: safeInteger(
          candidate.expansions,
          `Snapshot completed path ${index} expansions`,
        ),
        tilePath: Object.freeze(
          candidate.tilePath.map((tile, tileIndex) =>
            safeInteger(tile, `Snapshot completed path ${index} tile ${tileIndex}`),
          ),
        ),
        chunkRoute: Object.freeze(
          candidate.chunkRoute.map((chunk, chunkIndex) =>
            safeInteger(chunk, `Snapshot completed path ${index} chunk ${chunkIndex}`),
          ),
        ),
        flowDirections: Object.freeze(
          candidate.flowDirections as CachedPathResult['flowDirections'],
        ),
        completedAtTick: safeInteger(
          candidate.completedAtTick,
          `Snapshot completed path ${index} completed tick`,
        ),
        lastUsedTick: safeInteger(
          candidate.lastUsedTick,
          `Snapshot completed path ${index} used tick`,
        ),
      });
    }),
  );
  const state: PathCacheState = Object.freeze({
    terrainRevision: safeInteger(value.terrainRevision, 'Snapshot path cache terrain revision'),
    logicalTick: safeInteger(value.logicalTick, 'Snapshot path cache logical tick', 0, worldTick),
    nextRequestId: safeInteger(value.nextRequestId, 'Snapshot path cache next request', 1),
    nextEntryId: safeInteger(value.nextEntryId, 'Snapshot path cache next entry', 1),
    pending,
    completed,
    backlog: safeInteger(value.backlog, 'Snapshot path cache backlog'),
    operationCount: safeInteger(value.operationCount, 'Snapshot path cache operations'),
  });
  assertPathCacheInvariants(state);
  return state;
}

function parseVersionEightWorldPayload(value: unknown): WorldState {
  if (!isRecord(value)) throw new Error('Snapshot payload must be an object.');
  assertExactKeys(
    value,
    [
      ...LEGACY_PAYLOAD_KEYS,
      'civilization',
      'civilizations',
      'development',
      'pathCache',
      'populationScale',
    ],
    'Snapshot payload',
  );
  const legacyPayload = { ...value };
  delete legacyPayload.populationScale;
  delete legacyPayload.pathCache;
  const base = parseVersionSixWorldPayload(legacyPayload);
  const current: WorldState = Object.freeze({
    ...base,
    populationScale: parsePopulationScale(value.populationScale, base.tick),
    pathCache: parsePathCache(value.pathCache, base.tick),
  });
  assertWorldInvariants(current);
  return current;
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
    const canonical = canonicalVersionTwoWorldJson(world);
    let difference = 0;
    while (difference < canonical.length && canonical[difference] === payloadJson[difference])
      difference += 1;
    throw new Error(
      `World snapshot payload is not canonical at byte ${difference}: ${payloadJson.slice(difference, difference + 80)} != ${canonical.slice(difference, difference + 80)}.`,
    );
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
    envelope.formatVersion !== 3 ||
    envelope.engineVersion !== 3 ||
    envelope.contentVersion !== 3 ||
    typeof envelope.checksum !== 'string'
  ) {
    throw new Error('World snapshot version metadata is invalid.');
  }
  const payloadJson = JSON.stringify(envelope.payload);
  if (hashCanonicalJson(payloadJson) !== envelope.checksum) {
    throw new Error('World snapshot checksum does not match its payload.');
  }
  const world = parseVersionThreeWorldPayload(envelope.payload);
  // v3 contains the retired dense authority. Exact-key parsing plus its checksum
  // validates the historical input; its one-way migration immediately emits v4's
  // canonical representation and never preserves a v3 payload as a new generation.
  return world;
}

function deserializeVersionFour(envelope: UnknownRecord): WorldState {
  assertExactKeys(
    envelope,
    ['checksum', 'contentVersion', 'engineVersion', 'format', 'formatVersion', 'payload'],
    'World snapshot envelope',
  );
  if (
    envelope.formatVersion !== 4 ||
    envelope.engineVersion !== 4 ||
    envelope.contentVersion !== 4 ||
    typeof envelope.checksum !== 'string'
  ) {
    throw new Error('World snapshot version metadata is invalid.');
  }
  const payloadJson = JSON.stringify(envelope.payload);
  if (hashCanonicalJson(payloadJson) !== envelope.checksum)
    throw new Error('World snapshot checksum does not match its payload.');
  const world = parseVersionFourWorldPayload(envelope.payload);
  const canonicalPayload = JSON.parse(canonicalWorldJson(world)) as UnknownRecord;
  delete canonicalPayload.development;
  delete canonicalPayload.civilizations;
  delete canonicalPayload.populationScale;
  delete canonicalPayload.pathCache;
  const canonical = JSON.stringify(canonicalPayload);
  if (canonical !== payloadJson) {
    let difference = 0;
    while (difference < canonical.length && canonical[difference] === payloadJson[difference])
      difference += 1;
    throw new Error(
      `World snapshot payload is not canonical at byte ${difference}: ${payloadJson.slice(difference, difference + 80)} != ${canonical.slice(difference, difference + 80)}.`,
    );
  }
  return world;
}

function deserializeVersionFive(envelope: UnknownRecord): WorldState {
  assertExactKeys(
    envelope,
    ['checksum', 'contentVersion', 'engineVersion', 'format', 'formatVersion', 'payload'],
    'World snapshot envelope',
  );
  if (
    envelope.formatVersion !== 5 ||
    envelope.engineVersion !== 5 ||
    envelope.contentVersion !== 5 ||
    typeof envelope.checksum !== 'string'
  ) {
    throw new Error('World snapshot version metadata is invalid.');
  }
  const payloadJson = JSON.stringify(envelope.payload);
  if (hashCanonicalJson(payloadJson) !== envelope.checksum)
    throw new Error('World snapshot checksum does not match its payload.');
  const world = parseVersionFiveWorldPayload(envelope.payload);
  const canonicalPayload = JSON.parse(canonicalWorldJson(world)) as UnknownRecord;
  delete canonicalPayload.civilizations;
  delete canonicalPayload.populationScale;
  delete canonicalPayload.pathCache;
  const canonical = JSON.stringify(canonicalPayload);
  if (canonical !== payloadJson) {
    let difference = 0;
    while (difference < canonical.length && canonical[difference] === payloadJson[difference])
      difference += 1;
    throw new Error(
      `World snapshot payload is not canonical at byte ${difference}: ${payloadJson.slice(difference, difference + 80)} != ${canonical.slice(difference, difference + 80)}.`,
    );
  }
  return world;
}

function deserializeVersionedWorld(envelope: UnknownRecord, version: number): WorldState {
  assertExactKeys(
    envelope,
    ['checksum', 'contentVersion', 'engineVersion', 'format', 'formatVersion', 'payload'],
    'World snapshot envelope',
  );
  if (
    envelope.formatVersion !== version ||
    envelope.engineVersion !== version ||
    envelope.contentVersion !== version ||
    typeof envelope.checksum !== 'string'
  ) {
    throw new Error('World snapshot version metadata is invalid.');
  }
  const payloadJson = JSON.stringify(envelope.payload);
  if (hashCanonicalJson(payloadJson) !== envelope.checksum)
    throw new Error('World snapshot checksum does not match its payload.');
  const world = parseVersionSixWorldPayload(envelope.payload);
  const canonicalPayload = JSON.parse(canonicalWorldJson(world)) as UnknownRecord;
  delete canonicalPayload.populationScale;
  delete canonicalPayload.pathCache;
  const canonical = JSON.stringify(canonicalPayload);
  if (canonical !== payloadJson) {
    let difference = 0;
    while (difference < canonical.length && canonical[difference] === payloadJson[difference])
      difference += 1;
    throw new Error(
      `World snapshot payload is not canonical at byte ${difference}: ${payloadJson.slice(difference, difference + 80)} != ${canonical.slice(difference, difference + 80)}.`,
    );
  }
  return world;
}

/** Parses the final M6 payload shape before its one-way v7 envelope migration. */
function deserializeVersionSix(envelope: UnknownRecord): WorldState {
  return deserializeVersionedWorld(envelope, WORLD_SNAPSHOT_VERSION_SIX);
}

/** Parses the v7 payload shape. Keep this pinned when a later format becomes current. */
function deserializeVersionSeven(envelope: UnknownRecord): WorldState {
  return deserializeVersionedWorld(envelope, WORLD_SNAPSHOT_VERSION_SEVEN);
}

/** Parses the strict v8 payload shape including population and cache authority. */
function deserializeVersionEight(envelope: UnknownRecord): WorldState {
  assertExactKeys(
    envelope,
    ['checksum', 'contentVersion', 'engineVersion', 'format', 'formatVersion', 'payload'],
    'World snapshot envelope',
  );
  if (
    envelope.formatVersion !== WORLD_SNAPSHOT_VERSION_EIGHT ||
    envelope.engineVersion !== WORLD_SNAPSHOT_VERSION_EIGHT ||
    envelope.contentVersion !== WORLD_SNAPSHOT_VERSION_EIGHT ||
    typeof envelope.checksum !== 'string'
  ) {
    throw new Error('World snapshot version metadata is invalid.');
  }
  const payloadJson = JSON.stringify(envelope.payload);
  if (hashCanonicalJson(payloadJson) !== envelope.checksum)
    throw new Error('World snapshot checksum does not match its payload.');
  const world = parseVersionEightWorldPayload(envelope.payload);
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
  if (formatVersion === WORLD_SNAPSHOT_VERSION_EIGHT) {
    return serializeWorldSnapshot(deserializeVersionEight(envelope));
  }
  if (formatVersion === WORLD_SNAPSHOT_VERSION_SEVEN) {
    return serializeWorldSnapshot(deserializeVersionSeven(envelope));
  }
  if (formatVersion === WORLD_SNAPSHOT_VERSION_SIX) {
    return serializeWorldSnapshot(deserializeVersionSix(envelope));
  }
  if (formatVersion === 5) {
    return serializeWorldSnapshot(deserializeVersionFive(envelope));
  }
  if (formatVersion === 4) {
    return serializeWorldSnapshot(deserializeVersionFour(envelope));
  }
  if (formatVersion === 3) {
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
  return deserializeVersionEight(parseEnvelope(migrated));
}
