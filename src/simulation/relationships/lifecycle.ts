import { deriveXoshiro128State, Xoshiro128StarStar } from '../random';
import {
  admitActiveRelationships,
  archiveActiveRelationship,
  assertInterpersonalInvariants,
  canonicalPair,
  childIdsFor,
  findActiveRelationship,
  isDirectFamily,
  isExtendedKin,
  isProhibitedPartnerKin,
  isSibling,
  MAX_NEW_CANDIDATES_PER_PERSON_PER_YEAR,
  parentIdsFor,
  type ActiveRelationship,
  type InterpersonalPersonInput,
  type InterpersonalState,
  type RelationshipDirectionalState,
  type RelationshipKind,
  type RelationshipRole,
  type RelationshipTrend,
} from './index';

export interface RelationshipPersonContext extends InterpersonalPersonInput {
  readonly name: string;
  readonly cultureId: number;
  readonly tileIndex: number;
  readonly traits: readonly [number, number, number, number];
  readonly skills: readonly [number, number, number, number];
  readonly occupation: string;
  readonly recentEventIds: readonly number[];
}

export interface RelationshipCultureContext {
  readonly id: number;
  readonly familyPolicy: 'pair-bond' | 'communal-guardianship';
  readonly partnershipLimit: 1 | 2;
}

export interface RelationshipLifecycleInput {
  readonly tick: number;
  readonly yearTicks: number;
  readonly worldWidth: number;
  readonly people: readonly RelationshipPersonContext[];
  readonly cultures: readonly RelationshipCultureContext[];
  readonly scarcity: number;
  readonly stability: number;
}

export type RelationshipLifecycleEventKind =
  | 'relationship-formed'
  | 'friendship-formed'
  | 'close-friendship-formed'
  | 'friendship-ended'
  | 'rivalry-formed'
  | 'enmity-formed'
  | 'mentorship-formed'
  | 'partnership-formed'
  | 'long-term-partnership-formed'
  | 'partnership-separated'
  | 'family-estranged'
  | 'relationship-reconciled'
  | 'partner-widowed'
  | 'sibling-bond-formed';

export interface RelationshipLifecycleEvent {
  readonly relationshipId: number;
  readonly kind: RelationshipLifecycleEventKind;
  readonly firstPersonId: number;
  readonly secondPersonId: number;
  readonly importance: number;
  readonly amount: number;
  readonly summary: string;
}

export interface RelationshipLifecycleResult {
  readonly state: InterpersonalState;
  readonly events: readonly RelationshipLifecycleEvent[];
}

export type RelationshipExperienceKind =
  'crisis-assistance' | 'shared-trauma' | 'crisis-abandonment';

export interface RelationshipExperienceInput {
  readonly tick: number;
  readonly firstPersonId: number;
  readonly secondPersonId: number;
  readonly kind: RelationshipExperienceKind;
  readonly amount: number;
}

export type RelationshipDecisionDomain =
  'help' | 'family' | 'migration' | 'knowledge' | 'politics' | 'conflict';

