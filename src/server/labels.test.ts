import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { createLabelStore, normalizeLabels } from "./labels.js";

const ref = { account: "a", mailbox: "INBOX", message: "1" };
const fresh = async () => {
  const path = join(await mkdtemp(join(tmpdir(), "labels-")), "labels.json");
  return { path, store: createLabelStore(path) };
};

describe("normalizeLabels", () => {
  it("trims, collapses spaces and drops case-insensitive duplicates", () => {
    expect(normalizeLabels(["  Rechnung ", "rechnung", "Steuer  2026", ""])).toEqual(["Rechnung", "Steuer 2026"]);
  });

  it("rejects too long labels, control characters and more than five", () => {
    expect(() => normalizeLabels(["x".repeat(25)])).toThrow("Ungültiges Etikett.");
    expect(() => normalizeLabels(["a\u0007b"])).toThrow("Ungültiges Etikett.");
    expect(() => normalizeLabels(["1", "2", "3", "4", "5", "6"])).toThrow("Zu viele Etiketten.");
  });
});

describe("label store", () => {
  it("stores, replaces and removes the labels of a message, with mode 0600", async () => {
    const { path, store } = await fresh();
    await store.set(ref, ["Rechnung", "Steuer"]);
    await store.set(ref, ["Rechnung"]);
    expect(await store.all()).toEqual([{ ...ref, labels: ["Rechnung"] }]);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await store.set(ref, []);
    expect(await store.all()).toEqual([]);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual([]);
  });

  it("reads a corrupt or partly broken file as far as it can", async () => {
    const { path } = await fresh();
    await writeFile(path, "{broken");
    expect(await createLabelStore(path).all()).toEqual([]);
    await writeFile(path, JSON.stringify([{ ...ref, labels: ["ok", "x".repeat(40)] }, { ...ref, message: "2", labels: ["fine"] }, { nope: 1 }]));
    expect((await createLabelStore(path).all()).map((entry) => entry.message)).toEqual(["2"]);
  });

  it("does not write the file when clearing a message that has no labels", async () => {
    const { path, store } = await fresh();
    await store.set(ref, []);
    await expect(stat(path)).rejects.toThrow();
  });

  it("is not affected by a leftover .tmp file or directory and leaves no temp file behind", async () => {
    const { path, store } = await fresh();
    await writeFile(`${path}.tmp`, "stale", { mode: 0o644 });
    await mkdir(`${path}.blocked.tmp`);
    await store.set(ref, ["x"]);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const leftovers = (await readdir(dirname(path))).filter((name) => name.endsWith(".tmp") && name !== "labels.json.tmp" && name !== "labels.json.blocked.tmp");
    expect(leftovers).toEqual([]);
  });
});
