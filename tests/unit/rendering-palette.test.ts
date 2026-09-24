import { describe, expect, it } from 'vitest';

import {
  colorForTile,
  mixColor,
  overlayDefinition,
  WORLD_OVERLAYS,
} from '../../src/rendering/world-palette';

describe('world palette', () => {
  it('defines every interactive overlay once', () => {
    expect(WORLD_OVERLAYS.map(({ value }) => value)).toEqual([
      'terrain',
      'resources',
      'population',
      'trade',
      'technology',
      'danger',
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
    expect(colorForTile('population', 0, 2_000, 0, 0, 1_000)).not.toBe(
      colorForTile('technology', 0, 2_000, 0, 0, 1_000),
    );
    expect(colorForTile('population', 0, 500, 0, 0, 0)).not.toBe(
      colorForTile('population', 0, 500, 0, 0, 1_000),
    );
    expect(colorForTile('danger', 2, 0, 0, 120, 800)).not.toBe(
      colorForTile('danger', 3, 0, 0, 120, 800),
    );
    expect(colorForTile('danger', 2, 0, 0, 120, 0)).not.toBe(
      colorForTile('danger', 2, 0, 0, 120, 1_000),
    );
  });

  it('pairs every scalar overlay with a text legend and redundant pattern cue', () => {
    for (const overlay of WORLD_OVERLAYS) {
      const definition = overlayDefinition(overlay.value);
      expect(definition.legend.length).toBeGreaterThan(0);
      expect(definition.pattern.length).toBeGreaterThan(0);
    }
  });
});
