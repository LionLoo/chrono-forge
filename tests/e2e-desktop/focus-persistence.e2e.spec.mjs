import { $, browser, expect } from '@wdio/globals';

/* global CSSMediaRule, describe, document, it */

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
    await $('button=Observe 100 fixed ticks').click();
    const firstStructure = await $('.structure-inspector li');
    await firstStructure.waitForDisplayed();
    // The embedded driver can retain the already-rendered world while this test
    // clears only the isolated SQLite archive. Require the accessible non-color
    // condition label without assuming the structure was just founded.
    expect(await firstStructure.getText()).toMatch(/condition \d+% \((sound|worn|critical)\)/);
    await $('summary=Focus and accessibility settings').click();
    const reducedEffects = await $('//label[normalize-space() = "Reduce visual effects"]/input');
    if (!(await reducedEffects.isSelected())) await reducedEffects.click();
    expect(await reducedEffects.isSelected()).toBe(true);
    expect(
      await browser.execute(() => document.documentElement.classList.contains('reduced-effects')),
    ).toBe(true);
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
    expect(persistedSettings).toMatchObject({ reducedEffects: true });

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
    await browser.waitUntil(
      async () => (await $('.persistence-status').getText()).includes('World saved manually.'),
      { timeoutMsg: 'manual save did not finish' },
    );

    const allPausedSessions = await browser.tauri.execute(({ core }) =>
      core.invoke('list_focus_sessions'),
    );
    const pausedSessions = allPausedSessions.filter((session) => session.slotId === 'primary');
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
    const completedSessions = allCompletedSessions.filter(
      (session) => session.slotId === 'primary',
    );
    expect(completedSessions).toHaveLength(1);
    expect(completedSessions[0]).toMatchObject({ status: 'completed', focusedMs: 60_000 });
    // This short test session crosses no event boundary; the recap must not
    // borrow founding or pre-session history to manufacture activity.
    expect(completedSessions[0]?.recapEventIds).toEqual([]);
    expect(completedSessions[0]?.recapEntries).toEqual([]);
    const completedCandidates = await browser.tauri.execute(({ core }) =>
      core.invoke('load_save_slot_candidates', { slotId: 'primary' }),
    );
    expect(completedCandidates[0]?.focusSession).toMatchObject({
      sessionId: completedSessions[0]?.sessionId,
      status: 'completed',
      focusedMs: 60_000,
    });
  });
});
