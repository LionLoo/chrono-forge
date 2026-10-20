import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createReleaseManifest,
  loadReleaseManifest,
  type ReleaseManifestDocument,
} from '../../scripts/release-manifest.mjs';

const COMMIT = 'a'.repeat(40);
const PACKAGE_VERSION = '0.1.0';
const INSTALLER_PATH = 'src-tauri/target/release/bundle/nsis/Chrono Forge_0.1.0_x64-setup.exe';
const SBOM_PATH = 'release-artifacts/chrono-forge.cdx.json';
const MANIFEST_PATH = 'release-artifacts/release-manifest.json';

describe('release artifact manifest', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(path.join(tmpdir(), 'chrono-forge-release-manifest-'));
    writeArtifact(INSTALLER_PATH, 'installer-v1');
    writeArtifact(SBOM_PATH, '{"bomFormat":"CycloneDX"}\n');
  });

  afterEach(() => {
    rmSync(workspace, { force: true, recursive: true });
  });

  function writeArtifact(relativePath: string, contents: string): void {
    const target = path.join(workspace, ...relativePath.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents, 'utf8');
  }

  function manifest(): ReleaseManifestDocument {
    return createReleaseManifest({
      commit: COMMIT,
      installerPath: INSTALLER_PATH,
      packageVersion: PACKAGE_VERSION,
      workspace,
    });
  }

  function writeManifest(document: ReleaseManifestDocument): void {
    writeArtifact(MANIFEST_PATH, `${JSON.stringify(document, null, 2)}\n`);
  }

  function load(expectedCommit = COMMIT) {
    return loadReleaseManifest({
      expectedCommit,
      expectedPackageVersion: PACKAGE_VERSION,
      workspace,
    });
  }

  it('binds the exact installer and SBOM to the checked-out commit', () => {
    writeManifest(manifest());

    expect(load()).toMatchObject({
      artifactCommit: COMMIT,
      installer: { bytes: 12, path: INSTALLER_PATH },
      packageVersion: PACKAGE_VERSION,
      sbom: { path: SBOM_PATH },
    });
  });

  it('rejects an artifact manifest from a stale source commit', () => {
    writeManifest(manifest());

    expect(() => load('b'.repeat(40))).toThrow(
      `does not match checked-out commit ${'b'.repeat(40)}`,
    );
  });

  it('rejects an installer changed after the manifest was written', () => {
    writeManifest(manifest());
    writeArtifact(INSTALLER_PATH, 'installer-v2');

    expect(() => load()).toThrow('Release manifest installer does not match');
  });

  it('rejects an altered manifest hash instead of trusting its declaration', () => {
    const original = manifest();
    const altered = {
      ...original,
      artifacts: {
        ...original.artifacts,
        sbom: { ...original.artifacts.sbom, sha256: 'f'.repeat(64) },
      },
    };
    writeManifest(altered);

    expect(() => load()).toThrow('Release manifest sbom does not match');
  });

  it('rejects artifact paths outside the locked release layout', () => {
    const original = manifest();
    const altered = {
      ...original,
      artifacts: {
        ...original.artifacts,
        installer: { ...original.artifacts.installer, path: '../outside.exe' },
      },
    };
    writeManifest(altered);

    expect(() => load()).toThrow('Release manifest installer path is invalid');
  });
});
