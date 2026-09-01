import { describe, expect, it } from 'vitest';

import { M6_SCENARIOS } from '../fixtures/m6-scenarios';
import {
  assertWorldInvariants,
  createInitialWorld,
  hashWorldState,
  stepWorld,
} from '../../src/simulation/world';

describe('M6 world-owned civilizations integration', () => {
  it('founds one globally referenced settlement and civilization without duplicating people', () => {
    const world = createInitialWorld(M6_SCENARIOS[0]!.seed, {
      societyYearTicks: M6_SCENARIOS[0]!.yearTicks,
    });

    assertWorldInvariants(world);
    expect(world.civilizations.settlements).toHaveLength(1);
    expect(world.civilizations.civilizations).toHaveLength(1);
    const personResidencies = world.civilizations.residencies.filter(
      (residency) => residency.subjectKind === 'person',
    );
    expect(personResidencies.map((residency) => residency.subjectId)).toStrictEqual(
      world.civilization.society.people.map((person) => person.id),
    );
    expect(new Set(personResidencies.map((entry) => entry.subjectId)).size).toBe(
      personResidencies.length,
    );
    expect(world.civilizations.tileOwners[world.civilization.centerTileIndex]).toBe(1);
  });

  it('advances M6 only at civil-year boundaries and remains tick-partition deterministic', () => {
    const scenario = M6_SCENARIOS[0]!;
    const initial = createInitialWorld(scenario.seed, { societyYearTicks: scenario.yearTicks });
    const direct = stepWorld(initial, scenario.yearTicks * 5);
    let partitioned = initial;
    for (const ticks of [1_337, 2_411, 5_000, 7_252, 9_000]) {
      partitioned = stepWorld(partitioned, ticks);
    }

    expect(partitioned.tick).toBe(direct.tick);
    expect(direct.civilizations.tick).toBe(direct.tick);
    expect(direct.civilizations.settlements.length).toBeGreaterThan(1);
    expect(hashWorldState(partitioned)).toBe(hashWorldState(direct));
    expect(partitioned.civilizations).toStrictEqual(direct.civilizations);
  });
});
