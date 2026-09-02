import { Xoshiro128StarStar, type Xoshiro128State } from '../random';

/** M8's camera-independent detailed and aggregate population authority. */
export const MAX_DETAILED_RESIDENTS = 5_000;
export const MAX_AGGREGATE_RESIDENTS = 100_000;
export const MAX_SCALE_COHORTS = 256;
export const MAX_SCALE_TRANSFER_DELTAS = 256;
export const MAX_SCALE_WORK_PER_TICK = 128;
export const DETAILED_UPDATE_PERIOD_TICKS = 4;
export const AGGREGATE_UPDATE_PERIOD_TICKS = 16;
export const MAX_SOCIAL_REFERENCE_IDS = 24;
export const MAX_FAMILY_REFERENCE_IDS = 16;
export const MAX_EVENT_REFERENCE_IDS = 16;
export const MAX_SCALE_BACKLOG = MAX_DETAILED_RESIDENTS + MAX_SCALE_COHORTS;

export interface DetailedResidentState {
  readonly id: number;
  readonly settlementId: number;
  readonly civilizationId: number;
  readonly cultureId: number;
  readonly householdId: number;
  readonly tileIndex: number;
  readonly age: number;
  readonly health: number;
  readonly foodNeed: number;
  readonly waterNeed: number;
  readonly safety: number;
  readonly skill: number;
  /** Positive importance and any reference make a record non-aggregatable. */
  readonly importance: number;
  readonly nextUpdateTick: number;
  readonly updateCount: number;
  readonly rng: Xoshiro128State;
  readonly relationshipIds: readonly number[];
  readonly familyIds: readonly number[];
  readonly eventIds: readonly number[];
}

export interface AggregateClassification {
  readonly settlementId: number;
  readonly civilizationId: number;
  readonly cultureId: number;
  readonly householdId: number;
  readonly tileIndex: number;
}

export interface AggregateTotals {
  readonly age: number;
  readonly health: number;
  readonly foodNeed: number;
  readonly waterNeed: number;
  readonly safety: number;
  readonly skill: number;
}

export interface AggregateCohortState {
  readonly id: number;
  readonly classification: AggregateClassification;
  readonly residentIds: readonly number[];
  readonly householdCount: number;
  readonly totals: AggregateTotals;
  readonly nextUpdateTick: number;
  readonly updateCount: number;
}

export interface ScaleTransferDelta {
  readonly id: number;
  readonly tick: number;
  readonly kind: 'aggregated' | 'deaggregated';
  readonly cohortId: number;
  readonly residentCount: number;
  readonly firstResidentId: number;
  readonly lastResidentId: number;
  readonly totals: AggregateTotals;
}

export interface ScaleBacklog {
  readonly detailedDue: number;
  readonly cohortDue: number;
  readonly totalDue: number;
}

export interface PopulationScaleState {
  readonly tick: number;
  readonly nextCohortId: number;
  readonly nextTransferId: number;
  readonly rng: Xoshiro128State;
  readonly detailedResidents: readonly DetailedResidentState[];
  readonly cohorts: readonly AggregateCohortState[];
  readonly transfers: readonly ScaleTransferDelta[];
  readonly backlog: ScaleBacklog;
  readonly operationCount: number;
}

export interface PopulationScaleInitialization {
  readonly detailedResidents: readonly DetailedResidentState[];
  readonly cohorts?: readonly AggregateCohortState[];
}

const TOTAL_KEYS = ['age', 'health', 'foodNeed', 'waterNeed', 'safety', 'skill'] as const;

function isInteger(value: number): boolean {
  return Number.isSafeInteger(value);
}

