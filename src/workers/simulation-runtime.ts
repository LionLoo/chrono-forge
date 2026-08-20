import {
  WORKER_PROTOCOL_VERSION,
  projectionTransferables,
  validateUiToWorkerMessage,
  type AdvanceTicksRequest,
  type FrameDeltaResponse,
  type InitializeRequest,
  type LoadRequest,
  type PerformOfflineCatchUpRequest,
  type RequestSaveRequest,
  type RunMode,
  type WorkerFaultCode,
  type WorkerToUiMessage,
  type WorldFrameProjection,
} from '../protocol';
import { deserializeWorldSnapshot, serializeWorldSnapshot } from '../simulation/persistence';
import {
  appendWorldEvent,
  createInitialWorld,
  hashWorldState,
  stepWorld,
  type WorldState,
} from '../simulation/world';

export const OFFLINE_CATCH_UP_POLICY_VERSION = 1;
export const MAX_OFFLINE_CATCH_UP_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;
export const MAX_OFFLINE_CATCH_UP_TICKS = 1_000_000;

export type RuntimePost = (message: WorkerToUiMessage, transfer: readonly ArrayBuffer[]) => void;

export interface SimulationRuntime {
  readonly handleMessage: (message: unknown) => void;
}

function assertValidTicks(ticks: number): void {
  if (!Number.isSafeInteger(ticks) || ticks < 0) {
    throw new RangeError('Advance ticks must be a non-negative safe integer.');
  }
}

function toByte(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 255) {
    throw new RangeError('Projection byte values must be integers in the range 0 through 255.');
  }
  return value;
}

function toResource(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('Projection resource values must be non-negative safe integers.');
  }
  return value;
}

/** Creates a copied, transfer-ready UI read model without exposing world authority. */
export function projectWorldFrame(state: WorldState): WorldFrameProjection {
  const { width, height } = state.config;
  const expectedTiles = width * height;
  const { tiles } = state;
  if (
    !Number.isSafeInteger(expectedTiles) ||
    tiles.biome.length !== expectedTiles ||
    tiles.freshWater.length !== expectedTiles ||
    tiles.food.length !== expectedTiles ||
    tiles.timber.length !== expectedTiles ||
    tiles.stone.length !== expectedTiles ||
    tiles.metal.length !== expectedTiles ||
    tiles.habitability.length !== expectedTiles ||
    tiles.hazard.length !== expectedTiles
  ) {
    throw new Error('World tiles do not match the configured projection dimensions.');
  }

  const biome = new Uint8Array(expectedTiles);
  const resource = new Uint16Array(expectedTiles);
  const habitability = new Uint8Array(expectedTiles);
  const hazard = new Uint8Array(expectedTiles);
  for (let index = 0; index < expectedTiles; index += 1) {
    const tileBiome = tiles.biome[index];
    const freshWater = tiles.freshWater[index];
    const food = tiles.food[index];
    const timber = tiles.timber[index];
    const stone = tiles.stone[index];
    const metal = tiles.metal[index];
    const tileHabitability = tiles.habitability[index];
    const tileHazard = tiles.hazard[index];
    if (
      tileBiome === undefined ||
      freshWater === undefined ||
      food === undefined ||
      timber === undefined ||
      stone === undefined ||
      metal === undefined ||
      tileHabitability === undefined ||
      tileHazard === undefined
    ) {
      throw new Error('World tile projection encountered a missing tile.');
    }
    biome[index] = toByte(tileBiome);
    const resources =
      toResource(freshWater) +
      toResource(food) +
      toResource(timber) +
      toResource(stone) +
      toResource(metal);
    resource[index] = Math.min(65_535, resources);
    habitability[index] = toByte(tileHabitability);
    hazard[index] = toByte(tileHazard);
  }

  return Object.freeze({
    version: WORKER_PROTOCOL_VERSION,
    width,
    height,
    tick: state.tick,
    stateHash: hashWorldState(state),
    biome,
    resource,
    habitability,
    hazard,
  });
}

