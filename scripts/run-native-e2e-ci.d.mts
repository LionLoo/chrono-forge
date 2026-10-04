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

export declare function runNativeE2eCi(
  run?: (args: string[]) => Promise<NativeE2eCommandResult>,
  logger?: NativeE2eLogger,
): Promise<number>;
