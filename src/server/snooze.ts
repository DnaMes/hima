import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { writeFileDurably } from "./durable-write.js";
import { HimalayaError } from "./himalaya.js";

export type SnoozeEntry = { account: string; mailbox: string; message: string; until: string; subject?: string };
export type SnoozeRef = Pick<SnoozeEntry, "account" | "mailbox" | "message">;

export interface SnoozeStore {
  /** Entries still hidden at `now`; woken ones are dropped. */
  active(now?: Date): Promise<SnoozeEntry[]>;
  add(ref: SnoozeRef, until: Date, now?: Date, subject?: string): Promise<void>;
  cancel(ref: SnoozeRef): Promise<void>;
}

export const SNOOZE_CAP = 500;
const MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;

const keyOf = (ref: SnoozeRef): string => JSON.stringify([ref.account, ref.mailbox, ref.message]);

function defaultPath(): string {
  return process.env.HIMALAYA_WEB_SNOOZE_PATH ?? join(homedir(), ".config", "himalaya-web", "snoozed.json");
}

function parse(raw: unknown): SnoozeEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): SnoozeEntry[] => {
    const entry = item as Partial<Record<keyof SnoozeEntry, unknown>> | null;
    const ok = entry && [entry.account, entry.mailbox, entry.message, entry.until].every((value) => typeof value === "string" && value.length > 0)
      && Number.isFinite(Date.parse(entry.until as string));
    if (!ok) return [];
    const { account, mailbox, message, until, subject } = entry as SnoozeEntry;
    return [{ account, mailbox, message, until, ...(typeof subject === "string" ? { subject } : {}) }];
  });
}

/** Snoozing is local to this GUI: the mail stays where it is and is only hidden from the lists until it wakes. */
export function createSnoozeStore(path: string = defaultPath()): SnoozeStore {
  let state: Promise<SnoozeEntry[]> | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const load = (): Promise<SnoozeEntry[]> => (state ??= readFile(path, "utf8").then(
    (text) => parse(JSON.parse(text)),
    () => [],
  ).catch(() => []));

  const alive = (entries: readonly SnoozeEntry[], now: Date): SnoozeEntry[] => entries.filter((entry) => Date.parse(entry.until) > now.getTime());

  async function commit(change: (current: SnoozeEntry[]) => SnoozeEntry[], now: Date): Promise<void> {
    const run = async (): Promise<void> => {
      const next = alive(change(await load()), now);
      await writeFileDurably(path, `${JSON.stringify(next, null, 2)}\n`);
      state = Promise.resolve(next);
    };
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  }

  return {
    async active(now = new Date()) {
      return alive(await load(), now);
    },
    async add(ref, until, now = new Date(), subject) {
      if (!(until.getTime() > now.getTime()) || until.getTime() - now.getTime() > MAX_AHEAD_MS) {
        throw new HimalayaError("Ungültige Weckzeit.", "INVALID_INPUT", false);
      }
      await commit((current) => {
        // Woken entries do not count against the cap.
        const others = alive(current, now).filter((entry) => keyOf(entry) !== keyOf(ref));
        if (others.length >= SNOOZE_CAP) throw new HimalayaError("Zu viele zurückgestellte Nachrichten.", "INVALID_INPUT", false);
        return [...others, { ...ref, until: until.toISOString(), ...(subject ? { subject: subject.slice(0, 300) } : {}) }];
      }, now);
    },
    async cancel(ref) {
      await commit((current) => current.filter((entry) => keyOf(entry) !== keyOf(ref)), new Date());
    },
  };
}
