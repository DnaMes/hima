# Account Tree and Unified Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Thunderbird-style account/mailbox tree, persistent local account ordering, and a partial-failure-tolerant unified inbox for active and visible accounts.

**Architecture:** Keep account order and expanded-tree state in the browser, load mailbox children lazily, and keep the existing single-account message routes unchanged. Add one authenticated server-side aggregate route that resolves each selected account's `INBOX`, fetches bounded envelope pages, adds source metadata, merges newest-first, and returns per-account warnings.

**Tech Stack:** TypeScript, React 19, Fastify 5, Zod, Vitest, Playwright, Himalaya CLI v2.1.0, browser `localStorage`.

**Spec:** `docs/superpowers/specs/2026-09-18-himalaya-web-account-tree-unified-inbox-design.md`

## Global Constraints

- The app remains single-user, loopback-only, and protected by `X-Himalaya-Session`.
- Himalaya v2.1.0 remains the only mail backend; the browser never edits Himalaya account configuration.
- Browser preferences contain account aliases and UI state only, never credentials, keyring values, message bodies, provider secrets, or AI data.
- User-facing labels remain German; code, tests, and planning documents remain English.
- Automated tests use synthetic accounts, folders, envelopes, and MIME data only.
- Existing account controls, favorites, themes, search, unread filtering, paging, reader actions, exports, AI limits, and provider-error mapping remain functional.
- Do not add a dependency; use the existing React, Fastify, Zod, Vitest, and Playwright stack.
- The current worktree contains an approved but uncommitted 0.3.0 slice. Stage only task-specific paths, and do not create implementation commits until the user explicitly authorizes them.

## File Map

### New files

- `src/client/account-order.ts` — versioned browser storage, normalization, ordering, and move helpers.
- `src/client/account-order.test.ts` — pure tests for malformed storage, reconciliation, and boundary moves.
- `src/server/unified-inbox.ts` — server-side aggregate orchestration, bounded source paging, sorting, and warning conversion.
- `src/server/unified-inbox.test.ts` — synthetic service tests for merge order, source metadata, pagination, and partial failures.
- `tests/e2e/account-tree-unified-inbox.spec.ts` — synthetic browser coverage for tree placement, local order persistence, lazy mailboxes, and unified message opening.

### Modified files

- `src/shared/types.ts` — source metadata and unified warning/result types.
- `src/client/preferences.ts` — preserve favorite behavior while accepting the canonical account order.
- `src/client/main.tsx` — tree state, lazy mailbox loading, unified selection, source-aware message references, and account-manager ordering controls.
- `src/client/styles.css` — tree layout, indentation, disclosure controls, reorder affordances, unified warning rows, and removal of the central mailbox strip.
- `src/server/app.ts` — validated authenticated aggregate route.
- `src/server/app.test.ts` — route authentication, validation, response, and partial-warning coverage.
- `README.md` — describe the account tree and unified inbox, remove the obsolete no-unified-inbox statement.
- `CHANGELOG.md` — record the next account-navigation/unified-inbox release slice.

## Task 1: Add the local account-order model

**Files:**
- Create: `src/client/account-order.ts`
- Create: `src/client/account-order.test.ts`
- Modify: `src/client/preferences.ts: filterAccounts`

**Interfaces:**

- `readAccountOrder(storage: Pick<Storage, "getItem">): string[]`
- `writeAccountOrder(storage: Pick<Storage, "setItem">, order: readonly string[]): void`
- `normalizeAccountOrder(accounts: readonly Account[], stored: readonly string[]): string[]`
- `orderedAccounts(accounts: readonly Account[], order: readonly string[]): Account[]`
- `moveAccount(order: readonly string[], accountName: string, direction: "up" | "down"): string[]`
- `filterAccounts(accounts, query, filter, favoriteNames, accountOrder?)` preserves canonical order inside the existing favorite grouping.

- [ ] **Step 1: Write failing pure tests**

Add tests with an in-memory `Storage` double:

```ts
it("ignores malformed order storage", () => {
  const storage = { getItem: () => "{bad" };
  expect(readAccountOrder(storage)).toEqual([]);
});

it("deduplicates known aliases and appends new provider accounts", () => {
  const accounts = [account("anna"), account("andre"), account("cloudflare")];
  expect(normalizeAccountOrder(accounts, ["cloudflare", "andre", "andre", "removed"]))
    .toEqual(["cloudflare", "andre", "anna"]);
});

it("moves only within bounds", () => {
  const order = ["andre", "anna", "cloudflare"];
  expect(moveAccount(order, "andre", "up")).toEqual(order);
  expect(moveAccount(order, "anna", "down")).toEqual(["andre", "cloudflare", "anna"]);
});
```

