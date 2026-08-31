import { deriveXoshiro128State, type Xoshiro128State, Xoshiro128StarStar } from '../random';
import {
  assertInterpersonalInvariants,
  childArrivalEligibilityEvidence,
  childArrivalEligibilityEvidenceMatchesRecord,
  childArrivalEligibilityEventMatches,
  compareOrdinalText,
  createInitialInterpersonalState,
  interpersonalDto,
  isDirectFamily,
  childIdsFor,
  guardianIdsFor,
  listRelationshipsForPerson,
  parentIdsFor,
  relationshipEventMatchesFamilyBond,
  relationshipEventMatchesSocialEdge,
  retainSharedEventReferences,
  synchronizeInterpersonalPeople,
  type FamilyBond,
  type ChildArrivalEligibilityEvidence,
  type InterpersonalPersonInput,
  type InterpersonalState,
} from '../relationships';
import {
  advanceInterpersonalLifecycle,
  relationshipDecisionInfluence,
  selectPreferredRelatedPerson,
  type RelationshipLifecycleEvent,
  type RelationshipPersonContext,
} from '../relationships/lifecycle';

export const SOCIETY_PULSE_TICKS = 1_000;
export const NORMAL_YEAR_TICKS = 100_000;
export const ACCELERATED_YEAR_TICKS = 5_000;
export const MAX_SOCIETY_RESIDENTS = 64;
export const MAX_BIOGRAPHY_EVENT_IDS = 16;

export type EconomicRole = 'grower' | 'maker' | 'trader' | 'caretaker';
export type GovernmentKind = 'council' | 'stewardship';
export type EntityKind =
  'person' | 'structure' | 'household' | 'culture' | 'group' | 'institution' | 'world';
export type OfferKind = 'meal' | 'tool';

export interface SocietyEntityRef {
  readonly kind: EntityKind;
  readonly id: number;
}

export interface SocietyPersonObservation {
  readonly id: number;
  readonly alive: boolean;
  readonly health: number;
  readonly tileIndex: number;
  readonly traits: readonly [number, number, number, number];
  readonly skills: readonly [number, number, number, number];
  readonly occupation: string;
  readonly recentEventIds: readonly number[];
}

export interface CommunalStockpileInput {
  readonly food: number;
  readonly timber: number;
  readonly stone: number;
  readonly water: number;
}

export interface SocietyInitializationInput {
  readonly seed: Xoshiro128State;
  readonly tick: number;
  readonly centerTileIndex: number;
  readonly yearTicks: number;
  readonly people: readonly SocietyPersonObservation[];
}

export interface SocietyPulseInput {
  readonly tick: number;
  readonly centerTileIndex: number;
  readonly worldWidth: number;
  readonly people: readonly SocietyPersonObservation[];
  readonly communalStockpile: CommunalStockpileInput;
  readonly shelterCapacity: number;
}

export interface SocietyPerson {
  readonly id: number;
  readonly name: string;
  readonly origin: 'founder' | 'birth' | 'migration';
  readonly alive: boolean;
  readonly birthTick: number;
  readonly deathTick: number;
  readonly generation: number;
  readonly parentIds: readonly [number, number];
  readonly householdId: number;
  readonly cultureId: number;
  readonly role: EconomicRole;
  readonly tileIndex: number;
  readonly health: number;
  readonly biographyEventIds: readonly number[];
}

export interface SocietyHousehold {
  readonly id: number;
  readonly cultureId: number;
  readonly adultIds: readonly number[];
  readonly credits: number;
  readonly meals: number;
  readonly tools: number;
  readonly lastChildArrivalTick: number;
}

export interface SocietyCulture {
  readonly id: number;
  readonly name: string;
  readonly preference: EconomicRole;
  readonly belief: string;
  readonly tradition: string;
  readonly architectureStyle: string;
  readonly familyPolicy: 'pair-bond' | 'communal-guardianship';
  readonly partnershipLimit: 1 | 2;
}

export interface SocietyGroup {
  readonly id: number;
  readonly cultureId: number;
  readonly name: string;
  readonly memberIds: readonly number[];
}

export interface SocietyInstitution {
  readonly id: number;
  readonly kind: 'council';
  readonly leaderId: number;
  readonly government: GovernmentKind;
  readonly changedTick: number;
}

export interface SocietyOffer {
  readonly id: number;
  readonly kind: OfferKind;
  readonly sellerHouseholdId: number;
  readonly buyerHouseholdId: number;
  readonly amount: number;
  readonly price: number;
  readonly fulfilledAmount: number;
  readonly transportDemand: number;
}

export interface BiographyFact {
  readonly personId: number;
  readonly kind: string;
  readonly source: SocietyEntityRef;
  readonly target: SocietyEntityRef;
  readonly summary: string;
}

export interface SocietyState {
  readonly yearTicks: number;
  readonly lastTick: number;
  readonly centerTileIndex: number;
  readonly nextPersonId: number;
  readonly nextHouseholdId: number;
  readonly nextOfferId: number;
  readonly people: readonly SocietyPerson[];
  readonly households: readonly SocietyHousehold[];
  readonly cultures: readonly SocietyCulture[];
  readonly groups: readonly SocietyGroup[];
  readonly institution: SocietyInstitution;
  readonly offers: readonly SocietyOffer[];
  readonly interpersonal: InterpersonalState;
  readonly scarcity: number;
  readonly inequality: number;
  readonly stability: number;
  readonly collapsed: boolean;
  readonly pendingBiographyFacts: readonly BiographyFact[];
  readonly rng: Xoshiro128State;
  readonly operationCount: number;
}

export interface SocietyPersonDraft {
  readonly id: number;
  readonly name: string;
  readonly birthTick: number;
  readonly generation: number;
  readonly parentIds: readonly [number, number];
  readonly householdId: number;
  readonly cultureId: number;
  readonly role: EconomicRole;
  readonly tileIndex: number;
  readonly origin: 'birth' | 'migration';
}

export interface SocietyNeedReliefPatch {
  readonly personId: number;
  readonly hungerRelief: number;
  readonly thirstRelief: number;
}

export interface SocietySkillPatch {
  readonly personId: number;
  readonly skillIndex: 0 | 1 | 2 | 3;
  readonly amount: number;
}

export interface SocietyEventDraft {
  readonly kind: string;
  readonly subject: SocietyEntityRef;
  readonly target: SocietyEntityRef;
  readonly amount: number;
  readonly summary: string;
  readonly childArrivalEligibility?: ChildArrivalEligibilityEvidence;
}

export interface SocietyPulseResult {
  readonly society: SocietyState;
  readonly communalStockpile: CommunalStockpileInput;
  readonly personBirthDrafts: readonly SocietyPersonDraft[];
  readonly personMigrationDrafts: readonly SocietyPersonDraft[];
  readonly deathPersonIds: readonly number[];
  readonly roleOrNeedReliefPatches: readonly SocietyNeedReliefPatch[];
  readonly skillPatches: readonly SocietySkillPatch[];
  readonly events: readonly SocietyEventDraft[];
}

export interface SocietyAuthoritativeEvent {
  readonly id: number;
  readonly tick: number;
  readonly kind: string;
  readonly subject: SocietyEntityRef;
  readonly target: SocietyEntityRef;
  readonly summary: string;
  readonly childArrivalEligibility?: ChildArrivalEligibilityEvidence;
}

export interface SocietySummary {
  readonly livingPeople: number;
  readonly households: number;
  readonly cultures: number;
  readonly stability: number;
  readonly inequality: number;
  readonly scarcity: number;
  readonly collapsed: boolean;
  readonly operationCount: number;
}

const GIVEN_NAMES = Object.freeze([
  'Ari',
  'Bela',
  'Cato',
  'Dara',
  'Eren',
  'Fia',
  'Galen',
  'Hana',
  'Ivo',
  'Jora',
  'Kian',
  'Luma',
] as const);
const CULTURE_STEMS = Object.freeze([
  'Aster',
  'Briar',
  'Cinder',
  'Dawn',
  'Ember',
  'Flint',
] as const);
const BELIEFS = Object.freeze(['stewardship', 'reciprocity', 'craft', 'memory'] as const);
const TRADITIONS = Object.freeze([
  'shared meals',
  'river songs',
  'tool lending',
  'seasonal councils',
] as const);
const STYLES = Object.freeze([
  'timber halls',
  'stone courts',
  'woven roofs',
  'sunken hearths',
] as const);
const ROLES = Object.freeze([
  'grower',
  'maker',
  'trader',
  'caretaker',
] as const satisfies readonly EconomicRole[]);
const GOVERNMENTS = Object.freeze([
  'council',
  'stewardship',
] as const satisfies readonly GovernmentKind[]);
const ENTITY_KINDS = Object.freeze([
  'person',
  'structure',
  'household',
  'culture',
  'group',
  'institution',
  'world',
] as const satisfies readonly EntityKind[]);
const OFFER_KINDS = Object.freeze(['meal', 'tool'] as const satisfies readonly OfferKind[]);