function compareNumber(left: number, right: number): number {
  return left - right;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function distance(first: number, second: number, width: number): number {
  return (
    Math.abs((first % width) - (second % width)) +
    Math.abs(Math.floor(first / width) - Math.floor(second / width))
  );
}

function commonCount(first: readonly number[], second: readonly number[]): number {
  const other = new Set(second);
  return first.reduce((count, value) => count + (other.has(value) ? 1 : 0), 0);
}

function compatibility(
  first: RelationshipPersonContext,
  second: RelationshipPersonContext,
): number {
  return Math.max(
    0,
    40 -
      Math.floor(
        first.traits.reduce(
          (total, value, index) => total + Math.abs(value - second.traits[index]!),
          0,
        ) / 10,
      ),
  );
}

function maximumSkill(person: RelationshipPersonContext): number {
  return Math.max(...person.skills);
}

function age(person: RelationshipPersonContext, input: RelationshipLifecycleInput): number {
  return Math.max(0, Math.floor((input.tick - person.birthTick) / input.yearTicks));
}

function directed(
  affinity: number,
  trust: number,
  closeness: number,
  commitment: number,
  grievance: number,
): RelationshipDirectionalState {
  return Object.freeze({
    affinity: clamp(affinity),
    trust: clamp(trust),
    closeness: clamp(closeness),
    commitment: clamp(commitment),
    grievance: clamp(grievance),
  });
}

function stateFor(edge: ActiveRelationship, personId: number): RelationshipDirectionalState {
  return edge.firstPersonId === personId ? edge.firstToSecond : edge.secondToFirst;
}

function updateEdge(
  edge: ActiveRelationship,
  update: Readonly<{
    kind?: RelationshipKind;
    firstRole?: RelationshipRole;
    secondRole?: RelationshipRole;
    trend: RelationshipTrend;
    firstToSecond: RelationshipDirectionalState;
    secondToFirst: RelationshipDirectionalState;
    tick: number;
    rng: readonly [number, number, number, number];
    interacted: boolean;
  }>,
): ActiveRelationship {
  const kind = update.kind ?? edge.kind;
  const firstRole = update.firstRole ?? edge.firstRole;
  const secondRole = update.secondRole ?? edge.secondRole;
  return Object.freeze({
    ...edge,
    kind,
    firstRole,
    secondRole,
    trend: update.trend,
    changedTick:
      edge.kind === kind && edge.firstRole === firstRole && edge.secondRole === secondRole
        ? edge.changedTick
        : update.tick,
    lastInteractionTick: update.interacted ? update.tick : edge.lastInteractionTick,
    firstToSecond: update.firstToSecond,
    secondToFirst: update.secondToFirst,
    rng: update.rng,
  });
}

function event(
  edge: ActiveRelationship,
  kind: RelationshipLifecycleEventKind,
  first: RelationshipPersonContext,
  second: RelationshipPersonContext,
  amount: number,
): RelationshipLifecycleEvent {
  const phrase: Readonly<Record<RelationshipLifecycleEventKind, string>> = {
    'relationship-formed': 'formed an acquaintance',
    'friendship-formed': 'became friends',
    'close-friendship-formed': 'became close friends',
    'friendship-ended': 'ended their friendship',
    'rivalry-formed': 'became rivals',
    'enmity-formed': 'became enemies',
    'mentorship-formed': 'began a mentorship',
    'partnership-formed': 'formed a partnership',
    'long-term-partnership-formed': 'formed a long-term partnership',
    'partnership-separated': 'separated their partnership',
    'family-estranged': 'became estranged',
    'relationship-reconciled': 'reconciled',
    'partner-widowed': 'entered widowhood after losing a partner',
    'sibling-bond-formed': 'formed a sibling bond',
  };
  const summary = `${first.name} and ${second.name} ${phrase[kind]}.`;
  return Object.freeze({
    relationshipId: edge.id,
    kind,
    firstPersonId: edge.firstPersonId,
    secondPersonId: edge.secondPersonId,
    importance: kind === 'relationship-formed' ? 1 : 2,
    amount: clamp(amount),
    summary:
      summary.length <= 160 ? summary : `${first.name} and ${second.name} changed relationship.`,
  });
}

function assertInput(
  state: InterpersonalState,
  input: RelationshipLifecycleInput,
): readonly RelationshipPersonContext[] {
  if (!Number.isSafeInteger(input.tick) || state.tick !== input.tick)
    throw new Error('Lifecycle input tick must equal state tick.');
  if (!Number.isSafeInteger(input.yearTicks) || input.yearTicks <= 0)
    throw new Error('Lifecycle year ticks must be positive.');
  if (!Number.isSafeInteger(input.worldWidth) || input.worldWidth <= 0)
    throw new Error('Lifecycle world width must be positive.');
  if (
    ![input.scarcity, input.stability].every(
      (value) => Number.isSafeInteger(value) && value >= 0 && value <= 100,
    )
  )
    throw new Error('Lifecycle scarcity and stability must be integer percentages.');
  const people = [...input.people].sort((left, right) => left.id - right.id);
  for (let index = 1; index < people.length; index += 1) {
    if (people[index - 1]!.id === people[index]!.id)
      throw new Error('Lifecycle person ids must be unique.');
  }
  for (const person of people) {
    if (!Number.isSafeInteger(person.cultureId) || !Number.isSafeInteger(person.tileIndex))
      throw new Error('Lifecycle person context is invalid.');
    for (const tuple of [person.traits, person.skills]) {
      if (tuple.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 100))
        throw new Error('Lifecycle traits and skills must be integer percentages.');
    }
    if (person.recentEventIds.some((id) => !Number.isSafeInteger(id) || id < 1))
      throw new Error('Lifecycle event ids are invalid.');
  }
  const cultures = [...input.cultures].sort((left, right) => left.id - right.id);
  if (
    cultures.length === 0 ||
    cultures.some((culture, index) => index > 0 && culture.id === cultures[index - 1]!.id)
  )
    throw new Error('Lifecycle cultures must be unique and nonempty.');
  if (
    cultures.some(
      (culture) =>
        (culture.familyPolicy !== 'pair-bond' &&
          culture.familyPolicy !== 'communal-guardianship') ||
        (culture.partnershipLimit !== 1 && culture.partnershipLimit !== 2),
    )
  )
    throw new Error('Lifecycle culture context is invalid.');
  assertInterpersonalInvariants(state, people);
  return Object.freeze(people);
}

