# Himalaya Web Slice 2: Mail Watcher, Desktop Notifications, and the Omarchy Bar Widget

**Date:** 2026-09-22

**Status:** Brainstormed solo, autonomously, per explicit operator instruction
("autonom, ich bin essen! du triffst alle Entscheidungen!") while the operator
was away; not yet reviewed. Every decision below is a judgment call made in
this session, not a prior operator decision — treat it as a proposal to
approve, correct, or override on review, not as settled fact the way Slice
0/1's decisions (made in a live back-and-forth) were.

## Goal

Give Himalaya Web a background presence: detect new mail on watched accounts
without a browser tab open, surface it as a native desktop notification, and
show a live unread-count badge on the Omarchy bar widget (currently a plain
link button). This is Slice 2 of the mail-client roadmap
(`/home/dnames/.claude/plans/pasted-content-id-35ee-using-superpower-curried-reddy.md`);
it depends on nothing built so far and nothing later in the roadmap depends on
it, but Slice 3 (rules engine) is explicitly meant to reuse this slice's
polling loop rather than run a second one.

## Context and constraints

- Himalaya v2.1.0 has no `envelope watch` or IMAP IDLE support exposed via the
  CLI (confirmed in the Slice 0/1 planning session) — new-mail detection can
  only be server-side polling of `mailbox list` / `envelope list`.
- The current Omarchy widget (`deploy/omarchy/dnames.himalaya-mail/`) is a
  Quickshell `BarWidget` (QML) that only opens the browser via
  `Quickshell.execDetached(["xdg-open", ...])`. It has no existing IPC to the
  server beyond that one-shot process spawn.
- The server is a single Fastify process (`src/server/app.ts`, entry point
  `src/server/index.ts`), loopback-bound (`127.0.0.1` only), gated by a random
  session token generated at process start and **never written to disk** —
  it is injected only into the browser's entry page HTML. `outbox.ts` is the
  existing precedent for an in-memory, timer-driven background subsystem
  created inside `createApp()` and disposed on the Fastify `onClose` hook.
