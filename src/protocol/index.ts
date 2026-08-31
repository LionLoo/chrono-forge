import type { WorldConfig, WorldSeed } from '../simulation/world';
import type {
  ConditionId,
  DisasterKind,
  InterventionKind,
  KnowledgeId,
  KnowledgeStatus,
} from '../simulation/development';
import { ACCELERATED_YEAR_TICKS, NORMAL_YEAR_TICKS } from '../simulation/society';

export const WORKER_PROTOCOL_VERSION = 5;
export const MAX_ADVANCE_TICKS_PER_REQUEST = 1_000_000;

export type WorkerProtocolVersion = typeof WORKER_PROTOCOL_VERSION;
export type RunMode = 'paused' | 'running';

/** Stable numeric encodings for the Worker-to-renderer projection. */
export const AGENT_ACTION_CODES = Object.freeze({
  idle: 0,
  forage: 1,
  collectWater: 2,
  gatherTimber: 3,
  gatherStone: 4,
  transport: 5,
  construct: 6,
  repair: 7,
  rest: 8,
});

export const STRUCTURE_KIND_CODES = Object.freeze({ shelter: 1, storehouse: 2 });

export const STRUCTURE_STATE_CODES = Object.freeze({
  planned: 1,
  building: 2,
  operational: 3,
  damaged: 4,
  abandoned: 5,
  demolished: 6,
});

/**
 * Compact read-only settlement totals calculated by the authoritative worker.
 * These values are display data only; UI and renderer code must not derive or
 * mutate the simulation from them.
 */
export interface SettlementSummary {
  readonly population: number;
  readonly food: number;
  readonly water: number;
  readonly timber: number;
  readonly stone: number;
  readonly operationalStructures: number;
  readonly shelterCapacity: number;
  readonly activeConstruction: number;
}

export interface SocietyBiographyProjection {
  readonly eventId: number;
  readonly tick: number;
  readonly summary: string;
}

/** Exact immutable policy and eligibility evidence for a simulated child arrival. */
export interface SocietyChildArrivalProjection {
  readonly tick: number;
  readonly eventId: number;
  readonly eligibilityEventId: number;
  readonly policy: 'pair-bond' | 'communal-guardianship';
  readonly householdId: number;
  readonly guardianIds: readonly number[];
  readonly partnerRelationshipId: number | null;
  readonly partnerKindAtArrival: 'partner' | 'long-term-partner' | null;
  readonly minimumPartnerTrustAtArrival: number | null;
  readonly minimumPartnerCommitmentAtArrival: number | null;
  readonly selectionScoreAtArrival: number;
}

export interface SocietyPersonProjection {
  readonly id: number;
  readonly name: string;
  readonly ageYears: number;
  readonly lifeStage: string;
  readonly status: string;
  readonly role: string;
  readonly cultureName: string;
  readonly householdName: string;
  /** Stable-ID-sorted derived family indexes; no elective social edges are carried in a frame. */
  readonly parentIds: readonly number[];
  readonly guardianIds: readonly number[];
  readonly childIds: readonly number[];
  readonly siblingIds: readonly number[];
  readonly extendedKinIds: readonly number[];
  readonly childArrival: SocietyChildArrivalProjection | null;
  readonly biography: readonly SocietyBiographyProjection[];
}

/** A bounded, immutable source event attached to a relationship by the simulation. */
export interface SocietyRelationshipEventProjection {
  readonly eventId: number;
  readonly tick: number;
  readonly summary: string;
  readonly importance: number;
}

/** Directional social or family state; the UI must display rather than derive it. */
export interface SocietyRelationshipDirectionProjection {
  readonly affinity: number;
  readonly trust: number;
  readonly closeness: number;
  readonly commitment: number;
  readonly grievance: number;
}

/**
 * A sparse read-only relationship record. `social` records are the elective
 * graph; `family` records are canonical parent/guardian-to-child bonds.
 */
