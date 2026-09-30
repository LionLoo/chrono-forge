export interface WorldCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export const INITIAL_WORLD_CAMERA: WorldCamera = Object.freeze({ x: 24, y: 24, zoom: 1.5 });

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;
const MAX_OFFSET = 20_000;
const DEFAULT_TILE_SIZE = 6;
const WORLD_FRAME_PADDING = 32;

function finiteClamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(minimum, Math.min(maximum, value));
}

export function panCamera(camera: WorldCamera, deltaX: number, deltaY: number): WorldCamera {
  return {
    x: finiteClamp(camera.x + deltaX, -MAX_OFFSET, MAX_OFFSET),
    y: finiteClamp(camera.y + deltaY, -MAX_OFFSET, MAX_OFFSET),
    zoom: finiteClamp(camera.zoom, MIN_ZOOM, MAX_ZOOM),
  };
}

export function zoomCamera(camera: WorldCamera, factor: number): WorldCamera {
  const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;

  return {
    x: finiteClamp(camera.x, -MAX_OFFSET, MAX_OFFSET),
    y: finiteClamp(camera.y, -MAX_OFFSET, MAX_OFFSET),
    zoom: finiteClamp(camera.zoom * safeFactor, MIN_ZOOM, MAX_ZOOM),
  };
}

/**
 * Changes zoom while preserving the world position beneath a viewport point.
 * The point is in pixels relative to the map host, not the page.
 */
export function zoomCameraAt(
  camera: WorldCamera,
  factor: number,
  anchorX: number,
  anchorY: number,
): WorldCamera {
  const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
  const currentZoom = finiteClamp(camera.zoom, MIN_ZOOM, MAX_ZOOM);
  const zoom = finiteClamp(currentZoom * safeFactor, MIN_ZOOM, MAX_ZOOM);
  const x = finiteClamp(camera.x, -MAX_OFFSET, MAX_OFFSET);
  const y = finiteClamp(camera.y, -MAX_OFFSET, MAX_OFFSET);
  const safeAnchorX = finiteClamp(anchorX, -MAX_OFFSET, MAX_OFFSET);
  const safeAnchorY = finiteClamp(anchorY, -MAX_OFFSET, MAX_OFFSET);
  const worldX = (safeAnchorX - x) / currentZoom;
  const worldY = (safeAnchorY - y) / currentZoom;

  return {
    x: finiteClamp(safeAnchorX - worldX * zoom, -MAX_OFFSET, MAX_OFFSET),
    y: finiteClamp(safeAnchorY - worldY * zoom, -MAX_OFFSET, MAX_OFFSET),
    zoom,
  };
}

/**
 * Frames the factual world for its actual viewport. Large production worlds retain the calm
 * launch composition; compact authoritative worlds are centered and enlarged instead of being
 * stranded in one corner. This transform is presentation-only.
 */
export function fitCameraToWorld(
  worldWidth: number,
  worldHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  tileSize = DEFAULT_TILE_SIZE,
): WorldCamera {
  if (
    !Number.isSafeInteger(worldWidth) ||
    worldWidth < 1 ||
    !Number.isSafeInteger(worldHeight) ||
    worldHeight < 1 ||
    !Number.isFinite(viewportWidth) ||
    viewportWidth < 1 ||
    !Number.isFinite(viewportHeight) ||
    viewportHeight < 1 ||
    !Number.isFinite(tileSize) ||
    tileSize <= 0
  ) {
    return INITIAL_WORLD_CAMERA;
  }

  const fitZoom = Math.max(
    Math.max(1, viewportWidth - WORLD_FRAME_PADDING) / (worldWidth * tileSize),
    Math.max(1, viewportHeight - WORLD_FRAME_PADDING) / (worldHeight * tileSize),
  );
  if (fitZoom <= 2) return INITIAL_WORLD_CAMERA;
  const zoom = finiteClamp(fitZoom, MIN_ZOOM, MAX_ZOOM);
  return {
    x: finiteClamp((viewportWidth - worldWidth * tileSize * zoom) / 2, -MAX_OFFSET, MAX_OFFSET),
    y: finiteClamp((viewportHeight - worldHeight * tileSize * zoom) / 2, -MAX_OFFSET, MAX_OFFSET),
    zoom,
  };
}

/** Centers one factual map tile in the visible presentation without affecting world authority. */
export function frameCameraOnTile(
  tileIndex: number,
  worldWidth: number,
  worldHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  requestedZoom = 3.5,
  tileSize = DEFAULT_TILE_SIZE,
): WorldCamera {
  if (
    !Number.isSafeInteger(tileIndex) ||
    tileIndex < 0 ||
    !Number.isSafeInteger(worldWidth) ||
    worldWidth < 1 ||
    !Number.isSafeInteger(worldHeight) ||
    worldHeight < 1 ||
    tileIndex >= worldWidth * worldHeight ||
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight) ||
    viewportWidth < 1 ||
    viewportHeight < 1 ||
    !Number.isFinite(tileSize) ||
    tileSize <= 0
  ) {
    return INITIAL_WORLD_CAMERA;
  }

  const overview = fitCameraToWorld(
    worldWidth,
    worldHeight,
    viewportWidth,
    viewportHeight,
    tileSize,
  );
  const zoom = finiteClamp(
    Number.isFinite(requestedZoom) ? Math.max(requestedZoom, overview.zoom) : overview.zoom,
    MIN_ZOOM,
    MAX_ZOOM,
  );
  const tileX = tileIndex % worldWidth;
  const tileY = Math.floor(tileIndex / worldWidth);
  return {
    x: finiteClamp(viewportWidth / 2 - (tileX + 0.5) * tileSize * zoom, -MAX_OFFSET, MAX_OFFSET),
    y: finiteClamp(viewportHeight / 2 - (tileY + 0.5) * tileSize * zoom, -MAX_OFFSET, MAX_OFFSET),
    zoom,
  };
}
