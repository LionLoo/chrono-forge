import { describe, expect, it } from 'vitest';

import {
  INITIAL_WORLD_CAMERA,
  panCamera,
  zoomCamera,
  zoomCameraAt,
} from '../../src/rendering/camera';

describe('world camera', () => {
  it('pans without changing zoom', () => {
    expect(panCamera(INITIAL_WORLD_CAMERA, 12, -8)).toEqual({ x: 36, y: 16, zoom: 1 });
  });

  it('clamps zoom to a calm usable range', () => {
    expect(zoomCamera(INITIAL_WORLD_CAMERA, 0.001).zoom).toBe(0.5);
    expect(zoomCamera(INITIAL_WORLD_CAMERA, 100).zoom).toBe(5);
  });

  it('zooms around the supplied viewport point', () => {
    const camera = { x: 24, y: 18, zoom: 1 };
    const anchor = { x: 180, y: 72 };
    const zoomed = zoomCameraAt(camera, 2, anchor.x, anchor.y);

    expect(zoomed).toEqual({ x: -132, y: -36, zoom: 2 });
    expect((anchor.x - zoomed.x) / zoomed.zoom).toBe((anchor.x - camera.x) / camera.zoom);
    expect((anchor.y - zoomed.y) / zoomed.zoom).toBe((anchor.y - camera.y) / camera.zoom);
  });

  it('rejects non-finite camera input at the rendering boundary', () => {
    expect(panCamera({ x: Number.POSITIVE_INFINITY, y: 0, zoom: 1 }, 1, 1).x).toBe(0);
    expect(zoomCamera(INITIAL_WORLD_CAMERA, Number.NaN)).toEqual(INITIAL_WORLD_CAMERA);
    expect(zoomCameraAt(INITIAL_WORLD_CAMERA, 2, Number.NaN, Number.NaN)).toEqual({
      x: 48,
      y: 48,
      zoom: 2,
    });
  });
});
