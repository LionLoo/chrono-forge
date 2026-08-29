import { deriveXoshiro128State, type Xoshiro128State } from '../random';

export const MAX_ACTIVE_RELATIONSHIPS_PER_PERSON = 24;
export const MAX_ARCHIVED_RELATIONSHIPS_PER_PERSON = 24;
export const MAX_SHARED_EVENTS_PER_RELATIONSHIP = 16;
export const RELATIONSHIP_PAGE_SIZE = 8;
export const MAX_HOUSEHOLD_INTERVALS_PER_PERSON = 16;
export const MAX_NEW_CANDIDATES_PER_PERSON_PER_YEAR = 8;

export type RelationshipKind =
  | 'legacy-contact'
  | 'acquaintance'
  | 'friend'
  | 'close-friend'
  | 'rival'
  | 'enemy'
  | 'mentor'
  | 'partner'
  | 'long-term-partner'
  | 'former-partner'
  | 'estranged'
  | 'reconciled'
  | 'widowed';
export type RelationshipTrend = 'improving' | 'stable' | 'deteriorating';
export type RelationshipRole =
  'peer' | 'mentor' | 'protege' | 'partner' | 'former-partner' | 'adversary';
export type FamilyBondKind = 'parent' | 'guardian';
export type FamilyBondProvenance =
  'initial-parentage' | 'migrated-parentage' | 'recorded-parentage' | 'recorded-guardianship';
export type FamilyBondStateProvenance = 'neutral-initial' | 'migrated-unknown' | 'recorded';
export type HouseholdIntervalProvenance =
  'initial-current-household' | 'migrated-current-household' | 'recorded-household-event';
export type HouseholdMembershipReason =
  | 'initial-assignment'
  | 'migration-current-household'
  | 'formation'
  | 'join'
  | 'leave'
  | 'split'
  | 'merge'
  | 'child-arrival'
  | 'guardianship';
export type ChildArrivalPolicy = 'pair-bond' | 'communal-guardianship';

export interface RelationshipDirectionalState {
  readonly affinity: number;
  readonly trust: number;
  readonly closeness: number;
  readonly commitment: number;
  readonly grievance: number;
}
export interface SharedRelationshipEvent {
  readonly eventId: number;
  readonly importance: number;
  readonly tick: number;
}
export interface RelationshipEventIdentity {
  readonly kind: string;
  readonly subjectKind: string;
  readonly subjectId: number;
  readonly targetKind: string;
  readonly targetId: number;
}
export interface LegacySocietyCounters {
  readonly cooperation: number | null;
  readonly disagreement: number | null;
  readonly conflict: number | null;
}
export interface ActiveRelationship {
  readonly id: number;
  readonly firstPersonId: number;
  readonly secondPersonId: number;
  readonly firstRole: RelationshipRole;
  readonly secondRole: RelationshipRole;
  readonly kind: RelationshipKind;
  readonly formedTick: number;
  readonly changedTick: number;
  readonly lastInteractionTick: number;
  readonly observedSinceTick: number;
  readonly trend: RelationshipTrend;
  readonly firstToSecond: RelationshipDirectionalState;
  readonly secondToFirst: RelationshipDirectionalState;
  readonly sharedEvents: readonly SharedRelationshipEvent[];
  readonly rng: Xoshiro128State;
  readonly legacySocietyCounters: LegacySocietyCounters | null;
}
export interface ArchivedRelationshipSummary extends ActiveRelationship {
  readonly endedTick: number;
}
export interface LifetimeRelationshipSummary {
  readonly personId: number;
  readonly kind: RelationshipKind;
  readonly count: number;
  readonly firstTick: number;
  readonly lastTick: number;
}
export interface FamilyBond {
  readonly parentId: number;
  /** Backward-compatible neutral name for the parent or guardian adult. */
  readonly adultId: number;
  readonly childId: number;
  readonly kind: FamilyBondKind;
  readonly provenance: FamilyBondProvenance;
  readonly stateProvenance: FamilyBondStateProvenance;
  readonly formedEventId: number;
  readonly formedTick: number | null;
  readonly changedTick: number;
  readonly lastInteractionTick: number;
  readonly trend: RelationshipTrend;
  readonly parentToChild: RelationshipDirectionalState;
  readonly childToParent: RelationshipDirectionalState;
  readonly sharedEvents: readonly SharedRelationshipEvent[];
}
export interface HouseholdMembershipInterval {
  readonly householdId: number;
  readonly startTick: number | null;
  readonly endTick: number | null;
  readonly provenance: HouseholdIntervalProvenance;
  readonly reason: HouseholdMembershipReason;
}
export interface HouseholdHistoryPrefix {
  readonly intervalCount: number;
  readonly firstKnownStartTick: number | null;
  readonly lastKnownEndTick: number | null;
}
export interface PersonHouseholdHistory {
  readonly personId: number;
  readonly prefix: HouseholdHistoryPrefix | null;
  readonly intervals: readonly HouseholdMembershipInterval[];
}
export type HouseholdHistories = readonly PersonHouseholdHistory[] & {
  readonly get: (personId: number) => PersonHouseholdHistory | undefined;
};
export interface InterpersonalPersonInput {
  readonly id: number;
  readonly alive: boolean;
  readonly birthTick: number;
  readonly parentIds: readonly number[];
  readonly householdId: number;
}
export interface LegacyRelationshipContact {
  readonly firstPersonId: number;
  readonly secondPersonId: number;
  readonly affinity?: number;
  readonly trust?: number;
  readonly cooperation?: number;
  readonly disagreement?: number;
  readonly conflict?: number;
}
export interface ChildArrivalEligibility {
  readonly policy: ChildArrivalPolicy;
  readonly householdId: number;
  readonly guardianIds: readonly number[];
  readonly partnerRelationshipId: number | null;
}
export interface ChildArrivalEligibilityEvidence {
  readonly childId: number;
  readonly policy: ChildArrivalPolicy;
  readonly cultureId: number;
  readonly householdId: number;
  readonly guardianIds: readonly number[];
  /** Immutable evidence aligned by index with guardianIds. */
  readonly guardianBirthTicks: readonly number[];
  /** Immutable household evidence aligned by index with guardianIds. */
  readonly guardianHouseholdIdsAtArrival: readonly number[];
  /** Immutable interval-start proof aligned by index with guardianIds. */
  readonly guardianHouseholdMembershipStartTicksAtArrival: readonly (number | null)[];
  readonly partnerRelationshipId: number | null;
  readonly partnerKindAtArrival: 'partner' | 'long-term-partner' | null;
  readonly minimumPartnerTrustAtArrival: number | null;
  readonly minimumPartnerCommitmentAtArrival: number | null;
  readonly selectionScoreAtArrival: number;
}
export interface ChildArrivalRecord extends ChildArrivalEligibilityEvidence {
  readonly tick: number;
  readonly eventId: number;
  /** Stable source event recording the exact culturally selected eligibility path. */
  readonly eligibilityEventId: number;
}
export interface InterpersonalState {
  readonly tick: number;
  readonly nextRelationshipId: number;
  readonly active: readonly ActiveRelationship[];
  readonly archived: readonly ArchivedRelationshipSummary[];
  readonly lifetime: readonly LifetimeRelationshipSummary[];
  readonly familyBonds: readonly FamilyBond[];
  readonly householdHistories: HouseholdHistories;
  readonly childArrivals: readonly ChildArrivalRecord[];
  readonly operationCount: number;
  readonly rng: Xoshiro128State;
}

