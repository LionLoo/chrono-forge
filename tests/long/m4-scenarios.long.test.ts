import { MAX_SOCIETY_RESIDENTS } from '../../src/simulation/society';
import {
  applyRecordedSupplyShortage,
  assertWorldInvariants,
  createInitialWorld,
  hashWorldState,
  stepWorld,
  type WorldState,
} from '../../src/simulation/world';
import { scenariosFor } from '../fixtures/m4-scenarios';

function operationCount(world: WorldState): number {
  return world.civilization.operationCount + world.civilization.society.operationCount;
}

function production(world: WorldState): number {
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

function transported(world: WorldState): number {
  return world.civilization.agents.reduce((total, agent) => total + agent.activity.transported, 0);
}

function shelterCapacity(world: WorldState): number {
  return world.civilization.structures
    .filter((structure) => structure.kind === 'shelter' && structure.status === 'operational')
    .reduce((total, structure) => total + structure.capacity, 0);
}

function householdGoods(world: WorldState): number {
  return world.civilization.society.households.reduce(
    (total, household) => total + household.meals + household.tools,
    0,
  );
}

function createScenarioWorld(seed: readonly [number, number, number, number], yearTicks: number) {
  return createInitialWorld(seed, { societyYearTicks: yearTicks });
}

describe('locked M4 long-horizon scenarios', () => {
  // Hosted runners can be several times slower than the locked local baseline.
  // Correctness and scale remain enforced by hashes and operation counts.
  it('keeps all three viable worlds multi-generational, social, cultural, and hash-locked', () => {
    for (const scenario of scenariosFor('viable-generations')) {
      const world = stepWorld(
        createScenarioWorld(scenario.seed, scenario.yearTicks),
        scenario.horizonTicks,
      );
      const society = world.civilization.society;
      const eventKinds = new Set(world.eventLog.map((event) => event.kind));

      expect.soft(hashWorldState(world), `${scenario.name} hash`).toBe(scenario.expectedHash);
      expect
        .soft(operationCount(world), `${scenario.name} operations`)
        .toBe(scenario.expectedOperations);
      expect(society.people.length).toBeLessThanOrEqual(MAX_SOCIETY_RESIDENTS);
      expect(society.people.filter((person) => person.alive).length).toBeGreaterThanOrEqual(6);
      expect(new Set(society.people.map((person) => person.name)).size).toBe(society.people.length);
      expect(society.people.some((person) => person.origin === 'founder')).toBe(true);
      expect(society.people.some((person) => person.origin === 'birth')).toBe(true);
      expect(society.people.some((person) => person.generation === 1)).toBe(true);
      expect(society.people.some((person) => person.generation >= 2)).toBe(true);
      expect(society.people.some((person) => person.parentIds[0] !== 0)).toBe(true);
      expect(new Set(society.cultures.map((culture) => culture.name)).size).toBe(2);
      expect(
        new Set(
          society.cultures.map((culture) =>
            [culture.preference, culture.belief, culture.tradition, culture.architectureStyle].join(
              '|',
            ),
          ),
        ).size,
      ).toBe(2);
      for (const kind of [
        'person-born',
        'person-died',
        'tools-crafted',
        'local-exchange',
        'government-changed',
      ]) {
        expect(eventKinds.has(kind), `${scenario.name} missing ${kind}`).toBe(true);
      }
      expect(
        [
          'resource-shared',
          'crisis-assisted',
          'knowledge-shared',
          'friendship-formed',
          'close-friendship-formed',
        ].some((kind) => eventKinds.has(kind)),
        `${scenario.name} lacks factual positive social activity`,
      ).toBe(true);
      // Controlled M4.5 catalogues lock rare separation and reconciliation paths;
      // stable long worlds must not manufacture recurring drama for a checklist.
      expect(society.groups).toHaveLength(2);
      expect(
        society.groups.every((group) =>
          group.memberIds.every((memberId) =>
            society.people.some((person) => person.id === memberId && person.alive),
          ),
        ),
      ).toBe(true);
      expect(() => assertWorldInvariants(world)).not.toThrow();
    }
  }, 600_000);

  it('compares one lean-market checkpoint and proves a recorded non-collapse shortage propagates', () => {
    const scenario = scenariosFor('scarcity-control')[0]!;
    const checkpoint = stepWorld(
      createScenarioWorld(scenario.seed, scenario.yearTicks),
      scenario.shock!.tick,
    );
    const control = stepWorld(checkpoint, 1_000);
    const shocked = applyRecordedSupplyShortage(checkpoint, scenario.shock!.severity);
    const shortage = stepWorld(shocked, 1_000);
    const controlVolume = control.civilization.society.offers.reduce(
      (total, offer) => total + offer.fulfilledAmount,
      0,
    );
    const shortageVolume = shortage.civilization.society.offers.reduce(
      (total, offer) => total + offer.fulfilledAmount,
      0,
    );

    expect(shocked.civilization.society.collapsed).toBe(false);
    expect(shocked.eventLog.at(-1)).toMatchObject({
      kind: 'supply-shortage',
      amount: scenario.shock!.severity,
    });
    expect(shocked.civilization.stockpile.food).toBeLessThan(
      checkpoint.civilization.stockpile.food,
    );
    expect(householdGoods(shocked)).toBeLessThan(householdGoods(checkpoint));
    expect(production(shortage) - production(checkpoint)).not.toBe(
      production(control) - production(checkpoint),
    );
    for (const offers of [
      shortage.civilization.society.offers,
      control.civilization.society.offers,
    ]) {
      expect(offers.length).toBeGreaterThan(0);
      expect(
        offers.every(
          (offer) =>
            offer.price >= 1 && offer.fulfilledAmount > 0 && offer.fulfilledAmount <= offer.amount,
        ),
      ).toBe(true);
    }
    expect(shortageVolume).toBe(controlVolume);
    expect(shortage.civilization.society.offers.map((offer) => offer.buyerHouseholdId)).not.toEqual(
      control.civilization.society.offers.map((offer) => offer.buyerHouseholdId),
    );
    expect(transported(shortage) - transported(checkpoint)).not.toBe(
      transported(control) - transported(checkpoint),
    );
    expect(shortage.civilization.agents[0]).not.toMatchObject({
      health: control.civilization.agents[0]!.health,
      hunger: control.civilization.agents[0]!.hunger,
      thirst: control.civilization.agents[0]!.thirst,
      carryingKind: control.civilization.agents[0]!.carryingKind,
      carryingAmount: control.civilization.agents[0]!.carryingAmount,
    });
    expect(
      shortage.eventLog.slice(checkpoint.eventLog.length).map((event) => event.kind),
    ).toContain('local-exchange');

    const final = stepWorld(shortage, scenario.horizonTicks - shortage.tick);
    expect.soft(hashWorldState(final), 'scarcity hash').toBe(scenario.expectedHash);
    expect.soft(operationCount(final), 'scarcity operations').toBe(scenario.expectedOperations);
    expect(final.civilization.society.collapsed).toBe(false);
    expect(final.civilization.society.stability).toBeGreaterThanOrEqual(60);
    expect(() => assertWorldInvariants(final)).not.toThrow();
  }, 180_000);

  it('records severe decline and then recovers autonomously without a reset or M5 disaster', () => {
    const scenario = scenariosFor('collapse-recovery')[0]!;
    const checkpoint = stepWorld(
      createScenarioWorld(scenario.seed, scenario.yearTicks),
      scenario.shock!.tick,
    );
    const initialPopulation = checkpoint.civilization.agents.filter((agent) => agent.alive).length;
    const initialCapacity = shelterCapacity(checkpoint);
    const initialProduction = production(checkpoint);
    const shocked = applyRecordedSupplyShortage(checkpoint, scenario.shock!.severity);
    let world = shocked;
    let minimumPopulation = initialPopulation;
    let minimumCapacity = initialCapacity;
    let minimumProductionDelta = Number.MAX_SAFE_INTEGER;
    let minimumStability = checkpoint.civilization.society.stability;
    let priorProduction = production(shocked);
    while (world.tick < scenario.horizonTicks) {
      world = stepWorld(world, 1_000);
      const nextProduction = production(world);
      minimumPopulation = Math.min(
        minimumPopulation,
        world.civilization.agents.filter((agent) => agent.alive).length,
      );
      minimumCapacity = Math.min(minimumCapacity, shelterCapacity(world));
      minimumProductionDelta = Math.min(minimumProductionDelta, nextProduction - priorProduction);
      minimumStability = Math.min(minimumStability, world.civilization.society.stability);
      priorProduction = nextProduction;
    }
    const relevant = world.eventLog.filter((event) =>
      [
        'supply-shortage',
        'settlement-collapsed',
        'person-died',
        'person-migrated',
        'settlement-recovered',
      ].includes(event.kind),
    );
    const firstIndex = (kind: string) => relevant.findIndex((event) => event.kind === kind);

    expect.soft(hashWorldState(world), 'recovery hash').toBe(scenario.expectedHash);
    expect.soft(operationCount(world), 'recovery operations').toBe(scenario.expectedOperations);
    expect(minimumPopulation).toBeLessThan(initialPopulation);
    expect(minimumCapacity).toBeLessThan(initialCapacity);
    expect(minimumProductionDelta).toBe(0);
    expect(minimumStability).toBeLessThan(checkpoint.civilization.society.stability);
    expect(relevant.filter((event) => event.kind === 'supply-shortage')).toHaveLength(1);
    expect(relevant.filter((event) => event.kind === 'settlement-collapsed')).toHaveLength(1);
    expect(relevant.filter((event) => event.kind === 'settlement-recovered')).toHaveLength(1);
    expect(relevant.filter((event) => event.kind === 'person-died').length).toBeGreaterThanOrEqual(
      initialPopulation,
    );
    expect(
      relevant.filter((event) => event.kind === 'person-migrated').length,
    ).toBeGreaterThanOrEqual(Math.max(3, Math.trunc(initialPopulation / 8)));
    expect(firstIndex('supply-shortage')).toBeLessThan(firstIndex('settlement-collapsed'));
    expect(firstIndex('settlement-collapsed')).toBeLessThan(firstIndex('person-died'));
    expect(firstIndex('person-died')).toBeLessThan(firstIndex('person-migrated'));
    expect(firstIndex('person-migrated')).toBeLessThan(firstIndex('settlement-recovered'));
    expect(world.civilization.society.collapsed).toBe(false);
    expect(world.civilization.society.stability).toBeGreaterThanOrEqual(60);
    expect(world.civilization.agents.some((agent) => agent.alive)).toBe(true);
    expect(shelterCapacity(world)).toBeGreaterThan(minimumCapacity);
    expect(production(world)).toBeGreaterThan(initialProduction);
    expect(
      world.eventLog.some((event) =>
        ['drought', 'flood', 'fire', 'storm', 'earthquake', 'disease', 'meteor-impact'].includes(
          event.kind,
        ),
      ),
    ).toBe(false);
    expect(() => assertWorldInvariants(world)).not.toThrow();
  }, 240_000);
});