Use a local `account(name)` fixture with the complete `Account` shape and no
real addresses.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npx vitest run src/client/account-order.test.ts`

Expected: FAIL because the new helpers do not exist.

- [ ] **Step 3: Implement the minimal order module**

Use `ACCOUNT_ORDER_KEY = "himalaya-web-account-order-v1"`. Parse only a JSON
array of strings, remove duplicates while preserving first occurrence, filter
unknown aliases during normalization, and append provider aliases in provider
order. `moveAccount` returns a new array and leaves unknown/boundary moves
unchanged. Catch browser storage errors exactly as the existing preference
modules do.

- [ ] **Step 4: Update account filtering to honor the order**

Add an optional `accountOrder` argument to `filterAccounts`. Keep the existing
favorite-first behavior, then use the order index as the stable comparison
inside each group, with locale comparison only as the unknown-alias fallback.
Update existing preference tests or add cases proving a manual order survives
the account search and favorites filter.

- [ ] **Step 5: Run the focused tests and typecheck**

Run: `npx vitest run src/client/account-order.test.ts src/client/preferences.test.ts && npm run typecheck`

Expected: PASS with no new TypeScript errors.

## Task 2: Add the pure unified-inbox aggregator

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/server/unified-inbox.ts`
- Create: `src/server/unified-inbox.test.ts`

**Interfaces:**

Add these shared types:

```ts
export type EnvelopeSource = { account: string; mailbox: string };
export type UnifiedWarning = { account: string; code: string; message: string };
export type UnifiedInboxResult = {
  envelopes: Envelope[];
  hasMore: boolean;
  warnings: UnifiedWarning[];
};
```

Extend `Envelope` with `source?: EnvelopeSource`.

Add the server query and function:

```ts
export type UnifiedInboxQuery = {
  accounts: readonly string[];
  page: number;
  pageSize: number;
  search?: SearchInput;
};

export function listUnifiedInbox(
  service: Pick<HimalayaService, "listMailboxes" | "listEnvelopes">,
  query: UnifiedInboxQuery,
): Promise<UnifiedInboxResult>;
```

- [ ] **Step 1: Write failing aggregator tests**

Cover these exact cases with a fake service:

```ts
it("finds INBOX case-insensitively and attaches the source", async () => {
  const result = await listUnifiedInbox(serviceWith({
    andre: { mailboxes: [mailbox("Inbox")], envelopes: [envelope("andre-1", "2026-09-18T10:00:00Z")] },
    anna: { mailboxes: [mailbox("INBOX")], envelopes: [envelope("anna-1", "2026-09-18T09:00:00Z")] },
  }), queryFor(["andre", "anna"]));
  expect(result.envelopes.map(({ id, source }) => [id, source])).toEqual([
    ["andre-1", { account: "andre", mailbox: "Inbox" }],
    ["anna-1", { account: "anna", mailbox: "INBOX" }],
  ]);
});

it("keeps successful accounts when one provider fails", async () => {
  const result = await listUnifiedInbox(serviceWithFailure("anna"), queryFor(["andre", "anna"]));
  expect(result.envelopes).toHaveLength(1);
  expect(result.warnings).toEqual([{ account: "anna", code: "AUTH_REQUIRED", message: "synthetic auth guidance" }]);
});

it("sorts ties deterministically and reports more data", async () => {
  const result = await listUnifiedInbox(serviceWithPages(), { ...queryFor(["andre"]), page: 2, pageSize: 2 });
  expect(result.envelopes.map((item) => item.id)).toEqual(["andre-3", "andre-4"]);
  expect(result.hasMore).toBe(true);
});
```

