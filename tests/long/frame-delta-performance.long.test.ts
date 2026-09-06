// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';

import {
  WORKER_PROTOCOL_VERSION,
  type WorkerToUiMessage,
  type WorldFrameProjection,
} from '../../src/protocol';
import {
  applyWorldFrameDelta,
  createWorldFrameDelta,
  estimateFrameDeltaPayloadBytes,
  frameDeltaTransferables,
  type WorldFrameDelta,
} from '../../src/protocol/frame-delta';
import { createInitialWorld } from '../../src/simulation/world';
import { createSimulationRuntime, projectWorldFrame } from '../../src/workers/simulation-runtime';

const WIDTH = 128;
const HEIGHT = 96;
const TILE_COUNT = WIDTH * HEIGHT;
const AGENT_COUNT = 5_000;
const STRUCTURE_COUNT = 720;
const WARM_UP_DELTAS = 32;
const MEASURED_DELTAS = 500;
const PAYLOAD_LIMIT_BYTES = 4 * 1024 * 1024;
const APPLICATION_P95_LIMIT_MS = 8;

function percentile(samples: readonly number[], percentileValue: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil((percentileValue / 100) * sorted.length) - 1]!;
}

function commit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return process.env.GITHUB_SHA ?? 'unknown';
  }
}

function typedMetadata(value: unknown): unknown {
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return Object.freeze({
      $typedArray: value.constructor.name,
      byteLength: value.byteLength,
    });
  }
  if (Array.isArray(value)) return value.map((item) => typedMetadata(item));
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) result[key] = typedMetadata(source[key]);
    return result;
  }
  return value;
}

function independentlyAccountedPayloadBytes(delta: WorldFrameDelta): number {
  const transferBuffers = frameDeltaTransferables(delta);
  expect(new Set(transferBuffers).size).toBe(transferBuffers.length);
  const transferredBytes = transferBuffers.reduce((total, buffer) => total + buffer.byteLength, 0);
  const structuredMetadataBytes = new TextEncoder().encode(
    JSON.stringify(typedMetadata(delta)),
  ).byteLength;
  return transferredBytes + structuredMetadataBytes;
}

function representativeProjection(): WorldFrameProjection {
  const source = projectWorldFrame(
    createInitialWorld([8_080, 5_000, 100_000, 7], { width: WIDTH, height: HEIGHT, chunkSize: 8 }),
  );
  const biome = new Uint8Array(TILE_COUNT);
  const resource = new Uint16Array(TILE_COUNT);
  const habitability = new Uint8Array(TILE_COUNT);
  const hazard = new Uint8Array(TILE_COUNT);
  const tileOwners = new Uint32Array(TILE_COUNT);
  for (let tile = 0; tile < TILE_COUNT; tile += 1) {
    const x = tile % WIDTH;
    const y = Math.floor(tile / WIDTH);
    biome[tile] = (x * 3 + y * 5) % 7;
    resource[tile] = 200 + ((x * 29 + y * 17) % 1_600);
    habitability[tile] = 90 + ((x * 11 + y * 7) % 150);
    hazard[tile] = (x * 13 + y * 19) % 40;
    tileOwners[tile] = x < WIDTH / 2 ? 1 : 2;
  }
  const agentIds = Uint32Array.from({ length: AGENT_COUNT }, (_, index) => index + 1);
  const agentTiles = Uint32Array.from(
    { length: AGENT_COUNT },
    (_, index) => (index * 37 + Math.floor(index / WIDTH) * 23) % TILE_COUNT,
  );
  const agentHealth = Uint16Array.from({ length: AGENT_COUNT }, (_, index) => 800 + (index % 201));
  const agentActions = Uint8Array.from({ length: AGENT_COUNT }, (_, index) => index % 6);
  const structureIds = Uint32Array.from({ length: STRUCTURE_COUNT }, (_, index) => index + 1);
  const structureTiles = Uint32Array.from(
    { length: STRUCTURE_COUNT },
    (_, index) => (index * 71 + 19) % TILE_COUNT,
  );
  const structureKinds = Uint8Array.from({ length: STRUCTURE_COUNT }, (_, index) => index % 5);
  const structureStates = Uint8Array.from({ length: STRUCTURE_COUNT }, (_, index) => index % 3);
  const structureProgress = Uint16Array.from(
    { length: STRUCTURE_COUNT },
    (_, index) => 500 + (index % 501),
  );
  const structureCondition = Uint16Array.from(
    { length: STRUCTURE_COUNT },
    (_, index) => 650 + (index % 351),
  );

  return Object.freeze({
    ...source,
    version: WORKER_PROTOCOL_VERSION,
    biome,
    resource,
    habitability,
    hazard,
    agentIds,
    agentTiles,
    agentHealth,
    agentActions,
    structureIds,
    structureTiles,
    structureKinds,
    structureStates,
    structureProgress,
    structureCondition,
    settlementSummary: Object.freeze({
      population: AGENT_COUNT,
      food: 85_000,
      water: 79_000,
      timber: 43_000,
      stone: 31_000,
      operationalStructures: 600,
      shelterCapacity: 5_400,
      activeConstruction: 120,
    }),
    civilizations: Object.freeze({ ...source.civilizations, tileOwners }),
  });
}

