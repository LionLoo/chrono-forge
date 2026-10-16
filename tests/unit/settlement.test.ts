import {
  SETTLEMENT_FOUNDER_COUNT,
  advanceCivilization,
  assertCivilizationInvariants,
  createInitialCivilization,
  isViableSettlement,
  settlementSummary,
  type CivilizationState,
  type SettlementTerrain,
  type SettlementStructure,
} from '../../src/simulation/settlement';
import { migrateLegacyInterpersonalState } from '../../src/simulation/relationships';
import { createInitialWorld, hashWorldState, stepWorld } from '../../src/simulation/world';

function terrainFrom(world: ReturnType<typeof createInitialWorld>) {
  return {
    width: world.config.width,
    height: world.config.height,
    food: world.food,
    freshWater: world.freshWater,
    timber: world.timber,
    stone: world.stone,
    habitability: world.habitability,
    hazard: world.hazard,
    isWalkable: (index: number) =>
      world.water[index] === 0 &&
      (world.habitability[index] ?? 0) >= 80 &&
      (world.hazard[index] ?? 255) < 180,
  } as const;
}

function uniformTerrain(width = 7, height = 7): SettlementTerrain {
  const tileCount = width * height;
  return {
    width,
    height,
    food: new Uint16Array(tileCount),
    freshWater: new Uint16Array(tileCount),
    timber: new Uint16Array(tileCount),
    stone: new Uint16Array(tileCount),
    habitability: new Uint8Array(tileCount).fill(100),
    hazard: new Uint8Array(tileCount),
    isWalkable: (index: number) => index >= 0 && index < tileCount,
  };
}

function operationalShelter(tileIndex: number, condition = 1_000): SettlementStructure {
  return {
    id: 1,
    kind: 'shelter',
    status: 'operational',
    tileIndex,
    progress: 1_000,
    condition,
    level: 1,
    capacity: SETTLEMENT_FOUNDER_COUNT,
    communalOwnership: true,
    ownerId: 0,
    plannedTick: 0,
    completedTick: 1,
    changedTick: 1,
  };
}

function inactiveFounders(civilization: CivilizationState): CivilizationState {
  return {
    ...civilization,
    agents: civilization.agents.map((agent) => ({
      ...agent,
      alive: false,
      health: 0,
      action: 'idle' as const,
    })),
  };
}

