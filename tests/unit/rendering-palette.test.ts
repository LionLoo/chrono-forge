import { describe, expect, it } from 'vitest';

import { colorForTile, mixColor, WORLD_OVERLAYS } from '../../src/rendering/world-palette';

describe('world palette', () => {
  it('defines every interactive overlay once', () => {
    expect(WORLD_OVERLAYS.map(({ value }) => value)).toEqual([
      'terrain',
      'resources',
      'habitability',
      'hazards',
    ]);
  });

  it('clamps overlay intensity and preserves endpoint colors', () => {
    expect(mixColor(0x102030, 0xa0b0c0, -20)).toBe(0x102030);
    expect(mixColor(0x102030, 0xa0b0c0, 300)).toBe(0xa0b0c0);
  });

  it('maps terrain and scalar overlays to distinct readable colors', () => {
    expect(colorForTile('terrain', 0, 0, 0, 0)).not.toBe(colorForTile('terrain', 3, 0, 0, 0));
    expect(colorForTile('resources', 0, 0, 0, 0)).not.toBe(
      colorForTile('resources', 0, 2_000, 0, 0),
    );
    expect(colorForTile('resources', 0, 1_000, 0, 0)).not.toBe(
      colorForTile('resources', 0, 2_000, 0, 0),
    );
    expect(colorForTile('habitability', 0, 0, 255, 0)).not.toBe(
      colorForTile('hazards', 0, 0, 0, 255),
    );
  });
});
