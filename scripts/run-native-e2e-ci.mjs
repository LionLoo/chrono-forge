import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCliPath = process.env.npm_execpath;
const NATIVE_TEST_TIMEOUT_PATTERN = /Timeout of \d+ms exceeded\. The execution in the test /u;

const CONFIRMED_INFRASTRUCTURE_FAILURES = Object.freeze([
  Object.freeze({
    name: 'Tauri direct-eval script timeout',
    matches: (output) =>
      output.includes('DirectEvalClient.eval') && output.includes('Script execution timed out'),
  }),
  Object.freeze({
    name: 'Tauri direct-eval transport timeout',
    matches: (output) =>
      output.includes('[native-e2e-infrastructure] tauri-direct-eval-timeout') &&
      output.includes('TimeoutError: The operation was aborted due to timeout'),
  }),
  Object.freeze({
    name: 'WebDriver protocol script timeout',
    matches: (output) =>
      /WARN webdriver: WebDriverError: Script execution timed out when running "[^"]+" with method "POST"/u.test(
        output,
      ),
  }),
  Object.freeze({
    name: 'lost WebDriver session',
    matches: (output) =>
      /WARN webdriver: WebDriverError: Session [0-9a-f-]+ not found when running "[^"]+" with method "POST"/u.test(
        output,
      ),
  }),
]);

export function createNativeE2eCommandTracker({ logger = console, now = Date.now } = {}) {
  let nextCommandId = 0;
  const activeCommands = [];

  return Object.freeze({
    beforeCommand(commandName) {
      const commandId = ++nextCommandId;
      activeCommands.push({ commandId, commandName, startedAtMs: now() });
    },
    afterCommand(commandName) {
      const commandIndex = activeCommands.findLastIndex(
        (activeCommand) => activeCommand.commandName === commandName,
      );
      if (commandIndex === -1) return;
      activeCommands.splice(commandIndex, 1);
    },
    afterTest(error) {
      const message = error instanceof Error ? error.message : '';
      if (!NATIVE_TEST_TIMEOUT_PATTERN.test(message)) return;
      const observedAtMs = now();
      for (const { commandId, commandName, startedAtMs } of activeCommands) {
        logger.error(
          `[native-e2e-diagnostics] command-active-at-test-timeout id=${commandId} command=${JSON.stringify(commandName)} elapsedMs=${Math.max(0, observedAtMs - startedAtMs)}`,
        );
      }
    },
  });
}

export function confirmedNativeE2eInfrastructureFailures(output) {
  return CONFIRMED_INFRASTRUCTURE_FAILURES.filter(({ matches }) => matches(output)).map(
    ({ name }) => name,
  );
}

function runNpm(args) {
  return new Promise((resolve, reject) => {
    if (npmCliPath === undefined) {
      reject(new Error('npm_execpath is required to run the native CI E2E launcher.'));
      return;
    }
    const child = spawn(process.execPath, [npmCliPath, ...args], {
      cwd: repositoryRoot,
      env: process.env,
      shell: false,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    let output = '';
    const forward = (destination) => (chunk) => {
      destination.write(chunk);
      output += chunk.toString();
    };
    child.stdout.on('data', forward(process.stdout));
    child.stderr.on('data', forward(process.stderr));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      resolve({ code: code ?? 1, output, signal });
    });
  });
}

export async function runNativeE2eCi(run = runNpm, logger = console) {
  const build = await run(['run', 'build:e2e:desktop']);
  if (build.code !== 0) {
    return build.code;
  }

  const firstAttempt = await run(['exec', '--', 'wdio', 'run', 'wdio.conf.mjs']);
  if (firstAttempt.code === 0) return 0;

  const confirmedFailures = confirmedNativeE2eInfrastructureFailures(firstAttempt.output);
  if (confirmedFailures.length === 0) {
    logger.error(
      '[native-e2e-ci] The native suite failed without a confirmed transport/session signature; not retrying.',
    );
    return firstAttempt.code;
  }

  logger.warn(
    `[native-e2e-ci] The first native suite attempt failed through confirmed infrastructure (${confirmedFailures.join(', ')}). Retrying the complete unchanged suite once with fresh launcher-owned sessions.`,
  );
  const secondAttempt = await run(['exec', '--', 'wdio', 'run', 'wdio.conf.mjs']);
  if (secondAttempt.code !== 0) {
    logger.error('[native-e2e-ci] The single bounded infrastructure retry also failed.');
  }
  return secondAttempt.code;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(path.resolve(entryPath)).href) {
  process.exitCode = await runNativeE2eCi();
}
