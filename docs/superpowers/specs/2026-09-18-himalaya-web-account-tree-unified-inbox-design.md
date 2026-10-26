# Himalaya Web Account Tree and Unified Inbox

**Date:** 2026-09-18

**Status:** Proposed after user review of the design direction

## Goal

Replace the wide, central mailbox strip with a Thunderbird-like account tree,
make the account order user-controlled, and add a unified inbox that combines
the inboxes of the active and visible accounts. The existing local-only mail
workflow, account controls, favorites, themes, message actions, and reader
remain intact.

## Context and constraints

- The app is a single-user, loopback-only GUI for Himalaya v2.1.0.
- The browser session token and local-origin checks remain mandatory for every
  new API route.
- Himalaya remains the only mail backend. The web UI must not mutate the
  Himalaya account configuration.
- Browser preferences may contain account aliases and UI state, but never
  credentials, keyring values, message bodies, or AI data.
- User-facing labels remain German; code, tests, and planning documents remain
  English.
- Automated tests use synthetic accounts, folders, envelopes, and MIME data.
- Existing provider failures, including Gmail authentication failures, must be
  isolated per account in aggregate views.

## Design contract from the supplied UI reference

### Preserve

- The three-pane desktop workflow: accounts/navigation, message list, reader.
- The established dark Midnight/Tokyo Night visual language, semantic theme
  variables, serif heading hierarchy, compact density, and versioned shell.
- Account aliases, configured addresses, account favorites, mailbox favorites,
  active/visible preferences, search, unread filtering, paging, reader actions,
  exports, and the explicit AI assistant boundary.
- Internal scrolling so a large account set does not compress the message list
  or reader.

### Change

- Remove the wrapped mailbox chip strip from the message pane.
- Make the left pane a hierarchical tree with a virtual unified-inbox item at
  the top, followed by ordered account groups.
- Show folders as indented children of their account, with disclosure controls,
  unread counts, and mailbox favorites.
- Add direct account reordering with pointer and keyboard-accessible controls.
- Mark the source account in unified-inbox message rows.

No new fonts, bitmap assets, remote UI services, or decorative imagery are
needed. The visual work is a structural navigation change within the existing
design system.

## User experience

### Account tree

The navigation tree is ordered as follows:

1. `Alle Eingänge`, a virtual item representing the unified inbox;
2. a divider;
3. active and visible accounts in the persisted local order;
4. lazily loaded mailbox children under each expanded account.

The selected account expands automatically. Users may expand multiple accounts;
expanded state is transient UI state and does not affect mail preferences. A
mailbox click selects its account and mailbox, refreshes the existing message
list, and keeps the reader behavior unchanged.

Mailbox loading is lazy and cached for the current browser session. A loading
row and an inline account-scoped error row are shown beneath the account when a
provider is slow or unavailable. One broken account must not prevent other
accounts from being browsed.

The existing account search remains account-focused. The account filter and
favorite filter apply to account rows; the mailbox favorite state remains
account-scoped and is visible on each loaded child. An empty favorite view has
an explanatory German empty state.

### Manual account order

The browser stores the order under the versioned key
`himalaya-web-account-order-v1`. The value is an array of account aliases only.

- Dragging an account row moves it among the other accounts.
- Each row also exposes `Nach oben` and `Nach unten` actions for keyboard and
  non-drag users.
- The account manager exposes the same controls and shows the resulting order.
- New provider accounts append to the end.
- Provider accounts no longer returned are removed from the stored order.
- Hidden or inactive accounts retain their place in the order until removed by
  the provider.
- Reordering never changes Himalaya configuration and never triggers a mail
  operation.

The tree uses appropriate list/tree semantics, visible focus, drag status text,
and a polite live message after a move. Keyboard controls remain the canonical
accessible path; drag-and-drop is an enhancement.

### Unified inbox

Selecting `Alle Eingänge` loads the `INBOX` mailbox of every account that is
currently active and visible. It does not include arbitrary folders or hidden
accounts.

The server exposes a read-only aggregate endpoint. The client sends the
selected account aliases and the current search/unread/page parameters. The
server queries the account inboxes in parallel with bounded concurrency,
merges envelopes by newest date first, and returns source metadata for every
envelope:

```text
source: {
  account: string,
  mailbox: string
}
```

The aggregate response also returns safe per-account warnings. A provider
failure is represented as a warning and does not discard successful results.
If all selected accounts fail, the UI shows the combined warning state instead
of an empty-success illusion. Existing safe `HimalayaError` messages and codes
are reused; raw command output is not exposed.

