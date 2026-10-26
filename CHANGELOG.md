# Changelog

All notable changes to the standalone Himalaya Web GUI are documented here.

## 0.36.1 — 2026-10-26

- Cleaned up obsolete sidebar state and helpers:
  - Removed dead state (`accountFilter`, `accountFilterMode`, `mailboxFilterMode`, `accountFavorites`, `mailboxFavorites`, `expandedAccounts`) and associated handlers.
  - Removed unused preferences helpers (`filterAccounts`, `filterMailboxes`, `mailboxFavoriteKey`, `ACCOUNT_FAVORITES_KEY`, `MAILBOX_FAVORITES_KEY`) and simplified `chooseMailbox`.
- Accessibility and tab semantics polish:
  - Implemented roving tabindex on account and mailbox tabs (`tabindex="0"` on the active tab, `-1` on inactive tabs) with full arrow-key keyboard navigation (ArrowLeft/ArrowRight, ArrowUp/ArrowDown, Home, End).
  - Wired `aria-controls` to the workspace and message tabpanels.
  - Moved empty-state and mailbox status/alert elements outside of `role="tablist"` to enforce valid ARIA tree semantics.
  - Kept warning indicator badge out of the tab's accessible name (`aria-hidden="true"` with tooltip title).
- Layout & release polish:
  - Added `100vh` fallback alongside `100dvh` on `.app-shell`.
  - Added release workflow validation in the public repo requiring tagged releases to be on `main` and safe string matching in release notes extraction.

## 0.36.0 — 2026-10-26

- Persistent mailbox bar:
  - The account and folder tabs now sit permanently under the top bar and replace the left "Postfächer" sidebar; the message list and reader share the full width.
  - "Neue Nachricht" and "Konten verwalten" moved to the top bar. Account order and visibility are managed in the account manager.
  - The tab bar shows the "Keine aktiven Konten sichtbar" hint and the per-account load-warning badge that the sidebar used to carry.
  - Removed the sidebar-only tree, account filter and favourite toggles and the Tabs-Modus switch.
- Folder load failures show an alert with a retry button in the bar; the workspace height is now a flex layout instead of a hard-coded `calc()`; Inbox and Sent stay first in the folder tabs; folder tabs expose `aria-selected`.
- **Breaking:** account and folder favourites, the account filter and drag reordering in the sidebar are gone (reordering stays in the account manager).
- The open mailbox's email address is shown at the top of the message list panel.
- Fixed the unreadable colour-scheme dropdown: `<option>` elements now use the theme panel and text colours.
- Fixed the "1 Konten" label (now "1 Konto").
- Added `tests/e2e/screenshots.spec.ts` (opt-in with `SCREENSHOTS=1`) that renders the README screenshots from synthetic data.

## 0.35.0 — 2026-10-26

- Hima Rebranding & Open Source Release:
  - Rebranded application identity to **Hima** ("Your local mail workspace, powered by Himalaya").
  - Published public repository at `https://github.com/DnaMes/hima` with MIT License and GitHub Actions CI.
  - Set up portfolio repository at `~/projects/business/erdlabs/apps/hima`.
- Security & Robustness Hardening:
  - Fixed URL-encoded authentication bypass in `src/server/app.ts` with strict `decodeURIComponent` path normalization and loopback host enforcement.
  - Enforced strict draft storage namespacing in `src/client/compose-draft.ts` by account, mailbox, and message ID to eliminate cross-account draft collisions.
  - Streamed compose message bodies through child process `stdin` directly into `himalaya` CLI, eliminating argv leaks and `E2BIG` buffer caps on large messages.
  - Handled `stdin` `EPIPE` errors gracefully on early process termination.

## 0.34.0 — 2026-10-26

