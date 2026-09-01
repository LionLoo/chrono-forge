import { deriveXoshiro128State, Xoshiro128StarStar, type Xoshiro128State } from '../random';

/** M6 is deliberately an annual, world-owned authority. World orchestration owns all patches. */
export const MAX_ACTIVE_SETTLEMENTS = 8;
export const MAX_ACTIVE_CIVILIZATIONS = 8;
export const MAX_HISTORICAL_COMMUNITIES = 24;
export const MAX_FOUNDING_SITE_SAMPLES = 64;
export const MAX_DIPLOMACY_PAIRS = 28;
export const MAX_ROUTE_EVALUATIONS = 16;
export const MAX_MIGRATION_CHOICES = 8;
export const MAX_ACTIVE_CONFLICTS = 4;
export const MAX_CIVILIZATION_EVENTS = 32;
export const MAX_ACTIVE_ROUTES = 16;
export const MAX_ROUTE_CONFLICT_SUMMARIES = 32;
export const MAX_RUINS = 24;
export const MAX_TERRITORY_HISTORY_PER_SETTLEMENT = 64;
export const MAX_PROJECTED_RESIDENCIES = 128;

const MARKET_RESOURCES = Object.freeze(['food', 'water', 'timber', 'stone', 'metal'] as const);

export type SettlementStatus = 'active' | 'abandoned' | 'conquered';
export type CivilizationStatus = 'independent' | 'federated' | 'fragmented' | 'collapsed';
export type DiplomacyStatus = 'neutral' | 'allied' | 'rival' | 'at-war';
export type ConflictStatus = 'active' | 'resolved';
export type ResidencySubjectKind = 'person' | 'household';

export interface CommunityReserves {
  readonly food: number;
  readonly water: number;
  readonly timber: number;
  readonly stone: number;
  readonly metal: number;
}

export interface FoundingReserveDelta {
  readonly food: number;
  readonly water: number;
  readonly timber: number;
  readonly stone: number;
  readonly metal: number;
}

export interface TerritoryHistoryRecord {
  readonly id: number;
  readonly tick: number;
  readonly tileIndex: number;
  readonly previousSettlementId: number;
  readonly nextSettlementId: number;
}

export interface Settlement {
  readonly id: number;
  readonly civilizationId: number;
  readonly name: string;
  readonly cultureId: number;
  readonly centerTileIndex: number;
  readonly status: SettlementStatus;
  readonly population: number;
  readonly stability: number;
  readonly reserves: CommunityReserves;
  readonly territoryHistory: readonly TerritoryHistoryRecord[];
  readonly territoryHistorySummaryCount: number;
  readonly foundedTick: number;
  readonly endedTick: number | null;
  readonly provenance: 'initial' | 'v5-migration' | 'm6-founding';
}

export interface Civilization {
  readonly id: number;
  readonly name: string;
  readonly cultureId: number;
  readonly status: CivilizationStatus;
  readonly foundingSettlementId: number;
  readonly memberSettlementIds: readonly number[];
  readonly foundedTick: number;
  readonly endedTick: number | null;
  readonly provenance: 'initial' | 'v5-migration' | 'm6-founding';
}

export interface Residency {
  readonly id: number;
  readonly subjectKind: ResidencySubjectKind;
  readonly subjectId: number;
  readonly settlementId: number;
  readonly startedTick: number;
  readonly endedTick: number | null;
}

export interface DiplomacyRelation {
  readonly id: number;
  readonly firstCivilizationId: number;
  readonly secondCivilizationId: number;
  readonly status: DiplomacyStatus;
  readonly score: number;
  readonly changedTick: number;
}

export interface TradeRoute {
  readonly id: number;
  readonly firstSettlementId: number;
  readonly secondSettlementId: number;
  readonly status: 'active' | 'disrupted' | 'ended';
  readonly volume: number;
  readonly startedTick: number;
  readonly endedTick: number | null;
}

export interface Conflict {
  readonly id: number;
  readonly attackerCivilizationId: number;
  readonly defenderCivilizationId: number;
  readonly status: ConflictStatus;
  readonly pressure: number;
  readonly startedTick: number;
  readonly endedTick: number | null;
  readonly winnerCivilizationId: number | null;
}

export interface Ruin {
  readonly id: number;
  readonly settlementId: number;
  readonly createdTick: number;
  readonly cause: 'abandoned' | 'conquered' | 'collapse';
}

export interface CivilizationsState {
  readonly tick: number;
  /** One allocator makes identities unique even across entity categories. */
  readonly nextEntityId: number;
  readonly rng: Xoshiro128State;
  readonly settlements: readonly Settlement[];
  readonly civilizations: readonly Civilization[];
  readonly residencies: readonly Residency[];
  readonly diplomacy: readonly DiplomacyRelation[];
  readonly routes: readonly TradeRoute[];
  readonly conflicts: readonly Conflict[];
  readonly ruins: readonly Ruin[];
  /** Zero is unclaimed; every nonzero value is a current settlement ID. */
  readonly tileOwners: readonly number[];
  readonly operationCount: number;
}

export interface CivilizationsInitialization {
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly settlementName: string;
  readonly civilizationName: string;
  readonly centerTileIndex: number;
  readonly cultureId: number;
  readonly personIds: readonly number[];
  readonly householdIds: readonly number[];
  readonly reserves: CommunityReserves;
  readonly stability: number;
}

export interface CivilizationEventDraft {
  readonly kind:
    | 'settlement-founded'
    | 'route-established'
    | 'route-disrupted'
    | 'route-restored'
    | 'diplomacy-changed'
    | 'conflict-started'
    | 'conflict-resolved'
    | 'refugees-relocated'
    | 'settlement-ruined'
    | 'federation-formed'
    | 'civilization-fragmented'
    | 'territory-changed'
    | 'territory-history-summarized';
  readonly subjectId: number;
  readonly targetId: number;
  readonly tick: number;
  readonly amount: number;
  readonly summary: string;
}

export interface FoundingCandidate {
  readonly name: string;
  readonly civilizationName: string;
  readonly cultureId: number;
  readonly centerTileIndex: number;
  readonly siteScore: number;
  readonly personIds: readonly number[];
  readonly householdIds: readonly number[];
  readonly reserveTransfer: CommunityReserves;
  readonly stability: number;
}

export interface CommunityEconomyInput {
  readonly settlementId: number;
  readonly production: CommunityReserves;
  readonly consumption: CommunityReserves;
  readonly stabilityDelta: number;
}

export interface RouteCandidate {
  readonly firstSettlementId: number;
  readonly secondSettlementId: number;
  readonly utility: number;
  readonly volume: number;
}

export interface DiplomacyCandidate {
  readonly firstCivilizationId: number;
  readonly secondCivilizationId: number;
  readonly score: number;
}

export interface ConflictCandidate {
  readonly attackerCivilizationId: number;
  readonly defenderCivilizationId: number;
  readonly pressure: number;
}

export interface ConflictResolutionInput {
  readonly conflictId: number;
  readonly winnerCivilizationId: number;
}

export interface TerritoryChangeInput {
  readonly tileIndex: number;
  readonly nextSettlementId: number;
}

export interface ResidencyTransferInput {
  readonly fromSettlementId: number;
  readonly toSettlementId: number;
  readonly personIds: readonly number[];
  readonly householdIds: readonly number[];
  readonly reason: 'refugee' | 'migration';
}

export interface CivilizationsContext {
  readonly tick: number;
  readonly yearTicks: number;
  readonly foundingReserveAvailable: CommunityReserves;
  readonly foundingCandidates: readonly FoundingCandidate[];
  readonly economies: readonly CommunityEconomyInput[];
  readonly routeCandidates: readonly RouteCandidate[];
  readonly diplomacyCandidates: readonly DiplomacyCandidate[];
  readonly conflictCandidates: readonly ConflictCandidate[];
  readonly conflictResolutions: readonly ConflictResolutionInput[];
  readonly residencyTransfers: readonly ResidencyTransferInput[];
  readonly ruinSettlementIds: readonly number[];
  readonly federationCivilizationIds: readonly number[];
  readonly fragmentationCivilizationIds: readonly number[];
  readonly territoryChanges: readonly TerritoryChangeInput[];
}

