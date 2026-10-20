import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium } from '@playwright/test';

import { isInstalledPlayerPageUrl, waitForInstalledPlayerPage } from './installed-player-page.mjs';
import { loadReleaseManifest } from './release-manifest.mjs';

const APPLICATION_IDENTIFIER = 'com.lionloo.chronoforge';
const INSTALLED_STARTUP_TIMEOUT_MS = 60_000;
const MAX_DIAGNOSTIC_TARGET_URLS = 8;
const PROFILE_PATTERN = /^m11-rc-[a-z0-9-]{1,48}$/u;
const EXPECTED_SLOT_IDS = Object.freeze([
  'installed-crisis-review',
  'installed-mature-review',
  'm9-contacted',
  'm9-mid-flight',
  'primary',
]);

function delay(milliseconds) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

export function validatedChildPath(parent, child) {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  const relative = path.relative(resolvedParent, resolvedChild);
  if (relative.length === 0 || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Expected a child of ${resolvedParent}; received ${resolvedChild}.`);
  }
  return resolvedChild;
}

export function releaseCandidateOutputDirectory(requestedOutput, workspace = process.cwd()) {
  const outputRoot = path.resolve(workspace, 'test-results');
  const outputDirectory = validatedChildPath(outputRoot, path.resolve(workspace, requestedOutput));
  if (path.dirname(outputDirectory) !== outputRoot) {
    throw new Error(`Release-candidate output must be a direct child of ${outputRoot}.`);
  }
  return outputDirectory;
}

export function releaseCandidateArtifactDirectory(requestedRoot, workspace = process.cwd()) {
  const artifactRoot = releaseCandidateOutputDirectory(requestedRoot, workspace);
  if (!existsSync(artifactRoot)) {
    throw new Error(`Release-candidate artifact root does not exist: ${artifactRoot}`);
  }
  const canonicalArtifactRoot = realpathSync(artifactRoot);
  const canonicalTestResultsRoot = realpathSync(path.resolve(workspace, 'test-results'));
  if (path.dirname(canonicalArtifactRoot) !== canonicalTestResultsRoot) {
    throw new Error(
      `Release-candidate artifact root resolves outside test-results: ${artifactRoot}`,
    );
  }
  return canonicalArtifactRoot;
}

export function selectSingleInstaller(paths) {
  const installers = paths.filter((candidate) => candidate.toLowerCase().endsWith('.exe')).sort();
  if (installers.length !== 1) {
    throw new Error(`Expected exactly one NSIS installer; found ${installers.length}.`);
  }
  return installers[0];
}

export function checksumLine(hash, filename) {
  if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error('Installer SHA-256 must be lowercase hex.');
  if (filename.length === 0 || /[\r\n]/u.test(filename))
    throw new Error('Installer filename is invalid.');
  return `${hash}  ${filename}\n`;
}

function sha256Value(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function verifiedSaveGeneration(row) {
  const { checksum, generation, slotId, snapshot } = row;
  if (
    typeof slotId !== 'string' ||
    slotId.length === 0 ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    typeof checksum !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(checksum) ||
    typeof snapshot !== 'string'
  ) {
    throw new Error(`Installed archive contains invalid generation data: ${JSON.stringify(row)}`);
  }
  const computedChecksum = sha256Value(snapshot);
  if (computedChecksum !== checksum) {
    throw new Error(
      `Installed archive generation ${slotId}:${generation} failed its stored checksum.`,
    );
  }
  return Object.freeze({ checksum, generation, slotId });
}

export function assertArchiveContinuity(before, after) {
  const reject = (reason) => {
    throw new Error(
      `Installed archive changed unexpectedly across uninstall/reinstall (${reason}): ${JSON.stringify({ before, after })}`,
    );
  };
  if (after.activeSlotId !== before.activeSlotId) reject('active slot changed');
  if (after.sessions !== before.sessions) reject('focus-session count changed');
  if (after.slots.length !== before.slots.length) reject('slot count changed');

  const afterSlots = new Map(after.slots.map((slot) => [slot.slotId, slot]));
  for (const beforeSlot of before.slots) {
    const afterSlot = afterSlots.get(beforeSlot.slotId);
    if (afterSlot === undefined || afterSlot.name !== beforeSlot.name) {
      reject(`slot ${beforeSlot.slotId} changed or disappeared`);
    }
    const expectedHead =
      beforeSlot.slotId === before.activeSlotId
        ? beforeSlot.headGeneration + 1
        : beforeSlot.headGeneration;
    if (afterSlot.headGeneration !== expectedHead) {
      reject(`slot ${beforeSlot.slotId} advanced unexpectedly`);
    }
  }

  // Loading the reinstalled app intentionally applies bounded offline progression and commits
  // exactly one new active-world generation. Continuity means every prior immutable generation
  // remains byte-identical and that this single expected checkpoint is the only addition.
  if (after.generations !== before.generations + 1) reject('generation count did not advance once');
  const afterGenerations = new Map(
    after.saveGenerations.map((generation) => [
      `${generation.slotId}:${generation.generation}`,
      generation,
    ]),
  );
  for (const beforeGeneration of before.saveGenerations) {
    const identity = `${beforeGeneration.slotId}:${beforeGeneration.generation}`;
    const afterGeneration = afterGenerations.get(identity);
    if (afterGeneration?.checksum !== beforeGeneration.checksum) {
      reject(`generation ${identity} changed or disappeared`);
    }
    afterGenerations.delete(identity);
  }
  const added = [...afterGenerations.values()];
  const activeBefore = before.slots.find((slot) => slot.slotId === before.activeSlotId);
  if (
    activeBefore === undefined ||
    added.length !== 1 ||
    added[0]?.slotId !== before.activeSlotId ||
    added[0]?.generation !== activeBefore.headGeneration + 1
  ) {
    reject('reinstall added anything other than one active-world checkpoint');
  }
}

function sha256(file) {
  return sha256Value(readFileSync(file));
}

export async function awaitLaunchReadiness(readiness, cleanup) {
  try {
    await readiness;
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Installed application readiness failed and its process cleanup also failed.',
        { cause: cleanupError },
      );
    }
    throw error;
  }
}

function repositoryCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

async function runProgram(file, args, { environment = process.env, cwd = process.cwd() } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env: environment,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code: code ?? 1, output, signal }));
  });
}

async function runRequiredProgram(file, args, options) {
  const result = await runProgram(file, args, options);
  if (result.code !== 0) {
    throw new Error(
      `${path.basename(file)} exited ${result.code}${result.signal ? ` (${result.signal})` : ''}.`,
    );
  }
  return result;
}

async function waitForFileAbsent(file, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (existsSync(file)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for removal of ${file}.`);
    await delay(100);
  }
}