const KINDS = new Set<RelationshipKind>([
  'legacy-contact',
  'acquaintance',
  'friend',
  'close-friend',
  'rival',
  'enemy',
  'mentor',
  'partner',
  'long-term-partner',
  'former-partner',
  'estranged',
  'reconciled',
  'widowed',
]);
const TRENDS = new Set<RelationshipTrend>(['improving', 'stable', 'deteriorating']);
const ROLES = new Set<RelationshipRole>([
  'peer',
  'mentor',
  'protege',
  'partner',
  'former-partner',
  'adversary',
]);
const BOND_KINDS = new Set<FamilyBondKind>(['parent', 'guardian']);
const BOND_PROVENANCE = new Set<FamilyBondProvenance>([
  'initial-parentage',
  'migrated-parentage',
  'recorded-parentage',
  'recorded-guardianship',
]);
const STATE_PROVENANCE = new Set<FamilyBondStateProvenance>([
  'neutral-initial',
  'migrated-unknown',
  'recorded',
]);
const INTERVAL_PROVENANCE = new Set<HouseholdIntervalProvenance>([
  'initial-current-household',
  'migrated-current-household',
  'recorded-household-event',
]);
const HOUSEHOLD_REASONS = new Set<HouseholdMembershipReason>([
  'initial-assignment',
  'migration-current-household',
  'formation',
  'join',
  'leave',
  'split',
  'merge',
  'child-arrival',
  'guardianship',
]);
const SOCIAL_EVENT_KINDS = new Set([
  'relationship-formed',
  'friendship-formed',
  'close-friendship-formed',
  'friendship-ended',
  'rivalry-formed',
  'enmity-formed',
  'mentorship-formed',
  'partnership-formed',
  'long-term-partnership-formed',
  'partnership-separated',
  'family-estranged',
  'relationship-reconciled',
  'partner-widowed',
  'sibling-bond-formed',
  'parent-child-bond-changed',
  'guardianship-formed',
  'resource-shared',
  'crisis-assisted',
  'knowledge-shared',
  'conflict',
  'family-inheritance',
  'household-formed',
  'household-split',
  'household-merged',
  'pair-bond-child-arrival',
  'communal-child-arrival',
]);

/** Exact factual identity required by a child-arrival eligibility source event. */
export function childArrivalEligibilityEventMatches(
  record: Pick<ChildArrivalRecord, 'childId' | 'guardianIds' | 'policy'>,
  source: RelationshipEventIdentity,
): boolean {
  const [firstGuardianId, secondGuardianId] = record.guardianIds;
  if (
    firstGuardianId === undefined ||
    source.subjectKind !== 'person' ||
    source.subjectId !== firstGuardianId
  )
    return false;
  if (record.policy === 'pair-bond')
    return (
      record.guardianIds.length === 2 &&
      source.kind === 'pair-bond-child-arrival' &&
      source.targetKind === 'person' &&
      source.targetId === secondGuardianId
    );
  return (
    source.kind === 'communal-child-arrival' &&
    source.targetKind === 'person' &&
    source.targetId === (secondGuardianId ?? record.childId)
  );
}

/** Canonical structured evidence duplicated into the immutable eligibility source event. */
export function childArrivalEligibilityEvidence(
  record: ChildArrivalRecord,
): ChildArrivalEligibilityEvidence {
  return Object.freeze({
    childId: record.childId,
    policy: record.policy,
    cultureId: record.cultureId,
    householdId: record.householdId,
    guardianIds: Object.freeze([...record.guardianIds]),
    guardianBirthTicks: Object.freeze([...record.guardianBirthTicks]),
    guardianHouseholdIdsAtArrival: Object.freeze([...record.guardianHouseholdIdsAtArrival]),
    guardianHouseholdMembershipStartTicksAtArrival: Object.freeze([
      ...record.guardianHouseholdMembershipStartTicksAtArrival,
    ]),
    partnerRelationshipId: record.partnerRelationshipId,
    partnerKindAtArrival: record.partnerKindAtArrival,
    minimumPartnerTrustAtArrival: record.minimumPartnerTrustAtArrival,
    minimumPartnerCommitmentAtArrival: record.minimumPartnerCommitmentAtArrival,
    selectionScoreAtArrival: record.selectionScoreAtArrival,
  });
}

/** Exact semantic equality for the record/event dual authority. */
export function childArrivalEligibilityEvidenceMatchesRecord(
  record: ChildArrivalRecord,
  evidence: ChildArrivalEligibilityEvidence,
): boolean {
  const sameArray = <T>(left: readonly T[], right: readonly T[]): boolean =>
    left.length === right.length && left.every((value, index) => value === right[index]);
  return (
    evidence.childId === record.childId &&
    evidence.policy === record.policy &&
    evidence.cultureId === record.cultureId &&
    evidence.householdId === record.householdId &&
    sameArray(evidence.guardianIds, record.guardianIds) &&
    sameArray(evidence.guardianBirthTicks, record.guardianBirthTicks) &&
    sameArray(evidence.guardianHouseholdIdsAtArrival, record.guardianHouseholdIdsAtArrival) &&
    sameArray(
      evidence.guardianHouseholdMembershipStartTicksAtArrival,
      record.guardianHouseholdMembershipStartTicksAtArrival,
    ) &&
    evidence.partnerRelationshipId === record.partnerRelationshipId &&
    evidence.partnerKindAtArrival === record.partnerKindAtArrival &&
    evidence.minimumPartnerTrustAtArrival === record.minimumPartnerTrustAtArrival &&
    evidence.minimumPartnerCommitmentAtArrival === record.minimumPartnerCommitmentAtArrival &&
    evidence.selectionScoreAtArrival === record.selectionScoreAtArrival
  );
}

/** Exact factual identity required by a shared elective-relationship event. */
export function relationshipEventMatchesSocialEdge(
  edge: Pick<ActiveRelationship, 'firstPersonId' | 'secondPersonId'>,
  source: RelationshipEventIdentity,
): boolean {
  return (
    SOCIAL_EVENT_KINDS.has(source.kind) &&
    source.subjectKind === 'person' &&
    source.targetKind === 'person' &&
    ((source.subjectId === edge.firstPersonId && source.targetId === edge.secondPersonId) ||
      (source.subjectId === edge.secondPersonId && source.targetId === edge.firstPersonId))
  );
}

/** Exact factual identity required by a parent or guardian shared event. */
export function relationshipEventMatchesFamilyBond(
  bond: Pick<FamilyBond, 'kind' | 'parentId' | 'childId'>,
  source: RelationshipEventIdentity,
): boolean {
  return (
    (source.kind === 'person-born' &&
      bond.kind === 'parent' &&
      source.subjectKind === 'person' &&
      source.subjectId === bond.childId &&
      source.targetKind === 'household') ||
    (source.kind === 'parent-child-bond-changed' &&
      bond.kind === 'parent' &&
      source.subjectKind === 'person' &&
      source.subjectId === bond.parentId &&
      source.targetKind === 'person' &&
      source.targetId === bond.childId) ||
    (source.kind === 'guardianship-formed' &&
      bond.kind === 'guardian' &&
      source.subjectKind === 'person' &&
      source.subjectId === bond.parentId &&
      source.targetKind === 'person' &&
      source.targetId === bond.childId)
  );
}

function integer(
  value: number,
  label: string,
  minimum = Number.MIN_SAFE_INTEGER,
  maximum = Number.MAX_SAFE_INTEGER,
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(`${label} must be a safe integer in range.`);
}
function positive(value: number, label: string): void {
  integer(value, label, 1);
}
function compareNumber(left: number, right: number): number {
  return left - right;
}
/** Locale-independent UTF-16 code-unit ordering for authoritative canonical collections. */
export function compareOrdinalText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
function comparePair<T extends { readonly firstPersonId: number; readonly secondPersonId: number }>(
  left: T,
  right: T,
): number {
  return left.firstPersonId - right.firstPersonId || left.secondPersonId - right.secondPersonId;
}
function compareBond(left: FamilyBond, right: FamilyBond): number {
  return (
    left.childId - right.childId ||
    left.parentId - right.parentId ||
    compareOrdinalText(left.kind, right.kind)
  );
}
function neutral(): RelationshipDirectionalState {
  return Object.freeze({ affinity: 50, trust: 50, closeness: 0, commitment: 0, grievance: 0 });
}
function pairKey(first: number, second: number): string {
  return `${first}:${second}`;
}

