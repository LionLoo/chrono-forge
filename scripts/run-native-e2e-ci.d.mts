export interface NativeE2eCommandResult {
  readonly code: number;
  readonly output: string;
  readonly signal?: NodeJS.Signals | null;
}

export interface NativeE2eLogger {
  error(message: string): void;
  warn(message: string): void;
}

export interface NativeE2eCommandTracker {
  beforeCommand(commandName: string): void;
  afterCommand(commandName: string): void;
  afterTest(error?: unknown): void;
}

export declare function createNativeE2eCommandTracker(options?: {
  readonly logger?: Pick<NativeE2eLogger, 'error'>;
  readonly now?: () => number;
}): NativeE2eCommandTracker;

export declare function confirmedNativeE2eInfrastructureFailures(output: string): string[];

export declare function nativeE2eDatabasePath(
  profile: string,
  options?: {
    readonly environment?: NodeJS.ProcessEnv;
    readonly platform?: NodeJS.Platform;
  },
): string;

export interface NativeE2eDatabaseEvidence {
  readonly databasePath: string;
  readonly generations: 8;
  readonly sessions: 2;
  readonly slots: 3;
}

export declare function verifyNativeE2eDatabase(options?: {
  readonly databasePath?: string;
  readonly profile?: string;
}): Promise<NativeE2eDatabaseEvidence>;

export declare function runNativeE2eCi(
  run?: (args: string[]) => Promise<NativeE2eCommandResult>,
  logger?: NativeE2eLogger,
  verifyDatabase?: () => Promise<unknown>,
): Promise<number>;

export declare function runNativeE2eSingleAttempt(
  run?: (args: string[]) => Promise<NativeE2eCommandResult>,
  logger?: NativeE2eLogger,
  verifyDatabase?: () => Promise<unknown>,
): Promise<number>;
