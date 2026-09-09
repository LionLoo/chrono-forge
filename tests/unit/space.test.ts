import { describe, expect, it } from 'vitest';

import {
  FIRST_OFFWORLD_RESIDENT_ID,
  MAX_OFFWORLD_RESIDENTS,
  MAX_PENDING_COMMUNICATIONS,
  advanceSpace,
  assertSpaceInvariants,
  createInitialSpace,
  spaceDto,
  type AlienCivilization,
  type SpaceContext,
  type SpaceState,
} from '../../src/simulation/space';

const SEED = [7, 11, 13, 17] as const;

function context(tick: number, overrides: Partial<SpaceContext> = {}): SpaceContext {
  return Object.freeze({
    tick,
    knownKnowledge: Object.freeze(['advanced-energy', 'planetary-engineering', 'spaceflight']),
    activeCivilizations: Object.freeze([
      Object.freeze({
        id: 1,
        launchSettlementId: 10,
        cultureId: 2,
        institutionCount: 2,
        scarcity: 0,
        stability: 80,
        infrastructure: 100,
        storedMaterial: 100,
        energyCapacity: 100,
        engineeringCapacity: 100,
        interSettlementExchange: 100,
        surfaceReserves: Object.freeze({
          food: 100,
          water: 100,
          timber: 100,
          stone: 100,
          metal: 100,
        }),
      }),
    ]),
    surfaceSettlementOwners: Object.freeze([
      Object.freeze({ settlementId: 10, civilizationId: 1 }),
    ]),
    eligibleUnsalientResidents: Object.freeze([
      Object.freeze({ residentId: 101, settlementId: 10, civilizationId: 1 }),
      Object.freeze({ residentId: 102, settlementId: 10, civilizationId: 1 }),
      Object.freeze({ residentId: 103, settlementId: 10, civilizationId: 1 }),
      Object.freeze({ residentId: 104, settlementId: 10, civilizationId: 1 }),
    ]),
    recentAlienSignalPressure: 0,
    terrestrialDiplomacyPressure: 0,
    ...overrides,
  });
}

function advanceToColony(): SpaceState {
  let state = createInitialSpace(SEED, 0);
  for (let tick = 1; tick <= 40 && state.colonies.length === 0; tick += 1)
    state = advanceSpace(state, context(tick)).state;
  expect(state.colonies).toHaveLength(1);
  return state;
}

function withAlienTrait(state: SpaceState, trait: AlienCivilization['trait']): SpaceState {
  return Object.freeze({
    ...state,
    aliens: Object.freeze(state.aliens.map((alien) => Object.freeze({ ...alien, trait }))),
  });
}

