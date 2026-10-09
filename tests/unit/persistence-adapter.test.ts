import { createHash } from 'node:crypto';

import {
  DEFAULT_APP_SETTINGS,
  createInMemoryPersistenceGateway,
  createTauriPersistenceGateway,
  type FocusSession,
  type LoadedSave,
  type TauriInvoke,
} from '../../src/adapters/persistence';
import { checkpointFocus, completeFocus, createIdleFocusState, startFocus } from '../../src/focus';
import { projectFocusCheckpoint } from '../../src/focus/session-review';
import { hashCanonicalJson } from '../../src/simulation/canonical';
import { deserializeWorldSnapshot, serializeWorldSnapshot } from '../../src/simulation/persistence';
import { createInitialWorld, stepWorld } from '../../src/simulation/world';
import { focusSessionFromState } from '../../src/ui/useFocusController';

const ticksByName: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  other: 5,
};
const snapshot = (value: string): string =>
  serializeWorldSnapshot(
    stepWorld(
      createInitialWorld([1, 2, 3, 4], { width: 2, height: 2, chunkSize: 2 }),
      ticksByName[value] ?? 0,
    ),
  );
const checksumOf = (value: string): string => createHash('sha256').update(value).digest('hex');
const snapshotOneChecksum = checksumOf(snapshot('one'));

function versionTwelveSnapshotWithLegacySummary(): string {
  const envelope = JSON.parse(snapshot('one')) as {
    checksum: string;
    contentVersion: number;
    engineVersion: number;
    formatVersion: number;
    payload: { eventLog: { summary: string }[] };
  };
  envelope.contentVersion = 12;
  envelope.engineVersion = 12;
  envelope.formatVersion = 12;
  envelope.payload.eventLog[0]!.summary = 'Recorded world-generated.';
  envelope.checksum = hashCanonicalJson(JSON.stringify(envelope.payload));
  return JSON.stringify(envelope);
}

const completedFocusState = checkpointFocus(
  startFocus(
    createIdleFocusState(),
    { focusDurationMs: 100, breakDurationMs: 20, simulationTicksPerFocusSecond: 100 },
    100,
  ),
  220,
);

const completedSession: FocusSession = {
  sessionId: 'session-1',
  slotId: 'alpha',
  startedAtMs: 100,
  endedAtMs: 220,
  plannedFocusMs: 100,
  focusedMs: 100,
  plannedBreakMs: 20,
  breakMs: 20,
  issuedSimulationTicks: 10,
  status: 'completed',
  stateJson: JSON.stringify(completedFocusState),
  recapEventIds: [1],
  recapEntries: [{ id: 1, tick: 0, summary: 'The founding world formed.' }],
};

function nativeFocusRecord(
  session: FocusSession,
  authoritySession: FocusSession | null = null,
  checkpointGeneration: number | null = null,
) {
  return { session, authoritySession, checkpointGeneration };
}

function nativeSaveCandidatePage(
  candidates: readonly unknown[],
  nextBeforeGeneration: number | null = null,
) {
  return { candidates, nextBeforeGeneration };
}

