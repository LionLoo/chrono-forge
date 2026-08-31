import { describe, expect, it } from 'vitest';

import {
  DISASTER_KINDS,
  KNOWLEDGE_DEFINITIONS,
  advanceDevelopment,
  assertDevelopmentInvariants,
  createInitialDevelopment,
  queueIntervention,
  type DevelopmentContext,
  type DevelopmentState,
  type DisasterKind,
} from '../../src/simulation/development';
import {
  admitActiveRelationship,
  createInitialInterpersonalState,
  type ActiveRelationship,
  type InterpersonalState,
} from '../../src/simulation/relationships';

const YEAR = 5_000;

function people() {
  return Object.freeze(
    [1, 2, 3, 4, 5, 6].map((id) =>
      Object.freeze({
        id,
        alive: true,
        health: id === 3 || id === 5 ? 35 : 90,
        tileIndex: 20 + id,
        householdId: id,
        traits: Object.freeze([55, 50, 45, 60] as const),
        skills: Object.freeze(
          (id === 1 ? [85, 75, 70, 80] : [35, 30, 30, 35]) as readonly [
            number,
            number,
            number,
            number,
          ],
        ),
      }),
    ),
  );
}

function interpersonal(): InterpersonalState {
  return createInitialInterpersonalState(
    [101, 103, 107, 109],
    0,
    people().map((person) => ({
      id: person.id,
      alive: person.alive,
      birthTick: -25 * YEAR,
      parentIds: [],
      householdId: person.householdId,
    })),
  );
}

function relationship(
  id: number,
  firstPersonId: number,
  secondPersonId: number,
): ActiveRelationship {
  const [first, second] = [firstPersonId, secondPersonId].sort((left, right) => left - right);
  return Object.freeze({
    id,
    firstPersonId: first!,
    secondPersonId: second!,
    firstRole: 'peer',
    secondRole: 'peer',
    kind: 'close-friend',
    formedTick: 0,
    changedTick: 0,
    lastInteractionTick: 0,
    observedSinceTick: 0,
    trend: 'stable',
    firstToSecond: Object.freeze({
      affinity: 100,
      trust: 100,
      closeness: 100,
      commitment: 75,
      grievance: 0,
    }),
    secondToFirst: Object.freeze({
      affinity: 100,
      trust: 100,
      closeness: 100,
      commitment: 75,
      grievance: 0,
    }),
    sharedEvents: Object.freeze([]),
    rng: Object.freeze([id, id + 1, id + 2, id + 3] as const),
    legacySocietyCounters: null,
  });
}

function withRelationship(recipientId: 3 | 5): InterpersonalState {
  const current = interpersonal();
  return admitActiveRelationship(
    current,
    people().map((person) => ({
      id: person.id,
      alive: person.alive,
      birthTick: -25 * YEAR,
      parentIds: [],
      householdId: person.householdId,
    })),
    relationship(1, 1, recipientId),
  );
}

function context(tick = YEAR, overrides: Partial<DevelopmentContext> = {}): DevelopmentContext {
  return Object.freeze({
    tick,
    yearTicks: YEAR,
    worldWidth: 16,
    worldHeight: 16,
    centerTileIndex: 24,
    people: people(),
    interpersonal: interpersonal(),
    stockpile: Object.freeze({ food: 80, water: 80, timber: 40, stone: 40, metal: 20 }),
    operationalStructures: 4,
    damagedStructures: 0,
    tradeVolume: 8,
    institutionCount: 1,
    stability: 75,
    scarcity: 20,
    inequality: 10,
    collapsed: false,
    conflictEvents: 0,
    terrain: Object.freeze({
      dryLandRatio: 35,
      floodExposure: 35,
      forestRatio: 35,
      stormExposure: 35,
      seismicity: 35,
      resourceDepletion: 10,
    }),
    ...overrides,
  });
}

function withCondition(
  state: DevelopmentState,
  kind: DisasterKind,
  amount = 100,
): DevelopmentState {
  const condition = DISASTER_KINDS.find((candidate) => candidate.kind === kind)?.condition;
  if (condition === undefined) throw new Error(`Missing condition mapping for ${kind}.`);
  return Object.freeze({
    ...state,
    conditions: Object.freeze({ ...state.conditions, [condition]: amount }),
  });
}

