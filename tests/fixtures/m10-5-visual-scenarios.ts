import type {
  RenderDetailLevel,
  RenderModelOptions,
  TestOnlyVisualProjection,
} from '../../src/rendering/render-model';
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
    projection: source.projection,
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

export const M10_5_VISUAL_SCENARIOS: readonly M10_5VisualScenario[] = Object.freeze(
  (Object.keys(SOURCE_SCENARIOS) as M10_5ScenarioName[]).flatMap((name) => [
    visualScenario(name, 'wide'),
    visualScenario(name, 'close'),
  ]),
);