function add<K extends string | number>(index: Map<K, number[]>, key: K, id: number): void {
  const current = index.get(key);
  if (current === undefined) index.set(key, [id]);
  else current.push(id);
}

function take(source: readonly number[] | undefined, target: Set<number>, self: number): void {
  if (source === undefined) return;
  for (const id of source.slice(0, MAX_NEW_CANDIDATES_PER_PERSON_PER_YEAR))
    if (id !== self) target.add(id);
}

/** Builds queues only from bounded household, spatial, work, family, event, and edge indexes. */
function candidatePairs(
  state: InterpersonalState,
  people: readonly RelationshipPersonContext[],
  input: RelationshipLifecycleInput,
): readonly (readonly [number, number])[] {
  const living = people.filter((person) => person.alive);
  const household = new Map<number, number[]>();
  const work = new Map<string, number[]>();
  const tiles = new Map<number, number[]>();
  const events = new Map<number, number[]>();
  const family = new Map<number, number[]>();
  const existing = new Map<number, number[]>();
  const peopleById = new Map(people.map((person) => [person.id, person]));
  for (const person of living) {
    if (person.householdId !== 0) add(household, person.householdId, person.id);
    add(work, person.occupation, person.id);
    add(tiles, person.tileIndex, person.id);
    for (const id of person.recentEventIds) add(events, id, person.id);
    for (const id of [...parentIdsFor(state, person.id), ...childIdsFor(state, person.id)])
      add(family, person.id, id);
  }
  for (const index of [household, work, tiles, events, family])
    for (const values of index.values()) values.sort(compareNumber);
  for (const edge of state.active) {
    add(existing, edge.firstPersonId, edge.secondPersonId);
    add(existing, edge.secondPersonId, edge.firstPersonId);
  }
  for (const values of existing.values()) values.sort(compareNumber);
  const seen = new Set<string>();
  const pairs: (readonly [number, number])[] = [];
  for (const person of living) {
    const candidates = new Set<number>();
    take(household.get(person.householdId), candidates, person.id);
    take(work.get(person.occupation), candidates, person.id);
    take(tiles.get(person.tileIndex), candidates, person.id);
    for (const tile of [
      person.tileIndex - 1,
      person.tileIndex + 1,
      person.tileIndex - input.worldWidth,
      person.tileIndex + input.worldWidth,
    ])
      take(tiles.get(tile), candidates, person.id);
    take(family.get(person.id), candidates, person.id);
    take(existing.get(person.id), candidates, person.id);
    for (const eventId of person.recentEventIds.slice(0, MAX_NEW_CANDIDATES_PER_PERSON_PER_YEAR))
      take(events.get(eventId), candidates, person.id);
    const ranked = [...candidates]
      .filter((id) => {
        if (findActiveRelationship(state, person.id, id) !== undefined) return false;
        const pair = canonicalPair(person.id, id);
        return !state.archived.some(
          (edge) => edge.firstPersonId === pair[0] && edge.secondPersonId === pair[1],
        );
      })
      .sort((left, right) => {
        const leftPerson = peopleById.get(left)!;
        const rightPerson = peopleById.get(right)!;
        const leftScore =
          compatibility(person, leftPerson) +
          commonCount(person.recentEventIds, leftPerson.recentEventIds) * 4 -
          distance(person.tileIndex, leftPerson.tileIndex, input.worldWidth);
        const rightScore =
          compatibility(person, rightPerson) +
          commonCount(person.recentEventIds, rightPerson.recentEventIds) * 4 -
          distance(person.tileIndex, rightPerson.tileIndex, input.worldWidth);
        return rightScore - leftScore || left - right;
      })
      .slice(0, MAX_NEW_CANDIDATES_PER_PERSON_PER_YEAR);
    for (const candidate of ranked) {
      const pair = canonicalPair(person.id, candidate);
      const key = `${pair[0]}:${pair[1]}`;
      if (!seen.has(key)) {
        seen.add(key);
        pairs.push(pair);
      }
    }
  }
  return Object.freeze(pairs.sort((left, right) => left[0] - right[0] || left[1] - right[1]));
}

