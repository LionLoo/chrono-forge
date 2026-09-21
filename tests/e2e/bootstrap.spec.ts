import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { serializeWorldSnapshot } from '../../src/simulation/persistence';
import { createInitialWorld, stepWorld } from '../../src/simulation/world';
import { projectRelationshipPage } from '../../src/workers/simulation-runtime';
import { startProductionServer } from './static-server';

const M9_E2E_ARCHIVES = JSON.parse(
  readFileSync(new URL('../fixtures/saves/m9-e2e-archives.json', import.meta.url), 'utf8'),
) as Readonly<{
  midFlightPackage: string;
  contactedPackage: string;
}>;

async function importSavePackage(page: Page, savePackage: string, loadedName: string) {
  const importDetails = page.locator('details').filter({ hasText: 'Import or export package' });
  if ((await importDetails.getAttribute('open')) === null) {
    await importDetails.getByText('Import or export package').click();
  }
  await page.getByRole('textbox', { name: 'Import package' }).evaluate((element, value) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.bind(element)(
      value,
    );
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, savePackage);
  await page.getByRole('button', { name: 'Validate and import' }).click();
  await expect(page.getByText(`Loaded ${loadedName}.`)).toBeVisible({ timeout: 20_000 });
}

let origin: string;
let closeServer: () => Promise<void>;

function buildRelationshipArchive() {
  const world = stepWorld(
    createInitialWorld([7, 11, 13, 17], { societyYearTicks: 5_000 }),
    300_000,
  );
  for (const person of world.civilization.society.people) {
    const page = projectRelationshipPage(world, person.id, 0);
    const relationship = page.relationships.find(
      (candidate) => candidate.category === 'social' && candidate.sharedEvents.length > 0,
    );
    const hasFamily = page.relationships.some((candidate) => candidate.category === 'family');
    if (relationship === undefined || !hasFamily) continue;
    const snapshot = serializeWorldSnapshot(world);
    const otherId =
      relationship.firstPersonId === person.id
        ? relationship.secondPersonId
        : relationship.firstPersonId;
    const other = world.civilization.society.people.find((candidate) => candidate.id === otherId);
    if (other === undefined) throw new Error('Relationship archive has a dangling person.');
    return {
      personId: person.id,
      personName: person.name,
      otherName: other.name,
      relationshipId: relationship.id,
      relationshipKind: relationship.kind.replaceAll('-', ' '),
      eventSummary: relationship.sharedEvents[0]!.summary,
      savePackage: JSON.stringify({
        format: 'chrono-forge-save-export',
        version: 1,
        slotId: 'relationship-e2e',
        name: 'Relationship archive',
        snapshot,
        checksum: createHash('sha256').update(snapshot).digest('hex'),
      }),
    };
  }
  throw new Error('Locked M4.5 world did not expose a family-connected social relationship.');
}

test.beforeAll(async () => {
  const productionServer = await startProductionServer();
  origin = productionServer.origin;
  closeServer = productionServer.close;
});

test.afterAll(async () => {
  await closeServer();
});

test('production frontend renders a Worker-owned autonomous settlement', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-15T12:00:00Z') });
  await page.goto(origin);

  await expect(page).toHaveTitle('Chrono Forge');
  await expect(
    page.getByRole('heading', {
      name: 'Focus on your work while another world builds itself.',
    }),
  ).toBeVisible();
  await expect(page.locator('.simulation-status')).toContainText('Worker projection ready');
  await expect(page.getByRole('img', { name: /world map/ })).toBeVisible();
  await expect(page.getByText('Living people')).toBeVisible();
  await expect(page.getByLabel('Settlement stores')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Settlement and society' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open world inspection' }).click();
  const society = page.locator('.society-panel');
  await expect(society.getByRole('heading', { name: 'Settlement dashboard' })).toBeVisible();
  await expect(society.getByRole('combobox', { name: 'Inspect person' })).toBeVisible();
  await expect(society.getByRole('heading', { name: 'Cultures' })).toBeVisible();
  await expect(society.getByRole('heading', { name: 'Timeline' })).toBeVisible();
  await expect(society.getByText('The founding world formed.')).toBeVisible();

  await page.getByRole('radio', { name: 'Resources' }).check();
  await expect(page.locator('.world-map-canvas')).toHaveAttribute('data-overlay', 'resources');

  await page.getByRole('button', { name: 'Zoom world in' }).click();
  await expect(page.getByLabel('Camera position')).toContainText('1.20×');

  await page.getByRole('button', { name: 'Start focus' }).click();
  await page.clock.fastForward(10_000);
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('button', { name: 'Complete focus' }).click();
  await expect(page.getByText('Session recorded with a factual recap.')).toBeVisible();
  const logicalTick = page.locator('.world-metrics div').filter({ hasText: 'Logical tick' });
  await expect
    .poll(async () => Number(await logicalTick.locator('dd').textContent()))
    .toBeGreaterThanOrEqual(100);
  const firstFocusedTick = Number(await logicalTick.locator('dd').textContent());
  await expect(page.getByText('Active construction: 1 structure')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: /Construction progress/ })).toBeVisible();
  await expect(page.getByText('Shelter 1 was planned.', { exact: true }).first()).toBeVisible();

  const structure = page.getByRole('listitem', { name: /Shelter 1: status planned/ });
  await expect(structure).toContainText('condition 100% (sound); progress 0%');
  const savedStructure = await structure.innerText();
  await page.getByRole('button', { name: 'Save now' }).click();
  await expect(page.getByText('World saved manually.')).toBeVisible();
  await page.getByText('Create another slot').click();
  await page.getByRole('button', { name: 'Save as new slot' }).click();
  await expect(page.getByText('New save slot created.')).toBeVisible();
  await page.getByRole('button', { name: 'Start focus' }).click();
  await page.clock.fastForward(10_000);
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('button', { name: 'Complete focus' }).click();
  await expect(page.getByText('Session recorded with a factual recap.')).toBeVisible();
  await expect
    .poll(async () => Number(await logicalTick.locator('dd').textContent()))
    .toBeGreaterThan(firstFocusedTick);
  await page.getByRole('combobox', { name: 'Load local slot' }).selectOption('primary');
  await expect(logicalTick).toContainText(firstFocusedTick.toString());
  await expect(structure).toHaveText(savedStructure);
  await expect(page.getByText('Shelter 1 was planned.', { exact: true }).first()).toBeVisible();
});

