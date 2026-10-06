import type { KeyboardEvent } from 'react';

import type { SpaceProjection } from '../protocol';
import { panCamera, zoomCamera, type WorldCamera } from './camera';
import {
  sameSystemSelection,
  systemBodyLayout,
  systemEndpointBodyId,
  systemLabel,
  type SystemPoint,
  type SystemSelection,
} from './system-map-model';

const SYSTEM_WIDTH = 1_000;
const SYSTEM_HEIGHT = 600;
const SYSTEM_CENTER_X = SYSTEM_WIDTH / 2;
const SYSTEM_CENTER_Y = SYSTEM_HEIGHT / 2;

function bodyPoint(points: ReadonlyMap<number, SystemPoint>, bodyId: number): SystemPoint {
  return points.get(bodyId) ?? { bodyId, x: 0, y: 0 };
}

function activate(
  event: KeyboardEvent<SVGGElement>,
  selection: SystemSelection,
  onSelectionChange: (selection: SystemSelection) => void,
): void {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  onSelectionChange(selection);
}

export function SystemMap({
  camera,
  onCameraChange,
  onSelectionChange,
  selection,
  space,
}: {
  readonly camera: WorldCamera;
  readonly onCameraChange: (camera: WorldCamera) => void;
  readonly onSelectionChange: (selection: SystemSelection) => void;
  readonly selection: SystemSelection | null;
  readonly space: SpaceProjection;
}) {
  const layout = systemBodyLayout(space.bodies);
  const points = new Map(layout.map((point) => [point.bodyId, point]));
  const bodyById = new Map(space.bodies.map((body) => [body.id, body]));
  const homeBodyId = space.bodies.find((body) => body.kind === 'home')?.id ?? 1;
  const route = (
    key: string,
    originBodyId: number | null,
    destinationBodyId: number | null,
    routeSelection: SystemSelection,
    routeLabel: string,
    className: string,
  ) => {
    if (originBodyId === null || destinationBodyId === null) return null;
    const origin = bodyPoint(points, originBodyId);
    const destination = bodyPoint(points, destinationBodyId);
    return (
      <g
        aria-label={routeLabel}
        className={`${className}${sameSystemSelection(selection, routeSelection) ? ' is-selected' : ''}`}
        key={key}
        onClick={() => onSelectionChange(routeSelection)}
        onKeyDown={(event) => activate(event, routeSelection, onSelectionChange)}
        role="button"
        tabIndex={0}
      >
        <line x1={origin.x} x2={destination.x} y1={origin.y} y2={destination.y} />
      </g>
    );
  };

  return (
    <div
      aria-label="Known celestial system map"
      className="system-map"
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'ArrowLeft') onCameraChange(panCamera(camera, -36, 0));
        else if (event.key === 'ArrowRight') onCameraChange(panCamera(camera, 36, 0));
        else if (event.key === 'ArrowUp') onCameraChange(panCamera(camera, 0, -36));
        else if (event.key === 'ArrowDown') onCameraChange(panCamera(camera, 0, 36));
        else if (event.key === '+' || event.key === '=') {
          onCameraChange(zoomCamera(camera, 1.2));
        } else if (event.key === '-' || event.key === '_') {
          onCameraChange(zoomCamera(camera, 1 / 1.2));
        } else return;
        event.preventDefault();
      }}
      role="region"
      tabIndex={0}
    >
      <svg preserveAspectRatio="xMidYMid meet" viewBox={`0 0 ${SYSTEM_WIDTH} ${SYSTEM_HEIGHT}`}>
        <defs>
          <radialGradient id="system-map-glow">
            <stop offset="0" stopColor="#f4cd7b" stopOpacity="0.28" />
            <stop offset="1" stopColor="#f4cd7b" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g
          transform={`translate(${SYSTEM_CENTER_X + camera.x} ${SYSTEM_CENTER_Y + camera.y}) scale(${camera.zoom})`}
        >
          <circle className="system-map-glow" cx={0} cy={0} r={86} />
          {layout
            .filter((point) => bodyById.get(point.bodyId)?.kind !== 'home')
            .map((point) => (
              <circle
                className="system-orbit"
                cx={0}
                cy={0}
                key={`orbit-${point.bodyId}`}
                r={Math.hypot(point.x, point.y)}
              />
            ))}
          {space.missions.map((mission) =>
            route(
              `mission-${mission.id}`,
              mission.originBodyId,
              mission.destinationBodyId,
              { id: mission.id, kind: 'mission' },
              `${systemLabel(mission.kind)} mission ${mission.id}, ${systemLabel(mission.status)}`,
              `system-route system-route-mission system-route-${mission.status}`,
            ),
          )}
          {space.cargoTransfers.map((cargo) =>
            route(
              `cargo-${cargo.id}`,
              systemEndpointBodyId(cargo.origin, space),
              systemEndpointBodyId(cargo.destination, space),
              { id: cargo.id, kind: 'cargo' },
              `Cargo route ${cargo.id}, ${systemLabel(cargo.status)}`,
              `system-route system-route-cargo system-route-${cargo.status}`,
            ),
          )}
          {space.communications.map((communication) =>
            route(
              `communication-${communication.id}`,
              communication.originBodyId,
              communication.destinationBodyId,
              { id: communication.id, kind: 'communication' },
              `${systemLabel(communication.topic)} communication ${communication.id}, ${systemLabel(communication.status)}`,
              `system-route system-route-communication system-route-${communication.status}`,
            ),
          )}
          {layout.map((point) => {
            const body = bodyById.get(point.bodyId);
            if (body === undefined) return null;
            const bodySelection: SystemSelection = { id: body.id, kind: 'body' };
            const colonies = space.colonies.filter((colony) => colony.bodyId === body.id);
            const aliens = space.aliens.filter((alien) => alien.homeBodyId === body.id);
            return (
              <g key={`body-group-${body.id}`} transform={`translate(${point.x} ${point.y})`}>
                <g
                  aria-label={`${body.name}, ${systemLabel(body.kind)} body`}
                  className={`system-body system-body-${body.kind}${sameSystemSelection(selection, bodySelection) ? ' is-selected' : ''}`}
                  onClick={() => onSelectionChange(bodySelection)}
                  onKeyDown={(event) => activate(event, bodySelection, onSelectionChange)}
                  role="button"
                  tabIndex={0}
                >
                  <circle r={body.kind === 'home' ? 18 : body.kind === 'asteroid' ? 8 : 13} />
                  <text x={body.kind === 'home' ? 25 : 18} y={5}>
                    {body.name}
                  </text>
                </g>
                {colonies.map((colony, index) => {
                  const colonySelection: SystemSelection = { id: colony.id, kind: 'colony' };
                  return (
                    <g
                      aria-label={`Colony ${colony.id}, ${systemLabel(colony.status)}`}
                      className={`system-colony${sameSystemSelection(selection, colonySelection) ? ' is-selected' : ''}`}
                      key={`colony-${colony.id}`}
                      onClick={() => onSelectionChange(colonySelection)}
                      onKeyDown={(event) => activate(event, colonySelection, onSelectionChange)}
                      role="button"
                      tabIndex={0}
                      transform={`translate(${18 + index * 9} ${-18 - index * 5})`}
                    >
                      <rect height={8} width={8} x={-4} y={-4} />
                    </g>
                  );
                })}
                {aliens.map((alien, index) => {
                  const alienSelection: SystemSelection = { id: alien.id, kind: 'alien' };
                  return (
                    <g
                      aria-label={`Contacted civilization ${alien.id}, ${systemLabel(alien.trait)}`}
                      className={`system-alien${sameSystemSelection(selection, alienSelection) ? ' is-selected' : ''}`}
                      key={`alien-${alien.id}`}
                      onClick={() => onSelectionChange(alienSelection)}
                      onKeyDown={(event) => activate(event, alienSelection, onSelectionChange)}
                      role="button"
                      tabIndex={0}
                      transform={`translate(${-18 - index * 8} ${-18 - index * 5})`}
                    >
                      <path d="M 0 -6 L 6 5 L -6 5 Z" />
                    </g>
                  );
                })}
              </g>
            );
          })}
          {space.spacecraft.map((craft, index) => {
            const point = bodyPoint(points, craft.currentBodyId || homeBodyId);
            const craftSelection: SystemSelection = { id: craft.id, kind: 'spacecraft' };
            return (
              <g
                aria-label={`Spacecraft ${craft.id}, ${systemLabel(craft.status)}`}
                className={`system-spacecraft${sameSystemSelection(selection, craftSelection) ? ' is-selected' : ''}`}
                key={`spacecraft-${craft.id}`}
                onClick={() => onSelectionChange(craftSelection)}
                onKeyDown={(event) => activate(event, craftSelection, onSelectionChange)}
                role="button"
                tabIndex={0}
                transform={`translate(${point.x + 10 + (index % 3) * 7} ${point.y + 14 + (index % 2) * 7})`}
              >
                <path d="M 0 -7 L 5 6 L 0 3 L -5 6 Z" />
              </g>
            );
          })}
        </g>
      </svg>
      <p className="system-map-summary">
        {space.bodies.length} known {space.bodies.length === 1 ? 'body' : 'bodies'} ·{' '}
        {space.missions.filter((mission) => mission.status === 'active').length} active missions ·{' '}
        {space.colonies.filter((colony) => colony.status === 'active').length} active colonies ·{' '}
        {space.aliens.length} contacted civilizations
      </p>
    </div>
  );
}
