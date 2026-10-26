# Himalaya Web Compose (Reply, Forward, New, Delete, Undo-Send)

**Date:** 2026-09-22

**Status:** Proposed after user review of the plan (Slice 1 of the mail-client
roadmap brainstormed the same day; see
`/home/dnames/.claude/plans/pasted-content-id-35ee-using-superpower-curried-reddy.md`)

## Goal

Turn Himalaya Web from a read-mostly client into one that can also write mail:
reply, reply-all, forward, compose new, delete (trash-first), and send, with a
confirmation dialog and a 10-second undo window before anything actually
leaves the machine. Drafts autosave locally and can be explicitly saved to the
account's IMAP Drafts folder. The MiniMax assistant can draft or polish text
but never sends. This is Slice 1 of a larger mail-client roadmap; later slices
(mail watcher/notifications, rules, tags, housekeeper cleanup, a full designer
pass) build on the compose primitives introduced here but are out of scope.

## Context and constraints

- The app is a single-user, loopback-only GUI for Himalaya v2.1.0, session-
  token gated on every `/api/*` route (`app.ts`'s `onRequest` hook).
- Himalaya remains the only mail backend, invoked as an argv array via
  `SpawnRunner` (`himalaya.ts`) — never through a shell, so no argument can
  inject another flag or command.
- Himalaya v2.1.0's `message compose|reply|forward` subcommands are the
  built-in flag composer: `--to/--cc/--bcc/--subject/--body|--body-file
  /--attach/--signature/--save <MAILBOX>/--send`. Without `--send` they print
  the composed MIME to stdout (used here as a preview); `--send` does not
  also save a Sent copy unless `--save` is given; `reply`/`forward` fill
  `Re:`/`Fwd:`, `References`, and quoting, but `forward` does not attach the
  original message's attachments — the server must add them explicitly.
- `message delete` is trash-first: it moves to the account's trash mailbox
  unless the message is already there, in which case it is permanently
  removed.
- Account configuration has no `[mailbox.alias]` map and mailbox names carry
  no machine-readable special-use flag, so Sent/Drafts/Trash must be guessed
  from real mailbox names already observed for these accounts (`Sent`,
  `Drafts`, `Trash`, and German/Gmail variants), with a per-account override
  and no fetch beyond the existing `mailbox list` call.
- MiniMax is optional, server-side only, OpenAI-compatible
  (`HIMALAYA_AI_*` env vars, no key in the repo); existing bounded-prompt,
  timeout, cooldown, and in-flight limits in `ai.ts` apply to any new task.
- Editor is **plain text only** for this slice (user decision); HTML
  composition is explicitly deferred.
- Drafts autosave in the browser (survive a reload) plus an explicit
  "Save to Drafts" action that writes one IMAP copy via `--save`; there is no
  read-back of IMAP drafts into the editor in this slice (user decision).
- Sending gets both a confirmation dialog and a 10-second undo countdown
  before the Himalaya process actually runs (user decision — "Beides").
- User-facing labels stay German; code, tests, and planning documents stay
  English. Automated tests use synthetic accounts/messages; the one live
  check sends and deletes mail only to/from the operator's own address.
- Never copy passwords, tokens, or keyring contents into source, tests,
  browser storage, or logs (`AGENTS.md`).

## User experience

### Reader actions

The reader panel (`main.tsx`'s `.reader-actions`) gains "Antworten", "Allen
antworten", "Weiterleiten", and "Löschen" buttons alongside the existing
move/seen/export/print/AI controls. The account list panel heading gains a
top-level "Neue Nachricht" button, enabled once at least one account is
selectable. "Löschen" needs no confirmation unless the message is already in
the resolved trash mailbox, in which case a native `confirm()` (matching the
existing move-to-trash-equivalent pattern already used for the browser print
popup elsewhere) asks before the permanent delete.

### Composer

Reply/reply-all/forward/new all open the same `composer.tsx` panel, prefilled
per action (reply/forward pull the current message's `To`/`Cc`/`Subject`
client-side from the already-loaded `MessageDetail`; the server independently
regenerates the real reply/forward headers and quoting through Himalaya when
sending, so the prefill is a preview only, not the source of truth). Fields:
From (account picker, defaults to the account owning the source message or
the currently selected account for new mail), To/Cc/Bcc (comma or Enter
separated chips), Subject, a plain-text `<textarea>` body, and an attachment
list (file input; for forward, a checkbox "Original-Anhänge mitsenden" that
re-downloads and re-attaches the source message's attachments server-side).
Actions: "KI-Entwurf einfügen" (only for reply, reuses the existing
`reply-draft` AI task), "Text verbessern" (new `polish-draft` task, sends the
user's own current body back for a polished version, never auto-applied
without an explicit "Übernehmen"), "In Entwürfe speichern", "Senden".

### Send confirmation and undo

"Senden" opens a confirmation dialog summarizing From/To/Cc/Bcc/Subject and
attachment file names, plus the server-rendered MIME preview (collapsed by
default, via `POST /api/compose/preview`, which never sends). Confirming
posts to `POST /api/compose/send`, which schedules the send 10 seconds out
and returns immediately; the composer closes and a dismissible banner shows a
countdown with "Rückgängig". Rückgängig calls `DELETE /api/outbox/:id`,
which cancels the pending job before it fires (no discovered API race is
possible here: the job only starts the Himalaya process after the delay
elapses, single-threaded). If the countdown elapses, the banner switches to
"Gesendet" or, on failure, the mapped German error with "Erneut versuchen".

## API and domain model

### New server modules

- **`src/server/compose.ts`** — pure functions, no I/O. `ComposeRequest` (zod
  schema) → validated, args-array builders for `compose`/`reply <id>
  -m <mailbox>`/`forward <id> -m <mailbox>`. Validation: every address is a
  bare `addr-spec` or `Name <addr-spec>` and rejects any `\r`/`\n` (header
  injection) in address, subject, or signature fields; ≤ 100 total
  recipients; subject ≤ 998 bytes (RFC 5322 line limit); plain-text body ≤
  1 MiB; ≤ 20 attachments, ≤ 25 MiB combined; attachment filenames pass
  through the existing `safeFilename` pattern from `himalaya.ts`.
- **`src/server/special-folders.ts`** — resolves Sent/Drafts/Trash per
  account from the already-fetched `listMailboxes()` result via a name
  heuristic (`Sent`, `Sent Items`, `Sent Messages`, `Gesendet`,
  `[Gmail]/Sent Mail`, and the `Drafts`/`Entwürfe`/`Trash`/`Papierkorb`
  equivalents), with a per-account override and a `sentCopy: "auto" | "none"
  | <mailbox id>` setting persisted in `~/.config/himalaya-web/accounts.json`
  (aliases and mailbox ids only, mirroring the existing browser-preference
  privacy rule; never committed, never sent to the browser beyond what the
  account-settings UI needs). Gmail-IMAP accounts default `sentCopy` to
  `"none"` since the provider copies sent mail server-side.
- **`src/server/outbox.ts`** — in-process delayed-send queue:
  `schedule(job): { id, sendAt }`, `cancel(id): boolean`, `list(): Job[]`. On
  firing, runs the Himalaya send (with `--save <Sent>` unless `sentCopy` is
  `"none"`), removes the job's temp directory, and keeps a terminal status
  (`sent` | `failed` with a mapped German message | `cancelled`) for 10
  minutes for the banner to poll. Jobs are in-memory only: they do not
  survive a service restart, which is acceptable because the whole point of
  the countdown is that nothing has been sent yet, and this is documented in
  the README limitations.

### `HimalayaService` additions (`himalaya.ts`)

- `composePreview(args): Promise<string>` — runs Himalaya **without**
  `--send`, returns the printed MIME text for the confirmation dialog.
- `composeSend(args, attachmentPaths): Promise<void>` — runs Himalaya with
  `--send` (and `--save` when applicable); attachment paths point at files
  materialized from the multipart upload into a per-job `0700` temp
  directory, removed by the caller (`outbox.ts`) after the run.
- `deleteMessage(ref): Promise<void>` — `message delete <id> --mailbox
  <mailbox>`, trash-first per Himalaya's own documented behavior.
- Forward-with-attachments reuses the existing `downloadAttachment` to
  materialize the source message's files before building the `--attach`
  list.

### Routes (`app.ts`)

All behind the existing loopback/session `onRequest` hook, all zod-validated:

- `POST /api/compose/preview` — `ComposeRequest` JSON → `{ mime: string }`.
- `POST /api/compose/send` — multipart (`@fastify/multipart@10.1.1`,
  fastify 5 compatible; size limits from the compose validation above
  enforced at the plugin level too, defense in depth) → creates an outbox
  job, returns `{ jobId, sendAt }`.
- `POST /api/compose/draft` — `ComposeRequest` JSON, `--save <Drafts>` only,
  no `--send` → `{ ok: true }`.
- `DELETE /api/outbox/:id` — cancels a pending job, `404` if already fired or
  unknown.
- `GET /api/outbox/:id` — status for the banner's post-countdown poll.
- `POST /api/message/delete` — `{ ref: MessageRef }` → trash-first delete.
- `GET /api/accounts/:account/special-folders` /
  `PUT /api/accounts/:account/special-folders` — read/set the per-account
  Sent/Drafts/Trash override and `sentCopy` mode.
- `POST /api/ai/assist` gains the `polish-draft` task in the existing
  `aiBodySchema` task enum; its input is the user's own current draft text
  (bounded, capped) rather than a stored `MessageRef`, so the schema and
  `ai.ts`'s `buildAiPrompt` need a second input shape alongside the existing
  message-based one.

## Client

- **`src/client/composer.tsx`** — the panel described above, driven by a
  small reducer (`ComposeState`) for fields/attachments/mode
  (reply/reply-all/forward/new) and a save-status enum for the autosave
  indicator.
- **`src/client/compose-draft.ts`** — debounced `localStorage` autosave, one
  entry per open composer keyed by a random compose id; stores only text
  fields and attachment *names* (not bytes — removed attachments are shown
  as "erneut anhängen" on restore, matching the browser's inability to
  persist `File` handles across reloads).
- Confirmation dialog and undo banner as separate small components reusing
  the existing `.banner`/dialog CSS patterns from the account manager and
  error banners.
- Reader and top-bar buttons wired into `main.tsx` per the User experience
  section; no change to existing read-only flows (list, search, AI
  summarize/reply-draft, export, print, move, seen).
- **Design input**: before writing `composer.tsx`'s markup, dispatch the
  `ui-designer` agent with the current theme tokens (`styles.css` `:root`
  variables) for the composer panel, confirmation dialog, and undo banner
  layouts; a full-app design pass stays out of scope for this slice (roadmap
  Slice 6).

## Architecture decisions

### Confirm-and-undo instead of either alone

A confirmation dialog alone cannot be undone after the click; a bare undo
countdown alone gives no chance to catch a wrong recipient before the
countdown even starts. The user explicitly chose both. The dialog is
free (no server work yet); the countdown reuses the same 10-second budget
Himalaya's own process spin-up needs anyway, so there is no perceptible cost
to correctness-minded users who never hit undo.

### Server-side outbox job instead of a client-side `setTimeout`

A client-side delay would send on tab close, navigation, or reload before the
countdown finishes, or fail to send if the tab is gone — neither matches "the
mail was scheduled to send in 10 seconds." A server-side in-memory queue
(`outbox.ts`) survives client navigation and only loses pending (not yet
fired) jobs on a service restart, which is an accepted, documented limitation
given this is a single-user local tool with no persistence layer elsewhere in
the app either.

### Guessed special folders with a per-account override, not a fetch-everything approach

Himalaya's `mailbox list` returns no special-use metadata for these 36
accounts (verified live), so a heuristic plus manual override is the only
option that does not require a new Himalaya feature or a second network
round-trip per account. The override is stored the same way the existing
account/mailbox favorites are: aliases and ids only, never credentials.

### Himalaya's built-in composer instead of hand-built MIME

The user chose plain text only for this slice specifically to avoid building
and validating MIME (`multipart/alternative`, threading headers, quoting)
in-house; Himalaya's `compose`/`reply`/`forward` subcommands already do this
correctly for text mail, matching the project's existing pattern of never
reimplementing what the installed CLI already does safely.

## Security and privacy

- Header-injection guard: any `\r`/`\n` in an address, subject, or signature
  field is rejected before Himalaya is ever invoked (the argv array already
  prevents shell injection; this closes the SMTP-header-injection class
  specifically).
- Every new route stays behind the existing session-token and
  loopback-origin checks; no new unauthenticated surface.
- Attachment uploads are never echoed back to the client and are removed
  from disk (temp dir, mode `0700`) as soon as a job resolves (sent, failed,
  or cancelled) or after a 1-hour sweep for stuck jobs.
- The AI assistant can draft or polish text but has no send/save/delete
  capability — `polish-draft`'s input is capped and never auto-applied
  without an explicit user action, matching the existing `summarize`/
  `reply-draft` boundary.
- Drafts autosaved to `localStorage` contain only what the user typed; no
  credentials, tokens, or keyring values ever reach browser storage.
- `security-review` runs on the implementation before the release commit,
  and the README's outstanding "re-run the security review when compose,
  send… is added" checklist item is closed out with the report's location.

## Testing

- **Unit**: `compose.test.ts` (arg builders; rejects `\r`/`\n` injection;
  enforces recipient/subject/body/attachment limits), `special-folders.test.ts`
  (heuristic matching, override precedence, Gmail `sentCopy` default),
  `outbox.test.ts` (fake timers: schedule → fire → sent; schedule → cancel;
  fire → Himalaya failure → mapped error), `himalaya.test.ts` additions for
  `composePreview`/`composeSend`/`deleteMessage` against a fake
  `CommandRunner`, `ai.test.ts` for `polish-draft`.
- **Routes**: `app.test.ts` additions against a fake `HimalayaService` —
  preview never calls send; send creates a job and returns before Himalaya
  runs; cancel before fire prevents the send; delete is trash-first;
  special-folders GET/PUT round-trip; session/validation failures return the
  expected codes.
- **Playwright** (synthetic `page.route` fixtures, no real Himalaya): reply
  prefills To/Subject; the confirmation dialog shows the right summary;
  "Rückgängig" cancels the outbox job and no send route is hit after; a
  draft survives a reload; "Löschen" moves a non-trash message without a
  confirm and asks for confirmation when already in trash.
- **One reversible live check**, run manually after the automated suite is
  green: send a plain-text message from account `andre` to its own address,
  confirm it arrives in `INBOX` and a copy lands in the resolved Sent
  mailbox, then delete both (trash). No other account or real mail is
  touched, matching `AGENTS.md`'s synthetic-data rule for automated tests
  and the one-reversible-live-check exception for manual verification.
- Full suite before the release commit: `npm run typecheck && npm test &&
  npm run build && npm run test:e2e && npm audit --omit=dev
  --audit-level=high`, then `systemctl --user restart himalaya-web.service`
  and the loopback smoke check (root 200, unauthenticated API 401,
  authorized bootstrap 200).

## Acceptance criteria

- A reader can reply, reply-all, forward, or compose new mail in plain text,
  with attachments, and send it, with a confirmation dialog and a working
  10-second undo before anything is actually sent.
- A draft autosaves locally across a reload and can be explicitly saved to
  the account's IMAP Drafts folder.
- Deleting a message follows Himalaya's trash-first behavior, with a confirm
  step only for an already-trashed message.
- No AI action can send, move, delete, or tag mail; `polish-draft` only
  returns text for the user to accept.
- No credentials, tokens, or message bytes beyond what the user typed reach
  browser storage or Git.
- The full automated suite and the one live reversible check both pass, and
  the live service is verified working after a restart.

## Out of scope

- HTML/rich-text composition (explicitly deferred by user decision).
- Reading an existing IMAP draft back into the editor for further editing.
- Mail watcher, notifications, Omarchy bar-widget quick actions, rules
  engine, tags, and the housekeeper cleanup jobs — later roadmap slices that
  build on the compose primitives introduced here but do not depend on this
  spec beyond reusing `special-folders.ts` and the outbox pattern.
- A full application-wide visual design pass (roadmap Slice 6).
