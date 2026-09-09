import { describe, expect, it } from 'vitest';

import { ACCELERATED_YEAR_TICKS } from '../../src/simulation/society';
import { deserializeWorldSnapshot, serializeWorldSnapshot } from '../../src/simulation/persistence';
import { FIRST_ORDINARY_RESIDENT_ID } from '../../src/simulation/scale';
import { spaceDto } from '../../src/simulation/space';
import {
  assertWorldInvariants,
  canonicalWorldJson,
  createCivilizationsContext,
  createInitialWorld,
  createSpaceContext,
  initializeM8WorldAuthority,
  stepWorld,
} from '../../src/simulation/world';
import { createM9MatureWorld } from '../fixtures/m9-space-world';

const SEED = [7, 11, 13, 17] as const;
describe('M9 world integration', () => {
  it('selects a bounded launch cohort sample at the 100,000-resident scale cap', () => {
    const initial = createInitialWorld(SEED, { societyYearTicks: ACCELERATED_YEAR_TICKS });
    const primary = initial.civilizations.settlements[0]!;
    const civilizations = Object.freeze({
      ...initial.civilizations,
      settlements: Object.freeze([
        Object.freeze({ ...primary, population: 100_006 }),
        ...initial.civilizations.settlements.slice(1),
      ]),
    });
    const base = Object.freeze({ ...initial, civilizations });
    const m8 = initializeM8WorldAuthority(base);
    expect(m8.populationScale.cohorts).toHaveLength(100);
    expect(
      m8.populationScale.cohorts.reduce((total, cohort) => total + cohort.residentIds.length, 0),
    ).toBe(100_000);

    let residentReads = 0;
    const measuredCohorts = Object.freeze(
      m8.populationScale.cohorts.map((cohort) =>
        Object.freeze({
          ...cohort,
          residentIds: new Proxy(cohort.residentIds, {
            get(target, property, receiver): unknown {
              if (typeof property === 'string' && /^\d+$/.test(property)) residentReads += 1;
              return Reflect.get(target, property, receiver) as unknown;
            },
          }),
        }),
      ),
    );
    const measured = Object.freeze({
      ...base,
      ...m8,
      populationScale: Object.freeze({ ...m8.populationScale, cohorts: measuredCohorts }),
    });
    const context = createSpaceContext(measured, measured.tick);

    expect(context.eligibleUnsalientResidents.map((resident) => resident.residentId)).toStrictEqual(
      Array.from({ length: 16 }, (_, index) => FIRST_ORDINARY_RESIDENT_ID + index),
    );
    expect(residentReads).toBeLessThanOrEqual(measuredCohorts.length * 16);
  });

  it('grounds founding-community metal production in its generated ore tile', () => {
    const founding = createInitialWorld(SEED, { societyYearTicks: ACCELERATED_YEAR_TICKS });
    const primary = founding.civilizations.settlements[0]!;
    const economy = createCivilizationsContext(founding, ACCELERATED_YEAR_TICKS).economies.find(
      (candidate) => candidate.settlementId === primary.id,
    );

    expect(founding.metal[primary.centerTileIndex]).toBeGreaterThanOrEqual(60);
    expect(economy?.production).toStrictEqual({
      food: 0,
      water: 0,
      timber: 0,
      stone: 0,
      metal: Math.trunc(founding.metal[primary.centerTileIndex]! / 60),
    });
    const afterYear = stepWorld(founding, ACCELERATED_YEAR_TICKS);
    expect(afterYear.civilizations.settlements[0]!.reserves.metal).toBe(economy!.production.metal);
  });

  it('keeps space contextual, then advances and launches from mature terrestrial authority', () => {
    const founding = createInitialWorld(SEED, { societyYearTicks: ACCELERATED_YEAR_TICKS });
    const unchanged = stepWorld(founding, ACCELERATED_YEAR_TICKS * 4);
    expect(unchanged.space.programs).toStrictEqual([]);
    expect(unchanged.space.spacecraft).toStrictEqual([]);

    const prepared = createM9MatureWorld();
    const advanced = stepWorld(prepared, ACCELERATED_YEAR_TICKS * 4);
    const activeColonyMission = advanced.space.missions.find(
      (mission) => mission.status === 'active' && mission.kind === 'colony',
    );

    expect(advanced.space.programs[0]?.stage).toBe('spaceflight');
    expect(advanced.space.missions.some((mission) => mission.kind === 'orbital')).toBe(true);
    expect(activeColonyMission?.passengerIds).toHaveLength(2);
    expect(advanced.eventLog.some((event) => event.kind === 'space-program-advanced')).toBe(true);
    expect(advanced.eventLog.some((event) => event.kind === 'spacecraft-launched')).toBe(true);
    expect(advanced.civilizations.settlements[0]!.population).toBeLessThan(50);
    expect(
      activeColonyMission?.passengerIds.some((residentId) =>
        advanced.populationScale.cohorts.some((cohort) => cohort.residentIds.includes(residentId)),
      ),
    ).toBe(false);
    assertWorldInvariants(advanced);
  });

  it('is partition-equivalent across annual space boundaries', () => {
    const prepared = createM9MatureWorld();
    const oneShot = stepWorld(prepared, ACCELERATED_YEAR_TICKS * 4);
    let partitioned = prepared;
    for (let year = 0; year < 4; year += 1)
      partitioned = stepWorld(partitioned, ACCELERATED_YEAR_TICKS);

    expect(canonicalWorldJson(partitioned)).toBe(canonicalWorldJson(oneShot));
  });

  it('round-trips lived space authority and its factual world references', () => {
    const advanced = stepWorld(createM9MatureWorld(), ACCELERATED_YEAR_TICKS * 4);
    const loaded = deserializeWorldSnapshot(serializeWorldSnapshot(advanced));

    expect(spaceDto(loaded.space)).toStrictEqual(spaceDto(advanced.space));
    expect(loaded.eventLog).toStrictEqual(advanced.eventLog);
    expect(serializeWorldSnapshot(loaded)).toBe(serializeWorldSnapshot(advanced));
  });

  it('continues identically after a mid-flight save and reload', () => {
    const midFlight = stepWorld(createM9MatureWorld(), ACCELERATED_YEAR_TICKS * 3);
    expect(midFlight.space.missions.some((mission) => mission.status === 'active')).toBe(true);

    const uninterrupted = stepWorld(midFlight, ACCELERATED_YEAR_TICKS * 4);
    const reloaded = deserializeWorldSnapshot(serializeWorldSnapshot(midFlight));
    const resumed = stepWorld(reloaded, ACCELERATED_YEAR_TICKS * 4);

    expect(canonicalWorldJson(resumed)).toBe(canonicalWorldJson(uninterrupted));
  });

  it('continues identically after alien contact and delayed communication are saved', () => {
    let contacted = createM9MatureWorld();
    for (let year = 0; year < 24 && !contacted.space.relations.length; year += 1)
      contacted = stepWorld(contacted, ACCELERATED_YEAR_TICKS);

    expect(contacted.space.relations.length).toBeGreaterThan(0);
    expect(contacted.space.communications.length).toBeGreaterThan(0);
    const uninterrupted = stepWorld(contacted, ACCELERATED_YEAR_TICKS * 4);
    const reloaded = deserializeWorldSnapshot(serializeWorldSnapshot(contacted));
    const resumed = stepWorld(reloaded, ACCELERATED_YEAR_TICKS * 4);

    expect(canonicalWorldJson(resumed)).toBe(canonicalWorldJson(uninterrupted));
  });
});
