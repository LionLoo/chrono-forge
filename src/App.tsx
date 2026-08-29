import { useMemo, useState } from 'react';

import { getFocusAlerts, type FocusAlerts } from './adapters/focus-alerts';
import { getRuntimePersistence, type RuntimePersistence } from './adapters/runtime-persistence';
import { STRUCTURE_STATE_CODES } from './protocol';
import { INITIAL_WORLD_CAMERA, panCamera, zoomCamera } from './rendering/camera';
import { WorldMapCanvas } from './rendering/WorldMapCanvas';
import { WORLD_OVERLAYS, type WorldOverlay } from './rendering/world-palette';
import { PROJECT_META } from './project-meta';
import { FocusPersistencePanel } from './ui/FocusPersistencePanel';
import { SocietyPanel } from './ui/SocietyPanel';
import type { FocusClock } from './ui/useFocusController';
import {
  DEMO_WORLD_SEED,
  useWorldSimulation,
  type SimulationWorkerFactory,
} from './ui/useWorldSimulation';

const STRUCTURE_KIND_LABELS: Readonly<Record<number, string>> = Object.freeze({
  1: 'Shelter',
  2: 'Storehouse',
});

const STRUCTURE_STATUS_LABELS: Readonly<Record<number, string>> = Object.freeze({
  [STRUCTURE_STATE_CODES.planned]: 'planned',
  [STRUCTURE_STATE_CODES.building]: 'under construction',
  [STRUCTURE_STATE_CODES.operational]: 'operational',
  [STRUCTURE_STATE_CODES.damaged]: 'damaged',
  [STRUCTURE_STATE_CODES.abandoned]: 'abandoned',
  [STRUCTURE_STATE_CODES.demolished]: 'demolished',
});

interface AppProps {
  readonly focusAlerts?: FocusAlerts;
  readonly focusClock?: FocusClock;
  readonly persistence?: RuntimePersistence;
  readonly workerFactory?: SimulationWorkerFactory;
}

function seedLabel(): string {
  return DEMO_WORLD_SEED.map((word) => word.toString(16).padStart(8, '0')).join('-');
}

function factualEventCopy(event: { readonly summary: string }): string {
  return event.summary;
}

function conditionTier(condition: number): 'sound' | 'worn' | 'critical' {
  if (condition >= 667) return 'sound';
  if (condition >= 334) return 'worn';
  return 'critical';
}

