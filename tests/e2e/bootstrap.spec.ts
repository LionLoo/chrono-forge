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

test('production frontend presents the honest repository foundation', async ({ page }) => {
  await page.goto(origin);

  await expect(page).toHaveTitle('Chrono Forge');
  await expect(
    page.getByRole('heading', {
      name: 'Focus on your work while another world builds itself.',
    }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Repository foundation active');
  await expect(page.getByLabel('Foundation systems')).toContainText(
    'Deterministic worker boundary',
  );
});
