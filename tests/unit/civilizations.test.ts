import { describe, expect, it } from 'vitest';

import {
  MAX_FOUNDING_SITE_SAMPLES,
  advanceCivilizations,
  assertCivilizationsInvariants,
  civilizationsDto,
  createInitialCivilizations,
  deriveSettlementDevelopmentStage,
  migrateSingleSettlementCivilizations,
  selectCoMigrationPerson,
  selectConflictTargetCivilization,
  selectPoliticalSupportCivilization,
  selectRefugeeSupportSettlement,
  type CivilizationsContext,
  type CivilizationsInitialization,
} from '../../src/simulation/civilizations';

const SEED = [7, 11, 13, 17] as const;
const YEAR = 5_000;

const reserves = Object.freeze({ food: 80, water: 70, timber: 30, stone: 20, metal: 10 });

function initialization(): CivilizationsInitialization {
  return Object.freeze({
    worldWidth: 8,
    worldHeight: 8,
    settlementName: 'Riverhome',
    civilizationName: 'Riverfolk',
    centerTileIndex: 9,
    cultureId: 1,
    personIds: Object.freeze([11, 12]),
    householdIds: Object.freeze([3]),
    reserves,
    stability: 65,
  });
}

function context(
  tick: number,
  overrides: Partial<CivilizationsContext> = {},
): CivilizationsContext {
  return Object.freeze({
    tick,
    yearTicks: YEAR,
    foundingReserveAvailable: reserves,
    foundingCandidates: Object.freeze([]),
    economies: Object.freeze([]),
    routeCandidates: Object.freeze([]),
    diplomacyCandidates: Object.freeze([]),
    conflictCandidates: Object.freeze([]),
    conflictResolutions: Object.freeze([]),
    residencyTransfers: Object.freeze([]),
    ruinSettlementIds: Object.freeze([]),
    federationCivilizationIds: Object.freeze([]),
    fragmentationCivilizationIds: Object.freeze([]),
    settlementDevelopmentInputs: Object.freeze([]),
    territoryChanges: Object.freeze([]),
    ...overrides,
  });
}

