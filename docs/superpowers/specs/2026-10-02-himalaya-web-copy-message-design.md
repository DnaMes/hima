# Himalaya Web Slice 5d: Copy a Message

**Date:** 2026-10-02

**Status:** Brainstormed with the operator in-session. Decisions marked
*(operator)* were chosen by the operator; the rest are design judgment to
correct on review.

## Goal

Get a message out of the reader in the forms the operator needs: as plain text
for pasting into an AI chat or ticket, as raw source for phishing analysis, and
as a real copy in another folder or another account. Only the last one writes
to a real mailbox.

## Context and constraints

- Local, loopback-only, session-protected; mail content is never stored in the
  project, logs or browser storage. Automated tests use synthetic data and never
  touch a real mailbox.
- **Verified against the installed Himalaya CLI (v2.1) on a synthetic Maildir
  config under `/tmp` (no real mail):**
  - `message add --mailbox <M> -f seen -- <file>` appends a raw RFC 5322 file and
    sets the flag; the file path must come after `--` because `-f` takes a
    variadic list. `message add` also accepts stdin or an inline string.
  - `message copy --from <A> --to <B> <id>` copies within one account; the
    source stays, flags are kept, the new message gets a new id and the CLI does
    not print it (so an undo is impossible).
  - A raw message read with `message read --raw` and appended with `message add`
    into another account arrives intact (subject, headers, flags).
  - Cross-account copy has no CLI command of its own: it is read-raw plus add.
- **Not verified live:** IMAP `UID COPY` / `APPEND` on the real accounts (only the
  Maildir backend was probed; argument shapes are identical). `APPEND` stamps the
  internal arrival date with "now"; the app lists by the `Date:` header, so lists
  are unaffected.
- Existing building blocks: `HimalayaService.readRaw`/`move`, `messageRef`,
  `parseRawMessage`, `exportFilename`, the reader action bar and the
  `window.confirm` pattern used by move and delete (`src/client/main.tsx`),
  `listMailboxes` and `mailboxState` for folder lists.

## Decisions

| Topic | Decision |
|---|---|
| Scope *(operator)* | All four: text to clipboard, raw source/headers, copy to another folder, copy to another account. |
| Architecture | A dedicated `POST /api/message/copy` plus two `HimalayaService` methods; same-account uses `message copy`, cross-account uses read-raw plus `message add`. Rejected: extending `move` with "keep original" (mixes two meanings of one route). |
| Confirmation | Native `window.confirm` before every copy, like move and delete. No undo (the CLI does not return the new id). |
| Flags | Same account: kept by the server's COPY. Cross-account: the copy is added as `seen` so it does not create unread noise. |
| Duplicates | Copying into the message's own folder is rejected; copying twice creates two copies (the button is disabled while a request runs). |
| Raw handoff | The raw message goes to the CLI through a temp file (`0600` in a fresh `0700` directory, removed in `finally`), never as a command-line argument (visible to other processes, size-limited). |
| Clipboard | Browser `navigator.clipboard.writeText` (loopback counts as a secure context); failure shows a German error. |

## Architecture

### Server

- `HimalayaService.copy(ref: MessageRef, destinationMailbox: string): Promise<void>`
  runs `message copy --from <ref.mailbox> --to <destination> <ref.message>` in the
  ref's account (same argument shape as `move`).
- `HimalayaService.addRaw(account: string, mailbox: string, raw: Buffer, flags?: readonly ("seen" | "answered" | "flagged")[]): Promise<void>`
  writes `raw` to a temp file and runs
  `--account <account> message add --mailbox <mailbox> [-f <flag>…] -- <file>`.
- `POST /api/message/copy`, body (zod): `{ ref: { account, mailbox, message }, destination: { account, mailbox } }`.
  Same account and mailbox → `400 INVALID_REQUEST`. Same account → `copy`.
  Different account → `readRaw(ref)` then `addRaw(destination.account, destination.mailbox, raw, ["seen"])`.
  Response `{ ok: true, mode: "copy" | "append" }`.
- `GET /api/message/raw?account&mailbox&message` returns the original bytes as
  `message/rfc822` with `Content-Disposition: attachment` and a `.eml` filename
  (`exportFilename(detail, "eml")`: the existing helper gains an optional
  extension, default `md`). `Cache-Control: no-store`.
- All routes sit behind the existing loopback/session hooks.

### Client

- `src/client/message-copy.ts` (pure):
  `formatMessageText(detail: MessageDetail, withSender: boolean): string` builds
  `Von`, `An`, `Datum` (ISO as received), `Betreff`, a blank line and the text
  body; with `withSender` it adds an "Absenderprüfung" block (Reply-To,
  Return-Path, SPF/DKIM/DMARC, the received hops, the risk level and its
  reasons). `rawHeaderBlock(raw: string): string` returns everything before the
  first blank line.
- Reader action bar, new group "Kopieren": "Text kopieren", "Mit Prüfung
  kopieren", "Header kopieren" (fetches `/api/message/raw`, cuts the header block),
  "Quelltext (.eml)" (download), and a form "Kopieren nach …" with an account
  select (selectable accounts), a folder select (from `mailboxState`, loaded on
  account change) and "Kopie anlegen". Success notices: "In die Zwischenablage
  kopiert.", "Kopie angelegt." The reader stays open; the list is not reloaded.

## Error handling

- Bad body, unknown fields, same source and destination → `400 INVALID_REQUEST`.
- A failing CLI call surfaces through the existing provider-error mapping; the
  temp file is removed in every case.
- A failed copy never changes the source message.
- Clipboard or download failure shows a German error in the existing error area.

## Testing

- Unit: `copy`/`addRaw` argument shapes with the recording runner (variadic `-f`
  ended by `--`, file path last); the temp file exists with mode `0600` during the
  call, holds exactly the raw bytes, and is gone afterwards, also on failure;
  `formatMessageText` (both variants, missing fields) and `rawHeaderBlock`.
- Real-CLI integration (skipped when `himalaya` is not installed): a wrapper
  script injects `-c` for a synthetic Maildir config in a temp directory
  (`HIMALAYA_BIN`), then `copy` within an account and `addRaw` across two
  accounts are run through `HimalayaCli`; ids, flags and headers are asserted.
  This guards the argument-order class of bug that only the real CLI exposed in
  Slice 5c.
- Server routes (fake service): same-account → `copy`; cross-account →
  `readRaw` + `addRaw(["seen"])`; same folder rejected; validation 400s; raw route
  headers and bytes; session/loopback rejection.
- Playwright (synthetic API, clipboard permission granted): the four copy buttons,
  the confirmation dialog for the folder copy, the request bodies.
- Manual, after release and only with the operator: one copy of a throwaway
  message through a real IMAP account to confirm `UID COPY`/`APPEND`.

## Risks

- IMAP behavior is unverified live; Gmail label semantics (a copy into a label)
  and servers that reject `APPEND` of large messages may differ.
- Raw messages are held in memory (the runner caps output at 50 MiB) and briefly
  on disk in the temp file.
- No undo and no duplicate detection beyond the same-folder check.

## Out of scope

Bulk or multi-select copy, undo, preserving answered/flagged across accounts,
attachments as separate files, copy of drafts, server-side persistence of the
destination choice.
