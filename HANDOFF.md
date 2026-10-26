# HANDOFF — Himalaya Web

## Goal

Standalone, loopback-only local browser GUI for the installed Himalaya v2.1.0
CLI, growing into a full mail client (roadmap in
`/home/dnames/.claude/plans/pasted-content-id-35ee-using-superpower-curried-reddy.md`)
without ever moving credentials into the project or mutating real mail during
automated tests.


## Quick state (read this first)

- Shipped and live: **0.35.0** — **Hima** ("Your local mail workspace, powered by Himalaya"). Public open source release live at `https://github.com/DnaMes/hima`, portfolio repository set up at `~/projects/business/erdlabs/apps/hima`. Includes URL-encoded auth bypass fix, draft isolation namespacing, stdin streaming for compose, authentic vector logos, horizontal tabs, Superhuman 2-line cards, and focused reading pane. Earlier: 0.34.0 (spacious middle message frame with `clamp(520px, 34vw, 640px)`), 0.33.0 (horizontal tabs, collapsible search), 0.32.0 (ultra-slim 42px header), 0.30.0 (vector logos), 0.28.7 (threading).
- Health: typecheck/build clean; unit 770/770 passing across 57 test files; Playwright 133/133 passing; `npm audit --omit=dev` 0 vulnerabilities. Live service: `systemctl --user status himalaya-web.service` active and healthy at `http://127.0.0.1:47831/`.
- Repositories:
  - Working service tree: `~/projects/tools/himalaya-web` (git origin: `ssh://git@100.119.46.15:2222/erdna/himalaya-web.git`)
  - Public open source tree: `~/projects/business/erdlabs/apps/hima` (git origin: `git@github-personal:DnaMes/hima.git`)
- Real-UI verification (2026-10-26, live service): verified generous middle frame width, clean 2-line unclipped message items, authentic brand logos, single stars, calm hover states, and focused reader view.

## Current Progress
- **Doc-ops (2026-10-26, research refs + vault sync).** Fixed dead backticked paths in `docs/research/2026-10-phishing-heuristics-and-feature-gaps.md` (rspamd redirectors map, URLhaus/Mozilla/Google support URLs were host-looking tokens the checker treated as repo paths). Replaced embedded HIBP dollar tiers with pointers to the HIBP Subscription page and to `~/projects/ai-stack/docs/roles.md` / `~/projects/ai-stack/subscriptions/SUBSCRIPTIONS.md` for stack costs. Marked the research top-10 feature gaps as shipped in 0.35.0. Synced `AGENTS.md` parachute state and `~/ObsidianVault/2-Projects/tools/himalaya-web/index.md` to 0.35.0. Verified with `~/projects/ai-stack/claude/bin/doc-refs-check.sh`: 0 missing on the research note and on README/HANDOFF/AGENTS/SECURITY/CHANGELOG. No commit.
- **Version 0.30.0 (2026-10-26, authentic provider logos & full modern UI/UX overhaul) implemented and verified.**
  - **Authentic Brand Vector Logos (`src/client/provider-logos.tsx`):**
    - **Lima-City:** Replaced generic placeholder with the official server rack circuit arch vector extracted directly from `https://mail.lima-city.de/lima-city-branding/logo-small.svg`.
    - **Google Mail:** Replaced generic envelope with official 2020+ multi-color Google Workspace 'M' mark (`#4285F4`, `#34A853`, `#FBBC04`, `#EA4335`, `#C5221F`).
    - **Goneo:** Replaced basic circle with official goneo white 'g' mark and lime accent sphere (`#78be20`) on deep navy blue (`#003865`) from `goneo.de`.
    - **Microsoft Outlook:** Official layered blue envelope and 'O' vector mark.
    - **Apple iCloud:** Official iCloud gradient cloud shape from Simple Icons.
    - **Proton Mail:** Official Proton purple vector mark from Simple Icons.
    - **GMX & WEB.DE:** Official trademark vector paths from Wikipedia / Brand assets.
    - **Mailbox.org:** Official folded envelope cross mark.
    - **Fastmail, Hetzner, IONOS, STRATO, Posteo:** Authentic brand vector marks.
  - **Modern UI/UX Overhaul (Linear / Superhuman / Apple Mail tier):**
    - Double-bezel layout architecture with subtle ambient depth, macro-whitespace, and calm border contrast.
    - Modern typography hierarchy with system sans-serif stack, antialiased font smoothing, and tabular numbers for counters, dates, and times.
    - Upgraded multi-line envelope rows in message list with generous breathing room, vibrant glowing unread status dots, high-contrast sender/subject styling, and smooth cubic-bezier hover elevation (`transform: translateY(-1px)`).
    - Refined command-center floating topbar with brand eyebrow badge, live connection status indicator, and modern theme selector pill.
    - Elevated reader panel with large sender avatar, clear action toolbar, and spacious reading measure (`text-wrap: pretty`, line height 1.7).
    - Upgraded provider logo squircle containers (`20px` logo size, `30x30px` squircle) across sidebar accounts and account manager dialog.
  - **Full test coverage:** 57 test files, 766 unit tests, and all Playwright E2E tests passing.