function assertInteger(
  value: number,
  label: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a safe integer in range.`);
  }
}

function compareId<T extends { readonly id: number }>(left: T, right: T): number {
  return left.id - right.id;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}

function assertSortedUnique(values: readonly number[], label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) {
      throw new Error(`${label} must be sorted and unique.`);
    }
  }
}

function assertBoundedString(value: string, label: string, maximum = 64): void {
  if (value.length === 0 || value.length > maximum) throw new Error(`${label} is invalid.`);
}

function assertObservation(observation: SocietyPersonObservation): void {
  assertInteger(observation.id, 'Person observation id', 1);
  assertInteger(observation.health, 'Person observation health', 0, 100);
  assertInteger(observation.tileIndex, 'Person observation tile index');
  if (observation.alive !== observation.health > 0) {
    throw new Error('Person observation life and health are inconsistent.');
  }
  for (const trait of observation.traits) assertInteger(trait, 'Person observation trait', 0, 100);
  for (const skill of observation.skills) assertInteger(skill, 'Person observation skill', 0, 100);
  if (observation.recentEventIds.length > 16)
    throw new Error('Person observation event history is too long.');
  for (const eventId of observation.recentEventIds)
    assertInteger(eventId, 'Person observation event id', 1);
  assertSortedUnique(observation.recentEventIds, 'Person observation event ids');
}

function assertStockpile(stockpile: CommunalStockpileInput): void {
  assertInteger(stockpile.food, 'Communal food');
  assertInteger(stockpile.timber, 'Communal timber');
  assertInteger(stockpile.stone, 'Communal stone');
  assertInteger(stockpile.water, 'Communal water');
}

function roleFor(observation: SocietyPersonObservation, preference: EconomicRole): EconomicRole {
  const candidates = ROLES.map((role, index) => ({
    role,
    score:
      (observation.skills[index] ?? 0) +
      (role === preference ? 15 : 0) +
      (observation.occupation === role ? 10 : 0),
  }));
  return candidates.sort(
    (left, right) =>
      right.score - left.score || (left.role < right.role ? -1 : left.role > right.role ? 1 : 0),
  )[0]!.role;
}

function nameFor(rng: Xoshiro128StarStar, id: number, cultureId: number): string {
  return `${GIVEN_NAMES[rng.nextInt(GIVEN_NAMES.length)]!}-${cultureId}-${id}`;
}

function ref(kind: EntityKind, id: number): SocietyEntityRef {
  return Object.freeze({ kind, id });
}

function zeroParents(): readonly [number, number] {
  return [0, 0];
}

function summary(text: string): string {
  if (text.length > 160) throw new Error('Society event summaries must be at most 160 characters.');
  return text;
}

function event(
  kind: string,
  subject: SocietyEntityRef,
  target: SocietyEntityRef,
  amount: number,
  text: string,
  eligibilityEvidence?: ChildArrivalEligibilityEvidence,
): SocietyEventDraft {
  assertInteger(amount, 'Society event amount');
  return Object.freeze({
    kind,
    subject,
    target,
    amount,
    summary: summary(text),
    ...(eligibilityEvidence === undefined ? {} : { childArrivalEligibility: eligibilityEvidence }),
  });
}

function adultIdsFor(
  people: readonly SocietyPerson[],
  householdId: number,
  tick: number,
  yearTicks: number,
): readonly number[] {
  return Object.freeze(
    people
      .filter(
        (person) =>
          person.alive &&
          person.householdId === householdId &&
          tick - person.birthTick >= 18 * yearTicks,
      )
      .map((person) => person.id)
      .sort((left, right) => left - right),
  );
}

function inequalityFor(households: readonly SocietyHousehold[]): number {
  if (households.length === 0) return 0;
  const wealth = households.map(
    (household) => household.credits + household.meals * 2 + household.tools * 4,
  );
  return Math.max(...wealth) - Math.min(...wealth);
}

function chooseLeader(
  people: readonly SocietyPerson[],
  households: readonly SocietyHousehold[],
  interpersonal?: InterpersonalState,
): number {
  const wealthByHousehold = new Map(
    households.map((household) => [household.id, household.credits]),
  );
  const candidates = people
    .filter((person) => person.alive)
    .sort(
      (left, right) =>
        (wealthByHousehold.get(right.householdId) ?? 0) -
          (wealthByHousehold.get(left.householdId) ?? 0) || left.id - right.id,
    )
    .slice(0, 4);
  if (interpersonal === undefined || candidates.length < 2) return candidates[0]?.id ?? 0;
  const baseUtility = new Map(
    candidates.map((candidate) => [
      candidate.id,
      (wealthByHousehold.get(candidate.householdId) ?? 0) * 4 +
        (candidate.role === 'caretaker' ? 8 : candidate.role === 'trader' ? 4 : 0),
    ]),
  );
  const support = new Map(candidates.map((candidate) => [candidate.id, 0]));
  for (const voter of people.filter((person) => person.alive).sort(compareId)) {
    const selected = selectPreferredRelatedPerson(
      interpersonal,
      voter.id,
      candidates.map((candidate) => candidate.id),
      'politics',
      baseUtility,
    );
    if (selected !== null) support.set(selected, (support.get(selected) ?? 0) + 1);
  }
  const leader = candidates.sort(
    (left, right) =>
      (baseUtility.get(right.id) ?? 0) +
        (support.get(right.id) ?? 0) * 12 -
        ((baseUtility.get(left.id) ?? 0) + (support.get(left.id) ?? 0) * 12) || left.id - right.id,
  )[0];
  return leader?.id ?? 0;
}

function matchingFact(fact: BiographyFact, source: SocietyAuthoritativeEvent): boolean {
  return (
    fact.kind === source.kind &&
    fact.summary === source.summary &&
    source.subject.kind === fact.source.kind &&
    source.subject.id === fact.source.id &&
    source.target.kind === fact.target.kind &&
    source.target.id === fact.target.id
  );
}

function relationshipEventImportance(kind: string): number {
  if (
    [
      'person-born',
      'person-died',
      'long-term-partnership-formed',
      'partnership-separated',
      'partner-widowed',
      'relationship-reconciled',
      'family-estranged',
      'guardianship-formed',
      'family-inheritance',
      'household-migrated',
      'pair-bond-child-arrival',
      'communal-child-arrival',
    ].includes(kind)
  )
    return 3;
  if (
    [
      'friendship-formed',
      'close-friendship-formed',
      'friendship-ended',
      'rivalry-formed',
      'enmity-formed',
      'mentorship-formed',
      'partnership-formed',
      'sibling-bond-formed',
      'parent-child-bond-changed',
      'resource-shared',
      'crisis-assisted',
      'knowledge-shared',
      'conflict',
      'household-formed',
      'household-split',
      'household-merged',
    ].includes(kind)
  )
    return 2;
  return 1;
}

function biographyMilestoneGroup(kind: string): string | null {
  if (
    [
      'person-born',
      'sibling-bond-formed',
      'parent-child-bond-changed',
      'guardianship-formed',
      'pair-bond-child-arrival',
      'communal-child-arrival',
    ].includes(kind)
  )
    return 'childhood-family';
  if (
    [
      'relationship-formed',
      'friendship-formed',
      'close-friendship-formed',
      'mentorship-formed',
    ].includes(kind)
  )
    return 'friendship';
  if (
    [
      'partnership-formed',
      'long-term-partnership-formed',
      'household-formed',
      'household-merged',
      'household-migrated',
    ].includes(kind)
  )
    return 'partnership-household';
  if (
    [
      'friendship-ended',
      'rivalry-formed',
      'enmity-formed',
      'family-estranged',
      'partnership-separated',
      'household-split',
      'conflict',
    ].includes(kind)
  )
    return 'conflict-loss';
  if (['relationship-reconciled', 'partner-widowed', 'person-died'].includes(kind))
    return 'resolution-bereavement';
  return null;
}

function retainBiographyEventIds(
  existingIds: readonly number[],
  addedIds: readonly number[],
  historicalSources: readonly SocietyAuthoritativeEvent[],
): readonly number[] {
  const candidates = [...new Set([...existingIds, ...addedIds])];
  if (candidates.length <= MAX_BIOGRAPHY_EVENT_IDS)
    return Object.freeze(candidates.sort((left, right) => left - right));

  const sourceById = new Map(historicalSources.map((source) => [source.id, source]));
  const selected = new Set<number>();
  const milestoneGroups = new Map<string, SocietyAuthoritativeEvent[]>();
  for (const id of candidates) {
    const source = sourceById.get(id);
    if (source === undefined) continue;
    const group = biographyMilestoneGroup(source.kind);
    if (group === null) continue;
    const grouped = milestoneGroups.get(group);
    if (grouped === undefined) milestoneGroups.set(group, [source]);
    else grouped.push(source);
  }
  for (const grouped of milestoneGroups.values()) {
    grouped.sort((left, right) => left.tick - right.tick || left.id - right.id);
    selected.add(grouped[0]!.id);
  }
  const ranked = candidates
    .filter((id) => !selected.has(id))
    .sort((leftId, rightId) => {
      const left = sourceById.get(leftId);
      const right = sourceById.get(rightId);
      return (
        relationshipEventImportance(right?.kind ?? '') -
          relationshipEventImportance(left?.kind ?? '') ||
        (right?.tick ?? 0) - (left?.tick ?? 0) ||
        rightId - leftId
      );
    });
  for (const id of ranked) {
    if (selected.size >= MAX_BIOGRAPHY_EVENT_IDS) break;
    selected.add(id);
  }
  return Object.freeze([...selected].sort((left, right) => left - right));
}

function attachInterpersonalEventIds(
  state: InterpersonalState,
  sourceEvents: readonly SocietyAuthoritativeEvent[],
): InterpersonalState {
  const referenceFor = (source: SocietyAuthoritativeEvent) =>
    Object.freeze({
      eventId: source.id,
      importance: relationshipEventImportance(source.kind),
      tick: source.tick,
    });
  const identityFor = (source: SocietyAuthoritativeEvent) => ({
    kind: source.kind,
    subjectKind: source.subject.kind,
    subjectId: source.subject.id,
    targetKind: source.target.kind,
    targetId: source.target.id,
  });
  const active = state.active.map((edge) => {
    const matching = sourceEvents.filter((source) =>
      relationshipEventMatchesSocialEdge(edge, identityFor(source)),
    );
    return matching.length === 0
      ? edge
      : Object.freeze({
          ...edge,
          sharedEvents: retainSharedEventReferences([
            ...edge.sharedEvents,
            ...matching.map(referenceFor),
          ]),
        });
  });
  const archived = state.archived.map((edge) => {
    const matching = sourceEvents.filter((source) =>
      relationshipEventMatchesSocialEdge(edge, identityFor(source)),
    );
    return matching.length === 0
      ? edge
      : Object.freeze({
          ...edge,
          sharedEvents: retainSharedEventReferences([
            ...edge.sharedEvents,
            ...matching.map(referenceFor),
          ]),
        });
  });
  const familyBonds = state.familyBonds.map((bond) => {
    const matching = sourceEvents.filter((source) =>
      relationshipEventMatchesFamilyBond(bond, identityFor(source)),
    );
    if (matching.length === 0) return bond;
    const formation = matching.find(
      (source) => source.kind === 'person-born' || source.kind === 'guardianship-formed',
    );
    return Object.freeze({
      ...bond,
      formedEventId: bond.formedEventId !== 0 ? bond.formedEventId : (formation?.id ?? 0),
      sharedEvents: retainSharedEventReferences([
        ...bond.sharedEvents,
        ...matching.map(referenceFor),
      ]),
    });
  });
  const childArrivals = state.childArrivals.map((arrival) => {
    if (arrival.eventId !== 0 && arrival.eligibilityEventId !== 0) return arrival;
    const formation = sourceEvents.find(
      (source) =>
        source.kind === 'person-born' &&
        source.subject.kind === 'person' &&
        source.subject.id === arrival.childId &&
        source.target.kind === 'household' &&
        source.target.id === arrival.householdId,
    );
    const eligibility = sourceEvents.find(
      (source) =>
        source.tick === arrival.tick &&
        childArrivalEligibilityEventMatches(arrival, identityFor(source)) &&
        source.childArrivalEligibility !== undefined &&
        childArrivalEligibilityEvidenceMatchesRecord(arrival, source.childArrivalEligibility),
    );
    return Object.freeze({
      ...arrival,
      eventId: arrival.eventId !== 0 ? arrival.eventId : (formation?.id ?? 0),
      eligibilityEventId:
        arrival.eligibilityEventId !== 0 ? arrival.eligibilityEventId : (eligibility?.id ?? 0),
    });
  });
  return Object.freeze({
    ...state,
    active: Object.freeze(active),
    archived: Object.freeze(archived),
    familyBonds: Object.freeze(familyBonds),
    childArrivals: Object.freeze(childArrivals),
  });
}

function civilPeriodTicks(yearTicks: number): number {
  return Math.max(
    SOCIETY_PULSE_TICKS,
    Math.floor(yearTicks / 4 / SOCIETY_PULSE_TICKS) * SOCIETY_PULSE_TICKS,
  );
}

function transportDemand(leftTile: number, rightTile: number, worldWidth: number): number {
  return (
    Math.abs((leftTile % worldWidth) - (rightTile % worldWidth)) +
    Math.abs(Math.trunc(leftTile / worldWidth) - Math.trunc(rightTile / worldWidth))
  );
}

function addBiographyFact(
  facts: BiographyFact[],
  personId: number,
  draft: SocietyEventDraft,
): void {
  facts.push({
    personId,
    kind: draft.kind,
    source: draft.subject,
    target: draft.target,
    summary: draft.summary,
  });
}

function cultureIdentity(culture: SocietyCulture): string {
  return [culture.preference, culture.belief, culture.tradition, culture.architectureStyle].join(
    '\u001f',
  );
}

function interpersonalPeople(
  people: readonly SocietyPerson[],
): readonly InterpersonalPersonInput[] {
  return Object.freeze(
    people.map((person) =>
      Object.freeze({
        id: person.id,
        alive: person.alive,
        birthTick: person.birthTick,
        parentIds: person.parentIds,
        householdId: person.householdId,
      }),
    ),
  );
}

function relationshipPeople(
  people: readonly SocietyPerson[],
  observations: ReadonlyMap<number, SocietyPersonObservation>,
): readonly RelationshipPersonContext[] {
  return Object.freeze(
    people.map((person) => {
      const observation = observations.get(person.id);
      return Object.freeze({
        ...interpersonalPeople([person])[0]!,
        name: person.name,
        cultureId: person.cultureId,
        tileIndex: person.tileIndex,
        traits: observation?.traits ?? ([50, 50, 50, 50] as const),
        skills: observation?.skills ?? ([25, 25, 25, 25] as const),
        occupation: observation?.occupation ?? person.role,
        recentEventIds: observation?.recentEventIds ?? Object.freeze([]),
      });
    }),
  );
}

function relationshipEventDraft(draft: RelationshipLifecycleEvent): SocietyEventDraft {
  return event(
    draft.kind,
    ref('person', draft.firstPersonId),
    ref('person', draft.secondPersonId),
    draft.amount,
    draft.summary,
  );
}

/** Creates a deterministic, self-contained M4 social graph from current authoritative people. */
export function createInitialSociety(input: SocietyInitializationInput): SocietyState {
  assertInteger(input.tick, 'Society initial tick');
  assertInteger(input.centerTileIndex, 'Society center tile');
  if (input.yearTicks !== NORMAL_YEAR_TICKS && input.yearTicks !== ACCELERATED_YEAR_TICKS) {
    throw new Error('Society yearTicks must select the normal or accelerated persisted calendar.');
  }
  if (input.people.length > MAX_SOCIETY_RESIDENTS)
    throw new Error('Society resident cap exceeded.');
  const observations = [...input.people].sort(compareId);
  for (const observation of observations) assertObservation(observation);
  for (let index = 1; index < observations.length; index += 1) {
    if (observations[index - 1]!.id === observations[index]!.id)
      throw new Error('Person observations must be unique.');
  }
  const rng = new Xoshiro128StarStar(deriveXoshiro128State(input.seed, 'm4-society'));
  const cultures: SocietyCulture[] = [1, 2].map((id) =>
    Object.freeze({
      id,
      name: `${CULTURE_STEMS[rng.nextInt(CULTURE_STEMS.length)]!} folk`,
      preference: ROLES[rng.nextInt(ROLES.length)]!,
      belief: BELIEFS[rng.nextInt(BELIEFS.length)]!,
      tradition: TRADITIONS[rng.nextInt(TRADITIONS.length)]!,
      architectureStyle: STYLES[rng.nextInt(STYLES.length)]!,
      familyPolicy: id === 1 ? ('pair-bond' as const) : ('communal-guardianship' as const),
      partnershipLimit: id === 1 ? (1 as const) : (2 as const),
    }),
  );
  if (cultureIdentity(cultures[0]!) === cultureIdentity(cultures[1]!)) {
    const duplicate = cultures[1]!;
    cultures[1] = Object.freeze({
      ...duplicate,
      preference: ROLES[(ROLES.indexOf(duplicate.preference) + 1) % ROLES.length]!,
    });
  }
  if (cultures[0]!.name === cultures[1]!.name) {
    const duplicate = cultures[1]!;
    const stem = duplicate.name.slice(0, -' folk'.length);
    const nextStem =
      CULTURE_STEMS[
        (CULTURE_STEMS.indexOf(stem as (typeof CULTURE_STEMS)[number]) + 1) % CULTURE_STEMS.length
      ]!;
    cultures[1] = Object.freeze({ ...duplicate, name: `${nextStem} folk` });
  }
  const people: SocietyPerson[] = observations.map((observation, index) => {
    const cultureId = (index % cultures.length) + 1;
    const householdId = Math.floor(index / 2) + 1;
    return Object.freeze({
      id: observation.id,
      name: nameFor(rng, observation.id, cultureId),
      origin: 'founder',
      alive: observation.alive,
      birthTick: input.tick - 24 * input.yearTicks,
      deathTick: 0,
      generation: 0,
      parentIds: zeroParents(),
      householdId,
      cultureId,
      role: roleFor(observation, cultures[cultureId - 1]!.preference),
      tileIndex: observation.tileIndex,
      health: observation.health,
      biographyEventIds: Object.freeze([]),
    });
  });
  const householdCount = Math.ceil(people.length / 2);
  const households: SocietyHousehold[] = Array.from({ length: householdCount }, (_, index) => {
    const id = index + 1;
    const cultureId = people.find((person) => person.householdId === id)?.cultureId ?? 1;
    return Object.freeze({
      id,
      cultureId,
      adultIds: adultIdsFor(people, id, input.tick, input.yearTicks),
      credits: 12 + id * 3,
      meals: 4,
      tools: 1,
      lastChildArrivalTick: input.tick,
    });
  });
  const groups: SocietyGroup[] = cultures.map((culture) =>
    Object.freeze({
      id: culture.id,
      cultureId: culture.id,
      name: `${culture.name} circle`,
      memberIds: Object.freeze(
        people.filter((person) => person.cultureId === culture.id).map((person) => person.id),
      ),
    }),
  );
  const institution = Object.freeze({
    id: 1,
    kind: 'council' as const,
    leaderId: chooseLeader(people, households),
    government: 'council' as const,
    changedTick: input.tick,
  });
  const state: SocietyState = Object.freeze({
    yearTicks: input.yearTicks,
    lastTick: input.tick,
    centerTileIndex: input.centerTileIndex,
    nextPersonId: (people.at(-1)?.id ?? 0) + 1,
    nextHouseholdId: householdCount + 1,
    nextOfferId: 1,
    people: Object.freeze(people),
    households: Object.freeze(households),
    cultures: Object.freeze(cultures),
    groups: Object.freeze(groups),
    institution,
    offers: Object.freeze([]),
    interpersonal: createInitialInterpersonalState(
      input.seed,
      input.tick,
      interpersonalPeople(people),
    ),
    scarcity: 0,
    inequality: inequalityFor(households),
    stability: 80,
    collapsed: false,
    pendingBiographyFacts: Object.freeze([]),
    rng: rng.save(),
    operationCount: people.length,
  });
  assertSocietyInvariants(state);
  return state;
}

/** Advances the isolated M4 social layer once per fixed 1,000-tick society pulse. */
export function advanceSociety(state: SocietyState, input: SocietyPulseInput): SocietyPulseResult {
  assertSocietyInvariants(state);
  assertInteger(input.tick, 'Society pulse tick');
  assertInteger(input.centerTileIndex, 'Society center tile');
  assertInteger(input.worldWidth, 'Society world width', 1);
  assertInteger(input.shelterCapacity, 'Society shelter capacity');
  assertStockpile(input.communalStockpile);
  const nextBoundary = (Math.floor(state.lastTick / SOCIETY_PULSE_TICKS) + 1) * SOCIETY_PULSE_TICKS;
  if (input.tick !== nextBoundary) {
    throw new Error('Society pulses must use the next consecutive 1,000-tick boundary.');
  }
  if (input.people.length > MAX_SOCIETY_RESIDENTS)
    throw new Error('Society resident cap exceeded.');
  const observations = [...input.people].sort(compareId);
  for (const observation of observations) assertObservation(observation);
  for (let index = 1; index < observations.length; index += 1) {
    if (observations[index - 1]!.id === observations[index]!.id) {
      throw new Error('Person observations must be unique.');
    }
  }
  const observationById = new Map(observations.map((observation) => [observation.id, observation]));
  const rng = new Xoshiro128StarStar(state.rng);
  const events: SocietyEventDraft[] = [];
  const facts: BiographyFact[] = [...state.pendingBiographyFacts];
  const deathIds: number[] = [];
  let people = state.people.map((person) => {
    const observation = observationById.get(person.id);
    if (observation === undefined) return person;
    const culture = state.cultures.find((candidate) => candidate.id === person.cultureId)!;
    if (person.alive && !observation.alive) {
      deathIds.push(person.id);
      const text = `${person.name} died from observed health loss.`;
      events.push(
        event(
          'person-died',
          ref('person', person.id),
          ref('household', person.householdId),
          0,
          text,
        ),
      );
      facts.push({
        personId: person.id,
        kind: 'person-died',
        source: ref('person', person.id),
        target: ref('household', person.householdId),
        summary: text,
      });
    }
    return Object.freeze({
      ...person,
      alive: observation.alive,
      deathTick: observation.alive ? person.deathTick : person.deathTick || input.tick,
      tileIndex: observation.tileIndex,
      health: observation.health,
      role: roleFor(observation, culture.preference),
    });
  });
  if (input.tick % civilPeriodTicks(state.yearTicks) !== 0) {
    const households = state.households.map((household) =>
      Object.freeze({
        ...household,
        adultIds: Object.freeze(
          people
            .filter(
              (person) =>
                person.alive &&
                person.householdId === household.id &&
                input.tick - person.birthTick >= 18 * state.yearTicks,
            )
            .map((person) => person.id)
            .sort((left, right) => left - right),
        ),
      }),
    );
    const groups = state.groups.map((group) =>
      Object.freeze({
        ...group,
        memberIds: Object.freeze(
          people
            .filter((person) => person.alive && person.cultureId === group.cultureId)
            .map((person) => person.id)
            .sort((left, right) => left - right),
        ),
      }),
    );
    let institution = state.institution;
    if (
      institution.leaderId !== 0 &&
      !people.some((person) => person.id === institution.leaderId && person.alive)
    ) {
      const leaderId = chooseLeader(people, households, state.interpersonal);
      institution = Object.freeze({ ...institution, leaderId, changedTick: input.tick });
      const governmentDraft = event(
        'government-changed',
        ref('institution', institution.id),
        leaderId === 0 ? ref('world', 0) : ref('person', leaderId),
        state.stability,
        `The council selected ${people.find((person) => person.id === leaderId)?.name ?? 'no leader'} for ${institution.government}.`,
      );
      events.push(governmentDraft);
      if (leaderId !== 0) addBiographyFact(facts, leaderId, governmentDraft);
    }
    const next: SocietyState = Object.freeze({
      ...state,
      lastTick: input.tick,
      centerTileIndex: input.centerTileIndex,
      people: Object.freeze(people),
      interpersonal: synchronizeInterpersonalPeople(
        state.interpersonal,
        input.tick,
        interpersonalPeople(people),
      ),
      households: Object.freeze(households),
      groups: Object.freeze(groups),
      institution,
      pendingBiographyFacts: Object.freeze(facts),
      operationCount: state.operationCount + people.length + events.length,
    });
    assertSocietyInvariants(next);
    return Object.freeze({
      society: next,
      communalStockpile: input.communalStockpile,
      personBirthDrafts: Object.freeze([]),
      personMigrationDrafts: Object.freeze([]),
      deathPersonIds: Object.freeze(deathIds.sort((left, right) => left - right)),
      roleOrNeedReliefPatches: Object.freeze([]),
      skillPatches: Object.freeze([]),
      events: Object.freeze(events),
    });
  }
  const knownIds = new Set(people.map((person) => person.id));
  for (const observation of observations) {
    if (knownIds.has(observation.id)) continue;
    if (people.length >= MAX_SOCIETY_RESIDENTS) throw new Error('Society resident cap exceeded.');
    const cultureId = (observation.id % state.cultures.length) + 1;
    const culture = state.cultures[cultureId - 1]!;
    people = [
      ...people,
      Object.freeze({
        id: observation.id,
        name: nameFor(rng, observation.id, cultureId),
        origin: 'migration',
        alive: observation.alive,
        birthTick: input.tick - 24 * state.yearTicks,
        deathTick: observation.alive ? 0 : input.tick,
        generation: 0,
        parentIds: zeroParents(),
        householdId: state.nextHouseholdId,
        cultureId,
        role: roleFor(observation, culture.preference),
        tileIndex: observation.tileIndex,
        health: observation.health,
        biographyEventIds: Object.freeze([]),
      }),
    ];
  }
  people = people.sort(compareId);
  let nextHouseholdId = Math.max(
    state.nextHouseholdId,
    ...people.map((person) => person.householdId + 1),
  );
  let households = state.households.map((household) => ({ ...household }));
  for (const person of people) {
    if (!households.some((household) => household.id === person.householdId)) {
      households.push({
        id: person.householdId,
        cultureId: person.cultureId,
        adultIds: Object.freeze([]),
        credits: 10,
        meals: 2,
        tools: 0,
        lastChildArrivalTick: input.tick,
      });
    }
  }
  households = households.map((household) => ({
    ...household,
    adultIds: Object.freeze(
      people
        .filter(
          (person) =>
            person.alive &&
            person.householdId === household.id &&
            input.tick - person.birthTick >= 18 * state.yearTicks,
        )
        .map((person) => person.id)
        .sort((left, right) => left - right),
    ),
  }));
  const shortage = Math.max(
    0,
    people.filter((person) => person.alive).length * 2 - input.communalStockpile.food,
  );
  const scarcity = clamp(
    shortage * 10 +
      (input.shelterCapacity < people.filter((person) => person.alive).length ? 25 : 0),
    0,
    100,
  );
  let stockpile: CommunalStockpileInput = { ...input.communalStockpile };
  const mealWorker = people.find(
    (person) =>
      person.alive &&
      person.role === 'caretaker' &&
      households.some((household) => household.id === person.householdId),
  );
  const toolWorker = people.find(
    (person) =>
      person.alive &&
      person.role === 'maker' &&
      households.some((household) => household.id === person.householdId),
  );
  const recipeMeals = mealWorker === undefined ? 0 : Math.min(4, stockpile.food);
  const recipeTools = toolWorker === undefined ? 0 : Math.min(2, stockpile.timber, stockpile.stone);
  stockpile = Object.freeze({
    food: stockpile.food - recipeMeals,
    timber: stockpile.timber - recipeTools,
    stone: stockpile.stone - recipeTools,
    water: stockpile.water,
  });
  const mealHousehold = households.find((household) => household.id === mealWorker?.householdId);
  const toolHousehold = households.find((household) => household.id === toolWorker?.householdId);
  if (mealHousehold !== undefined && recipeMeals > 0) {
    mealHousehold.meals += recipeMeals;
  }
  if (toolHousehold !== undefined && recipeTools > 0) {
    toolHousehold.tools += recipeTools;
    events.push(
      event(
        'tools-crafted',
        ref('person', toolWorker!.id),
        ref('household', toolHousehold.id),
        recipeTools,
        `${toolWorker!.name} crafted ${recipeTools} tools from timber and stone.`,
      ),
    );
  }

  const sortedHouseholds = households.slice().sort(compareId);
  const seller = sortedHouseholds
    .slice()
    .sort((left, right) => right.meals - left.meals || left.id - right.id)[0];
  const buyer = sortedHouseholds
    .slice()
    .sort((left, right) => left.meals - right.meals || left.id - right.id)[0];
  const offers: SocietyOffer[] = [];
  let nextOfferId = state.nextOfferId;
  if (
    seller !== undefined &&
    buyer !== undefined &&
    seller.id !== buyer.id &&
    seller.meals > buyer.meals &&
    buyer.credits > 0
  ) {
    const amount = Math.min(2, seller.meals - buyer.meals, buyer.credits);
    const price = clamp(1 + Math.trunc(scarcity / 25), 1, 5);
    const fulfilledAmount = Math.min(amount, Math.trunc(buyer.credits / price));
    seller.meals -= fulfilledAmount;
    buyer.meals += fulfilledAmount;
    seller.credits += fulfilledAmount * price;
    buyer.credits -= fulfilledAmount * price;
    const demand = transportDemand(
      people.find((person) => person.householdId === seller.id)?.tileIndex ?? input.centerTileIndex,
      people.find((person) => person.householdId === buyer.id)?.tileIndex ?? input.centerTileIndex,
      input.worldWidth,
    );
    offers.push(
      Object.freeze({
        id: nextOfferId++,
        kind: 'meal',
        sellerHouseholdId: seller.id,
        buyerHouseholdId: buyer.id,
        amount,
        price,
        fulfilledAmount,
        transportDemand: demand,
      }),
    );
    if (fulfilledAmount > 0)
      events.push(
        event(
          'local-exchange',
          ref('household', seller.id),
          ref('household', buyer.id),
          fulfilledAmount,
          `Household ${seller.id} exchanged ${fulfilledAmount} meals with household ${buyer.id}.`,
        ),
      );
  }
  const toolSeller = sortedHouseholds
    .slice()
    .sort((left, right) => right.tools - left.tools || left.id - right.id)[0];
  const toolBuyer = sortedHouseholds
    .slice()
    .sort((left, right) => left.tools - right.tools || left.id - right.id)[0];
  if (
    toolSeller !== undefined &&
    toolBuyer !== undefined &&
    toolSeller.id !== toolBuyer.id &&
    toolSeller.tools > toolBuyer.tools &&
    toolBuyer.credits >= 2
  ) {
    const amount = Math.min(1, toolSeller.tools - toolBuyer.tools);
    const price = clamp(2 + Math.trunc(scarcity / 20), 2, 7);
    const fulfilledAmount = Math.min(amount, Math.trunc(toolBuyer.credits / price));
    toolSeller.tools -= fulfilledAmount;
    toolBuyer.tools += fulfilledAmount;
    toolSeller.credits += fulfilledAmount * price;
    toolBuyer.credits -= fulfilledAmount * price;
    offers.push(
      Object.freeze({
        id: nextOfferId++,
        kind: 'tool',
        sellerHouseholdId: toolSeller.id,
        buyerHouseholdId: toolBuyer.id,
        amount,
        price,
        fulfilledAmount,
        transportDemand: transportDemand(
          people.find((person) => person.householdId === toolSeller.id)?.tileIndex ??
            input.centerTileIndex,
          people.find((person) => person.householdId === toolBuyer.id)?.tileIndex ??
            input.centerTileIndex,
          input.worldWidth,
        ),
      }),
    );
    if (fulfilledAmount > 0)
      events.push(
        event(
          'local-exchange',
          ref('household', toolSeller.id),
          ref('household', toolBuyer.id),
          fulfilledAmount,
          `Household ${toolSeller.id} exchanged ${fulfilledAmount} tools with household ${toolBuyer.id}.`,
        ),
      );
  }

  const years =
    Math.floor(input.tick / state.yearTicks) - Math.floor(state.lastTick / state.yearTicks);
  const skillPatches: SocietySkillPatch[] = [];
  const living = () => people.filter((person) => person.alive);
  if (years > 0) {
    people = people.map((person) => {
      const ageYears = Math.floor((input.tick - person.birthTick) / state.yearTicks);
      if (person.alive && (ageYears >= 78 || (scarcity >= 95 && person.health <= 20))) {
        deathIds.push(person.id);
        events.push(
          event(
            'person-died',
            ref('person', person.id),
            ref('household', person.householdId),
            ageYears,
            `${person.name} died after ${ageYears} calendar years.`,
          ),
        );
        facts.push({
          personId: person.id,
          kind: 'person-died',
          source: ref('person', person.id),
          target: ref('household', person.householdId),
          summary: `${person.name} died after ${ageYears} calendar years.`,
        });
        return Object.freeze({ ...person, alive: false, health: 0, deathTick: input.tick });
      }
      return person;
    });
  }
  let interpersonal = synchronizeInterpersonalPeople(
    state.interpersonal,
    input.tick,
    interpersonalPeople(people),
  );
  let lifecycleEvents: readonly RelationshipLifecycleEvent[] = Object.freeze([]);
  if (years > 0) {
    const lifecycle = advanceInterpersonalLifecycle(interpersonal, {
      tick: input.tick,
      yearTicks: state.yearTicks,
      worldWidth: input.worldWidth,
      people: relationshipPeople(people, observationById),
      cultures: state.cultures.map((culture) => ({
        id: culture.id,
        familyPolicy: culture.familyPolicy,
        partnershipLimit: culture.partnershipLimit,
      })),
      scarcity,
      stability: state.stability,
    });
    interpersonal = lifecycle.state;
    lifecycleEvents = lifecycle.events;
    for (const relationshipEvent of lifecycle.events) {
      const draft = relationshipEventDraft(relationshipEvent);
      events.push(draft);
      addBiographyFact(facts, relationshipEvent.firstPersonId, draft);
      addBiographyFact(facts, relationshipEvent.secondPersonId, draft);
    }
  }
  if (years > 0 && interpersonal.familyBonds.length > 0) {
    const changedFamilyBonds = interpersonal.familyBonds.map((bond) => {
      const parent = people.find((person) => person.id === bond.parentId);
      const child = people.find((person) => person.id === bond.childId);
      if (parent === undefined || child === undefined || !parent.alive || !child.alive) return bond;
      const sharedHousehold = parent.householdId === child.householdId;
      const positive = sharedHousehold ? 3 : 1;
      const grievance = Math.max(0, Math.trunc((scarcity - state.stability) / 20));
      const parentToChild = Object.freeze({
        affinity: clamp(bond.parentToChild.affinity + positive - grievance, 0, 100),
        trust: clamp(bond.parentToChild.trust + positive, 0, 100),
        closeness: clamp(bond.parentToChild.closeness + positive, 0, 100),
        commitment: clamp(bond.parentToChild.commitment + 2, 0, 100),
        grievance: clamp(bond.parentToChild.grievance + grievance - positive, 0, 100),
      });
      const childToParent = Object.freeze({
        affinity: clamp(bond.childToParent.affinity + positive - grievance, 0, 100),
        trust: clamp(bond.childToParent.trust + positive, 0, 100),
        closeness: clamp(bond.childToParent.closeness + positive, 0, 100),
        commitment: clamp(bond.childToParent.commitment + 1, 0, 100),
        grievance: clamp(bond.childToParent.grievance + grievance - positive, 0, 100),
      });
      const trend = positive >= grievance ? ('improving' as const) : ('deteriorating' as const);
      if (input.tick % (state.yearTicks * 5) === 0) {
        const draft = event(
          'parent-child-bond-changed',
          ref('person', parent.id),
          ref('person', child.id),
          Math.max(parentToChild.closeness, childToParent.closeness),
          `${parent.name} and ${child.name}'s family bond ${trend === 'improving' ? 'strengthened' : 'came under strain'}.`,
        );
        events.push(draft);
        addBiographyFact(facts, parent.id, draft);
        addBiographyFact(facts, child.id, draft);
      }
      return Object.freeze({
        ...bond,
        stateProvenance: 'recorded' as const,
        changedTick: input.tick,
        lastInteractionTick: sharedHousehold ? input.tick : bond.lastInteractionTick,
        trend,
        parentToChild,
        childToParent,
      });
    });
    interpersonal = Object.freeze({
      ...interpersonal,
      familyBonds: Object.freeze(changedFamilyBonds),
      operationCount: interpersonal.operationCount + changedFamilyBonds.length,
    });
  }
  const householdChangedPersonIds = new Set<number>();
  for (const relationshipEvent of lifecycleEvents) {
    const first = people.find(
      (person) => person.id === relationshipEvent.firstPersonId && person.alive,
    );
    const second = people.find(
      (person) => person.id === relationshipEvent.secondPersonId && person.alive,
    );
    if (first === undefined || second === undefined) continue;
    if (
      relationshipEvent.kind === 'long-term-partnership-formed' &&
      first.householdId !== second.householdId &&
      !householdChangedPersonIds.has(first.id) &&
      !householdChangedPersonIds.has(second.id)
    ) {
      const firstPrior = households.find((household) => household.id === first.householdId)!;
      const secondPrior = households.find((household) => household.id === second.householdId)!;
      const householdId = nextHouseholdId++;
      const credits = Math.min(2, firstPrior.credits) + Math.min(2, secondPrior.credits);
      const meals = Math.min(1, firstPrior.meals) + Math.min(1, secondPrior.meals);
      const tools = Math.min(1, firstPrior.tools) + Math.min(1, secondPrior.tools);
      firstPrior.credits -= Math.min(2, firstPrior.credits);
      secondPrior.credits -= Math.min(2, secondPrior.credits);
      firstPrior.meals -= Math.min(1, firstPrior.meals);
      secondPrior.meals -= Math.min(1, secondPrior.meals);
      firstPrior.tools -= Math.min(1, firstPrior.tools);
      secondPrior.tools -= Math.min(1, secondPrior.tools);
      people = people.map((person) =>
        person.id === first.id || person.id === second.id
          ? Object.freeze({ ...person, householdId })
          : person,
      );
      interpersonal = synchronizeInterpersonalPeople(
        interpersonal,
        input.tick,
        interpersonalPeople(people),
        'formation',
      );
      householdChangedPersonIds.add(first.id);
      householdChangedPersonIds.add(second.id);
      households.push({
        id: householdId,
        cultureId: first.cultureId,
        adultIds: Object.freeze([first.id, second.id].sort((left, right) => left - right)),
        credits,
        meals,
        tools,
        lastChildArrivalTick: input.tick - state.yearTicks * 2,
      });
      const formed = event(
        'household-formed',
        ref('person', first.id),
        ref('person', second.id),
        householdId,
        `${first.name} and ${second.name} formed household ${householdId}.`,
      );
      const split = event(
        'household-split',
        ref('person', second.id),
        ref('person', first.id),
        householdId,
        `${second.name} left household ${second.householdId} to form household ${householdId}.`,
      );
      events.push(formed, split);
      addBiographyFact(facts, first.id, formed);
      addBiographyFact(facts, second.id, formed);
      addBiographyFact(facts, first.id, split);
      addBiographyFact(facts, second.id, split);
      const firstRemaining = people.some(
        (person) => person.alive && person.householdId === firstPrior.id,
      );
      const secondRemaining = people.some(
        (person) => person.alive && person.householdId === secondPrior.id,
      );
      if (!firstRemaining || !secondRemaining) {
        const merged = event(
          'household-merged',
          ref('person', first.id),
          ref('person', second.id),
          householdId,
          `Household ${!firstRemaining ? firstPrior.id : secondPrior.id} merged into household ${householdId}.`,
        );
        events.push(merged);
        addBiographyFact(facts, first.id, merged);
        addBiographyFact(facts, second.id, merged);
      }
    }
    if (
      relationshipEvent.kind === 'partnership-separated' &&
      first.householdId === second.householdId &&
      !householdChangedPersonIds.has(first.id) &&
      !householdChangedPersonIds.has(second.id)
    ) {
      const prior = households.find((household) => household.id === second.householdId)!;
      const householdId = nextHouseholdId++;
      const credits = Math.min(2, prior.credits);
      const meals = Math.min(1, prior.meals);
      const tools = Math.min(1, prior.tools);
      prior.credits -= credits;
      prior.meals -= meals;
      prior.tools -= tools;
      people = people.map((person) =>
        person.id === second.id ? Object.freeze({ ...person, householdId }) : person,
      );
      interpersonal = synchronizeInterpersonalPeople(
        interpersonal,
        input.tick,
        interpersonalPeople(people),
        'split',
      );
      householdChangedPersonIds.add(first.id);
      householdChangedPersonIds.add(second.id);
      households.push({
        id: householdId,
        cultureId: second.cultureId,
        adultIds: Object.freeze([second.id]),
        credits,
        meals,
        tools,
        lastChildArrivalTick: input.tick,
      });
      const split = event(
        'household-split',
        ref('person', second.id),
        ref('person', first.id),
        householdId,
        `${second.name} separated from household ${prior.id} into household ${householdId}.`,
      );
      events.push(split);
      addBiographyFact(facts, first.id, split);
      addBiographyFact(facts, second.id, split);
    }
  }
  const birthDrafts: SocietyPersonDraft[] = [];
  const migrationDrafts: SocietyPersonDraft[] = [];
  const childArrivals = [...interpersonal.childArrivals];
  if (years > 0 && people.length < MAX_SOCIETY_RESIDENTS) {
    const adults = living()
      .filter((person) => input.tick - person.birthTick >= 18 * state.yearTicks)
      .sort((left, right) => left.id - right.id);
    let eligibility:
      | Readonly<{
          householdId: number;
          parents: readonly [number, number];
          guardianIds: readonly number[];
          policy: 'pair-bond' | 'communal-guardianship';
          cultureId: number;
          guardianBirthTicks: readonly number[];
          guardianHouseholdIdsAtArrival: readonly number[];
          guardianHouseholdMembershipStartTicksAtArrival: readonly (number | null)[];
          partnerRelationshipId: number | null;
          partnerKindAtArrival: 'partner' | 'long-term-partner' | null;
          minimumPartnerTrustAtArrival: number | null;
          minimumPartnerCommitmentAtArrival: number | null;
          selectionScoreAtArrival: number;
        }>
      | undefined;
    for (const household of households.slice().sort(compareId)) {
      const culture = state.cultures.find((candidate) => candidate.id === household.cultureId)!;
      const residentAdults = adults.filter((person) => person.householdId === household.id);
      const dependentCount = living().filter(
        (person) =>
          person.householdId === household.id &&
          input.tick - person.birthTick < 18 * state.yearTicks,
      ).length;
      if (
        residentAdults.length < (culture.familyPolicy === 'pair-bond' ? 2 : 1) ||
        dependentCount >= 2 ||
        household.meals + stockpile.food < 2 ||
        input.tick - household.lastChildArrivalTick < state.yearTicks * 2 ||
        scarcity >= 85 ||
        input.shelterCapacity <= 0 ||
        living().length >= Math.max(input.shelterCapacity, households.length * 4)
      )
        continue;
      const candidates = interpersonal.active
        .filter(
          (edge) =>
            residentAdults.some((person) => person.id === edge.firstPersonId) &&
            residentAdults.some((person) => person.id === edge.secondPersonId),
        )
        .sort(
          (left, right) =>
            Math.min(
              right.firstToSecond.commitment,
              right.secondToFirst.commitment,
              right.firstToSecond.trust,
              right.secondToFirst.trust,
            ) -
              Math.min(
                left.firstToSecond.commitment,
                left.secondToFirst.commitment,
                left.firstToSecond.trust,
                left.secondToFirst.trust,
              ) ||
            left.firstPersonId - right.firstPersonId ||
            left.secondPersonId - right.secondPersonId,
        );
      const selected = candidates.find((edge) => {
        if (culture.familyPolicy === 'pair-bond')
          return (
            (edge.kind === 'partner' || edge.kind === 'long-term-partner') &&
            edge.firstToSecond.trust >= 50 &&
            edge.secondToFirst.trust >= 50 &&
            edge.firstToSecond.commitment >= 60 &&
            edge.secondToFirst.commitment >= 60
          );
        return (
          edge.kind === 'partner' ||
          edge.kind === 'long-term-partner' ||
          edge.kind === 'close-friend' ||
          isDirectFamily(interpersonal, edge.firstPersonId, edge.secondPersonId)
        );
      });
      if (selected === undefined && culture.familyPolicy === 'pair-bond') continue;
      const guardianIds =
        selected === undefined
          ? Object.freeze([
              residentAdults
                .slice()
                .sort(
                  (left, right) =>
                    Number(right.role === 'caretaker') - Number(left.role === 'caretaker') ||
                    right.health - left.health ||
                    left.id - right.id,
                )[0]!.id,
            ])
          : Object.freeze([selected.firstPersonId, selected.secondPersonId]);
      if (
        guardianIds.some(
          (personId) =>
            interpersonal.familyBonds.filter(
              (bond) => bond.kind === 'parent' && bond.parentId === personId,
            ).length >= 4,
        )
      )
        continue;
      const familyUtility =
        selected === undefined
          ? state.stability -
            scarcity +
            120 +
            (residentAdults.find((person) => person.id === guardianIds[0])?.role === 'caretaker'
              ? 20
              : 0)
          : state.stability -
            scarcity +
            Math.min(selected.firstToSecond.trust, selected.secondToFirst.trust) +
            Math.min(selected.firstToSecond.commitment, selected.secondToFirst.commitment);
      if (familyUtility < 100) continue;
      eligibility = Object.freeze({
        householdId: household.id,
        parents: Object.freeze([guardianIds[0]!, guardianIds[1] ?? 0] as const),
        guardianIds,
        policy: culture.familyPolicy,
        cultureId: culture.id,
        guardianBirthTicks: Object.freeze(
          guardianIds.map((personId) => people.find((person) => person.id === personId)!.birthTick),
        ),
        guardianHouseholdIdsAtArrival: Object.freeze(guardianIds.map(() => household.id)),
        guardianHouseholdMembershipStartTicksAtArrival: Object.freeze(
          guardianIds.map((personId) => {
            const interval = interpersonal.householdHistories.get(personId)?.intervals?.at(-1);
            if (interval?.householdId !== household.id || interval.endTick !== null)
              throw new Error('Selected guardian lacks current household membership evidence.');
            return interval.startTick;
          }),
        ),
        partnerRelationshipId: culture.familyPolicy === 'pair-bond' ? selected!.id : null,
        partnerKindAtArrival:
          culture.familyPolicy === 'pair-bond'
            ? (selected!.kind as 'partner' | 'long-term-partner')
            : null,
        minimumPartnerTrustAtArrival:
          culture.familyPolicy === 'pair-bond'
            ? Math.min(selected!.firstToSecond.trust, selected!.secondToFirst.trust)
            : null,
        minimumPartnerCommitmentAtArrival:
          culture.familyPolicy === 'pair-bond'
            ? Math.min(selected!.firstToSecond.commitment, selected!.secondToFirst.commitment)
            : null,
        selectionScoreAtArrival: familyUtility,
      });
      break;
    }
    if (eligibility !== undefined) {
      const {
        householdId,
        parents,
        guardianIds,
        policy,
        cultureId,
        guardianBirthTicks,
        guardianHouseholdIdsAtArrival,
        guardianHouseholdMembershipStartTicksAtArrival,
        partnerRelationshipId,
        partnerKindAtArrival,
        minimumPartnerTrustAtArrival,
        minimumPartnerCommitmentAtArrival,
        selectionScoreAtArrival,
      } = eligibility;
      const eligibleHousehold = households.find((household) => household.id === householdId)!;
      const id = Math.max(state.nextPersonId, ...people.map((person) => person.id + 1));
      const culture = state.cultures.find(
        (candidate) => candidate.id === eligibleHousehold.cultureId,
      )!;
      const draft: SocietyPersonDraft = Object.freeze({
        id,
        name: nameFor(rng, id, culture.id),
        birthTick: input.tick,
        generation:
          Math.max(
            ...parents.map(
              (parentId) => people.find((person) => person.id === parentId)?.generation ?? 0,
            ),
          ) + 1,
        parentIds: parents,
        householdId: eligibleHousehold.id,
        cultureId: culture.id,
        role: culture.preference,
        tileIndex: input.centerTileIndex,
        origin: 'birth',
      });
      birthDrafts.push(draft);
      people = [
        ...people,
        Object.freeze({
          ...draft,
          alive: true,
          deathTick: 0,
          health: 100,
          biographyEventIds: Object.freeze([]),
        }),
      ].sort(compareId);
      const householdMeals = Math.min(2, eligibleHousehold.meals);
      eligibleHousehold.meals -= householdMeals;
      stockpile = Object.freeze({
        ...stockpile,
        food: stockpile.food - (2 - householdMeals),
      });
      eligibleHousehold.lastChildArrivalTick = input.tick;
      const arrivalRecord = Object.freeze({
        childId: id,
        tick: input.tick,
        eventId: 0,
        eligibilityEventId: 0,
        policy,
        cultureId,
        householdId: eligibleHousehold.id,
        guardianIds: Object.freeze([...guardianIds].sort((left, right) => left - right)),
        guardianBirthTicks,
        guardianHouseholdIdsAtArrival,
        guardianHouseholdMembershipStartTicksAtArrival,
        partnerRelationshipId,
        partnerKindAtArrival,
        minimumPartnerTrustAtArrival,
        minimumPartnerCommitmentAtArrival,
        selectionScoreAtArrival,
      });
      childArrivals.push(arrivalRecord);
      const birthEvent = event(
        'person-born',
        ref('person', id),
        ref('household', eligibleHousehold.id),
        draft.generation,
        `${draft.name} was born into household ${eligibleHousehold.id}.`,
      );
      const guardianNames = guardianIds.map(
        (guardianId) => people.find((person) => person.id === guardianId)!.name,
      );
      const eligibilityEvent = event(
        policy === 'pair-bond' ? 'pair-bond-child-arrival' : 'communal-child-arrival',
        ref('person', guardianIds[0]!),
        ref('person', guardianIds[1] ?? id),
        eligibleHousehold.id,
        policy === 'pair-bond'
          ? `${draft.name}'s arrival was supported by ${guardianNames.join(' and ')} through a recorded ${partnerKindAtArrival?.replaceAll('-', ' ')} bond.`
          : `${draft.name}'s arrival was supported by ${guardianNames.join(' and ')} through communal guardianship.`,
        childArrivalEligibilityEvidence(arrivalRecord),
      );
      events.push(birthEvent, eligibilityEvent);
      facts.push({
        personId: id,
        kind: 'person-born',
        source: ref('person', id),
        target: ref('household', eligibleHousehold.id),
        summary: `${draft.name} was born into household ${eligibleHousehold.id}.`,
      });
      for (const guardianId of guardianIds) addBiographyFact(facts, guardianId, eligibilityEvent);
    }
  }
  if (years > 0 && living().length < 4 && people.length < MAX_SOCIETY_RESIDENTS) {
    const id = Math.max(state.nextPersonId, ...people.map((person) => person.id + 1));
    const culture = state.cultures[rng.nextInt(state.cultures.length)]!;
    const householdId = nextHouseholdId++;
    const draft: SocietyPersonDraft = Object.freeze({
      id,
      name: nameFor(rng, id, culture.id),
      birthTick: input.tick - 20 * state.yearTicks,
      generation: 0,
      parentIds: zeroParents(),
      householdId,
      cultureId: culture.id,
      role: culture.preference,
      tileIndex: input.centerTileIndex,
      origin: 'migration',
    });
    migrationDrafts.push(draft);
    people = [
      ...people,
      Object.freeze({
        ...draft,
        alive: true,
        deathTick: 0,
        health: 80,
        biographyEventIds: Object.freeze([]),
      }),
    ].sort(compareId);
    households.push({
      id: householdId,
      cultureId: culture.id,
      adultIds: Object.freeze([id]),
      credits: 8,
      meals: 2,
      tools: 0,
      lastChildArrivalTick: input.tick,
    });
    events.push(
      event(
        'person-migrated',
        ref('person', id),
        ref('culture', culture.id),
        1,
        `${draft.name} arrived from beyond the settlement.`,
      ),
    );
    facts.push({
      personId: id,
      kind: 'person-migrated',
      source: ref('person', id),
      target: ref('culture', culture.id),
      summary: `${draft.name} arrived from beyond the settlement.`,
    });
    const householdMigration = event(
      'household-migrated',
      ref('person', id),
      ref('household', householdId),
      1,
      `${draft.name} established migrant household ${householdId}.`,
    );
    events.push(householdMigration);
    addBiographyFact(facts, id, householdMigration);
  }
  households = households.map((household) => ({
    ...household,
    adultIds: adultIdsFor(people, household.id, input.tick, state.yearTicks),
  }));
  const adults = living()
    .filter((person) => input.tick - person.birthTick >= 18 * state.yearTicks)
    .sort(compareId);

  // Salient relationships change who receives voluntary help and crisis care.
  if (years > 0) {
    const helpers = adults
      .filter((person) => {
        const household = households.find((candidate) => candidate.id === person.householdId);
        return household !== undefined && household.meals > 1;
      })
      .sort((left, right) => {
        const leftHousehold = households.find((candidate) => candidate.id === left.householdId)!;
        const rightHousehold = households.find((candidate) => candidate.id === right.householdId)!;
        return (
          rightHousehold.meals - leftHousehold.meals ||
          rightHousehold.credits - leftHousehold.credits ||
          left.id - right.id
        );
      });
    for (const helper of helpers) {
      const helperHousehold = households.find((candidate) => candidate.id === helper.householdId)!;
      const candidates = living().filter(
        (candidate) => candidate.id !== helper.id && candidate.householdId !== helper.householdId,
      );
      const baseUtility = new Map(
        candidates.map((candidate) => {
          const household = households.find((entry) => entry.id === candidate.householdId)!;
          return [candidate.id, (100 - candidate.health) * 2 + (8 - household.meals) * 6] as const;
        }),
      );
      const recipientId = selectPreferredRelatedPerson(
        interpersonal,
        helper.id,
        candidates.map((candidate) => candidate.id),
        'help',
        baseUtility,
      );
      const recipient = candidates.find((candidate) => candidate.id === recipientId);
      const edge =
        recipient === undefined
          ? undefined
          : listRelationshipsForPerson(interpersonal, helper.id).find(
              (candidate) =>
                candidate.firstPersonId === recipient.id ||
                candidate.secondPersonId === recipient.id,
            );
      const recipientHousehold = households.find(
        (candidate) => candidate.id === recipient?.householdId,
      );
      if (
        recipient === undefined ||
        edge === undefined ||
        recipientHousehold === undefined ||
        helperHousehold.meals <= recipientHousehold.meals ||
        relationshipDecisionInfluence(edge, helper.id, 'help') < 40
      )
        continue;
      helperHousehold.meals -= 1;
      recipientHousehold.meals += 1;
      const draft = event(
        scarcity >= 80 ? 'crisis-assisted' : 'resource-shared',
        ref('person', helper.id),
        ref('person', recipient.id),
        1,
        scarcity >= 80
          ? `${helper.name} protected ${recipient.name}'s household with a meal during scarcity.`
          : `${helper.name} shared a meal with ${recipient.name}'s household.`,
      );
      events.push(draft);
      addBiographyFact(facts, helper.id, draft);
      addBiographyFact(facts, recipient.id, draft);
      break;
    }
  }

  // One bounded annual teaching interaction changes authoritative settlement skills.
  if (years > 0) {
    const teaching = interpersonal.active
      .flatMap((edge) => {
        const first = people.find((person) => person.id === edge.firstPersonId && person.alive);
        const second = people.find((person) => person.id === edge.secondPersonId && person.alive);
        const firstObservation = observationById.get(edge.firstPersonId);
        const secondObservation = observationById.get(edge.secondPersonId);
        if (
          first === undefined ||
          second === undefined ||
          firstObservation === undefined ||
          secondObservation === undefined
        )
          return [];
        return (
          [
            [first, firstObservation, second, secondObservation],
            [second, secondObservation, first, firstObservation],
          ] as const
        ).flatMap(([teacher, teacherObservation, learner, learnerObservation]) =>
          teacherObservation.skills.flatMap((teacherSkill, skillIndex) => {
            const gap = teacherSkill - learnerObservation.skills[skillIndex]!;
            const influence = relationshipDecisionInfluence(edge, learner.id, 'knowledge');
            return gap < 5 || influence < 40
              ? []
              : [
                  {
                    teacher,
                    learner,
                    skillIndex: skillIndex as 0 | 1 | 2 | 3,
                    score: gap * 4 + influence,
                  },
                ];
          }),
        );
      })
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.teacher.id - right.teacher.id ||
          left.learner.id - right.learner.id ||
          left.skillIndex - right.skillIndex,
      )[0];
    if (teaching !== undefined) {
      skillPatches.push(
        Object.freeze({
          personId: teaching.learner.id,
          skillIndex: teaching.skillIndex,
          amount: 1,
        }),
      );
      const draft = event(
        'knowledge-shared',
        ref('person', teaching.teacher.id),
        ref('person', teaching.learner.id),
        teaching.skillIndex,
        `${teaching.teacher.name} taught ${teaching.learner.name} practical knowledge through their relationship.`,
      );
      events.push(draft);
      addBiographyFact(facts, teaching.teacher.id, draft);
      addBiographyFact(facts, teaching.learner.id, draft);
    }
  }

  // Death transfers a bounded family resource share to a relationship-ranked heir.
  if (years > 0) {
    for (const deceasedId of [...new Set(deathIds)].sort((left, right) => left - right)) {
      const deceased = people.find((person) => person.id === deceasedId);
      if (deceased === undefined) continue;
      const childIds = childIdsFor(interpersonal, deceasedId);
      const parentIds = parentIdsFor(interpersonal, deceasedId);
      const guardianIds = guardianIdsFor(interpersonal, deceasedId);
      const partnerIds = listRelationshipsForPerson(interpersonal, deceasedId, true)
        .filter((edge) =>
          ['partner', 'long-term-partner', 'former-partner', 'widowed'].includes(edge.kind),
        )
        .map((edge) =>
          edge.firstPersonId === deceasedId ? edge.secondPersonId : edge.firstPersonId,
        );
      const candidateIds = [...new Set([...childIds, ...partnerIds, ...parentIds, ...guardianIds])]
        .filter((id) => people.some((person) => person.id === id && person.alive))
        .sort((left, right) => left - right);
      const baseUtility = new Map(
        candidateIds.map((id) => [
          id,
          childIds.includes(id) ? 240 : partnerIds.includes(id) ? 220 : 160,
        ]),
      );
      const heirId = selectPreferredRelatedPerson(
        interpersonal,
        deceasedId,
        candidateIds,
        'family',
        baseUtility,
      );
      const heir = people.find((person) => person.id === heirId);
      const sourceHousehold = households.find((household) => household.id === deceased.householdId);
      const targetHousehold = households.find((household) => household.id === heir?.householdId);
      if (heir === undefined || sourceHousehold === undefined || targetHousehold === undefined)
        continue;
      const amount =
        sourceHousehold.id === targetHousehold.id ? 0 : Math.min(1, sourceHousehold.credits);
      sourceHousehold.credits -= amount;
      targetHousehold.credits += amount;
      const draft = event(
        'family-inheritance',
        ref('person', deceased.id),
        ref('person', heir.id),
        amount,
        amount > 0
          ? `${heir.name} received one family credit after ${deceased.name}'s death.`
          : `${heir.name} retained ${deceased.name}'s family holdings within household ${targetHousehold.id}.`,
      );
      events.push(draft);
      addBiographyFact(facts, deceased.id, draft);
      addBiographyFact(facts, heir.id, draft);
    }
  }

  // Dependents without a living parent receive an event-backed, culturally valid guardian.
  if (years > 0) {
    for (const child of living()
      .filter(
        (person) =>
          input.tick - person.birthTick < 18 * state.yearTicks &&
          parentIdsFor(interpersonal, person.id).length > 0,
      )
      .sort(compareId)) {
      const parents = parentIdsFor(interpersonal, child.id);
      if (parents.some((id) => people.some((person) => person.id === id && person.alive))) continue;
      if (
        guardianIdsFor(interpersonal, child.id).some((id) =>
          people.some((person) => person.id === id && person.alive),
        )
      )
        continue;
      const salient = new Set<number>();
      for (const relatedId of [child.id, ...parents])
        for (const edge of listRelationshipsForPerson(interpersonal, relatedId, true))
          salient.add(edge.firstPersonId === relatedId ? edge.secondPersonId : edge.firstPersonId);
      const candidates = adults.filter(
        (candidate) =>
          candidate.cultureId === child.cultureId &&
          (candidate.householdId === child.householdId ||
            isDirectFamily(interpersonal, candidate.id, child.id) ||
            salient.has(candidate.id)),
      );
      const baseUtility = new Map(
        candidates.map((candidate) => [
          candidate.id,
          (candidate.householdId === child.householdId ? 160 : 0) +
            (isDirectFamily(interpersonal, candidate.id, child.id) ? 120 : 0) +
            (salient.has(candidate.id) ? 80 : 0),
        ]),
      );
      const guardianId = selectPreferredRelatedPerson(
        interpersonal,
        child.id,
        candidates.map((candidate) => candidate.id),
        'help',
        baseUtility,
      );
      const guardian = candidates.find((candidate) => candidate.id === guardianId);
      if (guardian === undefined) continue;
      const neutralDirection = Object.freeze({
        affinity: 60,
        trust: 60,
        closeness: 50,
        commitment: 70,
        grievance: 0,
      });
      const bond: FamilyBond = Object.freeze({
        parentId: guardian.id,
        adultId: guardian.id,
        childId: child.id,
        kind: 'guardian',
        provenance: 'recorded-guardianship',
        stateProvenance: 'recorded',
        formedEventId: 0,
        formedTick: input.tick,
        changedTick: input.tick,
        lastInteractionTick: input.tick,
        trend: 'improving',
        parentToChild: neutralDirection,
        childToParent: neutralDirection,
        sharedEvents: Object.freeze([]),
      });
      interpersonal = Object.freeze({
        ...interpersonal,
        familyBonds: Object.freeze(
          [...interpersonal.familyBonds, bond].sort(
            (left, right) =>
              left.childId - right.childId ||
              left.parentId - right.parentId ||
              compareOrdinalText(left.kind, right.kind),
          ),
        ),
      });
      if (child.householdId !== guardian.householdId) {
        people = people.map((person) =>
          person.id === child.id
            ? Object.freeze({ ...person, householdId: guardian.householdId })
            : person,
        );
        interpersonal = synchronizeInterpersonalPeople(
          interpersonal,
          input.tick,
          interpersonalPeople(people),
          'guardianship',
        );
      }
      const draft = event(
        'guardianship-formed',
        ref('person', guardian.id),
        ref('person', child.id),
        guardian.householdId,
        `${guardian.name} became ${child.name}'s guardian in household ${guardian.householdId}.`,
      );
      events.push(draft);
      addBiographyFact(facts, guardian.id, draft);
      addBiographyFact(facts, child.id, draft);
    }
  }

  // A decadal scarcity migration moves a relationship-ranked pair together.
  if (years > 0 && scarcity >= 75 && input.tick % (state.yearTicks * 10) === 0) {
    const eligibleMovers = adults.filter((person) => {
      if (householdChangedPersonIds.has(person.id)) return false;
      const history = interpersonal.householdHistories.get(person.id);
      const start = history?.intervals.at(-1)?.startTick;
      return start === null || start === undefined || input.tick - start >= state.yearTicks * 10;
    });
    const mover = eligibleMovers.sort((left, right) => {
      const leftHousehold = households.find((household) => household.id === left.householdId)!;
      const rightHousehold = households.find((household) => household.id === right.householdId)!;
      return (
        leftHousehold.credits +
          leftHousehold.meals * 2 -
          (rightHousehold.credits + rightHousehold.meals * 2) || left.id - right.id
      );
    })[0];
    if (mover !== undefined) {
      const candidateIds = eligibleMovers
        .filter((person) => person.id !== mover.id)
        .map((person) => person.id);
      const baseUtility = new Map(
        candidateIds.map((id) => [
          id,
          people.find((person) => person.id === id)?.householdId === mover.householdId ? 30 : 0,
        ]),
      );
      const companionId = selectPreferredRelatedPerson(
        interpersonal,
        mover.id,
        candidateIds,
        'migration',
        baseUtility,
      );
      const companion = people.find((person) => person.id === companionId && person.alive);
      const edge =
        companion === undefined
          ? undefined
          : listRelationshipsForPerson(interpersonal, mover.id).find(
              (candidate) =>
                candidate.firstPersonId === companion.id ||
                candidate.secondPersonId === companion.id,
            );
      if (
        companion !== undefined &&
        edge !== undefined &&
        relationshipDecisionInfluence(edge, mover.id, 'migration') >= 80
      ) {
        const householdId = nextHouseholdId++;
        let credits = 0;
        let meals = 0;
        let tools = 0;
        for (const priorId of [...new Set([mover.householdId, companion.householdId])]) {
          const prior = households.find((household) => household.id === priorId)!;
          const creditShare = Math.min(2, prior.credits);
          const mealShare = Math.min(1, prior.meals);
          const toolShare = Math.min(1, prior.tools);
          prior.credits -= creditShare;
          prior.meals -= mealShare;
          prior.tools -= toolShare;
          credits += creditShare;
          meals += mealShare;
          tools += toolShare;
        }
        people = people.map((person) =>
          person.id === mover.id || person.id === companion.id
            ? Object.freeze({ ...person, householdId })
            : person,
        );
        households.push({
          id: householdId,
          cultureId: mover.cultureId,
          adultIds: Object.freeze([mover.id, companion.id].sort((left, right) => left - right)),
          credits,
          meals,
          tools,
          lastChildArrivalTick: input.tick,
        });
        interpersonal = synchronizeInterpersonalPeople(
          interpersonal,
          input.tick,
          interpersonalPeople(people),
          'migration-current-household',
        );
        householdChangedPersonIds.add(mover.id);
        householdChangedPersonIds.add(companion.id);
        const draft = event(
          'household-migrated',
          ref('person', mover.id),
          ref('person', companion.id),
          householdId,
          `${mover.name} and ${companion.name} migrated together into household ${householdId}.`,
        );
        events.push(draft);
        addBiographyFact(facts, mover.id, draft);
        addBiographyFact(facts, companion.id, draft);
      }
    }
  }

  // Scarcity retaliation targets a represented rival or grievance, never an arbitrary first pair.
  if (years > 0 && scarcity >= 70) {
    const retaliation = interpersonal.active
      .flatMap((edge) => [
        {
          edge,
          actorId: edge.firstPersonId,
          targetId: edge.secondPersonId,
          score: relationshipDecisionInfluence(edge, edge.firstPersonId, 'conflict'),
        },
        {
          edge,
          actorId: edge.secondPersonId,
          targetId: edge.firstPersonId,
          score: relationshipDecisionInfluence(edge, edge.secondPersonId, 'conflict'),
        },
      ])
      .filter(
        (candidate) =>
          candidate.score > 0 &&
          people.some((person) => person.id === candidate.actorId && person.alive) &&
          people.some((person) => person.id === candidate.targetId && person.alive),
      )
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.actorId - right.actorId ||
          left.targetId - right.targetId,
      )[0];
    if (retaliation !== undefined) {
      const actor = people.find((person) => person.id === retaliation.actorId)!;
      const target = people.find((person) => person.id === retaliation.targetId)!;
      const actorHousehold = households.find((household) => household.id === actor.householdId)!;
      const targetHousehold = households.find((household) => household.id === target.householdId)!;
      const amount =
        actorHousehold.id === targetHousehold.id ? 0 : Math.min(1, targetHousehold.credits);
      targetHousehold.credits -= amount;
      actorHousehold.credits += amount;
      const draft = event(
        'conflict',
        ref('person', actor.id),
        ref('person', target.id),
        retaliation.score,
        amount > 0
          ? `${actor.name} retaliated against ${target.name} and took one credit during scarcity.`
          : `${actor.name} retaliated against ${target.name} during scarcity.`,
      );
      events.push(draft);
      addBiographyFact(facts, actor.id, draft);
      addBiographyFact(facts, target.id, draft);
      if (amount > 0) {
        const theftDraft = event(
          'theft',
          ref('person', actor.id),
          ref('household', targetHousehold.id),
          amount,
          `${actor.name} took one credit from household ${targetHousehold.id} during the conflict.`,
        );
        events.push(theftDraft);
        addBiographyFact(facts, actor.id, theftDraft);
      }
    }
  }
  households = households.map((household) => ({
    ...household,
    adultIds: adultIdsFor(people, household.id, input.tick, state.yearTicks),
  }));
  const inequality = inequalityFor(households);
  const stability = clamp(
    state.stability +
      (scarcity >= 85 ? -16 : scarcity >= 50 ? -6 : 8) -
      Math.min(4, Math.trunc(inequality / 20)),
    0,
    100,
  );
  const recovered = state.collapsed && scarcity < 30 && stability >= 60;
  const collapsed = state.collapsed ? !recovered : stability <= 15;
  if (!state.collapsed && collapsed)
    events.push(
      event(
        'settlement-collapsed',
        ref('institution', state.institution.id),
        ref('world', 0),
        stability,
        'The settlement collapsed under scarcity and instability.',
      ),
    );
  if (recovered)
    events.push(
      event(
        'settlement-recovered',
        ref('institution', state.institution.id),
        ref('world', 0),
        stability,
        'The settlement recovered through renewed production and cooperation.',
      ),
    );
  const leaderId = chooseLeader(people, households, interpersonal);
  const government: GovernmentKind = stability < 35 ? 'stewardship' : 'council';
  const institution = Object.freeze({
    ...state.institution,
    leaderId,
    government,
    changedTick:
      government === state.institution.government && leaderId === state.institution.leaderId
        ? state.institution.changedTick
        : input.tick,
  });
  if (institution.changedTick === input.tick) {
    const governmentDraft = event(
      'government-changed',
      ref('institution', institution.id),
      leaderId === 0 ? ref('world', 0) : ref('person', leaderId),
      stability,
      `The council selected ${people.find((person) => person.id === leaderId)?.name ?? 'no leader'} for ${government}.`,
    );
    events.push(governmentDraft);
    if (leaderId !== 0) addBiographyFact(facts, leaderId, governmentDraft);
  }
  const groups = state.cultures.map((culture) =>
    Object.freeze({
      id: culture.id,
      cultureId: culture.id,
      name: `${culture.name} circle`,
      memberIds: Object.freeze(
        people
          .filter((person) => person.alive && person.cultureId === culture.id)
          .map((person) => person.id)
          .sort((left, right) => left - right),
      ),
    }),
  );
  const next: SocietyState = Object.freeze({
    ...state,
    lastTick: input.tick,
    centerTileIndex: input.centerTileIndex,
    nextPersonId: Math.max(state.nextPersonId, ...people.map((person) => person.id + 1)),
    nextHouseholdId,
    nextOfferId,
    people: Object.freeze(people),
    households: Object.freeze(households.sort(compareId)),
    groups: Object.freeze(groups),
    institution,
    offers: Object.freeze(offers),
    interpersonal: synchronizeInterpersonalPeople(
      Object.freeze({
        ...interpersonal,
        childArrivals: Object.freeze(
          childArrivals.sort((left, right) => left.childId - right.childId),
        ),
      }),
      input.tick,
      interpersonalPeople(people),
      birthDrafts.length > 0
        ? 'child-arrival'
        : migrationDrafts.length > 0
          ? 'migration-current-household'
          : 'join',
    ),
    scarcity,
    inequality,
    stability,
    collapsed,
    pendingBiographyFacts: Object.freeze(facts),
    rng: rng.save(),
    operationCount: state.operationCount + people.length + households.length + events.length,
  });
  assertSocietyInvariants(next);
  return Object.freeze({
    society: next,
    communalStockpile: stockpile,
    personBirthDrafts: Object.freeze(birthDrafts),
    personMigrationDrafts: Object.freeze(migrationDrafts),
    deathPersonIds: Object.freeze(deathIds.sort((left, right) => left - right)),
    roleOrNeedReliefPatches: Object.freeze(
      living().map((person) =>
        Object.freeze({
          personId: person.id,
          hungerRelief: recipeMeals > 0 ? 2 : 0,
          thirstRelief: stockpile.water > 0 ? 1 : 0,
        }),
      ),
    ),
    skillPatches: Object.freeze(skillPatches),
    events: Object.freeze(events),
  });
}