test('society controls remain readable with reduced motion and 200% text', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(origin);
  await expect(page.locator('.simulation-status')).toContainText('Worker projection ready');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });

  await page.getByRole('button', { name: 'Open world inspection' }).click();
  await expect(page.getByRole('heading', { name: 'Settlement and society' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Inspect person' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Observe .* fixed ticks/ })).toHaveCount(0);
  await expect(
    page.getByText(/Only accepted focus time advances the live world directly/),
  ).toBeVisible();
  const zoom = page.getByRole('button', { name: 'Zoom world in' });
  expect(['0.01ms', '1e-05s']).toContain(
    await zoom.evaluate((element) => getComputedStyle(element).transitionDuration),
  );
});

test('primary world controls remain keyboard operable and unclipped from 100% through 200%', async ({
  page,
}) => {
  await page.goto(origin);
  await expect(page.locator('.simulation-status')).toContainText('Worker projection ready');

  const populationOverlay = page.getByRole('radio', { name: 'Population' });
  await populationOverlay.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.world-map-canvas')).toHaveAttribute('data-overlay', 'population');
  await expect(page.getByText(/Settlement population\. Pattern cue: rings\./)).toBeVisible();

  const zoom = page.getByRole('button', { name: 'Zoom world in' });
  await zoom.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Camera position')).toContainText('1.20×');

  const mapObject = page.getByRole('combobox', { name: 'Inspect map object' });
  await mapObject.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('article', { name: 'Selected map object' })).toBeVisible();

  const inspection = page.getByRole('button', { name: 'Open world inspection' });
  await inspection.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Settlement and society' })).toBeVisible();
  await page.getByRole('button', { name: 'Close world inspection' }).focus();
  await page.keyboard.press('Enter');

  const settings = page.getByText('Focus and accessibility settings', { exact: true });
  await settings.focus();
  await page.keyboard.press('Enter');
  const reducedEffects = page.getByRole('checkbox', { name: 'Reduce visual effects' });
  await reducedEffects.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.world-map-canvas')).toHaveAttribute('data-effects', 'reduced');
  await expect(page.getByText('Applies only while accepted focus time is running.')).toBeVisible();
  await expect(page.getByText('Changes the completion tone only.')).toBeVisible();

  const calmMode = page.getByRole('checkbox', { name: 'Calm focus mode' });
  await calmMode.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('heading', { name: 'Settlement and society' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open world inspection' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Settlement and society' })).toBeVisible();

  for (const scale of [100, 150, 200]) {
    await page.evaluate((percent) => {
      document.documentElement.style.fontSize = `${percent}%`;
    }, scale);
    await expect(page.getByRole('button', { name: 'Close world inspection' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Inspect person' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start focus' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
});

test('imports, inspects, saves, and reloads a relationship-rich world', async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = buildRelationshipArchive();
  await page.goto(origin);

  await page.getByText('Import or export package').click();
  await page.getByRole('textbox', { name: 'Import package' }).fill(fixture.savePackage);
  await page.getByRole('button', { name: 'Validate and import' }).click();
  await expect(page.getByText('Loaded Relationship archive.')).toBeVisible({ timeout: 20_000 });
  const localSlots = page.getByRole('combobox', { name: 'Load local slot' });
  await expect(localSlots.locator('option')).toHaveCount(2);
  await expect(localSlots).toHaveValue('relationship-e2e');

  await page.getByRole('button', { name: 'Open world inspection' }).click();
  const inspectPerson = page.getByRole('combobox', { name: 'Inspect person' });
  await inspectPerson.selectOption(String(fixture.personId));
  await expect(page.getByRole('heading', { name: fixture.personName })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Inspect relationship' })).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Inspect relationship' })
    .selectOption(fixture.relationshipId);
  const detail = page.getByRole('article', { name: 'Relationship detail' });
  await expect(detail).toContainText(`${fixture.personName} and ${fixture.otherName}`);
  await expect(detail).toContainText(fixture.relationshipKind);
  await expect(detail).toContainText(fixture.eventSummary);
  await expect(page.getByText('Factual biography')).toBeVisible();
  await expect(
    page.getByRole('region', { name: /Parents|Guardians|Children|Siblings/ }).first(),
  ).toBeVisible();

  for (const scale of [100, 150, 200]) {
    await page.evaluate((percent) => {
      document.documentElement.style.fontSize = `${percent}%`;
    }, scale);
    await expect(page.getByRole('article', { name: 'Relationship detail' })).toBeVisible();
    await expect(
      page.getByRole('region', { name: /Parents|Guardians|Children|Siblings/ }).first(),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '100%';
  });

  await page.getByRole('button', { name: 'Save now' }).click();
  await expect(page.getByText('World saved manually.')).toBeVisible();
  await expect(localSlots.locator('option')).toHaveCount(2);
  await localSlots.selectOption('primary');
  await expect(page.getByText('Loaded Founding world.')).toBeVisible();
  await expect(localSlots.locator('option')).toHaveCount(2);
  await localSlots.selectOption('relationship-e2e');
  await expect(page.getByText('Loaded Relationship archive.')).toBeVisible({ timeout: 20_000 });
  await inspectPerson.selectOption(String(fixture.personId));
  await page
    .getByRole('combobox', { name: 'Inspect relationship' })
    .selectOption(fixture.relationshipId);
  await expect(page.getByRole('article', { name: 'Relationship detail' })).toContainText(
    fixture.eventSummary,
  );
});

test('inspects and persists a Worker-owned mid-flight space world', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(origin);
  await importSavePackage(page, M9_E2E_ARCHIVES.midFlightPackage, 'M9 mid-flight');
  await page.getByRole('button', { name: 'Open world inspection' }).click();
  const space = page.locator('.space-panel');
  await expect(space.getByRole('heading', { name: 'The wider system' })).toBeVisible();
  await expect(space.locator('.space-body-list')).not.toContainText(/Body-\d+/);
  await expect(space.getByText('Autonomous program active')).toBeVisible();
  await expect(space.getByRole('list', { name: 'Space missions' })).toContainText('active');
  await page.getByRole('button', { name: 'Save now' }).click();
  await expect(page.getByText('World saved manually.')).toBeVisible();
  const localSlots = page.getByRole('combobox', { name: 'Load local slot' });
  await localSlots.selectOption('primary');
  await expect(page.getByText('Loaded Founding world.')).toBeVisible();
  await localSlots.selectOption('m9-mid-flight');
  await expect(page.getByText('Loaded M9 mid-flight.')).toBeVisible();
  await expect(
    page.locator('.space-panel').getByRole('list', { name: 'Space missions' }),
  ).toContainText('active');
});

