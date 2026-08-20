import type { WorldConfig, WorldSeed } from '../simulation/world';

export const WORKER_PROTOCOL_VERSION = 1;

export type WorkerProtocolVersion = typeof WORKER_PROTOCOL_VERSION;
export type RunMode = 'paused' | 'running';

export interface WorldFrameProjection {
  readonly version: WorkerProtocolVersion;
  readonly width: number;
  readonly height: number;
  readonly tick: number;
  readonly stateHash: string;
  readonly biome: Uint8Array;
  readonly resource: Uint16Array;
  readonly habitability: Uint8Array;
  readonly hazard: Uint8Array;
}

interface RequestBase {
  readonly protocolVersion: WorkerProtocolVersion;
  readonly requestId: string;
}

export interface InitializeRequest extends RequestBase {
  readonly type: 'initialize';
  readonly seed: WorldSeed;
  readonly config?: Partial<WorldConfig>;
}

export interface LoadRequest extends RequestBase {
  readonly type: 'load';
  readonly snapshot: string;
}

export interface QueuedCommand {
  readonly kind: string;
  readonly payload: Readonly<Record<string, boolean | number | string>>;
}

export interface QueueCommandRequest extends RequestBase {
  readonly type: 'queueCommand';
  readonly command: QueuedCommand;
}

export interface SetRunModeRequest extends RequestBase {
  readonly type: 'setRunMode';
  readonly runMode: RunMode;
}

export interface AdvanceTicksRequest extends RequestBase {
  readonly type: 'advanceTicks';
  readonly ticks: number;
}

export interface RequestSaveRequest extends RequestBase {
  readonly type: 'requestSave';
}

export interface PerformOfflineCatchUpRequest extends RequestBase {
  readonly type: 'performOfflineCatchUp';
  readonly elapsedMilliseconds: number;
  readonly rate: number;
  readonly policyVersion: number;
}

export type UiToWorkerMessage =
  | InitializeRequest
  | LoadRequest
  | QueueCommandRequest
  | SetRunModeRequest
  | AdvanceTicksRequest
  | RequestSaveRequest
  | PerformOfflineCatchUpRequest;

export const INVALID_REQUEST_ID = 'invalid-request';

export type WorkerRequestValidation =
  | { readonly kind: 'valid'; readonly message: UiToWorkerMessage }
  | {
      readonly kind: 'invalid';
      readonly requestId: string;
      readonly reason: string;
    }
  | {
      readonly kind: 'protocol-version-mismatch';
      readonly requestId: string;
      readonly receivedVersion: number;
    };

type PrimitiveCommandValue = boolean | number | string;
type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isUint32(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isSafeInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isSafeInteger(value) && value >= 0;
}

function invalid(requestId: string, reason: string): WorkerRequestValidation {
  return { kind: 'invalid', requestId, reason };
}

function optionalConfig(value: unknown): Partial<WorldConfig> | undefined | 'invalid' {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    return 'invalid';
  }
  const config: { width?: number; height?: number; chunkSize?: number } = {};
  for (const key of ['width', 'height', 'chunkSize'] as const) {
    const candidate = value[key];
    if (candidate === undefined) {
      continue;
    }
    if (!isNonNegativeSafeInteger(candidate) || candidate < 1) {
      return 'invalid';
    }
    config[key] = candidate;
  }
  return config;
}

function commandFrom(value: unknown): QueuedCommand | 'invalid' {
  if (!isRecord(value) || typeof value.kind !== 'string' || !isRecord(value.payload)) {
    return 'invalid';
  }
  const payload: Record<string, PrimitiveCommandValue> = {};
  for (const [key, candidate] of Object.entries(value.payload)) {
    if (
      typeof candidate !== 'string' &&
      typeof candidate !== 'boolean' &&
      !isFiniteNumber(candidate)
    ) {
      return 'invalid';
    }
    payload[key] = candidate;
  }
  return Object.freeze({ kind: value.kind, payload: Object.freeze(payload) });
}

/**
 * Validates data received through structured clone before it reaches the
 * authoritative runtime. This intentionally constructs fresh request objects
 * rather than trusting a caller-provided prototype or nested references.
 */