/** All relationship inputs are pre-indexed by the caller; this layer never scans every pair. */
export interface IndexedRelationshipChoice {
  readonly id: number;
  readonly baseUtility: number;
  readonly relationshipDecisionInfluence: number;
}

export interface CoMigrationChoice extends IndexedRelationshipChoice {
  readonly personId: number;
}

export interface RefugeeSupportChoice extends IndexedRelationshipChoice {
  readonly settlementId: number;
}

export interface PoliticalSupportChoice extends IndexedRelationshipChoice {
  readonly civilizationId: number;
}

export interface ConflictChoice extends IndexedRelationshipChoice {
  readonly civilizationId: number;
}

export interface CivilizationAdvanceResult {
  readonly state: CivilizationsState;
  readonly events: readonly CivilizationEventDraft[];
  /** Applied exactly once by the founding settlement owner; it is never applied inside this module. */
  readonly foundingReserveDelta: FoundingReserveDelta;
}

function frozen<T>(value: T): T {
  return Object.freeze(value);
}

function sorted<T>(values: readonly T[], compare: (left: T, right: T) => number): readonly T[] {
  return Object.freeze([...values].sort(compare));
}

function compareNumber(left: number, right: number): number {
  return left - right;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateInteger(
  value: number,
  label: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(`${label} must be an integer in range.`);
}

function validatePercent(value: number, label: string): void {
  validateInteger(value, label, 0, 100);
}

function validateName(value: string, label: string): void {
  if (value.length < 1 || value.length > 80) throw new Error(`${label} must be bounded text.`);
}

function freezeReserves(value: CommunityReserves): CommunityReserves {
  validateInteger(value.food, 'Reserve food');
  validateInteger(value.water, 'Reserve water');
  validateInteger(value.timber, 'Reserve timber');
  validateInteger(value.stone, 'Reserve stone');
  validateInteger(value.metal, 'Reserve metal');
  return frozen({ ...value });
}

function addReserves(first: CommunityReserves, second: CommunityReserves): CommunityReserves {
  return freezeReserves({
    food: first.food + second.food,
    water: first.water + second.water,
    timber: first.timber + second.timber,
    stone: first.stone + second.stone,
    metal: first.metal + second.metal,
  });
}

function subtractReserves(first: CommunityReserves, second: CommunityReserves): CommunityReserves {
  return freezeReserves({
    food: Math.max(0, first.food - second.food),
    water: Math.max(0, first.water - second.water),
    timber: Math.max(0, first.timber - second.timber),
    stone: Math.max(0, first.stone - second.stone),
    metal: Math.max(0, first.metal - second.metal),
  });
}

function negativeReserves(value: CommunityReserves): FoundingReserveDelta {
  return frozen({
    food: -value.food,
    water: -value.water,
    timber: -value.timber,
    stone: -value.stone,
    metal: -value.metal,
  });
}

function emptyReserveDelta(): FoundingReserveDelta {
  return frozen({ food: 0, water: 0, timber: 0, stone: 0, metal: 0 });
}

function addReserveDelta(
  first: FoundingReserveDelta,
  second: FoundingReserveDelta,
): FoundingReserveDelta {
  return frozen({
    food: first.food + second.food,
    water: first.water + second.water,
    timber: first.timber + second.timber,
    stone: first.stone + second.stone,
    metal: first.metal + second.metal,
  });
}

function reserveFits(available: CommunityReserves, requested: CommunityReserves): boolean {
  return (
    requested.food <= available.food &&
    requested.water <= available.water &&
    requested.timber <= available.timber &&
    requested.stone <= available.stone &&
    requested.metal <= available.metal
  );
}

function pair(firstId: number, secondId: number): readonly [number, number] {
  if (firstId === secondId) throw new Error('Civilization pair cannot self-reference.');
  return firstId < secondId ? [firstId, secondId] : [secondId, firstId];
}

function pairKey(firstId: number, secondId: number): string {
  const [first, second] = pair(firstId, secondId);
  return `${first}:${second}`;
}

function event(
  kind: CivilizationEventDraft['kind'],
  subjectId: number,
  targetId: number,
  tick: number,
  amount: number,
  summary: string,
): CivilizationEventDraft {
  if (summary.length > 160)
    throw new Error('Civilization factual summary exceeds the event bound.');
  return frozen({ kind, subjectId, targetId, tick, amount, summary });
}

function validateInitialization(input: CivilizationsInitialization): void {
  validateInteger(input.worldWidth, 'Civilization world width', 1);
  validateInteger(input.worldHeight, 'Civilization world height', 1);
  validateName(input.settlementName, 'Settlement name');
  validateName(input.civilizationName, 'Civilization name');
  validateInteger(
    input.centerTileIndex,
    'Settlement center tile',
    0,
    input.worldWidth * input.worldHeight - 1,
  );
  validateInteger(input.cultureId, 'Settlement culture', 1);
  validatePercent(input.stability, 'Settlement stability');
  freezeReserves(input.reserves);
  for (const ids of [input.personIds, input.householdIds]) {
    const seen = new Set<number>();
    for (const id of ids) {
      validateInteger(id, 'Residency subject id', 1);
      if (seen.has(id)) throw new Error('Initialization residency subject ids must be unique.');
      seen.add(id);
    }
  }
}

function createBaseline(
  seed: Xoshiro128State,
  tick: number,
  input: CivilizationsInitialization,
  provenance: 'initial' | 'v5-migration',
): CivilizationsState {
  validateInteger(tick, 'Civilizations tick');
  validateInitialization(input);
  const settlementId = 1;
  const civilizationId = 2;
  let nextEntityId = 3;
  const residencies: Residency[] = [];
  for (const [subjectKind, ids] of [
    ['person', input.personIds] as const,
    ['household', input.householdIds] as const,
  ]) {
    for (const subjectId of [...ids].sort(compareNumber)) {
      residencies.push(
        frozen({
          id: nextEntityId,
          subjectKind,
          subjectId,
          settlementId,
          startedTick: tick,
          endedTick: null,
        }),
      );
      nextEntityId += 1;
    }
  }
  const tileOwners = Array.from({ length: input.worldWidth * input.worldHeight }, () => 0);
  tileOwners[input.centerTileIndex] = settlementId;
  const state: CivilizationsState = frozen({
    tick,
    nextEntityId,
    rng: deriveXoshiro128State(seed, 'civilizations'),
    settlements: Object.freeze([
      frozen<Settlement>({
        id: settlementId,
        civilizationId,
        name: input.settlementName,
        cultureId: input.cultureId,
        centerTileIndex: input.centerTileIndex,
        status: 'active',
        population: input.personIds.length,
        stability: input.stability,
        reserves: freezeReserves(input.reserves),
        territoryHistory: Object.freeze([]),
        territoryHistorySummaryCount: 0,
        foundedTick: tick,
        endedTick: null,
        provenance,
      }),
    ]),
    civilizations: Object.freeze([
      frozen<Civilization>({
        id: civilizationId,
        name: input.civilizationName,
        cultureId: input.cultureId,
        status: 'independent',
        foundingSettlementId: settlementId,
        memberSettlementIds: Object.freeze([settlementId]),
        foundedTick: tick,
        endedTick: null,
        provenance,
      }),
    ]),
    residencies: sorted(residencies, (left, right) => left.id - right.id),
    diplomacy: Object.freeze([]),
    routes: Object.freeze([]),
    conflicts: Object.freeze([]),
    ruins: Object.freeze([]),
    tileOwners: Object.freeze(tileOwners),
    operationCount: 0,
  });
  assertCivilizationsInvariants(state);
  return state;
}

/** Creates the in-world initial baseline without any M6 historical claim. */
export function createInitialCivilizations(
  seed: Xoshiro128State,
  tick: number,
  input: CivilizationsInitialization,
): CivilizationsState {
  return createBaseline(seed, tick, input, 'initial');
}

/** v5 migration is conservative: one labelled settlement/civilization and no M6 history. */
export function migrateSingleSettlementCivilizations(
  seed: Xoshiro128State,
  tick: number,
  input: CivilizationsInitialization,
): CivilizationsState {
  return createBaseline(seed, tick, input, 'v5-migration');
}

function activeSettlements(state: CivilizationsState): readonly Settlement[] {
  return state.settlements.filter((settlement) => settlement.status === 'active');
}

function activeCivilizations(state: CivilizationsState): readonly Civilization[] {
  return state.civilizations.filter((civilization) => civilization.endedTick === null);
}

function activeRoutePairKeys(state: CivilizationsState): Set<string> {
  return new Set(
    state.routes
      .filter((route) => route.status !== 'ended')
      .map((route) => pairKey(route.firstSettlementId, route.secondSettlementId)),
  );
}

interface MarketTransfer {
  readonly donorSettlementId: number;
  readonly recipientSettlementId: number;
  readonly resource: (typeof MARKET_RESOURCES)[number];
  readonly amount: number;
}

/**
 * Route volume is the maximum total annual exchange. The route settles the
 * largest relative shortages first, with resource order as the final tie
 * breaker. Transfers only rebalance goods that already exist in a community.
 */
function marketTransfers(
  first: Settlement,
  second: Settlement,
  volume: number,
): readonly MarketTransfer[] {
  let remainingVolume = volume;
  const candidates = MARKET_RESOURCES.map((resource, resourceOrder) => {
    const difference = first.reserves[resource] - second.reserves[resource];
    return {
      donorSettlementId: difference > 0 ? first.id : second.id,
      recipientSettlementId: difference > 0 ? second.id : first.id,
      resource,
      resourceOrder,
      transferable: Math.floor(Math.abs(difference) / 2),
    };
  })
    .filter((candidate) => candidate.transferable > 0)
    .sort(
      (left, right) =>
        right.transferable - left.transferable || left.resourceOrder - right.resourceOrder,
    );
  const transfers: MarketTransfer[] = [];
  for (const candidate of candidates) {
    if (remainingVolume === 0) break;
    const amount = Math.min(remainingVolume, candidate.transferable);
    transfers.push(
      frozen({
        donorSettlementId: candidate.donorSettlementId,
        recipientSettlementId: candidate.recipientSettlementId,
        resource: candidate.resource,
        amount,
      }),
    );
    remainingVolume -= amount;
  }
  return Object.freeze(transfers);
}

function applyMarketExchange(settlements: Settlement[], route: TradeRoute): number {
  if (route.status !== 'active' || route.volume === 0) return 0;
  const firstIndex = settlements.findIndex(
    (settlement) => settlement.id === route.firstSettlementId,
  );
  const secondIndex = settlements.findIndex(
    (settlement) => settlement.id === route.secondSettlementId,
  );
  const first = settlements[firstIndex];
  const second = settlements[secondIndex];
  if (
    first === undefined ||
    second === undefined ||
    first.status !== 'active' ||
    second.status !== 'active'
  )
    return 0;

  const transfers = marketTransfers(first, second, route.volume);
  for (const transfer of transfers) {
    const donorIndex = settlements.findIndex(
      (settlement) => settlement.id === transfer.donorSettlementId,
    );
    const recipientIndex = settlements.findIndex(
      (settlement) => settlement.id === transfer.recipientSettlementId,
    );
    const donor = settlements[donorIndex];
    const recipient = settlements[recipientIndex];
    if (donor === undefined || recipient === undefined)
      throw new Error('Market transfer references an unknown settlement.');
    settlements[donorIndex] = frozen({
      ...donor,
      reserves: freezeReserves({
        ...donor.reserves,
        [transfer.resource]: donor.reserves[transfer.resource] - transfer.amount,
      }),
    });
    settlements[recipientIndex] = frozen({
      ...recipient,
      reserves: freezeReserves({
        ...recipient.reserves,
        [transfer.resource]: recipient.reserves[transfer.resource] + transfer.amount,
      }),
    });
  }
  return transfers.length;
}

function validateContext(state: CivilizationsState, context: CivilizationsContext): void {
  if (!Number.isSafeInteger(context.tick) || context.tick <= state.tick)
    throw new Error('Civilization annual context tick must advance state.');
  validateInteger(context.yearTicks, 'Civilization annual year ticks', 1);
  freezeReserves(context.foundingReserveAvailable);
  if (
    context.foundingCandidates.length > MAX_FOUNDING_SITE_SAMPLES ||
    context.routeCandidates.length > MAX_ROUTE_EVALUATIONS ||
    context.diplomacyCandidates.length > MAX_DIPLOMACY_PAIRS ||
    context.conflictCandidates.length > MAX_ACTIVE_CONFLICTS ||
    context.residencyTransfers.length > MAX_MIGRATION_CHOICES ||
    context.territoryChanges.length > MAX_TERRITORY_HISTORY_PER_SETTLEMENT
  )
    throw new Error('Civilization annual candidate cap exceeded.');
  const ids = new Set<number>();
  for (const settlement of state.settlements) ids.add(settlement.id);
  const civilizationIds = new Set(state.civilizations.map((civilization) => civilization.id));
  for (const candidate of context.foundingCandidates) {
    validateName(candidate.name, 'Founding settlement name');
    validateName(candidate.civilizationName, 'Founding civilization name');
    validateInteger(candidate.cultureId, 'Founding culture id', 1);
    validateInteger(
      candidate.centerTileIndex,
      'Founding center tile',
      0,
      state.tileOwners.length - 1,
    );
    validateInteger(candidate.siteScore, 'Founding site score');
    validatePercent(candidate.stability, 'Founding stability');
    freezeReserves(candidate.reserveTransfer);
    for (const personId of candidate.personIds) validateInteger(personId, 'Founding person id', 1);
    for (const householdId of candidate.householdIds)
      validateInteger(householdId, 'Founding household id', 1);
  }
  for (const economy of context.economies) {
    if (!ids.has(economy.settlementId))
      throw new Error('Economy references an unknown settlement.');
    freezeReserves(economy.production);
    freezeReserves(economy.consumption);
    validateInteger(economy.stabilityDelta, 'Community stability delta', -100, 100);
  }
  for (const candidate of context.routeCandidates) {
    if (!ids.has(candidate.firstSettlementId) || !ids.has(candidate.secondSettlementId))
      throw new Error('Route references an unknown settlement.');
    pair(candidate.firstSettlementId, candidate.secondSettlementId);
    validateInteger(candidate.utility, 'Route utility', -1000, 1000);
    validateInteger(candidate.volume, 'Route volume');
  }
  for (const candidate of context.diplomacyCandidates) {
    if (
      !civilizationIds.has(candidate.firstCivilizationId) ||
      !civilizationIds.has(candidate.secondCivilizationId)
    )
      throw new Error('Diplomacy references an unknown civilization.');
    pair(candidate.firstCivilizationId, candidate.secondCivilizationId);
    validateInteger(candidate.score, 'Diplomacy score', -1000, 1000);
  }
  for (const candidate of context.conflictCandidates) {
    if (
      !civilizationIds.has(candidate.attackerCivilizationId) ||
      !civilizationIds.has(candidate.defenderCivilizationId)
    )
      throw new Error('Conflict references an unknown civilization.');
    pair(candidate.attackerCivilizationId, candidate.defenderCivilizationId);
    validateInteger(candidate.pressure, 'Conflict pressure', 0, 1000);
  }
  for (const resolution of context.conflictResolutions) {
    validateInteger(resolution.conflictId, 'Conflict resolution id', 1);
    if (!civilizationIds.has(resolution.winnerCivilizationId))
      throw new Error('Conflict winner is unknown.');
  }
  for (const transfer of context.residencyTransfers) {
    if (
      !ids.has(transfer.fromSettlementId) ||
      !ids.has(transfer.toSettlementId) ||
      transfer.fromSettlementId === transfer.toSettlementId
    )
      throw new Error('Residency transfer references an invalid settlement pair.');
    for (const subjectId of [...transfer.personIds, ...transfer.householdIds])
      validateInteger(subjectId, 'Residency transfer subject', 1);
  }
  for (const settlementId of context.ruinSettlementIds) {
    if (!ids.has(settlementId)) throw new Error('Ruin references an unknown settlement.');
  }
  for (const civilizationId of [
    ...context.federationCivilizationIds,
    ...context.fragmentationCivilizationIds,
  ]) {
    if (!civilizationIds.has(civilizationId))
      throw new Error('Political state references unknown civilization.');
  }
  for (const change of context.territoryChanges) {
    validateInteger(change.tileIndex, 'Territory tile', 0, state.tileOwners.length - 1);
    if (change.nextSettlementId !== 0 && !ids.has(change.nextSettlementId))
      throw new Error('Territory owner is unknown.');
  }
}

function appendEvent(events: CivilizationEventDraft[], value: CivilizationEventDraft): void {
  if (events.length >= MAX_CIVILIZATION_EVENTS)
    throw new Error('Civilization factual event budget would overflow.');
  events.push(value);
}

function findRelation(
  relations: readonly DiplomacyRelation[],
  firstCivilizationId: number,
  secondCivilizationId: number,
): DiplomacyRelation | undefined {
  const [first, second] = pair(firstCivilizationId, secondCivilizationId);
  return relations.find(
    (relation) =>
      relation.firstCivilizationId === first && relation.secondCivilizationId === second,
  );
}

function statusForScore(score: number): DiplomacyStatus {
  if (score >= 40) return 'allied';
  if (score <= -60) return 'rival';
  return 'neutral';
}

function freezeState(
  input: Omit<
    CivilizationsState,
    | 'settlements'
    | 'civilizations'
    | 'residencies'
    | 'diplomacy'
    | 'routes'
    | 'conflicts'
    | 'ruins'
    | 'tileOwners'
  > & {
    readonly settlements: Settlement[];
    readonly civilizations: Civilization[];
    readonly residencies: Residency[];
    readonly diplomacy: DiplomacyRelation[];
    readonly routes: TradeRoute[];
    readonly conflicts: Conflict[];
    readonly ruins: Ruin[];
    readonly tileOwners: number[];
  },
): CivilizationsState {
  return frozen({
    ...input,
    settlements: sorted(input.settlements, (left, right) => left.id - right.id),
    civilizations: sorted(input.civilizations, (left, right) => left.id - right.id),
    residencies: sorted(input.residencies, (left, right) => left.id - right.id),
    diplomacy: sorted(
      input.diplomacy,
      (left, right) =>
        left.firstCivilizationId - right.firstCivilizationId ||
        left.secondCivilizationId - right.secondCivilizationId,
    ),
    routes: sorted(
      input.routes,
      (left, right) =>
        left.firstSettlementId - right.firstSettlementId ||
        left.secondSettlementId - right.secondSettlementId,
    ),
    conflicts: sorted(input.conflicts, (left, right) => left.id - right.id),
    ruins: sorted(input.ruins, (left, right) => left.id - right.id),
    tileOwners: Object.freeze([...input.tileOwners]),
  });
}

/**
 * Pure one-year M6 authority. It returns a founding-reserve delta instead of
 * mutating M3-M5 reserves, preserving one source of truth for those goods.
 */
export function advanceCivilizations(
  state: CivilizationsState,
  context: CivilizationsContext,
): CivilizationAdvanceResult {
  assertCivilizationsInvariants(state);
  validateContext(state, context);
  const rng = new Xoshiro128StarStar(state.rng);
  const events: CivilizationEventDraft[] = [];
  const settlements = [...state.settlements];
  const civilizations = [...state.civilizations];
  const residencies = [...state.residencies];
  const diplomacy = [...state.diplomacy];
  const routes = [...state.routes];
  const conflicts = [...state.conflicts];
  const ruins = [...state.ruins];
  const tileOwners = [...state.tileOwners];
  let nextEntityId = state.nextEntityId;
  let foundingReserveAvailable = freezeReserves(context.foundingReserveAvailable);
  let foundingReserveDelta = emptyReserveDelta();
  let operationCount = state.operationCount;

  // 1. Founding and residency. Exactly one best valid candidate may found per year.
  const founding = [...context.foundingCandidates]
    .sort(
      (left, right) =>
        right.siteScore - left.siteScore ||
        left.centerTileIndex - right.centerTileIndex ||
        compareText(left.name, right.name),
    )
    .find(
      (candidate) =>
        candidate.siteScore >= 50 &&
        tileOwners[candidate.centerTileIndex] === 0 &&
        reserveFits(foundingReserveAvailable, candidate.reserveTransfer),
    );
  if (
    founding !== undefined &&
    activeSettlements({ ...state, settlements }).length < MAX_ACTIVE_SETTLEMENTS &&
    settlements.length < MAX_ACTIVE_SETTLEMENTS
  ) {
    const settlementId = nextEntityId;
    const civilizationId = nextEntityId + 1;
    nextEntityId += 2;
    const settlement = frozen<Settlement>({
      id: settlementId,
      civilizationId,
      name: founding.name,
      cultureId: founding.cultureId,
      centerTileIndex: founding.centerTileIndex,
      status: 'active',
      population: new Set(founding.personIds).size,
      stability: founding.stability,
      reserves: freezeReserves(founding.reserveTransfer),
      territoryHistory: Object.freeze([]),
      territoryHistorySummaryCount: 0,
      foundedTick: context.tick,
      endedTick: null,
      provenance: 'm6-founding',
    });
    settlements.push(settlement);
    civilizations.push(
      frozen({
        id: civilizationId,
        name: founding.civilizationName,
        cultureId: founding.cultureId,
        status: 'independent',
        foundingSettlementId: settlementId,
        memberSettlementIds: Object.freeze([settlementId]),
        foundedTick: context.tick,
        endedTick: null,
        provenance: 'm6-founding',
      }),
    );
    for (const [subjectKind, ids] of [
      ['person', founding.personIds] as const,
      ['household', founding.householdIds] as const,
    ]) {
      for (const subjectId of [...new Set(ids)].sort(compareNumber)) {
        const priorIndex = residencies.findIndex(
          (residency) =>
            residency.subjectKind === subjectKind &&
            residency.subjectId === subjectId &&
            residency.endedTick === null,
        );
        if (priorIndex >= 0) {
          const prior = residencies[priorIndex]!;
          residencies[priorIndex] = frozen({ ...prior, endedTick: context.tick });
          if (subjectKind === 'person') {
            const sourceIndex = settlements.findIndex(
              (candidate) => candidate.id === prior.settlementId,
            );
            const source = settlements[sourceIndex];
            if (source !== undefined)
              settlements[sourceIndex] = frozen({
                ...source,
                population: Math.max(0, source.population - 1),
              });
          }
        }
        residencies.push(
          frozen({
            id: nextEntityId,
            subjectKind,
            subjectId,
            settlementId,
            startedTick: context.tick,
            endedTick: null,
          }),
        );
        nextEntityId += 1;
      }
    }
    tileOwners[founding.centerTileIndex] = settlementId;
    foundingReserveAvailable = subtractReserves(foundingReserveAvailable, founding.reserveTransfer);
    foundingReserveDelta = addReserveDelta(
      foundingReserveDelta,
      negativeReserves(founding.reserveTransfer),
    );
    appendEvent(
      events,
      event(
        'settlement-founded',
        settlementId,
        civilizationId,
        context.tick,
        founding.siteScore,
        `${founding.name} was founded.`,
      ),
    );
    operationCount += 1;
  }

  // 2. Community production and consumption, in stable settlement order.
  const economyBySettlement = new Map<number, CommunityEconomyInput>();
  for (const economy of context.economies) economyBySettlement.set(economy.settlementId, economy);
  for (const settlement of [...settlements].sort((left, right) => left.id - right.id)) {
    if (settlement.status !== 'active') continue;
    const economy = economyBySettlement.get(settlement.id);
    if (economy === undefined) continue;
    const reserves = subtractReserves(
      addReserves(settlement.reserves, economy.production),
      economy.consumption,
    );
    const stability = Math.max(0, Math.min(100, settlement.stability + economy.stabilityDelta));
    settlements[settlements.findIndex((candidate) => candidate.id === settlement.id)] = frozen({
      ...settlement,
      reserves,
      stability,
    });
    operationCount += 1;
  }

  // 3. Markets and routes.
  const routeKeys = activeRoutePairKeys({ ...state, routes });
  for (const candidate of [...context.routeCandidates].sort(
    (left, right) =>
      right.utility - left.utility ||
      left.firstSettlementId - right.firstSettlementId ||
      left.secondSettlementId - right.secondSettlementId,
  )) {
    const [firstSettlementId, secondSettlementId] = pair(
      candidate.firstSettlementId,
      candidate.secondSettlementId,
    );
    const routeKey = pairKey(firstSettlementId, secondSettlementId);
    const existing = routes.find(
      (route) =>
        route.status !== 'ended' &&
        route.firstSettlementId === firstSettlementId &&
        route.secondSettlementId === secondSettlementId,
    );
    if (existing !== undefined) {
      if (existing.status === 'active' && candidate.utility <= -40) {
        routes[routes.findIndex((route) => route.id === existing.id)] = frozen({
          ...existing,
          status: 'disrupted',
          volume: 0,
        });
        appendEvent(
          events,
          event(
            'route-disrupted',
            firstSettlementId,
            secondSettlementId,
            context.tick,
            Math.abs(candidate.utility),
            'A trade route was disrupted.',
          ),
        );
        operationCount += 1;
      } else if (existing.status === 'disrupted' && candidate.utility >= 40) {
        routes[routes.findIndex((route) => route.id === existing.id)] = frozen({
          ...existing,
          status: 'active',
          volume: candidate.volume,
        });
        appendEvent(
          events,
          event(
            'route-restored',
            firstSettlementId,
            secondSettlementId,
            context.tick,
            candidate.volume,
            'A trade route resumed.',
          ),
        );
        operationCount += 1;
      }
      continue;
    }
    if (
      candidate.utility < 40 ||
      routeKeys.has(routeKey) ||
      routes.filter((route) => route.status !== 'ended').length >= MAX_ACTIVE_ROUTES
    )
      continue;
    routes.push(
      frozen({
        id: nextEntityId,
        firstSettlementId,
        secondSettlementId,
        status: 'active',
        volume: candidate.volume,
        startedTick: context.tick,
        endedTick: null,
      }),
    );
    nextEntityId += 1;
    routeKeys.add(routeKey);
    appendEvent(
      events,
      event(
        'route-established',
        firstSettlementId,
        secondSettlementId,
        context.tick,
        candidate.volume,
        'A trade route was established.',
      ),
    );
    operationCount += 1;
  }

  // Route volume is an annual total capacity. Stable route ordering makes
  // scarce-goods transfer partition-independent and keeps disruption final
  // before any market movement this year.
  for (const route of [...routes].sort(
    (left, right) =>
      left.firstSettlementId - right.firstSettlementId ||
      left.secondSettlementId - right.secondSettlementId,
  )) {
    operationCount += applyMarketExchange(settlements, route);
  }

  // 4. Diplomacy.
  for (const candidate of [...context.diplomacyCandidates].sort(
    (left, right) =>
      left.firstCivilizationId - right.firstCivilizationId ||
      left.secondCivilizationId - right.secondCivilizationId,
  )) {
    const [firstCivilizationId, secondCivilizationId] = pair(
      candidate.firstCivilizationId,
      candidate.secondCivilizationId,
    );
    const current = findRelation(diplomacy, firstCivilizationId, secondCivilizationId);
    const status = statusForScore(candidate.score);
    if (current === undefined) {
      if (diplomacy.length >= MAX_DIPLOMACY_PAIRS) continue;
      diplomacy.push(
        frozen({
          id: nextEntityId,
          firstCivilizationId,
          secondCivilizationId,
          status,
          score: candidate.score,
          changedTick: context.tick,
        }),
      );
      nextEntityId += 1;
      appendEvent(
        events,
        event(
          'diplomacy-changed',
          firstCivilizationId,
          secondCivilizationId,
          context.tick,
          Math.abs(candidate.score),
          'Diplomatic standing changed.',
        ),
      );
      operationCount += 1;
    } else if (current.status !== status || current.score !== candidate.score) {
      diplomacy[diplomacy.findIndex((relation) => relation.id === current.id)] = frozen({
        ...current,
        status,
        score: candidate.score,
        changedTick: context.tick,
      });
      appendEvent(
        events,
        event(
          'diplomacy-changed',
          firstCivilizationId,
          secondCivilizationId,
          context.tick,
          Math.abs(candidate.score),
          'Diplomatic standing changed.',
        ),
      );
      operationCount += 1;
    }
  }

  // 5. Conflict and refugees. The caller supplies only bounded relationship-indexed choices.
  for (const candidate of [...context.conflictCandidates].sort(
    (left, right) =>
      right.pressure - left.pressure ||
      left.attackerCivilizationId - right.attackerCivilizationId ||
      left.defenderCivilizationId - right.defenderCivilizationId,
  )) {
    if (
      candidate.pressure < 60 ||
      conflicts.filter((conflict) => conflict.status === 'active').length >= MAX_ACTIVE_CONFLICTS ||
      conflicts.some(
        (conflict) =>
          conflict.status === 'active' &&
          pairKey(conflict.attackerCivilizationId, conflict.defenderCivilizationId) ===
            pairKey(candidate.attackerCivilizationId, candidate.defenderCivilizationId),
      )
    )
      continue;
    conflicts.push(
      frozen({
        id: nextEntityId,
        attackerCivilizationId: candidate.attackerCivilizationId,
        defenderCivilizationId: candidate.defenderCivilizationId,
        status: 'active',
        pressure: candidate.pressure,
        startedTick: context.tick,
        endedTick: null,
        winnerCivilizationId: null,
      }),
    );
    nextEntityId += 1;
    const relation = findRelation(
      diplomacy,
      candidate.attackerCivilizationId,
      candidate.defenderCivilizationId,
    );
    if (relation !== undefined)
      diplomacy[diplomacy.findIndex((entry) => entry.id === relation.id)] = frozen({
        ...relation,
        status: 'at-war',
        changedTick: context.tick,
      });
    appendEvent(
      events,
      event(
        'conflict-started',
        candidate.attackerCivilizationId,
        candidate.defenderCivilizationId,
        context.tick,
        candidate.pressure,
        'A conflict began.',
      ),
    );
    operationCount += 1;
  }
  for (const resolution of [...context.conflictResolutions].sort(
    (left, right) => left.conflictId - right.conflictId,
  )) {
    const conflict = conflicts.find((candidate) => candidate.id === resolution.conflictId);
    if (
      conflict?.status !== 'active' ||
      (resolution.winnerCivilizationId !== conflict.attackerCivilizationId &&
        resolution.winnerCivilizationId !== conflict.defenderCivilizationId)
    )
      continue;
    conflicts[conflicts.findIndex((candidate) => candidate.id === conflict.id)] = frozen({
      ...conflict,
      status: 'resolved',
      endedTick: context.tick,
      winnerCivilizationId: resolution.winnerCivilizationId,
    });
    const losingCivilizationId =
      conflict.attackerCivilizationId === resolution.winnerCivilizationId
        ? conflict.defenderCivilizationId
        : conflict.attackerCivilizationId;
    const loserIndex = civilizations.findIndex(
      (civilization) => civilization.id === losingCivilizationId,
    );
    const winnerIndex = civilizations.findIndex(
      (civilization) => civilization.id === resolution.winnerCivilizationId,
    );
    const loser = civilizations[loserIndex];
    const winner = civilizations[winnerIndex];
    if (loser !== undefined && winner !== undefined && loser.endedTick === null) {
      const conqueredIds: number[] = [];
      for (const settlementId of loser.memberSettlementIds) {
        const settlementIndex = settlements.findIndex(
          (settlement) => settlement.id === settlementId,
        );
        const settlement = settlements[settlementIndex];
        if (settlement?.status !== 'active') continue;
        conqueredIds.push(settlement.id);
        settlements[settlementIndex] = frozen({
          ...settlement,
          civilizationId: winner.id,
          status: 'conquered',
          endedTick: context.tick,
        });
        for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
          const route = routes[routeIndex]!;
          if (
            route.status !== 'ended' &&
            (route.firstSettlementId === settlement.id ||
              route.secondSettlementId === settlement.id)
          )
            routes[routeIndex] = frozen({
              ...route,
              status: 'ended',
              volume: 0,
              endedTick: context.tick,
            });
        }
      }
      civilizations[loserIndex] = frozen({
        ...loser,
        status: 'collapsed',
        endedTick: context.tick,
      });
      civilizations[winnerIndex] = frozen({
        ...winner,
        memberSettlementIds: sorted(
          [...new Set([...winner.memberSettlementIds, ...conqueredIds])],
          compareNumber,
        ),
      });
    }
    appendEvent(
      events,
      event(
        'conflict-resolved',
        conflict.id,
        resolution.winnerCivilizationId,
        context.tick,
        conflict.pressure,
        'A conflict resolved.',
      ),
    );
    operationCount += 1;
  }

  for (const transfer of [...context.residencyTransfers].sort(
    (left, right) =>
      left.fromSettlementId - right.fromSettlementId || left.toSettlementId - right.toSettlementId,
  )) {
    let movedPeople = 0;
    for (const [subjectKind, ids] of [
      ['person', transfer.personIds] as const,
      ['household', transfer.householdIds] as const,
    ]) {
      for (const subjectId of [...new Set(ids)].sort(compareNumber)) {
        const priorIndex = residencies.findIndex(
          (residency) =>
            residency.subjectKind === subjectKind &&
            residency.subjectId === subjectId &&
            residency.settlementId === transfer.fromSettlementId &&
            residency.endedTick === null,
        );
        if (priorIndex < 0) continue;
        residencies[priorIndex] = frozen({ ...residencies[priorIndex]!, endedTick: context.tick });
        residencies.push(
          frozen({
            id: nextEntityId,
            subjectKind,
            subjectId,
            settlementId: transfer.toSettlementId,
            startedTick: context.tick,
            endedTick: null,
          }),
        );
        nextEntityId += 1;
        if (subjectKind === 'person') movedPeople += 1;
      }
    }
    if (movedPeople === 0) continue;
    const fromIndex = settlements.findIndex(
      (settlement) => settlement.id === transfer.fromSettlementId,
    );
    const toIndex = settlements.findIndex(
      (settlement) => settlement.id === transfer.toSettlementId,
    );
    const from = settlements[fromIndex];
    const to = settlements[toIndex];
    if (from !== undefined)
      settlements[fromIndex] = frozen({
        ...from,
        population: Math.max(0, from.population - movedPeople),
      });
    if (to !== undefined)
      settlements[toIndex] = frozen({ ...to, population: to.population + movedPeople });
    appendEvent(
      events,
      event(
        'refugees-relocated',
        transfer.fromSettlementId,
        transfer.toSettlementId,
        context.tick,
        movedPeople,
        transfer.reason === 'refugee'
          ? 'People found refuge in another settlement.'
          : 'People migrated between settlements.',
      ),
    );
    operationCount += movedPeople;
  }

  // 6. Federation and fragmentation.
  for (const civilizationId of [...new Set(context.federationCivilizationIds)].sort(
    compareNumber,
  )) {
    const civilization = civilizations.find((candidate) => candidate.id === civilizationId);
    if (civilization?.endedTick !== null || civilization?.status === 'federated') continue;
    civilizations[civilizations.findIndex((candidate) => candidate.id === civilizationId)] = frozen(
      {
        ...civilization,
        status: 'federated',
      },
    );
    appendEvent(
      events,
      event(
        'federation-formed',
        civilizationId,
        0,
        context.tick,
        1,
        'A civilization entered a federation.',
      ),
    );
    operationCount += 1;
  }
  for (const civilizationId of [...new Set(context.fragmentationCivilizationIds)].sort(
    compareNumber,
  )) {
    const civilization = civilizations.find((candidate) => candidate.id === civilizationId);
    if (civilization?.endedTick !== null || civilization?.status === 'fragmented') continue;
    civilizations[civilizations.findIndex((candidate) => candidate.id === civilizationId)] = frozen(
      {
        ...civilization,
        status: 'fragmented',
      },
    );
    appendEvent(
      events,
      event(
        'civilization-fragmented',
        civilizationId,
        0,
        context.tick,
        1,
        'A civilization fragmented.',
      ),
    );
    operationCount += 1;
  }

  // 7. Ruins and fixed territory history. Overflow is represented explicitly, never dropped.
  for (const settlementId of [...new Set(context.ruinSettlementIds)].sort(compareNumber)) {
    const settlement = settlements.find((candidate) => candidate.id === settlementId);
    if (
      settlement === undefined ||
      settlement.status === 'abandoned' ||
      ruins.some((ruin) => ruin.settlementId === settlementId) ||
      ruins.length >= MAX_RUINS
    )
      continue;
    if (
      residencies.some(
        (residency) => residency.settlementId === settlementId && residency.endedTick === null,
      )
    )
      throw new Error('A settlement with active residents cannot become a ruin.');
    settlements[settlements.findIndex((candidate) => candidate.id === settlementId)] = frozen({
      ...settlement,
      status: 'abandoned',
      endedTick: context.tick,
    });
    for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
      const route = routes[routeIndex]!;
      if (
        route.status !== 'ended' &&
        (route.firstSettlementId === settlementId || route.secondSettlementId === settlementId)
      )
        routes[routeIndex] = frozen({
          ...route,
          status: 'ended',
          volume: 0,
          endedTick: context.tick,
        });
    }
    const civilizationIndex = civilizations.findIndex(
      (civilization) => civilization.id === settlement.civilizationId,
    );
    const civilization = civilizations[civilizationIndex];
    if (
      civilization?.endedTick === null &&
      !civilization.memberSettlementIds.some(
        (memberId) =>
          settlements.find((candidate) => candidate.id === memberId)?.status === 'active',
      )
    )
      civilizations[civilizationIndex] = frozen({
        ...civilization,
        status: 'collapsed',
        endedTick: context.tick,
      });
    ruins.push(
      frozen({
        id: nextEntityId,
        settlementId,
        createdTick: context.tick,
        cause: settlement.status === 'conquered' ? 'conquered' : 'abandoned',
      }),
    );
    nextEntityId += 1;
    appendEvent(
      events,
      event(
        'settlement-ruined',
        settlementId,
        0,
        context.tick,
        1,
        `${settlement.name} became a ruin.`,
      ),
    );
    operationCount += 1;
  }
  for (const change of [...context.territoryChanges].sort(
    (left, right) =>
      left.tileIndex - right.tileIndex || left.nextSettlementId - right.nextSettlementId,
  )) {
    const previousSettlementId = tileOwners[change.tileIndex]!;
    if (previousSettlementId === change.nextSettlementId) continue;
    tileOwners[change.tileIndex] = change.nextSettlementId;
    const historySettlementId =
      change.nextSettlementId === 0 ? previousSettlementId : change.nextSettlementId;
    const settlement = settlements.find((candidate) => candidate.id === historySettlementId);
    if (settlement === undefined) continue;
    if (settlement.territoryHistory.length < MAX_TERRITORY_HISTORY_PER_SETTLEMENT) {
      const history: TerritoryHistoryRecord = frozen({
        id: nextEntityId,
        tick: context.tick,
        tileIndex: change.tileIndex,
        previousSettlementId,
        nextSettlementId: change.nextSettlementId,
      });
      nextEntityId += 1;
      settlements[settlements.findIndex((candidate) => candidate.id === settlement.id)] = frozen({
        ...settlement,
        territoryHistory: Object.freeze([...settlement.territoryHistory, history]),
      });
      appendEvent(
        events,
        event(
          'territory-changed',
          historySettlementId,
          change.nextSettlementId,
          context.tick,
          change.tileIndex,
          'Territory changed hands.',
        ),
      );
    } else {
      settlements[settlements.findIndex((candidate) => candidate.id === settlement.id)] = frozen({
        ...settlement,
        territoryHistorySummaryCount: settlement.territoryHistorySummaryCount + 1,
      });
      appendEvent(
        events,
        event(
          'territory-history-summarized',
          historySettlementId,
          change.nextSettlementId,
          context.tick,
          1,
          'Additional territory changes were summarized.',
        ),
      );
    }
    operationCount += 1;
  }

  // One deterministic draw keeps the isolated persisted stream active without influencing another authority.
  rng.nextUint32();
  const next = freezeState({
    tick: context.tick,
    nextEntityId,
    rng: rng.save(),
    settlements,
    civilizations,
    residencies,
    diplomacy,
    routes,
    conflicts,
    ruins,
    tileOwners,
    operationCount,
  });
  assertCivilizationsInvariants(next);
  return frozen({ state: next, events: Object.freeze(events), foundingReserveDelta });
}

