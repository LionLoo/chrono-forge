import 'pixi.js/unsafe-eval';

import { Application, Container, Graphics } from 'pixi.js';
import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { STRUCTURE_STATE_CODES, type WorldFrameProjection } from '../protocol';
import { panCamera, zoomCamera, zoomCameraAt, type WorldCamera } from './camera';
import {
  buildPreparedRenderModel,
  prepareRenderProjection,
  renderDetailForZoom,
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
  readonly agentLastTargetAtMs: Map<number, number>;
  readonly agentMotions: Map<number, AgentMotion>;
  readonly agentTargetTiles: Map<number, number>;
  readonly application: Application;
  readonly builtGraphics: Graphics;
  readonly effectsGraphics: Graphics;
  readonly routeRuinGraphics: Graphics;
  readonly selectionGraphics: Graphics;
  readonly spaceGraphics: Graphics;
  readonly structureGraphics: Graphics;
  readonly terrainGraphics: Graphics;
  readonly worldLayer: Container;
  lastModel: RenderModel | null;
  preparedProjection: PreparedRenderProjection | null;
  preparedSource: WorldMapProjection | null;
  animationFrame: number | null;
  reducedEffects: boolean;
}

const TILE_SIZE = 6;

interface AgentMotion {
  readonly durationMs: number;
  readonly fromX: number;
  readonly fromY: number;
  readonly startedAtMs: number;
  readonly targetX: number;
  readonly targetY: number;
}

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
    if (model.overlay.value !== 'terrain') continue;
    const textureStride =
      model.detailLevel === 'overview' ? 4 : model.detailLevel === 'district' ? 2 : 1;
    if ((tile.tileIndex + tile.variant) % textureStride !== 0) continue;
    const drift = tile.variant * 0.35;
    if (tile.biome === 0) {
      graphics
        .moveTo(x + 0.7, y + 2 + drift)
        .lineTo(x + 2.2, y + 1.6 + drift)
        .lineTo(x + 3.7, y + 2 + drift)
        .lineTo(x + 5.2, y + 1.6 + drift)
        .stroke({ color: 0x78a7b0, width: 0.35 });
    } else if (tile.biome === 1) {
      graphics
        .moveTo(x + 1.2 + drift, y + 1.4)
        .lineTo(x + 2.2 + drift, y + 2.4)
        .moveTo(x + 2.2 + drift, y + 1.4)
        .lineTo(x + 1.2 + drift, y + 2.4)
        .stroke({ color: 0xe5ece4, width: 0.3 });
    } else if (tile.biome === 2) {
      graphics
        .moveTo(x + 1.4 + drift, y + 4.8)
        .lineTo(x + 1.8 + drift, y + 3.25)
        .lineTo(x + 2.25 + drift, y + 4.8)
        .stroke({ color: 0xb8c881, width: 0.35 });
    } else if (tile.biome === 3) {
      graphics
        .moveTo(x + 1 + drift, y + 4.8)
        .lineTo(x + 2.2 + drift, y + 1.1)
        .lineTo(x + 3.4 + drift, y + 4.8)
        .closePath()
        .fill(0x244b36);
    } else if (tile.biome === 4) {
      graphics
        .moveTo(x + 0.7, y + 3.7 + drift * 0.5)
        .lineTo(x + 2.1, y + 3.05 + drift * 0.5)
        .lineTo(x + 3.7, y + 3.7 + drift * 0.5)
        .lineTo(x + 5.3, y + 3.05 + drift * 0.5)
        .stroke({ color: 0xe1c37b, width: 0.35 });
    } else if (tile.biome === 5) {
      for (let reed = 0; reed < 2; reed += 1) {
        const reedX = x + 1.5 + reed * 2 + drift * 0.25;
        graphics
          .moveTo(reedX, y + 5)
          .lineTo(reedX + (reed === 0 ? -0.25 : 0.25), y + 2.2)
          .stroke({ color: 0x86aa79, width: 0.35 });
      }
    } else if (tile.biome === 6) {
      graphics
        .moveTo(x + 0.7, y + 4.9)
        .lineTo(x + 2.25, y + 1.2 + drift * 0.3)
        .lineTo(x + 3.4, y + 3.2)
        .lineTo(x + 4.2, y + 1.9)
        .lineTo(x + 5.3, y + 4.9)
        .stroke({ color: 0xc5beb2, width: 0.4 });
    }
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
        ? 3.1
        : settlement.wealthTier === 'comfortable'
          ? 2.7
          : 2.3;
    if (settlement.layout === 'courtyard') {
      graphics
        .rect(x - radius, y - radius, radius * 2, radius * 2)
        .stroke({ color: settlement.accentColor, width: 0.65 });
      if (model.detailLevel !== 'overview') {
        graphics
          .rect(x - radius * 0.42, y - radius * 0.42, radius * 0.84, radius * 0.84)
          .stroke({ color: 0xf5ead1, width: 0.45 });
      }
    } else if (settlement.layout === 'linear') {
      graphics
        .moveTo(x - radius, y)
        .lineTo(x + radius, y)
        .moveTo(x - radius * 0.72, y - radius * 0.65)
        .lineTo(x + radius * 0.72, y - radius * 0.65)
        .stroke({ color: settlement.accentColor, width: 0.75 });
    } else {
      graphics
        .moveTo(x, y - radius)
        .lineTo(x + radius, y)
        .lineTo(x, y + radius)
        .lineTo(x - radius, y)
        .closePath()
        .stroke({ color: settlement.accentColor, width: 0.75 });
      if (model.detailLevel === 'close') {
        graphics.circle(x, y, radius * 0.36).stroke({ color: 0xf5ead1, width: 0.45 });
      }
    }
  }
  for (const descriptor of model.builtEnvironment) {
    const [baseX, baseY] = tilePoint(descriptor.tileIndex, model.width);
    const [offsetX, offsetY] = builtOffset(descriptor.kind);
    const color = materialColor(descriptor.material);
    const x = baseX + offsetX;
    const y = baseY + offsetY;
    if (descriptor.kind === 'road') {
      if (model.detailLevel === 'close') {
        graphics
          .moveTo(baseX - 2.6, baseY + 1.6)
          .lineTo(baseX + 2.6, baseY - 1.6)
          .stroke({ color: 0x937a58, width: 0.85 });
      }
    } else if (descriptor.kind === 'farm') {
      graphics
        .rect(x - 1.5, y - 1, 3, 2)
        .fill(color)
        .stroke({ color: 0x27352e, width: 0.4 });
      for (let row = -1; row <= 1; row += 1) {
        graphics
          .moveTo(x - 1.2 + row * 0.75, y - 0.75)
          .lineTo(x - 1.2 + row * 0.75, y + 0.75)
          .stroke({ color: 0x315b42, width: 0.3 });
      }
    } else if (descriptor.kind === 'industry') {
      graphics
        .moveTo(x - 1.45, y + 1.25)
        .lineTo(x - 1.45, y - 0.25)
        .lineTo(x - 0.35, y - 1)
        .lineTo(x - 0.35, y - 0.15)
        .lineTo(x + 0.85, y - 0.9)
        .lineTo(x + 1.45, y - 0.4)
        .lineTo(x + 1.45, y + 1.25)
        .closePath()
        .fill(color)
        .stroke({ color: 0x27352e, width: 0.45 });
      graphics.rect(x + 0.7, y - 1.9, 0.5, 1.2).fill(0x4b5558);
    } else if (descriptor.kind === 'infrastructure') {
      graphics
        .moveTo(x, y - 1.5)
        .lineTo(x + 1.5, y)
        .lineTo(x, y + 1.5)
        .lineTo(x - 1.5, y)
        .closePath()
        .stroke({ color, width: 0.7 });
      graphics
        .moveTo(x - 0.7, y)
        .lineTo(x + 0.7, y)
        .stroke({ color: 0x79cbd1, width: 0.45 });
    } else {
      graphics
        .moveTo(x - 1.4, y + 1.25)
        .lineTo(x - 1.4, y - 0.2)
        .lineTo(x, y - 1.45)
        .lineTo(x + 1.4, y - 0.2)
        .lineTo(x + 1.4, y + 1.25)
        .closePath()
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
      graphics.rect(x - 2.15 + mark * 1.25, y + 2.15, 0.7, 0.7).fill(0x0b1510);
    }
    if (structure.state === STRUCTURE_STATE_CODES.planned) {
      graphics.rect(x - 2.35, y - 1.55, 4.7, 3.8).stroke({ color: outline, width: 0.75 });
      graphics
        .moveTo(x - 2.35, y + 2.25)
        .lineTo(x + 2.35, y - 1.55)
        .moveTo(x - 2.35, y - 1.55)
        .lineTo(x + 2.35, y + 2.25)
        .stroke({ color: structure.accentColor, width: 0.45 });
      continue;
    }
    const bodyTop = structure.form === 'storehouse' ? -1.25 : -0.95;
    const bodyHeight = structure.form === 'storehouse' ? 3.45 : 3.15;
    const completedHeight =
      structure.state === STRUCTURE_STATE_CODES.building
        ? Math.max(0.5, (bodyHeight * structure.progress) / 1_000)
        : bodyHeight;
    graphics
      .rect(x - 2.2, y + bodyTop + bodyHeight - completedHeight, 4.4, completedHeight)
      .fill(fill)
      .stroke({ color: outline, width: 0.7 });
    const roofY = y + bodyTop;
    if (structure.roof === 'flat') {
      graphics
        .moveTo(x - 2.45, roofY)
        .lineTo(x + 2.45, roofY)
        .stroke({ color: structure.accentColor, width: 0.9 });
    } else if (structure.roof === 'hip') {
      graphics
        .moveTo(x - 2.45, roofY)
        .lineTo(x - 1.2, roofY - 1.4)
        .lineTo(x + 1.2, roofY - 1.4)
        .lineTo(x + 2.45, roofY)
        .closePath()
        .fill(structure.accentColor)
        .stroke({ color: outline, width: 0.55 });
    } else {
      graphics
        .moveTo(x - 2.45, roofY)
        .lineTo(x, roofY - 1.65)
        .lineTo(x + 2.45, roofY)
        .closePath()
        .fill(structure.accentColor)
        .stroke({ color: outline, width: 0.55 });
    }
    if (model.detailLevel !== 'overview') {
      graphics.rect(x - 0.55, y + 0.25, 1.1, 2).fill(0x27352e);
      if (structure.form === 'storehouse') {
        graphics
          .moveTo(x - 1.65, y + 0.1)
          .lineTo(x - 0.85, y + 0.1)
          .moveTo(x + 0.85, y + 0.1)
          .lineTo(x + 1.65, y + 0.1)
          .stroke({ color: 0xe9dfba, width: 0.45 });
      }
    }
    if (structure.state === STRUCTURE_STATE_CODES.building) {
      graphics
        .moveTo(x - 2.7, y - 2.65)
        .lineTo(x - 2.7, y + 2.5)
        .moveTo(x + 2.7, y - 2.65)
        .lineTo(x + 2.7, y + 2.5)
        .moveTo(x - 2.7, y - 1.9)
        .lineTo(x + 2.7, y - 1.9)
        .stroke({ color: 0xe9dfba, width: 0.4 });
    }
    if (structure.conditionTier !== 'sound') {
      graphics
        .moveTo(x + 0.6, y - 0.4)
        .lineTo(x + 1.25, y + 0.25)
        .lineTo(x + 0.75, y + 0.8)
        .stroke({ color: 0x5f2c2c, width: 0.5 });
    }
  }
}

