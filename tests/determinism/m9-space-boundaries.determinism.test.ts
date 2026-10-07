import fc from 'fast-check';

import { deserializeWorldSnapshot, serializeWorldSnapshot } from '../../src/simulation/persistence';
import { ACCELERATED_YEAR_TICKS } from '../../src/simulation/society';
import {
  MAX_ACTIVE_CARGO_TRANSFERS,
  MAX_ACTIVE_MISSIONS,
  MAX_COMPLETED_CARGO_TRANSFERS,
  MAX_COMPLETED_MISSIONS,
  MAX_DELIVERED_COMMUNICATIONS,
  MAX_PENDING_COMMUNICATIONS,
} from '../../src/simulation/space';
import {
  assertWorldInvariants,
  canonicalWorldJson,
  hashWorldState,
  stepWorld,
  type WorldState,
} from '../../src/simulation/world';
import { createM9MatureWorld } from '../fixtures/m9-space-world';

const BOUNDARY_SPAN = ACCELERATED_YEAR_TICKS + 1;

function canonicalReload(world: WorldState): WorldState {
  return deserializeWorldSnapshot(serializeWorldSnapshot(world));
}

function partitionsFromCuts(cuts: readonly number[]): readonly number[] {
  const points = [0, ...cuts, BOUNDARY_SPAN].sort((left, right) => left - right);
  return points.slice(1).map((point, index) => point - points[index]!);
}

function advancePartitionedWithReloads(
  source: WorldState,
  partitions: readonly number[],
): WorldState {
  let world = canonicalReload(source);
  for (const ticks of partitions) {
    world = canonicalReload(stepWorld(world, ticks));
  }
  return world;
}

function assertSpaceQueuesBounded(world: WorldState): void {
  expect(
    world.space.missions.filter((mission) => mission.status === 'active').length,
  ).toBeLessThanOrEqual(MAX_ACTIVE_MISSIONS);
  expect(
    world.space.missions.filter((mission) => mission.status !== 'active').length,
  ).toBeLessThanOrEqual(MAX_COMPLETED_MISSIONS);
  expect(
    world.space.cargoTransfers.filter((transfer) => transfer.status === 'active').length,
  ).toBeLessThanOrEqual(MAX_ACTIVE_CARGO_TRANSFERS);
  expect(
    world.space.cargoTransfers.filter((transfer) => transfer.status !== 'active').length,
  ).toBeLessThanOrEqual(MAX_COMPLETED_CARGO_TRANSFERS);
  expect(
    world.space.communications.filter((message) => message.status === 'pending').length,
  ).toBeLessThanOrEqual(MAX_PENDING_COMMUNICATIONS);
  expect(
    world.space.communications.filter((message) => message.status !== 'pending').length,
  ).toBeLessThanOrEqual(MAX_DELIVERED_COMMUNICATIONS);
}

describe('M9 resolution-boundary determinism', () => {
  it.each([
    {
      name: 'mission arrival',
      sourceYears: 3,
      requiredEventKinds: ['mission-arrived'],
    },
    {
      name: 'mission, cargo, and communication arrivals',
      sourceYears: 5,
      requiredEventKinds: ['mission-arrived', 'cargo-arrived', 'communication-delivered'],
    },
  ] as const)(
    'preserves $name across arbitrary partitions and canonical reloads',
    ({ sourceYears, requiredEventKinds }) => {
      const source = stepWorld(createM9MatureWorld(), sourceYears * ACCELERATED_YEAR_TICKS);
      const baselineEventId = source.eventLog.at(-1)?.id ?? 0;
      const uninterrupted = stepWorld(source, BOUNDARY_SPAN);
      const uninterruptedJson = canonicalWorldJson(uninterrupted);
      const uninterruptedHash = hashWorldState(uninterrupted);
      const boundaryEvents = uninterrupted.eventLog.filter((event) => event.id > baselineEventId);

      for (const requiredKind of requiredEventKinds) {
        expect(boundaryEvents.some((event) => event.kind === requiredKind)).toBe(true);
      }
      assertWorldInvariants(uninterrupted);
      assertSpaceQueuesBounded(uninterrupted);

      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 0, max: BOUNDARY_SPAN }), {
            minLength: 0,
            maxLength: 8,
          }),
          (cuts) => {
            const resumed = advancePartitionedWithReloads(source, partitionsFromCuts(cuts));
            expect(canonicalWorldJson(resumed)).toBe(uninterruptedJson);
            expect(hashWorldState(resumed)).toBe(uninterruptedHash);
            expect(resumed.eventLog.filter((event) => event.id > baselineEventId)).toStrictEqual(
              boundaryEvents,
            );
            assertWorldInvariants(resumed);
            assertSpaceQueuesBounded(resumed);
          },
        ),
        { numRuns: 24 },
      );
    },
    120_000,
  );
});