async function availableLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : undefined;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (port === undefined) throw new Error('Could not reserve a loopback diagnostics port.');
  return port;
}

async function readCdpTargetsBeforeDeadline(fetchImplementation, url, timeoutMs) {
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      controller.abort();
      reject(new Error('Installed Chrono Forge diagnostics probe timed out.'));
    }, timeoutMs);
    let requestAndBody;
    try {
      requestAndBody = Promise.resolve(
        fetchImplementation(url, { signal: controller.signal }),
      ).then(async (response) => ({
        ok: response.ok,
        targets: response.ok ? await response.json() : null,
      }));
    } catch (error) {
      globalThis.clearTimeout(timeout);
      reject(error);
      return;
    }
    requestAndBody.then(
      (result) => {
        globalThis.clearTimeout(timeout);
        resolve(result);
      },
      (error) => {
        globalThis.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export async function waitForCdp(
  endpoint,
  child,
  timeoutMs = INSTALLED_STARTUP_TIMEOUT_MS,
  fetchImplementation = fetch,
) {
  const deadline = Date.now() + timeoutMs;
  const observedPageUrls = new Set();
  let lastProbeFailure;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Installed Chrono Forge exited before diagnostics were ready (${child.exitCode}).`,
      );
    }
    try {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      const { ok, targets } = await readCdpTargetsBeforeDeadline(
        fetchImplementation,
        `${endpoint}/json/list`,
        remainingMs,
      );
      if (ok) {
        if (Array.isArray(targets)) {
          for (const target of targets) {
            if (target?.type !== 'page' || typeof target.url !== 'string') continue;
            if (observedPageUrls.size < MAX_DIAGNOSTIC_TARGET_URLS) {
              observedPageUrls.add(target.url.replace(/[\r\n]/gu, '').slice(0, 240));
            }
            if (isInstalledPlayerPageUrl(target.url)) return;
          }
        }
      }
    } catch (error) {
      // The endpoint is expected to refuse connections until WebView2 is ready.
      lastProbeFailure =
        error instanceof Error
          ? error.message.replace(/[\r\n]/gu, ' ').slice(0, 240)
          : String(error)
              .replace(/[\r\n]/gu, ' ')
              .slice(0, 240);
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await delay(Math.min(100, remainingMs));
  }
  const diagnostic =
    observedPageUrls.size > 0
      ? ` Observed page targets: ${JSON.stringify([...observedPageUrls])}.`
      : lastProbeFailure === undefined
        ? ' No page targets were observed.'
        : ` No page targets were observed; last diagnostics probe failed: ${lastProbeFailure}.`;
  throw new Error(
    `Installed Chrono Forge did not expose its player page before the deadline.${diagnostic}`,
  );
}

async function launchInstalledApplication(executable, profile) {
  const port = await availableLoopbackPort();
  const endpoint = `http://127.0.0.1:${port}`;
  const child = spawn(executable, [], {
    cwd: path.dirname(executable),
    env: {
      ...process.env,
      CHRONO_FORGE_PROFILE: profile,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  let rejectSpawnError;
  const spawnError = new Promise((_, reject) => {
    rejectSpawnError = reject;
  });
  const onSpawnError = (error) => rejectSpawnError(error);
  child.once('error', onSpawnError);
  try {
    await awaitLaunchReadiness(Promise.race([waitForCdp(endpoint, child), spawnError]), () =>
      stopProcessTree(child),
    );
  } finally {
    child.removeListener('error', onSpawnError);
  }
  return { child, endpoint };
}

async function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    const onClose = () => {
      globalThis.clearTimeout(timeout);
      resolve(true);
    };
    const timeout = globalThis.setTimeout(() => {
      child.removeListener('close', onClose);
      resolve(child.exitCode !== null || child.signalCode !== null);
    }, timeoutMs);
    child.once('close', onClose);
  });
}

export async function ensureProcessTreeStopped(child, waitForExit, forceKill) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (child.pid === undefined) {
    throw new Error('Installed application remained live without a process ID for forced cleanup.');
  }

  // Kill the complete Windows process tree while the host PID still exists. Killing the host
  // first can make it exit before taskkill enumerates its WebView2 descendants, leaving those
  // children alive and holding the isolated profile or installer files.
  await forceKill(child.pid);
  if (!(await waitForExit())) {
    throw new Error(
      `Installed application process tree ${child.pid} remained live after taskkill.`,
    );
  }
}

async function stopProcessTree(child) {
  await ensureProcessTreeStopped(
    child,
    () => waitForChildExit(child, 5_000),
    async (pid) => {
      await runRequiredProgram('taskkill.exe', ['/PID', String(pid), '/T', '/F']);
    },
  );
}

async function installedPlayerPage(browser) {
  const context = browser.contexts()[0];
  if (context === undefined) throw new Error('Installed candidate exposed no browser context.');
  const page = await waitForInstalledPlayerPage(context, INSTALLED_STARTUP_TIMEOUT_MS);
  if (page !== undefined) return page;
  throw new Error('Installed candidate exposed no player page.');
}

async function checkpointInstalledWorld(endpoint) {
  const browser = await chromium.connectOverCDP(endpoint);
  try {
    const page = await installedPlayerPage(browser);
    await page.locator('.simulation-status').getByText('Worker projection ready').waitFor({
      state: 'visible',
      timeout: 30_000,
    });
    const slot = page.getByRole('combobox', { name: 'Load local slot' });
    const activeSlotId = await slot.inputValue();
    const activeSlotName = (await slot.locator('option:checked').innerText()).trim();
    await page.getByRole('button', { name: 'Save now' }).click();
    await page.getByText('World saved manually.').waitFor({ state: 'visible', timeout: 30_000 });
    return Object.freeze({ activeSlotId, activeSlotName });
  } finally {
    await browser.close();
  }
}

function archiveEvidence(databasePath) {
  if (!existsSync(databasePath)) throw new Error(`Installed archive is missing: ${databasePath}`);
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const integrity = database.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
      throw new Error(`SQLite integrity_check failed: ${JSON.stringify(integrity)}`);
    }
    const foreignKeys = database.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeys.length !== 0) {
      throw new Error(`SQLite foreign_key_check failed: ${JSON.stringify(foreignKeys)}`);
    }
    const slots = database
      .prepare(
        'SELECT slot_id AS slotId, name, head_generation AS headGeneration FROM save_slots ORDER BY slot_id ASC',
      )
      .all();
    const slotIds = slots.map(({ slotId }) => slotId);
    if (JSON.stringify(slotIds) !== JSON.stringify(EXPECTED_SLOT_IDS)) {
      throw new Error(`Installed review produced unexpected slots: ${JSON.stringify(slotIds)}`);
    }
    if (slots.some(({ headGeneration }) => !Number.isSafeInteger(headGeneration))) {
      throw new Error(
        `Installed review left a slot without a valid head: ${JSON.stringify(slots)}`,
      );
    }
    const settings = database
      .prepare('SELECT active_slot_id AS activeSlotId FROM app_settings')
      .get();
    if (settings?.activeSlotId !== 'm9-contacted') {
      throw new Error(
        `Installed review retained the wrong active slot: ${JSON.stringify(settings)}`,
      );
    }
    const counts = database
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM save_generations) AS generations,
           (SELECT COUNT(*) FROM focus_sessions) AS sessions`,
      )
      .get();
    const saveGenerationRows = database
      .prepare(
        `SELECT slot_id AS slotId, generation, checksum, snapshot
         FROM save_generations
         ORDER BY slot_id ASC, generation ASC`,
      )
      .all();
    const saveGenerations = saveGenerationRows.map(verifiedSaveGeneration);
    if (!Number.isSafeInteger(counts?.generations) || counts.generations < slots.length) {
      throw new Error(`Installed review retained too few generations: ${JSON.stringify(counts)}`);
    }
    if (saveGenerations.length !== counts.generations) {
      throw new Error(
        `Installed review retained invalid generation evidence: ${JSON.stringify(saveGenerations)}`,
      );
    }
    if (!Number.isSafeInteger(counts?.sessions) || counts.sessions < 1) {
      throw new Error(`Installed review retained no focus session: ${JSON.stringify(counts)}`);
    }
    return Object.freeze({
      activeSlotId: settings.activeSlotId,
      generations: counts.generations,
      integrityCheck: 'ok',
      saveGenerations,
      sessions: counts.sessions,
      slots,
    });
  } finally {
    database.close();
  }
}

async function verifyReinstalledUi(endpoint, screenshotPath) {
  const browser = await chromium.connectOverCDP(endpoint);
  try {
    const page = await installedPlayerPage(browser);
    await page.locator('.simulation-status').getByText('Worker projection ready').waitFor({
      state: 'visible',
      timeout: 30_000,
    });
    const slot = page.getByRole('combobox', { name: 'Load local slot' });
    if ((await slot.inputValue()) !== 'm9-contacted') {
      throw new Error(
        `Reinstalled candidate loaded unexpected slot ${(await slot.inputValue()).trim()}.`,
      );
    }
    const selectedName = (await slot.locator('option:checked').innerText()).trim();
    if (selectedName !== 'M9 contacted world') {
      throw new Error(`Reinstalled candidate displayed unexpected slot name ${selectedName}.`);
    }
    await page.screenshot({ path: screenshotPath });
    return Object.freeze({
      activeSlotId: 'm9-contacted',
      activeSlotName: selectedName,
      dimensions: (await page.locator('.world-heading-status').innerText()).trim(),
    });
  } finally {
    await browser.close();
  }
}

function profileDirectory(profile) {
  if (!PROFILE_PATTERN.test(profile)) throw new Error(`Invalid M11 profile name: ${profile}`);
  const localData = process.env.LOCALAPPDATA;
  if (localData === undefined || localData.length === 0) {
    throw new Error('LOCALAPPDATA is unavailable.');
  }
  const profileRoot = path.resolve(localData, APPLICATION_IDENTIFIER, 'profiles');
  return validatedChildPath(profileRoot, path.join(profileRoot, profile));
}

async function runInstalledReleaseCandidate() {
  if (process.platform !== 'win32') {
    throw new Error('The installed release-candidate verifier requires Windows.');
  }
  const npmCli = process.env.npm_execpath;
  if (npmCli === undefined) {
    throw new Error('Run through `npm run verify:installed-release-candidate`.');
  }
  const workspaceDirectory = realpathSync(process.cwd());
  const commit = repositoryCommit();
  const packageVersion = JSON.parse(
    readFileSync(path.join(workspaceDirectory, 'package.json'), 'utf8'),
  ).version;
  const requestedArtifactRoot = process.env.CHRONO_FORGE_RC_ARTIFACT_ROOT;
  const artifactWorkspace =
    requestedArtifactRoot === undefined
      ? workspaceDirectory
      : releaseCandidateArtifactDirectory(requestedArtifactRoot, workspaceDirectory);
  const releaseManifest = loadReleaseManifest({
    expectedCommit: commit,
    expectedPackageVersion: packageVersion,
    workspace: artifactWorkspace,
  });
  const installerDirectory = path.join(
    artifactWorkspace,
    'src-tauri',
    'target',
    'release',
    'bundle',
    'nsis',
  );
  const installerName = selectSingleInstaller(
    readdirSync(installerDirectory).map((name) => path.join(installerDirectory, name)),
  );
  if (realpathSync(installerName) !== releaseManifest.installer.absolutePath) {
    throw new Error(
      `Release manifest installer ${releaseManifest.installer.path} does not match ${installerName}.`,
    );
  }
  const outputRoot = path.resolve(workspaceDirectory, 'test-results');
  mkdirSync(outputRoot, { recursive: true });
  validatedChildPath(workspaceDirectory, realpathSync(outputRoot));
  const outputDirectory = releaseCandidateOutputDirectory(
    process.env.CHRONO_FORGE_RC_OUTPUT ??
      path.join('test-results', `m11-release-candidate-${Date.now()}`),
    workspaceDirectory,
  );
  if (existsSync(outputDirectory) && readdirSync(outputDirectory).length > 0) {
    throw new Error(`Release-candidate output directory is not empty: ${outputDirectory}`);
  }
  mkdirSync(outputDirectory, { recursive: true });
  validatedChildPath(realpathSync(outputRoot), realpathSync(outputDirectory));
  const installDirectory = validatedChildPath(
    outputDirectory,
    path.join(outputDirectory, 'installed'),
  );
  const reviewDirectory = validatedChildPath(outputDirectory, path.join(outputDirectory, 'review'));
  const reportPath = validatedChildPath(
    outputDirectory,
    path.join(outputDirectory, 'installed-release-candidate.json'),
  );
  const reinstallScreenshot = validatedChildPath(
    outputDirectory,
    path.join(outputDirectory, 'reinstalled-continuity.png'),
  );
  const profile = `m11-rc-${randomBytes(8).toString('hex')}`;
  const isolatedProfileDirectory = profileDirectory(profile);
  if (existsSync(isolatedProfileDirectory)) {
    throw new Error(`Generated M11 profile unexpectedly exists: ${isolatedProfileDirectory}`);
  }
  const databasePath = validatedChildPath(
    isolatedProfileDirectory,
    path.join(isolatedProfileDirectory, 'chrono-forge.sqlite3'),
  );
  const installedExecutable = validatedChildPath(
    installDirectory,
    path.join(installDirectory, 'chrono-forge.exe'),
  );
  const uninstaller = validatedChildPath(
    installDirectory,
    path.join(installDirectory, 'uninstall.exe'),
  );
  const installerHash = sha256(installerName);
  const installerBytes = statSync(installerName).size;
  if (
    installerHash !== releaseManifest.installer.sha256 ||
    installerBytes !== releaseManifest.installer.bytes
  ) {
    throw new Error('Release installer changed after manifest validation.');
  }
  const checksumPath = validatedChildPath(
    outputDirectory,
    path.join(outputDirectory, `${path.basename(installerName)}.sha256`),
  );
  writeFileSync(checksumPath, checksumLine(installerHash, path.basename(installerName)), 'utf8');

  let application;
  let installed = false;
  let successful = false;
  try {
    await runRequiredProgram(installerName, ['/S', `/D=${installDirectory}`]);
    installed = true;
    if (!existsSync(installedExecutable) || !existsSync(uninstaller)) {
      throw new Error('NSIS installation did not produce the application and uninstaller.');
    }
    const installedExecutableEvidence = Object.freeze({
      bytes: statSync(installedExecutable).size,
      sha256: sha256(installedExecutable),
    });

    application = await launchInstalledApplication(installedExecutable, profile);
    await runRequiredProgram(process.execPath, [npmCli, 'run', 'capture:installed-review'], {
      environment: {
        ...process.env,
        CHRONO_FORGE_CDP_URL: application.endpoint,
        CHRONO_FORGE_REVIEW_OUTPUT: reviewDirectory,
      },
    });
    const canonicalCheckpoint = await checkpointInstalledWorld(application.endpoint);
    if (
      canonicalCheckpoint.activeSlotId !== 'm9-contacted' ||
      canonicalCheckpoint.activeSlotName !== 'M9 contacted world'
    ) {
      throw new Error(
        `Installed review checkpointed the wrong world: ${JSON.stringify(canonicalCheckpoint)}`,
      );
    }
    await stopProcessTree(application.child);
    application = undefined;
    const beforeUninstall = archiveEvidence(databasePath);

    await runRequiredProgram(uninstaller, ['/S']);
    installed = false;
    await waitForFileAbsent(installedExecutable);
    if (!existsSync(databasePath)) {
      throw new Error('NSIS uninstall unexpectedly removed the isolated local archive.');
    }

    await runRequiredProgram(installerName, ['/S', `/D=${installDirectory}`]);
    installed = true;
    application = await launchInstalledApplication(installedExecutable, profile);
    const reinstalledUi = await verifyReinstalledUi(application.endpoint, reinstallScreenshot);
    await stopProcessTree(application.child);
    application = undefined;
    const afterReinstall = archiveEvidence(databasePath);
    assertArchiveContinuity(beforeUninstall, afterReinstall);

    await runRequiredProgram(uninstaller, ['/S']);
    installed = false;
    await waitForFileAbsent(installedExecutable);
    if (!existsSync(databasePath)) {
      throw new Error('Final uninstall unexpectedly removed the isolated local archive.');
    }

    const report = Object.freeze({
      archiveAfterReinstall: afterReinstall,
      archiveBeforeUninstall: beforeUninstall,
      canonicalCheckpoint,
      artifactRoot:
        artifactWorkspace === workspaceDirectory
          ? '.'
          : path.relative(workspaceDirectory, artifactWorkspace).split(path.sep).join('/'),
      artifactCommit: releaseManifest.artifactCommit,
      commit,
      installedExecutable: installedExecutableEvidence,
      installer: {
        bytes: installerBytes,
        filename: path.basename(installerName),
        sha256: installerHash,
      },
      releaseManifest: {
        bytes: releaseManifest.manifest.bytes,
        path: releaseManifest.manifest.path,
        sha256: releaseManifest.manifest.sha256,
      },
      sbom: {
        bytes: releaseManifest.sbom.bytes,
        path: releaseManifest.sbom.path,
        sha256: releaseManifest.sbom.sha256,
      },
      profile,
      profilePreservedAcrossUninstall: true,
      reinstalledUi,
      reviewDirectory,
      version: 1,
    });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    successful = true;
    console.log(`Installed release-candidate verification passed and wrote ${reportPath}.`);
  } finally {
    if (application !== undefined) await stopProcessTree(application.child);
    if (installed && existsSync(uninstaller)) {
      await runProgram(uninstaller, ['/S']);
      await waitForFileAbsent(installedExecutable).catch(() => undefined);
    }
    if (successful) {
      rmSync(profileDirectory(profile), { recursive: true, force: true });
    }
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  await runInstalledReleaseCandidate();
}
