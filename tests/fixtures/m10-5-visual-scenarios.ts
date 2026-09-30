import type {
  RenderDetailLevel,
  RenderModelOptions,
  TestOnlyVisualProjection,
} from '../../src/rendering/render-model';
import { createTestOnlyVisualProjection } from '../../src/rendering/render-model';
import { M7_VISUAL_SCENARIOS } from './m7-visual-scenarios';

export type M10_5ScenarioName =
  'founding' | 'mature-settlement' | 'crisis' | 'advanced-city' | 'space';

export interface M10_5VisualScenario {
  readonly detailLevel: Extract<RenderDetailLevel, 'overview' | 'close'>;
  readonly name: M10_5ScenarioName;
  readonly projection: TestOnlyVisualProjection;
  readonly renderOptions: RenderModelOptions;
  readonly view: 'wide' | 'close';
}

const SOURCE_SCENARIOS: Readonly<Record<M10_5ScenarioName, (typeof M7_VISUAL_SCENARIOS)[number]>> =
  Object.freeze({
    founding: requiredSource('founding'),
    'mature-settlement': requiredSource('town'),
    crisis: requiredSource('disaster'),
    'advanced-city': requiredSource('advanced'),
    space: requiredSource('space'),
  });

function requiredSource(name: (typeof M7_VISUAL_SCENARIOS)[number]['name']) {
  const source = M7_VISUAL_SCENARIOS.find((scenario) => scenario.name === name);
  if (source === undefined) throw new Error(`Missing M7 visual source: ${name}`);
  return source;
}

function visualScenario(
  name: M10_5ScenarioName,
  view: M10_5VisualScenario['view'],
): M10_5VisualScenario {
  const source = SOURCE_SCENARIOS[name];
  const detailLevel = view === 'wide' ? 'overview' : 'close';
  return Object.freeze({
    detailLevel,
    name,
    projection: enrichScenarioProjection(name, source.projection),
    renderOptions: Object.freeze({
      ...source.renderOptions,
      detailLevel,
      overlay: name === 'crisis' ? 'danger' : 'terrain',
      viewport:
        view === 'wide'
          ? Object.freeze({ heightTiles: 9, leftTile: 0, topTile: 0, widthTiles: 16 })
          : Object.freeze({
              heightTiles: 5,
              leftTile: name === 'space' ? 0 : 1,
              topTile: name === 'space' ? 0 : 1,
              widthTiles: 7,
            }),
    }),
    view,
  });
}

/**
 * The older M7 fixtures prove deterministic layer semantics with a deliberately
 * tiny cast. M10.5 uses the same facts plus a denser, still-explicit test-only
 * neighborhood so close visual evidence exercises a lived-in settlement rather
 * than two overlapping glyphs.
 */
function enrichScenarioProjection(
  name: M10_5ScenarioName,
  projection: TestOnlyVisualProjection,
): TestOnlyVisualProjection {
  const { provenance, ...base } = projection;
  if (provenance !== 'test-only') {
    throw new TypeError('M10.5 visual evidence must remain explicitly test-only.');
  }
  const isFounding = name === 'founding';
  const agentAdditions = isFounding
    ? [
        Object.freeze({ action: 2, ageYears: 24, health: 940, id: 11, tileIndex: 35 }),
        Object.freeze({ action: 4, ageYears: 42, health: 870, id: 12, tileIndex: 52 }),
      ]
    : [
        Object.freeze({ action: 2, ageYears: 24, health: 940, id: 11, tileIndex: 35 }),
        Object.freeze({ action: 4, ageYears: 42, health: 870, id: 12, tileIndex: 51 }),
        Object.freeze({ action: 5, ageYears: 16, health: 910, id: 13, tileIndex: 52 }),
        Object.freeze({ action: 6, ageYears: 36, health: 780, id: 14, tileIndex: 54 }),
        Object.freeze({ action: 1, ageYears: 57, health: 690, id: 15, tileIndex: 68 }),
        Object.freeze({ action: 3, ageYears: 9, health: 960, id: 16, tileIndex: 69 }),
      ];
  const structureAdditions = isFounding
    ? [Object.freeze({ condition: 980, id: 11, kind: 1, progress: 1_000, state: 3, tileIndex: 35 })]
    : [
        Object.freeze({
          condition: 980,
          id: 11,
          kind: 1,
          progress: 1_000,
          state: 3,
          tileIndex: 34,
        }),
        Object.freeze({
          condition: 860,
          id: 12,
          kind: 1,
          progress: 1_000,
          state: 3,
          tileIndex: 35,
        }),
        Object.freeze({
          condition: 760,
          id: 13,
          kind: 2,
          progress: 1_000,
          state: 3,
          tileIndex: 51,
        }),
        Object.freeze({
          condition: 930,
          id: 14,
          kind: 1,
          progress: 1_000,
          state: 3,
          tileIndex: 52,
        }),
        Object.freeze({ condition: 610, id: 15, kind: 1, progress: 780, state: 2, tileIndex: 54 }),
        Object.freeze({
          condition: 890,
          id: 16,
          kind: 2,
          progress: 1_000,
          state: 3,
          tileIndex: 68,
        }),
      ];
  return createTestOnlyVisualProjection({
    ...base,
    agentFacts: Object.freeze([...projection.agentFacts, ...agentAdditions]),
    structureFacts: Object.freeze([...projection.structureFacts, ...structureAdditions]),
  });
}

export const M10_5_VISUAL_SCENARIOS: readonly M10_5VisualScenario[] = Object.freeze(
  (Object.keys(SOURCE_SCENARIOS) as M10_5ScenarioName[]).flatMap((name) => [
    visualScenario(name, 'wide'),
    visualScenario(name, 'close'),
  ]),
);
