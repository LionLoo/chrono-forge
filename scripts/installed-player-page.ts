import type { BrowserContext, Page } from '@playwright/test';

export function isInstalledPlayerPageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.hostname === 'tauri.localhost' &&
      (url.pathname === '/' || url.pathname === '/index.html') &&
      url.search === ''
    );
  } catch {
    return false;
  }
}

export function installedPlayerPage(context: BrowserContext): Page | undefined {
  return context.pages().find((candidate) => isInstalledPlayerPageUrl(candidate.url()));
}

export async function waitForInstalledPlayerPage(
  context: BrowserContext,
  timeoutMs = 30_000,
  pollIntervalMs = 50,
): Promise<Page | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const playerPage = installedPlayerPage(context);
    if (playerPage !== undefined) return playerPage;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return undefined;
    await new Promise<void>((resolve) =>
      globalThis.setTimeout(resolve, Math.min(pollIntervalMs, remainingMs)),
    );
  }
}
