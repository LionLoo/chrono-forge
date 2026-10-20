import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { stageDownloadedRelease } from '../../scripts/stage-downloaded-release.mjs';

const COMMIT = '1'.repeat(40);
const VERSION = '1.0.0';
const INSTALLER_NAME = 'chrono-forge-1.0.0-x64-setup.exe';

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

describe('downloaded release staging', () => {
  let workspace = '';
  let downloadDirectory = '';
  let stagingDirectory = '';

  beforeEach(() => {
    workspace = mkdtempSync(path.join(tmpdir(), 'chrono-forge-downloaded-release-'));
    downloadDirectory = path.join(workspace, 'test-results', 'release-download');
    stagingDirectory = path.join(workspace, 'test-results', 'release-staged');
    mkdirSync(downloadDirectory, { recursive: true });
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  function writeValidBundle({
    commit = COMMIT,
    checksum,
  }: { commit?: string; checksum?: string } = {}) {
    const installer = Buffer.from('downloaded installer bytes');
    const sbom = Buffer.from('{"bomFormat":"CycloneDX"}\n');
    const installerHash = sha256(installer);
    writeFileSync(path.join(downloadDirectory, INSTALLER_NAME), installer);
    writeFileSync(path.join(downloadDirectory, 'chrono-forge.cdx.json'), sbom);
    writeFileSync(
      path.join(downloadDirectory, `${INSTALLER_NAME}.sha256`),
      `${checksum ?? installerHash}  ${INSTALLER_NAME}\n`,
    );
    writeFileSync(
      path.join(downloadDirectory, 'release-manifest.json'),
      `${JSON.stringify(
        {
          artifacts: {
            installer: {
              bytes: installer.byteLength,
              path: `src-tauri/target/release/bundle/nsis/${INSTALLER_NAME}`,
              sha256: installerHash,
            },
            sbom: {
              bytes: sbom.byteLength,
              path: 'release-artifacts/chrono-forge.cdx.json',
              sha256: sha256(sbom),
            },
          },
          commit,
          format: 'chrono-forge-release-manifest',
          packageVersion: VERSION,
          version: 1,
        },
        null,
        2,
      )}\n`,
    );
    return installerHash;
  }

  it('requires exactly four assets and stages their exact bytes into manifest paths', () => {
    const installerHash = writeValidBundle();
    const result = stageDownloadedRelease({
      commit: COMMIT,
      downloadPath: 'test-results/release-download',
      packageVersion: VERSION,
      stagingPath: 'test-results/release-staged',
      workspace,
    });

    expect(result).toMatchObject({
      artifactCommit: COMMIT,
      installer: { filename: INSTALLER_NAME, sha256: installerHash },
      packageVersion: VERSION,
      stagingDirectory,
    });
    expect(
      existsSync(
        path.join(
          stagingDirectory,
          'src-tauri',
          'target',
          'release',
          'bundle',
          'nsis',
          INSTALLER_NAME,
        ),
      ),
    ).toBe(true);
    expect(
      existsSync(path.join(stagingDirectory, 'release-artifacts', 'release-manifest.json')),
    ).toBe(true);
  });

  it('rejects an unexpected release asset before staging anything', () => {
    writeValidBundle();
    writeFileSync(path.join(downloadDirectory, 'unexpected.txt'), 'not part of the release');

    expect(() =>
      stageDownloadedRelease({
        commit: COMMIT,
        downloadPath: 'test-results/release-download',
        packageVersion: VERSION,
        stagingPath: 'test-results/release-staged',
        workspace,
      }),
    ).toThrow('exact release contract');
    expect(existsSync(stagingDirectory)).toBe(false);
  });

  it('rejects a checksum mismatch and an artifact manifest bound to another commit', () => {
    writeValidBundle({ checksum: 'a'.repeat(64) });
    expect(() =>
      stageDownloadedRelease({
        commit: COMMIT,
        downloadPath: 'test-results/release-download',
        packageVersion: VERSION,
        stagingPath: 'test-results/release-staged',
        workspace,
      }),
    ).toThrow('checksum mismatch');

    rmSync(downloadDirectory, { recursive: true, force: true });
    mkdirSync(downloadDirectory, { recursive: true });
    writeValidBundle({ commit: '2'.repeat(40) });
    expect(() =>
      stageDownloadedRelease({
        commit: COMMIT,
        downloadPath: 'test-results/release-download',
        packageVersion: VERSION,
        stagingPath: 'test-results/release-staged',
        workspace,
      }),
    ).toThrow('does not match checked-out commit');
    expect(existsSync(stagingDirectory)).toBe(false);
  });
});
