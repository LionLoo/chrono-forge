export interface ReleaseCiEvidence {
  readonly commit: string;
  readonly workflowRunId: number;
}

export interface ReleaseCiRun {
  readonly conclusion?: string | null;
  readonly event?: string;
  readonly head_branch?: string | null;
  readonly head_sha?: string;
  readonly id?: number;
  readonly path?: string;
  readonly status?: string;
}

export interface ReleaseCiJob {
  readonly conclusion?: string | null;
  readonly name?: string;
  readonly status?: string;
}

export function selectVerifiedMainCiRun(
  workflowRuns: readonly ReleaseCiRun[],
  expectedCommit: string,
): ReleaseCiRun & { readonly id: number };

export function requireSuccessfulRequiredJob(
  jobs: readonly ReleaseCiJob[],
  workflowRunId: number,
): ReleaseCiJob;

export function verifyReleaseCi(options: {
  readonly commit: string;
  readonly repository: string;
  readonly token: string;
  readonly fetchImplementation?: typeof fetch;
}): Promise<ReleaseCiEvidence>;
