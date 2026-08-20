import fc from 'fast-check';
import {
  createInitialWorld,
  isWalkableTile,
  tileCoordinates,
  tileIndex,
} from '../../src/simulation/world';

describe('world generation properties', () => {
  it('keeps every field finite, dense, and internally indexable', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.integer({ min: 0, max: 0xffff_ffff }),
          fc.integer({ min: 0, max: 0xffff_ffff }),
          fc.integer({ min: 0, max: 0xffff_ffff }),
          fc.integer({ min: 0, max: 0xffff_ffff }),
        ),
        fc.integer({ min: 1, max: 64 }),
        fc.integer({ min: 1, max: 64 }),
        (seed, width, height) => {
          const world = createInitialWorld(seed, { width, height, chunkSize: 32 });
          const fields = [
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
          ];
          for (const field of fields) {
            expect(field).toHaveLength(width * height);
            expect(Array.from(field).every(Number.isFinite)).toBe(true);
          }
          const finalIndex = tileIndex(world, width - 1, height - 1);
          expect(tileCoordinates(world, finalIndex)).toStrictEqual([width - 1, height - 1]);
          expect(typeof isWalkableTile(world, finalIndex)).toBe('boolean');
        },
      ),
      { numRuns: 100 },
    );
  });
});
