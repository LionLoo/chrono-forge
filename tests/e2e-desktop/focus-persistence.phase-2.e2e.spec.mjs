import { $, browser, expect } from '@wdio/globals';
import {
  advanceControlledClock,
  executeTauri,
  expectM10Migration,
  installActiveM9Archive,
  M9_E2E_ARCHIVES,
  openWorldInspection,
  reloadFrontendAfterArchiveChange,
  setControlledClock,
  settleVisibleSessionBeforeCleanup,
  waitForLoadedWorld,
} from './focus-persistence.helpers.mjs';

/* global describe, it */

describe('native focus persistence phase 2', () => {
  it('recovers, resumes, and completes the persisted paused focus session through real SQLite IPC', async () => {
    await $('#focus-title').waitForDisplayed();
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

    const startAtMs = 1_700_000_000_000;
    await setControlledClock(startAtMs + 10_000);
    await $('button=Resume').click();
    await advanceControlledClock(50_000);
    await $('button=Complete focus').click();
    await $('h4=Latest factual recap').waitForDisplayed();
    await browser.waitUntil(
      async () =>
        (await $('.persistence-status').getText()).includes(
          'Session recorded with a factual recap.',
        ),
      { timeoutMsg: 'completed focus session did not publish its factual recap' },
    );

    const allCompletedSessions = await executeTauri(({ core }) =>
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
    const completedCandidates = await executeTauri(({ core }) =>
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
  }).timeout(360_000);

  it('reloads an exact mid-flight M9 save through SQLite and the real Worker', async () => {
    await settleVisibleSessionBeforeCleanup();
    await $('button=Start focus').waitForDisplayed();

    const expectedMidFlight = JSON.parse(M9_E2E_ARCHIVES.midFlightPackage).snapshot;
    await installActiveM9Archive(M9_E2E_ARCHIVES.midFlightPackage);
    await reloadFrontendAfterArchiveChange();
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
    const candidates = await executeTauri(({ core }) =>
      core.invoke('load_save_slot_candidates', { slotId: 'm9-mid-flight' }),
    );
    expectM10Migration(candidates[0]?.snapshot, expectedMidFlight);
  });

  it('reloads an exact post-contact M9 save through SQLite and the real Worker', async () => {
    await settleVisibleSessionBeforeCleanup();
    await $('button=Start focus').waitForDisplayed();
    const expectedContacted = JSON.parse(M9_E2E_ARCHIVES.contactedPackage).snapshot;
    await installActiveM9Archive(M9_E2E_ARCHIVES.contactedPackage);
    await reloadFrontendAfterArchiveChange();
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
    const candidates = await executeTauri(({ core }) =>
      core.invoke('load_save_slot_candidates', { slotId: 'm9-contacted' }),
    );
    expectM10Migration(candidates[0]?.snapshot, expectedContacted);
  });
});
