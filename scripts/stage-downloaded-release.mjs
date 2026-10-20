import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { loadReleaseManifest } from './release-manifest.mjs';

const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const MANIFEST_NAME = 'release-manifest.json';
const SBOM_NAME = 'chrono-forge.cdx.json';

function sha256File(filename) {
  return createHash('sha256').update(readFileSync(filename)).digest('hex');
}

function directTestResultsChild(requestedPath, workspace, { mustExist }) {
  const workspaceRoot = realpathSync(path.resolve(workspace));
  const testResultsRoot = path.join(workspaceRoot, 'test-results');
  mkdirSync(testResultsRoot, { recursive: true });
  const canonicalTestResultsRoot = realpathSync(testResultsRoot);
  const requested = path.resolve(workspaceRoot, requestedPath);
  if (path.dirname(requested) !== canonicalTestResultsRoot) {
    throw new Error(
      `Downloaded release paths must be direct children of ${canonicalTestResultsRoot}: ${requested}`,
    );
  }
  if (!existsSync(requested)) {
    if (mustExist) throw new Error(`Downloaded release path does not exist: ${requested}`);
    return requested;
  }
  const canonicalRequested = realpathSync(requested);
  if (
    path.dirname(canonicalRequested) !== canonicalTestResultsRoot ||
    canonicalRequested !== requested
  ) {
    throw new Error(`Downloaded release path resolves outside test-results: ${requested}`);
  }
  return canonicalRequested;
}

function requireExactAssets(downloadDirectory) {
  const entries = readdirSync(downloadDirectory, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile())) {
    throw new Error('Downloaded release directory may contain regular files only.');
  }
  const names = entries.map((entry) => entry.name).sort();
  const installers = names.filter((name) => name.toLowerCase().endsWith('.exe'));
  if (installers.length !== 1) {
    throw new Error(`Expected exactly one downloaded installer; found ${installers.length}.`);
  }
  const installerName = installers[0];
  const checksumName = `${installerName}.sha256`;
  const expected = [MANIFEST_NAME, SBOM_NAME, checksumName, installerName].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(
      `Downloaded release assets do not match the exact release contract: ${JSON.stringify(names)}.`,
    );
  }
  return Object.freeze({ checksumName, installerName });
}

function verifyChecksum(downloadDirectory, installerName, checksumName) {
  const checksumContents = readFileSync(path.join(downloadDirectory, checksumName), 'utf8');
  const match = checksumContents.match(/^([a-f0-9]{64}) {2}([^\r\n]+)\r?\n?$/u);
  if (match === null || !HASH_PATTERN.test(match[1]) || match[2] !== installerName) {
    throw new Error('Downloaded installer checksum file is malformed or names another asset.');
  }
  const actual = sha256File(path.join(downloadDirectory, installerName));
  if (actual !== match[1]) {
    throw new Error(
      `Downloaded installer checksum mismatch: expected ${match[1]}, found ${actual}.`,
    );
  }
  return actual;
}

export function stageDownloadedRelease({
  commit,
  downloadPath,
  packageVersion,
  stagingPath,
  workspace = process.cwd(),
}) {
  if (typeof commit !== 'string' || !COMMIT_PATTERN.test(commit)) {
    throw new Error('Downloaded release verification requires an exact lowercase commit hash.');
  }
  if (typeof packageVersion !== 'string' || packageVersion.length === 0) {
    throw new Error('Downloaded release verification requires a package version.');
  }
  const downloadDirectory = directTestResultsChild(downloadPath, workspace, { mustExist: true });
  const stagingDirectory = directTestResultsChild(stagingPath, workspace, { mustExist: false });
  if (downloadDirectory === stagingDirectory) {
    throw new Error('Downloaded and staged release directories must be different.');
  }
  if (existsSync(stagingDirectory) && readdirSync(stagingDirectory).length > 0) {
    throw new Error(`Staged release directory is not empty: ${stagingDirectory}`);
  }

  const { checksumName, installerName } = requireExactAssets(downloadDirectory);
  const installerSha256 = verifyChecksum(downloadDirectory, installerName, checksumName);
  const installerRelativePath = path.join(
    'src-tauri',
    'target',
    'release',
    'bundle',
    'nsis',
    installerName,
  );
  const stagedFiles = [
    [MANIFEST_NAME, path.join('release-artifacts', MANIFEST_NAME)],
    [SBOM_NAME, path.join('release-artifacts', SBOM_NAME)],
    [checksumName, path.join('release-artifacts', checksumName)],
    [installerName, installerRelativePath],
  ];

  try {
    mkdirSync(stagingDirectory, { recursive: true });
    for (const [sourceName, destinationRelativePath] of stagedFiles) {
      const destination = path.join(stagingDirectory, destinationRelativePath);
      mkdirSync(path.dirname(destination), { recursive: true });
      copyFileSync(path.join(downloadDirectory, sourceName), destination);
    }
    const manifest = loadReleaseManifest({
      expectedCommit: commit,
      expectedPackageVersion: packageVersion,
      workspace: stagingDirectory,
    });
    if (manifest.installer.sha256 !== installerSha256) {
      throw new Error('Downloaded checksum and release manifest disagree about the installer.');
    }
    return Object.freeze({
      artifactCommit: manifest.artifactCommit,
      installer: Object.freeze({
        bytes: manifest.installer.bytes,
        filename: installerName,
        sha256: installerSha256,
      }),
      manifest: Object.freeze({
        bytes: manifest.manifest.bytes,
        sha256: manifest.manifest.sha256,
      }),
      packageVersion: manifest.packageVersion,
      sbom: Object.freeze({ bytes: manifest.sbom.bytes, sha256: manifest.sbom.sha256 }),
      stagingDirectory,
    });
  } catch (error) {
    rmSync(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

function repositoryCommit() {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
  if (!COMMIT_PATTERN.test(commit)) throw new Error(`Git returned an invalid commit: ${commit}`);
  return commit;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  if (process.argv.length !== 4) {
    throw new Error(
      'Usage: node scripts/stage-downloaded-release.mjs <download-path> <staging-path>',
    );
  }
  const packageVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const result = stageDownloadedRelease({
    commit: repositoryCommit(),
    downloadPath: process.argv[2],
    packageVersion,
    stagingPath: process.argv[3],
  });
  process.stdout.write(`Downloaded release verified and staged: ${JSON.stringify(result)}\n`);
}
