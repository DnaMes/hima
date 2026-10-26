import { chmod, mkdir, mkdtemp, readdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { writeFileDurably } from "./durable-write.js";

describe("writeFileDurably", () => {
  it("creates missing directories, writes mode 0600 and leaves no temp file", async () => {
    const root = await mkdtemp(join(tmpdir(), "durable-"));
    const path = join(root, "nested", "file.json");
    await writeFileDurably(path, "one");
    await writeFileDurably(path, "two");
    expect(await readFile(path, "utf8")).toBe("two");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readdir(join(root, "nested"))).toEqual(["file.json"]);
  });

  it("ignores a leftover .tmp file and removes its own temp file when the rename fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "durable-"));
    const path = join(root, "file.json");
    await writeFile(`${path}.tmp`, "stale", { mode: 0o644 });
    await writeFileDurably(path, "ok");
    expect((await stat(path)).mode & 0o777).toBe(0o600);

    const blocked = join(root, "blocked");
    await mkdir(join(blocked, "occupied"), { recursive: true });
    await expect(writeFileDurably(blocked, "x")).rejects.toThrow();
    expect((await readdir(root)).filter((name) => name.startsWith("blocked.") && name.endsWith(".tmp"))).toEqual([]);
  });

  it("creates a new directory private (0700)", async () => {
    const root = await mkdtemp(join(tmpdir(), "durable-"));
    await writeFileDurably(join(root, "private", "file.json"), "x");
    expect((await stat(join(root, "private"))).mode & 0o777).toBe(0o700);
  });

  it("sweeps old temp files of its own pattern only, and keeps recent or foreign ones", async () => {
    const root = await mkdtemp(join(tmpdir(), "durable-"));
    const path = join(root, "file.json");
    const old = `${path}.11111111-1111-1111-1111-111111111111.tmp`;
    const recent = `${path}.22222222-2222-2222-2222-222222222222.tmp`;
    const foreign = join(root, "other.json.33333333-3333-3333-3333-333333333333.tmp");
    for (const file of [old, recent, foreign]) await writeFile(file, "x");
    const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(old, longAgo, longAgo);
    await utimes(foreign, longAgo, longAgo);
    await writeFileDurably(path, "ok");
    const names = (await readdir(root)).sort();
    expect(names).toContain(`file.json.22222222-2222-2222-2222-222222222222.tmp`);
    expect(names).toContain("other.json.33333333-3333-3333-3333-333333333333.tmp");
    expect(names).not.toContain("file.json.11111111-1111-1111-1111-111111111111.tmp");
  });

  it.each([
    { code: "ENOSYS", logged: false },
    { code: "EINVAL", logged: false },
    { code: "EIO", logged: true },
  ])("treats a directory flush failing with $code as logged=$logged and still keeps the written file", async ({ code, logged }) => {
    const root = await mkdtemp(join(tmpdir(), "durable-"));
    const path = join(root, "file.json");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const failing = (async () => { throw Object.assign(new Error("boom"), { code }); }) as unknown as typeof import("node:fs/promises").open;
      await writeFileDurably(path, "kept", failing);
      expect(await readFile(path, "utf8")).toBe("kept");
      expect(stderr.mock.calls.some(([text]) => String(text).includes("could not flush the directory"))).toBe(logged);
    } finally {
      stderr.mockRestore();
    }
  });

  it("sweeps once per file and process: a temp file left later is not touched by the next write", async () => {
    const root = await mkdtemp(join(tmpdir(), "durable-"));
    const path = join(root, "once.json");
    await writeFileDurably(path, "first");
    const late = `${path}.44444444-4444-4444-4444-444444444444.tmp`;
    await writeFile(late, "x");
    const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(late, longAgo, longAgo);
    await writeFileDurably(path, "second");
    expect(await readdir(root)).toContain("once.json.44444444-4444-4444-4444-444444444444.tmp");
  });

  // root can read a 0o300 directory, so the setup below would not make the read fail
  it.skipIf(process.getuid?.() === 0)("retries the sweep after a failed directory read, because only a successful read marks the file as swept", async () => {
    const root = await mkdtemp(join(tmpdir(), "durable-"));
    const directory = join(root, "locked");
    const path = join(directory, "retry.json");
    await mkdir(directory);
    await chmod(directory, 0o300); // writable and searchable but not readable: the sweep's readdir fails
    try {
      await writeFileDurably(path, "first");
    } finally {
      await chmod(directory, 0o700);
    }
    const stale = `${path}.55555555-5555-5555-5555-555555555555.tmp`;
    await writeFile(stale, "x");
    const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(stale, longAgo, longAgo);
    await writeFileDurably(path, "second");
    expect(await readdir(directory)).not.toContain("retry.json.55555555-5555-5555-5555-555555555555.tmp");
  });
});
