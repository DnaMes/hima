import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Address, Envelope } from "../shared/types.js";

export type RuleField = "from" | "subject" | "to";
export type RuleMatch = "contains" | "equals";
export type RuleFlagName = "seen" | "answered" | "flagged" | "draft";

export type RuleCondition = { field: RuleField; match: RuleMatch; value: string };

export type RuleAction =
  | { type: "flag"; flag: RuleFlagName; value: boolean }
  | { type: "move"; mailbox: string };

export type Rule = {
  id: string;
  account: string;
  enabled: boolean;
  dryRun: boolean;
  condition: RuleCondition;
  actions: RuleAction[];
};

export type RuleOutcome = {
  ruleId: string;
  dryRun: boolean;
  flagsApplied: Array<{ flag: RuleFlagName; value: boolean }>;
  movedTo: string | null;
};

const FIELDS: readonly RuleField[] = ["from", "subject", "to"];
const MATCHES: readonly RuleMatch[] = ["contains", "equals"];
const FLAGS: readonly RuleFlagName[] = ["seen", "answered", "flagged", "draft"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCondition(value: unknown): RuleCondition | null {
  if (!isRecord(value)) return null;
  const { field, match, value: text } = value;
  if (typeof field !== "string" || !(FIELDS as string[]).includes(field)) return null;
  if (typeof match !== "string" || !(MATCHES as string[]).includes(match)) return null;
  if (typeof text !== "string" || text.length === 0) return null;
  return { field: field as RuleField, match: match as RuleMatch, value: text };
}

function parseAction(value: unknown): RuleAction | null {
  if (!isRecord(value)) return null;
  if (value.type === "flag") {
    const { flag, value: flagValue } = value;
    if (typeof flag !== "string" || !(FLAGS as string[]).includes(flag)) return null;
    if (typeof flagValue !== "boolean") return null;
    return { type: "flag", flag: flag as RuleFlagName, value: flagValue };
  }
  if (value.type === "move") {
    const { mailbox } = value;
    if (typeof mailbox !== "string" || mailbox.length === 0) return null;
    return { type: "move", mailbox };
  }
  return null;
}

/** A rule, or the reason it is unusable (so the log can say what to fix in a hand-edited file). */
function checkRule(value: unknown): Rule | string {
  if (!isRecord(value)) return "not an object";
  const { id, account, enabled, dryRun, condition, actions } = value;
  if (typeof id !== "string" || id.length === 0) return "missing id";
  if (typeof account !== "string" || account.length === 0) return "missing account";
  // dryRun is the operator's safety valve before trusting a rule with real
  // mail; a malformed value (e.g. a quoted "true" from hand-editing JSON)
  // must drop the rule rather than coerce to a default, since coercing to
  // false would silently turn it into a LIVE rule. enabled is held to the
  // same standard for consistency with the rest of this parser: every other
  // field here drops the rule on a bad value instead of guessing.
  if (enabled !== undefined && typeof enabled !== "boolean") return "enabled must be true or false";
  if (dryRun !== undefined && typeof dryRun !== "boolean") return "dryRun must be true or false";
  const parsedCondition = parseCondition(condition);
  if (!parsedCondition) return "invalid condition (field, match and a non-empty value are required)";
  if (!Array.isArray(actions) || actions.length === 0) return "needs at least one action";
  const parsedActions: RuleAction[] = [];
  for (const action of actions) {
    const parsed = parseAction(action);
    if (!parsed) return "invalid action (a flag action needs a known flag and true/false, a move action a mailbox)";
    parsedActions.push(parsed);
  }
  return {
    id,
    account,
    enabled: enabled === true,
    dryRun: dryRun === true,
    condition: parsedCondition,
    actions: parsedActions,
  };
}

function defaultRulesPath(): string {
  return process.env.HIMALAYA_WEB_RULES_PATH ?? join(homedir(), ".config", "himalaya-web", "rules.json");
}

export async function readRules(path: string = defaultRulesPath()): Promise<Rule[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    // A missing file is the documented inert default and stays silent; anything else (permissions, I/O) is reported.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") process.stderr.write(`[rules] cannot read ${path}: ${(error as Error).message}\n`);
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    process.stderr.write(`[rules] ${path} is not valid JSON; no rules are active\n`);
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const rules: Rule[] = [];
  parsed.forEach((entry, index) => {
    const result = checkRule(entry);
    if (typeof result !== "string") {
      rules.push(result);
      return;
    }
    const id = isRecord(entry) && typeof entry.id === "string" && entry.id.length > 0 ? `"${entry.id}"` : `entry ${index}`;
    process.stderr.write(`[rules] dropped rule ${id} in ${path}: ${result}\n`);
  });
  return rules;
}

function addressMatches(address: Address, match: RuleMatch, needle: string): boolean {
  const email = address.email.toLowerCase();
  const name = (address.name ?? "").toLowerCase();
  if (match === "equals") return email === needle || name === needle;
  return email.includes(needle) || name.includes(needle);
}

export function matchesCondition(envelope: Envelope, condition: RuleCondition): boolean {
  const needle = condition.value.toLowerCase();
  if (condition.field === "subject") {
    const subject = envelope.subject.toLowerCase();
    return condition.match === "equals" ? subject === needle : subject.includes(needle);
  }
  const addresses = condition.field === "from" ? envelope.from : envelope.to;
  return addresses.some((address) => addressMatches(address, condition.match, needle));
}

export function planActions(envelope: Envelope, rules: readonly Rule[]): RuleOutcome[] {
  const outcomes: RuleOutcome[] = [];
  let moveClaimed = false;
  for (const rule of rules) {
    if (!matchesCondition(envelope, rule.condition)) continue;

    const flagsApplied = rule.actions
      .filter((action): action is Extract<RuleAction, { type: "flag" }> => action.type === "flag")
      .map(({ flag, value }) => ({ flag, value }));

    const moveAction = rule.actions.find(
      (action): action is Extract<RuleAction, { type: "move" }> => action.type === "move",
    );
    let movedTo: string | null = null;
    if (moveAction && (rule.dryRun || !moveClaimed)) {
      movedTo = moveAction.mailbox;
      if (!rule.dryRun) moveClaimed = true;
    }

    outcomes.push({ ruleId: rule.id, dryRun: rule.dryRun, flagsApplied, movedTo });
  }
  return outcomes;
}