Global paging is computed server-side by fetching enough envelopes from each
source to cover the requested global page, then sorting and slicing the merged
set. The endpoint applies explicit upper bounds to page, page size, and
per-request fan-out. A `hasMore` result flag controls the existing next-page
button. No background polling or persistent mail index is introduced.

Unified rows show the source account and mailbox as secondary metadata. Opening
one creates the normal `MessageRef` from the source metadata, so read-state,
move, attachment, Markdown export, PDF printing, and explicit AI actions
continue to operate against the correct account.

The unified inbox is intentionally read-only as an aggregate. It does not add
bulk actions, cross-account moves, send, delete, tagging, or automatic AI
processing.

## API and domain model

### Client state

- `accountOrder`: normalized alias array loaded from local storage;
- `expandedAccounts`: transient set of expanded aliases;
- `mailboxesByAccount`: session cache with loading/error states;
- `selectedAccount` and `selectedMailbox`, with a separate unified-inbox
  selection mode;
- `unifiedWarnings`: current aggregate warnings for visible feedback;
- `Envelope.source`: optional source metadata, present for aggregate rows.

Existing single-account message routes and message references remain unchanged.

### Aggregate route

Add a session-protected read-only route for unified inbox messages. Its input
contains the account aliases, page, page size, search field/text, and unread
filter. Its output contains:

- merged envelopes;
- `hasMore`;
- warnings with account alias, stable error code, and safe German message.

Input aliases are validated using the same reference-part constraints as the
existing account routes. The aggregate operation is not allowed to read raw
messages and must not accept message bodies from the browser.

The aggregate implementation belongs beside the existing Himalaya service
boundary so the route remains orchestration-only and is straightforward to
test with a fake service. Provider calls should be independently settled and
bounded rather than allowing one rejection to cancel the whole result.

## Architecture decisions

### Server-side aggregation over client fan-out

Server-side aggregation is chosen over issuing one browser request per account.
It gives the UI one stable response, centralizes source metadata and paging,
allows bounded provider concurrency, and makes partial failures consistent.
The trade-off is a new aggregate contract and more server-side orchestration.

### Browser-local ordering over configuration mutation

Ordering stays browser-local because it is a presentation preference and must
not rewrite the user's Himalaya configuration. This is reversible, secret-free,
works across the existing service boundary, and naturally supports new and
removed accounts. A different browser profile will have its own order.

### Lazy mailbox loading over eager tree hydration

Folders load on expansion instead of all accounts loading at bootstrap. This
avoids a burst of provider calls for the current account count and lets broken
providers remain isolated. The trade-off is a small loading state the first
time an account is expanded.

## Accessibility and responsive behavior

- Tree rows and controls are keyboard reachable with visible focus.
- Disclosure buttons have German accessible labels and `aria-expanded`.
- Reordering has button-based keyboard controls, drag status feedback, and
  does not rely on color alone.
- Loading, partial-failure, empty, and selected states use text or semantics in
  addition to color.
- The left pane gets a bounded scroll area; the message list and reader retain
  their independent scroll behavior.
- At the existing desktop minimum width the tree receives enough width for an
  alias, address, and folder indentation without bringing back the old center
  overflow. Narrow layouts preserve usable horizontal scrolling rather than
  hiding the tree controls.

## Security and privacy

- Preserve the loopback host/origin check and `X-Himalaya-Session` boundary.
- Do not persist account mailboxes, message bodies, provider errors containing
  secrets, or aggregate results in local storage.
- Use only account aliases in the order preference.
- Keep all provider calls behind the existing Himalaya process and keyring
  integration.
- Synthetic fixtures only in tests; no real unified-inbox request is used as an
  automated test dependency.

## Acceptance criteria

- The central mailbox strip is gone and folders render directly under expanded
  account rows in the left navigation.
- Account order survives reload, handles new/removed accounts, and can be
  changed through both drag enhancement and accessible move controls.
- `Alle Eingänge` merges active/visible account inboxes newest-first and keeps
  the source reference needed to open and act on a message.
- A failed account produces a visible scoped warning while successful account
  messages remain usable.
- Unified message actions use the source account and mailbox correctly.
- Existing account management, favorites, search, theme, export, AI, and
  single-account workflows remain functional.
- Focused unit, API, and synthetic Playwright tests cover the new behavior.
- `npm run typecheck`, `npm test`, `npm run build`, and the high-severity audit
  pass after implementation.

## Out of scope

- Adding or permanently removing Himalaya accounts from the browser UI.
- Synchronization across browsers or devices.
- Background indexing, polling, or offline unified mail storage.
- Unified sent/archive/custom-folder views.
- Cross-account bulk operations, compose, send, delete, tagging, or automatic
  AI actions.
