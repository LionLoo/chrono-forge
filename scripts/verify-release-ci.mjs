import process from 'node:process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const API_ROOT = 'https://api.github.com';

function requireValue(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

export function selectVerifiedMainCiRun(workflowRuns, expectedCommit) {
  if (!Array.isArray(workflowRuns)) throw new Error('GitHub CI workflow runs are invalid.');
  const matches = workflowRuns
    .filter(
      (run) =>
        run?.head_sha === expectedCommit &&
        run.event === 'push' &&
        run.head_branch === 'main' &&
        run.path === '.github/workflows/ci.yml' &&
        run.status === 'completed' &&
        run.conclusion === 'success' &&
        Number.isSafeInteger(run.id),
    )
    .sort((left, right) => right.id - left.id);
  if (matches.length === 0) {
    throw new Error(`No successful main CI workflow exists for release commit ${expectedCommit}.`);
  }
  return matches[0];
}

export function requireSuccessfulRequiredJob(jobs, workflowRunId) {
  if (!Array.isArray(jobs)) throw new Error('GitHub CI workflow jobs are invalid.');
  const required = jobs.filter((job) => job?.name === 'Required');
  if (
    required.length !== 1 ||
    required[0]?.status !== 'completed' ||
    required[0]?.conclusion !== 'success'
  ) {
    throw new Error(
      `CI workflow ${workflowRunId} does not contain exactly one successful aggregate Required job.`,
    );
  }
  return required[0];
}

async function githubJson(repository, token, resource, fetchImplementation = fetch) {
  const response = await fetchImplementation(`${API_ROOT}/repos/${repository}${resource}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub release-CI verification request failed (${response.status}).`);
  }
  return response.json();
}

export async function verifyReleaseCi({ commit, repository, token, fetchImplementation = fetch }) {
  requireValue(commit, 'Release commit');
  requireValue(repository, 'GitHub repository');
  requireValue(token, 'GitHub token');
  if (!COMMIT_PATTERN.test(commit)) {
    throw new Error(`Release commit is invalid: ${commit}`);
  }
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new Error(`GitHub repository is invalid: ${repository}`);
  }

  const main = await githubJson(repository, token, '/branches/main', fetchImplementation);
  if (main?.commit?.sha !== commit) {
    throw new Error(
      `Release tag commit ${commit} is not current main ${String(main?.commit?.sha)}.`,
    );
  }

  const runs = await githubJson(
    repository,
    token,
    `/actions/workflows/ci.yml/runs?event=push&head_sha=${commit}&per_page=100`,
    fetchImplementation,
  );
  const verifiedRun = selectVerifiedMainCiRun(runs?.workflow_runs, commit);
  const jobs = await githubJson(
    repository,
    token,
    `/actions/runs/${verifiedRun.id}/jobs?filter=latest&per_page=100`,
    fetchImplementation,
  );
  requireSuccessfulRequiredJob(jobs?.jobs, verifiedRun.id);
  return Object.freeze({ commit, workflowRunId: verifiedRun.id });
}

async function verifyFromEnvironment() {
  const evidence = await verifyReleaseCi({
    commit: requireValue(process.env.GITHUB_SHA, 'GITHUB_SHA'),
    repository: requireValue(process.env.GITHUB_REPOSITORY, 'GITHUB_REPOSITORY'),
    token: requireValue(process.env.GH_TOKEN, 'GH_TOKEN'),
  });
  process.stdout.write(
    `Release commit ${evidence.commit} has exact green main CI workflow ${evidence.workflowRunId}.\n`,
  );
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  await verifyFromEnvironment();
}
