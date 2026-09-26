import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createFixtureRenderModel, renderModelSvgBaseline } from '../src/rendering/render-model';
import { M10_5_VISUAL_SCENARIOS } from '../tests/fixtures/m10-5-visual-scenarios';
import { M7_VISUAL_SCENARIOS } from '../tests/fixtures/m7-visual-scenarios';

const outputDirectory = resolve('tests', 'visual', 'baselines');
mkdirSync(outputDirectory, { recursive: true });

for (const scenario of M7_VISUAL_SCENARIOS) {
  const svg = renderModelSvgBaseline(
    createFixtureRenderModel(scenario.projection, scenario.renderOptions),
  );
  writeFileSync(resolve(outputDirectory, `${scenario.name}.svg`), `${svg}\n`, 'utf8');
}

for (const scenario of M10_5_VISUAL_SCENARIOS) {
  const svg = renderModelSvgBaseline(
    createFixtureRenderModel(scenario.projection, scenario.renderOptions),
  );
  writeFileSync(
    resolve(outputDirectory, `m10-5-${scenario.name}-${scenario.view}.svg`),
    `${svg}\n`,
    'utf8',
  );
}

console.log(
  `Generated ${M7_VISUAL_SCENARIOS.length + M10_5_VISUAL_SCENARIOS.length} deterministic render baselines.`,
);
