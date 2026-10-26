# Rules Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** View, add, edit, reorder, enable, dry-run and delete mail rules in the browser, with a read-only preview.

**Architecture:** A new `rules-store.ts` (strict schema, read/write that preserves invalid entries, pure preview) behind `GET/PUT /api/rules` and `POST /api/rules/preview`; a pure `rules-form.ts` and a "Regeln" dialog in the client.

**Tech Stack:** TypeScript (strict), Fastify + zod, React 19, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-03-himalaya-web-rules-editor-design.md`

## Global Constraints

- **Never edit or stage `src/server/rules.ts` / `src/server/rules.test.ts`** (another session's uncommitted work); import only their existing exports (`matchesCondition`, the `Rule` types).
- The editor never moves or flags real mail; tests use temp files (`HIMALAYA_WEB_RULES_PATH`) and fake services, and never touch the real `rules.json`.
- Invalid entries already in `rules.json` are preserved verbatim on every save; writes are atomic and serialized.
- New rules start enabled and in dry-run; going live asks `window.confirm`.
- Limits: 100 rules, id 1–64 chars and unique, condition value ≤ 200, mailbox ≤ 512, ≤ 8 actions per rule.
- UI text German; code, tests, docs, commits English. One commit for the slice via `git-ops`.

## Review Focus

- Hand-edited invalid entries survive a save byte for byte; a corrupt or missing file reads as no rules and the first save creates it — Task 1 tests.
- The preview and the editor never call `move`/`setFlag` — Task 2 test.
- Duplicate ids, empty actions, over-limit lists and unknown enum values are rejected before anything is written — Tasks 1 and 2 tests.
- Switching a rule to live (or adding a live rule) is confirmed, dismissing sends nothing — Task 4 Playwright test.

---

### Task 1: `rules-store.ts`

**Files:** Create `src/server/rules-store.ts`, `src/server/rules-store.test.ts`.

**Interfaces — Produces:** `rulesSchema` (zod array of strict rule objects: `id`, `account`, `enabled`, `dryRun` booleans required, `condition {field: "from"|"subject"|"to", match: "contains"|"equals", value}`, `actions` 1–8 of `{type:"flag", flag: "seen"|"answered"|"flagged"|"draft", value: boolean} | {type:"move", mailbox}`; refinements: unique ids, ≤ 100 rules), `readStoredRules(path?: string): Promise<{ rules: Rule[]; preservedInvalid: number }>`, `writeStoredRules(rules: readonly Rule[], path?: string): Promise<void>`, `previewRule(rule: Rule, envelopes: readonly Envelope[]): { checked: number; matchCount: number; samples: Array<{ subject: string; from: string }> }` (uses `matchesCondition` from `./rules.js`; samples ≤ 10, `from` = first From name or address). Default path: `process.env.HIMALAYA_WEB_RULES_PATH ?? ~/.config/himalaya-web/rules.json` (same rule as `rules.ts`).

- [ ] **Step 1: Failing tests (temp dir per test):** missing and corrupt (`{not json`, non-array) file → `{rules: [], preservedInvalid: 0}`; a mixed file (two valid, one with `dryRun: "true"`, one non-object) → the valid ones and `preservedInvalid: 2`; `writeStoredRules` keeps the two invalid entries verbatim after the new rules and the file parses as JSON; atomic (no `.tmp` left); the file mode of an existing file is kept and a new file gets `0o600`; 10 parallel writes leave a valid file whose content equals one of the writes; schema rejects duplicate ids, empty actions, 9 actions, unknown field/match/flag, `enabled` missing, a 201-char value, 101 rules, empty id and 65-char id; `previewRule`: counts matches case-insensitively with `contains`/`equals`, caps samples at 10, `checked` = envelopes length.
- [ ] **Step 2:** `npx vitest run src/server/rules-store.test.ts` → FAIL.
- [ ] **Step 3: Implement.** **Step 4:** the test file and `npm run typecheck` → PASS.

### Task 2: Routes

**Files:** Modify `src/server/app.ts`; test `src/server/app.test.ts`.

**Interfaces:** `AppOptions.rulesPath?: string` (default: the environment/default path). `GET /api/rules` → `{ rules, preservedInvalid }`; `PUT /api/rules` body `{ rules }` (validated with `rulesSchema`) → `{ ok: true, rules, preservedInvalid }`; `POST /api/rules/preview` body `{ rule }` (one rule validated with the schema's item) → `{ checked, matchCount, samples }` using `service.listMailboxes(account, {counts:false})` to find the INBOX (id or name equal to `inbox`, case-insensitive; none → `HimalayaError("…","FOLDER_NOT_FOUND",false)`) and `service.listEnvelopes({account, mailbox, page:1, pageSize:50})`.

- [ ] **Step 1: Failing tests:** round trip (PUT then GET) through a temp `rulesPath`; PUT with a duplicate id / empty actions / bad enum → 400 `INVALID_REQUEST` and the file unchanged; invalid entries preserved across a PUT; preview counts matches from fake envelopes, caps samples, never calls `move`/`setFlag` (spies), unknown INBOX → 404; session/loopback boundary (401/403, no service call, no file written) for all three routes; `app.test.ts`' `beforeEach` pins `HIMALAYA_WEB_RULES_PATH` to a non-existent temp path so no test reads the real file.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `npx vitest run src/server/app.test.ts` and typecheck → PASS.

### Task 3: `rules-form.ts`

**Files:** Create `src/client/rules-form.ts`, `src/client/rules-form.test.ts`.

**Interfaces — Produces:** `type RuleDraft` (the server `Rule` shape with `actions` flattened to `{ markSeen: boolean; markFlagged: boolean; moveTo: string }`), `newRuleDraft(account: string, existingIds: readonly string[]): RuleDraft` (id `Regel N` first free, enabled, `dryRun: true`, condition `from`/`contains`/`""`), `draftToRule(draft: RuleDraft): Rule`, `ruleToDraft(rule: Rule): RuleDraft` (other action combinations are kept in `extraActions` and written back unchanged), `validateDrafts(drafts: readonly RuleDraft[]): string[]` (German messages per problem: empty name, duplicate name, name > 64, empty condition value, > 200, no action chosen, move target empty when selected, more than 100 rules), `goesLive(before: readonly Rule[], after: readonly Rule[]): string[]` (names of rules that are enabled, not dry-run, have at least one action, and are new or were previously dry-run or disabled), `moveRule(drafts, index, direction): RuleDraft[]`.

- [ ] **Step 1: Failing tests** for each function incl. unknown extra actions surviving a round trip, duplicate detection ignoring case/space, `goesLive` for new live rule, dry-run → live, disabled → enabled live, unchanged live rule (not listed), dry-run rule (not listed); `moveRule` at the boundaries is a no-op.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** test file and typecheck → PASS.

### Task 4: Dialog and Playwright tests

**Files:** Modify `src/client/main.tsx`, `src/client/styles.css`; create `tests/e2e/rules-editor.spec.ts`.

**Interfaces — Consumes:** Tasks 2–3; `mailboxState`/`loadMailboxes`, `selectableAccounts`, `window.confirm`. **Produces:** a "Regeln" button in the top bar (`aria-haspopup="dialog"`) opening a dialog (`role="dialog"`, same pattern as the account manager) that loads `GET /api/rules`, shows the note "Regeln wirken nur auf neu eintreffende Mails." and, when `preservedInvalid > 0`, "N ungültige Einträge in rules.json bleiben unverändert."; rule cards with: name input, "Aktiv", "Probelauf" (with the hint "Probelauf: es wird nur protokolliert, nichts verändert."), account select, condition selects/inputs (Absender/Betreff/Empfänger; enthält/ist gleich), checkboxes "Als gelesen markieren" and "Markieren", "In Ordner verschieben" select (the account's folders; "—" for none), buttons "Nach oben", "Nach unten", "Löschen", "Vorschau" (shows "N von 50 Mails passen: …"); "Neue Regel" and "Speichern" (validation messages first, then `goesLive` → `window.confirm("Diese Regel(n) gelten ab jetzt für neu eintreffende Mails: <names>. Fortfahren?")`, then `PUT`; success notice "Regeln gespeichert."; the dialog stays open and reloads from the response).

- [ ] **Step 1: Failing Playwright tests (synthetic routes):** opening shows the existing rules and the invalid-entries note; "Neue Regel" adds a card in dry-run; editing and saving sends the expected `PUT` body (a dry-run rule needs no confirmation); switching "Probelauf" off asks for confirmation naming the rule, dismissing sends nothing, accepting sends `dryRun:false`; preview shows the result and the card state is unchanged; reorder changes the body order; delete removes the card; a validation problem (empty value) shows its message and sends nothing; a failed `PUT` (500) shows an error and keeps the dialog open.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `npx playwright test` (all), `npx vitest run`, typecheck, build → PASS (except the foreign `rules.test.ts` failures).

### Task 5: Release

- [ ] Bump to `0.16.0` (package.json, lock lines 3 and 9, `app-meta.test.ts`); `doc-ops` updates README/HANDOFF/AGENTS (state that rules act on arriving mail only, new rules start in dry-run, invalid entries are preserved, `rules.ts` untouched); full verification; independent diff review by `summarizer` and a fix pass; rebuild, restart `himalaya-web.service`, check `/api/watch/summary` `error: null`, correct commit-state wording, `git-ops` commits once (`feat: add a rules editor (0.16.0)`) with explicit paths including new files (never `rules.ts`/`rules.test.ts`) and pushes `main`.
