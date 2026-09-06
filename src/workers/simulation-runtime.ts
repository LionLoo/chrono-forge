import {
  AGENT_ACTION_CODES,
  MAX_ADVANCE_TICKS_PER_REQUEST,
  STRUCTURE_KIND_CODES,
  STRUCTURE_STATE_CODES,
  WORKER_PROTOCOL_VERSION,
  projectionTransferables,
  validateUiToWorkerMessage,
  type AdvanceTicksRequest,
  type CivilizationsProjection,
  type DevelopmentProjection,
  type InitializeRequest,
  type LoadRequest,
  type PerformOfflineCatchUpRequest,
  type RequestRelationshipEventPageRequest,
  type RequestRelationshipPageRequest,
  type RequestSaveRequest,
  type RequestTimelinePageRequest,
  type RunMode,
  type SettlementSummary,
  type SocietyProjection,
  type SocietyRelationshipProjection,
  type WorkerEvent,
  type WorkerFaultCode,
  type WorkerToUiMessage,
  type WorldFrameProjection,
} from '../protocol';
import {
  createWorldFrameDelta,
  estimateFrameDeltaPayloadBytes,
  frameDeltaTransferables,
} from '../protocol/frame-delta';
import {
  MAX_ACTIVE_CIVILIZATIONS,
  MAX_ACTIVE_CONFLICTS,
  MAX_ACTIVE_ROUTES,
  MAX_ACTIVE_SETTLEMENTS,
  MAX_DIPLOMACY_PAIRS,
  MAX_HISTORICAL_COMMUNITIES,
  MAX_PROJECTED_RESIDENCIES,
  MAX_ROUTE_CONFLICT_SUMMARIES,
  MAX_RUINS,
  MAX_TERRITORY_HISTORY_PER_SETTLEMENT,
} from '../simulation/civilizations';
import { deserializeWorldSnapshot, serializeWorldSnapshot } from '../simulation/persistence';
import {
  RELATIONSHIP_PAGE_SIZE,
  relationshipEventMatchesFamilyBond,
  relationshipEventMatchesSocialEdge,
} from '../simulation/relationships';
import type {
  ActiveRelationship,
  ArchivedRelationshipSummary,
  FamilyBond,
  RelationshipDirectionalState,
  SharedRelationshipEvent,
} from '../simulation/relationships';
import {
  applyWorldIntervention,
  appendWorldEvent,
  createInitialWorld,
  hashWorldState,
  stepWorld,
  type WorldState,
} from '../simulation/world';
import type {
  AgentAction,
  CivilizationState,
  SettlementStructure,
  StructureKind,
  StructureStatus,
} from '../simulation/settlement';

export const OFFLINE_CATCH_UP_POLICY_VERSION = 1;
export const MAX_OFFLINE_CATCH_UP_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;
export const MAX_OFFLINE_CATCH_UP_TICKS = 1_000_000;
export const MAX_RECENT_WORKER_EVENTS = 256;

export type RuntimePost = (message: WorkerToUiMessage, transfer: readonly ArrayBuffer[]) => void;

export interface SimulationRuntime {
  readonly handleMessage: (message: unknown) => void;
}

function projectDevelopment(state: WorldState): DevelopmentProjection {
  return Object.freeze({
    researchFocusId: state.development.researchFocusId,
    knowledge: Object.freeze(
      state.development.knowledge.map((record) =>
        Object.freeze({ id: record.id, status: record.status, progress: record.progress }),
      ),
    ),
    conditions: Object.freeze({ ...state.development.conditions }),
    activeCrises: Object.freeze(
      state.development.activeCrises.map((crisis) =>
        Object.freeze({
          id: crisis.id,
          kind: crisis.kind,
          severity: crisis.severity,
          startedTick: crisis.startedTick,
          triggerCondition: crisis.triggerCondition,
          triggerValue: crisis.triggerValue,
        }),
      ),
    ),
    recoveredCrisisCount: state.development.crisisHistory.length,
    operationCount: state.development.operationCount,
  });
}

function stableIdSorted<T extends { readonly id: number }>(records: readonly T[]): readonly T[] {
  return [...records].sort((left, right) => left.id - right.id);
}

function assertProjectionCount(count: number, maximum: number, category: string): void {
  if (count > maximum) throw new Error(`Civilizations projection ${category} exceeds its bound.`);
}

