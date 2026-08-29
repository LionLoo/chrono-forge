import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { serializeWorldSnapshot } from '../../src/simulation/persistence';
import { createInitialWorld, stepWorld } from '../../src/simulation/world';
import { projectRelationshipPage } from '../../src/workers/simulation-runtime';
import { startProductionServer } from './static-server';

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
  await page.goto(origin);

  await expect(page).toHaveTitle('Chrono Forge');
  await expect(
    page.getByRole('heading', {
      name: 'Focus on your work while another world builds itself.',
    }),
  ).toBeVisible();
  await expect(page.locator('.simulation-status')).toContainText('Worker projection ready');
  await expect(page.getByRole('img', { name: /Autonomous settlement map/ })).toBeVisible();
  await expect(page.getByText('Living people')).toBeVisible();
  await expect(page.getByLabel('Settlement stores')).toBeVisible();
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

  await page.getByRole('button', { name: 'Observe 100 fixed ticks' }).click();
  await expect(
    page.locator('.world-metrics div').filter({ hasText: 'Logical tick' }),
  ).toContainText('100');
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
  await page.getByRole('button', { name: 'Observe 100 fixed ticks' }).click();
  await expect(
    page.locator('.world-metrics div').filter({ hasText: 'Logical tick' }),
  ).toContainText('200');
  await page.getByRole('combobox', { name: 'Load local slot' }).selectOption('primary');
  await expect(
    page.locator('.world-metrics div').filter({ hasText: 'Logical tick' }),
  ).toContainText('100');
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

  await expect(page.getByRole('heading', { name: 'Settlement and society' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Inspect person' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Observe 100 fixed ticks' })).toBeVisible();
  await page.getByRole('button', { name: 'Observe 100 fixed ticks' }).click();
  await expect(page.getByText(/condition 100% \(sound\)/)).toBeVisible();
  expect(['0.01ms', '1e-05s']).toContain(
    await page
      .getByRole('button', { name: 'Observe 100 fixed ticks' })
      .evaluate((element) => getComputedStyle(element).transitionDuration),
  );
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