/** Attaches only authoritative events whose complete factual identity matches a pending biography fact. */
export function attachSocietyBiographyEventIds(
  state: SocietyState,
  sourceEvents: readonly SocietyAuthoritativeEvent[],
  historicalSources: readonly SocietyAuthoritativeEvent[] = sourceEvents,
): SocietyState {
  assertSocietyInvariants(state);
  const sources = [...sourceEvents].sort(compareId);
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index]!;
    assertInteger(source.id, 'Authoritative society event id', 1);
    if (index > 0 && sources[index - 1]!.id === source.id)
      throw new Error('Authoritative society event ids must be unique.');
    summary(source.summary);
  }
  const attached = new Map<number, number[]>();
  for (const fact of state.pendingBiographyFacts) {
    const source = sources.find((candidate) => matchingFact(fact, candidate));
    if (source === undefined)
      throw new Error('Biography event must match an exact authoritative source event.');
    attached.set(fact.personId, [...(attached.get(fact.personId) ?? []), source.id]);
  }
  const next: SocietyState = Object.freeze({
    ...state,
    interpersonal: attachInterpersonalEventIds(state.interpersonal, sources),
    people: Object.freeze(
      state.people.map((person) =>
        Object.freeze({
          ...person,
          biographyEventIds: retainBiographyEventIds(
            person.biographyEventIds,
            attached.get(person.id) ?? [],
            historicalSources,
          ),
        }),
      ),
    ),
    pendingBiographyFacts: Object.freeze([]),
  });
  assertSocietyInvariants(next);
  return next;
}