- Balanced Spacing & Spacious Middle Frame:
  - Redesigned workspace grid proportions based on Codex Sol expert critique: sidebar set to 240px, middle message frame expanded to `clamp(520px, 34vw, 640px)` (in collapsed mode `clamp(560px, 40vw, 720px)`), and reader to `minmax(580px, 1fr)`.
  - Middle panel now has generous breathing room (520–720px) without feeling squeezed or crowding the reading pane.
  - Updated responsive media queries for consistent, fluid scaling down to 1240px without hardcoded sidebar widths.
- Superhuman / Apple Mail Style Multi-Line Message Rows:
  - Re-architected `.envelope-row` to a clean 2-line layout: Line 1 hosts the account dot/selector, sender name, badges, and time aligned right; Line 2 dedicates full width to the email subject, source chips, and labels.
  - Avoids all horizontal cramping and text truncation even with long subjects and multi-tag emails.
  - Reordered `.active` after `.unread` in CSS to guarantee crisp selection highlighting.
  - Removed jarring hover `translateY(-1px)` for calm, tactile 130ms background and border transitions.
  - Added visible, accessible `:focus-visible` focus ring (`outline: 2px solid var(--accent)`).


- Mailbox & Account Horizontal Tabs Navigation:
  - Added dedicated `.account-tabs` row alongside `.mailbox-tabs` in collapsed/tabs mode, allowing direct 1-click switching between accounts ("Alle Eingänge", Gmail, lima-city, etc.) with authentic vector provider logos and unread count badges.
  - Slimmed the collapsed accounts panel down to a 52px precision rail, expanding the email reader to up to 75%+ of total screen width (`minmax(680px, 1fr)`).
  - Added a topbar "Tabs-Modus" / "Seitenleiste" toggle button for fast 1-click switching between full 3-column tree layout and 2-column tabbed focus layout.
- Collapsible Search & Filter Area:
  - Added a search toggle button (`.search-toggle-button`) in the messages panel header with persistent `localStorage` preference (`himalaya-web-search-expanded`).
  - When collapsed, the bulky search form and saved searches are completely hidden, reclaiming ~120px of vertical space so the email list begins immediately beneath the title/tab bar.
  - When filters or queries are active in collapsed state, a compact summary chip bar is rendered with 1-click reset and re-open triggers.
  - Pressing the `/` or `s` search shortcut automatically expands the search area and focuses the input.
- Focused Email Reader & Ultra-Slim Header:
  - Expanded email body maximum reading width from 840px to `min(100%, 1080px)` and eliminated subject title width caps so messages read comfortably and legibly on modern displays.
  - Streamlined topbar to 38px with 6px app-shell padding, increasing total workspace height to `calc(100vh - 64px)`.


- Ultra-Slim Command Header:
  - Replaced bulky 3-tier topbar (eyebrow pill, large h1, subtitle, and extra margins) with a razor-sharp 42px precision toolbar.
  - Reduced app-shell vertical padding from 24px to 10px, expanding the available workspace height by over 56px (`calc(100vh - 72px)`).
  - Clean inline brand lockup: compact icon, brand typography, and version badge inline with theme and shortcut controls.
- Interactive Tab Folder Navigation & Accessibility:
  - Strengthened horizontal folder tabs in collapsed mode with active tab feedback on click.
  - Added explicit accessible name `aria-label="Neue Nachricht"` to the compose button in collapsed state.
  - Added explicit account name and address tooltips to collapsed account tab selectors.
  - Wrapped quick triage buttons with `flex-wrap: wrap` to prevent clipping at narrow viewports.


- Collapsible Postfächer / Sidebar Tab Mode:
  - Add collapse/expand toggle button in the accounts panel heading with persistent preference in `localStorage` (`himalaya-web-sidebar-collapsed`).
  - In collapsed mode, the sidebar collapses into a sleek 68px vertical tab strip displaying authentic provider logos and unread badges, freeing up over 230px of horizontal space for the message list and reading panel.
  - In collapsed mode, horizontal folder quick tabs (`.mailbox-tabs`) appear at the top of the messages panel for fast 1-click switching between mailboxes (INBOX, Sent, Drafts, Trash, etc.) without needing the expanded tree.
