import { $, browser, expect } from '@wdio/globals';
import {
  advanceControlledClock,
  clearIsolatedNativeArchive,
  executeTauri,
  openWorldInspection,
  reloadFrontendAfterArchiveChange,
  setControlledClock,
  settleVisibleSessionBeforeCleanup,
} from './focus-persistence.helpers.mjs';

/* global CSSMediaRule, HTMLElement, HTMLSelectElement, PointerEvent, WheelEvent, describe, document, it, window */

function parseCameraReadout(readout) {
  const match = /^X (-?\d+) · Y (-?\d+) · ([\d.]+)×$/.exec(readout);
  if (match === null) throw new Error(`unexpected camera readout: ${readout}`);
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
}

async function setMapSelectionValue(value) {
  await browser.execute((nextValue) => {
    const select = document.querySelector('#map-inspector select');
    if (!(select instanceof HTMLSelectElement)) throw new Error('map selection is unavailable');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(
      select,
      nextValue,
    );
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await browser.waitUntil(async () => (await $('#map-inspector select').getValue()) === value, {
    timeoutMsg: `map selection did not settle to ${JSON.stringify(value)}`,
  });
}

describe('native focus persistence phase 1', () => {
  it('validates the initial native UI and persists a paused ten-second focus session through SQLite', async function () {
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
    if (selectedMapValue === null) throw new Error('native map has no selectable object');
    const firstMapSelection = selectedMapValue;

    const mapHost = await $('.world-map-canvas');
    await mapHost.waitForDisplayed();
    await mapHost.scrollIntoView({ block: 'center', inline: 'center' });
    await setMapSelectionValue('');
    const pointerDispatched = await browser.execute(() => {
      const host = document.querySelector('.world-map-canvas');
      const canvas = host?.querySelector('canvas');
      if (!(host instanceof HTMLElement) || !(canvas instanceof HTMLElement)) {
        throw new Error('world map canvas is unavailable');
      }
      const bounds = host.getBoundingClientRect();
      const clientX = bounds.left + bounds.width / 2;
      const clientY = bounds.top + bounds.height / 2;
      const originalSetPointerCapture = host.setPointerCapture;
      const originalHasPointerCapture = host.hasPointerCapture;
      const originalReleasePointerCapture = host.releasePointerCapture;
      host.setPointerCapture = () => undefined;
      host.hasPointerCapture = () => true;
      host.releasePointerCapture = () => undefined;
      try {
        const options = { bubbles: true, clientX, clientY, pointerId: 1 };
        canvas.dispatchEvent(new PointerEvent('pointerdown', options));
        canvas.dispatchEvent(new PointerEvent('pointerup', options));
      } finally {
        host.setPointerCapture = originalSetPointerCapture;
        host.hasPointerCapture = originalHasPointerCapture;
        host.releasePointerCapture = originalReleasePointerCapture;
      }
      return true;
    });
    expect(pointerDispatched).toBe(true);
    let pointerSelection = '';
    try {
      await browser.waitUntil(
        async () => {
          pointerSelection = await $('#map-inspector select').getValue();
          return pointerSelection === firstMapSelection;
        },
        { timeoutMsg: 'native pointer input did not select the centered factual map object' },
      );
    } catch (error) {
      throw new Error(
        `native pointer input missed the centered object; expected=${firstMapSelection} actual=${pointerSelection} camera=${JSON.stringify(parseCameraReadout(await $('.camera-readout').getText()))}`,
        { cause: error },
      );
    }

    const cameraReadout = await $('.camera-readout');
    const beforeWheel = parseCameraReadout(await cameraReadout.getText());
    const mapViewport = await browser.execute(() => {
      const host = document.querySelector('.world-map-canvas');
      if (!(host instanceof HTMLElement)) throw new Error('world map host is unavailable');
      return {
        anchorX: host.clientWidth / 2,
        anchorY: host.clientHeight / 2,
        scrollY: window.scrollY,
      };
    });
    const wheelPrevented = await browser.execute(() => {
      const host = document.querySelector('.world-map-canvas');
      if (!(host instanceof HTMLElement)) throw new Error('world map host is unavailable');
      const bounds = host.getBoundingClientRect();
      const wheel = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2,
        deltaY: 120,
      });
      host.dispatchEvent(wheel);
      return wheel.defaultPrevented;
    });
    expect(wheelPrevented).toBe(true);
    await browser.waitUntil(
      async () =>
        (await cameraReadout.getText()) !==
        `X ${beforeWheel.x} · Y ${beforeWheel.y} · ${beforeWheel.zoom.toFixed(2)}×`,
      { timeoutMsg: 'native wheel input did not change the map camera' },
    );
    const afterWheel = parseCameraReadout(await cameraReadout.getText());
    expect(afterWheel.zoom).toBeLessThan(beforeWheel.zoom);
    expect(
      Math.abs(
        (mapViewport.anchorX - beforeWheel.x) / beforeWheel.zoom -
          (mapViewport.anchorX - afterWheel.x) / afterWheel.zoom,
      ),
    ).toBeLessThan(1);
    expect(
      Math.abs(
        (mapViewport.anchorY - beforeWheel.y) / beforeWheel.zoom -
          (mapViewport.anchorY - afterWheel.y) / afterWheel.zoom,
      ),
    ).toBeLessThan(1);
    expect(await browser.execute(() => window.scrollY)).toBe(mapViewport.scrollY);

    await mapHost.click();
    expect(
      await browser.execute(() =>
        document.activeElement?.matches('.world-map-canvas[role="application"]'),
      ),
    ).toBe(true);
    await browser.keys(['ArrowRight']);
    await browser.waitUntil(
      async () => parseCameraReadout(await cameraReadout.getText()).x === afterWheel.x + 36,
      { timeoutMsg: 'native canvas keyboard input did not pan the map camera' },
    );
    const afterKeyboardPan = parseCameraReadout(await cameraReadout.getText());
    expect(afterKeyboardPan).toEqual({
      x: afterWheel.x + 36,
      y: afterWheel.y,
      zoom: afterWheel.zoom,
    });
    await setMapSelectionValue('');
    await browser.keys(['Enter']);
    await browser.waitUntil(
      async () => (await $('#map-inspector select').getValue()) === firstMapSelection,
      { timeoutMsg: 'native canvas keyboard input did not select the first factual map object' },
    );

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
        if (status.startsWith('Archive fault:')) throw new Error(status);
        return status.includes('Settings saved locally.');
      },
      { timeoutMsg: 'reduced-effects setting did not persist' },
    );
    const persistedSettings = await executeTauri(({ core }) => core.invoke('load_settings'));
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
          if (lastSaveStatus.startsWith('Archive fault:')) throw new Error(lastSaveStatus);
          lastSessions = await executeTauri(({ core }) => core.invoke('list_focus_sessions'));
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

    const allPausedSessions = await executeTauri(({ core }) => core.invoke('list_focus_sessions'));
    const pausedSessions = allPausedSessions
      .map(({ session }) => session)
      .filter((session) => session.slotId === 'primary');
    expect(pausedSessions).toHaveLength(1);
    expect(pausedSessions[0]).toMatchObject({ status: 'paused', focusedMs: 10_000 });
    const pausedCandidates = await executeTauri(({ core }) =>
      core.invoke('load_save_slot_candidates', { slotId: 'primary' }),
    );
    expect(pausedCandidates[0]?.focusSession).toMatchObject({
      sessionId: pausedSessions[0]?.sessionId,
      status: 'paused',
      focusedMs: 10_000,
    });
  }).timeout(360_000);
});