/** Copies the bounded M6 authority into a stable-ID-sorted read model. */
function projectCivilizations(state: WorldState): CivilizationsProjection {
  const source = state.civilizations;
  const historicalCommunities =
    source.settlements.filter((settlement) => settlement.status !== 'active').length +
    source.civilizations.filter((civilization) => civilization.endedTick !== null).length;
  const routeConflictSummaries =
    source.routes.filter((route) => route.status === 'ended').length +
    source.conflicts.filter((conflict) => conflict.status === 'resolved').length;
  assertProjectionCount(
    source.settlements.filter((settlement) => settlement.status === 'active').length,
    MAX_ACTIVE_SETTLEMENTS,
    'active settlements',
  );
  assertProjectionCount(
    source.civilizations.filter((civilization) => civilization.endedTick === null).length,
    MAX_ACTIVE_CIVILIZATIONS,
    'active civilizations',
  );
  assertProjectionCount(
    historicalCommunities,
    MAX_HISTORICAL_COMMUNITIES,
    'historical communities',
  );
  assertProjectionCount(source.diplomacy.length, MAX_DIPLOMACY_PAIRS, 'diplomacy');
  assertProjectionCount(
    source.routes.filter((route) => route.status !== 'ended').length,
    MAX_ACTIVE_ROUTES,
    'active routes',
  );
  assertProjectionCount(
    routeConflictSummaries,
    MAX_ROUTE_CONFLICT_SUMMARIES,
    'route/conflict summaries',
  );
  assertProjectionCount(
    source.conflicts.filter((conflict) => conflict.status === 'active').length,
    MAX_ACTIVE_CONFLICTS,
    'active conflicts',
  );
  assertProjectionCount(source.ruins.length, MAX_RUINS, 'ruins');
  if (source.tileOwners.length !== state.config.width * state.config.height)
    throw new Error('Civilizations tile ownership does not match the world dimensions.');

  const settlements = stableIdSorted(source.settlements).map((settlement) => {
    assertProjectionCount(
      settlement.territoryHistory.length,
      MAX_TERRITORY_HISTORY_PER_SETTLEMENT,
      'settlement territory history',
    );
    return Object.freeze({
      id: settlement.id,
      civilizationId: settlement.civilizationId,
      name: settlement.name,
      cultureId: settlement.cultureId,
      centerTileIndex: settlement.centerTileIndex,
      status: settlement.status,
      population: settlement.population,
      stability: settlement.stability,
      reserves: Object.freeze({ ...settlement.reserves }),
      territoryHistory: Object.freeze(
        stableIdSorted(settlement.territoryHistory).map((history) => Object.freeze({ ...history })),
      ),
      territoryHistorySummaryCount: settlement.territoryHistorySummaryCount,
      foundedTick: settlement.foundedTick,
      endedTick: settlement.endedTick,
      provenance: settlement.provenance,
    });
  });
  const civilizations = stableIdSorted(source.civilizations).map((civilization) =>
    Object.freeze({
      id: civilization.id,
      name: civilization.name,
      cultureId: civilization.cultureId,
      status: civilization.status,
      foundingSettlementId: civilization.foundingSettlementId,
      memberSettlementIds: Object.freeze([...civilization.memberSettlementIds]),
      foundedTick: civilization.foundedTick,
      endedTick: civilization.endedTick,
      provenance: civilization.provenance,
    }),
  );
  const activeResidencies = stableIdSorted(
    source.residencies.filter((residency) => residency.endedTick === null),
  );
  const residencies = activeResidencies
    .slice(0, MAX_PROJECTED_RESIDENCIES)
    .map((residency) => Object.freeze({ ...residency }));
  const diplomacy = stableIdSorted(source.diplomacy).map((relation) =>
    Object.freeze({ ...relation }),
  );
  const routes = stableIdSorted(source.routes).map((route) => Object.freeze({ ...route }));
  const conflicts = stableIdSorted(source.conflicts).map((conflict) =>
    Object.freeze({ ...conflict }),
  );
  const ruins = stableIdSorted(source.ruins).map((ruin) => Object.freeze({ ...ruin }));
  const tileOwners = new Uint32Array(source.tileOwners.length);
  for (let index = 0; index < source.tileOwners.length; index += 1) {
    tileOwners[index] = toUint32(source.tileOwners[index]!, 'Tile owner');
  }

  return Object.freeze({
    operationCount: source.operationCount,
    settlements: Object.freeze(settlements),
    civilizations: Object.freeze(civilizations),
    residencies: Object.freeze(residencies),
    activeResidencyCount: activeResidencies.length,
    historicalResidencyCount: source.residencies.length - activeResidencies.length,
    diplomacy: Object.freeze(diplomacy),
    routes: Object.freeze(routes),
    conflicts: Object.freeze(conflicts),
    ruins: Object.freeze(ruins),
    tileOwners,
  });
}

function assertValidTicks(ticks: number): void {
  if (!Number.isSafeInteger(ticks) || ticks < 0 || ticks > MAX_ADVANCE_TICKS_PER_REQUEST) {
    throw new RangeError(
      `Advance ticks must be an integer from 0 through ${MAX_ADVANCE_TICKS_PER_REQUEST}.`,
    );
  }
}

function toByte(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 255) {
    throw new RangeError('Projection byte values must be integers in the range 0 through 255.');
  }
  return value;
}

function toResource(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('Projection resource values must be non-negative safe integers.');
  }
  return value;
}

function toUint32(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`${label} must be a uint32 integer.`);
  }
  return value;
}

function toSettlementUnit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000) {
    throw new RangeError(`${label} must be an integer from 0 through 1000.`);
  }
  return value;
}

function agentActionCode(action: AgentAction): number {
  switch (action) {
    case 'idle':
      return AGENT_ACTION_CODES.idle;
    case 'forage':
      return AGENT_ACTION_CODES.forage;
    case 'collect-water':
      return AGENT_ACTION_CODES.collectWater;
    case 'gather-timber':
      return AGENT_ACTION_CODES.gatherTimber;
    case 'gather-stone':
      return AGENT_ACTION_CODES.gatherStone;
    case 'transport':
      return AGENT_ACTION_CODES.transport;
    case 'construct':
      return AGENT_ACTION_CODES.construct;
    case 'repair':
      return AGENT_ACTION_CODES.repair;
    case 'rest':
      return AGENT_ACTION_CODES.rest;
  }
  throw new Error('Unknown agent action.');
}

function structureKindCode(kind: StructureKind): number {
  switch (kind) {
    case 'shelter':
      return STRUCTURE_KIND_CODES.shelter;
    case 'storehouse':
      return STRUCTURE_KIND_CODES.storehouse;
  }
  throw new Error('Unknown structure kind.');
}

