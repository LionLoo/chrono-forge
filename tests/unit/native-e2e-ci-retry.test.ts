import { describe, expect, it, vi } from 'vitest';

import {
  confirmedNativeE2eInfrastructureFailures,
  createNativeE2eCommandTracker,
  runNativeE2eCi,
  type NativeE2eCommandResult,
} from '../../scripts/run-native-e2e-ci.mjs';

const success = Object.freeze({ code: 0, output: '' });

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
      .mockResolvedValueOnce(
        commandResult(1, 'Error: Script execution timed out\n    at DirectEvalClient.eval'),
      )
      .mockResolvedValueOnce(success);
    const logger = { error: vi.fn(), warn: vi.fn() };

    await expect(runNativeE2eCi(run, logger)).resolves.toBe(0);
    expect(run).toHaveBeenNthCalledWith(1, ['run', 'build:e2e:desktop']);
    expect(run).toHaveBeenNthCalledWith(2, ['exec', '--', 'wdio', 'run', 'wdio.conf.mjs']);
    expect(run).toHaveBeenNthCalledWith(3, ['exec', '--', 'wdio', 'run', 'wdio.conf.mjs']);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('does not retry an unclassified failure', async () => {
    const run = vi
      .fn<(args: string[]) => Promise<NativeE2eCommandResult>>()
      .mockResolvedValueOnce(success)
      .mockResolvedValueOnce(commandResult(7, 'expected paused session to exist'));
    const logger = { error: vi.fn(), warn: vi.fn() };

    await expect(runNativeE2eCi(run, logger)).resolves.toBe(7);
    expect(run).toHaveBeenCalledTimes(2);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('fails after the single bounded retry', async () => {
    const run = vi
      .fn<(args: string[]) => Promise<NativeE2eCommandResult>>()
      .mockResolvedValueOnce(success)
      .mockResolvedValueOnce(
        commandResult(
          1,
          '[native-e2e-infrastructure] tauri-direct-eval-timeout\nTimeoutError: The operation was aborted due to timeout',
        ),
      )
      .mockResolvedValueOnce(commandResult(9, 'expected 1 to equal 2'));
    const logger = { error: vi.fn(), warn: vi.fn() };

    await expect(runNativeE2eCi(run, logger)).resolves.toBe(9);
    expect(run).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledOnce();
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
