import { describe, expect, it } from 'vitest';

import { DISASTER_KINDS } from '../../src/simulation/development';
import { deserializeWorldSnapshot, serializeWorldSnapshot } from '../../src/simulation/persistence';
import {
  applyRecordedSupplyShortage,
  assertWorldInvariants,
  canonicalWorldJson,
  createInitialWorld,
  hashWorldState,
  stepWorld,
  type WorldState,
} from '../../src/simulation/world';
import {
  M10_COLLAPSE_RECOVERY_SCENARIO,
  type M10CollapseBaseline,
  type M10CollapseCheckpoint,
  type M10CollapseMetrics,
} from '../fixtures/m10-collapse-recovery';

const CONQUEST_SHORTCUT_EVENT_KINDS = new Set([
  'conflict-started',
  'conflict-resolved',
  'refugees-relocated',
  'settlement-restored',
  'settlement-ruined',
  'civilization-fragmented',
  'territory-changed',
]);

function operationTotals(world: WorldState): M10CollapseCheckpoint['operations'] {
  return Object.freeze({
    settlement: world.civilization.operationCount,
    society: world.civilization.society.operationCount,
    development: world.development.operationCount,
    civilizations: world.civilizations.operationCount,
    scale: world.populationScale.operationCount,
    space: world.space.operationCount,
  });
}

function livingPopulation(world: WorldState): number {
  return world.civilization.society.people.filter((person) => person.alive).length;
}

function shelterIntegrity(world: WorldState): number {
  return world.civilization.structures
    .filter((structure) => structure.kind === 'shelter')
    .reduce((total, structure) => total + structure.condition, 0);
}

function cumulativeProduction(world: WorldState): number {
  return world.civilization.agents.reduce(
    (total, agent) =>
      total +
      agent.activity.foodGathered +
      agent.activity.waterGathered +
      agent.activity.timberGathered +
      agent.activity.stoneGathered +
      agent.activity.constructionWork +
      agent.activity.transported,
    0,
  );
}

function metrics(world: WorldState, production: number): M10CollapseMetrics {
  return Object.freeze({
    population: livingPopulation(world),
    shelterIntegrity: shelterIntegrity(world),
    production,
    stability: world.civilization.society.stability,
  });
}

function declineDimensions(candidate: M10CollapseMetrics, baseline: M10CollapseMetrics): number {
  return (
    Number(candidate.population < baseline.population) +
    Number(candidate.shelterIntegrity < baseline.shelterIntegrity) +
    Number(candidate.production < baseline.production) +
    Number(candidate.stability < baseline.stability)
  );
}

function checkpoint(
  world: WorldState,
  checkpointMetrics: M10CollapseMetrics,
): M10CollapseCheckpoint {
  return Object.freeze({
    tick: world.tick,
    hash: hashWorldState(world),
    operations: operationTotals(world),
    metrics: checkpointMetrics,
  });
}

