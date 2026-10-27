import { describe, expect, it } from "vitest";

import { APP_NAME, APP_VERSION, APP_VERSION_LABEL } from "./app-meta.js";

describe("application metadata", () => {
  it("exposes the standalone app identity and semantic version", () => {
    expect(APP_NAME).toBe("Hima");
    expect(APP_VERSION).toBe("0.37.0");
    expect(APP_VERSION_LABEL).toBe("v0.37.0");
  });
});