export interface SocietyRelationshipProjection {
  readonly id: string;
  readonly category: 'social' | 'family';
  readonly status: 'active' | 'archived' | 'family';
  readonly kind: string;
  readonly firstPersonId: number;
  readonly secondPersonId: number;
  readonly firstRole: string;
  readonly secondRole: string;
  readonly trend: 'improving' | 'stable' | 'deteriorating';
  readonly formedTick: number | null;
  readonly changedTick: number;
  readonly endedTick: number | null;
  readonly firstToSecond: SocietyRelationshipDirectionProjection;
  readonly secondToFirst: SocietyRelationshipDirectionProjection;
  /** At most one bounded relationship-inspection page of source events. */
  readonly sharedEvents: readonly SocietyRelationshipEventProjection[];
  readonly sharedEventTotal: number;
}

export interface SocietyCultureProjection {
  readonly id: number;
  readonly name: string;
  readonly preference: string;
  readonly belief: string;
  readonly tradition: string;
  readonly architectureStyle: string;
  readonly familyPolicy: 'pair-bond' | 'communal-guardianship';
}

export interface SocietyTimelineProjection {
  readonly id: number;
  readonly tick: number;
  readonly summary: string;
}

export interface SocietyDashboardProjection {
  readonly year: number;
  readonly population: number;
  readonly households: number;
  readonly meals: number;
  readonly tools: number;
  readonly exchangeVolume: number;
  readonly transportDemand: number;
  readonly scarcity: number;
  readonly stability: number;
  readonly inequality: number;
  readonly government: string;
  readonly leaderName: string;
}

export interface SocietyProjection {
  readonly dashboard: SocietyDashboardProjection;
  readonly people: readonly SocietyPersonProjection[];
  readonly cultures: readonly SocietyCultureProjection[];
  readonly timeline: readonly SocietyTimelineProjection[];
  readonly timelineOffset: number;
  readonly timelineTotal: number;
}

export interface DevelopmentKnowledgeProjection {
  readonly id: KnowledgeId;
  readonly status: KnowledgeStatus;
  readonly progress: number;
}

export interface DevelopmentCrisisProjection {
  readonly id: number;
  readonly kind: DisasterKind;
  readonly severity: number;
  readonly startedTick: number;
  readonly triggerCondition: ConditionId;
  readonly triggerValue: number;
}

export interface DevelopmentProjection {
  readonly researchFocusId: KnowledgeId | null;
  readonly knowledge: readonly DevelopmentKnowledgeProjection[];
  readonly conditions: Readonly<Record<ConditionId, number>>;
  readonly activeCrises: readonly DevelopmentCrisisProjection[];
  readonly recoveredCrisisCount: number;
  readonly operationCount: number;
}

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
  /** Stable-ID-sorted visible agents. Parallel arrays have exactly this length. */
  readonly agentIds: Uint32Array;
  readonly agentTiles: Uint32Array;
  readonly agentHealth: Uint16Array;
  readonly agentActions: Uint8Array;
  /** Stable-ID-sorted visible structures. Parallel arrays have exactly this length. */
  readonly structureIds: Uint32Array;
  readonly structureTiles: Uint32Array;
  readonly structureKinds: Uint8Array;
  readonly structureStates: Uint8Array;
  /** Normalized authoritative units from 0 through 1,000. */
  readonly structureProgress: Uint16Array;
  /** Normalized authoritative units from 0 through 1,000. */
  readonly structureCondition: Uint16Array;
  readonly settlementSummary: SettlementSummary;
  readonly society: SocietyProjection;
  readonly development: DevelopmentProjection;
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
  readonly kind: 'intervention';
  readonly payload: Readonly<{
    interventionKind: InterventionKind;
    intensity: number;
    polarity: 'supportive' | 'challenging';
    targetTileIndex: number;
  }>;
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

export interface RequestTimelinePageRequest extends RequestBase {
  readonly type: 'requestTimelinePage';
  readonly offset: number;
}

