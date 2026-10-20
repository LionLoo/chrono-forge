import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { chromium, type Page } from '@playwright/test';

import { serializeWorldSnapshot } from '../src/simulation/persistence';
import {
  applyRecordedSupplyShortage,
  createInitialWorld,
  stepWorld,
  type WorldState,
} from '../src/simulation/world';
import { waitForInstalledPlayerPage } from './installed-player-page.mjs';

const endpoint = process.env.CHRONO_FORGE_CDP_URL ?? 'http://127.0.0.1:9333';
const outputDirectory = resolve(
  process.env.CHRONO_FORGE_REVIEW_OUTPUT ?? 'test-results/m10-5-installed-review',
);
const m9Archives = JSON.parse(
  readFileSync(resolve('tests/fixtures/saves/m9-e2e-archives.json'), 'utf8'),
) as Readonly<{ contactedPackage: string; midFlightPackage: string }>;

interface CaptureObservation {
  readonly camera: string;
  readonly detail: string | null;
  readonly file: string;
  readonly height: number;
  readonly horizontalOverflow: boolean;
  readonly scalePercent: number;
  readonly scenario: string;
  readonly width: number;
}

function exportWorld(world: WorldState, slotId: string, name: string): string {
  const snapshot = serializeWorldSnapshot(world);
  return JSON.stringify({
    checksum: createHash('sha256').update(snapshot).digest('hex'),
    format: 'chrono-forge-save-export',
    name,
    slotId,
    snapshot,
    version: 1,
  });
}

function reviewPackages(): Readonly<Record<'crisis' | 'mature', string>> {
  const mature = stepWorld(
    createInitialWorld([7, 11, 13, 17], { societyYearTicks: 5_000 }),
    300_000,
  );
  const crisisBaseline = stepWorld(
    createInitialWorld([1, 2, 3, 4], { societyYearTicks: 5_000 }),
    150_000,
  );
  const crisis = applyRecordedSupplyShortage(crisisBaseline, 100);
  return Object.freeze({
    crisis: exportWorld(crisis, 'installed-crisis-review', 'Installed crisis review'),
    mature: exportWorld(mature, 'installed-mature-review', 'Installed mature review'),
  });
}

async function importPackage(page: Page, savePackage: string, loadedName: string): Promise<void> {
  const details = page.locator('details').filter({ hasText: 'Import or export package' });
  if ((await details.getAttribute('open')) === null) {
    await details.getByText('Import or export package').click();
  }
  await page.getByRole('textbox', { name: 'Import package' }).evaluate((element, value) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.bind(element)(
      value,
    );
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, savePackage);
  await page.getByRole('button', { name: 'Validate and import' }).click();
  await page.getByText(`Loaded ${loadedName}.`).waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('.simulation-status').getByText('Worker projection ready').waitFor({
    state: 'visible',
    timeout: 30_000,
  });
}

async function setPresentation(page: Page, scalePercent: number, reduced: boolean): Promise<void> {
  await page.evaluate((scale) => {
    document.documentElement.style.fontSize = `${scale}%`;
  }, scalePercent);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const settings = page.getByText('Focus and accessibility settings', { exact: true });
      const details = settings.locator('xpath=ancestor::details');
      if ((await details.getAttribute('open')) === null) await settings.click();
      const reducedEffects = page.getByRole('checkbox', { name: 'Reduce visual effects' });
      if ((await reducedEffects.isChecked()) !== reduced) {
        await reducedEffects.setChecked(reduced, { timeout: 10_000 });
        await page.locator('.world-map-canvas').waitFor({ state: 'visible' });
      }
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.waitForTimeout(100);
    }
  }
}

async function frameFirstObject(page: Page): Promise<void> {
  const mapObject = page.getByRole('combobox', { name: 'Inspect map object' });
  const values = await mapObject
    .locator('option')
    .evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value).filter(Boolean),
    );
  const value = values[0];
  if (value === undefined) throw new Error('Installed world exposed no inspectable map object.');
  await mapObject.selectOption(value);
  await page.getByRole('button', { name: 'Frame selection' }).click();
  await settleVisual(page);
  const cameraReadout = (await page.getByLabel('Camera position').textContent()) ?? '';
  const zoom = /([0-9]+\.[0-9]{2})×/.exec(cameraReadout)?.[1];
  if (zoom === undefined || Number(zoom) < 3.5) {
    throw new Error(`Frame selection did not establish a close camera: ${cameraReadout}`);
  }
}

