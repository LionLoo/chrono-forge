import { AGENT_ACTION_CODES, STRUCTURE_KIND_CODES, type WorldFrameProjection } from '../protocol';
import {
  colorForTile,
  overlayDefinition,
  type OverlayPattern,
  type WorldOverlay,
} from './world-palette';

export const RENDER_MODEL_VERSION = 2;
export const RENDER_GUARD_BAND_TILES = 1;

export type RenderEra = 'founding' | 'town' | 'industrial' | 'advanced' | 'space';
export type RenderDetailLevel = 'overview' | 'district' | 'close';
export type BuiltEnvironmentKind = 'farm' | 'district' | 'industry' | 'infrastructure' | 'road';
export type EffectKind = 'drought' | 'flood' | 'fire' | 'storm' | 'earthquake' | 'meteor-impact';
export type SpaceLandmarkKind = 'launch-site' | 'body' | 'craft' | 'colony';
export type AgentActivityVisual = 'idle' | 'gather' | 'water' | 'carry' | 'build' | 'rest';
export type AgentSilhouette = 'compact' | 'upright' | 'broad';
export type AgentAccent = 'band' | 'sash' | 'scarf';
export type StructureForm = 'home' | 'storehouse';
export type StructureRoof = 'gable' | 'hip' | 'flat';

export type SelectableKind =
  'agent' | 'structure' | 'settlement' | 'civilization' | 'route' | 'ruin' | 'crisis' | 'event';

export interface SelectableId {
  readonly id: number;
  readonly kind: SelectableKind;
}

export interface RenderViewport {
  readonly heightTiles: number;
  readonly leftTile: number;
  readonly topTile: number;
  readonly widthTiles: number;
}

export interface RenderModelOptions {
  readonly detailLevel: RenderDetailLevel;
  readonly overlay: WorldOverlay;
  readonly reducedEffects: boolean;
  readonly selection: SelectableId | null;
  readonly viewport: RenderViewport;
}

export interface VisualAgentFact {
  readonly action: number;
  readonly ageYears: number;
  readonly health: number;
  readonly id: number;
  readonly tileIndex: number;
}

export interface VisualStructureFact {
  readonly condition: number;
  readonly id: number;
  readonly kind: number;
  readonly progress: number;
  readonly state: number;
  readonly tileIndex: number;
}

export interface VisualSettlementFact {
  readonly centerTileIndex: number;
  readonly cultureId: number;
  readonly id: number;
  readonly population: number;
  readonly reserves: number;
  readonly status: 'active' | 'abandoned' | 'conquered';
}

export interface VisualCultureFact {
  readonly architectureStyle: string;
  readonly id: number;
}

export interface VisualRouteFact {
  readonly firstSettlementId: number;
  readonly id: number;
  readonly secondSettlementId: number;
  readonly status: 'active' | 'disrupted' | 'ended';
  readonly volume: number;
}

export interface VisualRuinFact {
  readonly id: number;
  readonly settlementId: number;
}

export interface VisualCrisisFact {
  readonly id: number;
  readonly kind: string;
  readonly severity: number;
}

export interface VisualSpaceBodyFact {
  readonly distance: number;
  readonly habitable: boolean;
  readonly id: number;
  readonly kind: 'home' | 'moon' | 'planet' | 'asteroid';
}

export interface VisualSpaceProgramFact {
  readonly civilizationId: number;
  readonly id: number;
  readonly launchCapacity: number;
  readonly settlementId: number;
  readonly stage: 'none' | 'advanced-energy' | 'planetary-engineering' | 'spaceflight';
}

export interface VisualSpacecraftFact {
  readonly civilizationId: number;
  readonly currentBodyId: number;
  readonly id: number;
  readonly missionId: number | null;
  readonly status: 'grounded' | 'in-flight' | 'orbiting' | 'retired';
}

export interface VisualSpaceMissionFact {
  readonly civilizationId: number;
  readonly id: number;
  readonly kind: 'orbital' | 'exploration' | 'colony';
  readonly spacecraftId: number;
  readonly status: 'active' | 'completed' | 'failed';
}

export interface VisualSpaceColonyFact {
  readonly bodyId: number;
  readonly id: number;
  readonly residentCount: number;
  readonly settlementId: number;
  readonly status: 'active' | 'abandoned';
}

export interface VisualProjection {
  readonly agentFacts: readonly VisualAgentFact[];
  readonly biome: Uint8Array;
  readonly cultureFacts: readonly VisualCultureFact[];
  readonly crisisFacts: readonly VisualCrisisFact[];
  readonly habitability: Uint8Array;
  readonly hazard: Uint8Array;
  readonly height: number;
  readonly knownKnowledgeIds: readonly string[];
  readonly provenance: 'worker' | 'test-only';
  readonly resource: Uint16Array;
  readonly ruinFacts: readonly VisualRuinFact[];
  readonly settlementFacts: readonly VisualSettlementFact[];
  readonly spaceBodyFacts: readonly VisualSpaceBodyFact[];
  readonly spaceColonyCount: number;
  readonly spaceColonyFacts: readonly VisualSpaceColonyFact[];
  readonly spaceMissionFacts: readonly VisualSpaceMissionFact[];
  readonly spaceProgramStage: 'none' | 'advanced-energy' | 'planetary-engineering' | 'spaceflight';
  readonly spaceProgramFacts: readonly VisualSpaceProgramFact[];
  readonly spacecraftFacts: readonly VisualSpacecraftFact[];
  readonly structureFacts: readonly VisualStructureFact[];
  readonly testOnlyEra: 'advanced' | 'space' | null;
  readonly tick: number;
  readonly routeFacts: readonly VisualRouteFact[];
  readonly width: number;
}

/** A test-only source cannot be passed to the production Worker-frame adapter. */
export interface TestOnlyVisualProjection extends VisualProjection {
  readonly provenance: 'test-only';
  readonly testOnlyEra: 'advanced' | 'space' | null;
}

export interface TerrainDescriptor {
  readonly biome: number;
  readonly color: number;
  readonly overlayPattern: OverlayPattern;
  readonly overlayValue: number;
  readonly tileIndex: number;
  readonly variant: number;
  readonly x: number;
  readonly y: number;
}

export interface BuiltEnvironmentDescriptor {
  readonly cultureStyle: string;
  readonly kind: BuiltEnvironmentKind;
  readonly material: 'timber' | 'stone' | 'metal';
  readonly sourceId: number;
  readonly sourceKind: 'route' | 'settlement';
  readonly tileIndex: number;
  readonly wealthTier: 'modest' | 'comfortable' | 'prosperous';
}

export interface AgentDescriptor {
  readonly action: number;
  readonly activityVisual: AgentActivityVisual;
  readonly ageTier: 'child' | 'adult' | 'elder';
  readonly healthTier: 'sound' | 'worn' | 'critical';
  readonly identity: {
    readonly accent: AgentAccent;
    readonly accentColor: number;
    readonly clothingColor: number;
    readonly facing: 'left' | 'right';
    readonly silhouette: AgentSilhouette;
    readonly skinColor: number;
  };
  readonly selectable: SelectableId;
  readonly tileIndex: number;
}

export interface StructureDescriptor {
  readonly accentColor: number;
  readonly conditionTier: 'sound' | 'worn' | 'critical';
  readonly form: StructureForm;
  readonly material: 'timber' | 'stone' | 'metal';
  readonly progress: number;
  readonly roof: StructureRoof;
  readonly selectable: SelectableId;
  readonly state: number;
  readonly tileIndex: number;
}

export interface SettlementDescriptor {
  readonly accentColor: number;
  readonly cultureStyle: string;
  readonly layout: 'courtyard' | 'linear' | 'radial';
  readonly selectable: SelectableId;
  readonly tileIndex: number;
  readonly wealthTier: 'modest' | 'comfortable' | 'prosperous';
}

export interface RouteDescriptor {
  readonly fromTileIndex: number;
  readonly selectable: SelectableId;
  readonly status: 'active' | 'disrupted' | 'ended';
  readonly toTileIndex: number;
  readonly volume: number;
}

export interface RuinDescriptor {
  readonly selectable: SelectableId;
  readonly settlementId: number;
  readonly tileIndex: number;
}

export interface EffectDescriptor {
  readonly kind: EffectKind;
  readonly markerTileIndex: number;
  readonly reduced: boolean;
  readonly selectable: SelectableId;
  readonly severity: number;
}

export interface SpaceLandmarkDescriptor {
  readonly accentColor: number;
  readonly bodyKind: VisualSpaceBodyFact['kind'] | null;
  readonly habitable: boolean;
  readonly kind: SpaceLandmarkKind;
  readonly sourceId: number;
  readonly sourceKind: 'program' | 'body' | 'spacecraft' | 'colony';
  readonly status: string;
  readonly tileIndex: number;
  readonly variant: number;
}

export interface RenderPlanningMetrics {
  /** Descriptors considered after querying visible spatial buckets. */
  readonly candidateDescriptors: number;
  /** Descriptors indexed once when the authoritative projection changed. */
  readonly indexedDescriptors: number;
  /** Guard-banded world tiles queried for this view. */
  readonly queriedTiles: number;
}

export interface RenderLayerSignatures {
  readonly agents: string;
  readonly builtEnvironment: string;
  readonly effects: string;
  readonly routesRuins: string;
  readonly selection: string;
  readonly space: string;
  readonly structures: string;
  readonly terrain: string;
}