function partners(state: InterpersonalState, personId: number): number {
  return state.active.filter(
    (edge) =>
      (edge.firstPersonId === personId || edge.secondPersonId === personId) &&
      (edge.kind === 'partner' || edge.kind === 'long-term-partner'),
  ).length;
}

function mayPartner(
  state: InterpersonalState,
  first: RelationshipPersonContext,
  second: RelationshipPersonContext,
  input: RelationshipLifecycleInput,
  cultures: ReadonlyMap<number, RelationshipCultureContext>,
): boolean {
  const firstCulture = cultures.get(first.cultureId);
  const secondCulture = cultures.get(second.cultureId);
  const partnershipLimit = Math.min(
    firstCulture?.partnershipLimit ?? 0,
    secondCulture?.partnershipLimit ?? 0,
  );
  return (
    firstCulture !== undefined &&
    secondCulture !== undefined &&
    age(first, input) >= 18 &&
    age(second, input) >= 18 &&
    !isProhibitedPartnerKin(state, first.id, second.id) &&
    partners(state, first.id) < partnershipLimit &&
    partners(state, second.id) < partnershipLimit
  );
}

function acquaintance(
  state: InterpersonalState,
  first: RelationshipPersonContext,
  second: RelationshipPersonContext,
  input: RelationshipLifecycleInput,
): ActiveRelationship {
  const rng = new Xoshiro128StarStar(
    deriveXoshiro128State(state.rng, `m4.5-pair:${first.id}:${second.id}`),
  );
  const kin =
    isDirectFamily(state, first.id, second.id) ||
    isSibling(state, first.id, second.id) ||
    isExtendedKin(state, first.id, second.id)
      ? 8
      : 0;
  const score =
    compatibility(first, second) +
    Math.max(0, 12 - distance(first.tileIndex, second.tileIndex, input.worldWidth) * 2) +
    commonCount(first.recentEventIds, second.recentEventIds) * 4 +
    (first.occupation === second.occupation ? 6 : 0) +
    kin +
    Math.floor(input.stability / 10) -
    Math.floor(input.scarcity / 8) +
    rng.nextInt(7) -
    3;
  const grievance = Math.floor(Math.max(0, input.scarcity - input.stability) / 4);
  const firstState = directed(
    40 + score,
    35 + score,
    Math.max(1, Math.floor(score / 3)),
    0,
    grievance,
  );
  const secondState = directed(
    40 + score + rng.nextInt(5) - 2,
    35 + score,
    Math.max(1, Math.floor(score / 3)),
    0,
    grievance,
  );
  return Object.freeze({
    id: state.nextRelationshipId,
    firstPersonId: first.id,
    secondPersonId: second.id,
    firstRole: 'peer',
    secondRole: 'peer',
    kind: 'acquaintance',
    formedTick: input.tick,
    changedTick: input.tick,
    lastInteractionTick: input.tick,
    observedSinceTick: input.tick,
    trend: 'improving',
    firstToSecond: firstState,
    secondToFirst: secondState,
    sharedEvents: Object.freeze([]),
    rng: rng.save(),
    legacySocietyCounters: null,
  });
}

