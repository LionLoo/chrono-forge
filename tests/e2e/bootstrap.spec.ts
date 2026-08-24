import { expect, test } from '@playwright/test';
import { startProductionServer } from './static-server';

let origin: string;
let closeServer: () => Promise<void>;

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
