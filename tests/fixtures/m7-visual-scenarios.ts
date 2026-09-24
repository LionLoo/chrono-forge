import {
  createTestOnlyVisualProjection,
  type RenderModelOptions,
  type RenderViewport,
  type TestOnlyVisualProjection,
} from '../../src/rendering/render-model';

export const M7_FIXED_VIEWPORT = Object.freeze({
  camera: Object.freeze({ heightTiles: 9, leftTile: 0, topTile: 0, widthTiles: 16 }),
  height: 540,
  width: 960,
});

export interface M7VisualScenario {
  readonly name: 'founding' | 'town' | 'industrial' | 'disaster' | 'advanced' | 'space';
  readonly projection: TestOnlyVisualProjection;
  readonly renderOptions: RenderModelOptions;
}

const terrain = (value: number): Uint8Array =>
  new Uint8Array(Array.from({ length: 16 * 9 }, (_, index) => (index + value) % 7));
const resources = (value: number): Uint16Array =>
  new Uint16Array(Array.from({ length: 16 * 9 }, (_, index) => value + (index % 5) * 160));
const scalar = (value: number): Uint8Array =>
  new Uint8Array(
    Array.from({ length: 16 * 9 }, (_, index) => Math.min(255, value + (index % 4) * 12)),
  );

const renderOptions = (overlay: RenderModelOptions['overlay']): RenderModelOptions =>
  Object.freeze({
    detailLevel: 'district',
    overlay,
    reducedEffects: true,
    selection: null,
    viewport: M7_FIXED_VIEWPORT.camera,
  });

function scenario(
  name: M7VisualScenario['name'],
  knowledge: readonly string[],
  options: {
    readonly crisis?: { readonly id: number; readonly kind: string; readonly severity: number };
    readonly era?: 'advanced' | 'space';
    readonly population?: number;
  } = {},
): M7VisualScenario {
  const population = options.population ?? 8;
  return Object.freeze({
    name,
    projection: createTestOnlyVisualProjection({
      agentFacts: Object.freeze([
        Object.freeze({ action: 6, ageYears: 31, health: 900, id: 1, tileIndex: 36 }),
        Object.freeze({ action: 1, ageYears: 68, health: 500, id: 2, tileIndex: 53 }),
      ]),
      biome: terrain(1),
      cultureFacts: Object.freeze([Object.freeze({ architectureStyle: 'river-stone', id: 1 })]),
      crisisFacts:
        options.crisis === undefined
          ? Object.freeze([])
          : Object.freeze([Object.freeze(options.crisis)]),
      habitability: scalar(145),
      hazard: scalar(options.crisis === undefined ? 20 : 120),
      height: 9,
      knownKnowledgeIds: Object.freeze([...knowledge]),
      resource: resources(300),
      ruinFacts: Object.freeze([Object.freeze({ id: 7, settlementId: 1 })]),
      routeFacts: Object.freeze([
        Object.freeze({
          firstSettlementId: 1,
          id: 3,
          secondSettlementId: 2,
          status: 'active' as const,
          volume: 44,
        }),
      ]),
      settlementFacts: Object.freeze([
        Object.freeze({
          centerTileIndex: 36,
          cultureId: 1,
          id: 1,
          population,
          reserves: 340,
          status: 'active' as const,
        }),
        Object.freeze({
          centerTileIndex: 107,
          cultureId: 1,
          id: 2,
          population: 16,
          reserves: 180,
          status: 'active' as const,
        }),
      ]),
      spaceBodyFacts: Object.freeze(
        options.era === 'space'
          ? [
              Object.freeze({ distance: 0, habitable: true, id: 1, kind: 'home' as const }),
              Object.freeze({ distance: 4, habitable: true, id: 2, kind: 'planet' as const }),
              Object.freeze({ distance: 6, habitable: false, id: 3, kind: 'moon' as const }),
            ]
          : [],
      ),
      spaceColonyCount: options.era === 'space' ? 1 : 0,
      spaceColonyFacts: Object.freeze(
        options.era === 'space'
          ? [
              Object.freeze({
                bodyId: 2,
                id: 6,
                residentCount: 12,
                settlementId: 1,
                status: 'active' as const,
              }),
            ]
          : [],
      ),
      spaceMissionFacts: Object.freeze(
        options.era === 'space'
          ? [
              Object.freeze({
                civilizationId: 1,
                id: 3,
                kind: 'orbital' as const,
                spacecraftId: 2,
                status: 'active' as const,
              }),
            ]
          : [],
      ),
      spaceProgramStage: options.era === 'space' ? 'spaceflight' : 'none',
      spaceProgramFacts: Object.freeze(
        options.era === 'space' || options.era === 'advanced'
          ? [
              Object.freeze({
                civilizationId: 1,
                id: 1,
                launchCapacity: options.era === 'space' ? 2 : 0,
                settlementId: 1,
                stage:
                  options.era === 'space' ? ('spaceflight' as const) : ('advanced-energy' as const),
              }),
            ]
          : [],
      ),
      spacecraftFacts: Object.freeze(
        options.era === 'space'
          ? [
              Object.freeze({
                civilizationId: 1,
                currentBodyId: 1,
                id: 2,
                missionId: 3,
                status: 'orbiting' as const,
              }),
            ]
          : [],
      ),
      structureFacts: Object.freeze([
        Object.freeze({ condition: 920, id: 1, kind: 1, progress: 1_000, state: 3, tileIndex: 36 }),
        Object.freeze({ condition: 420, id: 2, kind: 2, progress: 650, state: 2, tileIndex: 37 }),
      ]),
      testOnlyEra: options.era ?? null,
      tick: 50_000,
      width: 16,
    }),
    renderOptions: renderOptions(
      name === 'disaster' ? 'danger' : name === 'town' ? 'population' : 'technology',
    ),
  });
}

export const M7_VISUAL_SCENARIOS: readonly M7VisualScenario[] = Object.freeze([
  scenario('founding', ['foraging-lore', 'shelter-craft']),
  scenario('town', ['agriculture', 'stonecraft', 'water-management'], { population: 22 }),
  scenario(
    'industrial',
    ['agriculture', 'mechanics', 'metallurgy', 'stonecraft', 'water-management'],
    {
      population: 35,
    },
  ),
  scenario('disaster', ['agriculture', 'stonecraft', 'water-management'], {
    crisis: { id: 9, kind: 'storm', severity: 88 },
    population: 22,
  }),
  scenario('advanced', ['advanced-energy', 'mechanics', 'metallurgy'], {
    era: 'advanced',
    population: 40,
  }),
  scenario('space', ['spaceflight'], { era: 'space', population: 40 }),
]);

export const M7_RENDER_VIEWPORT: RenderViewport = M7_FIXED_VIEWPORT.camera;