function transition(
  edge: ActiveRelationship,
  first: RelationshipPersonContext,
  second: RelationshipPersonContext,
  one: RelationshipDirectionalState,
  two: RelationshipDirectionalState,
  state: InterpersonalState,
  input: RelationshipLifecycleInput,
  cultures: ReadonlyMap<number, RelationshipCultureContext>,
): Readonly<{
  kind: RelationshipKind;
  firstRole: RelationshipRole;
  secondRole: RelationshipRole;
  event: RelationshipLifecycleEventKind | null;
}> {
  const positive = Math.min(
    one.affinity + one.trust + one.closeness,
    two.affinity + two.trust + two.closeness,
  );
  const grievance = Math.max(one.grievance, two.grievance);
  if ((edge.kind === 'partner' || edge.kind === 'long-term-partner') && grievance >= 55)
    return {
      kind: 'former-partner',
      firstRole: 'former-partner',
      secondRole: 'former-partner',
      event: 'partnership-separated',
    };
  if (
    (edge.kind === 'rival' || edge.kind === 'enemy' || edge.kind === 'estranged') &&
    grievance <= 18 &&
    positive >= 145
  )
    return {
      kind: 'reconciled',
      firstRole: 'peer',
      secondRole: 'peer',
      event: 'relationship-reconciled',
    };
  if (
    (isDirectFamily(state, first.id, second.id) || isSibling(state, first.id, second.id)) &&
    grievance >= 36 &&
    edge.kind !== 'estranged'
  )
    return { kind: 'estranged', firstRole: 'peer', secondRole: 'peer', event: 'family-estranged' };
  if (grievance >= 75 && edge.kind !== 'enemy')
    return {
      kind: 'enemy',
      firstRole: 'adversary',
      secondRole: 'adversary',
      event: 'enmity-formed',
    };
  if (grievance >= 42 && edge.kind !== 'rival' && edge.kind !== 'enemy')
    return {
      kind: 'rival',
      firstRole: 'adversary',
      secondRole: 'adversary',
      event: 'rivalry-formed',
    };
  if (
    (edge.kind === 'acquaintance' || edge.kind === 'reconciled') &&
    Math.abs(maximumSkill(first) - maximumSkill(second)) >= 25 &&
    positive >= 135
  ) {
    const mentorFirst = maximumSkill(first) > maximumSkill(second);
    return {
      kind: 'mentor',
      firstRole: mentorFirst ? 'mentor' : 'protege',
      secondRole: mentorFirst ? 'protege' : 'mentor',
      event: 'mentorship-formed',
    };
  }
  if (
    edge.kind === 'partner' &&
    one.commitment >= 65 &&
    two.commitment >= 65 &&
    input.tick - edge.formedTick >= input.yearTicks * 2
  )
    return {
      kind: 'long-term-partner',
      firstRole: 'partner',
      secondRole: 'partner',
      event: 'long-term-partnership-formed',
    };
  if (
    (edge.kind === 'friend' || edge.kind === 'close-friend' || edge.kind === 'reconciled') &&
    mayPartner(state, first, second, input, cultures) &&
    one.commitment >= 45 &&
    two.commitment >= 45 &&
    positive >= 175
  )
    return {
      kind: 'partner',
      firstRole: 'partner',
      secondRole: 'partner',
      event: 'partnership-formed',
    };
  if (edge.kind === 'friend' && positive >= 190)
    return {
      kind: 'close-friend',
      firstRole: 'peer',
      secondRole: 'peer',
      event: 'close-friendship-formed',
    };
  if ((edge.kind === 'acquaintance' || edge.kind === 'reconciled') && positive >= 145)
    return { kind: 'friend', firstRole: 'peer', secondRole: 'peer', event: 'friendship-formed' };
  return { kind: edge.kind, firstRole: edge.firstRole, secondRole: edge.secondRole, event: null };
}

