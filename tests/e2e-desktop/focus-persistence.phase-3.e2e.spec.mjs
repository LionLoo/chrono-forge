import { $, browser, expect } from '@wdio/globals';
import { executeTauri } from './focus-persistence.helpers.mjs';

/* global describe, it */

const REGISTERED_COMMANDS = Object.freeze([
  'app_info',
  'commit_focus_checkpoint',
  'commit_save_slot',
  'confirm_semantically_valid_save_generation',
  'delete_save_slot',
  'export_save_generation',
  'import_save_slot',
  'list_focus_sessions',
  'list_save_slots',
  'load_save_slot_candidates',
  'load_save_slot_fallback_candidates',
  'load_settings',
  'record_focus_session',
  'save_settings',
]);

async function invokeOutcome(command, arguments_ = undefined) {
  return executeTauri(
    async ({ core }, commandName, commandArguments) => {
      try {
        return { ok: true, value: await core.invoke(commandName, commandArguments) };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    command,
    arguments_,
  );
}

describe('native focus persistence phase 3', () => {
  it('fails closed across the complete installed Tauri command boundary', async () => {
    await $('#focus-title').waitForDisplayed();
    await $('span=SQLite archive').waitForDisplayed();

    const invoked = new Set();
    const invoke = async (command, arguments_ = undefined) => {
      invoked.add(command);
      const outcome = await invokeOutcome(command, arguments_);
      if (!outcome.ok) throw new Error(`${command} failed unexpectedly: ${outcome.message}`);
      return outcome.value;
    };
    const reject = async (command, arguments_, expected) => {
      invoked.add(command);
      const outcome = await invokeOutcome(command, arguments_);
      expect(outcome.ok).toBe(false);
      expect(outcome.message).toMatch(expected);
    };
    const invokeWithPrimarySnapshot = async (command, arguments_) => {
      invoked.add(command);
      const outcome = await executeTauri(
        async ({ core }, commandName, commandArguments) => {
          try {
            const page = await core.invoke('load_save_slot_candidates', { slotId: 'primary' });
            const snapshot = page?.candidates[0]?.snapshot;
            if (typeof snapshot !== 'string') throw new Error('primary snapshot is unavailable');
            return {
              ok: true,
              value: await core.invoke(commandName, { ...commandArguments, snapshot }),
            };
          } catch (error) {
            return {
              ok: false,
              message: error instanceof Error ? error.message : String(error),
            };
          }
        },
        command,
        arguments_,
      );
      if (!outcome.ok) throw new Error(`${command} failed unexpectedly: ${outcome.message}`);
      return outcome.value;
    };
    const rejectWithPrimarySnapshot = async (command, arguments_, expected) => {
      invoked.add(command);
      const outcome = await executeTauri(
        async ({ core }, commandName, commandArguments) => {
          try {
            const page = await core.invoke('load_save_slot_candidates', { slotId: 'primary' });
            const snapshot = page?.candidates[0]?.snapshot;
            if (typeof snapshot !== 'string') throw new Error('primary snapshot is unavailable');
            return {
              ok: true,
              value: await core.invoke(commandName, { ...commandArguments, snapshot }),
            };
          } catch (error) {
            return {
              ok: false,
              message: error instanceof Error ? error.message : String(error),
            };
          }
        },
        command,
        arguments_,
      );
      expect(outcome.ok).toBe(false);
      expect(outcome.message).toMatch(expected);
    };

    expect(await invoke('app_info')).toEqual({
      name: 'Chrono Forge',
      version: '0.1.0',
      localFirst: true,
    });
    const initialSlots = await invoke('list_save_slots');
    expect(initialSlots.some(({ slotId }) => slotId === 'primary')).toBe(true);
    const primaryPage = await invoke('load_save_slot_candidates', { slotId: 'primary' });
    const primary = primaryPage?.candidates[0];
    if (primary === undefined) throw new Error('primary native checkpoint is unavailable');
    const initialHistory = await invoke('list_focus_sessions');
    const completedRecord = initialHistory.find(
      ({ session }) => session.slotId === 'primary' && session.status === 'completed',
    );
    if (completedRecord === undefined) throw new Error('completed native focus history is missing');
    const completedSession = completedRecord.session;
    const initialSettings = await invoke('load_settings');

    await reject('load_save_slot_candidates', { slotId: 'bad slot' }, /slot ID|letters|digits/i);
    await reject(
      'load_save_slot_fallback_candidates',
      { slotId: 'primary', beforeGeneration: 0 },
      /positive|generation/i,
    );
    await reject(
      'confirm_semantically_valid_save_generation',
      { slotId: 'primary', generation: 0, checksum: 'not-a-checksum' },
      /malformed|checksum|generation/i,
    );
    await reject(
      'export_save_generation',
      { slotId: 'primary', generation: 0 },
      /positive|generation/i,
    );
    await reject('delete_save_slot', { slotId: 'bad slot' }, /slot ID|letters|digits/i);
    await reject(
      'commit_save_slot',
      { slotId: 'ipc-probe', name: 'x'.repeat(121), snapshot: '{}' },
      /save name|120/i,
    );
    await reject('import_save_slot', { package: '{' }, /JSON|expected|key|EOF|parsing/i);
    const oversizedSnapshot = await executeTauri(async ({ core }) => {
      try {
        await core.invoke('commit_save_slot', {
          slotId: 'ipc-oversized-snapshot',
          name: 'Oversized snapshot',
          snapshot: 'x'.repeat(50 * 1_024 * 1_024 + 1),
        });
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    });
    expect(oversizedSnapshot.ok).toBe(false);
    expect(oversizedSnapshot.message).toMatch(/snapshot|50|limit|52428800/i);

    const firstProbeCommit = await invokeWithPrimarySnapshot('commit_save_slot', {
      slotId: 'ipc-probe',
      name: 'IPC probe',
    });
    expect(firstProbeCommit.headGeneration).toBe(1);
    const sourceWorld = JSON.parse(primary.snapshot).payload;
    const probeEvent = sourceWorld.eventLog.at(-1);
    if (probeEvent === undefined) throw new Error('primary snapshot has no factual source event');
    const probeSession = {
      ...completedSession,
      sessionId: 'ipc-probe-session',
      slotId: 'ipc-probe',
      recapEventIds: [probeEvent.id],
      recapEntries: [{ id: probeEvent.id, tick: probeEvent.tick, summary: probeEvent.summary }],
      review: null,
    };
    const checkpointCommit = await invokeWithPrimarySnapshot('commit_focus_checkpoint', {
      slotId: 'ipc-probe',
      name: 'IPC probe',
      session: probeSession,
    });
    expect(checkpointCommit.headGeneration).toBe(2);
    const previousProbePage = await invoke('load_save_slot_fallback_candidates', {
      slotId: 'ipc-probe',
      beforeGeneration: 2,
    });
    expect(previousProbePage?.nextBeforeGeneration).toBe(1);
    expect(previousProbePage?.candidates[0]).toMatchObject({
      headGeneration: 2,
      recoveredGeneration: 1,
      recoveredFromCorruption: true,
      checksum: firstProbeCommit.checksum,
      focusSession: null,
    });
    await invoke('confirm_semantically_valid_save_generation', {
      slotId: 'ipc-probe',
      generation: checkpointCommit.headGeneration,
      checksum: checkpointCommit.checksum,
    });
    invoked.add('export_save_generation');
    invoked.add('import_save_slot');
    const imported = await executeTauri(async ({ core }, generation) => {
      const exported = await core.invoke('export_save_generation', {
        slotId: 'ipc-probe',
        generation,
      });
      const envelope = JSON.parse(exported);
      envelope.slotId = 'ipc-import';
      envelope.name = 'IPC import';
      return core.invoke('import_save_slot', { package: JSON.stringify(envelope) });
    }, checkpointCommit.headGeneration);
    expect(imported).toMatchObject({ slotId: 'ipc-import', recoveredGeneration: 1 });
    expect(await invoke('delete_save_slot', { slotId: 'ipc-import' })).toBe(true);
    await invoke('record_focus_session', { session: probeSession });
    expect(await invoke('save_settings', { settings: initialSettings })).toEqual(initialSettings);
    await rejectWithPrimarySnapshot(
      'commit_focus_checkpoint',
      {
        slotId: 'ipc-interrupted-checkpoint',
        name: 'Interrupted checkpoint',
        session: {
          ...probeSession,
          sessionId: 'ipc-interrupted-session',
          slotId: 'ipc-interrupted-checkpoint',
        },
      },
      /injected commit failure|head update/i,
    );

    const primaryGeneration = primary.recoveredGeneration;
    const staleState = JSON.parse(completedSession.stateJson);
    const staleFocusedMs = Math.max(0, completedSession.focusedMs - 1_000);
    const tickNumerator = BigInt(staleFocusedMs) * BigInt(staleState.simulationTicksPerFocusSecond);
    staleState.phase = 'focus-paused';
    staleState.accumulatedFocusMs = staleFocusedMs;
    staleState.accumulatedBreakMs = 0;
    staleState.totalIssuedSimulationTicks = Number(tickNumerator / 1_000n);
    staleState.simulationTickRemainder = Number(tickNumerator % 1_000n);
    staleState.focusEndedAtEpochMs = null;
    staleState.breakStartedAtEpochMs = null;
    staleState.breakEndedAtEpochMs = null;
    staleState.endedAtEpochMs = null;
    staleState.activeSegmentStartedAtEpochMs = null;
    staleState.lastObservedEpochMs = completedSession.startedAtMs + staleFocusedMs;
    staleState.outcome = null;
    const staleSession = {
      ...completedSession,
      endedAtMs: null,
      focusedMs: staleFocusedMs,
      breakMs: 0,
      issuedSimulationTicks: staleState.totalIssuedSimulationTicks,
      status: 'paused',
      stateJson: JSON.stringify(staleState),
      recapEventIds: [],
      recapEntries: [],
      review: null,
    };
    await rejectWithPrimarySnapshot(
      'commit_focus_checkpoint',
      {
        slotId: 'primary',
        name: 'Primary world',
        session: staleSession,
      },
      /stale|immutable identity/i,
    );
    const recapRewrite = { ...probeSession, recapEventIds: [], recapEntries: [] };
    await reject('record_focus_session', { session: recapRewrite }, /stale|immutable identity/i);
    await rejectWithPrimarySnapshot(
      'commit_focus_checkpoint',
      { slotId: 'ipc-probe', name: 'IPC probe', session: recapRewrite },
      /stale|immutable identity/i,
    );
    const reviewRewrite = {
      ...completedSession,
      review: {
        ...completedSession.review,
        before: {
          ...completedSession.review.before,
          food: completedSession.review.before.food + 1,
        },
      },
    };
    await reject('record_focus_session', { session: reviewRewrite }, /stale|immutable identity/i);
    await rejectWithPrimarySnapshot(
      'commit_focus_checkpoint',
      { slotId: 'primary', name: 'Primary world', session: reviewRewrite },
      /stale|immutable identity/i,
    );
    await rejectWithPrimarySnapshot(
      'commit_focus_checkpoint',
      {
        slotId: 'ipc-cross-slot',
        name: 'Cross-slot probe',
        session: { ...completedSession, slotId: 'ipc-cross-slot' },
      },
      /stale|immutable identity/i,
    );

    const noncanonicalState = JSON.parse(probeSession.stateJson);
    noncanonicalState.unexpectedAuthority = true;
    await reject(
      'record_focus_session',
      {
        session: {
          ...probeSession,
          sessionId: 'ipc-noncanonical-session',
          stateJson: JSON.stringify(noncanonicalState),
        },
      },
      /supported fields|unknown field|focus state/i,
    );
    await reject(
      'record_focus_session',
      {
        session: {
          ...probeSession,
          sessionId: 'ipc-oversized-session',
          stateJson: ' '.repeat(65 * 1_024),
        },
      },
      /64|focus session|invalid|size/i,
    );
    await reject(
      'save_settings',
      { settings: { ...initialSettings, unexpectedAuthority: true } },
      /unknown field|unexpectedAuthority|settings/i,
    );

    const firstRecoveryCommit = await invokeWithPrimarySnapshot('commit_save_slot', {
      slotId: 'ipc-corrupt-recovery',
      name: 'IPC recovery',
    });
    expect(firstRecoveryCommit.headGeneration).toBe(1);
    const corruptedHeadReceipt = await invokeWithPrimarySnapshot('commit_save_slot', {
      slotId: 'ipc-corrupt-recovery',
      name: 'IPC recovery',
    });
    expect(corruptedHeadReceipt.headGeneration).toBe(2);
    await invoke('save_settings', {
      settings: { ...initialSettings, activeSlotId: 'ipc-corrupt-recovery' },
    });

    const primaryAfterFailures = await invoke('load_save_slot_candidates', { slotId: 'primary' });
    expect(primaryAfterFailures?.candidates[0]).toEqual(primary);
    expect(primaryAfterFailures?.candidates[0]?.recoveredGeneration).toBe(primaryGeneration);
    const slotsAfterFailures = await invoke('list_save_slots');
    expect(slotsAfterFailures.map(({ slotId }) => slotId)).toContain('ipc-probe');
    expect(slotsAfterFailures.map(({ slotId }) => slotId)).toContain('ipc-corrupt-recovery');
    expect(slotsAfterFailures.map(({ slotId }) => slotId)).not.toContain('ipc-cross-slot');
    expect(slotsAfterFailures.map(({ slotId }) => slotId)).not.toContain(
      'ipc-interrupted-checkpoint',
    );
    expect(slotsAfterFailures.map(({ slotId }) => slotId)).not.toContain('ipc-import');
    expect(slotsAfterFailures.map(({ slotId }) => slotId)).not.toContain('ipc-oversized-snapshot');
    const historyAfterFailures = await invoke('list_focus_sessions');
    expect(
      historyAfterFailures.find(({ session }) => session.sessionId === completedSession.sessionId)
        ?.session,
    ).toEqual(completedSession);
    expect(
      historyAfterFailures.find(({ session }) => session.sessionId === 'ipc-probe-session')
        ?.session,
    ).toEqual(probeSession);
    expect(
      historyAfterFailures.some(({ session }) =>
        ['ipc-interrupted-session', 'ipc-noncanonical-session', 'ipc-oversized-session'].includes(
          session.sessionId,
        ),
      ),
    ).toBe(false);

    const sqlOutcome = await invokeOutcome('execute_sql', { sql: 'SELECT 1' });
    expect(sqlOutcome.ok).toBe(false);
    expect(sqlOutcome.message).toMatch(/not found|unknown command/i);
    const fileOutcome = await invokeOutcome('read_file', { path: 'C:\\Windows\\win.ini' });
    expect(fileOutcome.ok).toBe(false);
    expect(fileOutcome.message).toMatch(/not found|unknown command/i);

    expect([...invoked].sort()).toEqual([...REGISTERED_COMMANDS].sort());

    // Closing the only native window terminates the embedded desktop process. The launcher then
    // starts a new process for phase 4, so recovery is proved across a cold application launch
    // rather than across two WebDriver sessions attached to one process.
    await browser.closeWindow();
  }).timeout(360_000);
});