async function exerciseInstalledControls(page: Page): Promise<void> {
  const populationOverlay = page.getByRole('radio', { name: 'Population' });
  await populationOverlay.focus();
  await page.keyboard.press('Space');
  await page.locator('.world-map-canvas[data-overlay="population"]').waitFor({ state: 'visible' });

  const zoom = page.getByRole('button', { name: 'Zoom world in' });
  await zoom.focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('Camera position').getByText('1.80×').waitFor({ state: 'visible' });

  const mapObject = page.getByRole('combobox', { name: 'Inspect map object' });
  await mapObject.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.getByRole('article', { name: 'Selected map object' }).waitFor({ state: 'visible' });
  const frameSelection = page.getByRole('button', { name: 'Frame selection' });
  await frameSelection.focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('Camera position').getByText('3.50×').waitFor({ state: 'visible' });

  const map = page.locator('.world-map-canvas');
  await map.scrollIntoViewIfNeeded();
  const mapBounds = await map.boundingBox();
  if (mapBounds === null) throw new Error('Installed world map has no pointer target bounds.');
  await page.mouse.click(mapBounds.x + mapBounds.width / 2, mapBounds.y + mapBounds.height / 2);
  await page.getByRole('article', { name: 'Selected map object' }).waitFor({ state: 'visible' });
  const scrollBeforeMapZoom = await page.evaluate(() => window.scrollY);
  await page.mouse.move(mapBounds.x + mapBounds.width / 2, mapBounds.y + mapBounds.height / 2);
  await page.mouse.wheel(0, -120);
  await page.getByLabel('Camera position').getByText('4.02×').waitFor({ state: 'visible' });
  if ((await page.evaluate(() => window.scrollY)) !== scrollBeforeMapZoom) {
    throw new Error('Installed map wheel zoom scrolled the document.');
  }

  const inspection = page.getByRole('button', { name: 'Open world inspection' });
  await inspection.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Settlement and society' }).waitFor({ state: 'visible' });
  const closeInspection = page.getByRole('button', { name: 'Close world inspection' });
  await closeInspection.focus();
  await page.keyboard.press('Enter');

  const settings = page.getByText('Focus and accessibility settings', { exact: true });
  await settings.focus();
  if ((await settings.locator('xpath=ancestor::details').getAttribute('open')) === null) {
    await page.keyboard.press('Enter');
  }
  const reducedEffects = page.getByRole('checkbox', { name: 'Reduce visual effects' });
  await reducedEffects.focus();
  await page.keyboard.press('Space');
  await page.locator('.world-map-canvas[data-effects="reduced"]').waitFor({ state: 'visible' });
  const calmMode = page.getByRole('checkbox', { name: 'Calm focus mode' });
  await calmMode.focus();
  await page.keyboard.press('Space');
  await page.locator('html.calm-mode').waitFor({ state: 'attached' });
  await inspection.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Settlement and society' }).waitFor({ state: 'visible' });
  await closeInspection.focus();
  await page.keyboard.press('Enter');

  await calmMode.focus();
  await page.keyboard.press('Space');
  await page.locator('html:not(.calm-mode)').waitFor({ state: 'attached' });
  await reducedEffects.focus();
  await page.keyboard.press('Space');
  await page.locator('.world-map-canvas[data-effects="full"]').waitFor({ state: 'visible' });
  const terrainOverlay = page.getByRole('radio', { name: 'Terrain' });
  await terrainOverlay.focus();
  await page.keyboard.press('Space');
  await page.locator('.world-map-canvas[data-overlay="terrain"]').waitFor({ state: 'visible' });
}

async function settleVisual(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolveFrame) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()));
      }),
  );
  // WebView2 can finish compositing a viewport one frame after DOM/layout stability,
  // especially when reduced-effects or root font scaling just changed.
  await page.waitForTimeout(500);
}

async function capture(
  page: Page,
  observations: CaptureObservation[],
  scenario: string,
  width: number,
  height: number,
  scalePercent: number,
  reduced = false,
): Promise<void> {
  await page.setViewportSize({ width, height });
  await setPresentation(page, scalePercent, reduced);
  // A real resize invalidates WebView2's complete compositor surface after effects-mode changes.
  // Without it, CDP can occasionally capture stale raster tiles even though the live DOM is stable.
  await page.setViewportSize({ width: Math.max(320, width - 1), height });
  await page.setViewportSize({ width, height });
  await page.evaluate(() => window.scrollTo(0, 0));
  await settleVisual(page);
  const filename = `${scenario}-${width}x${height}-${scalePercent}${reduced ? '-reduced' : ''}.png`;
  const file = resolve(outputDirectory, filename);
  await page.screenshot({ path: file });
  observations.push({
    camera: (await page.getByLabel('Camera position').innerText()).trim(),
    detail: await page.locator('.world-map-canvas').getAttribute('data-detail'),
    file,
    height,
    horizontalOverflow: await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
    scalePercent,
    scenario,
    width,
  });
}