/** Stable canonical key for an elective undirected edge. */
export function canonicalPair(
  firstPersonId: number,
  secondPersonId: number,
): readonly [number, number] {
  positive(firstPersonId, 'Relationship first person id');
  positive(secondPersonId, 'Relationship second person id');
  if (firstPersonId === secondPersonId)
    throw new Error('Relationships cannot reference the same person.');
  return firstPersonId < secondPersonId
    ? [firstPersonId, secondPersonId]
    : [secondPersonId, firstPersonId];
}

function parentIds(person: InterpersonalPersonInput): readonly number[] {
  const result = person.parentIds.filter((id) => id !== 0).sort(compareNumber);
  if (result.length > 2 || result.some((id, index) => index > 0 && result[index - 1] === id))
    throw new Error('Person parent ids must be sorted conceptually and unique.');
  return result;
}
function validatedPeople(
  people: readonly InterpersonalPersonInput[],
  tick: number,
): readonly InterpersonalPersonInput[] {
  integer(tick, 'Interpersonal tick');
  const sorted = [...people].sort((left, right) => left.id - right.id);
  const ids = new Set<number>();
  for (const person of sorted) {
    positive(person.id, 'Person id');
    integer(person.birthTick, 'Person birth tick');
    integer(person.householdId, 'Person household id', 0);
    if (person.birthTick > tick) throw new Error('Person birth tick is after state tick.');
    if (ids.has(person.id)) throw new Error('People must have unique ids.');
    ids.add(person.id);
  }
  for (const person of sorted)
    for (const id of parentIds(person)) {
      positive(id, 'Parent id');
      if (id === person.id || !ids.has(id)) throw new Error('Parent reference is invalid.');
    }
  return sorted;
}
function makeFamilyBonds(
  people: readonly InterpersonalPersonInput[],
  tick: number,
  provenance: FamilyBondProvenance,
  stateProvenance: FamilyBondStateProvenance,
  formedTick: number | null,
): readonly FamilyBond[] {
  return Object.freeze(
    people
      .flatMap((person) =>
        parentIds(person).map((parentId) =>
          Object.freeze({
            parentId,
            adultId: parentId,
            childId: person.id,
            kind: 'parent' as const,
            provenance,
            stateProvenance,
            formedEventId: 0,
            formedTick,
            changedTick: tick,
            lastInteractionTick: tick,
            trend: 'stable' as const,
            parentToChild: neutral(),
            childToParent: neutral(),
            sharedEvents: Object.freeze([]),
          }),
        ),
      )
      .sort(compareBond),
  );
}

function withHistoryLookup(values: readonly PersonHouseholdHistory[]): HouseholdHistories {
  const sorted = [...values].sort((left, right) => left.personId - right.personId);
  const result = sorted as PersonHouseholdHistory[] & {
    get?: (personId: number) => PersonHouseholdHistory | undefined;
  };
  result.get = (personId: number): PersonHouseholdHistory | undefined =>
    result.find((history) => history.personId === personId);
  return Object.freeze(result) as HouseholdHistories;
}
function makeHistories(
  people: readonly InterpersonalPersonInput[],
  tick: number,
  provenance: HouseholdIntervalProvenance,
  reason: HouseholdMembershipReason,
  startTick: number | null,
): HouseholdHistories {
  return withHistoryLookup(
    people.map((person) =>
      Object.freeze({
        personId: person.id,
        prefix: null,
        intervals:
          person.householdId === 0
            ? Object.freeze([])
            : Object.freeze([
                Object.freeze({
                  householdId: person.householdId,
                  startTick,
                  endTick: null,
                  provenance,
                  reason,
                }),
              ]),
      }),
    ),
  );
}

export function createInitialInterpersonalState(
  seed: Xoshiro128State,
  tick: number,
  people: readonly InterpersonalPersonInput[],
): InterpersonalState {
  const sorted = validatedPeople(people, tick);
  const state: InterpersonalState = Object.freeze({
    tick,
    nextRelationshipId: 1,
    active: Object.freeze([]),
    archived: Object.freeze([]),
    lifetime: Object.freeze([]),
    childArrivals: Object.freeze([]),
    familyBonds: makeFamilyBonds(sorted, tick, 'initial-parentage', 'neutral-initial', tick),
    householdHistories: makeHistories(
      sorted,
      tick,
      'initial-current-household',
      'initial-assignment',
      tick,
    ),
    operationCount: sorted.length,
    rng: deriveXoshiro128State(seed, 'm4.5-interpersonal'),
  });
  assertInterpersonalInvariants(state, sorted);
  return state;
}

/** Conservative v3 mapping: only changed counters become untyped contacts. */
export function migrateLegacyInterpersonalState(
  seed: Xoshiro128State,
  tick: number,
  people: readonly InterpersonalPersonInput[],
  legacyContacts: readonly LegacyRelationshipContact[],
): InterpersonalState {
  const sorted = validatedPeople(people, tick);
  const ids = new Set(sorted.map((person) => person.id));
  const seen = new Set<string>();
  const candidates = legacyContacts
    .map((contact) => {
      const [firstPersonId, secondPersonId] = canonicalPair(
        contact.firstPersonId,
        contact.secondPersonId,
      );
      if (!ids.has(firstPersonId) || !ids.has(secondPersonId))
        throw new Error('Legacy relationship reference is invalid.');
      for (const value of [
        contact.affinity,
        contact.trust,
        contact.cooperation,
        contact.disagreement,
        contact.conflict,
      ])
        if (value !== undefined) integer(value, 'Legacy relationship counter', 0, 100);
      const key = pairKey(firstPersonId, secondPersonId);
      if (seen.has(key)) throw new Error('Legacy relationships must not duplicate a pair.');
      seen.add(key);
      const hasSocietyBond =
        contact.cooperation !== undefined ||
        contact.disagreement !== undefined ||
        contact.conflict !== undefined;
      const strength = Math.max(
        Math.abs((contact.affinity ?? 50) - 50),
        Math.abs((contact.trust ?? 50) - 50),
        contact.cooperation ?? 0,
        contact.conflict ?? 0,
      );
      return { contact, firstPersonId, secondPersonId, hasSocietyBond, strength };
    })
    .filter(
      (candidate) =>
        (candidate.contact.affinity !== undefined && candidate.contact.affinity !== 50) ||
        (candidate.contact.trust !== undefined && candidate.contact.trust !== 50) ||
        candidate.hasSocietyBond,
    )
    .sort(
      (left, right) =>
        Number(right.hasSocietyBond) - Number(left.hasSocietyBond) ||
        right.strength - left.strength ||
        left.firstPersonId - right.firstPersonId ||
        left.secondPersonId - right.secondPersonId,
    );
  const degree = new Map<number, number>();
  const active: ActiveRelationship[] = [];
  for (const candidate of candidates) {
    if (
      (degree.get(candidate.firstPersonId) ?? 0) >= MAX_ACTIVE_RELATIONSHIPS_PER_PERSON ||
      (degree.get(candidate.secondPersonId) ?? 0) >= MAX_ACTIVE_RELATIONSHIPS_PER_PERSON
    )
      continue;
    const direction = Object.freeze({
      affinity: candidate.contact.affinity ?? 50,
      trust: candidate.contact.trust ?? 50,
      closeness: candidate.contact.cooperation ?? 0,
      commitment: 0,
      grievance: candidate.contact.conflict ?? 0,
    });
    active.push(
      Object.freeze({
        id: active.length + 1,
        firstPersonId: candidate.firstPersonId,
        secondPersonId: candidate.secondPersonId,
        firstRole: 'peer',
        secondRole: 'peer',
        kind: 'legacy-contact',
        formedTick: tick,
        changedTick: tick,
        lastInteractionTick: tick,
        observedSinceTick: tick,
        trend: 'stable',
        firstToSecond: direction,
        secondToFirst: Object.freeze({ ...direction }),
        sharedEvents: Object.freeze([]),
        rng: deriveXoshiro128State(
          seed,
          `m4.5-legacy:${candidate.firstPersonId}:${candidate.secondPersonId}`,
        ),
        legacySocietyCounters: Object.freeze({
          cooperation: candidate.contact.cooperation ?? null,
          disagreement: candidate.contact.disagreement ?? null,
          conflict: candidate.contact.conflict ?? null,
        }),
      }),
    );
    degree.set(candidate.firstPersonId, (degree.get(candidate.firstPersonId) ?? 0) + 1);
    degree.set(candidate.secondPersonId, (degree.get(candidate.secondPersonId) ?? 0) + 1);
  }
  const state: InterpersonalState = Object.freeze({
    tick,
    nextRelationshipId: active.length + 1,
    active: Object.freeze(active.sort(comparePair)),
    archived: Object.freeze([]),
    lifetime: Object.freeze([]),
    childArrivals: Object.freeze([]),
    familyBonds: makeFamilyBonds(sorted, tick, 'migrated-parentage', 'migrated-unknown', null),
    householdHistories: makeHistories(
      sorted,
      tick,
      'migrated-current-household',
      'migration-current-household',
      null,
    ),
    operationCount: sorted.length + candidates.length,
    rng: deriveXoshiro128State(seed, 'm4.5-interpersonal'),
  });
  assertInterpersonalInvariants(state, sorted);
  return state;
}