function structureStateCode(status: StructureStatus): number {
  switch (status) {
    case 'planned':
      return STRUCTURE_STATE_CODES.planned;
    case 'building':
      return STRUCTURE_STATE_CODES.building;
    case 'operational':
      return STRUCTURE_STATE_CODES.operational;
    case 'damaged':
      return STRUCTURE_STATE_CODES.damaged;
    case 'abandoned':
      return STRUCTURE_STATE_CODES.abandoned;
    case 'demolished':
      return STRUCTURE_STATE_CODES.demolished;
  }
  throw new Error('Unknown structure status.');
}

function sortedVisibleStructures(civilization: CivilizationState): readonly SettlementStructure[] {
  return civilization.structures
    .filter((structure) => structure.status !== 'demolished')
    .slice()
    .sort((left, right) => left.id - right.id);
}

function projectSettlementSummary(
  civilization: CivilizationState,
  structures: readonly SettlementStructure[],
): SettlementSummary {
  const stockpile = civilization.stockpile;
  const operationalStructures = structures.filter(
    (structure) => structure.status === 'operational',
  );
  return Object.freeze({
    population: civilization.agents.filter((agent) => agent.alive).length,
    food: toResource(stockpile.food),
    water: toResource(stockpile.water),
    timber: toResource(stockpile.timber),
    stone: toResource(stockpile.stone),
    operationalStructures: operationalStructures.length,
    shelterCapacity: operationalStructures
      .filter((structure) => structure.kind === 'shelter')
      .reduce((total, structure) => total + toResource(structure.capacity), 0),
    activeConstruction: structures.filter(
      (structure) => structure.status === 'planned' || structure.status === 'building',
    ).length,
  });
}

export const TIMELINE_PAGE_SIZE = 8;

function projectTimelinePage(
  state: WorldState,
  requestedOffset: number,
): {
  readonly offset: number;
  readonly total: number;
  readonly timeline: readonly SocietyProjection['timeline'][number][];
} {
  const total = state.eventLog.length;
  const lastOffset = Math.max(
    0,
    Math.floor(Math.max(0, total - 1) / TIMELINE_PAGE_SIZE) * TIMELINE_PAGE_SIZE,
  );
  const offset = Math.min(requestedOffset, lastOffset);
  return Object.freeze({
    offset,
    total,
    timeline: Object.freeze(
      state.eventLog
        .slice(offset, offset + TIMELINE_PAGE_SIZE)
        .map((event) => Object.freeze({ id: event.id, tick: event.tick, summary: event.summary })),
    ),
  });
}

function projectRelationshipDirection(
  direction: RelationshipDirectionalState,
): SocietyRelationshipProjection['firstToSecond'] {
  return Object.freeze({
    affinity: direction.affinity,
    trust: direction.trust,
    closeness: direction.closeness,
    commitment: direction.commitment,
    grievance: direction.grievance,
  });
}

function projectRelationshipEvents(
  references: readonly SharedRelationshipEvent[],
  eventsById: ReadonlyMap<number, WorldState['eventLog'][number]>,
  belongsToRelationship: (source: WorldState['eventLog'][number]) => boolean,
  offset = 0,
): readonly SocietyRelationshipProjection['sharedEvents'][number][] {
  return Object.freeze(
    references.slice(offset, offset + RELATIONSHIP_PAGE_SIZE).map((reference) => {
      const source = eventsById.get(reference.eventId);
      if (source?.tick !== reference.tick || !belongsToRelationship(source))
        throw new Error('Projected relationship source event is missing or inconsistent.');
      return Object.freeze({
        eventId: source.id,
        tick: source.tick,
        summary: source.summary,
        importance: reference.importance,
      });
    }),
  );
}

function projectSocialRelationship(
  edge: ActiveRelationship | ArchivedRelationshipSummary,
  status: 'active' | 'archived',
  eventsById: ReadonlyMap<number, WorldState['eventLog'][number]>,
): SocietyRelationshipProjection {
  return Object.freeze({
    id: `social:${edge.id}`,
    category: 'social',
    status,
    kind: edge.kind,
    firstPersonId: edge.firstPersonId,
    secondPersonId: edge.secondPersonId,
    firstRole: edge.firstRole,
    secondRole: edge.secondRole,
    trend: edge.trend,
    formedTick: edge.formedTick,
    changedTick: edge.changedTick,
    endedTick: status === 'archived' ? (edge as ArchivedRelationshipSummary).endedTick : null,
    firstToSecond: projectRelationshipDirection(edge.firstToSecond),
    secondToFirst: projectRelationshipDirection(edge.secondToFirst),
    sharedEventTotal: edge.sharedEvents.length,
    sharedEvents: projectRelationshipEvents(edge.sharedEvents, eventsById, (source) =>
      relationshipEventMatchesSocialEdge(edge, source),
    ),
  });
}

function projectFamilyRelationship(
  bond: FamilyBond,
  eventsById: ReadonlyMap<number, WorldState['eventLog'][number]>,
): SocietyRelationshipProjection {
  return Object.freeze({
    id: `family:${bond.kind}:${bond.parentId}:${bond.childId}`,
    category: 'family',
    status: 'family',
    kind: bond.kind,
    firstPersonId: bond.parentId,
    secondPersonId: bond.childId,
    firstRole: bond.kind === 'parent' ? 'parent' : 'guardian',
    secondRole: 'child',
    trend: bond.trend,
    formedTick: bond.formedTick,
    changedTick: bond.changedTick,
    endedTick: null,
    firstToSecond: projectRelationshipDirection(bond.parentToChild),
    secondToFirst: projectRelationshipDirection(bond.childToParent),
    sharedEventTotal: bond.sharedEvents.length,
    sharedEvents: projectRelationshipEvents(bond.sharedEvents, eventsById, (source) =>
      relationshipEventMatchesFamilyBond(bond, source),
    ),
  });
}

