import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildPreparedRenderModel,
  createFixtureRenderModel,
  createRenderModel,
  prepareFixtureRenderProjection,
  renderDetailForZoom,
  renderModelSvgBaseline,
  type RenderModelOptions,
} from '../../src/rendering/render-model';
import { M7_VISUAL_SCENARIOS } from '../fixtures/m7-visual-scenarios';
import { M10_5_VISUAL_SCENARIOS } from '../fixtures/m10-5-visual-scenarios';

describe('M7 render model', () => {
  it('keeps every required visual fixture fixed at the documented viewport', () => {
    expect(M7_VISUAL_SCENARIOS.map((scenario) => scenario.name)).toEqual([
      'founding',
      'town',
      'industrial',
      'disaster',
      'advanced',
      'space',
    ]);
    expect(M7_VISUAL_SCENARIOS.every((scenario) => scenario.renderOptions.reducedEffects)).toBe(
      true,
    );
  });

  it('source-gates eras and decorative built environment', () => {
    const [founding, town, industrial] = M7_VISUAL_SCENARIOS;
    if (founding === undefined || town === undefined || industrial === undefined)
      throw new Error('M7 fixtures are incomplete.');

    expect(createFixtureRenderModel(founding.projection, founding.renderOptions).era).toBe(
      'founding',
    );
    const townScene = createFixtureRenderModel(town.projection, town.renderOptions);
    expect(townScene.era).toBe('town');
    expect(townScene.builtEnvironment.map((entry) => entry.kind)).toContain('farm');
    expect(townScene.builtEnvironment.map((entry) => entry.kind)).toContain('district');
    const industrialScene = createFixtureRenderModel(
      industrial.projection,
      industrial.renderOptions,
    );
    expect(industrialScene.era).toBe('industrial');
    expect(industrialScene.builtEnvironment.map((entry) => entry.kind)).toContain('industry');
    expect(industrialScene.builtEnvironment.map((entry) => entry.kind)).toContain('road');
  });

  it('derives stable person identity and factual activity presentation independently of detail', () => {
    const town = M7_VISUAL_SCENARIOS.find((scenario) => scenario.name === 'town');
    if (town === undefined) throw new Error('Town fixture is missing.');
    const overview = createFixtureRenderModel(town.projection, {
      ...town.renderOptions,
      detailLevel: 'overview',
    });
    const close = createFixtureRenderModel(town.projection, {
      ...town.renderOptions,
      detailLevel: 'close',
    });

    expect(overview.detailLevel).toBe('overview');
    expect(close.detailLevel).toBe('close');
    expect(overview.agents.map((agent) => agent.identity)).toEqual(
      close.agents.map((agent) => agent.identity),
    );
    expect(close.agents.map((agent) => agent.activityVisual)).toEqual(['build', 'gather']);
    expect(close.agents[0]?.identity).not.toEqual(close.agents[1]?.identity);
    expect(close.structures.map((structure) => structure.form)).toEqual(['home', 'storehouse']);
    expect(close.structures.every((structure) => structure.roof.length > 0)).toBe(true);
  });

  it('uses bounded zoom bands for presentation density only', () => {
    expect(renderDetailForZoom(Number.NaN)).toBe('overview');
    expect(renderDetailForZoom(0.5)).toBe('overview');
    expect(renderDetailForZoom(1.249)).toBe('overview');
    expect(renderDetailForZoom(1.25)).toBe('district');
    expect(renderDetailForZoom(2.749)).toBe('district');
    expect(renderDetailForZoom(2.75)).toBe('close');
    expect(renderDetailForZoom(5)).toBe('close');
  });

  it('uses typed stable selections, guard-band culling, and reusable layer signatures', () => {
    const town = M7_VISUAL_SCENARIOS.find((scenario) => scenario.name === 'town');
    if (town === undefined) throw new Error('Town fixture is missing.');
    const selectedOptions: RenderModelOptions = {
      ...town.renderOptions,
      selection: { id: 1, kind: 'agent' },
      viewport: { heightTiles: 2, leftTile: 4, topTile: 1, widthTiles: 3 },
    };
    const first = createFixtureRenderModel(town.projection, selectedOptions);
    const second = createFixtureRenderModel(town.projection, selectedOptions);
    expect(first.selected).toEqual({ id: 1, kind: 'agent' });
    expect(first.terrain.map((entry) => entry.tileIndex)).toContain(36);
    expect(first.terrain.every((entry) => entry.x <= 7 && entry.y <= 3)).toBe(true);
    expect(first.terrain).toHaveLength(20);
    expect(first.layerSignatures).toEqual(second.layerSignatures);
    expect(first.planning.queriedTiles).toBe(20);
  });

  it('prepares representative-scale facts once and bounds view planning to spatial buckets', () => {
    const town = M7_VISUAL_SCENARIOS.find((scenario) => scenario.name === 'town');
    if (town === undefined) throw new Error('Town fixture is missing.');
    const projection = {
      ...town.projection,
      agentFacts: Object.freeze([
        ...town.projection.agentFacts,
        ...Array.from({ length: 20_000 }, (_, index) =>
          Object.freeze({
            action: index % 8,
            ageYears: 20 + (index % 50),
            health: 500,
            id: 10_000 + index,
            tileIndex: town.projection.width * town.projection.height - 1,
          }),
        ),
      ]),
    };
    const prepared = prepareFixtureRenderProjection(projection);
    const first = buildPreparedRenderModel(prepared, {
      ...town.renderOptions,
      viewport: { heightTiles: 2, leftTile: 0, topTile: 0, widthTiles: 3 },
    });
    const second = buildPreparedRenderModel(prepared, {
      ...town.renderOptions,
      selection: { id: 1, kind: 'agent' },
      viewport: { heightTiles: 2, leftTile: 1, topTile: 0, widthTiles: 3 },
    });

    expect(first.planning.indexedDescriptors).toBeGreaterThan(20_000);
    expect(first.planning.queriedTiles).toBe(12);
    expect(first.planning.candidateDescriptors).toBeLessThan(50);
    expect(second.planning.queriedTiles).toBe(15);
    expect(second.planning.candidateDescriptors).toBeLessThan(50);
  });

  it('invalidates only the affected visual layer when mutable projected facts change', () => {
    const town = M7_VISUAL_SCENARIOS.find((scenario) => scenario.name === 'town');
    if (town === undefined) throw new Error('Town fixture is missing.');
    const baseline = createFixtureRenderModel(town.projection, town.renderOptions);
    const changed = createFixtureRenderModel(
      {
        ...town.projection,
        agentFacts: town.projection.agentFacts.map((agent, index) =>
          index === 0 ? { ...agent, action: agent.action + 1 } : agent,
        ),
        cultureFacts: town.projection.cultureFacts.map((culture, index) =>
          index === 0
            ? { ...culture, architectureStyle: `${culture.architectureStyle}-changed` }
            : culture,
        ),
        routeFacts: town.projection.routeFacts.map((route, index) =>
          index === 0 ? { ...route, volume: route.volume + 1 } : route,
        ),
        structureFacts: town.projection.structureFacts.map((structure, index) =>
          index === 0 ? { ...structure, progress: structure.progress + 1 } : structure,
        ),
      },
      town.renderOptions,
    );

    expect(changed.layerSignatures.agents).not.toBe(baseline.layerSignatures.agents);
    expect(changed.layerSignatures.builtEnvironment).not.toBe(
      baseline.layerSignatures.builtEnvironment,
    );
    expect(changed.layerSignatures.routesRuins).not.toBe(baseline.layerSignatures.routesRuins);
    expect(changed.layerSignatures.structures).not.toBe(baseline.layerSignatures.structures);
    expect(changed.layerSignatures.terrain).toBe(baseline.layerSignatures.terrain);
  });

  it('suppresses only nonessential crisis effects in reduced-effects mode', () => {
    const disaster = M7_VISUAL_SCENARIOS.find((scenario) => scenario.name === 'disaster');
    if (disaster === undefined) throw new Error('Disaster fixture is missing.');
    expect(createFixtureRenderModel(disaster.projection, disaster.renderOptions).effects).toEqual([
      expect.objectContaining({
        kind: 'storm',
        reduced: true,
        selectable: { id: 9, kind: 'crisis' },
      }),
    ]);
    expect(
      createFixtureRenderModel(disaster.projection, {
        ...disaster.renderOptions,
        reducedEffects: false,
      }).effects,
    ).toEqual([
      expect.objectContaining({
        kind: 'storm',
        reduced: false,
        selectable: { id: 9, kind: 'crisis' },
      }),
    ]);
  });

  it('keeps advanced and space vocabulary test-only rather than accepting a production frame', () => {
    const advanced = M7_VISUAL_SCENARIOS.find((scenario) => scenario.name === 'advanced');
    const space = M7_VISUAL_SCENARIOS.find((scenario) => scenario.name === 'space');
    if (advanced === undefined || space === undefined)
      throw new Error('Test-only era fixture is missing.');
    expect(createFixtureRenderModel(advanced.projection, advanced.renderOptions).era).toBe(
      'advanced',
    );
    const advancedScene = createFixtureRenderModel(advanced.projection, advanced.renderOptions);
    const spaceScene = createFixtureRenderModel(space.projection, space.renderOptions);
    expect(advancedScene.spaceLandmarks.map((landmark) => landmark.kind)).toEqual(['launch-site']);
    expect(spaceScene.era).toBe('space');
    expect(spaceScene.spaceLandmarks.map((landmark) => landmark.kind).sort()).toEqual([
      'body',
      'body',
      'colony',
      'craft',
      'launch-site',
    ]);
    expect(spaceScene.spaceLandmarks.find((landmark) => landmark.kind === 'craft')?.status).toBe(
      'orbiting:orbital',
    );
    expect(spaceScene.layerSignatures.space).not.toBe(advancedScene.layerSignatures.space);
    expect(advanced.projection).not.toHaveProperty('version');
    expect(createRenderModel).toBeTypeOf('function');
  });

  it.each(M7_VISUAL_SCENARIOS)('emits a byte-stable SVG baseline for $name', (scenario) => {
    const first = renderModelSvgBaseline(
      createFixtureRenderModel(scenario.projection, scenario.renderOptions),
    );
    const second = renderModelSvgBaseline(
      createFixtureRenderModel(scenario.projection, scenario.renderOptions),
    );
    expect(first).toBe(second);
    expect(first).toBe(
      readFileSync(resolve('tests', 'visual', 'baselines', `${scenario.name}.svg`), 'utf8').trim(),
    );
  });

  it('locks five M10.5 factual scenarios at both wide and close exploration scales', () => {
    expect(M10_5_VISUAL_SCENARIOS.map((scenario) => `${scenario.name}:${scenario.view}`)).toEqual([
      'founding:wide',
      'founding:close',
      'mature-settlement:wide',
      'mature-settlement:close',
      'crisis:wide',
      'crisis:close',
      'advanced-city:wide',
      'advanced-city:close',
      'space:wide',
      'space:close',
    ]);
    expect(
      M10_5_VISUAL_SCENARIOS.every(
        (scenario) =>
          scenario.detailLevel === (scenario.view === 'wide' ? 'overview' : 'close') &&
          scenario.renderOptions.reducedEffects,
      ),
    ).toBe(true);
  });

  it.each(M10_5_VISUAL_SCENARIOS)(
    'emits a byte-stable M10.5 SVG baseline for $name $view',
    (scenario) => {
      const first = renderModelSvgBaseline(
        createFixtureRenderModel(scenario.projection, scenario.renderOptions),
      );
      const second = renderModelSvgBaseline(
        createFixtureRenderModel(scenario.projection, scenario.renderOptions),
      );
      expect(first).toBe(second);
      expect(first).toContain(`data-detail="${scenario.detailLevel}"`);
      expect(first).toContain('data-silhouette=');
      expect(first).toContain('data-form=');
      expect(first).toBe(
        readFileSync(
          resolve('tests', 'visual', 'baselines', `m10-5-${scenario.name}-${scenario.view}.svg`),
          'utf8',
        ).trim(),
      );
    },
  );
});
