import { Xoshiro128StarStar, type Xoshiro128State } from '../random';

/** M8's camera-independent detailed and aggregate population authority. */
export const MAX_DETAILED_RESIDENTS = 5_000;
export const MAX_AGGREGATE_RESIDENTS = 100_000;
export const MAX_SCALE_COHORTS = 256;
export const MAX_SCALE_COHORT_RESIDENTS = 1_000;
export const MAX_SCALE_TRANSFER_DELTAS = 256;
export const MAX_SCALE_WORK_PER_TICK = 128;
export const MAX_LOD_TRANSFERS_PER_RECONCILE = 1;
export const DETAILED_UPDATE_PERIOD_TICKS = 64;
export const AGGREGATE_UPDATE_PERIOD_TICKS = 16;
export const MAX_SOCIAL_REFERENCE_IDS = 24;
export const MAX_FAMILY_REFERENCE_IDS = 16;
export const MAX_EVENT_REFERENCE_IDS = 16;
export const MAX_SCALE_BACKLOG = MAX_DETAILED_RESIDENTS + MAX_SCALE_COHORTS;
/** Disjoint from v1's bounded named-person IDs; persisted allocation prevents identity reuse. */
export const FIRST_ORDINARY_RESIDENT_ID = 1_000_000_000;

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
  /** Zero is reserved for anonymous settlement-level provenance, never a named household. */
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
  /** Persisted member cursor; independent of cadence so every resident is eventually sampled. */
  readonly promotionCursor: number;
}

export interface ScaleTransferDelta {
  readonly id: number;
  readonly tick: number;
  readonly kind: 'aggregated' | 'deaggregated' | 'materialized' | 'removed';
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
  readonly nextResidentId: number;
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

export interface AnonymousPopulationTarget {
  readonly settlementId: number;
  readonly civilizationId: number;
  readonly cultureId: number;
  readonly tileIndex: number;
  readonly residentCount: number;
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
  assertNonNegativeInteger(classification.householdId, 'classification.householdId');
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

function advanceRngState(rng: Xoshiro128State, steps: number): Xoshiro128State {
  const random = new Xoshiro128StarStar(rng);
  for (let index = 0; index < steps; index += 1) random.nextUint32();
  return random.save();
}

function nextScheduledTick(state: PopulationScaleState): number {
  let next = Number.MAX_SAFE_INTEGER;
  for (const resident of state.detailedResidents) next = Math.min(next, resident.nextUpdateTick);
  for (const cohort of state.cohorts) next = Math.min(next, cohort.nextUpdateTick);
  return next;
}

function restoredResidentRngState(id: number): Xoshiro128State {
  return [id >>> 0, (id ^ 0x9e3779b9) >>> 0, (id ^ 0x243f6a88) >>> 0, (id ^ 0xb7e15162) >>> 0];
}

function assertPopulationScaleInvariantsWithCohortLimit(
  state: PopulationScaleState,
  maximumCohortResidents: number,
): void {
  assertNonNegativeInteger(state.tick, 'tick');
  assertPositiveId(state.nextResidentId, 'nextResidentId');
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
    sortedUnique(cohort.residentIds, 'cohort.residentIds', maximumCohortResidents);
    for (const id of cohort.residentIds) {
      if (residentIds.has(id))
        throw new RangeError('Resident identity appears in detail and aggregate state.');
      residentIds.add(id);
    }
    aggregateResidentCount += cohort.residentIds.length;
    assertNonNegativeInteger(cohort.householdCount, 'cohort.householdCount');
    const expectedHouseholdCount = cohort.classification.householdId === 0 ? 0 : 1;
    if (cohort.householdCount !== expectedHouseholdCount)
      throw new RangeError('A cohort household count must match its provenance classification.');
    assertTotals(cohort.totals, 'cohort.totals');
    assertNonNegativeInteger(cohort.nextUpdateTick, 'cohort.nextUpdateTick');
    assertNonNegativeInteger(cohort.updateCount, 'cohort.updateCount');
    assertNonNegativeInteger(cohort.promotionCursor, 'cohort.promotionCursor');
  }
  if (state.nextCohortId <= previousCohortId) {
    throw new RangeError('nextCohortId must exceed every retained cohort ID.');
  }
  if (aggregateResidentCount > MAX_AGGREGATE_RESIDENTS) {
    throw new RangeError('Aggregate resident capacity exceeded.');
  }
  if (state.nextResidentId < FIRST_ORDINARY_RESIDENT_ID) {
    throw new RangeError('nextResidentId must remain in the ordinary-resident identity range.');
  }
  if ([...residentIds].some((id) => id >= state.nextResidentId)) {
    throw new RangeError('nextResidentId must exceed every allocated ordinary resident ID.');
  }

