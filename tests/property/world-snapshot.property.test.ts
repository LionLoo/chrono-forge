import fc from 'fast-check';

import { deserializeWorldSnapshot, serializeWorldSnapshot } from '../../src/simulation/persistence';
import { canonicalWorldJson, createInitialWorld, stepWorld } from '../../src/simulation/world';

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
        fc.integer({ min: 0, max: 1_000_000 }),
        (seed, width, height, tick) => {
          const world = stepWorld(createInitialWorld(seed, { width, height, chunkSize: 4 }), tick);
          const loaded = deserializeWorldSnapshot(serializeWorldSnapshot(world));
          expect(canonicalWorldJson(loaded)).toBe(canonicalWorldJson(world));
        },
      ),
      { numRuns: 100 },
    );
  });
});
