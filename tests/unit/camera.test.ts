import { describe, expect, it } from 'vitest';

import { INITIAL_WORLD_CAMERA, panCamera, zoomCamera } from '../../src/rendering/camera';

describe('world camera', () => {
  it('pans without changing zoom', () => {
    expect(panCamera(INITIAL_WORLD_CAMERA, 12, -8)).toEqual({ x: 36, y: 16, zoom: 1 });
  });

  it('clamps zoom to a calm usable range', () => {
    expect(zoomCamera(INITIAL_WORLD_CAMERA, 0.001).zoom).toBe(0.5);
    expect(zoomCamera(INITIAL_WORLD_CAMERA, 100).zoom).toBe(5);
  });

  it('rejects non-finite camera input at the rendering boundary', () => {
    expect(panCamera({ x: Number.POSITIVE_INFINITY, y: 0, zoom: 1 }, 1, 1).x).toBe(0);
    expect(zoomCamera(INITIAL_WORLD_CAMERA, Number.NaN)).toEqual(INITIAL_WORLD_CAMERA);
  });
});
