import { findLocalPath } from '../pathfinding';
import { deriveXoshiro128State, type Xoshiro128State, Xoshiro128StarStar } from '../random';
import {
  NORMAL_YEAR_TICKS,
  SOCIETY_PULSE_TICKS,
  advanceSociety,
  assertSocietyInvariants,
  createInitialSociety,
  societyDto,
  type EntityKind,
  type SocietyPersonDraft,
  type SocietyPersonObservation,
  type SocietyState,
} from '../society';

export const SETTLEMENT_FOUNDER_COUNT = 6;
export const SETTLEMENT_ACTION_PULSE_TICKS = 100;
export const MAX_AGENT_KNOWN_TILES = 16;
export const MAX_AGENT_MEMORIES = 12;
export const SETTLEMENT_PATH_EXPANSION_QUOTA = 64;
export const MAX_AGENT_PLAN_STEPS = 2;
export const MAX_AGENT_ROUTE_LENGTH = SETTLEMENT_PATH_EXPANSION_QUOTA + 1;

export type AgentAction =
  | 'idle'
  | 'forage'
  | 'collect-water'
  | 'gather-timber'
  | 'gather-stone'
  | 'transport'
  | 'construct'
  | 'repair'
  | 'rest';
export type AgentGoal = 'survive' | 'secure-shelter' | 'sustain-stores' | 'improve-settlement';
export type Occupation =
  'generalist' | 'forager' | 'water-carrier' | 'woodcutter' | 'stone-gatherer' | 'builder';
export type CarriedResource = 'none' | 'food' | 'water' | 'timber' | 'stone';
export type StructureKind = 'shelter' | 'storehouse';
export type StructureStatus =
  'planned' | 'building' | 'operational' | 'damaged' | 'abandoned' | 'demolished';

export interface AgentActivityTotals {
  readonly foodGathered: number;
  readonly waterGathered: number;
  readonly timberGathered: number;
  readonly stoneGathered: number;
  readonly constructionWork: number;
  readonly transported: number;
}

export interface FactualMemory {
  readonly id: number;
  readonly eventId: number;
  readonly tick: number;
  readonly kind: string;
  readonly summary: string;
  readonly targetKind: EntityKind;
  readonly targetId: number;
}

export interface SettlementAgent {
  readonly id: number;
  readonly name: string;
  readonly alive: boolean;
  readonly tileIndex: number;
  readonly ageTicks: number;
  readonly health: number;
  readonly hunger: number;
  readonly thirst: number;
  readonly fatigue: number;
  readonly safety: number;
  readonly traits: readonly [number, number, number, number];
  readonly skills: readonly [number, number, number, number];
  readonly action: AgentAction;
  readonly targetTileIndex: number;
  /** Stable tile-index route and cursor make movement resumable across snapshots. */
  readonly route: readonly number[];
  readonly routeCursor: number;
  readonly carryingKind: CarriedResource;
  readonly carryingAmount: number;
  readonly plan: readonly AgentPlanStep[];
  readonly planIndex: number;
  readonly homeStructureId: number;
  readonly personalGoal: AgentGoal;
  readonly communalGoal: AgentGoal;
  readonly occupation: Occupation;
  readonly knownTiles: readonly number[];
  readonly memories: readonly FactualMemory[];
  readonly rng: Xoshiro128State;
  readonly activity: AgentActivityTotals;
}

export interface AgentPlanStep {
  readonly action: AgentAction;
  readonly targetTileIndex: number;
  readonly targetStructureId: number;
}

export interface Relationship {
  readonly id: number;
  readonly firstAgentId: number;
  readonly secondAgentId: number;
  readonly affinity: number;
  readonly trust: number;
}

export interface SettlementStructure {
  readonly id: number;
  readonly kind: StructureKind;
  readonly status: StructureStatus;
  readonly tileIndex: number;
  readonly progress: number;
  readonly condition: number;
  readonly level: number;
  readonly capacity: number;
  readonly communalOwnership: boolean;
  readonly ownerId: number;
  readonly plannedTick: number;
  readonly completedTick: number;
  readonly changedTick: number;
}

export interface SettlementStockpile {
  readonly food: number;
  readonly water: number;
  readonly timber: number;
  readonly stone: number;
}

export interface ResourceDepletion {
  readonly tileIndex: number;
  readonly food: number;
  readonly timber: number;
  readonly stone: number;
}

export interface CivilizationState {
  readonly nextAgentId: number;
  readonly nextRelationshipId: number;
  readonly nextStructureId: number;
  readonly nextMemoryId: number;
  readonly centerTileIndex: number;
  readonly stockpile: SettlementStockpile;
  readonly agents: readonly SettlementAgent[];
  readonly relationships: readonly Relationship[];
  readonly structures: readonly SettlementStructure[];
  readonly society: SocietyState;
  readonly resourceDepletion: readonly ResourceDepletion[];
  readonly pathDemand: Uint16Array;
  readonly systemRng: Xoshiro128State;
  readonly operationCount: number;
}

export interface SettlementTerrain {
  readonly width: number;
  readonly height: number;
  readonly food: Uint16Array;
  readonly freshWater: Uint16Array;
  readonly timber: Uint16Array;
  readonly stone: Uint16Array;
  readonly habitability: Uint8Array;
  readonly hazard: Uint8Array;
  readonly isWalkable: (tileIndex: number) => boolean;
}

export interface SettlementEventDraft {
  readonly kind: string;
  readonly summary: string;
  readonly subjectKind: EntityKind;
  readonly subjectId: number;
  readonly targetKind: EntityKind;
  readonly targetId: number;
  readonly tileIndex: number;
  readonly amount: number;
}

export interface SettlementPulseResult {
  readonly civilization: CivilizationState;
  readonly events: readonly SettlementEventDraft[];
}

export interface SettlementSummary {
  readonly aliveAgents: number;
  readonly operationalShelters: number;
  readonly operationalStorehouses: number;
  readonly stockpile: SettlementStockpile;
  readonly operationCount: number;
}

interface MutableStockpile {
  food: number;
  water: number;
  timber: number;
  stone: number;
}

const EMPTY_ACTIVITY: AgentActivityTotals = Object.freeze({
  foodGathered: 0,
  waterGathered: 0,
  timberGathered: 0,
  stoneGathered: 0,
  constructionWork: 0,
  transported: 0,
});

function clamp(value: number, minimum: number, maximum: number): number {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}