- **Version 0.29.0 (2026-10-26, provider detection engine & initial vector icons) implemented and verified.**
  - **Visual & UI/UX redesign:** calming modern design system inspired by Linear, Superhuman, and Apple Mail. Sans-serif system font stack replacing serif titles, subtle surface elevation, calm borders, cleaner spacing, and improved readability across all three panes.
  - **Vector icons library (`src/client/icons.tsx`):** 40+ crisp, accessible SVG icons (`currentColor`, flexible sizing, `aria-hidden`) replacing Unicode emoji glyphs throughout the app.
  - **Authentic vector provider logos (`src/client/provider-logos.tsx`):** dedicated vector marks for Gmail, Apple iCloud, Goneo, lima-city, Microsoft Outlook, Fastmail, Proton Mail, GMX, Web.de, Posteo, Mailbox.org, Strato, Hetzner, Ionos, and custom domain fallback.
  - **Automatic provider detection (`src/server/account-config.ts`):** analyzes IMAP server host and email address domain from `himalaya.toml` to automatically classify accounts into their corresponding brand identity.
  - **Full test coverage:** added unit tests for icons (`icons.test.tsx`), provider logos (`provider-logos.test.tsx`), account config (`account-config.test.ts`), and updated layout contracts and metadata tests.
  - **Verified:** typecheck and build clean; unit 766/766 tests passing; Playwright E2E passing.
- **Version 0.28.0 (2026-10-26, header-based threading) implemented and verified; the live service runs it.**
  - **Finding:** the list view does carry Message-ID. `himalaya --json envelope list` returns `message-id` and `in-reply-to` (array) for every envelope (checked on the real andre account: all 150 sampled inbox rows had a Message-ID, 6 an In-Reply-To). The app's zod `envelopeSchema` in `src/server/contracts.ts` had dropped them. The earlier claim that header threading was deliberately not built, because the list has no Message-ID, was wrong.
  - **Shipped:** `src/server/contracts.ts` parses `"message-id": z.string().nullish()` and `"in-reply-to": z.array(z.string()).nullish()`; `parseEnvelopes` adds `messageId` and `inReplyTo` (trimmed, only when present) to the shared `Envelope` type (`src/shared/types.ts`, both optional). `src/client/threads.ts` `groupThreads` uses union-find over Message-ID and In-Reply-To nodes (ids compared without angle brackets, case-insensitive, scoped per account): a reply joins its parent, replies to the same parent that is missing from the page stay together, and a changed subject does not break the chain. Envelopes with neither id fall back to the old subject match; header-linked and subject-only groups never mix. The grouping scope in `src/client/message-list.tsx` is now the account only (it was account and folder).
  - **Measured live (150 real inbox rows, read-only):** subject-only grouping folded 150 rows into 119 (mostly unrelated newsletters sharing a subject); header grouping gives 149 rows with the one real conversation grouped.
  - **Also in this release:** a label filter that vanished is forgotten for good (`useEffect` in `src/client/main.tsx`); the temp files of `labels.json` and `snoozed.json` are removed before being rewritten (`src/server/labels.ts`, `src/server/snooze.ts`); the app test for a failing labels file now makes the final rename fail.
  - **Tests:** new cases in `src/client/threads.test.ts` (chain, missing parent, brackets and case, account scope, subject fallback) and a `parseEnvelopes` case in `src/server/contracts.test.ts`.
  - **0.28.1 fixes (review gate):** `groupThreads` uses only the last In-Reply-To id as the parent (`parentOf` in `src/client/threads.ts`); grouping across folders of one account (Inbox plus Sent copies) is intended; `src/server/contracts.ts` ignores threading fields of an unexpected type (`.catch(undefined)`) and accepts a single `in-reply-to` string; the temp-file cleanup in `labels.ts`/`snooze.ts` no longer recurses.
  - **0.28.2 fixes (review gate):** `labels.ts` and `snooze.ts` write to a unique temp file (`<path>.<pid>.<time>.tmp`) and remove it on failure; `src/server/contracts.ts` keeps the text entries of an `in-reply-to` array that also holds non-text entries; `groupThreads` computes the parent once.
  - **0.28.3:** temp files of `labels.json`/`snoozed.json` are named with a UUID and flushed before the rename; the live re-request schedule was observed in the real browser (0.2 s, 6.2 s, 16.2 s after load with a warm cache; none after a cold 11.6 s load).
  - **0.28.4:** `src/server/durable-write.ts` `writeFileDurably` (random temp file, mode 0600, flush, rename, directory flush, temp removed on failure) is the single write path of `labels.ts` and `snooze.ts`; `senders.ts` and `rules-store.ts` still use their own temp-file writes (not changed).
  - **0.28.5:** `writeFileDurably` only ignores directory-flush errors that mean "unsupported" (logs the rest), creates new directories 0700 and sweeps its own stale `<name>.<uuid>.tmp` files older than an hour before each write.
  - **0.28.6 (found by a 30 min soak test on the live service, 19 accounts, read-only):** 31 requests, 0 non-200, RSS flat at 60 MB, but 6 of 30 warm requests took more than 1 s (max 7.7 s) because the GUI waited for the warmer's running fetch. `CachingRunner` entries now keep `value` and `previous`; the stale (GUI) view serves the older answer at once while a fetch is pending (test in `caching-runner.test.ts`). Second soak after the fix (12 min, 13 requests): 0 errors, RSS flat at 62 MB, after the first request median 103 ms, max 135 ms, none over 1 s. Also `ENOSYS` is an unsupported directory flush, the stale-temp sweep runs once per file and process, flush error handling is tested.
  - **0.28.7:** `CachingRunner` joins a pending fetch regardless of its age (no second spawn after the TTL); `writeFileDurably` marks a file as swept only after the directory was readable (test with `chmod 0o300`, mutation-checked).
  - **Verified:** typecheck and build clean; unit 673/673; Playwright 132/132; `npm audit --omit=dev` 0 vulnerabilities; live service `himalaya-web.service` restarted on 0.28.0.
  - **Still open:** nothing required.
