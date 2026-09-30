import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getFocusAlerts, type FocusAlerts } from './adapters/focus-alerts';
import { DEFAULT_APP_SETTINGS, type AppSettings } from './adapters/persistence';
import { getRuntimePersistence, type RuntimePersistence } from './adapters/runtime-persistence';
import {
  deriveAtmosphereScene,
  getGameSoundscape,
  type GameSoundscape,
} from './adapters/soundscape';
import type { FocusRevisitTarget } from './focus/session-review';
import { STRUCTURE_STATE_CODES, type QueuedCommand, type WorldFrameProjection } from './protocol';
import {
  fitCameraToWorld,
  frameCameraOnTile,
  INITIAL_WORLD_CAMERA,
  panCamera,
  zoomCamera,
} from './rendering/camera';
import { WorldMapCanvas } from './rendering/WorldMapCanvas';
import type { SelectableId } from './rendering/render-model';
import { overlayDefinition, WORLD_OVERLAYS, type WorldOverlay } from './rendering/world-palette';
import { PROJECT_META } from './project-meta';
import { FocusPersistencePanel } from './ui/FocusPersistencePanel';
import { useFactualEventSound } from './ui/useFactualEventSound';
import { CivilizationsPanel } from './ui/CivilizationsPanel';
import { DevelopmentPanel } from './ui/DevelopmentPanel';
import { SocietyPanel } from './ui/SocietyPanel';
import { SpacePanel } from './ui/SpacePanel';
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

const AGENT_ACTION_LABELS: Readonly<Record<number, string>> = Object.freeze({
  0: 'idle',
  1: 'foraging',
  2: 'collecting water',
  3: 'gathering timber',
  4: 'gathering stone',
  5: 'transporting goods',
  6: 'constructing',
  7: 'repairing',
  8: 'resting',
});

function selectionKey(selection: SelectableId): string {
  return `${selection.kind}:${selection.id}`;
}

function parseSelectionKey(value: string): SelectableId | null {
  const [kind, idText, extra] = value.split(':');
  const id = Number(idText);
  if (extra !== undefined || !Number.isSafeInteger(id) || id < 1) return null;
  if (
    kind !== 'agent' &&
    kind !== 'structure' &&
    kind !== 'settlement' &&
    kind !== 'route' &&
    kind !== 'ruin' &&
    kind !== 'crisis'
  ) {
    return null;
  }
  return { id, kind };
}

