import { describe, expect, it } from 'vitest';

import {
  ACCESSIBILITY_THEME_CONTRAST_PAIRS,
  WCAG_AA_ESSENTIAL_GRAPHIC_RATIO,
  WCAG_AA_LARGE_TEXT_RATIO,
  WCAG_AA_NORMAL_TEXT_RATIO,
  clampRgbChannel,
  contrastRatio,
  meetsContrastRatio,
  opaqueHex,
  relativeLuminance,
} from '../../src/ui/accessibility-theme';

describe('M7 accessibility theme contrast', () => {
  it('keeps every named current and M7 interface pair at its WCAG AA threshold', () => {
    expect(ACCESSIBILITY_THEME_CONTRAST_PAIRS.length).toBeGreaterThan(0);
    expect(new Set(ACCESSIBILITY_THEME_CONTRAST_PAIRS.map((pair) => pair.id)).size).toBe(
      ACCESSIBILITY_THEME_CONTRAST_PAIRS.length,
    );

    for (const pair of ACCESSIBILITY_THEME_CONTRAST_PAIRS) {
      expect(
        contrastRatio(pair.foreground, pair.background),
        `${pair.id} must meet ${pair.minimumRatio}:1 against its named opaque surface`,
      ).toBeGreaterThanOrEqual(pair.minimumRatio);
    }
  });

  it('uses 4.5:1 for normal text and 3:1 for large text, controls, and focus graphics', () => {
    for (const pair of ACCESSIBILITY_THEME_CONTRAST_PAIRS) {
      const expected =
        pair.kind === 'normal-text'
          ? WCAG_AA_NORMAL_TEXT_RATIO
          : pair.kind === 'large-text'
            ? WCAG_AA_LARGE_TEXT_RATIO
            : WCAG_AA_ESSENTIAL_GRAPHIC_RATIO;
      expect(pair.minimumRatio, pair.id).toBe(expected);
    }
  });

  it('calculates the WCAG luminance endpoints and a symmetric contrast ratio', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBe(1);
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#ffffff', '#000000')).toBe(21);
  });

  it('keeps exact thresholds inclusive and rejects just-below ratios', () => {
    expect(meetsContrastRatio(4.5, WCAG_AA_NORMAL_TEXT_RATIO)).toBe(true);
    expect(meetsContrastRatio(4.499_999, WCAG_AA_NORMAL_TEXT_RATIO)).toBe(false);
    expect(meetsContrastRatio(3, WCAG_AA_ESSENTIAL_GRAPHIC_RATIO)).toBe(true);
    expect(meetsContrastRatio(2.999_999, WCAG_AA_ESSENTIAL_GRAPHIC_RATIO)).toBe(false);
  });

  it('clamps generated opaque channels and rejects non-finite color data', () => {
    expect(clampRgbChannel(-1)).toBe(0);
    expect(clampRgbChannel(127.5)).toBe(128);
    expect(clampRgbChannel(300)).toBe(255);
    expect(opaqueHex({ red: -1, green: 127.5, blue: 300 })).toBe('#0080ff');
    expect(() => clampRgbChannel(Number.NaN)).toThrow(TypeError);
    expect(() => relativeLuminance('#1234')).toThrow(TypeError);
    expect(() => relativeLuminance('rgba(0, 0, 0, 1)')).toThrow(TypeError);
  });
});
