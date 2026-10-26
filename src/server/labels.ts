import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { writeFileDurably } from "./durable-write.js";
import { HimalayaError } from "./himalaya.js";

export type LabelRef = { account: string; mailbox: string; message: string };
export type LabelEntry = LabelRef & { labels: string[] };

export interface LabelStore {
  all(): Promise<LabelEntry[]>;
  /** Replaces the labels of a message; an empty list removes the entry. */
  set(ref: LabelRef, labels: readonly string[]): Promise<void>;
}

export const LABELS_PER_MESSAGE = 5;
export const LABEL_MAX_LENGTH = 24;
export const LABELED_MESSAGES_CAP = 5000;

const keyOf = (ref: LabelRef): string => JSON.stringify([ref.account, ref.mailbox, ref.message]);

function defaultPath(): string {
  return process.env.HIMALAYA_WEB_LABELS_PATH ?? join(homedir(), ".config", "himalaya-web", "labels.json");
}

/** Trims, collapses spaces and drops case-insensitive duplicates; throws on anything unusable. */
export function normalizeLabels(labels: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of labels) {
    const label = raw.replace(/\s+/g, " ").trim();
    if (!label) continue;
    if (label.length > LABEL_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(label)) {
      throw new HimalayaError("Ungültiges Etikett.", "INVALID_INPUT", false);
    }
    const key = label.toLocaleLowerCase("de-DE");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(label);
  }
  if (result.length > LABELS_PER_MESSAGE) throw new HimalayaError("Zu viele Etiketten.", "INVALID_INPUT", false);
  return result;
}

function parse(raw: unknown): LabelEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): LabelEntry[] => {
    const entry = item as Partial<Record<keyof LabelEntry, unknown>> | null;
    if (!entry || ![entry.account, entry.mailbox, entry.message].every((value) => typeof value === "string" && value.length > 0)) return [];
    if (!Array.isArray(entry.labels)) return [];
    try {
      const labels = normalizeLabels(entry.labels.filter((label): label is string => typeof label === "string"));
      return labels.length > 0 ? [{ account: entry.account as string, mailbox: entry.mailbox as string, message: entry.message as string, labels }] : [];
    } catch {
      return [];
    }
  });
}

/** Labels are local to this GUI: Himalaya cannot set custom IMAP keywords, so nothing about the mail changes. */
export function createLabelStore(path: string = defaultPath()): LabelStore {
  let state: Promise<LabelEntry[]> | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const load = (): Promise<LabelEntry[]> => (state ??= readFile(path, "utf8").then(
    (text) => parse(JSON.parse(text)),
    () => [],
  ).catch(() => []));

  return {
    all: load,
    async set(ref, labels) {
      const normalized = normalizeLabels(labels);
      const run = async (): Promise<void> => {
        const current = await load();
        // Clearing a message that has no labels (the common case after a move) must not touch the disk.
        if (normalized.length === 0 && !current.some((entry) => keyOf(entry) === keyOf(ref))) return;
        const others = current.filter((entry) => keyOf(entry) !== keyOf(ref));
        if (normalized.length > 0 && others.length >= LABELED_MESSAGES_CAP) throw new HimalayaError("Zu viele Nachrichten mit Etiketten.", "INVALID_INPUT", false);
        const next = normalized.length > 0 ? [...others, { ...ref, labels: normalized }] : others;
        await writeFileDurably(path, `${JSON.stringify(next, null, 2)}\n`);
        state = Promise.resolve(next);
      };
      const result = queue.then(run, run);
      queue = result.catch(() => undefined);
      return result;
    },
  };
}
