export interface StagedDownloadedRelease {
  readonly artifactCommit: string;
  readonly installer: {
    readonly bytes: number;
    readonly filename: string;
    readonly sha256: string;
  };
  readonly manifest: {
    readonly bytes: number;
    readonly sha256: string;
  };
  readonly packageVersion: string;
  readonly sbom: {
    readonly bytes: number;
    readonly sha256: string;
  };
  readonly stagingDirectory: string;
}

export function stageDownloadedRelease(options: {
  readonly commit: string;
  readonly downloadPath: string;
  readonly packageVersion: string;
  readonly stagingPath: string;
  readonly workspace?: string;
}): StagedDownloadedRelease;
