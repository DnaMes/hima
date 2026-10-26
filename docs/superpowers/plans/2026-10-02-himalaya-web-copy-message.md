# Copy a Message Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator copy a message out of the reader as plain text, as raw source/headers, and as a real copy into another folder or account.

**Architecture:** Two new `HimalayaService` methods (`copy`, `addRaw`) behind `POST /api/message/copy` (same account → `message copy`; other account → read-raw + `message add` via a temp file) and `GET /api/message/raw`; text/header copying is client-side; a pure `message-copy.ts` formats the clipboard text and the reader gets a "Kopieren" group.

**Tech Stack:** TypeScript (strict), Fastify + zod, React 19, Vitest, Playwright, Himalaya CLI v2.1.

**Spec:** `docs/superpowers/specs/2026-10-02-himalaya-web-copy-message-design.md`

## Global Constraints

- Loopback-only, session-protected; mail content never lands in the project, logs or browser storage; raw mail goes to the CLI only through a temp file (`0600` file in a fresh `0700` directory, removed in `finally`), never as a command-line argument.
- UI text German; code, tests, docs, commits English. Automated tests use synthetic data and never touch a real mailbox; the real-CLI test uses a synthetic Maildir in a temp directory.
- Verified CLI shapes: `message copy --from <A> --to <B> <id>` (id last, same shape as `move`); `message add --mailbox <M> [-f <flag>…] -- <file>` (`-f` is variadic, so the file path comes after `--`).
- Copy into the message's own account+mailbox is rejected; cross-account copies are added as `seen`; no undo.
- Confirmation uses `window.confirm`, like move and delete.
- One commit for the slice via `git-ops` after the operator's go; never stage `src/server/rules.ts` / `src/server/rules.test.ts` (another session's work).

## Review Focus

- Copy into the same account and mailbox is rejected with `400` before any provider work — Task 2 test.
- The temp file is removed on every path, including a failing CLI call, and the raw content never appears in the command arguments — Task 1 tests.
- Account/mailbox values with an empty string or NUL are rejected before the CLI is spawned — Task 1 test.
- A second click while a copy runs sends no second request, and cancelling the confirmation sends nothing — Task 4 Playwright tests.
- `rawHeaderBlock` copes with LF-only line endings and with a message that has no body separator — Task 3 tests.

---

### Task 1: `copy` and `addRaw` on the service, with a real-CLI check

**Files:**
- Modify: `src/server/himalaya.ts`
- Test: `src/server/himalaya.test.ts`, create `src/server/himalaya.maildir.test.ts`

**Interfaces:**
- Produces on `HimalayaService` and `HimalayaCli` (`himalaya.ts`):
  - `copy(ref: MessageRef, destinationMailbox: string): Promise<void>` — `--account <ref.account> message copy --from <ref.mailbox> --to <destinationMailbox> <ref.message>`; validates with `messageRef` and `validateRefPart(destinationMailbox, "destination mailbox")`.
  - `addRaw(account: string, mailbox: string, raw: Buffer, flags?: readonly ("seen" | "answered" | "flagged")[]): Promise<void>` — validates `account` and `mailbox` with `validateRefPart`; writes `raw` to `<mkdtemp>/message.eml` (file mode `0o600`), runs `--account <account> message add --mailbox <mailbox> [-f <flag>…] -- <file>` (the `-f` group only when `flags` is non-empty), removes the directory in `finally`.

- [ ] **Step 1: Write the failing tests** in `himalaya.test.ts` (reuse `RecordingRunner`; add a subclass whose `run` reads the last argument as a path and records its mode, bytes and the joined args before delegating):
  - `copy({account:"andre",mailbox:"INBOX",message:"7"}, "Archive")` → `runner.calls[0]` equals `["--account","andre","message","copy","--from","INBOX","--to","Archive","7"]`.
  - `copy` with destination `""` or `"a\u0000b"` rejects and the runner is never called.
  - `addRaw("beta","Archive",raw,["seen"])` → args equal `["--account","beta","message","add","--mailbox","Archive","-f","seen","--", <path>]`; during the call the file has mode `0o600` and exactly the raw bytes; afterwards the path does not exist; the joined args do not contain a marker string placed in the raw body.
  - `addRaw` without flags has no `-f`; with `["seen","flagged"]` the args contain `"-f","seen","flagged","--"`.
  - `addRaw` with a failing runner response (`code: 1`) rejects and the temp directory is gone; empty `account` or `mailbox` rejects before spawning.
