# Himalaya Web Overview System

**Date:** 2026-09-18

**Status:** Proposed after user review of the visual direction

## Goal

Make the mailbox readable at a glance. Give every account a stable colour, tint
the three main areas differently, group the message list by date, show clear
status badges, and offer two list densities. All changes are frontend-only and
keep the local, privacy-first workflow of Himalaya Web unchanged.

This is sub-project A of a larger improvement round. Later, separate specs
cover B (keyboard and command palette), D (remote-image privacy), C
(conversations and saved searches), and F/G (notifications and a bar widget).

## Context and constraints

- Single-user, loopback-only GUI for Himalaya v2.1.0. No API route, backend
  contract, session rule, or provider call changes in this slice.
- Browser storage may contain aliases and UI choices only. Never credentials,
  message content, or AI data. Every storage read and write is wrapped so the UI
  still renders when storage is empty, blocked, or throwing.
- User-facing text stays German; code, tests, and planning documents stay
  English.
- Existing behaviour stays intact: account tree, lazy folders, unified inbox,
  favorites, local ordering, account manager, export, AI actions, six themes.
- `src/client/main.tsx` is 879 lines. Only the list rendering that this slice
  touches is extracted; no other refactoring.

## Approved decisions

| Topic | Decision |
|---|---|
| List style | Compact, one line per message, coloured account dot, date-group headers (mockup "C") |
| Area colours | Each area has its own tone: accounts violet, messages blue, reader teal (mockup "2") |
| Account colours | Automatic and stable, overridable per account in the account manager |
| Density | Two levels: `compact` (default) and `comfortable` |
| Status colours | Never colour alone: every badge carries an icon and an accessible text |

## Non-goals

- Sender avatars, body previews, new mail actions (archive, delete, flag), and
  any backend or API change.
- Per-message colours, cross-device sync of colour choices, custom palettes.
- Reworking layout structure, navigation, or the reader.

## Architecture

Each unit has one purpose, a small interface, and its own tests.

### `src/client/account-colors.ts` (pure, plus storage helpers)

- `ACCOUNT_COLORS_KEY = "himalaya-web-account-colors-v1"`.
- `ACCOUNT_HUE_COUNT = 8`.
- The stored state has two maps, `{ manual, auto }`, each `alias -> index`.
  `manual` holds the user's overrides; `auto` holds automatic assignments that
  are persisted so a colour never changes when accounts are added or removed.
  Keeping them apart lets the manager show "Auto" as a real, selected state.
- `readAccountColorState(storage)` accepts only string aliases mapped to
  integers `0..7`; everything else is dropped.
- `writeAccountColorState(storage, state)` swallows storage errors and returns
  whether the write succeeded (same pattern as `account-order.ts`).
- `resolveAccountColors(aliases, state)` returns `{ colors, state }`. Manual
  entries win, kept automatic entries stay, and every missing alias receives the
  currently least-used index; ties go to the alias's stable FNV-1a hash index,
  then to the lowest index. Aliases are processed in sorted order so the result
  does not depend on the user's display order. Entries for unknown aliases are
  removed from both maps.
- `setManualAccountColor(state, alias, index | null)` sets an override, or
  removes it for "Auto" so the account keeps or receives an automatic colour.
- With more accounts than hues, colours repeat. The account name is always shown
  beside the colour, so colour is an aid and never the only identifier.

### `src/client/message-groups.ts` (pure)

- `groupKey(date, now)` classifies by local calendar-day difference:
  `today`, `yesterday`, `this-week` (2 to 6 days ago), `last-week` (7 to 13),
  `older`, and `none` for a missing or unparsable date. A date in the future
  counts as `today`.
- Day difference uses year, month, and day components, so it is correct across
  daylight-saving changes.
- `withGroupHeaders(envelopes, now)` returns the rows in their **original order**
  and marks a row as starting a group whenever its key differs from the previous
  row's key. Rows are never reordered or dropped, so a list that is not strictly
  date-sorted simply shows more headers.
- German labels: `Heute`, `Gestern`, `Diese Woche`, `Letzte Woche`, `Älter`,
  `Ohne Datum`.

### `src/client/list-density.ts` (pure, plus storage helpers)

- `LIST_DENSITY_KEY = "himalaya-web-list-density-v1"`, values `compact` |
  `comfortable`. Unknown or missing values resolve to `compact`.

### `src/client/message-list.tsx` (component, extracted from `main.tsx`)

- Renders group headers, rows, badges, and the empty/loading slots it is given.
- Props: `envelopes`, `now`, `density`, `unified`, `currentAccount`,
  `colorIndexFor(alias)`, `isSelected(envelope)`, `onOpen(envelope)`.
- Exports `envelopeBadges(envelope)` (pure) returning the badge list below.
- Badge rules from real data only:
  - `new`: message is not seen (`● Neu`).
  - `attachment`: `hasAttachment === true` (`📎 Anhang`).
  - `flagged`: flag `iana` or raw value is `flagged` (`⚑ Markiert`).
  - `answered`: flag `iana` or raw value is `answered` (`↩ Beantwortet`).
  - Draft, deleted, and unknown flags are ignored.
- The `⚠ Fehler` badge is **not** derived from message content. It appears only
  in the accounts pane beside an account that has a warning in the current
  unified result (`unifiedWarnings`).
- Compact rows use icon-only badges with `title` and visually hidden text.
  Comfortable rows show icon plus text.

### Themes (`src/client/themes.ts`)

- New semantic keys, mapped to CSS variables by the existing `applyTheme`:
  `areaAccounts`, `areaList`, `areaReader` (backgrounds) and `titleAccounts`,
  `titleList`, `titleReader` (area title colour and 3px top line).
