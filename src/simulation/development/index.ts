import { deriveXoshiro128State, Xoshiro128StarStar, type Xoshiro128State } from '../random';
import { findActiveRelationship, type InterpersonalState } from '../relationships';
import {
  relationshipDecisionInfluence,
  selectPreferredRelatedPerson,
  type RelationshipExperienceInput,
} from '../relationships/lifecycle';

/** M5 development is deliberately self-contained; the settlement applies returned effects. */
export const MAX_ACTIVE_CRISES = 4;
export const MAX_CRISIS_HISTORY = 32;
export const MAX_PENDING_INTERVENTIONS = 8;
export const MAX_DEVELOPMENT_EVENTS = 24;
export const MAX_CRISIS_RESPONSES = 8;
const MAX_CRISIS_RESPONSE_CANDIDATES = 32;

export type KnowledgeStatus = 'unknown' | 'known' | 'lost';
export type KnowledgeId =
  | 'foraging-lore'
  | 'shelter-craft'
  | 'water-lore'
  | 'water-management'
  | 'stonecraft'
  | 'agriculture'
  | 'kiln-craft'
  | 'metallurgy'
  | 'medicine'
  | 'navigation'
  | 'writing'
  | 'mechanics'
  | 'institutions'
  | 'advanced-energy'
  | 'planetary-engineering'
  | 'spaceflight';

export interface KnowledgeDefinition {
  readonly id: KnowledgeId;
  readonly prerequisites: readonly KnowledgeId[];
  readonly discoveryThreshold: number;
  readonly context: readonly ContextRequirement[];
}

export interface ContextRequirement {
  readonly kind: 'stockpile' | 'terrain' | 'society' | 'skill' | 'pressure';
  readonly id: string;
  readonly minimum: number;
}

export interface KnowledgeRecord {
  readonly id: KnowledgeId;
  readonly status: KnowledgeStatus;
  readonly progress: number;
  readonly discoveredTick: number | null;
  readonly lostTick: number | null;
  readonly recoveredTick: number | null;
  readonly evidence: KnowledgeEvidence | null;
}

export interface KnowledgeRequirementEvidence extends ContextRequirement {
  readonly value: number;
}

export interface KnowledgeEvidence {
  readonly kind: 'founding' | 'discovery' | 'recovery';
  readonly tick: number;
  readonly prerequisiteIds: readonly KnowledgeId[];
  readonly requirements: readonly KnowledgeRequirementEvidence[];
}

export type DisasterKind =
  | 'drought'
  | 'flood'
  | 'fire'
  | 'storm'
  | 'earthquake'
  | 'disease'
  | 'famine'
  | 'resource-collapse'
  | 'political-crisis'
  | 'technological-accident'
  | 'meteor-impact';

export type ConditionId =
  | 'droughtPressure'
  | 'floodPressure'
  | 'firePressure'
  | 'stormPressure'
  | 'seismicPressure'
  | 'diseasePressure'
  | 'faminePressure'
  | 'resourcePressure'
  | 'politicalPressure'
  | 'accidentPressure'
  | 'meteorPressure'
  | 'protection';

export interface DisasterDefinition {
  readonly kind: DisasterKind;
  readonly condition: ConditionId;
}

export const DISASTER_KINDS: readonly DisasterDefinition[] = Object.freeze([
  Object.freeze({ kind: 'drought', condition: 'droughtPressure' }),
  Object.freeze({ kind: 'flood', condition: 'floodPressure' }),
  Object.freeze({ kind: 'fire', condition: 'firePressure' }),
  Object.freeze({ kind: 'storm', condition: 'stormPressure' }),
  Object.freeze({ kind: 'earthquake', condition: 'seismicPressure' }),
  Object.freeze({ kind: 'disease', condition: 'diseasePressure' }),
  Object.freeze({ kind: 'famine', condition: 'faminePressure' }),
  Object.freeze({ kind: 'resource-collapse', condition: 'resourcePressure' }),
  Object.freeze({ kind: 'political-crisis', condition: 'politicalPressure' }),
  Object.freeze({ kind: 'technological-accident', condition: 'accidentPressure' }),
  Object.freeze({ kind: 'meteor-impact', condition: 'meteorPressure' }),
]);

export type InterventionKind =
  | 'weather'
  | 'resource'
  | 'organism'
  | 'omen'
  | 'artifact'
  | 'protection'
  | 'disaster'
  | 'alien-signal';

export interface DevelopmentInterventionInput {
  readonly kind: InterventionKind;
  readonly intensity: number;
  readonly polarity: 'supportive' | 'challenging';
  readonly targetTileIndex: number;
  readonly requestedTick: number;
}

export interface DevelopmentIntervention extends DevelopmentInterventionInput {
  readonly id: number;
}

export type DevelopmentConditions = Readonly<Record<ConditionId, number>>;

export interface ActiveCrisis {
  readonly id: number;
  readonly kind: DisasterKind;
  readonly triggerCondition: ConditionId;
  readonly triggerValue: number;
  readonly triggerThreshold: number;
  readonly startedTick: number;
  readonly severity: number;
}

export interface CrisisHistoryRecord {
  readonly id: number;
  readonly kind: DisasterKind;
  readonly triggerCondition: ConditionId;
  readonly triggerValue: number;
  readonly triggerThreshold: number;
  readonly startedTick: number;
  readonly endedTick: number;
  readonly outcome: 'recovered';
}