describe('autonomous settlement core', () => {
  it('creates factual founders with bounded, saved autonomous state', () => {
    const world = createInitialWorld([1, 2, 3, 4]);
    expect(world.civilization.agents).toHaveLength(SETTLEMENT_FOUNDER_COUNT);
    expect(world.eventLog).toStrictEqual([
      expect.objectContaining({ id: 1, kind: 'world-generated', tileIndex: -1 }),
      expect.objectContaining({
        id: 2,
        kind: 'founders-arrived',
        amount: SETTLEMENT_FOUNDER_COUNT,
      }),
    ]);
    expect(
      world.civilization.agents.every((agent) =>
        agent.memories.some((memory) => memory.eventId === 2),
      ),
    ).toBe(true);
  });

  it.each([
    [1, 2, 3, 4],
    [101, 202, 303, 404],
    [0xffff_ffff, 0, 0x8000_0000, 17],
  ] as const)(
    'is tick-partition equivalent and reaches a viable founding settlement for %j',
    (...seed) => {
      const oneShot = stepWorld(createInitialWorld(seed), 60_000);
      let partitioned = createInitialWorld(seed);
      for (let index = 0; index < 600; index += 1) partitioned = stepWorld(partitioned, 100);
      const diagnostic = JSON.stringify({
        alive: oneShot.civilization.agents.filter((agent) => agent.alive).length,
        events: oneShot.eventLog.map((event) => event.kind),
        stockpile: oneShot.civilization.stockpile,
        structures: oneShot.civilization.structures.map((structure) => ({
          kind: structure.kind,
          progress: structure.progress,
          status: structure.status,
        })),
      });
      expect(hashWorldState(oneShot)).toBe(hashWorldState(partitioned));
      expect(isViableSettlement(oneShot.civilization), diagnostic).toBe(true);
      expect(settlementSummary(oneShot.civilization), diagnostic).toMatchObject({
        aliveAgents: SETTLEMENT_FOUNDER_COUNT,
        operationalShelters: 1,
      });
      expect(oneShot.civilization.agents.filter((agent) => agent.alive)).toHaveLength(
        SETTLEMENT_FOUNDER_COUNT,
      );
      expect(
        oneShot.civilization.structures.some(
          (structure) => structure.kind === 'shelter' && structure.status === 'operational',
        ),
      ).toBe(true);
      expect(
        oneShot.civilization.agents.some(
          (agent) => agent.activity.foodGathered + agent.activity.waterGathered > 0,
        ),
      ).toBe(true);
      expect(oneShot.civilization.agents.some((agent) => agent.occupation !== 'generalist')).toBe(
        true,
      );
    },
  );

  it('gathers, carries, and deposits a resource through explicit autonomous plan steps', () => {
    const terrain = uniformTerrain();
    const civilization = createInitialCivilization([4, 3, 2, 1], terrain);
    const center = civilization.centerTileIndex;
    terrain.food[center] = 30;
    const first = civilization.agents[0]!;
    const prepared: CivilizationState = {
      ...inactiveFounders(civilization),
      stockpile: { food: 0, water: 100, timber: 0, stone: 0 },
      agents: [
        {
          ...first,
          hunger: 0,
          thirst: 0,
          fatigue: 0,
          action: 'forage',
          targetTileIndex: center,
          plan: [
            { action: 'forage', targetTileIndex: center, targetStructureId: 0 },
            { action: 'transport', targetTileIndex: center, targetStructureId: 0 },
          ],
          planIndex: 0,
        },
        ...inactiveFounders(civilization).agents.slice(1),
      ],
    };

    const gathered = advanceCivilization(prepared, terrain, 100).civilization;
    expect(gathered.agents[0]).toMatchObject({
      action: 'forage',
      carryingKind: 'food',
      carryingAmount: 30,
      planIndex: 1,
    });
    expect(gathered.stockpile.food).toBe(0);

    const deposited = advanceCivilization(gathered, terrain, 200).civilization;
    expect(deposited.agents[0]).toMatchObject({
      action: 'transport',
      carryingKind: 'none',
      carryingAmount: 0,
      planIndex: 2,
    });
    expect(deposited.agents[0]!.activity).toMatchObject({ foodGathered: 30, transported: 30 });
    expect(deposited.stockpile.food).toBe(30);
    expect(() => assertCivilizationInvariants(deposited, terrain)).not.toThrow();
  });

  it('uses contrasting geography, traits, and social state for different stable action-target signatures', () => {
    const actionSignature = (civilization: CivilizationState) =>
      civilization.agents.map((agent) => [agent.action, agent.targetTileIndex] as const);
    const makeScenario = (kind: 'food' | 'water') => {
      const terrain = uniformTerrain();
      const civilization = createInitialCivilization([20, 21, 22, 23], terrain);
      const target = civilization.centerTileIndex + (kind === 'food' ? -1 : 1);
      if (kind === 'food') {
        terrain.food[target] = 30;
        for (const offset of [
          1,
          -terrain.width,
          terrain.width,
          terrain.width + 1,
          -terrain.width - 1,
        ])
          terrain.food[civilization.centerTileIndex + offset] = 24;
      } else terrain.freshWater[target] = 500;
      const social = kind === 'food' ? 0 : 100;
      const traits: readonly [number, number, number, number] =
        kind === 'food' ? [100, 0, 0, 0] : [0, 100, 0, 0];
      const skills: readonly [number, number, number, number] =
        kind === 'food' ? [100, 0, 0, 0] : [0, 100, 0, 0];
      const relationshipContacts = civilization.agents.flatMap((first) =>
        civilization.agents
          .filter((second) => first.id < second.id)
          .map((second) => ({
            firstPersonId: first.id,
            secondPersonId: second.id,
            affinity: social,
            trust: social,
          })),
      );
      const state: CivilizationState = {
        ...civilization,
        stockpile: { food: 100, water: 100, timber: 0, stone: 0 },
        structures: [operationalShelter(civilization.centerTileIndex)],
        agents: civilization.agents.map((agent) => ({
          ...agent,
          hunger: 0,
          thirst: 0,
          fatigue: 0,
          traits,
          skills,
        })),
        society: {
          ...civilization.society,
          interpersonal: migrateLegacyInterpersonalState(
            [31, 32, 33, 34],
            civilization.society.lastTick,
            civilization.society.people.map((person) => ({
              id: person.id,
              alive: person.alive,
              birthTick: person.birthTick,
              parentIds: person.parentIds,
              householdId: person.householdId,
            })),
            relationshipContacts,
          ),
        },
      };
      return { state, terrain, target };
    };

    const food = makeScenario('food');
    const water = makeScenario('water');
    expect(() => assertCivilizationInvariants(food.state, food.terrain)).not.toThrow();
    expect(() => assertCivilizationInvariants(water.state, water.terrain)).not.toThrow();

    const foodResult = advanceCivilization(food.state, food.terrain, 100).civilization;
    const waterResult = advanceCivilization(water.state, water.terrain, 100).civilization;
    const foodSignature = actionSignature(foodResult);
    const waterSignature = actionSignature(waterResult);
    expect(foodSignature.every(([action]) => action === 'forage')).toBe(true);
    expect(waterSignature.every(([action]) => action === 'collect-water')).toBe(true);
    expect(foodSignature.some(([, target]) => target === food.target)).toBe(true);
    expect(waterSignature.some(([, target]) => target === water.target)).toBe(true);
    expect(foodSignature.every(([, target]) => food.terrain.food[target]! > 0)).toBe(true);
    expect(new Set(foodSignature.map(([, target]) => target)).size).toBeGreaterThanOrEqual(4);
    expect(waterSignature).toEqual(
      Array.from({ length: SETTLEMENT_FOUNDER_COUNT }, () => ['collect-water', water.target]),
    );
    expect(actionSignature(foodResult)).not.toEqual(actionSignature(waterResult));
    expect(
      actionSignature(advanceCivilization(food.state, food.terrain, 100).civilization),
    ).toEqual(actionSignature(foodResult));
    expect(
      actionSignature(advanceCivilization(water.state, water.terrain, 100).civilization),
    ).toEqual(actionSignature(waterResult));
    expect(() => assertCivilizationInvariants(foodResult, food.terrain)).not.toThrow();
    expect(() => assertCivilizationInvariants(waterResult, water.terrain)).not.toThrow();
  });

  it('ignores stale plans from dead agents when coordinating living work', () => {
    const terrain = uniformTerrain();
    const civilization = createInitialCivilization([24, 25, 26, 27], terrain);
    for (const offset of [-1, 1, -terrain.width, terrain.width])
      terrain.food[civilization.centerTileIndex + offset] = 30;
    const inactive = inactiveFounders(civilization);
    const baselineState: CivilizationState = {
      ...civilization,
      stockpile: { food: 0, water: 100, timber: 0, stone: 0 },
      structures: [operationalShelter(civilization.centerTileIndex)],
      agents: [
        { ...civilization.agents[0]!, hunger: 0, thirst: 0, fatigue: 0 },
        ...inactive.agents.slice(1),
      ],
    };
    const baseline = advanceCivilization(baselineState, terrain, 100).civilization;
    const baselineWorker = baseline.agents[0]!;
    expect(baselineWorker.action).toBe('forage');

    const stalePlanState: CivilizationState = {
      ...baselineState,
      agents: baselineState.agents.map((agent, index) =>
        index === 1
          ? {
              ...agent,
              plan: [
                {
                  action: 'forage' as const,
                  targetTileIndex: baselineWorker.targetTileIndex,
                  targetStructureId: 0,
                },
              ],
              planIndex: 0,
            }
          : agent,
      ),
    };
    const withStaleDeadPlan = advanceCivilization(stalePlanState, terrain, 100).civilization;
    expect(withStaleDeadPlan.agents[0]).toMatchObject({
      action: baselineWorker.action,
      targetTileIndex: baselineWorker.targetTileIndex,
      personalGoal: baselineWorker.personalGoal,
      rng: baselineWorker.rng,
    });
  });

  it('does not let a reservation from another source tile alter local work', () => {
    const terrain = uniformTerrain();
    const civilization = createInitialCivilization([28, 29, 30, 31], terrain);
    const center = civilization.centerTileIndex;
    terrain.food[center - 1] = 30;
    terrain.food[center + 1] = 30;
    const inactive = inactiveFounders(civilization);
    const decidingAgent = {
      ...civilization.agents[0]!,
      hunger: 0,
      thirst: 0,
      fatigue: 0,
    };
    const baselineState: CivilizationState = {
      ...civilization,
      stockpile: { food: 0, water: 100, timber: 0, stone: 0 },
      structures: [operationalShelter(center)],
      agents: [decidingAgent, ...inactive.agents.slice(1)],
    };
    const baseline = advanceCivilization(baselineState, terrain, 100).civilization;
    const baselineTarget = baseline.agents[0]!.targetTileIndex;

    const remoteSource = center + terrain.width * 2;
    const withRemoteReservation: CivilizationState = {
      ...baselineState,
      agents: baselineState.agents.map((agent, index) =>
        index === 1
          ? {
              ...civilization.agents[1]!,
              tileIndex: remoteSource,
              action: 'forage' as const,
              targetTileIndex: baselineTarget,
              plan: [
                {
                  action: 'forage' as const,
                  targetTileIndex: baselineTarget,
                  targetStructureId: 0,
                },
              ],
              planIndex: 0,
            }
          : agent,
      ),
    };
    const coordinated = advanceCivilization(withRemoteReservation, terrain, 100).civilization;
    expect(coordinated.agents[0]).toMatchObject({
      action: baseline.agents[0]!.action,
      targetTileIndex: baselineTarget,
      personalGoal: baseline.agents[0]!.personalGoal,
      rng: baseline.agents[0]!.rng,
    });
  });

  it('naturally degrades an operational shelter through damaged and abandoned before deterministic repurposing', () => {
    const world = createInitialWorld([6, 7, 8, 9]);
    const terrain = terrainFrom(world);
    let civilization: CivilizationState = {
      ...inactiveFounders(world.civilization),
      agents: inactiveFounders(world.civilization).agents.map((agent) => ({
        ...agent,
        homeStructureId: 1,
      })),
      nextStructureId: 2,
      structures: [operationalShelter(world.civilization.centerTileIndex, 2)],
    };

    civilization = advanceCivilization(civilization, terrain, 1_000).civilization;
    expect(civilization.structures[0]).toMatchObject({ status: 'damaged', condition: 1 });
    civilization = advanceCivilization(civilization, terrain, 2_000).civilization;
    expect(civilization.structures[0]).toMatchObject({ status: 'abandoned', condition: 0 });

    civilization = advanceCivilization(civilization, terrain, 3_000).civilization;
    expect(civilization.structures[0]).toMatchObject({
      kind: 'storehouse',
      status: 'planned',
      level: 2,
      progress: 0,
    });
    expect(civilization.agents.every((agent) => agent.homeStructureId === 0)).toBe(true);
    expect(() => assertCivilizationInvariants(civilization, terrain)).not.toThrow();
  });

  it('repurposes an abandoned shelter and demolishes an abandoned storehouse deterministically', () => {
    const world = createInitialWorld([7, 8, 9, 10]);
    const shelter = {
      id: 1,
      kind: 'shelter' as const,
      status: 'abandoned' as const,
      tileIndex: world.civilization.centerTileIndex,
      progress: 1000,
      condition: 0,
      level: 1,
      capacity: 6,
      communalOwnership: true,
      ownerId: 0,
      plannedTick: 0,
      completedTick: 0,
      changedTick: 0,
    };
    const repurposed = advanceCivilization(
      { ...world.civilization, nextStructureId: 2, structures: [shelter] },
      terrainFrom(world),
      1_000,
    ).civilization.structures[0]!;
    expect(repurposed).toMatchObject({ kind: 'storehouse', status: 'planned', level: 2 });
    const demolished = advanceCivilization(
      {
        ...world.civilization,
        nextStructureId: 2,
        structures: [{ ...shelter, kind: 'storehouse' as const }],
      },
      terrainFrom(world),
      1_000,
    ).civilization.structures[0]!;
    expect(demolished.status).toBe('demolished');
  });

  it('repairs damaged structures and expands an operational storehouse with real materials', () => {
    const world = createInitialWorld([11, 12, 13, 14]);
    const base = {
      id: 1,
      kind: 'storehouse' as const,
      status: 'damaged' as const,
      tileIndex: world.civilization.centerTileIndex,
      progress: 1000,
      condition: 900,
      level: 1,
      capacity: 200,
      communalOwnership: true,
      ownerId: 0,
      plannedTick: 0,
      completedTick: 1,
      changedTick: 1,
    };
    const repairPlan = [
      { action: 'repair' as const, targetTileIndex: base.tileIndex, targetStructureId: 1 },
    ];
    const repairing = advanceCivilization(
      {
        ...world.civilization,
        nextStructureId: 2,
        structures: [base],
        stockpile: { ...world.civilization.stockpile, timber: 100, stone: 100 },
        agents: world.civilization.agents.map((agent) => ({
          ...agent,
          tileIndex: base.tileIndex,
          targetTileIndex: base.tileIndex,
          action: 'repair' as const,
          plan: repairPlan,
          planIndex: 0,
        })),
      },
      terrainFrom(world),
      100,
    ).civilization;
    expect(repairing.structures[0]!.condition).toBeGreaterThan(base.condition);
    const expanded = advanceCivilization(
      {
        ...repairing,
        structures: [
          { ...repairing.structures[0]!, status: 'operational' as const, condition: 1000 },
        ],
        stockpile: { ...repairing.stockpile, timber: 100, stone: 100 },
      },
      terrainFrom(world),
      50_000,
    ).civilization;
    expect(expanded.structures[0]!.level).toBe(2);
  });
});