export function societyDto(state: SocietyState): Readonly<Record<string, unknown>> {
  assertSocietyInvariants(state);
  return Object.freeze({
    centerTileIndex: state.centerTileIndex,
    collapsed: state.collapsed,
    cultures: state.cultures.map((culture) => ({ ...culture })),
    groups: state.groups.map((group) => ({ ...group, memberIds: [...group.memberIds] })),
    households: state.households.map((household) => ({
      ...household,
      adultIds: [...household.adultIds],
    })),
    inequality: state.inequality,
    interpersonal: interpersonalDto(state.interpersonal),
    institution: { ...state.institution },
    lastTick: state.lastTick,
    nextHouseholdId: state.nextHouseholdId,
    nextOfferId: state.nextOfferId,
    nextPersonId: state.nextPersonId,
    operationCount: state.operationCount,
    offers: state.offers.map((offer) => ({ ...offer })),
    pendingBiographyFacts: state.pendingBiographyFacts.map((fact) => ({
      ...fact,
      source: { ...fact.source },
      target: { ...fact.target },
    })),
    people: state.people.map((person) => ({
      ...person,
      parentIds: [...person.parentIds],
      biographyEventIds: [...person.biographyEventIds],
    })),
    rng: [...state.rng],
    scarcity: state.scarcity,
    stability: state.stability,
    yearTicks: state.yearTicks,
  });
}

