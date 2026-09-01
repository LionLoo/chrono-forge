import { describe, expect, it } from 'vitest';

import {
  selectCoMigrationPerson,
  selectConflictTargetCivilization,
  selectPoliticalSupportCivilization,
  selectRefugeeSupportSettlement,
} from '../../src/simulation/civilizations';
import type { ActiveRelationship } from '../../src/simulation/relationships';
import { relationshipDecisionInfluence } from '../../src/simulation/relationships/lifecycle';
import {
  createCivilizationsContext,
  createInitialWorld,
  stepWorld,
  type WorldState,
} from '../../src/simulation/world';

function edge(
  id: number,
  firstPersonId: number,
  secondPersonId: number,
  friendly: boolean,
): ActiveRelationship {
  const positive = friendly
    ? { affinity: 90, trust: 90, closeness: 90, commitment: 70, grievance: 0 }
    : { affinity: 10, trust: 5, closeness: 0, commitment: 0, grievance: 80 };
  return {
    id,
    firstPersonId,
    secondPersonId,
    firstRole: friendly ? 'peer' : 'adversary',
    secondRole: friendly ? 'peer' : 'adversary',
    kind: friendly ? 'close-friend' : 'enemy',
    formedTick: 0,
    changedTick: 0,
    lastInteractionTick: 0,
    observedSinceTick: 0,
    trend: 'stable',
    firstToSecond: positive,
    secondToFirst: positive,
    sharedEvents: [],
    rng: [id, id + 1, id + 2, id + 3],
    legacySocietyCounters: null,
  };
}

describe('M6 relationship-grounded geopolitical choices', () => {
  it('changes co-migration and refuge choices when only the salient social bond changes', () => {
    const leadId = 1;
    const bondToThree = edge(1, leadId, 3, true);
    const bondToFour = edge(1, leadId, 4, true);
    const chooseCompanion = (bond: ActiveRelationship) =>
      selectCoMigrationPerson([
        {
          id: 3,
          personId: 3,
          baseUtility: 50,
          relationshipDecisionInfluence:
            bond.secondPersonId === 3
              ? relationshipDecisionInfluence(bond, leadId, 'migration')
              : 0,
        },
        {
          id: 4,
          personId: 4,
          baseUtility: 50,
          relationshipDecisionInfluence:
            bond.secondPersonId === 4
              ? relationshipDecisionInfluence(bond, leadId, 'migration')
              : 0,
        },
      ]);

    expect(chooseCompanion(bondToThree)).toBe(3);
    expect(chooseCompanion(bondToFour)).toBe(4);
    expect(
      selectRefugeeSupportSettlement([
        { id: 10, settlementId: 10, baseUtility: 60, relationshipDecisionInfluence: 0 },
        {
          id: 20,
          settlementId: 20,
          baseUtility: 55,
          relationshipDecisionInfluence: relationshipDecisionInfluence(bondToFour, leadId, 'help'),
        },
      ]),
    ).toBe(20);
  });

  it('changes political support and conflict targets under identical material utility', () => {
    const alliance = relationshipDecisionInfluence(edge(1, 1, 2, true), 1, 'politics');
    const grievance = relationshipDecisionInfluence(edge(2, 1, 3, false), 1, 'conflict');

    expect(
      selectPoliticalSupportCivilization([
        { id: 2, civilizationId: 2, baseUtility: 50, relationshipDecisionInfluence: alliance },
        { id: 3, civilizationId: 3, baseUtility: 50, relationshipDecisionInfluence: 0 },
      ]),
    ).toBe(2);
    expect(
      selectConflictTargetCivilization([
        { id: 2, civilizationId: 2, baseUtility: 50, relationshipDecisionInfluence: 0 },
        { id: 3, civilizationId: 3, baseUtility: 50, relationshipDecisionInfluence: grievance },
      ]),
    ).toBe(3);
  });

  it('changes the actual autonomous conflict target when only one cross-settlement bond changes', () => {
    const yearTicks = 5_000;
    const base = stepWorld(
      createInitialWorld([37, 41, 43, 47], { societyYearTicks: yearTicks }),
      7 * yearTicks,
    );
    const residentFor = (civilizationId: number): number | null => {
      const civilization = base.civilizations.civilizations.find(
        (candidate) => candidate.id === civilizationId,
      )!;
      return (
        base.civilizations.residencies.find(
          (residency) =>
            residency.subjectKind === 'person' &&
            residency.endedTick === null &&
            civilization.memberSettlementIds.includes(residency.settlementId),
        )?.subjectId ?? null
      );
    };
    const civilizations = base.civilizations.civilizations.filter(
      (civilization) => civilization.endedTick === null && residentFor(civilization.id) !== null,
    );
    expect(civilizations.length).toBeGreaterThanOrEqual(3);
    const requiredResidentFor = (civilizationId: number) => residentFor(civilizationId)!;
    const attacker = civilizations[0]!;
    const firstTarget = civilizations[1]!;
    const secondTarget = civilizations[2]!;
    const attackerPersonId = requiredResidentFor(attacker.id);
    const relationshipId = base.civilization.society.interpersonal.nextRelationshipId;
    const withEnemyIn = (targetCivilizationId: number): WorldState =>
      Object.freeze({
        ...base,
        civilization: Object.freeze({
          ...base.civilization,
          society: Object.freeze({
            ...base.civilization.society,
            interpersonal: Object.freeze({
              ...base.civilization.society.interpersonal,
              nextRelationshipId: relationshipId + 1,
              active: Object.freeze([
                edge(
                  relationshipId,
                  attackerPersonId,
                  requiredResidentFor(targetCivilizationId),
                  false,
                ),
              ]),
            }),
          }),
        }),
      });
    const firstContext = createCivilizationsContext(withEnemyIn(firstTarget.id), 8 * yearTicks);
    const secondContext = createCivilizationsContext(withEnemyIn(secondTarget.id), 8 * yearTicks);

    expect(firstContext.conflictCandidates[0]?.defenderCivilizationId).toBe(firstTarget.id);
    expect(secondContext.conflictCandidates[0]?.defenderCivilizationId).toBe(secondTarget.id);
  });
});
