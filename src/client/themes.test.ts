import { describe, expect, it } from "vitest";

import {
  applyTheme,
  persistTheme,
  readStoredTheme,
  SEMANTIC_THEME_KEYS,
  THEME_STORAGE_KEY,
  THEMES,
} from "./themes.js";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  constructor(entries: readonly [string, string][] = []) {
    for (const [key, value] of entries) this.values.set(key, value);
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function contrastRatio(first: string, second: string): number {
  const channel = (value: string, offset: number): number => {
    const raw = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return raw <= 0.03928 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (value: string): number => (
    0.2126 * channel(value, 1) + 0.7152 * channel(value, 3) + 0.0722 * channel(value, 5)
  );
  const left = luminance(first);
  const right = luminance(second);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

describe("themes", () => {
  it("contains exactly the six supported themes", () => {
    expect(Object.keys(THEMES)).toEqual([
      "midnight",
      "vscode-dark",
      "catppuccin-mocha",
      "catppuccin-latte",
      "nord",
      "tokyo-night",
    ]);
  });

  it("provides every semantic variable and a visible focus color", () => {
    for (const theme of Object.values(THEMES)) {
      expect(Object.keys(theme.colors)).toEqual(SEMANTIC_THEME_KEYS);
      for (const color of Object.values(theme.colors)) expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.colors.focus).not.toBe(theme.colors.border);
    }
  });

  it("keeps primary text, muted text, accent contrast, and focus readable", () => {
    for (const theme of Object.values(THEMES)) {
      expect(contrastRatio(theme.colors.text, theme.colors.page)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.colors.mutedText, theme.colors.page)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(theme.colors.accentContrast, theme.colors.accent)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(theme.colors.focus, theme.colors.page)).toBeGreaterThanOrEqual(3);
    }
  });

  it("falls back to Midnight and repairs invalid storage", () => {
    const storage = new MemoryStorage([[THEME_STORAGE_KEY, "not-a-theme"]]);

    expect(readStoredTheme(storage)).toBe("midnight");
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("midnight");
  });

  it("persists only valid theme names", () => {
    const storage = new MemoryStorage();

    persistTheme(storage, "nord");
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("nord");
  });

  it("applies the data attribute and semantic custom properties", () => {
    const properties = new Map<string, string>();
    const root = {
      dataset: {} as DOMStringMap,
      style: { setProperty: (name: string, value: string) => properties.set(name, value) },
    } as unknown as HTMLElement;

    applyTheme(root, "tokyo-night");

    expect(root.dataset.theme).toBe("tokyo-night");
    expect(properties.get("--muted-text")).toBe(THEMES["tokyo-night"].colors.mutedText);
    expect(properties.get("--accent-contrast")).toBe(THEMES["tokyo-night"].colors.accentContrast);
  });

  it("applies the area tokens and the eight account hues", () => {
    const properties = new Map<string, string>();
    const root = {
      dataset: {} as DOMStringMap,
      style: { setProperty: (name: string, value: string) => properties.set(name, value) },
    } as unknown as HTMLElement;

    applyTheme(root, "midnight");

    expect(properties.get("--area-accounts")).toBe(THEMES.midnight.colors.areaAccounts);
    expect(properties.get("--title-reader")).toBe(THEMES.midnight.colors.titleReader);
    for (let index = 0; index < 8; index += 1) {
      expect(properties.get(`--account-hue-${index}`)).toBe(THEMES.midnight.accountHues[index]);
    }
  });
});