export interface RenderModel {
  readonly agents: readonly AgentDescriptor[];
  readonly builtEnvironment: readonly BuiltEnvironmentDescriptor[];
  readonly detailLevel: RenderDetailLevel;
  readonly effects: readonly EffectDescriptor[];
  readonly era: RenderEra;
  readonly height: number;
  readonly layerSignatures: RenderLayerSignatures;
  readonly overlay: {
    readonly legend: string;
    readonly pattern: OverlayPattern;
    readonly value: WorldOverlay;
  };
  readonly planning: RenderPlanningMetrics;
  readonly routes: readonly RouteDescriptor[];
  readonly sceneSignature: string;
  readonly selected: SelectableId | null;
  readonly settlements: readonly SettlementDescriptor[];
  readonly spaceLandmarks: readonly SpaceLandmarkDescriptor[];
  readonly structures: readonly StructureDescriptor[];
  readonly terrain: readonly TerrainDescriptor[];
  readonly ruins: readonly RuinDescriptor[];
  readonly version: typeof RENDER_MODEL_VERSION;
  readonly viewport: RenderViewport;
  readonly width: number;
}

interface PreparedProjectionData {
  readonly activeCrisisSeverity: number;
  readonly activeTrade: number;
  readonly agentsByTile: ReadonlyMap<number, readonly AgentDescriptor[]>;
  readonly builtEnvironmentByTile: ReadonlyMap<number, readonly BuiltEnvironmentDescriptor[]>;
  readonly effects: readonly Omit<EffectDescriptor, 'markerTileIndex' | 'reduced'>[];
  readonly era: RenderEra;
  readonly indexedDescriptors: number;
  readonly knowledge: ReadonlySet<string>;
  readonly projection: VisualProjection;
  readonly routesByTile: ReadonlyMap<number, readonly RouteDescriptor[]>;
  readonly ruinsByTile: ReadonlyMap<number, readonly RuinDescriptor[]>;
  readonly settlementPopulationByTile: ReadonlyMap<number, number>;
  readonly settlementsByTile: ReadonlyMap<number, readonly SettlementDescriptor[]>;
  readonly spaceByTile: ReadonlyMap<number, readonly SpaceLandmarkDescriptor[]>;
  readonly structuresByTile: ReadonlyMap<number, readonly StructureDescriptor[]>;
}

const PREPARED_RENDER_PROJECTION = Symbol('prepared-render-projection');

/** Opaque, immutable render index rebuilt only when the source projection changes. */
export interface PreparedRenderProjection {
  readonly [PREPARED_RENDER_PROJECTION]: PreparedProjectionData;
}

function sorted<T extends { readonly id: number }>(values: readonly T[]): readonly T[] {
  return [...values].sort((left, right) => left.id - right.id);
}

function toUnit(value: number, ceiling: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(1_000, Math.round((value * 1_000) / ceiling));
}

function tier(
  value: number,
  moderate: number,
  high: number,
): 'modest' | 'comfortable' | 'prosperous' {
  if (value >= high) return 'prosperous';
  if (value >= moderate) return 'comfortable';
  return 'modest';
}

const AGENT_CLOTHING_COLORS = [0x315f68, 0x75495b, 0x596b3b, 0x8a5a35, 0x4d527c, 0x6b4b36] as const;
const AGENT_ACCENT_COLORS = [0xe7bc61, 0x79cbd1, 0xd9826b, 0xa8c979, 0xc7a4df, 0xe9dfba] as const;
const AGENT_SKIN_COLORS = [0xf2d2b6, 0xdca77b, 0xb97852, 0x87523b, 0x653b2d] as const;
const STRUCTURE_ACCENT_COLORS = [0xd8a34e, 0x72a7a8, 0xb96e5f, 0x829a61, 0x8e7bb2] as const;
const AGENT_SILHOUETTES: readonly AgentSilhouette[] = ['compact', 'upright', 'broad'];
const AGENT_ACCENTS: readonly AgentAccent[] = ['band', 'sash', 'scarf'];
const STRUCTURE_ROOFS: readonly StructureRoof[] = ['gable', 'hip', 'flat'];
const SETTLEMENT_LAYOUTS: readonly SettlementDescriptor['layout'][] = [
  'courtyard',
  'linear',
  'radial',
];

function presentationIndex(id: number, salt: number, length: number): number {
  let value = Math.imul((id | 0) ^ salt, 0x45d9f3b);
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) % length;
}

function indexedValue<T>(values: readonly T[], id: number, salt: number): T {
  const value = values[presentationIndex(id, salt, values.length)];
  if (value === undefined) throw new Error('Presentation palette is empty.');
  return value;
}

function activityVisual(action: number): AgentActivityVisual {
  switch (action) {
    case AGENT_ACTION_CODES.forage:
    case AGENT_ACTION_CODES.gatherTimber:
    case AGENT_ACTION_CODES.gatherStone:
      return 'gather';
    case AGENT_ACTION_CODES.collectWater:
      return 'water';
    case AGENT_ACTION_CODES.transport:
      return 'carry';
    case AGENT_ACTION_CODES.construct:
    case AGENT_ACTION_CODES.repair:
      return 'build';
    case AGENT_ACTION_CODES.rest:
      return 'rest';
    default:
      return 'idle';
  }
}

function agentIdentity(id: number): AgentDescriptor['identity'] {
  return Object.freeze({
    accent: indexedValue(AGENT_ACCENTS, id, 0x18f3),
    accentColor: indexedValue(AGENT_ACCENT_COLORS, id, 0x2b91),
    clothingColor: indexedValue(AGENT_CLOTHING_COLORS, id, 0x5a17),
    facing: presentationIndex(id, 0x7ce1, 2) === 0 ? 'left' : 'right',
    silhouette: indexedValue(AGENT_SILHOUETTES, id, 0x34d7),
    skinColor: indexedValue(AGENT_SKIN_COLORS, id, 0x63ab),
  });
}

function structureForm(kind: number): StructureForm {
  return kind === STRUCTURE_KIND_CODES.storehouse ? 'storehouse' : 'home';
}

/** Camera scale selects presentation density only; it never enters Worker authority. */
export function renderDetailForZoom(zoom: number): RenderDetailLevel {
  if (!Number.isFinite(zoom) || zoom < 1.25) return 'overview';
  if (zoom < 2.75) return 'district';
  return 'close';
}

function material(knownKnowledgeIds: ReadonlySet<string>): 'timber' | 'stone' | 'metal' {
  if (knownKnowledgeIds.has('metallurgy')) return 'metal';
  if (knownKnowledgeIds.has('stonecraft')) return 'stone';
  return 'timber';
}

function eraFor(projection: VisualProjection, knownKnowledgeIds: ReadonlySet<string>): RenderEra {
  if (projection.provenance === 'test-only' && projection.testOnlyEra !== null)
    return projection.testOnlyEra;
  if (projection.spaceProgramStage === 'spaceflight' || projection.spaceColonyCount > 0)
    return 'space';
  if (
    projection.spaceProgramStage === 'advanced-energy' ||
    projection.spaceProgramStage === 'planetary-engineering'
  )
    return 'advanced';
  if (knownKnowledgeIds.has('mechanics')) return 'industrial';
  if (knownKnowledgeIds.has('agriculture')) return 'town';
  return 'founding';
}