function advanceProjection(previous: WorldFrameProjection, ordinal: number): WorldFrameProjection {
  const agentTiles = new Uint32Array(previous.agentTiles);
  const agentHealth = new Uint16Array(previous.agentHealth);
  const agentActions = new Uint8Array(previous.agentActions);
  const agent = ordinal % AGENT_COUNT;
  agentTiles[agent] = (agentTiles[agent]! + 1 + (ordinal % 5)) % TILE_COUNT;
  agentHealth[agent] = 800 + ((agentHealth[agent]! + ordinal) % 201);
  agentActions[agent] = (agentActions[agent]! + 1) % 6;

  const changes: {
    agentTiles: Uint32Array;
    agentHealth: Uint16Array;
    agentActions: Uint8Array;
    hazard?: Uint8Array;
    structureProgress?: Uint16Array;
    civilizations?: WorldFrameProjection['civilizations'];
  } = { agentTiles, agentHealth, agentActions };
  if (ordinal % 7 === 0) {
    const hazard = new Uint8Array(previous.hazard);
    const tile = (ordinal * 97) % TILE_COUNT;
    hazard[tile] = (hazard[tile]! + 1) % 64;
    changes.hazard = hazard;
  }
  if (ordinal % 11 === 0) {
    const structureProgress = new Uint16Array(previous.structureProgress);
    const structure = ordinal % STRUCTURE_COUNT;
    structureProgress[structure] = (structureProgress[structure]! + 3) % 1_001;
    changes.structureProgress = structureProgress;
  }
  if (ordinal % 13 === 0) {
    const tileOwners = new Uint32Array(previous.civilizations.tileOwners);
    const tile = (ordinal * 43) % TILE_COUNT;
    tileOwners[tile] = tileOwners[tile] === 1 ? 2 : 1;
    changes.civilizations = Object.freeze({ ...previous.civilizations, tileOwners });
  }

  return Object.freeze({
    ...previous,
    ...changes,
    tick: previous.tick + 1,
    stateHash: `frame-delta-scale-${ordinal}`,
    settlementSummary: Object.freeze({
      ...previous.settlementSummary,
      food: previous.settlementSummary.food + (ordinal % 3) - 1,
      water: previous.settlementSummary.water + (ordinal % 5) - 2,
    }),
    development: Object.freeze({
      ...previous.development,
      operationCount: previous.development.operationCount + 1,
    }),
  });
}

