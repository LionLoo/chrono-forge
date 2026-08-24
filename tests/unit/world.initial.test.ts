import {
  Biome,
  canonicalWorldJson,
  createInitialWorld,
  hashWorldState,
  isWalkableTile,
  stepWorld,
  tileCoordinates,
  tileIndex,
} from '../../src/simulation/world';

const seed = [0x12345678, 0x9abcdef0, 0x0fedcba9, 0x87654321] as const;

function largestWalkableRegion(world: ReturnType<typeof createInitialWorld>): number {
  const visited = new Uint8Array(world.elevation.length);
  let largest = 0;
  for (let start = 0; start < world.elevation.length; start += 1) {
    if (visited[start] !== 0 || !isWalkableTile(world, start)) {
      continue;
    }
    const queue = [start];
    visited[start] = 1;
    let size = 0;
    for (const tile of queue) {
      size += 1;
      const [x, y] = tileCoordinates(world, tile);
      const neighbors = [
        x > 0 ? tile - 1 : -1,
        x + 1 < world.config.width ? tile + 1 : -1,
        y > 0 ? tile - world.config.width : -1,
        y + 1 < world.config.height ? tile + world.config.width : -1,
      ];
      for (const neighbor of neighbors) {
        if (neighbor >= 0 && visited[neighbor] === 0 && isWalkableTile(world, neighbor)) {
          visited[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }
    largest = Math.max(largest, size);
  }
  return largest;
}

function meanAdjacentElevationDelta(world: ReturnType<typeof createInitialWorld>): number {
  let totalDelta = 0;
  let edgeCount = 0;
  for (let y = 0; y < world.config.height; y += 1) {
    for (let x = 0; x < world.config.width; x += 1) {
      const index = tileIndex(world, x, y);
      if (x + 1 < world.config.width) {
        totalDelta += Math.abs(world.elevation[index]! - world.elevation[index + 1]!);
        edgeCount += 1;
      }
      if (y + 1 < world.config.height) {
        totalDelta += Math.abs(
          world.elevation[index]! - world.elevation[index + world.config.width]!,
        );
        edgeCount += 1;
      }
    }
  }
  return Math.trunc(totalDelta / edgeCount);
}

describe('initial world generation', () => {
  it('creates the documented dense chunked default world', () => {
    const world = createInitialWorld(seed);

    expect(world.config).toStrictEqual({ width: 96, height: 64, chunkSize: 32 });
    expect(world.chunks).toHaveLength(6);
    expect(world.chunks.map((chunk) => chunk.id)).toStrictEqual([0, 1, 2, 3, 4, 5]);
    for (const field of [
      world.elevation,
      world.water,
      world.temperature,
      world.moisture,
      world.biome,
      world.freshWater,
      world.food,
      world.timber,
      world.stone,
      world.metal,
      world.habitability,
      world.hazard,
      world.plants,
      world.animals,
    ]) {
      expect(field).toHaveLength(96 * 64);
    }
    expect(world.tiles.biome).toBe(world.biome);
    expect(world.tick).toBe(0);
    expect(world.nextEventId).toBe(3);
    expect(world.eventLog).toStrictEqual([
      {
        id: 1,
        tick: 0,
        kind: 'world-generated',
        subjectId: 0,
        targetId: 0,
        tileIndex: -1,
        amount: 0,
      },
      {
        id: 2,
        tick: 0,
        kind: 'founders-arrived',
        subjectId: 0,
        targetId: 0,
        tileIndex: world.civilization.centerTileIndex,
        amount: 6,
      },
    ]);
  });

  it('accepts the valid all-zero world seed while deriving a non-zero RNG stream', () => {
    expect(createInitialWorld([0, 0, 0, 0]).elevation).toHaveLength(96 * 64);
  });

  it('provides a substantial reachable habitable land region and variation', () => {
    const world = createInitialWorld(seed);

    expect(largestWalkableRegion(world)).toBeGreaterThanOrEqual(500);
    expect(new Set(world.biome)).toContain(Biome.Water);
    expect(new Set(world.biome).size).toBeGreaterThanOrEqual(5);
    expect(new Set(world.food).size).toBeGreaterThan(100);
    expect(new Set(world.metal).size).toBeGreaterThan(20);
  });

  it('forms coherent neighboring terrain while retaining regional diversity', () => {
    const seeds = [seed, [0, 0, 0, 0], [1, 2, 3, 4]] as const;

    for (const regionalSeed of seeds) {
      const world = createInitialWorld(regionalSeed);
      expect(meanAdjacentElevationDelta(world)).toBeLessThan(25);
      expect(new Set(world.elevation).size).toBeGreaterThan(250);
      expect(new Set(world.biome).size).toBeGreaterThanOrEqual(4);
    }
  });

  it('maps tile indices and coordinates with checked bounds', () => {
    const world = createInitialWorld(seed);
    const index = tileIndex(world, 95, 63);

    expect(index).toBe(6_143);
    expect(tileCoordinates(world, index)).toStrictEqual([95, 63]);
    expect(() => tileIndex(world, 96, 0)).toThrow(RangeError);
    expect(() => tileCoordinates(world, -1)).toThrow(RangeError);
    expect(isWalkableTile(world, -1)).toBe(false);
  });

  it('advances integer ticks immutably without modifying generation data', () => {
    const world = createInitialWorld(seed);
    const advanced = stepWorld(world, 23);

    expect(advanced).not.toBe(world);
    expect(world.tick).toBe(0);
    expect(advanced.tick).toBe(23);
    expect(advanced.elevation).toBe(world.elevation);
    expect(() => stepWorld(world, -1)).toThrow(RangeError);
  });

  it('makes canonical state JSON and hashes repeatable', () => {
    const first = createInitialWorld(seed);
    const second = createInitialWorld(seed);

    expect(canonicalWorldJson(first)).toBe(canonicalWorldJson(second));
    expect(hashWorldState(first)).toBe(hashWorldState(second));
    expect(hashWorldState(stepWorld(first, 1))).not.toBe(hashWorldState(first));
  });
});
