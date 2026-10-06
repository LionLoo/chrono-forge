import type {
  SpaceBodyProjection,
  SpaceCargoEndpointProjection,
  SpaceProjection,
} from '../protocol';
import type { WorldCamera } from './camera';

export type SystemSelectionKind =
  'body' | 'mission' | 'colony' | 'spacecraft' | 'cargo' | 'communication' | 'alien';

export interface SystemSelection {
  readonly id: number;
  readonly kind: SystemSelectionKind;
}

export interface SystemPoint {
  readonly bodyId: number;
  readonly x: number;
  readonly y: number;
}

export const INITIAL_SYSTEM_CAMERA: WorldCamera = Object.freeze({ x: 0, y: 0, zoom: 1 });

export function systemLabel(value: string): string {
  return value.replaceAll('-', ' ');
}

function selectionKey(selection: SystemSelection): string {
  return `${selection.kind}:${selection.id}`;
}

export function sameSystemSelection(left: SystemSelection | null, right: SystemSelection): boolean {
  return left?.kind === right.kind && left.id === right.id;
}

export function systemEndpointBodyId(
  endpoint: SpaceCargoEndpointProjection,
  space: SpaceProjection,
): number | null {
  if (endpoint.kind === 'settlement') {
    return space.bodies.find((body) => body.kind === 'home')?.id ?? 1;
  }
  if (endpoint.kind === 'colony') {
    return space.colonies.find((colony) => colony.id === endpoint.colonyId)?.bodyId ?? null;
  }
  return space.aliens.find((alien) => alien.id === endpoint.alienId)?.homeBodyId ?? null;
}

/** Stable presentation layout derived only from ordered, already-visible Worker facts. */
export function systemBodyLayout(bodies: readonly SpaceBodyProjection[]): readonly SystemPoint[] {
  const ordered = [...bodies].sort(
    (left, right) => left.distance - right.distance || left.id - right.id,
  );
  const greatestDistance = Math.max(1, ...ordered.map((body) => body.distance));
  return ordered.map((body) => {
    if (body.kind === 'home' || body.distance === 0) return { bodyId: body.id, x: 0, y: 0 };
    const radius = 72 + (body.distance / greatestDistance) * 190;
    const angle = (((body.id * 137.508 + body.distance * 11) % 360) * Math.PI) / 180;
    return {
      bodyId: body.id,
      x: Math.round(Math.cos(angle) * radius * 100) / 100,
      y: Math.round(Math.sin(angle) * radius * 100) / 100,
    };
  });
}

export function systemSelectionOptions(
  space: SpaceProjection,
): readonly { readonly label: string; readonly selection: SystemSelection }[] {
  return [
    ...space.bodies.map((body) => ({
      label: `Celestial body · ${body.name}`,
      selection: { id: body.id, kind: 'body' } as const,
    })),
    ...space.spacecraft.map((craft) => ({
      label: `Spacecraft · ${craft.id}`,
      selection: { id: craft.id, kind: 'spacecraft' } as const,
    })),
    ...space.missions.map((mission) => ({
      label: `${systemLabel(mission.kind)} mission · ${mission.id}`,
      selection: { id: mission.id, kind: 'mission' } as const,
    })),
    ...space.colonies.map((colony) => ({
      label: `Colony · ${colony.id}`,
      selection: { id: colony.id, kind: 'colony' } as const,
    })),
    ...space.cargoTransfers.map((cargo) => ({
      label: `Cargo route · ${cargo.id}`,
      selection: { id: cargo.id, kind: 'cargo' } as const,
    })),
    ...space.communications.map((communication) => ({
      label: `${systemLabel(communication.topic)} communication · ${communication.id}`,
      selection: { id: communication.id, kind: 'communication' } as const,
    })),
    ...space.aliens.map((alien) => ({
      label: `Contacted civilization · ${alien.id}`,
      selection: { id: alien.id, kind: 'alien' } as const,
    })),
  ];
}