- Special-folder resolution already exists for sent/drafts/trash
  (`special-folders.ts`, just fixed in this session to also match a German
  Gmail's `[Google Mail]/...` prefix); this slice's "read" quick action needs
  no new folder kind, but "archive" would need one — see Quick Actions below.
- The user has 36 configured Himalaya accounts; polling all of them on every
  tick is wasteful and would flood notifications on first start. Which
  accounts to watch must be an explicit, persisted, opt-in choice.
- `AGENTS.md`: never copy credentials into source, tests, browser storage, or
  logs. `HANDOFF.md`'s standing decisions: loopback + session-token boundary
  on every route is non-negotiable; German-only user-facing text; English
  code/tests/docs; synthetic data in automated tests, at most one reversible
  live check.

## Non-goals (this slice)

- Reading message bodies for notification purposes — only envelope metadata
  (from, subject) is fetched, matching the existing `envelope list` no-body
  cost profile already used by the unified inbox.
- IMAP IDLE / push — not exposed by the installed Himalaya CLI.
- A settings UI for choosing watched accounts — v1 is hand-edited
  `accounts.json`, matching the existing pattern for special-folder
  overrides (a UI for both is future work, already tracked as a limitation).
- Quiet hours / do-not-disturb scheduling — no evidence this is wanted yet;
  add later if it turns out to matter (YAGNI).

## Decisions

| Topic | Decision | Rationale |
|---|---|---|
| Watched accounts | Opt-in per account via a new `watch: boolean` field in `accounts.json` (default `false`, i.e. watching nothing until configured) | Avoids a 36-account notification flood on first deploy; consistent with the existing hand-edited `accounts.json` pattern for special-folder overrides |
| Watched mailbox | `INBOX` only, per watched account | `INBOX` is the one folder name that is reliably present and consistently named across every provider already configured (verified: German-localized Gmail still reports `Inbox`, not a localized name, in this session's `mailbox list` probe) |
| Detection signal | `Mailbox.unread` count from `listMailboxes()`, not a full envelope diff, as the per-tick cheap check; only fetch envelopes (to get sender/subject for the notification body and to identify which messages are actually new) when the count has risen since the last tick | One `mailbox list` call per watched account per tick is cheap; an `envelope list` call is heavier and only needed on the accounts that actually changed |
| First tick after startup | Baseline only, no notifications | Otherwise every restart of `himalaya-web.service` would notify about the account's entire current unread count |
| Poll interval | 60 s default, `HIMALAYA_WEB_WATCH_INTERVAL_MS` env override (same pattern as `HIMALAYA_WEB_PORT`) | Matches "new mail within about a minute" expectations without hammering IMAP servers across potentially many watched accounts |
| Notification coalescing | ≤3 new envelopes on one account in one tick → one notification per message; >3 → a single summary notification ("N neue Nachrichten in `<account>`") | Avoids a notification storm from a newsletter burst or a long-offline watcher's first real tick |
| Per-account failure handling | A watched account's tick failure (e.g. `AUTH_REQUIRED`) is caught, logged server-side without message content, and does not stop the loop or other accounts; the account's last-known error is exposed in the summary endpoint | Matches the existing per-route error handling; one broken Gmail token must not silently kill notifications for every other watched account |
| Badge/notification transport to the widget | New loopback-only, narrowly-scoped auth token (see Security) rather than reusing or relaxing the main session-token boundary | `AGENTS.md`/`HANDOFF.md` treat the session boundary as non-negotiable; the existing token is deliberately never written to disk, so the widget — a separate OS process with no access to the browser's injected page — cannot present it |
| Quick actions (archive/read) | **Deferred out of this slice's v1** — see Quick Actions below | The roadmap names them, but `omarchy-notification-send` is now confirmed (by reading its source during spec review) to send notifications with an always-empty D-Bus `actions` array — true per-notification action buttons are not available through it, and "archive" has no existing folder-resolution primitive either |

## Architecture

### Server: `src/server/watcher.ts` (new module, mirrors `outbox.ts`'s shape)

```
export interface Watcher {
  start(): void;
  stop(): void;
  summary(): WatchSummary;
}

export type WatchSummary = {
  accounts: Array<{
    account: string;
    unread: number | null;
    error: string | null; // German provider-errors.ts text, or null
  }>;
  totalUnread: number;
};

export function createWatcher(deps: {
  service: HimalayaService;
  readAccountsConfig: typeof readAccountsConfig;
  notify: (title: string, body: string) => void; // spawns omarchy-notification-send --exec xdg-open ...
  intervalMs?: number;
}): Watcher;
```

Internal state (in-memory only, not persisted — a server restart re-baselines,
per the "first tick" decision above): a `Map<account, { lastUnread: number,
notifiedIds: Set<string> }>`, with `notifiedIds` capped at the last 200
entries per account (oldest evicted first) to bound memory across a
long-running service.

Each tick:
1. `readAccountsConfig()` to get the current watch list (re-read every tick,
   so toggling `watch` in `accounts.json` takes effect within one interval
   without a restart — the file is already the source of truth polled
   per-request elsewhere in the app, e.g. in `/api/compose/send`).
2. For each watched account, `listMailboxes(account)`, find the entry whose
   resolved kind is `INBOX` (by id/name, case-insensitively — same pattern as
   `resolveSpecialFolder`, but `INBOX` needs no heuristic table since IMAP
   guarantees the name), read `.unread`.
3. If `unread` rose since the last tick (and this is not the first tick for
   that account): `listEnvelopes(account, "INBOX", { page: 1, pageSize: 10,
   search: { field: "all", text: "", unread: true } })`, filter to envelope
   IDs not already in `notifiedIds`, notify per the coalescing rule, add the
   new IDs to `notifiedIds`.
4. On any per-account error, catch it, map through the existing
   `provider-errors.ts`, store the German text in that account's summary
   entry, and continue the loop for the remaining accounts.
5. Update the summary map used by `GET /api/watch/summary`.

`notify()` spawns `omarchy-notification-send` (confirmed present at
`/usr/share/omarchy/bin/omarchy-notification-send` and, unlike bare
`notify-send -A/--action`, does not block waiting for the user to click —
it calls `org.freedesktop.Notifications.Notify` directly via `busctl` and
returns immediately) with the account's display name/email and the
message's from/subject, truncated to a sane length and with any embedded
newlines stripped (same header-injection-adjacent caution as
`compose.ts`'s address validation, applied here defensively even though
the source is IMAP-reported metadata, not raw user input), plus `--exec
xdg-open http://127.0.0.1:<port>/` so clicking the notification opens the
browser — verified this argv-array invocation (never a shell string, same
rule as `SpawnRunner`) matches the script's own `--exec` contract. Fall
back to plain `notify-send` (confirmed present at `/usr/bin/notify-send`)
without `--exec` only if `omarchy-notification-send` is ever absent from
`$PATH` (defensive; both are present on the current host).

`createApp()` instantiates the watcher the same way it instantiates the
outbox (`const watcher = createWatcher({ service, readAccountsConfig, notify,
...})`), calls `.start()`, and disposes it (`.stop()`) in the existing
`onClose` hook alongside `outbox.dispose()`. If zero accounts have `watch:
true` at startup, `start()` still runs the timer (cheap: one no-op
`readAccountsConfig()` call per tick) so that toggling watch on later takes
effect without a restart, per point 1 above.

### New API surface

- `GET /api/watch/summary` — loopback-only (same host/origin check as every
  other route via the existing `onRequest` hook), but authenticated with a
  **separate, narrower-scoped token** (see Security) instead of the main
  session token. Returns `WatchSummary` as JSON, `Cache-Control: no-store`.
  No message content, only account aliases and counts — the same sensitivity
  level as what the bar widget already implicitly reveals just by existing
  (that Himalaya Web is running).
- No other new routes in v1 — quick actions are deferred (see below), and
  toggling `watch` per account reuses the existing hand-edit-`accounts.json`
  workflow, matching how special-folder overrides work today (a combined
  settings UI for both is a natural, but separate, future slice).

### `accounts.json` schema change

`AccountFolderSettings` (in `special-folders.ts`) gains one more optional
field:

```ts
export type AccountFolderSettings = {
  overrides: Partial<Record<SpecialFolderKind, string>>;
  sentCopy?: SentCopyMode;
  watch?: boolean; // default false when absent
};
```

`readAccountsConfig`'s parse gains `watch: value.watch === true ? true :
undefined` (same "stay undefined instead of coercing a default" shape as the
`sentCopy` fix just made in this session, applied consistently rather than
repeating the earlier bug's pattern for a new field).

### Security: the widget token

A second random token (`randomBytes(32)`, same generation as the main session
token) is generated once per `himalaya-web.service` process start, but —
unlike the main token — is written to `~/.config/himalaya-web/widget-token`
(mode `0600`) **only if at least one account has `watch: true`** at startup
(so the file does not exist at all for an operator who never opts into
watching, keeping the "nothing written to disk" property true by default).
This is a deliberate, narrow exception to the "session token is never written
to disk" rule stated in `index.ts`'s own startup log line, justified because:

- It authorizes exactly one read-only, no-content-leaking endpoint — nothing
  else. A leak of this token cannot send, delete, move, or read message
  content, unlike the main session token.
- It is loopback-only like every other route, so "written to disk" only
  matters against another local account/process on the same machine, not
  network exposure — the same trust boundary the rest of the app already
  accepts for `accounts.json` and Himalaya's own keyring-backed config.
- It rotates every process restart, same as the main token.

The Quickshell widget (`Widget.qml`) reads this file at startup (Quickshell's
`Process` API, reusing the same "spawn an external process" idiom the widget
already uses for `xdg-open`, e.g. `cat` the file or read it directly if
Quickshell's QML runtime exposes local file reads — resolve the exact API at
implementation time) and sends it as the existing `x-himalaya-session` header
on its polling request. `app.ts`'s session check grows a second branch: on
`GET /api/watch/summary` specifically, accept either the main token (so the
already-open browser tab could also poll it, later, if useful) or the widget
token; every other route continues to accept only the main token, unchanged.

### Omarchy widget (`deploy/omarchy/dnames.himalaya-mail/`)

- `manifest.json`: version bump; no schema change needed (`kinds` stays
  `["bar-widget"]` — a separate long-running `service` plugin kind was
  considered, per the roadmap's mention of it, but is unnecessary complexity
  here: a `Timer` inside the existing `BarWidget` polling a `Process` is
  sufficient and keeps the whole feature in one plugin, matching YAGNI).
- `Widget.qml`: add a `Timer` (interval matching or slightly longer than the
  server's poll interval, e.g. 60 s, to stay a follower of the server's
  authoritative count rather than an independent poller) that runs a
  `Process` curling `http://127.0.0.1:47831/api/watch/summary` with the
  widget-token header, parses `totalUnread`, and sets `button.text` to
  `"✉ " + totalUnread` when `> 0`, else `"✉"` (unchanged today). Left-click
  keeps opening the browser (unchanged); a fetch failure (server not running,
  or file missing because watching is off) silently falls back to the
  unchanged plain `"✉"` label rather than showing an error state on the bar.
- `deploy/omarchy/README.md`: document the new `widget-token` file and that
  it only appears once an account has `watch: true`.

### Quick actions (archive / read) — deferred, not designed here

The roadmap names "quick actions (archive/read)" on the widget. This spec
deliberately does not design them, for two reasons — one now confirmed
during spec review, one still a real design surface:

1. **Per-notification action buttons are confirmed unavailable through the
   host's own notification helper.** Reading
   `/usr/share/omarchy/bin/omarchy-notification-send` (spec review) shows it
   calls `org.freedesktop.Notifications.Notify` with the `actions` array
   always empty (`0` count) and exactly one click target via a single
   `omarchy-exec-argv` hint from `--exec` — there is no way to offer two
   distinct buttons ("Archiv" vs. "Gelesen") on one notification through
   this mechanism. Bare `notify-send -A/--action` does support multiple
   named actions, but only by blocking the calling process until the user
   picks one (`--wait` is implied) — unusable from a background polling
   tick without spawning a detached watcher-per-notification, which is more
   machinery than this slice's scope justifies. A future slice could still
   offer these as a widget right-click menu (Quickshell-side) instead of a
   notification action, which sidesteps this limitation entirely.
2. **"Archive" has no existing primitive.** Every mailbox action implemented
   so far is trash-move or permanent-delete (`message.delete`); "archive"
   would need a new `SpecialFolderKind` resolved the same way sent/drafts/
   trash are, but unlike those three, "archive" (Gmail's "All Mail") is not a
   folder every non-Gmail provider has an equivalent of — the UI would need
   to hide the action per-account when no archive-like folder resolves,
   which is a real design surface, not a one-line addition.

Slice 2 v1 ships the badge and the notifications with click-to-open, via
`omarchy-notification-send --exec xdg-open ...` (verified during spec
review — see below), and stops there.

## Error handling

- A watched account whose credentials are broken (`AUTH_REQUIRED`) never
  crashes the loop; its summary entry carries the error text and `unread:
  null`ed contribution to `totalUnread`.
- If `readAccountsConfig()` itself fails (e.g. malformed JSON), the tick logs
  and skips entirely, retrying next interval — same resilience the app
  already has elsewhere for that file (`readAccountsConfig` already swallows
  parse errors and returns `{}`, so this is actually already covered by the
  existing function, not new code).
- The widget must never surface a raw error to the bar — a poll failure of
  any kind (network, missing token file, non-200) just keeps the last known
  badge value or falls back to the plain icon.

## Testing

- Unit (`watcher.test.ts`, fake `HimalayaService` and a fake clock via
  `vi.useFakeTimers`, same style as `outbox.test.ts`/`ai.test.ts`'s timeout
  test): baseline-then-notify sequencing, coalescing threshold, per-account
  error isolation, `notifiedIds` bound/eviction, re-reading `accounts.json`
  each tick.
- Route test (`app.test.ts`): `GET /api/watch/summary` accepts the widget
  token and rejects an absent/wrong one; rejects non-loopback origin/host
  like every other route; returns `Cache-Control: no-store`.
- No Playwright coverage needed for the QML widget itself (outside this
  repo's test surface, per the existing "widget is link-only, documented not
  tested" precedent) — the summary endpoint's contract is what Playwright/
  unit tests can actually verify from this repo.
- Manual verification at the end, scoped exactly like Slice 1's: enable
  `watch: true` for the operator's own account, send one email to it from
  outside, confirm one desktop notification fires and the bar badge updates
  within one poll interval, then no further real mail is touched.

## Docs to update in the same change

`README.md` (feature list, `accounts.json` schema, widget-token file,
security checklist re-run note), `HANDOFF.md` (progress, decisions,
limitations), `deploy/omarchy/README.md`, `CHANGELOG` entry for the next
version.

## Verified during spec review (resolves two of the original three open questions)

1. **Notification click-to-open, and the multi-action-buttons question,
   both resolved by reading `/usr/share/omarchy/bin/omarchy-notification-send`
   directly.** It calls `org.freedesktop.Notifications.Notify` over
   `busctl --user` with the `actions` array always empty and a single
   `omarchy-exec-argv` hint built only from `--exec`; a presumed Omarchy
   notification-click daemon runs that one argv on click. This **confirms**
   (not just click-to-open, which was the open question) that true
   per-notification multi-button quick actions (e.g. separate "Archiv"/
   "Gelesen" buttons) are **not supported** by this mechanism — the earlier
   "Quick actions" deferral above was the right call, now for a confirmed
   reason rather than an assumed one, not merely an unresolved unknown.
2. **`himalaya-web.service` already has a reachable notification bus.**
   `systemctl --user show himalaya-web.service -p MainPID` →
   `/proc/<pid>/environ` contains both `DBUS_SESSION_BUS_ADDRESS=unix:path=
   /run/user/1000/bus` and `WAYLAND_DISPLAY=wayland-1` on the current host,
   confirmed against the actual running process, not just the user
   manager's general environment. Server-side notification dispatch needs
   no unit-file environment changes.

## Remaining open question for plan review

1. Is 60 s an acceptable default interval, or should it be longer for
   Gmail-heavy watch lists to stay comfortably inside any rate limits (no
   evidence of a problem yet, but 36 configured accounts is a lot if the
   operator later opts many of them into watching)?
