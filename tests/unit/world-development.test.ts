import { describe, expect, it } from 'vitest';

import {
  canonicalWorldJson,
  createInitialWorld,
  findResourceDepletionAt,
  isWalkableTile,
  stepWorld,
} from '../../src/simulation/world';
import { deserializeWorldSnapshot, serializeWorldSnapshot } from '../../src/simulation/persistence';
import {
  admitActiveRelationship,
  type ActiveRelationship,
} from '../../src/simulation/relationships';
import { ACCELERATED_YEAR_TICKS } from '../../src/simulation/society';

const YEAR = ACCELERATED_YEAR_TICKS;
const CONFIG = Object.freeze({ width: 32, height: 32, chunkSize: 16, societyYearTicks: YEAR });

function stockpileTotal(stockpile: {
  readonly food: number;
  readonly water: number;
  readonly timber: number;
  readonly stone: number;
}): number {
  return stockpile.food + stockpile.water + stockpile.timber + stockpile.stone;
}

describe('M5 world development integration', () => {
  it('advances development exactly at civil-year boundaries and preserves tick partitioning', () => {
    const seed = [7, 11, 13, 17] as const;
    const initial = createInitialWorld(seed, CONFIG);

    const direct = stepWorld(initial, YEAR * 2);
    const partitioned = stepWorld(stepWorld(stepWorld(initial, 700), 4_300), YEAR);

    expect(initial.development.tick).toBe(0);
    expect(direct.development.tick).toBe(YEAR * 2);
    expect(canonicalWorldJson(partitioned)).toBe(canonicalWorldJson(direct));
  });

  it('applies a modeled crisis to inhabitants, settlement economy, and world tiles', () => {
    const initial = createInitialWorld([37, 41, 43, 47], CONFIG);
    const prepared = Object.freeze({
      ...initial,
      development: Object.freeze({
        ...initial.development,
        conditions: Object.freeze({ ...initial.development.conditions, diseasePressure: 100 }),
      }),
    });
    const control = stepWorld(initial, YEAR);
    const controlHealth = control.civilization.agents.reduce(
      (total, person) => total + person.health,
      0,
    );
    const controlStores = stockpileTotal(control.civilization.stockpile);
    const beforeHazard = prepared.hazard[prepared.civilization.centerTileIndex]!;
    const after = stepWorld(prepared, YEAR);

    expect(after.eventLog).toContainEqual(
      expect.objectContaining({ kind: 'disease-started', subjectKind: 'world' }),
    );
    expect(
      after.civilization.agents.reduce((total, person) => total + person.health, 0),
    ).toBeLessThan(controlHealth);
    expect(stockpileTotal(after.civilization.stockpile)).toBeLessThan(controlStores);
    expect(after.hazard[after.civilization.centerTileIndex]).toBeGreaterThan(beforeHazard);
    for (const agent of after.civilization.agents) {
      const person = after.civilization.society.people.find(
        (candidate) => candidate.id === agent.id,
      );
      expect(person).toMatchObject({ alive: agent.alive, health: agent.health });
    }
    const reloaded = deserializeWorldSnapshot(serializeWorldSnapshot(after));
    expect(canonicalWorldJson(reloaded)).toBe(canonicalWorldJson(after));
  });

  it('invalidates persisted routes exactly when a modeled crisis changes walkability', () => {
    const initial = createInitialWorld([37, 41, 43, 47], CONFIG);
    const center = initial.civilization.centerTileIndex;
    const hazard = initial.hazard.slice();
    hazard[center] = 179;
    const prepared = Object.freeze({
      ...initial,
      hazard,
      tiles: Object.freeze({ ...initial.tiles, hazard }),
      development: Object.freeze({
        ...initial.development,
        conditions: Object.freeze({ ...initial.development.conditions, diseasePressure: 100 }),
      }),
    });

    expect(isWalkableTile(prepared, center)).toBe(true);
    const after = stepWorld(prepared, YEAR);

    expect(isWalkableTile(after, center)).toBe(false);
    expect(after.pathCache).toMatchObject({
      terrainRevision: 1,
      logicalTick: YEAR,
      pending: [],
      completed: [],
      backlog: 0,
    });
  });

  it('looks up sparse resource depletion by tile identity rather than array position', () => {
    const entries = Object.freeze([
      Object.freeze({ tileIndex: 3, food: 7, timber: 5, stone: 2 }),
      Object.freeze({ tileIndex: 900, food: 11, timber: 13, stone: 17 }),
    ]);

    expect(findResourceDepletionAt(entries, 900)).toEqual(entries[1]);
    expect(findResourceDepletionAt(entries, 1)).toBeUndefined();
  });

  it('uses a salient bond for factual crisis assistance and preserves its consequence on reload', () => {
    const initial = stepWorld(createInitialWorld([41, 43, 47, 53], CONFIG), YEAR - 1);
    const relationshipTick = initial.civilization.society.interpersonal.tick;
    const ranked = [...initial.civilization.agents].sort(
      (left, right) =>
        right.skills.reduce((total, skill) => total + skill, 0) -
          left.skills.reduce((total, skill) => total + skill, 0) || left.id - right.id,
    );
    const helper = ranked[0]!;
    const recipients = initial.civilization.agents
      .filter((person) => person.id !== helper.id)
      .sort((left, right) => left.id - right.id)
      .slice(0, 2);
    const linkedRecipient = recipients[1]!;
    const [firstPersonId, secondPersonId] = [helper.id, linkedRecipient.id].sort(
      (left, right) => left - right,
    );
    const direction = Object.freeze({
      affinity: 100,
      trust: 100,
      closeness: 100,
      commitment: 80,
      grievance: 0,
    });
    const edge: ActiveRelationship = Object.freeze({
      id: 1,
      firstPersonId: firstPersonId!,
      secondPersonId: secondPersonId!,
      firstRole: 'partner',
      secondRole: 'partner',
      kind: 'long-term-partner',
      formedTick: relationshipTick,
      changedTick: relationshipTick,
      lastInteractionTick: relationshipTick,
      observedSinceTick: relationshipTick,
      trend: 'stable',
      firstToSecond: direction,
      secondToFirst: direction,
      sharedEvents: Object.freeze([]),
      rng: Object.freeze([71, 73, 79, 83] as const),
      legacySocietyCounters: null,
    });
    const relationshipPeople = initial.civilization.society.people.map((person) => ({
      id: person.id,
      alive: person.alive,
      birthTick: person.birthTick,
      parentIds: person.parentIds,
      householdId: person.householdId,
    }));
    const interpersonal = admitActiveRelationship(
      initial.civilization.society.interpersonal,
      relationshipPeople,
      edge,
    );
    const prepared = Object.freeze({
      ...initial,
      development: Object.freeze({
        ...initial.development,
        conditions: Object.freeze({ ...initial.development.conditions, meteorPressure: 100 }),
      }),
      civilization: Object.freeze({
        ...initial.civilization,
        agents: Object.freeze(
          initial.civilization.agents.map((agent) =>
            Object.freeze({
              ...agent,
              health: recipients.some((recipient) => recipient.id === agent.id) ? 5 : 100,
            }),
          ),
        ),
        society: Object.freeze({
          ...initial.civilization.society,
          interpersonal,
          people: Object.freeze(
            initial.civilization.society.people.map((person) =>
              Object.freeze({
                ...person,
                health: recipients.some((recipient) => recipient.id === person.id) ? 5 : 100,
              }),
            ),
          ),
        }),
      }),
    });

    const assisted = stepWorld(prepared, 1);
    const assistance = assisted.eventLog.find(
      (event) => event.kind === 'crisis-assisted' && event.subjectId === helper.id,
    );
    expect(assistance).toMatchObject({
      subjectKind: 'person',
      subjectId: helper.id,
      targetKind: 'person',
      targetId: linkedRecipient.id,
    });
    const changedEdge = assisted.civilization.society.interpersonal.active.find(
      (candidate) => candidate.id === edge.id,
    )!;
    expect(changedEdge.changedTick).toBe(YEAR);
    expect(changedEdge.trend).toBe('improving');
    expect(
      assisted.civilization.society.people.find((person) => person.id === linkedRecipient.id),
    ).toMatchObject({ alive: false, health: 0, deathTick: YEAR });
    expect(assisted.eventLog).toContainEqual(
      expect.objectContaining({ kind: 'person-died', subjectId: linkedRecipient.id }),
    );

    const sourced = stepWorld(assisted, YEAR);
    const sourcedEdge = [
      ...sourced.civilization.society.interpersonal.active,
      ...sourced.civilization.society.interpersonal.archived,
    ].find((candidate) => candidate.id === edge.id)!;
    expect(sourcedEdge.kind).toBe('widowed');
    expect(sourcedEdge.sharedEvents).toContainEqual(
      expect.objectContaining({ eventId: assistance!.id, tick: YEAR }),
    );
    const bereavement = sourced.eventLog.find((event) => event.kind === 'partner-widowed');
    expect(bereavement).toBeDefined();
    expect(new Set([bereavement!.subjectId, bereavement!.targetId])).toEqual(
      new Set([helper.id, linkedRecipient.id]),
    );
    const reloaded = deserializeWorldSnapshot(serializeWorldSnapshot(sourced));
    expect(canonicalWorldJson(reloaded)).toBe(canonicalWorldJson(sourced));
  });
});