function relationshipSalience(relationship: SocietyRelationshipProjection): number {
  return Math.max(
    relationship.firstToSecond.closeness,
    relationship.firstToSecond.commitment,
    relationship.firstToSecond.grievance,
    relationship.secondToFirst.closeness,
    relationship.secondToFirst.commitment,
    relationship.secondToFirst.grievance,
  );
}

function compareProjectedRelationship(
  left: SocietyRelationshipProjection,
  right: SocietyRelationshipProjection,
): number {
  const family = left.category === right.category ? 0 : left.category === 'family' ? -1 : 1;
  const salience = relationshipSalience(right) - relationshipSalience(left);
  const category = left.category < right.category ? -1 : left.category > right.category ? 1 : 0;
  return (
    family ||
    salience ||
    category ||
    Math.min(left.firstPersonId, left.secondPersonId) -
      Math.min(right.firstPersonId, right.secondPersonId) ||
    Math.max(left.firstPersonId, left.secondPersonId) -
      Math.max(right.firstPersonId, right.secondPersonId) ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  );
}

function projectedRelationshipsForPerson(
  state: WorldState,
  personId: number,
): readonly SocietyRelationshipProjection[] {
  const society = state.civilization.society;
  if (!society.people.some((person) => person.id === personId))
    throw new RangeError(`Person ${personId} is not available for inspection.`);
  const eventsById = new Map(state.eventLog.map((event) => [event.id, event]));
  return Object.freeze(
    [
      ...society.interpersonal.active
        .filter((edge) => edge.firstPersonId === personId || edge.secondPersonId === personId)
        .map((edge) => projectSocialRelationship(edge, 'active', eventsById)),
      ...society.interpersonal.archived
        .filter((edge) => edge.firstPersonId === personId || edge.secondPersonId === personId)
        .map((edge) => projectSocialRelationship(edge, 'archived', eventsById)),
      ...society.interpersonal.familyBonds
        .filter((bond) => bond.parentId === personId || bond.childId === personId)
        .map((bond) => projectFamilyRelationship(bond, eventsById)),
    ].sort(compareProjectedRelationship),
  );
}

export function projectRelationshipPage(
  state: WorldState,
  personId: number,
  requestedOffset: number,
): {
  readonly personId: number;
  readonly offset: number;
  readonly total: number;
  readonly relationships: readonly SocietyRelationshipProjection[];
} {
  const relationships = projectedRelationshipsForPerson(state, personId);
  const total = relationships.length;
  const lastOffset = Math.max(
    0,
    Math.floor(Math.max(0, total - 1) / RELATIONSHIP_PAGE_SIZE) * RELATIONSHIP_PAGE_SIZE,
  );
  const offset = Math.min(requestedOffset, lastOffset);
  return Object.freeze({
    personId,
    offset,
    total,
    relationships: Object.freeze(relationships.slice(offset, offset + RELATIONSHIP_PAGE_SIZE)),
  });
}

export function projectRelationshipEventPage(
  state: WorldState,
  personId: number,
  relationshipId: string,
  requestedOffset: number,
): {
  readonly personId: number;
  readonly relationshipId: string;
  readonly offset: number;
  readonly total: number;
  readonly events: SocietyRelationshipProjection['sharedEvents'];
} {
  const society = state.civilization.society;
  if (!society.people.some((person) => person.id === personId))
    throw new RangeError(`Person ${personId} is not available for relationship history.`);
  const eventsById = new Map(state.eventLog.map((event) => [event.id, event]));
  let references: readonly SharedRelationshipEvent[];
  let belongsToRelationship: (source: WorldState['eventLog'][number]) => boolean;
  if (relationshipId.startsWith('social:')) {
    const relationshipNumber = Number(relationshipId.slice('social:'.length));
    const edge = [...society.interpersonal.active, ...society.interpersonal.archived].find(
      (candidate) =>
        candidate.id === relationshipNumber &&
        (candidate.firstPersonId === personId || candidate.secondPersonId === personId),
    );
    if (edge === undefined)
      throw new RangeError(`Relationship ${relationshipId} is not available for this person.`);
    references = edge.sharedEvents;
    belongsToRelationship = (source) => relationshipEventMatchesSocialEdge(edge, source);
  } else {
    const bond = society.interpersonal.familyBonds.find(
      (candidate) =>
        `family:${candidate.kind}:${candidate.parentId}:${candidate.childId}` === relationshipId &&
        (candidate.parentId === personId || candidate.childId === personId),
    );
    if (bond === undefined)
      throw new RangeError(`Relationship ${relationshipId} is not available for this person.`);
    references = bond.sharedEvents;
    belongsToRelationship = (source) => relationshipEventMatchesFamilyBond(bond, source);
  }
  const total = references.length;
  const lastOffset = Math.max(
    0,
    Math.floor(Math.max(0, total - 1) / RELATIONSHIP_PAGE_SIZE) * RELATIONSHIP_PAGE_SIZE,
  );
  const offset = Math.min(requestedOffset, lastOffset);
  return Object.freeze({
    personId,
    relationshipId,
    offset,
    total,
    events: projectRelationshipEvents(references, eventsById, belongsToRelationship, offset),
  });
}