describe('M5 contextual development authority', () => {
  it('starts with only explicit founding knowledge and valid bounded authority', () => {
    const state = createInitialDevelopment([7, 11, 13, 17], 0);

    assertDevelopmentInvariants(state);
    expect(
      state.knowledge.filter((record) => record.status === 'known').map((record) => record.id),
    ).toStrictEqual(['foraging-lore', 'shelter-craft', 'water-lore']);
    expect(state.activeCrises).toHaveLength(0);
    expect(state.pendingInterventions).toHaveLength(0);
  });

  it('never discovers a node while a required knowledge or contextual condition is absent', () => {
    const initial = createInitialDevelopment([7, 11, 13, 17], 0);
    const metallurgy = KNOWLEDGE_DEFINITIONS.find((definition) => definition.id === 'metallurgy')!;
    const primed = Object.freeze({
      ...initial,
      knowledge: Object.freeze(
        initial.knowledge.map((record) =>
          record.id === metallurgy.id
            ? Object.freeze({ ...record, progress: metallurgy.discoveryThreshold - 1 })
            : record,
        ),
      ),
    });

    const result = advanceDevelopment(
      primed,
      context(YEAR, {
        stockpile: Object.freeze({ food: 100, water: 100, timber: 100, stone: 100, metal: 100 }),
      }),
    );

    expect(result.state.knowledge.find((record) => record.id === metallurgy.id)?.status).toBe(
      'unknown',
    );
    expect(result.events.some((event) => event.kind === 'knowledge-discovered')).toBe(false);
  });

  it('changes discovery priorities when materials, pressure, skills, and trade context change', () => {
    const seed = [19, 23, 29, 31] as const;
    const waterContext = context(YEAR, {
      stockpile: Object.freeze({ food: 20, water: 20, timber: 80, stone: 5, metal: 0 }),
      scarcity: 70,
      terrain: Object.freeze({
        dryLandRatio: 80,
        floodExposure: 10,
        forestRatio: 60,
        stormExposure: 20,
        seismicity: 10,
        resourceDepletion: 5,
      }),
    });
    const materialContext = context(YEAR, {
      stockpile: Object.freeze({ food: 80, water: 80, timber: 20, stone: 100, metal: 100 }),
      scarcity: 0,
      tradeVolume: 40,
      terrain: Object.freeze({
        dryLandRatio: 20,
        floodExposure: 20,
        forestRatio: 20,
        stormExposure: 20,
        seismicity: 60,
        resourceDepletion: 20,
      }),
    });

    const water = advanceDevelopment(createInitialDevelopment(seed, 0), waterContext);
    const material = advanceDevelopment(createInitialDevelopment(seed, 0), materialContext);

    expect(water.state.researchFocusId).not.toBe(material.state.researchFocusId);
    expect(water.state.researchFocusId).toBe('water-management');
    expect(material.state.researchFocusId).toBe('stonecraft');
  });

  it('persists exact prerequisite and contextual evidence for a valid discovery', () => {
    let state = createInitialDevelopment([19, 23, 29, 31], 0);
    const material = {
      stockpile: Object.freeze({ food: 80, water: 80, timber: 30, stone: 100, metal: 40 }),
      scarcity: 0,
      terrain: Object.freeze({
        dryLandRatio: 20,
        floodExposure: 20,
        forestRatio: 20,
        stormExposure: 20,
        seismicity: 60,
        resourceDepletion: 20,
      }),
    } as const;
    for (let year = 1; year <= 4; year += 1)
      state = advanceDevelopment(state, context(year * YEAR, material)).state;

    const stonecraft = state.knowledge.find((record) => record.id === 'stonecraft')!;
    expect(stonecraft.status).toBe('known');
    expect(stonecraft.evidence).toStrictEqual({
      kind: 'discovery',
      tick: YEAR * 4,
      prerequisiteIds: ['shelter-craft'],
      requirements: [{ kind: 'stockpile', id: 'stone', minimum: 30, value: 100 }],
    });
  });

  it('lets recorded conflict and accident pressure accelerate relevant experimentation', () => {
    const initial = createInitialDevelopment([23, 29, 31, 37], 0);
    const prepared: DevelopmentState = Object.freeze({
      ...initial,
      tick: YEAR,
      knowledge: Object.freeze(
        initial.knowledge.map((record) => {
          if (record.id !== 'stonecraft' && record.id !== 'kiln-craft') return record;
          return Object.freeze({
            ...record,
            status: 'known' as const,
            progress: KNOWLEDGE_DEFINITIONS.find((definition) => definition.id === record.id)!
              .discoveryThreshold,
            discoveredTick: YEAR,
            evidence: Object.freeze({
              kind: 'discovery' as const,
              tick: YEAR,
              prerequisiteIds: Object.freeze(
                record.id === 'stonecraft' ? ['shelter-craft' as const] : ['stonecraft' as const],
              ),
              requirements: Object.freeze([
                Object.freeze({
                  kind: 'stockpile' as const,
                  id: record.id === 'stonecraft' ? 'stone' : 'timber',
                  minimum: record.id === 'stonecraft' ? 30 : 25,
                  value: 100,
                }),
              ]),
            }),
          });
        }),
      ),
    });
    const pressured = Object.freeze({
      ...prepared,
      conditions: Object.freeze({ ...prepared.conditions, accidentPressure: 100 }),
    });
    const material = {
      stockpile: Object.freeze({ food: 80, water: 80, timber: 100, stone: 100, metal: 100 }),
      scarcity: 0,
    } as const;

    const ordinary = advanceDevelopment(prepared, context(YEAR * 2, material));
    const experimental = advanceDevelopment(
      pressured,
      context(YEAR * 2, { ...material, conflictEvents: 4 }),
    );

    expect(ordinary.state.researchFocusId).toBe('metallurgy');
    expect(experimental.state.researchFocusId).toBe('metallurgy');
    expect(
      experimental.state.knowledge.find((record) => record.id === 'metallurgy')!.progress,
    ).toBeGreaterThan(
      ordinary.state.knowledge.find((record) => record.id === 'metallurgy')!.progress,
    );
  });

  it('can lose non-founding knowledge under modeled collapse pressure and recover it over later pulses', () => {
    let state = createInitialDevelopment([19, 23, 29, 31], 0);
    const material = {
      stockpile: Object.freeze({ food: 80, water: 80, timber: 30, stone: 100, metal: 40 }),
      scarcity: 0,
    } as const;
    for (let year = 1; year <= 4; year += 1)
      state = advanceDevelopment(state, context(year * YEAR, material)).state;
    state = Object.freeze({
      ...state,
      conditions: Object.freeze({ ...state.conditions, politicalPressure: 100 }),
    });

    let lostAt = 0;
    for (let year = 5; year <= 28; year += 1) {
      const result = advanceDevelopment(
        state,
        context(year * YEAR, { ...material, stability: 0, inequality: 100 }),
      );
      state = result.state;
      if (result.events.some((event) => event.kind === 'knowledge-lost')) {
        lostAt = year;
        break;
      }
    }
    expect(lostAt).toBeGreaterThan(0);
    expect(state.knowledge.find((record) => record.id === 'stonecraft')?.status).toBe('lost');

    state = Object.freeze({
      ...state,
      conditions: Object.freeze({ ...state.conditions, politicalPressure: 0 }),
    });
    const recoveryEvents: string[] = [];
    for (let year = lostAt + 1; year <= lostAt + 6; year += 1) {
      const result = advanceDevelopment(
        state,
        context(year * YEAR, { ...material, stability: 100, inequality: 0 }),
      );
      state = result.state;
      recoveryEvents.push(...result.events.map((event) => event.kind));
      if (recoveryEvents.includes('knowledge-recovered')) break;
    }
    expect(recoveryEvents).toContain('knowledge-recovered');
    expect(state.knowledge.find((record) => record.id === 'stonecraft')).toMatchObject({
      status: 'known',
      evidence: { kind: 'recovery' },
    });
  });

  it.each(DISASTER_KINDS)(
    'starts $kind only from its persisted modeled $condition pressure and emits bounded effects',
    ({ kind, condition }) => {
      const initial = withCondition(createInitialDevelopment([37, 41, 43, 47], 0), kind);
      const result = advanceDevelopment(initial, context());

      const started = result.state.activeCrises.find((crisis) => crisis.kind === kind);
      expect(started).toBeDefined();
      expect(started?.triggerCondition).toBe(condition);
      expect(started?.triggerValue).toBeGreaterThanOrEqual(80);
      expect(result.events).toContainEqual(
        expect.objectContaining({ kind: `${kind}-started`, subjectKind: 'world' }),
      );
      expect(
        result.effects.stockpileLoss.food +
          result.effects.stockpileLoss.water +
          result.effects.stockpileLoss.timber +
          result.effects.stockpileLoss.stone +
          result.effects.personHealthDamage.reduce((total, patch) => total + patch.amount, 0) +
          result.effects.structureDamage,
      ).toBeGreaterThan(0);
      assertDevelopmentInvariants(result.state);
    },
  );

  it('queues closed typed interventions that change conditions without directly selecting an outcome', () => {
    const initial = createInitialDevelopment([53, 59, 61, 67], 0);
    const queued = queueIntervention(initial, {
      kind: 'weather',
      intensity: 30,
      polarity: 'challenging',
      targetTileIndex: 24,
      requestedTick: 0,
    });

    expect(queued.activeCrises).toHaveLength(0);
    expect(queued.pendingInterventions).toHaveLength(1);
    const result = advanceDevelopment(queued, context());
    expect(result.state.pendingInterventions).toHaveLength(0);
    expect(result.events).toContainEqual(expect.objectContaining({ kind: 'weather-intervened' }));
    expect(result.state.conditions).not.toStrictEqual(initial.conditions);
  });

  it('uses the existing salient relationship to choose crisis care and records a bond experience', () => {
    const crisis = withCondition(createInitialDevelopment([37, 41, 43, 47], 0), 'disease');
    const toThree = advanceDevelopment(
      crisis,
      context(YEAR, { interpersonal: withRelationship(3) }),
    );
    const toFive = advanceDevelopment(
      crisis,
      context(YEAR, { interpersonal: withRelationship(5) }),
    );

    expect(toThree.responses[0]).toEqual(
      expect.objectContaining({ helperPersonId: 1, recipientPersonId: 3 }),
    );
    expect(toFive.responses[0]).toEqual(
      expect.objectContaining({ helperPersonId: 1, recipientPersonId: 5 }),
    );
    expect(toThree.relationshipExperiences).toContainEqual(
      expect.objectContaining({ firstPersonId: 1, secondPersonId: 3, kind: 'crisis-assistance' }),
    );
    expect(toThree.relationshipExperiences).toContainEqual(
      expect.objectContaining({ firstPersonId: 1, secondPersonId: 3, kind: 'shared-trauma' }),
    );

    const healthyResponse = advanceDevelopment(
      crisis,
      context(YEAR, {
        interpersonal: withRelationship(3),
        people: Object.freeze(people().map((person) => Object.freeze({ ...person, health: 100 }))),
      }),
    );
    expect(
      new Set([
        healthyResponse.responses[0]?.helperPersonId,
        healthyResponse.responses[0]?.recipientPersonId,
      ]),
    ).toEqual(new Set([1, 3]));

    const protectedResponse = advanceDevelopment(
      withCondition(createInitialDevelopment([37, 41, 43, 47], 0), 'fire'),
      context(YEAR, { interpersonal: withRelationship(3) }),
    );
    expect(protectedResponse.responses[0]).toMatchObject({
      kind: 'protection',
      helperPersonId: 1,
      recipientPersonId: 3,
    });
  });

  it('can generate a rare meteor impact autonomously through controlled development RNG', () => {
    let state = createInitialDevelopment([61, 67, 71, 73], 0);
    let meteorEvent = false;
    for (let year = 1; year <= 4_096 && !meteorEvent; year += 1) {
      const result = advanceDevelopment(
        state,
        context(year * YEAR, {
          scarcity: 0,
          stability: 100,
          inequality: 0,
          terrain: Object.freeze({
            dryLandRatio: 0,
            floodExposure: 0,
            forestRatio: 0,
            stormExposure: 0,
            seismicity: 0,
            resourceDepletion: 0,
          }),
        }),
      );
      state = result.state;
      meteorEvent = result.events.some((event) => event.kind === 'meteor-impact-started');
    }

    expect(meteorEvent).toBe(true);
    expect(state.activeCrises).toContainEqual(expect.objectContaining({ kind: 'meteor-impact' }));
  });

  it('keeps autonomous disaster timing independent from research randomness', () => {
    let baseline = createInitialDevelopment([61, 67, 71, 73], 0);
    let changedResearch: DevelopmentState = Object.freeze({
      ...baseline,
      rng: Object.freeze([101, 103, 107, 109] as const),
    });
    const baselineMeteorTicks: number[] = [];
    const changedMeteorTicks: number[] = [];
    for (let year = 1; year <= 1_024; year += 1) {
      const pulseContext = context(year * YEAR, {
        scarcity: 0,
        stability: 100,
        inequality: 0,
        terrain: Object.freeze({
          dryLandRatio: 0,
          floodExposure: 0,
          forestRatio: 0,
          stormExposure: 0,
          seismicity: 0,
          resourceDepletion: 0,
        }),
      });
      const first = advanceDevelopment(baseline, pulseContext);
      const second = advanceDevelopment(changedResearch, pulseContext);
      if (first.events.some((event) => event.kind === 'meteor-impact-started'))
        baselineMeteorTicks.push(year * YEAR);
      if (second.events.some((event) => event.kind === 'meteor-impact-started'))
        changedMeteorTicks.push(year * YEAR);
      expect(second.state.disasterRng).toEqual(first.state.disasterRng);
      baseline = first.state;
      changedResearch = second.state;
    }

    expect(baselineMeteorTicks.length).toBeGreaterThan(0);
    expect(changedMeteorTicks).toEqual(baselineMeteorTicks);
  });

  it('retains every factual event when a bounded pulse exceeds the former sixteen-event limit', () => {
    const base = createInitialDevelopment([79, 83, 89, 97], 0);
    const active = [
      ['drought', 'droughtPressure'],
      ['earthquake', 'seismicPressure'],
      ['famine', 'faminePressure'],
      ['fire', 'firePressure'],
    ] as const;
    let state: DevelopmentState = Object.freeze({
      ...base,
      nextCrisisId: 5,
      knowledge: Object.freeze(
        base.knowledge.map((record) =>
          record.id === 'stonecraft' ? Object.freeze({ ...record, progress: 79 }) : record,
        ),
      ),
      conditions: Object.freeze({
        ...base.conditions,
        floodPressure: 100,
        stormPressure: 100,
        resourcePressure: 100,
        meteorPressure: 100,
      }),
      activeCrises: Object.freeze(
        active.map(([kind, triggerCondition], index) =>
          Object.freeze({
            id: index + 1,
            kind,
            triggerCondition,
            triggerValue: 100,
            triggerThreshold: 80,
            startedTick: 0,
            severity: 1,
          }),
        ),
      ),
    });
    for (const kind of [
      'weather',
      'resource',
      'organism',
      'omen',
      'artifact',
      'protection',
      'disaster',
      'alien-signal',
    ] as const)
      state = queueIntervention(state, {
        kind,
        intensity: 1,
        polarity: 'challenging',
        targetTileIndex: 24,
        requestedTick: 0,
      });

    const result = advanceDevelopment(
      state,
      context(YEAR, { scarcity: 0, stability: 100, inequality: 0 }),
    );

    expect(result.events.length).toBeGreaterThan(16);
    for (const crisis of result.state.activeCrises)
      expect(result.events.some((event) => event.crisisId === crisis.id)).toBe(true);
  });

  it('resolves a weakened crisis autonomously when protection and social capacity exceed pressure', () => {
    const started = advanceDevelopment(
      withCondition(createInitialDevelopment([37, 41, 43, 47], 0), 'storm'),
      context(),
    ).state;
    const protectedState = Object.freeze({
      ...started,
      conditions: Object.freeze({ ...started.conditions, stormPressure: 0, protection: 100 }),
      activeCrises: Object.freeze(
        started.activeCrises.map((crisis) => Object.freeze({ ...crisis, severity: 1 })),
      ),
    });
    const recovered = advanceDevelopment(
      protectedState,
      context(YEAR * 2, { stability: 100, scarcity: 0 }),
    );

    expect(recovered.state.activeCrises).toHaveLength(0);
    expect(recovered.state.crisisHistory).toContainEqual(
      expect.objectContaining({ kind: 'storm', outcome: 'recovered' }),
    );
    expect(recovered.events).toContainEqual(expect.objectContaining({ kind: 'storm-recovered' }));
  });
});
