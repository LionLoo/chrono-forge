import 'pixi.js/unsafe-eval';

import { Application, Container, Graphics } from 'pixi.js';
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

import { STRUCTURE_STATE_CODES } from '../protocol';
import { panCamera, zoomCamera, type WorldCamera } from './camera';
import { colorForTile, type WorldOverlay } from './world-palette';

export interface WorldMapProjection {
  readonly width: number;
  readonly height: number;
  readonly biome: Uint8Array;
  readonly resource: Uint16Array;
  readonly habitability: Uint8Array;
  readonly hazard: Uint8Array;
  readonly agentIds: Uint32Array;
  readonly agentTiles: Uint32Array;
  readonly agentHealth: Uint16Array;
  readonly agentActions: Uint8Array;
  readonly structureIds: Uint32Array;
  readonly structureTiles: Uint32Array;
  readonly structureKinds: Uint8Array;
  readonly structureStates: Uint8Array;
  readonly structureProgress: Uint16Array;
  readonly structureCondition: Uint16Array;
}

interface WorldMapCanvasProps {
  readonly camera: WorldCamera;
  readonly onCameraChange: (camera: WorldCamera) => void;
  readonly overlay: WorldOverlay;
  readonly projection: WorldMapProjection;
}

interface PixiScene {
  readonly application: Application;
  readonly terrainGraphics: Graphics;
  readonly structureGraphics: Graphics;
  readonly agentGraphics: Graphics;
  readonly worldLayer: Container;
  lastOverlay: WorldOverlay | null;
  lastProjection: WorldMapProjection | null;
}

const TILE_SIZE = 6;

function drawTerrain(
  graphics: Graphics,
  projection: WorldMapProjection,
  overlay: WorldOverlay,
): void {
  graphics.clear();

  for (let index = 0; index < projection.biome.length; index += 1) {
    const x = index % projection.width;
    const y = Math.floor(index / projection.width);
    graphics
      .rect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE + 0.25, TILE_SIZE + 0.25)
      .fill(
        colorForTile(
          overlay,
          projection.biome[index] ?? 0,
          projection.resource[index] ?? 0,
          projection.habitability[index] ?? 0,
          projection.hazard[index] ?? 0,
        ),
      );
  }
}

function drawStructures(graphics: Graphics, projection: WorldMapProjection): void {
  graphics.clear();
  for (let index = 0; index < projection.structureIds.length; index += 1) {
    const tile = projection.structureTiles[index] ?? 0;
    const x = (tile % projection.width) * TILE_SIZE;
    const y = Math.floor(tile / projection.width) * TILE_SIZE;
    const kind = projection.structureKinds[index] ?? 0;
    const state = projection.structureStates[index] ?? 0;
    const progress = projection.structureProgress[index] ?? 0;
    const condition = projection.structureCondition[index] ?? 0;
    const fill = kind === 1 ? 0xd7b56a : 0x82a9b8;
    const outline = condition >= 667 ? 0xf5ead1 : condition >= 334 ? 0xd78b4b : 0xd75454;

    // One, two, or three dark marks are a redundant condition cue; their count does not rely on
    // the outline's color tier.
    const markCount = condition >= 667 ? 1 : condition >= 334 ? 2 : 3;
    for (let mark = 0; mark < markCount; mark += 1) {
      graphics.rect(x + 1 + mark * 1.4, y + 1, 0.8, 0.8).fill(0x0b1510);
    }

    if (state === STRUCTURE_STATE_CODES.planned) {
      graphics
        .rect(x + 0.5, y + 0.5, TILE_SIZE - 1, TILE_SIZE - 1)
        .stroke({ color: outline, width: 1 });
      continue;
    }

    if (state === STRUCTURE_STATE_CODES.building) {
      const height = Math.max(1, Math.round(((TILE_SIZE - 1) * progress) / 1_000));
      graphics.rect(x + 1, y + TILE_SIZE - height, TILE_SIZE - 2, height).fill(fill);
      graphics
        .rect(x + 0.5, y + 0.5, TILE_SIZE - 1, TILE_SIZE - 1)
        .stroke({ color: outline, width: 1 });
      continue;
    }

    graphics.circle(x + TILE_SIZE / 2, y + TILE_SIZE / 2, TILE_SIZE / 2 - 1).fill(fill);
    graphics
      .circle(x + TILE_SIZE / 2, y + TILE_SIZE / 2, TILE_SIZE / 2 - 1)
      .stroke({ color: outline, width: 1 });
  }
}

function drawAgents(graphics: Graphics, projection: WorldMapProjection): void {
  graphics.clear();
  for (let index = 0; index < projection.agentIds.length; index += 1) {
    const tile = projection.agentTiles[index] ?? 0;
    const x = (tile % projection.width) * TILE_SIZE + TILE_SIZE / 2;
    const y = Math.floor(tile / projection.width) * TILE_SIZE + TILE_SIZE / 2;
    const health = projection.agentHealth[index] ?? 0;
    const action = projection.agentActions[index] ?? 0;
    const fill = health >= 667 ? 0xf4ede0 : health >= 334 ? 0xe2ac55 : 0xd75d55;

    graphics.circle(x, y, 1.35).fill(fill).stroke({ color: 0x0b1510, width: 0.65 });
    if (action % 2 === 0) graphics.rect(x - 0.4, y - 2.2, 0.8, 0.8).fill(0xf5ead1);
    else graphics.rect(x + 1.45, y - 0.4, 0.8, 0.8).fill(0xf5ead1);
  }
}

