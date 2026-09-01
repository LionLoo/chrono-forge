import 'pixi.js/unsafe-eval';

import { Application, Container, Graphics } from 'pixi.js';
import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { STRUCTURE_STATE_CODES, type WorldFrameProjection } from '../protocol';
import { panCamera, zoomCamera, type WorldCamera } from './camera';
import {
  buildPreparedRenderModel,
  prepareRenderProjection,
  type PreparedRenderProjection,
  type RenderModel,
  type RenderViewport,
  type SelectableId,
} from './render-model';
import type { WorldOverlay } from './world-palette';

export type WorldMapProjection = WorldFrameProjection;

interface WorldMapCanvasProps {
  readonly camera: WorldCamera;
  readonly onCameraChange: (camera: WorldCamera) => void;
  readonly onSelectionChange?: (selection: SelectableId | null) => void;
  readonly overlay: WorldOverlay;
  readonly projection: WorldMapProjection;
  readonly reducedEffects?: boolean;
  readonly selection?: SelectableId | null;
}

interface PixiScene {
  readonly agentGraphics: Graphics;
  readonly application: Application;
  readonly builtGraphics: Graphics;
  readonly effectsGraphics: Graphics;
  readonly routeRuinGraphics: Graphics;
  readonly selectionGraphics: Graphics;
  readonly structureGraphics: Graphics;
  readonly terrainGraphics: Graphics;
  readonly worldLayer: Container;
  lastModel: RenderModel | null;
  preparedProjection: PreparedRenderProjection | null;
  preparedSource: WorldMapProjection | null;
}

const TILE_SIZE = 6;

function viewportFor(
  host: HTMLElement,
  camera: WorldCamera,
  projection: WorldMapProjection,
): RenderViewport {
  if (host.clientWidth < 1 || host.clientHeight < 1) {
    return {
      leftTile: 0,
      topTile: 0,
      widthTiles: projection.width,
      heightTiles: projection.height,
    };
  }
  const widthPixels = host.clientWidth;
  const heightPixels = host.clientHeight;
  return {
    leftTile: Math.floor(-camera.x / (TILE_SIZE * camera.zoom)),
    topTile: Math.floor(-camera.y / (TILE_SIZE * camera.zoom)),
    widthTiles: Math.max(1, Math.ceil(widthPixels / (TILE_SIZE * camera.zoom))),
    heightTiles: Math.max(1, Math.ceil(heightPixels / (TILE_SIZE * camera.zoom))),
  };
}

function tilePoint(tileIndex: number, width: number): readonly [number, number] {
  return [
    (tileIndex % width) * TILE_SIZE + TILE_SIZE / 2,
    Math.floor(tileIndex / width) * TILE_SIZE + TILE_SIZE / 2,
  ];
}

function drawPattern(
  graphics: Graphics,
  tileX: number,
  tileY: number,
  model: RenderModel,
  value: number,
): void {
  if (model.overlay.pattern === 'none' || value < 250) return;
  const tier = value >= 750 ? 3 : value >= 500 ? 2 : 1;
  for (let mark = 0; mark < tier; mark += 1) {
    const offset = 1 + mark * 1.45;
    if (model.overlay.pattern === 'rings') {
      graphics
        .circle(tileX + TILE_SIZE / 2, tileY + TILE_SIZE / 2, offset)
        .stroke({ color: 0xf4f0dc, width: 0.35 });
    } else if (model.overlay.pattern === 'dots' || model.overlay.pattern === 'speckle') {
      graphics.circle(tileX + offset, tileY + offset, 0.35).fill(0xf4f0dc);
    } else {
      graphics.rect(tileX + offset, tileY + 0.75, 0.45, TILE_SIZE - 1.5).fill(0xf4f0dc);
    }
  }
}

function drawTerrain(graphics: Graphics, model: RenderModel): void {
  graphics.clear();
  for (const tile of model.terrain) {
    const x = tile.x * TILE_SIZE;
    const y = tile.y * TILE_SIZE;
    graphics.rect(x, y, TILE_SIZE + 0.25, TILE_SIZE + 0.25).fill(tile.color);
    drawPattern(graphics, x, y, model, tile.overlayValue);
  }
}