The fixtures must return `HimalayaError` for provider failures and use only
synthetic envelope data.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npx vitest run src/server/unified-inbox.test.ts`

Expected: FAIL because the aggregator and source field are not implemented.

- [ ] **Step 3: Implement validation and source lookup**

Deduplicate account aliases before work. Reject page values below 1, page sizes
below 1 or above 50, and pages above 10 with `HimalayaError("Invalid unified inbox page.", "INVALID_INPUT", false)` or the equivalent page-size message. For each account, call `listMailboxes`, find the first mailbox whose `id` or `name` equals `INBOX` case-insensitively, and convert a missing mailbox into warning code `INBOX_NOT_FOUND` with German message `Kein INBOX-Ordner für dieses Konto gefunden.`.

- [ ] **Step 4: Implement bounded source paging and merge**

Fetch up to `page * pageSize` envelopes per source using a fixed source page
size of 100 and sequential source pages. Process at most four accounts at a
time. Pass the same optional search object to every source call. Convert
`HimalayaError` failures to their stable code/message; convert unknown failures
to `MAIL_OPERATION_FAILED` and `Das Konto konnte nicht geladen werden.`. Sort
by valid date descending, then account alias and message id ascending, attach
`source`, slice the requested global page, and set `hasMore` when a source
returned a full source page or the merged data exceeds the requested end.

- [ ] **Step 5: Run aggregator tests and typecheck**

Run: `npx vitest run src/server/unified-inbox.test.ts && npm run typecheck`

Expected: PASS.

## Task 3: Expose the authenticated aggregate route

**Files:**
- Modify: `src/server/app.ts`
- Modify: `src/server/app.test.ts`

**Interfaces:**

Add `POST /api/unified/inbox` with this JSON body:

```ts
{
  accounts: string[];
  page?: number;
  pageSize?: number;
  field?: "all" | "subject" | "from" | "to" | "body";
  q?: string;
  unread?: boolean;
}
```

Return the `UnifiedInboxResult` shape with `Cache-Control: no-store`.

- [ ] **Step 1: Write failing API tests**

Add tests that assert:

```ts
it("requires the local session for unified inbox", async () => {
  const response = await app.inject({ method: "POST", url: "/api/unified/inbox", payload: { accounts: ["andre"] } });
  expect(response.statusCode).toBe(401);
});

it("passes account aliases and filters to the aggregate service", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/unified/inbox",
    headers: { host: "127.0.0.1", "x-himalaya-session": "test-token", "content-type": "application/json" },
    payload: { accounts: ["andre", "anna"], page: 1, pageSize: 25, field: "subject", q: "invoice", unread: true },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ envelopes: [], warnings: [], hasMore: false });
});

it("rejects an invalid alias before invoking Himalaya", async () => {
  const response = await authenticatedPost({ accounts: ["bad\u0000alias"] });
  expect(response.statusCode).toBe(400);
  expect(response.json().code).toBe("INVALID_REQUEST");
});
```

Use the existing fake service and spy on `listMailboxes`/`listEnvelopes` to
prove the request is scoped to the submitted aliases and does not read raw
messages.

- [ ] **Step 2: Run the focused API tests and verify failure**

Run: `npx vitest run src/server/app.test.ts -t "unified inbox"`

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Add the Zod body schema and route**

Validate aliases as a maximum-100 array of 1–512-character strings with a Zod
refinement rejecting `\u0000`, page 1–10, page size 1–50, the existing
search-field enum, query text maximum 512 characters, and a boolean unread
flag. Normalize empty `q` to no search. Call `listUnifiedInbox(service, ...)` and return its result. The
existing `onRequest` hook supplies loopback and session protection; do not add a
second authentication path.

- [ ] **Step 4: Run API tests and the security-focused checks**

Run: `npx vitest run src/server/app.test.ts -t "unified inbox|local session|invalid" && npm run typecheck`

Expected: PASS; no raw message or command output is present in the response.

## Task 4: Integrate account ordering into the client shell

**Files:**
- Modify: `src/client/main.tsx`
- Modify: `src/client/preferences.ts`
- Modify: `src/client/styles.css`

**Interfaces:**

The `App` component owns `accountOrder: string[]` and writes the normalized
value after every move. It passes the ordered account list to both the tree and
the account manager. Reorder handlers call
`moveAccount(accountOrder, accountName, direction)` and persist the result.

- [ ] **Step 1: Add the order state without changing selection behavior**

Read `ACCOUNT_ORDER_KEY` with the existing safe browser-storage helper after
bootstrap, normalize against the returned accounts, and choose the existing
default/saved account from the normalized selectable list. Keep the saved
account and active/visible preference fallback rules unchanged.

- [ ] **Step 2: Replace alphabetical rendering with ordered rendering**

Compute `orderedAccountList = orderedAccounts(accounts, accountOrder)` once per
render, then apply active/visible, query, and favorite filters. Pass the
canonical order into `filterAccounts` so favorites remain grouped without
destroying manual order.

- [ ] **Step 3: Add account-manager move controls**

Render each ordered account with German buttons `Nach oben verschieben` and
`Nach unten verschieben`, disabled at the boundaries, with `aria-label`
including the account alias. Keep the existing active/visible checkboxes and
reload action. After a move, focus remains on the moved account's control and a
polite live region says `Konto <alias> verschoben`.

- [ ] **Step 4: Run pure tests and typecheck**

Run: `npx vitest run src/client/account-order.test.ts src/client/preferences.test.ts && npm run typecheck`

Expected: PASS; the app still builds before the tree JSX is changed.

## Task 5: Replace the mailbox strip with a lazy account tree

**Files:**
- Modify: `src/client/main.tsx`
- Modify: `src/client/styles.css`

**Interfaces:**

Use this client cache shape:

```ts
type MailboxLoadState =
  | { status: "idle"; mailboxes: Mailbox[] }
  | { status: "loading"; mailboxes: Mailbox[] }
  | { status: "ready"; mailboxes: Mailbox[] }
  | { status: "error"; mailboxes: Mailbox[]; error: string };
