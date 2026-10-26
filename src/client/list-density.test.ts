import { describe, expect, it } from "vitest";

import { LIST_DENSITY_KEY, readListDensity, resolveListDensity, writeListDensity } from "./list-density.js";

describe("list density", () => {
  it("defaults to compact for missing, unknown, and non-string values", () => {
    expect(resolveListDensity(null)).toBe("compact");
    expect(resolveListDensity("dense")).toBe("compact");
    expect(resolveListDensity(42)).toBe("compact");
    expect(resolveListDensity("comfortable")).toBe("comfortable");
  });

  it("reads the stored value and survives a throwing storage", () => {
    expect(readListDensity({ getItem: (key) => (key === LIST_DENSITY_KEY ? "comfortable" : null) })).toBe("comfortable");
    expect(readListDensity({ getItem: () => { throw new Error("blocked"); } })).toBe("compact");
  });

  it("writes valid values and reports storage failures", () => {
    const values = new Map<string, string>();
    expect(writeListDensity({ setItem: (key, value) => { values.set(key, value); } }, "comfortable")).toBe(true);
    expect(values.get(LIST_DENSITY_KEY)).toBe("comfortable");
    expect(writeListDensity({ setItem: () => { throw new Error("full"); } }, "compact")).toBe(false);
  });
});
