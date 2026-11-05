// SPDX-License-Identifier: MIT
// Copyright (C) 2026 erdlabs
import { describe, expect, it } from "vitest";

import { de } from "./de.js";
import { en } from "./en.js";
import { resolveLocale, translate } from "./index.js";

const placeholders = (text: string): string[] => (text.match(/\{\w+\}/g) ?? []).sort();

describe("catalogs", () => {
  it("carry the same keys in German and English", () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
  });

  it("have no empty strings and matching placeholders", () => {
    for (const [key, text] of Object.entries(en)) {
      expect(text, key).not.toBe("");
      expect(de[key as keyof typeof en], key).not.toBe("");
      expect(placeholders(de[key as keyof typeof en]), key).toEqual(placeholders(text));
    }
  });
});

describe("resolveLocale", () => {
  it("prefers an explicit choice over the browser language", () => {
    expect(resolveLocale("en", ["de-DE"])).toBe("en");
    expect(resolveLocale("de", ["en-US"])).toBe("de");
  });

  it("follows the first supported browser language, else English", () => {
    expect(resolveLocale(null, ["fr-FR", "de-AT", "en"])).toBe("de");
    expect(resolveLocale("auto", ["en-GB"])).toBe("en");
    expect(resolveLocale(null, ["fr-FR"])).toBe("en");
    expect(resolveLocale(null, [])).toBe("en");
  });
});

describe("translate", () => {
  it("fills placeholders and leaves unknown ones visible", () => {
    expect(translate("en", "topbar.snoozed", { count: 3 })).toBe("Snoozed (3)");
    expect(translate("de", "topbar.accountCount", { ready: 2, total: 5 })).toBe("2/5 Konten");
    expect(translate("en", "topbar.snoozed")).toBe("Snoozed ({count})");
  });
});
