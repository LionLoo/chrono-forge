export interface WorldCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export const INITIAL_WORLD_CAMERA: WorldCamera = Object.freeze({ x: 24, y: 24, zoom: 1 });

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5;
const MAX_OFFSET = 20_000;

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