describe.sequential('M10 controlled collapse-to-autonomous-recovery evidence', () => {
  it('survives and canonically reloads an integrated low point before normal systems recover', () => {
    const scenario = M10_COLLAPSE_RECOVERY_SCENARIO;
    const observationStart =
      scenario.shockTick - scenario.productionWindowTicks * scenario.preShockObservationWindows;
    let world = stepWorld(
      createInitialWorld(scenario.seed, { societyYearTicks: scenario.yearTicks }),
      observationStart,
    );
    let previousProduction = cumulativeProduction(world);
    let preShockProduction = 0;
    for (let window = 0; window < scenario.preShockObservationWindows; window += 1) {
      world = stepWorld(world, scenario.productionWindowTicks);
      const nextProduction = cumulativeProduction(world);
      preShockProduction = Math.max(preShockProduction, nextProduction - previousProduction);
      previousProduction = nextProduction;
    }
    expect(world.tick).toBe(scenario.shockTick);
    assertWorldInvariants(world);
    expect(world.development.activeCrises).toHaveLength(0);
    const historyBeforeShock = world.development.crisisHistory.length;
    const preShockMetrics = metrics(world, preShockProduction);
    const preShockCheckpoint = checkpoint(world, preShockMetrics);
    const eventCountBeforeShock = world.eventLog.length;

    world = applyRecordedSupplyShortage(world, scenario.shockSeverity);
    expect(world.civilization.society.collapsed).toBe(true);
    expect(world.development.pendingInterventions).toHaveLength(0);
    expect(world.eventLog.slice(eventCountBeforeShock).map((event) => event.kind)).toStrictEqual([
      'supply-shortage',
      'settlement-collapsed',
    ]);

    const immediateShockMetrics = metrics(world, preShockProduction);
    let lowPointWorld: WorldState | null = world;
    let lowPointMetrics: M10CollapseMetrics | null = immediateShockMetrics;
    let recoveryWorld: WorldState | null = null;
    let recoveryMetrics: M10CollapseMetrics | null = null;
    let bestDeclineDimensions = declineDimensions(immediateShockMetrics, preShockMetrics);
    let minimumPopulation = preShockMetrics.population;
    let minimumShelterIntegrity = immediateShockMetrics.shelterIntegrity;
    let minimumProduction = preShockMetrics.production;
    let minimumStability = immediateShockMetrics.stability;
    let postRecoveryProduction = 0;
    let previousEventCount = world.eventLog.length;
    previousProduction = cumulativeProduction(world);

    while (world.tick < scenario.horizonTick) {
      world = stepWorld(world, scenario.productionWindowTicks);
      assertWorldInvariants(world);
      if (recoveryWorld === null) expect(world.development.activeCrises).toHaveLength(0);
      expect(world.development.pendingInterventions).toHaveLength(0);
      const nextProduction = cumulativeProduction(world);
      const windowProduction = nextProduction - previousProduction;
      const currentMetrics = metrics(world, windowProduction);
      const newEvents = world.eventLog.slice(previousEventCount);

      if (recoveryWorld === null && world.civilization.society.collapsed) {
        minimumPopulation = Math.min(minimumPopulation, currentMetrics.population);
        minimumShelterIntegrity = Math.min(
          minimumShelterIntegrity,
          currentMetrics.shelterIntegrity,
        );
        minimumProduction = Math.min(minimumProduction, currentMetrics.production);
        minimumStability = Math.min(minimumStability, currentMetrics.stability);
        const currentDeclineDimensions = declineDimensions(currentMetrics, preShockMetrics);
        if (
          currentDeclineDimensions > bestDeclineDimensions ||
          (currentDeclineDimensions === bestDeclineDimensions &&
            (lowPointMetrics === null || currentMetrics.stability < lowPointMetrics.stability))
        ) {
          bestDeclineDimensions = currentDeclineDimensions;
          lowPointWorld = world;
          lowPointMetrics = currentMetrics;
        }
      }
      if (
        recoveryWorld === null &&
        newEvents.some((event) => event.kind === 'settlement-recovered')
      ) {
        recoveryWorld = world;
        recoveryMetrics = currentMetrics;
      } else if (recoveryWorld !== null) {
        postRecoveryProduction = Math.max(postRecoveryProduction, windowProduction);
      }

      previousProduction = nextProduction;
      previousEventCount = world.eventLog.length;
    }

    expect(lowPointWorld, 'no integrated low point was observed').not.toBeNull();
    expect(lowPointMetrics, 'no integrated low-point metrics were observed').not.toBeNull();
    expect(recoveryWorld, 'no factual settlement recovery was observed').not.toBeNull();
    expect(recoveryMetrics, 'no recovery metrics were observed').not.toBeNull();
    const lowPoint = lowPointWorld;
    const low = lowPointMetrics;
    const recovered = recoveryWorld!;
    const recoveredMetrics = recoveryMetrics!;

    expect(bestDeclineDimensions).toBeGreaterThanOrEqual(3);
    expect(declineDimensions(low, preShockMetrics)).toBe(bestDeclineDimensions);
    expect(minimumPopulation).toBeLessThan(preShockMetrics.population);
    expect(minimumShelterIntegrity).toBeLessThan(preShockMetrics.shelterIntegrity);
    expect(minimumProduction).toBeLessThan(preShockMetrics.production);
    expect(minimumStability).toBeLessThan(preShockMetrics.stability);
    expect(recovered.tick).toBeGreaterThan(lowPoint.tick);
    expect(recoveredMetrics.stability).toBeGreaterThan(minimumStability);
    expect(world.civilization.society.collapsed).toBe(false);
    expect(livingPopulation(world)).toBeGreaterThan(minimumPopulation);
    expect(shelterIntegrity(world)).toBeGreaterThan(minimumShelterIntegrity);
    expect(postRecoveryProduction).toBeGreaterThan(minimumProduction);
    expect(world.civilization.society.stability).toBeGreaterThanOrEqual(60);

    const recoveryEvents = world.eventLog.filter(
      (event) => event.tick >= scenario.shockTick && event.tick <= recovered.tick,
    );
    const firstEventIndex = (kind: string) =>
      recoveryEvents.findIndex((event) => event.kind === kind);
    expect(recoveryEvents.filter((event) => event.kind === 'supply-shortage')).toHaveLength(1);
    expect(recoveryEvents.filter((event) => event.kind === 'settlement-collapsed')).toHaveLength(1);
    expect(recoveryEvents.filter((event) => event.kind === 'settlement-recovered')).toHaveLength(1);
    expect(firstEventIndex('supply-shortage')).toBeLessThan(
      firstEventIndex('settlement-collapsed'),
    );
    expect(firstEventIndex('settlement-collapsed')).toBeLessThan(firstEventIndex('person-died'));
    expect(firstEventIndex('person-died')).toBeLessThan(firstEventIndex('person-migrated'));
    expect(firstEventIndex('person-migrated')).toBeLessThan(
      firstEventIndex('settlement-recovered'),
    );
    expect(recoveryEvents.some((event) => CONQUEST_SHORTCUT_EVENT_KINDS.has(event.kind))).toBe(
      false,
    );
    expect(
      recoveryEvents.some((event) =>
        DISASTER_KINDS.some(
          (definition) =>
            `${definition.kind}-started` === event.kind ||
            `${definition.kind}-recovered` === event.kind,
        ),
      ),
    ).toBe(false);
    expect(
      world.development.crisisHistory
        .slice(historyBeforeShock)
        .some(
          (crisis) =>
            crisis.startedTick >= scenario.shockTick && crisis.startedTick <= recovered.tick,
        ),
    ).toBe(false);

    const lowPointSnapshot = serializeWorldSnapshot(lowPoint);
    const reloadedLowPoint = deserializeWorldSnapshot(lowPointSnapshot);
    expect(serializeWorldSnapshot(reloadedLowPoint)).toBe(lowPointSnapshot);
    expect(canonicalWorldJson(reloadedLowPoint)).toBe(canonicalWorldJson(lowPoint));
    const reloadedRecovery = stepWorld(reloadedLowPoint, recovered.tick - reloadedLowPoint.tick);
    expect(canonicalWorldJson(reloadedRecovery)).toBe(canonicalWorldJson(recovered));

    const observed: M10CollapseBaseline = Object.freeze({
      preShock: preShockCheckpoint,
      lowPoint: checkpoint(lowPoint, low),
      recovery: checkpoint(recovered, recoveredMetrics),
      final: checkpoint(world, metrics(world, postRecoveryProduction)),
      troughs: Object.freeze({
        population: minimumPopulation,
        shelterIntegrity: minimumShelterIntegrity,
        production: minimumProduction,
        stability: minimumStability,
      }),
    });
    expect(observed).toStrictEqual(scenario.expected);
  }, 300_000);
});
