export interface ReleaseArtifactEvidence {
  readonly absolutePath: string;
  readonly bytes: number;
  readonly path: string;
  readonly sha256: string;
}

export interface ReleaseManifestDocument {
  readonly artifacts: {
    readonly installer: Omit<ReleaseArtifactEvidence, 'absolutePath'>;
    readonly sbom: Omit<ReleaseArtifactEvidence, 'absolutePath'>;
  };
  readonly commit: string;
  readonly format: 'chrono-forge-release-manifest';
  readonly packageVersion: string;
  readonly version: 1;
}

export interface VerifiedReleaseManifest {
  readonly artifactCommit: string;
  readonly installer: ReleaseArtifactEvidence;
  readonly manifest: ReleaseArtifactEvidence;
  readonly packageVersion: string;
  readonly sbom: ReleaseArtifactEvidence;
}

export function createReleaseManifest(options: {
  readonly commit: string;
  readonly installerPath: string;
  readonly packageVersion: string;
  readonly sbomPath?: string;
  readonly workspace?: string;
}): ReleaseManifestDocument;

export function cleanReleaseArtifacts(workspace?: string): void;

export function canonicalizeReleaseInstaller(options: {
  readonly packageVersion: string;
  readonly workspace?: string;
}): string;

export function loadReleaseManifest(options: {
  readonly expectedCommit: string;
  readonly expectedPackageVersion: string;
  readonly manifestPath?: string;
  readonly workspace?: string;
}): VerifiedReleaseManifest;