/** Advances deterministic yearly formation and evolution without scanning all population pairs. */
export function advanceInterpersonalLifecycle(
  state: InterpersonalState,
  input: RelationshipLifecycleInput,
): RelationshipLifecycleResult {
  const people = assertInput(state, input);
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const cultures = new Map(input.cultures.map((culture) => [culture.id, culture]));
  const startOperations = state.operationCount;
  let candidateEvaluations = 0;
  let edgeUpdates = 0;
  const events: RelationshipLifecycleEvent[] = [];
  const formed: {
    edge: ActiveRelationship;
    first: RelationshipPersonContext;
    second: RelationshipPersonContext;
  }[] = [];
  let nextRelationshipId = state.nextRelationshipId;
  for (const [firstId, secondId] of candidatePairs(state, people, input)) {
    candidateEvaluations += 1;
    const first = peopleById.get(firstId)!;
    const second = peopleById.get(secondId)!;
    if (findActiveRelationship(state, firstId, secondId) !== undefined) continue;
    const edge = acquaintance(
      Object.freeze({ ...state, nextRelationshipId }),
      first,
      second,
      input,
    );
    nextRelationshipId = edge.id + 1;
    formed.push({ edge, first, second });
  }
  let next = admitActiveRelationships(
    state,
    people,
    formed.map(({ edge }) => edge),
  );
  for (const { edge, first, second } of formed) {
    events.push(event(edge, 'relationship-formed', first, second, edge.firstToSecond.closeness));
    if (isSibling(next, edge.firstPersonId, edge.secondPersonId))
      events.push(event(edge, 'sibling-bond-formed', first, second, 1));
  }
  // New acquaintances have only the current year's factual formation; only
  // edges that existed at the boundary receive an evolution update.
  for (const edge of state.active) {
    const first = peopleById.get(edge.firstPersonId)!;
    const second = peopleById.get(edge.secondPersonId)!;
    edgeUpdates += 1;
    if (
      (edge.kind === 'partner' || edge.kind === 'long-term-partner') &&
      first.alive !== second.alive
    ) {
      const widowed = updateEdge(edge, {
        trend: 'stable',
        firstToSecond: edge.firstToSecond,
        secondToFirst: edge.secondToFirst,
        tick: input.tick,
        rng: edge.rng,
        interacted: false,
        kind: 'widowed',
        firstRole: 'partner',
        secondRole: 'partner',
      });
      next = Object.freeze({
        ...next,
        active: Object.freeze(
          next.active.map((candidate) => (candidate.id === edge.id ? widowed : candidate)),
        ),
      });
      events.push(event(widowed, 'partner-widowed', first, second, 100));
      continue;
    }
    if (!first.alive || !second.alive) continue;
    const rng = new Xoshiro128StarStar(edge.rng);
    const positive = Math.floor(
      (compatibility(first, second) +
        Math.max(0, 8 - distance(first.tileIndex, second.tileIndex, input.worldWidth)) +
        commonCount(first.recentEventIds, second.recentEventIds) * 5 +
        (first.occupation === second.occupation ? 5 : 0) +
        (isDirectFamily(next, first.id, second.id) ||
        isSibling(next, first.id, second.id) ||
        isExtendedKin(next, first.id, second.id)
          ? 4
          : 0) +
        Math.floor(input.stability / 10) +
        rng.nextInt(5) -
        Math.floor(input.scarcity / 8)) /
        8,
    );
    const grievance = Math.max(
      0,
      Math.floor((input.scarcity - input.stability + rng.nextInt(7) - 3) / 10),
    );
    const commitment =
      edge.kind === 'partner' || edge.kind === 'long-term-partner'
        ? Math.max(1, positive)
        : (edge.kind === 'friend' || edge.kind === 'close-friend') &&
            mayPartner(next, first, second, input, cultures) &&
            positive > grievance
          ? Math.max(2, positive * 2)
          : 0;
    const one = directed(
      edge.firstToSecond.affinity + positive - grievance,
      edge.firstToSecond.trust + positive - grievance,
      edge.firstToSecond.closeness + positive,
      edge.firstToSecond.commitment + commitment,
      edge.firstToSecond.grievance + grievance - Math.floor(positive / 3),
    );
    const two = directed(
      edge.secondToFirst.affinity + positive - grievance,
      edge.secondToFirst.trust + positive - grievance,
      edge.secondToFirst.closeness + positive,
      edge.secondToFirst.commitment + commitment,
      edge.secondToFirst.grievance + grievance - Math.floor(positive / 3),
    );
    if (
      (edge.kind === 'friend' || edge.kind === 'close-friend') &&
      (Math.min(one.affinity, two.affinity) <= 20 || Math.max(one.grievance, two.grievance) >= 70)
    ) {
      const weakened = updateEdge(edge, {
        trend: 'deteriorating',
        firstToSecond: one,
        secondToFirst: two,
        tick: input.tick,
        rng: rng.save(),
        interacted: true,
      });
      next = Object.freeze({
        ...next,
        active: Object.freeze(
          next.active.map((candidate) => (candidate.id === edge.id ? weakened : candidate)),
        ),
      });
      next = archiveActiveRelationship(next, people, edge.id, input.tick);
      events.push(
        event(weakened, 'friendship-ended', first, second, Math.max(one.grievance, two.grievance)),
      );
      continue;
    }
    const change = transition(edge, first, second, one, two, next, input, cultures);
    const updated = updateEdge(edge, {
      trend: positive >= grievance ? 'improving' : 'deteriorating',
      firstToSecond: one,
      secondToFirst: two,
      tick: input.tick,
      rng: rng.save(),
      interacted: true,
      ...change,
    });
    next = Object.freeze({
      ...next,
      active: Object.freeze(
        next.active.map((candidate) => (candidate.id === edge.id ? updated : candidate)),
      ),
    });
    if (change.event !== null)
      events.push(
        event(
          updated,
          change.event,
          first,
          second,
          Math.max(one.closeness, two.closeness, one.grievance, two.grievance),
        ),
      );
  }
  next = Object.freeze({
    ...next,
    active: Object.freeze(
      [...next.active].sort(
        (left, right) =>
          left.firstPersonId - right.firstPersonId || left.secondPersonId - right.secondPersonId,
      ),
    ),
    operationCount: startOperations + candidateEvaluations + edgeUpdates,
  });
  assertInterpersonalInvariants(next, people);
  return Object.freeze({ state: next, events: Object.freeze(events) });
}

