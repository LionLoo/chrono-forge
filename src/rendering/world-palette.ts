export type WorldOverlay = 'terrain' | 'resources' | 'habitability' | 'hazards';

const TERRAIN_COLORS = [
  0x2d6173, // water
  0xb7c4b9, // tundra
  0x789454, // grassland
  0x315b42, // forest
  0xc8a765, // desert
  0x527c6a, // wetland
  0x746e65, // mountain
] as const;

const OVERLAY_LOW = 0x172019;
const RESOURCE_DISPLAY_CEILING = 2_000;
const OVERLAY_HIGH = {
  resources: 0xf0c667,
  habitability: 0x62b99e,
  hazards: 0xd76d55,
} as const;

function mixChannel(low: number, high: number, intensity: number): number {
  return Math.round(low + ((high - low) * intensity) / 255);
}

export function mixColor(low: number, high: number, intensity: number): number {
  const normalized = Math.max(0, Math.min(255, Math.round(intensity)));
  const lowRed = (low >>> 16) & 0xff;
  const lowGreen = (low >>> 8) & 0xff;
  const lowBlue = low & 0xff;
  const highRed = (high >>> 16) & 0xff;
  const highGreen = (high >>> 8) & 0xff;
  const highBlue = high & 0xff;

  return (
    (mixChannel(lowRed, highRed, normalized) << 16) |
    (mixChannel(lowGreen, highGreen, normalized) << 8) |
    mixChannel(lowBlue, highBlue, normalized)
  );
}

export function colorForTile(
  overlay: WorldOverlay,
  biome: number,
  resource: number,
  habitability: number,
  hazard: number,
): number {
  if (overlay === 'terrain') return TERRAIN_COLORS[biome] ?? 0x5a5650;

  const value =
    overlay === 'resources'
      ? Math.round((Math.min(RESOURCE_DISPLAY_CEILING, resource) * 255) / RESOURCE_DISPLAY_CEILING)
      : overlay === 'habitability'
        ? habitability
        : hazard;

  return mixColor(OVERLAY_LOW, OVERLAY_HIGH[overlay], value);
}

export const WORLD_OVERLAYS: readonly { label: string; value: WorldOverlay }[] = [
  { label: 'Terrain', value: 'terrain' },
  { label: 'Resources', value: 'resources' },
  { label: 'Habitability', value: 'habitability' },
  { label: 'Hazards', value: 'hazards' },
];
