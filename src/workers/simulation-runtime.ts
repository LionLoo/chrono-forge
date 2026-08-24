import {
  AGENT_ACTION_CODES,
  MAX_ADVANCE_TICKS_PER_REQUEST,
  STRUCTURE_KIND_CODES,
  STRUCTURE_STATE_CODES,
  WORKER_PROTOCOL_VERSION,
  projectionTransferables,
  validateUiToWorkerMessage,
  type AdvanceTicksRequest,
  type FrameDeltaResponse,
  type InitializeRequest,
  type LoadRequest,
  type PerformOfflineCatchUpRequest,
  type RequestSaveRequest,
  type RequestTimelinePageRequest,
  type RunMode,
  type SettlementSummary,
  type SocietyProjection,
  type WorkerEvent,
  type WorkerFaultCode,
  type WorkerToUiMessage,
  type WorldFrameProjection,
} from '../protocol';
import { deserializeWorldSnapshot, serializeWorldSnapshot } from '../simulation/persistence';
import {
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

function projectSociety(state: WorldState): SocietyProjection {
  const society = state.civilization.society;
  const eventsById = new Map(state.eventLog.map((event) => [event.id, event]));
  const culturesById = new Map(society.cultures.map((culture) => [culture.id, culture]));
  const leaderName =
    society.people.find((person) => person.id === society.institution.leaderId)?.name ?? 'None';
  const people = society.people.map((person) => {
    const ageYears = Math.max(0, Math.floor((state.tick - person.birthTick) / society.yearTicks));
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
  });
}

export function createSimulationRuntime(post: RuntimePost): SimulationRuntime {
  let world: WorldState | undefined;
  let runMode: RunMode = 'paused';

  function emit(message: WorkerToUiMessage): void {
    const transfer =
      message.type === 'ready' || message.type === 'frameDelta'
        ? projectionTransferables(message.frame)
        : [];
    post(message, transfer);
  }

  function fault(requestId: string, code: WorkerFaultCode, message: string): void {
    emit({ type: 'fault', protocolVersion: WORKER_PROTOCOL_VERSION, requestId, code, message });
  }

  function metrics(requestId: string): void {
    emit({
      type: 'metrics',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId,
      metrics: { tick: world?.tick ?? 0, runMode, queuedCommandCount: 0 },
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
    emit({
      type: 'ready',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      frame: projectWorldFrame(world),
    });
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
    const response: FrameDeltaResponse = {
      type: 'frameDelta',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      frame: projectWorldFrame(world),
    };
    emit(response);
    emitEvents(request.requestId, world.eventLog.slice(priorEventCount));
    metrics(request.requestId);
  }

  function load(request: LoadRequest): void {
    world = deserializeWorldSnapshot(request.snapshot);
    runMode = 'paused';
    emit({
      type: 'ready',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      frame: projectWorldFrame(world),
    });
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
    emit({
      type: 'frameDelta',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      frame: projectWorldFrame(world),
    });
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
            fault(
              message.requestId,
              'unsupported-operation',
              'Direct simulation commands are unsupported; M3 settlement work remains autonomous.',
            );
            return;
          case 'requestSave':
            requestSave(message);
            return;
          case 'requestTimelinePage':
            requestTimelinePage(message);
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