mkdirSync(outputDirectory, { recursive: true });
const packages = reviewPackages();
const browser = await chromium.connectOverCDP(endpoint);
const context = browser.contexts()[0];
const page = context === undefined ? undefined : await waitForInstalledPlayerPage(context);
if (page === undefined)
  throw new Error('No Chrono Forge player WebView page was exposed over CDP.');

const observations: CaptureObservation[] = [];
try {
  await page.locator('.simulation-status').getByText('Worker projection ready').waitFor({
    state: 'visible',
    timeout: 30_000,
  });
  const interruptedSession = page.getByRole('button', { name: 'Complete focus' });
  if (await interruptedSession.isVisible()) {
    await interruptedSession.click();
    await page
      .getByText(/Session recorded with (?:a factual recap|an honest quiet interval)\./)
      .waitFor({
        state: 'visible',
      });
  }
  const newSession = page.getByRole('button', { name: 'New session' });
  if (await newSession.isVisible()) await newSession.click();
  const localSlot = page.getByRole('combobox', { name: 'Load local slot' });
  const foundingValue = await localSlot.locator('option').evaluateAll((options) => {
    const founding = options.find(
      (option) => (option as HTMLOptionElement).textContent?.trim() === 'Founding world',
    ) as HTMLOptionElement | undefined;
    return founding?.value ?? null;
  });
  if (foundingValue !== null && (await localSlot.inputValue()) !== foundingValue) {
    await localSlot.selectOption(foundingValue);
    await page.getByText('Loaded Founding world.').waitFor({ state: 'visible', timeout: 30_000 });
  }
  await page.getByLabel('Camera position').getByText('1.50×').waitFor({ state: 'visible' });
  await exerciseInstalledControls(page);
  await page.getByRole('button', { name: 'Overview' }).click();
  await capture(page, observations, 'founding-wide', 1440, 900, 100);
  await frameFirstObject(page);
  await capture(page, observations, 'founding-close', 1440, 900, 100);

  await page.getByRole('button', { name: 'Start focus' }).click();
  await page.waitForTimeout(1_200);
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('button', { name: 'Complete focus' }).click();
  await page
    .getByText(/Session recorded with (?:a factual recap|an honest quiet interval)\./)
    .waitFor({
      state: 'visible',
    });
  await page.getByRole('button', { name: 'Save now' }).click();
  await page.getByText('World saved manually.').waitFor({ state: 'visible' });

  await importPackage(page, packages.mature, 'Installed mature review');
  await page.getByRole('button', { name: 'Overview' }).click();
  await capture(page, observations, 'mature-wide', 1440, 900, 150);
  await frameFirstObject(page);
  await capture(page, observations, 'mature-close', 1440, 900, 100);

  await importPackage(page, packages.crisis, 'Installed crisis review');
  await page.getByRole('button', { name: 'Overview' }).click();
  await page.getByRole('radio', { name: 'Danger' }).check();
  await capture(page, observations, 'crisis-wide', 1440, 900, 100, true);
  await frameFirstObject(page);
  await capture(page, observations, 'crisis-close', 1440, 900, 100, true);

  await importPackage(page, m9Archives.midFlightPackage, 'M9 mid-flight');
  await page.getByRole('button', { name: 'Overview' }).click();
  await page.getByRole('radio', { name: 'Terrain' }).check();
  await capture(page, observations, 'advanced-wide', 1440, 900, 100);
  await frameFirstObject(page);
  await capture(page, observations, 'advanced-close', 1440, 900, 100);

  await importPackage(page, m9Archives.contactedPackage, 'M9 contacted world');
  await page.getByRole('button', { name: 'Overview' }).click();
  await capture(page, observations, 'space-wide', 1440, 900, 100);
  await frameFirstObject(page);
  await capture(page, observations, 'space-close', 1440, 900, 100);
  await capture(page, observations, 'space-narrow', 1024, 720, 200, true);

  if (observations.some((observation) => observation.horizontalOverflow)) {
    throw new Error('Installed review found viewport-wide horizontal overflow.');
  }
  writeFileSync(
    resolve(outputDirectory, 'observations.json'),
    `${JSON.stringify(observations, null, 2)}\n`,
    'utf8',
  );
  console.log(
    `Captured ${observations.length} installed-artifact observations at ${outputDirectory}.`,
  );
} finally {
  await browser.close();
}
