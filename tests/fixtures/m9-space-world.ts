import { KNOWLEDGE_DEFINITIONS, type DevelopmentState } from '../../src/simulation/development';
import { ACCELERATED_YEAR_TICKS } from '../../src/simulation/society';
import {
  assertWorldInvariants,
  createInitialWorld,
  reconcileWorldPopulationAuthority,
  type WorldState,
} from '../../src/simulation/world';

const M9_FIXTURE_SEED = Object.freeze([7, 11, 13, 17] as const);
const M9_FIXTURE_RESERVES = Object.freeze({
  food: 500,
  water: 500,
  timber: 300,
  stone: 300,
  metal: 300,
});

function matureDevelopment(state: DevelopmentState): DevelopmentState {
  return Object.freeze({
    ...state,
    knowledge: Object.freeze(
      state.knowledge.map((record, index) => {
        const definition = KNOWLEDGE_DEFINITIONS[index]!;
        if (record.evidence?.kind === 'founding') return record;
        return Object.freeze({
          ...record,
          status: 'known' as const,
          progress: definition.discoveryThreshold,
          discoveredTick: state.tick,
          lostTick: null,
          recoveredTick: null,
          evidence: Object.freeze({
            kind: 'discovery' as const,
            tick: state.tick,
            prerequisiteIds: Object.freeze([...definition.prerequisites]),
            requirements: Object.freeze(
              definition.context.map((requirement) =>
                Object.freeze({ ...requirement, value: requirement.minimum }),
              ),
            ),
          }),
        });
      }),
    ),
  });
}

/** A small deterministic terrestrial world that satisfies M9's launch preconditions. */
export function createM9MatureWorld(): WorldState {
  const initial = createInitialWorld(M9_FIXTURE_SEED, {
    width: 12,
    height: 8,
    chunkSize: 4,
    societyYearTicks: ACCELERATED_YEAR_TICKS,
  });
  const primary = initial.civilizations.settlements[0]!;
  const civilization = initial.civilizations.civilizations[0]!;
  const secondSettlementId = initial.civilizations.nextEntityId;
  const routeId = secondSettlementId + 1;
  const tileOwners = [...initial.civilizations.tileOwners];
  const secondCenter = tileOwners.findIndex(
    (owner, index) => owner === 0 && index !== primary.centerTileIndex,
  );
  if (secondCenter < 0) throw new Error('M9 fixture requires an unclaimed tile.');
  tileOwners[secondCenter] = secondSettlementId;
  const civilizations = Object.freeze({
    ...initial.civilizations,
    nextEntityId: routeId + 1,
    settlements: Object.freeze([
      Object.freeze({
        ...primary,
        population: 50,
        stability: 90,
        reserves: M9_FIXTURE_RESERVES,
      }),
      Object.freeze({
        id: secondSettlementId,
        civilizationId: civilization.id,
        name: 'Far Harbor',
        cultureId: primary.cultureId,
        centerTileIndex: secondCenter,
        status: 'active' as const,
        population: 10,
        stability: 90,
        reserves: M9_FIXTURE_RESERVES,
        territoryHistory: Object.freeze([]),
        territoryHistorySummaryCount: 0,
        foundedTick: 0,
        endedTick: null,
        provenance: 'initial' as const,
      }),
    ]),
    civilizations: Object.freeze([
      Object.freeze({
        ...civilization,
        memberSettlementIds: Object.freeze([primary.id, secondSettlementId]),
      }),
    ]),
    routes: Object.freeze([
      Object.freeze({
        id: routeId,
        firstSettlementId: primary.id,
        secondSettlementId,
        status: 'active' as const,
        volume: 30,
        startedTick: 0,
        endedTick: null,
      }),
    ]),
    tileOwners: Object.freeze(tileOwners),
  });
  const prepared = Object.freeze({
    ...initial,
    civilization: Object.freeze({
      ...initial.civilization,
      stockpile: Object.freeze({ food: 500, water: 500, timber: 300, stone: 300 }),
    }),
    civilizations,
    development: matureDevelopment(initial.development),
  });
  const reconciled = reconcileWorldPopulationAuthority(prepared);
  assertWorldInvariants(reconciled);
  return reconciled;
}
