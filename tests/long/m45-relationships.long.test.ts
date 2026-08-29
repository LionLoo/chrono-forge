import {
  assertWorldInvariants,
  createInitialWorld,
  hashWorldState,
  stepWorld,
} from '../../src/simulation/world';
import { deserializeWorldSnapshot, serializeWorldSnapshot } from '../../src/simulation/persistence';
import { M45_SCENARIOS, m45HorizonTicks } from '../fixtures/m45-scenarios';

const REQUIRED_LIFECYCLE_EVENTS = Object.freeze([
  'relationship-formed',
  'friendship-formed',
  'close-friendship-formed',
  'mentorship-formed',
  'partnership-formed',
  'long-term-partnership-formed',
  'partner-widowed',
  'parent-child-bond-changed',
  'sibling-bond-formed',
  'household-formed',
  'household-split',
  'household-merged',
] as const);

// Rare pressure/recovery transitions are locked by the controlled lifecycle
// and paired consequence catalogues; stable long worlds should not manufacture
// recurring drama merely to satisfy an event checklist.

describe('locked M4.5 multi-generation relationship scenarios', () => {
  it('produces bounded persistent social and family histories across three seeds', () => {
    const observedEvents = new Set<string>();
    const observedBaselines: { name: string; hash: string; operations: number }[] = [];

    for (const scenario of M45_SCENARIOS) {
      const world = stepWorld(
        createInitialWorld(scenario.seed, { societyYearTicks: scenario.yearTicks }),
        m45HorizonTicks(scenario),
      );
      const society = world.civilization.society;
      const interpersonal = society.interpersonal;
      const peopleById = new Map(society.people.map((person) => [person.id, person]));

      for (const event of world.eventLog) observedEvents.add(event.kind);
      expect(() => assertWorldInvariants(world), scenario.name).not.toThrow();
      expect(
        society.people.some((person) => person.generation >= 2),
        scenario.name,
      ).toBe(true);

      const enduring = interpersonal.active.some(
        (edge) => edge.lastInteractionTick - edge.formedTick >= scenario.yearTicks * 20,
      );
      const archivedEnduring = interpersonal.archived.some(
        (edge) => edge.lastInteractionTick - edge.formedTick >= scenario.yearTicks * 20,
      );
      expect(enduring || archivedEnduring, `${scenario.name} lacks a 20-year bond`).toBe(true);

      for (const person of society.people) {
        expect(
          interpersonal.active.filter(
            (edge) => edge.firstPersonId === person.id || edge.secondPersonId === person.id,
          ).length,
        ).toBeLessThanOrEqual(24);
        expect(
          interpersonal.archived.filter(
            (edge) => edge.firstPersonId === person.id || edge.secondPersonId === person.id,
          ).length,
        ).toBeLessThanOrEqual(24);
        expect(
          interpersonal.householdHistories.get(person.id)?.intervals.length ?? 0,
        ).toBeLessThanOrEqual(16);
      }

      for (const child of society.people.filter((person) => person.origin === 'birth')) {
        const parents = child.parentIds.filter((id) => id !== 0);
        expect(
          parents.length,
          `${scenario.name}:${child.id} needs one or two guardians`,
        ).toBeGreaterThanOrEqual(1);
        expect(
          parents.length,
          `${scenario.name}:${child.id} has too many guardians`,
        ).toBeLessThanOrEqual(2);
        expect(parents.every((id) => peopleById.has(id))).toBe(true);
        const bonds = interpersonal.familyBonds.filter(
          (bond) => bond.kind === 'parent' && bond.childId === child.id,
        );
        expect(bonds.map((bond) => bond.adultId).sort((a, b) => a - b)).toStrictEqual(
          [...parents].sort((a, b) => a - b),
        );
        expect(bonds.every((bond) => bond.formedEventId > 0)).toBe(true);
        const arrival = interpersonal.childArrivals.find(
          (candidate) => candidate.childId === child.id,
        );
        expect(arrival?.eventId).toBeGreaterThan(0);
        expect(arrival?.guardianIds).toStrictEqual([...parents].sort((a, b) => a - b));
      }

      expect(
        interpersonal.householdHistories.some((history) => history.intervals.length >= 2),
        `${scenario.name} lacks a changed household`,
      ).toBe(true);
      observedBaselines.push({
        name: scenario.name,
        hash: hashWorldState(world),
        operations: interpersonal.operationCount,
      });
    }

    expect(REQUIRED_LIFECYCLE_EVENTS.filter((kind) => !observedEvents.has(kind))).toStrictEqual([]);
    expect(observedBaselines).toStrictEqual(
      M45_SCENARIOS.map((scenario) => ({
        name: scenario.name,
        hash: scenario.expectedHash,
        operations: scenario.expectedOperations,
      })),
    );
  }, 90_000);

  it('is equivalent across arbitrary tick partitions and a mid-history v4 reload', () => {
    const scenario = M45_SCENARIOS[0]!;
    const horizon = scenario.yearTicks * 25;
    const initial = createInitialWorld(scenario.seed, { societyYearTicks: scenario.yearTicks });
    const oneShot = stepWorld(initial, horizon);

    let partitioned = createInitialWorld(scenario.seed, {
      societyYearTicks: scenario.yearTicks,
    });
    const partitions = [1, 999, 4_001, 7_777, 2_222] as const;
    let remaining = horizon;
    let partitionIndex = 0;
    while (remaining > 0) {
      const ticks = Math.min(partitions[partitionIndex % partitions.length]!, remaining);
      partitioned = stepWorld(partitioned, ticks);
      remaining -= ticks;
      partitionIndex += 1;
    }

    const saveBoundary = scenario.yearTicks * 12 + 1_337;
    const beforeSave = stepWorld(
      createInitialWorld(scenario.seed, { societyYearTicks: scenario.yearTicks }),
      saveBoundary,
    );
    const reloaded = deserializeWorldSnapshot(serializeWorldSnapshot(beforeSave));
    const resumed = stepWorld(reloaded, horizon - saveBoundary);

    expect(hashWorldState(partitioned)).toBe(hashWorldState(oneShot));
    expect(hashWorldState(resumed)).toBe(hashWorldState(oneShot));
    expect(serializeWorldSnapshot(resumed)).toBe(serializeWorldSnapshot(oneShot));
  }, 45_000);
});