/** Request one bounded, deliberate relationship-inspector page for a person. */
export interface RequestRelationshipPageRequest extends RequestBase {
  readonly type: 'requestRelationshipPage';
  readonly personId: number;
  readonly offset: number;
}

/** Request one bounded page from a specific relationship's retained factual history. */
export interface RequestRelationshipEventPageRequest extends RequestBase {
  readonly type: 'requestRelationshipEventPage';
  readonly personId: number;
  readonly relationshipId: string;
  readonly offset: number;
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
  | RequestTimelinePageRequest
  | RequestRelationshipPageRequest
  | RequestRelationshipEventPageRequest
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
  const config: {
    width?: number;
    height?: number;
    chunkSize?: number;
    societyYearTicks?: number;
  } = {};
  for (const key of ['width', 'height', 'chunkSize', 'societyYearTicks'] as const) {
    const candidate = value[key];
    if (candidate === undefined) {
      continue;
    }
    if (!isNonNegativeSafeInteger(candidate) || candidate < 1) {
      return 'invalid';
    }
    if (
      key === 'societyYearTicks' &&
      candidate !== NORMAL_YEAR_TICKS &&
      candidate !== ACCELERATED_YEAR_TICKS
    ) {
      return 'invalid';
    }
    config[key] = candidate;
  }
  return config;
}

function commandFrom(value: unknown): QueuedCommand | 'invalid' {
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(',') !== 'kind,payload' ||
    value.kind !== 'intervention' ||
    !isRecord(value.payload) ||
    Object.keys(value.payload).sort().join(',') !==
      'intensity,interventionKind,polarity,targetTileIndex'
  ) {
    return 'invalid';
  }
  const kinds = new Set<InterventionKind>([
    'weather',
    'resource',
    'organism',
    'omen',
    'artifact',
    'protection',
    'disaster',
    'alien-signal',
  ]);
  if (
    typeof value.payload.interventionKind !== 'string' ||
    !kinds.has(value.payload.interventionKind as InterventionKind) ||
    !isNonNegativeSafeInteger(value.payload.intensity) ||
    value.payload.intensity < 1 ||
    value.payload.intensity > 100 ||
    (value.payload.polarity !== 'supportive' && value.payload.polarity !== 'challenging') ||
    !isNonNegativeSafeInteger(value.payload.targetTileIndex)
  )
    return 'invalid';
  return Object.freeze({
    kind: 'intervention',
    payload: Object.freeze({
      interventionKind: value.payload.interventionKind as InterventionKind,
      intensity: value.payload.intensity,
      polarity: value.payload.polarity,
      targetTileIndex: value.payload.targetTileIndex,
    }),
  });
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
        ? invalid(requestId, 'queueCommand.command must be one closed typed intervention.')
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
      return isNonNegativeSafeInteger(input.ticks) && input.ticks <= MAX_ADVANCE_TICKS_PER_REQUEST
        ? {
            kind: 'valid',
            message: {
              type: 'advanceTicks',
              protocolVersion: WORKER_PROTOCOL_VERSION,
              requestId,
              ticks: input.ticks,
            },
          }
        : invalid(
            requestId,
            `advanceTicks.ticks must be an integer from 0 through ${MAX_ADVANCE_TICKS_PER_REQUEST}.`,
          );
    case 'requestSave':
      return {
        kind: 'valid',
        message: { type: 'requestSave', protocolVersion: WORKER_PROTOCOL_VERSION, requestId },
      };
    case 'requestTimelinePage':
      return isNonNegativeSafeInteger(input.offset)
        ? {
            kind: 'valid',
            message: {
              type: 'requestTimelinePage',
              protocolVersion: WORKER_PROTOCOL_VERSION,
              requestId,
              offset: input.offset,
            },
          }
        : invalid(requestId, 'requestTimelinePage.offset must be a non-negative safe integer.');
    case 'requestRelationshipPage':
      return isNonNegativeSafeInteger(input.personId) &&
        input.personId > 0 &&
        isNonNegativeSafeInteger(input.offset)
        ? {
            kind: 'valid',
            message: {
              type: 'requestRelationshipPage',
              protocolVersion: WORKER_PROTOCOL_VERSION,
              requestId,
              personId: input.personId,
              offset: input.offset,
            },
          }
        : invalid(
            requestId,
            'requestRelationshipPage.personId must be a positive safe integer and offset must be a non-negative safe integer.',
          );
    case 'requestRelationshipEventPage':
      return isNonNegativeSafeInteger(input.personId) &&
        input.personId > 0 &&
        typeof input.relationshipId === 'string' &&
        input.relationshipId.length > 0 &&
        input.relationshipId.length <= 128 &&
        isNonNegativeSafeInteger(input.offset)
        ? {
            kind: 'valid',
            message: {
              type: 'requestRelationshipEventPage',
              protocolVersion: WORKER_PROTOCOL_VERSION,
              requestId,
              personId: input.personId,
              relationshipId: input.relationshipId,
              offset: input.offset,
            },
          }
        : invalid(
            requestId,
            'requestRelationshipEventPage requires a positive personId, bounded relationshipId, and non-negative offset.',
          );
    case 'performOfflineCatchUp':
      return isNonNegativeSafeInteger(input.elapsedMilliseconds) &&
        isNonNegativeSafeInteger(input.rate) &&
        input.rate <= 1_000 &&
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
            'performOfflineCatchUp requires non-negative safe integer elapsedMilliseconds/rate and integer policyVersion.',
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