describe('M9 pure space authority', () => {
  it('is seed-deterministic and creates only uncontacted generated records', () => {
    const first = createInitialSpace(SEED, 0);
    expect(spaceDto(first)).toStrictEqual(spaceDto(createInitialSpace(SEED, 0)));
    expect(
      first.bodies.every(
        (body) => JSON.stringify(body.originalDeposit) === JSON.stringify(body.remainingDeposit),
      ),
    ).toBe(true);
    expect(first.aliens.every((alien) => alien.discoveredTick === null)).toBe(true);
  });

  it('requires staged capability and sends orbital missions without passengers', () => {
    const initial = createInitialSpace(SEED, 0);
    expect(
      advanceSpace(initial, context(1, { knownKnowledge: Object.freeze(['spaceflight']) })).state
        .programs,
    ).toHaveLength(0);
    let state = initial;
    state = advanceSpace(state, context(1)).state;
    expect(state.programs[0]).toMatchObject({ stage: 'advanced-energy', launchCapacity: 0 });
    state = advanceSpace(state, context(2)).state;
    expect(state.programs[0]).toMatchObject({ stage: 'planetary-engineering', launchCapacity: 0 });
    const launched = advanceSpace(state, context(3));
    expect(launched.state.programs[0]?.stage).toBe('spaceflight');
    expect(launched.state.programs[0]?.planetaryTransportCapacity).toBeGreaterThan(0);
    expect(launched.state.programs[0]?.launchCapacity).toBeGreaterThan(0);
    expect(launched.state.missions[0]).toMatchObject({ kind: 'orbital', passengerIds: [] });
    expect(launched.surfacePopulationDeltas).toEqual([]);
    expect(launched.surfaceResourceDeltas[0]).toMatchObject({
      civilizationId: 1,
      settlementId: 10,
      resources: { metal: -1 },
    });
  });

  it('moves only matching candidate provenance into a colony and preserves a historical manifest', () => {
    const state = advanceToColony();
    expect(state.colonies[0]).toMatchObject({
      civilizationId: 1,
      settlementId: 10,
      cultureId: 2,
      residentIds: [101, 102, 9_000_000_000],
    });
    const mission = state.missions.find(
      (item) => item.kind === 'colony' && item.status === 'completed',
    )!;
    expect(mission.passengerIds).toEqual([]);
    expect(mission.manifestPassengerIds).toEqual([101, 102]);
    assertSpaceInvariants(state);
  });

  it('stops new offworld growth at 25,000 rather than throwing', () => {
    const state = advanceToColony();
    const colony = state.colonies[0]!;
    const activePassengers = state.missions
      .filter((mission) => mission.status === 'active')
      .flatMap((mission) => mission.passengerIds);
    const residents = Array.from(
      { length: MAX_OFFWORLD_RESIDENTS - activePassengers.length },
      (_, index) => FIRST_OFFWORLD_RESIDENT_ID + index,
    );
    const colonies = Array.from({ length: 7 }, (_, index) =>
      Object.freeze({
        ...colony,
        id: index === 0 ? colony.id : 100 + index,
        stores:
          index === 0
            ? colony.stores
            : Object.freeze({ food: 0, water: 0, timber: 0, stone: 0, metal: 0 }),
        residentIds: Object.freeze(residents.slice(index * 3_572, (index + 1) * 3_572)),
      }),
    );
    const capped = Object.freeze({
      ...state,
      nextOffworldResidentId: FIRST_OFFWORLD_RESIDENT_ID + residents.length,
      nextSpaceId: 200,
      colonies: Object.freeze(colonies),
    });
    assertSpaceInvariants(capped);
    expect(() => advanceSpace(capped, context(capped.tick + 1))).not.toThrow();
  });

  it('returns source-scoped signed patches and maintains the resource ledger', () => {
    const state = advanceToColony();
    const result = advanceSpace(state, context(state.tick + 1));
    expect(
      result.surfaceResourceDeltas.every(
        (patch) => patch.civilizationId === 1 && patch.settlementId === 10,
      ),
    ).toBe(true);
    expect(result.surfaceResourceDeltas.some((patch) => patch.resources.food < 0)).toBe(true);
    assertSpaceInvariants(result.state);
  });

  it('creates delayed two-way cargo and communication', () => {
    let state = advanceToColony();
    state = advanceSpace(state, context(state.tick + 1)).state;
    expect(
      state.cargoTransfers.some(
        (item) => item.origin.kind === 'colony' && item.destination.kind === 'settlement',
      ),
    ).toBe(true);
    const due = Math.min(
      ...state.communications
        .filter((item) => item.status === 'pending')
        .map((item) => item.dueTick),
    );
    state = advanceSpace(state, context(due)).state;
    expect(state.communications.some((item) => item.status === 'delivered')).toBe(true);
    expect(state.communications.some((item) => item.topic === 'reply')).toBe(true);
  });

  it('records stale return cargo as lost after surface ownership changes', () => {
    let state = advanceToColony();
    state = advanceSpace(state, context(state.tick + 1)).state;
    const staleReturn = state.cargoTransfers.find(
      (transfer) => transfer.status === 'active' && transfer.destination.kind === 'settlement',
    );
    expect(staleReturn).toBeDefined();

    const result = advanceSpace(
      state,
      context(staleReturn!.dueTick, {
        surfaceSettlementOwners: Object.freeze([
          Object.freeze({ settlementId: 10, civilizationId: 2 }),
        ]),
      }),
    );

    expect(
      result.state.cargoTransfers.find((transfer) => transfer.id === staleReturn!.id)?.status,
    ).toBe('lost');
    expect(result.events.some((event) => event.kind === 'cargo-lost')).toBe(true);
    expect(
      result.surfaceResourceDeltas.some(
        (patch) =>
          patch.civilizationId === 1 && patch.settlementId === 10 && patch.resources.metal > 0,
      ),
    ).toBe(false);
    assertSpaceInvariants(result.state);
  });

  it('completes then abandons an in-flight colony safely after its civilization collapses', () => {
    let state = createInitialSpace(SEED, 0);
    let colonyMission = state.missions.find(
      (mission) => mission.kind === 'colony' && mission.status === 'active',
    );
    for (let tick = 1; tick <= 40 && colonyMission === undefined; tick += 1) {
      state = advanceSpace(state, context(tick)).state;
      colonyMission = state.missions.find(
        (mission) => mission.kind === 'colony' && mission.status === 'active',
      );
    }
    expect(colonyMission).toBeDefined();

    const result = advanceSpace(
      state,
      context(colonyMission!.dueTick, {
        activeCivilizations: Object.freeze([]),
        surfaceSettlementOwners: Object.freeze([]),
        eligibleUnsalientResidents: Object.freeze([]),
      }),
    );

    expect(result.state.colonies).toContainEqual(
      expect.objectContaining({ civilizationId: 1, status: 'abandoned' }),
    );
    expect(result.events.some((event) => event.kind === 'colony-abandoned')).toBe(true);
    expect(
      result.state.relations.every((relation) =>
        result.state.aliens.some(
          (alien) => alien.id === relation.alienId && alien.discoveredTick !== null,
        ),
      ),
    ).toBe(true);
    assertSpaceInvariants(result.state);
  });

  it('resolves due work in stable order, respects the delivery quota, and retains overflow', () => {
    const initial = createInitialSpace(SEED, 0);
    const queued = Object.freeze({
      ...initial,
      nextSpaceId: MAX_PENDING_COMMUNICATIONS + 1,
      communications: Object.freeze(
        Array.from({ length: MAX_PENDING_COMMUNICATIONS }, (_, index) =>
          Object.freeze({
            id: index + 1,
            civilizationId: 1,
            originBodyId: 1,
            destinationBodyId: 2,
            sentTick: 0,
            dueTick: 1,
            status: 'pending' as const,
            topic: 'reply' as const,
            replyToId: null,
          }),
        ),
      ),
    });
    assertSpaceInvariants(queued);

    const result = advanceSpace(
      queued,
      context(1, {
        knownKnowledge: Object.freeze([]),
        activeCivilizations: Object.freeze([]),
        eligibleUnsalientResidents: Object.freeze([]),
      }),
    );

    expect(
      result.state.communications
        .filter((message) => message.status === 'delivered')
        .map((message) => message.id),
    ).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(
      result.state.communications
        .filter((message) => message.status === 'pending')
        .map((message) => message.id),
    ).toStrictEqual(
      Array.from({ length: MAX_PENDING_COMMUNICATIONS - 8 }, (_, index) => index + 9),
    );
    expect(result.events).toHaveLength(8);
    expect(result.state.operationCount - queued.operationCount).toBe(8);
    assertSpaceInvariants(result.state);
  });

  it('takes cooperative exchange, hostile consequence, then recovery paths from context', () => {
    const cooperative = withAlienTrait(advanceToColony(), 'curious');
    const allied = advanceSpace(cooperative, context(cooperative.tick + 1));
    expect(
      allied.state.relations.some(
        (relation) => relation.status === 'allied' || relation.status === 'cooperative',
      ),
    ).toBe(true);
    const hostile = advanceSpace(
      allied.state,
      context(allied.state.tick + 1, {
        recentAlienSignalPressure: 100,
        terrestrialDiplomacyPressure: 100,
      }),
    );
    expect(hostile.state.relations.some((relation) => relation.status === 'hostile')).toBe(true);
    const recovered = advanceSpace(
      withAlienTrait(hostile.state, 'curious'),
      context(hostile.state.tick + 2),
    );
    expect(
      recovered.state.relations.some(
        (relation) => relation.status === 'allied' || relation.status === 'cooperative',
      ),
    ).toBe(true);
  });

  it('rejects malformed context/state and keeps canonical DTO repeatable', () => {
    const initial = createInitialSpace(SEED, 0);
    expect(() =>
      advanceSpace(
        initial,
        context(1, {
          eligibleUnsalientResidents: Object.freeze([
            { residentId: 101, settlementId: 10, civilizationId: 1 },
            { residentId: 101, settlementId: 10, civilizationId: 1 },
          ]),
        }),
      ),
    ).toThrow('provenance');
    expect(() =>
      advanceSpace(
        initial,
        context(1, {
          activeCivilizations: Object.freeze([
            Object.freeze({ ...context(1).activeCivilizations[0]!, infrastructure: NaN }),
          ]),
        }),
      ),
    ).toThrow('Infrastructure');
    const state = advanceToColony();
    expect(() =>
      assertSpaceInvariants(Object.freeze({ ...state, nextOffworldResidentId: 1 })),
    ).toThrow('allocator');
    expect(() => assertSpaceInvariants(Object.freeze({ ...initial, operationCount: -1 }))).toThrow(
      'operation count',
    );
    expect(() =>
      assertSpaceInvariants(
        Object.freeze({
          ...initial,
          nextSpaceId: 2,
          relations: Object.freeze([
            Object.freeze({
              id: 1,
              civilizationId: 1,
              alienId: initial.aliens[0]!.id,
              status: 'cooperative' as const,
              trust: 60,
              tension: 25,
              changedTick: 0,
              lastInteractionTick: 0,
              exchangeCount: 0,
              conflictCount: 0,
            }),
          ]),
        }),
      ),
    ).toThrow('Relation');
    expect(() =>
      assertSpaceInvariants(
        Object.freeze({
          ...initial,
          nextSpaceId: 2,
          communications: Object.freeze([
            Object.freeze({
              id: 1,
              civilizationId: 1,
              originBodyId: 1,
              destinationBodyId: 2,
              sentTick: 0,
              dueTick: 0,
              status: 'pending' as const,
              topic: 'reply' as const,
              replyToId: null,
            }),
          ]),
        }),
      ),
    ).toThrow('Communication');
    expect(spaceDto(state)).toStrictEqual(spaceDto(state));
  });
});
