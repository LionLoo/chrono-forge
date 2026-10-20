import type { BrowserContext, Page } from '@playwright/test';

export function isInstalledPlayerPageUrl(value: string): boolean;

export function installedPlayerPage(context: BrowserContext): Page | undefined;

export function waitForInstalledPlayerPage(
  context: BrowserContext,
  timeoutMs?: number,
  pollIntervalMs?: number,
): Promise<Page | undefined>;
