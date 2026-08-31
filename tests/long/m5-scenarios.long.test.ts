import { describe, expect, it } from 'vitest';

import { M5_SCENARIOS } from '../fixtures/m5-scenarios';
import {
  assertWorldInvariants,
  createInitialWorld,
  hashWorldState,
  stepWorld,
  type WorldState,
} from '../../src/simulation/world';

function knowledgeSignature(world: WorldState): string {
  return world.development.knowledge
    .filter((record) => record.status === 'known')
    .map((record) => record.id)
    .join(',');
}

describe('M5 accelerated scenario acceptance', () => {
  it('locks divergent contextual development and autonomous crisis recovery', () => {
    const checkpoints = new Map<string, readonly WorldState[]>();
    for (const scenario of M5_SCENARIOS) {
      let world = createInitialWorld(scenario.seed, { societyYearTicks: scenario.yearTicks });
      let previousYear = 0;
      const scenarioCheckpoints: WorldState[] = [];
      for (const [index, year] of scenario.checkpointYears.entries()) {
        world = stepWorld(world, (year - previousYear) * scenario.yearTicks);
        previousYear = year;
        assertWorldInvariants(world);
        expect(world.development.tick).toBe(year * scenario.yearTicks);
        expect(world.development.operationCount).toBe(year);
        expect(hashWorldState(world)).toBe(scenario.expectedHashes[index]);
        scenarioCheckpoints.push(world);
      }
      checkpoints.set(scenario.name, Object.freeze(scenarioCheckpoints));
      expect(world.development.crisisHistory.length).toBeGreaterThan(0);
      expect(world.eventLog.some((event) => event.kind.endsWith('-started'))).toBe(true);
      expect(world.eventLog.some((event) => event.kind.endsWith('-recovered'))).toBe(true);
    }

    const river = checkpoints.get('river-inventors')!;
    const ore = checkpoints.get('ore-council')!;
    const storm = checkpoints.get('storm-kin')!;
    const renewed = checkpoints.get('renewed-observatory')!;
    expect(
      river[1]!.development.knowledge.find((record) => record.id === 'water-management')?.status,
    ).not.toBe('unknown');
    expect(knowledgeSignature(river[1]!)).toContain('agriculture');
    expect(knowledgeSignature(storm[1]!)).toContain('metallurgy');
    expect(knowledgeSignature(river[1]!)).not.toBe(knowledgeSignature(storm[1]!));
    expect(
      [...river, ...ore, ...storm, ...renewed].some(
        (world) =>
          world.development.knowledge.some((record) => record.status === 'lost') ||
          world.eventLog.some((event) => event.kind === 'knowledge-lost'),
      ),
    ).toBe(true);
    expect(knowledgeSignature(ore[2]!)).not.toBe(knowledgeSignature(renewed[2]!));
    expect(storm[2]!.eventLog.some((event) => event.kind === 'crisis-assisted')).toBe(true);
  }, 120_000);
});
