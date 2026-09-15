export const RELATIONSHIP_EVENT_KINDS = Object.freeze([
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
] as const);

export const DISASTER_EVENT_STEMS = Object.freeze([
  'drought',
  'flood',
  'fire',
  'storm',
  'earthquake',
  'disease',
  'famine',
  'resource-collapse',
  'political-crisis',
  'technological-accident',
  'meteor-impact',
] as const);

export const INTERVENTION_EVENT_STEMS = Object.freeze([
  'weather',
  'resource',
  'organism',
  'omen',
  'artifact',
  'protection',
  'disaster',
  'alien-signal',
] as const);

export const CIVILIZATION_EVENT_KINDS = Object.freeze([
  'settlement-founded',
  'route-established',
  'route-disrupted',
  'route-restored',
  'diplomacy-changed',
  'conflict-started',
  'conflict-resolved',
  'refugees-relocated',
  'settlement-restored',
  'settlement-ruined',
  'settlement-stage-changed',
  'federation-formed',
  'civilization-fragmented',
  'territory-changed',
  'territory-history-summarized',
] as const);

export const SPACE_EVENT_KINDS = Object.freeze([
  'space-program-advanced',
  'spacecraft-launched',
  'mission-arrived',
  'colony-founded',
  'cargo-departed',
  'cargo-arrived',
  'cargo-lost',
  'communication-delivered',
  'alien-contacted',
  'space-relation-changed',
  'colony-abandoned',
  'colony-population-grown',
  'colony-diverged',
] as const);

const SOCIETY_EVENT_KINDS = Object.freeze([
  'person-died',
  'government-changed',
  'tools-crafted',
  'local-exchange',
  'parent-child-bond-changed',
  'household-formed',
  'household-split',
  'household-merged',
  'person-born',
  'pair-bond-child-arrival',
  'communal-child-arrival',
  'person-migrated',
  'household-migrated',
  'crisis-assisted',
  'resource-shared',
  'knowledge-shared',
  'family-inheritance',
  'guardianship-formed',
  'conflict',
  'theft',
  'settlement-collapsed',
  'settlement-recovered',
] as const);

const SETTLEMENT_EVENT_KINDS = Object.freeze([
  'shelter-planned',
  'storehouse-planned',
  'shelter-expanded',
  'storehouse-expanded',
  'shelter-operational',
  'storehouse-operational',
] as const);

const WORLD_EVENT_KINDS = Object.freeze([
  'world-generated',
  'founders-arrived',
  'supply-shortage',
  'offline-catch-up',
] as const);

const KNOWLEDGE_EVENT_KINDS = Object.freeze([
  'knowledge-discovered',
  'knowledge-recovered',
  'knowledge-lost',
] as const);

export type RelationshipEventKind = (typeof RELATIONSHIP_EVENT_KINDS)[number];
export type DisasterEventStem = (typeof DISASTER_EVENT_STEMS)[number];
export type InterventionEventStem = (typeof INTERVENTION_EVENT_STEMS)[number];
export type DevelopmentEventKind =
  | (typeof KNOWLEDGE_EVENT_KINDS)[number]
  | `${DisasterEventStem}-started`
  | `${DisasterEventStem}-recovered`
  | `${InterventionEventStem}-intervened`;
export type CivilizationEventKind = (typeof CIVILIZATION_EVENT_KINDS)[number];
export type SpaceEventKind = (typeof SPACE_EVENT_KINDS)[number];
export type PlayerVisibleEventKind =
  | (typeof WORLD_EVENT_KINDS)[number]
  | (typeof SETTLEMENT_EVENT_KINDS)[number]
  | (typeof SOCIETY_EVENT_KINDS)[number]
  | RelationshipEventKind
  | DevelopmentEventKind
  | CivilizationEventKind
  | SpaceEventKind;

const DEVELOPMENT_EVENT_KINDS = Object.freeze([
  ...KNOWLEDGE_EVENT_KINDS,
  ...DISASTER_EVENT_STEMS.flatMap((stem) => [`${stem}-started`, `${stem}-recovered`] as const),
  ...INTERVENTION_EVENT_STEMS.map((stem) => `${stem}-intervened` as const),
] satisfies readonly DevelopmentEventKind[]);

export const PLAYER_VISIBLE_EVENT_KINDS: readonly PlayerVisibleEventKind[] = Object.freeze([
  ...WORLD_EVENT_KINDS,
  ...SETTLEMENT_EVENT_KINDS,
  ...SOCIETY_EVENT_KINDS,
  ...RELATIONSHIP_EVENT_KINDS,
  ...DEVELOPMENT_EVENT_KINDS,
  ...CIVILIZATION_EVENT_KINDS,
  ...SPACE_EVENT_KINDS,
]);

const PLAYER_VISIBLE_EVENT_KIND_SET = new Set<string>(PLAYER_VISIBLE_EVENT_KINDS);

const GENERIC_FACTUAL_SUMMARIES = Object.freeze([
  /^Recorded\b/i,
  /^Development conditions changed\b/i,
  /changed relationship\.?$/i,
  /^A trade route (?:was disrupted|resumed|was established)\.?$/i,
  /^Diplomatic standing changed\.?$/i,
  /^A conflict (?:began|resolved)\.?$/i,
  /^People (?:found refuge|migrated)\b/i,
  /^A civilization (?:entered a federation|fragmented)\.?$/i,
  /^Territory changed hands\.?$/i,
  /^Additional territory changes were summarized\.?$/i,
  /^Program reached\b/i,
  /^Mission arrived\b/i,
  /^Cargo (?:arrived|was lost)\.?$/i,
  /^Delayed communication delivered\.?$/i,
  /^Interworld cargo departed\.?$/i,
  /^Relation became\b/i,
]);

export function isPlayerVisibleEventKind(value: unknown): value is PlayerVisibleEventKind {
  return typeof value === 'string' && PLAYER_VISIBLE_EVENT_KIND_SET.has(value);
}

export function assertFactualEventSummary(summary: string): void {
  if (summary.trim() !== summary || summary.length < 1 || summary.length > 160) {
    throw new Error('Factual event summary must be trimmed and contain 1 through 160 characters.');
  }
  if (!/[.!?]$/.test(summary)) {
    throw new Error('Factual event summary must end with sentence punctuation.');
  }
  if (/\b(?:undefined|null|NaN)\b/.test(summary) || /\bBody-\d+\b/.test(summary)) {
    throw new Error('Factual event summary contains placeholder content.');
  }
  if (GENERIC_FACTUAL_SUMMARIES.some((pattern) => pattern.test(summary))) {
    throw new Error('Factual event summary is generic rather than source-specific.');
  }
}

export function normalizeFactualEventSummary(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/\b[a-z][a-z']*-\d+-\d+\b/g, '<person>')
    .replace(/\b\d+\b/g, '<number>')
    .replace(/\s+/g, ' ')
    .trim();
}
