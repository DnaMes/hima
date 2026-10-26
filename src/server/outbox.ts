import { randomBytes } from "node:crypto";

export type OutboxStatus = "queued" | "sending" | "sent" | "failed" | "cancelled";

export type OutboxJob = {
  id: string;
  status: OutboxStatus;
  sendAt: number;
  error?: string;
};

export interface Outbox {
  schedule(run: () => Promise<void>, delayMs?: number): OutboxJob;
  cancel(id: string): boolean;
  get(id: string): OutboxJob | undefined;
  dispose(): void;
}

const DEFAULT_DELAY_MS = 10_000;
const FORGET_AFTER_MS = 10 * 60_000;

export function createOutbox(): Outbox {
  const jobs = new Map<string, OutboxJob>();
  const sendTimers = new Map<string, NodeJS.Timeout>();
  const forgetTimers = new Map<string, NodeJS.Timeout>();

  function schedule(run: () => Promise<void>, delayMs: number = DEFAULT_DELAY_MS): OutboxJob {
    const id = randomBytes(16).toString("hex");
    const job: OutboxJob = { id, status: "queued", sendAt: Date.now() + delayMs };
    jobs.set(id, job);

    const timer = setTimeout(() => {
      sendTimers.delete(id);
      const current = jobs.get(id);
      if (!current || current.status !== "queued") return;
      current.status = "sending";
      run()
        .then(() => {
          current.status = "sent";
        })
        .catch((error: unknown) => {
          current.status = "failed";
          current.error = error instanceof Error ? error.message : "Der Versand ist fehlgeschlagen.";
        })
        .finally(() => {
          forgetTimers.set(id, setTimeout(() => {
            jobs.delete(id);
            forgetTimers.delete(id);
          }, FORGET_AFTER_MS));
        });
    }, delayMs);
    sendTimers.set(id, timer);

    return job;
  }

  function cancel(id: string): boolean {
    const job = jobs.get(id);
    if (!job || job.status !== "queued") return false;
    const timer = sendTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      sendTimers.delete(id);
    }
    job.status = "cancelled";
    return true;
  }

  function get(id: string): OutboxJob | undefined {
    return jobs.get(id);
  }

  function dispose(): void {
    for (const timer of sendTimers.values()) clearTimeout(timer);
    for (const timer of forgetTimers.values()) clearTimeout(timer);
    sendTimers.clear();
    forgetTimers.clear();
  }

  return { schedule, cancel, get, dispose };
}
