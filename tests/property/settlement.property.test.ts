import fc from 'fast-check';

import {
  assertWorldInvariants,
  createInitialWorld,
  hashWorldState,
  stepWorld,
} from '../../src/simulation/world';

describe('settlement invariants', () => {
  it('preserves bounded agents, resources, ownership, placements, and references', () => {
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
        fc.integer({ min: 0, max: 12_000 }),
        (seed, width, height, ticks) => {
          const world = stepWorld(createInitialWorld(seed, { width, height, chunkSize: 4 }), ticks);
          expect(() => assertWorldInvariants(world)).not.toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('is canonically equivalent for arbitrary tick partitions', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.integer({ min: 0, max: 0xffff_ffff }),
          fc.integer({ min: 0, max: 0xffff_ffff }),
          fc.integer({ min: 0, max: 0xffff_ffff }),
          fc.integer({ min: 0, max: 0xffff_ffff }),
        ),
        fc.integer({ min: 0, max: 20_000 }),
        fc.array(fc.integer({ min: 0, max: 2_000 }), { minLength: 1, maxLength: 12 }),
        (seed, total, partitions) => {
          const totalParts = partitions.reduce((sum, value) => sum + value, 0);
          const scaled =
            totalParts === 0
              ? [total]
              : partitions.map((value) => Math.trunc((value * total) / totalParts));
          const remainder = total - scaled.reduce((sum, value) => sum + value, 0);
          scaled[0] = (scaled[0] ?? 0) + remainder;
          let partitioned = createInitialWorld(seed);
          for (const ticks of scaled) partitioned = stepWorld(partitioned, ticks);
          expect(hashWorldState(partitioned)).toBe(
            hashWorldState(stepWorld(createInitialWorld(seed), total)),
          );
        },
      ),
      { numRuns: 100 },
    );
  }, 60_000);
});
