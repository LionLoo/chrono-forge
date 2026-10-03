import { $, browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';

export const M9_E2E_ARCHIVES = JSON.parse(
  readFileSync(new URL('../fixtures/saves/m9-e2e-archives.json', import.meta.url), 'utf8'),
);

export async function executeTauri(script, ...args) {
  try {
    return await browser.tauri.execute(script, ...args);
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'TimeoutError' &&
      error.message === 'The operation was aborted due to timeout'
    ) {
      console.error('[native-e2e-infrastructure] tauri-direct-eval-timeout');
    }
    throw error;
  }
}

export async function clearIsolatedNativeArchive() {
  await executeTauri(async ({ core }) => {
    const slots = await core.invoke('list_save_slots');
    await Promise.all(slots.map(({ slotId }) => core.invoke('delete_save_slot', { slotId })));
  });
}

export async function settleVisibleSessionBeforeCleanup() {
  const cancel = await $('button=Cancel');
  if (await cancel.isDisplayed()) {
    await cancel.click();
    await browser.waitUntil(
      async () =>
        (await (await $('.persistence-status')).getText()).includes(
          'Session recorded with a factual recap.',
        ),
      { timeoutMsg: 'active cleanup session did not persist its cancellation' },
    );
  } else {
    const endBreak = await $('button=End break');
    if (await endBreak.isDisplayed()) {
      await endBreak.click();
      await browser.waitUntil(
        async () =>
          (await (await $('.persistence-status')).getText()).includes(
            'Session recorded with a factual recap.',
          ),
        { timeoutMsg: 'break cleanup session did not persist its completion' },
      );
    }
  }
  const newSession = await $('button=New session');
  if (await newSession.isDisplayed()) await newSession.click();
}

export async function setControlledClock(epochMs) {
  await browser.execute((initialEpochMs) => {
    globalThis.__chronoForgeE2EClock = { now: initialEpochMs };
    Date.now = () => globalThis.__chronoForgeE2EClock?.now ?? initialEpochMs;
  }, epochMs);
}

export async function advanceControlledClock(milliseconds) {
  await browser.execute((elapsedMilliseconds) => {
    if (globalThis.__chronoForgeE2EClock === undefined) {
      throw new Error('controlled clock was not installed');
    }
    globalThis.__chronoForgeE2EClock.now += elapsedMilliseconds;
  }, milliseconds);
}

export async function openWorldInspection() {
  const open = await $('button=Open world inspection');
  if (await open.isExisting()) await open.click();
  await $('h2=Settlement and society').waitForDisplayed();
}

export async function reloadFrontendAfterArchiveChange() {
  await browser.refresh();
  await $('#focus-title').waitForDisplayed();
}

export async function waitForLoadedWorld(name) {
  let lastStatus = '';
  try {
    await browser.waitUntil(
      async () => {
        lastStatus = await $('.persistence-status').getText();
        return lastStatus.includes(`Loaded ${name}.`);
      },
      { timeoutMsg: `${name} did not finish loading from SQLite` },
    );
  } catch (error) {
    throw new Error(`${name} did not finish loading from SQLite; last status: ${lastStatus}`, {
      cause: error,
    });
  }
}

export async function installActiveM9Archive(savePackage) {
  return executeTauri(async ({ core }, packageText) => {
    const imported = await core.invoke('import_save_slot', { package: packageText });
    const settings = await core.invoke('load_settings');
    await core.invoke('save_settings', {
      settings: {
        ...settings,
        activeSlotId: imported.slotId,
        offlineProgressionEnabled: false,
      },
    });
    return imported;
  }, savePackage);
}

export function expectM10Migration(actualSnapshot, legacySnapshot) {
  const actual = JSON.parse(actualSnapshot);
  const legacy = JSON.parse(legacySnapshot);
  expect(actual).toMatchObject({ contentVersion: 13, engineVersion: 13, formatVersion: 13 });
  const withoutSummary = (event) => {
    const copy = { ...event };
    delete copy.summary;
    return copy;
  };
  expect(actual.payload.eventLog.map(withoutSummary)).toEqual(
    legacy.payload.eventLog.map(withoutSummary),
  );
  for (const event of actual.payload.eventLog) {
    expect(event.summary).toMatch(/[.!?]$/);
    expect(event.summary.length).toBeGreaterThan(0);
    expect(event.summary.length).toBeLessThanOrEqual(160);
    expect(event.summary).not.toMatch(/\b(?:Body-\d+|undefined|null|NaN)\b/);
  }
  expect(actual.payload.space.bodies.map((body) => ({ ...body, name: undefined }))).toEqual(
    legacy.payload.space.bodies.map((body) => ({ ...body, name: undefined })),
  );
  expect(actual.payload.space.bodies.map((body) => body.name).join(' ')).not.toMatch(/Body-\d+/);
}