function builtOffset(kind: string): readonly [number, number] {
  switch (kind) {
    case 'farm':
      return [-2, 1.5];
    case 'district':
      return [1.5, -2];
    case 'industry':
      return [1.7, 1.6];
    case 'infrastructure':
      return [-2, -2];
    default:
      return [0, 0];
  }
}

function materialColor(material: string): number {
  return material === 'metal' ? 0xaebfc5 : material === 'stone' ? 0xc0b9a9 : 0xd7b56a;
}

function drawBuiltEnvironment(graphics: Graphics, model: RenderModel): void {
  graphics.clear();
  for (const settlement of model.settlements) {
    const [x, y] = tilePoint(settlement.tileIndex, model.width);
    const radius =
      settlement.wealthTier === 'prosperous'
        ? 3
        : settlement.wealthTier === 'comfortable'
          ? 2.5
          : 2;
    graphics.circle(x, y, radius).stroke({ color: 0xf5ead1, width: 0.7 });
  }
  for (const descriptor of model.builtEnvironment) {
    if (descriptor.kind === 'road') continue;
    const [baseX, baseY] = tilePoint(descriptor.tileIndex, model.width);
    const [offsetX, offsetY] = builtOffset(descriptor.kind);
    const color = materialColor(descriptor.material);
    if (descriptor.kind === 'farm') {
      graphics.rect(baseX + offsetX - 1.3, baseY + offsetY - 0.8, 2.6, 1.6).fill(color);
      graphics.rect(baseX + offsetX - 0.8, baseY + offsetY - 0.8, 0.35, 1.6).fill(0x315b42);
    } else if (descriptor.kind === 'industry') {
      graphics.rect(baseX + offsetX - 1.2, baseY + offsetY - 1.2, 2.4, 2.4).fill(color);
      graphics.rect(baseX + offsetX + 0.5, baseY + offsetY - 2, 0.55, 1.2).fill(0x4b5558);
    } else if (descriptor.kind === 'infrastructure') {
      graphics.circle(baseX + offsetX, baseY + offsetY, 1.4).stroke({ color, width: 0.7 });
    } else {
      graphics
        .rect(baseX + offsetX - 1.2, baseY + offsetY - 1.2, 2.4, 2.4)
        .stroke({ color, width: 0.65 });
    }
  }
}

function drawRoutesAndRuins(graphics: Graphics, model: RenderModel): void {
  graphics.clear();
  for (const route of model.routes) {
    const [fromX, fromY] = tilePoint(route.fromTileIndex, model.width);
    const [toX, toY] = tilePoint(route.toTileIndex, model.width);
    graphics
      .moveTo(fromX, fromY)
      .lineTo(toX, toY)
      .stroke({
        color: route.status === 'disrupted' ? 0xd78b4b : 0x79cbd1,
        width: route.volume >= 40 ? 1.2 : 0.7,
      });
  }
  for (const ruin of model.ruins) {
    const [x, y] = tilePoint(ruin.tileIndex, model.width);
    graphics
      .moveTo(x - 2, y - 2)
      .lineTo(x + 2, y + 2)
      .moveTo(x + 2, y - 2)
      .lineTo(x - 2, y + 2)
      .stroke({ color: 0xd76d55, width: 0.8 });
  }
}

function drawStructures(graphics: Graphics, model: RenderModel): void {
  graphics.clear();
  for (const structure of model.structures) {
    const [x, y] = tilePoint(structure.tileIndex, model.width);
    const outline =
      structure.conditionTier === 'sound'
        ? 0xf5ead1
        : structure.conditionTier === 'worn'
          ? 0xd78b4b
          : 0xd75454;
    const fill = materialColor(structure.material);
    const markCount =
      structure.conditionTier === 'sound' ? 1 : structure.conditionTier === 'worn' ? 2 : 3;
    for (let mark = 0; mark < markCount; mark += 1) {
      graphics.rect(x - 2 + mark * 1.4, y - 2, 0.8, 0.8).fill(0x0b1510);
    }
    if (structure.state === STRUCTURE_STATE_CODES.planned) {
      graphics.rect(x - 2.5, y - 2.5, 5, 5).stroke({ color: outline, width: 1 });
    } else if (structure.state === STRUCTURE_STATE_CODES.building) {
      const height = Math.max(1, Math.round((5 * structure.progress) / 1_000));
      graphics.rect(x - 2, y + 2.5 - height, 4, height).fill(fill);
      graphics.rect(x - 2.5, y - 2.5, 5, 5).stroke({ color: outline, width: 1 });
    } else {
      graphics.circle(x, y, 2).fill(fill).stroke({ color: outline, width: 1 });
    }
  }
}

