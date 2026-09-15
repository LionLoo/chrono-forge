import { describe, expect, it } from 'vitest';

import {
  assertFactualEventSummary,
  isPlayerVisibleEventKind,
  normalizeFactualEventSummary,
} from '../../src/simulation/events';
import { deserializeWorldSnapshot, serializeWorldSnapshot } from '../../src/simulation/persistence';
import { MAX_SOCIETY_RESIDENTS } from '../../src/simulation/society';
import {
  assertWorldInvariants,
  createInitialWorld,
  hashWorldState,
  stepWorld,
  type WorldState,
} from '../../src/simulation/world';
import { M10_EXPECTED_BASELINES, M10_SCENARIOS, type M10Baseline } from '../fixtures/m10-scenarios';

function operationTotals(world: WorldState) {
  return Object.freeze({
    settlement: world.civilization.operationCount,
    society: world.civilization.society.operationCount,
    development: world.development.operationCount,
    civilizations: world.civilizations.operationCount,
    scale: world.populationScale.operationCount,
    space: world.space.operationCount,
  });
}

function operationSum(world: WorldState): number {
  return Object.values(operationTotals(world)).reduce((sum, count) => sum + count, 0);
}

describe.sequential('M10 integrated 25-seed content-hardening catalogue', () => {
  it('locks unique seeds before running the catalogue', () => {
    expect(M10_SCENARIOS).toHaveLength(25);
    expect(new Set(M10_SCENARIOS.map((scenario) => scenario.seed.join(':'))).size).toBe(25);
    expect(M10_SCENARIOS.map((scenario) => scenario.name)).toEqual(
      expect.arrayContaining(['concord-orbit', 'contested-frontier']),
    );
  });

  it('keeps diverse full worlds coherent, active, bounded, and reloadable for 60 years', () => {
    const hashes = new Set<string>();
    const cultureNames = new Set<string>();
    const architectureStyles = new Set<string>();
    const personNameRoots = new Set<string>();
    const eventKinds = new Set<string>();
    const normalizedDescriptionKinds = new Map<string, Set<string>>();
    const year25Knowledge = new Set<string>();
    let multiGenerationWorlds = 0;
    let relationshipWorlds = 0;
    let crisisRecoveryWorlds = 0;
    let multiSettlementWorlds = 0;
    let advancedCityWorlds = 0;
    const baselines: M10Baseline[] = [];

    for (const [scenarioIndex, scenario] of M10_SCENARIOS.entries()) {
      let world = createInitialWorld(scenario.seed, { societyYearTicks: scenario.yearTicks });
      let previousYear = 0;
      let operationsAtYear25 = 0;
      for (const year of scenario.checkpointYears) {
        world = stepWorld(world, (year - previousYear) * scenario.yearTicks);
        previousYear = year;
        assertWorldInvariants(world);
        if (year === 25) {
          operationsAtYear25 = operationSum(world);
          year25Knowledge.add(
            world.development.knowledge
              .filter((record) => record.status === 'known')
              .map((record) => record.id)
              .join(','),
          );
        }
      }

      expect(world.tick, scenario.name).toBe(60 * scenario.yearTicks);
      expect(
        operationSum(world),
        `${scenario.name} stopped doing deterministic work`,
      ).toBeGreaterThan(operationsAtYear25);
      expect(
        world.civilization.society.people.filter((person) => person.alive).length,
        `${scenario.name} ended without a living detailed population`,
      ).toBeGreaterThan(0);
      expect(world.civilization.society.people.length, scenario.name).toBeLessThanOrEqual(
        MAX_SOCIETY_RESIDENTS,
      );
      expect(world.eventLog.length, `${scenario.name} lacks factual history`).toBeGreaterThan(2);

      const hash = hashWorldState(world);
      expect(hashes.has(hash), `${scenario.name} duplicated another final world`).toBe(false);
      hashes.add(hash);
      baselines.push({ name: scenario.name, hash, operations: operationTotals(world) });
      for (const culture of world.civilization.society.cultures) {
        cultureNames.add(culture.name);
        architectureStyles.add(culture.architectureStyle);
      }
      for (const person of world.civilization.society.people) {
        personNameRoots.add(person.name.split('-')[0]!);
      }
      for (const event of world.eventLog) {
        eventKinds.add(event.kind);
        expect(isPlayerVisibleEventKind(event.kind), `${scenario.name}: ${event.kind}`).toBe(true);
        expect(
          () => assertFactualEventSummary(event.summary),
          `${scenario.name}: ${event.kind}`,
        ).not.toThrow();
        const normalized = normalizeFactualEventSummary(event.summary);
        const kinds = normalizedDescriptionKinds.get(normalized) ?? new Set<string>();
        kinds.add(event.kind);
        normalizedDescriptionKinds.set(normalized, kinds);
      }

      if (world.civilization.society.people.some((person) => person.generation >= 2)) {
        multiGenerationWorlds += 1;
      }
      if (
        world.civilization.society.interpersonal.active.length > 0 &&
        world.civilization.society.interpersonal.familyBonds.length > 0
      ) {
        relationshipWorlds += 1;
      }
      if (
        world.development.crisisHistory.some((crisis) => crisis.outcome === 'recovered') &&
        world.eventLog.some((event) => event.kind.endsWith('-recovered'))
      ) {
        crisisRecoveryWorlds += 1;
      }
      if (
        world.civilizations.settlements.filter((settlement) => settlement.status === 'active')
          .length > 1
      ) {
        multiSettlementWorlds += 1;
      }
      if (
        world.civilizations.settlements.some(
          (settlement) =>
            settlement.status === 'active' && settlement.developmentStage === 'advanced-city',
        )
      ) {
        advancedCityWorlds += 1;
      }
      if (scenarioIndex % 5 === 0) {
        const snapshot = serializeWorldSnapshot(world);
        const reloaded = deserializeWorldSnapshot(snapshot);
        expect(hashWorldState(reloaded), `${scenario.name} reload hash`).toBe(hash);
        expect(serializeWorldSnapshot(reloaded), `${scenario.name} canonical reload`).toBe(
          snapshot,
        );
        expect(reloaded.eventLog, `${scenario.name} factual prose reload`).toStrictEqual(
          world.eventLog,
        );
      }
    }

    expect.soft(hashes.size, 'distinct hashes').toBe(25);
    expect.soft(cultureNames.size, 'culture names').toBeGreaterThanOrEqual(20);
    expect.soft(architectureStyles.size, 'architecture styles').toBeGreaterThanOrEqual(12);
    expect.soft(personNameRoots.size, 'person-name roots').toBeGreaterThanOrEqual(32);
    expect.soft(year25Knowledge.size, 'year-25 knowledge signatures').toBeGreaterThanOrEqual(4);
    expect.soft(multiGenerationWorlds, 'multi-generation worlds').toBeGreaterThanOrEqual(20);
    expect.soft(relationshipWorlds, 'relationship worlds').toBeGreaterThanOrEqual(20);
    expect.soft(crisisRecoveryWorlds, 'crisis-recovery worlds').toBeGreaterThanOrEqual(15);
    expect.soft(multiSettlementWorlds, 'multi-settlement worlds').toBeGreaterThanOrEqual(15);
    expect.soft(advancedCityWorlds, 'advanced-city worlds').toBeGreaterThanOrEqual(1);
    for (const [normalized, kinds] of normalizedDescriptionKinds) {
      expect
        .soft(
          kinds.size,
          `generic description shared across kinds: ${normalized} (${[...kinds].join(', ')})`,
        )
        .toBe(1);
    }
    for (const requiredKind of [
      'shelter-operational',
      'local-exchange',
      'person-born',
      'person-died',
      'friendship-formed',
      'government-changed',
      'knowledge-discovered',
      'settlement-founded',
      'settlement-stage-changed',
      'route-established',
    ]) {
      expect.soft(eventKinds.has(requiredKind), `catalogue missing ${requiredKind}`).toBe(true);
    }
    expect(baselines).toStrictEqual(M10_EXPECTED_BASELINES);
  }, 1_800_000);
});