export interface TimelinePageResponse extends ResponseBase {
  readonly type: 'timelinePage';
  readonly offset: number;
  readonly total: number;
  readonly timeline: readonly SocietyTimelineProjection[];
}

/** A single, stable-sorted relationship inspector page. */
export interface RelationshipPageResponse extends ResponseBase {
  readonly type: 'relationshipPage';
  readonly personId: number;
  readonly offset: number;
  readonly total: number;
  readonly relationships: readonly SocietyRelationshipProjection[];
}

/** A bounded page from one relationship's retained factual event history. */
export interface RelationshipEventPageResponse extends ResponseBase {
  readonly type: 'relationshipEventPage';
  readonly personId: number;
  readonly relationshipId: string;
  readonly offset: number;
  readonly total: number;
  readonly events: readonly SocietyRelationshipEventProjection[];
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
  readonly id: number;
  readonly tick: number;
  readonly type: string;
  readonly summary: string;
  readonly subjectKind: string;
  readonly subjectId: number;
  readonly targetKind: string;
  readonly targetId: number;
  readonly tileIndex: number;
  readonly amount: number;
}

export type WorkerToUiMessage =
  | ReadyResponse
  | CommandAcceptedResponse
  | FrameDeltaResponse
  | EventBatchResponse
  | SaveSnapshotResponse
  | TimelinePageResponse
  | RelationshipPageResponse
  | RelationshipEventPageResponse
  | MetricsResponse
  | FaultResponse;

export function projectionTransferables(frame: WorldFrameProjection): readonly ArrayBuffer[] {
  return [
    frame.biome.buffer as ArrayBuffer,
    frame.resource.buffer as ArrayBuffer,
    frame.habitability.buffer as ArrayBuffer,
    frame.hazard.buffer as ArrayBuffer,
    frame.agentIds.buffer as ArrayBuffer,
    frame.agentTiles.buffer as ArrayBuffer,
    frame.agentHealth.buffer as ArrayBuffer,
    frame.agentActions.buffer as ArrayBuffer,
    frame.structureIds.buffer as ArrayBuffer,
    frame.structureTiles.buffer as ArrayBuffer,
    frame.structureKinds.buffer as ArrayBuffer,
    frame.structureStates.buffer as ArrayBuffer,
    frame.structureProgress.buffer as ArrayBuffer,
    frame.structureCondition.buffer as ArrayBuffer,
  ];
}
