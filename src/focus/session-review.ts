import type { SettlementDevelopmentStage } from '../simulation/civilizations';
import type { WorldEntityKind, WorldEvent, WorldState } from '../simulation/world';

export const FOCUS_SESSION_REVIEW_VERSION = 1 as const;
export const MAX_FOCUS_RECAP_EVENTS = 12;
export const MAX_FOCUS_REVISIT_LABEL_LENGTH = 80;

export interface FocusRecapEntry {
  readonly id: number;
  readonly tick: number;
  readonly summary: string;
}

export interface FocusLeadingSettlement {
  readonly id: number;
  readonly name: string;
  readonly developmentStage: SettlementDevelopmentStage;
}

/** Bounded factual display copy captured from one exact Worker-owned world state. */
export interface FocusWorldMoment {
  readonly tick: number;
  readonly detailedPopulation: number;
  readonly surfacePopulation: number;
  readonly food: number;
  readonly water: number;
  readonly timber: number;
  readonly stone: number;
  readonly operationalStructures: number;
  readonly activeConstruction: number;
  readonly households: number;
  readonly scarcity: number;
  readonly stability: number;
  readonly activeSettlements: number;
  readonly activeCivilizations: number;
  readonly activeRoutes: number;
  readonly activeConflicts: number;
  readonly activeCrises: number;
  readonly ruins: number;
  readonly leadingSettlement: FocusLeadingSettlement | null;
  readonly offworldPopulation: number;
  readonly activeMissions: number;
  readonly activeColonies: number;
  readonly contactedAliens: number;
}

export type FocusRevisitKind = 'person' | 'structure' | 'settlement' | 'route' | 'ruin';

export interface FocusRevisitTarget {
  readonly kind: FocusRevisitKind;
  readonly id: number;
  readonly label: string;
  readonly sourceEventId: number | null;
}

export interface FocusCheckpointProjection {
  readonly latestEventId: number;
  readonly moment: FocusWorldMoment;
  readonly recapEntries: readonly FocusRecapEntry[];
  readonly revisitTarget: FocusRevisitTarget | null;
}

export interface FocusSessionReview {
  readonly version: typeof FOCUS_SESSION_REVIEW_VERSION;
  readonly baselineEventId: number;
  readonly before: FocusWorldMoment;
  readonly after: FocusWorldMoment;
  readonly revisitTarget: FocusRevisitTarget | null;
}

const MOMENT_KEYS = [
  'tick',
  'detailedPopulation',
  'surfacePopulation',
  'food',
  'water',
  'timber',
  'stone',
  'operationalStructures',
  'activeConstruction',
  'households',
  'scarcity',
  'stability',
  'activeSettlements',
  'activeCivilizations',
  'activeRoutes',
  'activeConflicts',
  'activeCrises',
  'ruins',
  'leadingSettlement',
  'offworldPopulation',
  'activeMissions',
  'activeColonies',
  'contactedAliens',
] as const;

const SETTLEMENT_STAGES: readonly SettlementDevelopmentStage[] = Object.freeze([
  'founding',
  'village',
  'town',
  'city',
  'advanced-city',
]);

const REVISIT_KINDS: readonly FocusRevisitKind[] = Object.freeze([
  'person',
  'structure',
  'settlement',
  'route',
  'ruin',
]);