/** Highest (importance, tick, inverse-event-id) event references, deterministically. */
export function retainSharedEventReferences(
  events: readonly SharedRelationshipEvent[],
): readonly SharedRelationshipEvent[] {
  const ids = new Set<number>();
  for (const event of events) {
    positive(event.eventId, 'Relationship event id');
    integer(event.importance, 'Relationship event importance', 0);
    integer(event.tick, 'Relationship event tick');
    if (ids.has(event.eventId)) throw new Error('Relationship event ids must be unique.');
    ids.add(event.eventId);
  }
  return Object.freeze(
    [...events]
      .sort(
        (left, right) =>
          right.importance - left.importance ||
          right.tick - left.tick ||
          left.eventId - right.eventId,
      )
      .slice(0, MAX_SHARED_EVENTS_PER_RELATIONSHIP)
      .map((event) => Object.freeze({ ...event })),
  );
}
function outgoing(
  edge: Pick<ActiveRelationship, 'firstPersonId' | 'firstToSecond' | 'secondToFirst'>,
  personId: number,
): RelationshipDirectionalState {
  return edge.firstPersonId === personId ? edge.firstToSecond : edge.secondToFirst;
}
function other(
  edge: Pick<ActiveRelationship, 'firstPersonId' | 'secondPersonId'>,
  personId: number,
): number {
  return edge.firstPersonId === personId ? edge.secondPersonId : edge.firstPersonId;
}
function major(edge: Pick<ActiveRelationship, 'sharedEvents'>): number {
  return edge.sharedEvents.some((event) => event.importance > 0) ? 1 : 0;
}
/** ADR-025 ascending eviction order. */
export function compareRelationshipRetentionForPerson(
  left: ActiveRelationship | ArchivedRelationshipSummary,
  right: ActiveRelationship | ArchivedRelationshipSummary,
  personId: number,
): number {
  const a = outgoing(left, personId);
  const b = outgoing(right, personId);
  return (
    major(left) - major(right) ||
    Math.max(a.closeness, a.grievance) - Math.max(b.closeness, b.grievance) ||
    left.lastInteractionTick - right.lastInteractionTick ||
    other(right, personId) - other(left, personId) ||
    left.id - right.id
  );
}
function protectedPartner(edge: ActiveRelationship): boolean {
  return edge.kind === 'partner' || edge.kind === 'long-term-partner';
}
function fold(
  lifetime: readonly LifetimeRelationshipSummary[],
  edge: ArchivedRelationshipSummary,
): readonly LifetimeRelationshipSummary[] {
  const result = [...lifetime];
  for (const personId of [edge.firstPersonId, edge.secondPersonId]) {
    const index = result.findIndex(
      (summary) => summary.personId === personId && summary.kind === edge.kind,
    );
    const firstTick = Math.min(edge.formedTick, edge.endedTick);
    const lastTick = Math.max(edge.lastInteractionTick, edge.endedTick);
    if (index < 0) result.push({ personId, kind: edge.kind, count: 1, firstTick, lastTick });
    else {
      const prior = result[index]!;
      result[index] = {
        ...prior,
        count: prior.count + 1,
        firstTick: Math.min(prior.firstTick, firstTick),
        lastTick: Math.max(prior.lastTick, lastTick),
      };
    }
  }
  return Object.freeze(
    result.sort(
      (left, right) => left.personId - right.personId || compareOrdinalText(left.kind, right.kind),
    ),
  );
}
function trimArchives(
  archived: readonly ArchivedRelationshipSummary[],
  lifetime: readonly LifetimeRelationshipSummary[],
): {
  readonly archived: readonly ArchivedRelationshipSummary[];
  readonly lifetime: readonly LifetimeRelationshipSummary[];
} {
  let kept = [...archived];
  let summaries = lifetime;
  while (true) {
    const overflow = [...new Set(kept.flatMap((edge) => [edge.firstPersonId, edge.secondPersonId]))]
      .sort(compareNumber)
      .find(
        (personId) =>
          kept.filter((edge) => edge.firstPersonId === personId || edge.secondPersonId === personId)
            .length > MAX_ARCHIVED_RELATIONSHIPS_PER_PERSON,
      );
    if (overflow === undefined) break;
    const evicted = kept
      .filter((edge) => edge.firstPersonId === overflow || edge.secondPersonId === overflow)
      .sort((left, right) => compareRelationshipRetentionForPerson(left, right, overflow))[0]!;
    kept = kept.filter((edge) => edge.id !== evicted.id);
    summaries = fold(summaries, evicted);
  }
  return { archived: Object.freeze(kept.sort(comparePair)), lifetime: summaries };
}
function admitActiveRelationshipUnchecked(
  state: InterpersonalState,
  relationship: ActiveRelationship,
): InterpersonalState {
  const active = [
    ...state.active,
    Object.freeze({
      ...relationship,
      sharedEvents: retainSharedEventReferences(relationship.sharedEvents),
    }),
  ];
  const archived = [...state.archived];
  while (true) {
    const overflow = [
      ...new Set(active.flatMap((edge) => [edge.firstPersonId, edge.secondPersonId])),
    ]
      .sort(compareNumber)
      .find(
        (personId) =>
          active.filter(
            (edge) => edge.firstPersonId === personId || edge.secondPersonId === personId,
          ).length > MAX_ACTIVE_RELATIONSHIPS_PER_PERSON,
      );
    if (overflow === undefined) break;
    const evicted = active
      .filter(
        (edge) =>
          (edge.firstPersonId === overflow || edge.secondPersonId === overflow) &&
          !protectedPartner(edge),
      )
      .sort((left, right) => compareRelationshipRetentionForPerson(left, right, overflow))[0];
    if (evicted === undefined)
      throw new Error('Active partner protection leaves no elective slot.');
    active.splice(
      active.findIndex((edge) => edge.id === evicted.id),
      1,
    );
    archived.push(Object.freeze({ ...evicted, endedTick: evicted.lastInteractionTick }));
  }
  const trimmed = trimArchives(archived, state.lifetime);
  const next: InterpersonalState = Object.freeze({
    ...state,
    nextRelationshipId: Math.max(state.nextRelationshipId, relationship.id + 1),
    active: Object.freeze(active.sort(comparePair)),
    archived: trimmed.archived,
    lifetime: trimmed.lifetime,
    operationCount: state.operationCount + 1,
  });
  return next;
}

export function admitActiveRelationship(
  state: InterpersonalState,
  people: readonly InterpersonalPersonInput[],
  relationship: ActiveRelationship,
): InterpersonalState {
  assertInterpersonalInvariants(state, people);
  const next = admitActiveRelationshipUnchecked(state, relationship);
  assertInterpersonalInvariants(next, people);
  return next;
}

