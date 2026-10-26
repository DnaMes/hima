# Himalaya Web Slice 5c: Cross-Folder / Cross-Account Search and Filters

**Date:** 2026-10-02

**Status:** Brainstormed with the operator in-session. Decisions marked
*(operator)* were chosen by the operator; the rest are design judgment to
correct on review.

## Goal

Let the operator find a message without knowing which account or folder it is
in, and narrow results with real filters. Today search covers only the open
folder, or the INBOX of each account in "Alle Eingänge", and has no filters
besides "unread".

## Context and constraints

- Local, loopback-only, read-only: search never mutates mail and never writes
  mail content to disk. A persistent local index was rejected for that reason.
- **Verified against the installed Himalaya CLI (v2.1), not assumed:**
  - Search DSL: `from|to|subject|body <pattern>`, `date <d>`, `after <d>`,
    `flag <seen|answered|flagged|draft>`, `and`/`or`/`not`, parentheses,
    `order by <date|from|to|subject> [asc|desc]`. There is **no** `before`.
  - `after D` is exclusive of day D (`after 2026-09-29` starts on 09-30).
    Inclusive start `X` is therefore `after (X-1 day)`; inclusive end `Y` is
    `not after Y`. `not after Y and after Z` yields a bounded range.
  - `--has-attachment` only populates the `ATT` column / the envelope's
    `has-attachment` field; it is **not** a filter. An attachment filter can
    only run on already-loaded envelopes.
  - `listEnvelopes` already passes `--has-attachment`, so `Envelope.hasAttachment`
    is populated for list and search results.
  - `listEnvelopes` in `src/server/himalaya.ts` now passes options (pagination, search) before the query argument to `envelope search`; putting the query after the options caused all text searches to fail with PROVIDER_ERROR before this fix.
  - Pattern escaping: search text must backslash-escape whitespace, parentheses, and backslashes (`Beleg\ für` for a phrase, backslash itself as `\\`). Quotes are taken literally, not as string delimiters. Grouping parentheses must touch their neighbours (`(subject x or from x)` works, `( subject` does not).
  - Inclusive date range: `from X to Y` (inclusive both ends) on one day D returns the exact same IDs as the DSL `date D`. Unbounded: `order by date asc` works alone without `after` or `not after`.
- Existing behavior this slice touches: `HimalayaCli.listEnvelopes`
  (`src/server/himalaya.ts`) runs `envelope search` only when
  `search.text.trim()` is non-empty and otherwise `envelope list`, so a
  `{ text: "", unread: true }` search (used by the watcher and offered by the
  unread toggle) silently degrades to a plain list. Fixing "any criterion
  present → search" changes that; see Risks.
- `listUnifiedInbox` (`src/server/unified-inbox.ts`) already merges per-account
  windows with a stable sort, page cap (`UNIFIED_INBOX_MAX_PAGE`), bounded
  concurrency (4) and per-account warnings. It is the base to generalize.

## Decisions