interface AppProps {
  readonly focusAlerts?: FocusAlerts;
  readonly focusClock?: FocusClock;
  readonly persistence?: RuntimePersistence;
  readonly soundscape?: GameSoundscape;
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

function tileForSelection(
  frame: WorldFrameProjection,
  selection: SelectableId | null,
): number | null {
  if (selection === null) return null;
  if (selection.kind === 'agent') {
    const index = frame.agentIds.indexOf(selection.id);
    return index < 0 ? null : (frame.agentTiles[index] ?? null);
  }
  if (selection.kind === 'structure') {
    const index = frame.structureIds.indexOf(selection.id);
    return index < 0 ? null : (frame.structureTiles[index] ?? null);
  }
  if (selection.kind === 'settlement') {
    return (
      frame.civilizations.settlements.find((settlement) => settlement.id === selection.id)
        ?.centerTileIndex ?? null
    );
  }
  if (selection.kind === 'route') {
    const route = frame.civilizations.routes.find((candidate) => candidate.id === selection.id);
    return route === undefined
      ? null
      : (frame.civilizations.settlements.find(
          (settlement) => settlement.id === route.firstSettlementId,
        )?.centerTileIndex ?? null);
  }
  if (selection.kind === 'ruin') {
    const ruin = frame.civilizations.ruins.find((candidate) => candidate.id === selection.id);
    return ruin === undefined
      ? null
      : (frame.civilizations.settlements.find((settlement) => settlement.id === ruin.settlementId)
          ?.centerTileIndex ?? null);
  }
  return null;
}

export function App({ focusAlerts, focusClock, persistence, soundscape, workerFactory }: AppProps) {
  const simulation = useWorldSimulation(workerFactory);
  const completionAlerts = focusAlerts ?? getFocusAlerts();
  const gameSoundscape = soundscape ?? getGameSoundscape();
  const runtimePersistence = persistence ?? getRuntimePersistence();
  const mapFrameRef = useRef<HTMLDivElement>(null);
  const mapDimensionsRef = useRef<string | null>(null);
  const cameraFollowsOverviewRef = useRef(true);
  const [camera, setCamera] = useState(INITIAL_WORLD_CAMERA);
  const [overlay, setOverlay] = useState<WorldOverlay>('terrain');
  const [inspectionOpen, setInspectionOpen] = useState(false);
  const [mapSelection, setMapSelection] = useState<SelectableId | null>(null);
  const [reducedEffects, setReducedEffects] = useState(false);
  const [audioSettings, setAudioSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [interventionPending, setInterventionPending] = useState(false);
  const [interventionStatus, setInterventionStatus] = useState<string | null>(null);
  const atmosphereScene = useMemo(
    () => (simulation.frame === null ? null : deriveAtmosphereScene(simulation.frame)),
    [simulation.frame],
  );

  useEffect(() => {
    if (atmosphereScene === null) return;
    void gameSoundscape.updateAtmosphere(atmosphereScene, audioSettings);
  }, [atmosphereScene, audioSettings, gameSoundscape]);

  useFactualEventSound(simulation.latestRecordedEvents, audioSettings, gameSoundscape);

  useEffect(
    () => () => {
      void gameSoundscape.stop();
    },
    [gameSoundscape],
  );

  const frameWidth = simulation.frame?.width ?? null;
  const frameHeight = simulation.frame?.height ?? null;
  useEffect(() => {
    if (frameWidth === null || frameHeight === null) return;
    const dimensions = `${frameWidth}x${frameHeight}`;
    if (mapDimensionsRef.current === dimensions) return;
    mapDimensionsRef.current = dimensions;
    cameraFollowsOverviewRef.current = true;
    const mapFrame = mapFrameRef.current;
    const viewportWidth = mapFrame?.clientWidth;
    const viewportHeight = mapFrame?.clientHeight;
    setCamera(
      fitCameraToWorld(
        frameWidth,
        frameHeight,
        viewportWidth === undefined || viewportWidth < 1 ? 960 : viewportWidth,
        viewportHeight === undefined || viewportHeight < 1 ? 540 : viewportHeight,
      ),
    );
  }, [frameHeight, frameWidth]);

  const setExploredCamera = useCallback((nextCamera: typeof INITIAL_WORLD_CAMERA) => {
    cameraFollowsOverviewRef.current = false;
    setCamera(nextCamera);
  }, []);
  const refitOverviewOnResize = useCallback(
    (viewportWidth: number, viewportHeight: number) => {
      if (!cameraFollowsOverviewRef.current || frameWidth === null || frameHeight === null) {
        return;
      }
      setCamera(fitCameraToWorld(frameWidth, frameHeight, viewportWidth, viewportHeight));
    },
    [frameHeight, frameWidth],
  );

  const selectMapObject = useCallback(
    (selection: SelectableId | null) => {
      setMapSelection(selection);
      if (selection !== null) void gameSoundscape.playCue('selection', audioSettings);
    },
    [audioSettings, gameSoundscape],
  );
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
  const overlayInfo = overlayDefinition(overlay);
  const selectableObjects = useMemo(() => {
    const frame = simulation.frame;
    if (frame === null) return [];
    const people = new Map(frame.society.people.map((person) => [person.id, person.name]));
    const settlements = new Map(
      frame.civilizations.settlements.map((settlement) => [settlement.id, settlement.name]),
    );
    const choices: { readonly label: string; readonly selection: SelectableId }[] = [];
    for (const id of frame.agentIds) {
      choices.push({
        label: `Person · ${people.get(id) ?? `Agent ${id}`}`,
        selection: { id, kind: 'agent' },
      });
    }
    for (const id of frame.structureIds) {
      const index = frame.structureIds.indexOf(id);
      choices.push({
        label: `${STRUCTURE_KIND_LABELS[frame.structureKinds[index] ?? 0] ?? 'Structure'} · ${id}`,
        selection: { id, kind: 'structure' },
      });
    }
    for (const settlement of frame.civilizations.settlements) {
      choices.push({
        label: `Settlement · ${settlement.name}`,
        selection: { id: settlement.id, kind: 'settlement' },
      });
    }
    for (const route of frame.civilizations.routes) {
      choices.push({
        label: `Trade route · ${settlements.get(route.firstSettlementId) ?? route.firstSettlementId} to ${settlements.get(route.secondSettlementId) ?? route.secondSettlementId}`,
        selection: { id: route.id, kind: 'route' },
      });
    }
    for (const ruin of frame.civilizations.ruins) {
      choices.push({
        label: `Ruin · ${settlements.get(ruin.settlementId) ?? ruin.settlementId}`,
        selection: { id: ruin.id, kind: 'ruin' },
      });
    }
    for (const crisis of frame.development.activeCrises) {
      choices.push({
        label: `Crisis · ${crisis.kind.replaceAll('-', ' ')}`,
        selection: { id: crisis.id, kind: 'crisis' },
      });
    }
    return choices;
  }, [simulation.frame]);
  const activeMapSelection = useMemo(
    () =>
      mapSelection !== null &&
      selectableObjects.some(
        (choice) =>
          choice.selection.kind === mapSelection.kind && choice.selection.id === mapSelection.id,
      )
        ? mapSelection
        : null,
    [mapSelection, selectableObjects],
  );
  // React permits a guarded same-component adjustment during render. Clearing here keeps every
  // committed child on the current authoritative frame and prevents an absent stable ID from
  // resurfacing as a selection if a later frame contains that key again.
  if (mapSelection !== null && activeMapSelection === null) setMapSelection(null);
  const selectedMapDetail = useMemo(() => {
    const frame = simulation.frame;
    if (frame === null || activeMapSelection === null) return null;
    if (activeMapSelection.kind === 'agent') {
      const index = frame.agentIds.indexOf(activeMapSelection.id);
      const person = frame.society.people.find(
        (candidate) => candidate.id === activeMapSelection.id,
      );
      if (index < 0) return null;
      return {
        heading: person?.name ?? `Agent ${activeMapSelection.id}`,
        lines: [
          `Person ${activeMapSelection.id}`,
          `Tile ${frame.agentTiles[index] ?? 0}`,
          `Health ${Math.round((frame.agentHealth[index] ?? 0) / 10)}%`,
          `Current activity: ${AGENT_ACTION_LABELS[frame.agentActions[index] ?? 0] ?? 'unknown'}`,
        ],
      };
    }
    if (activeMapSelection.kind === 'structure') {
      const index = frame.structureIds.indexOf(activeMapSelection.id);
      if (index < 0) return null;
      return {
        heading: `${STRUCTURE_KIND_LABELS[frame.structureKinds[index] ?? 0] ?? 'Structure'} ${activeMapSelection.id}`,
        lines: [
          `Tile ${frame.structureTiles[index] ?? 0}`,
          `Status: ${STRUCTURE_STATUS_LABELS[frame.structureStates[index] ?? 0] ?? 'unknown'}`,
          `Condition ${Math.round((frame.structureCondition[index] ?? 0) / 10)}%`,
          `Construction ${Math.round((frame.structureProgress[index] ?? 0) / 10)}%`,
        ],
      };
    }
    if (activeMapSelection.kind === 'settlement') {
      const settlement = frame.civilizations.settlements.find(
        (candidate) => candidate.id === activeMapSelection.id,
      );
      if (settlement === undefined) return null;
      return {
        heading: settlement.name,
        lines: [
          `Settlement ${settlement.id}`,
          `Development: ${settlement.developmentStage.replaceAll('-', ' ')}`,
          `Population ${settlement.population}`,
          `Status: ${settlement.status}`,
          `Stability ${settlement.stability}%`,
        ],
      };
    }
    if (activeMapSelection.kind === 'route') {
      const route = frame.civilizations.routes.find(
        (candidate) => candidate.id === activeMapSelection.id,
      );
      if (route === undefined) return null;
      return {
        heading: `Trade route ${route.id}`,
        lines: [
          `Settlement ${route.firstSettlementId} to ${route.secondSettlementId}`,
          `Status: ${route.status}`,
          `Volume ${route.volume}`,
          `Began at tick ${route.startedTick}`,
        ],
      };
    }
    if (activeMapSelection.kind === 'ruin') {
      const ruin = frame.civilizations.ruins.find(
        (candidate) => candidate.id === activeMapSelection.id,
      );
      if (ruin === undefined) return null;
      return {
        heading: `Ruin ${ruin.id}`,
        lines: [
          `Former settlement ${ruin.settlementId}`,
          `Cause: ${ruin.cause}`,
          `Recorded at tick ${ruin.createdTick}`,
        ],
      };
    }
    const crisis = frame.development.activeCrises.find(
      (candidate) => candidate.id === activeMapSelection.id,
    );
    if (crisis === undefined) return null;
    return {
      heading: crisis.kind.replaceAll('-', ' '),
      lines: [
        `Active crisis ${crisis.id}`,
        `Severity ${crisis.severity}`,
        `Triggered at tick ${crisis.startedTick}`,
      ],
    };
  }, [activeMapSelection, simulation.frame]);
  const selectedMapTile = useMemo(
    () =>
      simulation.frame === null ? null : tileForSelection(simulation.frame, activeMapSelection),
    [activeMapSelection, simulation.frame],
  );
  const frameMapObject = useCallback(
    (selection: SelectableId | null) => {
      const frame = simulation.frame;
      const tileIndex = frame === null ? null : tileForSelection(frame, selection);
      const mapFrame = mapFrameRef.current;
      if (frame === null || tileIndex === null || mapFrame === null) return;
      setExploredCamera(
        frameCameraOnTile(
          tileIndex,
          frame.width,
          frame.height,
          mapFrame.clientWidth < 1 ? 960 : mapFrame.clientWidth,
          mapFrame.clientHeight < 1 ? 540 : mapFrame.clientHeight,
        ),
      );
    },
    [setExploredCamera, simulation.frame],
  );
  const revisitFocusTarget = useCallback(
    (target: FocusRevisitTarget) => {
      const selection: SelectableId = {
        id: target.id,
        kind: target.kind === 'person' ? 'agent' : target.kind,
      };
      selectMapObject(selection);
      frameMapObject(selection);
      queueMicrotask(() => {
        const inspector = document.getElementById('map-inspector');
        inspector?.focus({ preventScroll: true });
        inspector?.scrollIntoView({
          behavior: reducedEffects ? 'auto' : 'smooth',
          block: 'center',
        });
      });
    },
    [frameMapObject, reducedEffects, selectMapObject],
  );
  const queueIntervention = (command: QueuedCommand) => {
    setInterventionPending(true);
    setInterventionStatus(null);
    void simulation
      .queueCommand(command)
      .then(() => {
        setInterventionStatus('Intervention queued for the next civil-year development pulse.');
      })
      .catch((reason: unknown) => {
        setInterventionStatus(
          reason instanceof Error ? reason.message : 'The intervention request was rejected.',
        );
      })
      .finally(() => {
        setInterventionPending(false);
      });
  };

  const statusCopy =
    simulation.status === 'booting'
      ? 'Forging deterministic world…'
      : simulation.status === 'faulted'
        ? `Simulation fault: ${simulation.error ?? 'unknown error'}`
        : 'Worker projection ready · autonomous world active';

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#main" aria-label="Chrono Forge home">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span>{PROJECT_META.name}</span>
        </a>
        <nav className="topbar-actions" aria-label="Primary navigation">
          <a href="#world-map-title">Explore world</a>
          <a href="#focus-title">Begin focus</a>
          <span className="build-badge">Private world · v{PROJECT_META.version}</span>
        </nav>
      </header>

      <main id="main" className="world-lab" tabIndex={-1}>
        <section className="lab-intro" aria-labelledby="hero-title">
          <div>
            <p className="eyebrow">A civilization shaped by the time you protect</p>
            <h1 id="hero-title">{PROJECT_META.promise}</h1>
          </div>
          <p>
            Settle into a quiet session, then return to named people, changing homes, growing towns,
            difficult seasons, and a history that records only what truly happened in your world.
          </p>
        </section>

        <FocusPersistencePanel
          alerts={completionAlerts}
          onReducedEffectsChange={setReducedEffects}
          onRevisitTarget={revisitFocusTarget}
          onSettingsChange={setAudioSettings}
          runtime={runtimePersistence}
          simulation={simulation}
          soundscape={gameSoundscape}
          {...(focusClock === undefined ? {} : { clock: focusClock })}
        />

        <div className="lab-grid">
          <section className="world-card" aria-labelledby="world-map-title">
            <header className="card-heading">
              <div>
                <p>Live world</p>
                <h2 id="world-map-title">
                  {simulation.frame?.civilizations.settlements[0]?.name ?? 'Founding settlement'}
                </h2>
              </div>
              <div className="world-heading-status">
                <span>
                  {simulation.frame ? `Tick ${simulation.frame.tick}` : 'Preparing world'}
                </span>
                <span>
                  {simulation.frame
                    ? `${simulation.frame.width} × ${simulation.frame.height}`
                    : '—'}
                </span>
              </div>
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

            <div className="map-stage">
              <div className="map-frame" ref={mapFrameRef}>
                {simulation.frame ? (
                  <WorldMapCanvas
                    camera={camera}
                    onCameraChange={setExploredCamera}
                    onSelectionChange={selectMapObject}
                    onViewportResize={refitOverviewOnResize}
                    overlay={overlay}
                    projection={simulation.frame}
                    reducedEffects={reducedEffects}
                    selection={activeMapSelection}
                  />
                ) : (
                  <div className="map-loading" aria-live="polite">
                    <span />
                    Forging the first landscape
                  </div>
                )}
              </div>

              <div className="overlay-legend" aria-live="polite">
                <span
                  aria-hidden="true"
                  className={`overlay-pattern overlay-pattern-${overlayInfo.pattern}`}
                />
                <span>
                  {overlayInfo.legend}. Pattern cue: {overlayInfo.pattern}.
                </span>
              </div>

              <div className="camera-toolbar" aria-label="World camera controls">
                <div className="camera-directions">
                  <button
                    aria-label="Pan world left"
                    onClick={() => {
                      cameraFollowsOverviewRef.current = false;
                      setCamera((current) => panCamera(current, -36, 0));
                    }}
                    type="button"
                  >
                    ←
                  </button>
                  <button
                    aria-label="Pan world up"
                    onClick={() => {
                      cameraFollowsOverviewRef.current = false;
                      setCamera((current) => panCamera(current, 0, -36));
                    }}
                    type="button"
                  >
                    ↑
                  </button>
                  <button
                    aria-label="Pan world down"
                    onClick={() => {
                      cameraFollowsOverviewRef.current = false;
                      setCamera((current) => panCamera(current, 0, 36));
                    }}
                    type="button"
                  >
                    ↓
                  </button>
                  <button
                    aria-label="Pan world right"
                    onClick={() => {
                      cameraFollowsOverviewRef.current = false;
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
                      cameraFollowsOverviewRef.current = false;
                      setCamera((current) => zoomCamera(current, 1 / 1.2));
                    }}
                    type="button"
                  >
                    −
                  </button>
                  <button
                    onClick={() => {
                      const frame = simulation.frame;
                      const mapFrame = mapFrameRef.current;
                      cameraFollowsOverviewRef.current = true;
                      setCamera(
                        frame === null || mapFrame === null
                          ? INITIAL_WORLD_CAMERA
                          : fitCameraToWorld(
                              frame.width,
                              frame.height,
                              mapFrame.clientWidth < 1 ? 960 : mapFrame.clientWidth,
                              mapFrame.clientHeight < 1 ? 540 : mapFrame.clientHeight,
                            ),
                      );
                    }}
                    type="button"
                  >
                    Overview
                  </button>
                  <button
                    aria-label="Zoom world in"
                    onClick={() => {
                      cameraFollowsOverviewRef.current = false;
                      setCamera((current) => zoomCamera(current, 1.2));
                    }}
                    type="button"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            <section
              className="map-inspector"
              aria-labelledby="map-inspector-title"
              id="map-inspector"
              tabIndex={-1}
            >
              <div>
                <h3 id="map-inspector-title">Map selection</h3>
                <p>Pointer selection and this keyboard navigator open the same factual object.</p>
              </div>
              <label>
                Inspect map object
                <select
                  onChange={(event) => {
                    selectMapObject(parseSelectionKey(event.currentTarget.value));
                  }}
                  value={activeMapSelection === null ? '' : selectionKey(activeMapSelection)}
                >
                  <option value="">No object selected</option>
                  {selectableObjects.map((choice) => (
                    <option
                      key={selectionKey(choice.selection)}
                      value={selectionKey(choice.selection)}
                    >
                      {choice.label}
                    </option>
                  ))}
                </select>
              </label>
              {selectedMapDetail === null ? (
                <p className="map-selection-empty">
                  Choose an object to inspect its current Worker-projected facts.
                </p>
              ) : (
                <article aria-label="Selected map object" className="map-selection-detail">
                  <h4>{selectedMapDetail.heading}</h4>
                  <ul>
                    {selectedMapDetail.lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  {selectedMapTile === null ? null : (
                    <button
                      onClick={() => {
                        frameMapObject(activeMapSelection);
                      }}
                      type="button"
                    >
                      Frame selection
                    </button>
                  )}
                </article>
              )}
            </section>
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

            <p className="milestone-note">
              Only accepted focus time advances the live world directly. Observing, moving the
              camera, changing overlays, and revisiting factual objects never changes an autonomous
              outcome.
            </p>
          </aside>
        </div>

        <section className="inspection-shell" aria-labelledby="inspection-shell-title">
          <div>
            <p className="eyebrow">Optional world detail</p>
            <h2 id="inspection-shell-title">World inspection</h2>
            <p>
              Open this only when you want to explore people, families, relationships,
              civilizations, research, and factual history. It stays out of the calm focus surface
              by default.
            </p>
          </div>
          <button
            aria-controls="world-inspection-region"
            aria-expanded={inspectionOpen}
            disabled={simulation.frame === null}
            onClick={() => {
              setInspectionOpen((current) => !current);
            }}
            type="button"
          >
            {inspectionOpen ? 'Close world inspection' : 'Open world inspection'}
          </button>
        </section>

        {simulation.frame === null || !inspectionOpen ? null : (
          <div className="inspection-region" id="world-inspection-region">
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
            <CivilizationsPanel
              civilizations={simulation.frame.civilizations}
              cultureNames={
                new Map(
                  simulation.frame.society.cultures.map((culture) => [culture.id, culture.name]),
                )
              }
              personNames={
                new Map(simulation.frame.society.people.map((person) => [person.id, person.name]))
              }
            />
            <SpacePanel space={simulation.frame.space} />
            <DevelopmentPanel
              development={simulation.frame.development}
              disabled={simulation.status !== 'ready'}
              isPending={interventionPending}
              onQueueIntervention={queueIntervention}
              targetTileIndex={simulation.frame.agentTiles[0] ?? 0}
            />
            {interventionStatus === null ? null : (
              <p className="intervention-status" role="status">
                {interventionStatus}
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
