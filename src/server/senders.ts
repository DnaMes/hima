import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { HimalayaError } from "./himalaya.js";

export type SenderStatus = "trusted" | "blocked";

export interface SenderLists {
  trusted: ReadonlySet<string>;
  blocked: ReadonlySet<string>;
}

export interface SenderStore {
  lists(): Promise<SenderLists>;
  statusOf(email: string): Promise<SenderStatus | null>;
  /** `null` removes the address from both lists. */
  setStatus(email: string, status: SenderStatus | null): Promise<void>;
}

export const SENDER_LIST_CAP = 5000;
const MAX_EMAIL_LENGTH = 320;

function invalid(message: string): HimalayaError {
  return new HimalayaError(message, "INVALID_INPUT", false);
}

export function normalizeEmail(email: string): string {
  const value = email.trim().toLowerCase();
  const parts = value.split("@");
  if (value.length > MAX_EMAIL_LENGTH || parts.length !== 2 || !parts[0] || !parts[1] || /[\s\u0000-\u001f\u007f]/.test(value)) {
    throw invalid("Ungültige Absenderadresse.");
  }
  return value;
}

function defaultPath(): string {
  return process.env.HIMALAYA_WEB_SENDERS_PATH ?? join(homedir(), ".config", "himalaya-web", "senders.json");
}

type State = { trusted: Set<string>; blocked: Set<string> };

function parseState(raw: unknown): State {
  const record = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const list = (value: unknown): Set<string> => new Set(
    Array.isArray(value) ? value.flatMap((entry) => {
      try {
        return typeof entry === "string" ? [normalizeEmail(entry)] : [];
      } catch {
        return [];
      }
    }) : [],
  );
  return { trusted: list(record.trusted), blocked: list(record.blocked) };
}

export function createSenderStore(path: string = defaultPath()): SenderStore {
  let state: Promise<State> | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  function load(): Promise<State> {
    state ??= readFile(path, "utf8").then(
      (text) => parseState(JSON.parse(text)),
      (error: NodeJS.ErrnoException) => {
        // ponytail: a corrupt file reads as empty and is replaced on the next write; the app is its only writer.
        if (error.code !== "ENOENT") process.stderr.write(`[senders] ignoring unreadable ${path}\n`);
        return { trusted: new Set<string>(), blocked: new Set<string>() };
      },
    ).catch(() => {
      process.stderr.write(`[senders] ignoring unreadable ${path}\n`);
      return { trusted: new Set<string>(), blocked: new Set<string>() };
    });
    return state;
  }

  async function persist(next: State): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.tmp`;
    await writeFile(temp, `${JSON.stringify({ trusted: [...next.trusted].sort(), blocked: [...next.blocked].sort() }, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, path);
  }

  return {
    async lists() {
      return load();
    },
    async statusOf(email) {
      const address = normalizeEmail(email);
      const current = await load();
      return current.trusted.has(address) ? "trusted" : current.blocked.has(address) ? "blocked" : null;
    },
    async setStatus(email, status) {
      const address = normalizeEmail(email);
      const run = async (): Promise<void> => {
        const current = await load();
        const next: State = { trusted: new Set(current.trusted), blocked: new Set(current.blocked) };
        next.trusted.delete(address);
        next.blocked.delete(address);
        if (status !== null) {
          const target = next[status];
          if (target.size >= SENDER_LIST_CAP) throw invalid("Die Liste ist voll.");
          target.add(address);
        }
        await persist(next);
        state = Promise.resolve(next);
      };
      const result = queue.then(run, run);
      queue = result.catch(() => undefined);
      return result;
    },
  };
}
