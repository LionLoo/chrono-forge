import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';

import {
  confirmedNativeE2eInfrastructureFailures,
  createNativeE2eCommandTracker,
  nativeE2eDatabasePath,
  runNativeE2eCi,
  runNativeE2eSingleAttempt,
  verifyNativeE2eDatabase,
  type NativeE2eCommandResult,
} from '../../scripts/run-native-e2e-ci.mjs';

const success = Object.freeze({ code: 0, output: '' });
const beforeRelaunchArgs = [
  'exec',
  '--',
  'wdio',
  'run',
  'wdio.conf.mjs',
  '--spec',
  './tests/e2e-desktop/focus-persistence.phase-1.e2e.spec.mjs',
  '--spec',
  './tests/e2e-desktop/focus-persistence.phase-2.e2e.spec.mjs',
  '--spec',
  './tests/e2e-desktop/focus-persistence.phase-3.e2e.spec.mjs',
];
const afterRelaunchArgs = [
  'exec',
  '--',
  'wdio',
  'run',
  'wdio.conf.mjs',
  '--spec',
  './tests/e2e-desktop/focus-persistence.phase-4.e2e.spec.mjs',
];
const confirmedInfrastructureOutputs = [
  'Error: Script execution timed out\n    at DirectEvalClient.eval',
  '[native-e2e-infrastructure] tauri-direct-eval-timeout\nTimeoutError: The operation was aborted due to timeout',
  'WARN webdriver: WebDriverError: Script execution timed out when running "execute/sync" with method "POST"',
  'WARN webdriver: WebDriverError: Session f0c679fc-44c5-49fc-8618-5c3f3ad7d899 not found when running "execute/sync" with method "POST"',
];

function commandResult(code: number, output: string): NativeE2eCommandResult {
  return { code, output };
}

