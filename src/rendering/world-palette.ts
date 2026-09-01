export type WorldOverlay =
  | 'terrain'
  | 'resources'
  | 'population'
  | 'trade'
  | 'technology'
  | 'danger'
  | 'habitability'
  | 'hazards';

export type OverlayPattern = 'none' | 'speckle' | 'rings' | 'hatch' | 'grid' | 'chevron' | 'dots';

export interface WorldOverlayDefinition {
  readonly label: string;
  readonly legend: string;
  readonly pattern: OverlayPattern;
  readonly value: WorldOverlay;
}

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
  population: 0xb497e7,
  trade: 0x79cbd1,
  technology: 0x9fcb78,
  danger: 0xd76d55,
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
  derivedValue = 0,
): number {
  if (overlay === 'terrain') return TERRAIN_COLORS[biome] ?? 0x5a5650;

  const value =
    overlay === 'resources'
      ? Math.round((Math.min(RESOURCE_DISPLAY_CEILING, resource) * 255) / RESOURCE_DISPLAY_CEILING)
      : overlay === 'habitability'
        ? habitability
        : overlay === 'hazards' || overlay === 'danger'
          ? hazard
          : Math.round((Math.max(0, Math.min(1_000, derivedValue)) * 255) / 1_000);

  return mixColor(OVERLAY_LOW, OVERLAY_HIGH[overlay], value);
}

export const WORLD_OVERLAYS: readonly WorldOverlayDefinition[] = [
  { label: 'Terrain', legend: 'Biome and water', pattern: 'none', value: 'terrain' },
  { label: 'Resources', legend: 'Material abundance', pattern: 'speckle', value: 'resources' },
  { label: 'Population', legend: 'Settlement population', pattern: 'rings', value: 'population' },
  { label: 'Trade', legend: 'Active exchange volume', pattern: 'hatch', value: 'trade' },
  { label: 'Technology', legend: 'Known development tier', pattern: 'grid', value: 'technology' },
  { label: 'Danger', legend: 'Hazards and active crises', pattern: 'chevron', value: 'danger' },
  { label: 'Habitability', legend: 'Habitable terrain', pattern: 'dots', value: 'habitability' },
  { label: 'Hazards', legend: 'Terrain hazard', pattern: 'chevron', value: 'hazards' },
];

export function overlayDefinition(overlay: WorldOverlay): WorldOverlayDefinition {
  const definition = WORLD_OVERLAYS.find((candidate) => candidate.value === overlay);
  if (definition === undefined) throw new Error(`Unknown world overlay: ${overlay}`);
  return definition;
}
