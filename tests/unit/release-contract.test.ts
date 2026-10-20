import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { WORKER_PROTOCOL_VERSION } from '../../src/protocol';
import {
  WORLD_CONTENT_VERSION,
  WORLD_ENGINE_VERSION,
  WORLD_SNAPSHOT_FORMAT_VERSION,
} from '../../src/simulation/persistence';

const releaseNotes = readFileSync(path.resolve('RELEASE_NOTES.md'), 'utf8');
const releaseWorkflow = readFileSync(path.resolve('.github/workflows/release.yml'), 'utf8');
const packageJson = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')) as {
  readonly scripts: Readonly<Record<string, string>>;
  readonly version: string;
};

describe('v1.0.0 release contract', () => {
  it('freezes authoritative save and Worker protocol versions for the release candidate', () => {
    expect({
      content: WORLD_CONTENT_VERSION,
      engine: WORLD_ENGINE_VERSION,
      protocol: WORKER_PROTOCOL_VERSION,
      snapshot: WORLD_SNAPSHOT_FORMAT_VERSION,
    }).toStrictEqual({ content: 14, engine: 14, protocol: 11, snapshot: 14 });
  });

  it('documents the private Windows release boundary and recovery expectations', () => {
    expect(releaseNotes).toContain('Windows 10 or Windows 11, x64');
    expect(releaseNotes).toContain('unsigned');
    expect(releaseNotes).toContain('SHA-256 checksum');
    expect(releaseNotes).toContain('CycloneDX SBOM');
    expect(releaseNotes).toContain('release manifest');
    expect(releaseNotes).toContain('exact source commit');
    expect(releaseNotes).toContain('Uninstalling the application intentionally leaves');
    expect(releaseNotes).toContain('snapshot, engine, and content version 14');
    expect(releaseNotes).toContain('Worker protocol version 11');
    expect(releaseNotes).toContain('Known non-blocking limitations');
    expect(releaseNotes).toContain('no account or online service');
  });

  it('builds release artifacts only from a clean source and writes their manifest', () => {
    expect(packageJson.scripts['build:release']).toBe(
      'node scripts/release-manifest.mjs --check-source && node scripts/release-manifest.mjs --clean && npm run generate:sbom && npm run build:desktop && node scripts/release-manifest.mjs',
    );
    expect(packageJson.scripts['verify:production-exclusion']).toContain('npm run build:release');
  });

  it('stages a draft download, smokes it, and only then publishes the release', () => {
    const orderedSteps = [
      'Create or refresh private draft release',
      'Download exact draft assets',
      'Verify and stage downloaded assets',
      'Smoke downloaded installer',
      'Publish verified private release',
    ];
    let previous = -1;
    for (const step of orderedSteps) {
      const index = releaseWorkflow.indexOf(`- name: ${step}`);
      expect(index, `${step} must exist after the previous release gate`).toBeGreaterThan(previous);
      previous = index;
    }
    expect(releaseWorkflow).toContain('--notes-file RELEASE_NOTES.md --draft');
    expect(releaseWorkflow).toContain('already published; refusing to mutate it on a rerun');
    expect(releaseWorkflow).toContain('CHRONO_FORGE_RC_ARTIFACT_ROOT: test-results/release-staged');
    expect(releaseWorkflow).toContain(
      'gh release edit $env:GITHUB_REF_NAME --draft=false --latest',
    );
  });

  it('uses the final v1.0.0 package version', () => {
    expect(packageJson.version).toBe('1.0.0');
  });
});
