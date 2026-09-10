import { CELESTIAL_NAME_STEMS } from '../content';
import { deriveXoshiro128State, Xoshiro128StarStar, type Xoshiro128State } from '../random';

/** M9's pure world-owned space authority. World applies every returned patch exactly once. */
export const MAX_SPACE_BODIES = 8;
export const MAX_SPACE_PROGRAMS = 8;
export const MAX_SPACECRAFT = 32;
export const MAX_ACTIVE_MISSIONS = 16;
export const MAX_COMPLETED_MISSIONS = 64;
export const MAX_COLONIES = 16;
export const MAX_ACTIVE_CARGO_TRANSFERS = 32;
export const MAX_COMPLETED_CARGO_TRANSFERS = 64;
export const MAX_PENDING_COMMUNICATIONS = 32;
export const MAX_DELIVERED_COMMUNICATIONS = 64;
export const MAX_ALIEN_CIVILIZATIONS = 4;
export const MAX_SPACE_RELATIONS = 32;
export const MAX_OFFWORLD_RESIDENTS = 25_000;
export const MAX_COLONY_RESIDENTS = 4_096;
export const MAX_SPACE_EVENTS_PER_PULSE = 32;
export const FIRST_OFFWORLD_RESIDENT_ID = 9_000_000_000;

const MAX_PROGRAMS_PER_PULSE = 8;
const MAX_LAUNCHES_PER_PULSE = 2;
const MAX_MISSION_ARRIVALS_PER_PULSE = 8;
const MAX_CARGO_ARRIVALS_PER_PULSE = 8;
const MAX_COMMUNICATION_DELIVERIES_PER_PULSE = 8;
const MAX_RELATIONS_PER_PULSE = 8;

export type SpaceResourceStock = Readonly<{
  food: number;
  water: number;
  timber: number;
  stone: number;
  metal: number;
}>;
export type SpaceProgramStage =
  'none' | 'advanced-energy' | 'planetary-engineering' | 'spaceflight';
export type SpaceMissionKind = 'orbital' | 'exploration' | 'colony';
export type SpaceMissionStatus = 'active' | 'completed' | 'failed';
export type SpacecraftStatus = 'grounded' | 'in-flight' | 'orbiting' | 'retired';
export type CargoTransferStatus = 'active' | 'completed' | 'lost';
export type CommunicationStatus = 'pending' | 'delivered';
export type AlienRelationStatus = 'unknown' | 'allied' | 'cooperative' | 'competitive' | 'hostile';
export type SpaceReferentKind =
  | 'celestial-body'
  | 'space-program'
  | 'spacecraft'
  | 'space-colony'
  | 'alien-civilization'
  | 'civilization'
  | 'settlement';

export interface CelestialBody {
  readonly id: number;
  readonly kind: 'home' | 'moon' | 'planet' | 'asteroid';
  readonly name: string;
  readonly distance: number;
  readonly habitable: boolean;
  readonly originalDeposit: SpaceResourceStock;
  readonly remainingDeposit: SpaceResourceStock;
}
export interface CivilizationSpaceProgram {
  readonly id: number;
  readonly civilizationId: number;
  readonly settlementId: number;
  readonly cultureId: number;
  readonly stage: SpaceProgramStage;
  readonly startedTick: number;
  readonly updatedTick: number;
  readonly planetaryTransportCapacity: number;
  readonly launchCapacity: number;
}
export interface Spacecraft {
  readonly id: number;
  readonly civilizationId: number;
  readonly settlementId: number;
  readonly status: SpacecraftStatus;
  readonly currentBodyId: number;
  readonly missionId: number | null;
  readonly launchedTick: number | null;
}
export interface SpaceMission {
  readonly id: number;
  readonly spacecraftId: number;
  readonly civilizationId: number;
  readonly settlementId: number;
  readonly cultureId: number;
  readonly kind: SpaceMissionKind;
  readonly originBodyId: number;
  readonly destinationBodyId: number;
  readonly departureTick: number;
  readonly dueTick: number;
  readonly status: SpaceMissionStatus;
  readonly completedTick: number | null;
  readonly passengerIds: readonly number[];
  readonly manifestPassengerIds: readonly number[];
  readonly cargo: SpaceResourceStock;
  readonly manifestCargo: SpaceResourceStock;
}
export interface SpaceColony {
  readonly id: number;
  readonly civilizationId: number;
  readonly settlementId: number;
  readonly cultureId: number;
  readonly parentBodyId: number;
  readonly bodyId: number;
  readonly foundedTick: number;
  readonly cultureDivergence: number;
  readonly residentIds: readonly number[];
  readonly stores: SpaceResourceStock;
  readonly status: 'active' | 'abandoned';
}
export type CargoEndpoint =
  | Readonly<{
      readonly kind: 'settlement';
      readonly civilizationId: number;
      readonly settlementId: number;
    }>
  | Readonly<{ readonly kind: 'colony'; readonly colonyId: number }>
  | Readonly<{ readonly kind: 'alien'; readonly alienId: number }>;
export interface CargoTransfer {
  readonly id: number;
  readonly civilizationId: number;
  readonly origin: CargoEndpoint;
  readonly destination: CargoEndpoint;
  readonly departureTick: number;
  readonly dueTick: number;
  readonly status: CargoTransferStatus;
  readonly cargo: SpaceResourceStock;
  readonly manifestCargo: SpaceResourceStock;
}
export interface DelayedCommunication {
  readonly id: number;
  readonly civilizationId: number;
  readonly originBodyId: number;
  readonly destinationBodyId: number;
  readonly sentTick: number;
  readonly dueTick: number;
  readonly status: CommunicationStatus;
  readonly topic: 'mission' | 'colony' | 'contact' | 'reply';
  readonly replyToId: number | null;
}
export interface AlienCivilization {
  readonly id: number;
  readonly homeBodyId: number;
  readonly trait: 'curious' | 'cautious' | 'competitive' | 'hostile';
  readonly discoveredTick: number | null;
}
export interface SpaceRelation {
  readonly id: number;
  readonly civilizationId: number;
  readonly alienId: number;
  readonly status: Exclude<AlienRelationStatus, 'unknown'>;
  readonly trust: number;
  readonly tension: number;
  readonly changedTick: number;
  readonly lastInteractionTick: number;
  readonly exchangeCount: number;
  readonly conflictCount: number;
}
export interface SpaceResourceLedger {
  readonly surfaceImports: SpaceResourceStock;
  readonly alienImports: SpaceResourceStock;
  readonly bodyExtraction: SpaceResourceStock;
  readonly consumed: SpaceResourceStock;
  readonly lost: SpaceResourceStock;
  readonly surfaceExports: SpaceResourceStock;
}
export interface SpaceState {
  readonly tick: number;
  readonly nextSpaceId: number;
  readonly nextOffworldResidentId: number;
  readonly systemRng: Xoshiro128State;
  readonly programRng: Xoshiro128State;
  readonly missionRng: Xoshiro128State;
  readonly contactRng: Xoshiro128State;
  readonly bodies: readonly CelestialBody[];
  readonly programs: readonly CivilizationSpaceProgram[];
  readonly spacecraft: readonly Spacecraft[];
  readonly missions: readonly SpaceMission[];
  readonly colonies: readonly SpaceColony[];
  readonly cargoTransfers: readonly CargoTransfer[];
  readonly communications: readonly DelayedCommunication[];
  readonly aliens: readonly AlienCivilization[];
  readonly relations: readonly SpaceRelation[];
  readonly ledger: SpaceResourceLedger;
  readonly operationCount: number;
}
export interface SpaceCivilizationContext {
  readonly id: number;
  readonly launchSettlementId: number;
  readonly cultureId: number;
  readonly institutionCount: number;
  readonly scarcity: number;
  readonly stability: number;
  readonly infrastructure: number;
  readonly storedMaterial: number;
  readonly energyCapacity: number;
  readonly engineeringCapacity: number;
  readonly interSettlementExchange: number;
  readonly surfaceReserves: SpaceResourceStock;
}
export interface EligibleSpaceResident {
  readonly residentId: number;
  readonly settlementId: number;
  readonly civilizationId: number;
}
export interface SpaceContext {
  readonly tick: number;
  readonly knownKnowledge: readonly string[];
  readonly activeCivilizations: readonly SpaceCivilizationContext[];
  readonly surfaceSettlementOwners: readonly Readonly<{
    readonly settlementId: number;
    readonly civilizationId: number;
  }>[];
  readonly eligibleUnsalientResidents: readonly EligibleSpaceResident[];
  readonly recentAlienSignalPressure: number;
  readonly terrestrialDiplomacyPressure: number;
}
export interface SpacePopulationDelta {
  readonly residentId: number;
  readonly civilizationId: number;
  readonly settlementId: number;
  readonly delta: -1;
}
export interface SpaceSurfaceResourceDelta {
  readonly civilizationId: number;
  readonly settlementId: number;
  readonly resources: Readonly<{
    food: number;
    water: number;
    timber: number;
    stone: number;
    metal: number;
  }>;
}
export interface SpaceEventDraft {
  readonly kind:
    | 'space-program-advanced'
    | 'spacecraft-launched'
    | 'mission-arrived'
    | 'colony-founded'
    | 'cargo-departed'
    | 'cargo-arrived'
    | 'cargo-lost'
    | 'communication-delivered'
    | 'alien-contacted'
    | 'space-relation-changed'
    | 'colony-abandoned'
    | 'colony-population-grown'
    | 'colony-diverged';
  readonly subjectKind: SpaceReferentKind;
  readonly subjectId: number;
  readonly targetKind: SpaceReferentKind;
  readonly targetId: number;
  readonly tick: number;
  readonly amount: number;
  readonly summary: string;
}
export interface SpaceAdvanceResult {
  readonly state: SpaceState;
  readonly events: readonly SpaceEventDraft[];
  readonly surfacePopulationDeltas: readonly SpacePopulationDelta[];
  readonly surfaceResourceDeltas: readonly SpaceSurfaceResourceDelta[];
}

