import {
  RUNTIME_PROFILE_AGGREGATE_RESIDENTS,
  RUNTIME_PROFILE_DETAILED_RESIDENTS,
  RUNTIME_PROFILE_WORLD_HEIGHT,
  RUNTIME_PROFILE_WORLD_WIDTH,
  assertRuntimeProfileFixtureContract,
  createRuntimeProfileWorld,
} from '../support/runtime-profile-fixture';
import { deserializeWorldSnapshot, serializeWorldSnapshot } from '../../src/simulation/persistence';
import { stepWorld } from '../../src/simulation/world';
import { SETTLEMENT_ACTION_PULSE_TICKS } from '../../src/simulation/settlement';

describe('M10.65 runtime profile fixture', () => {
  it('constructs the exact release-scale world required by the runtime profile', () => {
    const world = createRuntimeProfileWorld();

    expect(world.config).toMatchObject({
      width: RUNTIME_PROFILE_WORLD_WIDTH,
      height: RUNTIME_PROFILE_WORLD_HEIGHT,
    });
    expect(world.populationScale.detailedResidents).toHaveLength(
      RUNTIME_PROFILE_DETAILED_RESIDENTS,
    );
    expect(
      world.populationScale.cohorts.reduce((total, cohort) => total + cohort.residentIds.length, 0),
    ).toBe(RUNTIME_PROFILE_AGGREGATE_RESIDENTS);
  });

  it('rejects evidence fixtures that omit the detailed-resident load', () => {
    const world = createRuntimeProfileWorld();
    const undersized = {
      ...world,
      populationScale: {
        ...world.populationScale,
        detailedResidents: world.populationScale.detailedResidents.slice(0, -1),
      },
    };

    expect(() => assertRuntimeProfileFixtureContract(undersized)).toThrow(
      `Runtime profile requires ${RUNTIME_PROFILE_DETAILED_RESIDENTS} detailed residents.`,
    );
  });

  it('round-trips the maximum detailed and aggregate population partition', () => {
    const world = createRuntimeProfileWorld();
    const snapshot = serializeWorldSnapshot(world);

    const restored = deserializeWorldSnapshot(snapshot);

    expect(restored.populationScale.detailedResidents).toHaveLength(
      RUNTIME_PROFILE_DETAILED_RESIDENTS,
    );
    expect(
      restored.populationScale.cohorts.reduce(
        (total, cohort) => total + cohort.residentIds.length,
        0,
      ),
    ).toBe(RUNTIME_PROFILE_AGGREGATE_RESIDENTS);
    expect(serializeWorldSnapshot(restored)).toBe(snapshot);
  });

  it('advances a settlement pulse without collapsing or overflowing the max-scale partition', () => {
    const world = createRuntimeProfileWorld();

    const advanced = stepWorld(world, SETTLEMENT_ACTION_PULSE_TICKS);

    expect(advanced.populationScale.detailedResidents).toHaveLength(
      RUNTIME_PROFILE_DETAILED_RESIDENTS,
    );
    expect(
      advanced.populationScale.cohorts.reduce(
        (total, cohort) => total + cohort.residentIds.length,
        0,
      ),
    ).toBe(RUNTIME_PROFILE_AGGREGATE_RESIDENTS);
  });
});
