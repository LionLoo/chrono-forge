import { describe, expect, it } from 'vitest';

import { M6_SCENARIOS } from '../fixtures/m6-scenarios';
import {
  assertWorldInvariants,
  createInitialWorld,
  hashWorldState,
  settlementDevelopmentInputsForWorld,
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
    expect(world.civilizations.settlements[0]).toMatchObject({
      developmentStage: 'founding',
      developmentStageProvenance: 'initial',
    });
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
    expect(
      direct.civilizations.settlements.some(
        (settlement) => settlement.developmentStage !== 'founding',
      ),
    ).toBe(true);
    expect(direct.eventLog.some((event) => event.kind === 'settlement-stage-changed')).toBe(true);
    expect(hashWorldState(partitioned)).toBe(hashWorldState(direct));
    expect(partitioned.civilizations).toStrictEqual(direct.civilizations);
  });

  it('rejects an observed settlement stage without its matching factual event', () => {
    const world = createInitialWorld(M6_SCENARIOS[0]!.seed, {
      societyYearTicks: M6_SCENARIOS[0]!.yearTicks,
    });
    const invalid = Object.freeze({
      ...world,
      civilizations: Object.freeze({
        ...world.civilizations,
        settlements: Object.freeze([
          Object.freeze({
            ...world.civilizations.settlements[0]!,
            developmentStage: 'village' as const,
            developmentStageProvenance: 'observed' as const,
          }),
        ]),
      }),
    });

    expect(() => assertWorldInvariants(invalid)).toThrow('factual source event');
  });

  it('derives development inputs with one ownership pass at the maximum map bound', () => {
    const world = createInitialWorld(M6_SCENARIOS[0]!.seed, {
      societyYearTicks: M6_SCENARIOS[0]!.yearTicks,
    });
    const primary = world.civilizations.settlements[0]!;
    const settlementIds = Array.from({ length: 32 }, (_, index) => index + 100);
    const settlements = Object.freeze(
      settlementIds.map((id, index) =>
        Object.freeze({
          ...primary,
          id,
          status: index < 8 ? ('active' as const) : ('abandoned' as const),
          population: index < 8 ? 1 : 0,
          endedTick: index < 8 ? null : 0,
        }),
      ),
    );
    const owners = Array.from(
      { length: 1_000_000 },
      (_, index) => settlementIds[index % settlementIds.length]!,
    );
    let ownershipInspections = 0;
    const countedOwners = new Proxy(owners, {
      get(target, property, receiver) {
        if (property === Symbol.iterator)
          return function* iterateOwners() {
            for (const owner of target) {
              ownershipInspections += 1;
              yield owner;
            }
          };
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const source = Object.freeze({
      ...world,
      civilizations: Object.freeze({
        ...world.civilizations,
        settlements,
        tileOwners: countedOwners,
      }),
    });

    expect(settlementDevelopmentInputsForWorld(source)).toHaveLength(32);
    expect(ownershipInspections).toBe(1_000_000);
  });
});