interface FamilyProjectionIndex {
  readonly childIdsByParent: ReadonlyMap<number, readonly number[]>;
  readonly guardianIdsByChild: ReadonlyMap<number, readonly number[]>;
  readonly parentIdsByChild: ReadonlyMap<number, readonly number[]>;
}

function familyProjectionIndex(bonds: readonly FamilyBond[]): FamilyProjectionIndex {
  const childIdsByParent = new Map<number, number[]>();
  const guardianIdsByChild = new Map<number, number[]>();
  const parentIdsByChild = new Map<number, number[]>();
  const add = (index: Map<number, number[]>, key: number, value: number) => {
    const values = index.get(key);
    if (values === undefined) index.set(key, [value]);
    else values.push(value);
  };
  for (const bond of bonds) {
    if (bond.kind === 'parent') {
      add(parentIdsByChild, bond.childId, bond.parentId);
      add(childIdsByParent, bond.parentId, bond.childId);
    } else add(guardianIdsByChild, bond.childId, bond.parentId);
  }
  for (const index of [childIdsByParent, guardianIdsByChild, parentIdsByChild])
    for (const values of index.values()) values.sort((left, right) => left - right);
  return Object.freeze({ childIdsByParent, guardianIdsByChild, parentIdsByChild });
}

function indexedIds(index: ReadonlyMap<number, readonly number[]>, id: number): readonly number[] {
  return Object.freeze([...(index.get(id) ?? [])]);
}

function indexedAncestors(
  index: FamilyProjectionIndex,
  personId: number,
  maximumDepth: number,
): ReadonlyMap<number, number> {
  const distances = new Map<number, number>();
  let frontier = [personId];
  for (let depth = 1; depth <= maximumDepth && frontier.length > 0; depth += 1) {
    const next: number[] = [];
    for (const childId of frontier)
      for (const parentId of index.parentIdsByChild.get(childId) ?? [])
        if (!distances.has(parentId)) {
          distances.set(parentId, depth);
          next.push(parentId);
        }
    frontier = next.sort((left, right) => left - right);
  }
  return distances;
}

function indexedDescendants(
  index: FamilyProjectionIndex,
  personId: number,
  maximumDepth: number,
): ReadonlyMap<number, number> {
  const distances = new Map<number, number>();
  let frontier = [personId];
  for (let depth = 1; depth <= maximumDepth && frontier.length > 0; depth += 1) {
    const next: number[] = [];
    for (const parentId of frontier)
      for (const childId of index.childIdsByParent.get(parentId) ?? [])
        if (!distances.has(childId)) {
          distances.set(childId, depth);
          next.push(childId);
        }
    frontier = next.sort((left, right) => left - right);
  }
  return distances;
}

function indexedSiblingIds(index: FamilyProjectionIndex, personId: number): readonly number[] {
  const siblings = new Set<number>();
  for (const parentId of index.parentIdsByChild.get(personId) ?? [])
    for (const childId of index.childIdsByParent.get(parentId) ?? [])
      if (childId !== personId) siblings.add(childId);
  return Object.freeze([...siblings].sort((left, right) => left - right));
}

function indexedExtendedKinIds(
  index: FamilyProjectionIndex,
  personId: number,
  populationBound: number,
): readonly number[] {
  const ancestors = indexedAncestors(index, personId, 3);
  const directAncestors = indexedAncestors(index, personId, populationBound);
  const directDescendants = indexedDescendants(index, personId, populationBound);
  const siblings = new Set(indexedSiblingIds(index, personId));
  const kin = new Set<number>();
  for (const ancestorId of ancestors.keys()) {
    for (const candidateId of indexedDescendants(index, ancestorId, 3).keys()) {
      if (
        candidateId !== personId &&
        !directAncestors.has(candidateId) &&
        !directDescendants.has(candidateId) &&
        !siblings.has(candidateId)
      )
        kin.add(candidateId);
    }
  }
  return Object.freeze([...kin].sort((left, right) => left - right));
}