export interface DevelopmentState {
  readonly tick: number;
  readonly nextCrisisId: number;
  readonly nextInterventionId: number;
  readonly disasterRng: Xoshiro128State;
  readonly rng: Xoshiro128State;
  readonly knowledge: readonly KnowledgeRecord[];
  readonly researchFocusId: KnowledgeId | null;
  readonly conditions: DevelopmentConditions;
  readonly activeCrises: readonly ActiveCrisis[];
  readonly crisisHistory: readonly CrisisHistoryRecord[];
  readonly pendingInterventions: readonly DevelopmentIntervention[];
  readonly operationCount: number;
}

export interface DevelopmentPerson {
  readonly id: number;
  readonly alive: boolean;
  readonly health: number;
  readonly tileIndex: number;
  readonly householdId: number;
  readonly traits: readonly [number, number, number, number];
  readonly skills: readonly [number, number, number, number];
}

export interface DevelopmentContext {
  readonly tick: number;
  readonly yearTicks: number;
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly centerTileIndex: number;
  readonly people: readonly DevelopmentPerson[];
  readonly interpersonal: InterpersonalState;
  readonly stockpile: Readonly<{
    food: number;
    water: number;
    timber: number;
    stone: number;
    metal: number;
  }>;
  readonly operationalStructures: number;
  readonly damagedStructures: number;
  readonly tradeVolume: number;
  readonly institutionCount: number;
  readonly stability: number;
  readonly scarcity: number;
  readonly inequality: number;
  readonly collapsed: boolean;
  readonly conflictEvents: number;
  readonly terrain: Readonly<{
    dryLandRatio: number;
    floodExposure: number;
    forestRatio: number;
    stormExposure: number;
    seismicity: number;
    resourceDepletion: number;
  }>;
}

export interface DevelopmentEvent {
  readonly kind: string;
  readonly subjectKind: 'world' | 'person';
  readonly subjectId: number;
  readonly tick: number;
  readonly amount: number;
  readonly crisisId?: number;
  readonly interventionId?: number;
  readonly knowledgeId?: KnowledgeId;
  readonly targetTileIndex?: number;
}

export interface CrisisResponse {
  readonly kind: 'protection' | 'aid' | 'caregiving' | 'evacuation';
  readonly helperPersonId: number;
  readonly recipientPersonId: number;
  readonly crisisKind: DisasterKind;
  readonly amount: number;
}

export interface DevelopmentEffects {
  readonly stockpileLoss: Readonly<{ food: number; water: number; timber: number; stone: number }>;
  readonly personHealthDamage: readonly Readonly<{ personId: number; amount: number }>[];
  readonly structureDamage: number;
}

export interface DevelopmentResult {
  readonly state: DevelopmentState;
  readonly events: readonly DevelopmentEvent[];
  readonly effects: DevelopmentEffects;
  readonly responses: readonly CrisisResponse[];
  readonly relationshipExperiences: readonly RelationshipExperienceInput[];
}

const definition = (
  id: KnowledgeId,
  prerequisites: readonly KnowledgeId[],
  discoveryThreshold: number,
  context: readonly ContextRequirement[] = [],
): KnowledgeDefinition =>
  Object.freeze({
    id,
    prerequisites: Object.freeze([...prerequisites]),
    discoveryThreshold,
    context: Object.freeze([...context]),
  });

export const KNOWLEDGE_DEFINITIONS: readonly KnowledgeDefinition[] = Object.freeze([
  definition('foraging-lore', [], 1),
  definition('shelter-craft', [], 1),
  definition('water-lore', [], 1),
  definition('water-management', ['water-lore'], 80, [
    { kind: 'terrain', id: 'dryLandRatio', minimum: 15 },
    { kind: 'pressure', id: 'scarcity', minimum: 20 },
  ]),
  definition('stonecraft', ['shelter-craft'], 80, [
    { kind: 'stockpile', id: 'stone', minimum: 30 },
  ]),
  definition('agriculture', ['foraging-lore', 'water-management'], 100, [
    { kind: 'stockpile', id: 'water', minimum: 35 },
  ]),
  definition('kiln-craft', ['stonecraft'], 100, [{ kind: 'stockpile', id: 'timber', minimum: 25 }]),
  definition('metallurgy', ['stonecraft', 'kiln-craft'], 120, [
    { kind: 'stockpile', id: 'metal', minimum: 20 },
    { kind: 'skill', id: 'craft', minimum: 55 },
  ]),
  definition('medicine', ['water-management'], 120, [
    { kind: 'pressure', id: 'diseasePressure', minimum: 15 },
  ]),
  definition('navigation', ['water-management'], 120, [
    { kind: 'society', id: 'tradeVolume', minimum: 12 },
  ]),
  definition('writing', ['navigation'], 140, [
    { kind: 'society', id: 'institutionCount', minimum: 1 },
  ]),
  definition('mechanics', ['metallurgy', 'writing'], 160, [
    { kind: 'society', id: 'operationalStructures', minimum: 6 },
  ]),
  definition('institutions', ['writing'], 160, [
    { kind: 'society', id: 'institutionCount', minimum: 2 },
  ]),
  definition('advanced-energy', ['mechanics', 'institutions'], 200, [
    { kind: 'stockpile', id: 'metal', minimum: 50 },
  ]),
  definition('planetary-engineering', ['advanced-energy'], 240, [
    { kind: 'society', id: 'tradeVolume', minimum: 30 },
  ]),
  definition('spaceflight', ['planetary-engineering'], 300, [
    { kind: 'society', id: 'operationalStructures', minimum: 20 },
  ]),
]);

