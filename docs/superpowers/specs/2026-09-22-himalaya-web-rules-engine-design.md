# Himalaya Web Slice 3: Mail Rules Engine

**Date:** 2026-09-22

**Status:** Brainstormed solo, autonomously, per the operator's standing
session-wide authorization ("autonom, du triffst alle Entscheidungen",
reaffirmed as "weiter" after Slice 2 shipped). Every decision below is a
judgment call made in this session — treat it as a proposal to correct or
override on review, not as a prior operator decision the way Slice 0/1's
were.

## Goal

Let the operator define rules — "if this envelope matches a condition, move
it and/or flag it" — that run automatically inside the mail watcher's
existing polling loop (Slice 2), so mail that matches a known pattern (a
newsletter, a specific sender, a recurring notification) is filed or marked
without the operator opening the app. This is Slice 3 of the mail-client
roadmap (`/home/dnames/.claude/plans/pasted-content-id-35ee-using-superpower-curried-reddy.md`),
which explicitly depends on Slice 2's watcher and explicitly says to reuse
its polling loop rather than run a second one.

## Context and constraints

- The roadmap's own line for this slice: *"Rules engine (condition → move/
  flag/tag/seen), runs in watcher; MiniMax suggests rules."* It is the
  sparsest row in the roadmap — the roadmap doc itself says no skill exists
  for a mail rules engine and defers all design to this slice's own
  brainstorm.
- **Verified against the installed Himalaya CLI, not assumed:** `himalaya
  flag add --flag <FLAG>` accepts exactly four values — `seen`, `answered`,
  `flagged`, `draft` (checked via `himalaya flag add --help`). There is no
  arbitrary custom-keyword tagging in this CLI surface. The roadmap's own
  Slice 4 row ("Tags vs. folders decision") already anticipated this needs
  its own decision — Slice 3 does not invent tagging to fill the gap.
  "Tag" and "seen" in the roadmap's phrasing collapse into one primitive:
  flag add/remove.
- `HimalayaService.setSeen()` (`himalaya.ts:254`) already wraps `flag add/
  remove --flag seen`; `HimalayaService.move()` already exists (used by
  trash-move). Both are reused, not reinvented.
- The watcher (`watcher.ts`, Slice 2) already computes, per watched account
  per tick, the exact list of genuinely new ("fresh") envelopes before
  deciding whether to notify. This is precisely the input a rules engine
  needs — no separate poll, no separate envelope fetch.
- Rules only make sense for accounts the operator has already opted into
  watching (`watch: true`); Himalaya has no independent "list all new mail
  regardless of watch state" primitive, and running a second poll loop
  for accounts nobody is watching would contradict the roadmap's explicit
  "reuse the polling loop" instruction.
- AGENTS.md/HANDOFF's durable decisions: MiniMax is optional, server-side
  only, and AI actions can never send/move/delete/tag mail themselves —
  only ever return text a human acts on. A rule-suggestion AI task must
  return a *description* of a rule, not create or apply one.
- User-facing text stays German (though this slice, like Slice 2, ships
  with no UI); code/tests/docs stay English; synthetic data in automated
  tests; at most one reversible live check.

## Non-goals (this slice)

- A UI for creating/editing rules — v1 is hand-edited
  `~/.config/himalaya-web/rules.json`, exactly the precedent Slice 2 set
  for `watch: true` and the precedent Slice 1 set for special-folder
  overrides. A combined settings UI for all three is future work.
- Arbitrary custom tags/keywords — not exposed by this Himalaya version;
  deferred to the roadmap's own Slice 4.
- Regex conditions — `contains`/`equals` on `from`/`subject`/`to` covers
  the realistic cases (sender-based and subject-based filing) without the
  complexity and ReDoS surface of user-supplied regex. Add later if a real
  rule genuinely needs it.
- Rules for accounts that aren't watched — see Context above.
- Auto-applying an AI-suggested rule — the AI task returns text only; the
  operator hand-adds it to `rules.json` if they want it, same as every
  other AI task in this app.
- Decoupling rule evaluation from `watch`-driven notifications — both
  currently gate on the same per-account `watch: true` (Decisions table),
  so there is no way yet to get silent auto-filing without also opting
  into desktop notifications for that account. Split into two flags later
  if that turns out to matter; no evidence yet that it does.

