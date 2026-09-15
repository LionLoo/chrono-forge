import { describe, expect, it } from 'vitest';

import { deserializeWorldSnapshot, serializeWorldSnapshot } from '../../src/simulation/persistence';
import { ACCELERATED_YEAR_TICKS } from '../../src/simulation/society';
import {
  assertWorldInvariants,
  createInitialWorld,
  hashWorldState,
  stepWorld,
  type WorldState,
} from '../../src/simulation/world';

const CHECKPOINT_YEARS = [25, 75, 150, 240] as const;
const SCENARIOS = [
  {
    name: 'concord-orbit',
    seed: [7, 11, 13, 17] as const,
    // The first two M10-expanded hashes remain unchanged. The later two renew
    // after the M10 lifecycle fix prevents estranged kin from oscillating into
    // rivalry/enmity, removing six invalid society transition operations.
    expectedHashes: ['0dc1e8de', '1f538887', '8c38c58c', 'c9f18ba4'],
    expectedOperations: {
      settlement: 587_432,
      society: 113_552,
      development: 240,
      civilizations: 3_832,
      scale: 618_600,
      space: 1_922,
      total: 1_325_578,
    },
  },
  {
    name: 'contested-frontier',
    seed: [37, 41, 43, 47] as const,
    // Renewed for M10's intentional persisted name/culture/celestial-content expansion.
    expectedHashes: ['9331b225', '780acdb6', '8ce47f15', '3748a1d3'],
    expectedOperations: {
      settlement: 571_260,
      society: 111_345,
      development: 240,
      civilizations: 5_524,
      scale: 881_902,
      space: 738,
      total: 1_571_009,
    },
  },
] as const;

function operationTotals(world: WorldState) {
  const totals = {
    settlement: world.civilization.operationCount,
    society: world.civilization.society.operationCount,
    development: world.development.operationCount,
    civilizations: world.civilizations.operationCount,
    scale: world.populationScale.operationCount,
    space: world.space.operationCount,
  };
  return Object.freeze({
    ...totals,
    total: Object.values(totals).reduce((sum, count) => sum + count, 0),
  });
}

function assertPhysicalMinimum(world: WorldState): void {
  expect(
    world.development.knowledge.find((record) => record.id === 'advanced-energy')?.status,
  ).toBe('known');
  expect(
    world.development.knowledge.find((record) => record.id === 'planetary-engineering')?.status,
  ).toBe('known');
  expect(world.development.knowledge.find((record) => record.id === 'spaceflight')?.status).toBe(
    'known',
  );
  expect(world.space.bodies.length).toBeGreaterThan(1);
  expect(world.space.programs.some((program) => program.stage === 'spaceflight')).toBe(true);
  expect(world.space.spacecraft.length).toBeGreaterThan(0);
  expect(
    world.space.missions.some(
      (mission) => mission.kind === 'orbital' && mission.status === 'completed',
    ),
  ).toBe(true);
  const colonyMission = world.space.missions.find(
    (mission) => mission.kind === 'colony' && mission.status === 'completed',
  );
  expect(colonyMission?.manifestPassengerIds.length).toBeGreaterThan(0);
  const colony = world.space.colonies.find(
    (candidate) =>
      candidate.status === 'active' && candidate.civilizationId === colonyMission?.civilizationId,
  );
  expect(colony?.residentIds.length).toBeGreaterThan(0);
  expect(colony?.cultureDivergence).toBeGreaterThan(0);
  for (const residentId of colonyMission?.manifestPassengerIds ?? []) {
    expect(colony?.residentIds).toContain(residentId);
    expect(
      world.populationScale.cohorts.some((cohort) => cohort.residentIds.includes(residentId)),
    ).toBe(false);
  }
  expect(world.space.missions.every((mission) => mission.dueTick > mission.departureTick)).toBe(
    true,
  );
  expect(
    world.space.cargoTransfers.every((transfer) => transfer.dueTick > transfer.departureTick),
  ).toBe(true);
  expect(world.space.communications.every((message) => message.dueTick > message.sentTick)).toBe(
    true,
  );
  expect(world.space.cargoTransfers.some((transfer) => transfer.status === 'completed')).toBe(true);
  expect(world.space.communications.some((message) => message.status === 'delivered')).toBe(true);
  expect(world.space.communications.some((message) => message.topic === 'reply')).toBe(true);
  expect(world.space.aliens.some((alien) => alien.discoveredTick !== null)).toBe(true);
  expect(world.eventLog.some((event) => event.kind === 'alien-contacted')).toBe(true);
  expect(world.eventLog.some((event) => event.kind === 'mission-arrived')).toBe(true);
  expect(world.eventLog.some((event) => event.kind === 'cargo-arrived')).toBe(true);
  expect(world.eventLog.some((event) => event.kind === 'communication-delivered')).toBe(true);
  assertWorldInvariants(world);
}