function effectKind(kind: string): EffectKind | null {
  switch (kind) {
    case 'drought':
    case 'flood':
    case 'fire':
    case 'storm':
    case 'earthquake':
    case 'meteor-impact':
      return kind;
    default:
      return null;
  }
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function layerSignature(name: string, values: readonly string[]): string {
  return `${name}-${fnv1a(values.join('|'))}`;
}

function semanticSignature(
  layers: RenderLayerSignatures,
  detailLevel: RenderDetailLevel,
  era: RenderEra,
  overlay: WorldOverlay,
): string {
  return `m10.5-r${RENDER_MODEL_VERSION}-${fnv1a(
    [
      era,
      detailLevel,
      overlay,
      layers.agents,
      layers.builtEnvironment,
      layers.effects,
      layers.routesRuins,
      layers.selection,
      layers.space,
      layers.structures,
      layers.terrain,
    ].join('|'),
  )}`;
}

function matchingSelection(selection: SelectableId | null, candidate: SelectableId): boolean {
  return selection?.kind === candidate.kind && selection.id === candidate.id;
}

/**
 * Converts only copied Worker facts into a rendering projection. It does not
 * retain the Worker frame, mutate it, or manufacture authoritative entities.
 */
export function visualProjectionFromWorkerFrame(frame: WorldFrameProjection): VisualProjection {
  const ages = new Map(frame.society.people.map((person) => [person.id, person.ageYears]));
  const cultures = sorted(
    frame.society.cultures.map((culture) => ({
      architectureStyle: culture.architectureStyle,
      id: culture.id,
    })),
  );
  const settlements = sorted(
    frame.civilizations.settlements.map((settlement) => ({
      centerTileIndex: settlement.centerTileIndex,
      cultureId: settlement.cultureId,
      id: settlement.id,
      population: settlement.population,
      reserves:
        settlement.reserves.food +
        settlement.reserves.water +
        settlement.reserves.timber +
        settlement.reserves.stone +
        settlement.reserves.metal,
      status: settlement.status,
    })),
  );

  return Object.freeze({
    agentFacts: Object.freeze(
      Array.from(frame.agentIds, (id, index) =>
        Object.freeze({
          action: frame.agentActions[index] ?? 0,
          ageYears: ages.get(id) ?? 18,
          health: frame.agentHealth[index] ?? 0,
          id,
          tileIndex: frame.agentTiles[index] ?? 0,
        }),
      ),
    ),
    biome: frame.biome,
    cultureFacts: Object.freeze(cultures),
    crisisFacts: Object.freeze(
      sorted(frame.development.activeCrises).map((crisis) =>
        Object.freeze({ id: crisis.id, kind: crisis.kind, severity: crisis.severity }),
      ),
    ),
    habitability: frame.habitability,
    hazard: frame.hazard,
    height: frame.height,
    knownKnowledgeIds: Object.freeze(
      frame.development.knowledge
        .filter((knowledge) => knowledge.status === 'known')
        .map((knowledge) => knowledge.id)
        .sort(),
    ),
    provenance: 'worker',
    resource: frame.resource,
    ruinFacts: Object.freeze(
      sorted(frame.civilizations.ruins).map((ruin) => Object.freeze({ ...ruin })),
    ),
    routeFacts: Object.freeze(
      sorted(frame.civilizations.routes).map((route) => Object.freeze({ ...route })),
    ),
    settlementFacts: Object.freeze(settlements),
    spaceBodyFacts: Object.freeze(
      sorted(frame.space.bodies).map((body) =>
        Object.freeze({
          distance: body.distance,
          habitable: body.habitable,
          id: body.id,
          kind: body.kind,
        }),
      ),
    ),
    spaceColonyCount: frame.space.colonies.filter((colony) => colony.status === 'active').length,
    spaceColonyFacts: Object.freeze(
      sorted(frame.space.colonies).map((colony) =>
        Object.freeze({
          bodyId: colony.bodyId,
          id: colony.id,
          residentCount: colony.residentCount,
          settlementId: colony.settlementId,
          status: colony.status,
        }),
      ),
    ),
    spaceMissionFacts: Object.freeze(
      sorted(frame.space.missions).map((mission) =>
        Object.freeze({
          civilizationId: mission.civilizationId,
          id: mission.id,
          kind: mission.kind,
          spacecraftId: mission.spacecraftId,
          status: mission.status,
        }),
      ),
    ),
    spaceProgramStage:
      frame.space.programs.find((program) => program.stage === 'spaceflight')?.stage ??
      frame.space.programs.find((program) => program.stage === 'planetary-engineering')?.stage ??
      frame.space.programs.find((program) => program.stage === 'advanced-energy')?.stage ??
      'none',
    spaceProgramFacts: Object.freeze(
      sorted(frame.space.programs).map((program) =>
        Object.freeze({
          civilizationId: program.civilizationId,
          id: program.id,
          launchCapacity: program.launchCapacity,
          settlementId: program.settlementId,
          stage: program.stage,
        }),
      ),
    ),
    spacecraftFacts: Object.freeze(
      sorted(frame.space.spacecraft).map((spacecraft) =>
        Object.freeze({
          civilizationId: spacecraft.civilizationId,
          currentBodyId: spacecraft.currentBodyId,
          id: spacecraft.id,
          missionId: spacecraft.missionId,
          status: spacecraft.status,
        }),
      ),
    ),
    structureFacts: Object.freeze(
      Array.from(frame.structureIds, (id, index) =>
        Object.freeze({
          condition: frame.structureCondition[index] ?? 0,
          id,
          kind: frame.structureKinds[index] ?? 0,
          progress: frame.structureProgress[index] ?? 0,
          state: frame.structureStates[index] ?? 0,
          tileIndex: frame.structureTiles[index] ?? 0,
        }),
      ),
    ),
    testOnlyEra: null,
    tick: frame.tick,
    width: frame.width,
  });
}

/** Creates a test-only visual source; production frames cannot carry this provenance. */
export function createTestOnlyVisualProjection(
  projection: Omit<TestOnlyVisualProjection, 'provenance'>,
): TestOnlyVisualProjection {
  return Object.freeze({ ...projection, provenance: 'test-only' });
}

function validateProjectionDimensions(projection: VisualProjection): number {
  const expectedTiles = projection.width * projection.height;
  if (
    !Number.isSafeInteger(expectedTiles) ||
    projection.width < 1 ||
    projection.height < 1 ||
    projection.biome.length !== expectedTiles ||
    projection.resource.length !== expectedTiles ||
    projection.habitability.length !== expectedTiles ||
    projection.hazard.length !== expectedTiles
  ) {
    throw new RangeError('Visual projection dimensions are invalid.');
  }
  return expectedTiles;
}

type MutableTileIndex<T> = Map<number, T[]>;

function addToTileIndex<T>(index: MutableTileIndex<T>, tileIndex: number, value: T): void {
  const bucket = index.get(tileIndex);
  if (bucket === undefined) index.set(tileIndex, [value]);
  else bucket.push(value);
}

function freezeTileIndex<T>(index: MutableTileIndex<T>): ReadonlyMap<number, readonly T[]> {
  return new Map(
    [...index.entries()].map(([tileIndex, values]) => [tileIndex, Object.freeze(values)] as const),
  );
}

function visibleTileIndices(
  projection: VisualProjection,
  viewport: RenderViewport,
): readonly number[] {
  const left = Math.max(0, viewport.leftTile - RENDER_GUARD_BAND_TILES);
  const top = Math.max(0, viewport.topTile - RENDER_GUARD_BAND_TILES);
  const right = Math.min(
    projection.width,
    viewport.leftTile + viewport.widthTiles + RENDER_GUARD_BAND_TILES,
  );
  const bottom = Math.min(
    projection.height,
    viewport.topTile + viewport.heightTiles + RENDER_GUARD_BAND_TILES,
  );
  const result: number[] = [];
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) result.push(y * projection.width + x);
  }
  return result;
}

function queryTileIndex<T>(
  index: ReadonlyMap<number, readonly T[]>,
  visibleTiles: readonly number[],
): readonly T[] {
  return visibleTiles.flatMap((tileIndex) => index.get(tileIndex) ?? []);
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string | number): readonly T[] {
  const seen = new Set<string | number>();
  return values.filter((value) => {
    const candidate = key(value);
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    return true;
  });
}

const ORBIT_OFFSETS = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
] as const;

function offsetTileIndex(
  anchorTileIndex: number,
  width: number,
  height: number,
  sourceId: number,
  distance: number,
): number {
  const offset = indexedValue(ORBIT_OFFSETS, sourceId, 0x6f29);
  const radius = Math.max(1, Math.min(6, Math.trunc(distance)));
  const anchorX = anchorTileIndex % width;
  const anchorY = Math.floor(anchorTileIndex / width);
  const x = Math.max(0, Math.min(width - 1, anchorX + offset[0] * radius));
  const y = Math.max(0, Math.min(height - 1, anchorY + offset[1] * radius));
  return y * width + x;
}