function drawAgents(graphics: Graphics, model: RenderModel): void {
  graphics.clear();
  for (const agent of model.agents) {
    const [x, y] = tilePoint(agent.tileIndex, model.width);
    const fill =
      agent.healthTier === 'sound' ? 0xf4ede0 : agent.healthTier === 'worn' ? 0xe2ac55 : 0xd75d55;
    const radius = agent.ageTier === 'child' ? 1 : agent.ageTier === 'elder' ? 1.55 : 1.35;
    graphics.circle(x, y, radius).fill(fill).stroke({ color: 0x0b1510, width: 0.65 });
    if (agent.action % 2 === 0) {
      graphics.rect(x - 0.4, y - 2.2, 0.8, 0.8).fill(0xf5ead1);
    } else {
      graphics.rect(x + 1.45, y - 0.4, 0.8, 0.8).fill(0xf5ead1);
    }
  }
}

function drawEffects(graphics: Graphics, model: RenderModel): void {
  graphics.clear();
  model.effects.forEach((effect, index) => {
    if (!effect.reduced) {
      const inset = 2 + index * 1.5;
      graphics
        .rect(
          inset,
          inset,
          Math.max(1, model.width * TILE_SIZE - inset * 2),
          Math.max(1, model.height * TILE_SIZE - inset * 2),
        )
        .stroke({ color: 0xd76d55, width: effect.severity >= 60 ? 1.2 : 0.6 });
    }
    const [x, y] = tilePoint(effect.markerTileIndex, model.width);
    const radius = effect.severity >= 60 ? 2.4 : 1.9;
    graphics
      .moveTo(x, y - radius)
      .lineTo(x + radius, y)
      .lineTo(x, y + radius)
      .lineTo(x - radius, y)
      .closePath()
      .stroke({ color: 0xf3c96d, width: 0.9 });
    graphics
      .moveTo(x - 1, y)
      .lineTo(x + 1, y)
      .stroke({ color: 0xd76d55, width: 0.7 });
  });
}

function selectedTile(model: RenderModel, selection: SelectableId): number | null {
  const direct = [...model.agents, ...model.structures, ...model.settlements, ...model.ruins].find(
    (entry) => entry.selectable.kind === selection.kind && entry.selectable.id === selection.id,
  );
  if (direct !== undefined) return direct.tileIndex;
  const route = model.routes.find(
    (entry) => entry.selectable.kind === selection.kind && entry.selectable.id === selection.id,
  );
  if (route !== undefined) return Math.min(route.fromTileIndex, route.toTileIndex);
  return (
    model.effects.find(
      (entry) => entry.selectable.kind === selection.kind && entry.selectable.id === selection.id,
    )?.markerTileIndex ?? null
  );
}

function drawSelection(graphics: Graphics, model: RenderModel): void {
  graphics.clear();
  if (model.selected === null) return;
  const tile = selectedTile(model, model.selected);
  if (tile === null) {
    graphics
      .rect(1, 1, model.width * TILE_SIZE - 2, model.height * TILE_SIZE - 2)
      .stroke({ color: 0xf3c96d, width: 1 });
    return;
  }
  const [x, y] = tilePoint(tile, model.width);
  graphics.circle(x, y, 3.6).stroke({ color: 0xf3c96d, width: 1.2 });
  graphics.rect(x - 0.45, y - 4.6, 0.9, 1.4).fill(0xf3c96d);
}