describe('persistence adapter', () => {
  it('upgrades matching pre-v13 focus recap copies with their authoritative world summaries', async () => {
    const legacySnapshot = versionTwelveSnapshotWithLegacySummary();
    const legacySession = {
      ...completedSession,
      recapEntries: [{ id: 1, tick: 0, summary: 'Recorded world-generated.' }],
    };
    const invoke: TauriInvoke = async (command) => {
      await Promise.resolve();
      if (command !== 'load_save_slot_candidates') throw new Error(`unexpected ${command}`);
      return nativeSaveCandidatePage(
        [
          {
            slotId: 'alpha',
            name: 'Alpha',
            headGeneration: 1,
            recoveredGeneration: 1,
            recoveredFromCorruption: false,
            savedAtMs: 1_000,
            focusSession: legacySession,
            snapshot: legacySnapshot,
            checksum: checksumOf(legacySnapshot),
          },
        ],
        1,
      ) as never;
    };

    const loaded = await createTauriPersistenceGateway(invoke).loadSaveSlot('alpha');

    expect(loaded?.focusSession?.recapEntries).toEqual([
      { id: 1, tick: 0, summary: deserializeWorldSnapshot(legacySnapshot).eventLog[0]!.summary },
    ]);
  });

  it('does not use legacy migration to conceal a tampered focus recap copy', async () => {
    const legacySnapshot = versionTwelveSnapshotWithLegacySummary();
    const invoke: TauriInvoke = async () => {
      await Promise.resolve();
      return nativeSaveCandidatePage(
        [
          {
            slotId: 'alpha',
            name: 'Alpha',
            headGeneration: 1,
            recoveredGeneration: 1,
            recoveredFromCorruption: false,
            savedAtMs: 1_000,
            focusSession: {
              ...completedSession,
              recapEntries: [{ id: 1, tick: 0, summary: 'Invented recap.' }],
            },
            snapshot: legacySnapshot,
            checksum: checksumOf(legacySnapshot),
          },
        ],
        1,
      ) as never;
    };

    await expect(createTauriPersistenceGateway(invoke).loadSaveSlot('alpha')).rejects.toThrow(
      'exactly match authoritative saved-world events',
    );
  });

  it('hides plausible focus-history prose that does not match retained world authority', async () => {
    const invoke: TauriInvoke = async (command) => {
      await Promise.resolve();
      if (command === 'list_focus_sessions') {
        return [
          nativeFocusRecord({
            ...completedSession,
            recapEntries: [
              { id: 1, tick: 0, summary: 'A fabricated narrative passed validation.' },
            ],
          }),
        ] as never;
      }
      if (command === 'load_save_slot_candidates') {
        return nativeSaveCandidatePage(
          [
            {
              slotId: 'alpha',
              name: 'Alpha',
              headGeneration: 1,
              recoveredGeneration: 1,
              recoveredFromCorruption: false,
              savedAtMs: 1_000,
              focusSession: null,
              snapshot: snapshot('one'),
              checksum: snapshotOneChecksum,
            },
          ],
          1,
        ) as never;
      }
      throw new Error(`unexpected ${command}`);
    };

    const gateway = createTauriPersistenceGateway(invoke);
    const sourceSave = await gateway.loadSaveSlot('alpha');
    await expect(gateway.listFocusSessions(sourceSave ?? undefined)).resolves.toEqual([
      { ...completedSession, recapEntries: [] },
    ]);
  });

  it('ignores fabricated quiet-history review facts unless the exact checkpoint proves them', async () => {
    const beforeWorld = createInitialWorld([1, 2, 3, 4], {
      width: 2,
      height: 2,
      chunkSize: 2,
    });
    const afterWorld = stepWorld(beforeWorld, 1);
    const baseline = projectFocusCheckpoint(beforeWorld, null);
    const checkpoint = projectFocusCheckpoint(afterWorld, baseline.latestEventId);
    expect(checkpoint.recapEntries).toEqual([]);
    const completedState = completeFocus(
      startFocus(
        createIdleFocusState(),
        { focusDurationMs: 100, breakDurationMs: 0, simulationTicksPerFocusSecond: 10 },
        100,
      ),
      200,
    );
    const authoritativeSession: FocusSession = {
      ...focusSessionFromState('quiet-review', 'alpha', completedState, []),
      recapEntries: [],
      review: {
        version: 1,
        baselineEventId: baseline.latestEventId,
        before: baseline.moment,
        after: checkpoint.moment,
        revisitTarget: checkpoint.revisitTarget,
      },
    };
    const fabricatedHistory: FocusSession = {
      ...authoritativeSession,
      review: {
        ...authoritativeSession.review!,
        after: {
          ...authoritativeSession.review!.after,
          food: authoritativeSession.review!.after.food + 1,
        },
        revisitTarget: {
          kind: 'settlement',
          id: 999,
          label: 'Invented settlement',
          sourceEventId: null,
        },
      },
    };
    const sourceSnapshot = serializeWorldSnapshot(afterWorld);
    const sourceSave: LoadedSave = {
      slotId: 'alpha',
      name: 'Alpha',
      headGeneration: 2,
      recoveredGeneration: 2,
      recoveredFromCorruption: false,
      savedAtMs: 2_000,
      focusSession: authoritativeSession,
      snapshot: sourceSnapshot,
      checksum: checksumOf(sourceSnapshot),
    };
    const gateway = createTauriPersistenceGateway(async (command) => {
      await Promise.resolve();
      if (command === 'list_focus_sessions') {
        return [nativeFocusRecord(fabricatedHistory, authoritativeSession, 2)] as never;
      }
      throw new Error(`unexpected ${command}`);
    });

    await expect(gateway.listFocusSessions(sourceSave)).resolves.toEqual([authoritativeSession]);
    await expect(gateway.listFocusSessions({ ...sourceSave, focusSession: null })).resolves.toEqual(
      [authoritativeSession],
    );

    const unverifiedGateway = createTauriPersistenceGateway(async () => {
      await Promise.resolve();
      return [nativeFocusRecord(fabricatedHistory)] as never;
    });
    await expect(
      unverifiedGateway.listFocusSessions({ ...sourceSave, focusSession: null }),
    ).resolves.toEqual([{ ...fabricatedHistory, review: null }]);

    const previewGateway = createInMemoryPersistenceGateway(() => 3_000);
    await previewGateway.commitFocusCheckpoint(
      'alpha',
      'Alpha',
      sourceSnapshot,
      authoritativeSession,
      [],
    );
    const rewrittenReview: FocusSession = {
      ...authoritativeSession,
      review: {
        ...authoritativeSession.review!,
        before: {
          ...authoritativeSession.review!.before,
          food: authoritativeSession.review!.before.food + 1,
        },
      },
    };
    await expect(
      previewGateway.commitFocusCheckpoint('alpha', 'Alpha', sourceSnapshot, rewrittenReview, []),
    ).rejects.toThrow(/stale|immutable identity/i);
    await expect(previewGateway.recordFocusSession(rewrittenReview, [])).rejects.toThrow(
      /stale|immutable identity/i,
    );
    await previewGateway.commitSaveSlot('alpha', 'Alpha', snapshot('two'));
    await previewGateway.commitSaveSlot('alpha', 'Alpha', snapshot('three'));
    const laterAlpha = await previewGateway.commitSaveSlot('alpha', 'Alpha', snapshot('four'));
    await expect(previewGateway.listFocusSessions(laterAlpha)).resolves.toEqual([
      authoritativeSession,
    ]);

    const beta = await previewGateway.commitSaveSlot('beta', 'Beta', snapshot('other'));
    await expect(previewGateway.listFocusSessions(beta)).resolves.toEqual([
      { ...authoritativeSession, review: null },
    ]);
    await expect(
      previewGateway.listFocusSessions((await previewGateway.loadSaveSlot('alpha'))!),
    ).resolves.toEqual([authoritativeSession]);
  });

  it('accepts exact Worker checkpoint evidence and rejects a mismatched fast-path projection', async () => {
    const beforeWorld = createInitialWorld([1, 2, 3, 4], {
      width: 2,
      height: 2,
      chunkSize: 2,
    });
    const afterWorld = stepWorld(beforeWorld, 1);
    const baseline = projectFocusCheckpoint(beforeWorld, null);
    const checkpoint = projectFocusCheckpoint(afterWorld, baseline.latestEventId);
    const completedState = completeFocus(
      startFocus(
        createIdleFocusState(),
        { focusDurationMs: 100, breakDurationMs: 0, simulationTicksPerFocusSecond: 10 },
        100,
      ),
      200,
    );
    const session: FocusSession = {
      ...focusSessionFromState('worker-authority', 'alpha', completedState, []),
      recapEntries: checkpoint.recapEntries,
      review: {
        version: 1,
        baselineEventId: baseline.latestEventId,
        before: baseline.moment,
        after: checkpoint.moment,
        revisitTarget: checkpoint.revisitTarget,
      },
    };
    const sourceSnapshot = serializeWorldSnapshot(afterWorld);
    const gateway = createInMemoryPersistenceGateway(() => 3_000);

    const committed = await gateway.commitFocusCheckpoint(
      'alpha',
      'Alpha',
      sourceSnapshot,
      session,
      [],
      { baselineEventId: baseline.latestEventId, checkpoint },
    );

    await expect(gateway.listFocusSessions(committed)).resolves.toEqual([session]);
    await expect(
      gateway.commitFocusCheckpoint('alpha', 'Alpha', sourceSnapshot, session, [], {
        baselineEventId: baseline.latestEventId,
        checkpoint: {
          ...checkpoint,
          moment: { ...checkpoint.moment, food: checkpoint.moment.food + 1 },
        },
      }),
    ).rejects.toThrow('authoritative Worker checkpoint');

    const malformedEnvelope = JSON.parse(sourceSnapshot) as {
      payload: { config: { width: number } };
    };
    malformedEnvelope.payload.config.width = 0;
    await expect(
      gateway.commitFocusCheckpoint(
        'alpha',
        'Alpha',
        JSON.stringify(malformedEnvelope),
        session,
        [],
        { baselineEventId: baseline.latestEventId, checkpoint },
      ),
    ).rejects.toThrow();
    await expect(gateway.loadSaveSlot('alpha')).resolves.toMatchObject({
      headGeneration: 1,
      snapshot: sourceSnapshot,
    });
  });

  it('verifies recap prose against one supplied active save without loading historical slots', async () => {
    const calls: string[] = [];
    const alphaSessions = Array.from({ length: 64 }, (_, index): FocusSession => ({
      ...completedSession,
      sessionId: `session-alpha-${index}`,
    }));
    const betaSession: FocusSession = {
      ...completedSession,
      sessionId: 'session-2',
      slotId: 'beta',
    };
    const invoke: TauriInvoke = async (command) => {
      await Promise.resolve();
      calls.push(command);
      if (command === 'list_focus_sessions') {
        return [...alphaSessions, betaSession].map((session) =>
          nativeFocusRecord(session),
        ) as never;
      }
      throw new Error(`unexpected ${command}`);
    };
    const sourceSnapshot = snapshot('one');
    let snapshotReads = 0;
    const sourceSave: LoadedSave = {
      slotId: 'alpha',
      name: 'Alpha',
      headGeneration: 1,
      recoveredGeneration: 1,
      recoveredFromCorruption: false,
      savedAtMs: 1_000,
      focusSession: null,
      get snapshot() {
        snapshotReads += 1;
        return sourceSnapshot;
      },
      checksum: snapshotOneChecksum,
    };

    const listed = await createTauriPersistenceGateway(invoke).listFocusSessions(sourceSave);
    expect(listed).toHaveLength(65);
    expect(listed.slice(0, 64).every((session) => session.recapEntries.length === 1)).toBe(true);
    expect(listed[64]).toEqual({ ...betaSession, recapEntries: [] });
    expect(calls).toEqual(['list_focus_sessions']);
    expect(snapshotReads).toBeLessThanOrEqual(3);
  });

  it('uses narrow command names and camelCase Tauri arguments', async () => {
    const calls: { command: string; arguments_: Readonly<Record<string, unknown>> | undefined }[] =
      [];
    const invoke: TauriInvoke = async (command, arguments_) => {
      await Promise.resolve();
      calls.push({ command, arguments_ });
      if (command === 'commit_save_slot') {
        return {
          slotId: 'alpha',
          name: 'Alpha',
          headGeneration: 1,
          savedAtMs: 1_000,
          checksum: snapshotOneChecksum,
        } as never;
      }
      if (command === 'save_settings') {
        return DEFAULT_APP_SETTINGS as never;
      }
      return undefined as never;
    };

    const gateway = createTauriPersistenceGateway(invoke);
    await gateway.commitSaveSlot('alpha', 'Alpha', snapshot('one'));
    await expect(gateway.recordFocusSession(completedSession, [2])).rejects.toThrow(
      'absent from the authoritative world',
    );
    await expect(
      gateway.recordFocusSession({ ...completedSession, focusedMs: 99 }, [1]),
    ).rejects.toThrow('does not match');
    await gateway.recordFocusSession(completedSession, [1]);
    await gateway.saveSettings(DEFAULT_APP_SETTINGS);

    expect(calls).toEqual([
      {
        command: 'commit_save_slot',
        arguments_: { slotId: 'alpha', name: 'Alpha', snapshot: snapshot('one') },
      },
      {
        command: 'confirm_semantically_valid_save_generation',
        arguments_: { slotId: 'alpha', generation: 1, checksum: snapshotOneChecksum },
      },
      { command: 'record_focus_session', arguments_: { session: completedSession } },
      { command: 'save_settings', arguments_: { settings: DEFAULT_APP_SETTINGS } },
    ]);
  });

  it('does not retry durable writes when semantic confirmation is temporarily unavailable', async () => {
    const invokeMock = vi.fn(async (command: string) => {
      await Promise.resolve();
      if (command === 'import_save_slot') {
        return {
          slotId: 'alpha',
          name: 'Alpha',
          headGeneration: 3,
          recoveredGeneration: 3,
          recoveredFromCorruption: false,
          savedAtMs: 3_000,
          focusSession: null,
          snapshot: snapshot('one'),
          checksum: snapshotOneChecksum,
        };
      }
      if (command !== 'commit_save_slot' && command !== 'commit_focus_checkpoint') {
        throw new Error(`unexpected ${command}`);
      }
      return {
        slotId: 'alpha',
        name: 'Alpha',
        headGeneration: command === 'commit_save_slot' ? 1 : 2,
        savedAtMs: command === 'commit_save_slot' ? 1_000 : 2_000,
        checksum: snapshotOneChecksum,
      };
    });
    const invoke: TauriInvoke = <Result>(command: string) => invokeMock(command) as Promise<Result>;
    const unavailableConfirmation = vi.fn().mockRejectedValue(new Error('broker unavailable'));
    const gateway = createTauriPersistenceGateway(invoke, unavailableConfirmation);
    const savePackage = JSON.stringify({
      format: 'chrono-forge-save-export',
      version: 1,
      slotId: 'alpha',
      name: 'Alpha',
      snapshot: snapshot('one'),
      checksum: snapshotOneChecksum,
    });

    await expect(gateway.commitSaveSlot('alpha', 'Alpha', snapshot('one'))).resolves.toMatchObject({
      recoveredGeneration: 1,
      checksum: snapshotOneChecksum,
    });
    await expect(
      gateway.commitFocusCheckpoint('alpha', 'Alpha', snapshot('one'), completedSession, [1]),
    ).resolves.toMatchObject({ recoveredGeneration: 2, focusSession: completedSession });
    await expect(gateway.importSaveSlot(savePackage)).resolves.toMatchObject({
      recoveredGeneration: 3,
      checksum: snapshotOneChecksum,
    });
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      'commit_save_slot',
      'commit_focus_checkpoint',
      'import_save_slot',
    ]);
    expect(unavailableConfirmation).toHaveBeenCalledTimes(3);
  });

  it('rejects a malformed native commit receipt without echoing the snapshot', async () => {
    const gateway = createTauriPersistenceGateway(async () => {
      await Promise.resolve();
      return {
        slotId: 'alpha',
        name: 'Alpha',
        headGeneration: 1,
        savedAtMs: 1_000,
        checksum: 'not-a-checksum',
      } as never;
    });

    await expect(gateway.commitSaveSlot('alpha', 'Alpha', snapshot('one'))).rejects.toThrow(
      'save checksum does not match its snapshot',
    );
  });

  it('rejects a well-formed native commit receipt checksum for different material', async () => {
    const gateway = createTauriPersistenceGateway(async () => {
      await Promise.resolve();
      return {
        slotId: 'alpha',
        name: 'Alpha',
        headGeneration: 1,
        savedAtMs: 1_000,
        checksum: '0'.repeat(64),
      } as never;
    });

    await expect(gateway.commitSaveSlot('alpha', 'Alpha', snapshot('one'))).rejects.toThrow(
      'save checksum does not match its snapshot',
    );
  });

  it('validates every successful native command result shape', async () => {
    const loaded = {
      slotId: 'alpha',
      name: 'Alpha',
      headGeneration: 1,
      recoveredGeneration: 1,
      recoveredFromCorruption: false,
      savedAtMs: 1_000,
      focusSession: null,
      snapshot: snapshot('one'),
      checksum: snapshotOneChecksum,
    };
    const savePackage = JSON.stringify({
      format: 'chrono-forge-save-export',
      version: 1,
      slotId: 'alpha',
      name: 'Alpha',
      snapshot: snapshot('one'),
      checksum: snapshotOneChecksum,
    });
    let loadCount = 0;
    const gateway = createTauriPersistenceGateway(async (command) => {
      await Promise.resolve();
      switch (command) {
        case 'list_save_slots':
          return [{ slotId: 'empty', name: 'Empty', headGeneration: null }] as never;
        case 'load_save_slot_candidates':
          loadCount += 1;
          return (loadCount === 1 ? null : nativeSaveCandidatePage([loaded], 1)) as never;
        case 'delete_save_slot':
          return true as never;
        case 'export_save_generation':
          return savePackage as never;
        case 'import_save_slot':
          return loaded as never;
        case 'list_focus_sessions':
          return [nativeFocusRecord(completedSession)] as never;
        case 'load_settings':
          return DEFAULT_APP_SETTINGS as never;
        default:
          throw new Error(`unexpected command ${command}`);
      }
    });

    await expect(gateway.listSaveSlots()).resolves.toEqual([
      { slotId: 'empty', name: 'Empty', headGeneration: null },
    ]);
    await expect(gateway.loadSaveSlot('alpha')).resolves.toBeNull();
    await expect(gateway.loadSaveSlot('alpha')).resolves.toEqual(loaded);
    await expect(gateway.deleteSaveSlot('alpha')).resolves.toBe(true);
    await expect(gateway.exportSaveSlot('alpha')).resolves.toBe(savePackage);
    await expect(gateway.importSaveSlot(savePackage)).resolves.toEqual(loaded);
    await expect(gateway.listFocusSessions(loaded)).resolves.toEqual([completedSession]);
    await expect(gateway.loadSettings()).resolves.toEqual(DEFAULT_APP_SETTINGS);
  });

  it('rejects malformed native results before they enter UI state', async () => {
    const gateway = createTauriPersistenceGateway(async () => {
      await Promise.resolve();
      return { unexpected: true } as never;
    });

    await expect(gateway.loadSettings()).rejects.toThrow('unexpected or missing fields');
    await expect(gateway.listSaveSlots()).rejects.toThrow('non-array');
    await expect(gateway.listFocusSessions()).rejects.toThrow('non-array');
    await expect(gateway.deleteSaveSlot('alpha')).rejects.toThrow('non-boolean');
    const malformedExportGateway = createTauriPersistenceGateway(async (command) => {
      await Promise.resolve();
      return (
        command === 'load_save_slot_candidates'
          ? nativeSaveCandidatePage(
              [
                {
                  slotId: 'alpha',
                  name: 'Alpha',
                  headGeneration: 1,
                  recoveredGeneration: 1,
                  recoveredFromCorruption: false,
                  savedAtMs: 1_000,
                  focusSession: null,
                  snapshot: snapshot('one'),
                  checksum: snapshotOneChecksum,
                },
              ],
              1,
            )
          : { unexpected: true }
      ) as never;
    });
    await expect(malformedExportGateway.exportSaveSlot('alpha')).rejects.toThrow('non-string');
  });

  it('rejects malformed and out-of-range audio settings from native responses', async () => {
    const malformedGateway = createTauriPersistenceGateway(async () => {
      await Promise.resolve();
      return { ...DEFAULT_APP_SETTINGS, audioMuted: 0 } as never;
    });
    await expect(malformedGateway.loadSettings()).rejects.toThrow('audioMuted must be a boolean');

    const outOfRangeGateway = createTauriPersistenceGateway(async () => {
      await Promise.resolve();
      return { ...DEFAULT_APP_SETTINGS, ambienceVolumePercent: 101 } as never;
    });
    await expect(outOfRangeGateway.loadSettings()).rejects.toThrow(
      'settings contain a value outside its supported range',
    );
  });

  it('falls back from a checksum-valid but semantically invalid native head', async () => {
    const malformedSnapshot = '{"hello":"world"}';
    const recoveredWorld = stepWorld(
      createInitialWorld([81, 82, 83, 84], {
        width: 12,
        height: 8,
        chunkSize: 4,
        societyYearTicks: 5_000,
      }),
      30_000,
    );
    expect(recoveredWorld.civilization.society.interpersonal.active.length).toBeGreaterThan(0);
    const recoveredSnapshot = serializeWorldSnapshot(recoveredWorld);
    const recoveredChecksum = checksumOf(recoveredSnapshot);
    const calls: { command: string; arguments_: Readonly<Record<string, unknown>> }[] = [];
    const gateway = createTauriPersistenceGateway(async (command, arguments_ = {}) => {
      await Promise.resolve();
      calls.push({ command, arguments_ });
      if (command === 'load_save_slot_candidates') {
        return nativeSaveCandidatePage(
          [
            {
              slotId: 'alpha',
              name: 'Alpha',
              headGeneration: 2,
              recoveredGeneration: 2,
              recoveredFromCorruption: false,
              savedAtMs: 2_000,
              focusSession: null,
              snapshot: malformedSnapshot,
              checksum: checksumOf(malformedSnapshot),
            },
          ],
          2,
        ) as never;
      }
      if (command === 'load_save_slot_fallback_candidates') {
        return nativeSaveCandidatePage(
          [
            {
              slotId: 'alpha',
              name: 'Alpha',
              headGeneration: 2,
              recoveredGeneration: 1,
              recoveredFromCorruption: true,
              savedAtMs: 1_000,
              focusSession: null,
              snapshot: recoveredSnapshot,
              checksum: recoveredChecksum,
            },
          ],
          1,
        ) as never;
      }
      if (command === 'confirm_semantically_valid_save_generation') return null as never;
      throw new Error('unexpected command');
    });

    const recovered = await gateway.loadSaveSlot('alpha');
    expect(recovered).toMatchObject({
      recoveredGeneration: 1,
      recoveredFromCorruption: true,
      snapshot: recoveredSnapshot,
    });
    expect(calls).toEqual([
      { command: 'load_save_slot_candidates', arguments_: { slotId: 'alpha' } },
      {
        command: 'load_save_slot_fallback_candidates',
        arguments_: { beforeGeneration: 2, slotId: 'alpha' },
      },
      {
        command: 'confirm_semantically_valid_save_generation',
        arguments_: {
          checksum: recoveredChecksum,
          generation: 1,
          slotId: 'alpha',
        },
      },
    ]);
    const reloaded = deserializeWorldSnapshot(recovered!.snapshot);
    expect(reloaded.civilization.society.interpersonal.active.length).toBeGreaterThan(0);
    expect(serializeWorldSnapshot(reloaded)).toBe(recoveredSnapshot);
  });

  it('keeps migrated fallback export and post-migration confirmation bound to exact generations', async () => {
    const malformedSnapshot = '{"hello":"migrated-head"}';
    const recoveredSnapshot = snapshot('one');
    const recoveredChecksum = checksumOf(recoveredSnapshot);
    const replacementSnapshot = snapshot('two');
    const replacementChecksum = checksumOf(replacementSnapshot);
    const recoveredExport = JSON.stringify({
      format: 'chrono-forge-save-export',
      version: 1,
      slotId: 'alpha',
      name: 'Alpha',
      snapshot: recoveredSnapshot,
      checksum: recoveredChecksum,
    });
    const calls: { command: string; arguments_: Readonly<Record<string, unknown>> }[] = [];
    const gateway = createTauriPersistenceGateway(async (command, arguments_ = {}) => {
      await Promise.resolve();
      calls.push({ command, arguments_ });
      switch (command) {
        case 'load_save_slot_candidates':
          return nativeSaveCandidatePage(
            [
              {
                slotId: 'alpha',
                name: 'Alpha',
                headGeneration: 7,
                recoveredGeneration: 7,
                recoveredFromCorruption: false,
                savedAtMs: 7_000,
                focusSession: null,
                snapshot: malformedSnapshot,
                checksum: checksumOf(malformedSnapshot),
              },
            ],
            7,
          ) as never;
        case 'load_save_slot_fallback_candidates':
          return nativeSaveCandidatePage(
            [
              {
                slotId: 'alpha',
                name: 'Alpha',
                headGeneration: 7,
                recoveredGeneration: 4,
                recoveredFromCorruption: true,
                savedAtMs: 4_000,
                focusSession: null,
                snapshot: recoveredSnapshot,
                checksum: recoveredChecksum,
              },
            ],
            4,
          ) as never;
        case 'export_save_generation':
          return recoveredExport as never;
        case 'commit_save_slot':
          return {
            slotId: 'alpha',
            name: 'Alpha',
            headGeneration: 8,
            savedAtMs: 8_000,
            checksum: replacementChecksum,
          } as never;
        case 'confirm_semantically_valid_save_generation':
          return undefined as never;
        default:
          throw new Error(`unexpected command ${command}`);
      }
    });

    await expect(gateway.exportSaveSlot('alpha')).resolves.toBe(recoveredExport);
    await expect(
      gateway.commitSaveSlot('alpha', 'Alpha', replacementSnapshot),
    ).resolves.toMatchObject({
      headGeneration: 8,
      recoveredGeneration: 8,
      snapshot: replacementSnapshot,
      checksum: replacementChecksum,
    });
    expect(calls).toEqual([
      { command: 'load_save_slot_candidates', arguments_: { slotId: 'alpha' } },
      {
        command: 'load_save_slot_fallback_candidates',
        arguments_: { beforeGeneration: 7, slotId: 'alpha' },
      },
      {
        command: 'export_save_generation',
        arguments_: { generation: 4, slotId: 'alpha' },
      },
      {
        command: 'commit_save_slot',
        arguments_: { name: 'Alpha', slotId: 'alpha', snapshot: replacementSnapshot },
      },
      {
        command: 'confirm_semantically_valid_save_generation',
        arguments_: { checksum: replacementChecksum, generation: 8, slotId: 'alpha' },
      },
    ]);
  });

  it('recovers the oldest canonical generation through checksum-valid semantic failures', async () => {
    const malformedTwo = '{"hello":"world-2"}';
    const malformedThree = '{"hello":"world-3"}';
    const recoveredSnapshot = snapshot('one');
    const calls: { command: string; arguments_: Readonly<Record<string, unknown>> }[] = [];
    const gateway = createTauriPersistenceGateway(async (command, arguments_ = {}) => {
      await Promise.resolve();
      calls.push({ command, arguments_ });
      if (command === 'load_save_slot_candidates') {
        return nativeSaveCandidatePage([], 4) as never;
      }
      if (command === 'confirm_semantically_valid_save_generation') return null as never;
      if (command !== 'load_save_slot_fallback_candidates') {
        throw new Error(`unexpected ${command}`);
      }
      const beforeGeneration = arguments_.beforeGeneration;
      if (beforeGeneration === 4) {
        return nativeSaveCandidatePage(
          [
            {
              slotId: 'alpha',
              name: 'Alpha',
              headGeneration: 4,
              recoveredGeneration: 3,
              recoveredFromCorruption: true,
              savedAtMs: 3_000,
              focusSession: null,
              snapshot: malformedThree,
              checksum: checksumOf(malformedThree),
            },
          ],
          3,
        ) as never;
      }
      if (beforeGeneration === 3) {
        return nativeSaveCandidatePage(
          [
            {
              slotId: 'alpha',
              name: 'Alpha',
              headGeneration: 4,
              recoveredGeneration: 2,
              recoveredFromCorruption: true,
              savedAtMs: 2_000,
              focusSession: null,
              snapshot: malformedTwo,
              checksum: checksumOf(malformedTwo),
            },
          ],
          2,
        ) as never;
      }
      if (beforeGeneration === 2) {
        return nativeSaveCandidatePage(
          [
            {
              slotId: 'alpha',
              name: 'Alpha',
              headGeneration: 4,
              recoveredGeneration: 1,
              recoveredFromCorruption: true,
              savedAtMs: 1_000,
              focusSession: null,
              snapshot: recoveredSnapshot,
              checksum: checksumOf(recoveredSnapshot),
            },
          ],
          1,
        ) as never;
      }
      throw new Error(`unexpected fallback boundary ${String(beforeGeneration)}`);
    });

    await expect(gateway.loadSaveSlot('alpha')).resolves.toMatchObject({
      headGeneration: 4,
      recoveredGeneration: 1,
      recoveredFromCorruption: true,
      snapshot: recoveredSnapshot,
    });
    expect(calls.map((call) => call.arguments_)).toEqual([
      { slotId: 'alpha' },
      { beforeGeneration: 4, slotId: 'alpha' },
      { beforeGeneration: 3, slotId: 'alpha' },
      { beforeGeneration: 2, slotId: 'alpha' },
      {
        checksum: checksumOf(recoveredSnapshot),
        generation: 1,
        slotId: 'alpha',
      },
    ]);
  });

  it('fails closed when native recovery repeats a fallback cursor', async () => {
    const malformed = '{"hello":"world"}';
    const calls: { command: string; arguments_: Readonly<Record<string, unknown>> }[] = [];
    const gateway = createTauriPersistenceGateway(async (command, arguments_ = {}) => {
      await Promise.resolve();
      calls.push({ command, arguments_ });
      if (command === 'load_save_slot_candidates') {
        return nativeSaveCandidatePage(
          [
            {
              slotId: 'alpha',
              name: 'Alpha',
              headGeneration: 3,
              recoveredGeneration: 3,
              recoveredFromCorruption: false,
              savedAtMs: 3_000,
              focusSession: null,
              snapshot: malformed,
              checksum: checksumOf(malformed),
            },
          ],
          3,
        ) as never;
      }
      if (command === 'load_save_slot_fallback_candidates') {
        return nativeSaveCandidatePage([], 3) as never;
      }
      throw new Error(`unexpected ${command}`);
    });

    await expect(gateway.loadSaveSlot('alpha')).rejects.toThrow(
      'save candidate cursor did not move to an older generation',
    );
    expect(calls).toEqual([
      { command: 'load_save_slot_candidates', arguments_: { slotId: 'alpha' } },
      {
        command: 'load_save_slot_fallback_candidates',
        arguments_: { beforeGeneration: 3, slotId: 'alpha' },
      },
    ]);
  });

  it('fails closed when a native page cursor skips older candidate generations', async () => {
    const malformed = '{"hello":"world"}';
    const calls: string[] = [];
    const gateway = createTauriPersistenceGateway(async (command) => {
      await Promise.resolve();
      calls.push(command);
      if (command !== 'load_save_slot_candidates') throw new Error(`unexpected ${command}`);
      return nativeSaveCandidatePage(
        [
          {
            slotId: 'alpha',
            name: 'Alpha',
            headGeneration: 5,
            recoveredGeneration: 5,
            recoveredFromCorruption: false,
            savedAtMs: 5_000,
            focusSession: null,
            snapshot: malformed,
            checksum: checksumOf(malformed),
          },
        ],
        2,
      ) as never;
    });

    await expect(gateway.loadSaveSlot('alpha')).rejects.toThrow(
      'cursor must match its sole candidate generation',
    );
    expect(calls).toEqual(['load_save_slot_candidates']);
  });

  it('falls back when a checksum-valid head fabricates persisted review facts', async () => {
    const beforeWorld = createInitialWorld([1, 2, 3, 4], {
      width: 2,
      height: 2,
      chunkSize: 2,
    });
    const afterWorld = stepWorld(beforeWorld, 1);
    const baseline = projectFocusCheckpoint(beforeWorld, null);
    const checkpoint = projectFocusCheckpoint(afterWorld, baseline.latestEventId);
    const completedState = completeFocus(
      startFocus(
        createIdleFocusState(),
        { focusDurationMs: 100, breakDurationMs: 0, simulationTicksPerFocusSecond: 10 },
        100,
      ),
      200,
    );
    const session: FocusSession = {
      ...focusSessionFromState(
        'review-session',
        'alpha',
        completedState,
        checkpoint.recapEntries.map((entry) => entry.id),
      ),
      recapEntries: checkpoint.recapEntries,
      review: {
        version: 1,
        baselineEventId: baseline.latestEventId,
        before: baseline.moment,
        after: checkpoint.moment,
        revisitTarget: checkpoint.revisitTarget,
      },
    };
    const validSnapshot = serializeWorldSnapshot(afterWorld);
    const tamperedSession: FocusSession = {
      ...session,
      review: {
        ...session.review!,
        after: { ...session.review!.after, food: session.review!.after.food + 1 },
        revisitTarget:
          session.review!.revisitTarget === null
            ? null
            : { ...session.review!.revisitTarget, id: session.review!.revisitTarget.id + 1 },
      },
    };
    const gateway = createTauriPersistenceGateway(async (command, arguments_) => {
      await Promise.resolve();
      if (command === 'load_save_slot_candidates') {
        return nativeSaveCandidatePage(
          [
            {
              slotId: 'alpha',
              name: 'Alpha',
              headGeneration: 2,
              recoveredGeneration: 2,
              recoveredFromCorruption: false,
              savedAtMs: 2_000,
              focusSession: tamperedSession,
              snapshot: validSnapshot,
              checksum: checksumOf(validSnapshot),
            },
          ],
          2,
        ) as never;
      }
      expect(command).toBe('load_save_slot_fallback_candidates');
      expect(arguments_).toEqual({ beforeGeneration: 2, slotId: 'alpha' });
      return nativeSaveCandidatePage(
        [
          {
            slotId: 'alpha',
            name: 'Alpha',
            headGeneration: 2,
            recoveredGeneration: 1,
            recoveredFromCorruption: true,
            savedAtMs: 1_000,
            focusSession: session,
            snapshot: validSnapshot,
            checksum: checksumOf(validSnapshot),
          },
        ],
        1,
      ) as never;
    });

    await expect(gateway.loadSaveSlot('alpha')).resolves.toMatchObject({
      recoveredGeneration: 1,
      recoveredFromCorruption: true,
      focusSession: session,
    });
  });

  it('round-trips independent slots, immutable increasing generations, and export/import', async () => {
    const gateway = createInMemoryPersistenceGateway();
    const first = await gateway.commitSaveSlot('alpha', 'Alpha', snapshot('one'));
    const second = await gateway.commitSaveSlot('alpha', 'Alpha', snapshot('two'));
    await gateway.commitSaveSlot('alpha', 'Alpha', snapshot('three'));
    const fourth = await gateway.commitSaveSlot('alpha', 'Alpha', snapshot('four'));
    await gateway.commitSaveSlot('beta', 'Beta', snapshot('other'));

    expect(first.recoveredGeneration).toBe(1);
    expect(second.recoveredGeneration).toBe(2);
    expect(fourth.recoveredGeneration).toBe(4);
    expect((await gateway.loadSaveSlot('alpha'))?.snapshot).toBe(snapshot('four'));
    expect(await gateway.listSaveSlots()).toEqual([
      { slotId: 'alpha', name: 'Alpha', headGeneration: 4 },
      { slotId: 'beta', name: 'Beta', headGeneration: 1 },
    ]);

    const exported = await gateway.exportSaveSlot('alpha');
    const destination = createInMemoryPersistenceGateway();
    const imported = await destination.importSaveSlot(exported);
    expect(imported).toMatchObject({ slotId: 'alpha', name: 'Alpha', snapshot: snapshot('four') });
    const tampered = JSON.parse(exported) as { checksum: string };
    tampered.checksum = '0'.repeat(64);
    await expect(destination.importSaveSlot(JSON.stringify(tampered))).rejects.toThrow('checksum');
  });

  it('uses an injected in-memory clock for durable generation timestamps', async () => {
    let nowMs = 1_000;
    const gateway = createInMemoryPersistenceGateway(() => nowMs);
    const first = await gateway.commitSaveSlot('alpha', 'Alpha', snapshot('one'));
    nowMs = 2_500;
    const second = await gateway.importSaveSlot(
      JSON.stringify({
        format: 'chrono-forge-save-export',
        version: 1,
        slotId: 'alpha',
        name: 'Alpha',
        snapshot: snapshot('two'),
        checksum: checksumOf(snapshot('two')),
      }),
    );

    expect(first.savedAtMs).toBe(1_000);
    expect(second.savedAtMs).toBe(2_500);
    expect((await gateway.loadSaveSlot('alpha'))?.savedAtMs).toBe(2_500);
  });

  it('commits an exact focus checkpoint with its immutable generation atomically', async () => {
    const gateway = createInMemoryPersistenceGateway();
    const committed = await gateway.commitFocusCheckpoint(
      'alpha',
      'Alpha',
      snapshot('one'),
      completedSession,
      [1],
    );

    expect(committed.focusSession).toEqual(completedSession);
    expect((await gateway.loadSaveSlot('alpha'))?.focusSession).toEqual(completedSession);
    expect(await gateway.listFocusSessions(committed)).toEqual([completedSession]);
    await expect(
      gateway.commitFocusCheckpoint(
        'alpha',
        'Alpha',
        snapshot('two'),
        { ...completedSession, slotId: 'beta' },
        [1],
      ),
    ).rejects.toThrow('belong to its save slot');
    expect((await gateway.loadSaveSlot('alpha'))?.recoveredGeneration).toBe(1);
    expect(await gateway.listFocusSessions(committed)).toEqual([completedSession]);
  });

  it('rejects stale and cross-slot checkpoint reuse without changing the durable head', async () => {
    const gateway = createInMemoryPersistenceGateway();
    const committed = await gateway.commitFocusCheckpoint(
      'alpha',
      'Alpha',
      snapshot('one'),
      completedSession,
      [1],
    );
    const staleSession = focusSessionFromState(
      completedSession.sessionId,
      'alpha',
      checkpointFocus(
        startFocus(
          createIdleFocusState(),
          { focusDurationMs: 100, breakDurationMs: 20, simulationTicksPerFocusSecond: 100 },
          100,
        ),
        150,
      ),
    );

    await expect(
      gateway.commitFocusCheckpoint('alpha', 'Alpha', snapshot('two'), staleSession, []),
    ).rejects.toThrow(/stale|immutable identity/i);
    await expect(
      gateway.commitFocusCheckpoint(
        'beta',
        'Beta',
        snapshot('other'),
        { ...completedSession, slotId: 'beta' },
        [1],
      ),
    ).rejects.toThrow(/stale|immutable identity/i);
    const rewrittenHistory = {
      ...completedSession,
      recapEventIds: [],
      recapEntries: [],
    };
    await expect(
      gateway.commitFocusCheckpoint('alpha', 'Alpha', snapshot('two'), rewrittenHistory, []),
    ).rejects.toThrow(/stale|immutable identity/i);
    await expect(gateway.recordFocusSession(rewrittenHistory, [])).rejects.toThrow(
      /stale|immutable identity/i,
    );

    const noncanonicalState = JSON.parse(completedSession.stateJson) as Record<string, unknown>;
    noncanonicalState.unexpectedAuthority = true;
    await expect(
      gateway.commitFocusCheckpoint(
        'alpha',
        'Alpha',
        snapshot('two'),
        {
          ...completedSession,
          sessionId: 'session-noncanonical',
          stateJson: JSON.stringify(noncanonicalState),
        },
        [1],
      ),
    ).rejects.toThrow(/missing or unknown fields/i);

    expect(await gateway.loadSaveSlot('alpha')).toEqual(committed);
    expect(await gateway.listFocusSessions(committed)).toEqual([completedSession]);
    expect(await gateway.listSaveSlots()).toEqual([
      { slotId: 'alpha', name: 'Alpha', headGeneration: 1 },
    ]);
  });

  it('uses the checkpoint command only after validating the exact snapshot pair', async () => {
    const calls: string[] = [];
    const gateway = createTauriPersistenceGateway(async (command, arguments_) => {
      await Promise.resolve();
      calls.push(command);
      if (command === 'confirm_semantically_valid_save_generation') {
        expect(arguments_).toEqual({
          slotId: 'alpha',
          generation: 1,
          checksum: snapshotOneChecksum,
        });
        return undefined as never;
      }
      expect(command).toBe('commit_focus_checkpoint');
      expect(arguments_).toEqual({
        slotId: 'alpha',
        name: 'Alpha',
        snapshot: snapshot('one'),
        session: completedSession,
      });
      return {
        slotId: 'alpha',
        name: 'Alpha',
        headGeneration: 1,
        savedAtMs: 1_000,
        checksum: snapshotOneChecksum,
      } as never;
    });

    await expect(
      gateway.commitFocusCheckpoint('alpha', 'Alpha', snapshot('one'), completedSession, [1]),
    ).resolves.toMatchObject({ focusSession: completedSession });
    await expect(
      gateway.commitFocusCheckpoint(
        'alpha',
        'Alpha',
        snapshot('one'),
        {
          ...completedSession,
          recapEventIds: [999],
          recapEntries: [{ id: 999, tick: 0, summary: 'Absent factual event.' }],
        },
        [2],
      ),
    ).rejects.toThrow('authoritative world');
    await expect(
      gateway.commitFocusCheckpoint(
        'alpha',
        'Alpha',
        snapshot('one'),
        {
          ...completedSession,
          recapEntries: [{ ...completedSession.recapEntries[0]!, tick: 1 }],
        },
        [1],
      ),
    ).rejects.toThrow('exactly match authoritative saved-world events');
    await expect(
      gateway.commitFocusCheckpoint(
        'alpha',
        'Alpha',
        snapshot('one'),
        {
          ...completedSession,
          recapEntries: [{ ...completedSession.recapEntries[0]!, summary: 'Invented recap.' }],
        },
        [1],
      ),
    ).rejects.toThrow('exactly match authoritative saved-world events');
    expect(calls).toEqual([
      'commit_focus_checkpoint',
      'confirm_semantically_valid_save_generation',
    ]);
  });

  it('rejects malformed native generation timestamps', async () => {
    const gateway = createTauriPersistenceGateway(async () => {
      await Promise.resolve();
      return nativeSaveCandidatePage(
        [
          {
            slotId: 'alpha',
            name: 'Alpha',
            headGeneration: 1,
            recoveredGeneration: 1,
            recoveredFromCorruption: false,
            savedAtMs: -1,
            focusSession: null,
            snapshot: snapshot('one'),
            checksum: snapshotOneChecksum,
          },
        ],
        1,
      ) as never;
    });

    await expect(gateway.loadSaveSlot('alpha')).rejects.toThrow('savedAtMs');
  });

  it('keeps browser delete/history semantics aligned and rejects invalid boundary data', async () => {
    const gateway = createInMemoryPersistenceGateway();
    await expect(gateway.loadSaveSlot('missing')).resolves.toBeNull();
    await expect(gateway.exportSaveSlot('missing')).rejects.toThrow('does not exist');
    await expect(gateway.importSaveSlot('{')).rejects.toThrow('valid JSON');
    await expect(
      gateway.importSaveSlot(
        JSON.stringify({
          format: 'wrong',
          version: 1,
          slotId: 'alpha',
          name: 'Alpha',
          snapshot: snapshot('one'),
          checksum: snapshotOneChecksum,
        }),
      ),
    ).rejects.toThrow('unsupported');
    await expect(gateway.commitSaveSlot('bad slot', 'Alpha', snapshot('one'))).rejects.toThrow(
      'slot ID',
    );
    await expect(gateway.commitSaveSlot('alpha', ' ', snapshot('one'))).rejects.toThrow(
      'save name',
    );
    await expect(gateway.commitSaveSlot('alpha', 'Alpha', '{')).rejects.toThrow('valid JSON');

    await expect(gateway.recordFocusSession(completedSession, [1])).rejects.toThrow(
      'does not exist',
    );
    await gateway.commitSaveSlot('alpha', 'Alpha', snapshot('one'));
    await gateway.recordFocusSession(completedSession, [1]);
    await expect(
      gateway.recordFocusSession(
        {
          ...completedSession,
          recapEntries: [{ ...completedSession.recapEntries[0]!, summary: 'Invented recap.' }],
        },
        [1],
      ),
    ).rejects.toThrow('exactly match authoritative saved-world events');
    expect(await gateway.deleteSaveSlot('alpha')).toBe(true);
    expect(await gateway.deleteSaveSlot('alpha')).toBe(false);
    expect(await gateway.listFocusSessions()).toEqual([
      { ...completedSession, slotId: null, recapEntries: [] },
    ]);

    await expect(
      gateway.recordFocusSession({ ...completedSession, stateJson: '{' }, [1]),
    ).rejects.toThrow('valid JSON');
    await expect(
      gateway.recordFocusSession({ ...completedSession, recapEventIds: [0] }, [1]),
    ).rejects.toThrow('recap');
    await expect(
      gateway.recordFocusSession(
        {
          ...completedSession,
          recapEntries: [{ id: 2, tick: 0, summary: 'Mismatched factual event.' }],
        },
        [1],
      ),
    ).rejects.toThrow('exactly match');
    await expect(
      gateway.saveSettings({ ...DEFAULT_APP_SETTINGS, focusToSimRatio: 0 }),
    ).rejects.toThrow('outside its supported range');
  });

  it('persists validated focus sessions and settings without sharing mutable arrays or objects', async () => {
    const gateway = createInMemoryPersistenceGateway();
    await gateway.commitSaveSlot('alpha', 'Alpha', snapshot('one'));
    await gateway.recordFocusSession(completedSession, [1]);
    const sourceSave = await gateway.loadSaveSlot('alpha');
    const sessions = await gateway.listFocusSessions(sourceSave ?? undefined);
    expect(sessions).toEqual([completedSession]);
    (sessions[0]?.recapEventIds as number[]).push(99);
    expect(await gateway.listFocusSessions(sourceSave ?? undefined)).toEqual([completedSession]);

    const updated = {
      ...DEFAULT_APP_SETTINGS,
      focusToSimRatio: 42,
      calmMode: true,
      audioMuted: true,
      ambienceEnabled: true,
      ambienceVolumePercent: 65,
      effectsVolumePercent: 35,
    };
    expect(await gateway.saveSettings(updated)).toEqual(updated);
    expect(await gateway.loadSettings()).toEqual(updated);
    await expect(gateway.saveSettings({ ...updated, volumePercent: 101 })).rejects.toThrow(
      'outside its supported range',
    );
    await expect(gateway.saveSettings({ ...updated, ambienceVolumePercent: 101 })).rejects.toThrow(
      'outside its supported range',
    );
    await expect(gateway.saveSettings({ ...updated, effectsVolumePercent: 101 })).rejects.toThrow(
      'outside its supported range',
    );
  });

  it('persists and clears the active slot identifier', async () => {
    const gateway = createInMemoryPersistenceGateway();
    const selected = { ...DEFAULT_APP_SETTINGS, activeSlotId: 'alpha' };
    await gateway.commitSaveSlot('alpha', 'Alpha', snapshot('one'));
    expect(await gateway.saveSettings(selected)).toEqual(selected);
    await expect(
      gateway.saveSettings({ ...DEFAULT_APP_SETTINGS, activeSlotId: 'missing' }),
    ).rejects.toThrow('does not reference an existing save slot');
    await gateway.deleteSaveSlot('alpha');
    expect((await gateway.loadSettings()).activeSlotId).toBeNull();
    await expect(
      gateway.saveSettings({ ...DEFAULT_APP_SETTINGS, activeSlotId: 'bad slot' }),
    ).rejects.toThrow('activeSlotId');
  });
});
