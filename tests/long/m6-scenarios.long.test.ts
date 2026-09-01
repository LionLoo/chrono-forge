import { describe, expect, it } from 'vitest';

import { M6_SCENARIOS } from '../fixtures/m6-scenarios';
import { deserializeWorldSnapshot, serializeWorldSnapshot } from '../../src/simulation/persistence';
import {
  assertWorldInvariants,
  createInitialWorld,
  hashWorldState,
  stepWorld,
  type WorldState,
} from '../../src/simulation/world';

function runCheckpoints(index: number): readonly WorldState[] {
  const scenario = M6_SCENARIOS[index]!;
  let world = createInitialWorld(scenario.seed, { societyYearTicks: scenario.yearTicks });
  let elapsedYears = 0;
  return scenario.checkpointYears.map((year) => {
    world = stepWorld(world, (year - elapsedYears) * scenario.yearTicks);
    elapsedYears = year;
    assertWorldInvariants(world);
    return world;
  });
}

describe('M6 accelerated multiple-civilization catalogue', () => {
  for (const [index, scenario] of M6_SCENARIOS.entries()) {
    it(`${scenario.name} reaches its locked factual outcome`, () => {
      const checkpoints = runCheckpoints(index);
      const yearFive = checkpoints[0]!;
      const final = checkpoints.at(-1)!;
      const eventKinds = final.eventLog.map((event) => event.kind);

      expect(yearFive.civilizations.settlements.length).toBeGreaterThan(1);
      expect(
        new Set(final.civilizations.settlements.map((settlement) => settlement.cultureId)).size,
      ).toBeGreaterThan(1);
      expect(final.civilizations.routes.length).toBeGreaterThan(0);
      expect(final.civilizations.operationCount).toBeGreaterThan(0);
      if (scenario.purpose.startsWith('peaceful')) {
        expect(eventKinds).not.toContain('conflict-started');
        expect(final.civilizations.routes.some((route) => route.status === 'active')).toBe(true);
      }
      if (scenario.purpose === 'peaceful-federation') {
        expect(eventKinds).toContain('federation-formed');
        expect(
          final.civilizations.civilizations.some(
            (civilization) => civilization.status === 'federated',
          ),
        ).toBe(true);
      }
      if (scenario.purpose === 'peaceful-coexistence') {
        expect(eventKinds).toContain('route-disrupted');
        expect(eventKinds).toContain('route-restored');
        expect(final.civilizations.civilizations.length).toBeGreaterThan(1);
        expect(
          final.civilizations.diplomacy.every((relation) => relation.status !== 'at-war'),
        ).toBe(true);
      }
      if (scenario.purpose === 'conflict-conquest') {
        expect(eventKinds).toContain('conflict-started');
        expect(eventKinds).toContain('conflict-resolved');
        expect(eventKinds).toContain('refugees-relocated');
        expect(
          final.civilizations.settlements.some((settlement) => settlement.status === 'conquered'),
        ).toBe(true);
        expect(
          final.civilizations.settlements.some(
            (settlement) => settlement.territoryHistory.length > 0,
          ),
        ).toBe(true);
      }
      if (scenario.purpose === 'conflict-fragmentation') {
        expect(eventKinds).toContain('federation-formed');
        expect(eventKinds).toContain('civilization-fragmented');
        expect(eventKinds).toContain('settlement-ruined');
        expect(final.civilizations.ruins.length).toBeGreaterThan(0);
      }
      const operations = {
        settlement: final.civilization.operationCount,
        society: final.civilization.society.operationCount,
        development: final.development.operationCount,
        civilizations: final.civilizations.operationCount,
      };
      expect.soft(checkpoints.map(hashWorldState)).toStrictEqual(scenario.expectedHashes);
      expect
        .soft({
          ...operations,
          total:
            operations.settlement +
            operations.society +
            operations.development +
            operations.civilizations,
        })
        .toStrictEqual(scenario.expectedOperations);
      const reloaded = deserializeWorldSnapshot(serializeWorldSnapshot(final));
      expect(hashWorldState(reloaded)).toBe(hashWorldState(final));
      expect
        .soft({
          settlement: reloaded.civilization.operationCount,
          society: reloaded.civilization.society.operationCount,
          development: reloaded.development.operationCount,
          civilizations: reloaded.civilizations.operationCount,
          total:
            reloaded.civilization.operationCount +
            reloaded.civilization.society.operationCount +
            reloaded.development.operationCount +
            reloaded.civilizations.operationCount,
        })
        .toStrictEqual(scenario.expectedOperations);
    }, 180_000);
  }
});
