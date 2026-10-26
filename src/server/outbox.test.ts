import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createOutbox } from "./outbox.js";

describe("createOutbox", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires the job after the delay and marks it sent", async () => {
    const outbox = createOutbox();
    const run = vi.fn().mockResolvedValue(undefined);
    const job = outbox.schedule(run, 10_000);

    expect(job.status).toBe("queued");
    expect(run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(run).toHaveBeenCalledTimes(1);
    expect(outbox.get(job.id)?.status).toBe("sent");
    outbox.dispose();
  });

  it("marks the job failed with the error message when run() rejects", async () => {
    const outbox = createOutbox();
    const run = vi.fn().mockRejectedValue(new Error("SMTP abgelehnt"));
    const job = outbox.schedule(run, 10_000);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(outbox.get(job.id)).toMatchObject({ status: "failed", error: "SMTP abgelehnt" });
    outbox.dispose();
  });

  it("cancels a queued job before it fires", async () => {
    const outbox = createOutbox();
    const run = vi.fn().mockResolvedValue(undefined);
    const job = outbox.schedule(run, 10_000);

    expect(outbox.cancel(job.id)).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(run).not.toHaveBeenCalled();
    expect(outbox.get(job.id)?.status).toBe("cancelled");
    outbox.dispose();
  });

  it("cannot cancel a job that has already started sending (Review Focus race)", async () => {
    const outbox = createOutbox();
    let releaseRun: () => void = () => {};
    const run = vi.fn(() => new Promise<void>((resolve) => { releaseRun = resolve; }));
    const job = outbox.schedule(run, 10_000);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(outbox.get(job.id)?.status).toBe("sending");

    expect(outbox.cancel(job.id)).toBe(false);

    releaseRun();
    await vi.advanceTimersByTimeAsync(0);
    expect(outbox.get(job.id)?.status).toBe("sent");
    outbox.dispose();
  });

  it("returns false for cancelling an unknown job id and never throws", () => {
    const outbox = createOutbox();
    expect(outbox.cancel("does-not-exist")).toBe(false);
    outbox.dispose();
  });

  it("forgets a resolved job after 10 minutes", async () => {
    const outbox = createOutbox();
    const job = outbox.schedule(vi.fn().mockResolvedValue(undefined), 10_000);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(outbox.get(job.id)?.status).toBe("sent");

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(outbox.get(job.id)).toBeUndefined();
    outbox.dispose();
  });

  it("dispose clears pending timers so a queued job never fires", async () => {
    const outbox = createOutbox();
    const run = vi.fn().mockResolvedValue(undefined);
    outbox.schedule(run, 10_000);

    outbox.dispose();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(run).not.toHaveBeenCalled();
  });
});