- Focused Email Reader Layout:
  - Repositioned the email body directly below the subject header and a compact quick-reply/triage bar (`Antworten`, `Allen antworten`, `Weiterleiten`, `Später erinnern`, `Löschen`), ensuring the actual email text is immediately in view and unobstructed.
  - Secondary utility actions (Move to folder, Copies, Markdown download, PDF print, raw EML, Headers, Etiketten / Labels, AI Assistant, Sender reputation details) are neatly positioned below the email body.
- Visual Polish & Accessibility:
  - Fixed duplicate favorite stars (`★★` -> `★`) by defining `.visually-hidden` styling, properly hiding fallback text characters while keeping screen reader accessibility intact.
  - Fixed letter initials displaying inside/next to provider logo squircles, allowing authentic vector brand logos to display cleanly.
  - Eliminated awkward ellipsis truncations (`...`) on account names and sender columns: enabled natural soft word-breaking and widened the sender column template for effortless readability.


- Authentic Brand Logos: Replaced placeholder approximations with official vector brand marks for email providers:
  - Lima-City: Official circuit rack arch vector directly from `mail.lima-city.de/lima-city-branding/logo-small.svg`.
  - Google Mail: Official multi-color Google Workspace 'M' mark (`#4285F4`, `#34A853`, `#FBBC04`, `#EA4335`, `#C5221F`).
  - Goneo: Official white goneo 'g' mark and lime accent (`#78be20`) on deep navy blue (`#003865`).
  - Microsoft Outlook: Official blue layered vector envelope mark.
  - Apple iCloud: Official iCloud gradient cloud shape.
  - Proton Mail: Official Proton purple vector mark.
  - GMX & WEB.DE: Official brand vector typography marks.
  - Mailbox.org: Official folded envelope cross mark.
  - Fastmail, Hetzner, IONOS, STRATO, and Posteo: Authentic brand vector marks.
- Major UI/UX Redesign (Linear, Superhuman & Apple Mail grade):
  - Double-bezel layout with soft ambient elevation, subtle border contrast, and macro-whitespace.
  - Modernized typography with system sans-serif hierarchy, antialiased font smoothing, and tabular numbers for counters and timestamps.
  - Upgraded envelope list cards with generous breathing room, glowing unread status dots, clear sender/subject contrast, and subtle cubic-bezier hover elevation.
  - Refined floating topbar with command-center styling, live connection status indicator, and theme selector pill.
  - Elevated reader panel with large sender avatar, clear action toolbar, and spacious reading measure.
  - Increased provider logo squircle size to 20px for crisp visibility in both sidebar and account manager dialog.

## 0.29.0 — 2026-10-26

- Visual design and UI/UX overhaul inspired by modern email clients (Linear, Superhuman, Apple Mail): replaced serif fonts with clean modern system sans-serif hierarchy, subtle surface elevation, calm border contrast, and refined spacing.
- Authentic vector provider logos library (`src/client/provider-logos.tsx`): vector brand marks for Gmail, Apple iCloud, Goneo, lima-city, Microsoft Outlook, Fastmail, Proton Mail, GMX, Web.de, Posteo, Mailbox.org, Strato, Hetzner, Ionos, and custom domain fallback.
- Automatic provider detection (`src/server/account-config.ts`): inspects IMAP host and email address domain in `himalaya.toml` to associate each configured account with its authentic brand icon and label.
- Provider brand integration: displayed in account marks across the sidebar tree, account manager dialog, and account selection.
- Crisp vector icon library (`src/client/icons.tsx`): 40+ accessible SVG vector icons (`currentColor`, flexible size, `aria-hidden`) replacing Unicode emoji glyphs across sidebar navigation, toolbar buttons, reader panel actions, compose, and dialog controls.
- Preserved 100% of accessibility roles, keyboard shortcuts, and test assertions.