const DEFINITION_BY_ID = new Map(KNOWLEDGE_DEFINITIONS.map((entry) => [entry.id, entry]));
const DISASTER_BY_KIND = new Map(DISASTER_KINDS.map((entry) => [entry.kind, entry]));
const FOUNDING = new Set<KnowledgeId>(['foraging-lore', 'shelter-craft', 'water-lore']);
const CONDITION_IDS: readonly ConditionId[] = Object.freeze([
  'droughtPressure',
  'floodPressure',
  'firePressure',
  'stormPressure',
  'seismicPressure',
  'diseasePressure',
  'faminePressure',
  'resourcePressure',
  'politicalPressure',
  'accidentPressure',
  'meteorPressure',
  'protection',
]);

function clamp(value: number, maximum = 100): number {
  return Math.max(0, Math.min(maximum, value));
}
function frozen<T>(value: T): T {
  return Object.freeze(value);
}
function sorted<T>(values: readonly T[], compare: (left: T, right: T) => number): readonly T[] {
  return Object.freeze([...values].sort(compare));
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
function initialConditions(): DevelopmentConditions {
  return frozen({
    droughtPressure: 0,
    floodPressure: 0,
    firePressure: 0,
    stormPressure: 0,
    seismicPressure: 0,
    diseasePressure: 0,
    faminePressure: 0,
    resourcePressure: 0,
    politicalPressure: 0,
    accidentPressure: 0,
    meteorPressure: 0,
    protection: 0,
  });
}

export function createInitialDevelopment(seed: Xoshiro128State, tick: number): DevelopmentState {
  validateInteger(tick, 'Development tick');
  const rng = deriveXoshiro128State(seed, 'development');
  const state: DevelopmentState = frozen({
    tick,
    nextCrisisId: 1,
    nextInterventionId: 1,
    disasterRng: deriveXoshiro128State(seed, 'development-disasters'),
    rng,
    knowledge: Object.freeze(
      KNOWLEDGE_DEFINITIONS.map((entry) =>
        frozen<KnowledgeRecord>({
          id: entry.id,
          status: FOUNDING.has(entry.id) ? 'known' : 'unknown',
          progress: 0,
          discoveredTick: FOUNDING.has(entry.id) ? tick : null,
          lostTick: null,
          recoveredTick: null,
          evidence: FOUNDING.has(entry.id)
            ? frozen({
                kind: 'founding' as const,
                tick,
                prerequisiteIds: Object.freeze([]),
                requirements: Object.freeze([]),
              })
            : null,
        }),
      ),
    ),
    researchFocusId: null,
    conditions: initialConditions(),
    activeCrises: Object.freeze([]),
    crisisHistory: Object.freeze([]),
    pendingInterventions: Object.freeze([]),
    operationCount: 0,
  });
  assertDevelopmentInvariants(state);
  return state;
}

export function queueIntervention(
  state: DevelopmentState,
  intervention: DevelopmentInterventionInput,
): DevelopmentState {
  assertDevelopmentInvariants(state);
  if (
    !INTERVENTION_KINDS.has(intervention.kind) ||
    !['supportive', 'challenging'].includes(intervention.polarity)
  )
    throw new Error('Development intervention kind is invalid.');
  validateInteger(intervention.intensity, 'Intervention intensity', 1, 100);
  validateInteger(intervention.targetTileIndex, 'Intervention tile', 0);
  validateInteger(intervention.requestedTick, 'Intervention requested tick');
  if (state.pendingInterventions.length >= MAX_PENDING_INTERVENTIONS)
    throw new Error('Development intervention queue is full.');
  const pending = sorted(
    [...state.pendingInterventions, frozen({ ...intervention, id: state.nextInterventionId })],
    (left, right) => left.requestedTick - right.requestedTick || left.id - right.id,
  );
  return frozen({
    ...state,
    nextInterventionId: state.nextInterventionId + 1,
    pendingInterventions: pending,
  });
}

const INTERVENTION_KINDS = new Set<InterventionKind>([
  'weather',
  'resource',
  'organism',
  'omen',
  'artifact',
  'protection',
  'disaster',
  'alien-signal',
]);
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
function conditionMet(
  requirement: ContextRequirement,
  state: DevelopmentState,
  context: DevelopmentContext,
): boolean {
  return requirementValue(requirement, state, context) >= requirement.minimum;
}

function requirementValue(
  requirement: ContextRequirement,
  state: DevelopmentState,
  context: DevelopmentContext,
): number {
  const maximumSkill = context.people.reduce(
    (maximum, person) => Math.max(maximum, ...person.skills),
    0,
  );
  const lookup: Readonly<Record<ContextRequirement['kind'], Readonly<Record<string, number>>>> = {
    stockpile: context.stockpile,
    terrain: context.terrain,
    society: {
      tradeVolume: context.tradeVolume,
      institutionCount: context.institutionCount,
      operationalStructures: context.operationalStructures,
    },
    skill: { craft: maximumSkill },
    pressure: { scarcity: context.scarcity, diseasePressure: state.conditions.diseasePressure },
  };
  return lookup[requirement.kind][requirement.id] ?? 0;
}
function canResearch(
  record: KnowledgeRecord,
  state: DevelopmentState,
  context: DevelopmentContext,
): boolean {
  const entry = DEFINITION_BY_ID.get(record.id)!;
  return (
    record.status !== 'known' &&
    entry.prerequisites.every(
      (id) => state.knowledge.find((candidate) => candidate.id === id)?.status === 'known',
    ) &&
    entry.context.every((requirement) => conditionMet(requirement, state, context))
  );
}
function researchScore(entry: KnowledgeDefinition, context: DevelopmentContext): number {
  if (entry.id === 'water-management')
    return (
      context.terrain.dryLandRatio * 3 +
      context.scarcity * 20 +
      context.stockpile.timber -
      context.stockpile.stone
    );
  if (entry.id === 'stonecraft')
    return (
      Math.min(100, context.stockpile.stone) * 2 +
      context.stockpile.metal +
      context.tradeVolume * 2 -
      context.terrain.dryLandRatio -
      context.scarcity * 3
    );
  return (
    entry.context.reduce((total, requirement) => total + requirement.minimum, 0) +
    context.tradeVolume +
    context.operationalStructures +
    (entry.id === 'mechanics' || entry.id === 'metallurgy' ? context.conflictEvents * 3 : 0)
  );
}

function experimentationBonus(
  knowledgeId: KnowledgeId,
  conditions: DevelopmentConditions,
  context: DevelopmentContext,
): number {
  if (knowledgeId !== 'mechanics' && knowledgeId !== 'metallurgy') return 0;
  return Math.min(10, context.conflictEvents + Math.floor(conditions.accidentPressure / 10));
}
function effectFor(crisis: ActiveCrisis, context: DevelopmentContext): DevelopmentEffects {
  const severity = Math.max(1, crisis.severity);
  const losses = { food: 0, water: 0, timber: 0, stone: 0 };
  if (crisis.kind === 'drought' || crisis.kind === 'famine') {
    losses.food = severity;
    losses.water = crisis.kind === 'drought' ? severity : 0;
  } else if (crisis.kind === 'flood' || crisis.kind === 'storm') {
    losses.timber = severity;
    losses.food = Math.floor(severity / 2);
  } else if (crisis.kind === 'fire') losses.timber = severity;
  else if (crisis.kind === 'disease') losses.food = Math.max(1, Math.floor(severity / 2));
  else if (crisis.kind === 'resource-collapse') losses.stone = severity;
  else if (crisis.kind === 'political-crisis') losses.food = Math.floor(severity / 2);
  else if (
    crisis.kind === 'technological-accident' ||
    crisis.kind === 'earthquake' ||
    crisis.kind === 'meteor-impact'
  )
    losses.stone = Math.floor(severity / 2);
  const health =
    crisis.kind === 'disease' ||
    crisis.kind === 'meteor-impact' ||
    crisis.kind === 'earthquake' ||
    crisis.kind === 'technological-accident'
      ? Object.freeze(
          context.people
            .filter((person) => person.alive)
            .sort((left, right) => left.health - right.health || left.id - right.id)
            .slice(0, 2)
            .map((person) => frozen({ personId: person.id, amount: severity })),
        )
      : Object.freeze([]);
  const structureDamage = [
    'fire',
    'flood',
    'storm',
    'earthquake',
    'technological-accident',
    'meteor-impact',
  ].includes(crisis.kind)
    ? severity
    : 0;
  return frozen({ stockpileLoss: frozen(losses), personHealthDamage: health, structureDamage });
}
function mergeEffects(values: readonly DevelopmentEffects[]): DevelopmentEffects {
  const loss = { food: 0, water: 0, timber: 0, stone: 0 };
  const damage = new Map<number, number>();
  let structures = 0;
  for (const value of values) {
    loss.food += value.stockpileLoss.food;
    loss.water += value.stockpileLoss.water;
    loss.timber += value.stockpileLoss.timber;
    loss.stone += value.stockpileLoss.stone;
    structures += value.structureDamage;
    for (const patch of value.personHealthDamage)
      damage.set(patch.personId, (damage.get(patch.personId) ?? 0) + patch.amount);
  }
  return frozen({
    stockpileLoss: frozen(loss),
    personHealthDamage: Object.freeze(
      [...damage]
        .sort(([a], [b]) => a - b)
        .slice(0, MAX_CRISIS_RESPONSES)
        .map(([personId, amount]) => frozen({ personId, amount })),
    ),
    structureDamage: structures,
  });
}
function responseFor(
  crisis: ActiveCrisis,
  context: DevelopmentContext,
  effects: DevelopmentEffects,
): {
  response: CrisisResponse | null;
  experiences: readonly RelationshipExperienceInput[];
} {
  const damageByPersonId = new Map(
    effects.personHealthDamage.map((patch) => [patch.personId, patch.amount] as const),
  );
  const recipients = context.people
    .filter(
      (person) =>
        person.alive &&
        (damageByPersonId.size === 0 || person.health < 100 || damageByPersonId.has(person.id)),
    )
    .sort(
      (left, right) =>
        left.health -
          (damageByPersonId.get(left.id) ?? 0) -
          (right.health - (damageByPersonId.get(right.id) ?? 0)) || left.id - right.id,
    )
    .slice(0, MAX_CRISIS_RESPONSE_CANDIDATES);
  const helpers = context.people
    .filter((person) => person.alive)
    .sort(
      (left, right) =>
        right.skills.reduce((a, b) => a + b, 0) - left.skills.reduce((a, b) => a + b, 0) ||
        left.id - right.id,
    )
    .slice(0, MAX_CRISIS_RESPONSE_CANDIDATES);
  let selected: CrisisResponse | null = null;
  let selectedScore = Number.MIN_SAFE_INTEGER;
  for (const helper of helpers) {
    const bases = new Map(
      recipients.map((person) => {
        const personX = person.tileIndex % context.worldWidth;
        const personY = Math.floor(person.tileIndex / context.worldWidth);
        const centerX = context.centerTileIndex % context.worldWidth;
        const centerY = Math.floor(context.centerTileIndex / context.worldWidth);
        const exposure =
          damageByPersonId.size === 0
            ? Math.max(1, 100 - Math.abs(personX - centerX) - Math.abs(personY - centerY))
            : 0;
        return [person.id, 100 - person.health + (damageByPersonId.get(person.id) ?? 0) + exposure];
      }),
    );
    const recipientId = selectPreferredRelatedPerson(
      context.interpersonal,
      helper.id,
      recipients.map((person) => person.id),
      'help',
      bases,
    );
    if (recipientId === null) continue;
    const edge = findActiveRelationship(context.interpersonal, helper.id, recipientId);
    const score =
      (edge === undefined ? 0 : relationshipDecisionInfluence(edge, helper.id, 'help')) +
      helper.skills.reduce((total, skill) => total + skill, 0);
    if (
      score > selectedScore ||
      (score === selectedScore &&
        (selected === null ||
          helper.id < selected.helperPersonId ||
          (helper.id === selected.helperPersonId && recipientId < selected.recipientPersonId)))
    ) {
      selectedScore = score;
      selected = frozen({
        kind:
          crisis.kind === 'disease'
            ? 'caregiving'
            : crisis.kind === 'flood' || crisis.kind === 'storm'
              ? 'evacuation'
              : ['fire', 'earthquake', 'technological-accident', 'meteor-impact'].includes(
                    crisis.kind,
                  )
                ? 'protection'
                : 'aid',
        helperPersonId: helper.id,
        recipientPersonId: recipientId,
        crisisKind: crisis.kind,
        amount: clamp(Math.floor(score / 20), 1),
      });
    }
  }
  if (selected === null) return { response: null, experiences: Object.freeze([]) };
  return {
    response: selected,
    experiences: Object.freeze([
      frozen<RelationshipExperienceInput>({
        tick: context.tick,
        firstPersonId: selected.helperPersonId,
        secondPersonId: selected.recipientPersonId,
        kind: 'crisis-assistance',
        amount: selected.amount,
      }),
      frozen<RelationshipExperienceInput>({
        tick: context.tick,
        firstPersonId: selected.helperPersonId,
        secondPersonId: selected.recipientPersonId,
        kind: 'shared-trauma',
        amount: Math.max(1, Math.floor(crisis.severity / 2)),
      }),
    ]),
  };
}
function interventionCondition(kind: InterventionKind): ConditionId {
  const map: Readonly<Record<InterventionKind, ConditionId>> = {
    weather: 'stormPressure',
    resource: 'resourcePressure',
    organism: 'diseasePressure',
    omen: 'politicalPressure',
    artifact: 'accidentPressure',
    protection: 'protection',
    disaster: 'meteorPressure',
    'alien-signal': 'accidentPressure',
  };
  return map[kind];
}

export function advanceDevelopment(
  state: DevelopmentState,
  context: DevelopmentContext,
): DevelopmentResult {
  assertDevelopmentInvariants(state);
  validateContext(context, state);
  const rng = new Xoshiro128StarStar(state.rng);
  const disasterRng = new Xoshiro128StarStar(state.disasterRng);
  const events: DevelopmentEvent[] = [];
  let conditions: DevelopmentConditions = state.conditions;
  for (const intervention of state.pendingInterventions) {
    const condition = interventionCondition(intervention.kind);
    const sign =
      intervention.kind === 'protection'
        ? intervention.polarity === 'supportive'
          ? 1
          : -1
        : intervention.polarity === 'supportive'
          ? -1
          : 1;
    conditions = frozen({
      ...conditions,
      [condition]: clamp(conditions[condition] + sign * intervention.intensity),
    });
    events.push(
      frozen({
        kind: `${intervention.kind}-intervened`,
        subjectKind: 'world',
        subjectId: 0,
        tick: context.tick,
        amount: intervention.intensity,
        interventionId: intervention.id,
        targetTileIndex: intervention.targetTileIndex,
      }),
    );
  }
  conditions = evolveConditions(conditions, context, disasterRng.nextInt(256) === 0 ? 100 : 0);
  let knowledge = state.knowledge;
  let lostThisPulseId: KnowledgeId | null = null;
  if (
    (conditions.resourcePressure >= 90 || conditions.politicalPressure >= 90) &&
    rng.nextInt(4) === 0
  ) {
    const loss = knowledge.find((record) => record.status === 'known' && !FOUNDING.has(record.id));
    if (loss !== undefined) {
      lostThisPulseId = loss.id;
      knowledge = Object.freeze(
        knowledge.map((record) =>
          record.id === loss.id
            ? frozen({
                ...record,
                status: 'lost' as const,
                progress: Math.floor(record.progress / 2),
                lostTick: context.tick,
              })
            : record,
        ),
      );
      events.push(
        frozen({
          kind: 'knowledge-lost',
          subjectKind: 'world',
          subjectId: 0,
          tick: context.tick,
          amount: loss.progress,
          knowledgeId: loss.id,
        }),
      );
    }
  }
  const researchState: DevelopmentState = frozen({ ...state, knowledge, conditions });
  const candidates = knowledge
    .filter(
      (record) => record.id !== lostThisPulseId && canResearch(record, researchState, context),
    )
    .sort(
      (left, right) =>
        researchScore(DEFINITION_BY_ID.get(right.id)!, context) -
          researchScore(DEFINITION_BY_ID.get(left.id)!, context) || compareText(left.id, right.id),
    );
  const focus = candidates[0]?.id ?? null;
  if (focus !== null) {
    const selected = knowledge.find((record) => record.id === focus)!;
    const definition = DEFINITION_BY_ID.get(focus)!;
    const progress = Math.min(
      definition.discoveryThreshold,
      selected.progress + 20 + experimentationBonus(focus, conditions, context) + rng.nextInt(6),
    );
    const discovered = progress >= definition.discoveryThreshold;
    knowledge = Object.freeze(
      knowledge.map((record) =>
        record.id !== focus
          ? record
          : frozen({
              ...record,
              status: discovered ? 'known' : record.status,
              progress,
              discoveredTick:
                discovered && record.discoveredTick === null ? context.tick : record.discoveredTick,
              recoveredTick:
                discovered && record.status === 'lost' ? context.tick : record.recoveredTick,
              evidence: discovered
                ? frozen({
                    kind:
                      selected.status === 'lost' ? ('recovery' as const) : ('discovery' as const),
                    tick: context.tick,
                    prerequisiteIds: definition.prerequisites,
                    requirements: Object.freeze(
                      definition.context.map((requirement) =>
                        frozen({
                          ...requirement,
                          value: requirementValue(requirement, researchState, context),
                        }),
                      ),
                    ),
                  })
                : record.evidence,
            }),
      ),
    );
    if (discovered)
      events.push(
        frozen({
          kind: recordKind(selected.status, 'knowledge-discovered', 'knowledge-recovered'),
          subjectKind: 'world',
          subjectId: 0,
          tick: context.tick,
          amount: progress,
          knowledgeId: selected.id,
        }),
      );
  }
  const existing = state.activeCrises.filter(
    (crisis) => crisis.severity > recoveryAmount(crisis, conditions, context),
  );
  const recovered = state.activeCrises.filter((crisis) => !existing.includes(crisis));
  if (recovered.length > 0) {
    const cooled = { ...conditions };
    for (const crisis of recovered) cooled[crisis.triggerCondition] = 0;
    conditions = frozen(cooled);
  }
  for (const crisis of recovered)
    events.push(
      frozen({
        kind: `${crisis.kind}-recovered`,
        subjectKind: 'world',
        subjectId: 0,
        tick: context.tick,
        amount: crisis.severity,
        crisisId: crisis.id,
      }),
    );
  let nextCrisisId = state.nextCrisisId;
  const starts = DISASTER_KINDS.filter(
    (entry) =>
      conditions[entry.condition] >= 80 &&
      !existing.some((crisis) => crisis.kind === entry.kind) &&
      !recovered.some((crisis) => crisis.kind === entry.kind),
  )
    .slice(0, MAX_ACTIVE_CRISES - existing.length)
    .map((entry) =>
      frozen({
        id: nextCrisisId++,
        kind: entry.kind,
        triggerCondition: entry.condition,
        triggerValue: conditions[entry.condition],
        triggerThreshold: 80,
        startedTick: context.tick,
        severity: Math.max(1, Math.floor(conditions[entry.condition] / 10)),
      }),
    );
  for (const crisis of starts)
    events.push(
      frozen({
        kind: `${crisis.kind}-started`,
        subjectKind: 'world',
        subjectId: 0,
        tick: context.tick,
        amount: crisis.severity,
        crisisId: crisis.id,
      }),
    );
  const activeCrises = sorted(
    [
      ...existing.map((crisis) =>
        frozen({
          ...crisis,
          severity: Math.max(1, crisis.severity - recoveryAmount(crisis, conditions, context)),
        }),
      ),
      ...starts,
    ],
    (left, right) => compareText(left.kind, right.kind),
  );
  const history = Object.freeze(
    [
      ...state.crisisHistory,
      ...recovered.map((crisis) =>
        frozen({
          id: crisis.id,
          kind: crisis.kind,
          triggerCondition: crisis.triggerCondition,
          triggerValue: crisis.triggerValue,
          triggerThreshold: crisis.triggerThreshold,
          startedTick: crisis.startedTick,
          endedTick: context.tick,
          outcome: 'recovered' as const,
        }),
      ),
    ].slice(-MAX_CRISIS_HISTORY),
  );
  const crisisEffects = starts.map((crisis) => effectFor(crisis, context));
  const responseOutcomes = starts.map((crisis, index) =>
    responseFor(crisis, context, crisisEffects[index]!),
  );
  const responses = responseOutcomes
    .filter((value) => value.response !== null)
    .map((value) => value.response!);
  const experiences = responseOutcomes.flatMap((value) => value.experiences);
  const next: DevelopmentState = frozen({
    tick: context.tick,
    nextCrisisId,
    nextInterventionId: state.nextInterventionId,
    disasterRng: disasterRng.save(),
    rng: rng.save(),
    knowledge,
    researchFocusId: focus,
    conditions,
    activeCrises,
    crisisHistory: history,
    pendingInterventions: Object.freeze([]),
    operationCount: state.operationCount + 1,
  });
  assertDevelopmentInvariants(next);
  if (events.length > MAX_DEVELOPMENT_EVENTS)
    throw new Error('Development factual event cap exceeded.');
  return frozen({
    state: next,
    events: Object.freeze(events),
    effects: mergeEffects(crisisEffects),
    responses: Object.freeze(responses.slice(0, MAX_CRISIS_RESPONSES)),
    relationshipExperiences: Object.freeze(experiences.slice(0, MAX_CRISIS_RESPONSES)),
  });
}

function recordKind(status: KnowledgeStatus, first: string, recovery: string): string {
  return status === 'lost' ? recovery : first;
}
function recoveryAmount(
  crisis: ActiveCrisis,
  conditions: DevelopmentConditions,
  context: DevelopmentContext,
): number {
  const pressure = conditions[crisis.triggerCondition];
  return Math.floor(
    (100 - pressure + conditions.protection + context.stability + (100 - context.scarcity)) / 100,
  );
}
function evolveConditions(
  conditions: DevelopmentConditions,
  context: DevelopmentContext,
  meteorImpulse: number,
): DevelopmentConditions {
  const next: DevelopmentConditions = frozen({
    ...conditions,
    droughtPressure: clamp(
      conditions.droughtPressure +
        Math.floor(context.terrain.dryLandRatio / 25) +
        Math.floor(context.scarcity / 50) -
        1,
    ),
    floodPressure: clamp(
      conditions.floodPressure + Math.floor(context.terrain.floodExposure / 30) - 1,
    ),
    firePressure: clamp(
      conditions.firePressure +
        Math.floor(context.terrain.forestRatio / 35) +
        Math.floor(context.terrain.dryLandRatio / 50) -
        1,
    ),
    stormPressure: clamp(
      conditions.stormPressure + Math.floor(context.terrain.stormExposure / 25) - 1,
    ),
    seismicPressure: clamp(
      conditions.seismicPressure + Math.floor(context.terrain.seismicity / 35) - 1,
    ),
    diseasePressure: clamp(conditions.diseasePressure + Math.floor(context.scarcity / 35) - 1),
    faminePressure: clamp(
      conditions.faminePressure +
        Math.floor(context.scarcity / 25) -
        Math.floor(context.stockpile.food / 100),
    ),
    resourcePressure: clamp(
      conditions.resourcePressure +
        Math.floor(context.terrain.resourceDepletion / 25) -
        Math.floor(context.tradeVolume / 50),
    ),
    politicalPressure: clamp(
      conditions.politicalPressure +
        Math.max(
          -4,
          Math.min(
            2,
            Math.floor(context.inequality / 40) +
              Math.floor(context.conflictEvents / 3) +
              (context.collapsed ? 4 : 0) -
              Math.floor(context.stability / 25),
          ),
        ),
    ),
    accidentPressure: clamp(
      conditions.accidentPressure +
        Math.floor(context.damagedStructures / 3) -
        Math.floor(context.operationalStructures / 20),
    ),
    meteorPressure: clamp(conditions.meteorPressure - 1 + meteorImpulse),
    protection: clamp(conditions.protection - 1),
  });
  return next;
}
function validateContext(context: DevelopmentContext, state: DevelopmentState): void {
  if (
    context.tick <= state.tick ||
    !Number.isSafeInteger(context.tick) ||
    !Number.isSafeInteger(context.yearTicks) ||
    context.yearTicks <= 0 ||
    context.tick % context.yearTicks !== 0
  )
    throw new Error('Development must advance at a society-year boundary.');
  for (const value of [
    context.worldWidth,
    context.worldHeight,
    context.centerTileIndex,
    context.operationalStructures,
    context.damagedStructures,
    context.tradeVolume,
    context.institutionCount,
    context.stability,
    context.scarcity,
    context.inequality,
    context.conflictEvents,
  ])
    validateInteger(value, 'Development context value');
  const ids = new Set<number>();
  for (const person of context.people) {
    validateInteger(person.id, 'Development person id', 1);
    if (ids.has(person.id)) throw new Error('Development people must be unique.');
    ids.add(person.id);
    for (const value of [...person.traits, ...person.skills, person.health])
      validateInteger(value, 'Development person value', 0, 100);
  }
}

export function assertDevelopmentInvariants(state: DevelopmentState): void {
  validateInteger(state.tick, 'Development tick');
  validateInteger(state.nextCrisisId, 'Development next crisis id', 1);
  validateInteger(state.nextInterventionId, 'Development next intervention id', 1);
  validateInteger(state.operationCount, 'Development operation count');
  for (const [label, rng] of [
    ['Development research RNG', state.rng],
    ['Development disaster RNG', state.disasterRng],
  ] as const) {
    if (
      rng.length !== 4 ||
      rng.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) ||
      (rng[0] | rng[1] | rng[2] | rng[3]) === 0
    )
      throw new Error(`${label} is invalid.`);
  }
  if (
    state.knowledge.length !== KNOWLEDGE_DEFINITIONS.length ||
    state.knowledge.some(
      (record, index) =>
        record.id !== KNOWLEDGE_DEFINITIONS[index]?.id ||
        !['unknown', 'known', 'lost'].includes(record.status) ||
        !Number.isSafeInteger(record.progress) ||
        record.progress < 0 ||
        record.progress > (DEFINITION_BY_ID.get(record.id)?.discoveryThreshold ?? -1),
    )
  )
    throw new Error('Development knowledge records are invalid.');
  for (const record of state.knowledge) {
    const definition = DEFINITION_BY_ID.get(record.id)!;
    if (FOUNDING.has(record.id)) {
      if (
        record.status !== 'known' ||
        record.discoveredTick === null ||
        record.evidence?.kind !== 'founding' ||
        record.evidence.tick !== record.discoveredTick
      )
        throw new Error('Founding knowledge evidence is invalid.');
      continue;
    }
    if (record.status === 'unknown') {
      if (record.discoveredTick !== null || record.lostTick !== null || record.evidence !== null)
        throw new Error('Unknown knowledge cannot contain historical evidence.');
      continue;
    }
    if (
      (record.status === 'known'
        ? record.progress !== definition.discoveryThreshold
        : record.progress >= definition.discoveryThreshold) ||
      record.discoveredTick === null ||
      record.evidence === null ||
      record.evidence.kind === 'founding' ||
      record.evidence.tick > state.tick ||
      record.evidence.prerequisiteIds.length !== definition.prerequisites.length ||
      record.evidence.prerequisiteIds.some((id, index) => id !== definition.prerequisites[index]) ||
      record.evidence.requirements.length !== definition.context.length ||
      record.evidence.requirements.some((evidence, index) => {
        const required = definition.context[index];
        return (
          evidence.kind !== required?.kind ||
          evidence.id !== required?.id ||
          evidence.minimum !== required?.minimum ||
          evidence.value < evidence.minimum
        );
      })
    )
      throw new Error('Contextual knowledge evidence is invalid.');
    if (
      (record.status === 'lost' && record.lostTick === null) ||
      (record.evidence.kind === 'recovery' && record.recoveredTick === null)
    )
      throw new Error('Knowledge loss or recovery evidence is invalid.');
  }
  if (state.researchFocusId !== null && !DEFINITION_BY_ID.has(state.researchFocusId))
    throw new Error('Development focus is invalid.');
  for (const condition of CONDITION_IDS)
    validateInteger(state.conditions[condition], `Development condition ${condition}`, 0, 100);
  if (
    state.activeCrises.length > MAX_ACTIVE_CRISES ||
    state.crisisHistory.length > MAX_CRISIS_HISTORY ||
    state.pendingInterventions.length > MAX_PENDING_INTERVENTIONS
  )
    throw new Error('Development bounded collection cap exceeded.');
  for (let index = 1; index < state.activeCrises.length; index += 1)
    if (compareText(state.activeCrises[index - 1]!.kind, state.activeCrises[index]!.kind) >= 0)
      throw new Error('Development crises must be canonically sorted.');
  for (const crisis of state.activeCrises) {
    const definition = DISASTER_BY_KIND.get(crisis.kind);
    if (
      definition?.condition !== crisis.triggerCondition ||
      crisis.startedTick > state.tick ||
      crisis.triggerThreshold !== 80 ||
      crisis.triggerValue < crisis.triggerThreshold
    )
      throw new Error('Development crisis is invalid.');
    validateInteger(crisis.id, 'Development crisis id', 1);
    validateInteger(crisis.triggerValue, 'Development crisis trigger value', 0, 100);
    validateInteger(crisis.severity, 'Development crisis severity', 1, 100);
  }
  for (const record of state.crisisHistory)
    if (
      !DISASTER_BY_KIND.has(record.kind) ||
      record.triggerThreshold !== 80 ||
      record.triggerValue < record.triggerThreshold ||
      record.startedTick > record.endedTick ||
      record.endedTick > state.tick ||
      record.outcome !== 'recovered'
    )
      throw new Error('Development crisis history is invalid.');
  const crisisIds = [
    ...state.activeCrises.map((crisis) => crisis.id),
    ...state.crisisHistory.map((crisis) => crisis.id),
  ];
  if (
    new Set(crisisIds).size !== crisisIds.length ||
    crisisIds.some((id) => !Number.isSafeInteger(id) || id < 1 || id >= state.nextCrisisId)
  )
    throw new Error('Development crisis ids are invalid.');
  const interventionIds = state.pendingInterventions.map((intervention) => intervention.id);
  if (
    new Set(interventionIds).size !== interventionIds.length ||
    interventionIds.some(
      (id) => !Number.isSafeInteger(id) || id < 1 || id >= state.nextInterventionId,
    )
  )
    throw new Error('Development intervention ids are invalid.');
  for (let index = 0; index < state.pendingInterventions.length; index += 1) {
    const intervention = state.pendingInterventions[index]!;
    if (
      !INTERVENTION_KINDS.has(intervention.kind) ||
      !['supportive', 'challenging'].includes(intervention.polarity) ||
      intervention.requestedTick > state.tick
    )
      throw new Error('Development intervention is invalid.');
    validateInteger(intervention.intensity, 'Intervention intensity', 1, 100);
    validateInteger(intervention.targetTileIndex, 'Intervention tile');
    validateInteger(intervention.requestedTick, 'Intervention requested tick');
    const previous = state.pendingInterventions[index - 1];
    if (
      previous !== undefined &&
      (previous.requestedTick > intervention.requestedTick ||
        (previous.requestedTick === intervention.requestedTick && previous.id >= intervention.id))
    )
      throw new Error('Development interventions must be canonically sorted.');
  }
}

/** Stable canonical DTO used by world hashes, snapshots, and read-only projections. */
export function developmentDto(state: DevelopmentState): Readonly<Record<string, unknown>> {
  assertDevelopmentInvariants(state);
  return Object.freeze({
    activeCrises: state.activeCrises.map((crisis) => ({ ...crisis })),
    conditions: { ...state.conditions },
    crisisHistory: state.crisisHistory.map((crisis) => ({ ...crisis })),
    disasterRng: [...state.disasterRng],
    knowledge: state.knowledge.map((record) => ({
      ...record,
      evidence:
        record.evidence === null
          ? null
          : {
              ...record.evidence,
              prerequisiteIds: [...record.evidence.prerequisiteIds],
              requirements: record.evidence.requirements.map((requirement) => ({
                ...requirement,
              })),
            },
    })),
    nextCrisisId: state.nextCrisisId,
    nextInterventionId: state.nextInterventionId,
    operationCount: state.operationCount,
    pendingInterventions: state.pendingInterventions.map((intervention) => ({ ...intervention })),
    researchFocusId: state.researchFocusId,
    rng: [...state.rng],
    tick: state.tick,
  });
}