describe('native CI E2E infrastructure classification', () => {
  it.each([
    [
      'direct-eval script timeout',
      'Error: Script execution timed out\n    at DirectEvalClient.eval',
    ],
    [
      'direct-eval timeout',
      '[native-e2e-infrastructure] tauri-direct-eval-timeout\nTimeoutError: The operation was aborted due to timeout',
    ],
    [
      'WebDriver protocol timeout',
      'WARN webdriver: WebDriverError: Script execution timed out when running "execute/sync" with method "POST"',
    ],
    [
      'lost session',
      'WARN webdriver: WebDriverError: Session f0c679fc-44c5-49fc-8618-5c3f3ad7d899 not found when running "execute/sync" with method "POST"',
    ],
  ])('admits the confirmed %s signature', (_label, output) => {
    expect(confirmedNativeE2eInfrastructureFailures(output)).toHaveLength(1);
  });

  it.each([
    'expected 1 to equal 2',
    'element ("button=Complete focus") still not displayed after 20000ms',
    'Archive fault: verified save generation is unavailable.',
    'Timeout of 360000ms exceeded.',
    'Error: Timeout',
    'Error: Script execution timed out',
    'TimeoutError: The operation was aborted due to timeout',
    'WebDriverError: Session f0c679fc-44c5-49fc-8618-5c3f3ad7d899 not found when running "execute/sync" with method "POST"',
    '[native-e2e-diagnostics] command-active-at-test-timeout id=42 command="execute" elapsedMs=360000\nTimeout of 360000ms exceeded. The execution in the test "native focus persistence phase 1" took too long.',
  ])('rejects an ordinary product or assertion failure: %s', (output) => {
    expect(confirmedNativeE2eInfrastructureFailures(output)).toEqual([]);
  });

  it('reports each confirmed signature once when downstream failures share one log', () => {
    const output = [
      'Error: Script execution timed out\n    at DirectEvalClient.eval',
      '[native-e2e-infrastructure] tauri-direct-eval-timeout\nTimeoutError: The operation was aborted due to timeout',
      'expected 1 to equal 2',
    ].join('\n');

    expect(confirmedNativeE2eInfrastructureFailures(output)).toEqual([
      'Tauri direct-eval script timeout',
      'Tauri direct-eval transport timeout',
    ]);
  });

  it('retries the full unchanged suite once after a confirmed infrastructure failure', async () => {
    const run = vi
      .fn<(args: string[]) => Promise<NativeE2eCommandResult>>()
      .mockResolvedValueOnce(success)
      .mockResolvedValueOnce(success)
      .mockResolvedValueOnce(
        commandResult(1, 'Error: Script execution timed out\n    at DirectEvalClient.eval'),
      )
      .mockResolvedValueOnce(success)
      .mockResolvedValueOnce(success);
    const logger = { error: vi.fn(), warn: vi.fn() };
    const verifyDatabase = vi.fn().mockResolvedValue(undefined);

    await expect(runNativeE2eCi(run, logger, verifyDatabase)).resolves.toBe(0);
    expect(run).toHaveBeenNthCalledWith(1, ['run', 'build:e2e:desktop']);
    expect(run).toHaveBeenNthCalledWith(2, beforeRelaunchArgs);
    expect(run).toHaveBeenNthCalledWith(3, afterRelaunchArgs);
    expect(run).toHaveBeenNthCalledWith(4, beforeRelaunchArgs);
    expect(run).toHaveBeenNthCalledWith(5, afterRelaunchArgs);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
    expect(verifyDatabase).toHaveBeenCalledOnce();
  });

  it('does not retry an unclassified failure', async () => {
    const run = vi
      .fn<(args: string[]) => Promise<NativeE2eCommandResult>>()
      .mockResolvedValueOnce(success)
      .mockResolvedValueOnce(success)
      .mockResolvedValueOnce(commandResult(7, 'expected paused session to exist'));
    const logger = { error: vi.fn(), warn: vi.fn() };
    const verifyDatabase = vi.fn().mockResolvedValue(undefined);

    await expect(runNativeE2eCi(run, logger, verifyDatabase)).resolves.toBe(7);
    expect(run).toHaveBeenCalledTimes(3);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledOnce();
    expect(verifyDatabase).not.toHaveBeenCalled();
  });

  it.each(confirmedInfrastructureOutputs)(
    'does not let a recovered pre-relaunch signature mask a phase-4 assertion failure: %s',
    async (recoveredOutput) => {
      const run = vi
        .fn<(args: string[]) => Promise<NativeE2eCommandResult>>()
        .mockResolvedValueOnce(success)
        .mockResolvedValueOnce(commandResult(0, recoveredOutput))
        .mockResolvedValueOnce(commandResult(7, 'expected recovered generation 1 to equal 2'));
      const logger = { error: vi.fn(), warn: vi.fn() };
      const verifyDatabase = vi.fn().mockResolvedValue(undefined);

      await expect(runNativeE2eCi(run, logger, verifyDatabase)).resolves.toBe(7);
      expect(run).toHaveBeenCalledTimes(3);
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledOnce();
      expect(verifyDatabase).not.toHaveBeenCalled();
    },
  );

  it('fails after the single bounded retry', async () => {
    const run = vi
      .fn<(args: string[]) => Promise<NativeE2eCommandResult>>()
      .mockResolvedValueOnce(success)
      .mockResolvedValueOnce(success)
      .mockResolvedValueOnce(
        commandResult(
          1,
          '[native-e2e-infrastructure] tauri-direct-eval-timeout\nTimeoutError: The operation was aborted due to timeout',
        ),
      )
      .mockResolvedValueOnce(success)
      .mockResolvedValueOnce(commandResult(9, 'expected 1 to equal 2'));
    const logger = { error: vi.fn(), warn: vi.fn() };
    const verifyDatabase = vi.fn().mockResolvedValue(undefined);

    await expect(runNativeE2eCi(run, logger, verifyDatabase)).resolves.toBe(9);
    expect(run).toHaveBeenCalledTimes(5);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledOnce();
    expect(verifyDatabase).not.toHaveBeenCalled();
  });
});