/** Batch admission validates the same invariants once at each boundary. */
export function admitActiveRelationships(
  state: InterpersonalState,
  people: readonly InterpersonalPersonInput[],
  relationships: readonly ActiveRelationship[],
): InterpersonalState {
  assertInterpersonalInvariants(state, people);
  let next = state;
  for (const relationship of relationships)
    next = admitActiveRelationshipUnchecked(next, relationship);
  assertInterpersonalInvariants(next, people);
  return next;
}
export function archiveActiveRelationship(
  state: InterpersonalState,
  people: readonly InterpersonalPersonInput[],
  relationshipId: number,
  endedTick: number,
): InterpersonalState {
  assertInterpersonalInvariants(state, people);
  positive(relationshipId, 'Relationship id');
  integer(endedTick, 'Relationship end tick');
  const edge = state.active.find((candidate) => candidate.id === relationshipId);
  if (edge === undefined || endedTick < edge.lastInteractionTick || endedTick > state.tick)
    throw new Error('Active relationship end is invalid.');
  const trimmed = trimArchives(
    [...state.archived, Object.freeze({ ...edge, endedTick })],
    state.lifetime,
  );
  const next: InterpersonalState = Object.freeze({
    ...state,
    active: Object.freeze(state.active.filter((candidate) => candidate.id !== relationshipId)),
    archived: trimmed.archived,
    lifetime: trimmed.lifetime,
    operationCount: state.operationCount + 1,
  });
  assertInterpersonalInvariants(next, people);
  return next;
}

export function appendHouseholdMembershipInterval(
  history: PersonHouseholdHistory,
  interval: HouseholdMembershipInterval,
): PersonHouseholdHistory {
  const intervals = [...history.intervals, interval];
  assertHouseholdHistory(
    { ...history, intervals },
    Number.MAX_SAFE_INTEGER,
    MAX_HOUSEHOLD_INTERVALS_PER_PERSON + 1,
  );
  if (intervals.length <= MAX_HOUSEHOLD_INTERVALS_PER_PERSON)
    return Object.freeze({ ...history, intervals: Object.freeze(intervals) });
  const removed = intervals.shift()!;
  if (removed.endTick === null) throw new Error('An open household interval cannot be folded.');
  return Object.freeze({
    ...history,
    prefix: Object.freeze({
      intervalCount: (history.prefix?.intervalCount ?? 0) + 1,
      firstKnownStartTick: history.prefix?.firstKnownStartTick ?? removed.startTick,
      lastKnownEndTick: removed.endTick,
    }),
    intervals: Object.freeze(intervals),
  });
}
/** Synchronizes only observed people, genealogy, and household transitions; it never forms elective edges. */
export function synchronizeInterpersonalPeople(
  state: InterpersonalState,
  tick: number,
  people: readonly InterpersonalPersonInput[],
  reason: HouseholdMembershipReason = 'join',
): InterpersonalState {
  integer(tick, 'Synchronization tick');
  if (tick < state.tick) throw new Error('Synchronization tick cannot move backwards.');
  const sorted = validatedPeople(people, tick);
  const priorIds = new Set(state.householdHistories.map((history) => history.personId));
  const desiredIds = new Set(sorted.map((person) => person.id));
  if ([...priorIds].some((id) => !desiredIds.has(id)))
    throw new Error('Synchronization cannot erase factual people.');
  const bondKeys = new Set(state.familyBonds.map((bond) => `${bond.parentId}:${bond.childId}`));
  const bonds = [...state.familyBonds];
  for (const person of sorted)
    for (const parentId of parentIds(person)) {
      const key = `${parentId}:${person.id}`;
      if (!bondKeys.has(key)) {
        bonds.push(
          Object.freeze({
            parentId,
            childId: person.id,
            kind: 'parent',
            provenance: 'recorded-parentage',
            stateProvenance: 'recorded',
            adultId: parentId,
            formedEventId: 0,
            formedTick: tick,
            changedTick: tick,
            lastInteractionTick: tick,
            trend: 'stable',
            parentToChild: neutral(),
            childToParent: neutral(),
            sharedEvents: Object.freeze([]),
          }),
        );
        bondKeys.add(key);
      }
    }
  const histories = sorted.map((person) => {
    const prior = state.householdHistories.find((history) => history.personId === person.id);
    if (prior === undefined)
      return Object.freeze({
        personId: person.id,
        prefix: null,
        intervals:
          person.householdId === 0
            ? Object.freeze([])
            : Object.freeze([
                Object.freeze({
                  householdId: person.householdId,
                  startTick: tick,
                  endTick: null,
                  provenance: 'recorded-household-event' as const,
                  reason,
                }),
              ]),
      });
    const open = prior.intervals.at(-1);
    if (
      (person.householdId === 0 && open?.endTick !== null) ||
      (person.householdId !== 0 &&
        open?.householdId === person.householdId &&
        open.endTick === null)
    )
      return prior;
    const closed =
      open === undefined
        ? prior
        : Object.freeze({
            ...prior,
            intervals: Object.freeze([
              ...prior.intervals.slice(0, -1),
              Object.freeze({ ...open, endTick: tick }),
            ]),
          });
    return person.householdId === 0
      ? closed
      : appendHouseholdMembershipInterval(closed, {
          householdId: person.householdId,
          startTick: tick,
          endTick: null,
          provenance: 'recorded-household-event',
          reason,
        });
  });
  const next: InterpersonalState = Object.freeze({
    ...state,
    tick,
    familyBonds: Object.freeze(bonds.sort(compareBond)),
    householdHistories: withHistoryLookup(histories),
    operationCount: state.operationCount + sorted.length,
  });
  assertInterpersonalInvariants(next, sorted);
  return next;
}

export function findActiveRelationship(
  state: InterpersonalState,
  firstPersonId: number,
  secondPersonId: number,
): ActiveRelationship | undefined {
  const [first, second] = canonicalPair(firstPersonId, secondPersonId);
  return state.active.find(
    (edge) => edge.firstPersonId === first && edge.secondPersonId === second,
  );
}
export function listRelationshipsForPerson(
  state: InterpersonalState,
  personId: number,
  includeArchived = false,
): readonly (ActiveRelationship | ArchivedRelationshipSummary)[] {
  positive(personId, 'Relationship person id');
  return Object.freeze(
    (includeArchived ? [...state.active, ...state.archived] : [...state.active])
      .filter((edge) => edge.firstPersonId === personId || edge.secondPersonId === personId)
      .sort(comparePair),
  );
}
/** Genealogy queries deliberately exclude guardian links. */
export function parentIdsFor(state: InterpersonalState, childId: number): readonly number[] {
  positive(childId, 'Child id');
  return Object.freeze(
    state.familyBonds
      .filter((bond) => bond.kind === 'parent' && bond.childId === childId)
      .map((bond) => bond.parentId)
      .sort(compareNumber),
  );
}
export function guardianIdsFor(state: InterpersonalState, childId: number): readonly number[] {
  positive(childId, 'Child id');
  return Object.freeze(
    state.familyBonds
      .filter((bond) => bond.kind === 'guardian' && bond.childId === childId)
      .map((bond) => bond.parentId)
      .sort(compareNumber),
  );
}
export function childIdsFor(state: InterpersonalState, parentId: number): readonly number[] {
  positive(parentId, 'Parent id');
  return Object.freeze(
    state.familyBonds
      .filter((bond) => bond.kind === 'parent' && bond.parentId === parentId)
      .map((bond) => bond.childId)
      .sort(compareNumber),
  );
}
export function siblingIdsFor(state: InterpersonalState, personId: number): readonly number[] {
  const parents = new Set(parentIdsFor(state, personId));
  return Object.freeze(
    state.householdHistories
      .map((history) => history.personId)
      .filter(
        (candidate) =>
          candidate !== personId &&
          parentIdsFor(state, candidate).some((parent) => parents.has(parent)),
      )
      .sort(compareNumber),
  );
}
function ancestors(
  state: InterpersonalState,
  personId: number,
  maximum: number,
): ReadonlyMap<number, number> {
  const distances = new Map<number, number>();
  let frontier = [personId];
  for (let depth = 1; depth <= maximum && frontier.length > 0; depth += 1) {
    const next: number[] = [];
    for (const descendant of frontier)
      for (const parent of parentIdsFor(state, descendant))
        if (!distances.has(parent)) {
          distances.set(parent, depth);
          next.push(parent);
        }
    frontier = next.sort(compareNumber);
  }
  return distances;
}
export function isDirectFamily(
  state: InterpersonalState,
  firstPersonId: number,
  secondPersonId: number,
): boolean {
  canonicalPair(firstPersonId, secondPersonId);
  return (
    ancestors(state, firstPersonId, state.householdHistories.length).has(secondPersonId) ||
    ancestors(state, secondPersonId, state.householdHistories.length).has(firstPersonId)
  );
}
export function isSibling(
  state: InterpersonalState,
  firstPersonId: number,
  secondPersonId: number,
): boolean {
  canonicalPair(firstPersonId, secondPersonId);
  const parents = new Set(parentIdsFor(state, firstPersonId));
  return parentIdsFor(state, secondPersonId).some((parent) => parents.has(parent));
}
export function isExtendedKin(
  state: InterpersonalState,
  firstPersonId: number,
  secondPersonId: number,
): boolean {
  if (
    isDirectFamily(state, firstPersonId, secondPersonId) ||
    isSibling(state, firstPersonId, secondPersonId)
  )
    return false;
  const first = ancestors(state, firstPersonId, 3);
  const second = ancestors(state, secondPersonId, 3);
  return [...first.keys()].some((id) => second.has(id));
}
export function isProhibitedPartnerKin(
  state: InterpersonalState,
  firstPersonId: number,
  secondPersonId: number,
): boolean {
  if (
    isDirectFamily(state, firstPersonId, secondPersonId) ||
    isSibling(state, firstPersonId, secondPersonId)
  )
    return true;
  const first = ancestors(state, firstPersonId, 2);
  const second = ancestors(state, secondPersonId, 2);
  return [...first].some(([id, firstDistance]) => {
    const secondDistance = second.get(id);
    return (
      secondDistance !== undefined &&
      ((firstDistance === 1 && secondDistance === 2) ||
        (firstDistance === 2 && secondDistance === 1) ||
        (firstDistance === 2 && secondDistance === 2))
    );
  });
}