## Decisions

| Topic | Decision | Rationale |
|---|---|---|
| Storage | New `~/.config/himalaya-web/rules.json`, hand-edited, `0600`, array of rule objects | Matches `accounts.json`'s established v1 pattern; rules are logically distinct from per-account folder/watch settings, so a separate file keeps each config file's shape simple |
| Scope | Rules evaluate only against watched accounts' fresh envelopes, inside the watcher's existing tick | Reuses Slice 2's infrastructure exactly, per the roadmap's explicit instruction; no second poll loop |
| Condition shape | `{ field: "from" \| "subject" \| "to", match: "contains" \| "equals", value: string }`, case-insensitive | Covers realistic sender/subject filing rules; avoids regex's complexity/ReDoS surface for a hand-edited, no-validation-UI config file |
| Action shape | `{ type: "move", mailbox: string }` and/or `{ type: "flag", flag: "seen" \| "answered" \| "flagged" \| "draft", value: boolean }` (repeatable) | The only primitives Himalaya's `flag add`/`move` actually expose, verified against `--help`, not assumed |
| Multiple actions per rule | A rule's `actions` array applies in order; all flag actions run first, then at most the rule's own first `move` action | Matches IMAP UID semantics: a flag operation needs the message's current (pre-move) id/mailbox, so flags must be set before any move |
| Multiple rules matching one envelope | Evaluate rules in file order; every matching rule's flag actions apply; the **first** matching rule with a `move` action wins (a message can only end up in one mailbox) — later matching move actions are skipped, not queued | Keeps the model simple and matches "first rule wins" as the least surprising default for a hand-edited, ordered file |
| Notification interaction | An envelope a rule moved out of the watched mailbox, or marked `seen: true`, is excluded from that tick's watcher notification; an envelope only flagged (`answered`/`flagged`/`draft`, or `seen: false`) still notifies normally | A message auto-filed or auto-read doesn't need "you have new mail" — that would defeat the rule's purpose; a message merely flagged for later still does |
| Safety valve for a new rule | Optional per-rule `"dryRun": true` — the engine evaluates and logs the match + the action it *would* take (`process.stdout.write`, captured by `journalctl --user -u himalaya-web.service`) but calls no Himalaya command | Lets the operator test a rule's condition against real mail before trusting it to actually move/flag anything, without needing a UI or a separate test endpoint — matches this app's existing log-and-`journalctl` pattern (already used throughout this session) rather than adding new surface |
| MiniMax rule suggestion | One new bounded AI task, `suggest-rule`, same shape as `summarize`/`reply-draft` (`ai.ts`): given a message ref, returns German text describing a candidate rule (condition + action) for the operator to read and hand-add to `rules.json` if they want it | Matches the roadmap's stated "MiniMax suggests rules"; stays inside the durable "AI never sends/moves/deletes/tags" decision by construction — it's text output, not an executed action |

## Architecture

### `rules.json` schema

```json
[
  {
    "id": "newsletter-example",
    "account": "andre",
    "enabled": true,
    "dryRun": false,
    "condition": { "field": "from", "match": "contains", "value": "newsletter@example.test" },
    "actions": [
      { "type": "flag", "flag": "seen", "value": true },
      { "type": "move", "mailbox": "Newsletter" }
    ]
  }
]
```

### Server: `src/server/rules.ts` (new module)

Pure, injectable, mirrors `special-folders.ts`'s shape:

```ts
export type RuleCondition = {
  field: "from" | "subject" | "to";
  match: "contains" | "equals";
  value: string;
};

export type RuleAction =
  | { type: "flag"; flag: "seen" | "answered" | "flagged" | "draft"; value: boolean }
  | { type: "move"; mailbox: string };

export type Rule = {
  id: string;
  account: string;
  enabled: boolean;
  dryRun?: boolean;
  condition: RuleCondition;
  actions: RuleAction[];
};

export function readRules(path?: string): Promise<Rule[]>; // swallows parse/ENOENT errors, returns []

export function matchesCondition(envelope: Envelope, condition: RuleCondition): boolean;

export type RuleOutcome = {
  ruleId: string;
  flagsApplied: RuleAction[];
  movedTo: string | null;
  dryRun: boolean;
};

export function planActions(envelope: Envelope, rules: readonly Rule[]): RuleOutcome[];
// Pure: given one envelope and the rules for its account, returns what
// would happen — flags to apply (all matching rules') and at most one
// move (first matching rule's). No I/O; watcher.ts executes the plan.
```