describe('native E2E SQLite integrity gate', () => {
  it('runs after the single-attempt installed suite and stays fatal', async () => {
    const run = vi
      .fn<(args: string[]) => Promise<NativeE2eCommandResult>>()
      .mockResolvedValue(success);
    const logger = { error: vi.fn(), warn: vi.fn() };
    const verifyDatabase = vi.fn().mockRejectedValue(new Error('integrity fault'));

    await expect(runNativeE2eSingleAttempt(run, logger, verifyDatabase)).resolves.toBe(1);
    expect(run).toHaveBeenNthCalledWith(1, ['run', 'build:e2e:desktop']);
    expect(run).toHaveBeenNthCalledWith(2, beforeRelaunchArgs);
    expect(run).toHaveBeenNthCalledWith(3, afterRelaunchArgs);
    expect(verifyDatabase).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith('[native-e2e-integrity] integrity fault');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('resolves the isolated Windows database below the E2E application root', () => {
    expect(
      nativeE2eDatabasePath('profile-1', {
        environment: { LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' },
        platform: 'win32',
      }),
    ).toBe(
      path.join(
        'C:\\Users\\tester\\AppData\\Local',
        'com.lionloo.chronoforge.e2e',
        'profiles',
        'profile-1',
        'chrono-forge.sqlite3',
      ),
    );
  });

  it('checks the closed post-relaunch archive with read-only SQLite pragmas', async () => {
    const fixtureDirectory = mkdtempSync(path.join(tmpdir(), 'chrono-forge-native-db-'));
    const databasePath = path.join(fixtureDirectory, 'chrono-forge.sqlite3');
    const database = new DatabaseSync(databasePath);
    try {
      database.exec(`
        CREATE TABLE save_slots (slot_id TEXT PRIMARY KEY, head_generation INTEGER NOT NULL);
        CREATE TABLE save_generations (slot_id TEXT NOT NULL, generation INTEGER NOT NULL);
        CREATE TABLE focus_sessions (session_id TEXT PRIMARY KEY);
        CREATE TABLE app_settings (active_slot_id TEXT NOT NULL);
        INSERT INTO save_slots VALUES
          ('m9-contacted', 2),
          ('m9-mid-flight', 2),
          ('primary', 5);
        INSERT INTO save_generations VALUES
          ('m9-contacted', 1),
          ('m9-contacted', 2),
          ('m9-mid-flight', 1),
          ('m9-mid-flight', 2),
          ('primary', 3),
          ('primary', 4),
          ('primary', 5);
        INSERT INTO focus_sessions VALUES ('primary-session'), ('probe-session');
        INSERT INTO app_settings VALUES ('m9-contacted');
      `);
    } finally {
      database.close();
    }
    try {
      await expect(verifyNativeE2eDatabase({ databasePath })).resolves.toMatchObject({
        databasePath,
        generations: 7,
        sessions: 2,
        slots: 3,
      });
    } finally {
      rmSync(fixtureDirectory, { force: true, recursive: true });
    }
  });
});

describe('native CI E2E command timeout diagnostics', () => {
  it('reports only commands that remain active when the test wrapper times out', () => {
    const logger = { error: vi.fn() };
    let nowMs = 10_000;
    const tracker = createNativeE2eCommandTracker({ logger, now: () => nowMs });

    tracker.beforeCommand('waitUntil');
    nowMs = 20_000;
    tracker.beforeCommand('getText');
    tracker.afterCommand('getText');
    nowMs = 370_000;
    tracker.afterTest(
      new Error(
        'Timeout of 360000ms exceeded. The execution in the test "native focus persistence phase 1" took too long.',
      ),
    );

    expect(logger.error).toHaveBeenCalledWith(
      '[native-e2e-diagnostics] command-active-at-test-timeout id=1 command="waitUntil" elapsedMs=360000',
    );
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('does not report recovered commands or ordinary product failures', () => {
    const logger = { error: vi.fn() };
    let nowMs = 10_000;
    const tracker = createNativeE2eCommandTracker({ logger, now: () => nowMs });

    tracker.beforeCommand('waitUntil');
    nowMs = 100_000;
    tracker.afterCommand('waitUntil');
    tracker.afterTest(
      new Error(
        'Timeout of 360000ms exceeded. The execution in the test "native focus persistence phase 1" took too long.',
      ),
    );
    tracker.beforeCommand('execute');
    tracker.afterTest(new Error('expected persisted focus session to exist'));

    expect(logger.error).not.toHaveBeenCalled();
  });
});
