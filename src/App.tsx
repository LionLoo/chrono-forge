import { useMemo, useState } from 'react';

import { getFocusAlerts, type FocusAlerts } from './adapters/focus-alerts';
import { getRuntimePersistence, type RuntimePersistence } from './adapters/runtime-persistence';
import { INITIAL_WORLD_CAMERA, panCamera, zoomCamera } from './rendering/camera';
import { WorldMapCanvas } from './rendering/WorldMapCanvas';
import { WORLD_OVERLAYS, type WorldOverlay } from './rendering/world-palette';
import { PROJECT_META } from './project-meta';
import { FocusPersistencePanel } from './ui/FocusPersistencePanel';
import type { FocusClock } from './ui/useFocusController';
import {
  DEMO_WORLD_SEED,
  useWorldSimulation,
  type SimulationWorkerFactory,
} from './ui/useWorldSimulation';

interface AppProps {
  readonly focusAlerts?: FocusAlerts;
  readonly focusClock?: FocusClock;
  readonly persistence?: RuntimePersistence;
  readonly workerFactory?: SimulationWorkerFactory;
}

function seedLabel(): string {
  return DEMO_WORLD_SEED.map((word) => word.toString(16).padStart(8, '0')).join('-');
}

export function App({ focusAlerts, focusClock, persistence, workerFactory }: AppProps) {
  const simulation = useWorldSimulation(workerFactory);
  const completionAlerts = focusAlerts ?? getFocusAlerts();
  const runtimePersistence = persistence ?? getRuntimePersistence();
  const [camera, setCamera] = useState(INITIAL_WORLD_CAMERA);
  const [overlay, setOverlay] = useState<WorldOverlay>('terrain');
  const deterministicMatch =
    simulation.frame !== null && simulation.frame.stateHash === simulation.mainThreadHash;
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

  const statusCopy =
    simulation.status === 'booting'
      ? 'Forging deterministic world…'
      : simulation.status === 'faulted'
        ? `Simulation fault: ${simulation.error ?? 'unknown error'}`
        : deterministicMatch
          ? 'Worker synchronized · deterministic match'
          : 'Determinism mismatch detected';

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
            <p className="eyebrow">Milestone 2 · Focus becomes history</p>
            <h1 id="hero-title">{PROJECT_META.promise}</h1>
          </div>
          <p>
            Begin a calm session and accepted focus time advances this deterministic world. Local
            saves preserve both civilization state and factual focus history without an account.
          </p>
        </section>

        <div className="lab-grid">
          <section className="world-card" aria-labelledby="world-map-title">
            <header className="card-heading">
              <div>
                <p>Projection 01</p>
                <h2 id="world-map-title">Founding region</h2>
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
                <h2 id="telemetry-title">World telemetry</h2>
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

            <div className="seed-panel">
              <span>Visible 128-bit seed</span>
              <code>{seedLabel()}</code>
            </div>

            <div className="hash-panel">
              <div>
                <span>Worker hash</span>
                <code>{simulation.frame?.stateHash ?? 'waiting'}</code>
              </div>
              <div>
                <span>Main-thread hash</span>
                <code>{simulation.mainThreadHash ?? 'waiting'}</code>
              </div>
            </div>

            <button
              className="advance-button"
              disabled={simulation.status !== 'ready'}
              onClick={() => {
                simulation.advanceTicks(100);
              }}
              type="button"
            >
              Advance 100 fixed ticks
            </button>
            <p className="milestone-note">
              Focus time advances fixed logical ticks; observing or moving the camera never changes
              the authoritative outcome.
            </p>
          </aside>
        </div>

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