describe('M6 civilizations authority', () => {
  it('creates deterministic initial and conservative migrated single-settlement baselines without M6 history', () => {
    const initial = createInitialCivilizations(SEED, 0, initialization());
    const repeated = createInitialCivilizations(SEED, 0, initialization());
    const migrated = migrateSingleSettlementCivilizations(SEED, 77, initialization());

    expect(civilizationsDto(initial)).toStrictEqual(civilizationsDto(repeated));
    expect(initial.diplomacy).toStrictEqual([]);
    expect(initial.routes).toStrictEqual([]);
    expect(initial.conflicts).toStrictEqual([]);
    expect(initial.ruins).toStrictEqual([]);
    expect(initial.settlements[0]?.territoryHistory).toStrictEqual([]);
    expect(initial.settlements[0]).toMatchObject({
      developmentStage: 'founding',
      developmentStageChangedTick: 0,
      developmentStageProvenance: 'initial',
    });
    expect(migrated.settlements[0]?.provenance).toBe('v5-migration');
    expect(migrated.civilizations[0]?.provenance).toBe('v5-migration');
    expect(migrated.settlements[0]?.foundedTick).toBe(77);
    assertCivilizationsInvariants(initial);
    assertCivilizationsInvariants(migrated);
  });

  it('advances and regresses one factual settlement stage per year with hysteresis', () => {
    const initial = createInitialCivilizations(SEED, 0, {
      ...initialization(),
      personIds: Object.freeze(Array.from({ length: 30 }, (_, index) => index + 11)),
      stability: 70,
    });
    const developmentInput = Object.freeze({
      settlementId: 1,
      operationalStructures: 2,
      infrastructure: 40,
      knownKnowledgeIds: Object.freeze(['agriculture', 'mechanics', 'advanced-energy']),
    });

    let state = initial;
    for (const [year, expected] of [
      [1, 'village'],
      [2, 'town'],
      [3, 'city'],
      [4, 'advanced-city'],
    ] as const) {
      const result = advanceCivilizations(
        state,
        context(YEAR * year, {
          settlementDevelopmentInputs: Object.freeze([developmentInput]),
        }),
      );
      state = result.state;
      expect(state.settlements[0]).toMatchObject({
        developmentStage: expected,
        developmentStageChangedTick: YEAR * year,
        developmentStageProvenance: 'observed',
      });
      expect(result.events.at(-1)).toMatchObject({
        kind: 'settlement-stage-changed',
        subjectId: 1,
        targetId: 2,
      });
    }

    const regressed = advanceCivilizations(
      state,
      context(YEAR * 5, {
        economies: Object.freeze([
          {
            settlementId: 1,
            production: Object.freeze({ food: 0, water: 0, timber: 0, stone: 0, metal: 0 }),
            consumption: Object.freeze({ food: 0, water: 0, timber: 0, stone: 0, metal: 0 }),
            stabilityDelta: -40,
          },
        ]),
        settlementDevelopmentInputs: Object.freeze([
          Object.freeze({
            settlementId: 1,
            operationalStructures: 0,
            infrastructure: 0,
            knownKnowledgeIds: Object.freeze([]),
          }),
        ]),
      }),
    );
    expect(regressed.state.settlements[0]).toMatchObject({
      developmentStage: 'city',
      developmentStageChangedTick: YEAR * 5,
      developmentStageProvenance: 'observed',
    });
    expect(regressed.events.at(-1)?.summary).toContain('contracted');
  });

  it('derives the highest fact-supported migration stage without gradual history', () => {
    expect(
      deriveSettlementDevelopmentStage(
        { population: 30, stability: 70 },
        {
          settlementId: 1,
          operationalStructures: 2,
          infrastructure: 40,
          knownKnowledgeIds: Object.freeze(['agriculture', 'mechanics', 'advanced-energy']),
        },
      ),
    ).toBe('advanced-city');
  });

  it('retains a stage inside its hysteresis band without emitting false history', () => {
    const initial = createInitialCivilizations(SEED, 0, {
      ...initialization(),
      personIds: Object.freeze([11, 12, 13, 14]),
      stability: 30,
    });
    const promoted = advanceCivilizations(
      initial,
      context(YEAR, {
        settlementDevelopmentInputs: Object.freeze([
          Object.freeze({
            settlementId: 1,
            operationalStructures: 0,
            infrastructure: 8,
            knownKnowledgeIds: Object.freeze([]),
          }),
        ]),
      }),
    );
    const retained = advanceCivilizations(
      promoted.state,
      context(YEAR * 2, {
        settlementDevelopmentInputs: Object.freeze([
          Object.freeze({
            settlementId: 1,
            operationalStructures: 0,
            infrastructure: 4,
            knownKnowledgeIds: Object.freeze([]),
          }),
        ]),
      }),
    );

    expect(promoted.state.settlements[0]?.developmentStage).toBe('village');
    expect(retained.state.settlements[0]?.developmentStage).toBe('village');
    expect(retained.events).toStrictEqual([]);
  });

  it('is deterministic, conserves founding reserves through an explicit delta, and preserves references', () => {
    const initial = createInitialCivilizations(SEED, 0, initialization());
    const founding = context(YEAR, {
      foundingCandidates: Object.freeze([
        {
          name: 'Stoneford',
          civilizationName: 'Stonefolk',
          cultureId: 2,
          centerTileIndex: 31,
          siteScore: 90,
          personIds: Object.freeze([21, 22]),
          householdIds: Object.freeze([8]),
          reserveTransfer: Object.freeze({ food: 10, water: 10, timber: 5, stone: 2, metal: 0 }),
          stability: 55,
        },
      ]),
    });
    const first = advanceCivilizations(initial, founding);
    const repeated = advanceCivilizations(initial, founding);
    const founded = first.state.settlements.find((settlement) => settlement.name === 'Stoneford');

    expect(civilizationsDto(first.state)).toStrictEqual(civilizationsDto(repeated.state));
    expect(first.events).toStrictEqual(repeated.events);
    expect(founded?.reserves).toStrictEqual({ food: 10, water: 10, timber: 5, stone: 2, metal: 0 });
    expect(first.foundingReserveDelta).toStrictEqual({
      food: -10,
      water: -10,
      timber: -5,
      stone: -2,
      metal: 0,
    });
    expect(
      first.state.residencies.filter((entry) => entry.settlementId === founded?.id),
    ).toHaveLength(3);
    expect(first.state.tileOwners[31]).toBe(founded?.id);
    assertCivilizationsInvariants(first.state);
  });

  it('runs an explicit founding, route, diplomacy, conflict, resolution, ruin, and territory path in annual order', () => {
    const initial = createInitialCivilizations(SEED, 0, initialization());
    const founded = advanceCivilizations(
      initial,
      context(YEAR, {
        foundingCandidates: Object.freeze([
          {
            name: 'Stoneford',
            civilizationName: 'Stonefolk',
            cultureId: 2,
            centerTileIndex: 31,
            siteScore: 90,
            personIds: Object.freeze([21]),
            householdIds: Object.freeze([]),
            reserveTransfer: Object.freeze({ food: 1, water: 1, timber: 0, stone: 0, metal: 0 }),
            stability: 55,
          },
        ]),
      }),
    ).state;
    const secondSettlement = founded.settlements.find(
      (settlement) => settlement.name === 'Stoneford',
    )!;
    const secondCivilization = founded.civilizations.find(
      (civilization) => civilization.foundingSettlementId === secondSettlement.id,
    )!;
    const next = advanceCivilizations(
      founded,
      context(YEAR * 2, {
        economies: Object.freeze([
          {
            settlementId: 1,
            production: Object.freeze({ food: 3, water: 2, timber: 0, stone: 0, metal: 0 }),
            consumption: Object.freeze({ food: 1, water: 1, timber: 0, stone: 0, metal: 0 }),
            stabilityDelta: 1,
          },
        ]),
        routeCandidates: Object.freeze([
          { firstSettlementId: 1, secondSettlementId: secondSettlement.id, utility: 90, volume: 6 },
        ]),
        diplomacyCandidates: Object.freeze([
          { firstCivilizationId: 2, secondCivilizationId: secondCivilization.id, score: -80 },
        ]),
        conflictCandidates: Object.freeze([
          {
            attackerCivilizationId: 2,
            defenderCivilizationId: secondCivilization.id,
            pressure: 80,
          },
        ]),
        territoryChanges: Object.freeze([{ tileIndex: 30, nextSettlementId: secondSettlement.id }]),
      }),
    );
    const conflict = next.state.conflicts[0]!;
    const resolved = advanceCivilizations(
      next.state,
      context(YEAR * 3, {
        conflictResolutions: Object.freeze([{ conflictId: conflict.id, winnerCivilizationId: 2 }]),
        residencyTransfers: Object.freeze([
          {
            fromSettlementId: secondSettlement.id,
            toSettlementId: 1,
            personIds: Object.freeze([21]),
            householdIds: Object.freeze([]),
            reason: 'refugee',
          },
        ]),
      }),
    );
    const restored = advanceCivilizations(
      resolved.state,
      context(YEAR * 4, { recoveredSettlementIds: Object.freeze([secondSettlement.id]) }),
    );
    expect(
      restored.state.settlements.find((settlement) => settlement.id === secondSettlement.id),
    ).toMatchObject({ status: 'active', endedTick: null, civilizationId: 2 });
    expect(restored.events.map((event) => event.kind)).toContain('settlement-restored');

    const resolvedAndRuined = advanceCivilizations(
      next.state,
      context(YEAR * 3, {
        conflictResolutions: Object.freeze([{ conflictId: conflict.id, winnerCivilizationId: 2 }]),
        residencyTransfers: Object.freeze([
          {
            fromSettlementId: secondSettlement.id,
            toSettlementId: 1,
            personIds: Object.freeze([21]),
            householdIds: Object.freeze([]),
            reason: 'refugee',
          },
        ]),
        ruinSettlementIds: Object.freeze([secondSettlement.id]),
      }),
    );

    expect(next.events.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining([
        'route-established',
        'diplomacy-changed',
        'conflict-started',
        'territory-changed',
      ]),
    );
    expect(next.state.routes[0]?.status).toBe('active');
    expect(next.state.diplomacy[0]?.status).toBe('at-war');
    expect(resolvedAndRuined.state.conflicts[0]?.status).toBe('resolved');
    expect(resolvedAndRuined.state.ruins[0]?.settlementId).toBe(secondSettlement.id);
    expect(resolvedAndRuined.events.map((event) => event.kind)).toContain('refugees-relocated');
    expect(
      resolvedAndRuined.state.residencies.find(
        (entry) =>
          entry.subjectKind === 'person' && entry.subjectId === 21 && entry.endedTick === null,
      )?.settlementId,
    ).toBe(1);
    expect(
      resolvedAndRuined.state.settlements.find((entry) => entry.id === secondSettlement.id)?.status,
    ).toBe('abandoned');
    assertCivilizationsInvariants(resolvedAndRuined.state);
  });

  it('conserves scarce goods through bounded deterministic market exchange and stops on disruption', () => {
    const initial = createInitialCivilizations(SEED, 0, initialization());
    const founded = advanceCivilizations(
      initial,
      context(YEAR, {
        foundingCandidates: Object.freeze([
          {
            name: 'Stoneford',
            civilizationName: 'Stonefolk',
            cultureId: 2,
            centerTileIndex: 31,
            siteScore: 90,
            personIds: Object.freeze([]),
            householdIds: Object.freeze([]),
            reserveTransfer: Object.freeze({ food: 60, water: 60, timber: 0, stone: 0, metal: 0 }),
            stability: 55,
          },
        ]),
      }),
    ).state;
    const stoneford = founded.settlements.find((settlement) => settlement.name === 'Stoneford')!;
    const exchanged = advanceCivilizations(
      founded,
      context(YEAR * 2, {
        economies: Object.freeze([
          {
            settlementId: stoneford.id,
            production: Object.freeze({ food: 0, water: 40, timber: 0, stone: 0, metal: 0 }),
            consumption: Object.freeze({ food: 0, water: 0, timber: 0, stone: 0, metal: 0 }),
            stabilityDelta: 0,
          },
          {
            settlementId: 1,
            production: Object.freeze({ food: 0, water: 0, timber: 0, stone: 0, metal: 0 }),
            consumption: Object.freeze({ food: 0, water: 10, timber: 0, stone: 0, metal: 0 }),
            stabilityDelta: 0,
          },
        ]),
        routeCandidates: Object.freeze([
          { firstSettlementId: 1, secondSettlementId: stoneford.id, utility: 90, volume: 12 },
        ]),
      }),
    );

    const riverhomeAfterExchange = exchanged.state.settlements.find(
      (settlement) => settlement.id === 1,
    )!;
    const stonefordAfterExchange = exchanged.state.settlements.find(
      (settlement) => settlement.id === stoneford.id,
    )!;
    expect(riverhomeAfterExchange.reserves).not.toStrictEqual(reserves);
    expect(riverhomeAfterExchange.reserves.food + stonefordAfterExchange.reserves.food).toBe(140);
    expect(riverhomeAfterExchange.reserves.water + stonefordAfterExchange.reserves.water).toBe(160);
    expect(riverhomeAfterExchange.reserves.timber + stonefordAfterExchange.reserves.timber).toBe(
      30,
    );
    expect(riverhomeAfterExchange.reserves.stone + stonefordAfterExchange.reserves.stone).toBe(20);
    expect(riverhomeAfterExchange.reserves.metal + stonefordAfterExchange.reserves.metal).toBe(10);
    expect(exchanged.state.routes[0]?.volume).toBe(12);

    const resized = advanceCivilizations(
      exchanged.state,
      context(YEAR * 3, {
        routeCandidates: Object.freeze([
          { firstSettlementId: 1, secondSettlementId: stoneford.id, utility: 90, volume: 6 },
        ]),
      }),
    );
    expect(resized.state.routes[0]?.volume).toBe(6);

    const disrupted = advanceCivilizations(
      resized.state,
      context(YEAR * 4, {
        routeCandidates: Object.freeze([
          { firstSettlementId: 1, secondSettlementId: stoneford.id, utility: -40, volume: 12 },
        ]),
      }),
    );
    expect(disrupted.state.routes[0]?.status).toBe('disrupted');
    expect(disrupted.state.settlements).toStrictEqual(resized.state.settlements);
    assertCivilizationsInvariants(disrupted.state);
  });

  it('requires evacuation before ruin and closes a settlement-less civilization', () => {
    const initial = createInitialCivilizations(SEED, 0, initialization());
    const founded = advanceCivilizations(
      initial,
      context(YEAR, {
        foundingCandidates: Object.freeze([
          {
            name: 'Stoneford',
            civilizationName: 'Stonefolk',
            cultureId: 2,
            centerTileIndex: 31,
            siteScore: 90,
            personIds: Object.freeze([21]),
            householdIds: Object.freeze([8]),
            reserveTransfer: Object.freeze({ food: 5, water: 5, timber: 1, stone: 1, metal: 0 }),
            stability: 20,
          },
        ]),
      }),
    ).state;
    const stoneford = founded.settlements.find((settlement) => settlement.name === 'Stoneford')!;
    const stonefolk = founded.civilizations.find(
      (civilization) => civilization.foundingSettlementId === stoneford.id,
    )!;

    expect(() =>
      advanceCivilizations(
        founded,
        context(YEAR * 2, { ruinSettlementIds: Object.freeze([stoneford.id]) }),
      ),
    ).toThrow('active residents');

    const abandoned = advanceCivilizations(
      founded,
      context(YEAR * 2, {
        residencyTransfers: Object.freeze([
          {
            fromSettlementId: stoneford.id,
            toSettlementId: 1,
            personIds: Object.freeze([21]),
            householdIds: Object.freeze([8]),
            reason: 'refugee',
          },
        ]),
        ruinSettlementIds: Object.freeze([stoneford.id]),
        territoryChanges: Object.freeze([
          { tileIndex: stoneford.centerTileIndex, nextSettlementId: 0 },
        ]),
      }),
    ).state;

    expect(abandoned.settlements.find((settlement) => settlement.id === stoneford.id)?.status).toBe(
      'abandoned',
    );
    expect(
      abandoned.civilizations.find((civilization) => civilization.id === stonefolk.id),
    ).toMatchObject({ status: 'collapsed', endedTick: YEAR * 2 });
    expect(
      abandoned.residencies.some(
        (residency) => residency.settlementId === stoneford.id && residency.endedTick === null,
      ),
    ).toBe(false);
    expect(abandoned.tileOwners[stoneford.centerTileIndex]).toBe(0);
    assertCivilizationsInvariants(abandoned);
  });

  it('enforces bounded candidate work and rejects invalid global reference conservation', () => {
    const initial = createInitialCivilizations(SEED, 0, initialization());
    expect(() =>
      advanceCivilizations(
        initial,
        context(YEAR, {
          foundingCandidates: Object.freeze(
            Array.from({ length: MAX_FOUNDING_SITE_SAMPLES + 1 }, (_, index) => ({
              name: `Site${index}`,
              civilizationName: `People${index}`,
              cultureId: 1,
              centerTileIndex: index % 64,
              siteScore: 0,
              personIds: Object.freeze([]),
              householdIds: Object.freeze([]),
              reserveTransfer: Object.freeze({ food: 0, water: 0, timber: 0, stone: 0, metal: 0 }),
              stability: 0,
            })),
          ),
        }),
      ),
    ).toThrow('candidate cap');
    expect(() =>
      assertCivilizationsInvariants(
        Object.freeze({
          ...initial,
          tileOwners: Object.freeze([...initial.tileOwners.slice(0, -1), 999]),
        }),
      ),
    ).toThrow('Tile ownership');
  });

  it('uses only caller-supplied indexed relationship candidates for migration, refugee, political, and conflict choices', () => {
    expect(
      selectCoMigrationPerson([
        { id: 1, personId: 12, baseUtility: 10, relationshipDecisionInfluence: 0 },
        { id: 2, personId: 13, baseUtility: 9, relationshipDecisionInfluence: 4 },
      ]),
    ).toBe(13);
    expect(
      selectRefugeeSupportSettlement([
        { id: 1, settlementId: 1, baseUtility: 10, relationshipDecisionInfluence: 0 },
        { id: 2, settlementId: 5, baseUtility: 9, relationshipDecisionInfluence: 4 },
      ]),
    ).toBe(5);
    expect(
      selectPoliticalSupportCivilization([
        { id: 1, civilizationId: 2, baseUtility: 10, relationshipDecisionInfluence: 0 },
        { id: 2, civilizationId: 6, baseUtility: 9, relationshipDecisionInfluence: 4 },
      ]),
    ).toBe(6);
    expect(
      selectConflictTargetCivilization([
        { id: 1, civilizationId: 2, baseUtility: 10, relationshipDecisionInfluence: 0 },
        { id: 2, civilizationId: 6, baseUtility: 9, relationshipDecisionInfluence: -10 },
      ]),
    ).toBe(2);
  });
});