  let previousTransferId = 0;
  for (const transfer of state.transfers) {
    assertPositiveId(transfer.id, 'transfer.id');
    if (transfer.id <= previousTransferId)
      throw new RangeError('Transfer deltas must be ID sorted.');
    previousTransferId = transfer.id;
    assertNonNegativeInteger(transfer.tick, 'transfer.tick');
    if (
      transfer.kind !== 'aggregated' &&
      transfer.kind !== 'deaggregated' &&
      transfer.kind !== 'materialized' &&
      transfer.kind !== 'removed'
    ) {
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

export function assertPopulationScaleInvariants(state: PopulationScaleState): void {
  assertPopulationScaleInvariantsWithCohortLimit(state, MAX_SCALE_COHORT_RESIDENTS);
}

/** Validates the retired v8 shape before its one-way split and provenance migration. */
export function assertVersionEightPopulationScaleInvariants(state: PopulationScaleState): void {
  assertPopulationScaleInvariantsWithCohortLimit(state, MAX_AGGREGATE_RESIDENTS);
}

export function createPopulationScale(
  rng: Xoshiro128State,
  tick: number,
  initialization: PopulationScaleInitialization,
): PopulationScaleState {
  const provisional: PopulationScaleState = {
    tick,
    nextResidentId: Math.max(
      FIRST_ORDINARY_RESIDENT_ID,
      ...initialization.detailedResidents.map((resident) => resident.id + 1),
      ...(initialization.cohorts?.flatMap((cohort) =>
        cohort.residentIds.map((residentId) => residentId + 1),
      ) ?? []),
    ),
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
  const endingTick = state.tick + logicalTicks;
  while (state.tick < endingTick) {
    const scheduledTick = nextScheduledTick(state);
    const tick = Math.min(endingTick, Math.max(state.tick + 1, scheduledTick));
    const rng = advanceRngState(state.rng, tick - state.tick);
    const due = [
      ...state.detailedResidents
        .filter((resident) => resident.nextUpdateTick <= tick)
        .map((resident) => ({
          kind: 'detail' as const,
          id: resident.id,
          scheduledTick: resident.nextUpdateTick,
        })),
      ...state.cohorts
        .filter((cohort) => cohort.nextUpdateTick <= tick)
        .map((cohort) => ({
          kind: 'cohort' as const,
          id: cohort.id,
          scheduledTick: cohort.nextUpdateTick,
        })),
    ].sort(
      (left, right) =>
        left.scheduledTick - right.scheduledTick ||
        left.id - right.id ||
        (left.kind === right.kind ? 0 : left.kind === 'detail' ? -1 : 1),
    );
    if (due.length === 0) {
      state = { ...state, tick, rng };
      continue;
    }
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
    state = {
      ...state,
      tick,
      rng,
      detailedResidents,
      cohorts,
      backlog: normalizeBacklog(tick, detailedResidents, cohorts),
      operationCount: state.operationCount + selected.length,
    };
  }
  assertPopulationScaleInvariants(state);
  return state;
}

function aggregateResidentsUnchecked(
  input: PopulationScaleState,
  residentIds: readonly number[],
): PopulationScaleState {
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
  if (residentIds.length > MAX_SCALE_COHORT_RESIDENTS)
    throw new RangeError('Aggregation exceeds the bounded cohort size.');
  const existingCohort = input.cohorts
    .filter(
      (cohort) =>
        sameClassification(cohort.classification, classification) &&
        cohort.residentIds.length + residentIds.length <= MAX_SCALE_COHORT_RESIDENTS,
    )
    .sort(
      (left, right) => left.residentIds.length - right.residentIds.length || left.id - right.id,
    )[0];
  if (existingCohort === undefined && input.cohorts.length >= MAX_SCALE_COHORTS)
    throw new RangeError('Scale cohort capacity exceeded.');
  const selectedTotals = totalsForResidents(selected);
  const cohort: AggregateCohortState =
    existingCohort === undefined
      ? {
          id: input.nextCohortId,
          classification,
          residentIds: [...residentIds],
          householdCount: classification.householdId === 0 ? 0 : 1,
          totals: selectedTotals,
          nextUpdateTick: input.tick,
          updateCount: 0,
          promotionCursor: 0,
        }
      : {
          ...existingCohort,
          residentIds: [...existingCohort.residentIds, ...residentIds].sort(
            (left, right) => left - right,
          ),
          totals: addTotals(existingCohort.totals, selectedTotals),
        };
  const detailedResidents = input.detailedResidents.filter(
    (resident) => !selectedIds.has(resident.id),
  );
  const cohorts =
    existingCohort === undefined
      ? [...input.cohorts, cohort].sort((left, right) => left.id - right.id)
      : input.cohorts.map((candidate) => (candidate.id === cohort.id ? cohort : candidate));
  const transfers = appendTransfer(input, {
    tick: input.tick,
    kind: 'aggregated',
    cohortId: cohort.id,
    residentCount: residentIds.length,
    firstResidentId: residentIds[0]!,
    lastResidentId: residentIds.at(-1)!,
    totals: selectedTotals,
  });
  const state: PopulationScaleState = {
    ...input,
    nextCohortId:
      existingCohort === undefined
        ? Math.max(input.nextCohortId, cohort.id + 1)
        : input.nextCohortId,
    nextTransferId: input.nextTransferId + 1,
    detailedResidents,
    cohorts,
    transfers,
    backlog: normalizeBacklog(input.tick, detailedResidents, cohorts),
  };
  return state;
}

export function aggregateResidents(
  input: PopulationScaleState,
  residentIds: readonly number[],
): PopulationScaleState {
  assertPopulationScaleInvariants(input);
  const state = aggregateResidentsUnchecked(input, residentIds);
  assertPopulationScaleInvariants(state);
  return state;
}

function deaggregateResidents(
  input: PopulationScaleState,
  cohortId: number,
  selectedIds: readonly number[],
): PopulationScaleState {
  assertPositiveId(cohortId, 'cohortId');
  sortedUnique(selectedIds, 'selectedIds', MAX_DETAILED_RESIDENTS);
  if (selectedIds.length === 0) throw new RangeError('Deaggregation requires a resident.');
  const cohort = input.cohorts.find((candidate) => candidate.id === cohortId);
  if (!cohort) throw new RangeError('Unknown aggregate cohort.');
  const selectedSet = new Set(selectedIds);
  if (selectedIds.some((id) => !cohort.residentIds.includes(id)))
    throw new RangeError('Cannot deaggregate a resident outside the cohort.');
  if (input.detailedResidents.length + selectedIds.length > MAX_DETAILED_RESIDENTS) {
    throw new RangeError('Detailed resident capacity exceeded.');
  }
  const restoredTotals = { ...zeroTotals() };
  const restoredResidents: DetailedResidentState[] = [];
  const remainingIds: number[] = [];
  for (let index = 0; index < cohort.residentIds.length; index += 1) {
    const id = cohort.residentIds[index]!;
    if (!selectedSet.has(id)) {
      remainingIds.push(id);
      continue;
    }
    const totals = {
      age: distribute(cohort.totals.age, cohort.residentIds.length, index),
      health: distribute(cohort.totals.health, cohort.residentIds.length, index),
      foodNeed: distribute(cohort.totals.foodNeed, cohort.residentIds.length, index),
      waterNeed: distribute(cohort.totals.waterNeed, cohort.residentIds.length, index),
      safety: distribute(cohort.totals.safety, cohort.residentIds.length, index),
      skill: distribute(cohort.totals.skill, cohort.residentIds.length, index),
    };
    for (const key of TOTAL_KEYS) restoredTotals[key] += totals[key];
    restoredResidents.push({
      id,
      ...cohort.classification,
      ...totals,
      importance: 0,
      nextUpdateTick: input.tick,
      updateCount: 0,
      rng: restoredResidentRngState(id),
      relationshipIds: [],
      familyIds: [],
      eventIds: [],
    });
  }
  const detailedResidents = [...input.detailedResidents, ...restoredResidents].sort(
    (left, right) => left.id - right.id,
  );
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
                promotionCursor: candidate.promotionCursor + 1,
              },
            ],
    )
    .sort((left, right) => left.id - right.id);
  const transfers = appendTransfer(input, {
    tick: input.tick,
    kind: 'deaggregated',
    cohortId,
    residentCount: selectedIds.length,
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
  return state;
}

export function deaggregateCohort(
  input: PopulationScaleState,
  cohortId: number,
  residentCount: number,
): PopulationScaleState {
  assertPopulationScaleInvariants(input);
  assertPositiveId(residentCount, 'residentCount');
  const cohort = input.cohorts.find((candidate) => candidate.id === cohortId);
  if (!cohort) throw new RangeError('Unknown aggregate cohort.');
  if (residentCount > cohort.residentIds.length)
    throw new RangeError('Cannot deaggregate more residents than the cohort contains.');
  const state = deaggregateResidents(input, cohortId, cohort.residentIds.slice(0, residentCount));
  assertPopulationScaleInvariants(state);
  return state;
}

/**
 * Reconciles only population already owned by settlement authority but not represented by named
 * people. Zero household provenance explicitly means no household or relationship history was
 * inferred. The disjoint persisted allocator prevents future named births from colliding with
 * these stable ordinary identities.
 */
export function reconcileAnonymousPopulation(
  input: PopulationScaleState,
  targets: readonly AnonymousPopulationTarget[],
): PopulationScaleState {
  assertPopulationScaleInvariants(input);
  const orderedTargets = [...targets].sort((left, right) => left.settlementId - right.settlementId);
  for (let index = 0; index < orderedTargets.length; index += 1) {
    const target = orderedTargets[index]!;
    assertPositiveId(target.settlementId, 'anonymous target settlementId');
    assertPositiveId(target.civilizationId, 'anonymous target civilizationId');
    assertPositiveId(target.cultureId, 'anonymous target cultureId');
    assertNonNegativeInteger(target.tileIndex, 'anonymous target tileIndex');
    assertNonNegativeInteger(target.residentCount, 'anonymous target residentCount');
    if (index > 0 && orderedTargets[index - 1]!.settlementId === target.settlementId) {
      throw new RangeError('Anonymous population targets must have unique settlement IDs.');
    }
  }

  let state = input;
  const ordinaryDetailGroups = new Map<string, number[]>();
  for (const resident of state.detailedResidents) {
    if (resident.householdId !== 0) continue;
    if (isProtected(resident))
      throw new RangeError('Anonymous settlement population cannot retain salient references.');
    const classification = classificationFor(resident);
    const key = [
      classification.settlementId,
      classification.civilizationId,
      classification.cultureId,
      classification.tileIndex,
    ].join(':');
    const ids = ordinaryDetailGroups.get(key) ?? [];
    ids.push(resident.id);
    ordinaryDetailGroups.set(key, ids);
  }
  for (const ids of [...ordinaryDetailGroups.values()].sort(
    (left, right) => left[0]! - right[0]!,
  )) {
    state = aggregateResidentsUnchecked(state, ids);
  }

  const targetBySettlement = new Map(
    orderedTargets.map((target) => [target.settlementId, target] as const),
  );
  const reclassifiedCohorts = state.cohorts.map((cohort) => {
    if (cohort.classification.householdId !== 0) return cohort;
    const target = targetBySettlement.get(cohort.classification.settlementId);
    if (target === undefined) return cohort;
    return {
      ...cohort,
      classification: {
        settlementId: target.settlementId,
        civilizationId: target.civilizationId,
        cultureId: target.cultureId,
        householdId: 0,
        tileIndex: target.tileIndex,
      },
    };
  });
  if (reclassifiedCohorts.some((cohort, index) => cohort !== state.cohorts[index])) {
    state = {
      ...state,
      cohorts: reclassifiedCohorts,
      backlog: normalizeBacklog(state.tick, state.detailedResidents, reclassifiedCohorts),
    };
  }

  const allSettlementIds = [
    ...new Set([
      ...orderedTargets.map((target) => target.settlementId),
      ...state.cohorts
        .filter((cohort) => cohort.classification.householdId === 0)
        .map((cohort) => cohort.classification.settlementId),
    ]),
  ].sort((left, right) => left - right);
  for (const settlementId of allSettlementIds) {
    const target = targetBySettlement.get(settlementId);
    const targetCount = target?.residentCount ?? 0;
    let currentCount = state.cohorts
      .filter(
        (cohort) =>
          cohort.classification.householdId === 0 &&
          cohort.classification.settlementId === settlementId,
      )
      .reduce((total, cohort) => total + cohort.residentIds.length, 0);
    if (currentCount < targetCount) {
      if (target === undefined) throw new RangeError('Missing anonymous population target.');
      const addCount = targetCount - currentCount;
      const aggregateCount = state.cohorts.reduce(
        (total, cohort) => total + cohort.residentIds.length,
        0,
      );
      if (aggregateCount + addCount > MAX_AGGREGATE_RESIDENTS)
        throw new RangeError('Aggregate resident capacity exceeded.');
      if (state.nextResidentId + addCount - 1 > Number.MAX_SAFE_INTEGER)
        throw new RangeError('Ordinary resident identity range exhausted.');
      const classification: AggregateClassification = {
        settlementId: target.settlementId,
        civilizationId: target.civilizationId,
        cultureId: target.cultureId,
        householdId: 0,
        tileIndex: target.tileIndex,
      };
      let remainingToAdd = addCount;
      while (remainingToAdd > 0) {
        const existing = state.cohorts
          .filter(
            (cohort) =>
              sameClassification(cohort.classification, classification) &&
              cohort.residentIds.length < MAX_SCALE_COHORT_RESIDENTS,
          )
          .sort(
            (left, right) =>
              left.residentIds.length - right.residentIds.length || left.id - right.id,
          )[0];
        if (existing === undefined && state.cohorts.length >= MAX_SCALE_COHORTS)
          throw new RangeError('Scale cohort capacity exceeded.');
        const capacity = MAX_SCALE_COHORT_RESIDENTS - (existing?.residentIds.length ?? 0);
        const batchCount = Math.min(remainingToAdd, capacity);
        const residentIds = Array.from(
          { length: batchCount },
          (_, index) => state.nextResidentId + index,
        );
        const cohort: AggregateCohortState =
          existing === undefined
            ? {
                id: state.nextCohortId,
                classification,
                residentIds,
                householdCount: 0,
                totals: zeroTotals(),
                nextUpdateTick: state.tick,
                updateCount: 0,
                promotionCursor: 0,
              }
            : {
                ...existing,
                residentIds: [...existing.residentIds, ...residentIds],
              };
        const cohorts =
          existing === undefined
            ? [...state.cohorts, cohort].sort((left, right) => left.id - right.id)
            : state.cohorts.map((candidate) => (candidate.id === cohort.id ? cohort : candidate));
        const transfers = appendTransfer(state, {
          tick: state.tick,
          kind: 'materialized',
          cohortId: cohort.id,
          residentCount: residentIds.length,
          firstResidentId: residentIds[0]!,
          lastResidentId: residentIds.at(-1)!,
          totals: zeroTotals(),
        });
        state = {
          ...state,
          nextResidentId: state.nextResidentId + batchCount,
          nextCohortId: existing === undefined ? state.nextCohortId + 1 : state.nextCohortId,
          nextTransferId: state.nextTransferId + 1,
          cohorts,
          transfers,
          backlog: normalizeBacklog(state.tick, state.detailedResidents, cohorts),
        };
        remainingToAdd -= batchCount;
      }
      currentCount += addCount;
    }
    if (currentCount <= targetCount) continue;

    let removeCount = currentCount - targetCount;
    const candidateCohorts = state.cohorts
      .filter(
        (cohort) =>
          cohort.classification.householdId === 0 &&
          cohort.classification.settlementId === settlementId,
      )
      .sort((left, right) => right.id - left.id);
    for (const selectedCohort of candidateCohorts) {
      if (removeCount === 0) break;
      const cohort = state.cohorts.find((candidate) => candidate.id === selectedCohort.id);
      if (cohort === undefined) continue;
      const count = Math.min(removeCount, cohort.residentIds.length);
      const firstRemovedIndex = cohort.residentIds.length - count;
      const removedIds = cohort.residentIds.slice(firstRemovedIndex);
      const remainingIds = cohort.residentIds.slice(0, firstRemovedIndex);
      const removedTotals = TOTAL_KEYS.reduce<AggregateTotals>(
        (totals, key) => ({
          ...totals,
          [key]: removedIds.reduce(
            (sum, _id, offset) =>
              sum +
              distribute(cohort.totals[key], cohort.residentIds.length, firstRemovedIndex + offset),
            0,
          ),
        }),
        zeroTotals(),
      );
      const cohorts = state.cohorts.flatMap((candidate) =>
        candidate.id !== cohort.id
          ? [candidate]
          : remainingIds.length === 0
            ? []
            : [
                {
                  ...candidate,
                  residentIds: remainingIds,
                  totals: subtractTotals(candidate.totals, removedTotals),
                },
              ],
      );
      const transfers = appendTransfer(state, {
        tick: state.tick,
        kind: 'removed',
        cohortId: cohort.id,
        residentCount: removedIds.length,
        firstResidentId: removedIds[0]!,
        lastResidentId: removedIds.at(-1)!,
        totals: removedTotals,
      });
      state = {
        ...state,
        nextTransferId: state.nextTransferId + 1,
        cohorts,
        transfers,
        backlog: normalizeBacklog(state.tick, state.detailedResidents, cohorts),
      };
      removeCount -= count;
    }
    if (removeCount !== 0) throw new RangeError('Anonymous population reconciliation failed.');
  }
  assertPopulationScaleInvariants(state);
  return state;
}

/**
 * Transfers exact anonymous resident identities out of terrestrial population authority.
 * Callers must preselect stable IDs from household-zero cohorts; named, protected, or detailed
 * residents are deliberately ineligible. The persisted allocator never rewinds, so an exported
 * identity cannot be reused if terrestrial population later grows again.
 */
export function removeAnonymousResidents(
  input: PopulationScaleState,
  residentIds: readonly number[],
): PopulationScaleState {
  assertPopulationScaleInvariants(input);
  sortedUnique(residentIds, 'residentIds', MAX_SCALE_TRANSFER_DELTAS);
  if (residentIds.length === 0) return input;
  if (residentIds.some((residentId) => residentId < FIRST_ORDINARY_RESIDENT_ID)) {
    throw new RangeError('Only ordinary anonymous residents may leave terrestrial authority.');
  }

  const requested = new Set(residentIds);
  const cohortIdByResident = new Map<number, number>();
  for (const cohort of input.cohorts) {
    for (const residentId of cohort.residentIds) {
      if (!requested.has(residentId)) continue;
      if (cohort.classification.householdId !== 0) {
        throw new RangeError('Socially classified residents cannot leave as anonymous residents.');
      }
      cohortIdByResident.set(residentId, cohort.id);
    }
  }
  if (cohortIdByResident.size !== residentIds.length) {
    throw new RangeError('Anonymous resident transfer references an unavailable aggregate ID.');
  }

  const residentIdsByCohort = new Map<number, number[]>();
  for (const residentId of residentIds) {
    const cohortId = cohortIdByResident.get(residentId)!;
    const ids = residentIdsByCohort.get(cohortId) ?? [];
    ids.push(residentId);
    residentIdsByCohort.set(cohortId, ids);
  }

  let state = input;
  for (const cohortId of [...residentIdsByCohort.keys()].sort((left, right) => left - right)) {
    const cohort = state.cohorts.find((candidate) => candidate.id === cohortId);
    if (cohort === undefined) throw new RangeError('Anonymous resident cohort disappeared.');
    const removedIds = residentIdsByCohort.get(cohortId)!;
    const removed = new Set(removedIds);
    const removedTotals = TOTAL_KEYS.reduce<AggregateTotals>(
      (totals, key) => ({
        ...totals,
        [key]: cohort.residentIds.reduce(
          (sum, residentId, index) =>
            sum +
            (removed.has(residentId)
              ? distribute(cohort.totals[key], cohort.residentIds.length, index)
              : 0),
          0,
        ),
      }),
      zeroTotals(),
    );
    const remainingIds = cohort.residentIds.filter((residentId) => !removed.has(residentId));
    const cohorts = state.cohorts.flatMap((candidate) =>
      candidate.id !== cohortId
        ? [candidate]
        : remainingIds.length === 0
          ? []
          : [
              {
                ...candidate,
                residentIds: remainingIds,
                totals: subtractTotals(candidate.totals, removedTotals),
                promotionCursor: candidate.promotionCursor % Math.max(1, remainingIds.length),
              },
            ],
    );
    const transfers = appendTransfer(state, {
      tick: state.tick,
      kind: 'removed',
      cohortId,
      residentCount: removedIds.length,
      firstResidentId: removedIds[0]!,
      lastResidentId: removedIds.at(-1)!,
      totals: removedTotals,
    });
    state = {
      ...state,
      nextTransferId: state.nextTransferId + 1,
      cohorts,
      transfers,
      backlog: normalizeBacklog(state.tick, state.detailedResidents, cohorts),
    };
  }
  assertPopulationScaleInvariants(state);
  return state;
}

/**
 * Applies bounded, camera-independent production LOD. Updated ordinary detail records collapse
 * into classification cohorts; a rotating sample from mature cohorts is promoted for the next
 * detailed pulse. Persisted cohort update counts and the pulse ordinal are the only cursors.
 */
export function reconcilePopulationLod(
  input: PopulationScaleState,
  pulseOrdinal: number,
): PopulationScaleState {
  assertPopulationScaleInvariants(input);
  assertNonNegativeInteger(pulseOrdinal, 'pulseOrdinal');
  let state = input;
  const groups = new Map<string, number[]>();
  for (const resident of state.detailedResidents) {
    if (isProtected(resident) || resident.updateCount === 0) continue;
    const classification = classificationFor(resident);
    const key = [
      classification.settlementId,
      classification.civilizationId,
      classification.cultureId,
      classification.householdId,
      classification.tileIndex,
    ].join(':');
    const ids = groups.get(key) ?? [];
    ids.push(resident.id);
    groups.set(key, ids);
  }
  const orderedGroups = [...groups.values()].sort((left, right) => left[0]! - right[0]!);
  const aggregationStart =
    orderedGroups.length === 0
      ? 0
      : (pulseOrdinal * MAX_LOD_TRANSFERS_PER_RECONCILE) % orderedGroups.length;
  const selectedGroups = Array.from(
    { length: Math.min(MAX_LOD_TRANSFERS_PER_RECONCILE, orderedGroups.length) },
    (_, index) => orderedGroups[(aggregationStart + index) % orderedGroups.length]!,
  );
  for (const group of selectedGroups) {
    const residentIds = group.slice(0, MAX_SCALE_COHORT_RESIDENTS);
    const resident = state.detailedResidents.find((candidate) => candidate.id === residentIds[0]);
    if (resident === undefined) continue;
    const hasMatchingCohort = state.cohorts.some((cohort) =>
      sameClassification(cohort.classification, classificationFor(resident)),
    );
    if (!hasMatchingCohort && state.cohorts.length >= MAX_SCALE_COHORTS) continue;
    const aggregatePopulation = state.cohorts.reduce(
      (total, cohort) => total + cohort.residentIds.length,
      0,
    );
    if (aggregatePopulation + residentIds.length > MAX_AGGREGATE_RESIDENTS) continue;
    state = aggregateResidentsUnchecked(state, residentIds);
  }

  const promotable = state.cohorts.filter((cohort) => cohort.updateCount > 0);
  if (promotable.length === 0) {
    assertPopulationScaleInvariants(state);
    return state;
  }
  const promotionCount = Math.min(
    MAX_LOD_TRANSFERS_PER_RECONCILE,
    promotable.length,
    MAX_DETAILED_RESIDENTS - state.detailedResidents.length,
  );
  if (promotionCount === 0) {
    assertPopulationScaleInvariants(state);
    return state;
  }
  const start = (pulseOrdinal * MAX_LOD_TRANSFERS_PER_RECONCILE) % promotable.length;
  const selected = Array.from(
    { length: promotionCount },
    (_, index) => promotable[(start + index) % promotable.length]!,
  );
  for (const selectedCohort of selected) {
    const cohort = state.cohorts.find((candidate) => candidate.id === selectedCohort.id);
    if (cohort === undefined || cohort.residentIds.length === 0) continue;
    const residentId = cohort.residentIds[cohort.promotionCursor % cohort.residentIds.length]!;
    state = deaggregateResidents(state, cohort.id, [residentId]);
  }
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