/**
 * Applies one factual M5 experience to an existing salient edge. The immutable
 * source event is attached separately after the world assigns its stable id.
 */
export function applyRelationshipExperience(
  state: InterpersonalState,
  people: readonly InterpersonalPersonInput[],
  input: RelationshipExperienceInput,
): InterpersonalState {
  assertInterpersonalInvariants(state, people);
  if (
    !Number.isSafeInteger(input.tick) ||
    input.tick < state.tick ||
    !Number.isSafeInteger(input.amount) ||
    input.amount < 1 ||
    input.amount > 100 ||
    input.firstPersonId === input.secondPersonId
  )
    throw new RangeError('Relationship experience input is invalid.');
  const existing = findActiveRelationship(state, input.firstPersonId, input.secondPersonId);
  if (existing === undefined) return state;

  const delta = Math.max(1, Math.floor(input.amount / 5));
  const half = Math.max(1, Math.floor(delta / 2));
  const revise = (
    direction: RelationshipDirectionalState,
    recipient: boolean,
  ): RelationshipDirectionalState => {
    switch (input.kind) {
      case 'crisis-assistance':
        return directed(
          direction.affinity + half,
          direction.trust + (recipient ? delta : half),
          direction.closeness + delta,
          direction.commitment + half,
          direction.grievance - delta,
        );
      case 'shared-trauma':
        return directed(
          direction.affinity + half,
          direction.trust + half,
          direction.closeness + delta,
          direction.commitment + half,
          direction.grievance + half,
        );
      case 'crisis-abandonment':
        return directed(
          direction.affinity - delta,
          direction.trust - delta,
          direction.closeness - half,
          direction.commitment - delta,
          direction.grievance + delta,
        );
    }
  };
  const firstIsCanonical = existing.firstPersonId === input.firstPersonId;
  const firstToSecond = revise(existing.firstToSecond, firstIsCanonical);
  const secondToFirst = revise(existing.secondToFirst, !firstIsCanonical);
  const updated = Object.freeze({
    ...existing,
    changedTick: input.tick,
    lastInteractionTick: input.tick,
    trend:
      input.kind === 'crisis-abandonment' ? ('deteriorating' as const) : ('improving' as const),
    firstToSecond,
    secondToFirst,
  });
  const next = Object.freeze({
    ...state,
    tick: input.tick,
    active: Object.freeze(state.active.map((edge) => (edge.id === existing.id ? updated : edge))),
    operationCount: state.operationCount + 1,
  });
  assertInterpersonalInvariants(next, people);
  return next;
}