function assertPositiveId(value: number, label: string): void {
  if (!isInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer.`);
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!isInteger(value) || value < 0)
    throw new RangeError(`${label} must be a non-negative integer.`);
}

function sortedUnique(
  values: readonly number[],
  label: string,
  maximum: number,
): readonly number[] {
  if (values.length > maximum) throw new RangeError(`${label} exceeds its bounded capacity.`);
  for (let index = 0; index < values.length; index += 1) {
    assertPositiveId(values[index]!, `${label}[${index}]`);
    if (index > 0 && values[index - 1]! >= values[index]!) {
      throw new RangeError(`${label} must be stable-ID sorted and unique.`);
    }
  }
  return values;
}

function assertRng(rng: Xoshiro128State, label: string): void {
  // Constructing validates the exact persisted xoshiro state, including all-zero rejection.
  new Xoshiro128StarStar(rng);
  if (rng.length !== 4) throw new RangeError(`${label} must have four xoshiro words.`);
}

function assertClassification(classification: AggregateClassification): void {
  assertPositiveId(classification.settlementId, 'classification.settlementId');
  assertPositiveId(classification.civilizationId, 'classification.civilizationId');
  assertPositiveId(classification.cultureId, 'classification.cultureId');
  assertPositiveId(classification.householdId, 'classification.householdId');
  assertNonNegativeInteger(classification.tileIndex, 'classification.tileIndex');
}

function assertTotals(totals: AggregateTotals, label: string): void {
  for (const key of TOTAL_KEYS) assertNonNegativeInteger(totals[key], `${label}.${key}`);
}

function zeroTotals(): AggregateTotals {
  return { age: 0, health: 0, foodNeed: 0, waterNeed: 0, safety: 0, skill: 0 };
}

function addTotals(left: AggregateTotals, right: AggregateTotals): AggregateTotals {
  return {
    age: left.age + right.age,
    health: left.health + right.health,
    foodNeed: left.foodNeed + right.foodNeed,
    waterNeed: left.waterNeed + right.waterNeed,
    safety: left.safety + right.safety,
    skill: left.skill + right.skill,
  };
}

function subtractTotals(left: AggregateTotals, right: AggregateTotals): AggregateTotals {
  const result = {
    age: left.age - right.age,
    health: left.health - right.health,
    foodNeed: left.foodNeed - right.foodNeed,
    waterNeed: left.waterNeed - right.waterNeed,
    safety: left.safety - right.safety,
    skill: left.skill - right.skill,
  };
  assertTotals(result, 'remaining cohort totals');
  return result;
}

function residentTotals(resident: DetailedResidentState): AggregateTotals {
  return {
    age: resident.age,
    health: resident.health,
    foodNeed: resident.foodNeed,
    waterNeed: resident.waterNeed,
    safety: resident.safety,
    skill: resident.skill,
  };
}

function totalsForResidents(residents: readonly DetailedResidentState[]): AggregateTotals {
  return residents.reduce(
    (totals, resident) => addTotals(totals, residentTotals(resident)),
    zeroTotals(),
  );
}

function classificationFor(resident: DetailedResidentState): AggregateClassification {
  return {
    settlementId: resident.settlementId,
    civilizationId: resident.civilizationId,
    cultureId: resident.cultureId,
    householdId: resident.householdId,
    tileIndex: resident.tileIndex,
  };
}

function sameClassification(
  left: AggregateClassification,
  right: AggregateClassification,
): boolean {
  return (
    left.settlementId === right.settlementId &&
    left.civilizationId === right.civilizationId &&
    left.cultureId === right.cultureId &&
    left.householdId === right.householdId &&
    left.tileIndex === right.tileIndex
  );
}

function isProtected(resident: DetailedResidentState): boolean {
  return (
    resident.importance > 0 ||
    resident.relationshipIds.length > 0 ||
    resident.familyIds.length > 0 ||
    resident.eventIds.length > 0
  );
}

function normalizeBacklog(
  tick: number,
  detailedResidents: readonly DetailedResidentState[],
  cohorts: readonly AggregateCohortState[],
): ScaleBacklog {
  const detailedDue = detailedResidents.filter(
    (resident) => resident.nextUpdateTick <= tick,
  ).length;
  const cohortDue = cohorts.filter((cohort) => cohort.nextUpdateTick <= tick).length;
  const totalDue = detailedDue + cohortDue;
  if (totalDue > MAX_SCALE_BACKLOG)
    throw new RangeError('Scale backlog exceeds its bounded capacity.');
  return { detailedDue, cohortDue, totalDue };
}

function appendTransfer(
  state: PopulationScaleState,
  transfer: Omit<ScaleTransferDelta, 'id'>,
): readonly ScaleTransferDelta[] {
  return [...state.transfers, { id: state.nextTransferId, ...transfer }].slice(
    -MAX_SCALE_TRANSFER_DELTAS,
  );
}

function distribute(total: number, count: number, index: number): number {
  const quotient = Math.floor(total / count);
  return quotient + (index < total % count ? 1 : 0);
}

function nextRngState(rng: Xoshiro128State): Xoshiro128State {
  const random = new Xoshiro128StarStar(rng);
  random.nextUint32();
  return random.save();
}

function restoredResidentRngState(id: number): Xoshiro128State {
  return [id >>> 0, (id ^ 0x9e3779b9) >>> 0, (id ^ 0x243f6a88) >>> 0, (id ^ 0xb7e15162) >>> 0];
}

export function assertPopulationScaleInvariants(state: PopulationScaleState): void {
  assertNonNegativeInteger(state.tick, 'tick');
  assertPositiveId(state.nextCohortId, 'nextCohortId');
  assertPositiveId(state.nextTransferId, 'nextTransferId');
  assertRng(state.rng, 'rng');
  if (state.detailedResidents.length > MAX_DETAILED_RESIDENTS) {
    throw new RangeError('Detailed resident capacity exceeded.');
  }
  if (state.cohorts.length > MAX_SCALE_COHORTS)
    throw new RangeError('Scale cohort capacity exceeded.');
  if (state.transfers.length > MAX_SCALE_TRANSFER_DELTAS) {
    throw new RangeError('Transfer delta capacity exceeded.');
  }
  assertNonNegativeInteger(state.operationCount, 'operationCount');

  const residentIds = new Set<number>();
  let aggregateResidentCount = 0;
  let previousDetailedId = 0;
  for (const resident of state.detailedResidents) {
    assertPositiveId(resident.id, 'resident.id');
    if (resident.id <= previousDetailedId)
      throw new RangeError('Detailed residents must be stable-ID sorted.');
    previousDetailedId = resident.id;
    residentIds.add(resident.id);
    assertClassification(classificationFor(resident));
    for (const key of TOTAL_KEYS) assertNonNegativeInteger(resident[key], `resident.${key}`);
    assertNonNegativeInteger(resident.importance, 'resident.importance');
    assertNonNegativeInteger(resident.nextUpdateTick, 'resident.nextUpdateTick');
    assertNonNegativeInteger(resident.updateCount, 'resident.updateCount');
    assertRng(resident.rng, 'resident.rng');
    sortedUnique(resident.relationshipIds, 'relationshipIds', MAX_SOCIAL_REFERENCE_IDS);
    sortedUnique(resident.familyIds, 'familyIds', MAX_FAMILY_REFERENCE_IDS);
    sortedUnique(resident.eventIds, 'eventIds', MAX_EVENT_REFERENCE_IDS);
  }

  let previousCohortId = 0;
  for (const cohort of state.cohorts) {
    assertPositiveId(cohort.id, 'cohort.id');
    if (cohort.id <= previousCohortId) throw new RangeError('Cohorts must be stable-ID sorted.');
    previousCohortId = cohort.id;
    assertClassification(cohort.classification);
    if (cohort.residentIds.length === 0) throw new RangeError('Cohorts must not be empty.');
    sortedUnique(cohort.residentIds, 'cohort.residentIds', MAX_AGGREGATE_RESIDENTS);
    for (const id of cohort.residentIds) {
      if (residentIds.has(id))
        throw new RangeError('Resident identity appears in detail and aggregate state.');
      residentIds.add(id);
    }
    aggregateResidentCount += cohort.residentIds.length;
    assertPositiveId(cohort.householdCount, 'cohort.householdCount');
    if (cohort.householdCount !== 1)
      throw new RangeError('A cohort must retain exactly one household identity.');
    assertTotals(cohort.totals, 'cohort.totals');
    assertNonNegativeInteger(cohort.nextUpdateTick, 'cohort.nextUpdateTick');
    assertNonNegativeInteger(cohort.updateCount, 'cohort.updateCount');
  }
  if (state.nextCohortId <= previousCohortId) {
    throw new RangeError('nextCohortId must exceed every retained cohort ID.');
  }
  if (aggregateResidentCount > MAX_AGGREGATE_RESIDENTS) {
    throw new RangeError('Aggregate resident capacity exceeded.');
  }

  let previousTransferId = 0;
  for (const transfer of state.transfers) {
    assertPositiveId(transfer.id, 'transfer.id');
    if (transfer.id <= previousTransferId)
      throw new RangeError('Transfer deltas must be ID sorted.');
    previousTransferId = transfer.id;
    assertNonNegativeInteger(transfer.tick, 'transfer.tick');
    if (transfer.kind !== 'aggregated' && transfer.kind !== 'deaggregated') {
      throw new RangeError('Transfer kind is invalid.');
    }
    assertPositiveId(transfer.cohortId, 'transfer.cohortId');
    assertPositiveId(transfer.residentCount, 'transfer.residentCount');
    assertPositiveId(transfer.firstResidentId, 'transfer.firstResidentId');
    assertPositiveId(transfer.lastResidentId, 'transfer.lastResidentId');
    if (transfer.firstResidentId > transfer.lastResidentId)
      throw new RangeError('Transfer resident range is invalid.');
    assertTotals(transfer.totals, 'transfer.totals');
  }
  if (state.nextTransferId <= previousTransferId) {
    throw new RangeError('nextTransferId must exceed every retained transfer ID.');
  }
  const expectedBacklog = normalizeBacklog(state.tick, state.detailedResidents, state.cohorts);
  if (
    state.backlog.detailedDue !== expectedBacklog.detailedDue ||
    state.backlog.cohortDue !== expectedBacklog.cohortDue ||
    state.backlog.totalDue !== expectedBacklog.totalDue
  ) {
    throw new RangeError('Scale backlog telemetry does not match scheduled work.');
  }
}

export function createPopulationScale(
  rng: Xoshiro128State,
  tick: number,
  initialization: PopulationScaleInitialization,
): PopulationScaleState {
  const provisional: PopulationScaleState = {
    tick,
    nextCohortId: Math.max(0, ...(initialization.cohorts?.map((cohort) => cohort.id) ?? [])) + 1,
    nextTransferId: 1,
    rng,
    detailedResidents: [...initialization.detailedResidents].sort(
      (left, right) => left.id - right.id,
    ),
    cohorts: [...(initialization.cohorts ?? [])].sort((left, right) => left.id - right.id),
    transfers: [],
    backlog: { detailedDue: 0, cohortDue: 0, totalDue: 0 },
    operationCount: 0,
  };
  const state = {
    ...provisional,
    backlog: normalizeBacklog(tick, provisional.detailedResidents, provisional.cohorts),
  };
  assertPopulationScaleInvariants(state);
  return state;
}

/** Advances fixed logical ticks; no camera or elapsed-time input can affect authority. */
export function advancePopulationScale(
  input: PopulationScaleState,
  logicalTicks: number,
): PopulationScaleState {
  assertPopulationScaleInvariants(input);
  assertNonNegativeInteger(logicalTicks, 'logicalTicks');
  let state = input;
  for (let offset = 0; offset < logicalTicks; offset += 1) {
    const tick = state.tick + 1;
    const due = [
      ...state.detailedResidents
        .filter((resident) => resident.nextUpdateTick <= tick)
        .map((resident) => ({ kind: 'detail' as const, id: resident.id })),
      ...state.cohorts
        .filter((cohort) => cohort.nextUpdateTick <= tick)
        .map((cohort) => ({ kind: 'cohort' as const, id: cohort.id })),
    ].sort(
      (left, right) =>
        left.id - right.id || (left.kind === right.kind ? 0 : left.kind === 'detail' ? -1 : 1),
    );
    const selected = due.slice(0, MAX_SCALE_WORK_PER_TICK);
    const selectedDetails = new Set(
      selected.filter((item) => item.kind === 'detail').map((item) => item.id),
    );
    const selectedCohorts = new Set(
      selected.filter((item) => item.kind === 'cohort').map((item) => item.id),
    );
    const detailedResidents = state.detailedResidents.map((resident) =>
      selectedDetails.has(resident.id)
        ? {
            ...resident,
            rng: nextRngState(resident.rng),
            nextUpdateTick: tick + DETAILED_UPDATE_PERIOD_TICKS,
            updateCount: resident.updateCount + 1,
          }
        : resident,
    );
    const cohorts = state.cohorts.map((cohort) =>
      selectedCohorts.has(cohort.id)
        ? {
            ...cohort,
            nextUpdateTick: tick + AGGREGATE_UPDATE_PERIOD_TICKS,
            updateCount: cohort.updateCount + 1,
          }
        : cohort,
    );
    const random = new Xoshiro128StarStar(state.rng);
    random.nextUint32();
    state = {
      ...state,
      tick,
      rng: random.save(),
      detailedResidents,
      cohorts,
      backlog: normalizeBacklog(tick, detailedResidents, cohorts),
      operationCount: state.operationCount + selected.length,
    };
  }
  assertPopulationScaleInvariants(state);
  return state;
}

export function aggregateResidents(
  input: PopulationScaleState,
  residentIds: readonly number[],
): PopulationScaleState {
  assertPopulationScaleInvariants(input);
  sortedUnique(residentIds, 'residentIds', MAX_DETAILED_RESIDENTS);
  if (residentIds.length === 0) throw new RangeError('Aggregation requires at least one resident.');
  const selectedIds = new Set(residentIds);
  const selected = input.detailedResidents.filter((resident) => selectedIds.has(resident.id));
  if (selected.length !== residentIds.length)
    throw new RangeError('Aggregation references an unknown detailed resident.');
  if (selected.some(isProtected))
    throw new RangeError(
      'Historically significant or socially referenced residents cannot aggregate.',
    );
  const classification = classificationFor(selected[0]!);
  if (
    selected.some((resident) => !sameClassification(classification, classificationFor(resident)))
  ) {
    throw new RangeError(
      'Aggregation requires one preserved settlement/culture/household/tile classification.',
    );
  }
  if (input.cohorts.length >= MAX_SCALE_COHORTS)
    throw new RangeError('Scale cohort capacity exceeded.');
  const cohort: AggregateCohortState = {
    id: input.nextCohortId,
    classification,
    residentIds: [...residentIds],
    householdCount: 1,
    totals: totalsForResidents(selected),
    nextUpdateTick: input.tick,
    updateCount: 0,
  };
  const detailedResidents = input.detailedResidents.filter(
    (resident) => !selectedIds.has(resident.id),
  );
  const cohorts = [...input.cohorts, cohort].sort((left, right) => left.id - right.id);
  const transfers = appendTransfer(input, {
    tick: input.tick,
    kind: 'aggregated',
    cohortId: cohort.id,
    residentCount: cohort.residentIds.length,
    firstResidentId: cohort.residentIds[0]!,
    lastResidentId: cohort.residentIds.at(-1)!,
    totals: cohort.totals,
  });
  const state: PopulationScaleState = {
    ...input,
    nextCohortId: cohort.id + 1,
    nextTransferId: input.nextTransferId + 1,
    detailedResidents,
    cohorts,
    transfers,
    backlog: normalizeBacklog(input.tick, detailedResidents, cohorts),
  };
  assertPopulationScaleInvariants(state);
  return state;
}

export function deaggregateCohort(
  input: PopulationScaleState,
  cohortId: number,
  residentCount: number,
): PopulationScaleState {
  assertPopulationScaleInvariants(input);
  assertPositiveId(cohortId, 'cohortId');
  assertPositiveId(residentCount, 'residentCount');
  const cohort = input.cohorts.find((candidate) => candidate.id === cohortId);
  if (!cohort) throw new RangeError('Unknown aggregate cohort.');
  if (residentCount > cohort.residentIds.length)
    throw new RangeError('Cannot deaggregate more residents than the cohort contains.');
  if (input.detailedResidents.length + residentCount > MAX_DETAILED_RESIDENTS) {
    throw new RangeError('Detailed resident capacity exceeded.');
  }
  const selectedIds = cohort.residentIds.slice(0, residentCount);
  const restoredTotals = TOTAL_KEYS.reduce<AggregateTotals>(
    (totals, key) => ({
      ...totals,
      [key]: selectedIds.reduce(
        (sum, _id, index) => sum + distribute(cohort.totals[key], cohort.residentIds.length, index),
        0,
      ),
    }),
    zeroTotals(),
  );
  const detailedResidents = [
    ...input.detailedResidents,
    ...selectedIds.map((id, index): DetailedResidentState => ({
      id,
      ...cohort.classification,
      age: distribute(cohort.totals.age, cohort.residentIds.length, index),
      health: distribute(cohort.totals.health, cohort.residentIds.length, index),
      foodNeed: distribute(cohort.totals.foodNeed, cohort.residentIds.length, index),
      waterNeed: distribute(cohort.totals.waterNeed, cohort.residentIds.length, index),
      safety: distribute(cohort.totals.safety, cohort.residentIds.length, index),
      skill: distribute(cohort.totals.skill, cohort.residentIds.length, index),
      importance: 0,
      nextUpdateTick: input.tick,
      updateCount: 0,
      rng: restoredResidentRngState(id),
      relationshipIds: [],
      familyIds: [],
      eventIds: [],
    })),
  ].sort((left, right) => left.id - right.id);
  const remainingIds = cohort.residentIds.slice(residentCount);
  const cohorts = input.cohorts
    .flatMap((candidate) =>
      candidate.id !== cohortId
        ? [candidate]
        : remainingIds.length === 0
          ? []
          : [
              {
                ...candidate,
                residentIds: remainingIds,
                totals: subtractTotals(candidate.totals, restoredTotals),
              },
            ],
    )
    .sort((left, right) => left.id - right.id);
  const transfers = appendTransfer(input, {
    tick: input.tick,
    kind: 'deaggregated',
    cohortId,
    residentCount,
    firstResidentId: selectedIds[0]!,
    lastResidentId: selectedIds.at(-1)!,
    totals: restoredTotals,
  });
  const state: PopulationScaleState = {
    ...input,
    nextTransferId: input.nextTransferId + 1,
    detailedResidents,
    cohorts,
    transfers,
    backlog: normalizeBacklog(input.tick, detailedResidents, cohorts),
  };
  assertPopulationScaleInvariants(state);
  return state;
}

/** A plain, sorted, serialization-safe DTO used by snapshots and canonical hashing. */
export function populationScaleDto(state: PopulationScaleState): PopulationScaleState {
  assertPopulationScaleInvariants(state);
  return {
    ...state,
    rng: [...state.rng] as Xoshiro128State,
    detailedResidents: state.detailedResidents.map((resident) => ({
      ...resident,
      rng: [...resident.rng] as Xoshiro128State,
      relationshipIds: [...resident.relationshipIds],
      familyIds: [...resident.familyIds],
      eventIds: [...resident.eventIds],
    })),
    cohorts: state.cohorts.map((cohort) => ({
      ...cohort,
      classification: { ...cohort.classification },
      residentIds: [...cohort.residentIds],
      totals: { ...cohort.totals },
    })),
    transfers: state.transfers.map((transfer) => ({ ...transfer, totals: { ...transfer.totals } })),
    backlog: { ...state.backlog },
  };
}