function drawSpaceLandmarks(graphics: Graphics, model: RenderModel): void {
  graphics.clear();
  for (const landmark of model.spaceLandmarks) {
    const [baseX, baseY] = tilePoint(landmark.tileIndex, model.width);
    const x = landmark.kind === 'launch-site' ? baseX + 1.85 : baseX;
    const y = landmark.kind === 'launch-site' ? baseY - 1.45 : baseY;
    if (landmark.kind === 'launch-site') {
      const height = model.detailLevel === 'close' ? 3.4 : 2.7;
      graphics
        .moveTo(x - 1.4, y + 2.2)
        .lineTo(x - 0.55, y - height)
        .lineTo(x + 0.55, y - height)
        .lineTo(x + 1.4, y + 2.2)
        .closePath()
        .fill(0xd9e3dc)
        .stroke({ color: landmark.accentColor, width: 0.55 });
      graphics
        .moveTo(x - 2.2, y + 2.2)
        .lineTo(x - 2.2, y - 1.8)
        .lineTo(x - 0.75, y - 1.8)
        .moveTo(x - 2.2, y - 0.2)
        .lineTo(x - 0.95, y - 0.2)
        .stroke({ color: 0x8fa9a8, width: 0.45 });
    } else if (landmark.kind === 'body') {
      if (landmark.bodyKind === 'asteroid') {
        graphics
          .moveTo(x - 2.1, y - 0.7)
          .lineTo(x - 0.8, y - 2)
          .lineTo(x + 1.6, y - 1.25)
          .lineTo(x + 2.1, y + 0.7)
          .lineTo(x + 0.45, y + 2)
          .lineTo(x - 1.8, y + 1.1)
          .closePath()
          .fill(0x8e8272)
          .stroke({ color: landmark.accentColor, width: 0.5 });
      } else {
        const radius = landmark.bodyKind === 'moon' ? 1.55 : 2.05;
        graphics
          .circle(x, y, radius)
          .fill(landmark.habitable ? 0x5f9d78 : 0x76828c)
          .stroke({ color: landmark.accentColor, width: 0.55 });
        if (landmark.bodyKind === 'planet') {
          graphics
            .moveTo(x - radius - 1, y + 0.55)
            .lineTo(x + radius + 1, y - 0.55)
            .stroke({ color: 0xd9e3dc, width: 0.4 });
        } else {
          graphics
            .moveTo(x - 0.55, y - 1)
            .lineTo(x + 0.65, y + 0.8)
            .stroke({ color: 0xd9e3dc, width: 0.35 });
        }
      }
    } else if (landmark.kind === 'craft') {
      const direction = landmark.variant % 2 === 0 ? -1 : 1;
      graphics
        .moveTo(x, y - 2.6)
        .lineTo(x + 1.05, y - 0.45)
        .lineTo(x + 0.8, y + 1.45)
        .lineTo(x, y + 0.75)
        .lineTo(x - 0.8, y + 1.45)
        .lineTo(x - 1.05, y - 0.45)
        .closePath()
        .fill(0xd9e3dc)
        .stroke({ color: landmark.accentColor, width: 0.55 });
      graphics.circle(x, y - 0.7, 0.45).fill(0x79cbd1);
      if (landmark.status.startsWith('in-flight') && model.detailLevel !== 'overview') {
        graphics
          .moveTo(x, y + 1.3)
          .lineTo(x + direction * 1.2, y + 2.8)
          .stroke({ color: 0xe7bc61, width: 0.55 });
      }
    } else {
      graphics
        .moveTo(x - 2.4, y + 1.8)
        .lineTo(x - 1.45, y - 0.65)
        .lineTo(x, y - 1.7)
        .lineTo(x + 1.45, y - 0.65)
        .lineTo(x + 2.4, y + 1.8)
        .closePath()
        .fill(landmark.status === 'active' ? 0xaac2b5 : 0x665f5a)
        .stroke({ color: landmark.accentColor, width: 0.6 });
      graphics
        .moveTo(x - 1.45, y + 0.2)
        .lineTo(x + 1.45, y + 0.2)
        .stroke({ color: 0x23332d, width: 0.4 });
    }
  }
}

