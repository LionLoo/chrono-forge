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

test('production frontend runs the deterministic world in its module worker', async ({ page }) => {
  await page.goto(origin);

  await expect(page).toHaveTitle('Chrono Forge');
  await expect(
    page.getByRole('heading', {
      name: 'Focus on your work while another world builds itself.',
    }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Worker synchronized · deterministic match');
  await expect(page.getByRole('img', { name: 'Generated Chrono Forge world' })).toBeVisible();

  const hashes = page.locator('.hash-panel code');
  await expect(hashes).toHaveCount(2);
  expect(await hashes.nth(0).textContent()).toBe(await hashes.nth(1).textContent());

  await page.getByRole('radio', { name: 'Resources' }).check();
  await expect(page.locator('.world-map-canvas')).toHaveAttribute('data-overlay', 'resources');

  await page.getByRole('button', { name: 'Zoom world in' }).click();
  await expect(page.getByLabel('Camera position')).toContainText('1.20×');

  await page.getByRole('button', { name: 'Advance 100 fixed ticks' }).click();
  await expect(
    page.locator('.world-metrics div').filter({ hasText: 'Logical tick' }),
  ).toContainText('100');
  await expect(page.getByRole('status')).toContainText('deterministic match');
  expect(await hashes.nth(0).textContent()).toBe(await hashes.nth(1).textContent());
});
