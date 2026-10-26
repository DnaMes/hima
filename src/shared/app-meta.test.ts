import { describe, expect, it } from "vitest";

import { APP_NAME, APP_VERSION, APP_VERSION_LABEL } from "./app-meta.js";

describe("application metadata", () => {
  it("exposes the standalone app identity and semantic version", () => {
    expect(APP_NAME).toBe("Hima");
    expect(APP_VERSION).toBe("0.36.1");
    expect(APP_VERSION_LABEL).toBe("v0.36.1");
  });
});