- **Version 0.27.0 (2026-10-26, local labels, roadmap Slice 4) implemented and verified in the real UI; the live service runs it.**
  - **Decision:** Himalaya's `flag` command only exposes seen/answered/flagged/draft, so tags cannot be IMAP keywords. Labels are local to this GUI, like snooze, and never change the mail.
  - **Server:** `src/server/labels.ts` (`createLabelStore`, `normalizeLabels`: trim, collapse spaces, case-insensitive dedupe, max 5 per message, max 24 characters, no control characters). File `~/.config/himalaya-web/labels.json` (override `HIMALAYA_WEB_LABELS_PATH`), mode 0600, max 5000 labeled messages, atomic write. `POST /api/labels {ref, labels[]}` replaces a message's labels (empty removes); `GET /api/bootstrap` also returns labels. The move, delete and report routes drop the labels of the moved or deleted message because it gets a new id. New `createApp` option `labelsPath`.
  - **Client:** `src/client/labels.ts` (`labelNames`, `hasLabel`, `addLabels`); `src/client/main.tsx` state `labelEntries`, `labelFilter`, `labelDraft`; derived envelopes are also filtered by `labelFilter`. Reader label bar (comma separated, Enter adds, x removes, a refused input shows a hint); toolbar select "Nach Etikett filtern" (filters the loaded page only); palette entries "Etikett: x" and "Etikett-Filter aufheben"; `MessageList` prop `labelsFor` renders small chips; `forgetLabelsOf` mirrors the server after move and delete.
  - **Tests:** new `src/client/labels.test.ts`, `src/server/labels.test.ts` and `tests/e2e/labels.spec.ts`. The immediate-removal specs in `tests/e2e/bulk-select.spec.ts` now check the endpoint per action, assert the confirmation and unroute at the end.
  - **0.27.1 fixes (review gate):** `forgetLabels` in `src/server/app.ts` is best effort (a failing `labels.json` is logged and the move, delete or report still answers 200); `LabelStore.set(ref, [])` returns without writing when the message has no labels; the temp file of `labels.json` and `snoozed.json` gets `chmod 0600` before the rename; `activeLabelFilter` in `src/client/main.tsx` drops a filter whose label no message carries any more.
  - **Verified:** typecheck and build clean; unit 666/666; Playwright 132/132 including `tests/e2e/labels.spec.ts`; `npm audit --omit=dev` 0 vulnerabilities; live service `himalaya-web.service` restarted on 0.27.0.
  - **Real-UI check (2026-10-26, live service, throwaway mail in andre's Trash):** labels added (2 chips in the reader and in the row); filter "Wegwerf" showed 1 row; `labels.json` mode 600 persisted across a reload; removing both left `[]`. No page errors.
  - **Still open:** nothing required. Header-based threading was added later, in 0.28.0.
- **Version 0.26.2 (2026-10-26, delete and move rows removed at once) implemented and verified in the real UI; the live service runs it.**
  - **Shipped:** single and bulk delete and move now remove the affected rows from the local list at once (`setEnvelopes` filter after success in `bulkDelete`, `bulkMove`, `deleteMessage` and `moveMessage` in `src/client/main.tsx`) instead of leaving them dimmed until the reload ends. New test in `tests/e2e/bulk-select.spec.ts` (the reload is held back 3 s).
  - **Verified:** typecheck and build clean; unit 658/658; Playwright 129/129; `npm audit --omit=dev` 0 vulnerabilities; live service `himalaya-web.service` restarted on 0.26.2.
  - **Real-UI check (2026-10-26, live service, headless Chromium):** a throwaway mail that the account andre sent to itself, subject marker `HW-LIVE-TEST-<timestamp>`, composed through the real composer, confirmed with `Jetzt senden`, delivered. Results: Sent row shows `An: andre@semek.org` (real data); read/unread toggle works; snooze hides the message, the `Zurückgestellt` dialog lists it and `Zurückholen` brings it back, `snoozed.json` empty again; bulk move to Diverses (the confirmation names the target) and single move back to Inbox worked; bulk delete (confirmation `in den Papierkorb verschieben`) and single delete of the Sent copy worked, both copies sit in Trash and Inbox, Sent and Diverses hold 0 copies; the unsubscribe button on a real already-read newsletter shows a confirmation naming the sender and the link origin, it was dismissed and no tab opened (the link was never opened on purpose: it could really unsubscribe); rules dialog: a never-matching dry-run rule (preview `0 von 50 Mails passen`) saved to `rules.json` (mode 600, `dryRun` true), reappeared after reopening, was deleted and saved as `[]`, and the file was removed again because it did not exist before.
  - **Finding:** deleted rows stayed visible for a moment; fixed in 0.26.2.
  - **Still open:** nothing required. Two throwaway copies remain in the Trash of andre. Header-based threading was added later, in 0.28.0.
- **Version 0.26.0 (2026-10-26, stale-while-revalidate server cache) implemented and verified; the live service runs it.**
  - **Shipped:** `src/server/caching-runner.ts` `CachingRunner` now takes a 4th constructor argument `staleMs` and has `withStale()`, a view for the GUI: an entry older than the TTL (45 s) but younger than `staleMs` (6 h) is returned at once and refreshed in the background; the old answer stays usable until a successful, still-current replacement arrives; one refresh per key at a time. The plain runner (watcher, warmer) never gets stale data; any non-read command still clears everything. `src/server/index.ts` builds one cache and two services: `service = new HimalayaCli(cache.withStale())` for the GUI routes, `freshService = new HimalayaCli(cache)` for the watcher (new `createApp` option `watchService` in `src/server/app.ts`) and the warmer. `src/client/main.tsx` list effect refactored to `send()`/`apply()`: an answer that arrives in under 400 ms is requested twice more quietly (after 6 s and after 16 s, since refreshing 19 accounts can take longer than 6 s) (`window.setTimeout`, cleared in the effect cleanup) and replaces the list, so a stale server answer is swapped for the fresh one. `src/server/rules.ts`: `readRules` reports read errors other than ENOENT.
  - **Tests:** new unit tests for the caching-runner stale view (2) and the rules read error (1); new `tests/e2e/revalidate.spec.ts` (fake clock).
  - **Verified:** typecheck and build clean; unit 658/658; Playwright 128/128; live service `himalaya-web.service` restarted on 0.26.0.
  - **Measured live (19 accounts, read-only, 2026-10-26):** first unified inbox request right after a service restart 11119 ms (nothing cached yet, unavoidable); the same request after 340 s without any request (the warmer had stopped after its 5 min idle limit, entries were older than the 45 s TTL) 9 ms from the stale view, and 8 ms 8 s later. The list swap 6 s after a fast answer is covered by `tests/e2e/revalidate.spec.ts` with a fake clock and was not watched in the live UI.
  - **Still open:** manual verification of destructive actions in the real UI. Header-based threading was wrongly deferred here; it was built in 0.28.0.
## What Worked

- **Root-cause every failure before fixing it — this caught real bugs, not
  just cosmetics.** Slice 0's first Playwright run surfaced 4 regressions
  (missing `aria-label`, a reused CSS class, a stale test loop, a Chromium
  `:focus-visible` input-modality quirk) — each was traced to ground truth
  via the per-test page snapshots Playwright writes under `test-results/` (not kept in the repo) before touching anything.
  `subagent-driven-development`'s per-task reviewers repeatedly caught real,
  reproducible defects in the plan's OWN reference code (a subject byte-vs-
  char length bug, a poll that could strand the UI forever, two silent-
  failure bugs, a draft that could never survive reload) by tracing them
  through the actual dependency chain, not by trusting the plan's prose.
