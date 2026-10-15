import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCliPath = process.env.npm_execpath;
const PROFILE_ENVIRONMENT_VARIABLE = 'CHRONO_FORGE_PROFILE';
const E2E_APPLICATION_IDENTIFIER = 'com.lionloo.chronoforge.e2e';
const NATIVE_TEST_TIMEOUT_PATTERN = /Timeout of \d+ms exceeded\. The execution in the test /u;
const PRE_RELAUNCH_SPECS = Object.freeze([
  './tests/e2e-desktop/focus-persistence.phase-1.e2e.spec.mjs',
  './tests/e2e-desktop/focus-persistence.phase-2.e2e.spec.mjs',
  './tests/e2e-desktop/focus-persistence.phase-3.e2e.spec.mjs',
]);
const POST_RELAUNCH_SPECS = Object.freeze([
  './tests/e2e-desktop/focus-persistence.phase-4.e2e.spec.mjs',
]);
let generatedProfileSequence = 0;

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

export function nativeE2eDatabasePath(
  profile,
  { environment = process.env, platform = process.platform } = {},
) {
  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(profile)) {
    throw new Error('native E2E profile name is invalid');
  }
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  let localDataRoot;
  if (platform === 'win32') {
    localDataRoot = environment.LOCALAPPDATA;
  } else if (platform === 'darwin') {
    localDataRoot =
      environment.HOME === undefined
        ? undefined
        : pathApi.join(environment.HOME, 'Library', 'Application Support');
  } else {
    localDataRoot =
      environment.XDG_DATA_HOME ??
      (environment.HOME === undefined
        ? undefined
        : pathApi.join(environment.HOME, '.local', 'share'));
  }
  if (localDataRoot === undefined || localDataRoot.length === 0) {
    throw new Error('native E2E application-local-data root is unavailable');
  }
  return pathApi.join(
    localDataRoot,
    E2E_APPLICATION_IDENTIFIER,
    'profiles',
    profile,
    'chrono-forge.sqlite3',
  );
}