function prepareVisualProjection(projection: VisualProjection): PreparedRenderProjection {
  validateProjectionDimensions(projection);
  const knowledge = new Set(projection.knownKnowledgeIds);
  const era = eraFor(projection, knowledge);
  const settlements = sorted(projection.settlementFacts);
  const settlementById = new Map(settlements.map((settlement) => [settlement.id, settlement]));
  const cultureById = new Map(projection.cultureFacts.map((culture) => [culture.id, culture]));
  const activeTrade = projection.routeFacts
    .filter((route) => route.status === 'active')
    .reduce((total, route) => total + route.volume, 0);
  const activeCrisisSeverity = projection.crisisFacts.reduce(
    (total, crisis) => total + crisis.severity,
    0,
  );
  const settlementPopulationByTile = new Map(
    settlements.map((settlement) => [settlement.centerTileIndex, settlement.population]),
  );
  const agentsByTile: MutableTileIndex<AgentDescriptor> = new Map();
  const structuresByTile: MutableTileIndex<StructureDescriptor> = new Map();
  const settlementsByTile: MutableTileIndex<SettlementDescriptor> = new Map();
  const builtEnvironmentByTile: MutableTileIndex<BuiltEnvironmentDescriptor> = new Map();
  const routesByTile: MutableTileIndex<RouteDescriptor> = new Map();
  const ruinsByTile: MutableTileIndex<RuinDescriptor> = new Map();
  const spaceByTile: MutableTileIndex<SpaceLandmarkDescriptor> = new Map();
  const renderedMaterial = material(knowledge);

  for (const agent of sorted(projection.agentFacts)) {
    addToTileIndex(
      agentsByTile,
      agent.tileIndex,
      Object.freeze({
        action: agent.action,
        activityVisual: activityVisual(agent.action),
        ageTier: agent.ageYears < 18 ? 'child' : agent.ageYears >= 60 ? 'elder' : 'adult',
        healthTier: agent.health >= 667 ? 'sound' : agent.health >= 334 ? 'worn' : 'critical',
        identity: agentIdentity(agent.id),
        selectable: Object.freeze({ id: agent.id, kind: 'agent' as const }),
        tileIndex: agent.tileIndex,
      }),
    );
  }
  for (const structure of sorted(projection.structureFacts)) {
    addToTileIndex(
      structuresByTile,
      structure.tileIndex,
      Object.freeze({
        accentColor: indexedValue(STRUCTURE_ACCENT_COLORS, structure.id, 0x4d31),
        conditionTier:
          structure.condition >= 667 ? 'sound' : structure.condition >= 334 ? 'worn' : 'critical',
        form: structureForm(structure.kind),
        material:
          structure.kind === STRUCTURE_KIND_CODES.storehouse && knowledge.has('stonecraft')
            ? 'stone'
            : renderedMaterial,
        progress: structure.progress,
        roof: indexedValue(STRUCTURE_ROOFS, structure.id, 0x71a9),
        selectable: Object.freeze({ id: structure.id, kind: 'structure' as const }),
        state: structure.state,
        tileIndex: structure.tileIndex,
      }),
    );
  }
  for (const settlement of settlements) {
    const cultureStyle = cultureById.get(settlement.cultureId)?.architectureStyle ?? 'unknown';
    const wealthTier = tier(settlement.reserves, 100, 300);
    addToTileIndex(
      settlementsByTile,
      settlement.centerTileIndex,
      Object.freeze({
        accentColor: indexedValue(STRUCTURE_ACCENT_COLORS, settlement.id, 0x21e7),
        cultureStyle,
        layout: indexedValue(SETTLEMENT_LAYOUTS, settlement.id, 0x57c3),
        selectable: Object.freeze({ id: settlement.id, kind: 'settlement' as const }),
        tileIndex: settlement.centerTileIndex,
        wealthTier,
      }),
    );
    if (knowledge.has('agriculture')) {
      addToTileIndex(
        builtEnvironmentByTile,
        settlement.centerTileIndex,
        Object.freeze({
          cultureStyle,
          kind: 'farm',
          material: renderedMaterial,
          sourceId: settlement.id,
          sourceKind: 'settlement',
          tileIndex: settlement.centerTileIndex,
          wealthTier,
        }),
      );
    }
    if (settlement.population >= 12) {
      addToTileIndex(
        builtEnvironmentByTile,
        settlement.centerTileIndex,
        Object.freeze({
          cultureStyle,
          kind: 'district',
          material: renderedMaterial,
          sourceId: settlement.id,
          sourceKind: 'settlement',
          tileIndex: settlement.centerTileIndex,
          wealthTier,
        }),
      );
    }
    if (knowledge.has('metallurgy')) {
      addToTileIndex(
        builtEnvironmentByTile,
        settlement.centerTileIndex,
        Object.freeze({
          cultureStyle,
          kind: 'industry',
          material: renderedMaterial,
          sourceId: settlement.id,
          sourceKind: 'settlement',
          tileIndex: settlement.centerTileIndex,
          wealthTier,
        }),
      );
    }
    if (knowledge.has('water-management')) {
      addToTileIndex(
        builtEnvironmentByTile,
        settlement.centerTileIndex,
        Object.freeze({
          cultureStyle,
          kind: 'infrastructure',
          material: renderedMaterial,
          sourceId: settlement.id,
          sourceKind: 'settlement',
          tileIndex: settlement.centerTileIndex,
          wealthTier,
        }),
      );
    }
  }
  for (const route of sorted(projection.routeFacts)) {
    if (route.status !== 'active' && route.status !== 'disrupted') continue;
    const first = settlementById.get(route.firstSettlementId);
    const second = settlementById.get(route.secondSettlementId);
    if (first === undefined || second === undefined) continue;
    const descriptor = Object.freeze({
      fromTileIndex: first.centerTileIndex,
      selectable: Object.freeze({ id: route.id, kind: 'route' as const }),
      status: route.status,
      toTileIndex: second.centerTileIndex,
      volume: route.volume,
    });
    addToTileIndex(routesByTile, first.centerTileIndex, descriptor);
    if (second.centerTileIndex !== first.centerTileIndex)
      addToTileIndex(routesByTile, second.centerTileIndex, descriptor);
    if (route.status === 'active') {
      const road = Object.freeze({
        cultureStyle: 'route',
        kind: 'road' as const,
        material: renderedMaterial,
        sourceId: route.id,
        sourceKind: 'route' as const,
        tileIndex: Math.min(first.centerTileIndex, second.centerTileIndex),
        wealthTier: tier(route.volume, 20, 60),
      });
      addToTileIndex(builtEnvironmentByTile, first.centerTileIndex, road);
      if (second.centerTileIndex !== first.centerTileIndex)
        addToTileIndex(builtEnvironmentByTile, second.centerTileIndex, road);
    }
  }
  for (const ruin of sorted(projection.ruinFacts)) {
    const settlement = settlementById.get(ruin.settlementId);
    if (settlement === undefined) continue;
    addToTileIndex(
      ruinsByTile,
      settlement.centerTileIndex,
      Object.freeze({
        selectable: Object.freeze({ id: ruin.id, kind: 'ruin' as const }),
        settlementId: ruin.settlementId,
        tileIndex: settlement.centerTileIndex,
      }),
    );
  }
  const programByCivilization = new Map(
    sorted(projection.spaceProgramFacts).map((program) => [program.civilizationId, program]),
  );
  const firstProgram = sorted(projection.spaceProgramFacts)[0];
  const firstProgramSettlement =
    firstProgram === undefined ? undefined : settlementById.get(firstProgram.settlementId);
  const bodyTileById = new Map<number, number>();
  for (const program of sorted(projection.spaceProgramFacts)) {
    const settlement = settlementById.get(program.settlementId);
    if (settlement === undefined || program.stage === 'none') continue;
    addToTileIndex(
      spaceByTile,
      settlement.centerTileIndex,
      Object.freeze({
        accentColor: indexedValue(STRUCTURE_ACCENT_COLORS, program.id, 0x7831),
        bodyKind: null,
        habitable: false,
        kind: 'launch-site' as const,
        sourceId: program.id,
        sourceKind: 'program' as const,
        status: program.stage,
        tileIndex: settlement.centerTileIndex,
        variant: presentationIndex(program.id, 0x3971, 3),
      }),
    );
  }
  if (firstProgramSettlement !== undefined) {
    for (const body of sorted(projection.spaceBodyFacts)) {
      if (body.kind === 'home') continue;
      const tileIndex = offsetTileIndex(
        firstProgramSettlement.centerTileIndex,
        projection.width,
        projection.height,
        body.id,
        Math.max(2, Math.min(6, body.distance)),
      );
      bodyTileById.set(body.id, tileIndex);
      addToTileIndex(
        spaceByTile,
        tileIndex,
        Object.freeze({
          accentColor: indexedValue(AGENT_ACCENT_COLORS, body.id, 0x591d),
          bodyKind: body.kind,
          habitable: body.habitable,
          kind: 'body' as const,
          sourceId: body.id,
          sourceKind: 'body' as const,
          status: body.habitable ? 'habitable' : 'uninhabitable',
          tileIndex,
          variant: presentationIndex(body.id, 0x2f41, 3),
        }),
      );
    }
  }
  const missionBySpacecraft = new Map(
    sorted(projection.spaceMissionFacts).map((mission) => [mission.spacecraftId, mission]),
  );
  for (const spacecraft of sorted(projection.spacecraftFacts)) {
    const program = programByCivilization.get(spacecraft.civilizationId);
    const settlement = program === undefined ? undefined : settlementById.get(program.settlementId);
    if (settlement === undefined) continue;
    const mission = missionBySpacecraft.get(spacecraft.id);
    const anchor = bodyTileById.get(spacecraft.currentBodyId) ?? settlement.centerTileIndex;
    const tileIndex = offsetTileIndex(
      anchor,
      projection.width,
      projection.height,
      spacecraft.id,
      spacecraft.status === 'grounded' ? 1 : 2,
    );
    addToTileIndex(
      spaceByTile,
      tileIndex,
      Object.freeze({
        accentColor: indexedValue(AGENT_ACCENT_COLORS, spacecraft.id, 0x41b7),
        bodyKind: null,
        habitable: false,
        kind: 'craft' as const,
        sourceId: spacecraft.id,
        sourceKind: 'spacecraft' as const,
        status: mission === undefined ? spacecraft.status : `${spacecraft.status}:${mission.kind}`,
        tileIndex,
        variant: presentationIndex(spacecraft.id, 0x79c3, 3),
      }),
    );
  }
  for (const colony of sorted(projection.spaceColonyFacts)) {
    const settlement = settlementById.get(colony.settlementId);
    if (settlement === undefined) continue;
    const anchor = bodyTileById.get(colony.bodyId) ?? settlement.centerTileIndex;
    const tileIndex = offsetTileIndex(anchor, projection.width, projection.height, colony.id, 1);
    addToTileIndex(
      spaceByTile,
      tileIndex,
      Object.freeze({
        accentColor: indexedValue(STRUCTURE_ACCENT_COLORS, colony.id, 0x5e27),
        bodyKind: null,
        habitable: colony.residentCount > 0,
        kind: 'colony' as const,
        sourceId: colony.id,
        sourceKind: 'colony' as const,
        status: colony.status,
        tileIndex,
        variant: presentationIndex(colony.id, 0x3ab9, 3),
      }),
    );
  }
  const effects = sorted(projection.crisisFacts).flatMap((crisis) => {
    const kind = effectKind(crisis.kind);
    return kind === null
      ? []
      : [
          Object.freeze({
            kind,
            selectable: Object.freeze({ id: crisis.id, kind: 'crisis' as const }),
            severity: crisis.severity,
          }),
        ];
  });
  const uniqueBuiltDescriptors = new Set(
    [...builtEnvironmentByTile.values()]
      .flat()
      .map((entry) => `${entry.sourceKind}:${entry.sourceId}:${entry.kind}:${entry.tileIndex}`),
  ).size;
  const uniqueSpaceDescriptors = new Set(
    [...spaceByTile.values()]
      .flat()
      .map((entry) => `${entry.sourceKind}:${entry.sourceId}:${entry.kind}:${entry.tileIndex}`),
  ).size;
  const indexedDescriptors =
    projection.agentFacts.length +
    projection.structureFacts.length +
    settlements.length +
    uniqueBuiltDescriptors +
    sorted(projection.routeFacts).filter(
      (route) => route.status === 'active' || route.status === 'disrupted',
    ).length +
    projection.ruinFacts.length +
    uniqueSpaceDescriptors +
    effects.length;
  return Object.freeze({
    [PREPARED_RENDER_PROJECTION]: Object.freeze({
      activeCrisisSeverity,
      activeTrade,
      agentsByTile: freezeTileIndex(agentsByTile),
      builtEnvironmentByTile: freezeTileIndex(builtEnvironmentByTile),
      effects: Object.freeze(effects),
      era,
      indexedDescriptors,
      knowledge,
      projection,
      routesByTile: freezeTileIndex(routesByTile),
      ruinsByTile: freezeTileIndex(ruinsByTile),
      settlementPopulationByTile,
      settlementsByTile: freezeTileIndex(settlementsByTile),
      spaceByTile: freezeTileIndex(spaceByTile),
      structuresByTile: freezeTileIndex(structuresByTile),
    }),
  });
}

/** Prepares one production Worker frame; reuse the result for view-only updates. */
export function prepareRenderProjection(frame: WorldFrameProjection): PreparedRenderProjection {
  return prepareVisualProjection(visualProjectionFromWorkerFrame(frame));
}

