# Trust or Report a Sender Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator trust an address (no more false-positive warnings) or report a sender as phishing (message moved to Junk, address flagged for good).

**Architecture:** A small JSON-file store (`senders.ts`) feeds an optional sender status into `assessMessage` through `parseRawMessage`; the app and the watcher share one store; two routes change the state; the sender panel gets the buttons.

**Tech Stack:** TypeScript (strict), Fastify + zod, React 19, Vitest, Playwright, Himalaya CLI v2.1.

**Spec:** `docs/superpowers/specs/2026-10-02-himalaya-web-trust-report-sender-design.md`

## Global Constraints

- Local, loopback-only, session-protected; the store file holds addresses only, mode `0600`, atomic writes; tests never read or write the real `~/.config/himalaya-web/senders.json` (they set `HIMALAYA_WEB_SENDERS_PATH`) and never move a real message.
- Trust is by exact, case-insensitive address only. A trusted sender with DKIM or DMARC `fail` stays `high`; SPF alone is ignored.
- UI text German; code, tests, docs, commits English.
- One commit for the slice via `git-ops`; never stage `src/server/rules.ts` / `src/server/rules.test.ts` (another session's work).

## Review Focus

- A trusted address must not hide a message that fails DKIM/DMARC — Task 2 test.
- A failing move during a report must store nothing; no Junk folder means "remembered, not moved" — Task 3 tests.
- Concurrent status changes must not lose updates, and an invalid or oversized address must be rejected before anything is written — Task 1 tests.
- After a status change the watcher must not keep a stale verdict for that sender — Task 2 test.
- Double-clicking a status button must not send two requests — Task 4 Playwright test.

---

### Task 1: The sender store

**Files:** Create `src/server/senders.ts`, `src/server/senders.test.ts`.

**Interfaces — Produces:**
- `type SenderStatus = "trusted" | "blocked"`; `interface SenderLists { trusted: ReadonlySet<string>; blocked: ReadonlySet<string> }`; `interface SenderStore { lists(): Promise<SenderLists>; statusOf(email: string): Promise<SenderStatus | null>; setStatus(email: string, status: SenderStatus | null): Promise<void> }`.
- `createSenderStore(path?: string): SenderStore` — default path `process.env.HIMALAYA_WEB_SENDERS_PATH ?? ~/.config/himalaya-web/senders.json`.
- `normalizeEmail(email: string): string` — trim + lower-case; throws `HimalayaError("…", "INVALID_INPUT", false)` unless exactly one `@` with non-empty parts, no whitespace/control characters, ≤ 320 chars. `SENDER_LIST_CAP = 5000`.

- [ ] **Step 1: Failing tests (temp directory per test):** missing file → empty lists; `setStatus("Anna@X.test","trusted")` then `statusOf("anna@x.test")` is `"trusted"`; setting `"blocked"` removes it from trusted (mutual exclusion); `null` removes; persistence across a second `createSenderStore(samePath)`; file mode `0o600` and valid JSON `{trusted:[…],blocked:[…]}` with sorted unique entries; no `.tmp` file left behind; invalid addresses (`""`, `"a"`, `"a@"`, `"@b"`, `"a@b@c"`, `"a b@c.d"`, 321 chars) reject and the file is not created; adding the 5001st entry to a list rejects; 20 parallel `setStatus` calls on different addresses all persist; a corrupt file reads as empty lists and a later `setStatus` replaces it.
- [ ] **Step 2:** `npx vitest run src/server/senders.test.ts` → FAIL.
- [ ] **Step 3: Implement** (read lazily once into memory; writes chained on one promise; write `<path>.tmp` with mode `0o600` then `rename`; create the directory with `mkdir -p`).
- [ ] **Step 4:** the test file → PASS.

### Task 2: Detection, `parseRawMessage`, watcher and app wiring

**Files:** Modify `src/server/phishing.ts`, `src/server/mime.ts`, `src/shared/types.ts`, `src/server/watcher.ts`, `src/server/app.ts`; tests `phishing.test.ts`, `mime.test.ts`, `watcher.test.ts`, `app.test.ts` and the `SenderInfo` literals in other tests.

**Interfaces:**
- Consumes: Task 1 `SenderLists`, `SenderStore`.
- Produces: `AssessInput.senderStatus?: SenderStatus`; `SenderInfo.trust: SenderStatus | null` (shared type; every test literal gains `trust: null`); `parseRawMessage(raw, attachments, ref, options?: { senders?: SenderLists }): Promise<MessageDetail>`; `createWatcher` dep `senders?: SenderStore` and `Watcher.forgetSender(email: string): void`; `createApp` builds one store (`options.sendersPath` optional, else the default) and routes every `parseRawMessage` call through a local helper that passes `await store.lists()`.

Behavior of `assessMessage`: `blocked` → `{ level: "high", score: 100, reasons: ["Du hast diesen Absender als Phishing gemeldet."] }`; `trusted` with neither `auth.dkim` nor `auth.dmarc` equal to `"fail"` → `{ level: "none", score: 0, reasons: [] }`; `trusted` with such a failure → the normal verdict raised to at least `high` plus the reason "Vertrauter Absender, aber die Absenderprüfung ist fehlgeschlagen (mögliche Fälschung)."

- [ ] **Step 1: Failing tests:** `assessMessage` for the three cases (SPF `fail` alone with trust → `none`); `parseRawMessage` with `{senders}` for a trusted/blocked first From address (case-insensitive) sets `sender.trust` and the verdict, without options `trust` is `null`; watcher with a store whose list blocks the sender: a fresh mail notifies "⚠ Phishing-Verdacht" and `forgetSender(email)` makes `riskFor` return `undefined` (the map stores `{level, email}`); `createApp` default store path is overridden by the environment variable in `app.test.ts`' `beforeEach`/`afterEach` (set it to a non-existent temp path there and in `app.raw.test.ts`).
- [ ] **Step 2:** run the four test files → FAIL.
- [ ] **Step 3: Implement** the changes; update every `SenderInfo` literal in tests.
- [ ] **Step 4:** `npx vitest run` and `npm run typecheck` → PASS (the 3 `rules.test.ts` logging failures are another session's).

### Task 3: Routes

**Files:** Modify `src/server/app.ts`, `src/server/search-scope.ts` (add `findJunkMailbox`); tests `app.test.ts`, `search-scope.test.ts`.

**Interfaces:**
- Consumes: Task 1/2.
- Produces: `findJunkMailbox(mailboxes: readonly Mailbox[]): Mailbox | null` — the first mailbox whose id or name (last `/`/`.` segment, case-insensitive) is `junk`, `spam`, `junk e-mail` or `junk email`; never the trash. `POST /api/senders/status` body `{ email, status: "trusted" | "blocked" | null }` → `{ ok: true }`, calls `watcher.forgetSender(email)`; invalid address → `400 INVALID_REQUEST`. `POST /api/message/report` body `{ ref }` → `{ ok: true, moved: boolean, mailbox: string | null }` as in the spec (read raw + parse for the address; `listMailboxes(account, {counts:false})`; `move` unless the message already sits in the Junk folder; then `setStatus(address,"blocked")` and `forgetSender`).

- [ ] **Step 1: Failing tests:** `findJunkMailbox` picks `Junk`, `[Google Mail]/Spam`, `INBOX.Junk`, ignores `Trash`/`Papierkorb`, returns `null` when absent; status route sets/unsets, rejects bad addresses/body, enforces the session/loopback boundary, calls `forgetSender`; report: with a Junk folder → `move(ref, junkId)` is called before the address is stored and the response is `{ok:true,moved:true,mailbox:junkId}`; message already in Junk → no move, `moved:false`; no Junk folder → stored, `moved:false`, `mailbox:null`; failing `move` → error response and the address is NOT stored; unparsable sender → `400`; session boundary.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `npx vitest run src/server/app.test.ts src/server/search-scope.test.ts` and typecheck → PASS.

### Task 4: Client

**Files:** Modify `src/client/sender-panel.tsx`, `src/client/sender-panel.test.ts`, `src/client/message-copy.ts` (+test), `src/client/main.tsx`, `src/client/styles.css`; create `tests/e2e/sender-trust.spec.ts`.

**Interfaces:** `SenderDetails` gains optional props `onSetStatus?: (status: "trusted" | "blocked" | null) => void`, `onReport?: () => void`, `busy?: boolean`; with `onSetStatus` it renders a row "Einstufung": the status text ("Vertrauenswürdig" / "Als Phishing gemeldet" / "Nicht eingestuft") and the buttons "Absender vertrauen" or "Vertrauen widerrufen", "Als Phishing melden" or "Meldung widerrufen" (disabled while `busy`). `formatMessageText(detail, true)` adds `Einstufung: Vertrauenswürdig` / `Einstufung: Als Phishing gemeldet` when `detail.sender.trust` is set. `main.tsx`: `setSenderStatus` (POST `/api/senders/status`, notice, reload the message), `reportSender` (`window.confirm("Mail in Junk verschieben und den Absender als Phishing melden?")`, POST `/api/message/report`, notices from the spec, then clear the reader and reload the list because the message moved when `moved`), a `busy` flag guarding double clicks.

- [ ] **Step 1: Failing tests:** panel markup for the three states and `busy`; `formatMessageText` lines; Playwright (synthetic routes incl. the two POST routes): trust sends `{email:"anna@evil.example",status:"trusted"}` and the reloaded detail shows "Vertrauenswürdig"; revoke sends `null`; report with an accepted dialog posts `{ref}` and shows the notice, a dismissed dialog posts nothing; two fast clicks on a status button send one request.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `npx vitest run`, `npx playwright test`, typecheck, build → PASS (except the foreign failures).

### Task 5: Release

- [ ] Bump to `0.14.0` (package.json, lock lines 3 and 9, `app-meta.test.ts`); `doc-ops` updates README/HANDOFF/AGENTS (no commit, no board items); full verification; independent diff review by the `summarizer` wrapper and a fix pass for Critical/Important findings; then rebuild, restart `himalaya-web.service`, check `/api/watch/summary` `error: null`, correct commit-state wording in the docs, and have `git-ops` commit once (`feat: let the operator trust or report a sender (0.14.0)`) with explicit paths including new files and push `main`.