function agentMotionPoint(motion: AgentMotion, now: number): readonly [number, number, boolean] {
  const progress = Math.max(0, Math.min(1, (now - motion.startedAtMs) / motion.durationMs));
  return [
    motion.fromX + (motion.targetX - motion.fromX) * progress,
    motion.fromY + (motion.targetY - motion.fromY) * progress,
    progress < 1,
  ];
}

function drawAgents(
  graphics: Graphics,
  model: RenderModel,
  motions: ReadonlyMap<number, AgentMotion>,
  now: number,
): void {
  graphics.clear();
  for (const agent of model.agents) {
    const motion = motions.get(agent.selectable.id);
    const [x, y] =
      motion === undefined
        ? tilePoint(agent.tileIndex, model.width)
        : agentMotionPoint(motion, now);
    const offsetX = ((agent.selectable.id % 3) - 1) * 0.45;
    const offsetY = ((Math.floor(agent.selectable.id / 3) % 3) - 1) * 0.3;
    const centerX = x + offsetX;
    const centerY = y + offsetY;
    const height =
      (model.detailLevel === 'overview' ? 3.2 : model.detailLevel === 'district' ? 4.15 : 5.1) *
      (agent.ageTier === 'child' ? 0.76 : agent.ageTier === 'elder' ? 0.92 : 1);
    const halfWidth =
      height *
      (agent.identity.silhouette === 'compact'
        ? 0.18
        : agent.identity.silhouette === 'broad'
          ? 0.26
          : 0.22);
    const direction = agent.identity.facing === 'left' ? -1 : 1;
    const headY = centerY - height * 0.32;
    const bodyTop = centerY - height * 0.08;
    const bodyBottom = centerY + height * 0.34;
    const healthOutline =
      agent.healthTier === 'sound' ? 0x17211c : agent.healthTier === 'worn' ? 0xe2ac55 : 0xd75d55;
    graphics
      .moveTo(centerX - halfWidth, bodyTop)
      .lineTo(centerX + halfWidth, bodyTop)
      .lineTo(centerX + halfWidth * 0.76, bodyBottom)
      .lineTo(centerX - halfWidth * 0.76, bodyBottom)
      .closePath()
      .fill(agent.identity.clothingColor)
      .stroke({ color: healthOutline, width: 0.5 });
    graphics
      .circle(centerX + direction * height * 0.035, headY, height * 0.115)
      .fill(agent.identity.skinColor)
      .stroke({ color: healthOutline, width: 0.45 });
    graphics
      .moveTo(centerX - halfWidth * 0.72, bodyBottom)
      .lineTo(centerX - halfWidth, centerY + height * 0.55)
      .moveTo(centerX + halfWidth * 0.72, bodyBottom)
      .lineTo(centerX + halfWidth, centerY + height * 0.55)
      .stroke({ color: 0x17211c, width: 0.5 });
    if (agent.identity.accent === 'band') {
      graphics
        .moveTo(centerX - halfWidth * 0.9, centerY + height * 0.09)
        .lineTo(centerX + halfWidth * 0.9, centerY + height * 0.09)
        .stroke({ color: agent.identity.accentColor, width: 0.45 });
    } else if (agent.identity.accent === 'sash') {
      graphics
        .moveTo(centerX - halfWidth * 0.7, bodyTop)
        .lineTo(centerX + halfWidth * 0.55, bodyBottom)
        .stroke({ color: agent.identity.accentColor, width: 0.45 });
    } else {
      graphics
        .moveTo(centerX - halfWidth * 0.6, bodyTop - height * 0.02)
        .lineTo(centerX + halfWidth * 0.6, bodyTop - height * 0.02)
        .lineTo(centerX + direction * halfWidth, centerY + height * 0.17)
        .stroke({ color: agent.identity.accentColor, width: 0.4 });
    }
    const activityX = centerX + direction * height * 0.27;
    if (agent.activityVisual === 'carry') {
      graphics
        .rect(activityX - height * 0.1, centerY - height * 0.03, height * 0.2, height * 0.2)
        .fill(agent.identity.accentColor)
        .stroke({ color: 0x17211c, width: 0.35 });
    } else if (agent.activityVisual === 'water') {
      graphics
        .moveTo(activityX, centerY - height * 0.13)
        .lineTo(activityX + height * 0.1, centerY + height * 0.04)
        .lineTo(activityX, centerY + height * 0.17)
        .lineTo(activityX - height * 0.1, centerY + height * 0.04)
        .closePath()
        .fill(0x79cbd1)
        .stroke({ color: 0x17211c, width: 0.3 });
    } else if (agent.activityVisual === 'build') {
      graphics
        .moveTo(centerX + direction * height * 0.12, centerY)
        .lineTo(activityX + direction * height * 0.14, centerY - height * 0.2)
        .moveTo(activityX + direction * height * 0.03, centerY - height * 0.25)
        .lineTo(activityX + direction * height * 0.2, centerY - height * 0.1)
        .stroke({ color: agent.identity.accentColor, width: 0.55 });
    } else if (agent.activityVisual === 'gather') {
      graphics
        .moveTo(centerX + direction * height * 0.11, centerY)
        .lineTo(activityX + direction * height * 0.14, centerY + height * 0.22)
        .stroke({ color: agent.identity.accentColor, width: 0.55 });
    } else if (agent.activityVisual === 'rest') {
      graphics
        .moveTo(centerX - height * 0.24, centerY + height * 0.58)
        .lineTo(centerX + height * 0.24, centerY + height * 0.58)
        .stroke({ color: agent.identity.accentColor, width: 0.55 });
    }
    if (agent.ageTier === 'elder' && model.detailLevel === 'close') {
      graphics
        .moveTo(centerX - direction * height * 0.28, centerY + height * 0.08)
        .lineTo(centerX - direction * height * 0.34, centerY + height * 0.58)
        .stroke({ color: 0x795f3e, width: 0.45 });
    }
  }
}