function householdHistorySupportsArrival(
  state: InterpersonalState,
  personId: number,
  householdId: number,
  tick: number,
  membershipStartTickAtArrival: number | null,
): boolean {
  const history = state.householdHistories.get(personId);
  if (history === undefined) return false;
  const hasMatchingInterval = history.intervals.some(
    (candidate) =>
      candidate.householdId === householdId &&
      candidate.startTick === membershipStartTickAtArrival &&
      (candidate.startTick === null || candidate.startTick <= tick) &&
      (candidate.endTick === null || tick < candidate.endTick),
  );
  if (hasMatchingInterval) return true;
  const prefix = history.prefix;
  const firstRetainedStartTick = history.intervals[0]?.startTick;
  return (
    prefix !== null &&
    (membershipStartTickAtArrival === null
      ? prefix.firstKnownStartTick === null
      : (prefix.firstKnownStartTick === null ||
          prefix.firstKnownStartTick <= membershipStartTickAtArrival) &&
        membershipStartTickAtArrival <= tick) &&
    prefix.lastKnownEndTick !== null &&
    tick < prefix.lastKnownEndTick &&
    (firstRetainedStartTick === undefined ||
      firstRetainedStartTick === null ||
      tick < firstRetainedStartTick)
  );
}

function assertChildArrivalFields(
  record: ChildArrivalRecord,
  state: InterpersonalState,
  people: readonly InterpersonalPersonInput[],
): void {
  positive(record.childId, 'Child arrival child id');
  integer(record.eventId, 'Child arrival event id', 0);
  integer(record.eligibilityEventId, 'Child arrival eligibility event id', 0);
  integer(record.tick, 'Child arrival tick');
  if (record.tick > state.tick) throw new Error('Child arrival tick is invalid.');
  const eligibility: ChildArrivalEligibility = record;
  if (eligibility.policy !== 'pair-bond' && eligibility.policy !== 'communal-guardianship')
    throw new Error('Child arrival policy is invalid.');
  positive(record.cultureId, 'Child arrival culture id');
  positive(eligibility.householdId, 'Child arrival household id');
  if (eligibility.guardianIds.length < 1 || eligibility.guardianIds.length > 2)
    throw new Error('Child arrival guardians are invalid.');
  const guardians = [...eligibility.guardianIds];
  if (
    guardians.some(
      (id, index) =>
        !Number.isSafeInteger(id) ||
        id < 1 ||
        (index > 0 && guardians[index - 1]! >= id) ||
        id === record.childId,
    )
  )
    throw new Error('Child arrival guardians must be sorted, unique, and distinct from the child.');
  const child = people.find((person) => person.id === record.childId);
  if (child?.birthTick !== record.tick)
    throw new Error('Child arrival must match the child birth tick.');
  if (
    record.guardianBirthTicks.length !== guardians.length ||
    record.guardianHouseholdIdsAtArrival.length !== guardians.length ||
    record.guardianHouseholdMembershipStartTicksAtArrival.length !== guardians.length
  )
    throw new Error('Child arrival guardian evidence is incomplete.');
  if (
    !guardians.every((id, index) => {
      const guardian = people.find((person) => person.id === id);
      return (
        guardian?.birthTick === record.guardianBirthTicks[index] &&
        record.guardianHouseholdIdsAtArrival[index] === eligibility.householdId &&
        householdHistorySupportsArrival(
          state,
          id,
          eligibility.householdId,
          record.tick,
          record.guardianHouseholdMembershipStartTicksAtArrival[index]!,
        )
      );
    }) ||
    !householdHistorySupportsArrival(
      state,
      record.childId,
      eligibility.householdId,
      record.tick,
      record.tick,
    )
  )
    throw new Error('Child arrival guardians require historical household evidence.');
  integer(record.selectionScoreAtArrival, 'Child arrival selection score', 100);
  if (eligibility.policy === 'pair-bond') {
    if (guardians.length !== 2 || eligibility.partnerRelationshipId === null)
      throw new Error('Pair-bond eligibility is invalid.');
    const activeEdge = state.active.find(
      (candidate) => candidate.id === eligibility.partnerRelationshipId,
    );
    const archivedEdge = state.archived.find(
      (candidate) => candidate.id === eligibility.partnerRelationshipId,
    );
    const edge = activeEdge ?? archivedEdge;
    if (
      edge === undefined ||
      edge.firstPersonId !== guardians[0] ||
      edge.secondPersonId !== guardians[1] ||
      edge.formedTick > record.tick ||
      (archivedEdge !== undefined && archivedEdge.endedTick < record.tick) ||
      (record.eligibilityEventId === 0 &&
        record.tick === state.tick &&
        (edge.kind !== record.partnerKindAtArrival ||
          (edge.kind !== 'partner' && edge.kind !== 'long-term-partner') ||
          record.minimumPartnerTrustAtArrival !==
            Math.min(edge.firstToSecond.trust, edge.secondToFirst.trust) ||
          record.minimumPartnerCommitmentAtArrival !==
            Math.min(edge.firstToSecond.commitment, edge.secondToFirst.commitment))) ||
      (record.partnerKindAtArrival !== 'partner' &&
        record.partnerKindAtArrival !== 'long-term-partner') ||
      record.minimumPartnerTrustAtArrival === null ||
      record.minimumPartnerTrustAtArrival < 50 ||
      record.minimumPartnerTrustAtArrival > 100 ||
      record.minimumPartnerCommitmentAtArrival === null ||
      record.minimumPartnerCommitmentAtArrival < 60 ||
      record.minimumPartnerCommitmentAtArrival > 100
    )
      throw new Error('Pair-bond relationship evidence is invalid.');
  } else if (
    eligibility.partnerRelationshipId !== null ||
    record.partnerKindAtArrival !== null ||
    record.minimumPartnerTrustAtArrival !== null ||
    record.minimumPartnerCommitmentAtArrival !== null
  )
    throw new Error('Communal guardianship cannot require pair-bond evidence.');
}

/** Validates factual child-arrival policy/evidence against the current sparse authority. */
export function assertChildArrivalRecord(
  record: ChildArrivalRecord,
  state: InterpersonalState,
  people: readonly InterpersonalPersonInput[],
): void {
  assertInterpersonalInvariants(state, people);
  assertChildArrivalFields(record, state, people);
}