function applyProjection(
  scene: PixiScene,
  projection: WorldMapProjection,
  overlay: WorldOverlay,
  viewport: RenderViewport,
  selection: SelectableId | null,
  reducedEffects: boolean,
): RenderModel {
  if (scene.preparedSource !== projection || scene.preparedProjection === null) {
    scene.preparedSource = projection;
    scene.preparedProjection = prepareRenderProjection(projection);
  }
  const model = buildPreparedRenderModel(scene.preparedProjection, {
    overlay,
    viewport,
    selection,
    reducedEffects,
  });
  const previous = scene.lastModel;
  if (previous?.layerSignatures.terrain !== model.layerSignatures.terrain) {
    drawTerrain(scene.terrainGraphics, model);
  }
  if (previous?.layerSignatures.builtEnvironment !== model.layerSignatures.builtEnvironment) {
    drawBuiltEnvironment(scene.builtGraphics, model);
  }
  if (previous?.layerSignatures.routesRuins !== model.layerSignatures.routesRuins) {
    drawRoutesAndRuins(scene.routeRuinGraphics, model);
  }
  if (
    previous?.layerSignatures.selection !== model.layerSignatures.selection ||
    previous?.layerSignatures.routesRuins !== model.layerSignatures.routesRuins ||
    previous?.layerSignatures.agents !== model.layerSignatures.agents ||
    previous?.layerSignatures.builtEnvironment !== model.layerSignatures.builtEnvironment ||
    previous?.layerSignatures.structures !== model.layerSignatures.structures
  ) {
    drawSelection(scene.selectionGraphics, model);
  }
  if (previous?.layerSignatures.effects !== model.layerSignatures.effects) {
    drawEffects(scene.effectsGraphics, model);
  }
  if (previous?.layerSignatures.agents !== model.layerSignatures.agents) {
    drawAgents(scene.agentGraphics, model);
  }
  if (previous?.layerSignatures.structures !== model.layerSignatures.structures) {
    drawStructures(scene.structureGraphics, model);
  }
  scene.lastModel = model;
  return model;
}

function selectableAtTile(model: RenderModel, tileIndex: number): SelectableId | null {
  for (const collection of [
    model.agents,
    model.structures,
    model.settlements,
    model.ruins,
  ] as const) {
    const match = collection.find((entry) => entry.tileIndex === tileIndex);
    if (match !== undefined) return match.selectable;
  }
  const tileX = tileIndex % model.width;
  const tileY = Math.floor(tileIndex / model.width);
  const route = model.routes.find((entry) => {
    const fromX = entry.fromTileIndex % model.width;
    const fromY = Math.floor(entry.fromTileIndex / model.width);
    const toX = entry.toTileIndex % model.width;
    const toY = Math.floor(entry.toTileIndex / model.width);
    const deltaX = toX - fromX;
    const deltaY = toY - fromY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const position =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, ((tileX - fromX) * deltaX + (tileY - fromY) * deltaY) / lengthSquared),
          );
    const nearestX = fromX + position * deltaX;
    const nearestY = fromY + position * deltaY;
    return (tileX - nearestX) ** 2 + (tileY - nearestY) ** 2 <= 0.5;
  });
  if (route !== undefined) return route.selectable;
  const effect = model.effects.find((entry) => entry.markerTileIndex === tileIndex);
  if (effect !== undefined) return effect.selectable;
  return null;
}