- New `accountHues`: a tuple of exactly eight colours per theme, applied as
  `--account-hue-0` to `--account-hue-7`. Rows and dots use
  `--c: var(--account-hue-N)`, so switching theme recolours without recomputing.
- Values are chosen per theme, including the light theme, and verified by the
  contrast test below. None is hard-coded in CSS beyond the Midnight fallbacks
  in `:root`.
- Catppuccin Latte's `mutedText` changes from `#6c6f85` to Catppuccin's own
  darker Subtext 1 `#5c5f77`, because the old value stays below 4.5:1 on the
  new area backgrounds.

## Visual specification

- Areas: `accounts-panel`, `messages-panel`, and `reader-panel` use their
  `area*` background, a 3px top line in the matching `title*` colour, and an
  uppercase eyebrow in that colour. Borders between areas mix 35% of the accounts
  title colour into the existing border colour.
- Compact row grid: dot | sender (fixed width, ellipsis) | subject | badges |
  time. In unified mode a small account chip with the exact text
  `<account> · <mailbox>` (ellipsised by CSS, full alias in `title`) precedes
  the subject; existing browser tests rely on that text.
- The time column shows `HH:mm` for messages from today and `dd.MM.yy`
  otherwise.
- Comfortable row adds a second line with the first recipient and the message
  size, plus more vertical space. Message body previews are not available from
  the envelope data and are out of scope; the second line uses only fields that
  already exist.
- Group headers are sticky within the list panel.
- Unread rows are bold; read rows use the normal text colour, not reduced
  opacity, so they stay readable.
- Account rows in the accounts pane show the alias with a coloured mark (the
  existing `account-mark`, tinted with the account hue), any count pill that the
  pane already shows, and `⚠` when the account has a current warning.

## Behaviour

- Colours are computed from the full account list (not only visible ones) so
  hiding an account never changes another account's colour. New accounts get a
  colour and it is written back once; if writing fails the same result is
  recomputed deterministically on the next load.
- The account manager gets a "Farbe" control per account: a button group with
  "Auto" plus eight swatches. Each button uses `aria-pressed` and a German
  colour name, and is reachable and operable by keyboard (Tab, Space, Enter).
- The list toolbar gets a two-state density toggle (`Kompakt`, `Komfortabel`)
  with `aria-pressed`, and the choice persists per browser.
- Switching account, mailbox, page, search, or unified view keeps the existing
  request-sequencing rules; this slice adds no new requests.

## Accessibility

- Colour is never the only carrier of meaning: every badge and status has an
  icon and text or accessible text.
- Focus styles and the existing keyboard behaviour stay unchanged. No new
  animation is introduced, so `prefers-reduced-motion` needs no special case.
- Contrast rules, enforced by a unit test for **every** theme, using the WCAG
  relative-luminance formula:
  - Body and muted text against each `area*` background: at least 4.5:1.
  - Area titles (`title*`) against their own `area*` background: at least 4.5:1.
  - Each account hue against each `area*` background, as dot or line: at least
    3:1.
  - Each account hue as chip text on its own 14% tint over each `area*`
    background: at least 4.5:1.

## Error handling

- Invalid, missing, or blocked storage yields defaults (automatic colours,
  compact density) without an error message.
- A missing or invalid date lands in `Ohne Datum` and never throws.
- An unknown account alias in stored colours is ignored and dropped on the next
  write.

## Testing

- Unit tests (Vitest): `account-colors` (validation, stable assignment,
  distribution, override and reset, unknown-alias cleanup, storage failure),
  `message-groups` (boundaries, daylight-saving days, future and missing dates,
  original order preserved, header only on change), `list-density` (defaults and
  invalid values), `envelopeBadges` (each flag form), and the theme contrast test
  for all six themes.
- Layout contract test updated for the new area classes and tokens.
- Playwright with synthetic data only, in `tests/e2e/overview.spec.ts`: group
  headers appear; a colour override changes the dot and survives a reload;
  "Auto" restores it; the density toggle changes rows and survives a reload;
  blocked reads and writes of the two new storage keys still render; the
  unified inbox shows the source chip and the
  correct account dot; an account with a warning shows `⚠`.
- The existing 42 browser tests and 146 unit tests must keep passing.

## Documentation and release

- README (features, controls) and CHANGELOG are updated in the same change.
- Version becomes `0.4.0`, exposed through the existing `app-meta` path.
- `HANDOFF.md` and the `AGENTS.md` handoff block are updated to the new state.

## Risks and limits

- Eight hues are fewer than the ~19 configured accounts; colours repeat. This is
  acceptable because the alias is always visible, and a larger palette can be
  added later without changing the storage format.
- Tuning eight distinct hues per theme against the contrast rules, especially
  in the light theme, takes iteration. The contrast test is the safety net; a
  hue that cannot pass is replaced, not exempted.
- Extracting the list from `main.tsx` risks regressions in request sequencing;
  the existing browser tests for stale responses and paging guard against it.

## Acceptance criteria

1. Every account shows a stable colour; overriding and resetting it works and
   persists.
2. The list is grouped by date with correct German headers and never reorders
   rows.
3. Compact and comfortable density both work and persist.
4. Badges reflect real flags and attachments, and always carry an icon plus
   accessible text.
5. The three areas are visibly distinct in every theme, and the contrast test
   passes for all six themes.
6. No API, backend, or session change; no real mail is read or mutated by tests.
7. All existing and new unit and browser tests pass, typecheck and build pass,
   and the docs and version reflect `0.4.0`.
