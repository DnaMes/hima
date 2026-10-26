# Cross-Folder / Cross-Account Search and Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Search across folders and accounts with date, flag/read-state, sort-order and attachment filters, without mutating or persisting any mail.

**Architecture:** Extend `SearchInput`/`buildSearchQuery` with the new filters (Task 1); generalize the unified-inbox merge from "INBOX per account" to a list of `(account, mailbox)` sources (Task 2); expose it as `POST /api/search` and let the two existing list routes take the same filters (Task 3); a pure client `search-state.ts` (Task 4) drives a scope switch (Task 5) and a filter panel with chips (Task 6); Task 7 verifies against real mail read-only and ships.

**Tech Stack:** TypeScript (strict), Fastify + zod, React 19, Vitest, Playwright, Himalaya CLI v2.1.

**Spec:** `docs/superpowers/specs/2026-10-02-himalaya-web-cross-folder-search-design.md`

## Global Constraints

- Search is read-only and loopback-only; no mail content is written to disk; session/loopback boundary unchanged.
- UI text is German; code, tests, docs, commits are English. Tests use synthetic data only.
- Himalaya DSL facts (verified): no `before`; `after D` excludes day D; inclusive start `X` = `after (X-1 day)`, inclusive end `Y` = `not after Y`; `order by date asc` and a leading `not …` are accepted; `--has-attachment` only fills `Envelope.hasAttachment`, it is not a filter.
- At most 60 sources per request (`MAX_SOURCES = 60`); source concurrency stays 4; per-source window stays `UNIFIED_INBOX_MAX_PAGE * pageSize`.
- Default scope is "Dieser Ordner" (today's behavior); scope and filters are not persisted.
- Date filter label: "Datum (Sendedatum)". Attachment hint: "Seite kann weniger Treffer enthalten".
- One commit for the slice, made by `git-ops` only after the operator says go; never stage `src/server/rules.ts` / `src/server/rules.test.ts` (another session's work).

## Review Focus

- Filter-only search with empty text (e.g. only `unread`, only a date) must run `envelope search`, not `envelope list` — Task 1 test.
- Impossible dates (`2026-02-30`), `from` after `until`, `scope: "folder"` without `mailbox`, `scope: "all"` with no accounts → `400 INVALID_INPUT`, never a CLI error — Task 3 tests.
- One folder or account failing mid-search returns the other hits plus a warning naming account and mailbox — Task 2 test.
- Identical timestamps across mailboxes and pages beyond the first stay deterministic (no duplicate or missing hit between page 1 and 2); undated mail sorts last in both directions — Task 2 tests.
- A hit from another account than the open one must open, mark seen and move through its own `source`, not the selected mailbox — Task 5 Playwright test.

---

### Task 1: Search contract and `listEnvelopes` switch

**Files:**
- Modify: `src/server/contracts.ts`, `src/server/himalaya.ts` (`listEnvelopes`)
- Test: `src/server/contracts.test.ts`, `src/server/himalaya.test.ts`

**Interfaces:**
- Produces (`contracts.ts`):
  - `type SearchFlag = "flagged" | "seen" | "unseen" | "answered"`, `type SearchOrder = "desc" | "asc"`
  - `SearchInput` gains `from?: string; until?: string; flag?: SearchFlag; order?: SearchOrder` (dates `YYYY-MM-DD`, inclusive)
  - `isoDateSchema` (zod string: `^\d{4}-\d{2}-\d{2}$` and a real calendar date)
  - `previousDay(date: string): string` (throws `Error("Invalid date")` on a non-calendar date)
  - `hasSearchCriteria(search: SearchInput | undefined): boolean` — true if non-blank `text`, `unread`, `from`, `until`, `flag`, or `order === "asc"`
  - `buildSearchQuery(input: SearchInput): string[]` — clauses joined by `"and"` in this order: text, `after <previousDay(from)>`, `not after <until>`, flag (`flagged`→`flag flagged`, `seen`→`flag seen`, `unseen`→`not flag seen`, `answered`→`flag answered`), unread (`not flag seen`, skipped when `flag === "unseen"`); then `order by date asc` appended without `and` when `order === "asc"`. Blank text emits no text clause. Existing outputs for text/unread stay byte-identical.

- [ ] **Step 1: Write the failing tests** in `contracts.test.ts`:
  - `buildSearchQuery({field:"all",text:"",from:"2026-09-30"})` → `["after","2026-09-29"]`
  - rollover: `from` `2026-03-01`→`"2026-02-28"`, `2026-01-01`→`"2025-12-31"`, `2028-03-01`→`"2028-02-29"` (via `previousDay`)
  - `{field:"all",text:"",until:"2026-09-30"}` → `["not","after","2026-09-30"]`
  - `{field:"subject",text:"x",from:"2026-09-25",until:"2026-09-30",flag:"unseen"}` → `["subject","x","and","after","2026-09-24","and","not","after","2026-09-30","and","not","flag","seen"]`
  - `{field:"all",text:"",order:"asc"}` → `["order","by","date","asc"]`; with `text:"x",field:"subject"` → `["subject","x","order","by","date","asc"]`
  - `{unread:true, flag:"unseen"}` emits `not flag seen` once
  - `hasSearchCriteria`: `undefined`→false, blank text→false, `order:"desc"` only→false, `order:"asc"`→true, `unread`→true, `from`→true
  - `isoDateSchema.safeParse("2026-02-30").success === false`, `"2028-02-29"` ok, `"2026-9-1"` rejected; `previousDay("2026-02-30")` throws.
- [ ] **Step 2:** In `himalaya.test.ts` (existing `RecordingRunner`) add: `listEnvelopes` with `search:{field:"all",text:"",unread:true}` → the args between `"search"` and `"--mailbox"` equal `["not","flag","seen"]`; with `search` undefined the args contain `"list"`. Run `npx vitest run src/server/contracts.test.ts src/server/himalaya.test.ts` → FAIL.
- [ ] **Step 3: Implement** the interfaces above in `contracts.ts` (UTC date arithmetic via `Date.UTC`, round-trip check for calendar validity); in `himalaya.ts` switch `listEnvelopes` to `search` when `query.search && hasSearchCriteria(query.search)`.
- [ ] **Step 4:** Run the two test files plus `npx vitest run src/server/watcher.test.ts` → PASS (the watcher's `{text:"",unread:true}` call now becomes a real unread search; call arguments are unchanged).

### Task 2: Source resolution and multi-source merge

**Files:**
- Create: `src/server/search-scope.ts`, `src/server/search-scope.test.ts`
- Modify: `src/server/unified-inbox.ts`, `src/shared/types.ts` (`UnifiedWarning` gains `mailbox?: string`)
- Test: `src/server/search-scope.test.ts`, `src/server/unified-inbox.test.ts` (must stay green unchanged)

**Interfaces:**
- Consumes: Task 1 `SearchInput`; `HimalayaService.listMailboxes`/`listEnvelopes`; `HimalayaError`.
- Produces (`search-scope.ts`):
  - `type SearchScope = "folder" | "account" | "all"`, `type SourceRef = { account: string; mailbox: string }`, `const MAX_SOURCES = 60`
  - `isJunkOrTrash(mailbox: Mailbox): boolean` — case-insensitive match of id or name against `junk|spam|trash|papierkorb|deleted messages|deleted items|gelöschte elemente`, also as the last `/` segment (`[Google Mail]/Spam`)
  - `resolveSources(service: Pick<HimalayaService,"listMailboxes">, input: { scope: SearchScope; accounts: readonly string[]; current?: SourceRef; includeJunk: boolean }): Promise<{ sources: SourceRef[]; warnings: UnifiedWarning[] }>` — `folder` → `[current]` without listing; `account` → all mailboxes of `current.account`; `all` → all mailboxes of each account in order. Junk/trash dropped unless `includeJunk`. A failing `listMailboxes` becomes a warning (code from `HimalayaError` else `MAIL_OPERATION_FAILED`). Beyond `MAX_SOURCES` the rest are dropped with one warning per affected account: `{account, code:"SOURCE_CAP", message:"<n> Ordner nicht durchsucht (Obergrenze 60)."}`.
- Produces (`unified-inbox.ts`): `listSources(service: Pick<HimalayaService,"listEnvelopes">, sources: readonly SourceRef[], query: { page: number; pageSize: number; search?: SearchInput }): Promise<UnifiedInboxResult>` — the existing window/concurrency/merge/validation logic, per source; warnings carry `mailbox`; sort = date (direction `search?.order`, undated last in both directions), then account, mailbox, id. `listUnifiedInbox` keeps its signature and behavior: it resolves each account's INBOX (existing `INBOX_NOT_FOUND`/failure warnings) and delegates to `listSources`.

- [ ] **Step 1: Write the failing tests** (fake service in the style of `unified-inbox.test.ts`):
  - `resolveSources`: scope `account` returns every mailbox of that account only; `all` returns accounts in order; `[Google Mail]/Spam`, `Junk`, `Papierkorb`, `Deleted Messages` excluded by default and included with `includeJunk: true`; 70 mailboxes across 2 accounts → 60 sources + one `SOURCE_CAP` warning per account that lost folders; one account's `listMailboxes` rejecting with `HimalayaError("x","AUTH_REQUIRED",false)` → warning `AUTH_REQUIRED`, other accounts still resolved.
  - `listSources`: two accounts × two mailboxes merge newest-first; with `search.order:"asc"` oldest-first; equal timestamps across mailboxes order by account, mailbox, id and page 2 has no overlap/gap with page 1; an undated envelope is last in both directions; one source throwing → its warning has `account` and `mailbox` and the other sources' hits are returned.
- [ ] **Step 2:** `npx vitest run src/server/search-scope.test.ts` → FAIL.
- [ ] **Step 3: Implement** as specified; refactor `listUnifiedInbox` into a thin caller. Reuse the existing `SOURCE_PAGE_SIZE`, `ACCOUNT_CONCURRENCY` and window math.
- [ ] **Step 4:** `npx vitest run src/server/search-scope.test.ts src/server/unified-inbox.test.ts` → PASS (the old file unchanged proves no regression).

### Task 3: `POST /api/search` and filters on the existing routes

**Files:**
- Modify: `src/server/app.ts`
- Test: `src/server/app.test.ts` (same headers/token setup as the existing unified-inbox route tests)

**Interfaces:**
- Consumes: Tasks 1–2 (`isoDateSchema`, `hasSearchCriteria`, `resolveSources`, `listSources`); existing `withRisk`.
- Produces: `POST /api/search`, body (zod): `{ scope: "folder"|"account"|"all"; accounts: string[] (max 100, default []); account?: string; mailbox?: string; includeJunk: boolean = false; page (1..UNIFIED_INBOX_MAX_PAGE); pageSize (1..50, default 50); field; q (max 512, default ""); unread: boolean = false; from?: isoDate; until?: isoDate; flag?: SearchFlag; order: SearchOrder = "desc"; hasAttachment: boolean = false }`. Refinements: `from <= until`; `folder` needs `account`+`mailbox`; `account` needs `account`; `all` needs ≥1 `accounts`. Response: `UnifiedInboxResult` (envelopes carry `source` and watcher `risk`; `hasAttachment: true` keeps only `envelope.hasAttachment === true`, `hasMore` untouched; warnings = source-resolution warnings + merge warnings). `GET /api/accounts/:account/messages` (query) and `POST /api/unified/inbox` (body) accept optional `from`, `until`, `flag`, `order` and build `search` whenever `hasSearchCriteria` holds (not only with `q`).

- [ ] **Step 1: Write the failing tests:** `400` + `code:"INVALID_INPUT"` for `from:"2026-02-30"`, `from > until`, `scope:"folder"` without `mailbox`, `scope:"all"` with `accounts:[]`; scope `account` calls `listMailboxes` once and searches each folder; `includeJunk` default excludes the Spam folder; `hasAttachment:true` drops envelopes with `hasAttachment` `false`/`null`; a watcher verdict appears as `risk` on a hit; `GET …/messages?mailbox=INBOX&flag=unseen` (no `q`) reaches `listEnvelopes` with `search.flag === "unseen"`; unified inbox with `from` and no `q` likewise.
- [ ] **Step 2:** `npx vitest run src/server/app.test.ts` → FAIL.
- [ ] **Step 3: Implement** the route and schemas in `app.ts`; extract the unified route's per-envelope risk mapping into one helper both routes share; map zod failures through the existing error handler (already yields `INVALID_INPUT`).
- [ ] **Step 4:** `npx vitest run` (whole suite; the 3 `rules.test.ts` logging failures are another session's) and `npm run typecheck` → PASS.

### Task 4: Pure client search state

**Files:**
- Create: `src/client/search-state.ts`, `src/client/search-state.test.ts`

**Interfaces:**
- Produces:
  - `type SearchScope = "folder"|"account"|"all"`; `type SearchFilters = { scope: SearchScope; includeJunk: boolean; from: string; until: string; flag: ""|"flagged"|"seen"|"unseen"|"answered"; order: "desc"|"asc"; hasAttachment: boolean }`; `const DEFAULT_FILTERS: SearchFilters` (`folder`, `false`, `""`, `""`, `""`, `"desc"`, `false`)
  - `type FilterChip = { key: keyof SearchFilters; label: string }`; `activeChips(filters: SearchFilters): FilterChip[]` — German labels: `Dieses Konto`/`Alle Konten` (scope ≠ folder), `Von 30.09.2026`, `Bis 30.09.2026`, `Markiert`/`Gelesen`/`Ungelesen`/`Beantwortet`, `Älteste zuerst`, `Mit Anhang`, `Auch Papierkorb/Spam`
  - `clearFilter(filters: SearchFilters, key: keyof SearchFilters): SearchFilters` (resets that key to its default)
  - `filterFields(filters: SearchFilters): { from?: string; until?: string; flag?: string; order?: "asc" }` (non-default values only; `order` only when `asc`)
  - `searchBody(args: { filters: SearchFilters; text: string; field: string; unread: boolean; page: number; pageSize: number; accounts: readonly string[]; current: { account: string; mailbox: string } | null }): Record<string, unknown>` — the `/api/search` body
  - `usesSearchRoute(filters: SearchFilters): boolean` — `scope !== "folder"`
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing tests:** defaults → `activeChips` is `[]`; each non-default value yields the labelled chip (assert the exact German strings above, date formatted `DD.MM.YYYY`); `clearFilter` of `from` leaves the others; `filterFields` omits defaults and `order:"desc"`; `searchBody` for scope `all` sends `accounts` and no `account`/`mailbox`, for `account` sends `account` from `current`, `from`/`until`/`flag` only when set; `usesSearchRoute` false for `folder`.
- [ ] **Step 2:** `npx vitest run src/client/search-state.test.ts` → FAIL.
- [ ] **Step 3: Implement** the module (pure, no React).
- [ ] **Step 4:** run the test file → PASS.

### Task 5: Scope switch and request wiring

**Files:**
- Modify: `src/client/main.tsx`, `src/client/styles.css`
- Test: `tests/e2e/cross-folder-search.spec.ts` (new)

**Interfaces:**
- Consumes: Task 4 module; routes from Task 3.
- Produces: a `searchFilters` state (`SearchFilters`, default `DEFAULT_FILTERS`) and `multiSource = unifiedSelected || usesSearchRoute(searchFilters)`. A scope `<select aria-label="Suchbereich">` beside the search field: single-account view offers "Dieser Ordner", "Dieses Konto (alle Ordner)", "Alle Konten (alle Ordner)"; unified view offers "Alle Eingänge (Posteingänge)" and "Alle Konten (alle Ordner)". Requests: `folder` → existing routes (single account: GET messages with `filterFields`; unified: POST unified with `filterFields`); `account`/`all` → `POST /api/search` via `searchBody`. Everywhere `main.tsx` branches on `unifiedSelected` for list rows, row source (`envelope.source ?? {account: selectedAccount, mailbox: selectedMailbox}`), warnings (now `account/mailbox: message`), empty state and reload keys, use `multiSource`. Changing scope resets page to 1 and clears the reader selection like a search does.

- [ ] **Step 1: Write the failing Playwright tests** (synthetic routes for bootstrap, mailboxes, `/api/search`, `/api/accounts/*/messages`, `/api/message`, `/api/message/seen`; follow `tests/e2e/unified-account-switch.spec.ts`): choosing "Alle Konten (alle Ordner)" and searching posts to `/api/search` with `scope:"all"` and the current `accounts` list; "Dieses Konto (alle Ordner)" posts `scope:"account"` with the open account; "Dieser Ordner" still GETs `/api/accounts/…/messages`; a hit with `source:{account:"beta",mailbox:"Archive"}` shown while `alpha` is open opens via `/api/message?account=beta&mailbox=Archive&…` and marking it seen posts `ref` with `beta`/`Archive` (Review Focus 5); a warning with `mailbox` renders as `beta/Archive: <message>`.
- [ ] **Step 2:** `npx playwright test tests/e2e/cross-folder-search.spec.ts` → FAIL.
- [ ] **Step 3: Implement** the state, select, request branching and `multiSource` replacements (grep `unifiedSelected` in `main.tsx` and review each hit: tree/account-selection uses stay, list/row/source/warning uses switch).
- [ ] **Step 4:** run the new spec and the whole Playwright suite (`npx playwright test`) plus `npm run typecheck` → PASS.

### Task 6: Filter panel, chips and attachment hint

**Files:**
- Modify: `src/client/main.tsx`, `src/client/styles.css`
- Test: `tests/e2e/cross-folder-search.spec.ts`

**Interfaces:**
- Consumes: Task 4 (`activeChips`, `clearFilter`), Task 5 state.
- Produces: a collapsible `<details>` "Filter" under the search form with: date inputs "Datum (Sendedatum) von"/"bis" (`type="date"`), flag select ("Alle", "Markiert", "Gelesen", "Ungelesen", "Beantwortet"), sort select ("Neueste zuerst"/"Älteste zuerst"), checkboxes "Nur mit Anhang" and (only for `account`/`all` scope) "Papierkorb/Spam einschließen"; removable chips (`button` with `aria-label="Filter entfernen: <label>"`) from `activeChips`; with "Nur mit Anhang" on, the hint "Seite kann weniger Treffer enthalten" shows under the toolbar. Filters apply on "Suchen" like the other criteria, so a filter-only search (empty text) runs; the attachment filter is applied client-side to the received page only when the GET/unified routes are used (the search route does it server-side via `hasAttachment`).

- [ ] **Step 1: Write the failing Playwright tests:** setting from/until + "Ungelesen" and clicking "Suchen" with empty text sends a request containing those values (GET query for folder scope, `/api/search` body otherwise) and shows chips `Von …`, `Bis …`, `Ungelesen`; clicking a chip's remove button drops that field from the next request; "Nur mit Anhang" shows the hint and hides an envelope with `hasAttachment:false` on the folder route; "Papierkorb/Spam einschließen" is absent in folder scope and sends `includeJunk:true` otherwise.
- [ ] **Step 2:** run the spec → FAIL.
- [ ] **Step 3: Implement** the panel, chips and hint.
- [ ] **Step 4:** `npx playwright test` (all) and `npm run typecheck` and `npm test` → PASS.

### Task 7: Real-mail check, docs, release

**Files:**
- Modify: `package.json`, `package-lock.json` (version `0.11.0`), `src/shared/app-meta.test.ts`, `README.md`, `HANDOFF.md`, spec (replace "resolveSpecialFolder for trash" with the regex matcher actually used)
- Create (not committed): `/tmp/live-search-check.mts`

- [ ] **Step 1: Live read-only check** with a one-off `tsx` script using `HimalayaCli`: (a) on account `andre`, INBOX, `listEnvelopes` with `from:"2026-09-29", until:"2026-09-29"` returns exactly the same ids as the DSL's own `date 2026-09-29`; (b) `resolveSources`+`listSources` with scope `all` over all configured accounts (default junk exclusion): print wall time, source count, warnings, hit count. Pass criteria: (a) identical id sets; (b) finishes under 60 s without a thrown error. If (b) is slower, lower `MAX_SOURCES` or add a note to the spec's Risks with the measured numbers. Never call a mutating command.
- [ ] **Step 2:** Bump version to `0.11.0` (package.json, lock lines 3 and 9, `app-meta.test.ts`).
- [ ] **Step 3:** Delegate README/HANDOFF/spec upkeep to `doc-ops` (no commit, no board items, no vault) with the measured numbers from Step 1.
- [ ] **Step 4:** `npm run typecheck && npm test && npx playwright test && npm run build` → all green except the 3 foreign `rules.test.ts` logging tests.
- [ ] **Step 5:** After the operator's go: `git-ops` commits one `feat: add cross-folder search and filters (0.11.0)` with explicit paths (no `rules*`), pushes `main`; then `npm run build` and `systemctl --user restart himalaya-web.service`, check HTTP 200 on `127.0.0.1:47831`.