export function WorldMapCanvas({
  camera,
  onCameraChange,
  onSelectionChange,
  overlay,
  projection,
  reducedEffects = false,
  selection = null,
}: WorldMapCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<PixiScene | null>(null);
  const cameraRef = useRef(camera);
  const onCameraChangeRef = useRef(onCameraChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const overlayRef = useRef(overlay);
  const projectionRef = useRef(projection);
  const reducedEffectsRef = useRef(reducedEffects);
  const selectionRef = useRef(selection);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    cameraRef.current = camera;
    onCameraChangeRef.current = onCameraChange;
    onSelectionChangeRef.current = onSelectionChange;
    overlayRef.current = overlay;
    projectionRef.current = projection;
    reducedEffectsRef.current = reducedEffects;
    selectionRef.current = selection;
  }, [camera, onCameraChange, onSelectionChange, overlay, projection, reducedEffects, selection]);

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
        const builtGraphics = new Graphics();
        const routeRuinGraphics = new Graphics();
        const structureGraphics = new Graphics();
        const agentGraphics = new Graphics();
        const effectsGraphics = new Graphics();
        const selectionGraphics = new Graphics();
        worldLayer.addChild(
          terrainGraphics,
          builtGraphics,
          routeRuinGraphics,
          structureGraphics,
          agentGraphics,
          effectsGraphics,
          selectionGraphics,
        );
        application.stage.addChild(worldLayer);
        application.canvas.setAttribute('role', 'img');
        application.canvas.tabIndex = 0;
        host.appendChild(application.canvas);
        const scene: PixiScene = {
          agentGraphics,
          application,
          builtGraphics,
          effectsGraphics,
          routeRuinGraphics,
          selectionGraphics,
          structureGraphics,
          terrainGraphics,
          worldLayer,
          lastModel: null,
          preparedProjection: null,
          preparedSource: null,
        };
        sceneRef.current = scene;
        const model = applyProjection(
          scene,
          projectionRef.current,
          overlayRef.current,
          viewportFor(host, cameraRef.current, projectionRef.current),
          selectionRef.current,
          reducedEffectsRef.current,
        );
        application.canvas.setAttribute(
          'aria-label',
          `${model.era} world map, ${projectionRef.current.agentIds.length} visible agents, ${projectionRef.current.structureIds.length} structures, ${model.overlay.legend} overlay`,
        );
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
    const host = hostRef.current;
    if (!scene || !host) return;
    const model = applyProjection(
      scene,
      projection,
      overlay,
      viewportFor(host, camera, projection),
      selection,
      reducedEffects,
    );
    scene.application.canvas.setAttribute(
      'aria-label',
      `${model.era} world map, ${projection.agentIds.length} visible agents, ${projection.structureIds.length} structures, ${model.overlay.legend} overlay`,
    );
    scene.worldLayer.position.set(camera.x, camera.y);
    scene.worldLayer.scale.set(camera.zoom);
  }, [camera, overlay, projection, reducedEffects, selection]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    const next = panCamera(cameraRef.current, deltaX, deltaY);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: drag.moved || Math.abs(deltaX) + Math.abs(deltaY) > 2,
    };
    onCameraChangeRef.current(next);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId && !drag.moved) {
      const host = hostRef.current;
      const model = sceneRef.current?.lastModel;
      if (host && model) {
        const bounds = host.getBoundingClientRect();
        const x = (event.clientX - bounds.left - cameraRef.current.x) / cameraRef.current.zoom;
        const y = (event.clientY - bounds.top - cameraRef.current.y) / cameraRef.current.zoom;
        if (x >= 0 && y >= 0) {
          const tileX = Math.floor(x / TILE_SIZE);
          const tileY = Math.floor(y / TILE_SIZE);
          if (tileX < model.width && tileY < model.height) {
            onSelectionChangeRef.current?.(selectableAtTile(model, tileY * model.width + tileX));
          }
        }
      }
    }
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const directions: Readonly<Record<string, readonly [number, number]>> = {
      ArrowLeft: [-36, 0],
      ArrowUp: [0, -36],
      ArrowDown: [0, 36],
      ArrowRight: [36, 0],
    };
    const direction = directions[event.key];
    if (direction !== undefined) {
      event.preventDefault();
      onCameraChangeRef.current(panCamera(cameraRef.current, direction[0], direction[1]));
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      onCameraChangeRef.current(zoomCamera(cameraRef.current, 1.15));
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      onCameraChangeRef.current(zoomCamera(cameraRef.current, 1 / 1.15));
    } else if (event.key === 'Enter') {
      const model = sceneRef.current?.lastModel;
      const selectable =
        model === undefined || model === null
          ? null
          : ([
              ...model.agents,
              ...model.structures,
              ...model.settlements,
              ...model.routes,
              ...model.ruins,
              ...model.effects,
            ][0]?.selectable ?? null);
      onSelectionChangeRef.current?.(selectable);
    }
  };

  return (
    <div
      className="world-map-canvas"
      data-effects={reducedEffects ? 'reduced' : 'full'}
      data-overlay={overlay}
      onKeyDown={handleKeyDown}
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
