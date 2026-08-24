import {
  advanceCivilization,
  createInitialCivilization,
  type CivilizationState,
  type SettlementTerrain,
  type SettlementStructure,
} from '../../src/simulation/settlement';
import { assertWorldInvariants, createInitialWorld, stepWorld } from '../../src/simulation/world';

describe('settlement resource conservation', () => {
  it('does not gather water from terrain with no fresh water', () => {
    const tileCount = 9;
    const terrain: SettlementTerrain = {
      width: 3,
      height: 3,
      food: new Uint16Array(tileCount),
      freshWater: new Uint16Array(tileCount),
      timber: new Uint16Array(tileCount),
      stone: new Uint16Array(tileCount),
      habitability: new Uint8Array(tileCount).fill(100),
      hazard: new Uint8Array(tileCount),
      isWalkable: (tileIndex) => tileIndex >= 0 && tileIndex < tileCount,
    };
    const initial = createInitialCivilization([1, 2, 3, 4], terrain);
    const thirsty: CivilizationState = {
      ...initial,
      stockpile: { ...initial.stockpile, water: 0 },
    };

    const result = advanceCivilization(thirsty, terrain, 100).civilization;

    expect(result.agents.some((agent) => agent.action === 'collect-water')).toBe(true);
    expect(result.agents.every((agent) => agent.activity.waterGathered === 0)).toBe(true);
    expect(result.agents.every((agent) => agent.carryingKind !== 'water')).toBe(true);
  });

  it('charges only the timber that can contribute to a bounded repair', () => {
    const tileCount = 9;
    const terrain: SettlementTerrain = {
      width: 3,
      height: 3,
      food: new Uint16Array(tileCount).fill(100),
      freshWater: new Uint16Array(tileCount).fill(100),
      timber: new Uint16Array(tileCount).fill(100),
      stone: new Uint16Array(tileCount).fill(100),
      habitability: new Uint8Array(tileCount).fill(100),
      hazard: new Uint8Array(tileCount),
      isWalkable: (tileIndex) => tileIndex >= 0 && tileIndex < tileCount,
    };
    const initial = createInitialCivilization([5, 6, 7, 8], terrain);
    const damagedShelter: SettlementStructure = {
      id: 1,
      kind: 'shelter',
      status: 'damaged',
      tileIndex: initial.centerTileIndex,
      progress: 1_000,
      condition: 990,
      level: 1,
      capacity: 6,
      communalOwnership: true,
      ownerId: 0,
      plannedTick: 0,
      completedTick: 1,
      changedTick: 1,
    };
    const damaged: CivilizationState = {
      ...initial,
      structures: [damagedShelter],
      nextStructureId: 2,
    };

    const result = advanceCivilization(damaged, terrain, 100).civilization;

    expect(result.structures[0]).toMatchObject({ condition: 1_000, status: 'operational' });
    expect(result.stockpile.timber).toBe(initial.stockpile.timber - 1);
  });

  it('does not overlap structures when a tiny world has no second valid site', () => {
    const world = stepWorld(
      createInitialWorld([0, 0, 0, 0], { width: 1, height: 1, chunkSize: 1 }),
      35_000,
    );

    expect(
      world.civilization.structures.filter((structure) => structure.status !== 'demolished'),
    ).toHaveLength(1);
    expect(() => assertWorldInvariants(world)).not.toThrow();
  });
});