export function validateUiToWorkerMessage(input: unknown): WorkerRequestValidation {
  if (!isRecord(input)) {
    return invalid(INVALID_REQUEST_ID, 'Message must be an object.');
  }
  const requestId = typeof input.requestId === 'string' ? input.requestId : INVALID_REQUEST_ID;
  if (typeof input.requestId !== 'string') {
    return invalid(requestId, 'requestId must be a string.');
  }
  if (typeof input.type !== 'string') {
    return invalid(requestId, 'type must be a string.');
  }
  if (!isFiniteNumber(input.protocolVersion)) {
    return invalid(requestId, 'protocolVersion must be a finite number.');
  }
  if (input.protocolVersion !== WORKER_PROTOCOL_VERSION) {
    return {
      kind: 'protocol-version-mismatch',
      requestId,
      receivedVersion: input.protocolVersion,
    };
  }

  switch (input.type) {
    case 'initialize': {
      if (!Array.isArray(input.seed) || input.seed.length !== 4 || !input.seed.every(isUint32)) {
        return invalid(requestId, 'initialize.seed must contain four uint32 values.');
      }
      const config = optionalConfig(input.config);
      if (config === 'invalid') {
        return invalid(requestId, 'initialize.config must contain positive integer dimensions.');
      }
      const seed: WorldSeed = [input.seed[0]!, input.seed[1]!, input.seed[2]!, input.seed[3]!];
      return {
        kind: 'valid',
        message:
          config === undefined
            ? { type: 'initialize', protocolVersion: WORKER_PROTOCOL_VERSION, requestId, seed }
            : {
                type: 'initialize',
                protocolVersion: WORKER_PROTOCOL_VERSION,
                requestId,
                seed,
                config,
              },
      };
    }
    case 'load':
      return typeof input.snapshot === 'string'
        ? {
            kind: 'valid',
            message: {
              type: 'load',
              protocolVersion: WORKER_PROTOCOL_VERSION,
              requestId,
              snapshot: input.snapshot,
            },
          }
        : invalid(requestId, 'load.snapshot must be a string.');
    case 'queueCommand': {
      const command = commandFrom(input.command);
      return command === 'invalid'
        ? invalid(requestId, 'queueCommand.command must contain string kind and primitive payload.')
        : {
            kind: 'valid',
            message: {
              type: 'queueCommand',
              protocolVersion: WORKER_PROTOCOL_VERSION,
              requestId,
              command,
            },
          };
    }
    case 'setRunMode':
      return input.runMode === 'paused' || input.runMode === 'running'
        ? {
            kind: 'valid',
            message: {
              type: 'setRunMode',
              protocolVersion: WORKER_PROTOCOL_VERSION,
              requestId,
              runMode: input.runMode,
            },
          }
        : invalid(requestId, 'setRunMode.runMode must be paused or running.');
    case 'advanceTicks':
      return isNonNegativeSafeInteger(input.ticks)
        ? {
            kind: 'valid',
            message: {
              type: 'advanceTicks',
              protocolVersion: WORKER_PROTOCOL_VERSION,
              requestId,
              ticks: input.ticks,
            },
          }
        : invalid(requestId, 'advanceTicks.ticks must be a non-negative safe integer.');
    case 'requestSave':
      return {
        kind: 'valid',
        message: { type: 'requestSave', protocolVersion: WORKER_PROTOCOL_VERSION, requestId },
      };
    case 'performOfflineCatchUp':
      return isFiniteNumber(input.elapsedMilliseconds) &&
        isFiniteNumber(input.rate) &&
        isNonNegativeSafeInteger(input.policyVersion)
        ? {
            kind: 'valid',
            message: {
              type: 'performOfflineCatchUp',
              protocolVersion: WORKER_PROTOCOL_VERSION,
              requestId,
              elapsedMilliseconds: input.elapsedMilliseconds,
              rate: input.rate,
              policyVersion: input.policyVersion,
            },
          }
        : invalid(
            requestId,
            'performOfflineCatchUp requires finite elapsedMilliseconds/rate and integer policyVersion.',
          );
    default:
      return invalid(requestId, `Unknown worker request type ${input.type}.`);
  }
}

interface ResponseBase {
  readonly protocolVersion: WorkerProtocolVersion;
  readonly requestId: string;
}

export interface ReadyResponse extends ResponseBase {
  readonly type: 'ready';
  readonly frame: WorldFrameProjection;
}

export interface CommandAcceptedResponse extends ResponseBase {
  readonly type: 'commandAccepted';
  readonly command: QueuedCommand;
  readonly sequence: number;
  readonly targetTick: number;
}

export interface FrameDeltaResponse extends ResponseBase {
  readonly type: 'frameDelta';
  readonly frame: WorldFrameProjection;
}

export interface EventBatchResponse extends ResponseBase {
  readonly type: 'eventBatch';
  readonly events: readonly WorkerEvent[];
}

export interface SaveSnapshotResponse extends ResponseBase {
  readonly type: 'saveSnapshot';
  readonly snapshot: string;
}

export interface SimulationMetrics {
  readonly tick: number;
  readonly runMode: RunMode;
  readonly queuedCommandCount: number;
}

export interface MetricsResponse extends ResponseBase {
  readonly type: 'metrics';
  readonly metrics: SimulationMetrics;
}

export type WorkerFaultCode =
  | 'invalid-request'
  | 'not-initialized'
  | 'protocol-version-mismatch'
  | 'unsupported-operation'
  | 'world-error';

export interface FaultResponse extends ResponseBase {
  readonly type: 'fault';
  readonly code: WorkerFaultCode;
  readonly message: string;
}

export interface WorkerEvent {
  readonly tick: number;
  readonly type: string;
  readonly subjectId: number;
}

export type WorkerToUiMessage =
  | ReadyResponse
  | CommandAcceptedResponse
  | FrameDeltaResponse
  | EventBatchResponse
  | SaveSnapshotResponse
  | MetricsResponse
  | FaultResponse;

export function projectionTransferables(frame: WorldFrameProjection): readonly ArrayBuffer[] {
  return [
    frame.biome.buffer as ArrayBuffer,
    frame.resource.buffer as ArrayBuffer,
    frame.habitability.buffer as ArrayBuffer,
    frame.hazard.buffer as ArrayBuffer,
  ];
}
