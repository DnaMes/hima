import { describe, expect, it } from "vitest";

import { ListCache } from "./list-cache.js";

const list = (hasMore: boolean) => ({ envelopes: [], warnings: [], hasMore });

describe("ListCache", () => {
  it("returns what was stored and forgets it on clear", () => {
    const cache = new ListCache();
    cache.set("a", list(true));
    expect(cache.get("a")?.hasMore).toBe(true);
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
  });

  it("drops the oldest list beyond its bound", () => {
    const cache = new ListCache();
    for (let index = 0; index < 41; index++) cache.set(`k${index}`, list(false));
    expect(cache.get("k0")).toBeUndefined();
    expect(cache.get("k40")).toBeDefined();
  });
});
