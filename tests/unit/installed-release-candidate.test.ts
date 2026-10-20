import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  assertArchiveContinuity,
  awaitLaunchReadiness,
  checksumLine,
  ensureProcessTreeStopped,
  releaseCandidateArtifactDirectory,
  releaseCandidateOutputDirectory,
  selectSingleInstaller,
  validatedChildPath,
  verifiedSaveGeneration,
  waitForCdp,
} from '../../scripts/run-installed-release-candidate.mjs';

describe('installed release-candidate verifier', () => {
  it('accepts only a strict child path', () => {
    const parent = path.resolve('test-results', 'candidate');
    expect(validatedChildPath(parent, path.join(parent, 'installed'))).toBe(
      path.join(parent, 'installed'),
    );
    expect(() => validatedChildPath(parent, parent)).toThrow('Expected a child');
    expect(() => validatedChildPath(parent, path.resolve(parent, '..', 'outside'))).toThrow(
      'Expected a child',
    );
  });

  it('confines release-candidate output to one workspace test-results child', () => {
    const workspace = path.resolve('candidate-workspace');
    expect(releaseCandidateOutputDirectory('test-results/m11-rc-test', workspace)).toBe(
      path.join(workspace, 'test-results', 'm11-rc-test'),
    );
    expect(() => releaseCandidateOutputDirectory('outside', workspace)).toThrow('Expected a child');
    expect(() =>
      releaseCandidateOutputDirectory('test-results/nested/m11-rc-test', workspace),
    ).toThrow('direct child');
  });

  it('accepts only an existing direct test-results child as an alternate artifact root', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'chrono-forge-artifact-root-'));
    try {
      const artifactRoot = path.join(workspace, 'test-results', 'downloaded-release');
      mkdirSync(artifactRoot, { recursive: true });
      expect(releaseCandidateArtifactDirectory('test-results/downloaded-release', workspace)).toBe(
        artifactRoot,
      );
      expect(() =>
        releaseCandidateArtifactDirectory('test-results/missing-release', workspace),
      ).toThrow('does not exist');
      expect(() =>
        releaseCandidateArtifactDirectory('test-results/nested/downloaded-release', workspace),
      ).toThrow('direct child');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('requires one exact executable installer', () => {
    expect(selectSingleInstaller(['candidate.exe'])).toBe('candidate.exe');
    expect(() => selectSingleInstaller([])).toThrow('found 0');
    expect(() => selectSingleInstaller(['a.exe', 'b.exe'])).toThrow('found 2');
    expect(() => selectSingleInstaller(['candidate.zip'])).toThrow('found 0');
  });

  it('writes a conventional lowercase SHA-256 line', () => {
    const hash = 'a'.repeat(64);
    expect(checksumLine(hash, 'chrono-forge-1.0.0-x64-setup.exe')).toBe(
      `${hash}  chrono-forge-1.0.0-x64-setup.exe\n`,
    );
    expect(() => checksumLine('ABC', 'candidate.exe')).toThrow('lowercase hex');
    expect(() => checksumLine(hash, 'bad\nname.exe')).toThrow('filename is invalid');
  });

  it('independently hashes every immutable snapshot generation', () => {
    const snapshot = '{"world":"canonical"}';
    const checksum = createHash('sha256').update(snapshot).digest('hex');
    expect(
      verifiedSaveGeneration({ checksum, generation: 2, slotId: 'primary', snapshot }),
    ).toStrictEqual({ checksum, generation: 2, slotId: 'primary' });
    expect(() =>
      verifiedSaveGeneration({
        checksum,
        generation: 2,
        slotId: 'primary',
        snapshot: '{"world":"corrupt"}',
      }),
    ).toThrow('failed its stored checksum');
  });

  it('cleans up a launched process when diagnostics readiness fails', async () => {
    const failure = new Error('diagnostics timeout');
    const cleanup = vi.fn().mockResolvedValue(undefined);
    await expect(awaitLaunchReadiness(Promise.reject(failure), cleanup)).rejects.toBe(failure);
    expect(cleanup).toHaveBeenCalledOnce();

    const cleanupFailure = new Error('forced cleanup failed');
    await expect(
      awaitLaunchReadiness(Promise.reject(failure), () => Promise.reject(cleanupFailure)),
    ).rejects.toMatchObject({
      errors: [failure, cleanupFailure],
      message: 'Installed application readiness failed and its process cleanup also failed.',
    });
  });

  it('bounds a stalled CDP response and still runs launch cleanup', async () => {
    const stalledFetch = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
    const cleanup = vi.fn().mockResolvedValue(undefined);
    await expect(
      awaitLaunchReadiness(
        waitForCdp('http://127.0.0.1:1', { exitCode: null }, 20, stalledFetch),
        cleanup,
      ),
    ).rejects.toThrow('did not expose its player page before the deadline');
    expect(stalledFetch).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('keeps the CDP deadline active while the response body is parsed', async () => {
    const stalledBodyFetch = vi.fn<typeof fetch>(() =>
      Promise.resolve({
        ok: true,
        json: () => new Promise<unknown>(() => undefined),
      } as Response),
    );
    const cleanup = vi.fn().mockResolvedValue(undefined);
    await expect(
      awaitLaunchReadiness(
        waitForCdp('http://127.0.0.1:1', { exitCode: null }, 20, stalledBodyFetch),
        cleanup,
      ),
    ).rejects.toThrow('did not expose its player page before the deadline');
    expect(stalledBodyFetch).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('requires forced process-tree cleanup to succeed and confirm exit', async () => {
    const child = {
      exitCode: null,
      kill: vi.fn().mockReturnValue(true),
      pid: 42,
      signalCode: null,
    };
    const failedTaskkill = vi.fn().mockRejectedValue(new Error('taskkill.exe exited 1'));
    await expect(
      ensureProcessTreeStopped(child, () => Promise.resolve(false), failedTaskkill),
    ).rejects.toThrow('taskkill.exe exited 1');
    expect(child.kill).not.toHaveBeenCalled();

    const successfulTaskkill = vi.fn().mockResolvedValue(undefined);
    const stillRunning = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
    await expect(ensureProcessTreeStopped(child, stillRunning, successfulTaskkill)).rejects.toThrow(
      'remained live after taskkill',
    );

    const exitsAfterTaskkill = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    await expect(
      ensureProcessTreeStopped(child, exitsAfterTaskkill, successfulTaskkill),
    ).resolves.toBeUndefined();
    expect(successfulTaskkill).toHaveBeenLastCalledWith(42);
  });

  it('preserves every prior generation while accepting one bounded offline checkpoint', () => {
    const before = {
      activeSlotId: 'm9-contacted',
      generations: 2,
      saveGenerations: [
        { checksum: 'a'.repeat(64), generation: 1, slotId: 'm9-contacted' },
        { checksum: 'b'.repeat(64), generation: 1, slotId: 'primary' },
      ],
      sessions: 1,
      slots: [
        { slotId: 'm9-contacted', name: 'M9 contacted world', headGeneration: 1 },
        { slotId: 'primary', name: 'Founding world', headGeneration: 1 },
      ],
    };
    const after = {
      ...before,
      generations: 3,
      saveGenerations: [
        ...before.saveGenerations,
        { checksum: 'c'.repeat(64), generation: 2, slotId: 'm9-contacted' },
      ],
      slots: [{ ...before.slots[0]!, headGeneration: 2 }, before.slots[1]!],
    };

    expect(() => assertArchiveContinuity(before, after)).not.toThrow();
    expect(() => assertArchiveContinuity(before, { ...after, sessions: 0 })).toThrow(
      'changed unexpectedly across uninstall/reinstall',
    );
    expect(() =>
      assertArchiveContinuity(before, {
        ...after,
        saveGenerations: [
          { ...before.saveGenerations[0]!, checksum: 'd'.repeat(64) },
          before.saveGenerations[1]!,
          after.saveGenerations[2]!,
        ],
      }),
    ).toThrow('generation m9-contacted:1 changed or disappeared');
    expect(() =>
      assertArchiveContinuity(before, {
        ...after,
        saveGenerations: [
          ...before.saveGenerations,
          { checksum: 'c'.repeat(64), generation: 2, slotId: 'primary' },
        ],
      }),
    ).toThrow('anything other than one active-world checkpoint');
  });
});