function assertSafeInteger(value: number, label: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${label} must be a safe integer greater than or equal to ${minimum}.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be a plain object.`);
  return value;
}

function expectExactKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new TypeError(`${label} has missing or unknown fields.`);
  }
}

function copyRecapEntry(event: WorldEvent): FocusRecapEntry {
  return Object.freeze({ id: event.id, tick: event.tick, summary: event.summary });
}

function leadingSettlement(state: WorldState): FocusLeadingSettlement | null {
  const settlement = state.civilizations.settlements
    .filter((candidate) => candidate.status === 'active')
    .slice()
    .sort((left, right) => left.id - right.id)[0];
  return settlement === undefined
    ? null
    : Object.freeze({
        id: settlement.id,
        name: settlement.name,
        developmentStage: settlement.developmentStage,
      });
}

export function projectFocusWorldMoment(state: WorldState): FocusWorldMoment {
  const structures = state.civilization.structures.filter(
    (structure) => structure.status !== 'demolished',
  );
  return Object.freeze({
    tick: state.tick,
    detailedPopulation: state.civilization.agents.filter((agent) => agent.alive).length,
    surfacePopulation: state.civilizations.settlements
      .filter((settlement) => settlement.status === 'active')
      .reduce((total, settlement) => total + settlement.population, 0),
    food: state.civilization.stockpile.food,
    water: state.civilization.stockpile.water,
    timber: state.civilization.stockpile.timber,
    stone: state.civilization.stockpile.stone,
    operationalStructures: structures.filter((structure) => structure.status === 'operational')
      .length,
    activeConstruction: structures.filter(
      (structure) => structure.status === 'planned' || structure.status === 'building',
    ).length,
    households: state.civilization.society.households.length,
    scarcity: state.civilization.society.scarcity,
    stability: state.civilization.society.stability,
    activeSettlements: state.civilizations.settlements.filter(
      (settlement) => settlement.status === 'active',
    ).length,
    activeCivilizations: state.civilizations.civilizations.filter(
      (civilization) => civilization.endedTick === null,
    ).length,
    activeRoutes: state.civilizations.routes.filter((route) => route.status === 'active').length,
    activeConflicts: state.civilizations.conflicts.filter(
      (conflict) => conflict.status === 'active',
    ).length,
    activeCrises: state.development.activeCrises.length,
    ruins: state.civilizations.ruins.length,
    leadingSettlement: leadingSettlement(state),
    offworldPopulation:
      state.space.missions
        .filter((mission) => mission.status === 'active')
        .reduce((total, mission) => total + mission.passengerIds.length, 0) +
      state.space.colonies
        .filter((colony) => colony.status === 'active')
        .reduce((total, colony) => total + colony.residentIds.length, 0),
    activeMissions: state.space.missions.filter((mission) => mission.status === 'active').length,
    activeColonies: state.space.colonies.filter((colony) => colony.status === 'active').length,
    contactedAliens: state.space.aliens.filter((alien) => alien.discoveredTick !== null).length,
  });
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll('-', ' ');
}

function eventTarget(
  state: WorldState,
  kind: WorldEntityKind,
  id: number,
  sourceEventId: number | null,
): FocusRevisitTarget | null {
  switch (kind) {
    case 'person': {
      const person = state.civilization.society.people.find((candidate) => candidate.id === id);
      return person === undefined
        ? null
        : Object.freeze({ kind: 'person', id, label: person.name, sourceEventId });
    }
    case 'structure': {
      const structure = state.civilization.structures.find(
        (candidate) => candidate.id === id && candidate.status !== 'demolished',
      );
      return structure === undefined
        ? null
        : Object.freeze({
            kind: 'structure',
            id,
            label: `${titleCase(structure.kind)} ${id}`,
            sourceEventId,
          });
    }
    case 'settlement': {
      const settlement = state.civilizations.settlements.find((candidate) => candidate.id === id);
      return settlement === undefined
        ? null
        : Object.freeze({ kind: 'settlement', id, label: settlement.name, sourceEventId });
    }
    case 'route': {
      const route = state.civilizations.routes.find((candidate) => candidate.id === id);
      if (route === undefined) return null;
      const names = new Map(
        state.civilizations.settlements.map((settlement) => [settlement.id, settlement.name]),
      );
      return Object.freeze({
        kind: 'route',
        id,
        label: `${names.get(route.firstSettlementId) ?? `Settlement ${route.firstSettlementId}`}–${names.get(route.secondSettlementId) ?? `Settlement ${route.secondSettlementId}`} route`,
        sourceEventId,
      });
    }
    case 'ruin': {
      const ruin = state.civilizations.ruins.find((candidate) => candidate.id === id);
      const settlement =
        ruin === undefined
          ? undefined
          : state.civilizations.settlements.find((candidate) => candidate.id === ruin.settlementId);
      return ruin === undefined
        ? null
        : Object.freeze({
            kind: 'ruin',
            id,
            label: settlement === undefined ? `Ruin ${id}` : `Ruin of ${settlement.name}`,
            sourceEventId,
          });
    }
    case 'civilization':
    case 'group':
    case 'household':
    case 'world':
    case 'conflict':
    case 'culture':
    case 'institution':
    case 'celestial-body':
    case 'space-program':
    case 'spacecraft':
    case 'space-colony':
    case 'alien-civilization':
      return null;
  }
}

function revisitTarget(
  state: WorldState,
  recapEvents: readonly WorldEvent[],
): FocusRevisitTarget | null {
  for (const event of [...recapEvents].reverse()) {
    const subject = eventTarget(state, event.subjectKind, event.subjectId, event.id);
    if (subject !== null) return subject;
    const target = eventTarget(state, event.targetKind, event.targetId, event.id);
    if (target !== null) return target;
  }
  const activeConstruction = state.civilization.structures
    .filter((structure) => structure.status === 'planned' || structure.status === 'building')
    .slice()
    .sort((left, right) => left.id - right.id)[0];
  if (activeConstruction !== undefined) {
    return eventTarget(state, 'structure', activeConstruction.id, null);
  }
  const settlement = state.civilizations.settlements
    .filter((candidate) => candidate.status === 'active')
    .slice()
    .sort((left, right) => left.id - right.id)[0];
  if (settlement !== undefined) return eventTarget(state, 'settlement', settlement.id, null);
  const person = state.civilization.society.people
    .filter((candidate) => candidate.alive)
    .slice()
    .sort((left, right) => left.id - right.id)[0];
  return person === undefined ? null : eventTarget(state, 'person', person.id, null);
}

export function projectFocusCheckpoint(
  state: WorldState,
  baselineEventId: number | null,
): FocusCheckpointProjection {
  if (baselineEventId !== null) assertSafeInteger(baselineEventId, 'Focus event baseline');
  const latestEventId = state.eventLog.at(-1)?.id ?? 0;
  if (baselineEventId !== null && baselineEventId > latestEventId) {
    throw new RangeError('Focus event baseline cannot be newer than the authoritative event log.');
  }
  const recapEvents =
    baselineEventId === null
      ? []
      : state.eventLog.filter((event) => event.id > baselineEventId).slice(-MAX_FOCUS_RECAP_EVENTS);
  return Object.freeze({
    latestEventId,
    moment: projectFocusWorldMoment(state),
    recapEntries: Object.freeze(recapEvents.map(copyRecapEntry)),
    revisitTarget: revisitTarget(state, recapEvents),
  });
}

export function createFocusSessionReview(
  baseline: FocusCheckpointProjection,
  latest: FocusCheckpointProjection,
): FocusSessionReview {
  if (baseline.recapEntries.length !== 0) {
    throw new TypeError('A focus session baseline cannot contain post-baseline events.');
  }
  return validateFocusSessionReview({
    version: FOCUS_SESSION_REVIEW_VERSION,
    baselineEventId: baseline.latestEventId,
    before: baseline.moment,
    after: latest.moment,
    revisitTarget: latest.revisitTarget,
  });
}

function validateLeadingSettlement(value: unknown): FocusLeadingSettlement | null {
  if (value === null) return null;
  const record = expectRecord(value, 'Focus leading settlement');
  expectExactKeys(record, ['id', 'name', 'developmentStage'], 'Focus leading settlement');
  assertSafeInteger(record.id as number, 'Focus leading settlement ID', 1);
  if (
    typeof record.name !== 'string' ||
    record.name.trim().length === 0 ||
    record.name.length > MAX_FOCUS_REVISIT_LABEL_LENGTH ||
    !SETTLEMENT_STAGES.includes(record.developmentStage as SettlementDevelopmentStage)
  ) {
    throw new TypeError('Focus leading settlement is invalid.');
  }
  return value as FocusLeadingSettlement;
}

export function validateFocusWorldMoment(value: unknown): FocusWorldMoment {
  const record = expectRecord(value, 'Focus world moment');
  expectExactKeys(record, MOMENT_KEYS, 'Focus world moment');
  for (const key of MOMENT_KEYS) {
    if (key === 'leadingSettlement') continue;
    assertSafeInteger(record[key] as number, `Focus world moment ${key}`);
  }
  validateLeadingSettlement(record.leadingSettlement);
  return value as FocusWorldMoment;
}

export function validateFocusRevisitTarget(value: unknown): FocusRevisitTarget | null {
  if (value === null) return null;
  const record = expectRecord(value, 'Focus revisit target');
  expectExactKeys(record, ['kind', 'id', 'label', 'sourceEventId'], 'Focus revisit target');
  if (!REVISIT_KINDS.includes(record.kind as FocusRevisitKind)) {
    throw new TypeError('Focus revisit target kind is invalid.');
  }
  assertSafeInteger(record.id as number, 'Focus revisit target ID', 1);
  if (
    typeof record.label !== 'string' ||
    record.label.trim().length === 0 ||
    record.label.length > MAX_FOCUS_REVISIT_LABEL_LENGTH
  ) {
    throw new TypeError('Focus revisit target label is invalid.');
  }
  if (record.sourceEventId !== null) {
    assertSafeInteger(record.sourceEventId as number, 'Focus revisit source event ID', 1);
  }
  return value as FocusRevisitTarget;
}

export function validateFocusSessionReview(value: unknown): FocusSessionReview {
  const record = expectRecord(value, 'Focus session review');
  expectExactKeys(
    record,
    ['version', 'baselineEventId', 'before', 'after', 'revisitTarget'],
    'Focus session review',
  );
  if (record.version !== FOCUS_SESSION_REVIEW_VERSION) {
    throw new TypeError('Unsupported focus session review version.');
  }
  assertSafeInteger(record.baselineEventId as number, 'Focus session review baseline');
  const before = validateFocusWorldMoment(record.before);
  const after = validateFocusWorldMoment(record.after);
  if (after.tick < before.tick) {
    throw new RangeError('Focus session review moment cannot move backwards in logical time.');
  }
  validateFocusRevisitTarget(record.revisitTarget);
  return value as FocusSessionReview;
}
