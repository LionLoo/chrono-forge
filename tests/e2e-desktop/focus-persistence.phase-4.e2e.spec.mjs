import { $, browser, expect } from '@wdio/globals';
import { executeTauri } from './focus-persistence.helpers.mjs';

/* global describe, it */

describe('native focus persistence phase 4', () => {
  it('recovers the exact valid head and history after relaunching from rejected IPC requests', async () => {
    await $('#focus-title').waitForDisplayed();
    await $('span=SQLite archive').waitForDisplayed();
    const archivePanel = $('.archive-panel');
    try {
      await archivePanel.waitForDisplayed();
    } catch (error) {
      const alert = $('p[role="alert"]');
      const status = $('p[role="status"]');
      const detail = (await alert.isExisting())
        ? await alert.getText()
        : (await status.isExisting())
          ? await status.getText()
          : 'no persistence diagnostic was rendered';
      throw new Error(`the installed archive did not open: ${detail}`, { cause: error });
    }
    const slotPicker = $('.archive-panel select');
    let activeSlot = '';
    try {
      await browser.waitUntil(
        async () => {
          activeSlot = String(await slotPicker.getValue());
          return activeSlot === 'ipc-corrupt-recovery';
        },
        { timeoutMsg: 'the recovered IPC slot did not become the active installed-app world' },
      );
    } catch (error) {
      throw new Error(`the recovered IPC slot was not active; rendered slot: ${activeSlot}`, {
        cause: error,
      });
    }
    expect(await $('.archive-panel p').getText()).toMatch(
      /Active slot: IPC recovery · generation 1/,
    );

    const evidence = await executeTauri(async ({ core }) => {
      const slots = await core.invoke('list_save_slots');
      const primary = await core.invoke('load_save_slot_candidates', { slotId: 'primary' });
      const probe = await core.invoke('load_save_slot_candidates', { slotId: 'ipc-probe' });
      const corruptHead = await core.invoke('load_save_slot_candidates', {
        slotId: 'ipc-corrupt-recovery',
      });
      const recovered = await core.invoke('load_save_slot_fallback_candidates', {
        slotId: 'ipc-corrupt-recovery',
        beforeGeneration: corruptHead.nextBeforeGeneration,
      });
      const history = await core.invoke('list_focus_sessions');
      const settings = await core.invoke('load_settings');
      return { slots, primary, probe, corruptHead, recovered, history, settings };
    });

    expect(evidence.slots.map(({ slotId }) => slotId)).toContain('primary');
    expect(evidence.slots.map(({ slotId }) => slotId)).toContain('ipc-probe');
    expect(evidence.slots.map(({ slotId }) => slotId)).toContain('ipc-corrupt-recovery');
    expect(evidence.slots.map(({ slotId }) => slotId)).not.toContain('ipc-cross-slot');
    expect(evidence.slots.map(({ slotId }) => slotId)).not.toContain('ipc-import');
    expect(evidence.primary?.candidates[0]?.focusSession).toMatchObject({
      slotId: 'primary',
      status: 'completed',
    });
    expect(evidence.corruptHead).toMatchObject({ candidates: [], nextBeforeGeneration: 2 });
    expect(evidence.recovered?.candidates[0]).toMatchObject({
      slotId: 'ipc-corrupt-recovery',
      headGeneration: 2,
      recoveredGeneration: 1,
      recoveredFromCorruption: true,
      focusSession: null,
      checksum: evidence.primary?.candidates[0]?.checksum,
      snapshot: evidence.primary?.candidates[0]?.snapshot,
    });
    expect(evidence.probe?.candidates[0]).toMatchObject({
      recoveredGeneration: 2,
      focusSession: {
        sessionId: 'ipc-probe-session',
        slotId: 'ipc-probe',
        status: 'completed',
      },
    });
    const probeRecord = evidence.history.find(
      ({ session }) => session.sessionId === 'ipc-probe-session',
    );
    expect(probeRecord).toMatchObject({
      session: { slotId: 'ipc-probe', status: 'completed' },
      checkpointGeneration: 2,
    });
    expect(probeRecord?.authoritySession).toEqual(probeRecord?.session);
    expect(evidence.settings).toMatchObject({ activeSlotId: 'ipc-corrupt-recovery' });

    const cleanup = await executeTauri(async ({ core }) => {
      const settings = await core.invoke('load_settings');
      await core.invoke('save_settings', {
        settings: { ...settings, activeSlotId: 'm9-contacted' },
      });
      return {
        probe: await core.invoke('delete_save_slot', { slotId: 'ipc-probe' }),
        recovery: await core.invoke('delete_save_slot', { slotId: 'ipc-corrupt-recovery' }),
      };
    });
    expect(cleanup).toEqual({ probe: true, recovery: true });
    const finalSlots = await executeTauri(async ({ core }) => core.invoke('list_save_slots'));
    expect(finalSlots.map(({ slotId }) => slotId)).not.toContain('ipc-probe');
    expect(finalSlots.map(({ slotId }) => slotId)).not.toContain('ipc-corrupt-recovery');
    expect(finalSlots.map(({ slotId }) => slotId)).toContain('primary');
  }).timeout(180_000);
});
