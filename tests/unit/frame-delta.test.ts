import {
  applyWorldFrameDelta,
  createWorldFrameDelta,
  estimateFrameDeltaPayloadBytes,
  frameDeltaTransferables,
  type WorldFrameDelta,
} from '../../src/protocol/frame-delta';
import type { WorldFrameProjection } from '../../src/protocol';
import { createInitialWorld, stepWorld } from '../../src/simulation/world';
import { projectWorldFrame } from '../../src/workers/simulation-runtime';

function frame(ticks = 0): WorldFrameProjection {
  const initial = createInitialWorld([7, 11, 13, 17], { width: 8, height: 6, chunkSize: 2 });
  return projectWorldFrame(ticks === 0 ? initial : stepWorld(initial, ticks));
}

function changed(
  source: WorldFrameProjection,
  changes: Partial<WorldFrameProjection>,
): WorldFrameProjection {
  return Object.freeze({
    ...source,
    tick: source.tick + 1,
    stateHash: `${source.stateHash}-next`,
    ...changes,
  });
}

describe('ordered world frame deltas', () => {
  it('emits a no-layer delta when only tick/hash advance', () => {
    const previous = frame();
    const next = changed(previous, {});
    const delta = createWorldFrameDelta(previous, next);

    expect(delta).toMatchObject({
      baseTick: previous.tick,
      tick: next.tick,
      stateHash: next.stateHash,
    });
    expect(delta.terrain).toBeUndefined();
    expect(delta.agents).toBeUndefined();
    expect(delta.structures).toBeUndefined();
    expect(frameDeltaTransferables(delta)).toStrictEqual([]);
    expect(applyWorldFrameDelta(previous, delta)).toStrictEqual(next);
  });

  it('emits each changed typed or object layer and reconstructs exactly', () => {
    const previous = frame();
    const civilizations = {
      ...previous.civilizations,
      tileOwners: new Uint32Array(previous.civilizations.tileOwners),
      operationCount: previous.civilizations.operationCount + 1,
    };
    civilizations.tileOwners[0] = 9;
    const next = changed(previous, {
      biome: new Uint8Array(
        previous.biome.map((value, index) => (index === 0 ? value + 1 : value)),
      ),
      agentHealth: new Uint16Array(
        previous.agentHealth.map((value, index) => (index === 0 ? value - 1 : value)),
      ),
      structureIds: new Uint32Array([99]),
      structureTiles: new Uint32Array([0]),
      structureKinds: new Uint8Array([1]),
      structureStates: new Uint8Array([2]),
      structureProgress: new Uint16Array([10]),
      structureCondition: new Uint16Array([990]),
      settlementSummary: {
        ...previous.settlementSummary,
        food: previous.settlementSummary.food + 1,
      },
      society: { ...previous.society, dashboard: { ...previous.society.dashboard, meals: 1 } },
      development: {
        ...previous.development,
        operationCount: previous.development.operationCount + 1,
      },
      civilizations,
    });
    const delta = createWorldFrameDelta(previous, next);

    expect(delta.terrain).toBeDefined();
    expect(delta.agents).toBeDefined();
    expect(delta.structures).toBeDefined();
    expect(delta.settlementSummary).toBeDefined();
    expect(delta.society).toBeDefined();
    expect(delta.development).toBeDefined();
    expect(delta.civilizations).toBeDefined();
    expect(Object.isFrozen(applyWorldFrameDelta(previous, delta))).toBe(true);
    expect(applyWorldFrameDelta(previous, delta)).toStrictEqual(next);
  });

  it('rejects stale, out-of-order, malformed, and dimension-incompatible patches', () => {
    const previous = frame();
    const delta = createWorldFrameDelta(previous, changed(previous, {}));
    expect(() => applyWorldFrameDelta(previous, { ...delta, baseTick: previous.tick + 1 })).toThrow(
      'base tick',
    );
    expect(() => applyWorldFrameDelta(previous, { ...delta, tick: previous.tick - 1 })).toThrow(
      'not monotonic',
    );
    expect(() => applyWorldFrameDelta(previous, { ...delta, width: previous.width + 1 })).toThrow(
      'dimensions',
    );
    expect(() => applyWorldFrameDelta(previous, { ...delta, version: 6 as never })).toThrow(
      'protocol version',
    );
    expect(() =>
      applyWorldFrameDelta(previous, {
        ...delta,
        agents: {
          ids: new Uint32Array([1]),
          tiles: new Uint32Array([]),
          health: new Uint16Array([1]),
          actions: new Uint8Array([1]),
        },
      }),
    ).toThrow('parallel arrays');
  });

  it('uses only changed transfer buffers and has deterministic payload accounting', () => {
    const previous = frame();
    const next = changed(previous, { agentActions: new Uint8Array(previous.agentActions) });
    next.agentActions[0] = 8;
    const delta = createWorldFrameDelta(previous, next);
    expect(frameDeltaTransferables(delta)).toStrictEqual([
      delta.agents!.ids.buffer,
      delta.agents!.tiles.buffer,
      delta.agents!.health.buffer,
      delta.agents!.actions.buffer,
    ]);
    expect(estimateFrameDeltaPayloadBytes(delta)).toBe(estimateFrameDeltaPayloadBytes(delta));
    expect(createWorldFrameDelta(previous, next)).toStrictEqual(delta);
  });

  it('stays below the M8 4 MiB transfer budget for a synthetic 5,000-agent patch', () => {
    const previous = frame();
    const count = 5_000;
    const next = changed(previous, {
      agentIds: Uint32Array.from({ length: count }, (_, index) => index + 1),
      agentTiles: Uint32Array.from(
        { length: count },
        (_, index) => index % (previous.width * previous.height),
      ),
      agentHealth: Uint16Array.from({ length: count }, () => 1_000),
      agentActions: Uint8Array.from({ length: count }, () => 1),
    });
    const delta = createWorldFrameDelta(previous, next);
    expect(estimateFrameDeltaPayloadBytes(delta)).toBeLessThan(4 * 1024 * 1024);
  });

  it('does not permit malformed typed layer payloads', () => {
    const previous = frame();
    const delta: WorldFrameDelta = {
      ...createWorldFrameDelta(previous, changed(previous, {})),
      terrain: {
        biome: new Uint8Array(1),
        resource: new Uint16Array(1),
        habitability: new Uint8Array(1),
        hazard: new Uint8Array(1),
      },
    };
    expect(() => applyWorldFrameDelta(previous, delta)).toThrow('terrain array lengths');
  });
});