function projectSociety(state: WorldState): SocietyProjection {
  const society = state.civilization.society;
  const familyIndex = familyProjectionIndex(society.interpersonal.familyBonds);
  const eventsById = new Map(state.eventLog.map((event) => [event.id, event]));
  const culturesById = new Map(society.cultures.map((culture) => [culture.id, culture]));
  const leaderName =
    society.people.find((person) => person.id === society.institution.leaderId)?.name ?? 'None';
  const people = society.people.map((person) => {
    const ageYears = Math.max(0, Math.floor((state.tick - person.birthTick) / society.yearTicks));
    const childArrival = society.interpersonal.childArrivals.find(
      (arrival) => arrival.childId === person.id,
    );
    return Object.freeze({
      id: person.id,
      name: person.name,
      ageYears,
      lifeStage: person.alive
        ? ageYears < 18
          ? 'Child'
          : ageYears < 65
            ? 'Adult'
            : 'Elder'
        : 'Deceased',
      status: person.alive ? 'Living' : `Died at tick ${person.deathTick}`,
      role: person.role,
      cultureName: culturesById.get(person.cultureId)?.name ?? 'Unknown culture',
      householdName: `Household ${person.householdId}`,
      parentIds: indexedIds(familyIndex.parentIdsByChild, person.id),
      guardianIds: indexedIds(familyIndex.guardianIdsByChild, person.id),
      childIds: indexedIds(familyIndex.childIdsByParent, person.id),
      siblingIds: indexedSiblingIds(familyIndex, person.id),
      extendedKinIds: indexedExtendedKinIds(familyIndex, person.id, society.people.length),
      childArrival:
        childArrival === undefined
          ? null
          : Object.freeze({
              tick: childArrival.tick,
              eventId: childArrival.eventId,
              eligibilityEventId: childArrival.eligibilityEventId,
              policy: childArrival.policy,
              householdId: childArrival.householdId,
              guardianIds: Object.freeze([...childArrival.guardianIds]),
              partnerRelationshipId: childArrival.partnerRelationshipId,
              partnerKindAtArrival: childArrival.partnerKindAtArrival,
              minimumPartnerTrustAtArrival: childArrival.minimumPartnerTrustAtArrival,
              minimumPartnerCommitmentAtArrival: childArrival.minimumPartnerCommitmentAtArrival,
              selectionScoreAtArrival: childArrival.selectionScoreAtArrival,
            }),
      biography: Object.freeze(
        person.biographyEventIds.map((eventId) => {
          const source = eventsById.get(eventId);
          if (source === undefined) throw new Error('Projected biography source event is missing.');
          return Object.freeze({ eventId, tick: source.tick, summary: source.summary });
        }),
      ),
    });
  });
  const cultures = society.cultures.map((culture) =>
    Object.freeze({
      id: culture.id,
      name: culture.name,
      preference: culture.preference,
      belief: culture.belief,
      tradition: culture.tradition,
      architectureStyle: culture.architectureStyle,
      familyPolicy: culture.familyPolicy,
    }),
  );
  const timelinePage = projectTimelinePage(state, state.eventLog.length);
  return Object.freeze({
    dashboard: Object.freeze({
      year: Math.floor(state.tick / society.yearTicks),
      population: society.people.filter((person) => person.alive).length,
      households: society.households.length,
      meals: society.households.reduce((total, household) => total + household.meals, 0),
      tools: society.households.reduce((total, household) => total + household.tools, 0),
      exchangeVolume: society.offers.reduce((total, offer) => total + offer.fulfilledAmount, 0),
      transportDemand: society.offers.reduce((total, offer) => total + offer.transportDemand, 0),
      scarcity: society.scarcity,
      stability: society.stability,
      inequality: society.inequality,
      government: society.institution.government,
      leaderName,
    }),
    people: Object.freeze(people),
    cultures: Object.freeze(cultures),
    timeline: timelinePage.timeline,
    timelineOffset: timelinePage.offset,
    timelineTotal: timelinePage.total,
  });
}

/** Creates a copied, transfer-ready UI read model without exposing world authority. */
export function projectWorldFrame(state: WorldState): WorldFrameProjection {
  const { width, height } = state.config;
  const expectedTiles = width * height;
  const { tiles } = state;
  if (
    !Number.isSafeInteger(expectedTiles) ||
    tiles.biome.length !== expectedTiles ||
    tiles.freshWater.length !== expectedTiles ||
    tiles.food.length !== expectedTiles ||
    tiles.timber.length !== expectedTiles ||
    tiles.stone.length !== expectedTiles ||
    tiles.metal.length !== expectedTiles ||
    tiles.habitability.length !== expectedTiles ||
    tiles.hazard.length !== expectedTiles
  ) {
    throw new Error('World tiles do not match the configured projection dimensions.');
  }

  const biome = new Uint8Array(expectedTiles);
  const resource = new Uint16Array(expectedTiles);
  const habitability = new Uint8Array(expectedTiles);
  const hazard = new Uint8Array(expectedTiles);
  for (let index = 0; index < expectedTiles; index += 1) {
    const tileBiome = tiles.biome[index];
    const freshWater = tiles.freshWater[index];
    const food = tiles.food[index];
    const timber = tiles.timber[index];
    const stone = tiles.stone[index];
    const metal = tiles.metal[index];
    const tileHabitability = tiles.habitability[index];
    const tileHazard = tiles.hazard[index];
    if (
      tileBiome === undefined ||
      freshWater === undefined ||
      food === undefined ||
      timber === undefined ||
      stone === undefined ||
      metal === undefined ||
      tileHabitability === undefined ||
      tileHazard === undefined
    ) {
      throw new Error('World tile projection encountered a missing tile.');
    }
    biome[index] = toByte(tileBiome);
    const resources =
      toResource(freshWater) +
      toResource(food) +
      toResource(timber) +
      toResource(stone) +
      toResource(metal);
    resource[index] = Math.min(65_535, resources);
    habitability[index] = toByte(tileHabitability);
    hazard[index] = toByte(tileHazard);
  }

  const visibleAgents = state.civilization.agents
    .filter((agent) => agent.alive)
    .slice()
    .sort((left, right) => left.id - right.id);
  const agentIds = new Uint32Array(visibleAgents.length);
  const agentTiles = new Uint32Array(visibleAgents.length);
  const agentHealth = new Uint16Array(visibleAgents.length);
  const agentActions = new Uint8Array(visibleAgents.length);
  for (let index = 0; index < visibleAgents.length; index += 1) {
    const agent = visibleAgents[index]!;
    if (index > 0 && agent.id <= visibleAgents[index - 1]!.id) {
      throw new Error('Projected agent IDs must be strictly ascending.');
    }
    agentIds[index] = toUint32(agent.id, 'Agent id');
    const tile = toUint32(agent.tileIndex, 'Agent tile');
    if (tile >= expectedTiles) throw new RangeError('Agent tile is outside the projection.');
    agentTiles[index] = tile;
    agentHealth[index] = toSettlementUnit(agent.health * 10, 'Agent health');
    agentActions[index] = agentActionCode(agent.action);
  }

  const visibleStructures = sortedVisibleStructures(state.civilization);
  const structureIds = new Uint32Array(visibleStructures.length);
  const structureTiles = new Uint32Array(visibleStructures.length);
  const structureKinds = new Uint8Array(visibleStructures.length);
  const structureStates = new Uint8Array(visibleStructures.length);
  const structureProgress = new Uint16Array(visibleStructures.length);
  const structureCondition = new Uint16Array(visibleStructures.length);
  for (let index = 0; index < visibleStructures.length; index += 1) {
    const structure = visibleStructures[index]!;
    if (index > 0 && structure.id <= visibleStructures[index - 1]!.id) {
      throw new Error('Projected structure IDs must be strictly ascending.');
    }
    structureIds[index] = toUint32(structure.id, 'Structure id');
    const tile = toUint32(structure.tileIndex, 'Structure tile');
    if (tile >= expectedTiles) throw new RangeError('Structure tile is outside the projection.');
    structureTiles[index] = tile;
    structureKinds[index] = structureKindCode(structure.kind);
    structureStates[index] = structureStateCode(structure.status);
    structureProgress[index] = toSettlementUnit(structure.progress, 'Structure progress');
    structureCondition[index] = toSettlementUnit(structure.condition, 'Structure condition');
  }
  const settlementSummary = projectSettlementSummary(state.civilization, visibleStructures);
  const society = projectSociety(state);
  const development = projectDevelopment(state);
  const civilizations = projectCivilizations(state);

  return Object.freeze({
    version: WORKER_PROTOCOL_VERSION,
    width,
    height,
    tick: state.tick,
    stateHash: hashWorldState(state),
    biome,
    resource,
    habitability,
    hazard,
    agentIds,
    agentTiles,
    agentHealth,
    agentActions,
    structureIds,
    structureTiles,
    structureKinds,
    structureStates,
    structureProgress,
    structureCondition,
    settlementSummary,
    society,
    development,
    civilizations,
  });
}