type MailboxesByAccount = Record<string, MailboxLoadState>;
```

The tree renders a virtual `Alle Eingänge` row, ordered accounts, disclosure
buttons, account rows, and indented mailbox rows. It loads a mailbox list only
when an account changes from collapsed to expanded, caches successful results,
and keeps an account-scoped error row on failure.

- [ ] **Step 1: Add tree state and lazy loading**

Replace the single `mailboxes` state with `mailboxesByAccount`, an
`expandedAccounts` set, and per-account request sequence numbers. Expand the
selected account after bootstrap. Ignore stale responses when an account is
collapsed, reordered, or replaced by a newer request. Preserve the existing
selected-mailbox fallback (`saved mailbox`, `INBOX`, first visible mailbox).

- [ ] **Step 2: Add account and mailbox selection callbacks**

Keep `chooseAccount(name)` for normal mailbox views, add
`chooseUnifiedInbox()` that clears the selected mailbox/detail and resets page
one, and make `chooseMailbox(account, id)` set both selected account and
mailbox. Retain account-scoped mailbox favorite keys and the existing local
last-account/last-mailbox keys.

- [ ] **Step 3: Render the hierarchical navigation**

Remove the center `mailbox-toolbar` and its wrapped `.mailbox-tabs`. In the
left panel, render:

```tsx
<button aria-current={unifiedSelected ? "page" : undefined}>Alle Eingänge</button>
{visibleAccounts.map((account) => (
  <section key={account.name} aria-label={account.name}>
    {/* disclosure, account selection, favorite, reorder */}
    {/* loading/error/indented mailbox children */}
  </section>
))}
```

Use `aria-expanded` on disclosure buttons, `aria-current` on the selected
account/mailbox, German labels for folder selection and disclosure, and a text
fallback when the favorite folder filter has no results.

Keep `mailboxFilterMode` in the left panel as a compact `Ordner: Alle` /
`Ordner: Favoriten` control. For every expanded account, pass its cached
mailboxes through `filterMailboxes(account.name, state.mailboxes,
mailboxFilterMode, mailboxFavorites)` before rendering children. This preserves
the existing account-scoped mailbox favorite behavior without bringing back a
horizontal strip.

- [ ] **Step 4: Add pointer and keyboard reordering**

Set `draggable` on account rows and store the dragged alias in a ref. On drop,
move the dragged alias to the dropped row's index, normalize and persist the
result, then announce the German move message. Keep the explicit up/down
buttons as the keyboard path and call the same `moveAccount` helper for both
interaction modes.

- [ ] **Step 5: Implement the tree visual contract**

Give the navigation its own bounded scroll region. Use a consistent 20–24px
indent for child folders, muted folder icons/text, visible unread count pills,
and a compact reorder control group that appears on hover and remains keyboard
visible. Keep the existing theme variables and focus ring. Increase the first
grid column only enough to show alias/address plus indentation; do not restore
the old center overflow.

- [ ] **Step 6: Run the build checks**

Run: `npm run typecheck && npm run build`

Expected: PASS, with no `.mailbox-tabs` navigation remaining in the rendered
client.

## Task 6: Connect the unified inbox to the message list and reader

**Files:**
- Modify: `src/client/main.tsx`
- Modify: `src/client/styles.css`

**Interfaces:**

Add client response types:

```ts
type UnifiedInboxResponse = {
  envelopes: Envelope[];
  hasMore: boolean;
  warnings: UnifiedWarning[];
};
```

Extend the existing `api` helper to accept an optional `RequestInit`, while
keeping the current GET call sites unchanged.

- [ ] **Step 1: Add the unified message-loading branch**

When `unifiedSelected` is true, POST the ordered active/visible account names
to `/api/unified/inbox` with the current page, page size, search field/text,
and unread flag. Set the returned envelopes and warnings, and use `hasMore` to
control the next-page button. When a normal mailbox is selected, keep the
existing GET route and clear unified warnings.

- [ ] **Step 2: Make message opening source-aware**

Build a `MessageRef` from `envelope.source` for unified rows and from the
selected account/mailbox for normal rows. If a unified envelope lacks source
metadata, show the existing German request error and do not call `/api/message`.
Keep seen-state updates, move, attachment, Markdown export, PDF printing, and
explicit AI requests using the resulting ref.

- [ ] **Step 3: Add source labels and partial warnings**

Render `account · mailbox` in unified envelope metadata. Above the list, show
the number of affected accounts and each safe warning. Show an explicit empty
state when no active/visible account remains, and distinguish it from
`Keine Nachrichten gefunden`.

- [ ] **Step 4: Verify existing and unified state transitions**

Confirm that selecting a normal mailbox clears unified warnings, selecting
`Alle Eingänge` clears stale detail state, page changes do not reuse an old
account reference, and stale async responses cannot overwrite a newer view.

- [ ] **Step 5: Run typecheck and unit tests**

Run: `npm run typecheck && npm test`

Expected: PASS for all existing 0.3.0 tests plus the new shared/client tests.

## Task 7: Add synthetic browser coverage

**Files:**
- Create: `tests/e2e/account-tree-unified-inbox.spec.ts`
- Modify: `playwright.config.ts` only if the existing deterministic server setup cannot serve the new route mocks.

- [ ] **Step 1: Add synthetic route fixtures**

Mock two accounts, two mailbox lists, one normal account message route, one
unified POST response with envelopes from both accounts, and the existing
message/seen routes. Use subjects and addresses under `example.test` only.

- [ ] **Step 2: Test tree hierarchy and lazy mailbox loading**

Navigate to `/`, assert `Alle Eingänge` and both accounts are visible, expand
one account, assert its `Inbox` is nested below it, and assert the other
account's mailbox endpoint was not requested before expansion.

- [ ] **Step 3: Test order persistence**

Use the visible move control to move the second account above the first, reload
the page, and assert the account row order remains changed. Inspect browser
storage only for the alias array key; never store or assert message content in
storage.

- [ ] **Step 4: Test unified selection and source-aware opening**

Click `Alle Eingänge`, assert the unified POST body contains only the active
and visible aliases, assert both source labels render, click one message, and
assert the message request URL contains that message's source account and
mailbox. Assert no AI route is called merely by selecting the message.

- [ ] **Step 5: Run the browser test**

Run: `npx playwright test tests/e2e/account-tree-unified-inbox.spec.ts`

Expected: PASS with synthetic data and no provider access.

## Task 8: Update operator documentation and perform the full verification

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update README behavior statements**

Describe the hierarchical account tree, browser-local account order key,
lazy-loaded folders, and `Alle Eingänge`. Remove the statement that the app
has no unified-inbox workflow. State that the aggregate view includes active
and visible `INBOX` folders only and tolerates per-account failures.

- [ ] **Step 2: Add a changelog entry**

Record the account tree, manual order controls, lazy folder loading, unified
inbox source labels, and partial-warning behavior in English project docs.

- [ ] **Step 3: Run the complete verification suite**

Run each command separately:

```bash
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
npx playwright test
```

Expected: all commands pass, the audit reports zero high-severity
vulnerabilities, and the browser suite uses only synthetic fixtures.

- [ ] **Step 4: Review the final diff for privacy and scope**

Run `git diff --check` and inspect only the feature paths plus the intended
documentation changes. Confirm that no credentials, API keys, message bodies,
real provider output, or browser storage snapshots were added. Confirm the
service remains loopback-only and the existing session hook still covers the
new route.

## Execution Notes

This plan intentionally does not include commit commands. The repository has a
pre-existing uncommitted release slice and its instructions require explicit
authorization before implementation commits. Each task has a focused test or
build checkpoint; once the feature is verified, the user can request a single
explicit Conventional Commit and push workflow.