/** Prepares one source-gated test fixture without exposing it to production adapters. */
export function prepareFixtureRenderProjection(
  projection: TestOnlyVisualProjection,
): PreparedRenderProjection {
  return prepareVisualProjection(projection);
}

/** Builds one stable scene by querying only guard-banded visible descriptor buckets. */
export function buildPreparedRenderModel(
  prepared: PreparedRenderProjection,
  options: RenderModelOptions,
): RenderModel {
  const data = prepared[PREPARED_RENDER_PROJECTION];
  const { projection } = data;
  const definition = overlayDefinition(options.overlay);
  const visibleTiles = visibleTileIndices(projection, options.viewport);
  const knownTechnology = toUnit(data.knowledge.size, 16);
  const terrain = visibleTiles.map((tileIndex) => {
    const resource = projection.resource[tileIndex] ?? 0;
    const habitability = projection.habitability[tileIndex] ?? 0;
    const hazard = projection.hazard[tileIndex] ?? 0;
    const population = data.settlementPopulationByTile.get(tileIndex) ?? 0;
    const overlayValue =
      options.overlay === 'population'
        ? toUnit(population, 100)
        : options.overlay === 'trade'
          ? toUnit(data.activeTrade, 100)
          : options.overlay === 'technology'
            ? knownTechnology
            : options.overlay === 'danger'
              ? Math.max(hazard * 4, toUnit(data.activeCrisisSeverity, 100))
              : options.overlay === 'resources'
                ? toUnit(resource, 2_000)
                : options.overlay === 'habitability'
                  ? habitability * 4
                  : options.overlay === 'hazards'
                    ? hazard * 4
                    : 0;
    return Object.freeze({
      biome: projection.biome[tileIndex] ?? 0,
      color: colorForTile(
        options.overlay,
        projection.biome[tileIndex] ?? 0,
        resource,
        habitability,
        hazard,
        overlayValue,
      ),
      overlayPattern: definition.pattern,
      overlayValue,
      tileIndex,
      variant: presentationIndex(tileIndex + 1, 0x4b2d, 4),
      x: tileIndex % projection.width,
      y: Math.floor(tileIndex / projection.width),
    });
  });
  const rawAgents = queryTileIndex(data.agentsByTile, visibleTiles);
  const rawStructures = queryTileIndex(data.structuresByTile, visibleTiles);
  const rawSettlements = queryTileIndex(data.settlementsByTile, visibleTiles);
  const rawBuiltEnvironment = queryTileIndex(data.builtEnvironmentByTile, visibleTiles);
  const rawRoutes = queryTileIndex(data.routesByTile, visibleTiles);
  const rawRuins = queryTileIndex(data.ruinsByTile, visibleTiles);
  const rawSpace = queryTileIndex(data.spaceByTile, visibleTiles);
  const agents = [...rawAgents].sort((left, right) => left.selectable.id - right.selectable.id);
  const structures = [...rawStructures].sort(
    (left, right) => left.selectable.id - right.selectable.id,
  );
  const settlementDescriptors = [...rawSettlements].sort(
    (left, right) => left.selectable.id - right.selectable.id,
  );
  const routes = [...uniqueBy(rawRoutes, (entry) => entry.selectable.id)].sort(
    (left, right) => left.selectable.id - right.selectable.id,
  );
  const ruins = [...rawRuins].sort((left, right) => left.selectable.id - right.selectable.id);
  const spaceLandmarks = [
    ...uniqueBy(
      rawSpace,
      (entry) => `${entry.sourceKind}:${entry.sourceId}:${entry.kind}:${entry.tileIndex}`,
    ),
  ].sort(
    (left, right) =>
      left.tileIndex - right.tileIndex ||
      left.sourceId - right.sourceId ||
      (left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0),
  );
  const sortedBuiltEnvironment = [
    ...uniqueBy(
      rawBuiltEnvironment,
      (entry) => `${entry.sourceKind}:${entry.sourceId}:${entry.kind}:${entry.tileIndex}`,
    ),
  ].sort(
    (left, right) =>
      left.tileIndex - right.tileIndex ||
      left.sourceId - right.sourceId ||
      (left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0),
  );
  const markerLeft = Math.max(0, Math.min(projection.width - 1, options.viewport.leftTile));
  const markerTop = Math.max(0, Math.min(projection.height - 1, options.viewport.topTile));
  const effects = data.effects.map((effect, index) =>
    Object.freeze({
      ...effect,
      markerTileIndex:
        markerTop * projection.width + Math.min(projection.width - 1, markerLeft + index),
      reduced: options.reducedEffects,
    }),
  );
  const selected =
    options.selection === null ||
    [
      ...agents.map((entry) => entry.selectable),
      ...structures.map((entry) => entry.selectable),
      ...settlementDescriptors.map((entry) => entry.selectable),
      ...routes.map((entry) => entry.selectable),
      ...ruins.map((entry) => entry.selectable),
      ...effects.map((entry) => entry.selectable),
    ].some((candidate) => matchingSelection(options.selection, candidate))
      ? options.selection
      : null;
  const layerSignatures = Object.freeze({
    agents: layerSignature('agents', [
      `detail:${options.detailLevel}`,
      ...agents.map(
        (entry) =>
          `${entry.selectable.id}:${entry.tileIndex}:${entry.action}:${entry.activityVisual}:${entry.ageTier}:${entry.healthTier}:${entry.identity.silhouette}:${entry.identity.accent}:${entry.identity.clothingColor}:${entry.identity.accentColor}:${entry.identity.skinColor}:${entry.identity.facing}`,
      ),
    ]),
    builtEnvironment: layerSignature('built', [
      `detail:${options.detailLevel}`,
      ...settlementDescriptors.map(
        (entry) =>
          `settlement:${entry.selectable.id}:${entry.tileIndex}:${entry.cultureStyle}:${entry.wealthTier}:${entry.layout}:${entry.accentColor}`,
      ),
      ...sortedBuiltEnvironment.map(
        (entry) =>
          `${entry.kind}:${entry.sourceKind}:${entry.sourceId}:${entry.tileIndex}:${entry.cultureStyle}:${entry.material}:${entry.wealthTier}`,
      ),
    ]),
    effects: layerSignature(
      'effects',
      effects.map(
        (entry) =>
          `${entry.selectable.id}:${entry.kind}:${entry.severity}:${entry.markerTileIndex}:${entry.reduced}`,
      ),
    ),
    routesRuins: layerSignature('routes-ruins', [
      ...routes.map(
        (entry) =>
          `r:${entry.selectable.id}:${entry.fromTileIndex}:${entry.toTileIndex}:${entry.status}:${entry.volume}`,
      ),
      ...ruins.map((entry) => `u:${entry.selectable.id}:${entry.settlementId}:${entry.tileIndex}`),
    ]),
    selection: layerSignature(
      'selection',
      selected === null ? [] : [`${selected.kind}:${selected.id}`],
    ),
    space: layerSignature('space', [
      `detail:${options.detailLevel}`,
      ...spaceLandmarks.map(
        (entry) =>
          `${entry.kind}:${entry.sourceKind}:${entry.sourceId}:${entry.tileIndex}:${entry.status}:${entry.bodyKind ?? 'none'}:${entry.habitable}:${entry.variant}:${entry.accentColor}`,
      ),
    ]),
    structures: layerSignature('structures', [
      `detail:${options.detailLevel}`,
      ...structures.map(
        (entry) =>
          `${entry.selectable.id}:${entry.tileIndex}:${entry.state}:${entry.progress}:${entry.conditionTier}:${entry.material}:${entry.form}:${entry.roof}:${entry.accentColor}`,
      ),
    ]),
    terrain: layerSignature(
      'terrain',
      terrain.map(
        (entry) =>
          `${entry.tileIndex}:${entry.biome}:${entry.color}:${entry.overlayValue}:${entry.overlayPattern}:${entry.variant}`,
      ),
    ),
  });
  return Object.freeze({
    agents: Object.freeze(agents),
    builtEnvironment: Object.freeze(sortedBuiltEnvironment),
    detailLevel: options.detailLevel,
    effects: Object.freeze(effects),
    era: data.era,
    height: projection.height,
    layerSignatures,
    overlay: Object.freeze({
      legend: definition.legend,
      pattern: definition.pattern,
      value: definition.value,
    }),
    planning: Object.freeze({
      candidateDescriptors:
        rawAgents.length +
        rawStructures.length +
        rawSettlements.length +
        rawBuiltEnvironment.length +
        rawRoutes.length +
        rawRuins.length +
        rawSpace.length +
        effects.length,
      indexedDescriptors: data.indexedDescriptors,
      queriedTiles: visibleTiles.length,
    }),
    routes: Object.freeze(routes),
    ruins: Object.freeze(ruins),
    sceneSignature: semanticSignature(
      layerSignatures,
      options.detailLevel,
      data.era,
      options.overlay,
    ),
    selected,
    settlements: Object.freeze(settlementDescriptors),
    spaceLandmarks: Object.freeze(spaceLandmarks),
    structures: Object.freeze(structures),
    terrain: Object.freeze(terrain),
    version: RENDER_MODEL_VERSION,
    viewport: Object.freeze({ ...options.viewport }),
    width: projection.width,
  });
}

/** One-off compatibility helper. Reuse a prepared projection for view-only changes. */
export function buildRenderModel(
  projection: VisualProjection,
  options: RenderModelOptions,
): RenderModel {
  return buildPreparedRenderModel(prepareVisualProjection(projection), options);
}

/** Production entry point: advanced and space test fixtures cannot use this function. */
export function createRenderModel(
  frame: WorldFrameProjection,
  options: RenderModelOptions,
): RenderModel {
  return buildPreparedRenderModel(prepareRenderProjection(frame), options);
}