describe.sequential('M9 accelerated planetary and space scenarios', () => {
  it('advances real founding worlds through the locked divergent space-age checkpoints', () => {
    const results: {
      name: string;
      hashes: string[];
      world: WorldState;
      missionSignature: string[];
      colonySignature: string[];
      totals: ReturnType<typeof operationTotals>;
    }[] = [];

    for (const scenario of SCENARIOS) {
      let world = createInitialWorld(scenario.seed, {
        societyYearTicks: ACCELERATED_YEAR_TICKS,
      });
      let priorYear = 0;
      const hashes: string[] = [];
      for (const year of CHECKPOINT_YEARS) {
        world = stepWorld(world, (year - priorYear) * ACCELERATED_YEAR_TICKS);
        priorYear = year;
        assertWorldInvariants(world);
        hashes.push(hashWorldState(world));
      }

      assertPhysicalMinimum(world);
      if (scenario.name === 'concord-orbit') {
        expect(
          world.space.relations.every(
            (relation) => relation.status === 'allied' || relation.status === 'cooperative',
          ),
        ).toBe(true);
        expect(world.space.relations.every((relation) => relation.exchangeCount > 0)).toBe(true);
        expect(
          world.space.cargoTransfers.some((transfer) => transfer.origin.kind === 'alien'),
        ).toBe(true);
      } else {
        expect(
          world.space.relations.some(
            (relation) => relation.status === 'competitive' || relation.status === 'hostile',
          ),
        ).toBe(true);
        expect(world.space.relations.some((relation) => relation.conflictCount > 0)).toBe(true);
        expect(world.eventLog.some((event) => event.kind === 'cargo-lost')).toBe(true);
      }

      const snapshot = serializeWorldSnapshot(world);
      const reloaded = deserializeWorldSnapshot(snapshot);
      expect(hashWorldState(reloaded)).toBe(hashes.at(-1));
      expect(serializeWorldSnapshot(reloaded)).toBe(snapshot);

      const missionSignature = world.space.missions
        .slice(0, 12)
        .map(
          (mission) =>
            `${mission.civilizationId}:${mission.kind}:${mission.destinationBodyId}:${mission.status}`,
        );
      const colonySignature = world.space.colonies.map(
        (colony) =>
          `${colony.civilizationId}:${colony.cultureId}:${colony.bodyId}:${colony.cultureDivergence}`,
      );
      const totals = operationTotals(world);
      results.push({
        name: scenario.name,
        hashes,
        world,
        missionSignature,
        colonySignature,
        totals,
      });
    }

    for (const [index, scenario] of SCENARIOS.entries()) {
      expect(results[index]!.hashes).toStrictEqual(scenario.expectedHashes);
      expect(results[index]!.totals).toStrictEqual(scenario.expectedOperations);
    }
    expect(results[0]!.hashes).not.toStrictEqual(results[1]!.hashes);
    expect(results[0]!.missionSignature).not.toStrictEqual(results[1]!.missionSignature);
    expect(results[0]!.colonySignature).not.toStrictEqual(results[1]!.colonySignature);
  }, 1_800_000);
});
