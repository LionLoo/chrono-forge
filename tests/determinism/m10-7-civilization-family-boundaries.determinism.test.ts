import { describe, expect, it } from 'vitest';

import { deserializeWorldSnapshot, serializeWorldSnapshot } from '../../src/simulation/persistence';
import {
  assertWorldInvariants,
  canonicalWorldJson,
  createInitialWorld,
  hashWorldState,
  stepWorld,
  type WorldState,
} from '../../src/simulation/world';

const SEED = [37, 41, 43, 47] as const;
const YEAR_TICKS = 5_000;
const HORIZON_TICK = 280_000;
const RELOAD_ENDPOINTS = Object.freeze([
  999,
  1_000,
  4_999,
  5_000,
  34_999,
  35_000,
  39_999,
  40_000,
  59_999,
  60_000,
  199_999,
  200_000,
  219_999,
  220_000,
  234_999,
  235_000,
  244_999,
  245_000,
  269_999,
  270_000,
  HORIZON_TICK,
]);

function initialWorld(): WorldState {
  return createInitialWorld(SEED, { societyYearTicks: YEAR_TICKS });
}

function reloadAcrossBoundaries(): WorldState {
  let world = initialWorld();
  let priorTick = 0;
  for (const endpoint of RELOAD_ENDPOINTS) {
    world = stepWorld(world, endpoint - priorTick);
    world = deserializeWorldSnapshot(serializeWorldSnapshot(world));
    priorTick = endpoint;
  }
  return world;
}

describe('M10.7 civilization, disaster, and family boundaries', () => {
  it('keeps factual lifecycles and canonical authority exact across irregular reloads', () => {
    const direct = stepWorld(initialWorld(), HORIZON_TICK);
    const reloaded = reloadAcrossBoundaries();

    expect(() => assertWorldInvariants(direct)).not.toThrow();
    expect(() => assertWorldInvariants(reloaded)).not.toThrow();
    expect(hashWorldState(reloaded)).toBe(hashWorldState(direct));
    expect(canonicalWorldJson(reloaded)).toBe(canonicalWorldJson(direct));
    expect(reloaded.eventLog).toStrictEqual(direct.eventLog);

    const eventKindsAt = (tick: number): ReadonlySet<string> =>
      new Set(direct.eventLog.filter((event) => event.tick === tick).map((event) => event.kind));
    for (const kind of ['conflict-started', 'household-formed', 'person-born'])
      expect(eventKindsAt(40_000)).toContain(kind);
    for (const kind of ['conflict-resolved', 'refugees-relocated'])
      expect(eventKindsAt(60_000)).toContain(kind);
    for (const kind of ['crisis-assisted', 'flood-started'])
      expect(eventKindsAt(200_000)).toContain(kind);
    expect(eventKindsAt(220_000)).toContain('flood-recovered');
    for (const kind of [
      'conflict-resolved',
      'household-formed',
      'person-born',
      'refugees-relocated',
    ])
      expect(eventKindsAt(235_000)).toContain(kind);
    for (const kind of ['family-inheritance', 'person-born', 'person-died', 'partner-widowed'])
      expect(eventKindsAt(270_000)).toContain(kind);

    const peopleById = new Map(
      direct.civilization.society.people.map((person) => [person.id, person] as const),
    );
    const personResidencies = direct.civilizations.residencies.filter(
      (residency) => residency.subjectKind === 'person',
    );
    for (const person of peopleById.values()) {
      const records = personResidencies.filter((residency) => residency.subjectId === person.id);
      expect(records.length, `person ${person.id} residency`).toBeGreaterThan(0);
      expect(
        records.every((residency) => residency.startedTick >= person.birthTick),
        `person ${person.id} residence predates birth`,
      ).toBe(true);
      const active = records.filter((residency) => residency.endedTick === null);
      if (person.alive) expect(active, `living person ${person.id}`).toHaveLength(1);
      else {
        expect(active, `deceased person ${person.id}`).toHaveLength(0);
        expect(
          records.some((residency) => residency.endedTick === person.deathTick),
          `person ${person.id} final residence does not match death`,
        ).toBe(true);
      }
    }

    const refugeeEvents = direct.eventLog.filter((event) => event.kind === 'refugees-relocated');
    expect(refugeeEvents.length).toBeGreaterThan(0);
    for (const event of refugeeEvents) {
      const departures = direct.civilizations.residencies.filter(
        (residency) =>
          residency.settlementId === event.subjectId && residency.endedTick === event.tick,
      );
      expect(departures.length, `refugee departure event ${event.id}`).toBeGreaterThan(0);
      for (const departure of departures)
        expect(
          direct.civilizations.residencies.some(
            (arrival) =>
              arrival.subjectKind === departure.subjectKind &&
              arrival.subjectId === departure.subjectId &&
              arrival.settlementId === event.targetId &&
              arrival.startedTick === event.tick,
          ),
          `refugee residency ${departure.id} lost its exact arrival`,
        ).toBe(true);
    }

    expect(direct.development.crisisHistory).toContainEqual(
      expect.objectContaining({ kind: 'flood', startedTick: 200_000, endedTick: 220_000 }),
    );
    const peopleWithBiographyEvents = new Map(
      direct.civilization.society.people.map((person) => [
        person.id,
        new Set(person.biographyEventIds),
      ]),
    );
    for (const event of direct.eventLog.filter(
      (candidate) =>
        candidate.tick === 270_000 &&
        (candidate.kind === 'person-died' || candidate.kind === 'partner-widowed'),
    )) {
      if (event.subjectKind === 'person')
        expect(peopleWithBiographyEvents.get(event.subjectId)).toContain(event.id);
      if (event.targetKind === 'person')
        expect(peopleWithBiographyEvents.get(event.targetId)).toContain(event.id);
    }
  }, 120_000);
});
