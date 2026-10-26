import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSenderStore, normalizeEmail, SENDER_LIST_CAP } from "./senders.js";

let dir = "";
let path = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "himalaya-web-senders-test-"));
  path = join(dir, "nested", "senders.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const exists = (target: string): Promise<boolean> => stat(target).then(() => true, () => false);

describe("normalizeEmail", () => {
  it("trims and lower-cases", () => {
    expect(normalizeEmail("  Anna@Evil.Example ")).toBe("anna@evil.example");
  });

  it.each(["", "a", "a@", "@b", "a@b@c", "a b@c.d", "a\u0000b@c.d", `${"a".repeat(310)}@example.test`])("rejects %j", (value) => {
    expect(() => normalizeEmail(value)).toThrow();
  });
});

describe("createSenderStore", () => {
  it("starts empty when the file is missing", async () => {
    const lists = await createSenderStore(path).lists();

    expect([...lists.trusted]).toEqual([]);
    expect([...lists.blocked]).toEqual([]);
  });

  it("sets, reads and removes a status, ignoring case", async () => {
    const store = createSenderStore(path);
    await store.setStatus("Anna@X.test", "trusted");
    expect(await store.statusOf("anna@x.TEST")).toBe("trusted");

    await store.setStatus("anna@x.test", null);
    expect(await store.statusOf("anna@x.test")).toBeNull();
  });

  it("keeps an address in at most one list", async () => {
    const store = createSenderStore(path);
    await store.setStatus("a@x.test", "trusted");
    await store.setStatus("a@x.test", "blocked");
    const lists = await store.lists();

    expect(lists.trusted.has("a@x.test")).toBe(false);
    expect(lists.blocked.has("a@x.test")).toBe(true);
  });

  it("persists across store instances in a private, atomically written file", async () => {
    await createSenderStore(path).setStatus("b@x.test", "blocked");
    await createSenderStore(path).setStatus("a@x.test", "trusted");

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ trusted: ["a@x.test"], blocked: ["b@x.test"] });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readdir(join(dir, "nested"))).toEqual(["senders.json"]);
    expect(await createSenderStore(path).statusOf("b@x.test")).toBe("blocked");
  });

  it("rejects an invalid address before writing anything", async () => {
    const store = createSenderStore(path);

    await expect(store.setStatus("not-an-address", "trusted")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await exists(path)).toBe(false);
  });

  it("rejects an entry beyond the list cap", async () => {
    const entries = Array.from({ length: SENDER_LIST_CAP }, (_, index) => `u${index}@x.test`);
    await rm(join(dir, "nested"), { recursive: true, force: true });
    await import("node:fs/promises").then(({ mkdir }) => mkdir(join(dir, "nested"), { recursive: true }));
    await writeFile(path, JSON.stringify({ trusted: entries, blocked: [] }));
    const store = createSenderStore(path);

    await expect(store.setStatus("one-too-many@x.test", "trusted")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await store.setStatus("u0@x.test", null);
    await store.setStatus("one-too-many@x.test", "trusted");
    expect(await store.statusOf("one-too-many@x.test")).toBe("trusted");
  });

  it("keeps every update when many writes run at once", async () => {
    const store = createSenderStore(path);
    await Promise.all(Array.from({ length: 20 }, (_, index) => store.setStatus(`u${index}@x.test`, index % 2 === 0 ? "trusted" : "blocked")));
    const reread = await createSenderStore(path).lists();

    expect(reread.trusted.size).toBe(10);
    expect(reread.blocked.size).toBe(10);
  });

  it("treats a corrupt file as empty and replaces it on the next write", async () => {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(join(dir, "nested"), { recursive: true }));
    await writeFile(path, "{not json");
    const store = createSenderStore(path);

    expect((await store.lists()).trusted.size).toBe(0);
    await store.setStatus("a@x.test", "trusted");
    expect(JSON.parse(await readFile(path, "utf8")).trusted).toEqual(["a@x.test"]);
  });
});
