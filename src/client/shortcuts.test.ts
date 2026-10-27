import { describe, expect, it } from "vitest";

import { shortcutFor } from "./shortcuts.js";

const press = (key: string, extra: Partial<Parameters<typeof shortcutFor>[0]> = {}) =>
  shortcutFor({ key, ctrlKey: false, metaKey: false, altKey: false, target: null, ...extra });

describe("shortcutFor", () => {
  it("maps list navigation and mail actions", () => {
    expect(press("j")).toBe("next");
    expect(press("k")).toBe("previous");
    expect(press("r")).toBe("reply");
    expect(press("#")).toBe("delete");
    expect(press("e")).toBe("archive");
    expect(press("l")).toBe("label");
    expect(press("?")).toBe("help");
  });

  it("ignores unknown keys and modified presses", () => {
    expect(press("x")).toBeNull();
    expect(press("r", { ctrlKey: true })).toBeNull();
    expect(press("j", { metaKey: true })).toBeNull();
  });

  it("stays silent while typing in a field", () => {
    expect(press("j", { target: { tagName: "INPUT" } as unknown as EventTarget })).toBeNull();
    expect(press("r", { target: { tagName: "TEXTAREA" } as unknown as EventTarget })).toBeNull();
    expect(press("r", { target: { tagName: "DIV", isContentEditable: true } as unknown as EventTarget })).toBeNull();
  });
});
