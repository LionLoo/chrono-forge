import type { WorldFrameProjection } from '../protocol';
import {
  colorForTile,
  overlayDefinition,
  type OverlayPattern,
  type WorldOverlay,
} from './world-palette';

export const RENDER_MODEL_VERSION = 1;
export const RENDER_GUARD_BAND_TILES = 1;

export type RenderEra = 'founding' | 'town' | 'industrial' | 'advanced' | 'space';
export type BuiltEnvironmentKind = 'farm' | 'district' | 'industry' | 'infrastructure' | 'road';
export type EffectKind = 'drought' | 'flood' | 'fire' | 'storm' | 'earthquake' | 'meteor-impact';

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
  readonly spaceColonyCount: number;
  readonly spaceProgramStage: 'none' | 'advanced-energy' | 'planetary-engineering' | 'spaceflight';
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
  readonly color: number;
  readonly overlayPattern: OverlayPattern;
  readonly overlayValue: number;
  readonly tileIndex: number;
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
  readonly ageTier: 'child' | 'adult' | 'elder';
  readonly healthTier: 'sound' | 'worn' | 'critical';
  readonly selectable: SelectableId;
  readonly tileIndex: number;
}

export interface StructureDescriptor {
  readonly conditionTier: 'sound' | 'worn' | 'critical';
  readonly material: 'timber' | 'stone' | 'metal';
  readonly progress: number;
  readonly selectable: SelectableId;
  readonly state: number;
  readonly tileIndex: number;
}

export interface SettlementDescriptor {
  readonly cultureStyle: string;
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
  readonly structures: string;
  readonly terrain: string;
}