export function createSimulationRuntime(post: RuntimePost): SimulationRuntime {
  let world: WorldState | undefined;
  let runMode: RunMode = 'paused';
  // Transport-only base. It is never returned to UI code or used as world authority.
  let lastEmittedFrame: WorldFrameProjection | undefined;

  function emit(message: WorkerToUiMessage): void {
    const transfer =
      message.type === 'ready'
        ? projectionTransferables(message.frame)
        : message.type === 'frameDelta'
          ? frameDeltaTransferables(message.delta)
          : [];
    post(message, transfer);
  }

  function emitReady(requestId: string): void {
    if (world === undefined) throw new Error('Cannot emit a ready frame before initialization.');
    // The ready frame's buffers transfer to the UI. Keep a separate immutable full
    // projection so the next delta never reads detached transfer buffers.
    lastEmittedFrame = projectWorldFrame(world);
    emit({
      type: 'ready',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId,
      frame: projectWorldFrame(world),
    });
  }

  function emitOrderedFrameDelta(requestId: string): void {
    if (world === undefined || lastEmittedFrame === undefined)
      throw new Error('Cannot emit a frame delta before a ready frame establishes its base.');
    const nextFrame = projectWorldFrame(world);
    const delta = createWorldFrameDelta(lastEmittedFrame, nextFrame);
    lastEmittedFrame = nextFrame;
    emit({
      type: 'frameDelta',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId,
      delta,
      payloadBytes: estimateFrameDeltaPayloadBytes(delta),
    });
  }

  function fault(requestId: string, code: WorkerFaultCode, message: string): void {
    emit({ type: 'fault', protocolVersion: WORKER_PROTOCOL_VERSION, requestId, code, message });
  }

  function metrics(requestId: string): void {
    emit({
      type: 'metrics',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId,
      metrics: {
        tick: world?.tick ?? 0,
        runMode,
        queuedCommandCount: world?.development.pendingInterventions.length ?? 0,
      },
    });
  }

  function projectedEvent(event: WorldState['eventLog'][number]): WorkerEvent {
    return Object.freeze({
      id: event.id,
      tick: event.tick,
      type: event.kind,
      summary: event.summary,
      subjectKind: event.subjectKind,
      subjectId: event.subjectId,
      targetKind: event.targetKind,
      targetId: event.targetId,
      tileIndex: event.tileIndex,
      amount: event.amount,
    });
  }

  function emitEvents(requestId: string, events: readonly WorldState['eventLog'][number][]): void {
    if (events.length === 0) return;
    const recentEvents = events.slice(-MAX_RECENT_WORKER_EVENTS);
    emit({
      type: 'eventBatch',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId,
      events: Object.freeze(recentEvents.map(projectedEvent)),
    });
  }

  function initialize(request: InitializeRequest): void {
    world = createInitialWorld(request.seed, request.config);
    runMode = 'paused';
    lastEmittedFrame = undefined;
    emitReady(request.requestId);
    emitEvents(request.requestId, world.eventLog);
    metrics(request.requestId);
  }

  function advance(request: AdvanceTicksRequest): void {
    if (world === undefined) {
      fault(request.requestId, 'not-initialized', 'Initialize a world before advancing ticks.');
      return;
    }
    assertValidTicks(request.ticks);
    const priorEventCount = world.eventLog.length;
    world = stepWorld(world, request.ticks);
    emitOrderedFrameDelta(request.requestId);
    emitEvents(request.requestId, world.eventLog.slice(priorEventCount));
    metrics(request.requestId);
  }

  function load(request: LoadRequest): void {
    world = deserializeWorldSnapshot(request.snapshot);
    runMode = 'paused';
    lastEmittedFrame = undefined;
    emitReady(request.requestId);
    emitEvents(request.requestId, world.eventLog);
    metrics(request.requestId);
  }

  function requestSave(request: RequestSaveRequest): void {
    if (world === undefined) {
      fault(request.requestId, 'not-initialized', 'Initialize a world before requesting a save.');
      return;
    }
    emit({
      type: 'saveSnapshot',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      snapshot: serializeWorldSnapshot(world),
    });
  }

  function requestTimelinePage(request: RequestTimelinePageRequest): void {
    if (world === undefined) {
      fault(request.requestId, 'not-initialized', 'Initialize a world before requesting history.');
      return;
    }
    const page = projectTimelinePage(world, request.offset);
    emit({
      type: 'timelinePage',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      ...page,
    });
  }

  function requestRelationshipPage(request: RequestRelationshipPageRequest): void {
    if (world === undefined) {
      fault(
        request.requestId,
        'not-initialized',
        'Initialize a world before inspecting relationships.',
      );
      return;
    }
    const page = projectRelationshipPage(world, request.personId, request.offset);
    emit({
      type: 'relationshipPage',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      ...page,
    });
  }

  function requestRelationshipEventPage(request: RequestRelationshipEventPageRequest): void {
    if (world === undefined) {
      fault(
        request.requestId,
        'not-initialized',
        'Initialize a world before inspecting relationship history.',
      );
      return;
    }
    const page = projectRelationshipEventPage(
      world,
      request.personId,
      request.relationshipId,
      request.offset,
    );
    emit({
      type: 'relationshipEventPage',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      ...page,
    });
  }

  function performOfflineCatchUp(request: PerformOfflineCatchUpRequest): void {
    if (world === undefined) {
      fault(request.requestId, 'not-initialized', 'Initialize a world before offline catch-up.');
      return;
    }
    if (request.policyVersion !== OFFLINE_CATCH_UP_POLICY_VERSION) {
      fault(
        request.requestId,
        'unsupported-operation',
        `Offline catch-up policy ${request.policyVersion} is not supported.`,
      );
      return;
    }
    const elapsedMilliseconds = Math.min(
      request.elapsedMilliseconds,
      MAX_OFFLINE_CATCH_UP_MILLISECONDS,
    );
    const requestedTicks = Math.floor((elapsedMilliseconds * request.rate) / 1_000);
    const ticks = Math.min(requestedTicks, MAX_OFFLINE_CATCH_UP_TICKS);
    const priorEventCount = world.eventLog.length;
    if (ticks > 0) {
      world = stepWorld(world, ticks);
      world = appendWorldEvent(world, 'offline-catch-up', world.tick, {
        summary: `Bounded offline progression reached tick ${world.tick}.`,
      });
    }
    emitOrderedFrameDelta(request.requestId);
    emitEvents(request.requestId, world.eventLog.slice(priorEventCount));
    metrics(request.requestId);
  }

  return Object.freeze({
    handleMessage(input: unknown): void {
      const validation = validateUiToWorkerMessage(input);
      if (validation.kind === 'invalid') {
        fault(validation.requestId, 'invalid-request', validation.reason);
        return;
      }
      if (validation.kind === 'protocol-version-mismatch') {
        fault(
          validation.requestId,
          'protocol-version-mismatch',
          `Unsupported worker protocol version ${validation.receivedVersion}.`,
        );
        return;
      }
      const message = validation.message;

      try {
        switch (message.type) {
          case 'initialize':
            initialize(message);
            return;
          case 'load':
            load(message);
            return;
          case 'advanceTicks':
            advance(message);
            return;
          case 'setRunMode':
            runMode = message.runMode;
            metrics(message.requestId);
            return;
          case 'queueCommand':
            if (world === undefined) {
              fault(
                message.requestId,
                'not-initialized',
                'Initialize a world before queueing an intervention.',
              );
              return;
            }
            world = applyWorldIntervention(world, {
              kind: message.command.payload.interventionKind,
              intensity: message.command.payload.intensity,
              polarity: message.command.payload.polarity,
              targetTileIndex: message.command.payload.targetTileIndex,
            });
            emit({
              type: 'commandAccepted',
              protocolVersion: WORKER_PROTOCOL_VERSION,
              requestId: message.requestId,
              command: message.command,
              sequence: world.development.nextInterventionId - 1,
              targetTick:
                (Math.floor(world.tick / world.config.societyYearTicks) + 1) *
                world.config.societyYearTicks,
            });
            metrics(message.requestId);
            return;
          case 'requestSave':
            requestSave(message);
            return;
          case 'requestTimelinePage':
            requestTimelinePage(message);
            return;
          case 'requestRelationshipPage':
            requestRelationshipPage(message);
            return;
          case 'requestRelationshipEventPage':
            requestRelationshipEventPage(message);
            return;
          case 'performOfflineCatchUp':
            performOfflineCatchUp(message);
            return;
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown world runtime error.';
        fault(message.requestId, 'world-error', reason);
      }
    },
  });
}