describe('M8 frame delta performance evidence', () => {
  it('reconstructs 500 warmed realistic 5,000-agent deltas under the transfer and application budgets', () => {
    let expectedFrame = representativeProjection();
    let transportBase = expectedFrame;
    for (let ordinal = 1; ordinal <= WARM_UP_DELTAS; ordinal += 1) {
      expectedFrame = advanceProjection(expectedFrame, ordinal);
      transportBase = applyWorldFrameDelta(
        transportBase,
        createWorldFrameDelta(transportBase, expectedFrame),
      );
      expect(transportBase).toStrictEqual(expectedFrame);
    }

    const applicationDurationsMs: number[] = [];
    let maximumPayloadBytes = 0;
    let reconstructedFrame = transportBase;
    for (let offset = 1; offset <= MEASURED_DELTAS; offset += 1) {
      const ordinal = WARM_UP_DELTAS + offset;
      expectedFrame = advanceProjection(expectedFrame, ordinal);
      const delta = createWorldFrameDelta(reconstructedFrame, expectedFrame);
      const transferBuffers = frameDeltaTransferables(delta);
      expect(transferBuffers.every((buffer) => buffer.byteLength > 0)).toBe(true);
      expect(estimateFrameDeltaPayloadBytes(delta)).toBe(independentlyAccountedPayloadBytes(delta));
      const payloadBytes = estimateFrameDeltaPayloadBytes(delta);
      maximumPayloadBytes = Math.max(maximumPayloadBytes, payloadBytes);
      expect(payloadBytes).toBeLessThan(PAYLOAD_LIMIT_BYTES);

      const startedAt = performance.now();
      const reconstructed = applyWorldFrameDelta(reconstructedFrame, delta);
      applicationDurationsMs.push(performance.now() - startedAt);
      if (offset % 50 === 0 || offset === MEASURED_DELTAS) {
        expect(reconstructed).toStrictEqual(expectedFrame);
      }
      reconstructedFrame = reconstructed;
    }

    const report = {
      ImageOS: process.env.ImageOS ?? 'unknown',
      ImageVersion: process.env.ImageVersion ?? 'unknown',
      Node: process.version,
      commit: commit(),
      warmupDeltas: WARM_UP_DELTAS,
      samples: MEASURED_DELTAS,
      agents: AGENT_COUNT,
      structures: STRUCTURE_COUNT,
      maximumPayloadBytes,
      medianApplicationMs: percentile(applicationDurationsMs, 50),
      p95ApplicationMs: percentile(applicationDurationsMs, 95),
      p99ApplicationMs: percentile(applicationDurationsMs, 99),
    };
    console.info('M8 frame delta performance evidence', report);

    expect(percentile(applicationDurationsMs, 95)).toBeLessThan(APPLICATION_P95_LIMIT_MS);
    expect(reconstructedFrame.tick).toBe(WARM_UP_DELTAS + MEASURED_DELTAS);
    expect(reconstructedFrame).toStrictEqual(expectedFrame);
    expect(reconstructedFrame.agentIds).toHaveLength(AGENT_COUNT);
    expect(reconstructedFrame.structureIds).toHaveLength(STRUCTURE_COUNT);
  }, 60_000);

  it('keeps the worker retained base intact when copied transfer buffers are structured-cloned', () => {
    const delivered: WorkerToUiMessage[] = [];
    const runtime = createSimulationRuntime((message, transfer) => {
      delivered.push(structuredClone(message, { transfer: [...transfer] }));
    });
    runtime.handleMessage({
      type: 'initialize',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'clone-ready',
      seed: [8_080, 5_000, 100_000, 7],
    });
    runtime.handleMessage({
      type: 'advanceTicks',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'clone-first-delta',
      ticks: 1,
    });
    runtime.handleMessage({
      type: 'advanceTicks',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'clone-second-delta',
      ticks: 1,
    });

    const ready = delivered.find(
      (message): message is Extract<WorkerToUiMessage, { type: 'ready' }> =>
        message.type === 'ready',
    );
    const deltas = delivered.filter(
      (message): message is Extract<WorkerToUiMessage, { type: 'frameDelta' }> =>
        message.type === 'frameDelta',
    );
    expect(ready).toBeDefined();
    expect(deltas).toHaveLength(2);
    let reconstructed = ready!.frame;
    for (const delta of deltas) reconstructed = applyWorldFrameDelta(reconstructed, delta.delta);
    expect(reconstructed.tick).toBe(2);
    expect(deltas[1]!.delta.baseTick).toBe(1);
  });
});