export function parseSystemSelection(value: string): SystemSelection | null {
  const [kind, idText, extra] = value.split(':');
  const id = Number(idText);
  if (extra !== undefined || !Number.isSafeInteger(id) || id < 1) return null;
  if (
    kind !== 'body' &&
    kind !== 'mission' &&
    kind !== 'colony' &&
    kind !== 'spacecraft' &&
    kind !== 'cargo' &&
    kind !== 'communication' &&
    kind !== 'alien'
  ) {
    return null;
  }
  return { id, kind };
}

export function systemSelectionValue(selection: SystemSelection | null): string {
  return selection === null ? '' : selectionKey(selection);
}

export function systemSelectionDetail(
  space: SpaceProjection,
  selection: SystemSelection | null,
): { readonly heading: string; readonly lines: readonly string[] } | null {
  if (selection === null) return null;
  if (selection.kind === 'body') {
    const body = space.bodies.find((candidate) => candidate.id === selection.id);
    if (body === undefined) return null;
    return {
      heading: body.name,
      lines: [
        `${systemLabel(body.kind)} body ${body.id}`,
        `System distance ${body.distance}`,
        body.habitable ? 'Habitable conditions recorded' : 'Inhospitable conditions recorded',
      ],
    };
  }
  if (selection.kind === 'spacecraft') {
    const craft = space.spacecraft.find((candidate) => candidate.id === selection.id);
    if (craft === undefined) return null;
    return {
      heading: `Spacecraft ${craft.id}`,
      lines: [
        `Civilization ${craft.civilizationId}`,
        `Status: ${systemLabel(craft.status)}`,
        `Current body ${craft.currentBodyId}`,
        craft.missionId === null ? 'No active mission' : `Mission ${craft.missionId}`,
      ],
    };
  }
  if (selection.kind === 'mission') {
    const mission = space.missions.find((candidate) => candidate.id === selection.id);
    if (mission === undefined) return null;
    return {
      heading: `${systemLabel(mission.kind)} mission ${mission.id}`,
      lines: [
        `Body ${mission.originBodyId} to body ${mission.destinationBodyId}`,
        `Status: ${systemLabel(mission.status)}`,
        `Departure tick ${mission.departureTick}; due tick ${mission.dueTick}`,
        `Passengers ${mission.passengerCount}`,
      ],
    };
  }
  if (selection.kind === 'colony') {
    const colony = space.colonies.find((candidate) => candidate.id === selection.id);
    if (colony === undefined) return null;
    return {
      heading: `Colony ${colony.id}`,
      lines: [
        `Body ${colony.bodyId}`,
        `Civilization ${colony.civilizationId}`,
        `Residents ${colony.residentCount}`,
        `Status: ${systemLabel(colony.status)}`,
      ],
    };
  }
  if (selection.kind === 'cargo') {
    const cargo = space.cargoTransfers.find((candidate) => candidate.id === selection.id);
    if (cargo === undefined) return null;
    return {
      heading: `Cargo route ${cargo.id}`,
      lines: [
        `Status: ${systemLabel(cargo.status)}`,
        `Departure tick ${cargo.departureTick}; due tick ${cargo.dueTick}`,
        `Civilization ${cargo.civilizationId}`,
      ],
    };
  }
  if (selection.kind === 'communication') {
    const communication = space.communications.find((candidate) => candidate.id === selection.id);
    if (communication === undefined) return null;
    return {
      heading: `${systemLabel(communication.topic)} communication ${communication.id}`,
      lines: [
        `Body ${communication.originBodyId} to body ${communication.destinationBodyId}`,
        `Status: ${systemLabel(communication.status)}`,
        `Sent tick ${communication.sentTick}; due tick ${communication.dueTick}`,
      ],
    };
  }
  const alien = space.aliens.find((candidate) => candidate.id === selection.id);
  if (alien === undefined) return null;
  const relation = space.relations.find((candidate) => candidate.alienId === alien.id);
  return {
    heading: `Contacted civilization ${alien.id}`,
    lines: [
      `Home body ${alien.homeBodyId}`,
      `Observed behavior: ${systemLabel(alien.trait)}`,
      alien.discoveredTick === null
        ? 'Contact unverified'
        : `Discovered tick ${alien.discoveredTick}`,
      relation === undefined
        ? 'No relation recorded'
        : `${systemLabel(relation.status)} relation · trust ${relation.trust} · tension ${relation.tension}`,
    ],
  };
}