export function interpersonalDto(state: InterpersonalState): Readonly<Record<string, unknown>> {
  return Object.freeze({
    tick: state.tick,
    nextRelationshipId: state.nextRelationshipId,
    active: state.active.map(dtoRelationship),
    archived: state.archived.map((edge) => ({
      ...dtoRelationship(edge),
      endedTick: edge.endedTick,
    })),
    lifetime: state.lifetime.map((summary) => ({
      personId: summary.personId,
      kind: summary.kind,
      count: summary.count,
      firstTick: summary.firstTick,
      lastTick: summary.lastTick,
    })),
    familyBonds: state.familyBonds.map((bond) => ({
      parentId: bond.parentId,
      adultId: bond.adultId,
      childId: bond.childId,
      kind: bond.kind,
      provenance: bond.provenance,
      stateProvenance: bond.stateProvenance,
      formedEventId: bond.formedEventId,
      formedTick: bond.formedTick,
      changedTick: bond.changedTick,
      lastInteractionTick: bond.lastInteractionTick,
      trend: bond.trend,
      parentToChild: directionDto(bond.parentToChild),
      childToParent: directionDto(bond.childToParent),
      sharedEvents: bond.sharedEvents.map(eventDto),
    })),
    householdHistories: state.householdHistories.map((history) => ({
      personId: history.personId,
      prefix:
        history.prefix === null
          ? null
          : {
              intervalCount: history.prefix.intervalCount,
              firstKnownStartTick: history.prefix.firstKnownStartTick,
              lastKnownEndTick: history.prefix.lastKnownEndTick,
            },
      intervals: history.intervals.map((interval) => ({
        householdId: interval.householdId,
        startTick: interval.startTick,
        endTick: interval.endTick,
        provenance: interval.provenance,
        reason: interval.reason,
      })),
    })),
    childArrivals: state.childArrivals.map((arrival) => ({
      childId: arrival.childId,
      tick: arrival.tick,
      eventId: arrival.eventId,
      policy: arrival.policy,
      cultureId: arrival.cultureId,
      householdId: arrival.householdId,
      guardianIds: [...arrival.guardianIds],
      guardianBirthTicks: [...arrival.guardianBirthTicks],
      guardianHouseholdIdsAtArrival: [...arrival.guardianHouseholdIdsAtArrival],
      guardianHouseholdMembershipStartTicksAtArrival: [
        ...arrival.guardianHouseholdMembershipStartTicksAtArrival,
      ],
      eligibilityEventId: arrival.eligibilityEventId,
      partnerRelationshipId: arrival.partnerRelationshipId,
      partnerKindAtArrival: arrival.partnerKindAtArrival,
      minimumPartnerTrustAtArrival: arrival.minimumPartnerTrustAtArrival,
      minimumPartnerCommitmentAtArrival: arrival.minimumPartnerCommitmentAtArrival,
      selectionScoreAtArrival: arrival.selectionScoreAtArrival,
    })),
    operationCount: state.operationCount,
    rng: [...state.rng],
  });
}
function directionDto(value: RelationshipDirectionalState): Readonly<Record<string, number>> {
  return {
    affinity: value.affinity,
    trust: value.trust,
    closeness: value.closeness,
    commitment: value.commitment,
    grievance: value.grievance,
  };
}
function eventDto(value: SharedRelationshipEvent): Readonly<Record<string, number>> {
  return { eventId: value.eventId, importance: value.importance, tick: value.tick };
}
function dtoRelationship(edge: ActiveRelationship): Readonly<Record<string, unknown>> {
  return {
    id: edge.id,
    firstPersonId: edge.firstPersonId,
    secondPersonId: edge.secondPersonId,
    firstRole: edge.firstRole,
    secondRole: edge.secondRole,
    kind: edge.kind,
    formedTick: edge.formedTick,
    changedTick: edge.changedTick,
    lastInteractionTick: edge.lastInteractionTick,
    observedSinceTick: edge.observedSinceTick,
    trend: edge.trend,
    firstToSecond: directionDto(edge.firstToSecond),
    secondToFirst: directionDto(edge.secondToFirst),
    sharedEvents: edge.sharedEvents.map(eventDto),
    rng: [...edge.rng],
    legacySocietyCounters:
      edge.legacySocietyCounters === null
        ? null
        : {
            cooperation: edge.legacySocietyCounters.cooperation,
            disagreement: edge.legacySocietyCounters.disagreement,
            conflict: edge.legacySocietyCounters.conflict,
          },
  };
}
function assertDirection(value: RelationshipDirectionalState, label: string): void {
  for (const name of ['affinity', 'trust', 'closeness', 'commitment', 'grievance'] as const)
    integer(value[name], `${label} ${name}`, 0, 100);
}
function assertRng(value: Xoshiro128State, label: string): void {
  if (
    value.length !== 4 ||
    value.some((word) => !Number.isSafeInteger(word) || word < 0 || word > 0xffff_ffff) ||
    (value[0] | value[1] | value[2] | value[3]) === 0
  )
    throw new Error(`${label} RNG is invalid.`);
}
function assertEvents(
  events: readonly SharedRelationshipEvent[],
  tick: number,
  label: string,
): void {
  if (
    events.length > MAX_SHARED_EVENTS_PER_RELATIONSHIP ||
    retainSharedEventReferences(events).some(
      (event, index) => event.eventId !== events[index]?.eventId,
    )
  )
    throw new Error(`${label} shared events are invalid.`);
  if (events.some((event) => event.tick > tick))
    throw new Error(`${label} references a future event.`);
}
function assertEdge(
  edge: ActiveRelationship | ArchivedRelationshipSummary,
  people: ReadonlySet<number>,
  tick: number,
  archived: boolean,
): void {
  positive(edge.id, 'Relationship id');
  const [first, second] = canonicalPair(edge.firstPersonId, edge.secondPersonId);
  if (
    first !== edge.firstPersonId ||
    second !== edge.secondPersonId ||
    !people.has(first) ||
    !people.has(second)
  )
    throw new Error('Relationship pair is invalid.');
  if (
    !KINDS.has(edge.kind) ||
    !ROLES.has(edge.firstRole) ||
    !ROLES.has(edge.secondRole) ||
    !TRENDS.has(edge.trend)
  )
    throw new Error('Relationship category is invalid.');
  for (const [label, value] of [
    ['formed', edge.formedTick],
    ['changed', edge.changedTick],
    ['last interaction', edge.lastInteractionTick],
    ['observed since', edge.observedSinceTick],
  ] as const)
    integer(value, `Relationship ${label} tick`);
  if (
    edge.formedTick > edge.changedTick ||
    edge.changedTick > tick ||
    edge.lastInteractionTick > tick ||
    edge.observedSinceTick > tick
  )
    throw new Error('Relationship ticks are invalid.');
  if (archived) {
    const ended = (edge as ArchivedRelationshipSummary).endedTick;
    integer(ended, 'Archived relationship end tick');
    if (ended < edge.lastInteractionTick || ended > tick)
      throw new Error('Archived relationship end tick is invalid.');
  }
  assertDirection(edge.firstToSecond, 'Relationship first direction');
  assertDirection(edge.secondToFirst, 'Relationship second direction');
  assertEvents(edge.sharedEvents, tick, 'Relationship');
  assertRng(edge.rng, 'Relationship');
}
function assertHouseholdHistory(
  history: PersonHouseholdHistory,
  tick: number,
  maximum = MAX_HOUSEHOLD_INTERVALS_PER_PERSON,
): void {
  positive(history.personId, 'Household history person id');
  if (history.intervals.length > maximum)
    throw new Error('Household history interval cap exceeded.');
  if (history.prefix !== null) {
    positive(history.prefix.intervalCount, 'Household prefix count');
    if (history.prefix.firstKnownStartTick !== null)
      integer(history.prefix.firstKnownStartTick, 'Household prefix first tick');
    if (history.prefix.lastKnownEndTick !== null)
      integer(history.prefix.lastKnownEndTick, 'Household prefix last tick');
  }
  let previous: HouseholdMembershipInterval | undefined;
  for (const interval of history.intervals) {
    positive(interval.householdId, 'Household interval household id');
    if (!INTERVAL_PROVENANCE.has(interval.provenance) || !HOUSEHOLD_REASONS.has(interval.reason))
      throw new Error('Household interval provenance or reason is invalid.');
    if (interval.startTick !== null) integer(interval.startTick, 'Household interval start tick');
    if (interval.endTick !== null) integer(interval.endTick, 'Household interval end tick');
    if (
      (interval.startTick !== null && interval.startTick > tick) ||
      (interval.endTick !== null && interval.endTick > tick) ||
      (interval.startTick !== null &&
        interval.endTick !== null &&
        interval.startTick >= interval.endTick)
    )
      throw new Error('Household interval ticks are invalid.');
    if (
      previous !== undefined &&
      (previous.endTick === null ||
        interval.startTick === null ||
        previous.endTick > interval.startTick)
    )
      throw new Error('Household intervals overlap or are unsorted.');
    previous = interval;
  }
}
/** Rejects malformed references, caps, collection order, impossible genealogy, and invalid factual records. */
export function assertInterpersonalInvariants(
  state: InterpersonalState,
  people: readonly InterpersonalPersonInput[],
): void {
  integer(state.tick, 'Interpersonal state tick');
  const sorted = validatedPeople(people, state.tick);
  const ids = new Set(sorted.map((person) => person.id));
  positive(state.nextRelationshipId, 'Next relationship id');
  integer(state.operationCount, 'Interpersonal operation count', 0);
  assertRng(state.rng, 'Interpersonal');
  const sortedUnique = <T>(
    values: readonly T[],
    compare: (left: T, right: T) => number,
    label: string,
  ): void => {
    for (let index = 1; index < values.length; index += 1)
      if (compare(values[index - 1]!, values[index]!) >= 0)
        throw new Error(`${label} must be sorted and unique.`);
  };
  sortedUnique(state.active, comparePair, 'Active relationships');
  sortedUnique(state.archived, comparePair, 'Archived relationships');
  sortedUnique(state.familyBonds, compareBond, 'Family bonds');
  sortedUnique(
    state.householdHistories,
    (left, right) => left.personId - right.personId,
    'Household histories',
  );
  sortedUnique(
    state.lifetime,
    (left, right) => left.personId - right.personId || compareOrdinalText(left.kind, right.kind),
    'Lifetime summaries',
  );
  const relationshipIds = new Set<number>();
  const pairs = new Set<string>();
  const activeDegree = new Map<number, number>();
  const archivedDegree = new Map<number, number>();
  for (const edge of state.active) {
    assertEdge(edge, ids, state.tick, false);
    if (relationshipIds.has(edge.id) || pairs.has(pairKey(edge.firstPersonId, edge.secondPersonId)))
      throw new Error('Relationships must have unique ids and pairs.');
    relationshipIds.add(edge.id);
    pairs.add(pairKey(edge.firstPersonId, edge.secondPersonId));
    for (const id of [edge.firstPersonId, edge.secondPersonId])
      activeDegree.set(id, (activeDegree.get(id) ?? 0) + 1);
  }
  for (const edge of state.archived) {
    assertEdge(edge, ids, state.tick, true);
    if (relationshipIds.has(edge.id) || pairs.has(pairKey(edge.firstPersonId, edge.secondPersonId)))
      throw new Error('Relationships must have unique ids and pairs.');
    relationshipIds.add(edge.id);
    pairs.add(pairKey(edge.firstPersonId, edge.secondPersonId));
    for (const id of [edge.firstPersonId, edge.secondPersonId])
      archivedDegree.set(id, (archivedDegree.get(id) ?? 0) + 1);
  }
  if (
    [...activeDegree.values()].some((degree) => degree > MAX_ACTIVE_RELATIONSHIPS_PER_PERSON) ||
    [...archivedDegree.values()].some((degree) => degree > MAX_ARCHIVED_RELATIONSHIPS_PER_PERSON)
  )
    throw new Error('Relationship cap exceeded.');
  if (state.nextRelationshipId <= Math.max(0, ...relationshipIds))
    throw new Error('Next relationship id is invalid.');
  for (const summary of state.lifetime) {
    if (!ids.has(summary.personId) || !KINDS.has(summary.kind))
      throw new Error('Lifetime summary reference is invalid.');
    positive(summary.count, 'Lifetime summary count');
    integer(summary.firstTick, 'Lifetime summary first tick');
    integer(summary.lastTick, 'Lifetime summary last tick');
    if (summary.firstTick > summary.lastTick)
      throw new Error('Lifetime summary ticks are invalid.');
  }
  const bondKeys = new Set<string>();
  for (const bond of state.familyBonds) {
    positive(bond.parentId, 'Family parent id');
    positive(bond.childId, 'Family child id');
    if (
      bond.adultId !== bond.parentId ||
      bond.parentId === bond.childId ||
      !ids.has(bond.parentId) ||
      !ids.has(bond.childId) ||
      !BOND_KINDS.has(bond.kind) ||
      !BOND_PROVENANCE.has(bond.provenance) ||
      !STATE_PROVENANCE.has(bond.stateProvenance)
    )
      throw new Error('Family bond is invalid.');
    const key = `${bond.parentId}:${bond.childId}`;
    if (bondKeys.has(key)) throw new Error('Parent or guardian links must not duplicate.');
    bondKeys.add(key);
    integer(bond.formedEventId, 'Family bond event id', 0);
    if (bond.formedTick !== null) integer(bond.formedTick, 'Family bond formed tick');
    integer(bond.changedTick, 'Family bond changed tick');
    integer(bond.lastInteractionTick, 'Family bond interaction tick');
    if (
      bond.changedTick > state.tick ||
      bond.lastInteractionTick > state.tick ||
      (bond.formedTick !== null && bond.formedTick > bond.changedTick)
    )
      throw new Error('Family bond ticks are invalid.');
    if (!TRENDS.has(bond.trend)) throw new Error('Family bond trend is invalid.');
    assertDirection(bond.parentToChild, 'Family bond parent direction');
    assertDirection(bond.childToParent, 'Family bond child direction');
    assertEvents(bond.sharedEvents, state.tick, 'Family bond');
  }
  for (const person of sorted) {
    const declared = parentIds(person);
    const recorded = parentIdsFor(state, person.id);
    if (declared.length !== recorded.length || declared.some((id, index) => recorded[index] !== id))
      throw new Error('Declared parentage and family bonds differ.');
  }
  for (const id of ids)
    if (ancestors(state, id, ids.size).has(id))
      throw new Error('Family ancestry contains a cycle.');
  let previousArrivalChildId = 0;
  for (const arrival of state.childArrivals) {
    assertChildArrivalFields(arrival, state, sorted);
    if (arrival.childId <= previousArrivalChildId)
      throw new Error('Child arrivals must be sorted with unique children.');
    previousArrivalChildId = arrival.childId;
    if (arrival.tick > state.tick || (arrival.eventId === 0 && arrival.tick < state.tick))
      throw new Error('Child arrival event provenance is invalid.');
    const child = sorted.find((person) => person.id === arrival.childId);
    const declaredParents = parentIds(child!);
    if (
      declaredParents.length !== arrival.guardianIds.length ||
      declaredParents.some((id, index) => id !== arrival.guardianIds[index])
    )
      throw new Error('Child arrival guardians must match recorded parentage.');
  }
  const histories = new Set<number>();
  for (const history of state.householdHistories) {
    if (!ids.has(history.personId) || histories.has(history.personId))
      throw new Error('Household history reference is invalid.');
    histories.add(history.personId);
    assertHouseholdHistory(history, state.tick);
    const current = sorted.find((person) => person.id === history.personId)!;
    const open = history.intervals.at(-1);
    if (
      current.householdId === 0
        ? open?.endTick === null
        : open?.householdId !== current.householdId || open.endTick !== null
    )
      throw new Error('Current household and history differ.');
  }
  if (histories.size !== ids.size) throw new Error('Every person requires household history.');
}