function updateAgentMotions(
  scene: PixiScene,
  model: RenderModel,
  reducedEffects: boolean,
): boolean {
  const now = performance.now();
  let changed = false;
  const visibleIds = new Set<number>();
  for (const agent of model.agents) {
    const id = agent.selectable.id;
    visibleIds.add(id);
    const previousTarget = scene.agentTargetTiles.get(id);
    const [targetX, targetY] = tilePoint(agent.tileIndex, model.width);
    if (previousTarget === undefined) {
      scene.agentTargetTiles.set(id, agent.tileIndex);
      scene.agentLastTargetAtMs.set(id, now);
      continue;
    }
    if (previousTarget !== agent.tileIndex) {
      const previousMotion = scene.agentMotions.get(id);
      const [fromX, fromY] =
        previousMotion === undefined
          ? tilePoint(previousTarget, model.width)
          : agentMotionPoint(previousMotion, now);
      scene.agentTargetTiles.set(id, agent.tileIndex);
      const priorTargetAtMs = scene.agentLastTargetAtMs.get(id) ?? now;
      scene.agentLastTargetAtMs.set(id, now);
      if (reducedEffects) {
        scene.agentMotions.delete(id);
      } else {
        scene.agentMotions.set(id, {
          // One authoritative position is emitted per completed logical movement.
          // Use that observed interval so normal focus pace glides between sparse
          // action pulses, while accelerated pace remains responsive.
          durationMs: Math.max(120, Math.min(10_000, Math.round((now - priorTargetAtMs) * 0.9))),
          fromX,
          fromY,
          startedAtMs: now,
          targetX,
          targetY,
        });
      }
      changed = true;
    }
  }
  for (const id of scene.agentTargetTiles.keys()) {
    if (!visibleIds.has(id)) {
      scene.agentTargetTiles.delete(id);
      scene.agentLastTargetAtMs.delete(id);
      scene.agentMotions.delete(id);
    }
  }
  if (reducedEffects && scene.agentMotions.size > 0) {
    scene.agentMotions.clear();
    changed = true;
  }
  return changed;
}

