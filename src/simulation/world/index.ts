import { hashCanonicalJson } from '../canonical';
import {
  assertFactualEventSummary,
  isPlayerVisibleEventKind,
  type PlayerVisibleEventKind,
} from '../events';
import {
  advanceCivilizations,
  assertCivilizationsInvariants,
  civilizationsDto,
  createInitialCivilizations,
  deriveSettlementDevelopmentStage,
  selectCoMigrationPerson,
  selectConflictTargetCivilization,
  selectPoliticalSupportCivilization,
  selectRefugeeSupportSettlement,
  type CivilizationEventDraft,
  type CivilizationsContext,
  type CivilizationsInitialization,
  type CivilizationsState,
  type CommunityReserves,
  type SettlementDevelopmentInput,
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
  FIRST_ORDINARY_RESIDENT_ID,
  advancePopulationScale,
  assertPopulationScaleInvariants,
  createPopulationScale,
  populationScaleDto,
  reconcileAnonymousPopulation,
  reconcilePopulationLod,
  removeAnonymousResidents,
  type DetailedResidentState,
  type PopulationScaleState,
} from '../scale';
import {
  advanceSpace,
  assertSpaceInvariants,
  createInitialSpace,
  spaceDto,
  type SpaceContext,
  type SpaceReferentKind,
  type SpaceResourceStock,
  type SpaceState,
} from '../space';
import {
  assertPathCacheInvariants,
  createPathCacheState,
  invalidatePathCache,
  toCanonicalPathCacheDto,
  type PathCacheState,
} from '../pathfinding/cache';
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
  advanceCivilizationWithPathCache,
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
  readonly kind: PlayerVisibleEventKind;
  readonly summary: string;
  readonly subjectKind: WorldEntityKind;
  readonly subjectId: number;
  readonly targetKind: WorldEntityKind;
  readonly targetId: number;
  readonly tileIndex: number;
  readonly amount: number;
  readonly childArrivalEligibility?: ChildArrivalEligibilityEvidence;
}

export interface WorldEventDetails {
  readonly summary: string;
  readonly subjectKind?: WorldEntityKind;
  readonly subjectId?: number;
  readonly targetKind?: WorldEntityKind;
  readonly targetId?: number;
  readonly tileIndex?: number;
  readonly amount?: number;
  readonly childArrivalEligibility?: ChildArrivalEligibilityEvidence;
}

export type SocietyWorldEvent = Omit<WorldEvent, 'subjectKind' | 'targetKind'> &
  Readonly<{ subjectKind: EntityKind; targetKind: EntityKind }>;

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
  /** M9's bounded planetary and interworld authority. */
  readonly space: SpaceState;
  /** Camera-independent detailed and aggregate population authority. */
  readonly populationScale: PopulationScaleState;
  /** Persisted deterministic cache authority; live request scheduling is separate. */
  readonly pathCache: PathCacheState;
  /** Compatibility projection; it aliases the root-level authoritative fields. */
  readonly tiles: WorldTileFields;
}

export type WorldEntityKind = EntityKind | SpaceReferentKind;