- **The final whole-branch review earned its cost.** No single task's scoped
  review could have caught the cross-account reply/forward bug or the undo-
  banner-dies-with-the-composer architecture defect — both only became
  visible once the whole system was assembled and traced end-to-end.
- Fresh subagent per task + independent task review + a scoped re-review per
  fix round, on a model tier matched to the task's actual complexity (haiku
  for pure transcription of fully-specified code, sonnet for integration
  work, opus for the final whole-branch review and its fix wave) kept quality
  high without spending the most expensive tier on mechanical work.
- Live-checking one real, reversible action (send-to-self, then trash both
  copies) found a real deployment gap (`mailbox.alias.trash` missing) that no
  amount of synthetic testing would have surfaced — and the final review's
  delete rework later removed that dependency entirely.

## What Did Not Work / Traps Hit

- (Historical, through Slice 2) Git pushes were blocked — no `origin`
  remote configured, and guessing a Forgejo URL was explicitly the wrong
  move. Obsolete as of 2026-09-22 — see "Current Progress" above; `origin`
  now exists and this repo's `main` has already been pushed once.
- The active Gmail credentials cannot be repaired from this repository — SASL
  PLAIN and Basic auth are both rejected server-side; fix is external to
  Himalaya's own config, not this app.
- A missing `aria-label` on a button whose visible text changes silently
  breaks every `getByRole(name: "...")` Playwright lookup for it — always add
  an explicit `aria-label` when a button's rendered text is more than a
  literal string match.
