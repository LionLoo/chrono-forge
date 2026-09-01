import fc from 'fast-check';

import {
  MAX_ACTIVE_CIVILIZATIONS,
  MAX_ACTIVE_CONFLICTS,
  MAX_ACTIVE_ROUTES,
  MAX_ACTIVE_SETTLEMENTS,
  MAX_DIPLOMACY_PAIRS,
  MAX_RUINS,
} from '../../src/simulation/civilizations';
import {
  assertWorldInvariants,
  createInitialWorld,
  hashWorldState,
  stepWorld,
} from '../../src/simulation/world';

const seedArbitrary = fc.tuple(
  fc.integer({ min: 0, max: 0xffff_ffff }),
  fc.integer({ min: 0, max: 0xffff_ffff }),
  fc.integer({ min: 0, max: 0xffff_ffff }),
  fc.integer({ min: 0, max: 0xffff_ffff }),
);

describe('M6 multiple-civilization properties', () => {
  it('preserves bounded authority and one active residency per represented subject', () => {
    fc.assert(
      fc.property(seedArbitrary, (seed) => {
        const world = stepWorld(
          createInitialWorld(seed, {
            width: 16,
            height: 12,
            chunkSize: 4,
            societyYearTicks: 5_000,
          }),
          15_000,
        );
        const state = world.civilizations;
        const activeResidencies = state.residencies.filter((entry) => entry.endedTick === null);
        const residencyKeys = activeResidencies.map(
          (entry) => `${entry.subjectKind}:${entry.subjectId}`,
        );

        assertWorldInvariants(world);
        expect(
          state.settlements.filter((entry) => entry.status === 'active').length,
        ).toBeLessThanOrEqual(MAX_ACTIVE_SETTLEMENTS);
        expect(
          state.civilizations.filter((entry) => entry.endedTick === null).length,
        ).toBeLessThanOrEqual(MAX_ACTIVE_CIVILIZATIONS);
        expect(state.routes.filter((entry) => entry.status !== 'ended').length).toBeLessThanOrEqual(
          MAX_ACTIVE_ROUTES,
        );
        expect(state.diplomacy.length).toBeLessThanOrEqual(MAX_DIPLOMACY_PAIRS);
        expect(
          state.conflicts.filter((entry) => entry.status === 'active').length,
        ).toBeLessThanOrEqual(MAX_ACTIVE_CONFLICTS);
        expect(state.ruins.length).toBeLessThanOrEqual(MAX_RUINS);
        expect(new Set(residencyKeys).size).toBe(residencyKeys.length);
      }),
      { numRuns: 20 },
    );
  }, 30_000);

  it('is invariant under arbitrary tick partitions across annual boundaries', () => {
    fc.assert(
      fc.property(
        seedArbitrary,
        fc.array(fc.integer({ min: 0, max: 2_000 }), { minLength: 2, maxLength: 8 }),
        (seed, partitions) => {
          const config = { width: 16, height: 12, chunkSize: 4, societyYearTicks: 5_000 };
          let partitioned = createInitialWorld(seed, config);
          for (const ticks of partitions) partitioned = stepWorld(partitioned, ticks);
          const total = partitions.reduce((sum, ticks) => sum + ticks, 0);
          const direct = stepWorld(createInitialWorld(seed, config), total);

          expect(hashWorldState(partitioned)).toBe(hashWorldState(direct));
          expect(partitioned.civilizations.operationCount).toBe(
            direct.civilizations.operationCount,
          );
        },
      ),
      { numRuns: 20 },
    );
  }, 30_000);
});
