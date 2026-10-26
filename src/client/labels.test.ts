import { describe, expect, it } from "vitest";

import { addLabels, hasLabel, labelNames } from "./labels.js";

const entry = (labels: string[], message = "1") => ({ account: "a", mailbox: "INBOX", message, labels });

describe("labels", () => {
  it("lists every label once, case-insensitively, sorted", () => {
    expect(labelNames([entry(["Steuer", "rechnung"]), entry(["Rechnung", "Alt"], "2")])).toEqual(["Alt", "rechnung", "Steuer"]);
  });

  it("matches a label case-insensitively", () => {
    expect(hasLabel(["Rechnung"], "rechnung")).toBe(true);
    expect(hasLabel(undefined, "x")).toBe(false);
  });

  it("adds comma separated labels, skips known ones and refuses what cannot be added", () => {
    expect(addLabels(["Rechnung"], " Steuer ,rechnung")).toEqual(["Rechnung", "Steuer"]);
    expect(addLabels(["Rechnung"], "RECHNUNG")).toBeNull();
    expect(addLabels([], "   ")).toBeNull();
    expect(addLabels([], "x".repeat(25))).toBeNull();
    expect(addLabels(["1", "2", "3", "4", "5"], "6")).toBeNull();
  });
});
