import { deriveXoshiro128State, type Xoshiro128State, Xoshiro128StarStar } from '../random';

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
  readonly skills: readonly [number, number, number, number];
  readonly occupation: string;
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
}

export interface SocietyCulture {
  readonly id: number;
  readonly name: string;
  readonly preference: EconomicRole;
  readonly belief: string;
  readonly tradition: string;
  readonly architectureStyle: string;
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

export interface SocietyBond {
  readonly firstPersonId: number;
  readonly secondPersonId: number;
  readonly cooperation: number;
  readonly disagreement: number;
  readonly conflict: number;
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
  readonly bonds: readonly SocietyBond[];
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

export interface SocietyEventDraft {
  readonly kind: string;
  readonly subject: SocietyEntityRef;
  readonly target: SocietyEntityRef;
  readonly amount: number;
  readonly summary: string;
}

export interface SocietyPulseResult {
  readonly society: SocietyState;
  readonly communalStockpile: CommunalStockpileInput;
  readonly personBirthDrafts: readonly SocietyPersonDraft[];
  readonly personMigrationDrafts: readonly SocietyPersonDraft[];
  readonly deathPersonIds: readonly number[];
  readonly roleOrNeedReliefPatches: readonly SocietyNeedReliefPatch[];
  readonly events: readonly SocietyEventDraft[];
}

export interface SocietyAuthoritativeEvent {
  readonly id: number;
  readonly kind: string;
  readonly subject: SocietyEntityRef;
  readonly target: SocietyEntityRef;
  readonly summary: string;
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
  for (const skill of observation.skills) assertInteger(skill, 'Person observation skill', 0, 100);
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
): SocietyEventDraft {
  assertInteger(amount, 'Society event amount');
  return Object.freeze({ kind, subject, target, amount, summary: summary(text) });
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

function pairKey(firstPersonId: number, secondPersonId: number): string {
  return `${firstPersonId}:${secondPersonId}`;
}

function sortedBonds(bonds: readonly SocietyBond[]): readonly SocietyBond[] {
  return Object.freeze(
    [...bonds].sort(
      (left, right) =>
        left.firstPersonId - right.firstPersonId || left.secondPersonId - right.secondPersonId,
    ),
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
): number {
  const wealthByHousehold = new Map(
    households.map((household) => [household.id, household.credits]),
  );
  const leader = people
    .filter((person) => person.alive)
    .sort(
      (left, right) =>
        (wealthByHousehold.get(right.householdId) ?? 0) -
          (wealthByHousehold.get(left.householdId) ?? 0) || left.id - right.id,
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
    bonds: Object.freeze([]),
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
      const leaderId = chooseLeader(people, households);
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
  const birthDrafts: SocietyPersonDraft[] = [];
  const migrationDrafts: SocietyPersonDraft[] = [];
  if (years > 0 && living().length < MAX_SOCIETY_RESIDENTS) {
    const adults = living()
      .filter((person) => input.tick - person.birthTick >= 18 * state.yearTicks)
      .sort((left, right) => right.generation - left.generation || left.id - right.id);
    let parents: readonly [number, number] | undefined;
    for (const first of adults) {
      const firstParents = new Set(first.parentIds.filter((id) => id !== 0));
      const second = adults.find(
        (candidate) =>
          candidate.id !== first.id &&
          candidate.householdId !== first.householdId &&
          candidate.parentIds.every((parentId) => parentId === 0 || !firstParents.has(parentId)),
      );
      if (second !== undefined) {
        parents = [first.id, second.id];
        break;
      }
    }
    const eligibleHousehold =
      parents === undefined || scarcity >= 65 || living().length > input.shelterCapacity
        ? undefined
        : households.find(
            (household) =>
              household.id === people.find((person) => person.id === parents[0])?.householdId &&
              household.meals >= 2,
          );
    if (eligibleHousehold !== undefined && parents !== undefined) {
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
      eligibleHousehold.meals -= 2;
      events.push(
        event(
          'person-born',
          ref('person', id),
          ref('household', eligibleHousehold.id),
          draft.generation,
          `${draft.name} was born into household ${eligibleHousehold.id}.`,
        ),
      );
      facts.push({
        personId: id,
        kind: 'person-born',
        source: ref('person', id),
        target: ref('household', eligibleHousehold.id),
        summary: `${draft.name} was born into household ${eligibleHousehold.id}.`,
      });
    }
  }
  if (years > 0 && living().length < 4 && living().length < MAX_SOCIETY_RESIDENTS) {
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
  }
  households = households.map((household) => ({
    ...household,
    adultIds: adultIdsFor(people, household.id, input.tick, state.yearTicks),
  }));

  const currentBonds = new Map(
    state.bonds.map((bond) => [pairKey(bond.firstPersonId, bond.secondPersonId), bond]),
  );
  const adults = living()
    .filter((person) => input.tick - person.birthTick >= 18 * state.yearTicks)
    .sort(compareId);
  let bonds: SocietyBond[] = [];
  if (adults.length >= 2) {
    const first = adults[0]!;
    const second = adults[1]!;
    const prior = currentBonds.get(pairKey(first.id, second.id)) ?? {
      firstPersonId: first.id,
      secondPersonId: second.id,
      cooperation: 50,
      disagreement: 0,
      conflict: 0,
    };
    const nextBond =
      scarcity >= 60
        ? {
            ...prior,
            cooperation: clamp(prior.cooperation - 4, 0, 100),
            disagreement: clamp(prior.disagreement + 5, 0, 100),
            conflict: clamp(prior.conflict + (scarcity >= 85 ? 8 : 0), 0, 100),
          }
        : {
            ...prior,
            cooperation: clamp(prior.cooperation + 4, 0, 100),
            disagreement: clamp(prior.disagreement - 3, 0, 100),
            conflict: clamp(prior.conflict - 4, 0, 100),
          };
    bonds = [Object.freeze(nextBond)];
    if (scarcity >= 85) {
      const conflictDraft = event(
        'conflict',
        ref('person', first.id),
        ref('person', second.id),
        nextBond.conflict,
        `${first.name} and ${second.name} entered a scarcity conflict.`,
      );
      events.push(conflictDraft);
      addBiographyFact(facts, first.id, conflictDraft);
      addBiographyFact(facts, second.id, conflictDraft);
      const victim = households.find((household) => household.id === second.householdId);
      const thief = households.find((household) => household.id === first.householdId);
      if (victim !== undefined && thief !== undefined && victim.credits > 0) {
        victim.credits -= 1;
        thief.credits += 1;
        const theftDraft = event(
          'theft',
          ref('person', first.id),
          ref('household', victim.id),
          1,
          `${first.name} took one credit during scarcity.`,
        );
        events.push(theftDraft);
        addBiographyFact(facts, first.id, theftDraft);
      }
    } else if (prior.conflict > 0) {
      const reconciliationDraft = event(
        'reconciliation',
        ref('person', first.id),
        ref('person', second.id),
        nextBond.cooperation,
        `${first.name} and ${second.name} reconciled.`,
      );
      events.push(reconciliationDraft);
      addBiographyFact(facts, first.id, reconciliationDraft);
      addBiographyFact(facts, second.id, reconciliationDraft);
    } else {
      const cooperationDraft = event(
        'cooperation',
        ref('person', first.id),
        ref('person', second.id),
        nextBond.cooperation,
        `${first.name} and ${second.name} cooperated.`,
      );
      events.push(cooperationDraft);
      addBiographyFact(facts, first.id, cooperationDraft);
      addBiographyFact(facts, second.id, cooperationDraft);
    }
  }
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
  const leaderId = chooseLeader(people, households);
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
    bonds: sortedBonds(bonds),
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
    events: Object.freeze(events),
  });
}

/** Attaches only authoritative events whose complete factual identity matches a pending biography fact. */
export function attachSocietyBiographyEventIds(
  state: SocietyState,
  sourceEvents: readonly SocietyAuthoritativeEvent[],
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
    people: Object.freeze(
      state.people.map((person) =>
        Object.freeze({
          ...person,
          biographyEventIds: Object.freeze(
            [...new Set([...person.biographyEventIds, ...(attached.get(person.id) ?? [])])]
              .sort((left, right) => left - right)
              .slice(-MAX_BIOGRAPHY_EVENT_IDS),
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
    bonds: state.bonds.map((bond) => ({ ...bond })),
    centerTileIndex: state.centerTileIndex,
    collapsed: state.collapsed,
    cultures: state.cultures.map((culture) => ({ ...culture })),
    groups: state.groups.map((group) => ({ ...group, memberIds: [...group.memberIds] })),
    households: state.households.map((household) => ({
      ...household,
      adultIds: [...household.adultIds],
    })),
    inequality: state.inequality,
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
      (person.generation > 0 && (person.parentIds[0] === 0 || person.parentIds[1] === 0))
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
    const identity = cultureIdentity(culture);
    if (cultureIdentities.has(identity))
      throw new Error('Society cultures must have distinct identities.');
    cultureIdentities.add(identity);
    if (cultureNames.has(culture.name)) throw new Error('Society culture names must be unique.');
    cultureNames.add(culture.name);
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
  const bonds = new Set<string>();
  let previousFirstPersonId = 0;
  let previousSecondPersonId = 0;
  for (const bond of state.bonds) {
    if (
      !personIds.has(bond.firstPersonId) ||
      !personIds.has(bond.secondPersonId) ||
      bond.firstPersonId >= bond.secondPersonId
    )
      throw new Error('Society bond references are invalid.');
    const key = pairKey(bond.firstPersonId, bond.secondPersonId);
    if (bonds.has(key)) throw new Error('Society bonds must be unique.');
    if (
      previousFirstPersonId > bond.firstPersonId ||
      (previousFirstPersonId === bond.firstPersonId &&
        previousSecondPersonId >= bond.secondPersonId)
    ) {
      throw new Error('Society bonds must be sorted.');
    }
    bonds.add(key);
    previousFirstPersonId = bond.firstPersonId;
    previousSecondPersonId = bond.secondPersonId;
    assertInteger(bond.cooperation, 'Society cooperation', 0, 100);
    assertInteger(bond.disagreement, 'Society disagreement', 0, 100);
    assertInteger(bond.conflict, 'Society conflict', 0, 100);
  }
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
