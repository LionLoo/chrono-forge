import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const FORMAT = 'chrono-forge-release-manifest';
const FORMAT_VERSION = 1;
const MANIFEST_PATH = 'release-artifacts/release-manifest.json';
const SBOM_PATH = 'release-artifacts/chrono-forge.cdx.json';
const INSTALLER_PATTERN = /^src-tauri\/target\/release\/bundle\/nsis\/[^/]+\.exe$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Release manifest ${label} must be a non-empty string.`);
  }
  return value;
}

function canonicalWorkspace(workspace) {
  return realpathSync(path.resolve(workspace));
}

function resolveArtifact(workspace, relativePath, kind) {
  requireString(relativePath, `${kind} path`);
  if (relativePath.includes('\\') || path.posix.normalize(relativePath) !== relativePath) {
    throw new Error(`Release manifest ${kind} path is not canonical: ${relativePath}`);
  }
  if (
    (kind === 'installer' && !INSTALLER_PATTERN.test(relativePath)) ||
    (kind === 'sbom' && relativePath !== SBOM_PATH)
  ) {
    throw new Error(`Release manifest ${kind} path is invalid: ${relativePath}`);
  }

  const root = canonicalWorkspace(workspace);
  const candidate = realpathSync(path.resolve(root, ...relativePath.split('/')));
  const relation = path.relative(root, candidate);
  if (relation.length === 0 || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new Error(`Release manifest ${kind} escapes the workspace: ${relativePath}`);
  }
  const canonicalRelative = relation.split(path.sep).join('/');
  if (canonicalRelative !== relativePath) {
    throw new Error(
      `Release manifest ${kind} path resolves unexpectedly: ${relativePath} -> ${canonicalRelative}`,
    );
  }
  return candidate;
}

function artifactEvidence(workspace, relativePath, kind) {
  const absolutePath = resolveArtifact(workspace, relativePath, kind);
  const contents = readFileSync(absolutePath);
  return Object.freeze({
    absolutePath,
    bytes: contents.byteLength,
    path: relativePath,
    sha256: sha256(contents),
  });
}

function validateArtifactRecord(workspace, record, kind) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`Release manifest ${kind} record is invalid.`);
  }
  const expected = artifactEvidence(workspace, record.path, kind);
  if (!Number.isSafeInteger(record.bytes) || record.bytes < 1) {
    throw new Error(`Release manifest ${kind} byte count is invalid.`);
  }
  if (typeof record.sha256 !== 'string' || !HASH_PATTERN.test(record.sha256)) {
    throw new Error(`Release manifest ${kind} SHA-256 is invalid.`);
  }
  if (record.bytes !== expected.bytes || record.sha256 !== expected.sha256) {
    throw new Error(
      `Release manifest ${kind} does not match ${record.path}: expected ${record.bytes} bytes/${record.sha256}, found ${expected.bytes} bytes/${expected.sha256}.`,
    );
  }
  return expected;
}

export function createReleaseManifest({
  commit,
  installerPath,
  packageVersion,
  sbomPath = SBOM_PATH,
  workspace = process.cwd(),
}) {
  if (typeof commit !== 'string' || !COMMIT_PATTERN.test(commit)) {
    throw new Error('Release manifest source commit must be a lowercase 40-character Git hash.');
  }
  requireString(packageVersion, 'package version');
  const installer = artifactEvidence(workspace, installerPath, 'installer');
  const sbom = artifactEvidence(workspace, sbomPath, 'sbom');
  return Object.freeze({
    artifacts: {
      installer: { bytes: installer.bytes, path: installer.path, sha256: installer.sha256 },
      sbom: { bytes: sbom.bytes, path: sbom.path, sha256: sbom.sha256 },
    },
    commit,
    format: FORMAT,
    packageVersion,
    version: FORMAT_VERSION,
  });
}

export function loadReleaseManifest({
  expectedCommit,
  expectedPackageVersion,
  manifestPath = MANIFEST_PATH,
  workspace = process.cwd(),
}) {
  if (typeof expectedCommit !== 'string' || !COMMIT_PATTERN.test(expectedCommit)) {
    throw new Error('Expected release commit must be a lowercase 40-character Git hash.');
  }
  requireString(expectedPackageVersion, 'expected package version');
  if (manifestPath !== MANIFEST_PATH) {
    throw new Error(`Release manifest must use ${MANIFEST_PATH}.`);
  }
  const absoluteManifestPath = resolveArtifact(workspace, manifestPath, 'manifest');
  const manifestContents = readFileSync(absoluteManifestPath);
  let manifest;
  try {
    manifest = JSON.parse(manifestContents.toString('utf8'));
  } catch (error) {
    throw new Error(`Release manifest is not valid JSON: ${absoluteManifestPath}`, {
      cause: error,
    });
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Release manifest root is invalid.');
  }
  if (manifest.format !== FORMAT || manifest.version !== FORMAT_VERSION) {
    throw new Error('Release manifest format or version is unsupported.');
  }
  if (manifest.commit !== expectedCommit) {
    throw new Error(
      `Release artifact commit ${String(manifest.commit)} does not match checked-out commit ${expectedCommit}.`,
    );
  }
  if (manifest.packageVersion !== expectedPackageVersion) {
    throw new Error(
      `Release artifact package version ${String(manifest.packageVersion)} does not match ${expectedPackageVersion}.`,
    );
  }
  if (
    manifest.artifacts === null ||
    typeof manifest.artifacts !== 'object' ||
    Array.isArray(manifest.artifacts)
  ) {
    throw new Error('Release manifest artifacts record is invalid.');
  }
  const installer = validateArtifactRecord(workspace, manifest.artifacts.installer, 'installer');
  const sbom = validateArtifactRecord(workspace, manifest.artifacts.sbom, 'sbom');
  return Object.freeze({
    artifactCommit: manifest.commit,
    installer,
    manifest: Object.freeze({
      absolutePath: absoluteManifestPath,
      bytes: manifestContents.byteLength,
      path: manifestPath,
      sha256: sha256(manifestContents),
    }),
    packageVersion: manifest.packageVersion,
    sbom,
  });
}

function repositoryValue(args) {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
}

function releaseSource() {
  const status = repositoryValue(['status', '--porcelain=v1', '--untracked-files=all']);
  if (status.length > 0) {
    throw new Error('Release manifest generation requires a clean Git worktree.');
  }
  const commit = repositoryValue(['rev-parse', 'HEAD']);
  if (!COMMIT_PATTERN.test(commit)) {
    throw new Error(`Git returned an invalid release source commit: ${commit}`);
  }
  return commit;
}

export function cleanReleaseArtifacts(workspace = process.cwd()) {
  const root = canonicalWorkspace(workspace);
  const generatedDirectories = [
    path.join(root, 'release-artifacts'),
    path.join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis'),
  ];
  for (const directory of generatedDirectories) {
    const relation = path.relative(root, directory);
    if (
      relation.length === 0 ||
      relation.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relation)
    ) {
      throw new Error(`Generated release directory escapes the workspace: ${directory}`);
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

function writeReleaseManifest() {
  const workspace = canonicalWorkspace(process.cwd());
  const commit = releaseSource();
  const packageJson = JSON.parse(readFileSync(path.join(workspace, 'package.json'), 'utf8'));
  const installerDirectory = path.join(
    workspace,
    'src-tauri',
    'target',
    'release',
    'bundle',
    'nsis',
  );
  const installerNames = readdirSync(installerDirectory)
    .filter((name) => name.toLowerCase().endsWith('.exe'))
    .sort();
  if (installerNames.length !== 1) {
    throw new Error(`Expected exactly one NSIS installer; found ${installerNames.length}.`);
  }
  const installerPath = path
    .relative(workspace, path.join(installerDirectory, installerNames[0]))
    .split(path.sep)
    .join('/');
  const manifest = createReleaseManifest({
    commit,
    installerPath,
    packageVersion: packageJson.version,
    workspace,
  });
  const outputPath = path.join(workspace, ...MANIFEST_PATH.split('/'));
  mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    renameSync(temporaryPath, outputPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  process.stdout.write(`Wrote ${MANIFEST_PATH} for ${commit}.\n`);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  if (process.argv[2] === '--check-source') {
    process.stdout.write(`Release source is clean at ${releaseSource()}.\n`);
  } else if (process.argv[2] === '--clean') {
    cleanReleaseArtifacts();
    process.stdout.write('Removed prior generated release artifacts.\n');
  } else if (process.argv.length === 2) {
    writeReleaseManifest();
  } else {
    throw new Error('Usage: node scripts/release-manifest.mjs [--check-source|--clean]');
  }
}