| Topic | Decision |
|---|---|
| Scope *(operator)* | Switchable: "Dieser Ordner" (default, as today) / "Dieses Konto (alle Ordner)" / "Alle Konten (alle Ordner)". |
| Filters *(operator)* | Date range (from/until, inclusive), flag/read state (flagged, seen, unseen, answered), sort order (newest/oldest first), has-attachment (post-filter). |
| Architecture | Generalize the unified-inbox merge from "INBOX per account" to "a list of (account, mailbox) sources". New route `POST /api/search`; rejected alternatives: streaming per-source results (too much client and server machinery for the value) and a local search index (violates the no-mail-at-rest rule). |
| Trash/Spam | Excluded from the all-folders scopes by default; one checkbox includes them. Detected by a case-insensitive name match on the last path segment (`junk`, `spam`, `trash`, `papierkorb`, `deleted messages`, `deleted items`, `gelöschte elemente`); `resolveSpecialFolder` needs per-account settings that are not available when resolving sources. |
| Source cap | At most 30 sources per request. Sources are ordered INBOX-first (every account's INBOX first, then one more folder per account in turn); sources beyond the cap are skipped with a visible warning, never silently. |
| Gmail aggregate folders | Gmail's `[Gmail]/` and `[Google Mail]/` aggregate folders (All Mail / Alle Nachrichten, Important / Wichtig, Starred / Markiert) hold copies of mail that also lives in the INBOX or a label. They are excluded from the "account" and "all" scopes to avoid duplicate hits. Not verified live: open the folder and use "Dieser Ordner" to search it. |
| Attachment filter | Applied to the returned page; the UI says a page may hold fewer than 25 hits. |

## Architecture

### Search contract (`src/server/contracts.ts`)

`SearchInput` grows optional fields (all backwards compatible):

```ts
type SearchInput = {
  field: SearchField;
  text: string;
  unread?: boolean;
  from?: string;   // YYYY-MM-DD, inclusive
  until?: string;  // YYYY-MM-DD, inclusive
  flag?: "flagged" | "seen" | "unseen" | "answered";
  order?: "desc" | "asc";
};
```

`buildSearchQuery` composes: the text clause (if any), `after <from-1d>`,
`not after <until>`, the flag clause (`unseen` = `not flag seen`), and the
existing unread clause, joined with `and`, then `order by date <order>`.
Dates are validated as real calendar dates; the day-before computation uses
UTC date arithmetic on the validated string. A new helper
`hasSearchCriteria(search)` is true when any clause would be emitted.
`listEnvelopes` switches to `envelope search` whenever it is true (instead of
only for non-empty text). `has-attachment` is not part of the query.

### Sources and merge (`src/server/search-scope.ts`, `unified-inbox.ts`)

- `resolveSources(service, input: ResolveInput)` returns
  `{ sources: {account, mailbox}[], warnings }`, where `ResolveInput` is
  `{ scope, accounts, current?, includeJunk }`: one source for "folder", all
  mailboxes of one account for "account", all mailboxes of each listed account
  for "all". Trash/Spam are filtered unless `includeJunk`, and Gmail's
  `[Gmail]/` / `[Google Mail]/` aggregate folders are always filtered (see the
  Decisions table; the exclusion is not yet verified against a live Gmail
  account).
- Sources come back INBOX-first: every account's INBOX is placed first, then
  one more folder per account in turn, so the 30-source cap favors the folders
  most likely to hold the answer instead of filling up from one account.
- The merge extracted from `listUnifiedInbox` becomes
  `listSources(service, sources, query)`; `listUnifiedInbox` becomes a thin
  caller with INBOX sources, so its behavior and tests stay unchanged.
  Per-source window = `UNIFIED_INBOX_MAX_PAGE * pageSize`, sorted by date
  (direction from `order`), ties by account, mailbox, id. Concurrency stays 4;
  each source has the runner's existing timeout.
- Failed or skipped sources become `UnifiedWarning` entries (existing type,
  now with an optional `mailbox`). Skipped sources produce one warning per
  account with the exact message `N Ordner nicht durchsucht (Obergrenze 30)`.
- Mailbox listing for the "account"/"all" scopes uses the existing
  `listMailboxes(account, { counts: false })`. Message counts are not needed to
  build the source list, and requesting them made this step much slower
  (measured: 5.4 s for all folders without counts vs 12.7 s with counts).

### Route (`src/server/app.ts`)

`POST /api/search` with body `{ scope, accounts, account?, mailbox?, includeJunk,
page, pageSize, field, q, unread, from, until, flag, order, hasAttachment }`,
validated with zod like `unifiedInboxBodySchema`. It returns the existing
`UnifiedInboxResult` shape (envelopes with `source`, `hasMore`, `warnings`)
and the same `risk` decoration as the unified route. The existing
`/api/unified/inbox` and `/api/accounts/:account/messages` routes keep their
contracts; both accept the new optional filter fields so single-folder search
gets the filters too.

The Next `›` button is decided differently per route: `/api/search` and
`/api/unified/inbox` report the server-computed `hasMore` from the merged
source windows, while the single-folder route has no merged window and reports
`hasMore` from the raw loaded page length, taken *before* the attachment trim.
The attachment post-filter therefore never changes whether another page is
offered.

### Client (`src/client/`)

- `search-state.ts` (new, pure): the filter model, default values, chips
  derived from active filters, and the request-body builder; tested in
  isolation.
- `main.tsx`: scope switch next to the search field, a collapsible filter
  panel, removable chips for active filters, and the German hint for the
  attachment filter. Results render through the existing `MessageList` with
  `unified` row sources, so open/reply/move/delete already work on
  `source`.
- Search scope and filters are not persisted: every session starts as today
  (open folder, no filters).

## Error handling

- Invalid dates, `from > until`, unknown flag/order, empty `accounts` for the
  "all" scope → `400 INVALID_REQUEST` with a German message.
- One failing source never fails the request; it appears in `warnings`.
- More than 30 sources: sources are ordered INBOX-first (every account's
  INBOX first, then one more folder per account in turn) and the first 30 are
  searched; the skipped sources are reported with one warning per account.
- A source that exceeds the runner timeout now surfaces as `TIMEOUT`, not
  `SPAWN_FAILED`: the abort path settles the timeout error before calling
  `controller.abort()`, whose synchronous child `"error"` event previously won
  the race and mislabelled every timeout as "could not be started".
- The attachment post-filter never changes `hasMore`; the UI states that pages
  may be shorter.

## Testing

- Unit: `buildSearchQuery` date boundaries (inclusive start and end, month and
  year rollover, invalid dates), flag combinations, text-less filter-only
  queries, `hasSearchCriteria`; `resolveSources` per scope, junk and
  Gmail-aggregate exclusion, INBOX-first ordering, 30-source cap and warning.
- Server (fake service): merge across several mailboxes of several accounts,
  ascending order, ties, paging across the window, partial failure warnings,
  `listUnifiedInbox` unchanged; route validation and `risk` decoration.
- Client: `search-state` request bodies and chips.
- Playwright (synthetic API only): scope switch changes the request body,
  filter panel and chips, attachment hint. Real mail is only checked
  read-only, never mutated.
- Verified on 2026-10-02: 436/439 unit tests pass (the 3 failures are
  pre-existing `rules.test.ts` logging assertions from another session's
  uncommitted work, unrelated to this slice); 77/77 Playwright tests pass
  across 10 files, 15 of them in `cross-folder-search.spec.ts`.

## Risks

- **Watcher side effect:** after the criteria change, the watcher's
  `{ text: "", unread: true }` call becomes a real unread search. That is the
  intended meaning, but `watcher.test.ts` and a live check must confirm no
  regression (fresh-mail detection still keys off the unread counter).
- All-account scope can fan out to hundreds of IMAP searches on this host
  (20+ accounts). The cap, concurrency limit and timeouts bound it. This was
  timed against real mail: a 60-source version took ~100 s end to end, while
  the final INBOX-first 30-source version covering 19/19 accounts took ~24 s
  total (~2.7 s resolving sources, ~21.6 s searching), so the cap of 30 was
  kept.
- The Gmail aggregate-folder exclusion is implemented from folder names but
  has not been verified against a live Gmail account. Until it is, open a
  `[Gmail]/...` folder and use the "Dieser Ordner" scope to search it.
- Date clauses match the message's `Date:` header (sent-at), not the arrival
  date, and boundary behavior was only probed on one account; the UI labels the
  filter "Datum (Sendedatum)" and the plan adds a boundary test against a real
  read-only search before release.

## Out of scope

Saved searches, a local index, full-text search inside attachments, tags
(Slice 5e / roadmap Slice 4), server-side persistence of filter choices.