export function relationshipDecisionInfluence(
  edge: ActiveRelationship,
  personId: number,
  domain: RelationshipDecisionDomain,
): number {
  const direction = stateFor(edge, personId);
  const positive = Math.floor(
    (direction.affinity + direction.trust + direction.closeness + direction.commitment) / 4,
  );
  if (domain === 'conflict') return direction.grievance * 2 - Math.floor(positive / 3);
  const multiplier: Readonly<Record<Exclude<RelationshipDecisionDomain, 'conflict'>, number>> = {
    help: 2,
    family: 3,
    migration: 2,
    knowledge: 2,
    politics: 2,
  };
  return positive * multiplier[domain] - direction.grievance * 2;
}

/** Stable utility selection; equal utility resolves to the smaller person id. */
export function selectPreferredRelatedPerson(
  state: InterpersonalState,
  personId: number,
  candidateIds: readonly number[],
  domain: RelationshipDecisionDomain,
  baseUtilityByPerson: ReadonlyMap<number, number>,
): number | null {
  let selected: number | null = null;
  let best = Number.MIN_SAFE_INTEGER;
  for (const candidateId of [...new Set(candidateIds)].sort(compareNumber)) {
    const base = baseUtilityByPerson.get(candidateId);
    if (candidateId === personId || base === undefined || !Number.isSafeInteger(base)) continue;
    const edge = findActiveRelationship(state, personId, candidateId);
    const utility =
      base + (edge === undefined ? 0 : relationshipDecisionInfluence(edge, personId, domain));
    if (utility > best || (utility === best && (selected === null || candidateId < selected))) {
      selected = candidateId;
      best = utility;
    }
  }
  return selected;
}
