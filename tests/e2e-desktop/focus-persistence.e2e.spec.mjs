import { $, browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';

/* global CSSMediaRule, describe, document, it */

const M9_E2E_ARCHIVES = JSON.parse(
  readFileSync(new URL('../fixtures/saves/m9-e2e-archives.json', import.meta.url), 'utf8'),
);

async function clearIsolatedNativeArchive() {
  await browser.tauri.execute(async ({ core }) => {
    const slots = await core.invoke('list_save_slots');
    await Promise.all(slots.map(({ slotId }) => core.invoke('delete_save_slot', { slotId })));
  });
}

async function settleVisibleSessionBeforeCleanup() {
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

async function setControlledClock(epochMs) {
  await browser.execute((initialEpochMs) => {
    globalThis.__chronoForgeE2EClock = { now: initialEpochMs };
    Date.now = () => globalThis.__chronoForgeE2EClock?.now ?? initialEpochMs;
  }, epochMs);
}

async function advanceControlledClock(milliseconds) {
  await browser.execute((elapsedMilliseconds) => {
    if (globalThis.__chronoForgeE2EClock === undefined) {
      throw new Error('controlled clock was not installed');
    }
    globalThis.__chronoForgeE2EClock.now += elapsedMilliseconds;
  }, milliseconds);
}

async function openWorldInspection() {
  const open = await $('button=Open world inspection');
  if (await open.isExisting()) await open.click();
  await $('h2=Settlement and society').waitForDisplayed();
}

async function waitForLoadedWorld(name) {
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

async function installActiveM9Archive(savePackage) {
  return browser.tauri.execute(async ({ core }, packageText) => {
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

function expectM10Migration(actualSnapshot, legacySnapshot) {
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

describe('native focus persistence', () => {
  it('starts, pauses, saves, relaunches, resumes, and completes through real SQLite IPC', async () => {
    await $('#focus-title').waitForDisplayed();
    await $('span=SQLite archive').waitForDisplayed();
    await openWorldInspection();
    expect(await (await $('h2=Settlement and society')).isDisplayed()).toBe(true);
    expect(await (await $('select[aria-label="Inspect person"]')).isDisplayed()).toBe(true);
    expect(await (await $('h3=Timeline')).isDisplayed()).toBe(true);
    await settleVisibleSessionBeforeCleanup();
    await clearIsolatedNativeArchive();
    await browser.reloadSession();
    await browser.refresh();
    await $('button=Start focus').waitForDisplayed();
    await $('button=Save now').click();
    await browser.waitUntil(
      async () => (await $('.persistence-status').getText()).includes('World saved manually.'),
      { timeoutMsg: 'visible world was not recreated after isolated archive cleanup' },
    );
    await openWorldInspection();

    const hasReducedMotionRule = await browser.execute(() =>
      [...document.styleSheets].some((sheet) =>
        [...sheet.cssRules].some(
          (rule) =>
            rule instanceof CSSMediaRule &&
            rule.conditionText.includes('prefers-reduced-motion: reduce'),
        ),
      ),
    );
    expect(hasReducedMotionRule).toBe(true);
    await browser.execute(() => {
      document.documentElement.style.fontSize = '200%';
    });
    expect(await (await $('h2=Settlement and society')).isDisplayed()).toBe(true);
    expect(await (await $('select[aria-label="Inspect person"]')).isDisplayed()).toBe(true);
    expect(await (await $('button=Observe 100 fixed ticks')).isExisting()).toBe(false);
    await $('summary=Focus and accessibility settings').click();
    const reducedEffects = await $('//label[normalize-space() = "Reduce visual effects"]/input');
    if (!(await reducedEffects.isSelected())) await reducedEffects.click();
    expect(await reducedEffects.isSelected()).toBe(true);
    expect(
      await browser.execute(() => document.documentElement.classList.contains('reduced-effects')),
    ).toBe(true);
    const ambientSoundscape = await $('//label[normalize-space() = "Ambient soundscape"]/input');
    if (!(await ambientSoundscape.isSelected())) await ambientSoundscape.click();
    const soundEffects = await $('//label[normalize-space() = "Sound effects"]/input');
    if (!(await soundEffects.isSelected())) await soundEffects.click();
    const muteAllAudio = await $('//label[normalize-space() = "Mute all audio"]/input');
    if (await muteAllAudio.isSelected()) await muteAllAudio.click();
    await browser.execute(() => {
      const values = {
        'Master volume percent': '34',
        'Ambience volume percent': '18',
        'Effects volume percent': '27',
      };
      for (const [label, value] of Object.entries(values)) {
        const input = document.querySelector(`input[aria-label="${label}"]`);
        const setter =
          input === null
            ? undefined
            : Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
        if (input === null || input.tagName !== 'INPUT' || setter === undefined) {
          throw new Error(`missing audio slider: ${label}`);
        }
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    expect(await (await $('.audio-settings-status')).getText()).toContain(
      'Audio: master 34% · ambience 18% · effects 27%.',
    );
    expect(await (await $('button=Preview audio')).isEnabled()).toBe(true);
    const saveSettings = await $('button=Save settings');
    expect(await saveSettings.isEnabled()).toBe(true);
    await saveSettings.click();
    await browser.waitUntil(
      async () => {
        const status = await $('.persistence-status').getText();
        if (status.startsWith('Save fault:')) throw new Error(status);
        return status.includes('Settings saved locally.');
      },
      { timeoutMsg: 'reduced-effects setting did not persist' },
    );
    const persistedSettings = await browser.tauri.execute(({ core }) =>
      core.invoke('load_settings'),
    );
    expect(persistedSettings).toMatchObject({
      reducedEffects: true,
      audioMuted: false,
      ambienceEnabled: true,
      soundEnabled: true,
      volumePercent: 34,
      ambienceVolumePercent: 18,
      effectsVolumePercent: 27,
    });

    const startAtMs = 1_700_000_000_000;
    await setControlledClock(startAtMs);
    const customMinutes = await $('//label[normalize-space() = "Custom focus minutes"]/input');
    await customMinutes.setValue('1');
    await $('button=Start focus').click();
    await $('button=Pause').waitForDisplayed();

    await advanceControlledClock(10_000);
    await $('button=Pause').click();
    expect(await (await $('p=focus paused')).isDisplayed()).toBe(true);
    await $('button=Save now').click();
    let lastSaveStatus = '';
    let lastSessions = [];
    try {
      await browser.waitUntil(
        async () => {
          lastSaveStatus = await $('.persistence-status').getText();
          if (lastSaveStatus.startsWith('Save fault:')) throw new Error(lastSaveStatus);
          lastSessions = await browser.tauri.execute(({ core }) =>
            core.invoke('list_focus_sessions'),
          );
          return lastSessions.some(
            ({ session }) => session.slotId === 'primary' && session.status === 'paused',
          );
        },
        { timeoutMsg: 'manual save did not commit the paused session to SQLite' },
      );
    } catch (error) {
      const sessionSummary = lastSessions.map(({ session: { sessionId, slotId, status } }) => ({
        sessionId,
        slotId,
        status,
      }));
      throw new Error(
        `manual paused-session save failed; status=${JSON.stringify(lastSaveStatus)} sessions=${JSON.stringify(sessionSummary)}`,
        { cause: error },
      );
    }

    const allPausedSessions = await browser.tauri.execute(({ core }) =>
      core.invoke('list_focus_sessions'),
    );
    const pausedSessions = allPausedSessions
      .map(({ session }) => session)
      .filter((session) => session.slotId === 'primary');
    expect(pausedSessions).toHaveLength(1);
    expect(pausedSessions[0]).toMatchObject({ status: 'paused', focusedMs: 10_000 });
    const pausedCandidates = await browser.tauri.execute(({ core }) =>
      core.invoke('load_save_slot_candidates', { slotId: 'primary' }),
    );
    expect(pausedCandidates[0]?.focusSession).toMatchObject({
      sessionId: pausedSessions[0]?.sessionId,
      status: 'paused',
      focusedMs: 10_000,
    });

    await browser.reloadSession();
    await $('button=Resume').waitForDisplayed();
    await $('summary=Focus and accessibility settings').click();
    expect(await (await $('.audio-settings-status')).getText()).toContain(
      'Audio: master 34% · ambience 18% · effects 27%.',
    );
    expect(
      await (await $('//label[normalize-space() = "Ambient soundscape"]/input')).isSelected(),
    ).toBe(true);
    expect(await (await $('input[aria-label="Master volume percent"]')).getValue()).toBe('34');
    expect(await (await $('input[aria-label="Ambience volume percent"]')).getValue()).toBe('18');
    expect(await (await $('input[aria-label="Effects volume percent"]')).getValue()).toBe('27');
    await openWorldInspection();
    expect(await (await $('h2=Settlement and society')).isDisplayed()).toBe(true);
    expect(await (await $('select[aria-label="Inspect person"]')).isDisplayed()).toBe(true);
    expect(await (await $('p=focus paused')).isDisplayed()).toBe(true);

    await setControlledClock(startAtMs + 10_000);
    await $('button=Resume').click();
    await advanceControlledClock(50_000);
    await $('button=Complete focus').click();
    expect(await (await $('h4=Latest factual recap')).isDisplayed()).toBe(true);
    expect(await (await $('.persistence-status')).getText()).toContain(
      'Session recorded with a factual recap.',
    );

    const allCompletedSessions = await browser.tauri.execute(({ core }) =>
      core.invoke('list_focus_sessions'),
    );
    const completedSessions = allCompletedSessions
      .map(({ session }) => session)
      .filter((session) => session.slotId === 'primary');
    expect(completedSessions).toHaveLength(1);
    const completedSession = completedSessions[0];
    if (completedSession === undefined) throw new Error('completed focus session is unavailable');
    expect(completedSession).toMatchObject({ status: 'completed', focusedMs: 60_000 });
    expect(completedSession.review).toMatchObject({
      version: 1,
    });
    const completedRecord = allCompletedSessions.find(
      ({ session }) => session.sessionId === completedSession.sessionId,
    );
    expect(completedRecord?.checkpointGeneration).toBeGreaterThan(0);
    expect(completedRecord?.authoritySession).toEqual(completedSession);
    expect(completedSession.review.after.tick - completedSession.review.before.tick).toBe(600);
    const completedCandidates = await browser.tauri.execute(({ core }) =>
      core.invoke('load_save_slot_candidates', { slotId: 'primary' }),
    );
    const completedWorld = JSON.parse(completedCandidates[0]?.snapshot).payload;
    const eventsById = new Map(completedWorld.eventLog.map((event) => [event.id, event]));
    expect(completedSession.recapEntries).toEqual(
      completedSession.recapEventIds.map((eventId) => {
        const event = eventsById.get(eventId);
        return { id: event.id, tick: event.tick, summary: event.summary };
      }),
    );
    expect(completedSession.recapEventIds.length).toBeLessThanOrEqual(12);
    expect(
      completedSession.recapEventIds.every(
        (eventId) => eventId > completedSession.review.baselineEventId,
      ),
    ).toBe(true);
    if (completedSession.recapEntries.length === 0) {
      expect(
        await (await $('p=No major event was recorded during this session.')).isDisplayed(),
      ).toBe(true);
    } else {
      for (const entry of completedSession.recapEntries) {
        expect(await (await $(`li=${entry.summary}`)).isDisplayed()).toBe(true);
      }
    }
    const revisit = await $('//button[starts-with(normalize-space(), "Revisit ")]');
    await revisit.waitForDisplayed();
    await revisit.click();
    expect(await (await $('#map-inspector')).isFocused()).toBe(true);
    expect(completedCandidates[0]?.focusSession).toMatchObject({
      sessionId: completedSession.sessionId,
      status: 'completed',
      focusedMs: 60_000,
    });
  });

  it('relaunches an exact mid-flight M9 save through SQLite and the real Worker', async () => {
    // The embedded Windows driver retains its bootstrap WebView on the first session.
    // Establish a fresh session before changing the active native slot.
    await browser.reloadSession();
    await settleVisibleSessionBeforeCleanup();
    await $('button=Start focus').waitForDisplayed();

    const expectedMidFlight = JSON.parse(M9_E2E_ARCHIVES.midFlightPackage).snapshot;
    await installActiveM9Archive(M9_E2E_ARCHIVES.midFlightPackage);
    await browser.reloadSession();
    await browser.refresh();
    await waitForLoadedWorld('M9 mid-flight');
    await $('button=Open world inspection').waitForDisplayed();
    await openWorldInspection();
    const missionList = await $('ul[aria-label="Space missions"]');
    await missionList.waitForDisplayed();
    expect(await missionList.getText()).toContain('active');
    expect(await (await $('.space-body-list')).getText()).not.toMatch(/Body-\d+/);
    await $('button=Save now').click();
    await browser.waitUntil(
      async () => (await $('.persistence-status').getText()).includes('World saved manually.'),
      { timeoutMsg: 'mid-flight M9 save did not commit' },
    );
    const candidates = await browser.tauri.execute(({ core }) =>
      core.invoke('load_save_slot_candidates', { slotId: 'm9-mid-flight' }),
    );
    expectM10Migration(candidates[0]?.snapshot, expectedMidFlight);
  });

  it('relaunches an exact post-contact M9 save through SQLite and the real Worker', async () => {
    await settleVisibleSessionBeforeCleanup();
    await $('button=Start focus').waitForDisplayed();
    const expectedContacted = JSON.parse(M9_E2E_ARCHIVES.contactedPackage).snapshot;
    await installActiveM9Archive(M9_E2E_ARCHIVES.contactedPackage);
    await browser.reloadSession();
    await browser.refresh();
    await waitForLoadedWorld('M9 contacted world');
    await openWorldInspection();
    const alienList = await $('ul[aria-label="Alien civilizations"]');
    await alienList.waitForDisplayed();
    expect(await alienList.getText()).toMatch(/allied|cooperative|competitive|hostile/);
    expect(await (await $('.space-body-list')).getText()).not.toMatch(/Body-\d+/);
    expect(await (await $('.space-panel details summary')).getText()).toMatch(
      /Logistics: \d+ cargo and \d+ communications in transit/,
    );
    await $('button=Save now').click();
    await browser.waitUntil(
      async () => (await $('.persistence-status').getText()).includes('World saved manually.'),
      { timeoutMsg: 'post-contact M9 save did not commit' },
    );
    const candidates = await browser.tauri.execute(({ core }) =>
      core.invoke('load_save_slot_candidates', { slotId: 'm9-contacted' }),
    );
    expectM10Migration(candidates[0]?.snapshot, expectedContacted);
  });
});
