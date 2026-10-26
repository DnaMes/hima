# Himalaya Web Slice 5e-2: Trust or Report a Sender

**Date:** 2026-10-02

**Status:** Brainstormed with the operator in-session. Decisions marked
*(operator)* were chosen by the operator; the rest are design judgment to
correct on review.

## Goal

Let the operator tell the phishing detection what it got wrong, in both
directions: stop warning about a legitimate sender (false positive such as a
tracking-link newsletter), and treat a sender as phishing for good after
reporting one of its mails.

## Context and constraints

- Local, loopback-only, session-protected. The new state is a small local file;
  it holds mail addresses only (no secrets, no mail content).
- Detection today: `assessMessage` (`src/server/phishing.ts`) is pure and is fed
  by `parseRawMessage` (`src/server/mime.ts`), which is called from four places
  in `src/server/app.ts` and from the watcher. `SenderInfo.risk` carries the
  verdict to the client; the watcher keeps fresh-mail verdicts in an in-memory
  map for the list badge.
- Config files already follow one pattern: a JSON file under
  `~/.config/himalaya-web/` with an environment override for tests
  (`rules.json`, `accounts.json`).
- A moved message is the only mailbox mutation in this slice (reuses
  `HimalayaService.move`); automated tests never touch a real mailbox.

## Decisions

| Topic | Decision |
|---|---|
| Trust scope *(operator)* | The exact address only. No domain trust, so shared domains (gmail.com, outlook.com) are never trusted wholesale. |
| Report action *(operator)* | Move the message to the account's Junk folder and remember the address as reported; future mail from it is flagged immediately. Revocable. |
| Trusted but failing authentication | Trust does not hide a message whose DKIM or DMARC result is `fail` (possible forgery of a trusted address): it stays `high` with an explicit reason. SPF alone is ignored because forwarding often breaks it. |
| Matching | Exact, case-insensitive match of the first From address. |
| Exclusivity | An address is in at most one list; setting one status removes the other. |
| Storage | `~/.config/himalaya-web/senders.json` (`HIMALAYA_WEB_SENDERS_PATH` overrides), mode `0600`, atomic write (temp file + rename), serialized writes. |
| Corrupt file | Treated as empty with a note on stderr; the next write replaces it (the app is the only writer). |
| Management UI | None beyond the per-message panel (revoke there). A list view is out of scope. |

## Architecture

### Store (`src/server/senders.ts`, new)

```ts
type SenderStatus = "trusted" | "blocked";
interface SenderLists { trusted: ReadonlySet<string>; blocked: ReadonlySet<string> }
interface SenderStore {
  lists(): Promise<SenderLists>;                         // loads lazily, then served from memory
  statusOf(email: string): Promise<SenderStatus | null>;
  setStatus(email: string, status: SenderStatus | null): Promise<void>;  // null removes
}
function createSenderStore(path?: string): SenderStore
```

`normalizeEmail` lower-cases and trims; an address must contain exactly one `@`
with non-empty parts, no whitespace or control characters, at most 320
characters; otherwise it throws an `INVALID_INPUT` error. The file format is
`{ "trusted": string[], "blocked": string[] }`; each list is capped at 5000
entries (adding beyond it is rejected). Writes go through one promise chain so
concurrent requests cannot lose updates.

### Detection

- `AssessInput` gains `senderStatus?: "trusted" | "blocked"`.
  - `blocked` → `{ level: "high", score: 100, reasons: ["Du hast diesen Absender als Phishing gemeldet."] }`.
  - `trusted` and neither `dkim` nor `dmarc` is `fail` → `{ level: "none", score: 0, reasons: [] }`.
  - `trusted` with a `dkim` or `dmarc` `fail` → the normal verdict, forced to at least `high`, with the extra reason "Vertrauter Absender, aber die Absenderprüfung ist fehlgeschlagen (mögliche Fälschung)."
- `parseRawMessage(raw, attachments, ref, options?: { senders?: SenderLists })`
  computes the status from the first From address and passes it on;
  `MessageDetail.sender.trust: "trusted" | "blocked" | null` reports it.
- `createApp` builds one store (path from the environment variable) and passes
  `await store.lists()` into every `parseRawMessage` call; the watcher gets the
  same store.

### Routes

- `POST /api/senders/status`, body `{ email: string, status: "trusted" | "blocked" | null }` → `{ ok: true }`. Invalid addresses → `400` (`INVALID_INPUT` from the store's validation, `INVALID_REQUEST` for a malformed body).
- `POST /api/message/report`, body `{ ref }`:
  1. `readRaw(ref)` and parse to get the sender address (no address → `400`).
  2. `listMailboxes(ref.account, { counts: false })`, pick the Junk folder with `findJunkMailbox` (same names as `isJunkOrTrash` minus trash: `junk`, `spam`, `junk e-mail`, `[Gmail]/Spam`, `[Google Mail]/Spam`).
  3. If the message is not already in that folder: `service.move(ref, junk.id)`; a failure returns the error and stores nothing.
  4. `setStatus(address, "blocked")`.
  Response `{ ok: true, moved: boolean, mailbox: string | null }`; with no Junk folder the address is still remembered (`moved: false`).
- Both routes sit behind the existing loopback/session hooks.

### Watcher

The watcher passes the store's lists to its assessments and keeps
`{ level, email }` per verdict; `forgetSender(email)` drops that sender's
entries. The status route calls it after a change so a stale ⚠ badge does not
survive a trust or report action.

### Client

- Sender panel: a row "Einstufung" with the current status and the buttons
  "Absender vertrauen" / "Vertrauen widerrufen" and "Als Phishing melden"
  (native `window.confirm`) / "Meldung widerrufen". After an action the message
  is loaded again so banner and verdict match.
- `formatMessageText(…, true)` adds a line "Einstufung: …" when a status is set.
- Notices: "Absender wird vertraut.", "Vertrauen widerrufen.", "Mail in Junk verschoben und Absender gemeldet.", "Absender gemeldet (kein Junk-Ordner gefunden).", "Meldung widerrufen."

## Error handling

- Corrupt or unreadable file → empty lists, stderr note; a failed write returns
  an error to the client and keeps the in-memory state unchanged.
- Report: a failing move stores nothing; a missing Junk folder is not an error.
- Revoking a "reported" sender does not move the message back (it stays in Junk).

## Testing

- Store (real temp files): missing file, set/unset, mutual exclusion,
  persistence across store instances, mode `0600`, atomic replacement, invalid
  and oversized addresses, list cap, concurrent writes keep every update, corrupt file.
- Detection: blocked → high/100; trusted → none; trusted with DMARC/DKIM `fail`
  → high with the reason, SPF fail alone → none; case-insensitive match;
  `parseRawMessage` reports `trust`.
- Routes (fake service): status set/unset/validation/session boundary; report
  with a Junk folder (move then store, order), message already in Junk, no Junk
  folder, failing move stores nothing, unparsable sender.
- Watcher: blocked sender notifies, `forgetSender` removes entries.
- Playwright (synthetic API): trust and revoke, report with confirmation and
  dismissal, the panel and banner after reload.
- Never move or copy a real message; the manual check is one throwaway mail.

## Risks

- A trusted address whose domain has no DKIM/DMARC cannot be protected against
  forgery by this rule; the operator accepted address-only trust.
- Junk folder detection is name-based; an unusual folder name means "remembered,
  not moved".
- Reporting remembers the address only locally; nothing is sent to the provider
  or a third party.

## Out of scope

Domain trust, a list/management screen, importing or exporting the lists,
reporting to third parties, syncing across devices, retro-flagging old mail in
the list (only mail opened later or arriving later is re-assessed).
