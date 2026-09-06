import fc from 'fast-check';

import { deserializeWorldSnapshot, serializeWorldSnapshot } from '../../src/simulation/persistence';
import {
  canonicalWorldJson,
  createInitialWorld,
  hashWorldState,
  stepWorld,
} from '../../src/simulation/world';

describe('world snapshot properties', () => {
  it('round-trips seeded worlds and safe logical ticks canonically', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.integer({ min: 0, max: 0xffff_ffff }),
          fc.integer({ min: 0, max: 0xffff_ffff }),
          fc.integer({ min: 0, max: 0xffff_ffff }),
          fc.integer({ min: 0, max: 0xffff_ffff }),
        ),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 20_000 }),
        fc.integer({ min: 0, max: 20_000 }),
        (seed, width, height, tick, partition) => {
          const world = stepWorld(createInitialWorld(seed, { width, height, chunkSize: 4 }), tick);
          const loaded = deserializeWorldSnapshot(serializeWorldSnapshot(world));
          expect(canonicalWorldJson(loaded)).toBe(canonicalWorldJson(world));
          expect(hashWorldState(loaded)).toBe(hashWorldState(world));
          expect(loaded.civilization.pathDemand).not.toBe(world.civilization.pathDemand);
          expect(loaded.civilizations.tileOwners).not.toBe(world.civilizations.tileOwners);
          expect(loaded.civilization.agents).toHaveLength(world.civilization.agents.length);

          const partitioned = stepWorld(
            stepWorld(createInitialWorld(seed, { width, height, chunkSize: 4 }), partition),
            tick,
          );
          const combined = stepWorld(
            createInitialWorld(seed, { width, height, chunkSize: 4 }),
            partition + tick,
          );
          expect(hashWorldState(partitioned)).toBe(hashWorldState(combined));
        },
      ),
      { numRuns: 100 },
    );
  }, 90_000);
});
