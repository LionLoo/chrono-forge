import 'pixi.js/unsafe-eval';

import { Application, Container, Graphics } from 'pixi.js';
import {
  useEffect,
  useRef,
  useState,
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
  readonly onViewportResize?: (width: number, height: number) => void;
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
    graphics
      .rect(x, y, TILE_SIZE + 0.25, TILE_SIZE + 0.25)
      .fill(tile.color)
      .stroke({ alpha: model.detailLevel === 'close' ? 0.18 : 0.08, color: 0x0a1510, width: 0.12 });
    drawPattern(graphics, x, y, model, tile.overlayValue);
    if (model.overlay.value !== 'terrain') continue;
    const textureStride =
      model.detailLevel === 'overview' ? 4 : model.detailLevel === 'district' ? 2 : 1;
    if ((tile.tileIndex + tile.variant) % textureStride !== 0) continue;
    const drift = tile.variant * 0.35;
    const detailMarks = model.detailLevel === 'close' ? 2 : 1;
    if (tile.biome === 0) {
      for (let wave = 0; wave < detailMarks; wave += 1) {
        graphics
          .moveTo(x + 0.55, y + 1.7 + drift + wave * 1.65)
          .lineTo(x + 1.65, y + 1.35 + drift + wave * 1.65)
          .lineTo(x + 2.75, y + 1.7 + drift + wave * 1.65)
          .lineTo(x + 3.85, y + 1.35 + drift + wave * 1.65)
          .lineTo(x + 5.2, y + 1.7 + drift + wave * 1.65)
          .stroke({ alpha: 0.76, color: wave === 0 ? 0x8ec0c6 : 0xd0e0d6, width: 0.32 });
      }
    } else if (tile.biome === 1) {
      for (let crystal = 0; crystal < detailMarks; crystal += 1) {
        const crystalX = x + 1.2 + drift + crystal * 2.2;
        const crystalY = y + 1.35 + crystal * 1.8;
        graphics
          .moveTo(crystalX, crystalY)
          .lineTo(crystalX + 1, crystalY + 1)
          .moveTo(crystalX + 1, crystalY)
          .lineTo(crystalX, crystalY + 1)
          .stroke({ alpha: 0.88, color: 0xf1f4ec, width: 0.28 });
      }
    } else if (tile.biome === 2) {
      for (let tuft = 0; tuft < detailMarks; tuft += 1) {
        const tuftX = x + 1.3 + drift + tuft * 2.25;
        graphics
          .moveTo(tuftX, y + 4.9 - tuft * 1.35)
          .lineTo(tuftX + 0.4, y + 3.25 - tuft * 1.35)
          .lineTo(tuftX + 0.85, y + 4.9 - tuft * 1.35)
          .stroke({ alpha: 0.9, color: 0xc8d98a, width: 0.34 });
      }
    } else if (tile.biome === 3) {
      for (let tree = 0; tree < detailMarks; tree += 1) {
        const treeX = x + 1 + drift + tree * 2.15;
        const treeY = y + 4.9 - tree * 0.75;
        graphics
          .moveTo(treeX, treeY)
          .lineTo(treeX + 1.15, treeY - 3.7)
          .lineTo(treeX + 2.3, treeY)
          .closePath()
          .fill(tree === 0 ? 0x183f2c : 0x28553a)
          .stroke({ alpha: 0.45, color: 0x102d21, width: 0.18 });
        if (model.detailLevel === 'close') {
          graphics.rect(treeX + 1.02, treeY - 0.75, 0.26, 1.15).fill(0x6b5438);
        }
      }
    } else if (tile.biome === 4) {
      for (let dune = 0; dune < detailMarks; dune += 1) {
        graphics
          .moveTo(x + 0.55, y + 2.55 + drift * 0.5 + dune * 1.55)
          .lineTo(x + 1.75, y + 2.05 + drift * 0.5 + dune * 1.55)
          .lineTo(x + 3.1, y + 2.55 + drift * 0.5 + dune * 1.55)
          .lineTo(x + 4.35, y + 2.05 + drift * 0.5 + dune * 1.55)
          .lineTo(x + 5.45, y + 2.55 + drift * 0.5 + dune * 1.55)
          .stroke({ alpha: 0.82, color: dune === 0 ? 0xefd38c : 0xa98248, width: 0.3 });
      }
    } else if (tile.biome === 5) {
      graphics
        .moveTo(x + 0.55, y + 4.55)
        .lineTo(x + 2.05, y + 4.25)
        .lineTo(x + 3.55, y + 4.55)
        .lineTo(x + 5.35, y + 4.25)
        .stroke({ alpha: 0.68, color: 0x78a7a0, width: 0.32 });
      for (let reed = 0; reed < 2 + (detailMarks - 1); reed += 1) {
        const reedX = x + 1.15 + reed * 1.65 + drift * 0.25;
        graphics
          .moveTo(reedX, y + 5)
          .lineTo(reedX + (reed === 0 ? -0.25 : 0.25), y + 2.2)
          .stroke({ color: 0x98bb7d, width: 0.32 });
      }
    } else if (tile.biome === 6) {
      graphics
        .moveTo(x + 0.7, y + 4.9)
        .lineTo(x + 2.25, y + 1.2 + drift * 0.3)
        .lineTo(x + 3.4, y + 3.2)
        .lineTo(x + 4.2, y + 1.9)
        .lineTo(x + 5.3, y + 4.9)
        .closePath()
        .fill(0x5d5a55)
        .stroke({ color: 0xd8d0c2, width: 0.36 });
      if (model.detailLevel === 'close') {
        graphics
          .moveTo(x + 1.65, y + 2.7)
          .lineTo(x + 2.25, y + 1.2 + drift * 0.3)
          .lineTo(x + 2.85, y + 2.7)
          .stroke({ color: 0xf0eee7, width: 0.28 });
      }
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
    if (model.detailLevel !== 'overview') {
      graphics
        .ellipse(x, y + 0.65, radius * 1.18, radius * 0.72)
        .fill({ alpha: 0.24, color: 0xead8a0 })
        .stroke({ alpha: 0.45, color: settlement.accentColor, width: 0.25 });
    }
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
    if (model.detailLevel === 'close') {
      graphics
        .moveTo(x - radius * 0.72, y + radius * 0.72)
        .lineTo(x - radius * 0.72, y - radius * 0.42)
        .lineTo(x - radius * 0.12, y - radius * 0.14)
        .lineTo(x - radius * 0.72, y + radius * 0.08)
        .fill(settlement.accentColor)
        .stroke({ color: 0x27352e, width: 0.22 });
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
          .stroke({ alpha: 0.6, color: 0x263329, width: 1.35 })
          .moveTo(baseX - 2.6, baseY + 1.6)
          .lineTo(baseX + 2.6, baseY - 1.6)
          .stroke({ color: 0xa98a5d, width: 0.85 });
      }
    } else if (descriptor.kind === 'farm') {
      graphics.rect(x - 1.7, y - 1.2, 3.4, 2.4).fill({ alpha: 0.38, color: 0x172a1e });
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
      if (model.detailLevel === 'close') {
        graphics
          .moveTo(x - 1.3, y - 0.55)
          .lineTo(x + 1.3, y - 0.55)
          .moveTo(x - 1.3, y + 0.55)
          .lineTo(x + 1.3, y + 0.55)
          .stroke({ alpha: 0.75, color: 0xf0d06c, width: 0.2 });
      }
    } else if (descriptor.kind === 'industry') {
      graphics.rect(x - 1.65, y + 0.95, 3.3, 0.65).fill({ alpha: 0.42, color: 0x17211c });
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
      if (model.detailLevel === 'close') {
        graphics
          .moveTo(x + 0.95, y - 1.9)
          .lineTo(x + 1.5, y - 2.45)
          .lineTo(x + 1.9, y - 2.25)
          .stroke({ alpha: 0.62, color: 0xb6c1ba, width: 0.32 });
      }
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
        .fill({ alpha: 0.68, color })
        .stroke({ color: 0xf5ead1, width: 0.48 });
      if (model.detailLevel === 'close') {
        graphics.rect(x - 0.32, y + 0.28, 0.64, 0.97).fill(0x27352e);
      }
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
        alpha: 0.7,
        color: 0x1c2922,
        width: route.volume >= 40 ? 1.75 : 1.25,
      })
      .moveTo(fromX, fromY)
      .lineTo(toX, toY)
      .stroke({
        color: route.status === 'disrupted' ? 0xd78b4b : 0xc6ad77,
        width: route.volume >= 40 ? 1.05 : 0.65,
      });
    if (route.status === 'active' && model.detailLevel !== 'overview') {
      graphics
        .moveTo(fromX, fromY)
        .lineTo(toX, toY)
        .stroke({ alpha: 0.75, color: 0x79cbd1, width: 0.22 });
    }
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
    const [tileX, tileY] = tilePoint(structure.tileIndex, model.width);
    const x = tileX + ((structure.selectable.id % 3) - 1) * 0.28;
    const y = tileY + ((Math.floor(structure.selectable.id / 3) % 2) - 0.5) * 0.22;
    const outline =
      structure.conditionTier === 'sound'
        ? 0xf5ead1
        : structure.conditionTier === 'worn'
          ? 0xd78b4b
          : 0xd75454;
    const fill = materialColor(structure.material);
    const markCount =
      structure.conditionTier === 'sound' ? 1 : structure.conditionTier === 'worn' ? 2 : 3;
    if (structure.state !== STRUCTURE_STATE_CODES.planned) {
      graphics.ellipse(x + 0.28, y + 2.05, 2.65, 0.88).fill({ alpha: 0.42, color: 0x111a16 });
    }
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
      graphics
        .rect(x - 1.62, y + 0.05, 0.68, 0.62)
        .fill(0xe9c36a)
        .stroke({ color: 0x27352e, width: 0.22 });
      if (structure.form === 'storehouse') {
        graphics
          .moveTo(x - 1.65, y + 0.1)
          .lineTo(x - 0.85, y + 0.1)
          .moveTo(x + 0.85, y + 0.1)
          .lineTo(x + 1.65, y + 0.1)
          .stroke({ color: 0xe9dfba, width: 0.45 });
      } else if (model.detailLevel === 'close') {
        graphics
          .rect(x + 0.95, y + 0.05, 0.66, 0.62)
          .fill(0x9ec4bd)
          .stroke({ color: 0x27352e, width: 0.22 });
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
      graphics.ellipse(x - 0.3, y + 2.3, 2.9, 0.7).fill({ alpha: 0.5, color: 0x17211c });
      graphics
        .rect(x - 2.55, y + 1.75, 5.1, 0.65)
        .fill(0x596a68)
        .stroke({ color: landmark.accentColor, width: 0.25 });
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
      if (model.detailLevel === 'close') {
        graphics
          .moveTo(x - 0.35, y + 2.1)
          .lineTo(x, y + 3.2)
          .lineTo(x + 0.35, y + 2.1)
          .fill(0xe7bc61);
      }
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
        graphics
          .moveTo(x - radius * 0.65, y - radius * 0.45)
          .lineTo(x - radius * 0.1, y - radius * 0.72)
          .stroke({ alpha: 0.78, color: 0xe6eee7, width: 0.38 });
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
      graphics.ellipse(x, y + 1.65, 1.35, 0.42).fill({ alpha: 0.38, color: 0x17211c });
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
      graphics.ellipse(x, y + 1.75, 2.65, 0.66).fill({ alpha: 0.42, color: 0x17211c });
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
      if (model.detailLevel === 'close') {
        graphics
          .moveTo(x - 1.2, y - 0.45)
          .lineTo(x, y - 1.35)
          .lineTo(x + 1.2, y - 0.45)
          .stroke({ alpha: 0.78, color: 0xe7f2e9, width: 0.32 });
      }
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
      (model.detailLevel === 'overview' ? 3.2 : model.detailLevel === 'district' ? 4.35 : 5.65) *
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
    if (model.detailLevel !== 'overview') {
      graphics
        .ellipse(centerX, centerY + height * 0.58, halfWidth * 1.45, height * 0.12)
        .fill({ alpha: 0.48, color: 0x101813 });
    }
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
    if (model.detailLevel === 'close') {
      graphics
        .moveTo(centerX - height * 0.085, headY - height * 0.045)
        .lineTo(centerX + direction * height * 0.025, headY - height * 0.135)
        .lineTo(centerX + direction * height * 0.13, headY - height * 0.04)
        .stroke({ color: 0x3e3028, width: 0.42 });
      graphics
        .rect(centerX + direction * height * 0.09 - 0.12, headY - height * 0.012, 0.24, 0.24)
        .fill(0x17211c);
    }
    graphics
      .moveTo(centerX - halfWidth * 0.82, bodyTop + height * 0.08)
      .lineTo(centerX - halfWidth * 1.4, centerY + height * 0.18)
      .moveTo(centerX + halfWidth * 0.82, bodyTop + height * 0.08)
      .lineTo(centerX + halfWidth * 1.4, centerY + height * 0.16)
      .stroke({ color: agent.identity.skinColor, width: 0.48 });
    graphics
      .moveTo(centerX - halfWidth * 0.72, bodyBottom)
      .lineTo(centerX - halfWidth, centerY + height * 0.55)
      .moveTo(centerX + halfWidth * 0.72, bodyBottom)
      .lineTo(centerX + halfWidth, centerY + height * 0.55)
      .stroke({ color: 0x27352e, width: 0.58 });
    if (model.detailLevel === 'close') {
      graphics
        .moveTo(centerX - halfWidth * 1.18, centerY + height * 0.55)
        .lineTo(centerX - halfWidth * 0.64, centerY + height * 0.55)
        .moveTo(centerX + halfWidth * 0.64, centerY + height * 0.55)
        .lineTo(centerX + halfWidth * 1.18, centerY + height * 0.55)
        .stroke({ color: 0x101813, width: 0.52 });
    }
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
    const inset = 2 + index * 1.5;
    graphics
      .rect(
        inset,
        inset,
        Math.max(1, model.width * TILE_SIZE - inset * 2),
        Math.max(1, model.height * TILE_SIZE - inset * 2),
      )
      .stroke({
        alpha: effect.reduced ? 0.42 : 0.72,
        color: 0xd76d55,
        width: effect.severity >= 60 ? 1.2 : 0.6,
      });
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
  return null;
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
  return null;
}