- Reusing an existing CSS class for new, unrelated markup lets old CSS-based
  test locators (`page.locator(".some-class ...")`) accidentally match the
  new content — give new UI its own class even if the styling looks similar.
- `light-my-request` (Fastify's `app.inject`, this repo's installed version
  6.6.0) natively accepts a `FormData` payload and converts it to a real
  multipart stream — verified working, no need to hand-build multipart
  bodies in tests.
- A test-only mouse click can flip Chromium's `:focus-visible` input
  modality and mask an unrelated, later `.focus()`-triggered outline
  assertion — use keyboard interaction in a test when a later assertion in
  the same test depends on focus-visible styling.

## Decisions Made (durable, still in effect)

- Loopback-only, session-token-gated on every `/api/*` route; Himalaya is
  invoked only via an argv array, never a shell string.
- User-facing text is German; code, tests, comments, commit messages, and
  planning docs are English (a runtime error string returned to the UI
  counts as user-facing text, not "code" — it follows the German rule).
- MiniMax is optional, server-side only, no key ever reaches the browser or
  Git; AI actions are explicit-click-only and can never send/move/delete/tag.
- Compose is plain-text only in this slice; HTML/rich-text is explicitly
  deferred to a later slice.
- Special-folder overrides and any local browser-preference storage contain
  only account aliases, mailbox ids, and UI state — never credentials.
- Sending gets both a confirmation dialog AND a 10-second server-side-outbox
  undo window (the "Beides" decision) — the outbox is server-side
  specifically so it survives client navigation/composer close, not a
  client-side `setTimeout`.


## Next Steps

**0.28.0 shipped:** header-based threading (Message-ID and In-Reply-To) is done, verified and live. Nothing required is open.

1. If AI should be enabled on the live service: create `~/.config/himalaya-web/ai.env` (mode `600`) with `HIMALAYA_AI_API_KEY` and restart `himalaya-web.service`; no key is present in this checkout.
2. For any Gmail account hitting `AUTH_REQUIRED`: configure a Google app password or OAuth2/XOAuth2 token through Himalaya's own external command, outside this app and this repo.

Roadmap after Slice 4, not required: housekeeper cleanup jobs, then a full designer pass.

Do not send, delete, bulk-move, or tag real mail during automated tests; one reversible live check against the operator's own account is acceptable when explicitly verifying a release, per the pattern used for `0.6.0`.

Older progress entries, known gaps and known limitations: `.parachute/handoff-archive/2026-10-26.md`.

generated by context-parachute v1.4.1