function assertSafeInteger(value: number, label: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be a safe integer at least ${minimum}.`);
  }
}

function freezeStockpile(stockpile: MutableStockpile): SettlementStockpile {
  return Object.freeze({
    food: stockpile.food,
    water: stockpile.water,
    timber: stockpile.timber,
    stone: stockpile.stone,
  });
}

function activityWith(
  activity: AgentActivityTotals,
  changes: Partial<AgentActivityTotals>,
): AgentActivityTotals {
  return Object.freeze({ ...activity, ...changes });
}

function deriveOccupation(
  activity: AgentActivityTotals,
  skills: readonly [number, number, number, number],
): Occupation {
  const candidates: readonly [Occupation, number][] = [
    ['forager', activity.foodGathered * 4 + skills[0]],
    ['water-carrier', activity.waterGathered * 4 + skills[1]],
    ['woodcutter', activity.timberGathered * 4 + skills[2]],
    ['stone-gatherer', activity.stoneGathered * 4 + skills[3]],
    ['builder', activity.constructionWork * 2 + skills[3]],
  ];
  const winner = [...candidates].sort(
    (left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0),
  )[0]!;
  return winner[1] <= 50 ? 'generalist' : winner[0];
}

function developSkills(
  skills: readonly [number, number, number, number],
  action: AgentAction,
): readonly [number, number, number, number] {
  let index: 0 | 1 | 2 | 3 | undefined;
  switch (action) {
    case 'forage':
      index = 0;
      break;
    case 'collect-water':
      index = 1;
      break;
    case 'gather-timber':
      index = 2;
      break;
    case 'gather-stone':
    case 'construct':
    case 'repair':
      index = 3;
      break;
    case 'idle':
    case 'transport':
    case 'rest':
      return skills;
  }
  const next = [...skills] as [number, number, number, number];
  next[index] = clamp(next[index] + 1, 0, 100);
  return next;
}

function centerTile(terrain: SettlementTerrain): number {
  const centerX = Math.trunc(terrain.width / 2);
  const centerY = Math.trunc(terrain.height / 2);
  const preferred = centerY * terrain.width + centerX;
  if (terrain.isWalkable(preferred)) return preferred;
  for (let index = 0; index < terrain.width * terrain.height; index += 1) {
    if (terrain.isWalkable(index)) return index;
  }
  throw new Error('Settlement requires at least one walkable founding tile.');
}

function traitTuple(rng: Xoshiro128StarStar): readonly [number, number, number, number] {
  return [rng.nextInt(101), rng.nextInt(101), rng.nextInt(101), rng.nextInt(101)];
}

function skillTuple(rng: Xoshiro128StarStar): readonly [number, number, number, number] {
  return [20 + rng.nextInt(31), 20 + rng.nextInt(31), 20 + rng.nextInt(31), 20 + rng.nextInt(31)];
}

function societyObservation(agent: SettlementAgent): SocietyPersonObservation {
  return Object.freeze({
    id: agent.id,
    alive: agent.alive,
    health: agent.health,
    tileIndex: agent.tileIndex,
    skills: agent.skills,
    occupation: agent.occupation,
  });
}

/** Creates six deterministic founders and no player-issued work assignments. */
export function createInitialCivilization(
  seed: Xoshiro128State,
  terrain: SettlementTerrain,
  tick = 0,
  societyYearTicks = NORMAL_YEAR_TICKS,
): CivilizationState {
  const centerTileIndex = centerTile(terrain);
  const agents: SettlementAgent[] = [];
  for (let index = 0; index < SETTLEMENT_FOUNDER_COUNT; index += 1) {
    const id = index + 1;
    const rng = new Xoshiro128StarStar(deriveXoshiro128State(seed, `agent-${id}`));
    agents.push(
      Object.freeze({
        id,
        name: `Founder ${id}`,
        alive: true,
        tileIndex: centerTileIndex,
        ageTicks: 18 * 365 * 24 * 60 * 60 * 10,
        health: 100,
        hunger: 12 + rng.nextInt(12),
        thirst: 12 + rng.nextInt(12),
        fatigue: rng.nextInt(12),
        safety: 70 + rng.nextInt(21),
        traits: traitTuple(rng),
        skills: skillTuple(rng),
        action: 'idle',
        targetTileIndex: centerTileIndex,
        route: Object.freeze([]),
        routeCursor: 0,
        carryingKind: 'none',
        carryingAmount: 0,
        plan: Object.freeze([]),
        planIndex: 0,
        homeStructureId: 0,
        personalGoal: 'survive',
        communalGoal: 'secure-shelter',
        occupation: 'generalist',
        knownTiles: Object.freeze([centerTileIndex]),
        memories: Object.freeze([]),
        rng: rng.save(),
        activity: EMPTY_ACTIVITY,
      }),
    );
  }
  const relationships: Relationship[] = [];
  let nextRelationshipId = 1;
  for (let first = 1; first <= SETTLEMENT_FOUNDER_COUNT; first += 1) {
    for (let second = first + 1; second <= SETTLEMENT_FOUNDER_COUNT; second += 1) {
      relationships.push(
        Object.freeze({
          id: nextRelationshipId++,
          firstAgentId: first,
          secondAgentId: second,
          affinity: 50,
          trust: 50,
        }),
      );
    }
  }
  const society = createInitialSociety({
    seed,
    tick,
    centerTileIndex,
    yearTicks: societyYearTicks,
    people: agents.map(societyObservation),
  });
  const names = new Map(society.people.map((person) => [person.id, person.name]));
  return Object.freeze({
    nextAgentId: SETTLEMENT_FOUNDER_COUNT + 1,
    nextRelationshipId,
    nextStructureId: 1,
    nextMemoryId: 1,
    centerTileIndex,
    stockpile: Object.freeze({ food: 48, water: 48, timber: 25, stone: 5 }),
    agents: Object.freeze(
      agents.map((agent) => Object.freeze({ ...agent, name: names.get(agent.id) ?? agent.name })),
    ),
    relationships: Object.freeze(relationships),
    structures: Object.freeze([]),
    society,
    resourceDepletion: Object.freeze([]),
    pathDemand: new Uint16Array(terrain.width * terrain.height),
    systemRng: deriveXoshiro128State(seed, 'settlement-system'),
    operationCount: 0,
  });
}

/**
 * Founds M3 civilization authority at a legacy snapshot's logical tick.
 *
 * Legacy worlds contain terrain history but no civilization history. Replaying
 * settlement pulses from tick zero would invent unrecorded events and makes
 * migration cost depend on an untrusted saved tick, so founding is deliberately
 * constant-time at the migration boundary.
 */
export function createCivilizationAtTick(
  seed: Xoshiro128State,
  terrain: SettlementTerrain,
  tick: number,
): CivilizationState {
  assertSafeInteger(tick, 'Legacy civilization tick');
  return createInitialCivilization(seed, terrain, tick);
}

function depletionAt(
  depletion: readonly ResourceDepletion[],
  tileIndex: number,
): ResourceDepletion | undefined {
  return depletion.find((entry) => entry.tileIndex === tileIndex);
}

function available(
  terrain: SettlementTerrain,
  depletion: readonly ResourceDepletion[],
  tileIndex: number,
  kind: 'food' | 'timber' | 'stone',
): number {
  const source = terrain[kind][tileIndex] ?? 0;
  const used = depletionAt(depletion, tileIndex)?.[kind] ?? 0;
  return Math.max(0, source - used);
}

function consumeTerrain(
  entries: readonly ResourceDepletion[],
  terrain: SettlementTerrain,
  tileIndex: number,
  kind: 'food' | 'timber' | 'stone',
  wanted: number,
): readonly ResourceDepletion[] {
  const amount = Math.min(wanted, available(terrain, entries, tileIndex, kind));
  if (amount === 0) return entries;
  const existing = depletionAt(entries, tileIndex);
  const replacement: ResourceDepletion = Object.freeze({
    tileIndex,
    food: (existing?.food ?? 0) + (kind === 'food' ? amount : 0),
    timber: (existing?.timber ?? 0) + (kind === 'timber' ? amount : 0),
    stone: (existing?.stone ?? 0) + (kind === 'stone' ? amount : 0),
  });
  return Object.freeze(
    [...entries.filter((entry) => entry.tileIndex !== tileIndex), replacement].sort(
      (left, right) => left.tileIndex - right.tileIndex,
    ),
  );
}

/** Food is a renewable field: each action pulse regrows a bounded unit while timber/stone remain depleted. */
function regrowFood(entries: readonly ResourceDepletion[]): readonly ResourceDepletion[] {
  return Object.freeze(
    entries
      .map((entry) => Object.freeze({ ...entry, food: Math.max(0, entry.food - 8) }))
      .filter((entry) => entry.food > 0 || entry.timber > 0 || entry.stone > 0),
  );
}

interface DecisionCandidate {
  readonly action: AgentAction;
  readonly goal: AgentGoal;
  readonly targetTileIndex: number;
  readonly targetStructureId: number;
  readonly utility: number;
}

function nearbyTiles(center: number, terrain: SettlementTerrain): readonly number[] {
  const x = center % terrain.width;
  const y = Math.trunc(center / terrain.width);
  const tiles: number[] = [];
  for (let deltaY = -3; deltaY <= 3; deltaY += 1) {
    for (let deltaX = -3; deltaX <= 3; deltaX += 1) {
      const targetX = x + deltaX;
      const targetY = y + deltaY;
      if (targetX >= 0 && targetX < terrain.width && targetY >= 0 && targetY < terrain.height) {
        const index = targetY * terrain.width + targetX;
        if (terrain.isWalkable(index)) tiles.push(index);
      }
    }
  }
  return Object.freeze(tiles.sort((left, right) => left - right));
}

function distance(left: number, right: number, width: number): number {
  return (
    Math.abs((left % width) - (right % width)) +
    Math.abs(Math.trunc(left / width) - Math.trunc(right / width))
  );
}

function bestResourceTile(
  agent: SettlementAgent,
  civilization: CivilizationState,
  terrain: SettlementTerrain,
  kind: Exclude<CarriedResource, 'none'>,
): readonly [number, number] {
  const candidates = nearbyTiles(agent.tileIndex, terrain);
  let bestTile = agent.tileIndex;
  let bestScore = Number.MIN_SAFE_INTEGER;
  for (const tileIndex of candidates) {
    const resource =
      kind === 'water'
        ? (terrain.freshWater[tileIndex] ?? 0)
        : available(terrain, civilization.resourceDepletion, tileIndex, kind);
    const score =
      resource * 4 +
      (terrain.habitability[tileIndex] ?? 0) -
      (terrain.hazard[tileIndex] ?? 0) * 2 -
      distance(agent.tileIndex, tileIndex, terrain.width) * 8;
    if (score > bestScore || (score === bestScore && tileIndex < bestTile)) {
      bestTile = tileIndex;
      bestScore = score;
    }
  }
  return [bestTile, bestScore];
}

function socialContext(agent: SettlementAgent, relationships: readonly Relationship[]): number {
  const linked = relationships.filter(
    (relationship) =>
      relationship.firstAgentId === agent.id || relationship.secondAgentId === agent.id,
  );
  if (linked.length === 0) return 0;
  return Math.trunc(
    linked.reduce((total, relationship) => total + relationship.affinity + relationship.trust, 0) /
      linked.length,
  );
}

function selectDecision(
  agent: SettlementAgent,
  civilization: CivilizationState,
  terrain: SettlementTerrain,
  rng: Xoshiro128StarStar,
): DecisionCandidate {
  if (agent.carryingAmount > 0) {
    return {
      action: 'transport',
      goal: 'sustain-stores',
      targetTileIndex: civilization.centerTileIndex,
      targetStructureId: 0,
      utility: 1_000_000,
    };
  }
  const [foodTile, foodScore] = bestResourceTile(agent, civilization, terrain, 'food');
  const [waterTile, waterScore] = bestResourceTile(agent, civilization, terrain, 'water');
  const [timberTile, timberScore] = bestResourceTile(agent, civilization, terrain, 'timber');
  const [stoneTile, stoneScore] = bestResourceTile(agent, civilization, terrain, 'stone');
  const structure = civilization.structures.find(
    (candidate) =>
      candidate.status === 'planned' ||
      candidate.status === 'building' ||
      candidate.status === 'damaged',
  );
  const social = socialContext(agent, civilization.relationships);
  const noShelter = !civilization.structures.some(
    (candidate) => candidate.kind === 'shelter' && candidate.status === 'operational',
  );
  const [requiredTimber, requiredStone] =
    structure === undefined ? [0, 0] : materialsFor(structure.kind);
  // Reserve pressure must outweigh local yield so a rich food or water tile
  // cannot make the settlement ignore a critical shortage of the other need.
  const foodDemand = Math.max(0, 72 - civilization.stockpile.food) * 120;
  const waterDemand = Math.max(0, 72 - civilization.stockpile.water) * 120;
  const timberDemand =
    structure !== undefined && civilization.stockpile.timber < requiredTimber ? 950 : 0;
  const stoneDemand =
    structure !== undefined && civilization.stockpile.stone < requiredStone ? 975 : 0;
  const candidates: DecisionCandidate[] = [
    {
      action: 'rest',
      goal: 'survive',
      targetTileIndex: agent.homeStructureId === 0 ? civilization.centerTileIndex : agent.tileIndex,
      targetStructureId: agent.homeStructureId,
      utility: agent.fatigue >= 80 ? agent.fatigue * 18 : 0,
    },
    {
      action: 'forage',
      goal: agent.hunger >= 65 ? 'survive' : 'sustain-stores',
      targetTileIndex: foodTile,
      targetStructureId: 0,
      utility:
        foodDemand +
        agent.hunger * 16 +
        foodScore +
        agent.traits[0] +
        agent.skills[0] -
        Math.trunc(social / 8),
    },
    {
      action: 'collect-water',
      goal: agent.thirst >= 65 ? 'survive' : 'sustain-stores',
      targetTileIndex: waterTile,
      targetStructureId: 0,
      utility:
        waterDemand +
        agent.thirst * 16 +
        waterScore +
        agent.traits[1] +
        agent.skills[1] -
        Math.trunc(social / 8),
    },
    {
      action: 'gather-timber',
      goal: noShelter ? 'secure-shelter' : 'improve-settlement',
      targetTileIndex: timberTile,
      targetStructureId: 0,
      utility:
        timberDemand +
        (noShelter ? 450 : 80) +
        timberScore +
        agent.traits[2] +
        agent.skills[2] +
        social,
    },
    {
      action: 'gather-stone',
      goal: noShelter ? 'secure-shelter' : 'improve-settlement',
      targetTileIndex: stoneTile,
      targetStructureId: 0,
      utility:
        stoneDemand +
        (noShelter ? 420 : 70) +
        stoneScore +
        agent.traits[2] +
        agent.skills[3] +
        social,
    },
  ];
  if (structure !== undefined) {
    const materialReady = stockpileForStructure(
      civilization.stockpile,
      requiredTimber,
      requiredStone,
    );
    candidates.push({
      action: structure.status === 'damaged' ? 'repair' : 'construct',
      goal: noShelter ? 'secure-shelter' : 'improve-settlement',
      targetTileIndex: structure.tileIndex,
      targetStructureId: structure.id,
      utility: (materialReady ? 5_000 : 300) + agent.traits[3] + agent.skills[3] + social * 2,
    });
  }
  const varied = candidates.map((candidate) =>
    Object.freeze({ ...candidate, utility: candidate.utility + rng.nextInt(3) }),
  );
  return varied.sort(
    (left, right) =>
      right.utility - left.utility ||
      compareAction(left.action, right.action) ||
      left.targetTileIndex - right.targetTileIndex ||
      left.targetStructureId - right.targetStructureId,
  )[0]!;
}

function planFor(candidate: DecisionCandidate, centerTileIndex: number): readonly AgentPlanStep[] {
  if (
    candidate.action === 'forage' ||
    candidate.action === 'collect-water' ||
    candidate.action === 'gather-timber' ||
    candidate.action === 'gather-stone'
  ) {
    return Object.freeze([
      Object.freeze({
        action: candidate.action,
        targetTileIndex: candidate.targetTileIndex,
        targetStructureId: 0,
      }),
      Object.freeze({
        action: 'transport',
        targetTileIndex: centerTileIndex,
        targetStructureId: 0,
      }),
    ]);
  }
  return Object.freeze([
    Object.freeze({
      action: candidate.action,
      targetTileIndex: candidate.targetTileIndex,
      targetStructureId: candidate.targetStructureId,
    }),
  ]);
}

function activePlanStepIsValid(
  step: AgentPlanStep,
  structures: readonly SettlementStructure[],
): boolean {
  if (step.action !== 'construct' && step.action !== 'repair') return true;
  const structure = structures.find((candidate) => candidate.id === step.targetStructureId);
  return step.action === 'construct'
    ? structure?.status === 'planned' || structure?.status === 'building'
    : structure?.status === 'damaged';
}

function compareAction(left: AgentAction, right: AgentAction): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function needsAndHealth(agent: SettlementAgent, stockpile: MutableStockpile): SettlementAgent {
  if (!agent.alive) return agent;
  let health = agent.health;
  let hunger = clamp(agent.hunger + 1, 0, 100);
  let thirst = clamp(agent.thirst + 1, 0, 100);
  const fatigue = clamp(agent.fatigue + 1, 0, 100);
  if (hunger >= 35 && stockpile.food > 0) {
    stockpile.food -= 1;
    hunger = clamp(hunger - 12, 0, 100);
  }
  if (thirst >= 30 && stockpile.water > 0) {
    stockpile.water -= 1;
    thirst = clamp(thirst - 15, 0, 100);
  }
  if (hunger >= 90 || thirst >= 90) health = clamp(health - 2, 0, 100);
  else if (hunger <= 45 && thirst <= 45) health = clamp(health + 1, 0, 100);
  return Object.freeze({
    ...agent,
    ageTicks: agent.ageTicks + SETTLEMENT_ACTION_PULSE_TICKS,
    health,
    hunger,
    thirst,
    fatigue,
    safety: clamp(agent.safety + 1, 0, 100),
    alive: health > 0,
    action: health > 0 ? agent.action : 'idle',
  });
}

function moveAgent(
  agent: SettlementAgent,
  terrain: SettlementTerrain,
): readonly [SettlementAgent, number] {
  if (!agent.alive || agent.targetTileIndex === agent.tileIndex) return [agent, 0];
  const routeNext = agent.route[agent.routeCursor + 1];
  if (routeNext !== undefined) {
    return [
      Object.freeze({ ...agent, tileIndex: routeNext, routeCursor: agent.routeCursor + 1 }),
      0,
    ];
  }
  const start = {
    x: agent.tileIndex % terrain.width,
    y: Math.trunc(agent.tileIndex / terrain.width),
  };
  const goal = {
    x: agent.targetTileIndex % terrain.width,
    y: Math.trunc(agent.targetTileIndex / terrain.width),
  };
  const path = findLocalPath({
    width: terrain.width,
    height: terrain.height,
    start,
    goal,
    maxExpansions: SETTLEMENT_PATH_EXPANSION_QUOTA,
    isPassable: (x, y) => terrain.isWalkable(y * terrain.width + x),
  });
  const route =
    path.status === 'complete'
      ? Object.freeze(path.path.map((point) => point.y * terrain.width + point.x))
      : Object.freeze([]);
  const next = route[1];
  return next === undefined
    ? [Object.freeze({ ...agent, route, routeCursor: 0 }), path.expansions]
    : [Object.freeze({ ...agent, route, routeCursor: 1, tileIndex: next }), path.expansions];
}

function addDemand(pathDemand: Uint16Array, tileIndex: number): void {
  const current = pathDemand[tileIndex] ?? 0;
  pathDemand[tileIndex] = Math.min(0xffff, current + 1);
}

function carryingFor(
  kind: Exclude<CarriedResource, 'none'>,
  amount: number,
): Pick<SettlementAgent, 'carryingKind' | 'carryingAmount'> {
  return amount > 0
    ? { carryingKind: kind, carryingAmount: amount }
    : { carryingKind: 'none', carryingAmount: 0 };
}

function selectBuildSite(
  civilization: CivilizationState,
  terrain: SettlementTerrain,
): number | undefined {
  let best: number | undefined;
  let bestScore = Number.MIN_SAFE_INTEGER;
  for (const tileIndex of nearbyTiles(civilization.centerTileIndex, terrain)) {
    if (
      civilization.structures.some(
        (structure) => structure.tileIndex === tileIndex && structure.status !== 'demolished',
      )
    )
      continue;
    const score =
      (terrain.habitability[tileIndex] ?? 0) * 4 -
      (terrain.hazard[tileIndex] ?? 0) * 5 -
      distance(civilization.centerTileIndex, tileIndex, terrain.width) * 3;
    if (best === undefined || score > bestScore || (score === bestScore && tileIndex < best)) {
      best = tileIndex;
      bestScore = score;
    }
  }
  return best;
}

function plannedStructure(
  civilization: CivilizationState,
  terrain: SettlementTerrain,
  tick: number,
): SettlementStructure | undefined {
  const hasShelter = civilization.structures.some(
    (structure) => structure.kind === 'shelter' && structure.status !== 'demolished',
  );
  if (!hasShelter) {
    const tileIndex = selectBuildSite(civilization, terrain);
    if (tileIndex === undefined) return undefined;
    return Object.freeze({
      id: civilization.nextStructureId,
      kind: 'shelter',
      status: 'planned',
      tileIndex,
      progress: 0,
      condition: 1000,
      level: 1,
      capacity: SETTLEMENT_FOUNDER_COUNT,
      communalOwnership: true,
      ownerId: 0,
      plannedTick: tick,
      completedTick: 0,
      changedTick: tick,
    });
  }
  const hasStorehouse = civilization.structures.some(
    (structure) => structure.kind === 'storehouse' && structure.status !== 'demolished',
  );
  if (!hasStorehouse && tick >= 35_000) {
    const tileIndex = selectBuildSite(civilization, terrain);
    if (tileIndex === undefined) return undefined;
    return Object.freeze({
      id: civilization.nextStructureId,
      kind: 'storehouse',
      status: 'planned',
      tileIndex,
      progress: 0,
      condition: 1000,
      level: 1,
      capacity: 200,
      communalOwnership: true,
      ownerId: 0,
      plannedTick: tick,
      completedTick: 0,
      changedTick: tick,
    });
  }
  const shelterCapacity = civilization.structures
    .filter((structure) => structure.kind === 'shelter' && structure.status === 'operational')
    .reduce((total, structure) => total + structure.capacity, 0);
  const pendingShelter = civilization.structures.some(
    (structure) =>
      structure.kind === 'shelter' &&
      (structure.status === 'planned' ||
        structure.status === 'building' ||
        structure.status === 'damaged'),
  );
  if (
    !pendingShelter &&
    civilization.agents.filter((agent) => agent.alive).length > shelterCapacity &&
    tick >= 45_000
  ) {
    const tileIndex = selectBuildSite(civilization, terrain);
    if (tileIndex === undefined) return undefined;
    return Object.freeze({
      id: civilization.nextStructureId,
      kind: 'shelter',
      status: 'planned',
      tileIndex,
      progress: 0,
      condition: 1000,
      level: 1,
      capacity: SETTLEMENT_FOUNDER_COUNT,
      communalOwnership: true,
      ownerId: 0,
      plannedTick: tick,
      completedTick: 0,
      changedTick: tick,
    });
  }
  return undefined;
}

function materialsFor(kind: StructureKind): readonly [number, number] {
  return kind === 'shelter' ? [20, 5] : [40, 10];
}

function stockpileForStructure(
  stockpile: SettlementStockpile,
  timber: number,
  stone: number,
): boolean {
  return stockpile.timber >= timber && stockpile.stone >= stone;
}

function buildStructures(
  structures: readonly SettlementStructure[],
  stockpile: MutableStockpile,
  workersByStructure: ReadonlyMap<number, readonly [number, number]>,
  tick: number,
): readonly SettlementStructure[] {
  return Object.freeze(
    structures.map((structure) => {
      const [builderCount, repairerCount] = workersByStructure.get(structure.id) ?? [0, 0];
      if (structure.status === 'damaged') {
        const usefulRepairers = Math.min(
          repairerCount,
          stockpile.timber,
          Math.ceil((1_000 - structure.condition) / 25),
        );
        if (usefulRepairers === 0) return structure;
        stockpile.timber -= usefulRepairers;
        const condition = clamp(structure.condition + usefulRepairers * 25, 0, 1000);
        return Object.freeze({
          ...structure,
          condition,
          status: condition === 1000 ? 'operational' : 'damaged',
          changedTick: tick,
        });
      }
      if (structure.status !== 'planned' && structure.status !== 'building') return structure;
      if (builderCount === 0) return structure;
      const [requiredTimber, requiredStone] = materialsFor(structure.kind);
      const progress = clamp(structure.progress + builderCount * 25, 0, 1000);
      const timberCost =
        Math.trunc((requiredTimber * progress) / 1000) -
        Math.trunc((requiredTimber * structure.progress) / 1000);
      const stoneCost =
        Math.trunc((requiredStone * progress) / 1000) -
        Math.trunc((requiredStone * structure.progress) / 1000);
      if (stockpile.timber < timberCost || stockpile.stone < stoneCost) return structure;
      stockpile.timber -= timberCost;
      stockpile.stone -= stoneCost;
      return Object.freeze({
        ...structure,
        status: progress === 1000 ? 'operational' : 'building',
        progress,
        completedTick: progress === 1000 ? tick : 0,
        changedTick: tick,
      });
    }),
  );
}

function lifecycleStructures(
  structures: readonly SettlementStructure[],
  tick: number,
): readonly SettlementStructure[] {
  return Object.freeze(
    structures.map((structure) => {
      if (
        (structure.status === 'operational' || structure.status === 'damaged') &&
        tick % 1_000 === 0
      ) {
        const condition = clamp(structure.condition - 1, 0, 1000);
        return Object.freeze({
          ...structure,
          condition,
          status: condition === 0 ? 'abandoned' : condition <= 150 ? 'damaged' : 'operational',
          changedTick: tick,
        });
      }
      if (structure.status === 'abandoned' && tick - structure.changedTick >= 1_000) {
        const storehouseExists = structures.some(
          (candidate) =>
            candidate.id !== structure.id &&
            candidate.kind === 'storehouse' &&
            candidate.status !== 'demolished',
        );
        if (structure.kind === 'shelter' && !storehouseExists) {
          return Object.freeze({
            ...structure,
            kind: 'storehouse',
            status: 'planned',
            progress: 0,
            condition: 500,
            capacity: 200,
            level: structure.level + 1,
            plannedTick: tick,
            completedTick: 0,
            changedTick: tick,
          });
        }
        return Object.freeze({ ...structure, status: 'demolished', changedTick: tick });
      }
      return structure;
    }),
  );
}

function expandStructures(
  structures: readonly SettlementStructure[],
  stockpile: MutableStockpile,
  tick: number,
): readonly SettlementStructure[] {
  if (tick < 50_000 || stockpile.timber < 20 || stockpile.stone < 5) return structures;
  const expandable = structures.find(
    (structure) =>
      structure.kind === 'storehouse' &&
      structure.status === 'operational' &&
      structure.level === 1,
  );
  if (expandable === undefined) return structures;
  stockpile.timber -= 20;
  stockpile.stone -= 5;
  return Object.freeze(
    structures.map((structure) =>
      structure.id === expandable.id
        ? Object.freeze({
            ...structure,
            level: 2,
            capacity: structure.capacity + 200,
            changedTick: tick,
          })
        : structure,
    ),
  );
}

function sortedAgents(agents: readonly SettlementAgent[]): readonly SettlementAgent[] {
  return Object.freeze([...agents].sort((left, right) => left.id - right.id));
}

function averageTuple(
  first: readonly [number, number, number, number],
  second: readonly [number, number, number, number],
  adjustment = 0,
): readonly [number, number, number, number] {
  return [0, 1, 2, 3].map((index) =>
    clamp(Math.trunc(((first[index] ?? 0) + (second[index] ?? 0)) / 2) + adjustment, 0, 100),
  ) as unknown as readonly [number, number, number, number];
}

function agentFromSocietyDraft(
  draft: SocietyPersonDraft,
  civilization: CivilizationState,
): SettlementAgent {
  const rng = new Xoshiro128StarStar(
    deriveXoshiro128State(civilization.systemRng, `m4-person-${draft.id}`),
  );
  const parents = draft.parentIds
    .map((id) => civilization.agents.find((agent) => agent.id === id))
    .filter((agent): agent is SettlementAgent => agent !== undefined);
  const traits =
    parents.length === 2 ? averageTuple(parents[0]!.traits, parents[1]!.traits) : traitTuple(rng);
  const skills =
    parents.length === 2
      ? averageTuple(parents[0]!.skills, parents[1]!.skills, -15)
      : skillTuple(rng);
  const homeStructureId =
    parents.find((parent) => parent.homeStructureId !== 0)?.homeStructureId ??
    civilization.structures.find(
      (structure) => structure.kind === 'shelter' && structure.status === 'operational',
    )?.id ??
    0;
  return Object.freeze({
    id: draft.id,
    name: draft.name,
    alive: true,
    tileIndex: draft.tileIndex,
    ageTicks: draft.origin === 'migration' ? 20 * 365 * 24 * 60 * 60 * 10 : 0,
    health: draft.origin === 'migration' ? 80 : 100,
    hunger: draft.origin === 'migration' ? 30 : 0,
    thirst: draft.origin === 'migration' ? 24 : 0,
    fatigue: 0,
    safety: homeStructureId === 0 ? 55 : 75,
    traits,
    skills,
    action: 'idle',
    targetTileIndex: draft.tileIndex,
    route: Object.freeze([]),
    routeCursor: 0,
    carryingKind: 'none',
    carryingAmount: 0,
    plan: Object.freeze([]),
    planIndex: 0,
    homeStructureId,
    personalGoal: 'survive',
    communalGoal: 'sustain-stores',
    occupation: 'generalist',
    knownTiles: Object.freeze(
      [...new Set([civilization.centerTileIndex, draft.tileIndex])].sort(
        (left, right) => left - right,
      ),
    ),
    memories: Object.freeze([]),
    rng: rng.save(),
    activity: EMPTY_ACTIVITY,
  });
}

function applySocietyPulse(
  civilization: CivilizationState,
  terrain: SettlementTerrain,
  tick: number,
): SettlementPulseResult {
  const shelterCapacity = civilization.structures
    .filter((structure) => structure.kind === 'shelter' && structure.status === 'operational')
    .reduce((total, structure) => total + structure.capacity, 0);
  const pulse = advanceSociety(civilization.society, {
    tick,
    centerTileIndex: civilization.centerTileIndex,
    worldWidth: terrain.width,
    people: civilization.agents.map(societyObservation),
    communalStockpile: civilization.stockpile,
    shelterCapacity,
  });
  const deaths = new Set(pulse.deathPersonIds);
  const relief = new Map(
    pulse.roleOrNeedReliefPatches.map((patch) => [patch.personId, patch] as const),
  );
  const stockpile: MutableStockpile = { ...pulse.communalStockpile };
  let agents = civilization.agents.map((agent) => {
    if (deaths.has(agent.id)) {
      if (agent.carryingKind !== 'none') stockpile[agent.carryingKind] += agent.carryingAmount;
      return Object.freeze({
        ...agent,
        alive: false,
        health: 0,
        action: 'idle' as const,
        targetTileIndex: agent.tileIndex,
        route: Object.freeze([]),
        routeCursor: 0,
        carryingKind: 'none' as const,
        carryingAmount: 0,
        plan: Object.freeze([]),
        planIndex: 0,
      });
    }
    const patch = relief.get(agent.id);
    return patch === undefined
      ? agent
      : Object.freeze({
          ...agent,
          hunger: clamp(agent.hunger - patch.hungerRelief, 0, 100),
          thirst: clamp(agent.thirst - patch.thirstRelief, 0, 100),
        });
  });
  const exchangeVolume = pulse.society.offers.reduce(
    (total, offer) => total + offer.fulfilledAmount,
    0,
  );
  const traderId = pulse.society.people
    .filter((person) => person.alive && person.role === 'trader')
    .sort((left, right) => left.id - right.id)[0]?.id;
  if (exchangeVolume > 0 && traderId !== undefined) {
    agents = agents.map((agent) =>
      agent.id === traderId
        ? Object.freeze({
            ...agent,
            action: 'transport' as const,
            targetTileIndex: civilization.centerTileIndex,
            plan: Object.freeze([]),
            planIndex: 0,
            route: Object.freeze([]),
            routeCursor: 0,
            activity: activityWith(agent.activity, {
              transported: agent.activity.transported + exchangeVolume,
            }),
          })
        : agent,
    );
  }
  for (const draft of [...pulse.personBirthDrafts, ...pulse.personMigrationDrafts].sort(
    (left, right) => left.id - right.id,
  )) {
    agents = [...agents, agentFromSocietyDraft(draft, { ...civilization, agents })];
  }
  const relationshipPairs = new Set(
    civilization.relationships.map(
      (relationship) => `${relationship.firstAgentId}:${relationship.secondAgentId}`,
    ),
  );
  let nextRelationshipId = civilization.nextRelationshipId;
  const relationships = [...civilization.relationships];
  for (const draft of pulse.personBirthDrafts) {
    for (const parentId of draft.parentIds) {
      if (parentId === 0) continue;
      const firstAgentId = Math.min(parentId, draft.id);
      const secondAgentId = Math.max(parentId, draft.id);
      const key = `${firstAgentId}:${secondAgentId}`;
      if (relationshipPairs.has(key)) continue;
      relationshipPairs.add(key);
      relationships.push(
        Object.freeze({
          id: nextRelationshipId++,
          firstAgentId,
          secondAgentId,
          affinity: 75,
          trust: 70,
        }),
      );
    }
  }
  const next: CivilizationState = Object.freeze({
    ...civilization,
    nextAgentId: Math.max(civilization.nextAgentId, ...agents.map((agent) => agent.id + 1)),
    nextRelationshipId,
    stockpile: freezeStockpile(stockpile),
    agents: sortedAgents(agents),
    relationships: Object.freeze(relationships.sort((left, right) => left.id - right.id)),
    society: pulse.society,
  });
  const events = pulse.events.map((draft) =>
    Object.freeze({
      kind: draft.kind,
      summary: draft.summary,
      subjectKind: draft.subject.kind,
      subjectId: draft.subject.id,
      targetKind: draft.target.kind,
      targetId: draft.target.id,
      tileIndex: civilization.centerTileIndex,
      amount: draft.amount,
    }),
  );
  assertCivilizationInvariants(next, terrain);
  return Object.freeze({ civilization: next, events: Object.freeze(events) });
}

/** Advances one fixed settlement action pulse. Call only at deterministic pulse boundaries. */
export function advanceCivilization(
  civilization: CivilizationState,
  terrain: SettlementTerrain,
  tick: number,
): SettlementPulseResult {
  assertSafeInteger(tick, 'Settlement pulse tick');
  const stockpile: MutableStockpile = { ...civilization.stockpile };
  const pathDemand = civilization.pathDemand.slice();
  let depletion = regrowFood(civilization.resourceDepletion);
  let pathExpansions = 0;
  const systemRng = new Xoshiro128StarStar(civilization.systemRng);
  let agents = civilization.agents.map((agent) => needsAndHealth(agent, stockpile));
  const events: SettlementEventDraft[] = [];
  const newStructure = plannedStructure(civilization, terrain, tick);
  const lifecycle = lifecycleStructures(civilization.structures, tick);
  let structures = lifecycle;
  let nextStructureId = civilization.nextStructureId;
  if (newStructure !== undefined) {
    structures = Object.freeze([...structures, newStructure]);
    nextStructureId += 1;
    events.push({
      kind: `${newStructure.kind}-planned`,
      summary: `${newStructure.kind === 'shelter' ? 'Shelter' : 'Storehouse'} ${newStructure.id} was planned.`,
      subjectKind: 'world',
      subjectId: 0,
      targetKind: 'structure',
      targetId: newStructure.id,
      tileIndex: newStructure.tileIndex,
      amount: 0,
    });
  }

  const decisionCivilization: CivilizationState = Object.freeze({
    ...civilization,
    structures: lifecycle,
  });

  agents = agents.map((agent) => {
    if (!agent.alive) return agent;
    const rng = new Xoshiro128StarStar(agent.rng);
    const pendingStep = agent.plan[agent.planIndex];
    const decidingAgent =
      pendingStep !== undefined && !activePlanStepIsValid(pendingStep, lifecycle)
        ? Object.freeze({
            ...agent,
            plan: Object.freeze([]),
            planIndex: 0,
            route: Object.freeze([]),
            routeCursor: 0,
          })
        : agent;
    const existingStep = decidingAgent.plan[decidingAgent.planIndex];
    const decision =
      existingStep === undefined
        ? selectDecision(decidingAgent, decisionCivilization, terrain, rng)
        : undefined;
    const plan =
      existingStep === undefined
        ? planFor(decision!, civilization.centerTileIndex)
        : decidingAgent.plan;
    const planIndex = existingStep === undefined ? 0 : decidingAgent.planIndex;
    const step = plan[planIndex]!;
    const routeComplete =
      decidingAgent.route.length === 0 ||
      decidingAgent.routeCursor >= decidingAgent.route.length - 1 ||
      decidingAgent.targetTileIndex !== step.targetTileIndex;
    let updated = Object.freeze({
      ...decidingAgent,
      personalGoal: decision?.goal ?? decidingAgent.personalGoal,
      communalGoal:
        decision?.goal === 'survive'
          ? 'secure-shelter'
          : (decision?.goal ?? decidingAgent.communalGoal),
      action: step.action,
      targetTileIndex: step.targetTileIndex,
      rng: rng.save(),
      route: routeComplete ? Object.freeze([]) : decidingAgent.route,
      routeCursor: routeComplete ? 0 : decidingAgent.routeCursor,
      plan,
      planIndex,
    });
    const [moved, expansions] = moveAgent(updated, terrain);
    pathExpansions += expansions;
    updated = moved;
    addDemand(pathDemand, updated.tileIndex);
    const knownTiles = updated.knownTiles.includes(updated.tileIndex)
      ? updated.knownTiles
      : Object.freeze(
          [...updated.knownTiles, updated.tileIndex]
            .slice(-MAX_AGENT_KNOWN_TILES)
            .sort((left, right) => left - right),
        );
    let activity = updated.activity;
    const completeStep = (): SettlementAgent =>
      Object.freeze({
        ...updated,
        planIndex: updated.planIndex + 1,
        route: Object.freeze([]),
        routeCursor: 0,
      });
    if (updated.tileIndex === step.targetTileIndex && step.action === 'forage') {
      const amount = Math.min(30, available(terrain, depletion, updated.tileIndex, 'food'));
      depletion = consumeTerrain(depletion, terrain, updated.tileIndex, 'food', amount);
      updated = Object.freeze({ ...completeStep(), ...carryingFor('food', amount) });
      activity = activityWith(activity, { foodGathered: activity.foodGathered + amount });
    } else if (updated.tileIndex === step.targetTileIndex && step.action === 'collect-water') {
      const freshWater = terrain.freshWater[updated.tileIndex] ?? 0;
      const yieldAmount =
        freshWater === 0 ? 0 : Math.max(4, Math.min(30, Math.trunc(freshWater / 20)));
      updated = Object.freeze({ ...completeStep(), ...carryingFor('water', yieldAmount) });
      activity = activityWith(activity, { waterGathered: activity.waterGathered + yieldAmount });
    } else if (updated.tileIndex === step.targetTileIndex && step.action === 'gather-timber') {
      const amount = Math.min(6, available(terrain, depletion, updated.tileIndex, 'timber'));
      depletion = consumeTerrain(depletion, terrain, updated.tileIndex, 'timber', amount);
      updated = Object.freeze({ ...completeStep(), ...carryingFor('timber', amount) });
      activity = activityWith(activity, { timberGathered: activity.timberGathered + amount });
    } else if (updated.tileIndex === step.targetTileIndex && step.action === 'gather-stone') {
      const amount = Math.min(5, available(terrain, depletion, updated.tileIndex, 'stone'));
      depletion = consumeTerrain(depletion, terrain, updated.tileIndex, 'stone', amount);
      updated = Object.freeze({ ...completeStep(), ...carryingFor('stone', amount) });
      activity = activityWith(activity, { stoneGathered: activity.stoneGathered + amount });
    } else if (updated.tileIndex === step.targetTileIndex && step.action === 'transport') {
      const deposited = updated.carryingAmount;
      if (updated.carryingKind !== 'none') stockpile[updated.carryingKind] += deposited;
      updated = Object.freeze({ ...completeStep(), carryingKind: 'none', carryingAmount: 0 });
      activity = activityWith(activity, { transported: activity.transported + deposited });
    } else if (
      updated.tileIndex === step.targetTileIndex &&
      (step.action === 'construct' || step.action === 'repair')
    ) {
      activity = activityWith(activity, { constructionWork: activity.constructionWork + 25 });
      updated = completeStep();
    } else if (updated.tileIndex === step.targetTileIndex && step.action === 'rest') {
      updated = Object.freeze({ ...completeStep(), fatigue: clamp(updated.fatigue - 12, 0, 100) });
    }
    const skills =
      updated.planIndex > planIndex ? developSkills(updated.skills, step.action) : updated.skills;
    return Object.freeze({
      ...updated,
      knownTiles,
      activity,
      skills,
      occupation: deriveOccupation(activity, skills),
    });
  });

  const workersByStructure = new Map<number, [number, number]>();
  for (const agent of agents) {
    if (
      !agent.alive ||
      agent.tileIndex !== agent.targetTileIndex ||
      (agent.action !== 'construct' && agent.action !== 'repair')
    )
      continue;
    const existing = workersByStructure.get(
      agent.plan[agent.planIndex - 1]?.targetStructureId ?? 0,
    ) ?? [0, 0];
    if (agent.action === 'construct') existing[0] += 1;
    else existing[1] += 1;
    workersByStructure.set(agent.plan[agent.planIndex - 1]?.targetStructureId ?? 0, existing);
  }
  const beforeStatus = new Map(structures.map((structure) => [structure.id, structure.status]));
  structures = buildStructures(structures, stockpile, workersByStructure, tick);
  const beforeExpansion = structures.map((structure) => ({
    id: structure.id,
    level: structure.level,
  }));
  structures = expandStructures(structures, stockpile, tick);
  for (const structure of structures) {
    const prior = beforeExpansion.find((candidate) => candidate.id === structure.id);
    if (prior !== undefined && prior.level !== structure.level)
      events.push({
        kind: `${structure.kind}-expanded`,
        summary: `${structure.kind === 'shelter' ? 'Shelter' : 'Storehouse'} ${structure.id} expanded to capacity ${structure.capacity}.`,
        subjectKind: 'world',
        subjectId: 0,
        targetKind: 'structure',
        targetId: structure.id,
        tileIndex: structure.tileIndex,
        amount: structure.capacity,
      });
  }
  for (const structure of structures) {
    if (beforeStatus.get(structure.id) !== 'operational' && structure.status === 'operational') {
      events.push({
        kind: `${structure.kind}-operational`,
        summary: `${structure.kind === 'shelter' ? 'Shelter' : 'Storehouse'} ${structure.id} became operational.`,
        subjectKind: 'world',
        subjectId: 0,
        targetKind: 'structure',
        targetId: structure.id,
        tileIndex: structure.tileIndex,
        amount: structure.capacity,
      });
      agents = agents.map((agent) =>
        agent.alive && agent.homeStructureId === 0 && structure.kind === 'shelter'
          ? Object.freeze({
              ...agent,
              homeStructureId: structure.id,
              safety: clamp(agent.safety + 15, 0, 100),
            })
          : agent,
      );
    }
  }
  agents = agents.map((agent) => {
    const activeStep = agent.plan[agent.planIndex];
    if (activeStep === undefined || activePlanStepIsValid(activeStep, structures)) return agent;
    return Object.freeze({
      ...agent,
      action: 'idle',
      targetTileIndex: agent.tileIndex,
      plan: Object.freeze([]),
      planIndex: 0,
      route: Object.freeze([]),
      routeCursor: 0,
    });
  });
  const relationships = Object.freeze(
    civilization.relationships.map((relationship) =>
      Object.freeze({
        ...relationship,
        affinity: clamp(relationship.affinity + (systemRng.nextInt(3) - 1), 0, 100),
        trust: clamp(relationship.trust + 1, 0, 100),
      }),
    ),
  );
  let next: CivilizationState = Object.freeze({
    ...civilization,
    nextStructureId,
    stockpile: freezeStockpile(stockpile),
    agents: sortedAgents(agents),
    relationships,
    structures: Object.freeze([...structures].sort((left, right) => left.id - right.id)),
    resourceDepletion: depletion,
    pathDemand,
    systemRng: systemRng.save(),
    operationCount: civilization.operationCount + civilization.agents.length + pathExpansions,
  });
  let nextSocietyTick =
    (Math.floor(next.society.lastTick / SOCIETY_PULSE_TICKS) + 1) * SOCIETY_PULSE_TICKS;
  while (nextSocietyTick <= tick) {
    const societyPulse = applySocietyPulse(next, terrain, nextSocietyTick);
    next = societyPulse.civilization;
    events.push(...societyPulse.events);
    nextSocietyTick += SOCIETY_PULSE_TICKS;
  }
  assertCivilizationInvariants(next, terrain);
  return Object.freeze({ civilization: next, events: Object.freeze(events) });
}

export function attachFactualMemories(
  civilization: CivilizationState,
  events: readonly {
    readonly id: number;
    readonly tick: number;
    readonly kind: string;
    readonly summary: string;
    readonly subjectKind: EntityKind;
    readonly subjectId: number;
    readonly targetKind: EntityKind;
    readonly targetId: number;
  }[],
): CivilizationState {
  let nextMemoryId = civilization.nextMemoryId;
  const bySubject = new Map<number, readonly FactualMemory[]>();
  for (const event of events) {
    const recipients =
      event.subjectKind === 'person'
        ? civilization.agents.filter((agent) => agent.id === event.subjectId)
        : event.subjectKind === 'household'
          ? civilization.agents.filter(
              (agent) =>
                agent.alive &&
                civilization.society.people.find((person) => person.id === agent.id)
                  ?.householdId === event.subjectId,
            )
          : civilization.agents.filter((agent) => agent.alive);
    for (const agent of recipients) {
      const existing = bySubject.get(agent.id) ?? agent.memories;
      bySubject.set(
        agent.id,
        Object.freeze(
          [
            ...existing,
            Object.freeze({
              id: nextMemoryId++,
              eventId: event.id,
              tick: event.tick,
              kind: event.kind,
              summary: event.summary,
              targetKind: event.targetKind,
              targetId: event.targetId,
            }),
          ].slice(-MAX_AGENT_MEMORIES),
        ),
      );
    }
  }
  if (bySubject.size === 0) return civilization;
  return Object.freeze({
    ...civilization,
    nextMemoryId,
    agents: Object.freeze(
      civilization.agents.map((agent) =>
        Object.freeze({ ...agent, memories: bySubject.get(agent.id) ?? agent.memories }),
      ),
    ),
  });
}

export function settlementSummary(civilization: CivilizationState): SettlementSummary {
  return Object.freeze({
    aliveAgents: civilization.agents.filter((agent) => agent.alive).length,
    operationalShelters: civilization.structures.filter(
      (structure) => structure.kind === 'shelter' && structure.status === 'operational',
    ).length,
    operationalStorehouses: civilization.structures.filter(
      (structure) => structure.kind === 'storehouse' && structure.status === 'operational',
    ).length,
    stockpile: civilization.stockpile,
    operationCount: civilization.operationCount,
  });
}

export function isViableSettlement(civilization: CivilizationState): boolean {
  const summary = settlementSummary(civilization);
  const gathered = civilization.agents.reduce(
    (total, agent) => total + agent.activity.foodGathered + agent.activity.waterGathered,
    0,
  );
  return (
    summary.aliveAgents >= SETTLEMENT_FOUNDER_COUNT &&
    summary.operationalShelters >= 1 &&
    summary.stockpile.food >= 12 &&
    summary.stockpile.water >= 12 &&
    gathered > 0 &&
    summary.operationCount > 0
  );
}

/** Canonical DTO: only arrays and primitive records, in stable ID/tile order. */
export function civilizationDto(
  civilization: CivilizationState,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    agents: civilization.agents.map((agent) => ({
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
    centerTileIndex: civilization.centerTileIndex,
    nextAgentId: civilization.nextAgentId,
    nextMemoryId: civilization.nextMemoryId,
    nextRelationshipId: civilization.nextRelationshipId,
    nextStructureId: civilization.nextStructureId,
    operationCount: civilization.operationCount,
    pathDemand: Array.from(civilization.pathDemand),
    relationships: civilization.relationships.map((relationship) => ({ ...relationship })),
    resourceDepletion: civilization.resourceDepletion.map((entry) => ({ ...entry })),
    society: societyDto(civilization.society),
    stockpile: { ...civilization.stockpile },
    structures: civilization.structures.map((structure) => ({ ...structure })),
    systemRng: [...civilization.systemRng],
  });
}

export function assertCivilizationInvariants(
  civilization: CivilizationState,
  terrain: SettlementTerrain,
): void {
  assertSocietyInvariants(civilization.society);
  if (civilization.pathDemand.length !== terrain.width * terrain.height)
    throw new Error('Path demand dimensions are invalid.');
  for (const value of [
    civilization.stockpile.food,
    civilization.stockpile.water,
    civilization.stockpile.timber,
    civilization.stockpile.stone,
  ]) {
    assertSafeInteger(value, 'Stockpile value');
  }
  const ids = new Set<number>();
  for (const agent of civilization.agents) {
    assertSafeInteger(agent.id, 'Agent id', 1);
    if (ids.has(agent.id)) throw new Error('Agent ids must be unique.');
    ids.add(agent.id);
    if (agent.tileIndex < 0 || agent.tileIndex >= terrain.width * terrain.height)
      throw new Error('Agent placement is invalid.');
    for (const value of [
      agent.health,
      agent.hunger,
      agent.thirst,
      agent.fatigue,
      agent.safety,
      ...agent.traits,
      ...agent.skills,
    ]) {
      if (!Number.isSafeInteger(value) || value < 0 || value > 100)
        throw new Error('Agent need, trait, or skill is invalid.');
    }
    if (agent.alive !== agent.health > 0)
      throw new Error('Agent life and health are inconsistent.');
    if (!agent.alive && agent.action !== 'idle')
      throw new Error('Dead agents cannot retain an action.');
    if (
      (agent.carryingKind === 'none') !== (agent.carryingAmount === 0) ||
      !Number.isSafeInteger(agent.carryingAmount) ||
      agent.carryingAmount < 0
    )
      throw new Error('Agent carrying state is invalid.');
    if (agent.knownTiles.length > MAX_AGENT_KNOWN_TILES)
      throw new Error('Agent knowledge exceeds its bound.');
    if (agent.memories.length > MAX_AGENT_MEMORIES)
      throw new Error('Agent memories exceed their bound.');
    for (const memory of agent.memories) {
      if (
        memory.summary.length < 1 ||
        memory.summary.length > 160 ||
        memory.targetId < 0 ||
        (memory.targetKind === 'world' ? memory.targetId !== 0 : memory.targetId === 0)
      )
        throw new Error('Agent factual memory is invalid.');
    }
    if (
      agent.plan.length > MAX_AGENT_PLAN_STEPS ||
      agent.planIndex < 0 ||
      agent.planIndex > agent.plan.length ||
      agent.route.length > MAX_AGENT_ROUTE_LENGTH ||
      agent.routeCursor < 0 ||
      agent.routeCursor > agent.route.length
    )
      throw new Error('Agent plan or route exceeds its bound.');
  }
  const agentIds = new Set(civilization.agents.map((agent) => agent.id));
  const societyPersonIds = new Set(civilization.society.people.map((person) => person.id));
  if (
    agentIds.size !== societyPersonIds.size ||
    [...agentIds].some((id) => !societyPersonIds.has(id)) ||
    civilization.nextAgentId !== civilization.society.nextPersonId
  )
    throw new Error('Settlement agents and society people must share one stable ID graph.');
  for (const person of civilization.society.people) {
    if (civilization.agents.find((agent) => agent.id === person.id)?.name !== person.name)
      throw new Error('Settlement and society person names must match.');
  }
  const relationshipPairs = new Set<string>();
  for (const relationship of civilization.relationships) {
    if (
      !agentIds.has(relationship.firstAgentId) ||
      !agentIds.has(relationship.secondAgentId) ||
      relationship.firstAgentId >= relationship.secondAgentId
    )
      throw new Error('Relationship references are invalid.');
    const pair = `${relationship.firstAgentId}:${relationship.secondAgentId}`;
    if (relationshipPairs.has(pair)) throw new Error('Relationship pairs must be unique.');
    relationshipPairs.add(pair);
  }
  const structureIds = new Set<number>();
  const activeStructureTiles = new Set<number>();
  for (const structure of civilization.structures) {
    if (structureIds.has(structure.id)) throw new Error('Structure ids must be unique.');
    structureIds.add(structure.id);
    if (
      structure.tileIndex < 0 ||
      structure.tileIndex >= terrain.width * terrain.height ||
      structure.progress < 0 ||
      structure.progress > 1000 ||
      structure.condition < 0 ||
      structure.condition > 1000
    )
      throw new Error('Structure placement or state is invalid.');
    if (!structure.communalOwnership && !agentIds.has(structure.ownerId))
      throw new Error('Structure ownership is invalid.');
    if (structure.status !== 'demolished') {
      if (activeStructureTiles.has(structure.tileIndex))
        throw new Error('Active structures cannot share a tile.');
      activeStructureTiles.add(structure.tileIndex);
    }
  }
  const structuresById = new Map(
    civilization.structures.map((structure) => [structure.id, structure]),
  );
  for (const agent of civilization.agents) {
    for (const step of agent.plan.slice(agent.planIndex)) {
      const structure = structuresById.get(step.targetStructureId);
      if (
        step.action === 'construct' &&
        (structure === undefined ||
          (structure.status !== 'planned' && structure.status !== 'building'))
      ) {
        throw new Error('Construction plans must reference an unfinished structure.');
      }
      if (step.action === 'repair' && structure?.status !== 'damaged') {
        throw new Error('Repair plans must reference a damaged structure.');
      }
    }
  }
  for (const entry of civilization.resourceDepletion) {
    if (
      entry.tileIndex < 0 ||
      entry.tileIndex >= terrain.width * terrain.height ||
      entry.food > (terrain.food[entry.tileIndex] ?? 0) ||
      entry.timber > (terrain.timber[entry.tileIndex] ?? 0) ||
      entry.stone > (terrain.stone[entry.tileIndex] ?? 0)
    )
      throw new Error('Resource depletion is invalid.');
  }
}