export function WorldMapCanvas({
  camera,
  onCameraChange,
  onSelectionChange,
  onViewportResize,
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
  const onViewportResizeRef = useRef(onViewportResize);
  const overlayRef = useRef(overlay);
  const projectionRef = useRef(projection);
  const reducedEffectsRef = useRef(reducedEffects);
  const selectionRef = useRef(selection);
  const lastViewportSizeRef = useRef({ height: 0, width: 0 });
  const [renderAttempt, setRenderAttempt] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [viewportRevision, setViewportRevision] = useState(0);
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
    onViewportResizeRef.current = onViewportResize;
    overlayRef.current = overlay;
    projectionRef.current = projection;
    reducedEffectsRef.current = reducedEffects;
    selectionRef.current = selection;
  }, [
    camera,
    onCameraChange,
    onSelectionChange,
    onViewportResize,
    overlay,
    projection,
    reducedEffects,
    selection,
  ]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const contentRect = entries[0]?.contentRect;
      const width = Math.round(contentRect?.width ?? host.clientWidth);
      const height = Math.round(contentRect?.height ?? host.clientHeight);
      if (width < 1 || height < 1) return;
      const previous = lastViewportSizeRef.current;
      if (previous.width === width && previous.height === height) return;
      lastViewportSizeRef.current = { height, width };
      setViewportRevision((revision) => revision + 1);
      onViewportResizeRef.current?.(width, height);
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
    };
  }, []);

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
    delete host.dataset.renderError;
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
        setRenderError(null);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          const message = error instanceof Error ? error.message : 'Renderer unavailable';
          host.dataset.renderError = message;
          setRenderError(message);
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
  }, [renderAttempt]);

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
  }, [camera, overlay, projection, reducedEffects, selection, viewportRevision]);

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
    cameraRef.current = next;
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
      const next = panCamera(cameraRef.current, direction[0], direction[1]);
      cameraRef.current = next;
      onCameraChangeRef.current(next);
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      const next = zoomCamera(cameraRef.current, 1.15);
      cameraRef.current = next;
      onCameraChangeRef.current(next);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      const next = zoomCamera(cameraRef.current, 1 / 1.15);
      cameraRef.current = next;
      onCameraChangeRef.current(next);
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
            ][0]?.selectable ?? null);
      onSelectionChangeRef.current?.(selectable);
    }
  };

  return (
    <>
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
      {renderError === null ? null : (
        <div className="map-render-error" role="alert">
          <p>
            <strong>The world map could not start.</strong> {renderError}
          </p>
          <button
            onClick={() => {
              setRenderError(null);
              setRenderAttempt((attempt) => attempt + 1);
            }}
            type="button"
          >
            Retry world map
          </button>
        </div>
      )}
    </>
  );
}