- [ ] **Step 2:** Create `himalaya.maildir.test.ts` (`it.skipIf(!hasHimalaya)`, where `hasHimalaya` is `spawnSync("himalaya", ["--version"]).status === 0`): in a temp dir build a config with two Maildir accounts (`[accounts.acc-a]` / `[accounts.acc-b]`, `maildir.root = "<dir>/a"` / `".../b"`), create `cur/new/tmp` for each root and for `a/Archive`, write an executable wrapper `#!/bin/sh\nexec himalaya -c "<config>" "$@"` and use `new HimalayaCli(new SpawnRunner(<wrapper>))`. Using `listMailboxes` ids (absolute paths) assert: `addRaw("acc-a", <a root id>, raw, ["seen"])` → `listEnvelopes` shows one envelope with the subject and a `\Seen` flag; `copy(ref, <Archive id>)` → Archive has one envelope with `\Seen`, the source still has one; `readRaw(ref)` then `addRaw("acc-b", <b root id>, raw, ["seen"])` → account b shows the subject. Clean the temp dir in `finally`.
- [ ] **Step 3:** Run `npx vitest run src/server/himalaya.test.ts src/server/himalaya.maildir.test.ts` → FAIL (methods missing).
- [ ] **Step 4: Implement** `copy` and `addRaw` in `HimalayaCli` and add them to the `HimalayaService` interface (`mkdtemp`/`writeFile`/`rm` from `node:fs/promises`, `tmpdir`/`join`).
- [ ] **Step 5:** Run the two files again → PASS (the Maildir test runs because `himalaya` is installed; say so in the output you read).

### Task 2: Routes `POST /api/message/copy` and `GET /api/message/raw`

**Files:**
- Modify: `src/server/app.ts`, `src/server/export.ts` (`exportFilename`), the `HimalayaService` literals in `src/server/app.test.ts`
- Test: `src/server/app.test.ts`, `src/server/export.test.ts`

**Interfaces:**
- Consumes: Task 1 `copy`/`addRaw`; existing `refQuerySchema`, `messageRef`, `parseRawMessage`, `withRisk` is not needed.
- Produces:
  - `exportFilename(detail: MessageDetail, extension: "md" | "eml" = "md"): string`.
  - `POST /api/message/copy`, body `{ ref: {account,mailbox,message}, destination: {account: string (1..512), mailbox: string (1..512)} }`; refinement: not (same account and same mailbox) → `400 INVALID_REQUEST`. Same account → `service.copy(ref, destination.mailbox)`, response `{ ok: true, mode: "copy" }`; otherwise `service.readRaw(ref)` then `service.addRaw(destination.account, destination.mailbox, raw, ["seen"])`, response `{ ok: true, mode: "append" }`. `Cache-Control: no-store`.
  - `GET /api/message/raw?account&mailbox&message` → the raw bytes, `Content-Type: message/rfc822`, `Content-Disposition: attachment; filename*=UTF-8''<exportFilename(detail,"eml")>`, `Cache-Control: no-store`.

