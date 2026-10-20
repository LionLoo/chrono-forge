import { describe, expect, it, vi } from 'vitest';

import {
  requireSuccessfulRequiredJob,
  selectVerifiedMainCiRun,
  verifyReleaseCi,
  type ReleaseCiJob,
  type ReleaseCiRun,
} from '../../scripts/verify-release-ci.mjs';

const COMMIT = 'a'.repeat(40);

function successfulRun(overrides: Partial<ReleaseCiRun> = {}): ReleaseCiRun {
  return {
    conclusion: 'success',
    event: 'push',
    head_branch: 'main',
    head_sha: COMMIT,
    id: 42,
    path: '.github/workflows/ci.yml',
    status: 'completed',
    ...overrides,
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });
}

describe('release CI provenance verifier', () => {
  it('selects only the newest successful main push for the exact release commit', () => {
    const selected = selectVerifiedMainCiRun(
      [
        successfulRun({ id: 41 }),
        successfulRun({ event: 'pull_request', id: 99 }),
        successfulRun({ conclusion: 'failure', id: 98 }),
        successfulRun({ head_sha: 'b'.repeat(40), id: 97 }),
        successfulRun({ id: 43 }),
      ],
      COMMIT,
    );

    expect(selected.id).toBe(43);
    expect(() =>
      selectVerifiedMainCiRun([successfulRun({ status: 'in_progress' })], COMMIT),
    ).toThrow(`No successful main CI workflow exists for release commit ${COMMIT}`);
  });

  it('requires exactly one completed successful aggregate Required job', () => {
    const successful: ReleaseCiJob = {
      conclusion: 'success',
      name: 'Required',
      status: 'completed',
    };
    expect(requireSuccessfulRequiredJob([successful], 42)).toBe(successful);
    expect(() =>
      requireSuccessfulRequiredJob([{ ...successful, conclusion: 'failure' }], 42),
    ).toThrow('does not contain exactly one successful aggregate Required job');
    expect(() => requireSuccessfulRequiredJob([successful, successful], 42)).toThrow(
      'does not contain exactly one successful aggregate Required job',
    );
  });

  it('binds the tag commit to current main and its successful Required evidence', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ commit: { sha: COMMIT } }))
      .mockResolvedValueOnce(jsonResponse({ workflow_runs: [successfulRun()] }))
      .mockResolvedValueOnce(
        jsonResponse({
          jobs: [{ conclusion: 'success', name: 'Required', status: 'completed' }],
        }),
      );

    await expect(
      verifyReleaseCi({
        commit: COMMIT,
        fetchImplementation,
        repository: 'LionLoo/chrono-forge',
        token: 'test-token',
      }),
    ).resolves.toStrictEqual({ commit: COMMIT, workflowRunId: 42 });
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    expect(fetchImplementation.mock.calls[1]?.[0]).toContain(
      `/actions/workflows/ci.yml/runs?event=push&head_sha=${COMMIT}`,
    );
  });

  it('fails before trusting CI when the tag commit is not current main', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ commit: { sha: 'b'.repeat(40) } }));

    await expect(
      verifyReleaseCi({
        commit: COMMIT,
        fetchImplementation,
        repository: 'LionLoo/chrono-forge',
        token: 'test-token',
      }),
    ).rejects.toThrow(`Release tag commit ${COMMIT} is not current main`);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });
});
