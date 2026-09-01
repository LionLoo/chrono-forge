/**
 * Opaque contrast pairs for the existing interface and the M7 token migration.
 *
 * CSS continues to own presentation for now. Keeping these values in TypeScript
 * gives tests a stable, named source of truth before the visual tokens move into
 * the stylesheet.
 */
export type ContrastKind = 'normal-text' | 'large-text' | 'essential-graphic';

export interface ContrastPair {
  readonly background: string;
  readonly foreground: string;
  readonly id: string;
  readonly kind: ContrastKind;
  readonly minimumRatio: number;
}

export const WCAG_AA_NORMAL_TEXT_RATIO = 4.5;
export const WCAG_AA_LARGE_TEXT_RATIO = 3;
export const WCAG_AA_ESSENTIAL_GRAPHIC_RATIO = 3;

const NORMAL_TEXT: ContrastKind = 'normal-text';
const ESSENTIAL_GRAPHIC: ContrastKind = 'essential-graphic';

/**
 * Current opaque CSS surfaces and M7 target surfaces. Semi-transparent CSS
 * decorations are intentionally excluded: they are not a stable text surface
 * and must not become the sole support for readable text.
 */
export const ACCESSIBILITY_THEME_CONTRAST_PAIRS = [
  {
    id: 'current-app-default-text',
    foreground: '#edf5ea',
    background: '#0b100d',
    kind: NORMAL_TEXT,
    minimumRatio: WCAG_AA_NORMAL_TEXT_RATIO,
  },
  {
    id: 'current-hero-body-copy',
    foreground: '#afbdad',
    background: '#0b100d',
    kind: NORMAL_TEXT,
    minimumRatio: WCAG_AA_NORMAL_TEXT_RATIO,
  },
  {
    id: 'current-hero-heading',
    foreground: '#f5ecd8',
    background: '#0b100d',
    kind: 'large-text',
    minimumRatio: WCAG_AA_LARGE_TEXT_RATIO,
  },
  {
    id: 'current-card-metadata',
    foreground: '#9fb19f',
    background: '#0e1611',
    kind: NORMAL_TEXT,
    minimumRatio: WCAG_AA_NORMAL_TEXT_RATIO,
  },
  {
    id: 'current-overlay-option',
    foreground: '#bdc9bb',
    background: '#17221b',
    kind: NORMAL_TEXT,
    minimumRatio: WCAG_AA_NORMAL_TEXT_RATIO,
  },
  {
    id: 'current-selected-overlay-option',
    foreground: '#ffe3a2',
    background: '#4b3a24',
    kind: NORMAL_TEXT,
    minimumRatio: WCAG_AA_NORMAL_TEXT_RATIO,
  },
  {
    id: 'current-focus-input-text',
    foreground: '#f0f5ee',
    background: '#0a110d',
    kind: NORMAL_TEXT,
    minimumRatio: WCAG_AA_NORMAL_TEXT_RATIO,
  },
  {
    id: 'current-primary-action-text',
    foreground: '#fff2d1',
    background: '#8f632f',
    kind: NORMAL_TEXT,
    minimumRatio: WCAG_AA_NORMAL_TEXT_RATIO,
  },
  {
    id: 'current-fault-status-text',
    foreground: '#ffd1c7',
    background: '#792f27',
    kind: NORMAL_TEXT,
    minimumRatio: WCAG_AA_NORMAL_TEXT_RATIO,
  },
  {
    id: 'current-focus-indicator',
    foreground: '#f3c96d',
    background: '#0b100d',
    kind: ESSENTIAL_GRAPHIC,
    minimumRatio: WCAG_AA_ESSENTIAL_GRAPHIC_RATIO,
  },
  {
    id: 'current-neutral-control-boundary',
    foreground: '#667967',
    background: '#17241b',
    kind: ESSENTIAL_GRAPHIC,
    minimumRatio: WCAG_AA_ESSENTIAL_GRAPHIC_RATIO,
  },
  {
    id: 'm7-inspector-body-text',
    foreground: '#bdcabb',
    background: '#0a120d',
    kind: NORMAL_TEXT,
    minimumRatio: WCAG_AA_NORMAL_TEXT_RATIO,
  },
  {
    id: 'm7-inspector-field-label',
    foreground: '#cbd8c9',
    background: '#0a120d',
    kind: NORMAL_TEXT,
    minimumRatio: WCAG_AA_NORMAL_TEXT_RATIO,
  },
  {
    id: 'm7-inspector-value',
    foreground: '#f0e2b9',
    background: '#101b14',
    kind: NORMAL_TEXT,
    minimumRatio: WCAG_AA_NORMAL_TEXT_RATIO,
  },
  {
    id: 'm7-primary-control-boundary',
    foreground: '#d8a74e',
    background: '#101a14',
    kind: ESSENTIAL_GRAPHIC,
    minimumRatio: WCAG_AA_ESSENTIAL_GRAPHIC_RATIO,
  },
  {
    id: 'm7-input-control-boundary',
    foreground: '#6f8b75',
    background: '#0a110d',
    kind: ESSENTIAL_GRAPHIC,
    minimumRatio: WCAG_AA_ESSENTIAL_GRAPHIC_RATIO,
  },
] as const satisfies readonly ContrastPair[];

interface RgbColor {
  readonly blue: number;
  readonly green: number;
  readonly red: number;
}

const OPAQUE_HEX = /^#[\da-f]{6}$/iu;

function parseOpaqueHex(color: string): RgbColor {
  if (!OPAQUE_HEX.test(color)) {
    throw new TypeError(`Expected an opaque #rrggbb color, received ${color}.`);
  }

  return {
    red: Number.parseInt(color.slice(1, 3), 16),
    green: Number.parseInt(color.slice(3, 5), 16),
    blue: Number.parseInt(color.slice(5, 7), 16),
  };
}

/** Clamps one RGB channel before it is serialized into a testable opaque color. */
export function clampRgbChannel(value: number): number {
  if (!Number.isFinite(value)) throw new TypeError('RGB channels must be finite numbers.');
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Serializes an RGB color into the opaque representation required by this registry. */
export function opaqueHex({ red, green, blue }: RgbColor): string {
  return `#${[red, green, blue]
    .map((channel) => clampRgbChannel(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

function linearChannel(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

/** Returns WCAG relative luminance for a named opaque interface color. */
export function relativeLuminance(color: string): number {
  const { red, green, blue } = parseOpaqueHex(color);
  return 0.2126 * linearChannel(red) + 0.7152 * linearChannel(green) + 0.0722 * linearChannel(blue);
}

/** Returns the symmetric WCAG contrast ratio between two opaque colors. */
export function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

/** Uses an inclusive threshold because a ratio exactly at AA passes WCAG. */
export function meetsContrastRatio(ratio: number, minimumRatio: number): boolean {
  if (!Number.isFinite(ratio) || !Number.isFinite(minimumRatio) || minimumRatio <= 0) {
    throw new TypeError('Contrast ratios must be finite and the minimum must be positive.');
  }
  return ratio >= minimumRatio;
}