function scheduleAgentMotion(scene: PixiScene): void {
  if (scene.animationFrame !== null || typeof window.requestAnimationFrame !== 'function') return;
  const animate = (now: number): void => {
    scene.animationFrame = null;
    const model = scene.lastModel;
    if (model === null) return;
    drawAgents(scene.agentGraphics, model, scene.agentMotions, now);
    const hasActiveMotion = [...scene.agentMotions.values()].some(
      (motion) => agentMotionPoint(motion, now)[2],
    );
    if (hasActiveMotion) scheduleAgentMotion(scene);
  };
  scene.animationFrame = window.requestAnimationFrame(animate);
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
    if (effect.kind === 'storm') {
      graphics
        .moveTo(x - radius, y - radius * 0.55)
        .lineTo(x + radius * 0.15, y - radius * 0.55)
        .lineTo(x - radius * 0.45, y + radius * 0.2)
        .lineTo(x + radius, y + radius * 0.2)
        .lineTo(x - radius * 0.25, y + radius)
        .stroke({ color: 0xf3c96d, width: 0.85 });
    } else if (effect.kind === 'fire') {
      graphics
        .moveTo(x, y - radius)
        .lineTo(x + radius * 0.8, y + radius * 0.35)
        .lineTo(x + radius * 0.25, y + radius)
        .lineTo(x - radius * 0.75, y + radius * 0.55)
        .lineTo(x - radius * 0.4, y - radius * 0.1)
        .closePath()
        .fill(0xd76d55)
        .stroke({ color: 0xf3c96d, width: 0.65 });
    } else if (effect.kind === 'flood') {
      for (let wave = -1; wave <= 1; wave += 1) {
        graphics
          .moveTo(x - radius, y + wave * radius * 0.45)
          .lineTo(x - radius * 0.35, y + wave * radius * 0.45 - 0.35)
          .lineTo(x + radius * 0.35, y + wave * radius * 0.45 + 0.35)
          .lineTo(x + radius, y + wave * radius * 0.45)
          .stroke({ color: 0x79cbd1, width: 0.55 });
      }
    } else if (effect.kind === 'earthquake') {
      graphics
        .moveTo(x - radius, y - radius)
        .lineTo(x - radius * 0.25, y - radius * 0.25)
        .lineTo(x - radius * 0.7, y + radius * 0.15)
        .lineTo(x + radius * 0.15, y + radius)
        .lineTo(x + radius, y + radius * 0.3)
        .stroke({ color: 0xf3c96d, width: 0.85 });
    } else if (effect.kind === 'meteor-impact') {
      graphics
        .circle(x + radius * 0.35, y + radius * 0.35, radius * 0.55)
        .stroke({ color: 0xd76d55, width: 0.75 });
      graphics
        .moveTo(x - radius, y - radius)
        .lineTo(x + radius * 0.05, y + radius * 0.05)
        .stroke({ color: 0xf3c96d, width: 0.85 });
    } else {
      graphics.circle(x, y, radius).stroke({ color: 0xf3c96d, width: 0.75 });
      graphics
        .moveTo(x - radius * 0.8, y + radius * 0.8)
        .lineTo(x - radius * 0.2, y + radius * 0.15)
        .lineTo(x + radius * 0.2, y + radius * 0.7)
        .lineTo(x + radius * 0.8, y - radius * 0.8)
        .stroke({ color: 0xd76d55, width: 0.65 });
    }
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
  zoom: number,
): RenderModel {
  if (scene.preparedSource !== projection || scene.preparedProjection === null) {
    scene.preparedSource = projection;
    scene.preparedProjection = prepareRenderProjection(projection);
  }
  const model = buildPreparedRenderModel(scene.preparedProjection, {
    detailLevel: renderDetailForZoom(zoom),
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
  const agentLayerChanged = previous?.layerSignatures.agents !== model.layerSignatures.agents;
  const agentMotionChanged = updateAgentMotions(scene, model, reducedEffects);
  if (agentLayerChanged || agentMotionChanged || scene.reducedEffects !== reducedEffects) {
    drawAgents(scene.agentGraphics, model, scene.agentMotions, performance.now());
  }
  if (previous?.layerSignatures.structures !== model.layerSignatures.structures) {
    drawStructures(scene.structureGraphics, model);
  }
  if (previous?.layerSignatures.space !== model.layerSignatures.space) {
    drawSpaceLandmarks(scene.spaceGraphics, model);
  }
  scene.reducedEffects = reducedEffects;
  scene.lastModel = model;
  if (!reducedEffects && scene.agentMotions.size > 0) scheduleAgentMotion(scene);
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
    // React delegates wheel events as passive in some embedded WebView environments.
    // A native non-passive listener keeps map zoom from also scrolling the page.
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.deltaY === 0) return;
      const bounds = host.getBoundingClientRect();
      const nextCamera = zoomCameraAt(
        cameraRef.current,
        event.deltaY < 0 ? 1.15 : 1 / 1.15,
        event.clientX - bounds.left,
        event.clientY - bounds.top,
      );
      // Wheel events can arrive before React commits the parent camera update. Keep this
      // presentation ref current so a normal multi-notch gesture compounds correctly.
      cameraRef.current = nextCamera;
      onCameraChangeRef.current(nextCamera);
    };
    host.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      host.removeEventListener('wheel', handleWheel);
    };
  }, []);

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
        const spaceGraphics = new Graphics();
        const agentGraphics = new Graphics();
        const effectsGraphics = new Graphics();
        const selectionGraphics = new Graphics();
        worldLayer.addChild(
          terrainGraphics,
          builtGraphics,
          routeRuinGraphics,
          structureGraphics,
          spaceGraphics,
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
          agentLastTargetAtMs: new Map(),
          agentMotions: new Map(),
          agentTargetTiles: new Map(),
          application,
          builtGraphics,
          effectsGraphics,
          routeRuinGraphics,
          selectionGraphics,
          spaceGraphics,
          structureGraphics,
          terrainGraphics,
          worldLayer,
          lastModel: null,
          preparedProjection: null,
          preparedSource: null,
          animationFrame: null,
          reducedEffects: reducedEffectsRef.current,
        };
        sceneRef.current = scene;
        const model = applyProjection(
          scene,
          projectionRef.current,
          overlayRef.current,
          viewportFor(host, cameraRef.current, projectionRef.current),
          selectionRef.current,
          reducedEffectsRef.current,
          cameraRef.current.zoom,
        );
        application.canvas.setAttribute(
          'aria-label',
          `${model.era} world map, ${projectionRef.current.agentIds.length} visible agents, ${projectionRef.current.structureIds.length} structures, ${model.overlay.legend} overlay`,
        );
        host.dataset.detail = model.detailLevel;
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
        if (sceneRef.current.animationFrame !== null) {
          window.cancelAnimationFrame(sceneRef.current.animationFrame);
        }
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
      camera.zoom,
    );
    scene.application.canvas.setAttribute(
      'aria-label',
      `${model.era} world map, ${projection.agentIds.length} visible agents, ${projection.structureIds.length} structures, ${model.overlay.legend} overlay`,
    );
    host.dataset.detail = model.detailLevel;
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
      ref={hostRef}
    />
  );
}
