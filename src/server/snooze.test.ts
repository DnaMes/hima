import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { createSnoozeStore } from "./snooze.js";

const ref = { account: "a", mailbox: "INBOX", message: "1" };
const now = new Date("2026-10-26T10:00:00Z");
const later = (hours: number) => new Date(now.getTime() + hours * 3_600_000);

async function fresh() {
  const path = join(await mkdtemp(join(tmpdir(), "snooze-")), "snoozed.json");
  return { path, store: createSnoozeStore(path) };
}

describe("snooze store", () => {
  it("hides until the wake time and then forgets the entry", async () => {
    const { store } = await fresh();
    await store.add(ref, later(2), now);
    expect(await store.active(later(1))).toHaveLength(1);
    expect(await store.active(later(3))).toEqual([]);
  });

  it("replaces an entry for the same message, can cancel, and persists with mode 0600", async () => {
    const { path, store } = await fresh();
    await store.add(ref, later(2), now);
    await store.add(ref, later(5), now);
    expect(JSON.parse(await readFile(path, "utf8"))).toHaveLength(1);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await store.cancel(ref);
    expect(await store.active(now)).toEqual([]);
  });

  it("rejects past times and more than a year ahead, and reads a corrupt file as empty", async () => {
    const { path, store } = await fresh();
    await expect(store.add(ref, later(-1), now)).rejects.toThrow("Ungültige Weckzeit.");
    await expect(store.add(ref, later(24 * 400), now)).rejects.toThrow("Ungültige Weckzeit.");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, "{broken");
    expect(await createSnoozeStore(path).active(now)).toEqual([]);
  });

  it("does not count woken entries against the cap", async () => {
    const { path, store } = await fresh();
    const { writeFile } = await import("node:fs/promises");
    const expired = Array.from({ length: 500 }, (_, index) => ({ ...ref, message: String(index), until: "2026-10-01T00:00:00.000Z" }));
    await writeFile(path, JSON.stringify(expired));
    await store.add({ ...ref, message: "new" }, later(2), now);
    expect(await store.active(now)).toHaveLength(1);
  });

  it("ignores a leftover temp file, leaves none behind and removes its own after a failed rename", async () => {
    const { path, store } = await fresh();
    await writeFile(`${path}.tmp`, "stale", { mode: 0o644 });
    await store.add(ref, later(2), now);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const names = () => readdir(dirname(path));
    expect((await names()).filter((name) => name.endsWith(".tmp") && name !== "snoozed.json.tmp")).toEqual([]);

    // A directory in the place of the file makes the rename fail; the temp file must not be left behind.
    const blocked = await fresh();
    await mkdir(join(blocked.path, "occupied"), { recursive: true });
    await expect(blocked.store.add(ref, later(2), now)).rejects.toThrow();
    expect((await readdir(dirname(blocked.path))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});