`watcher.ts` calls `planActions` for each `fresh` envelope (after the
Slice 2 notifiedIds bookkeeping, before deciding whether to notify), then
for each non-dry-run outcome: calls `service.setFlag`/`service.move` (flags
first, then the move, per the Decisions table), and if the outcome moved
the envelope or set `seen: true`, excludes that envelope from the tick's
notification batch. Dry-run outcomes are logged, never executed, and never
suppress notifications (the operator is still testing the rule — they
should still see the mail arrive normally).

### `HimalayaService` addition

```ts
setFlag(ref: MessageRef, flag: "seen" | "answered" | "flagged" | "draft", value: boolean): Promise<void>;
```

`HimalayaCli.setSeen()` becomes a one-line wrapper: `setFlag(ref, "seen",
value)`. No behavior change to `setSeen`'s existing callers/tests beyond
the internal refactor.

### AI: `ai.ts`'s `suggest-rule` task

New `AiTask` value `"suggest-rule"`, same `{ kind: "message"; detail }`
source as `summarize`/`reply-draft`. Prompt instructs the model to name one
candidate condition (field/match/value) and action (flag or move) in
German prose, explicitly told it is proposing text for the operator to
review, not executing anything. Reuses the existing bounded-prompt,
timeout, cooldown, and in-flight-limit machinery in `ai.ts` — no new AI
infrastructure.

## Error handling

- A malformed or missing `rules.json` behaves like a malformed/missing
  `accounts.json` today: `readRules` swallows the error and returns `[]`
  (no rules, no crash), consistent with `readAccountsConfig`.
- A rule action's Himalaya call failing (e.g. destination mailbox doesn't
  exist) is caught per-envelope, logged, and does not stop evaluation of
  other envelopes or other rules in the same tick — matches Slice 2's
  per-account error isolation, applied one level deeper (per-envelope).
- A rule whose `condition.field`/`match`/`action.flag`/`action.type` value
  fails schema validation on read is dropped from the loaded rule set (not
  silently coerced), with a startup-time log line naming which rule id was
  dropped and why.

## Testing

- Unit (`rules.test.ts`): `matchesCondition` (contains/equals,
  case-insensitivity, each field), `planActions` (single rule, multiple
  matching rules' flags all apply, only the first matching move wins,
  dry-run never appears in the executable plan, a rule for a different
  account never matches).
- `watcher.test.ts` additions: a fresh envelope matching a move-rule is
  excluded from that tick's notification; one matching a seen-rule is
  excluded; one matching only a flag-rule (`flagged`) still notifies; a
  dry-run rule's match is logged but the envelope still notifies and no
  `service.move`/`setFlag` call happens.
- `himalaya.test.ts`: `setFlag`'s argv for each of the four flag values,
  add and remove; `setSeen` still passes its existing tests unchanged
  (proving the refactor is behavior-preserving).
- `ai.test.ts`: `suggest-rule`'s prompt construction, same shape as the
  existing three tasks' tests.
- Manual verification, scoped like Slice 2's: one `dryRun: true` rule
  against the operator's own account, confirmed via `journalctl` that a
  real new message logs a match with no side effect, before ever setting
  `dryRun: false` against real mail.

## Docs to update in the same change

`README.md` (feature list, `rules.json` schema, the `suggest-rule` AI
task), `HANDOFF.md` (progress, decisions, limitations), `CHANGELOG.md`.

## Open questions for plan review

1. Should a `move` action's destination mailbox be validated to exist (via
   `listMailboxes`) before a rule is allowed to run non-dry-run, or is
   "Himalaya's own move command fails loudly and gets caught/logged" (this
   spec's current Error handling) sufficient? Leaning toward the latter
   (YAGNI, matches how `accounts.json`'s hand-edited overrides work today)
   but flagging it for plan review rather than deciding unilaterally.
2. Is once-per-tick per-envelope rule evaluation fast enough once several
   rules exist per account? Each match is a pure in-memory string
   comparison (no I/O), so this should be negligible next to the tick's
   existing `listMailboxes`/`listEnvelopes` calls — no evidence of a
   problem, noted for completeness.