function selectRelationshipInfluenced<T extends IndexedRelationshipChoice>(
  candidates: readonly T[],
  id: (candidate: T) => number,
): number | null {
  let selected: number | null = null;
  let utility = Number.MIN_SAFE_INTEGER;
  for (const candidate of [...candidates].sort((left, right) => id(left) - id(right))) {
    validateInteger(candidate.id, 'Indexed relationship candidate id', 1);
    validateInteger(candidate.baseUtility, 'Relationship base utility', -1_000_000, 1_000_000);
    validateInteger(
      candidate.relationshipDecisionInfluence,
      'Indexed relationship influence',
      -1_000_000,
      1_000_000,
    );
    const candidateUtility = candidate.baseUtility + candidate.relationshipDecisionInfluence;
    const candidateId = id(candidate);
    if (
      candidateUtility > utility ||
      (candidateUtility === utility && (selected === null || candidateId < selected))
    ) {
      selected = candidateId;
      utility = candidateUtility;
    }
  }
  return selected;
}

export function selectCoMigrationPerson(candidates: readonly CoMigrationChoice[]): number | null {
  return selectRelationshipInfluenced(candidates, (candidate) => candidate.personId);
}

export function selectRefugeeSupportSettlement(
  candidates: readonly RefugeeSupportChoice[],
): number | null {
  return selectRelationshipInfluenced(candidates, (candidate) => candidate.settlementId);
}