const SOCIETY_ENTITY_KINDS: readonly EntityKind[] = Object.freeze([
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

const WORLD_ENTITY_KINDS: readonly WorldEntityKind[] = Object.freeze([
  ...SOCIETY_ENTITY_KINDS,
  'celestial-body',
  'space-program',
  'spacecraft',
  'space-colony',
  'alien-civilization',
]);

function isEntityKind(value: unknown): value is WorldEntityKind {
  return typeof value === 'string' && (WORLD_ENTITY_KINDS as readonly string[]).includes(value);
}

function isSocietyEntityKind(value: WorldEntityKind): value is EntityKind {
  return (SOCIETY_ENTITY_KINDS as readonly WorldEntityKind[]).includes(value);
}

function societyWorldEvent(event: WorldEvent): SocietyWorldEvent {
  if (!isSocietyEntityKind(event.subjectKind) || !isSocietyEntityKind(event.targetKind)) {
    throw new Error('A space-referenced event cannot enter person memory or biography authority.');
  }
  return event as SocietyWorldEvent;
}

function worldReferenceExists(state: WorldState, kind: WorldEntityKind, id: number): boolean {
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
    case 'celestial-body':
      return state.space.bodies.some((body) => body.id === id);
    case 'space-program':
      return state.space.programs.some((program) => program.id === id);
    case 'spacecraft':
      return state.space.spacecraft.some((spacecraft) => spacecraft.id === id);
    case 'space-colony':
      return state.space.colonies.some((colony) => colony.id === id);
    case 'alien-civilization':
      return state.space.aliens.some((alien) => alien.id === id);
  }
}

type WorldReferenceLabelIndex = ReadonlyMap<string, readonly string[]>;

function worldReferenceLabelKey(kind: WorldEntityKind, id: number): string {
  return `${kind}:${id}`;
}

function createWorldReferenceLabelIndex(state: WorldState): WorldReferenceLabelIndex {
  const labels = new Map<string, readonly string[]>();
  const add = (kind: WorldEntityKind, id: number, values: readonly string[]): void => {
    labels.set(worldReferenceLabelKey(kind, id), Object.freeze([...values]));
  };
  for (const person of state.civilization.agents)
    add('person', person.id, [person.name, `person ${person.id}`]);
  for (const structure of state.civilization.structures)
    add('structure', structure.id, [
      `${structure.kind} ${structure.id}`,
      `structure ${structure.id}`,
    ]);
  for (const household of state.civilization.society.households)
    add('household', household.id, [`household ${household.id}`]);
  for (const culture of state.civilization.society.cultures)
    add('culture', culture.id, [culture.name, `culture ${culture.id}`]);
  for (const group of state.civilization.society.groups)
    add('group', group.id, [group.name, `group ${group.id}`]);
  const institution = state.civilization.society.institution;
  add('institution', institution.id, [
    `${institution.kind} ${institution.id}`,
    `institution ${institution.id}`,
  ]);
  for (const settlement of state.civilizations.settlements)
    add('settlement', settlement.id, [settlement.name, `settlement ${settlement.id}`]);
  for (const civilization of state.civilizations.civilizations)
    add('civilization', civilization.id, [civilization.name, `civilization ${civilization.id}`]);
  for (const route of state.civilizations.routes) add('route', route.id, [`route ${route.id}`]);
  for (const conflict of state.civilizations.conflicts)
    add('conflict', conflict.id, [`conflict ${conflict.id}`]);
  for (const ruin of state.civilizations.ruins) add('ruin', ruin.id, [`ruin ${ruin.id}`]);
  for (const body of state.space.bodies)
    add('celestial-body', body.id, [body.name, `body ${body.id}`]);
  for (const program of state.space.programs)
    add('space-program', program.id, [`program ${program.id}`]);
  for (const spacecraft of state.space.spacecraft)
    add('spacecraft', spacecraft.id, [`spacecraft ${spacecraft.id}`]);
  for (const colony of state.space.colonies)
    add('space-colony', colony.id, [`colony ${colony.id}`]);
  for (const alien of state.space.aliens)
    add('alien-civilization', alien.id, [`alien civilization ${alien.id}`]);
  return labels;
}

function worldReferenceLabels(
  state: WorldState,
  kind: WorldEntityKind,
  id: number,
  index?: WorldReferenceLabelIndex,
): readonly string[] {
  if (index !== undefined) return index.get(worldReferenceLabelKey(kind, id)) ?? Object.freeze([]);
  switch (kind) {
    case 'world':
      return Object.freeze([]);
    case 'person': {
      const person = state.civilization.agents.find((agent) => agent.id === id);
      return person === undefined
        ? Object.freeze([])
        : Object.freeze([person.name, `person ${id}`]);
    }
    case 'structure': {
      const structure = state.civilization.structures.find((candidate) => candidate.id === id);
      return structure === undefined
        ? Object.freeze([])
        : Object.freeze([`${structure.kind} ${id}`, `structure ${id}`]);
    }
    case 'household':
      return Object.freeze([`household ${id}`]);
    case 'culture': {
      const culture = state.civilization.society.cultures.find((candidate) => candidate.id === id);
      return culture === undefined
        ? Object.freeze([])
        : Object.freeze([culture.name, `culture ${id}`]);
    }
    case 'group': {
      const group = state.civilization.society.groups.find((candidate) => candidate.id === id);
      return group === undefined ? Object.freeze([]) : Object.freeze([group.name, `group ${id}`]);
    }
    case 'institution': {
      const institution = state.civilization.society.institution;
      return institution.id === id
        ? Object.freeze([`${institution.kind} ${id}`, `institution ${id}`])
        : Object.freeze([]);
    }
    case 'settlement': {
      const settlement = state.civilizations.settlements.find((candidate) => candidate.id === id);
      return settlement === undefined
        ? Object.freeze([])
        : Object.freeze([settlement.name, `settlement ${id}`]);
    }
    case 'civilization': {
      const civilization = state.civilizations.civilizations.find(
        (candidate) => candidate.id === id,
      );
      return civilization === undefined
        ? Object.freeze([])
        : Object.freeze([civilization.name, `civilization ${id}`]);
    }
    case 'route':
      return Object.freeze([`route ${id}`]);
    case 'conflict':
      return Object.freeze([`conflict ${id}`]);
    case 'ruin':
      return Object.freeze([`ruin ${id}`]);
    case 'celestial-body': {
      const body = state.space.bodies.find((candidate) => candidate.id === id);
      return body === undefined ? Object.freeze([]) : Object.freeze([body.name, `body ${id}`]);
    }
    case 'space-program':
      return Object.freeze([`program ${id}`]);
    case 'spacecraft':
      return Object.freeze([`spacecraft ${id}`]);
    case 'space-colony':
      return Object.freeze([`colony ${id}`]);
    case 'alien-civilization':
      return Object.freeze([`alien civilization ${id}`]);
  }
}

function assertSummaryNamesReference(
  state: WorldState,
  kind: WorldEntityKind,
  id: number,
  summary: string,
  role: 'subject' | 'target',
  index?: WorldReferenceLabelIndex,
): void {
  if (kind === 'world') return;
  const normalized = summary.toLowerCase();
  const labels = worldReferenceLabels(state, kind, id, index);
  if (labels.length === 0 || !labels.some((label) => normalized.includes(label.toLowerCase()))) {
    throw new RangeError(`Factual event summary must identify its ${role}.`);
  }
}

function worldEventDescriptionIsValid(
  state: WorldState,
  event: WorldEvent,
  index?: WorldReferenceLabelIndex,
): boolean {
  try {
    if (!isPlayerVisibleEventKind(event.kind)) return false;
    assertFactualEventSummary(event.summary);
    assertSummaryNamesReference(
      state,
      event.subjectKind,
      event.subjectId,
      event.summary,
      'subject',
      index,
    );
    assertSummaryNamesReference(
      state,
      event.targetKind,
      event.targetId,
      event.summary,
      'target',
      index,
    );
    return true;
  } catch {
    return false;
  }
}

/** Rejects current-format event prose that is generic, placeholder-bearing, or omits typed participants. */
export function assertWorldEventDescriptions(state: WorldState): void {
  const index = createWorldReferenceLabelIndex(state);
  for (const event of state.eventLog) {
    if (!worldEventDescriptionIsValid(state, event, index)) {
      throw new Error(`World event ${event.id} has invalid factual description copy.`);
    }
  }
}

function replaceLegacyCelestialLabels(state: WorldState, summary: string): string {
  return summary.replace(/\bBody-(\d+)\b/g, (placeholder, idText: string) => {
    const id = Number(idText);
    return state.space.bodies.find((body) => body.id === id)?.name ?? placeholder;
  });
}

function eventReferenceLabel(
  state: WorldState,
  kind: WorldEntityKind,
  id: number,
  compact = false,
  index?: WorldReferenceLabelIndex,
): string {
  if (kind === 'world') return 'the world';
  const labels = worldReferenceLabels(state, kind, id, index);
  if (labels.length === 0) return `${kind.replaceAll('-', ' ')} ${id}`;
  return labels[compact ? labels.length - 1 : 0]!;
}

function upgradedLegacyEventSummary(
  state: WorldState,
  event: WorldEvent,
  index: WorldReferenceLabelIndex,
): string {
  const replaced = replaceLegacyCelestialLabels(state, event.summary);
  const replacedEvent = Object.freeze({ ...event, summary: replaced });
  if (worldEventDescriptionIsValid(state, replacedEvent, index)) return replaced;

  const participantLabels = [
    ...(event.subjectKind === 'world'
      ? []
      : [eventReferenceLabel(state, event.subjectKind, event.subjectId, false, index)]),
    ...(event.targetKind === 'world'
      ? []
      : [eventReferenceLabel(state, event.targetKind, event.targetId, false, index)]),
  ].filter((label, index, labels) => labels.indexOf(label) === index);
  const participants =
    participantLabels.length === 0
      ? `The event recorded amount ${event.amount}.`
      : `It involved ${participantLabels.join(' and ')} with recorded amount ${event.amount}.`;
  const contextual = `At tick ${event.tick}: ${replaced} ${participants}`;
  const contextualEvent = Object.freeze({ ...event, summary: contextual });
  if (contextual.length <= 160 && worldEventDescriptionIsValid(state, contextualEvent, index)) {
    return contextual;
  }

  const compactLabels = [
    ...(event.subjectKind === 'world'
      ? []
      : [eventReferenceLabel(state, event.subjectKind, event.subjectId, true, index)]),
    ...(event.targetKind === 'world'
      ? []
      : [eventReferenceLabel(state, event.targetKind, event.targetId, true, index)]),
  ].filter((label, index, labels) => labels.indexOf(label) === index);
  const eventLabel = event.kind.replaceAll('-', ' ');
  const fallback =
    compactLabels.length === 0
      ? `At tick ${event.tick}, ${eventLabel} was recorded for the world with amount ${event.amount}.`
      : `At tick ${event.tick}, ${eventLabel} involved ${compactLabels.join(' and ')} with recorded amount ${event.amount}.`;
  const fallbackEvent = Object.freeze({ ...event, summary: fallback });
  if (!worldEventDescriptionIsValid(state, fallbackEvent, index)) {
    throw new Error(`World event ${event.id} could not be upgraded to factual description copy.`);
  }
  return fallback;
}

/** Upgrades legacy display copy without changing event identity, references, ticks, or amounts. */
export function upgradeLegacyWorldEventDescriptions(state: WorldState): WorldState {
  const index = createWorldReferenceLabelIndex(state);
  const summariesByEventId = new Map<number, string>();
  const eventLog = Object.freeze(
    state.eventLog.map((event) => {
      const summary = upgradedLegacyEventSummary(state, event, index);
      summariesByEventId.set(event.id, summary);
      return summary === event.summary ? event : Object.freeze({ ...event, summary });
    }),
  );
  const society = state.civilization.society;
  const pendingBiographyFacts = Object.freeze(
    society.pendingBiographyFacts.map((fact) => {
      const summary = upgradedLegacyEventSummary(
        state,
        Object.freeze({
          id: 1,
          tick: state.tick,
          kind: fact.kind,
          summary: fact.summary,
          subjectKind: fact.source.kind,
          subjectId: fact.source.id,
          targetKind: fact.target.kind,
          targetId: fact.target.id,
          tileIndex: -1,
          amount: 0,
        }),
        index,
      );
      return summary === fact.summary ? fact : Object.freeze({ ...fact, summary });
    }),
  );
  const agents = Object.freeze(
    state.civilization.agents.map((agent) =>
      Object.freeze({
        ...agent,
        memories: Object.freeze(
          agent.memories.map((memory) => {
            const summary = summariesByEventId.get(memory.eventId) ?? memory.summary;
            return summary === memory.summary ? memory : Object.freeze({ ...memory, summary });
          }),
        ),
      }),
    ),
  );
  const upgraded = Object.freeze({
    ...state,
    eventLog,
    civilization: Object.freeze({
      ...state.civilization,
      agents,
      society: Object.freeze({ ...society, pendingBiographyFacts }),
    }),
  });
  assertWorldInvariants(upgraded);
  assertWorldEventDescriptions(upgraded);
  return upgraded;
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

function sortedBoundedIds(ids: Iterable<number>, maximum: number): readonly number[] {
  return Object.freeze(
    [...new Set(ids)]
      .filter((id) => Number.isSafeInteger(id) && id > 0)
      .sort((left, right) => left - right)
      .slice(0, maximum),
  );
}

function namedScaleResidents(
  state: Pick<WorldState, 'civilization' | 'civilizations' | 'config' | 'tick'>,
): readonly DetailedResidentState[] {
  const society = state.civilization.society;
  const agentsById = new Map(state.civilization.agents.map((agent) => [agent.id, agent]));
  const residencyByPersonId = new Map(
    state.civilizations.residencies
      .filter((residency) => residency.subjectKind === 'person' && residency.endedTick === null)
      .map((residency) => [residency.subjectId, residency]),
  );
  const settlementsById = new Map(
    state.civilizations.settlements.map((settlement) => [settlement.id, settlement]),
  );
  const primarySettlement = state.civilizations.settlements[0];
  if (primarySettlement === undefined) throw new Error('World requires a primary settlement.');
  const interpersonal = society.interpersonal;
  return Object.freeze(
    society.people
      .filter((person) => person.alive)
      .map((person): DetailedResidentState => {
        const agent = agentsById.get(person.id);
        if (agent === undefined)
          throw new Error('Alive named people must retain a detailed agent record.');
        const settlement =
          settlementsById.get(residencyByPersonId.get(person.id)?.settlementId ?? -1) ??
          primarySettlement;
        const relationshipIds = sortedBoundedIds(
          [...interpersonal.active, ...interpersonal.archived]
            .filter(
              (relationship) =>
                relationship.firstPersonId === person.id ||
                relationship.secondPersonId === person.id,
            )
            .map((relationship) => relationship.id),
          24,
        );
        const familyIds = sortedBoundedIds(
          interpersonal.familyBonds
            .filter((bond) => bond.parentId === person.id || bond.childId === person.id)
            .flatMap((bond) => [bond.parentId, bond.childId]),
          16,
        );
        const eventIds = sortedBoundedIds(
          [
            ...person.biographyEventIds,
            ...agent.memories.map((memory) => memory.eventId),
            ...interpersonal.active.flatMap((relationship) =>
              relationship.firstPersonId === person.id || relationship.secondPersonId === person.id
                ? relationship.sharedEvents.map((event) => event.eventId)
                : [],
            ),
            ...interpersonal.familyBonds.flatMap((bond) =>
              bond.parentId === person.id || bond.childId === person.id
                ? bond.sharedEvents.map((event) => event.eventId)
                : [],
            ),
          ],
          16,
        );
        return Object.freeze({
          id: person.id,
          settlementId: settlement.id,
          civilizationId: settlement.civilizationId,
          cultureId: person.cultureId,
          householdId: person.householdId,
          tileIndex: agent.tileIndex,
          age: Math.trunc(agent.ageTicks / state.config.societyYearTicks),
          health: agent.health,
          foodNeed: agent.hunger,
          waterNeed: agent.thirst,
          safety: agent.safety,
          skill: agent.skills.reduce((total, skill) => total + skill, 0),
          // Society remains authoritative for these people; this makes every live named life
          // ineligible for generic aggregation even before it acquires a social reference.
          importance: 1,
          nextUpdateTick: state.tick,
          updateCount: 0,
          rng: agent.rng,
          relationshipIds,
          familyIds,
          eventIds,
        });
      })
      .sort((left, right) => left.id - right.id),
  );
}

function reconcileSettlementPopulationAuthority(
  state: Pick<WorldState, 'civilization' | 'civilizations' | 'config' | 'populationScale' | 'tick'>,
): PopulationScaleState {
  const named = namedScaleResidents(state);
  const namedBySettlement = new Map<number, number>();
  for (const resident of named) {
    namedBySettlement.set(
      resident.settlementId,
      (namedBySettlement.get(resident.settlementId) ?? 0) + 1,
    );
  }
  return reconcileAnonymousPopulation(
    state.populationScale,
    [...state.civilizations.settlements]
      .sort((left, right) => left.id - right.id)
      .map((settlement) => ({
        settlementId: settlement.id,
        civilizationId: settlement.civilizationId,
        cultureId: settlement.cultureId,
        tileIndex: settlement.centerTileIndex,
        residentCount:
          settlement.status === 'abandoned'
            ? 0
            : Math.max(0, settlement.population - (namedBySettlement.get(settlement.id) ?? 0)),
      })),
  );
}

/** Initializes M8 state at a saved tick without replaying population or cache history. */
export function initializeM8WorldAuthority(
  state: Pick<WorldState, 'seed' | 'civilization' | 'civilizations' | 'config' | 'tick'>,
): Pick<WorldState, 'populationScale' | 'pathCache'> {
  const populationScale = createPopulationScale(
    deriveXoshiro128State(state.seed, 'population-scale'),
    state.tick,
    { detailedResidents: namedScaleResidents(state) },
  );
  const reconciledPopulationScale = reconcileSettlementPopulationAuthority({
    ...state,
    populationScale,
  });
  const pathCache = Object.freeze({ ...createPathCacheState(0), logicalTick: state.tick });
  assertPathCacheInvariants(pathCache);
  return Object.freeze({ populationScale: reconciledPopulationScale, pathCache });
}

function synchronizePopulationScale(state: WorldState): PopulationScaleState {
  const named = namedScaleResidents(state);
  const namedIds = new Set(named.map((resident) => resident.id));
  const societyPersonIds = new Set(state.civilization.society.people.map((person) => person.id));
  const existingById = new Map(
    state.populationScale.detailedResidents.map((resident) => [resident.id, resident]),
  );
  for (const cohort of state.populationScale.cohorts)
    for (const residentId of cohort.residentIds)
      if (namedIds.has(residentId))
        throw new Error('Named residents cannot also appear in aggregate population authority.');
  const detailedResidents = [
    ...state.populationScale.detailedResidents.filter(
      (resident) => !societyPersonIds.has(resident.id),
    ),
    ...named.map((resident) => {
      const existing = existingById.get(resident.id);
      return existing === undefined
        ? resident
        : Object.freeze({
            ...resident,
            nextUpdateTick: existing.nextUpdateTick,
            updateCount: existing.updateCount,
            rng: existing.rng,
          });
    }),
  ].sort((left, right) => left.id - right.id);
  const provisional = {
    ...state.populationScale,
    detailedResidents: Object.freeze(detailedResidents),
  };
  // The scale module keeps this denormalized telemetry intentionally explicit.
  const rebuilt = createPopulationScale(provisional.rng, provisional.tick, {
    detailedResidents: provisional.detailedResidents,
    cohorts: provisional.cohorts,
  });
  const synchronized: PopulationScaleState = Object.freeze({
    ...provisional,
    backlog: rebuilt.backlog,
  });
  assertPopulationScaleInvariants(synchronized);
  return synchronized;
}

function synchronizeSettlementPopulation(state: WorldState): WorldState {
  const populationBySettlement = new Map<number, number>();
  for (const resident of state.populationScale.detailedResidents)
    populationBySettlement.set(
      resident.settlementId,
      (populationBySettlement.get(resident.settlementId) ?? 0) + 1,
    );
  for (const cohort of state.populationScale.cohorts)
    populationBySettlement.set(
      cohort.classification.settlementId,
      (populationBySettlement.get(cohort.classification.settlementId) ?? 0) +
        cohort.residentIds.length,
    );
  return Object.freeze({
    ...state,
    civilizations: Object.freeze({
      ...state.civilizations,
      settlements: Object.freeze(
        state.civilizations.settlements.map((settlement) =>
          Object.freeze({
            ...settlement,
            population: populationBySettlement.get(settlement.id) ?? 0,
          }),
        ),
      ),
    }),
  });
}

/**
 * Adopts an already-authoritative settlement population change into M8 scale authority. This is
 * the only bridge for anonymous population; it never creates society people or relationship data.
 */
export function reconcileWorldPopulationAuthority(state: WorldState): WorldState {
  return synchronizeSettlementPopulation(
    Object.freeze({
      ...state,
      populationScale: reconcileSettlementPopulationAuthority(state),
    }),
  );
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
  const initialEvents: readonly SocietyWorldEvent[] = Object.freeze([
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
  const m8 = initializeM8WorldAuthority({
    seed: normalizedSeed,
    config,
    tick: 0,
    civilization: foundedCivilization,
    civilizations,
  });

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
    space: createInitialSpace(normalizedSeed, 0),
    ...m8,
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
  const activeSettlements = state.civilizations.settlements.filter(
    (settlement) => settlement.status === 'active',
  );
  const activeRoutes = state.civilizations.routes.filter((route) => route.status === 'active');
  const primarySettlementId = state.civilizations.settlements[0]?.id ?? 0;
  const secondaryReserves = activeSettlements
    .filter((settlement) => settlement.id !== primarySettlementId)
    .reduce(
      (total, settlement) => ({
        food: total.food + settlement.reserves.food,
        water: total.water + settlement.reserves.water,
        timber: total.timber + settlement.reserves.timber,
        stone: total.stone + settlement.reserves.stone,
      }),
      { food: 0, water: 0, timber: 0, stone: 0 },
    );
  const storedSettlementMetal = activeSettlements.reduce(
    (total, settlement) => total + settlement.reserves.metal,
    0,
  );
  const planetScaleInfrastructure = activeSettlements.length * 3 + activeRoutes.length * 2;
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
      food: state.civilization.stockpile.food + secondaryReserves.food,
      water: state.civilization.stockpile.water + secondaryReserves.water,
      timber: state.civilization.stockpile.timber + secondaryReserves.timber,
      stone: state.civilization.stockpile.stone + secondaryReserves.stone,
      metal: Math.max(
        storedSettlementMetal,
        Math.floor(
          indexes.reduce((total, index) => total + (state.metal[index] ?? 0), 0) /
            Math.max(1, indexes.length),
        ),
      ),
    }),
    operationalStructures:
      state.civilization.structures.filter((structure) => structure.status === 'operational')
        .length + planetScaleInfrastructure,
    damagedStructures: state.civilization.structures.filter(
      (structure) => structure.status === 'damaged',
    ).length,
    tradeVolume:
      society.offers.reduce((total, offer) => total + offer.fulfilledAmount, 0) +
      activeRoutes.reduce((total, route) => total + route.volume, 0),
    institutionCount:
      1 +
      society.groups.length +
      state.civilizations.civilizations.filter((civilization) => civilization.endedTick === null)
        .length,
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
  const label = (value: string): string => value.replaceAll('-', ' ');
  if (event.kind === 'knowledge-discovered')
    return `${label(event.knowledgeId!)} was discovered through contextual experimentation at progress ${event.amount}.`;
  if (event.kind === 'knowledge-recovered')
    return `${label(event.knowledgeId!)} was recovered through renewed practice at progress ${event.amount}.`;
  if (event.kind === 'knowledge-lost')
    return `${label(event.knowledgeId!)} was lost during social or resource collapse from progress ${event.amount}.`;
  if (event.kind.endsWith('-intervened'))
    return `A ${label(event.kind.slice(0, -'-intervened'.length))} intervention of intensity ${event.amount} altered modeled conditions near tile ${event.targetTileIndex!}.`;
  if (event.kind.endsWith('-started')) {
    const crisis = development.activeCrises.find((candidate) => candidate.id === event.crisisId);
    if (crisis === undefined) throw new Error('Started development event lost its crisis source.');
    return `A ${label(crisis.kind)} crisis ${crisis.id} began after ${label(crisis.triggerCondition)} reached ${crisis.triggerValue}, with severity ${crisis.severity}.`;
  }
  if (event.kind.endsWith('-recovered'))
    return `The settlement recovered autonomously from the ${label(event.kind.slice(0, -'-recovered'.length))} crisis after recorded severity ${event.amount}.`;
  throw new Error(`Development event ${event.kind} lacks factual copy.`);
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
): { readonly state: WorldState; readonly events: readonly SocietyWorldEvent[] } {
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
        summary: `${person.name} died during modeled crisis conditions in household ${person.householdId}.`,
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
  const changedWalkabilityTiles: number[] = [];
  for (let index = 0; index < state.hazard.length; index += 1) {
    if (isWalkableTile(state, index) !== isWalkableTile(next, index)) {
      changedWalkabilityTiles.push(index);
    }
  }
  if (changedWalkabilityTiles.length > 0) {
    const changed = new Set(changedWalkabilityTiles);
    const agentsWithValidRoutes = Object.freeze(
      next.civilization.agents.map((agent) =>
        agent.route.slice(agent.routeCursor + 1).some((tile) => changed.has(tile))
          ? Object.freeze({ ...agent, route: Object.freeze([]), routeCursor: 0 })
          : agent,
      ),
    );
    next = Object.freeze({
      ...next,
      pathCache: invalidatePathCache(
        next.pathCache,
        next.pathCache.terrainRevision + 1,
        changedWalkabilityTiles,
      ),
      civilization: Object.freeze({
        ...next.civilization,
        agents: agentsWithValidRoutes,
      }),
    });
  }
  const created: SocietyWorldEvent[] = [];
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
    created.push(societyWorldEvent(next.eventLog.at(-1)!));
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
    created.push(societyWorldEvent(next.eventLog.at(-1)!));
  }
  for (const person of crisisPeople.filter((candidate) => killedIds.has(candidate.id))) {
    next = appendWorldEvent(next, 'person-died', tick, {
      summary: `${person.name} died during modeled crisis conditions in household ${person.householdId}.`,
      subjectKind: 'person',
      subjectId: person.id,
      targetKind: 'household',
      targetId: person.householdId,
      tileIndex: agentById.get(person.id)?.tileIndex ?? center,
      amount: 0,
    });
    created.push(societyWorldEvent(next.eventLog.at(-1)!));
  }
  return Object.freeze({ state: next, events: Object.freeze(created) });
}

function settlementTerrain(state: WorldState): SettlementTerrain {
  return Object.freeze({
    width: state.config.width,
    height: state.config.height,
    chunkSize: state.config.chunkSize,
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
  const source = societyWorldEvent(event);
  return Object.freeze({
    id: source.id,
    tick: source.tick,
    kind: source.kind,
    summary: source.summary,
    subject: Object.freeze({ kind: source.subjectKind, id: source.subjectId }),
    target: Object.freeze({ kind: source.targetKind, id: source.targetId }),
    ...(source.childArrivalEligibility === undefined
      ? {}
      : { childArrivalEligibility: source.childArrivalEligibility }),
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
    metal: state.civilizations.settlements[0]?.reserves.metal ?? 0,
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

/** Factual, camera-independent inputs used by annual development and legacy migration. */
export function settlementDevelopmentInputsForWorld(
  state: WorldState,
): readonly SettlementDevelopmentInput[] {
  const primarySettlementId = state.civilizations.settlements[0]?.id ?? 0;
  const knownKnowledgeIds = Object.freeze(
    state.development.knowledge
      .filter((knowledge) => knowledge.status === 'known')
      .map((knowledge) => knowledge.id)
      .sort(),
  );
  const operationalPrimaryStructures = state.civilization.structures.filter(
    (structure) => structure.status === 'operational',
  ).length;
  const activeRoutes = state.civilizations.routes.filter((route) => route.status === 'active');
  const ownedTileCounts = new Map<number, number>();
  for (const ownerId of state.civilizations.tileOwners)
    if (ownerId !== 0) ownedTileCounts.set(ownerId, (ownedTileCounts.get(ownerId) ?? 0) + 1);
  return Object.freeze(
    [...state.civilizations.settlements]
      .sort((left, right) => left.id - right.id)
      .map((settlement) => {
        const routes = activeRoutes.filter(
          (route) =>
            route.firstSettlementId === settlement.id || route.secondSettlementId === settlement.id,
        );
        const routeVolume = routes.reduce((total, route) => total + route.volume, 0);
        const ownedTiles = ownedTileCounts.get(settlement.id) ?? 0;
        const memberSettlementCount =
          state.civilizations.civilizations.find(
            (civilization) => civilization.id === settlement.civilizationId,
          )?.memberSettlementIds.length ?? 0;
        const operationalStructures =
          settlement.id === primarySettlementId ? operationalPrimaryStructures : 0;
        const infrastructure = Math.min(
          100,
          operationalStructures * 12 +
            routes.length * 8 +
            Math.min(20, Math.trunc(routeVolume / 2)) +
            Math.min(10, ownedTiles * 2) +
            Math.min(12, memberSettlementCount * 4),
        );
        return Object.freeze({
          settlementId: settlement.id,
          operationalStructures,
          infrastructure,
          knownKnowledgeIds,
        });
      }),
  );
}

/** Adds current stage facts to a pre-v12 world without inventing transition history. */
export function upgradeSettlementDevelopment(state: WorldState): WorldState {
  const inputs = new Map(
    settlementDevelopmentInputsForWorld(state).map((input) => [input.settlementId, input] as const),
  );
  const next = Object.freeze({
    ...state,
    civilizations: Object.freeze({
      ...state.civilizations,
      settlements: Object.freeze(
        state.civilizations.settlements.map((settlement) => {
          const input = inputs.get(settlement.id);
          if (input === undefined)
            throw new Error('Settlement development migration input missing.');
          return Object.freeze({
            ...settlement,
            developmentStage: deriveSettlementDevelopmentStage(settlement, input),
            developmentStageChangedTick: state.tick,
            developmentStageProvenance: 'v11-migration' as const,
          });
        }),
      ),
    }),
  });
  assertWorldInvariants(next);
  return next;
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
    activeSettlements.map((settlement, index) => {
      const ordinaryGrowth =
        index !== 0 &&
        year % 2 === 0 &&
        settlement.stability >= 40 &&
        settlement.reserves.food >= Math.max(2, Math.ceil(settlement.population / 3) + 1) &&
        settlement.reserves.water >= Math.max(2, Math.ceil(settlement.population / 3) + 1)
          ? 1
          : 0;
      return Object.freeze({
        settlementId: settlement.id,
        production:
          index === 0
            ? Object.freeze({
                food: 0,
                water: 0,
                timber: 0,
                stone: 0,
                metal: Math.trunc((state.metal[settlement.centerTileIndex] ?? 0) / 60),
              })
            : Object.freeze({
                food: Math.max(1, Math.trunc((state.food[settlement.centerTileIndex] ?? 0) / 120)),
                water: Math.max(
                  1,
                  Math.trunc((state.freshWater[settlement.centerTileIndex] ?? 0) / 180),
                ),
                timber: Math.trunc((state.timber[settlement.centerTileIndex] ?? 0) / 120),
                stone: Math.trunc((state.stone[settlement.centerTileIndex] ?? 0) / 260),
                metal: Math.trunc((state.metal[settlement.centerTileIndex] ?? 0) / 60),
              }),
        consumption:
          index === 0
            ? Object.freeze({ food: 0, water: 0, timber: 0, stone: 0, metal: 0 })
            : Object.freeze({
                food: Math.max(1, Math.ceil(settlement.population / 3)) + ordinaryGrowth,
                water: Math.max(1, Math.ceil(settlement.population / 3)) + ordinaryGrowth,
                timber: 0,
                stone: 0,
                metal: 0,
              }),
        populationDelta: ordinaryGrowth,
        stabilityDelta:
          profile === 'volatile' && year >= 30
            ? -3
            : (state.hazard[settlement.centerTileIndex] ?? 0) > 120
              ? -1
              : 1,
      });
    }),
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
  const activeCivilizationIds = new Set(activeCivilizations.map((civilization) => civilization.id));
  const conqueredSettlements = state.civilizations.settlements
    .filter(
      (settlement) =>
        settlement.status === 'conquered' &&
        settlement.endedTick !== null &&
        activeCivilizationIds.has(settlement.civilizationId),
    )
    .sort((left, right) => (left.endedTick ?? 0) - (right.endedTick ?? 0) || left.id - right.id);
  const retainedOccupationId = conqueredSettlements.at(-1)?.id ?? null;
  const recoveredSettlementIds = Object.freeze(
    conqueredSettlements
      .filter(
        (settlement) =>
          settlement.id !== retainedOccupationId &&
          tick - settlement.endedTick! >= state.config.societyYearTicks * 12,
      )
      .slice(0, 1)
      .map((settlement) => settlement.id),
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
  const activeSettlementIds = new Set(activeSettlements.map((settlement) => settlement.id));
  const settlementDevelopmentInputs = Object.freeze(
    settlementDevelopmentInputsForWorld(state).filter((input) =>
      activeSettlementIds.has(input.settlementId),
    ),
  );
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
    recoveredSettlementIds,
    ruinSettlementIds,
    federationCivilizationIds,
    fragmentationCivilizationIds,
    settlementDevelopmentInputs,
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
    case 'settlement-restored':
    case 'settlement-stage-changed':
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
  return Object.freeze({
    ...state.civilizations,
    nextEntityId,
    residencies: Object.freeze(residencies),
    settlements: state.civilizations.settlements,
    operationCount: state.civilizations.operationCount + operations,
  });
}

function applyCivilizationsYear(state: WorldState, tick: number): WorldState {
  const reconciled = reconcileCivilizationResidencies(state);
  let source = Object.freeze({ ...state, civilizations: reconciled });
  source = Object.freeze({ ...source, populationScale: synchronizePopulationScale(source) });
  source = synchronizeSettlementPopulation(source);
  const primarySettlementId = source.civilizations.settlements[0]!.id;
  const synchronizedCivilizations = Object.freeze({
    ...source.civilizations,
    settlements: Object.freeze(
      source.civilizations.settlements.map((settlement) =>
        settlement.id === primarySettlementId
          ? Object.freeze({
              ...settlement,
              stability: source.civilization.society.stability,
              reserves: communityReservesFromFounding(source),
            })
          : settlement,
      ),
    ),
  });
  const result = advanceCivilizations(
    synchronizedCivilizations,
    createCivilizationsContext(
      Object.freeze({ ...source, civilizations: synchronizedCivilizations }),
      tick,
    ),
  );
  const delta = result.foundingReserveDelta;
  const stockpile = Object.freeze({
    food: Math.max(0, source.civilization.stockpile.food + delta.food),
    water: Math.max(0, source.civilization.stockpile.water + delta.water),
    timber: Math.max(0, source.civilization.stockpile.timber + delta.timber),
    stone: Math.max(0, source.civilization.stockpile.stone + delta.stone),
  });
  const primaryReserves = Object.freeze({
    ...stockpile,
    metal: Math.max(
      0,
      (result.state.settlements.find((settlement) => settlement.id === primarySettlementId)
        ?.reserves.metal ?? 0) + delta.metal,
    ),
  });
  let next: WorldState = Object.freeze({
    ...source,
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
    civilization: Object.freeze({ ...source.civilization, stockpile }),
  });
  for (const event of result.events)
    next = appendWorldEvent(next, event.kind, tick, civilizationEventDetails(next, event));
  return next;
}

const SPACE_CONTEXT_RESIDENTS_PER_SETTLEMENT = 16;
const SPACE_RESOURCE_KEYS = Object.freeze([
  'food',
  'water',
  'timber',
  'stone',
  'metal',
] as const satisfies readonly (keyof SpaceResourceStock)[]);

export function createSpaceContext(state: WorldState, tick: number): SpaceContext {
  const knownKnowledge = Object.freeze(
    state.development.knowledge
      .filter((knowledge) => knowledge.status === 'known')
      .map((knowledge) => knowledge.id)
      .sort(),
  );
  const activeRoutes = state.civilizations.routes.filter((route) => route.status === 'active');
  const activeCivilizations = state.civilizations.civilizations
    .filter((civilization) => civilization.endedTick === null)
    .sort((left, right) => left.id - right.id)
    .flatMap((civilization) => {
      const memberIds = new Set(civilization.memberSettlementIds);
      const settlements = state.civilizations.settlements
        .filter((settlement) => settlement.status === 'active' && memberIds.has(settlement.id))
        .sort(
          (left, right) =>
            right.reserves.metal - left.reserves.metal ||
            right.reserves.stone - left.reserves.stone ||
            right.population - left.population ||
            left.id - right.id,
        );
      const launchSettlement = settlements[0];
      if (launchSettlement === undefined) return [];
      const civilizationRoutes = activeRoutes.filter(
        (route) =>
          memberIds.has(route.firstSettlementId) || memberIds.has(route.secondSettlementId),
      );
      const routeVolume = civilizationRoutes.reduce((total, route) => total + route.volume, 0);
      const population = settlements.reduce(
        (total, settlement) => total + settlement.population,
        0,
      );
      const institutionCount =
        1 +
        settlements.length +
        (memberIds.has(state.civilizations.settlements[0]!.id)
          ? state.civilization.society.groups.length
          : 0);
      const infrastructure = Math.min(
        100,
        settlements.length * 10 +
          civilizationRoutes.length * 2 +
          Math.trunc(routeVolume / 3) +
          Math.trunc(population / 2),
      );
      const storedMaterial = settlements.reduce(
        (total, settlement) =>
          total +
          settlement.reserves.timber +
          settlement.reserves.stone +
          settlement.reserves.metal,
        0,
      );
      const hasAdvancedEnergy = knownKnowledge.includes('advanced-energy');
      const hasPlanetaryEngineering = knownKnowledge.includes('planetary-engineering');
      const energyCapacity = hasAdvancedEnergy
        ? Math.min(100, infrastructure + institutionCount * 8)
        : 0;
      const engineeringCapacity = hasPlanetaryEngineering
        ? Math.min(100, infrastructure + settlements.length * 8 + Math.trunc(routeVolume / 2))
        : 0;
      const primaryMember = memberIds.has(state.civilizations.settlements[0]!.id);
      const scarcity = primaryMember
        ? state.civilization.society.scarcity
        : Math.max(
            0,
            100 - Math.min(100, launchSettlement.reserves.food + launchSettlement.reserves.water),
          );
      return [
        Object.freeze({
          id: civilization.id,
          launchSettlementId: launchSettlement.id,
          cultureId: launchSettlement.cultureId,
          institutionCount,
          scarcity,
          stability: Math.trunc(
            settlements.reduce((total, settlement) => total + settlement.stability, 0) /
              settlements.length,
          ),
          infrastructure,
          storedMaterial,
          energyCapacity,
          engineeringCapacity,
          interSettlementExchange: Math.min(100, routeVolume),
          hasAdvancedSettlement: settlements.some(
            (settlement) => settlement.developmentStage === 'advanced-city',
          ),
          surfaceReserves: Object.freeze({ ...launchSettlement.reserves }),
        }),
      ];
    });
  const eligibleUnsalientResidents = Object.freeze(
    activeCivilizations.flatMap((civilization) => {
      const aggregate = state.populationScale.cohorts
        .filter(
          (cohort) =>
            cohort.classification.householdId === 0 &&
            cohort.classification.civilizationId === civilization.id &&
            cohort.classification.settlementId === civilization.launchSettlementId,
        )
        .flatMap((cohort) => cohort.residentIds.slice(0, SPACE_CONTEXT_RESIDENTS_PER_SETTLEMENT));
      return aggregate
        .sort((left, right) => left - right)
        .slice(0, SPACE_CONTEXT_RESIDENTS_PER_SETTLEMENT)
        .map((residentId) =>
          Object.freeze({
            residentId,
            civilizationId: civilization.id,
            settlementId: civilization.launchSettlementId,
          }),
        );
    }),
  );
  const terrestrialDiplomacyPressure = Math.max(
    0,
    Math.min(
      100,
      state.civilizations.diplomacy.reduce(
        (total, relation) =>
          total +
          (relation.status === 'at-war'
            ? 60
            : relation.status === 'rival'
              ? 30
              : relation.status === 'allied'
                ? -15
                : 0),
        state.civilizations.conflicts.filter((conflict) => conflict.status === 'active').length *
          40,
      ),
    ),
  );
  return Object.freeze({
    tick,
    knownKnowledge,
    activeCivilizations: Object.freeze(activeCivilizations),
    surfaceSettlementOwners: Object.freeze(
      state.civilizations.settlements
        .filter((settlement) => settlement.status === 'active')
        .map((settlement) =>
          Object.freeze({
            settlementId: settlement.id,
            civilizationId: settlement.civilizationId,
          }),
        )
        .sort((left, right) => left.settlementId - right.settlementId),
    ),
    eligibleUnsalientResidents,
    recentAlienSignalPressure: Math.min(100, state.development.conditions.accidentPressure),
    terrestrialDiplomacyPressure,
  });
}

function applySpaceResourceDeltas(
  state: WorldState,
  deltas: readonly Readonly<{
    civilizationId: number;
    settlementId: number;
    resources: Readonly<Record<keyof SpaceResourceStock, number>>;
  }>[],
): WorldState {
  let civilization = state.civilization;
  const settlements = [...state.civilizations.settlements];
  const primarySettlementId = settlements[0]!.id;
  for (const delta of deltas) {
    const settlementIndex = settlements.findIndex(
      (settlement) =>
        settlement.id === delta.settlementId && settlement.civilizationId === delta.civilizationId,
    );
    if (settlementIndex < 0) throw new Error('Space resource patch lost its surface owner.');
    const source = settlements[settlementIndex]!;
    const reserves = { ...source.reserves };
    for (const key of SPACE_RESOURCE_KEYS) {
      const amount = delta.resources[key];
      if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(reserves[key] + amount))
        throw new Error('Space resource patch must remain a safe integer.');
      reserves[key] += amount;
      if (reserves[key] < 0) throw new Error('Space resource patch overdrew its surface owner.');
    }
    settlements[settlementIndex] = Object.freeze({
      ...source,
      reserves: Object.freeze(reserves),
    });
    if (source.id === primarySettlementId) {
      civilization = Object.freeze({
        ...civilization,
        stockpile: Object.freeze({
          food: reserves.food,
          water: reserves.water,
          timber: reserves.timber,
          stone: reserves.stone,
        }),
      });
    }
  }
  return Object.freeze({
    ...state,
    civilization,
    civilizations: Object.freeze({
      ...state.civilizations,
      settlements: Object.freeze(settlements),
    }),
  });
}

function applySpaceYear(state: WorldState, tick: number): WorldState {
  const result = advanceSpace(state.space, createSpaceContext(state, tick));
  let next: WorldState = Object.freeze({ ...state, space: result.state });
  next = applySpaceResourceDeltas(next, result.surfaceResourceDeltas);
  if (result.surfacePopulationDeltas.length > 0) {
    const provenanceByResident = new Map<
      number,
      Readonly<{ civilizationId: number; settlementId: number }>
    >();
    for (const cohort of next.populationScale.cohorts)
      for (const residentId of cohort.residentIds)
        provenanceByResident.set(residentId, cohort.classification);
    for (const delta of result.surfacePopulationDeltas) {
      const provenance = provenanceByResident.get(delta.residentId);
      if (
        provenance?.civilizationId !== delta.civilizationId ||
        provenance.settlementId !== delta.settlementId ||
        delta.delta !== -1
      )
        throw new Error('Space population patch lost its exact terrestrial provenance.');
    }
    const departureIds = result.surfacePopulationDeltas
      .map((delta) => delta.residentId)
      .sort((left, right) => left - right);
    const departuresBySettlement = new Map<number, number>();
    for (const delta of result.surfacePopulationDeltas)
      departuresBySettlement.set(
        delta.settlementId,
        (departuresBySettlement.get(delta.settlementId) ?? 0) + 1,
      );
    next = Object.freeze({
      ...next,
      populationScale: removeAnonymousResidents(next.populationScale, departureIds),
      civilizations: Object.freeze({
        ...next.civilizations,
        settlements: Object.freeze(
          next.civilizations.settlements.map((settlement) => {
            const departures = departuresBySettlement.get(settlement.id) ?? 0;
            if (departures > settlement.population)
              throw new Error('Space population patch overdrew its terrestrial settlement.');
            return departures === 0
              ? settlement
              : Object.freeze({ ...settlement, population: settlement.population - departures });
          }),
        ),
      }),
    });
  }
  for (const event of result.events) {
    next = appendWorldEvent(next, event.kind, tick, {
      summary: event.summary,
      subjectKind: event.subjectKind,
      subjectId: event.subjectId,
      targetKind: event.targetKind,
      targetId: event.targetId,
      tileIndex: -1,
      amount: event.amount,
    });
  }
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
    const populationScale = advancePopulationScale(
      next.populationScale,
      pulseTick - next.populationScale.tick,
    );
    const terrain = settlementTerrain(next);
    const pulse = advanceCivilizationWithPathCache(
      next.civilization,
      terrain,
      pulseTick,
      next.pathCache,
    );
    next = Object.freeze({
      ...next,
      tick: pulseTick,
      civilization: pulse.civilization,
      populationScale,
      pathCache: pulse.pathCache,
    });
    const createdEvents: SocietyWorldEvent[] = [];
    for (const draft of pulse.events) {
      next = appendWorldEvent(next, draft.kind, pulseTick, draft);
      createdEvents.push(societyWorldEvent(next.eventLog.at(-1)!));
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
    next = Object.freeze({
      ...next,
      civilizations: reconcileCivilizationResidencies(next),
    });
    next = Object.freeze({ ...next, populationScale: synchronizePopulationScale(next) });
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
    if (pulseTick % next.config.societyYearTicks === 0 && next.space.tick < pulseTick)
      next = applySpaceYear(next, pulseTick);
    next = Object.freeze({
      ...next,
      civilizations: reconcileCivilizationResidencies(next),
    });
    next = Object.freeze({
      ...next,
      populationScale: reconcilePopulationLod(
        reconcileSettlementPopulationAuthority({
          ...next,
          populationScale: synchronizePopulationScale(next),
        }),
        Math.trunc(pulseTick / SETTLEMENT_ACTION_PULSE_TICKS),
      ),
    });
    next = synchronizeSettlementPopulation(next);
    pulseTick += SETTLEMENT_ACTION_PULSE_TICKS;
  }
  if (next.tick === endingTick) {
    assertWorldInvariants(next);
    return next;
  }
  const populationScale = advancePopulationScale(
    next.populationScale,
    endingTick - next.populationScale.tick,
  );
  const completed = synchronizeSettlementPopulation(
    Object.freeze({
      ...next,
      tick: endingTick,
      populationScale,
      pathCache: Object.freeze({ ...next.pathCache, logicalTick: endingTick }),
    }),
  );
  assertWorldInvariants(completed);
  return completed;
}

/** Appends one factual event with the next stable id to an immutable world snapshot. */
export function appendWorldEvent(
  state: WorldState,
  kind: PlayerVisibleEventKind,
  eventTick: number,
  details: WorldEventDetails,
): WorldState {
  if (!isPlayerVisibleEventKind(kind)) {
    throw new RangeError('World event kind must be part of the player-visible factual catalogue.');
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
  const summary = details.summary;
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
  assertFactualEventSummary(summary);
  assertSummaryNamesReference(state, subjectKind, subjectId, summary, 'subject');
  assertSummaryNamesReference(state, targetKind, targetId, summary, 'target');
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
    summary: `A recorded supply shortage of severity ${severity} depleted stores overseen by council ${society.institution.id}.`,
    subjectKind: 'world',
    subjectId: 0,
    targetKind: 'institution',
    targetId: society.institution.id,
    tileIndex: state.civilization.centerTileIndex,
    amount: severity,
  });
  if (enteredCollapse) {
    recorded = appendWorldEvent(recorded, 'settlement-collapsed', state.tick, {
      summary: `Council ${society.institution.id} recorded the settlement's collapse under the supply shortage.`,
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
  assertSpaceInvariants(state.space);
  assertPopulationScaleInvariants(state.populationScale);
  assertPathCacheInvariants(state.pathCache);
  if (state.populationScale.tick !== state.tick)
    throw new Error(
      'World invariant violation: population scale must be synchronized to world time.',
    );
  if (state.pathCache.logicalTick !== state.tick)
    throw new Error('World invariant violation: path cache must be synchronized to world time.');
  if (state.development.tick > state.tick)
    throw new Error('World invariant violation: development cannot be ahead of world time.');
  if (state.civilizations.tick > state.tick)
    throw new Error('World invariant violation: civilizations cannot be ahead of world time.');
  if (state.space.tick > state.tick)
    throw new Error('World invariant violation: space cannot be ahead of world time.');
  const agentIds = new Set(state.civilization.agents.map((agent) => agent.id));
  const detailedById = new Map(
    state.populationScale.detailedResidents.map((resident) => [resident.id, resident]),
  );
  for (const person of state.civilization.society.people) {
    if (!person.alive) continue;
    const resident = detailedById.get(person.id);
    if (resident === undefined || resident.importance <= 0)
      throw new Error('Alive named people must remain protected detailed scale residents.');
  }
  const namedPersonIds = new Set(state.civilization.society.people.map((person) => person.id));
  const scaleSettlements = new Map(
    state.civilizations.settlements.map((settlement) => [settlement.id, settlement] as const),
  );
  for (const resident of state.populationScale.detailedResidents) {
    if (namedPersonIds.has(resident.id)) continue;
    const settlement = scaleSettlements.get(resident.settlementId);
    if (
      resident.householdId !== 0 ||
      resident.id < FIRST_ORDINARY_RESIDENT_ID ||
      resident.importance !== 0 ||
      resident.relationshipIds.length > 0 ||
      resident.familyIds.length > 0 ||
      resident.eventIds.length > 0 ||
      settlement === undefined ||
      settlement.status === 'abandoned' ||
      resident.civilizationId !== settlement.civilizationId ||
      resident.cultureId !== settlement.cultureId ||
      resident.tileIndex !== settlement.centerTileIndex
    ) {
      throw new Error(
        'Anonymous detailed residents must retain exact active-settlement unsalient provenance.',
      );
    }
  }
  for (const cohort of state.populationScale.cohorts) {
    const settlement = scaleSettlements.get(cohort.classification.settlementId);
    if (
      cohort.classification.householdId !== 0 ||
      cohort.householdCount !== 0 ||
      settlement === undefined ||
      settlement.status === 'abandoned' ||
      cohort.classification.civilizationId !== settlement.civilizationId ||
      cohort.classification.cultureId !== settlement.cultureId ||
      cohort.classification.tileIndex !== settlement.centerTileIndex ||
      cohort.residentIds.some(
        (residentId) => residentId < FIRST_ORDINARY_RESIDENT_ID || namedPersonIds.has(residentId),
      )
    ) {
      throw new Error('World aggregate cohorts must retain exact active-settlement provenance.');
    }
  }
  const scalePopulationBySettlement = new Map<number, number>();
  for (const resident of state.populationScale.detailedResidents)
    scalePopulationBySettlement.set(
      resident.settlementId,
      (scalePopulationBySettlement.get(resident.settlementId) ?? 0) + 1,
    );
  for (const cohort of state.populationScale.cohorts)
    scalePopulationBySettlement.set(
      cohort.classification.settlementId,
      (scalePopulationBySettlement.get(cohort.classification.settlementId) ?? 0) +
        cohort.residentIds.length,
    );
  for (const settlement of state.civilizations.settlements)
    if (settlement.population !== (scalePopulationBySettlement.get(settlement.id) ?? 0))
      throw new Error('Settlement population must conserve scale residents.');
  const terrestrialResidentIds = new Set<number>([
    ...state.populationScale.detailedResidents.map((resident) => resident.id),
    ...state.populationScale.cohorts.flatMap((cohort) => cohort.residentIds),
  ]);
  const offworldResidentIds = [
    ...state.space.missions
      .filter((mission) => mission.status === 'active')
      .flatMap((mission) => mission.passengerIds),
    ...state.space.colonies.flatMap((colony) => colony.residentIds),
  ];
  if (offworldResidentIds.some((residentId) => terrestrialResidentIds.has(residentId))) {
    throw new Error('A resident cannot exist in both terrestrial and space authority.');
  }
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
  for (const program of state.space.programs)
    if (
      !civilizationIds.has(program.civilizationId) ||
      !settlementIds.has(program.settlementId) ||
      !cultureIds.has(program.cultureId)
    )
      throw new Error('Space program lost its terrestrial provenance.');
  for (const spacecraft of state.space.spacecraft)
    if (
      !civilizationIds.has(spacecraft.civilizationId) ||
      !settlementIds.has(spacecraft.settlementId)
    )
      throw new Error('Spacecraft lost its terrestrial provenance.');
  for (const mission of state.space.missions)
    if (
      !civilizationIds.has(mission.civilizationId) ||
      !settlementIds.has(mission.settlementId) ||
      !cultureIds.has(mission.cultureId)
    )
      throw new Error('Space mission lost its terrestrial provenance.');
  for (const colony of state.space.colonies)
    if (
      !civilizationIds.has(colony.civilizationId) ||
      !settlementIds.has(colony.settlementId) ||
      !cultureIds.has(colony.cultureId)
    )
      throw new Error('Space colony lost its terrestrial provenance.');
  for (const transfer of state.space.cargoTransfers)
    for (const endpoint of [transfer.origin, transfer.destination])
      if (
        endpoint.kind === 'settlement' &&
        (!civilizationIds.has(endpoint.civilizationId) || !settlementIds.has(endpoint.settlementId))
      )
        throw new Error('Space cargo endpoint lost its terrestrial provenance.');
  for (const relation of state.space.relations)
    if (!civilizationIds.has(relation.civilizationId))
      throw new Error('Space relation references an unknown terrestrial civilization.');
  const referenceExists = (kind: WorldEntityKind, id: number): boolean => {
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
      case 'celestial-body':
        return state.space.bodies.some((body) => body.id === id);
      case 'space-program':
        return state.space.programs.some((program) => program.id === id);
      case 'spacecraft':
        return state.space.spacecraft.some((spacecraft) => spacecraft.id === id);
      case 'space-colony':
        return state.space.colonies.some((colony) => colony.id === id);
      case 'alien-civilization':
        return state.space.aliens.some((alien) => alien.id === id);
    }
  };
  const eventsById = new Map<number, WorldEvent>();
  const settlementDevelopmentEvents = new Set<string>();
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
    if (
      event.kind === 'settlement-stage-changed' &&
      event.subjectKind === 'settlement' &&
      event.targetKind === 'civilization'
    )
      settlementDevelopmentEvents.add(`${event.subjectId}:${event.tick}:${event.amount}`);
    previousEventId = event.id;
  }
  const settlementDevelopmentRanks = new Map([
    ['founding', 0],
    ['village', 1],
    ['town', 2],
    ['city', 3],
    ['advanced-city', 4],
  ] as const);
  for (const settlement of state.civilizations.settlements) {
    if (settlement.developmentStageChangedTick > state.tick)
      throw new Error('Settlement development cannot be ahead of world time.');
    if (
      settlement.developmentStageProvenance === 'observed' &&
      !settlementDevelopmentEvents.has(
        `${settlement.id}:${settlement.developmentStageChangedTick}:${settlementDevelopmentRanks.get(
          settlement.developmentStage,
        )}`,
      )
    )
      throw new Error('Observed settlement development must retain its factual source event.');
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
    populationScale: populationScaleDto(state.populationScale),
    pathCache: toCanonicalPathCacheDto(state.pathCache),
    seed: [...state.seed],
    space: spaceDto(state.space),
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
