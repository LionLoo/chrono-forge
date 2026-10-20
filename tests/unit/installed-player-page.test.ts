import type { BrowserContext, Page } from '@playwright/test';

import {
  isInstalledPlayerPageUrl,
  waitForInstalledPlayerPage,
} from '../../scripts/installed-player-page.mjs';

describe('installed player WebView selection', () => {
  it.each([
    'http://tauri.localhost/',
    'http://tauri.localhost/index.html',
    'https://tauri.localhost/',
    'https://tauri.localhost/index.html',
  ])('accepts the player page %s', (url) => {
    expect(isInstalledPlayerPageUrl(url)).toBe(true);
  });

  it.each([
    'http://tauri.localhost/index.html?persistence-broker=1',
    'http://tauri.localhost/?persistence-broker=1',
    'http://example.com/',
    'not a url',
  ])('rejects a non-player page %s', (url) => {
    expect(isInstalledPlayerPageUrl(url)).toBe(false);
  });

  it('waits for the main WebView to navigate away from its initial blank page', async () => {
    vi.useFakeTimers();
    try {
      let url = 'about:blank';
      const page = { url: () => url } as Page;
      const context = { pages: () => [page] } as BrowserContext;
      const selection = waitForInstalledPlayerPage(context, 1_000, 50);

      url = 'http://tauri.localhost/';
      await vi.advanceTimersByTimeAsync(50);

      await expect(selection).resolves.toBe(page);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns no page after the bounded startup wait expires', async () => {
    vi.useFakeTimers();
    try {
      const page = { url: () => 'about:blank' } as Page;
      const context = { pages: () => [page] } as BrowserContext;
      const selection = waitForInstalledPlayerPage(context, 100, 25);

      await vi.advanceTimersByTimeAsync(100);

      await expect(selection).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
