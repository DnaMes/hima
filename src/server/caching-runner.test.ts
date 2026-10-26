import { describe, expect, it, vi } from "vitest";

import { CachingRunner } from "./caching-runner.js";
import type { CommandRunner } from "./himalaya.js";

const ok = { stdout: Buffer.from("[]"), stderr: Buffer.alloc(0), code: 0 };
const list = ["--json", "--account", "a", "envelope", "list", "--mailbox", "INBOX"];

function setup(ttl = 1000) {
  let time = 0;
  const run = vi.fn(async () => ok);
  const runner = new CachingRunner({ run } as CommandRunner, ttl, () => time);
  return { run, runner, advance: (ms: number) => { time += ms; } };
}

describe("CachingRunner", () => {
  it("reuses a list answer within the ttl, including concurrent calls", async () => {
    const { run, runner, advance } = setup();
    await Promise.all([runner.run(list), runner.run(list)]);
    expect(run).toHaveBeenCalledTimes(1);
    advance(1001);
    await runner.run(list);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("keys by arguments", async () => {
    const { run, runner } = setup();
    await runner.run(list);
    await runner.run([...list.slice(0, 2), "b", ...list.slice(3)]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("clears on a mutation but not on reading a message or listing attachments", async () => {
    const { run, runner } = setup();
    await runner.run(list);
    await runner.run(["--json", "--account", "a", "attachment", "list", "1"]);
    await runner.run(["--account", "a", "message", "read", "1", "--raw"]);
    await runner.run(list);
    expect(run).toHaveBeenCalledTimes(3);
    await runner.run(["--account", "a", "flag", "add", "1", "seen"]);
    await runner.run(list);
    expect(run).toHaveBeenCalledTimes(5);
  });

  it("does not reuse failures", async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(ok);
    const runner = new CachingRunner({ run } as CommandRunner);
    await expect(runner.run(list)).rejects.toThrow("boom");
    await runner.run(list);
    expect(run).toHaveBeenCalledTimes(2);
  });

  describe("stale view", () => {
    function stale() {
      let time = 0;
      let calls = 0;
      let release: (() => void) | undefined;
      const run = vi.fn(async (args: string[]) => {
        calls += 1;
        const label = `answer-${calls}`;
        // Only list commands wait for the test to let them finish; a mutation answers at once.
        if (calls > 1 && args.includes("list")) await new Promise<void>((resolve) => { release = resolve; });
        return { stdout: Buffer.from(label), stderr: Buffer.alloc(0), code: 0 };
      });
      const cache = new CachingRunner({ run } as CommandRunner, 1000, () => time, 60_000);
      return { run, cache, view: cache.withStale(), advance: (ms: number) => { time += ms; }, release: () => release?.() };
    }

    it("serves an expired answer at once, refreshes in the background and never serves stale to the plain runner", async () => {
      const { run, cache, view, advance, release } = stale();
      expect((await view.run(list)).stdout.toString()).toBe("answer-1");
      advance(5000);
      expect((await view.run(list)).stdout.toString()).toBe("answer-1");
      expect(run).toHaveBeenCalledTimes(2);
      await view.run(list); // a refresh is already running: no third spawn
      expect(run).toHaveBeenCalledTimes(2);
      release();
      await vi.waitFor(async () => expect((await view.run(list)).stdout.toString()).toBe("answer-2"));
      advance(5000);
      const plain = cache.run(list);
      release();
      expect((await plain).stdout.toString()).toBe("answer-3");
    });

    it("serves the older answer at once while a fresh-view fetch (the warmer) is still running", async () => {
      const { run, cache, view, advance, release } = stale();
      expect((await view.run(list)).stdout.toString()).toBe("answer-1");
      advance(5000);
      const warming = cache.run(list); // the warmer: expired entry, so this spawns and parks as a pending entry
      expect(run).toHaveBeenCalledTimes(2);
      // The GUI neither waits for it nor spawns again.
      expect((await view.run(list)).stdout.toString()).toBe("answer-1");
      expect(run).toHaveBeenCalledTimes(2);
      release();
      expect((await warming).stdout.toString()).toBe("answer-2");
      await vi.waitFor(async () => expect((await view.run(list)).stdout.toString()).toBe("answer-2"));
    });

    it("joins a fetch that is still running even when it started longer ago than the TTL", async () => {
      const { run, cache, advance, release } = stale();
      await cache.run(list);
      advance(5000);
      const first = cache.run(list); // expired: spawns and stays pending
      advance(5000); // the pending fetch is now older than the TTL too
      const second = cache.run(list);
      expect(run).toHaveBeenCalledTimes(2);
      release();
      expect((await first).stdout.toString()).toBe("answer-2");
      expect((await second).stdout.toString()).toBe("answer-2");
    });

    it("drops everything on a mutation and stops serving after the stale window", async () => {
      const { run, view, advance, release } = stale();
      await view.run(list);
      await view.run(["--account", "a", "flag", "add", "1", "seen"]);
      const again = view.run(list);
      release();
      expect((await again).stdout.toString()).toBe("answer-3");
      advance(120_000);
      const old = view.run(list);
      release();
      expect((await old).stdout.toString()).toBe("answer-4");
      expect(run).toHaveBeenCalledTimes(4);
    });
  });
});
