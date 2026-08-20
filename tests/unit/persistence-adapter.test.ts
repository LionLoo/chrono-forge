import { createHash } from 'node:crypto';

import {
  DEFAULT_APP_SETTINGS,
  createInMemoryPersistenceGateway,
  createTauriPersistenceGateway,
  type FocusSession,
  type TauriInvoke,
} from '../../src/adapters/persistence';
import { checkpointFocus, createIdleFocusState, startFocus } from '../../src/focus';
import { serializeWorldSnapshot } from '../../src/simulation/persistence';
import { createInitialWorld, stepWorld } from '../../src/simulation/world';

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
};

describe('persistence adapter', () => {
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
          recoveredGeneration: 1,
          recoveredFromCorruption: false,
          snapshot: snapshot('one'),
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
      { command: 'record_focus_session', arguments_: { session: completedSession } },
      { command: 'save_settings', arguments_: { settings: DEFAULT_APP_SETTINGS } },
    ]);
  });

  it('validates every successful native command result shape', async () => {
    const loaded = {
      slotId: 'alpha',
      name: 'Alpha',
      headGeneration: 1,
      recoveredGeneration: 1,
      recoveredFromCorruption: false,
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
          return (loadCount === 1 ? null : [loaded]) as never;
        case 'delete_save_slot':
          return true as never;
        case 'export_save_generation':
          return savePackage as never;
        case 'import_save_slot':
          return loaded as never;
        case 'list_focus_sessions':
          return [completedSession] as never;
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
    await expect(gateway.listFocusSessions()).resolves.toEqual([completedSession]);
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
          ? [
              {
                slotId: 'alpha',
                name: 'Alpha',
                headGeneration: 1,
                recoveredGeneration: 1,
                recoveredFromCorruption: false,
                snapshot: snapshot('one'),
                checksum: snapshotOneChecksum,
              },
            ]
          : { unexpected: true }
      ) as never;
    });
    await expect(malformedExportGateway.exportSaveSlot('alpha')).rejects.toThrow('non-string');
  });

  it('falls back from a checksum-valid but semantically invalid native head', async () => {
    const malformedSnapshot = '{"hello":"world"}';
    const gateway = createTauriPersistenceGateway(async (command) => {
      await Promise.resolve();
      if (command !== 'load_save_slot_candidates') throw new Error('unexpected command');
      return [
        {
          slotId: 'alpha',
          name: 'Alpha',
          headGeneration: 2,
          recoveredGeneration: 2,
          recoveredFromCorruption: false,
          snapshot: malformedSnapshot,
          checksum: checksumOf(malformedSnapshot),
        },
        {
          slotId: 'alpha',
          name: 'Alpha',
          headGeneration: 2,
          recoveredGeneration: 1,
          recoveredFromCorruption: true,
          snapshot: snapshot('one'),
          checksum: snapshotOneChecksum,
        },
      ] as never;
    });

    await expect(gateway.loadSaveSlot('alpha')).resolves.toMatchObject({
      recoveredGeneration: 1,
      recoveredFromCorruption: true,
      snapshot: snapshot('one'),
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
    expect(await gateway.deleteSaveSlot('alpha')).toBe(true);
    expect(await gateway.deleteSaveSlot('alpha')).toBe(false);
    expect(await gateway.listFocusSessions()).toEqual([{ ...completedSession, slotId: null }]);

    await expect(
      gateway.recordFocusSession({ ...completedSession, stateJson: '{' }, [1]),
    ).rejects.toThrow('valid JSON');
    await expect(
      gateway.recordFocusSession({ ...completedSession, recapEventIds: [0] }, [1]),
    ).rejects.toThrow('recap');
    await expect(
      gateway.saveSettings({ ...DEFAULT_APP_SETTINGS, focusToSimRatio: 0 }),
    ).rejects.toThrow('outside its supported range');
  });

  it('persists validated focus sessions and settings without sharing mutable arrays or objects', async () => {
    const gateway = createInMemoryPersistenceGateway();
    await gateway.commitSaveSlot('alpha', 'Alpha', snapshot('one'));
    await gateway.recordFocusSession(completedSession, [1]);
    const sessions = await gateway.listFocusSessions();
    expect(sessions).toEqual([completedSession]);
    (sessions[0]?.recapEventIds as number[]).push(99);
    expect(await gateway.listFocusSessions()).toEqual([completedSession]);

    const updated = { ...DEFAULT_APP_SETTINGS, focusToSimRatio: 42, calmMode: true };
    expect(await gateway.saveSettings(updated)).toEqual(updated);
    expect(await gateway.loadSettings()).toEqual(updated);
    await expect(gateway.saveSettings({ ...updated, volumePercent: 101 })).rejects.toThrow(
      'outside its supported range',
    );
  });
});