- [ ] **Step 1: Write the failing tests:** (copy route) same account → `copy` called once with `(ref, "Archive")`, `addRaw`/`readRaw` not called, `{ok:true,mode:"copy"}`; other account → `readRaw(ref)` then `addRaw("beta","Archive",<raw>,["seen"])`, `mode:"append"`; same account and mailbox → 400 `INVALID_REQUEST` and no service call; empty destination mailbox, missing `destination`, extra account missing → 400; session/loopback rejection like the unified-inbox route tests (`401`/`403`, no service call); a service failure surfaces through the existing error handler and does not report success. (raw route) response bytes equal the fake `readRaw` output byte for byte, `content-type` starts with `message/rfc822`, `content-disposition` contains `.eml`, 401 without the session. In `export.test.ts`: `exportFilename(detail, "eml")` ends with `.eml` and the default still ends with `.md`.
- [ ] **Step 2:** Run `npx vitest run src/server/app.test.ts src/server/export.test.ts` → FAIL.
- [ ] **Step 3: Implement** the routes and the `exportFilename` parameter; add `copy: async () => undefined` and `addRaw: async () => undefined` to every full `HimalayaService` literal in `app.test.ts` (`fakeService` and the inline ones).
- [ ] **Step 4:** Run the two files, then `npm run typecheck` and `npx vitest run` (whole suite; the 3 `rules.test.ts` logging failures are another session's) → PASS.

### Task 3: Pure client helpers

**Files:**
- Create: `src/client/message-copy.ts`, `src/client/message-copy.test.ts`
- Modify: `src/client/message-actions.ts`, `src/client/message-actions.test.ts`

**Interfaces:**
- Produces:
  - `formatMessageText(detail: MessageDetail, withSender: boolean): string` — lines `Von: <name> <email>` (just the email when no name), `An: …` (comma-joined), `Datum: <envelope.date as received or "(unbekannt)">`, `Betreff: <subject or "(ohne Betreff)">`, blank line, body (`detail.text.trim()` or `(Kein Text)`). With `withSender` a block `Absenderprüfung` is inserted before the body: `Bewertung: Warnung (<score>)` / `Verdächtig (<score>)` / `Unauffällig`, one `- <reason>` line per reason, `Reply-To:`, `Return-Path:`, `Message-ID-Domain:` (only when present), `SPF: <v> | DKIM: <v> | DMARC: <v>` (`–` for null) or `Keine Authentication-Results vorhanden`, and `Übertragungsweg:` with `<n>. <from> [<ip>] → <by>` per hop.
  - `rawHeaderBlock(raw: string): string` — everything before the first blank line (`\r\n\r\n` or `\n\n`), CRLF normalized to LF; the whole text when there is no blank line.
  - `messageRawUrl(ref: MessageRef): string` in `message-actions.ts` → `/api/message/raw?account=…&mailbox=…&message=…` (same encoding as `messageExportUrl`, without `format`).

- [ ] **Step 1: Write the failing tests:** `formatMessageText` for a small synthetic detail — exact full string for `withSender: false`; with `withSender: true` contains `Absenderprüfung`, `Bewertung: Warnung (70)` for a `high` risk of score 70, `- <reason>`, `SPF: pass | DKIM: none | DMARC: fail`, `1. srv1.example [203.0.113.5] → mx.example`; a detail with `sender.auth === null` shows `Keine Authentication-Results vorhanden`; empty subject/text/date fallbacks. `rawHeaderBlock`: CRLF message, LF-only message, message without a blank line (returns all), header-only message with trailing blank line. `messageRawUrl({account:"andre",mailbox:"INBOX",message:"7"})` equals `/api/message/raw?account=andre&mailbox=INBOX&message=7`.
- [ ] **Step 2:** Run `npx vitest run src/client/message-copy.test.ts src/client/message-actions.test.ts` → FAIL.
- [ ] **Step 3: Implement** the three functions (pure, no React).
- [ ] **Step 4:** Run the two files and `npm run typecheck` → PASS.

### Task 4: Reader UI and Playwright tests

**Files:**
- Modify: `src/client/main.tsx`, `src/client/styles.css`
- Test: create `tests/e2e/copy-message.spec.ts`

**Interfaces:**
- Consumes: Task 3 helpers; Task 2 routes; existing `mailboxState`/`loadMailboxes`, `setNotice`/`setError`, `selectableAccounts`, `window.confirm` pattern from `moveMessage`.
- Produces: in the reader action bar a group "Kopieren" with buttons "Text kopieren" and "Mit Prüfung kopieren" (clipboard via `navigator.clipboard.writeText`, notice "In die Zwischenablage kopiert.", error "Die Zwischenablage ist nicht verfügbar."), "Header kopieren" (fetch `messageRawUrl` with the session header, `rawHeaderBlock`, notice "Header kopiert."), "Quelltext (.eml)" (blob download named `message-<id>.eml`), and a form "Kopieren nach …": `<select aria-label="Zielkonto">` (selectable accounts, default the message's account; changing it calls `loadMailboxes`), `<select aria-label="Zielordner">` (the account's mailboxes, excluding the message's own account+mailbox), button "Kopie anlegen" (disabled while a copy runs or no folder is chosen) → `window.confirm("Kopie in „<account> / <folder name>“ anlegen?")` → `POST /api/message/copy` → notice "Kopie angelegt." (reader stays open, list not reloaded).

- [ ] **Step 1: Write the failing Playwright tests** (synthetic routes for bootstrap alpha/beta, mailboxes with `INBOX` and `Archive`, messages, `/api/message` with a `sender` block, `/api/message/seen`, `/api/message/raw`, `/api/message/copy`; `test.use({ permissions: ["clipboard-read", "clipboard-write"] })`; follow `tests/e2e/phishing-warning.spec.ts`): "Text kopieren" puts `Betreff: <subject>` on the clipboard and shows the notice; "Mit Prüfung kopieren" contains `Absenderprüfung` and `SPF: pass`; "Header kopieren" with a raw route returning `From: a@x\r\nSubject: s\r\n\r\nbody` leaves exactly `From: a@x\nSubject: s` on the clipboard; "Quelltext (.eml)" triggers a download named `message-7.eml`; the folder copy to `beta` / `Archive` with an accepted dialog posts `{ ref: {account:"alpha",mailbox:"INBOX",message:"7"}, destination: {account:"beta",mailbox:"Archive"} }` and shows "Kopie angelegt."; a dismissed dialog posts nothing; the "Zielordner" list for the message's own account does not offer `INBOX`; a second click while the first request is pending (route held open) results in exactly one request.
- [ ] **Step 2:** `npx playwright test tests/e2e/copy-message.spec.ts` → FAIL.
- [ ] **Step 3: Implement** the handlers, the group and the form; keep `main.tsx` additions small by calling the Task 3 helpers.
- [ ] **Step 4:** Run the new spec, `npx playwright test` (all), `npm run typecheck` and `npm test` → PASS (except the foreign `rules.test.ts` failures).

### Task 5: Release

**Files:**
- Modify: `package.json`, `package-lock.json` (version `0.12.0`), `src/shared/app-meta.test.ts`, `README.md`, `HANDOFF.md`, `AGENTS.md` (version block)

- [ ] **Step 1:** Bump the version to `0.12.0` (package.json, lock lines 3 and 9, `app-meta.test.ts`).
- [ ] **Step 2:** Delegate README/HANDOFF/AGENTS upkeep to `doc-ops` (no commit, no board items, no vault, never paste command output); HANDOFF states: copy actions shipped, IMAP `UID COPY`/`APPEND` not verified live, manual check with a throwaway message recommended, 5e not started.
- [ ] **Step 3:** `npm run typecheck && npm test && npx playwright test && npm run build` → green except the 3 foreign `rules.test.ts` logging tests; read the Maildir test line in the output to confirm it ran, not skipped.
- [ ] **Step 4:** After the operator's go: `npm run build`, `systemctl --user restart himalaya-web.service`, check HTTP 200 and `/api/watch/summary` `error: null`, fix any stale "not committed / not restarted" wording in HANDOFF, then `git-ops` commits once (`feat: add message copy actions (0.12.0)`) with explicit paths including the new files and pushes `main`. Do not copy any real message in automated or live checks; propose one manual throwaway copy to the operator.