## 0.28.7 — 2026-10-26

- A request that arrives while a cache fetch is still running now joins it however old its start is (the runner's own timeout ends it), instead of starting a second spawn after the TTL passed.
- The stale-temp sweep is only marked as done after the directory could be read, so a transient read error no longer disables it for the rest of the process (test with an unreadable directory, checked to fail against the old code).

## 0.28.6 — 2026-10-26

- Found by a 30 minute read-only soak test against the live service (31 requests, 0 errors, memory flat at 60 MB, but 6 of 30 warm requests took over 1 s, up to 7.7 s): when the cache warmer re-fetched an expired list, the GUI waited for that running fetch instead of getting the older answer at once. The GUI view now keeps the answer it replaces and serves it while the fetch runs; the plain (watcher, warmer) view still waits for current data. Second 12 minute soak after the fix: 13 requests, 0 errors, memory flat at 62 MB, after the first request median 103 ms and maximum 135 ms, none over 1 s.
- `writeFileDurably`: `ENOSYS` counts as an unsupported directory flush, the stale-temp sweep runs once per file and process, and the flush error handling is tested.

## 0.28.5 — 2026-10-26

- `writeFileDurably` hardening from the review gate: a failing directory flush is only ignored for the errors that mean "not supported" and logged otherwise, new directories are created private (0700), and temp files an earlier crash left behind (own `<name>.<uuid>.tmp` pattern, older than an hour) are swept before the next write; new tests for all three.

## 0.28.4 — 2026-10-26

- One shared `writeFileDurably` (`src/server/durable-write.ts`) for `labels.json` and `snoozed.json`: random temp file, mode 0600, flushed before the rename, and the directory flushed after it, so a power loss leaves the old or the new file, never a partial one or a lost rename.

## 0.28.3 — 2026-10-26

- The temp file of `labels.json` and `snoozed.json` gets a random name (UUID) and is flushed to disk before the rename; the snooze store has its own tests for leftovers and for cleanup after a failed rename.
- Observed live in the real browser (19 accounts, warm server): the quiet re-requests of the list run at about 0.2 s, 6.2 s and 16.2 s after loading (10, 18 and 59 ms); a cold first load (11.6 s) correctly schedules none.

## 0.28.2 — 2026-10-26

- `labels.json` and `snoozed.json` are written through a unique temp file per write (renamed into place, removed on failure), so a leftover temp file or directory can neither keep an old mode nor block saving. A threading field that is an array with some non-text entries keeps its text entries instead of losing the whole field.

## 0.28.1 — 2026-10-26

- Threading, review-gate fixes: only the last In-Reply-To id counts as the parent (a mass reply listing many ids no longer glues other conversations together); copies of one conversation in several folders of an account (Inbox and Sent) are grouped on purpose; a threading field of an unexpected type is ignored instead of failing the whole list, and a single `in-reply-to` string is accepted; the stale temp file of `labels.json` and `snoozed.json` is removed without recursing into directories.

## 0.28.0 — 2026-10-26

- Real conversation threading: Himalaya v2.1's list view does carry `message-id` and `in-reply-to` (an earlier note here said it did not), so "Gespräche" now links messages through those headers instead of the subject: a reply is grouped with its parent, replies to the same parent that is not on the page stay together, and a changed subject no longer breaks the chain. Mail without a Message-ID still falls back to the subject match, and accounts stay apart. Measured on 150 real inbox rows: the subject match folded 150 rows into 119 (mostly unrelated newsletters with the same subject), the header match shows 149 with the one real conversation grouped.
- Labels, last review notes: a label filter that vanished is forgotten for good, and the temp files of `labels.json` and `snoozed.json` are removed before they are rewritten.

## 0.27.1 — 2026-10-26

- Labels, review-gate fixes: a failing `labels.json` no longer turns an already successful move, delete or report into an error (it is logged), clearing a message without labels writes nothing, the temp file of `labels.json` and `snoozed.json` is forced to mode 0600, and a label filter whose label no message carries any more falls away instead of leaving an empty list.

## 0.27.0 — 2026-10-26

- Local labels (roadmap Slice 4): Himalaya can only set seen/answered/flagged/draft, so labels are stored in this GUI only (`~/.config/himalaya-web/labels.json`, mode 0600, `HIMALAYA_WEB_LABELS_PATH` override) and never change the mail. A message can carry up to 5 labels of up to 24 characters; the reader has a label bar (comma separated, Enter adds, × removes), the list shows them as small chips, a "Nach Etikett filtern" select in the list toolbar narrows the loaded page, and the command palette offers "Etikett: …" filters. A message that is moved, deleted or reported gets a new id, so its labels are dropped.
- Test hardening from the review gate: the immediate-removal specs check the endpoint per action, assert the confirmation, and clean up the held-back route.

## 0.26.2 — 2026-10-26

- Deleted or moved messages (single or bulk) now disappear from the list at once instead of staying visible, dimmed, until the reload finishes. Found while running the destructive actions in the real UI against a throwaway mail.

## 0.26.1 — 2026-10-26

- The quiet re-request after a fast answer now runs twice (after 6 s and after 16 s): refreshing 19 accounts can take longer than 6 s, so a single retry could still see the old list.

## 0.26.0 — 2026-10-26

- Stale-while-revalidate on the server: after a pause longer than the cache (45 s) the GUI is answered at once from the last known lists (up to 6 hours old) while they refresh in the background, and the list re-requests itself once about 6 seconds after any answer that came back in under 400 ms, replacing the old list with the fresh one. The mail watcher and the cache warmer use a separate view that never gets stale data, so notifications stay current; any move, delete, flag or send still clears the whole cache.
- Measured live with 19 accounts: the first request after a restart still takes about 11 s (nothing cached yet), a request after more than 5 minutes without any use now answers in 9 ms.
- `readRules` also reports read errors other than a missing `rules.json`.

## 0.25.0 — 2026-10-26

- Attachment preview: a "Vorschau" button next to PNG/JPEG/GIF/WebP images, PDFs and plain-text files opens them in a dialog (up to 15 MB). The preview type comes from a fixed whitelist, never from the mail, and SVG/HTML/everything else stays download-only.
- Snooze: "Später erinnern …" in the reader hides a message in this GUI until 3 hours / this evening / tomorrow 8:00 / next Monday 8:00. The mail stays in its folder (other clients still show it); "Zurückgestellt (n)" lists them with "Zurückholen". Stored in `~/.config/himalaya-web/snoozed.json` (mode 0600, max 500, `HIMALAYA_WEB_SNOOZE_PATH` override); the bootstrap response carries the list and the GUI refreshes it every minute.
- Faster cold start of the unified inbox (measured live, 19 accounts): the fan-out grew from 4 to 10 accounts at once (18 s to 8.8 s), the server cache now lives 45 s, and a background warmer renews the first unified inbox page of the accounts in use every 40 s while the GUI was used in the last 5 minutes (it stops by itself when idle, and the widget poll does not count as use).
- Rules log what is wrong: an unusable rule entry is dropped with its id (or "entry N") and the reason, an unreadable `rules.json` is reported once, and a missing file stays silent. This also fixes the 3 long-failing logging tests.
- Security updates (npm audit fix, production dependencies): DOMPurify 3.4.17, zod 4.6.7, fastify 5.12.7, mailparser 3.12.4 with nodemailer 10.2.1, fast-uri; `npm audit --omit=dev` now reports 0 vulnerabilities.
- Review fixes from 0.24.0: an in-flight prefetch can no longer refill the detail cache after a move, delete or rating change; the remote-image test now proves that only the https image is requested.

## 0.24.0 — 2026-10-26

- Opening a message now fetches the neighbouring messages quietly (reading leaves flags alone), so j/k shows them instantly; cached details are dropped after moving, deleting, or changing a sender rating.
- Recipient suggestions can be chosen with the arrow keys and Enter (Enter only takes a highlighted suggestion).
- Multi-select can move the selected messages to another folder of the same account ("Verschieben nach …", with a confirmation; not offered in the unified inbox or cross-folder search).
- The list cache no longer treats reading a message as a mutation.
- Remote images: HTML mail still loads no images by default; a bar names how many http(s) images were blocked and offers "Bilder laden" (this message) or "Immer von <sender> laden" (remembered in the browser, up to 200 senders). Allowed images are https only, sent without a Referer, and srcset/style/event attributes are dropped; http images never load.

## 0.23.0 — 2026-10-26

- Conversation view: the "Gespräche" toggle in the list toolbar groups the loaded page by subject (Re:/AW:/Fwd:/WG: prefixes ignored, accounts and folders kept apart). A thread shows its first message plus a "N weitere im Gespräch" line (with the unread count) that expands the rest; the thread holding the open message stays open. Himalaya's list view has no Message-ID/References, so this is a subject match within the loaded page, not true threading; off during multi-select, remembered per browser.

## 0.22.0 — 2026-10-26

- Recipient suggestions in the composer: typing two or more characters in An, Cc or Bcc offers addresses from mail already loaded or remembered in the session (most frequent first, never the operator's own); picking one keeps the earlier recipients. Nothing is stored or sent anywhere.
- Unsubscribe links must now be plain https URLs without a `user:pass@` part; an unusable link is dropped, so no "Abmelden" button appears for it.

## 0.21.0 — 2026-10-26

- Newsletter unsubscribe: when a message carries a `List-Unsubscribe` header, the reader shows "Abmelden". An https link opens in a new tab after a confirmation naming its host; a mail-only offer shows the address to write to. The server only parses the header (https links and plain addresses) and never calls the link itself.

## 0.20.0 — 2026-10-26

- Command palette: Ctrl/Cmd+K opens a search over "Alle Eingänge", every account and every loaded folder, all keyboard actions and the dialogs (Regeln, Konten verwalten, Tastenkürzel). Arrow keys and Enter pick, Escape closes.

## 0.19.0 — 2026-10-26

- Faster perceived loading: a folder, search or unified-inbox page you already opened is shown at once from memory while the fresh list loads in the background (stale-while-revalidate, in-memory only, up to 40 lists). Deleting, moving or bulk-deleting clears it, so a removed message never flashes back.

## 0.18.0 — 2026-10-26

- Keyboard shortcuts (not while typing, not while a dialog is open): j/k next/previous message, r reply, a reply all, f forward, c new message, u toggle read, # or Delete delete (trash first), / focus search, ? help. A "Tastenkürzel" button in the top bar lists them.
- Multi-select: "Auswählen" in the list toolbar turns rows into check marks; "Alle auf dieser Seite", "Gelesen", "Ungelesen" and "Löschen" (trash only, with confirmation; a message already in the trash is skipped, never deleted for good).

## 0.17.0 — 2026-10-26

- Sent folders (and cross-folder search hits from a Sent folder) now show "An: <recipients>" instead of the sender.
- Inbox and Sent are pinned at the top of every account's folder list, also in the favorites view.
- Clearer region colors: distinct tones per area (accounts, list, reader), tinted headings, own topbar, accent bar on the selected row and folder, unread rows highlighted, read rows muted.
- Faster loading: the unified inbox no longer runs IMAP STATUS for every folder to find INBOX, list commands are cached for 20 s (any mutation clears the cache), and the message list stays visible (dimmed, not focusable) while a new one loads.
- The unified inbox page 1 now reads one source page per account instead of up to five; equal dates at the cut widen it to the full window so the order stays stable. Opening a message clears the list cache so it no longer shows as unread.

## 0.8.0 — 2026-09-22

- Added an opt-in mail rules engine: hand-edited entries in
  `~/.config/himalaya-web/rules.json` match a watched account's genuinely
  new mail by sender, subject, or recipient, and move it and/or flag it
  (read, answered, marked, draft). A message a live rule moves or marks
  read is filed silently instead of triggering a desktop notification.
  Rules can be marked `"dryRun": true` to log what they would do without
  touching any mail.
- Added `HimalayaService.setFlag`, generalizing the existing `setSeen`
  primitive to all four flags Himalaya's CLI supports.
- Added a bounded `suggest-rule` MiniMax task that proposes a candidate
  rule's condition and action for a selected message as German text — it
  never creates, edits, or applies a rule itself.

## 0.7.1 — 2026-09-22

- Fixed: `mailbox list` was never requesting `--counts` from Himalaya, so
  every mailbox's total/unread count was always `null` — this silently
  disabled the existing unread-pill badge in the account tree since it
  shipped, and made the 0.7.0 mail watcher's new-mail detection permanently
  inert against real accounts. Caught by the watcher's own live
  verification check, not by the test suite (which uses a fake backend
  that always returns non-null counts).
- Fixed: a link inside an HTML message body had nowhere to navigate —
  the message renders in a sandboxed iframe with no popup permission, so
  clicking a link silently did nothing. Links now open in a new browser
  tab (`target="_blank" rel="noopener noreferrer"`, enforced regardless of
  what the message's own HTML says), with the iframe sandbox loosened only
  enough to allow that — still no scripts, no same-origin access, no
  navigating the app itself away.

## 0.7.0 — 2026-09-22

- Added an opt-in mail watcher: accounts with `"watch": true` in
  `accounts.json` are polled for new INBOX mail and get a desktop
  notification (click to open the app), coalesced into one summary
  notification when more than 3 arrive in one poll.
- Added a live unread-count badge to the Omarchy bar widget, backed by a new
  `GET /api/watch/summary` route authorized by a separate, narrowly-scoped,
  rotate-on-restart widget token — the main session token is still never
  written to disk.
- Fixed a reachable hole in the Gmail duplicate-Sent-copy fix: an
  overrides-only `accounts.json` entry no longer silently re-enables the
  duplicate copy, and the special-folder regexes now also match a German
  Gmail account's real `[Google Mail]/...` IMAP prefix (was `[Gmail]/...`).

## 0.6.0 — 2026-09-22

- Added reply, reply-all, and forward, prefilling recipients, subject, and
  quoted source from the original message.
- Added new mail composition (plain text only).
- Added attachments on send, including carrying forward a forwarded
  message's original attachments on request.
- Added a confirm-and-undo send flow: a confirmation dialog summarizes the
  message, then a 10-second delayed send through a server-side outbox queue
  lets the user cancel before it goes out, surviving navigation away from
  the composer.
- Added local draft autosave for the composer, keyed by compose context, plus
  an explicit save-to-Drafts action that writes to the account's real
  Drafts mailbox.
- Added trash-first delete: deleting a message moves it to Trash; deleting
  again from Trash removes it permanently.
- Added per-account Sent/Drafts/Trash mailbox resolution with a
  configurable override, stored in `~/.config/himalaya-web/accounts.json`.
- Added a bounded `polish-draft` MiniMax AI task that reformulates the
  user's own draft text; like the existing AI actions, it never sends,
  moves, deletes, or tags mail.

### Fixed after the whole-branch review

- A reply or forward must now start from the account the source message
  belongs to; the server rejects a mismatch, and the composer no longer
  offers the sender picker for a reply or forward. Message ids collide
  across accounts, so a mismatch quoted and threaded an unrelated message.
- Delete is now decided by the server: it moves the message to the resolved
  trash mailbox, and answers `409 CONFIRM_REQUIRED` for a message already
  there, so a permanent delete always requires an explicit confirmation.
  The previous client-side mailbox-name guess missed folders such as
  `Deleted Items`, and the route itself called Himalaya's bare
  `message delete`, which fails without a configured `mailbox.alias.trash`.
- The undo banner and the send outcome now live above the composer, so
  closing the composer during the 10-second window no longer discards them.
  A failed send offers `Erneut versuchen`, and a second compose is blocked
  while an undo countdown is running.
- `Jetzt senden` is disabled while the upload is in flight, so a slow
  attachment upload can no longer produce two outbox jobs.
- An account with no `accounts.json` entry now falls back to the provider
  default sent-copy mode, so Gmail accounts no longer get a duplicate Sent
  copy from `--save`.
- Saving a draft honours a configured Drafts override, and warns before
  discarding attachments, which drafts still cannot carry.

## 0.5.0 — 2026-09-22

- Clicking an account now opens its INBOX directly without expanding its
  folder tree; only the disclosure arrow expands or collapses folders. This
  decouples loading a mailbox list from displaying it.
- The app now starts a fresh session in `Alle Eingänge` (the unified inbox)
  instead of a single account, remembered per browser as
  `himalaya-web-last-view`; a session that explicitly chose an account or
  mailbox returns to it on reload.
- `Alle Eingänge` is now a pinned card at the top of the account list with an
  account-count subtitle, instead of a plain text link.
- No API, backend, or session changes.

## 0.4.0 — 2026-09-19

- Added stable per-account colours (eight theme-tuned hues, automatic and
  persistent, overridable per account in the account manager) stored as aliases
  only under `himalaya-web-account-colors-v1`.
- Grouped the message list by date (Heute, Gestern, Diese Woche, Letzte Woche,
  Älter, Ohne Datum) without reordering rows, with sticky group headers.
- Added status badges from real IMAP flags (Neu, Anhang, Markiert,
  Beantwortet) with icon plus accessible text, and a warning mark for accounts
  with a current unified-inbox warning.
- Added two list densities, Kompakt and Komfortabel, remembered per browser
  under `himalaya-web-list-density-v1`.
- Tinted the accounts, message, and reader areas from new theme tokens with a
  coloured top line and title, and verified text and hue contrast for all six
  themes. Catppuccin Latte's muted text is darker to meet 4.5:1.
- No API, backend, or session changes.

## 0.3.0 — 2026-09-18

- Replaced the central mailbox strip with a hierarchical account tree and
  lazily loaded, session-cached folders with per-account loading/error states.
- Added drag ordering and keyboard-accessible move controls in the tree and
  account manager, persisted as aliases under the browser-local
  `himalaya-web-account-order-v1` key without changing Himalaya configuration.
- Added `Alle Eingänge` for the `INBOX` folders of active and visible accounts,
  with newest-first paging and account/mailbox source labels for reader actions.
- Added safe per-account warnings that preserve successful unified results and
  distinguish all-account failures from an empty inbox, without background
  synchronization or arbitrary-folder aggregation.
- Added Markdown export for the selected message with safe filenames and
  session-protected download headers.
- Added browser print-to-PDF export with sanitized HTML/text rendering.
- Added explicit MiniMax summary and reply-draft actions behind the local
  session boundary, with bounded prompts, timeout, cooldown, and no sending.
- Added optional external MiniMax service configuration without repository or
  browser secrets.
- Replaced the generic Himalaya provider failure for known Gmail
  authentication errors with actionable German `AUTH_REQUIRED` guidance.

## 0.2.0 — 2026-09-18

- Added a versioned standalone app identity with visible local version metadata.
- Repaired the three-pane shell so folder navigation remains visible instead
  of collapsing into a thin strip.
- Added responsive desktop grid sizing and a bounded, wrapping folder list.
- Added clearer folder section hierarchy and local-app header chrome.
- Kept account addresses, account/mailbox favorites, six local themes, and the
  loopback/session boundary intact.
- Added a local account manager for independent visibility and activation
  controls, with safe selection fallback and persistent browser preferences.
