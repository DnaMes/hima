import type { RuleActionDto, RuleDto } from "../shared/types.js";

export const MAX_RULES = 100;
const MAX_NAME = 64;
const MAX_VALUE = 200;
const MAX_ACTIONS = 8;

export type RuleDraft = {
  id: string;
  account: string;
  enabled: boolean;
  dryRun: boolean;
  field: RuleDto["condition"]["field"];
  match: RuleDto["condition"]["match"];
  value: string;
  markSeen: boolean;
  markFlagged: boolean;
  /** Target folder of a "move" action; "" means none. */
  moveTo: string;
  /** Actions the form has no control for (hand-edited ones); written back unchanged. */
  extraActions: RuleActionDto[];
};

export function newRuleDraft(account: string, existingIds: readonly string[]): RuleDraft {
  const taken = new Set(existingIds.map((id) => id.trim().toLowerCase()));
  let number = 1;
  while (taken.has(`regel ${number}`)) number += 1;
  // New rules start in dry-run: they only log until the operator switches them live.
  return {
    id: `Regel ${number}`, account, enabled: true, dryRun: true, field: "from", match: "contains", value: "",
    markSeen: false, markFlagged: false, moveTo: "", extraActions: [],
  };
}

export function ruleToDraft(rule: RuleDto): RuleDraft {
  let markSeen = false;
  let markFlagged = false;
  let moveTo = "";
  const extraActions: RuleActionDto[] = [];
  for (const action of rule.actions) {
    if (action.type === "flag" && action.flag === "seen" && action.value && !markSeen) markSeen = true;
    else if (action.type === "flag" && action.flag === "flagged" && action.value && !markFlagged) markFlagged = true;
    else if (action.type === "move" && moveTo === "") moveTo = action.mailbox;
    else extraActions.push(action);
  }
  return {
    id: rule.id, account: rule.account, enabled: rule.enabled, dryRun: rule.dryRun,
    field: rule.condition.field, match: rule.condition.match, value: rule.condition.value,
    markSeen, markFlagged, moveTo, extraActions,
  };
}

export function draftToRule(draft: RuleDraft): RuleDto {
  const actions: RuleActionDto[] = [
    ...(draft.markSeen ? [{ type: "flag" as const, flag: "seen" as const, value: true }] : []),
    ...(draft.markFlagged ? [{ type: "flag" as const, flag: "flagged" as const, value: true }] : []),
    ...(draft.moveTo ? [{ type: "move" as const, mailbox: draft.moveTo }] : []),
    ...draft.extraActions,
  ];
  return {
    id: draft.id.trim(), account: draft.account, enabled: draft.enabled, dryRun: draft.dryRun,
    condition: { field: draft.field, match: draft.match, value: draft.value.trim() },
    actions,
  };
}

const actionCount = (draft: RuleDraft): number =>
  Number(draft.markSeen) + Number(draft.markFlagged) + Number(draft.moveTo !== "") + draft.extraActions.length;

export function validateDrafts(drafts: readonly RuleDraft[]): string[] {
  const problems: string[] = [];
  if (drafts.length > MAX_RULES) problems.push(`Es können höchstens ${MAX_RULES} Regeln gespeichert werden.`);
  const seen = new Map<string, number>();
  for (const draft of drafts) {
    const name = draft.id.trim();
    if (name === "") {
      problems.push("Eine Regel hat keinen Namen.");
      continue;
    }
    seen.set(name.toLowerCase(), (seen.get(name.toLowerCase()) ?? 0) + 1);
    const label = `Regel „${name}“`;
    if (name.length > MAX_NAME) problems.push(`${label}: Der Name darf höchstens ${MAX_NAME} Zeichen haben.`);
    const value = draft.value.trim();
    if (value === "") problems.push(`${label}: Bitte einen Suchtext eingeben.`);
    else if (value.length > MAX_VALUE) problems.push(`${label}: Der Suchtext darf höchstens ${MAX_VALUE} Zeichen haben.`);
    const actions = actionCount(draft);
    if (actions === 0) problems.push(`${label}: Bitte mindestens eine Aktion wählen.`);
    else if (actions > MAX_ACTIONS) problems.push(`${label}: Höchstens ${MAX_ACTIONS} Aktionen.`);
  }
  const reported = new Set<string>();
  for (const draft of drafts) {
    const key = draft.id.trim().toLowerCase();
    if (key !== "" && (seen.get(key) ?? 0) > 1 && !reported.has(key)) {
      reported.add(key);
      problems.push(`Der Name „${draft.id.trim()}“ kommt mehrfach vor.`);
    }
  }
  return problems;
}

const isLive = (rule: RuleDto): boolean => rule.enabled && !rule.dryRun && rule.actions.length > 0;

/** Names of the rules that start acting on real mail with this save. */
export function goesLive(before: readonly RuleDto[], after: readonly RuleDto[]): string[] {
  const previous = new Map(before.map((rule) => [rule.id, rule]));
  return after.filter((rule) => isLive(rule) && !(previous.has(rule.id) && isLive(previous.get(rule.id)!))).map((rule) => rule.id);
}

export function moveRule<T>(list: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