function frozen<T>(value: T): T {
  return Object.freeze(value);
}
function byId<T extends { readonly id: number }>(left: T, right: T): number {
  return left.id - right.id;
}
function byDueThenId<T extends { readonly dueTick: number; readonly id: number }>(
  left: T,
  right: T,
): number {
  return left.dueTick - right.dueTick || left.id - right.id;
}
function integer(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a non-negative safe integer.`);
}
function percent(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100)
    throw new Error(`${label} must be integer 0..100.`);
}
function stock(value: SpaceResourceStock): SpaceResourceStock {
  const keys: (keyof SpaceResourceStock)[] = ['food', 'water', 'timber', 'stone', 'metal'];
  if (Object.keys(value).length !== keys.length) throw new Error('Resource stock shape invalid.');
  for (const key of keys) integer(value[key], `Resource ${key}`);
  return frozen({ ...value });
}
function zero(): SpaceResourceStock {
  return frozen({ food: 0, water: 0, timber: 0, stone: 0, metal: 0 });
}
function add(left: SpaceResourceStock, right: SpaceResourceStock): SpaceResourceStock {
  return stock({
    food: left.food + right.food,
    water: left.water + right.water,
    timber: left.timber + right.timber,
    stone: left.stone + right.stone,
    metal: left.metal + right.metal,
  });
}
function sub(left: SpaceResourceStock, right: SpaceResourceStock): SpaceResourceStock {
  return stock({
    food: left.food - right.food,
    water: left.water - right.water,
    timber: left.timber - right.timber,
    stone: left.stone - right.stone,
    metal: left.metal - right.metal,
  });
}
function sum(values: readonly SpaceResourceStock[]): SpaceResourceStock {
  return values.reduce(add, zero());
}
function same(left: SpaceResourceStock, right: SpaceResourceStock): boolean {
  return (
    left.food === right.food &&
    left.water === right.water &&
    left.timber === right.timber &&
    left.stone === right.stone &&
    left.metal === right.metal
  );
}
function signed(
  value: SpaceResourceStock,
  direction: 1 | -1,
): SpaceSurfaceResourceDelta['resources'] {
  return frozen({
    food: value.food * direction,
    water: value.water * direction,
    timber: value.timber * direction,
    stone: value.stone * direction,
    metal: value.metal * direction,
  });
}
function launchCargo(): SpaceResourceStock {
  return frozen({ food: 2, water: 2, timber: 0, stone: 0, metal: 1 });
}
function resupplyCargo(): SpaceResourceStock {
  return frozen({ food: 2, water: 2, timber: 0, stone: 0, metal: 1 });
}
function has(context: SpaceContext, knowledge: string): boolean {
  return context.knownKnowledge.includes(knowledge);
}
function canEmit(events: readonly SpaceEventDraft[], count = 1): boolean {
  return events.length + count <= MAX_SPACE_EVENTS_PER_PULSE;
}
function draft(
  kind: SpaceEventDraft['kind'],
  subjectKind: SpaceReferentKind,
  subjectId: number,
  targetKind: SpaceReferentKind,
  targetId: number,
  tick: number,
  amount: number,
  summary: string,
): SpaceEventDraft {
  return frozen({ kind, subjectKind, subjectId, targetKind, targetId, tick, amount, summary });
}
function delay(origin: CelestialBody, destination: CelestialBody, capacity: number): number {
  return Math.max(
    1,
    Math.ceil((Math.abs(origin.distance - destination.distance) * 10 + 1) / Math.max(1, capacity)),
  );
}
function capability(
  civilization: SpaceCivilizationContext,
  stage: SpaceProgramStage,
): readonly [number, number] {
  const transport =
    stage === 'none'
      ? 0
      : Math.max(
          1,
          Math.min(
            8,
            Math.floor((civilization.energyCapacity + civilization.engineeringCapacity) / 40),
          ),
        );
  return frozen([
    transport,
    stage === 'spaceflight'
      ? Math.max(1, Math.min(2, Math.floor(civilization.infrastructure / 60)))
      : 0,
  ]);
}
function nextStage(
  context: SpaceContext,
  civ: SpaceCivilizationContext,
  stage: SpaceProgramStage,
): SpaceProgramStage {
  const baseline =
    civ.stability >= 40 &&
    civ.institutionCount >= 1 &&
    civ.infrastructure >= 30 &&
    civ.storedMaterial >= 10;
  if (!baseline) return stage;
  if (stage === 'none' && has(context, 'advanced-energy') && civ.energyCapacity >= 30)
    return 'advanced-energy';
  if (
    stage === 'advanced-energy' &&
    has(context, 'planetary-engineering') &&
    civ.engineeringCapacity >= 40
  )
    return 'planetary-engineering';
  if (
    stage === 'planetary-engineering' &&
    has(context, 'spaceflight') &&
    civ.energyCapacity >= 50 &&
    civ.engineeringCapacity >= 50 &&
    civ.interSettlementExchange >= 20
  )
    return 'spaceflight';
  return stage;
}
function relationTarget(
  context: SpaceContext,
  civ: SpaceCivilizationContext,
  alien: AlienCivilization,
): Exclude<AlienRelationStatus, 'unknown'> {
  const trait =
    alien.trait === 'hostile'
      ? 45
      : alien.trait === 'competitive'
        ? 25
        : alien.trait === 'cautious'
          ? 10
          : 0;
  const cooperativeCapacity = Math.min(
    40,
    Math.trunc(civ.stability / 4) + Math.trunc(civ.interSettlementExchange / 4),
  );
  const pressure =
    context.recentAlienSignalPressure +
    context.terrestrialDiplomacyPressure +
    civ.scarcity +
    trait -
    cooperativeCapacity;
  if (pressure >= 120) return 'hostile';
  if (pressure >= 70) return 'competitive';
  if (pressure <= 10 && alien.trait === 'curious') return 'allied';
  return 'cooperative';
}
function endpointValid(
  endpoint: CargoEndpoint,
  colonies: readonly SpaceColony[],
  aliens: readonly AlienCivilization[],
): boolean {
  return endpoint.kind === 'settlement'
    ? endpoint.civilizationId > 0 && endpoint.settlementId > 0
    : endpoint.kind === 'colony'
      ? colonies.some((item) => item.id === endpoint.colonyId)
      : aliens.some((item) => item.id === endpoint.alienId);
}
function completeStock(): SpaceResourceStock {
  return zero();
}

function celestialName(stem: string, kind: CelestialBody['kind']): string {
  const suffix =
    kind === 'home' ? 'Hearth' : kind === 'planet' ? 'Reach' : kind === 'moon' ? 'Moon' : 'Drift';
  return `${stem} ${suffix}`;
}

/**
 * Stable release name for a generated body. This is exported so snapshot
 * migrations can replace M9's exact `Body-N` placeholders without touching
 * any physical, historical, or RNG authority.
 */
export function generatedCelestialName(
  seed: Xoshiro128State,
  bodyId: number,
  kind: CelestialBody['kind'],
): string {
  integer(bodyId, 'Celestial body id');
  if (bodyId < 1) throw new Error('Celestial body id must be positive.');
  const naming = new Xoshiro128StarStar(deriveXoshiro128State(seed, 'm10-body-names'));
  const firstNameIndex = naming.nextInt(CELESTIAL_NAME_STEMS.length);
  return celestialName(
    CELESTIAL_NAME_STEMS[(firstNameIndex + bodyId - 1) % CELESTIAL_NAME_STEMS.length]!,
    kind,
  );
}

/** Creation has no historical effect: every body, deposit, and alien is immutable/uncontacted. */
export function createInitialSpace(seed: Xoshiro128State, tick: number): SpaceState {
  integer(tick, 'Space tick');
  const system = new Xoshiro128StarStar(deriveXoshiro128State(seed, 'm9-system'));
  const count = 3 + system.nextInt(6);
  const bodies: CelestialBody[] = [
    frozen({
      id: 1,
      kind: 'home',
      name: generatedCelestialName(seed, 1, 'home'),
      distance: 0,
      habitable: true,
      originalDeposit: frozen({ food: 0, water: 0, timber: 0, stone: 100, metal: 100 }),
      remainingDeposit: frozen({ food: 0, water: 0, timber: 0, stone: 100, metal: 100 }),
    }),
  ];
  for (let id = 2; id <= count; id += 1) {
    const kind = id % 3 === 0 ? 'asteroid' : id % 2 === 0 ? 'planet' : 'moon';
    const deposit = frozen({
      food: 0,
      water: 10 + system.nextInt(30),
      timber: 0,
      stone: 20 + system.nextInt(80),
      metal: 20 + system.nextInt(80),
    });
    bodies.push(
      frozen({
        id,
        kind,
        name: generatedCelestialName(seed, id, kind),
        distance: 2 + id * 3 + system.nextInt(5),
        habitable: system.nextInt(3) !== 0,
        originalDeposit: deposit,
        remainingDeposit: deposit,
      }),
    );
  }
  const contact = new Xoshiro128StarStar(deriveXoshiro128State(seed, 'm9-contact-system'));
  const traits: readonly AlienCivilization['trait'][] = [
    'curious',
    'cautious',
    'competitive',
    'hostile',
  ];
  const aliens = frozen(
    Array.from({ length: Math.min(MAX_ALIEN_CIVILIZATIONS, count - 1) }, (_, index) =>
      frozen({
        id: index + 1,
        homeBodyId: index + 2,
        trait: traits[contact.nextInt(traits.length)]!,
        discoveredTick: null,
      }),
    ),
  );
  return frozen({
    tick,
    nextSpaceId: 1,
    nextOffworldResidentId: FIRST_OFFWORLD_RESIDENT_ID,
    systemRng: system.save(),
    programRng: deriveXoshiro128State(seed, 'm9-program'),
    missionRng: deriveXoshiro128State(seed, 'm9-mission'),
    contactRng: contact.save(),
    bodies: frozen(bodies),
    programs: frozen([]),
    spacecraft: frozen([]),
    missions: frozen([]),
    colonies: frozen([]),
    cargoTransfers: frozen([]),
    communications: frozen([]),
    aliens,
    relations: frozen([]),
    ledger: frozen({
      surfaceImports: zero(),
      alienImports: zero(),
      bodyExtraction: zero(),
      consumed: zero(),
      lost: zero(),
      surfaceExports: zero(),
    }),
    operationCount: 0,
  });
}

function activeAssets(
  state: Pick<SpaceState, 'missions' | 'cargoTransfers' | 'colonies'>,
): SpaceResourceStock {
  return sum([
    ...state.missions.filter((item) => item.status === 'active').map((item) => item.cargo),
    ...state.cargoTransfers.filter((item) => item.status === 'active').map((item) => item.cargo),
    ...state.colonies.map((item) => item.stores),
  ]);
}
function retainMissions(values: readonly SpaceMission[]): readonly SpaceMission[] {
  const active = values
    .filter((item) => item.status === 'active')
    .sort(byDueThenId)
    .slice(0, MAX_ACTIVE_MISSIONS);
  const done = values
    .filter((item) => item.status !== 'active')
    .sort(
      (left, right) =>
        (right.completedTick ?? -1) - (left.completedTick ?? -1) || right.id - left.id,
    )
    .slice(0, MAX_COMPLETED_MISSIONS);
  return frozen([...active, ...done].sort(byId));
}
function retainCargo(values: readonly CargoTransfer[]): readonly CargoTransfer[] {
  const active = values
    .filter((item) => item.status === 'active')
    .sort(byDueThenId)
    .slice(0, MAX_ACTIVE_CARGO_TRANSFERS);
  const done = values
    .filter((item) => item.status !== 'active')
    .sort((left, right) => right.dueTick - left.dueTick || right.id - left.id)
    .slice(0, MAX_COMPLETED_CARGO_TRANSFERS);
  return frozen([...active, ...done].sort(byId));
}
function retainMessages(values: readonly DelayedCommunication[]): readonly DelayedCommunication[] {
  const pending = values
    .filter((item) => item.status === 'pending')
    .sort(byDueThenId)
    .slice(0, MAX_PENDING_COMMUNICATIONS);
  const delivered = values
    .filter((item) => item.status === 'delivered')
    .sort((left, right) => right.dueTick - left.dueTick || right.id - left.id)
    .slice(0, MAX_DELIVERED_COMMUNICATIONS);
  return frozen([...pending, ...delivered].sort(byId));
}

export function advanceSpace(state: SpaceState, context: SpaceContext): SpaceAdvanceResult {
  assertSpaceInvariants(state);
  integer(context.tick, 'Context tick');
  if (context.tick < state.tick) throw new Error('Space time cannot move backwards.');
  const civilizations = [...context.activeCivilizations].sort(byId);
  const surfaceSettlementOwners = [...context.surfaceSettlementOwners].sort(
    (left, right) =>
      left.settlementId - right.settlementId || left.civilizationId - right.civilizationId,
  );
  percent(context.recentAlienSignalPressure, 'Alien signal pressure');
  percent(context.terrestrialDiplomacyPressure, 'Terrestrial diplomacy pressure');
  if (civilizations.length > MAX_SPACE_PROGRAMS)
    throw new Error('Space civilization cap exceeded.');
  for (const [index, civ] of civilizations.entries()) {
    integer(civ.id, 'Civilization ID');
    integer(civ.launchSettlementId, 'Launch settlement ID');
    integer(civ.cultureId, 'Culture ID');
    if (
      civ.id < 1 ||
      civ.launchSettlementId < 1 ||
      civ.cultureId < 1 ||
      (index > 0 && civilizations[index - 1]!.id === civ.id)
    )
      throw new Error('Space civilization context identity invalid.');
    percent(civ.scarcity, 'Civilization scarcity');
    percent(civ.stability, 'Civilization stability');
    integer(civ.institutionCount, 'Institution count');
    integer(civ.infrastructure, 'Infrastructure');
    integer(civ.storedMaterial, 'Stored material');
    integer(civ.energyCapacity, 'Energy capacity');
    integer(civ.engineeringCapacity, 'Engineering capacity');
    integer(civ.interSettlementExchange, 'Inter-settlement exchange');
    stock(civ.surfaceReserves);
  }
  for (const [index, owner] of surfaceSettlementOwners.entries()) {
    integer(owner.settlementId, 'Surface settlement ID');
    integer(owner.civilizationId, 'Surface civilization ID');
    if (
      owner.settlementId < 1 ||
      owner.civilizationId < 1 ||
      (index > 0 && surfaceSettlementOwners[index - 1]!.settlementId === owner.settlementId)
    )
      throw new Error('Surface settlement ownership context invalid.');
  }
  const candidates = [...context.eligibleUnsalientResidents].sort(
    (left, right) =>
      left.residentId - right.residentId ||
      left.civilizationId - right.civilizationId ||
      left.settlementId - right.settlementId,
  );
  for (let index = 0; index < candidates.length; index += 1) {
    const current = candidates[index]!;
    if (
      current.residentId < 1 ||
      current.residentId >= FIRST_OFFWORLD_RESIDENT_ID ||
      !Number.isSafeInteger(current.civilizationId) ||
      current.civilizationId < 1 ||
      !Number.isSafeInteger(current.settlementId) ||
      current.settlementId < 1 ||
      (index > 0 && candidates[index - 1]!.residentId === current.residentId)
    )
      throw new Error('Eligible resident provenance invalid.');
  }
  let nextId = state.nextSpaceId;
  let nextResident = state.nextOffworldResidentId;
  const programs = [...state.programs];
  const bodies = [...state.bodies];
  const ships = [...state.spacecraft];
  const missions = [...state.missions];
  const colonies = [...state.colonies];
  const cargo = [...state.cargoTransfers];
  const messages = [...state.communications];
  const aliens = [...state.aliens];
  const relations = [...state.relations];
  let ledger = state.ledger;
  let operations = 0;
  const events: SpaceEventDraft[] = [];
  const population: SpacePopulationDelta[] = [];
  const resource: SpaceSurfaceResourceDelta[] = [];
  const programRng = new Xoshiro128StarStar(state.programRng);
  const missionRng = new Xoshiro128StarStar(state.missionRng);
  const contactRng = new Xoshiro128StarStar(state.contactRng);
  const surfaceOwnerMatches = (endpoint: CargoEndpoint): boolean =>
    endpoint.kind !== 'settlement' ||
    surfaceSettlementOwners.some(
      (owner) =>
        owner.settlementId === endpoint.settlementId &&
        owner.civilizationId === endpoint.civilizationId,
    );
  const patchResource = (
    civilizationId: number,
    settlementId: number,
    amount: SpaceResourceStock,
    direction: 1 | -1,
  ): void => {
    resource.push(frozen({ civilizationId, settlementId, resources: signed(amount, direction) }));
  };
  const remainingSurface = new Map(
    civilizations.map((civilization) => [
      `${civilization.id}:${civilization.launchSettlementId}`,
      civilization.surfaceReserves,
    ]),
  );
  const withdrawSurface = (
    civilizationId: number,
    settlementId: number,
    amount: SpaceResourceStock,
  ): boolean => {
    const key = `${civilizationId}:${settlementId}`;
    const available = remainingSurface.get(key);
    if (!available) return false;
    try {
      remainingSurface.set(key, sub(available, amount));
      return true;
    } catch {
      return false;
    }
  };
  const addEvent = (entry: SpaceEventDraft): boolean => {
    if (!canEmit(events)) return false;
    events.push(entry);
    return true;
  };

  for (const civ of civilizations.slice(0, MAX_PROGRAMS_PER_PULSE)) {
    const index = programs.findIndex((program) => program.civilizationId === civ.id);
    const oldStage = index < 0 ? 'none' : programs[index]!.stage;
    const stage = nextStage(context, civ, oldStage);
    if (stage === oldStage || !canEmit(events)) continue;
    const caps = capability(civ, stage);
    const program = frozen({
      id: index < 0 ? nextId++ : programs[index]!.id,
      civilizationId: civ.id,
      settlementId: civ.launchSettlementId,
      cultureId: civ.cultureId,
      stage,
      startedTick: index < 0 ? context.tick : programs[index]!.startedTick,
      updatedTick: context.tick,
      planetaryTransportCapacity: caps[0],
      launchCapacity: stage === 'spaceflight' ? Math.min(2, caps[1] + programRng.nextInt(2)) : 0,
    });
    if (index < 0) programs.push(program);
    else programs[index] = program;
    addEvent(
      draft(
        'space-program-advanced',
        'space-program',
        program.id,
        'civilization',
        civ.id,
        context.tick,
        1,
        `Program reached ${stage}.`,
      ),
    );
    operations += 1;
  }

  type Due = Readonly<{ dueTick: number; id: number; kind: 'mission' | 'cargo' | 'message' }>;
  const due: Due[] = [
    ...missions
      .filter((item) => item.status === 'active' && item.dueTick <= context.tick)
      .map((item) => frozen({ dueTick: item.dueTick, id: item.id, kind: 'mission' as const })),
    ...cargo
      .filter((item) => item.status === 'active' && item.dueTick <= context.tick)
      .map((item) => frozen({ dueTick: item.dueTick, id: item.id, kind: 'cargo' as const })),
    ...messages
      .filter((item) => item.status === 'pending' && item.dueTick <= context.tick)
      .map((item) => frozen({ dueTick: item.dueTick, id: item.id, kind: 'message' as const })),
  ].sort(byDueThenId);
  let missionArrivals = 0;
  let cargoArrivals = 0;
  let deliveries = 0;
  for (const work of due) {
    if (work.kind === 'mission') {
      const index = missions.findIndex((item) => item.id === work.id);
      const mission = missions[index]!;
      const needs = mission.kind === 'colony' ? 4 : 1;
      if (
        missionArrivals >= MAX_MISSION_ARRIVALS_PER_PULSE ||
        !canEmit(events, needs) ||
        (mission.kind === 'colony' &&
          (colonies.length >= MAX_COLONIES ||
            colonies.some((colony) => colony.bodyId === mission.destinationBodyId)))
      )
        continue;
      missions[index] = frozen({
        ...mission,
        status: 'completed',
        completedTick: context.tick,
        passengerIds: frozen([]),
        cargo: completeStock(),
      });
      if (mission.kind !== 'colony')
        ledger = frozen({ ...ledger, consumed: add(ledger.consumed, mission.cargo) });
      const shipIndex = ships.findIndex((ship) => ship.id === mission.spacecraftId);
      ships[shipIndex] = frozen({
        ...ships[shipIndex]!,
        status: 'orbiting',
        currentBodyId: mission.destinationBodyId,
        missionId: null,
      });
      addEvent(
        draft(
          'mission-arrived',
          'spacecraft',
          mission.spacecraftId,
          'celestial-body',
          mission.destinationBodyId,
          context.tick,
          mission.manifestPassengerIds.length,
          'Mission arrived on schedule.',
        ),
      );
      if (mission.kind === 'colony') {
        const colony = frozen({
          id: nextId++,
          civilizationId: mission.civilizationId,
          settlementId: mission.settlementId,
          cultureId: mission.cultureId,
          parentBodyId: mission.originBodyId,
          bodyId: mission.destinationBodyId,
          foundedTick: context.tick,
          cultureDivergence: 1,
          residentIds: frozen([...mission.passengerIds]),
          stores: mission.cargo,
          status: 'active' as const,
        });
        colonies.push(colony);
        addEvent(
          draft(
            'colony-founded',
            'space-colony',
            colony.id,
            'celestial-body',
            colony.bodyId,
            context.tick,
            colony.residentIds.length,
            'A colony was founded from exact ordinary residents.',
          ),
        );
        const alien = aliens.find((item) => item.homeBodyId === colony.bodyId);
        if (alien?.discoveredTick === null) {
          const alienIndex = aliens.findIndex((item) => item.id === alien.id);
          aliens[alienIndex] = frozen({ ...alien, discoveredTick: context.tick });
          addEvent(
            draft(
              'alien-contacted',
              'alien-civilization',
              alien.id,
              'space-colony',
              colony.id,
              context.tick,
              1,
              'Generated alien intelligence was contacted.',
            ),
          );
          const civ = civilizations.find((item) => item.id === colony.civilizationId);
          if (civ !== undefined) {
            const status = relationTarget(context, civ, alien);
            const relation = frozen({
              id: nextId++,
              civilizationId: civ.id,
              alienId: alien.id,
              status,
              trust: status === 'allied' ? 80 : status === 'cooperative' ? 60 : 25,
              tension: status === 'hostile' ? 85 : status === 'competitive' ? 60 : 15,
              changedTick: context.tick,
              lastInteractionTick: context.tick,
              exchangeCount: 0,
              conflictCount: 0,
            });
            relations.push(relation);
            addEvent(
              draft(
                'space-relation-changed',
                'alien-civilization',
                alien.id,
                'civilization',
                civ.id,
                context.tick,
                relation.tension,
                `Relation became ${status}.`,
              ),
            );
          }
        }
        if (
          messages.filter((item) => item.status === 'pending').length < MAX_PENDING_COMMUNICATIONS
        ) {
          const source = state.bodies.find((body) => body.id === colony.bodyId)!;
          messages.push(
            frozen({
              id: nextId++,
              civilizationId: colony.civilizationId,
              originBodyId: colony.bodyId,
              destinationBodyId: 1,
              sentTick: context.tick,
              dueTick: context.tick + delay(source, state.bodies[0]!, 1),
              status: 'pending',
              topic: 'colony',
              replyToId: null,
            }),
          );
        }
      }
      missionArrivals += 1;
      operations += 1;
    } else if (work.kind === 'cargo') {
      if (cargoArrivals >= MAX_CARGO_ARRIVALS_PER_PULSE || !canEmit(events)) continue;
      const index = cargo.findIndex((item) => item.id === work.id);
      const transfer = cargo[index]!;
      let delivered = false;
      const transferDestination = transfer.destination;
      if (transferDestination.kind === 'colony') {
        const colonyIndex = colonies.findIndex(
          (colony) => colony.id === transferDestination.colonyId,
        );
        if (colonyIndex >= 0) {
          colonies[colonyIndex] = frozen({
            ...colonies[colonyIndex]!,
            stores: add(colonies[colonyIndex]!.stores, transfer.cargo),
          });
          delivered = true;
        }
      } else if (
        transferDestination.kind === 'settlement' &&
        surfaceOwnerMatches(transferDestination)
      ) {
        patchResource(
          transferDestination.civilizationId,
          transferDestination.settlementId,
          transfer.cargo,
          1,
        );
        ledger = frozen({ ...ledger, surfaceExports: add(ledger.surfaceExports, transfer.cargo) });
        delivered = true;
      }
      cargo[index] = frozen({
        ...transfer,
        status: delivered ? 'completed' : 'lost',
        cargo: completeStock(),
      });
      if (!delivered)
        ledger = frozen({ ...ledger, lost: add(ledger.lost, transfer.manifestCargo) });
      addEvent(
        draft(
          delivered ? 'cargo-arrived' : 'cargo-lost',
          transfer.origin.kind === 'colony'
            ? 'space-colony'
            : transfer.origin.kind === 'alien'
              ? 'alien-civilization'
              : 'settlement',
          transfer.origin.kind === 'colony'
            ? transfer.origin.colonyId
            : transfer.origin.kind === 'alien'
              ? transfer.origin.alienId
              : transfer.origin.settlementId,
          transfer.destination.kind === 'colony' ? 'space-colony' : 'settlement',
          transfer.destination.kind === 'colony'
            ? transfer.destination.colonyId
            : transfer.destination.kind === 'settlement'
              ? transfer.destination.settlementId
              : transfer.destination.alienId,
          context.tick,
          transfer.manifestCargo.metal,
          delivered ? 'Cargo arrived.' : 'Cargo was lost.',
        ),
      );
      cargoArrivals += 1;
      operations += 1;
    } else {
      if (deliveries >= MAX_COMMUNICATION_DELIVERIES_PER_PULSE || !canEmit(events)) continue;
      const index = messages.findIndex((item) => item.id === work.id);
      const message = messages[index]!;
      messages[index] = frozen({ ...message, status: 'delivered', replyToId: null });
      addEvent(
        draft(
          'communication-delivered',
          'celestial-body',
          message.originBodyId,
          'celestial-body',
          message.destinationBodyId,
          context.tick,
          1,
          'Delayed communication delivered.',
        ),
      );
      if (
        message.topic !== 'reply' &&
        messages.filter((item) => item.status === 'pending').length < MAX_PENDING_COMMUNICATIONS
      ) {
        const origin = state.bodies.find((body) => body.id === message.destinationBodyId)!;
        const destination = state.bodies.find((body) => body.id === message.originBodyId)!;
        messages.push(
          frozen({
            id: nextId++,
            civilizationId: message.civilizationId,
            originBodyId: origin.id,
            destinationBodyId: destination.id,
            sentTick: context.tick,
            dueTick: context.tick + delay(origin, destination, 1),
            status: 'pending',
            topic: 'reply',
            replyToId: message.id,
          }),
        );
      }
      deliveries += 1;
      operations += 1;
    }
  }

  const livePeople = new Set<number>([
    ...missions.filter((item) => item.status === 'active').flatMap((item) => item.passengerIds),
    ...colonies.flatMap((item) => item.residentIds),
  ]);
  let launches = 0;
  for (const program of programs.filter((item) => item.stage === 'spaceflight').sort(byId)) {
    if (
      launches >= MAX_LAUNCHES_PER_PULSE ||
      ships.length >= MAX_SPACECRAFT ||
      missions.filter((item) => item.status === 'active').length >= MAX_ACTIVE_MISSIONS ||
      !canEmit(events)
    )
      break;
    const civ = civilizations.find((item) => item.id === program.civilizationId);
    if (
      !has(context, 'spaceflight') ||
      civ === undefined ||
      missions.filter((item) => item.status === 'active' && item.civilizationId === civ.id)
        .length >= program.launchCapacity
    )
      continue;
    const orbital = missions.some(
      (item) =>
        item.civilizationId === civ.id && item.kind !== 'colony' && item.status === 'completed',
    );
    const target = bodies.find(
      (body) =>
        body.id !== 1 &&
        body.habitable &&
        !colonies.some((colony) => colony.bodyId === body.id) &&
        !missions.some(
          (mission) =>
            mission.status === 'active' &&
            mission.kind === 'colony' &&
            mission.destinationBodyId === body.id,
        ),
    );
    const candidatesForProgram = candidates.filter(
      (item) =>
        item.civilizationId === civ.id &&
        item.settlementId === civ.launchSettlementId &&
        !livePeople.has(item.residentId),
    );
    const kind: SpaceMissionKind = !orbital
      ? 'orbital'
      : target && candidatesForProgram.length >= 2 && livePeople.size + 2 <= MAX_OFFWORLD_RESIDENTS
        ? 'colony'
        : 'exploration';
    if (kind === 'colony' && !target) continue;
    const destination =
      kind === 'orbital'
        ? state.bodies[0]!
        : (target ?? state.bodies.find((body) => body.id !== 1)!);
    const cargoStock = launchCargo();
    if (!withdrawSurface(civ.id, civ.launchSettlementId, cargoStock)) continue;
    const passengerIds =
      kind === 'colony'
        ? candidatesForProgram
            .slice(0, 2)
            .map((item) => item.residentId)
            .sort((left, right) => left - right)
        : [];
    const ship = frozen({
      id: nextId++,
      civilizationId: civ.id,
      settlementId: civ.launchSettlementId,
      status: 'in-flight' as const,
      currentBodyId: 1,
      missionId: nextId,
      launchedTick: context.tick,
    });
    const dueTick =
      context.tick +
      delay(state.bodies[0]!, destination, program.planetaryTransportCapacity) +
      missionRng.nextInt(2);
    const mission = frozen({
      id: nextId++,
      spacecraftId: ship.id,
      civilizationId: civ.id,
      settlementId: civ.launchSettlementId,
      cultureId: civ.cultureId,
      kind,
      originBodyId: 1,
      destinationBodyId: destination.id,
      departureTick: context.tick,
      dueTick,
      status: 'active' as const,
      completedTick: null,
      passengerIds: frozen(passengerIds),
      manifestPassengerIds: frozen([...passengerIds]),
      cargo: cargoStock,
      manifestCargo: cargoStock,
    });
    ships.push(frozen({ ...ship, missionId: mission.id }));
    missions.push(mission);
    ledger = frozen({ ...ledger, surfaceImports: add(ledger.surfaceImports, cargoStock) });
    patchResource(civ.id, civ.launchSettlementId, cargoStock, -1);
    for (const residentId of passengerIds) {
      livePeople.add(residentId);
      population.push(
        frozen({
          residentId,
          civilizationId: civ.id,
          settlementId: civ.launchSettlementId,
          delta: -1,
        }),
      );
    }
    addEvent(
      draft(
        'spacecraft-launched',
        'spacecraft',
        ship.id,
        'celestial-body',
        destination.id,
        context.tick,
        passengerIds.length,
        'Contextual spacecraft launch departed.',
      ),
    );
    launches += 1;
    operations += 1;
  }

  const scheduleCargo = (
    civilizationId: number,
    origin: CargoEndpoint,
    destination: CargoEndpoint,
    amount: SpaceResourceStock,
    originKind: 'surface' | 'alien' | 'colony',
  ): boolean => {
    if (
      cargo.filter((item) => item.status === 'active').length >= MAX_ACTIVE_CARGO_TRANSFERS ||
      !canEmit(events) ||
      !endpointValid(origin, colonies, aliens) ||
      !endpointValid(destination, colonies, aliens) ||
      !surfaceOwnerMatches(origin) ||
      !surfaceOwnerMatches(destination)
    )
      return false;
    const body = (endpoint: CargoEndpoint): number =>
      endpoint.kind === 'colony'
        ? colonies.find((item) => item.id === endpoint.colonyId)!.bodyId
        : endpoint.kind === 'alien'
          ? aliens.find((item) => item.id === endpoint.alienId)!.homeBodyId
          : 1;
    const sourceSettlement = origin.kind === 'settlement' ? origin : null;
    if (
      originKind === 'surface' &&
      (!sourceSettlement ||
        !withdrawSurface(sourceSettlement.civilizationId, sourceSettlement.settlementId, amount))
    )
      return false;
    const transfer = frozen({
      id: nextId++,
      civilizationId,
      origin,
      destination,
      departureTick: context.tick,
      dueTick:
        context.tick +
        delay(
          state.bodies.find((item) => item.id === body(origin))!,
          state.bodies.find((item) => item.id === body(destination))!,
          1,
        ),
      status: 'active' as const,
      cargo: amount,
      manifestCargo: amount,
    });
    cargo.push(transfer);
    if (originKind === 'surface') {
      ledger = frozen({ ...ledger, surfaceImports: add(ledger.surfaceImports, amount) });
      patchResource(sourceSettlement!.civilizationId, sourceSettlement!.settlementId, amount, -1);
    } else if (originKind === 'alien')
      ledger = frozen({ ...ledger, alienImports: add(ledger.alienImports, amount) });
    addEvent(
      draft(
        'cargo-departed',
        origin.kind === 'colony'
          ? 'space-colony'
          : origin.kind === 'alien'
            ? 'alien-civilization'
            : 'settlement',
        origin.kind === 'colony'
          ? origin.colonyId
          : origin.kind === 'alien'
            ? origin.alienId
            : origin.settlementId,
        destination.kind === 'colony' ? 'space-colony' : 'settlement',
        destination.kind === 'colony'
          ? destination.colonyId
          : destination.kind === 'settlement'
            ? destination.settlementId
            : destination.alienId,
        context.tick,
        amount.metal,
        'Interworld cargo departed.',
      ),
    );
    operations += 1;
    return true;
  };
  for (const colony of colonies.filter((item) => item.status === 'active').sort(byId)) {
    const civ = civilizations.find((item) => item.id === colony.civilizationId);
    const index = colonies.findIndex((item) => item.id === colony.id);
    if (!civ) {
      if (canEmit(events)) {
        colonies[index] = frozen({ ...colonies[index]!, status: 'abandoned' });
        addEvent(
          draft(
            'colony-abandoned',
            'space-colony',
            colony.id,
            'civilization',
            colony.civilizationId,
            context.tick,
            colony.residentIds.length,
            'The colony was abandoned after losing active terrestrial support.',
          ),
        );
        operations += 1;
      }
      continue;
    }
    operations += 1;
    if (colonies[index]!.stores.food > 0) {
      const consumed = frozen({ food: 1, water: 0, timber: 0, stone: 0, metal: 0 });
      colonies[index] = frozen({
        ...colonies[index]!,
        stores: sub(colonies[index]!.stores, consumed),
      });
      ledger = frozen({ ...ledger, consumed: add(ledger.consumed, consumed) });
    }
    const bodyIndex = bodies.findIndex((body) => body.id === colony.bodyId);
    if (bodyIndex >= 0 && bodies[bodyIndex]!.remainingDeposit.metal > 0) {
      const extracted = frozen({ food: 0, water: 0, timber: 0, stone: 0, metal: 1 });
      bodies[bodyIndex] = frozen({
        ...bodies[bodyIndex]!,
        remainingDeposit: sub(bodies[bodyIndex]!.remainingDeposit, extracted),
      });
      colonies[index] = frozen({
        ...colonies[index]!,
        stores: add(colonies[index]!.stores, extracted),
      });
      ledger = frozen({ ...ledger, bodyExtraction: add(ledger.bodyExtraction, extracted) });
    }
    if (colonies[index]!.stores.food < 2)
      scheduleCargo(
        civ.id,
        frozen({
          kind: 'settlement',
          civilizationId: civ.id,
          settlementId: civ.launchSettlementId,
        }),
        frozen({ kind: 'colony', colonyId: colony.id }),
        resupplyCargo(),
        'surface',
      );
    if (colonies[index]!.stores.metal >= 1) {
      const amount = frozen({ food: 0, water: 0, timber: 0, stone: 0, metal: 1 });
      const admitted = scheduleCargo(
        civ.id,
        frozen({ kind: 'colony', colonyId: colony.id }),
        frozen({
          kind: 'settlement',
          civilizationId: civ.id,
          settlementId: civ.launchSettlementId,
        }),
        amount,
        'colony',
      );
      if (admitted)
        colonies[index] = frozen({
          ...colonies[index]!,
          stores: sub(colonies[index]!.stores, amount),
        });
    }
    const birthCost = frozen({ food: 1, water: 1, timber: 0, stone: 0, metal: 0 });
    if (
      colonies[index]!.residentIds.length < MAX_COLONY_RESIDENTS &&
      livePeople.size < MAX_OFFWORLD_RESIDENTS &&
      colonies[index]!.stores.food >= birthCost.food &&
      colonies[index]!.stores.water >= birthCost.water &&
      canEmit(events, 2)
    ) {
      colonies[index] = frozen({
        ...colonies[index]!,
        cultureDivergence: Math.min(100, colonies[index]!.cultureDivergence + 1),
        residentIds: frozen([...colonies[index]!.residentIds, nextResident++]),
        stores: sub(colonies[index]!.stores, birthCost),
      });
      livePeople.add(nextResident - 1);
      ledger = frozen({ ...ledger, consumed: add(ledger.consumed, birthCost) });
      addEvent(
        draft(
          'colony-population-grown',
          'space-colony',
          colony.id,
          'celestial-body',
          colony.bodyId,
          context.tick,
          1,
          'Colony population grew within food and water capacity.',
        ),
      );
      addEvent(
        draft(
          'colony-diverged',
          'space-colony',
          colony.id,
          'celestial-body',
          colony.bodyId,
          context.tick,
          colonies[index].cultureDivergence,
          'Colony culture diverged gradually.',
        ),
      );
    }
  }
  for (const relation of relations.sort(byId).slice(0, MAX_RELATIONS_PER_PULSE)) {
    const civ = civilizations.find((item) => item.id === relation.civilizationId);
    const alien = aliens.find((item) => item.id === relation.alienId);
    if (!civ || !alien || !canEmit(events)) continue;
    const status = relationTarget(context, civ, alien);
    const observed =
      missions.filter(
        (mission) => mission.civilizationId === civ.id && mission.status === 'completed',
      ).length +
      cargo.filter((transfer) => transfer.civilizationId === civ.id && transfer.status !== 'active')
        .length;
    const contactVariation = contactRng.nextInt(4);
    const index = relations.findIndex((item) => item.id === relation.id);
    const trust =
      status === 'allied' ? 80 : status === 'cooperative' ? 60 : status === 'competitive' ? 35 : 10;
    const tension =
      status === 'hostile'
        ? 85
        : status === 'competitive'
          ? 60
          : status === 'cooperative'
            ? 25
            : 10;
    const changed = status !== relation.status;
    relations[index] = frozen({
      ...relation,
      status,
      trust: Math.round((relation.trust + trust) / 2),
      tension: Math.min(
        100,
        Math.round((relation.tension + tension) / 2) + Math.min(5, observed + contactVariation),
      ),
      changedTick: changed ? context.tick : relation.changedTick,
      lastInteractionTick: context.tick,
      exchangeCount:
        relation.exchangeCount + (status === 'allied' || status === 'cooperative' ? 1 : 0),
      conflictCount:
        relation.conflictCount + (status === 'competitive' || status === 'hostile' ? 1 : 0),
    });
    operations += 1;
    if (changed)
      addEvent(
        draft(
          'space-relation-changed',
          'alien-civilization',
          alien.id,
          'civilization',
          civ.id,
          context.tick,
          tension,
          `Relation became ${status}.`,
        ),
      );
    const colony = colonies.find(
      (item) => item.civilizationId === civ.id && item.status === 'active',
    );
    if ((status === 'allied' || status === 'cooperative') && colony)
      scheduleCargo(
        civ.id,
        frozen({ kind: 'alien', alienId: alien.id }),
        frozen({ kind: 'colony', colonyId: colony.id }),
        frozen({ food: 1, water: 1, timber: 0, stone: 0, metal: 1 }),
        'alien',
      );
    else if (
      (status === 'competitive' || status === 'hostile') &&
      colony &&
      colonies.find((item) => item.id === colony.id)!.stores.metal > 0 &&
      canEmit(events)
    ) {
      const colonyIndex = colonies.findIndex((item) => item.id === colony.id);
      const loss = frozen({ food: 0, water: 0, timber: 0, stone: 0, metal: 1 });
      colonies[colonyIndex] = frozen({
        ...colonies[colonyIndex]!,
        stores: sub(colonies[colonyIndex]!.stores, loss),
      });
      ledger = frozen({ ...ledger, lost: add(ledger.lost, loss) });
      addEvent(
        draft(
          'cargo-lost',
          'space-colony',
          colony.id,
          'alien-civilization',
          alien.id,
          context.tick,
          1,
          'Conflict caused a recorded cargo loss.',
        ),
      );
    }
  }
  const result = frozen({
    tick: context.tick,
    nextSpaceId: nextId,
    nextOffworldResidentId: nextResident,
    systemRng: state.systemRng,
    programRng: programRng.save(),
    missionRng: missionRng.save(),
    contactRng: contactRng.save(),
    bodies: frozen(bodies.sort(byId)),
    programs: frozen(programs.sort(byId)),
    spacecraft: frozen(ships.sort(byId)),
    missions: retainMissions(missions),
    colonies: frozen(colonies.sort(byId)),
    cargoTransfers: retainCargo(cargo),
    communications: retainMessages(messages),
    aliens: frozen(aliens.sort(byId)),
    relations: frozen(relations.sort(byId)),
    ledger,
    operationCount: state.operationCount + operations,
  });
  assertSpaceInvariants(result);
  return frozen({
    state: result,
    events: frozen(events),
    surfacePopulationDeltas: frozen(population),
    surfaceResourceDeltas: frozen(resource),
  });
}

/** Canonical persistence DTO with no mutable collections. */
export function spaceDto(state: SpaceState): SpaceState {
  assertSpaceInvariants(state);
  return frozen({
    ...state,
    bodies: frozen([...state.bodies].sort(byId)),
    programs: frozen([...state.programs].sort(byId)),
    spacecraft: frozen([...state.spacecraft].sort(byId)),
    missions: frozen([...state.missions].sort(byId)),
    colonies: frozen([...state.colonies].sort(byId)),
    cargoTransfers: frozen([...state.cargoTransfers].sort(byId)),
    communications: frozen([...state.communications].sort(byId)),
    aliens: frozen([...state.aliens].sort(byId)),
    relations: frozen([...state.relations].sort(byId)),
  });
}

export function assertSpaceInvariants(state: SpaceState): void {
  integer(state.tick, 'Space tick');
  integer(state.nextSpaceId, 'Next space ID');
  integer(state.nextOffworldResidentId, 'Next offworld ID');
  integer(state.operationCount, 'Space operation count');
  if (state.nextSpaceId < 1) throw new Error('Next space ID invalid.');
  if (state.nextOffworldResidentId < FIRST_OFFWORLD_RESIDENT_ID)
    throw new Error('Offworld allocator range invalid.');
  for (const rng of [state.systemRng, state.programRng, state.missionRng, state.contactRng])
    new Xoshiro128StarStar(rng);
  if (state.bodies.length < 2 || state.bodies.length > MAX_SPACE_BODIES)
    throw new Error('Space body cap invalid.');
  if (
    state.programs.length > MAX_SPACE_PROGRAMS ||
    state.spacecraft.length > MAX_SPACECRAFT ||
    state.colonies.length > MAX_COLONIES ||
    state.aliens.length > MAX_ALIEN_CIVILIZATIONS ||
    state.relations.length > MAX_SPACE_RELATIONS
  )
    throw new Error('Space collection cap exceeded.');
  const all: readonly (readonly { readonly id: number }[])[] = [
    state.bodies,
    state.programs,
    state.spacecraft,
    state.missions,
    state.colonies,
    state.cargoTransfers,
    state.communications,
    state.aliens,
    state.relations,
  ];
  for (const values of all)
    for (let index = 1; index < values.length; index += 1)
      if (values[index - 1]!.id >= values[index]!.id)
        throw new Error('Collection must be canonical.');
  const dynamic = [
    ...state.programs,
    ...state.spacecraft,
    ...state.missions,
    ...state.colonies,
    ...state.cargoTransfers,
    ...state.communications,
    ...state.relations,
  ];
  const dynamicIds = new Set<number>();
  for (const item of dynamic) {
    if (item.id < 1 || item.id >= state.nextSpaceId || dynamicIds.has(item.id))
      throw new Error('Dynamic ID invalid.');
    dynamicIds.add(item.id);
  }
  if (
    state.missions.filter((item) => item.status === 'active').length > MAX_ACTIVE_MISSIONS ||
    state.missions.filter((item) => item.status !== 'active').length > MAX_COMPLETED_MISSIONS
  )
    throw new Error('Mission cap exceeded.');
  if (
    state.cargoTransfers.filter((item) => item.status === 'active').length >
      MAX_ACTIVE_CARGO_TRANSFERS ||
    state.cargoTransfers.filter((item) => item.status !== 'active').length >
      MAX_COMPLETED_CARGO_TRANSFERS
  )
    throw new Error('Cargo cap exceeded.');
  if (
    state.communications.filter((item) => item.status === 'pending').length >
      MAX_PENDING_COMMUNICATIONS ||
    state.communications.filter((item) => item.status === 'delivered').length >
      MAX_DELIVERED_COMMUNICATIONS
  )
    throw new Error('Communication cap exceeded.');
  const bodyIds = new Set(state.bodies.map((item) => item.id));
  const shipIds = new Set(state.spacecraft.map((item) => item.id));
  const missionIds = new Set(state.missions.map((item) => item.id));
  const alienIds = new Set(state.aliens.map((item) => item.id));
  const programCivs = new Set<number>();
  const people = new Set<number>();
  for (const [index, body] of state.bodies.entries()) {
    if (body.id !== index + 1 || (body.kind === 'home') !== (body.id === 1))
      throw new Error('Generated body identity invalid.');
    integer(body.distance, 'Body distance');
    stock(body.originalDeposit);
    stock(body.remainingDeposit);
    for (const key of ['food', 'water', 'timber', 'stone', 'metal'] as const)
      if (body.remainingDeposit[key] > body.originalDeposit[key])
        throw new Error('Body remaining deposit exceeds its generated deposit.');
  }
  for (const program of state.programs) {
    if (
      programCivs.has(program.civilizationId) ||
      program.civilizationId < 1 ||
      program.settlementId < 1 ||
      program.cultureId < 1 ||
      !['advanced-energy', 'planetary-engineering', 'spaceflight'].includes(program.stage) ||
      !Number.isSafeInteger(program.startedTick) ||
      !Number.isSafeInteger(program.updatedTick) ||
      program.startedTick < 0 ||
      program.updatedTick < program.startedTick ||
      !Number.isSafeInteger(program.planetaryTransportCapacity) ||
      program.planetaryTransportCapacity < 1 ||
      program.planetaryTransportCapacity > 8 ||
      !Number.isSafeInteger(program.launchCapacity) ||
      program.launchCapacity < 0 ||
      program.launchCapacity > 2 ||
      (program.stage === 'spaceflight') !== program.launchCapacity > 0
    )
      throw new Error('Program invalid.');
    programCivs.add(program.civilizationId);
  }
  for (const mission of state.missions) {
    const manifestIsCanonical = mission.manifestPassengerIds.every(
      (person, index) =>
        Number.isSafeInteger(person) &&
        person > 0 &&
        person < FIRST_OFFWORLD_RESIDENT_ID &&
        (index === 0 || mission.manifestPassengerIds[index - 1]! < person),
    );
    if (
      mission.civilizationId < 1 ||
      mission.settlementId < 1 ||
      mission.cultureId < 1 ||
      !shipIds.has(mission.spacecraftId) ||
      !bodyIds.has(mission.originBodyId) ||
      !bodyIds.has(mission.destinationBodyId) ||
      !['orbital', 'exploration', 'colony'].includes(mission.kind) ||
      !['active', 'completed', 'failed'].includes(mission.status) ||
      !Number.isSafeInteger(mission.departureTick) ||
      !Number.isSafeInteger(mission.dueTick) ||
      mission.dueTick <= mission.departureTick ||
      !manifestIsCanonical ||
      (mission.kind === 'colony') !== (mission.manifestPassengerIds.length === 2)
    )
      throw new Error('Mission reference invalid.');
    stock(mission.cargo);
    stock(mission.manifestCargo);
    if (mission.status === 'active') {
      if (
        mission.completedTick !== null ||
        state.spacecraft.find((ship) => ship.id === mission.spacecraftId)?.missionId !==
          mission.id ||
        (mission.kind !== 'colony' && mission.passengerIds.length !== 0) ||
        mission.passengerIds.length !== mission.manifestPassengerIds.length ||
        mission.passengerIds.some((person, index) => person !== mission.manifestPassengerIds[index])
      )
        throw new Error('Mission lifecycle invalid.');
      for (const person of mission.passengerIds) {
        if (people.has(person)) throw new Error('Live passenger duplicate.');
        people.add(person);
      }
    } else if (
      mission.completedTick === null ||
      mission.completedTick < mission.dueTick ||
      mission.completedTick > state.tick ||
      mission.passengerIds.length !== 0 ||
      !same(mission.cargo, zero())
    )
      throw new Error('Completed mission manifest invalid.');
  }
  for (const ship of state.spacecraft) {
    const linkedMission =
      ship.missionId === null
        ? undefined
        : state.missions.find((mission) => mission.id === ship.missionId);
    if (
      ship.civilizationId < 1 ||
      ship.settlementId < 1 ||
      !['grounded', 'in-flight', 'orbiting', 'retired'].includes(ship.status) ||
      !bodyIds.has(ship.currentBodyId) ||
      (ship.missionId !== null && !missionIds.has(ship.missionId)) ||
      (ship.status === 'in-flight') !== (linkedMission?.status === 'active')
    )
      throw new Error('Ship reference invalid.');
  }
  for (const colony of state.colonies) {
    if (
      !bodyIds.has(colony.bodyId) ||
      !bodyIds.has(colony.parentBodyId) ||
      colony.civilizationId < 1 ||
      colony.residentIds.length > MAX_COLONY_RESIDENTS ||
      colony.settlementId < 1 ||
      colony.cultureId < 1 ||
      !Number.isSafeInteger(colony.foundedTick) ||
      colony.foundedTick < 0 ||
      !Number.isSafeInteger(colony.cultureDivergence) ||
      colony.cultureDivergence < 0 ||
      colony.cultureDivergence > 100 ||
      !['active', 'abandoned'].includes(colony.status)
    )
      throw new Error('Colony invalid.');
    stock(colony.stores);
    for (const [index, person] of colony.residentIds.entries()) {
      if (!Number.isSafeInteger(person) || person < 1)
        throw new Error('Colony resident identity invalid.');
      if (index > 0 && colony.residentIds[index - 1]! >= person)
        throw new Error('Colony residents must be canonical.');
      if (people.has(person)) throw new Error('Live resident duplicate.');
      people.add(person);
    }
  }
  if (people.size > MAX_OFFWORLD_RESIDENTS) throw new Error('Offworld cap exceeded.');
  const bornIds = [...people]
    .filter((personId) => personId >= FIRST_OFFWORLD_RESIDENT_ID)
    .sort((left, right) => left - right);
  if (
    state.nextOffworldResidentId - FIRST_OFFWORLD_RESIDENT_ID !== bornIds.length ||
    bornIds.some((personId, index) => personId !== FIRST_OFFWORLD_RESIDENT_ID + index)
  )
    throw new Error('Offworld birth allocator is inconsistent with live residents.');
  for (const transfer of state.cargoTransfers) {
    if (
      transfer.dueTick <= transfer.departureTick ||
      !endpointValid(transfer.origin, state.colonies, state.aliens) ||
      !endpointValid(transfer.destination, state.colonies, state.aliens)
    )
      throw new Error('Cargo endpoint invalid.');
    stock(transfer.cargo);
    stock(transfer.manifestCargo);
    if (transfer.status !== 'active' && !same(transfer.cargo, zero()))
      throw new Error('Completed cargo manifest invalid.');
  }
  for (const message of state.communications)
    if (
      message.civilizationId < 1 ||
      !['pending', 'delivered'].includes(message.status) ||
      !['mission', 'colony', 'contact', 'reply'].includes(message.topic) ||
      !bodyIds.has(message.originBodyId) ||
      !bodyIds.has(message.destinationBodyId) ||
      !Number.isSafeInteger(message.sentTick) ||
      !Number.isSafeInteger(message.dueTick) ||
      message.dueTick <= message.sentTick ||
      (message.replyToId !== null &&
        !state.communications.some((item) => item.id === message.replyToId))
    )
      throw new Error('Communication invalid.');
  const pairs = new Set<string>();
  for (const alien of state.aliens)
    if (
      alien.id < 1 ||
      !bodyIds.has(alien.homeBodyId) ||
      !['curious', 'cautious', 'competitive', 'hostile'].includes(alien.trait) ||
      (alien.discoveredTick !== null &&
        (!Number.isSafeInteger(alien.discoveredTick) ||
          alien.discoveredTick < 0 ||
          alien.discoveredTick > state.tick))
    )
      throw new Error('Alien invalid.');
  for (const relation of state.relations) {
    const key = `${relation.civilizationId}:${relation.alienId}`;
    const alien = state.aliens.find((candidate) => candidate.id === relation.alienId);
    const alienDiscoveredTick = alien?.discoveredTick ?? null;
    if (
      !alienIds.has(relation.alienId) ||
      alienDiscoveredTick === null ||
      relation.civilizationId < 1 ||
      pairs.has(key) ||
      !['allied', 'cooperative', 'competitive', 'hostile'].includes(relation.status) ||
      !Number.isSafeInteger(relation.trust) ||
      relation.trust < 0 ||
      relation.trust > 100 ||
      !Number.isSafeInteger(relation.tension) ||
      relation.tension < 0 ||
      relation.tension > 100 ||
      !Number.isSafeInteger(relation.changedTick) ||
      !Number.isSafeInteger(relation.lastInteractionTick) ||
      relation.changedTick < alienDiscoveredTick ||
      relation.lastInteractionTick < relation.changedTick ||
      relation.lastInteractionTick > state.tick ||
      !Number.isSafeInteger(relation.exchangeCount) ||
      !Number.isSafeInteger(relation.conflictCount) ||
      relation.exchangeCount < 0 ||
      relation.conflictCount < 0
    )
      throw new Error('Relation invalid.');
    pairs.add(key);
  }
  for (const value of [
    state.ledger.surfaceImports,
    state.ledger.alienImports,
    state.ledger.bodyExtraction,
    state.ledger.consumed,
    state.ledger.lost,
    state.ledger.surfaceExports,
  ])
    stock(value);
  const sources = add(
    add(state.ledger.surfaceImports, state.ledger.alienImports),
    state.ledger.bodyExtraction,
  );
  const accounted = add(
    add(add(activeAssets(state), state.ledger.consumed), state.ledger.lost),
    state.ledger.surfaceExports,
  );
  if (!same(sources, accounted)) throw new Error('Resource ledger conservation invalid.');
  const original = sum(state.bodies.map((body) => body.originalDeposit));
  const remaining = sum(state.bodies.map((body) => body.remainingDeposit));
  if (!same(original, add(remaining, state.ledger.bodyExtraction)))
    throw new Error('Body deposit conservation invalid.');
}