function equalValues(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function terrainChanged(
  previous: WorldMapProjection | null,
  next: WorldMapProjection,
  previousOverlay: WorldOverlay | null,
  overlay: WorldOverlay,
): boolean {
  return (
    previous === null ||
    previousOverlay !== overlay ||
    !equalValues(previous.biome, next.biome) ||
    !equalValues(previous.resource, next.resource) ||
    !equalValues(previous.habitability, next.habitability) ||
    !equalValues(previous.hazard, next.hazard)
  );
}

function structuresChanged(previous: WorldMapProjection | null, next: WorldMapProjection): boolean {
  return (
    previous === null ||
    !equalValues(previous.structureIds, next.structureIds) ||
    !equalValues(previous.structureTiles, next.structureTiles) ||
    !equalValues(previous.structureKinds, next.structureKinds) ||
    !equalValues(previous.structureStates, next.structureStates) ||
    !equalValues(previous.structureProgress, next.structureProgress) ||
    !equalValues(previous.structureCondition, next.structureCondition)
  );
}

function agentsChanged(previous: WorldMapProjection | null, next: WorldMapProjection): boolean {
  return (
    previous === null ||
    !equalValues(previous.agentIds, next.agentIds) ||
    !equalValues(previous.agentTiles, next.agentTiles) ||
    !equalValues(previous.agentHealth, next.agentHealth) ||
    !equalValues(previous.agentActions, next.agentActions)
  );
}

function applyProjection(
  scene: PixiScene,
  projection: WorldMapProjection,
  overlay: WorldOverlay,
): void {
  const previous = scene.lastProjection;
  if (terrainChanged(previous, projection, scene.lastOverlay, overlay)) {
    drawTerrain(scene.terrainGraphics, projection, overlay);
  }
  if (structuresChanged(previous, projection)) drawStructures(scene.structureGraphics, projection);
  if (agentsChanged(previous, projection)) drawAgents(scene.agentGraphics, projection);
  scene.lastOverlay = overlay;
  scene.lastProjection = projection;
}

export function WorldMapCanvas({
  camera,
  onCameraChange,
  overlay,
  projection,
}: WorldMapCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<PixiScene | null>(null);
  const cameraRef = useRef(camera);
  const onCameraChangeRef = useRef(onCameraChange);
  const overlayRef = useRef(overlay);
  const projectionRef = useRef(projection);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  useEffect(() => {
    cameraRef.current = camera;
    onCameraChangeRef.current = onCameraChange;
    overlayRef.current = overlay;
    projectionRef.current = projection;
  }, [camera, onCameraChange, overlay, projection]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    const application = new Application();

    void application
      .init({
        antialias: false,
        autoDensity: true,
        background: '#0b1510',
        preference: 'webgl',
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        resizeTo: host,
      })
      .then(() => {
        if (disposed) {
          application.destroy(true, { children: true });
          return;
        }

        const worldLayer = new Container();
        const terrainGraphics = new Graphics();
        const structureGraphics = new Graphics();
        const agentGraphics = new Graphics();
        worldLayer.addChild(terrainGraphics, structureGraphics, agentGraphics);
        application.stage.addChild(worldLayer);
        const canvas = application.canvas;
        canvas.setAttribute(
          'aria-label',
          `Autonomous settlement map with ${projectionRef.current.agentIds.length} visible agents and ${projectionRef.current.structureIds.length} structures`,
        );
        canvas.setAttribute('role', 'img');
        canvas.tabIndex = 0;
        host.appendChild(canvas);

        const scene: PixiScene = {
          application,
          terrainGraphics,
          structureGraphics,
          agentGraphics,
          worldLayer,
          lastOverlay: null,
          lastProjection: null,
        };
        sceneRef.current = scene;
        applyProjection(scene, projectionRef.current, overlayRef.current);
        worldLayer.position.set(cameraRef.current.x, cameraRef.current.y);
        worldLayer.scale.set(cameraRef.current.zoom);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          host.dataset.renderError =
            error instanceof Error ? error.message : 'Renderer unavailable';
        }
        application.destroy(true, { children: true });
      });

    return () => {
      disposed = true;
      if (sceneRef.current?.application === application) {
        sceneRef.current = null;
        application.destroy(true, { children: true });
      }
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    applyProjection(scene, projection, overlay);
    scene.application.canvas.setAttribute(
      'aria-label',
      `Autonomous settlement map with ${projection.agentIds.length} visible agents and ${projection.structureIds.length} structures`,
    );
    scene.worldLayer.position.set(camera.x, camera.y);
    scene.worldLayer.scale.set(camera.zoom);
  }, [camera, overlay, projection]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;

    const next = panCamera(cameraRef.current, event.clientX - drag.x, event.clientY - drag.y);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    onCameraChangeRef.current(next);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      className="world-map-canvas"
      data-overlay={overlay}
      onPointerCancel={handlePointerUp}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={(event) => {
        event.preventDefault();
        onCameraChangeRef.current(
          zoomCamera(cameraRef.current, event.deltaY < 0 ? 1.15 : 1 / 1.15),
        );
      }}
      ref={hostRef}
    />
  );
}