export function createSimulationRuntime(post: RuntimePost): SimulationRuntime {
  let world: WorldState | undefined;
  let runMode: RunMode = 'paused';

  function emit(message: WorkerToUiMessage): void {
    const transfer =
      message.type === 'ready' || message.type === 'frameDelta'
        ? projectionTransferables(message.frame)
        : [];
    post(message, transfer);
  }

  function fault(requestId: string, code: WorkerFaultCode, message: string): void {
    emit({ type: 'fault', protocolVersion: WORKER_PROTOCOL_VERSION, requestId, code, message });
  }

  function metrics(requestId: string): void {
    emit({
      type: 'metrics',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId,
      metrics: { tick: world?.tick ?? 0, runMode, queuedCommandCount: 0 },
    });
  }

  function initialize(request: InitializeRequest): void {
    world = createInitialWorld(request.seed, request.config);
    runMode = 'paused';
    emit({
      type: 'ready',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      frame: projectWorldFrame(world),
    });
    metrics(request.requestId);
  }

  function advance(request: AdvanceTicksRequest): void {
    if (world === undefined) {
      fault(request.requestId, 'not-initialized', 'Initialize a world before advancing ticks.');
      return;
    }
    assertValidTicks(request.ticks);
    world = stepWorld(world, request.ticks);
    const response: FrameDeltaResponse = {
      type: 'frameDelta',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      frame: projectWorldFrame(world),
    };
    emit(response);
    metrics(request.requestId);
  }

  function load(request: LoadRequest): void {
    world = deserializeWorldSnapshot(request.snapshot);
    runMode = 'paused';
    emit({
      type: 'ready',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      frame: projectWorldFrame(world),
    });
    metrics(request.requestId);
  }

  function requestSave(request: RequestSaveRequest): void {
    if (world === undefined) {
      fault(request.requestId, 'not-initialized', 'Initialize a world before requesting a save.');
      return;
    }
    emit({
      type: 'saveSnapshot',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      snapshot: serializeWorldSnapshot(world),
    });
  }

  function performOfflineCatchUp(request: PerformOfflineCatchUpRequest): void {
    if (world === undefined) {
      fault(request.requestId, 'not-initialized', 'Initialize a world before offline catch-up.');
      return;
    }
    if (request.policyVersion !== OFFLINE_CATCH_UP_POLICY_VERSION) {
      fault(
        request.requestId,
        'unsupported-operation',
        `Offline catch-up policy ${request.policyVersion} is not supported.`,
      );
      return;
    }
    const elapsedMilliseconds = Math.min(
      request.elapsedMilliseconds,
      MAX_OFFLINE_CATCH_UP_MILLISECONDS,
    );
    const requestedTicks = Math.floor((elapsedMilliseconds * request.rate) / 1_000);
    const ticks = Math.min(requestedTicks, MAX_OFFLINE_CATCH_UP_TICKS);
    if (ticks > 0) {
      world = appendWorldEvent(stepWorld(world, ticks), 'offline-catch-up');
    }
    emit({
      type: 'frameDelta',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      frame: projectWorldFrame(world),
    });
    if (ticks > 0) {
      const event = world.eventLog.at(-1)!;
      emit({
        type: 'eventBatch',
        protocolVersion: WORKER_PROTOCOL_VERSION,
        requestId: request.requestId,
        events: [{ id: event.id, tick: event.tick, type: event.kind, subjectId: 0 }],
      });
    }
    metrics(request.requestId);
  }

  return Object.freeze({
    handleMessage(input: unknown): void {
      const validation = validateUiToWorkerMessage(input);
      if (validation.kind === 'invalid') {
        fault(validation.requestId, 'invalid-request', validation.reason);
        return;
      }
      if (validation.kind === 'protocol-version-mismatch') {
        fault(
          validation.requestId,
          'protocol-version-mismatch',
          `Unsupported worker protocol version ${validation.receivedVersion}.`,
        );
        return;
      }
      const message = validation.message;

      try {
        switch (message.type) {
          case 'initialize':
            initialize(message);
            return;
          case 'load':
            load(message);
            return;
          case 'advanceTicks':
            advance(message);
            return;
          case 'setRunMode':
            runMode = message.runMode;
            metrics(message.requestId);
            return;
          case 'queueCommand':
            fault(
              message.requestId,
              'unsupported-operation',
              `${message.type} is not available until the persistence and focus milestone.`,
            );
            return;
          case 'requestSave':
            requestSave(message);
            return;
          case 'performOfflineCatchUp':
            performOfflineCatchUp(message);
            return;
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown world runtime error.';
        fault(message.requestId, 'world-error', reason);
      }
    },
  });
}
