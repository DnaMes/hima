import { describe, expect, it } from "vitest";

import { THEMES } from "./themes.js";

const channels = (hex: string): number[] => [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));

function luminance(hex: string): number {
  const [red, green, blue] = channels(hex).map((value) => {
    const raw = value / 255;
    return raw <= 0.03928 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: string, second: string): number {
  const left = luminance(first);
  const right = luminance(second);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

function blend(foreground: string, background: string, alpha: number): string {
  const mixed = channels(background).map((value, index) => Math.round(value * (1 - alpha) + (channels(foreground)[index] ?? 0) * alpha));
  return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

describe.each(Object.entries(THEMES))("theme contrast: %s", (_name, theme) => {
  const areas = {
    areaAccounts: theme.colors.areaAccounts,
    areaList: theme.colors.areaList,
    areaReader: theme.colors.areaReader,
  };

  it("keeps the three area backgrounds distinct", () => {
    expect(new Set(Object.values(areas)).size).toBe(3);
  });

  it("keeps body and muted text readable on every area", () => {
    for (const background of Object.values(areas)) {
      expect(contrast(theme.colors.text, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.colors.mutedText, background)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(theme.colors.mutedText, theme.colors.field)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps each area title readable on its own area", () => {
    expect(contrast(theme.colors.titleAccounts, theme.colors.areaAccounts)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.colors.titleList, theme.colors.areaList)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.colors.titleReader, theme.colors.areaReader)).toBeGreaterThanOrEqual(4.5);
  });

  it("provides eight distinct account hues that work as dots, lines, and chip text", () => {
    expect(theme.accountHues).toHaveLength(8);
    expect(new Set(theme.accountHues).size).toBe(8);
    for (const hue of theme.accountHues) {
      expect(hue).toMatch(/^#[0-9a-f]{6}$/i);
      for (const background of Object.values(areas)) {
        expect(contrast(hue, background)).toBeGreaterThanOrEqual(3);
        expect(contrast(hue, blend(hue, background, 0.14))).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
