# Himalaya Web Slice 3: Mail Rules Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator define rules in a hand-edited `rules.json` that automatically move and/or flag genuinely new mail on watched accounts, evaluated inside the existing mail watcher's tick — no rule, no behavior change; a matching live rule suppresses that message's watcher notification.

**Architecture:** A new pure `rules.ts` module (types, JSON parsing, condition matching, and a per-envelope action planner) mirrors `special-folders.ts`'s shape. `watcher.ts`'s tick reads `rules.json` once per tick (like it already reads `accounts.json`), plans each fresh envelope's outcome, executes flags before any move (IMAP UID ordering), and excludes a moved-or-marked-seen envelope from that tick's notification. `HimalayaService` gains a small `setFlag` primitive that `setSeen` becomes a wrapper around. One new bounded MiniMax task, `suggest-rule`, returns rule-shaped German text for the operator to hand-copy into `rules.json` — it never executes anything.

**Tech Stack:** TypeScript, Vitest 3 (fake timers, already used by `watcher.test.ts`), the existing `HimalayaService`/`ai.ts` patterns.

**Spec:** `docs/superpowers/specs/2026-09-22-himalaya-web-rules-engine-design.md`

## Global Constraints

- Rules only evaluate for accounts already opted into `watch: true` (`accounts.json`), inside the watcher's existing tick — no second poll loop.
- `himalaya flag add --flag <FLAG>` accepts exactly `seen`, `answered`, `flagged`, `draft` — verified against the installed CLI, not assumed. No arbitrary tagging exists.
- Condition fields are `from` | `subject` | `to`; match is `contains` | `equals`, case-insensitive. No regex.
- A rule's flag actions execute before any move action (a flag operation needs the message's pre-move id/mailbox).
- Across all rules matching one envelope: every matching rule's flag actions apply; only the **first** matching **non-dry-run** rule with a move action actually moves the message. A dry-run rule always reports its own would-be action independently of other rules' claims.
- An envelope a live (non-dry-run) rule moved, or marked `seen: true`, is excluded from that tick's watcher notification. An envelope only flagged otherwise, or matched only by a dry-run rule, still notifies normally.
- `dryRun: true` rules evaluate and log (`process.stdout.write`, one line per match) but call no Himalaya command.
- `rules.json` is hand-edited, `0600`, at `~/.config/himalaya-web/rules.json` (overridable via `HIMALAYA_WEB_RULES_PATH`, matching `HIMALAYA_WEB_ACCOUNTS_PATH`'s existing pattern). A missing or malformed file behaves like a missing/malformed `accounts.json`: no crash, no rules.
- An individual invalid rule entry is dropped (logged), not coerced — the rest of the file still loads.
- MiniMax's `suggest-rule` task returns text only; it can never send/move/delete/flag mail itself (durable project decision).
- User-facing text stays German; code/tests/docs stay English; synthetic data in automated tests; at most one reversible live check.

## Review Focus

- A malformed `rules.json` (one bad entry among otherwise-valid ones) must not silently disable every rule in the file — only the bad entry is dropped.
- Two live rules both matching one envelope, each with a `move` action to a **different** mailbox, must move it to exactly one place (the first matching rule's), not both, and not throw.
- A `dryRun: true` rule matching real new mail must never call `service.move`/`service.setFlag`, and that mail must still notify normally — the operator is testing the rule, not silently losing the notification they'd otherwise get.
- A rule's Himalaria call failing (e.g. destination mailbox doesn't exist) for one envelope must not stop rule evaluation for the rest of that tick's other fresh envelopes.
- A rule written for an account that isn't currently watched (or was watched and just got `watch: false`) must never fire — rules read every tick alongside `accounts.json`, so a change takes effect within one interval without a restart, same as Slice 2's `watch` toggle.

---

### Task 1: `rules.ts` — types, parsing, condition matching, and the per-envelope planner

**Files:**
- Create: `src/server/rules.ts`
- Test: `src/server/rules.test.ts`

**Interfaces:**
- Consumes: `Envelope` (`../shared/types.js`, already has `from`/`to`: `Address[]` and `subject: string`).
- Produces: `RuleField`, `RuleMatch`, `RuleFlagName`, `RuleCondition`, `RuleAction`, `Rule`, `RuleOutcome`, `readRules(path?): Promise<Rule[]>`, `matchesCondition(envelope, condition): boolean`, `planActions(envelope, rules): RuleOutcome[]`. Task 3 (`watcher.ts`) imports all of these.

- [ ] **Step 1: Write the failing tests**

Create `src/server/rules.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { Envelope } from "../shared/types.js";
import { matchesCondition, planActions, readRules, type Rule } from "./rules.js";

function envelope(overrides: Partial<Envelope> = {}): Envelope {
  return {
    id: "1",
    date: null,
    flags: [],
    from: [{ name: "Newsletter Team", email: "newsletter@example.test" }],
    to: [{ name: "Andre", email: "andre@example.test" }],
    subject: "Weekly digest",
    size: 10,
    hasAttachment: false,
    ...overrides,
  };
}

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "r1",
    account: "andre",
    enabled: true,
    dryRun: false,
    condition: { field: "from", match: "contains", value: "newsletter@example.test" },
    actions: [{ type: "flag", flag: "seen", value: true }],
    ...overrides,
  };
}

describe("matchesCondition", () => {
  it("matches 'from' by email, case-insensitively, for contains and equals", () => {
    const env = envelope();
    expect(matchesCondition(env, { field: "from", match: "contains", value: "NEWSLETTER@example.test" })).toBe(true);
    expect(matchesCondition(env, { field: "from", match: "equals", value: "newsletter@example.test" })).toBe(true);
    expect(matchesCondition(env, { field: "from", match: "equals", value: "other@example.test" })).toBe(false);
  });

  it("matches 'from' by display name too", () => {
    const env = envelope();
    expect(matchesCondition(env, { field: "from", match: "contains", value: "newsletter team" })).toBe(true);
  });

  it("matches 'to' the same way as 'from'", () => {
    const env = envelope();
    expect(matchesCondition(env, { field: "to", match: "equals", value: "andre@example.test" })).toBe(true);
  });

  it("matches 'subject' as plain text, case-insensitively", () => {
    const env = envelope({ subject: "Weekly Digest" });
    expect(matchesCondition(env, { field: "subject", match: "contains", value: "digest" })).toBe(true);
    expect(matchesCondition(env, { field: "subject", match: "equals", value: "weekly digest" })).toBe(true);
    expect(matchesCondition(env, { field: "subject", match: "equals", value: "digest" })).toBe(false);
  });

  it("returns false when no address in the field matches", () => {
    const env = envelope({ from: [{ name: null, email: "someone-else@example.test" }] });
    expect(matchesCondition(env, { field: "from", match: "contains", value: "newsletter" })).toBe(false);
  });
});

describe("planActions", () => {
  it("returns one outcome per matching rule, and none for a non-matching rule", () => {
    const matching = rule({ id: "match" });
    const nonMatching = rule({ id: "no-match", condition: { field: "from", match: "equals", value: "nobody@example.test" } });
    const outcomes = planActions(envelope(), [matching, nonMatching]);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.ruleId).toBe("match");
  });

  it("applies every matching rule's flag actions", () => {
    const flagSeen = rule({ id: "seen-rule", actions: [{ type: "flag", flag: "seen", value: true }] });
    const flagFlagged = rule({ id: "flagged-rule", actions: [{ type: "flag", flag: "flagged", value: true }] });
    const outcomes = planActions(envelope(), [flagSeen, flagFlagged]);
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]).toMatchObject({ ruleId: "seen-rule", flagsApplied: [{ flag: "seen", value: true }], movedTo: null });
    expect(outcomes[1]).toMatchObject({ ruleId: "flagged-rule", flagsApplied: [{ flag: "flagged", value: true }], movedTo: null });
  });

  it("only the first matching live rule's move action actually moves the message (Review Focus)", () => {
    const first = rule({ id: "first", actions: [{ type: "move", mailbox: "Newsletter" }] });
    const second = rule({ id: "second", actions: [{ type: "move", mailbox: "Archive" }] });
    const outcomes = planActions(envelope(), [first, second]);
    expect(outcomes[0]).toMatchObject({ ruleId: "first", movedTo: "Newsletter" });
    expect(outcomes[1]).toMatchObject({ ruleId: "second", movedTo: null });
  });

  it("a dry-run rule always reports its own move, independent of other rules' claims", () => {
    const dryRunFirst = rule({ id: "dry", dryRun: true, actions: [{ type: "move", mailbox: "Newsletter" }] });
    const live = rule({ id: "live", actions: [{ type: "move", mailbox: "Archive" }] });
    const outcomes = planActions(envelope(), [dryRunFirst, live]);
    expect(outcomes[0]).toMatchObject({ ruleId: "dry", dryRun: true, movedTo: "Newsletter" });
    expect(outcomes[1]).toMatchObject({ ruleId: "live", dryRun: false, movedTo: "Archive" });
  });

  it("a rule with both a flag and a move action reports both", () => {
    const combined = rule({
      id: "combined",
      actions: [{ type: "flag", flag: "seen", value: true }, { type: "move", mailbox: "Newsletter" }],
    });
    const outcomes = planActions(envelope(), [combined]);
    expect(outcomes[0]).toMatchObject({
      ruleId: "combined",
      flagsApplied: [{ flag: "seen", value: true }],
      movedTo: "Newsletter",
    });
  });
});

describe("readRules", () => {
  it("returns an empty array when the file does not exist", async () => {
    expect(await readRules(join(tmpdir(), "himalaya-web-rules-test-missing", "rules.json"))).toEqual([]);
  });

  it("parses a valid rule, defaulting enabled/dryRun when present as booleans", async () => {
    const directory = await mkdtemp(join(tmpdir(), "himalaya-web-rules-test-"));
    const path = join(directory, "rules.json");
    try {
      await writeFile(path, JSON.stringify([{
        id: "r1", account: "andre", enabled: true, dryRun: false,
        condition: { field: "from", match: "contains", value: "newsletter@example.test" },
        actions: [{ type: "flag", flag: "seen", value: true }],
      }]));
      const rules = await readRules(path);
      expect(rules).toEqual([{
        id: "r1", account: "andre", enabled: true, dryRun: false,
        condition: { field: "from", match: "contains", value: "newsletter@example.test" },
        actions: [{ type: "flag", flag: "seen", value: true }],
      }]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("drops one invalid entry but keeps loading the rest of the file (Review Focus)", async () => {
    const directory = await mkdtemp(join(tmpdir(), "himalaya-web-rules-test-"));
    const path = join(directory, "rules.json");
    try {
      await writeFile(path, JSON.stringify([
        { id: "bad", account: "andre", condition: { field: "nonsense", match: "contains", value: "x" }, actions: [] },
        {
          id: "good", account: "andre", enabled: true, dryRun: false,
          condition: { field: "subject", match: "contains", value: "digest" },
          actions: [{ type: "move", mailbox: "Newsletter" }],
        },
      ]));
      const rules = await readRules(path);
      expect(rules).toHaveLength(1);
      expect(rules[0]?.id).toBe("good");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns an empty array for malformed JSON, without throwing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "himalaya-web-rules-test-"));
    const path = join(directory, "rules.json");
    try {
      await writeFile(path, "{not valid json");
      expect(await readRules(path)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/server/rules.test.ts`
Expected: FAIL — `Cannot find module './rules.js'`.

- [ ] **Step 3: Implement `rules.ts`**

Create `src/server/rules.ts`:

```ts
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

function parseRule(value: unknown): Rule | null {
  if (!isRecord(value)) return null;
  const { id, account, enabled, dryRun, condition, actions } = value;
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof account !== "string" || account.length === 0) return null;
  const parsedCondition = parseCondition(condition);
  if (!parsedCondition) return null;
  if (!Array.isArray(actions) || actions.length === 0) return null;
  const parsedActions: RuleAction[] = [];
  for (const action of actions) {
    const parsed = parseAction(action);
    if (!parsed) return null;
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
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(parsed)) return [];
    const rules: Rule[] = [];
    for (const entry of parsed) {
      const rule = parseRule(entry);
      if (rule) {
        rules.push(rule);
      } else {
        process.stderr.write(`[rules] dropped an invalid rule entry in ${path}\n`);
      }
    }
    return rules;
  } catch {
    return [];
  }
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/server/rules.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/server/rules.ts src/server/rules.test.ts
git commit -m "feat(server): add the mail rules engine's condition matching and action planner"
```

---

### Task 2: `HimalayaService.setFlag` — generalize `setSeen`'s flag primitive

**Files:**
- Modify: `src/server/himalaya.ts`
- Modify: `src/server/himalaya.test.ts`

**Interfaces:**
- Consumes: nothing new (pure refactor of existing `flag add`/`flag remove` argv building).
- Produces: `HimalayaService.setFlag(ref: MessageRef, flag: "seen" | "answered" | "flagged" | "draft", value: boolean): Promise<void>`. Task 3 (`watcher.ts`) calls this for a rule's `flag` actions.

- [ ] **Step 1: Write the failing test**

Add to `src/server/himalaya.test.ts`, near the existing `setSeen`-adjacent tests (search for `"never invokes the runner for an invalid account reference"` and add this test right before it, inside the same `describe("HimalayaCli", ...)` block):

```ts
  it("setFlag adds or removes any of the four supported flags", async () => {
    const runner = new RecordingRunner();
    const cli = new HimalayaCli(runner);

    await cli.setFlag({ account: "andre", mailbox: "INBOX", message: "7" }, "flagged", true);
    await cli.setFlag({ account: "andre", mailbox: "INBOX", message: "7" }, "answered", false);

    expect(runner.calls).toEqual([
      ["--account", "andre", "flag", "add", "--flag", "flagged", "7", "--mailbox", "INBOX"],
      ["--account", "andre", "flag", "remove", "--flag", "answered", "7", "--mailbox", "INBOX"],
    ]);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/himalaya.test.ts -t "setFlag adds or removes"`
Expected: FAIL — `cli.setFlag is not a function`.

- [ ] **Step 3: Add `setFlag` and refactor `setSeen` to use it**

In `src/server/himalaya.ts`, add to the `HimalayaService` interface (right after the existing `setSeen` line):

```ts
  setFlag(ref: MessageRef, flag: "seen" | "answered" | "flagged" | "draft", value: boolean): Promise<void>;
```

Replace the existing `setSeen` implementation:

```ts
  async setSeen(ref: MessageRef, seen: boolean): Promise<void> {
    const safe = messageRef(ref.account, ref.mailbox, ref.message);
    const action = seen ? "add" : "remove";
    requireSuccess(
      await this.runner.run([
        "--account",
        safe.account,
        "flag",
        action,
        "--flag",
        "seen",
        safe.message,
        "--mailbox",
        safe.mailbox,
      ]),
    );
  }
```

with:

```ts
  async setSeen(ref: MessageRef, seen: boolean): Promise<void> {
    await this.setFlag(ref, "seen", seen);
  }

  async setFlag(ref: MessageRef, flag: "seen" | "answered" | "flagged" | "draft", value: boolean): Promise<void> {
    const safe = messageRef(ref.account, ref.mailbox, ref.message);
    const action = value ? "add" : "remove";
    requireSuccess(
      await this.runner.run([
        "--account",
        safe.account,
        "flag",
        action,
        "--flag",
        flag,
        safe.message,
        "--mailbox",
        safe.mailbox,
      ]),
    );
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/server/himalaya.test.ts`
Expected: PASS (all tests, including the pre-existing `setSeen`-driven ones — proving the refactor is behavior-preserving).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/server/himalaya.ts src/server/himalaya.test.ts
git commit -m "feat(server): generalize setSeen into a setFlag primitive for the rules engine"
```

---

### Task 3: Wire rule evaluation into the watcher's tick

**Files:**
- Modify: `src/server/watcher.ts`
- Modify: `src/server/watcher.test.ts`

**Interfaces:**
- Consumes: `readRules`, `matchesCondition` (unused directly, via `planActions`), `planActions`, `Rule`, `RuleOutcome` (Task 1's `rules.ts`); `HimalayaService.setFlag` (Task 2); `HimalayaService.move` (already existed, now added to the watcher's own `Pick<...>` service type); `MessageRef`/`messageRef` (`../shared/types.js`/`./contracts.js`, already used elsewhere in this codebase).
- Produces: `createWatcher`'s `deps` gains an optional `readRules?: (path?: string) => Promise<Rule[]>`; `deps.service` widens to also require `setFlag` and `move`. No change to `Watcher`'s public shape (`start`/`stop`/`summary`).

- [ ] **Step 1: Write the failing tests**

Add to `src/server/watcher.test.ts`. First, extend the imports and `makeDeps` helper — replace:

```ts
import type { Envelope, Mailbox } from "../shared/types.js";
import { HimalayaError, type HimalayaService } from "./himalaya.js";
import type { AccountFolderSettings } from "./special-folders.js";
import { createWatcher } from "./watcher.js";
```

with:

```ts
import type { Envelope, Mailbox } from "../shared/types.js";
import { HimalayaError, type HimalayaService } from "./himalaya.js";
import type { Rule } from "./rules.js";
import type { AccountFolderSettings } from "./special-folders.js";
import { createWatcher } from "./watcher.js";
```

Then replace the `FakeDeps`/`makeDeps` block:

```ts
type FakeDeps = {
  service: Pick<HimalayaService, "listMailboxes" | "listEnvelopes">;
  readAccountsConfig: () => Promise<Record<string, AccountFolderSettings>>;
  notify: ReturnType<typeof vi.fn>;
};

function makeDeps(overrides: Partial<FakeDeps> = {}): FakeDeps {
  return {
    service: {
      listMailboxes: vi.fn().mockResolvedValue([inbox(0)]),
      listEnvelopes: vi.fn().mockResolvedValue([]),
    },
    readAccountsConfig: vi.fn().mockResolvedValue({}),
    notify: vi.fn(),
    ...overrides,
  };
}
```

with:

```ts
type FakeService = Pick<HimalayaService, "listMailboxes" | "listEnvelopes" | "setFlag" | "move">;

type FakeDeps = {
  service: FakeService;
  readAccountsConfig: () => Promise<Record<string, AccountFolderSettings>>;
  readRules: () => Promise<Rule[]>;
  notify: ReturnType<typeof vi.fn>;
};

function makeDeps(overrides: Partial<FakeDeps> = {}): FakeDeps {
  return {
    service: {
      listMailboxes: vi.fn().mockResolvedValue([inbox(0)]),
      listEnvelopes: vi.fn().mockResolvedValue([]),
      setFlag: vi.fn().mockResolvedValue(undefined),
      move: vi.fn().mockResolvedValue(undefined),
    },
    readAccountsConfig: vi.fn().mockResolvedValue({}),
    readRules: vi.fn().mockResolvedValue([]),
    notify: vi.fn(),
    ...overrides,
  };
}

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "r1",
    account: "andre",
    enabled: true,
    dryRun: false,
    condition: { field: "from", match: "contains", value: "newsletter@x.test" },
    actions: [{ type: "flag", flag: "seen", value: true }],
    ...overrides,
  };
}
```

Every existing `createWatcher({ ...deps, intervalMs: 60_000 })` call in this file keeps working unchanged (`readRules` defaults to `vi.fn().mockResolvedValue([])` via `makeDeps`, so no rule ever matches unless a test overrides it).

Now add these new tests at the end of the `describe("createWatcher", ...)` block, right before the closing `});`:

```ts
  it("applies a matching live rule's flag action and suppresses the notification for a seen: true match", async () => {
    const listMailboxes = vi.fn().mockResolvedValueOnce([inbox(0)]).mockResolvedValueOnce([inbox(1)]);
    const listEnvelopes = vi.fn()
      .mockResolvedValueOnce([]) // baseline seed
      .mockResolvedValueOnce([envelope("1", "newsletter@x.test", "Weekly digest")]);
    const deps = makeDeps({
      service: {
        listMailboxes, listEnvelopes,
        setFlag: vi.fn().mockResolvedValue(undefined),
        move: vi.fn().mockResolvedValue(undefined),
      },
      readAccountsConfig: vi.fn().mockResolvedValue({ andre: { overrides: {}, watch: true } }),
      readRules: vi.fn().mockResolvedValue([rule()]),
    });
    const watcher = createWatcher({ ...deps, intervalMs: 60_000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(deps.service.setFlag).toHaveBeenCalledWith(
      { account: "andre", mailbox: "INBOX", message: "1" }, "seen", true,
    );
    expect(deps.notify).not.toHaveBeenCalled();
    watcher.stop();
  });

  it("a matching live rule's move action moves the message and suppresses the notification", async () => {
    const listMailboxes = vi.fn().mockResolvedValueOnce([inbox(0)]).mockResolvedValueOnce([inbox(1)]);
    const listEnvelopes = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([envelope("1", "newsletter@x.test", "Weekly digest")]);
    const deps = makeDeps({
      service: {
        listMailboxes, listEnvelopes,
        setFlag: vi.fn().mockResolvedValue(undefined),
        move: vi.fn().mockResolvedValue(undefined),
      },
      readAccountsConfig: vi.fn().mockResolvedValue({ andre: { overrides: {}, watch: true } }),
      readRules: vi.fn().mockResolvedValue([rule({ actions: [{ type: "move", mailbox: "Newsletter" }] })]),
    });
    const watcher = createWatcher({ ...deps, intervalMs: 60_000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(deps.service.move).toHaveBeenCalledWith(
      { account: "andre", mailbox: "INBOX", message: "1" }, "Newsletter",
    );
    expect(deps.notify).not.toHaveBeenCalled();
    watcher.stop();
  });

  it("a rule that only sets a non-seen flag (e.g. flagged) still notifies normally", async () => {
    const listMailboxes = vi.fn().mockResolvedValueOnce([inbox(0)]).mockResolvedValueOnce([inbox(1)]);
    const listEnvelopes = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([envelope("1", "newsletter@x.test", "Weekly digest")]);
    const deps = makeDeps({
      service: {
        listMailboxes, listEnvelopes,
        setFlag: vi.fn().mockResolvedValue(undefined),
        move: vi.fn().mockResolvedValue(undefined),
      },
      readAccountsConfig: vi.fn().mockResolvedValue({ andre: { overrides: {}, watch: true } }),
      readRules: vi.fn().mockResolvedValue([rule({ actions: [{ type: "flag", flag: "flagged", value: true }] })]),
    });
    const watcher = createWatcher({ ...deps, intervalMs: 60_000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(deps.service.setFlag).toHaveBeenCalledWith(
      { account: "andre", mailbox: "INBOX", message: "1" }, "flagged", true,
    );
    expect(deps.notify).toHaveBeenCalledWith("andre", "newsletter@x.test: Weekly digest");
    watcher.stop();
  });

  it("a dry-run rule never calls setFlag/move and the message still notifies normally (Review Focus)", async () => {
    const listMailboxes = vi.fn().mockResolvedValueOnce([inbox(0)]).mockResolvedValueOnce([inbox(1)]);
    const listEnvelopes = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([envelope("1", "newsletter@x.test", "Weekly digest")]);
    const deps = makeDeps({
      service: {
        listMailboxes, listEnvelopes,
        setFlag: vi.fn().mockResolvedValue(undefined),
        move: vi.fn().mockResolvedValue(undefined),
      },
      readAccountsConfig: vi.fn().mockResolvedValue({ andre: { overrides: {}, watch: true } }),
      readRules: vi.fn().mockResolvedValue([rule({ dryRun: true, actions: [{ type: "move", mailbox: "Newsletter" }] })]),
    });
    const watcher = createWatcher({ ...deps, intervalMs: 60_000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(deps.service.setFlag).not.toHaveBeenCalled();
    expect(deps.service.move).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith("andre", "newsletter@x.test: Weekly digest");
    watcher.stop();
  });

  it("a rule action failure for one envelope does not stop the tick or other envelopes (Review Focus)", async () => {
    const listMailboxes = vi.fn().mockResolvedValueOnce([inbox(0)]).mockResolvedValueOnce([inbox(2)]);
    const listEnvelopes = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        envelope("1", "newsletter@x.test", "Weekly digest"),
        envelope("2", "someone-else@x.test", "Hello"),
      ]);
    const move = vi.fn().mockRejectedValueOnce(new Error("Zielordner existiert nicht")).mockResolvedValue(undefined);
    const deps = makeDeps({
      service: { listMailboxes, listEnvelopes, setFlag: vi.fn().mockResolvedValue(undefined), move },
      readAccountsConfig: vi.fn().mockResolvedValue({ andre: { overrides: {}, watch: true } }),
      readRules: vi.fn().mockResolvedValue([rule({ actions: [{ type: "move", mailbox: "Missing" }] })]),
    });
    const watcher = createWatcher({ ...deps, intervalMs: 60_000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);

    // The second envelope doesn't match the rule (different sender), so it
    // still notifies even though the first envelope's rule action failed.
    expect(deps.notify).toHaveBeenCalledWith("andre", "someone-else@x.test: Hello");
    watcher.stop();
  });

  it("a rule for a different account never fires", async () => {
    const listMailboxes = vi.fn().mockResolvedValueOnce([inbox(0)]).mockResolvedValueOnce([inbox(1)]);
    const listEnvelopes = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([envelope("1", "newsletter@x.test", "Weekly digest")]);
    const deps = makeDeps({
      service: {
        listMailboxes, listEnvelopes,
        setFlag: vi.fn().mockResolvedValue(undefined),
        move: vi.fn().mockResolvedValue(undefined),
      },
      readAccountsConfig: vi.fn().mockResolvedValue({ andre: { overrides: {}, watch: true } }),
      readRules: vi.fn().mockResolvedValue([rule({ account: "someone-else" })]),
    });
    const watcher = createWatcher({ ...deps, intervalMs: 60_000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(deps.service.setFlag).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith("andre", "newsletter@x.test: Weekly digest");
    watcher.stop();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/server/watcher.test.ts`
Expected: FAIL — the current `watcher.ts` never calls `service.setFlag`/
`service.move` at all, so the new tests' `expect(deps.service.setFlag)
.toHaveBeenCalledWith(...)`/`expect(deps.notify).not.toHaveBeenCalled()`
assertions fail with call counts of 0 (`setFlag`/`move` never invoked, and
every fresh envelope still notifies since nothing suppresses it yet).

- [ ] **Step 3: Wire rules into `watcher.ts`**

In `src/server/watcher.ts`, change the imports:

```ts
import type { Envelope, Mailbox } from "../shared/types.js";
import { HimalayaError, type HimalayaService } from "./himalaya.js";
import { readAccountsConfig as defaultReadAccountsConfig, type AccountFolderSettings } from "./special-folders.js";
```

to:

```ts
import { messageRef } from "./contracts.js";
import type { Envelope, Mailbox } from "../shared/types.js";
import { HimalayaError, type HimalayaService } from "./himalaya.js";
import { planActions, readRules as defaultReadRules, type Rule } from "./rules.js";
import { readAccountsConfig as defaultReadAccountsConfig, type AccountFolderSettings } from "./special-folders.js";
```

Change `createWatcher`'s `deps` parameter type:

```ts
export function createWatcher(deps: {
  service: Pick<HimalayaService, "listMailboxes" | "listEnvelopes">;
  readAccountsConfig?: () => Promise<Record<string, AccountFolderSettings>>;
  notify: (title: string, body: string) => void;
  intervalMs?: number;
}): Watcher {
  const readAccountsConfig = deps.readAccountsConfig ?? defaultReadAccountsConfig;
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
```

to:

```ts
export function createWatcher(deps: {
  service: Pick<HimalayaService, "listMailboxes" | "listEnvelopes" | "setFlag" | "move">;
  readAccountsConfig?: () => Promise<Record<string, AccountFolderSettings>>;
  readRules?: (path?: string) => Promise<Rule[]>;
  notify: (title: string, body: string) => void;
  intervalMs?: number;
}): Watcher {
  const readAccountsConfig = deps.readAccountsConfig ?? defaultReadAccountsConfig;
  const readRules = deps.readRules ?? defaultReadRules;
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
```

Change `tickAccount`'s signature to accept the account's rules, and rewrite its fresh-envelope handling. Replace:

```ts
  async function tickAccount(account: string): Promise<void> {
```

with:

```ts
  async function tickAccount(account: string, accountRules: readonly Rule[]): Promise<void> {
```

Replace the whole block from `if (!rose) return;` through the end of `tickAccount` (i.e. everything from `if (!rose) return;` down to, but not including, the `} catch (error) {` line) — currently:

```ts
      if (!rose) return;

      const envelopes = await deps.service.listEnvelopes({
        account,
        mailbox: inbox.id,
        page: 1,
        pageSize: NEW_MAIL_PAGE_SIZE,
        search: { field: "all", text: "", unread: true },
      });
      const fresh = envelopes.filter((envelope) => !state!.seen.has(envelope.id));
      if (fresh.length === 0) return;

      if (fresh.length > COALESCE_THRESHOLD) {
        deps.notify(account, `${fresh.length} neue Nachrichten in ${account}`);
      } else {
        for (const envelope of fresh) deps.notify(account, describeEnvelope(envelope));
      }
      for (const envelope of fresh) remember(state, envelope.id);
```

with:

```ts
      if (!rose) return;

      const envelopes = await deps.service.listEnvelopes({
        account,
        mailbox: inbox.id,
        page: 1,
        pageSize: NEW_MAIL_PAGE_SIZE,
        search: { field: "all", text: "", unread: true },
      });
      const fresh = envelopes.filter((envelope) => !state!.seen.has(envelope.id));
      if (fresh.length === 0) return;

      const notifiable: Envelope[] = [];
      for (const envelope of fresh) {
        const suppressed = await applyRules(account, inbox.id, envelope, accountRules);
        if (!suppressed) notifiable.push(envelope);
      }
      for (const envelope of fresh) remember(state, envelope.id);

      if (notifiable.length === 0) return;
      if (notifiable.length > COALESCE_THRESHOLD) {
        deps.notify(account, `${notifiable.length} neue Nachrichten in ${account}`);
      } else {
        for (const envelope of notifiable) deps.notify(account, describeEnvelope(envelope));
      }
```

Add the new `applyRules` helper right above `tickAccount` (after the existing `describeEnvelope` function):

```ts
  async function applyRules(
    account: string,
    mailbox: string,
    envelope: Envelope,
    accountRules: readonly Rule[],
  ): Promise<boolean> {
    const outcomes = planActions(envelope, accountRules);
    let suppressed = false;
    for (const outcome of outcomes) {
      if (outcome.dryRun) {
        if (outcome.flagsApplied.length > 0 || outcome.movedTo) {
          const flagsText = outcome.flagsApplied.map((f) => `${f.flag}=${f.value}`).join(", ");
          const moveText = outcome.movedTo ? `move to "${outcome.movedTo}"` : "";
          process.stdout.write(
            `[rules] dry-run match: rule "${outcome.ruleId}" on ${account}/${envelope.id} would ${[flagsText, moveText].filter(Boolean).join("; ")}\n`,
          );
        }
        continue;
      }
      try {
        const ref = messageRef(account, mailbox, envelope.id);
        for (const flag of outcome.flagsApplied) {
          await deps.service.setFlag(ref, flag.flag, flag.value);
          if (flag.flag === "seen" && flag.value) suppressed = true;
        }
        if (outcome.movedTo) {
          await deps.service.move(ref, outcome.movedTo);
          suppressed = true;
        }
      } catch (error) {
        process.stderr.write(
          `[rules] action failed for rule "${outcome.ruleId}" on ${account}/${envelope.id}: ${errorMessage(error)}\n`,
        );
      }
    }
    return suppressed;
  }
```

Finally, update `tick()` to read rules once per tick and pass each account's slice to `tickAccount`. Replace:

```ts
  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      const config = await readAccountsConfig();
      const watched = Object.entries(config)
        .filter(([, settings]) => settings.watch === true)
        .map(([account]) => account);

      const stillWatched = new Set(watched);
      for (const account of [...states.keys()]) {
        if (!stillWatched.has(account)) {
          states.delete(account);
          currentSummary.delete(account);
        }
      }

      for (const account of watched) {
        await tickAccount(account);
      }
    } finally {
      ticking = false;
    }
  }
```

with:

```ts
  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      const config = await readAccountsConfig();
      const watched = Object.entries(config)
        .filter(([, settings]) => settings.watch === true)
        .map(([account]) => account);

      const stillWatched = new Set(watched);
      for (const account of [...states.keys()]) {
        if (!stillWatched.has(account)) {
          states.delete(account);
          currentSummary.delete(account);
        }
      }

      const allRules = await readRules();
      for (const account of watched) {
        const accountRules = allRules.filter((rule) => rule.account === account && rule.enabled);
        await tickAccount(account, accountRules);
      }
    } finally {
      ticking = false;
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/server/watcher.test.ts`
Expected: PASS (all tests — the pre-existing Slice 2 tests still pass unchanged, since `makeDeps`'s default `readRules` resolves to `[]`, so `planActions` returns no outcomes and every envelope stays notifiable exactly as before).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/server/watcher.ts src/server/watcher.test.ts
git commit -m "feat(server): evaluate mail rules on fresh envelopes inside the watcher tick"
```

---

### Task 4: `ai.ts`'s `suggest-rule` task

**Files:**
- Modify: `src/server/ai.ts`
- Modify: `src/server/ai.test.ts`

**Interfaces:**
- Consumes: nothing new — reuses `AiSource`, `buildAiPrompt`'s existing `{ kind: "message"; detail }` shape and bounded-prompt machinery.
- Produces: `AiTask` gains `"suggest-rule"`. No other exported shape changes — this task follows the exact pattern `summarize`/`reply-draft` already use, so nothing downstream needs a new type.

- [ ] **Step 1: Write the failing test**

Add to `src/server/ai.test.ts`, near the existing task-instruction tests (search for `it("builds a bounded prompt that treats message content as untrusted data"`, and add this test in the same `describe` block, right after it):

```ts
  it("builds a suggest-rule prompt that asks for a candidate condition and action, not an executed one", () => {
    const prompt = buildAiPrompt("suggest-rule", { kind: "message", detail });
    expect(prompt.system).toContain("mail assistant");
    expect(prompt.user).toContain("Bedingung");
    expect(prompt.user).toContain("Aktion");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/ai.test.ts -t "builds a suggest-rule prompt"`
Expected: FAIL — `taskInstruction`'s current `if/if/else` falls through to
the `polish-draft` instruction text for any task it doesn't recognize, so
`prompt.user` contains that text instead of "Bedingung"/"Aktion" and the
`toContain` assertions fail.

- [ ] **Step 3: Add the task**

In `src/server/ai.ts`, change:

```ts
export type AiTask = "summarize" | "reply-draft" | "polish-draft";
```

to:

```ts
export type AiTask = "summarize" | "reply-draft" | "polish-draft" | "suggest-rule";
```

Change `taskInstruction`:

```ts
function taskInstruction(task: AiTask): string {
  if (task === "summarize") return "Fasse die Nachricht auf Deutsch kurz zusammen und nenne danach die wichtigsten Punkte als Liste.";
  if (task === "reply-draft") return "Erstelle auf Deutsch einen höflichen Antwortentwurf. Sende nichts und erfinde keine Fakten, die nicht aus der Nachricht hervorgehen.";
  return "Formuliere den folgenden eigenen Entwurf auf Deutsch höflicher und klarer, ohne den Inhalt oder die Fakten zu verändern. Gib nur den überarbeiteten Text zurück.";
}
```

to:

```ts
function taskInstruction(task: AiTask): string {
  if (task === "summarize") return "Fasse die Nachricht auf Deutsch kurz zusammen und nenne danach die wichtigsten Punkte als Liste.";
  if (task === "reply-draft") return "Erstelle auf Deutsch einen höflichen Antwortentwurf. Sende nichts und erfinde keine Fakten, die nicht aus der Nachricht hervorgehen.";
  if (task === "suggest-rule") {
    return "Schlage auf Deutsch eine einzelne Regel für diese Nachricht vor: eine Bedingung (Feld Absender, Betreff oder Empfänger; „enthält" oder „ist gleich"; der Wert) und eine Aktion (verschieben in einen Ordner, und/oder ein Flag wie gelesen/beantwortet/markiert setzen). Du schlägst nur Text vor, den die Person selbst in ihre Konfiguration einträgt — du führst nichts aus, versendest, verschiebst, löschst oder markierst keine Nachricht.";
  }
  return "Formuliere den folgenden eigenen Entwurf auf Deutsch höflicher und klarer, ohne den Inhalt oder die Fakten zu verändern. Gib nur den überarbeiteten Text zurück.";
}
```

`buildAiPrompt`'s message-source branch already calls `taskInstruction(task)` and already rejects `"suggest-rule"` from the draft-source branch (a `suggest-rule` request with `source.kind === "draft"` falls through to the message-shaped branch's requirements — this matches `summarize`/`reply-draft`, which are also message-only tasks; no separate validation is needed here because the route that will call this, `POST /api/ai/assist`, already restricts `summarize`/`reply-draft`-shaped tasks to `{ task, ref }` bodies via its existing discriminated union in `app.ts`'s `aiBodySchema` — extending that union is this task's Step 3 continuation below).

In `src/server/app.ts`, change the `aiBodySchema` discriminated union:

```ts
const aiBodySchema = z.discriminatedUnion("task", [
  z.object({ task: z.enum(["summarize", "reply-draft"]), ref: refQuerySchema }),
  z.object({ task: z.literal("polish-draft"), draftText: z.string().min(1).max(64_000) }),
]);
```

to:

```ts
const aiBodySchema = z.discriminatedUnion("task", [
  z.object({ task: z.enum(["summarize", "reply-draft", "suggest-rule"]), ref: refQuerySchema }),
  z.object({ task: z.literal("polish-draft"), draftText: z.string().min(1).max(64_000) }),
]);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/server/ai.test.ts`
Expected: PASS (all tests, including the pre-existing `summarize`/`reply-draft`/`polish-draft` ones unchanged).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/server/ai.ts src/server/ai.test.ts src/server/app.ts
git commit -m "feat(server): add a bounded suggest-rule AI task"
```

---

### Task 5: Docs, version, and full verification

**Files:**
- Modify: `README.md`
- Modify: `HANDOFF.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: the shipped behavior of Tasks 1–4.
- Produces: nothing consumed by another task — closing documentation and release task.

- [ ] **Step 1: Update `README.md`**

In the "Current status" section, after the mail-watcher paragraph added by Slice 2 (ending "...by hand-editing `~/.config/himalaya-web/accounts.json`."), add:

```markdown
An opt-in rules engine evaluates alongside the watcher: entries in
`~/.config/himalaya-web/rules.json` match a watched account's genuinely
new mail by sender, subject, or recipient, and can move it to another
mailbox and/or set a flag (read, answered, marked, draft). A message a
live rule moves or marks read is filed silently instead of triggering a
desktop notification. Each rule can be marked `"dryRun": true` to log what
it would do, without touching any mail, before trusting it for real. A
bounded MiniMax task can suggest a candidate rule's condition and action
for a selected message as German text — it never creates, edits, or
applies a rule itself.
```

Update the "Current standalone app version" line to the new version from Step 4 below.

Append to the `accounts.json`/security paragraph (the one Slice 2's fix already extended, ending "...which is still never written to disk."):

```markdown
`~/.config/himalaya-web/rules.json` (same file mode, same no-credentials
rule) holds the rules engine's hand-edited entries; a malformed file, or
one bad entry among valid ones, is dropped/ignored rather than crashing
the watcher.
```

- [ ] **Step 2: Update `HANDOFF.md`**

Update the top progress bullet to add Slice 3 to the shipped list and move
"Slice 3 (rules engine) is next" to "Slice 4 (tags vs. folders) is next".
Add a new dated paragraph under "Current Progress" (matching the style of
the existing Slice 2 and post-0.7.0-fixes paragraphs) summarizing: the
rules engine's storage/evaluation/notification-suppression design, the
`setFlag` generalization, the `suggest-rule` AI task, and the verified
test/typecheck/build/Playwright/audit counts from Step 5 below. Add a
"Known Limitations" entry:

```markdown
- No settings UI exists for the rules engine — same hand-edit-`rules.json`
  pattern as `accounts.json`'s `watch`/`sentCopy`/overrides. Regex
  conditions and arbitrary custom tagging are explicitly out of scope for
  this slice (Himalaya's `flag add` only exposes seen/answered/flagged/
  draft — verified against the installed CLI); tagging is deferred to the
  roadmap's own Slice 4.
```

Update "Next Steps" to move past Slice 3 to Slice 4 (tags vs. folders) per
the roadmap.

- [ ] **Step 3: Add the `CHANGELOG.md` entry and bump `package.json`**

Add a new section above the current top entry with the next patch/minor
version (this slice adds real new functionality, so bump the minor:
`0.8.0`) and today's date, summarizing the rules engine, the `setFlag`
primitive, and the `suggest-rule` AI task in the same style as the
existing `0.7.0`/`0.7.1` entries. Update `package.json`'s `"version"` to
match.

- [ ] **Step 4: Full verification suite**

Run each of the following and confirm the stated outcome before committing:

```bash
npm run typecheck
```
Expected: no errors.

```bash
npm test
```
Expected: every test passes; confirm the printed total against the
pre-Slice-3 count plus this plan's new tests (Task 1: 15 new; Task 2: 1
new; Task 3: 6 new; Task 4: 1 new — 23 new tests).

```bash
npm run build
```
Expected: clean Vite + `tsc --noEmit` build.

```bash
env HIMALAYA_WEB_PORT=47832 npx playwright test
```
Expected: all existing Playwright specs still pass (this plan adds no new
client-side UI, so a regression here means something unrelated broke).

```bash
npm audit --omit=dev --audit-level=high
```
Expected: 0 findings (no new dependency was added).

- [ ] **Step 5: Update the version string in `src/shared/app-meta.test.ts`**

`APP_VERSION`/`APP_VERSION_LABEL` derive from `package.json` (see
`src/shared/app-meta.ts`), so bumping the version in Step 3 will make
`src/shared/app-meta.test.ts`'s hardcoded expectation fail `npm test` in
Step 4 above — this was already caught once this session (the `0.7.1`
bump) and is not a new bug, just a second reminder to update the literal
strings in that one test file to match Step 3's new version before
re-running Step 4's `npm test`.

- [ ] **Step 6: Commit docs and version**

```bash
git add README.md HANDOFF.md CHANGELOG.md package.json src/shared/app-meta.test.ts
git commit -m "docs: document the mail rules engine and bump the version"
```

- [ ] **Step 7: Restart the live service and smoke-check it**

```bash
systemctl --user restart himalaya-web.service
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:47831/
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:47831/api/bootstrap
```

Expected: `200` for `/`, `401` for the unauthenticated `/api/bootstrap`
call.

- [ ] **Step 8: One reversible live check (get explicit operator confirmation first)**

This step writes a real `rules.json` entry for the operator's real
account, and lets a real rule act on real mail — do not run it without
asking first, per this project's "at most one reversible live check" rule.
Once confirmed:

1. Write one `dryRun: true` rule to `~/.config/himalaya-web/rules.json`
   for the operator's own watched account (condition on something that
   will actually match real mail, e.g. a known real sender), restart the
   service, send or wait for a matching message, and confirm via
   `journalctl --user -u himalaya-web.service -f` that a `[rules] dry-run
   match` line appears with no side effect.
2. Only if that looks right, and the operator wants to see a real rule
   fire: flip that one rule's `dryRun` to `false`, confirm the expected
   flag/move actually happened (e.g. via the app's own reader, or
   `himalaya envelope list`), then remove or disable the test rule
   afterward so it doesn't keep acting on the operator's mail beyond this
   check.

No other real mail is touched by this check.

## Self-Review

**1. Spec coverage:** `rules.json` schema + hand-edit v1 (Task 1), condition matching for from/subject/to with contains/equals (Task 1), the planner's flag-then-move ordering and first-move-wins-among-live-rules rule (Task 1), `setFlag` generalizing `setSeen` (Task 2), watcher integration + notification suppression (Task 3), `dryRun` safety valve (Task 3), `suggest-rule` AI task (Task 4), docs/version (Task 5). The spec's Non-goals (rules UI, regex, arbitrary tags, unwatched-account rules, AI auto-applying a rule, decoupling rules from `watch`) have no task — correct, they're intentionally out of scope. The spec's two "Open questions for plan review" (validating a move destination ahead of time; per-tick rule-evaluation performance) are not separately tasked — the first is answered by this plan's Error handling (Himalaya's own move command fails loudly and is caught/logged, matching the spec's leaning answer); the second has no evidence of being a real problem and needs no task.

**2. Placeholder scan:** No "TBD"/"TODO"/"implement later"/unshown code anywhere in this plan.

**3. Type consistency:** `Rule`/`RuleCondition`/`RuleAction`/`RuleOutcome` (Task 1) are used identically in Task 3's `watcher.ts` changes and its tests (`planActions(envelope, accountRules): RuleOutcome[]`, `outcome.flagsApplied`/`outcome.movedTo`/`outcome.dryRun` field names match exactly). `HimalayaService.setFlag(ref, flag, value)` (Task 2) matches the signature Task 3's `applyRules` calls it with. `AiTask`'s new `"suggest-rule"` value (Task 4) is added to both `ai.ts`'s type and `app.ts`'s `aiBodySchema` in the same task, so the route and the task type never drift.

**4. Review Focus:** All five items have an owning task and an explicit test: a malformed entry among valid ones → Task 1's "drops one invalid entry but keeps loading the rest of the file" test; two live rules both wanting to move to different mailboxes → Task 1's "only the first matching live rule's move action actually moves the message" test; a dry-run rule never touching real mail while the message still notifies → Task 3's "a dry-run rule never calls setFlag/move and the message still notifies normally" test; a rule action failure not stopping the rest of the tick → Task 3's "a rule action failure for one envelope does not stop the tick or other envelopes" test; a rule for an unwatched/different account never firing → Task 3's "a rule for a different account never fires" test (and Task 3's Global-Constraints-level behavior that `tick()` already drops unwatched accounts entirely, unchanged from Slice 2, so a `watch: false` account's rules are never even reached).
