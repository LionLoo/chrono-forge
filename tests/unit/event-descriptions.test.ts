import {
  CIVILIZATION_EVENT_KINDS,
  DISASTER_EVENT_STEMS,
  INTERVENTION_EVENT_STEMS,
  PLAYER_VISIBLE_EVENT_KINDS,
  RELATIONSHIP_EVENT_KINDS,
  SPACE_EVENT_KINDS,
  assertFactualEventSummary,
  isPlayerVisibleEventKind,
  normalizeFactualEventSummary,
} from '../../src/simulation/events';
import { hashCanonicalJson } from '../../src/simulation/canonical';
import { deserializeWorldSnapshot, serializeWorldSnapshot } from '../../src/simulation/persistence';
import { ACCELERATED_YEAR_TICKS } from '../../src/simulation/society';
import {
  appendWorldEvent,
  assertWorldInvariants,
  createInitialWorld,
  stepWorld,
} from '../../src/simulation/world';
import {
  projectRelationshipEventPage,
  projectRelationshipPage,
  projectWorldFrame,
} from '../../src/workers/simulation-runtime';

describe('M10 factual event description contract', () => {
  it('keeps every closed event family in one unique player-visible catalogue', () => {
    expect(new Set(PLAYER_VISIBLE_EVENT_KINDS).size).toBe(PLAYER_VISIBLE_EVENT_KINDS.length);
    for (const kind of [
      ...RELATIONSHIP_EVENT_KINDS,
      ...CIVILIZATION_EVENT_KINDS,
      ...SPACE_EVENT_KINDS,
      ...DISASTER_EVENT_STEMS.flatMap((stem) => [`${stem}-started`, `${stem}-recovered`]),
      ...INTERVENTION_EVENT_STEMS.map((stem) => `${stem}-intervened`),
    ]) {
      expect(isPlayerVisibleEventKind(kind), kind).toBe(true);
    }
    expect(isPlayerVisibleEventKind('unreviewed-generic-event')).toBe(false);
  });

  it('admits participant-complete source-specific copy for every registered event kind', () => {
    let world = createInitialWorld([1, 2, 3, 4]);
    const person = world.civilization.agents[0]!;
    const appendedKinds: string[] = [];

    for (const kind of PLAYER_VISIBLE_EVENT_KINDS) {
      const summary = `At tick ${world.tick}, ${kind.replaceAll('-', ' ')} involved ${person.name} and household 1 with recorded amount 1.`;
      world = appendWorldEvent(world, kind, world.tick, {
        subjectKind: 'person',
        subjectId: person.id,
        targetKind: 'household',
        targetId: 1,
        amount: 1,
        summary,
      });
      const event = world.eventLog.at(-1)!;
      expect(event.kind).toBe(kind);
      expect(event.summary).toBe(summary);
      expect(() => assertFactualEventSummary(event.summary), kind).not.toThrow();
      appendedKinds.push(event.kind);
    }

    expect(appendedKinds).toStrictEqual(PLAYER_VISIBLE_EVENT_KINDS);
    expect(
      new Set(world.eventLog.slice(-appendedKinds.length).map((event) => event.summary)).size,
    ).toBe(PLAYER_VISIBLE_EVENT_KINDS.length);
  });

  it('upgrades deficient v12 descriptions from every event family without changing authority', () => {
    let world = createInitialWorld([1, 2, 3, 4]);
    const person = world.civilization.agents[0]!;
    const familyKinds = [
      'world-generated',
      'shelter-operational',
      'person-born',
      'friendship-formed',
      'knowledge-discovered',
      'route-established',
      'spacecraft-launched',
    ] as const;
    const eventIds: number[] = [];
    for (const kind of familyKinds) {
      world = appendWorldEvent(world, kind, world.tick, {
        subjectKind: 'person',
        subjectId: person.id,
        targetKind: 'household',
        targetId: 1,
        amount: 1,
        summary: `At tick ${world.tick}, ${kind.replaceAll('-', ' ')} involved ${person.name} and household 1 with recorded amount 1.`,
      });
      eventIds.push(world.eventLog.at(-1)!.id);
    }
    const envelope = JSON.parse(serializeWorldSnapshot(world)) as {
      checksum: string;
      contentVersion: number;
      engineVersion: number;
      formatVersion: number;
      payload: { eventLog: (Record<string, unknown> & { id: number; summary: string })[] };
    };
    const legacyEvents = envelope.payload.eventLog
      .filter((event) => eventIds.includes(event.id))
      .map((event) => {
        event.summary = 'Recorded a generic player-visible event.';
        return { ...event };
      });
    envelope.contentVersion = 12;
    envelope.engineVersion = 12;
    envelope.formatVersion = 12;
    envelope.checksum = hashCanonicalJson(JSON.stringify(envelope.payload));

    const upgraded = deserializeWorldSnapshot(JSON.stringify(envelope));
    const upgradedEvents = upgraded.eventLog.filter((event) => eventIds.includes(event.id));

    expect(upgradedEvents).toHaveLength(familyKinds.length);
    for (const [index, event] of upgradedEvents.entries()) {
      expect({ ...event, summary: legacyEvents[index]!.summary }).toStrictEqual(
        legacyEvents[index],
      );
      expect(event.summary).not.toBe(legacyEvents[index]!.summary);
      expect(() => assertFactualEventSummary(event.summary), event.kind).not.toThrow();
    }
  });

  it('rejects placeholders, generic prose, and missing typed participants at admission', () => {
    const world = createInitialWorld([1, 2, 3, 4]);
    const person = world.civilization.agents[0]!;

    for (const summary of [
      'Recorded household-migrated at tick 0.',
      'Development conditions changed through weather-intervened.',
      'Cargo arrived.',
      'Program reached spaceflight.',
      'A message reached Body-2.',
      'A value became undefined.',
    ]) {
      expect(() => assertFactualEventSummary(summary), summary).toThrow();
    }
    expect(() =>
      appendWorldEvent(world, 'household-migrated', world.tick, {
        subjectKind: 'person',
        subjectId: person.id,
        targetKind: 'household',
        targetId: 1,
        summary: 'Household 1 welcomed a founder.',
      }),
    ).toThrow(/subject/i);
    expect(() =>
      appendWorldEvent(world, 'household-migrated', world.tick, {
        subjectKind: 'person',
        subjectId: person.id,
        targetKind: 'household',
        targetId: 1,
        summary: `${person.name} migrated within the settlement.`,
      }),
    ).toThrow(/target/i);
    expect(() =>
      appendWorldEvent(world, 'household-migrated', world.tick, {
        subjectKind: 'person',
        subjectId: person.id,
        targetKind: 'household',
        targetId: 1,
        summary: `${person.name} migrated into household 1.`,
      }),
    ).not.toThrow();
  });

  it('keeps deterministic source prose exact across timelines, biographies, relationships, and reload', () => {
    const create = () =>
      stepWorld(
        createInitialWorld([7, 11, 13, 17], { societyYearTicks: ACCELERATED_YEAR_TICKS }),
        40 * ACCELERATED_YEAR_TICKS,
      );
    const world = create();
    const repeated = create();
    assertWorldInvariants(world);
    expect(repeated.eventLog).toStrictEqual(world.eventLog);

    const eventById = new Map(world.eventLog.map((event) => [event.id, event]));
    const normalizedKinds = new Map<string, Set<string>>();
    for (const event of world.eventLog) {
      expect(isPlayerVisibleEventKind(event.kind), event.kind).toBe(true);
      expect(() => assertFactualEventSummary(event.summary), event.kind).not.toThrow();
      const normalized = normalizeFactualEventSummary(event.summary);
      const kinds = normalizedKinds.get(normalized) ?? new Set<string>();
      kinds.add(event.kind);
      normalizedKinds.set(normalized, kinds);
    }
    for (const [normalized, kinds] of normalizedKinds) {
      expect(kinds.size, `${normalized}: ${[...kinds].join(', ')}`).toBe(1);
    }

    const frame = projectWorldFrame(world);
    for (const entry of frame.society.timeline) {
      expect(entry).toStrictEqual({
        id: entry.id,
        tick: eventById.get(entry.id)!.tick,
        summary: eventById.get(entry.id)!.summary,
      });
    }
    for (const person of frame.society.people) {
      for (const entry of person.biography) {
        expect(entry).toStrictEqual({
          eventId: entry.eventId,
          tick: eventById.get(entry.eventId)!.tick,
          summary: eventById.get(entry.eventId)!.summary,
        });
      }
      const relationships = projectRelationshipPage(world, person.id, 0);
      for (const relationship of relationships.relationships) {
        const page = projectRelationshipEventPage(world, person.id, relationship.id, 0);
        for (const entry of page.events) {
          expect(entry.summary).toBe(eventById.get(entry.eventId)!.summary);
          expect(entry.tick).toBe(eventById.get(entry.eventId)!.tick);
        }
      }
    }

    const snapshot = serializeWorldSnapshot(world);
    const reloaded = deserializeWorldSnapshot(snapshot);
    expect(reloaded.eventLog).toStrictEqual(world.eventLog);
    expect(serializeWorldSnapshot(reloaded)).toBe(snapshot);
  }, 60_000);
});
