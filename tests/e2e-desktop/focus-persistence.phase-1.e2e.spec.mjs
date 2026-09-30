import { $, browser, expect } from '@wdio/globals';
import {
  advanceControlledClock,
  clearIsolatedNativeArchive,
  openWorldInspection,
  reloadFrontendAfterArchiveChange,
  setControlledClock,
  settleVisibleSessionBeforeCleanup,
} from './focus-persistence.helpers.mjs';

/* global CSSMediaRule, HTMLSelectElement, describe, document, it, window */

describe('native focus persistence phase 1', () => {
  it('validates the initial native UI and persists a paused ten-second focus session through SQLite', async function () {
    this.timeout(360_000);
    await $('#focus-title').waitForDisplayed();
    await $('span=SQLite archive').waitForDisplayed();
    for (const scale of [100, 150, 200]) {
      const layout = await browser.execute((percent) => {
        document.documentElement.style.fontSize = `${percent}%`;
        return {
          focusPresent: document.querySelector('#focus-title') !== null,
          mapPresent: document.querySelector('.world-map-canvas') !== null,
          noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        };
      }, scale);
      expect(layout).toEqual({ focusPresent: true, mapPresent: true, noHorizontalOverflow: true });
    }
    await browser.execute(() => {
      document.documentElement.style.fontSize = '100%';
    });
    await browser.waitUntil(
      async () => (await $('.simulation-status').getText()).includes('Worker projection ready'),
      { timeoutMsg: 'native world projection did not become ready for map framing' },
    );
    const worldDimensions = await browser.execute(
      () =>
        document.querySelector('.world-heading-status span:last-child')?.textContent?.trim() ?? '',
    );
    expect(['12 × 8', '96 × 64']).toContain(worldDimensions);
    const selectedMapValue = await browser.execute(() => {
      const select = document.querySelector('#map-inspector select');
      if (!(select instanceof HTMLSelectElement)) return null;
      const option = [...select.options].find((candidate) => candidate.value.length > 0);
      if (option === undefined) return null;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(
        select,
        option.value,
      );
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return option.value;
    });
    expect(selectedMapValue).not.toBeNull();
    const frameSelection = await $('button=Frame selection');
    await frameSelection.waitForExist();
    await frameSelection.click();
    const expectedFrameZoom = worldDimensions === '12 × 8' ? '8.00×' : '3.50×';
    expect(await (await $('.camera-readout')).getText()).toContain(expectedFrameZoom);
    await openWorldInspection();
    expect(await (await $('h2=Settlement and society')).isDisplayed()).toBe(true);
    expect(await (await $('select[aria-label="Inspect person"]')).isDisplayed()).toBe(true);
    expect(await (await $('h3=Timeline')).isDisplayed()).toBe(true);
    await settleVisibleSessionBeforeCleanup();
    await clearIsolatedNativeArchive();
    await reloadFrontendAfterArchiveChange();
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
  });
});