test('inspects contacted space facts at 100-200% with reduced effects', async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(origin);
  await importSavePackage(page, M9_E2E_ARCHIVES.contactedPackage, 'M9 contacted world');
  await page.getByRole('button', { name: 'Open world inspection' }).click();
  await expect(page.locator('.space-body-list')).not.toContainText(/Body-\d+/);
  await expect(page.getByRole('list', { name: 'Alien civilizations' })).toContainText(
    /allied|cooperative|competitive|hostile/,
  );
  await expect(
    page.getByText(/Logistics: \d+ cargo and \d+ communications in transit/),
  ).toBeVisible();
  await page.getByText(/Logistics: \d+ cargo and \d+ communications in transit/).click();
  await expect(page.getByRole('list', { name: 'Interworld communications' })).toBeVisible();

  for (const scale of [100, 150, 200]) {
    await page.evaluate((percent) => {
      document.documentElement.style.fontSize = `${percent}%`;
    }, scale);
    await expect(page.getByRole('heading', { name: 'The wider system' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Alien civilizations' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.getByText('Focus and accessibility settings', { exact: true }).click();
  const reducedEffects = page.getByRole('checkbox', { name: 'Reduce visual effects' });
  if (!(await reducedEffects.isChecked())) await reducedEffects.check();
  await expect(page.locator('.world-map-canvas')).toHaveAttribute('data-effects', 'reduced');
});