export interface RenderModel {
  readonly agents: readonly AgentDescriptor[];
  readonly builtEnvironment: readonly BuiltEnvironmentDescriptor[];
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
  readonly structures: readonly StructureDescriptor[];
  readonly terrain: readonly TerrainDescriptor[];
  readonly ruins: readonly RuinDescriptor[];
  readonly version: typeof RENDER_MODEL_VERSION;
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
  era: RenderEra,
  overlay: WorldOverlay,
): string {
  return `m7-r${RENDER_MODEL_VERSION}-${fnv1a(
    [
      era,
      overlay,
      layers.agents,
      layers.builtEnvironment,
      layers.effects,
      layers.routesRuins,
      layers.selection,
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
    spaceColonyCount: frame.space.colonies.filter((colony) => colony.status === 'active').length,
    spaceProgramStage:
      frame.space.programs.find((program) => program.stage === 'spaceflight')?.stage ??
      frame.space.programs.find((program) => program.stage === 'planetary-engineering')?.stage ??
      frame.space.programs.find((program) => program.stage === 'advanced-energy')?.stage ??
      'none',
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
  const renderedMaterial = material(knowledge);

  for (const agent of sorted(projection.agentFacts)) {
    addToTileIndex(
      agentsByTile,
      agent.tileIndex,
      Object.freeze({
        action: agent.action,
        ageTier: agent.ageYears < 18 ? 'child' : agent.ageYears >= 60 ? 'elder' : 'adult',
        healthTier: agent.health >= 667 ? 'sound' : agent.health >= 334 ? 'worn' : 'critical',
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
        conditionTier:
          structure.condition >= 667 ? 'sound' : structure.condition >= 334 ? 'worn' : 'critical',
        material: structure.kind === 2 && knowledge.has('stonecraft') ? 'stone' : renderedMaterial,
        progress: structure.progress,
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
        cultureStyle,
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
  const indexedDescriptors =
    projection.agentFacts.length +
    projection.structureFacts.length +
    settlements.length +
    uniqueBuiltDescriptors +
    sorted(projection.routeFacts).filter(
      (route) => route.status === 'active' || route.status === 'disrupted',
    ).length +
    projection.ruinFacts.length +
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
    agents: layerSignature(
      'agents',
      agents.map(
        (entry) =>
          `${entry.selectable.id}:${entry.tileIndex}:${entry.action}:${entry.ageTier}:${entry.healthTier}`,
      ),
    ),
    builtEnvironment: layerSignature('built', [
      ...settlementDescriptors.map(
        (entry) =>
          `settlement:${entry.selectable.id}:${entry.tileIndex}:${entry.cultureStyle}:${entry.wealthTier}`,
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
    structures: layerSignature(
      'structures',
      structures.map(
        (entry) =>
          `${entry.selectable.id}:${entry.tileIndex}:${entry.state}:${entry.progress}:${entry.conditionTier}:${entry.material}`,
      ),
    ),
    terrain: layerSignature(
      'terrain',
      terrain.map(
        (entry) =>
          `${entry.tileIndex}:${entry.color}:${entry.overlayValue}:${entry.overlayPattern}`,
      ),
    ),
  });
  return Object.freeze({
    agents: Object.freeze(agents),
    builtEnvironment: Object.freeze(sortedBuiltEnvironment),
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
        effects.length,
      indexedDescriptors: data.indexedDescriptors,
      queriedTiles: visibleTiles.length,
    }),
    routes: Object.freeze(routes),
    ruins: Object.freeze(ruins),
    sceneSignature: semanticSignature(layerSignatures, data.era, options.overlay),
    selected,
    settlements: Object.freeze(settlementDescriptors),
    structures: Object.freeze(structures),
    terrain: Object.freeze(terrain),
    version: RENDER_MODEL_VERSION,
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

/**
 * Stable visual evidence for pure render plans. Pixi remains responsible for
 * runtime drawing; this SVG intentionally contains only the same descriptors.
 */
export function renderModelSvgBaseline(scene: RenderModel, width = 960, height = 540): string {
  const tileWidth = width / scene.width;
  const tileHeight = height / scene.height;
  const point = (tileIndex: number): readonly [number, number] => [
    ((tileIndex % scene.width) + 0.5) * tileWidth,
    (Math.floor(tileIndex / scene.width) + 0.5) * tileHeight,
  ];
  const terrain = scene.terrain
    .filter((tile) => tile.x % 4 === 0 && tile.y % 3 === 0)
    .map(
      (tile) =>
        `<rect data-pattern="${tile.overlayPattern}" data-value="${tile.overlayValue}" fill="${svgColor(tile.color)}" height="${tileHeight * 3}" width="${tileWidth * 4}" x="${tile.x * tileWidth}" y="${tile.y * tileHeight}"/>`,
    )
    .join('');
  const built = scene.builtEnvironment
    .map((entry) => {
      const [x, y] = point(entry.tileIndex);
      return `<rect data-kind="${entry.kind}" fill="#e7c885" height="${tileHeight / 5}" width="${tileWidth / 5}" x="${x - tileWidth / 10}" y="${y - tileHeight / 10}"/>`;
    })
    .join('');
  const routes = scene.routes
    .map((route) => {
      const [x1, y1] = point(route.fromTileIndex);
      const [x2, y2] = point(route.toTileIndex);
      return `<path d="M${x1} ${y1}L${x2} ${y2}" data-route="${route.selectable.id}" fill="none" stroke="#79cbd1" stroke-width="3"/>`;
    })
    .join('');
  const ruins = scene.ruins
    .map((ruin) => {
      const [x, y] = point(ruin.tileIndex);
      return `<path d="M${x - 8} ${y - 8}L${x + 8} ${y + 8}M${x + 8} ${y - 8}L${x - 8} ${y + 8}" data-ruin="${ruin.selectable.id}" stroke="#d76d55" stroke-width="3"/>`;
    })
    .join('');
  const structures = scene.structures
    .map((structure) => {
      const [x, y] = point(structure.tileIndex);
      return `<rect data-structure="${structure.selectable.id}" fill="#f3dfaa" height="14" width="14" x="${x - 7}" y="${y - 7}"/>`;
    })
    .join('');
  const agents = scene.agents
    .map((agent) => {
      const [x, y] = point(agent.tileIndex);
      return `<circle cx="${x}" cy="${y}" data-agent="${agent.selectable.id}" fill="#f4ede0" r="6"/>`;
    })
    .join('');
  const effects = scene.effects
    .map(
      (effect, index) =>
        `<circle cx="${32 + index * 22}" cy="32" data-effect="${effect.kind}" fill="none" r="10" stroke="#d76d55" stroke-width="3"/>`,
    )
    .join('');
  const selected =
    scene.selected === null
      ? ''
      : `<text fill="#ffffff" x="12" y="${height - 14}">selected:${scene.selected.kind}:${scene.selected.id}</text>`;
  return `<svg aria-label="${scene.era} render baseline" data-signature="${scene.sceneSignature}" height="${height}" viewBox="0 0 ${width} ${height}" width="${width}" xmlns="http://www.w3.org/2000/svg"><g id="terrain">${terrain}</g><g id="built-environment">${built}</g><g id="routes-ruins">${routes}${ruins}</g><g id="structures">${structures}</g><g id="agents">${agents}</g><g id="effects">${effects}</g>${selected}</svg>`;
}