export function App({ focusAlerts, focusClock, persistence, workerFactory }: AppProps) {
  const simulation = useWorldSimulation(workerFactory);
  const completionAlerts = focusAlerts ?? getFocusAlerts();
  const runtimePersistence = persistence ?? getRuntimePersistence();
  const [camera, setCamera] = useState(INITIAL_WORLD_CAMERA);
  const [overlay, setOverlay] = useState<WorldOverlay>('terrain');
  const worldSummary = useMemo(() => {
    const frame = simulation.frame;
    if (frame === null) return null;

    let habitableTiles = 0;
    let resourceTiles = 0;
    for (let index = 0; index < frame.habitability.length; index += 1) {
      if ((frame.habitability[index] ?? 0) >= 128) habitableTiles += 1;
      if ((frame.resource[index] ?? 0) >= 1_000) resourceTiles += 1;
    }
    return { habitableTiles, resourceTiles, totalTiles: frame.width * frame.height };
  }, [simulation.frame]);
  const constructionSummary = useMemo(() => {
    const frame = simulation.frame;
    if (frame === null || frame.settlementSummary.activeConstruction === 0) return null;

    let progressTotal = 0;
    let activeCount = 0;
    for (let index = 0; index < frame.structureProgress.length; index += 1) {
      const progress = frame.structureProgress[index] ?? 0;
      const state = frame.structureStates[index] ?? 0;
      if (state === STRUCTURE_STATE_CODES.planned || state === STRUCTURE_STATE_CODES.building) {
        progressTotal += progress;
        activeCount += 1;
      }
    }
    const denominator =
      activeCount === 0 ? frame.settlementSummary.activeConstruction : activeCount;
    return {
      count: frame.settlementSummary.activeConstruction,
      percent: Math.round((progressTotal * 100) / (1_000 * denominator)),
    };
  }, [simulation.frame]);
  const lowestStructureCondition = useMemo(() => {
    const conditions = simulation.frame?.structureCondition;
    if (conditions === undefined || conditions.length === 0) return null;
    let lowest = 1_000;
    for (const condition of conditions) {
      lowest = Math.min(lowest, condition);
    }
    return Math.round(lowest / 10);
  }, [simulation.frame]);
  const visibleStructures = useMemo(() => {
    const frame = simulation.frame;
    if (frame === null) return [];

    return Array.from(frame.structureIds, (id, index) => {
      const condition = frame.structureCondition[index] ?? 0;
      return {
        condition: Math.round(condition / 10),
        conditionTier: conditionTier(condition),
        id,
        kind: STRUCTURE_KIND_LABELS[frame.structureKinds[index] ?? 0] ?? 'Structure',
        progress: Math.round((frame.structureProgress[index] ?? 0) / 10),
        status: STRUCTURE_STATUS_LABELS[frame.structureStates[index] ?? 0] ?? 'unknown status',
        tile: frame.structureTiles[index] ?? 0,
      };
    });
  }, [simulation.frame]);
  const recentEvents = useMemo(() => simulation.events.slice(-4).reverse(), [simulation.events]);

  const statusCopy =
    simulation.status === 'booting'
      ? 'Forging deterministic world…'
      : simulation.status === 'faulted'
        ? `Simulation fault: ${simulation.error ?? 'unknown error'}`
        : 'Worker projection ready · autonomous settlement active';

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#main" aria-label="Chrono Forge home">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span>{PROJECT_META.name}</span>
        </a>
        <span className="build-badge">v{PROJECT_META.version} · focus forge</span>
      </header>

      <main id="main" className="world-lab" tabIndex={-1}>
        <section className="lab-intro" aria-labelledby="hero-title">
          <div>
            <p className="eyebrow">Milestone 4 · A living society takes shape</p>
            <h1 id="hero-title">{PROJECT_META.promise}</h1>
          </div>
          <p>
            Begin a calm session and accepted focus time advances a Worker-owned settlement. Named
            people choose their own work and build culture across many sessions; every displayed
            history claim comes from an authoritative event.
          </p>
        </section>

        <div className="lab-grid">
          <section className="world-card" aria-labelledby="world-map-title">
            <header className="card-heading">
              <div>
                <p>Projection 01</p>
                <h2 id="world-map-title">Founding settlement</h2>
              </div>
              <span>
                {simulation.frame ? `${simulation.frame.width} × ${simulation.frame.height}` : '—'}
              </span>
            </header>

            <fieldset className="overlay-picker">
              <legend>Map overlay</legend>
              {WORLD_OVERLAYS.map((option) => (
                <label key={option.value}>
                  <input
                    checked={overlay === option.value}
                    name="world-overlay"
                    onChange={() => {
                      setOverlay(option.value);
                    }}
                    type="radio"
                    value={option.value}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </fieldset>

            <div className="map-frame">
              {simulation.frame ? (
                <WorldMapCanvas
                  camera={camera}
                  onCameraChange={setCamera}
                  overlay={overlay}
                  projection={simulation.frame}
                />
              ) : (
                <div className="map-loading" aria-live="polite">
                  <span />
                  Generating seeded terrain
                </div>
              )}
            </div>

            <div className="camera-toolbar" aria-label="World camera controls">
              <div className="camera-directions">
                <button
                  aria-label="Pan world left"
                  onClick={() => {
                    setCamera((current) => panCamera(current, -36, 0));
                  }}
                  type="button"
                >
                  ←
                </button>
                <button
                  aria-label="Pan world up"
                  onClick={() => {
                    setCamera((current) => panCamera(current, 0, -36));
                  }}
                  type="button"
                >
                  ↑
                </button>
                <button
                  aria-label="Pan world down"
                  onClick={() => {
                    setCamera((current) => panCamera(current, 0, 36));
                  }}
                  type="button"
                >
                  ↓
                </button>
                <button
                  aria-label="Pan world right"
                  onClick={() => {
                    setCamera((current) => panCamera(current, 36, 0));
                  }}
                  type="button"
                >
                  →
                </button>
              </div>
              <span className="camera-readout" aria-label="Camera position">
                X {Math.round(camera.x)} · Y {Math.round(camera.y)} · {camera.zoom.toFixed(2)}×
              </span>
              <div className="zoom-controls">
                <button
                  aria-label="Zoom world out"
                  onClick={() => {
                    setCamera((current) => zoomCamera(current, 1 / 1.2));
                  }}
                  type="button"
                >
                  −
                </button>
                <button
                  onClick={() => {
                    setCamera(INITIAL_WORLD_CAMERA);
                  }}
                  type="button"
                >
                  Reset
                </button>
                <button
                  aria-label="Zoom world in"
                  onClick={() => {
                    setCamera((current) => zoomCamera(current, 1.2));
                  }}
                  type="button"
                >
                  +
                </button>
              </div>
            </div>
          </section>

          <aside className="telemetry-card" aria-labelledby="telemetry-title">
            <header className="card-heading">
              <div>
                <p>Authoritative simulation</p>
                <h2 id="telemetry-title">Settlement status</h2>
              </div>
            </header>

            <div
              className={`simulation-status simulation-status-${simulation.status}`}
              role="status"
              aria-live="polite"
            >
              <span aria-hidden="true" />
              {statusCopy}
            </div>

            <dl className="world-metrics">
              <div>
                <dt>Logical tick</dt>
                <dd>{simulation.frame?.tick ?? '—'}</dd>
              </div>
              <div>
                <dt>Living people</dt>
                <dd>{simulation.frame?.settlementSummary.population ?? '—'}</dd>
              </div>
              <div>
                <dt>Operational structures</dt>
                <dd>{simulation.frame?.settlementSummary.operationalStructures ?? '—'}</dd>
              </div>
              <div>
                <dt>Shelter capacity</dt>
                <dd>{simulation.frame?.settlementSummary.shelterCapacity ?? '—'}</dd>
              </div>
              <div>
                <dt>Lowest structure condition</dt>
                <dd>{lowestStructureCondition === null ? '—' : `${lowestStructureCondition}%`}</dd>
              </div>
              <div>
                <dt>Habitable tiles</dt>
                <dd>
                  {worldSummary
                    ? `${worldSummary.habitableTiles} / ${worldSummary.totalTiles}`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>Resource-rich tiles</dt>
                <dd>{worldSummary?.resourceTiles ?? '—'}</dd>
              </div>
            </dl>

            <dl className="settlement-stores" aria-label="Settlement stores">
              <div>
                <dt>Food</dt>
                <dd>{simulation.frame?.settlementSummary.food ?? '—'}</dd>
              </div>
              <div>
                <dt>Water</dt>
                <dd>{simulation.frame?.settlementSummary.water ?? '—'}</dd>
              </div>
              <div>
                <dt>Timber</dt>
                <dd>{simulation.frame?.settlementSummary.timber ?? '—'}</dd>
              </div>
              <div>
                <dt>Stone</dt>
                <dd>{simulation.frame?.settlementSummary.stone ?? '—'}</dd>
              </div>
            </dl>

            {constructionSummary ? (
              <div className="construction-status">
                <span>
                  Active construction: {constructionSummary.count} structure
                  {constructionSummary.count === 1 ? '' : 's'}
                </span>
                <progress
                  aria-label={`Construction progress, ${constructionSummary.percent}%`}
                  max={100}
                  value={constructionSummary.percent}
                >
                  {constructionSummary.percent}%
                </progress>
                <strong>{constructionSummary.percent}% complete</strong>
              </div>
            ) : (
              <p className="construction-idle">No active construction.</p>
            )}

            <section className="structure-inspector" aria-labelledby="visible-structures-title">
              <h3 id="visible-structures-title">Visible structures</h3>
              {visibleStructures.length === 0 ? (
                <p>No structures are visible in this projection.</p>
              ) : (
                <ul>
                  {visibleStructures.map((structure) => (
                    <li
                      aria-label={`${structure.kind} ${structure.id}: status ${structure.status}; condition ${structure.condition}% (${structure.conditionTier}); progress ${structure.progress}%; tile ${structure.tile}.`}
                      key={structure.id}
                    >
                      <span
                        aria-hidden="true"
                        className={`structure-condition-marker structure-condition-marker-${structure.conditionTier}`}
                      />
                      <span>
                        {structure.kind} {structure.id}: status {structure.status}; condition{' '}
                        {structure.condition}% ({structure.conditionTier}); progress{' '}
                        {structure.progress}%; tile {structure.tile}.
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="factual-events" aria-labelledby="factual-events-title">
              <h3 id="factual-events-title">Recent factual events</h3>
              {recentEvents.length === 0 ? (
                <p>No authoritative events recorded yet.</p>
              ) : (
                <ol>
                  {recentEvents.map((event) => (
                    <li key={event.id}>{factualEventCopy(event)}</li>
                  ))}
                </ol>
              )}
            </section>

            <div className="seed-panel">
              <span>Visible 128-bit seed</span>
              <code>{seedLabel()}</code>
            </div>

            <button
              className="advance-button"
              disabled={simulation.status !== 'ready'}
              onClick={() => {
                simulation.advanceTicks(100);
              }}
              type="button"
            >
              Observe 100 fixed ticks
            </button>
            <p className="milestone-note">
              Focus time advances fixed logical ticks. Observing, moving the camera, and changing
              overlays never changes an autonomous outcome.
            </p>
          </aside>
        </div>

        {simulation.frame === null ? null : (
          <SocietyPanel
            cultures={simulation.frame.society.cultures}
            dashboard={simulation.frame.society.dashboard}
            relationshipEventPage={simulation.relationshipEventPage}
            relationshipPage={simulation.relationshipPage}
            onRelationshipEventPageRequest={simulation.requestRelationshipEventPage}
            onRelationshipPageRequest={simulation.requestRelationshipPage}
            onTimelinePageRequest={simulation.requestTimelinePage}
            people={simulation.frame.society.people}
            timeline={simulation.timeline.entries}
            timelineOffset={simulation.timeline.offset}
            timelineTotal={simulation.timeline.total}
          />
        )}

        <FocusPersistencePanel
          alerts={completionAlerts}
          runtime={runtimePersistence}
          simulation={simulation}
          {...(focusClock === undefined ? {} : { clock: focusClock })}
        />
      </main>
    </div>
  );
}
