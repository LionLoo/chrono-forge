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
import { runReviewedFocusSession } from '../fixtures/m10-focus-session-evidence';

const CHECKPOINT_YEARS = [25, 75, 150, 240] as const;
const SCENARIOS = [
  {
    name: 'concord-orbit',
    seed: [7, 11, 13, 17] as const,
    // Renewed after co-located workers began choosing distinct viable routes;
    // every physical space outcome below remains independently asserted.
    expectedHashes: ['3c0a752f', '91eb7223', 'f941d2ac', '47c7065d'],
    expectedOperations: {
      settlement: 596_510,
      society: 108_009,
      development: 240,
      civilizations: 3_776,
      scale: 619_850,
      space: 1_852,
      total: 1_330_237,
    },
  },
  {
    name: 'contested-frontier',
    seed: [37, 41, 43, 47] as const,
    // Renewed after co-located workers began choosing distinct viable routes;
    // every physical space outcome below remains independently asserted.
    expectedHashes: ['a787da6a', '30fc0c34', '1a18b4d0', 'ed2fa3bf'],
    expectedOperations: {
      settlement: 501_772,
      society: 78_564,
      development: 240,
      civilizations: 5_201,
      scale: 872_402,
      space: 232,
      total: 1_458_411,
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
        const firstLateSession = runReviewedFocusSession(world, 36_000);
        const secondLateSession = runReviewedFocusSession(firstLateSession.world, 36_000);
        expect(firstLateSession.review.after.tick - firstLateSession.review.before.tick).toBe(
          36_000,
        );
        expect(secondLateSession.review.after.tick - secondLateSession.review.before.tick).toBe(
          36_000,
        );
        expect(secondLateSession.review.before).toStrictEqual(firstLateSession.review.after);
        expect(secondLateSession.world.space.programs.length).toBeGreaterThan(0);
        expect(secondLateSession.world.space.colonies.length).toBeGreaterThan(0);
        expect(
          secondLateSession.world.space.aliens.some((alien) => alien.discoveredTick !== null),
        ).toBe(true);
        expect(serializeWorldSnapshot(firstLateSession.world)).toBe(firstLateSession.snapshot);
        expect(serializeWorldSnapshot(secondLateSession.world)).toBe(secondLateSession.snapshot);
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

    expect(results.map(({ name, hashes, totals }) => ({ name, hashes, totals }))).toStrictEqual(
      SCENARIOS.map(({ name, expectedHashes: hashes, expectedOperations: totals }) => ({
        name,
        hashes,
        totals,
      })),
    );
    expect(results[0]!.hashes).not.toStrictEqual(results[1]!.hashes);
    expect(results[0]!.missionSignature).not.toStrictEqual(results[1]!.missionSignature);
    expect(results[0]!.colonySignature).not.toStrictEqual(results[1]!.colonySignature);
  }, 1_800_000);
});