export function createFixtureRenderModel(
  projection: TestOnlyVisualProjection,
  options: RenderModelOptions,
): RenderModel {
  return buildPreparedRenderModel(prepareFixtureRenderProjection(projection), options);
}

function svgColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function materialColorForBaseline(materialValue: StructureDescriptor['material']): number {
  return materialValue === 'metal' ? 0xaebfc5 : materialValue === 'stone' ? 0xc0b9a9 : 0xd7b56a;
}

/**
 * Stable visual evidence for pure render plans. Pixi remains responsible for
 * runtime drawing; this SVG intentionally contains only the same descriptors.
 */
export function renderModelSvgBaseline(scene: RenderModel, width = 960, height = 540): string {
  const tileWidth = width / scene.viewport.widthTiles;
  const tileHeight = height / scene.viewport.heightTiles;
  const unit = Math.min(tileWidth, tileHeight);
  const number = (value: number): string => String(Number(value.toFixed(2)));
  const point = (tileIndex: number): readonly [number, number] => [
    ((tileIndex % scene.width) - scene.viewport.leftTile + 0.5) * tileWidth,
    (Math.floor(tileIndex / scene.width) - scene.viewport.topTile + 0.5) * tileHeight,
  ];
  const terrain = scene.terrain
    .filter(
      (tile) =>
        tile.x >= scene.viewport.leftTile &&
        tile.y >= scene.viewport.topTile &&
        tile.x < scene.viewport.leftTile + scene.viewport.widthTiles &&
        tile.y < scene.viewport.topTile + scene.viewport.heightTiles,
    )
    .map(
      (tile) =>
        `<rect data-pattern="${tile.overlayPattern}" data-tile="${tile.tileIndex}" data-value="${tile.overlayValue}" fill="${svgColor(tile.color)}" height="${number(tileHeight)}" stroke="#102119" stroke-opacity="${scene.detailLevel === 'close' ? '0.2' : '0.08'}" stroke-width="${number(Math.max(0.5, unit * 0.008))}" width="${number(tileWidth)}" x="${number((tile.x - scene.viewport.leftTile) * tileWidth)}" y="${number((tile.y - scene.viewport.topTile) * tileHeight)}"/>`,
    )
    .join('');
  const terrainTexture =
    scene.overlay.value !== 'terrain'
      ? ''
      : scene.terrain
          .filter(
            (tile) =>
              tile.x >= scene.viewport.leftTile &&
              tile.y >= scene.viewport.topTile &&
              tile.x < scene.viewport.leftTile + scene.viewport.widthTiles &&
              tile.y < scene.viewport.topTile + scene.viewport.heightTiles &&
              (tile.tileIndex + tile.variant) %
                (scene.detailLevel === 'overview'
                  ? 4
                  : scene.detailLevel === 'district'
                    ? 2
                    : 1) ===
                0,
          )
          .map((tile) => {
            const x = (tile.x - scene.viewport.leftTile) * tileWidth;
            const y = (tile.y - scene.viewport.topTile) * tileHeight;
            const drift = tile.variant * unit * 0.04;
            if (tile.biome === 0) {
              return `<path d="M${number(x + unit * 0.12)} ${number(y + unit * 0.4 + drift)}L${number(x + unit * 0.36)} ${number(y + unit * 0.33 + drift)}L${number(x + unit * 0.6)} ${number(y + unit * 0.4 + drift)}L${number(x + unit * 0.84)} ${number(y + unit * 0.33 + drift)}" fill="none" stroke="#78a7b0" stroke-width="${number(Math.max(1, unit * 0.018))}"/>`;
            }
            if (tile.biome === 1) {
              return `<path d="M${number(x + unit * 0.24 + drift)} ${number(y + unit * 0.22)}L${number(x + unit * 0.4 + drift)} ${number(y + unit * 0.38)}M${number(x + unit * 0.4 + drift)} ${number(y + unit * 0.22)}L${number(x + unit * 0.24 + drift)} ${number(y + unit * 0.38)}" fill="none" stroke="#e5ece4" stroke-width="${number(Math.max(1, unit * 0.016))}"/>`;
            }
            if (tile.biome === 2) {
              return `<path d="M${number(x + unit * 0.25 + drift)} ${number(y + unit * 0.78)}L${number(x + unit * 0.31 + drift)} ${number(y + unit * 0.52)}L${number(x + unit * 0.38 + drift)} ${number(y + unit * 0.78)}" fill="none" stroke="#b8c881" stroke-width="${number(Math.max(1, unit * 0.018))}"/>`;
            }
            if (tile.biome === 3) {
              return `<path d="M${number(x + unit * 0.18 + drift)} ${number(y + unit * 0.8)}L${number(x + unit * 0.36 + drift)} ${number(y + unit * 0.18)}L${number(x + unit * 0.54 + drift)} ${number(y + unit * 0.8)}Z" fill="#244b36"/>`;
            }
            if (tile.biome === 4) {
              return `<path d="M${number(x + unit * 0.12)} ${number(y + unit * 0.62 + drift * 0.5)}Q${number(x + unit * 0.34)} ${number(y + unit * 0.48 + drift * 0.5)} ${number(x + unit * 0.56)} ${number(y + unit * 0.62 + drift * 0.5)}Q${number(x + unit * 0.74)} ${number(y + unit * 0.48 + drift * 0.5)} ${number(x + unit * 0.88)} ${number(y + unit * 0.62 + drift * 0.5)}" fill="none" stroke="#e1c37b" stroke-width="${number(Math.max(1, unit * 0.018))}"/>`;
            }
            if (tile.biome === 5) {
              return `<path d="M${number(x + unit * 0.28 + drift * 0.25)} ${number(y + unit * 0.82)}L${number(x + unit * 0.25 + drift * 0.25)} ${number(y + unit * 0.38)}M${number(x + unit * 0.58 + drift * 0.25)} ${number(y + unit * 0.82)}L${number(x + unit * 0.62 + drift * 0.25)} ${number(y + unit * 0.38)}" fill="none" stroke="#86aa79" stroke-width="${number(Math.max(1, unit * 0.018))}"/>`;
            }
            return `<path d="M${number(x + unit * 0.12)} ${number(y + unit * 0.82)}L${number(x + unit * 0.37)} ${number(y + unit * 0.2 + drift * 0.2)}L${number(x + unit * 0.55)} ${number(y + unit * 0.54)}L${number(x + unit * 0.7)} ${number(y + unit * 0.32)}L${number(x + unit * 0.88)} ${number(y + unit * 0.82)}" fill="none" stroke="#c5beb2" stroke-width="${number(Math.max(1, unit * 0.02))}"/>`;
          })
          .join('');
  const settlements = scene.settlements
    .map((settlement) => {
      const [x, y] = point(settlement.tileIndex);
      const radius = unit * 0.22;
      const path =
        settlement.layout === 'linear'
          ? `M${number(x - radius)} ${number(y)}L${number(x + radius)} ${number(y)}M${number(x - radius * 0.7)} ${number(y - radius * 0.55)}L${number(x + radius * 0.7)} ${number(y - radius * 0.55)}`
          : settlement.layout === 'courtyard'
            ? `M${number(x - radius)} ${number(y - radius)}H${number(x + radius)}V${number(y + radius)}H${number(x - radius)}Z M${number(x - radius * 0.45)} ${number(y - radius * 0.45)}H${number(x + radius * 0.45)}V${number(y + radius * 0.45)}H${number(x - radius * 0.45)}Z`
            : `M${number(x)} ${number(y - radius)}L${number(x + radius)} ${number(y)}L${number(x)} ${number(y + radius)}L${number(x - radius)} ${number(y)}Z`;
      const ground =
        scene.detailLevel === 'overview'
          ? ''
          : `<ellipse cx="${number(x)}" cy="${number(y + radius * 0.28)}" fill="#ead8a0" fill-opacity="0.24" rx="${number(radius * 1.2)}" ry="${number(radius * 0.7)}" stroke="${svgColor(settlement.accentColor)}" stroke-opacity="0.45"/>`;
      return `<g data-layout="${settlement.layout}" data-settlement="${settlement.selectable.id}">${ground}<path d="${path}" fill="none" stroke="${svgColor(settlement.accentColor)}" stroke-width="${number(Math.max(2, unit * 0.045))}"/></g>`;
    })
    .join('');
  const built = scene.builtEnvironment
    .map((entry) => {
      const [baseX, baseY] = point(entry.tileIndex);
      const [offsetX, offsetY] =
        entry.kind === 'farm'
          ? [-0.28, 0.24]
          : entry.kind === 'district'
            ? [0.26, -0.27]
            : entry.kind === 'industry'
              ? [0.28, 0.25]
              : entry.kind === 'infrastructure'
                ? [-0.28, -0.27]
                : [0, 0];
      const x = baseX + offsetX * unit;
      const y = baseY + offsetY * unit;
      const size = unit * (scene.detailLevel === 'close' ? 0.2 : 0.13);
      const path =
        entry.kind === 'farm'
          ? `M${number(x - size)} ${number(y - size * 0.65)}H${number(x + size)}V${number(y + size * 0.65)}H${number(x - size)}Z M${number(x - size * 0.45)} ${number(y - size * 0.65)}V${number(y + size * 0.65)}M${number(x + size * 0.2)} ${number(y - size * 0.65)}V${number(y + size * 0.65)}`
          : entry.kind === 'industry'
            ? `M${number(x - size)} ${number(y + size)}V${number(y - size * 0.2)}L${number(x - size * 0.2)} ${number(y - size * 0.75)}V${number(y - size * 1.35)}H${number(x + size * 0.25)}V${number(y - size * 0.45)}L${number(x + size)} ${number(y - size * 0.85)}V${number(y + size)}Z`
            : entry.kind === 'infrastructure'
              ? `M${number(x)} ${number(y - size)}L${number(x + size)} ${number(y)}L${number(x)} ${number(y + size)}L${number(x - size)} ${number(y)}Z M${number(x - size * 0.45)} ${number(y)}H${number(x + size * 0.45)}`
              : entry.kind === 'district'
                ? `M${number(x - size)} ${number(y + size)}V${number(y - size * 0.2)}L${number(x)} ${number(y - size)}L${number(x + size)} ${number(y - size * 0.2)}V${number(y + size)}Z`
                : `M${number(x - size)} ${number(y)}H${number(x + size)}`;
      return `<path d="${path}" data-kind="${entry.kind}" data-material="${entry.material}" fill="${entry.kind === 'road' ? 'none' : '#e7c885'}" stroke="#27352e" stroke-width="${number(Math.max(1.5, unit * 0.025))}"/>`;
    })
    .join('');
  const routes = scene.routes
    .map((route) => {
      const [x1, y1] = point(route.fromTileIndex);
      const [x2, y2] = point(route.toTileIndex);
      const path = `M${number(x1)} ${number(y1)}L${number(x2)} ${number(y2)}`;
      return `<g data-route="${route.selectable.id}" data-status="${route.status}"><path d="${path}" fill="none" stroke="#1c2922" stroke-opacity="0.7" stroke-width="${number(Math.max(3, unit * 0.075))}"/><path d="${path}" fill="none" stroke="${route.status === 'disrupted' ? '#d78b4b' : '#c6ad77'}" stroke-width="${number(Math.max(2, unit * 0.05))}"/>${route.status === 'active' && scene.detailLevel !== 'overview' ? `<path d="${path}" fill="none" stroke="#79cbd1" stroke-opacity="0.75" stroke-width="${number(Math.max(1, unit * 0.012))}"/>` : ''}</g>`;
    })
    .join('');
  const ruins = scene.ruins
    .map((ruin) => {
      const [x, y] = point(ruin.tileIndex);
      const size = unit * 0.17;
      return `<path d="M${number(x - size)} ${number(y + size)}V${number(y - size * 0.55)}L${number(x - size * 0.2)} ${number(y - size)}V${number(y + size)}M${number(x + size * 0.1)} ${number(y + size)}V${number(y - size * 0.2)}L${number(x + size)} ${number(y - size * 0.7)}V${number(y + size)}" data-ruin="${ruin.selectable.id}" fill="none" stroke="#d76d55" stroke-width="${number(Math.max(2, unit * 0.04))}"/>`;
    })
    .join('');
  const structures = scene.structures
    .map((structure) => {
      const [baseX, baseY] = point(structure.tileIndex);
      const x = baseX + ((structure.selectable.id % 3) - 1) * unit * 0.035;
      const y = baseY + ((Math.floor(structure.selectable.id / 3) % 2) - 0.5) * unit * 0.028;
      const halfWidth = unit * (scene.detailLevel === 'close' ? 0.25 : 0.18);
      const halfHeight = unit * (structure.form === 'storehouse' ? 0.21 : 0.18);
      const roofY = y - halfHeight * 1.75;
      const roof =
        structure.roof === 'flat'
          ? `M${number(x - halfWidth)} ${number(y - halfHeight)}H${number(x + halfWidth)}`
          : structure.roof === 'hip'
            ? `M${number(x - halfWidth)} ${number(y - halfHeight)}L${number(x - halfWidth * 0.55)} ${number(roofY)}H${number(x + halfWidth * 0.55)}L${number(x + halfWidth)} ${number(y - halfHeight)}Z`
            : `M${number(x - halfWidth)} ${number(y - halfHeight)}L${number(x)} ${number(roofY)}L${number(x + halfWidth)} ${number(y - halfHeight)}Z`;
      const details =
        scene.detailLevel === 'overview'
          ? ''
          : `<rect fill="#27352e" height="${number(halfHeight * 0.95)}" width="${number(halfWidth * 0.32)}" x="${number(x - halfWidth * 0.16)}" y="${number(y + halfHeight * 0.05)}"/><rect fill="#e9c36a" height="${number(halfHeight * 0.34)}" stroke="#27352e" stroke-width="${number(Math.max(1, unit * 0.01))}" width="${number(halfWidth * 0.28)}" x="${number(x - halfWidth * 0.72)}" y="${number(y - halfHeight * 0.15)}"/>`;
      return `<g data-condition="${structure.conditionTier}" data-form="${structure.form}" data-progress="${structure.progress}" data-roof="${structure.roof}" data-state="${structure.state}" data-structure="${structure.selectable.id}"><ellipse cx="${number(x + halfWidth * 0.1)}" cy="${number(y + halfHeight * 1.05)}" fill="#111a16" fill-opacity="0.42" rx="${number(halfWidth * 1.18)}" ry="${number(halfHeight * 0.35)}"/><path d="M${number(x - halfWidth)} ${number(y - halfHeight)}H${number(x + halfWidth)}V${number(y + halfHeight)}H${number(x - halfWidth)}Z" fill="${svgColor(materialColorForBaseline(structure.material))}" stroke="#f3dfaa" stroke-width="${number(Math.max(2, unit * 0.035))}"/><path d="${roof}" fill="${svgColor(structure.accentColor)}" stroke="#27352e" stroke-width="${number(Math.max(1.5, unit * 0.025))}"/>${details}</g>`;
    })
    .join('');
  const spaceLandmarks = scene.spaceLandmarks
    .map((landmark) => {
      const [baseX, baseY] = point(landmark.tileIndex);
      const x = landmark.kind === 'launch-site' ? baseX + unit * 0.31 : baseX;
      const y = landmark.kind === 'launch-site' ? baseY - unit * 0.24 : baseY;
      const size = unit * (scene.detailLevel === 'close' ? 0.2 : 0.13);
      if (landmark.kind === 'launch-site') {
        return `<g data-space-kind="launch-site" data-source="${landmark.sourceId}" data-status="${landmark.status}"><path d="M${number(x - size * 0.7)} ${number(y + size)}L${number(x - size * 0.28)} ${number(y - size * 1.35)}H${number(x + size * 0.28)}L${number(x + size * 0.7)} ${number(y + size)}Z" fill="#d9e3dc" stroke="${svgColor(landmark.accentColor)}" stroke-width="${number(Math.max(1.5, unit * 0.025))}"/><path d="M${number(x - size * 1.05)} ${number(y + size)}V${number(y - size * 0.85)}H${number(x - size * 0.4)}" fill="none" stroke="#8fa9a8" stroke-width="${number(Math.max(1.2, unit * 0.02))}"/></g>`;
      }
      if (landmark.kind === 'body') {
        if (landmark.bodyKind === 'asteroid') {
          return `<path d="M${number(x - size)} ${number(y - size * 0.35)}L${number(x - size * 0.35)} ${number(y - size)}L${number(x + size * 0.8)} ${number(y - size * 0.6)}L${number(x + size)} ${number(y + size * 0.35)}L${number(x + size * 0.2)} ${number(y + size)}L${number(x - size * 0.85)} ${number(y + size * 0.55)}Z" data-body-kind="asteroid" data-source="${landmark.sourceId}" fill="#8e8272" stroke="${svgColor(landmark.accentColor)}" stroke-width="${number(Math.max(1.5, unit * 0.025))}"/>`;
        }
        const radius = landmark.bodyKind === 'moon' ? size * 0.72 : size;
        const ring =
          landmark.bodyKind === 'planet'
            ? `<path d="M${number(x - radius * 1.45)} ${number(y + radius * 0.35)}L${number(x + radius * 1.45)} ${number(y - radius * 0.35)}" fill="none" stroke="#d9e3dc" stroke-width="${number(Math.max(1.2, unit * 0.02))}"/>`
            : '';
        return `<g data-body-kind="${landmark.bodyKind}" data-habitable="${landmark.habitable}" data-source="${landmark.sourceId}"><circle cx="${number(x)}" cy="${number(y)}" fill="${landmark.habitable ? '#5f9d78' : '#76828c'}" r="${number(radius)}" stroke="${svgColor(landmark.accentColor)}" stroke-width="${number(Math.max(1.5, unit * 0.025))}"/>${ring}</g>`;
      }
      if (landmark.kind === 'craft') {
        return `<g data-space-kind="craft" data-source="${landmark.sourceId}" data-status="${landmark.status}"><path d="M${number(x)} ${number(y - size * 1.3)}L${number(x + size * 0.55)} ${number(y - size * 0.2)}L${number(x + size * 0.42)} ${number(y + size * 0.75)}L${number(x)} ${number(y + size * 0.4)}L${number(x - size * 0.42)} ${number(y + size * 0.75)}L${number(x - size * 0.55)} ${number(y - size * 0.2)}Z" fill="#d9e3dc" stroke="${svgColor(landmark.accentColor)}" stroke-width="${number(Math.max(1.5, unit * 0.025))}"/><circle cx="${number(x)}" cy="${number(y - size * 0.35)}" fill="#79cbd1" r="${number(size * 0.22)}"/></g>`;
      }
      return `<g data-space-kind="colony" data-source="${landmark.sourceId}" data-status="${landmark.status}"><path d="M${number(x - size * 1.2)} ${number(y + size * 0.8)}L${number(x - size * 0.7)} ${number(y - size * 0.35)}L${number(x)} ${number(y - size * 0.85)}L${number(x + size * 0.7)} ${number(y - size * 0.35)}L${number(x + size * 1.2)} ${number(y + size * 0.8)}Z" fill="${landmark.status === 'active' ? '#aac2b5' : '#665f5a'}" stroke="${svgColor(landmark.accentColor)}" stroke-width="${number(Math.max(1.5, unit * 0.025))}"/><path d="M${number(x - size * 0.7)} ${number(y + size * 0.05)}H${number(x + size * 0.7)}" fill="none" stroke="#23332d" stroke-width="${number(Math.max(1.2, unit * 0.02))}"/></g>`;
    })
    .join('');
  const agents = scene.agents
    .map((agent) => {
      const [x, y] = point(agent.tileIndex);
      const heightScale = agent.ageTier === 'child' ? 0.78 : agent.ageTier === 'elder' ? 0.92 : 1;
      const figureHeight = unit * (scene.detailLevel === 'close' ? 0.34 : 0.22) * heightScale;
      const bodyWidth =
        figureHeight *
        (agent.identity.silhouette === 'compact'
          ? 0.28
          : agent.identity.silhouette === 'broad'
            ? 0.42
            : 0.34);
      const direction = agent.identity.facing === 'left' ? -1 : 1;
      const headY = y - figureHeight * 0.38;
      const bodyTop = y - figureHeight * 0.12;
      const bodyBottom = y + figureHeight * 0.45;
      const shadow =
        scene.detailLevel === 'overview'
          ? ''
          : `<ellipse cx="${number(x)}" cy="${number(y + figureHeight * 0.64)}" fill="#101813" fill-opacity="0.5" rx="${number(bodyWidth * 1.45)}" ry="${number(figureHeight * 0.11)}"/>`;
      const closeDetails =
        scene.detailLevel !== 'close'
          ? ''
          : `<path d="M${number(x - figureHeight * 0.08)} ${number(headY - figureHeight * 0.04)}L${number(x + direction * figureHeight * 0.03)} ${number(headY - figureHeight * 0.14)}L${number(x + direction * figureHeight * 0.13)} ${number(headY - figureHeight * 0.04)}" fill="none" stroke="#3e3028" stroke-width="${number(Math.max(1.2, unit * 0.018))}"/><circle cx="${number(x + direction * figureHeight * 0.1)}" cy="${number(headY)}" fill="#17211c" r="${number(Math.max(1, figureHeight * 0.025))}"/>`;
      const activityMark =
        agent.activityVisual === 'carry'
          ? `<rect fill="${svgColor(agent.identity.accentColor)}" height="${number(figureHeight * 0.28)}" width="${number(figureHeight * 0.28)}" x="${number(x + direction * figureHeight * 0.34 - figureHeight * 0.14)}" y="${number(y - figureHeight * 0.05)}"/>`
          : agent.activityVisual === 'water'
            ? `<path d="M${number(x + direction * figureHeight * 0.34)} ${number(y - figureHeight * 0.1)}Q${number(x + direction * figureHeight * 0.5)} ${number(y + figureHeight * 0.08)} ${number(x + direction * figureHeight * 0.34)} ${number(y + figureHeight * 0.24)}Q${number(x + direction * figureHeight * 0.18)} ${number(y + figureHeight * 0.08)} ${number(x + direction * figureHeight * 0.34)} ${number(y - figureHeight * 0.1)}Z" fill="#79cbd1"/>`
            : agent.activityVisual === 'build'
              ? `<path d="M${number(x + direction * figureHeight * 0.2)} ${number(y - figureHeight * 0.02)}L${number(x + direction * figureHeight * 0.52)} ${number(y - figureHeight * 0.32)}M${number(x + direction * figureHeight * 0.38)} ${number(y - figureHeight * 0.4)}L${number(x + direction * figureHeight * 0.58)} ${number(y - figureHeight * 0.2)}" fill="none" stroke="${svgColor(agent.identity.accentColor)}" stroke-width="${number(Math.max(1.5, unit * 0.025))}"/>`
              : agent.activityVisual === 'gather'
                ? `<path d="M${number(x + direction * figureHeight * 0.18)} ${number(y)}L${number(x + direction * figureHeight * 0.52)} ${number(y + figureHeight * 0.28)}" fill="none" stroke="${svgColor(agent.identity.accentColor)}" stroke-width="${number(Math.max(1.5, unit * 0.025))}"/>`
                : agent.activityVisual === 'rest'
                  ? `<path d="M${number(x - figureHeight * 0.36)} ${number(y + figureHeight * 0.48)}H${number(x + figureHeight * 0.36)}" fill="none" stroke="${svgColor(agent.identity.accentColor)}" stroke-width="${number(Math.max(1.5, unit * 0.025))}"/>`
                  : '';
      return `<g data-accent="${agent.identity.accent}" data-activity="${agent.activityVisual}" data-agent="${agent.selectable.id}" data-facing="${agent.identity.facing}" data-health="${agent.healthTier}" data-silhouette="${agent.identity.silhouette}">${shadow}<path d="M${number(x - bodyWidth)} ${number(bodyTop)}Q${number(x)} ${number(bodyTop - figureHeight * 0.12)} ${number(x + bodyWidth)} ${number(bodyTop)}L${number(x + bodyWidth * 0.76)} ${number(bodyBottom)}H${number(x - bodyWidth * 0.76)}Z" fill="${svgColor(agent.identity.clothingColor)}" stroke="#17211c" stroke-width="${number(Math.max(1.5, unit * 0.025))}"/><circle cx="${number(x + direction * figureHeight * 0.04)}" cy="${number(headY)}" fill="${svgColor(agent.identity.skinColor)}" r="${number(figureHeight * 0.16)}" stroke="#17211c" stroke-width="${number(Math.max(1.2, unit * 0.02))}"/>${closeDetails}<path d="M${number(x - bodyWidth * 0.9)} ${number(bodyTop + figureHeight * 0.08)}L${number(x - bodyWidth * 1.4)} ${number(y + figureHeight * 0.17)}M${number(x + bodyWidth * 0.9)} ${number(bodyTop + figureHeight * 0.08)}L${number(x + bodyWidth * 1.4)} ${number(y + figureHeight * 0.17)}M${number(x - bodyWidth * 0.82)} ${number(y + figureHeight * 0.42)}L${number(x - bodyWidth)} ${number(y + figureHeight * 0.68)}M${number(x + bodyWidth * 0.82)} ${number(y + figureHeight * 0.42)}L${number(x + bodyWidth)} ${number(y + figureHeight * 0.68)}" fill="none" stroke="#17211c" stroke-width="${number(Math.max(1.5, unit * 0.025))}"/>${activityMark}</g>`;
    })
    .join('');
  const effects = scene.effects
    .map((effect) => {
      const [x, y] = point(effect.markerTileIndex);
      const size = unit * 0.18;
      const path =
        effect.kind === 'storm'
          ? `M${number(x - size)} ${number(y - size * 0.55)}H${number(x + size * 0.15)}L${number(x - size * 0.45)} ${number(y + size * 0.2)}H${number(x + size)}L${number(x - size * 0.25)} ${number(y + size)}`
          : effect.kind === 'fire'
            ? `M${number(x)} ${number(y - size)}L${number(x + size * 0.8)} ${number(y + size * 0.35)}L${number(x + size * 0.25)} ${number(y + size)}L${number(x - size * 0.75)} ${number(y + size * 0.55)}L${number(x - size * 0.4)} ${number(y - size * 0.1)}Z`
            : effect.kind === 'flood'
              ? `M${number(x - size)} ${number(y - size * 0.45)}Q${number(x - size * 0.35)} ${number(y - size * 0.8)} ${number(x + size * 0.35)} ${number(y - size * 0.45)}Q${number(x + size * 0.7)} ${number(y - size * 0.1)} ${number(x + size)} ${number(y - size * 0.45)}M${number(x - size)} ${number(y + size * 0.45)}Q${number(x - size * 0.35)} ${number(y + size * 0.1)} ${number(x + size * 0.35)} ${number(y + size * 0.45)}Q${number(x + size * 0.7)} ${number(y + size * 0.8)} ${number(x + size)} ${number(y + size * 0.45)}`
              : effect.kind === 'earthquake'
                ? `M${number(x - size)} ${number(y - size)}L${number(x - size * 0.25)} ${number(y - size * 0.25)}L${number(x - size * 0.7)} ${number(y + size * 0.15)}L${number(x + size * 0.15)} ${number(y + size)}L${number(x + size)} ${number(y + size * 0.3)}`
                : effect.kind === 'meteor-impact'
                  ? `M${number(x - size)} ${number(y - size)}L${number(x + size * 0.1)} ${number(y + size * 0.1)}M${number(x - size * 0.1)} ${number(y + size * 0.1)}A${number(size * 0.65)} ${number(size * 0.65)} 0 1 0 ${number(x + size * 1.2)} ${number(y + size * 0.1)}`
                  : `M${number(x - size)} ${number(y + size)}L${number(x - size * 0.25)} ${number(y + size * 0.2)}L${number(x + size * 0.25)} ${number(y + size * 0.75)}L${number(x + size)} ${number(y - size)}`;
      return `<path d="${path}" data-effect="${effect.kind}" data-reduced="${effect.reduced}" data-severity="${effect.severity}" fill="${effect.kind === 'fire' ? '#d76d55' : 'none'}" stroke="${effect.kind === 'flood' ? '#79cbd1' : '#d76d55'}" stroke-width="${number(Math.max(2, unit * 0.04))}"/>`;
    })
    .join('');
  const selected =
    scene.selected === null
      ? ''
      : `<text fill="#ffffff" x="12" y="${height - 14}">selected:${scene.selected.kind}:${scene.selected.id}</text>`;
  return `<svg aria-label="${scene.era} ${scene.detailLevel} render baseline" data-detail="${scene.detailLevel}" data-signature="${scene.sceneSignature}" height="${height}" viewBox="0 0 ${width} ${height}" width="${width}" xmlns="http://www.w3.org/2000/svg"><g id="terrain">${terrain}</g><g id="terrain-texture">${terrainTexture}</g><g id="routes">${routes}</g><g id="settlements">${settlements}</g><g id="built-environment">${built}</g><g id="ruins">${ruins}</g><g id="structures">${structures}</g><g id="space-landmarks">${spaceLandmarks}</g><g id="agents">${agents}</g><g id="effects">${effects}</g>${selected}</svg>`;
}