export function societySummary(state: SocietyState): SocietySummary {
  assertSocietyInvariants(state);
  return Object.freeze({
    livingPeople: state.people.filter((person) => person.alive).length,
    households: state.households.length,
    cultures: state.cultures.length,
    stability: state.stability,
    inequality: state.inequality,
    scarcity: state.scarcity,
    collapsed: state.collapsed,
    operationCount: state.operationCount,
  });
}

export function assertSocietyInvariants(state: SocietyState): void {
  if (state.yearTicks !== NORMAL_YEAR_TICKS && state.yearTicks !== ACCELERATED_YEAR_TICKS)
    throw new Error('Society calendar is invalid.');
  assertInteger(state.lastTick, 'Society last tick');
  assertInteger(state.centerTileIndex, 'Society center tile');
  assertInteger(state.nextPersonId, 'Society next person id', 1);
  assertInteger(state.nextHouseholdId, 'Society next household id', 1);
  assertInteger(state.nextOfferId, 'Society next offer id', 1);
  assertInteger(state.scarcity, 'Society scarcity', 0, 100);
  assertInteger(state.inequality, 'Society inequality');
  assertInteger(state.stability, 'Society stability', 0, 100);
  assertInteger(state.operationCount, 'Society operation count');
  if (state.people.length > MAX_SOCIETY_RESIDENTS)
    throw new Error('Society resident cap exceeded.');
  const people = [...state.people].sort(compareId);
  if (people.some((person, index) => state.people[index]?.id !== person.id))
    throw new Error('Society people must be sorted.');
  const personIds = new Set<number>();
  const householdIds = new Set(state.households.map((household) => household.id));
  const cultureIds = new Set(state.cultures.map((culture) => culture.id));
  const peopleById = new Map(state.people.map((person) => [person.id, person]));
  assertInterpersonalInvariants(state.interpersonal, interpersonalPeople(state.people));
  for (const person of state.people) {
    assertInteger(person.id, 'Society person id', 1);
    if (personIds.has(person.id)) throw new Error('Society person ids must be unique.');
    personIds.add(person.id);
    assertBoundedString(person.name, 'Society person name');
    if (!['founder', 'birth', 'migration'].includes(person.origin))
      throw new Error('Society person origin is invalid.');
    assertInteger(person.birthTick, 'Society person birth tick', Number.MIN_SAFE_INTEGER);
    assertInteger(person.deathTick, 'Society person death tick');
    if (!person.alive !== person.deathTick > 0)
      throw new Error('Society person life and death are inconsistent.');
    if (person.deathTick > 0 && person.deathTick < person.birthTick)
      throw new Error('Society death precedes birth.');
    assertInteger(person.generation, 'Society generation');
    if (
      (person.generation === 0 && (person.parentIds[0] !== 0 || person.parentIds[1] !== 0)) ||
      (person.generation > 0 && person.parentIds[0] === 0)
    ) {
      throw new Error('Society parent generation is invalid.');
    }
    for (const parentId of person.parentIds) {
      if (parentId === 0) continue;
      const parent = peopleById.get(parentId);
      if (
        parent === undefined ||
        parent.id >= person.id ||
        parent.generation >= person.generation ||
        parent.birthTick >= person.birthTick
      ) {
        throw new Error('Society parent reference or generation is invalid.');
      }
    }
    if (person.parentIds[0] !== 0 && person.parentIds[0] === person.parentIds[1])
      throw new Error('Society parents must be distinct.');
    if (!householdIds.has(person.householdId) || !cultureIds.has(person.cultureId))
      throw new Error('Society household or culture reference is invalid.');
    if (!ROLES.includes(person.role)) throw new Error('Society economic role is invalid.');
    assertInteger(person.tileIndex, 'Society person tile index');
    assertInteger(person.health, 'Society person health', 0, 100);
    if (person.alive !== person.health > 0) throw new Error('Society person health is invalid.');
    if (person.biographyEventIds.length > MAX_BIOGRAPHY_EVENT_IDS)
      throw new Error('Society biography is too long.');
    for (const eventId of person.biographyEventIds)
      assertInteger(eventId, 'Society biography event id', 1);
    assertSortedUnique(person.biographyEventIds, 'Society biography event ids');
  }
  for (const collection of [state.households, state.cultures, state.groups, state.offers]) {
    for (let index = 1; index < collection.length; index += 1)
      if (collection[index - 1]!.id >= collection[index]!.id)
        throw new Error('Society collections must be sorted with unique ids.');
  }
  for (const household of state.households) {
    if (!cultureIds.has(household.cultureId)) throw new Error('Household culture is invalid.');
    for (const id of household.adultIds) {
      const adult = peopleById.get(id);
      if (
        adult === undefined ||
        !adult.alive ||
        adult.householdId !== household.id ||
        state.lastTick - adult.birthTick < 18 * state.yearTicks
      ) {
        throw new Error('Household adult is invalid.');
      }
    }
    assertSortedUnique(household.adultIds, 'Household adults');
    assertInteger(household.credits, 'Household credits');
    assertInteger(household.meals, 'Household meals');
    assertInteger(household.tools, 'Household tools');
    assertInteger(
      household.lastChildArrivalTick,
      'Household last child arrival tick',
      Number.MIN_SAFE_INTEGER,
      state.lastTick,
    );
  }
  if (state.cultures.length < 2) throw new Error('Society requires two cultures.');
  const cultureIdentities = new Set<string>();
  const cultureNames = new Set<string>();
  for (const culture of state.cultures) {
    assertInteger(culture.id, 'Society culture id', 1);
    assertBoundedString(culture.name, 'Society culture name');
    assertBoundedString(culture.belief, 'Society culture belief');
    assertBoundedString(culture.tradition, 'Society culture tradition');
    assertBoundedString(culture.architectureStyle, 'Society culture architecture style');
    if (!ROLES.includes(culture.preference))
      throw new Error('Society culture preference is invalid.');
    if (
      (culture.familyPolicy !== 'pair-bond' && culture.familyPolicy !== 'communal-guardianship') ||
      (culture.partnershipLimit !== 1 && culture.partnershipLimit !== 2)
    )
      throw new Error('Society culture family policy is invalid.');
    const identity = cultureIdentity(culture);
    if (cultureIdentities.has(identity))
      throw new Error('Society cultures must have distinct identities.');
    cultureIdentities.add(identity);
    if (cultureNames.has(culture.name)) throw new Error('Society culture names must be unique.');
    cultureNames.add(culture.name);
  }
  for (const arrival of state.interpersonal.childArrivals) {
    const child = peopleById.get(arrival.childId);
    const culture = state.cultures.find((candidate) => candidate.id === arrival.cultureId);
    const household = state.households.find((candidate) => candidate.id === arrival.householdId);
    if (
      child?.origin !== 'birth' ||
      child.cultureId !== arrival.cultureId ||
      culture?.familyPolicy !== arrival.policy ||
      household?.cultureId !== arrival.cultureId
    )
      throw new Error('Child arrival culture or household evidence is invalid.');
    if (
      arrival.guardianIds.some((guardianId) => {
        const guardian = peopleById.get(guardianId);
        return guardian === undefined || arrival.tick - guardian.birthTick < 18 * state.yearTicks;
      })
    )
      throw new Error('Child arrival guardian was not an adult at arrival.');
  }
  for (const group of state.groups) {
    assertInteger(group.id, 'Society group id', 1);
    if (!cultureIds.has(group.cultureId)) throw new Error('Group culture is invalid.');
    assertBoundedString(group.name, 'Society group name');
    for (const id of group.memberIds) {
      const member = peopleById.get(id);
      if (member === undefined || !member.alive || member.cultureId !== group.cultureId)
        throw new Error('Group member is invalid.');
    }
    assertSortedUnique(group.memberIds, 'Group members');
  }
  if (
    !Number.isSafeInteger(state.institution.id) ||
    state.institution.id < 1 ||
    state.institution.kind !== 'council' ||
    !GOVERNMENTS.includes(state.institution.government) ||
    !Number.isSafeInteger(state.institution.changedTick) ||
    state.institution.changedTick < 0 ||
    state.institution.changedTick > state.lastTick ||
    (state.institution.leaderId !== 0 && !peopleById.get(state.institution.leaderId)?.alive)
  )
    throw new Error('Institution leader or government is invalid.');
  for (const offer of state.offers) {
    assertInteger(offer.id, 'Society offer id', 1);
    if (
      !householdIds.has(offer.sellerHouseholdId) ||
      !householdIds.has(offer.buyerHouseholdId) ||
      offer.sellerHouseholdId === offer.buyerHouseholdId
    )
      throw new Error('Society offer household reference is invalid.');
    if (!OFFER_KINDS.includes(offer.kind)) throw new Error('Society offer kind is invalid.');
    assertInteger(offer.amount, 'Society offer amount');
    assertInteger(offer.price, 'Society offer price', 1);
    assertInteger(offer.fulfilledAmount, 'Society offer fulfilled amount', 0, offer.amount);
    assertInteger(offer.transportDemand, 'Society transport demand');
  }
  const groupIds = new Set(state.groups.map((group) => group.id));
  const referenceExists = (entity: SocietyEntityRef): boolean => {
    if (!ENTITY_KINDS.includes(entity.kind) || !Number.isSafeInteger(entity.id)) return false;
    switch (entity.kind) {
      case 'person':
        return personIds.has(entity.id);
      case 'structure':
        return entity.id > 0;
      case 'household':
        return householdIds.has(entity.id);
      case 'culture':
        return cultureIds.has(entity.id);
      case 'group':
        return groupIds.has(entity.id);
      case 'institution':
        return entity.id === state.institution.id;
      case 'world':
        return entity.id === 0;
    }
  };
  for (const fact of state.pendingBiographyFacts) {
    if (
      !personIds.has(fact.personId) ||
      !referenceExists(fact.source) ||
      !referenceExists(fact.target) ||
      fact.kind.length === 0 ||
      fact.kind.length > 64 ||
      fact.summary.length === 0 ||
      fact.summary.length > 160
    )
      throw new Error('Pending biography fact is invalid.');
  }
  if (state.nextPersonId <= (state.people.at(-1)?.id ?? 0))
    throw new Error('Society next person id is invalid.');
  if (state.nextHouseholdId <= (state.households.at(-1)?.id ?? 0))
    throw new Error('Society next household id is invalid.');
  if (state.nextOfferId <= (state.offers.at(-1)?.id ?? 0))
    throw new Error('Society next offer id is invalid.');
}