export async function verifyNativeE2eDatabase({
  databasePath = undefined,
  profile = process.env[PROFILE_ENVIRONMENT_VARIABLE],
} = {}) {
  if (profile === undefined && databasePath === undefined) {
    throw new Error('native E2E profile is unavailable for SQLite integrity verification');
  }
  const resolvedPath = databasePath ?? nativeE2eDatabasePath(profile, { environment: process.env });
  if (!existsSync(resolvedPath)) {
    throw new Error(`native E2E SQLite database does not exist: ${resolvedPath}`);
  }
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(resolvedPath, { readOnly: true });
  try {
    const integrityRows = database.prepare('PRAGMA integrity_check').all();
    if (integrityRows.length !== 1 || integrityRows[0]?.integrity_check !== 'ok') {
      throw new Error(`SQLite integrity_check failed: ${JSON.stringify(integrityRows)}`);
    }
    const foreignKeyRows = database.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyRows.length !== 0) {
      throw new Error(`SQLite foreign_key_check failed: ${JSON.stringify(foreignKeyRows)}`);
    }
    const counts = database
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM save_slots) AS slots,
           (SELECT COUNT(*) FROM save_generations) AS generations,
           (SELECT COUNT(*) FROM focus_sessions) AS sessions`,
      )
      .get();
    if (counts?.slots !== 3 || counts.generations !== 8 || counts.sessions !== 2) {
      throw new Error(`unexpected post-cleanup SQLite counts: ${JSON.stringify(counts)}`);
    }
    const settings = database.prepare('SELECT active_slot_id FROM app_settings').get();
    if (settings?.active_slot_id !== 'm9-contacted') {
      throw new Error(`unexpected post-cleanup active slot: ${JSON.stringify(settings)}`);
    }
    const slots = database
      .prepare('SELECT slot_id, head_generation FROM save_slots ORDER BY slot_id ASC')
      .all();
    const expectedSlots = [
      { slot_id: 'm9-contacted', head_generation: 2 },
      { slot_id: 'm9-mid-flight', head_generation: 2 },
      { slot_id: 'primary', head_generation: 5 },
    ];
    if (JSON.stringify(slots) !== JSON.stringify(expectedSlots)) {
      throw new Error(`unexpected post-cleanup save slots: ${JSON.stringify(slots)}`);
    }
    const generations = database
      .prepare(
        `SELECT slot_id, generation, semantically_verified
         FROM save_generations
         ORDER BY slot_id ASC, generation ASC`,
      )
      .all();
    const expectedGenerations = [
      { slot_id: 'm9-contacted', generation: 1, semantically_verified: 1 },
      { slot_id: 'm9-contacted', generation: 2, semantically_verified: 0 },
      { slot_id: 'm9-mid-flight', generation: 1, semantically_verified: 1 },
      { slot_id: 'm9-mid-flight', generation: 2, semantically_verified: 0 },
      { slot_id: 'primary', generation: 1, semantically_verified: 1 },
      { slot_id: 'primary', generation: 3, semantically_verified: 0 },
      { slot_id: 'primary', generation: 4, semantically_verified: 0 },
      { slot_id: 'primary', generation: 5, semantically_verified: 0 },
    ];
    if (JSON.stringify(generations) !== JSON.stringify(expectedGenerations)) {
      throw new Error(`unexpected post-cleanup save generations: ${JSON.stringify(generations)}`);
    }
    console.log(
      `[native-e2e-integrity] integrity_check=ok foreign_key_check=ok slots=3 generations=8 sessions=2 database=${resolvedPath}`,
    );
    return Object.freeze({ databasePath: resolvedPath, generations: 8, sessions: 2, slots: 3 });
  } finally {
    database.close();
  }
}

function useFreshNativeE2eProfile() {
  generatedProfileSequence += 1;
  const profile = `wdio-${process.pid}-${Date.now()}-${generatedProfileSequence}`;
  process.env[PROFILE_ENVIRONMENT_VARIABLE] = profile;
  return profile;
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

function wdioArgs(specs) {
  return [
    'exec',
    '--',
    'wdio',
    'run',
    'wdio.conf.mjs',
    ...specs.flatMap((spec) => ['--spec', spec]),
  ];
}

async function runNativeE2eAttempt(run) {
  const beforeRelaunch = await run(wdioArgs(PRE_RELAUNCH_SPECS));
  if (beforeRelaunch.code !== 0) return beforeRelaunch;

  // Ending the first WDIO launcher cleanly deletes its WebDriver session before the Tauri
  // service stops the embedded app. The second launcher then proves phase 4 against a real
  // cold process while retaining the same isolated SQLite profile.
  const afterRelaunch = await run(wdioArgs(POST_RELAUNCH_SPECS));
  // Return only the command that controls this attempt's outcome. In particular, a recovered
  // warning from the successful first launcher must never classify an unrelated phase-4
  // assertion failure as retryable infrastructure.
  return afterRelaunch;
}

export async function runNativeE2eCi(
  run = runNpm,
  logger = console,
  verifyDatabase = verifyNativeE2eDatabase,
) {
  if (run === runNpm && process.env[PROFILE_ENVIRONMENT_VARIABLE] === undefined) {
    useFreshNativeE2eProfile();
  }
  const build = await run(['run', 'build:e2e:desktop']);
  if (build.code !== 0) {
    return build.code;
  }

  const firstAttempt = await runNativeE2eAttempt(run);
  if (firstAttempt.code === 0) {
    try {
      await verifyDatabase();
      return 0;
    } catch (error) {
      logger.error(
        `[native-e2e-integrity] ${error instanceof Error ? error.message : 'unknown SQLite verification failure'}`,
      );
      return 1;
    }
  }

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
  if (run === runNpm) useFreshNativeE2eProfile();
  const secondAttempt = await runNativeE2eAttempt(run);
  if (secondAttempt.code !== 0) {
    logger.error('[native-e2e-ci] The single bounded infrastructure retry also failed.');
    return secondAttempt.code;
  }
  try {
    await verifyDatabase();
    return 0;
  } catch (error) {
    logger.error(
      `[native-e2e-integrity] ${error instanceof Error ? error.message : 'unknown SQLite verification failure'}`,
    );
    return 1;
  }
}

export async function runNativeE2eSingleAttempt(
  run = runNpm,
  logger = console,
  verifyDatabase = verifyNativeE2eDatabase,
) {
  if (run === runNpm && process.env[PROFILE_ENVIRONMENT_VARIABLE] === undefined) {
    useFreshNativeE2eProfile();
  }
  const build = await run(['run', 'build:e2e:desktop']);
  if (build.code !== 0) return build.code;
  const attempt = await runNativeE2eAttempt(run);
  if (attempt.code !== 0) return attempt.code;
  try {
    await verifyDatabase();
    return 0;
  } catch (error) {
    logger.error(
      `[native-e2e-integrity] ${error instanceof Error ? error.message : 'unknown SQLite verification failure'}`,
    );
    return 1;
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(path.resolve(entryPath)).href) {
  process.exitCode = process.argv.includes('--single-attempt')
    ? await runNativeE2eSingleAttempt()
    : await runNativeE2eCi();
}
