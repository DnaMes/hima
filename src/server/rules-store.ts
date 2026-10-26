import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { z } from "zod";

import type { Envelope } from "../shared/types.js";
import { matchesCondition, type Rule } from "./rules.js";

export const MAX_RULES = 100;
const MAX_ACTIONS = 8;

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("flag"), flag: z.enum(["seen", "answered", "flagged", "draft"]), value: z.boolean() }).strict(),
  z.object({ type: z.literal("move"), mailbox: z.string().min(1).max(512) }).strict(),
]);

// Strict on purpose: a hand-edited rule with an unknown key is kept verbatim as "not editable" instead of
// being stripped by the editor. Missing `enabled`/`dryRun` read as false, exactly like the engine.
export const ruleSchema = z.object({
  id: z.string().trim().min(1).max(64),
  account: z.string().min(1).max(512),
  enabled: z.boolean().default(false),
  dryRun: z.boolean().default(false),
  condition: z.object({
    field: z.enum(["from", "subject", "to"]),
    match: z.enum(["contains", "equals"]),
    value: z.string().min(1).max(200),
  }).strict(),
  actions: z.array(actionSchema).min(1).max(MAX_ACTIONS),
}).strict();

export const rulesSchema = z.array(ruleSchema).max(MAX_RULES).refine(
  (rules) => new Set(rules.map((item) => item.id)).size === rules.length,
  "Rule ids must be unique.",
);

export interface StoredRules {
  rules: Rule[];
  /** Entries in the file the editor cannot edit; they are kept verbatim on every save. */
  preservedInvalid: number;
  /** The file exists but is not a readable JSON array (e.g. a typo from hand-editing); a save backs it up first. */
  unreadable: boolean;
}

// Same location rule as rules.ts' private default (that file is not touched by this slice).
function defaultPath(): string {
  return process.env.HIMALAYA_WEB_RULES_PATH ?? join(homedir(), ".config", "himalaya-web", "rules.json");
}

async function readEntries(path: string): Promise<{ valid: Rule[]; invalid: unknown[]; unreadable: boolean }> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return { valid: [], invalid: [], unreadable: false }; // missing file: nothing to protect
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { valid: [], invalid: [], unreadable: true };
  }
  if (!Array.isArray(parsed)) return { valid: [], invalid: [], unreadable: true };
  const valid: Rule[] = [];
  const invalid: unknown[] = [];
  for (const entry of parsed) {
    const result = ruleSchema.safeParse(entry);
    if (result.success) valid.push(result.data);
    else invalid.push(entry);
  }
  return { valid, invalid, unreadable: false };
}

export async function readStoredRules(path: string = defaultPath()): Promise<StoredRules> {
  const { valid, invalid, unreadable } = await readEntries(path);
  return { rules: valid, preservedInvalid: invalid.length, unreadable };
}

const queues = new Map<string, Promise<unknown>>();

/** Replaces the editable rules, keeps the invalid entries after them, writes atomically. */
export function writeStoredRules(rules: readonly Rule[], path: string = defaultPath()): Promise<void> {
  const run = async (): Promise<void> => {
    const { invalid, unreadable } = await readEntries(path);
    // A file the editor cannot read would be replaced by the editable rules alone: keep a copy first, or refuse.
    if (unreadable) await copyFile(path, `${path}.unreadable-${new Date().toISOString().replace(/[-:.]/g, "")}`);
    const mode = await stat(path).then((info) => info.mode & 0o777, () => 0o600);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.tmp`;
    await writeFile(temp, `${JSON.stringify([...rules, ...invalid], null, 2)}\n`, { mode });
    await rename(temp, path);
  };
  const previous = queues.get(path) ?? Promise.resolve();
  const result = previous.then(run, run);
  queues.set(path, result.catch(() => undefined));
  return result;
}

export interface RulePreview {
  checked: number;
  matchCount: number;
  samples: Array<{ subject: string; from: string }>;
}

/** Pure and read-only: which of these envelopes the rule's condition would match. */
export function previewRule(rule: Rule, envelopes: readonly Envelope[]): RulePreview {
  const matches = envelopes.filter((envelope) => matchesCondition(envelope, rule.condition));
  return {
    checked: envelopes.length,
    matchCount: matches.length,
    samples: matches.slice(0, 10).map((envelope) => ({
      subject: envelope.subject,
      from: envelope.from[0]?.name || envelope.from[0]?.email || "",
    })),
  };
}
