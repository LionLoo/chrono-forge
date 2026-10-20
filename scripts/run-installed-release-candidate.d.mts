export interface ReleaseCandidateArchiveSlot {
  readonly headGeneration: number;
  readonly name: string;
  readonly slotId: string;
}

export interface ReleaseCandidateArchiveEvidence {
  readonly activeSlotId: string;
  readonly generations: number;
  readonly saveGenerations: readonly ReleaseCandidateSaveGeneration[];
  readonly sessions: number;
  readonly slots: readonly ReleaseCandidateArchiveSlot[];
}

export interface ReleaseCandidateSaveGeneration {
  readonly checksum: string;
  readonly generation: number;
  readonly slotId: string;
}

export interface ReleaseCandidateSaveGenerationRow extends ReleaseCandidateSaveGeneration {
  readonly snapshot: string;
}

export function validatedChildPath(parent: string, child: string): string;

export function releaseCandidateOutputDirectory(
  requestedOutput: string,
  workspace?: string,
): string;

export function releaseCandidateArtifactDirectory(
  requestedRoot: string,
  workspace?: string,
): string;

export function selectSingleInstaller(paths: readonly string[]): string;

export function checksumLine(hash: string, filename: string): string;

export function verifiedSaveGeneration(
  row: ReleaseCandidateSaveGenerationRow,
): ReleaseCandidateSaveGeneration;

export function awaitLaunchReadiness(
  readiness: Promise<unknown>,
  cleanup: () => Promise<unknown>,
): Promise<void>;

export interface ReleaseCandidateChildProcess {
  readonly exitCode: number | null;
  readonly pid?: number;
  readonly signalCode: string | null;
  kill(): boolean;
}

export function ensureProcessTreeStopped(
  child: ReleaseCandidateChildProcess,
  waitForExit: () => Promise<boolean>,
  forceKill: (pid: number) => Promise<unknown>,
): Promise<void>;

export function waitForCdp(
  endpoint: string,
  child: Pick<ReleaseCandidateChildProcess, 'exitCode'>,
  timeoutMs?: number,
  fetchImplementation?: typeof fetch,
): Promise<void>;

export function assertArchiveContinuity(
  before: ReleaseCandidateArchiveEvidence,
  after: ReleaseCandidateArchiveEvidence,
): void;