export function selectPoliticalSupportCivilization(
  candidates: readonly PoliticalSupportChoice[],
): number | null {
  return selectRelationshipInfluenced(candidates, (candidate) => candidate.civilizationId);
}

export function selectConflictTargetCivilization(
  candidates: readonly ConflictChoice[],
): number | null {
  return selectRelationshipInfluenced(candidates, (candidate) => candidate.civilizationId);
}

export function assertCivilizationsInvariants(state: CivilizationsState): void {
  validateInteger(state.tick, 'Civilizations tick');
  validateInteger(state.nextEntityId, 'Civilizations next entity id', 1);
  validateInteger(state.operationCount, 'Civilizations operation count');
  if (
    state.rng.length !== 4 ||
    state.rng.some((word) => !Number.isSafeInteger(word) || word < 0 || word > 0xffff_ffff) ||
    (state.rng[0] | state.rng[1] | state.rng[2] | state.rng[3]) === 0
  )
    throw new Error('Civilizations RNG is invalid.');
  const allIds = [
    ...state.settlements.map((entry) => entry.id),
    ...state.civilizations.map((entry) => entry.id),
    ...state.residencies.map((entry) => entry.id),
    ...state.diplomacy.map((entry) => entry.id),
    ...state.routes.map((entry) => entry.id),
    ...state.conflicts.map((entry) => entry.id),
    ...state.ruins.map((entry) => entry.id),
    ...state.settlements.flatMap((settlement) =>
      settlement.territoryHistory.map((entry) => entry.id),
    ),
  ];
  if (
    new Set(allIds).size !== allIds.length ||
    allIds.some((id) => !Number.isSafeInteger(id) || id < 1 || id >= state.nextEntityId)
  )
    throw new Error('Civilization identities must be globally unique and allocated.');
  const settleIds = new Set(state.settlements.map((settlement) => settlement.id));
  const civilizationIds = new Set(state.civilizations.map((civilization) => civilization.id));
  if (activeSettlements(state).length > MAX_ACTIVE_SETTLEMENTS)
    throw new Error('Active settlement cap exceeded.');
  if (activeCivilizations(state).length > MAX_ACTIVE_CIVILIZATIONS)
    throw new Error('Active civilization cap exceeded.');
  if (
    state.settlements.filter((settlement) => settlement.status !== 'active').length +
      state.civilizations.filter((civilization) => civilization.endedTick !== null).length >
    MAX_HISTORICAL_COMMUNITIES
  )
    throw new Error('Historical community cap exceeded.');
  if (state.routes.filter((route) => route.status !== 'ended').length > MAX_ACTIVE_ROUTES)
    throw new Error('Active route cap exceeded.');
  if (
    state.routes.filter((route) => route.status === 'ended').length +
      state.conflicts.filter((conflict) => conflict.status === 'resolved').length >
    MAX_ROUTE_CONFLICT_SUMMARIES
  )
    throw new Error('Route and conflict summary cap exceeded.');
  if (state.diplomacy.length > MAX_DIPLOMACY_PAIRS) throw new Error('Diplomacy cap exceeded.');
  if (
    state.conflicts.filter((conflict) => conflict.status === 'active').length > MAX_ACTIVE_CONFLICTS
  )
    throw new Error('Active conflict cap exceeded.');
  if (state.ruins.length > MAX_RUINS) throw new Error('Ruin cap exceeded.');
  for (let index = 1; index < state.settlements.length; index += 1)
    if (state.settlements[index - 1]!.id >= state.settlements[index]!.id)
      throw new Error('Settlements must be stable-ID sorted.');
  for (let index = 1; index < state.civilizations.length; index += 1)
    if (state.civilizations[index - 1]!.id >= state.civilizations[index]!.id)
      throw new Error('Civilizations must be stable-ID sorted.');
  for (const settlement of state.settlements) {
    if (!civilizationIds.has(settlement.civilizationId) || settlement.foundedTick > state.tick)
      throw new Error('Settlement reference or founding tick is invalid.');
    if (
      (settlement.status === 'active' && settlement.endedTick !== null) ||
      (settlement.status !== 'active' &&
        (settlement.endedTick === null || settlement.endedTick > state.tick))
    )
      throw new Error('Settlement lifecycle is invalid.');
    const owningCivilization = state.civilizations.find(
      (civilization) => civilization.id === settlement.civilizationId,
    );
    if (
      settlement.status === 'active' &&
      (owningCivilization?.endedTick !== null ||
        owningCivilization.memberSettlementIds.includes(settlement.id) !== true)
    )
      throw new Error('An active settlement must belong to a living member civilization.');
    validateName(settlement.name, 'Settlement name');
    validateInteger(settlement.cultureId, 'Settlement culture', 1);
    validateInteger(
      settlement.centerTileIndex,
      'Settlement center tile',
      0,
      state.tileOwners.length - 1,
    );
    validateInteger(settlement.population, 'Settlement population');
    validatePercent(settlement.stability, 'Settlement stability');
    freezeReserves(settlement.reserves);
    if (settlement.territoryHistory.length > MAX_TERRITORY_HISTORY_PER_SETTLEMENT)
      throw new Error('Settlement territory history exceeds its cap.');
    validateInteger(settlement.territoryHistorySummaryCount, 'Territory history summary count');
    for (let index = 1; index < settlement.territoryHistory.length; index += 1)
      if (settlement.territoryHistory[index - 1]!.id >= settlement.territoryHistory[index]!.id)
        throw new Error('Territory history must be stable-ID sorted.');
    for (const history of settlement.territoryHistory) {
      if (
        history.tick > state.tick ||
        history.tileIndex < 0 ||
        history.tileIndex >= state.tileOwners.length
      )
        throw new Error('Territory history is invalid.');
      if (
        (history.previousSettlementId !== 0 && !settleIds.has(history.previousSettlementId)) ||
        (history.nextSettlementId !== 0 && !settleIds.has(history.nextSettlementId))
      )
        throw new Error('Territory history references an unknown settlement.');
    }
  }
  for (const civilization of state.civilizations) {
    if (!settleIds.has(civilization.foundingSettlementId) || civilization.foundedTick > state.tick)
      throw new Error('Civilization founding reference is invalid.');
    validateName(civilization.name, 'Civilization name');
    validateInteger(civilization.cultureId, 'Civilization culture', 1);
    if (
      civilization.memberSettlementIds.length === 0 ||
      civilization.memberSettlementIds.some((id) => !settleIds.has(id)) ||
      [...civilization.memberSettlementIds].some(
        (id, index, values) => index > 0 && values[index - 1]! >= id,
      )
    )
      throw new Error('Civilization members must be stable-ID sorted valid settlements.');
    if (
      (civilization.endedTick === null && civilization.status === 'collapsed') ||
      (civilization.endedTick !== null && civilization.status !== 'collapsed') ||
      (civilization.endedTick !== null && civilization.endedTick > state.tick)
    )
      throw new Error('Civilization lifecycle is invalid.');
    if (
      civilization.endedTick === null &&
      !civilization.memberSettlementIds.some(
        (id) => state.settlements.find((settlement) => settlement.id === id)?.status === 'active',
      )
    )
      throw new Error('A living civilization must retain an active member settlement.');
  }
  const activeResidencyKeys = new Set<string>();
  for (const residency of state.residencies) {
    const settlement = state.settlements.find(
      (candidate) => candidate.id === residency.settlementId,
    );
    if (settlement === undefined || residency.startedTick > state.tick)
      throw new Error('Residency reference is invalid.');
    validateInteger(residency.subjectId, 'Residency subject', 1);
    const key = `${residency.subjectKind}:${residency.subjectId}`;
    if (residency.endedTick === null) {
      if (settlement.status !== 'active')
        throw new Error(
          `Active ${residency.subjectKind} residency ${residency.id} references ${settlement.status} settlement ${settlement.id}.`,
        );
      if (activeResidencyKeys.has(key))
        throw new Error('A subject may have only one active residency.');
      activeResidencyKeys.add(key);
    } else if (residency.endedTick < residency.startedTick || residency.endedTick > state.tick)
      throw new Error('Residency lifecycle is invalid.');
  }
  const actualPopulation = new Map<number, number>();
  for (const residency of state.residencies)
    if (residency.subjectKind === 'person' && residency.endedTick === null)
      actualPopulation.set(
        residency.settlementId,
        (actualPopulation.get(residency.settlementId) ?? 0) + 1,
      );
  for (const settlement of state.settlements)
    if ((actualPopulation.get(settlement.id) ?? 0) > settlement.population)
      throw new Error('Settlement population cannot omit named resident conservation.');
  const relationKeys = new Set<string>();
  for (const relation of state.diplomacy) {
    if (
      !civilizationIds.has(relation.firstCivilizationId) ||
      !civilizationIds.has(relation.secondCivilizationId)
    )
      throw new Error('Diplomacy references an unknown civilization.');
    const key = pairKey(relation.firstCivilizationId, relation.secondCivilizationId);
    if (relationKeys.has(key) || relation.firstCivilizationId >= relation.secondCivilizationId)
      throw new Error('Diplomacy pairs must be canonical and unique.');
    relationKeys.add(key);
    validateInteger(relation.score, 'Diplomacy score', -1000, 1000);
  }
  const routeKeys = new Set<string>();
  for (const route of state.routes) {
    if (!settleIds.has(route.firstSettlementId) || !settleIds.has(route.secondSettlementId))
      throw new Error('Route references an unknown settlement.');
    const key = pairKey(route.firstSettlementId, route.secondSettlementId);
    if (routeKeys.has(key) || route.firstSettlementId >= route.secondSettlementId)
      throw new Error('Routes must be canonical and unique.');
    routeKeys.add(key);
    validateInteger(route.volume, 'Route volume');
    if ((route.status === 'ended') !== (route.endedTick !== null))
      throw new Error('Route lifecycle is invalid.');
    if (
      route.status !== 'ended' &&
      (state.settlements.find((settlement) => settlement.id === route.firstSettlementId)?.status !==
        'active' ||
        state.settlements.find((settlement) => settlement.id === route.secondSettlementId)
          ?.status !== 'active')
    )
      throw new Error('An active route must connect active settlements.');
  }
  for (const conflict of state.conflicts) {
    if (
      !civilizationIds.has(conflict.attackerCivilizationId) ||
      !civilizationIds.has(conflict.defenderCivilizationId) ||
      conflict.attackerCivilizationId === conflict.defenderCivilizationId ||
      conflict.startedTick > state.tick
    )
      throw new Error('Conflict reference is invalid.');
    validateInteger(conflict.pressure, 'Conflict pressure', 0, 1000);
    if (
      (conflict.status === 'active' &&
        (conflict.endedTick !== null || conflict.winnerCivilizationId !== null)) ||
      (conflict.status === 'resolved' &&
        (conflict.endedTick === null ||
          conflict.winnerCivilizationId === null ||
          !civilizationIds.has(conflict.winnerCivilizationId)))
    )
      throw new Error('Conflict lifecycle is invalid.');
  }
  for (const ruin of state.ruins) {
    const settlement = state.settlements.find((candidate) => candidate.id === ruin.settlementId);
    if (settlement === undefined || settlement.status === 'active' || ruin.createdTick > state.tick)
      throw new Error('Ruin is invalid.');
  }
  if (
    state.tileOwners.some(
      (owner) =>
        !Number.isSafeInteger(owner) || owner < 0 || (owner !== 0 && !settleIds.has(owner)),
    )
  )
    throw new Error('Tile ownership is invalid.');
}

/** Stable canonical DTO for snapshots, hashing, and read-only Worker projections. */
export function civilizationsDto(state: CivilizationsState): Readonly<Record<string, unknown>> {
  assertCivilizationsInvariants(state);
  return frozen({
    civilizations: state.civilizations.map((civilization) => ({
      ...civilization,
      memberSettlementIds: [...civilization.memberSettlementIds],
    })),
    conflicts: state.conflicts.map((conflict) => ({ ...conflict })),
    diplomacy: state.diplomacy.map((relation) => ({ ...relation })),
    nextEntityId: state.nextEntityId,
    operationCount: state.operationCount,
    residencies: state.residencies.map((residency) => ({ ...residency })),
    rng: [...state.rng],
    routes: state.routes.map((route) => ({ ...route })),
    ruins: state.ruins.map((ruin) => ({ ...ruin })),
    settlements: state.settlements.map((settlement) => ({
      ...settlement,
      reserves: { ...settlement.reserves },
      territoryHistory: settlement.territoryHistory.map((history) => ({ ...history })),
    })),
    tick: state.tick,
    tileOwners: [...state.tileOwners],
  });
}
