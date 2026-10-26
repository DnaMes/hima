# Himalaya Web UI Design

**Date:** 2026-09-18

**Status:** Implemented in the standalone project as version `0.2.0`; the
app-shell, folder-navigation repair, and local account manager were visually
verified after build.

## Goal

Make the local Himalaya Web GUI easier to scan and personalize by showing the
configured address for every account, allowing both account-level and
mailbox-level favorites, and providing a small set of polished local themes.
Keep Himalaya v2.1.0 and the existing desktop keyring as the only mail/data
backend.

## Context and constraints

- `himalaya account list --json` returns only `name`, `default`, and `backends`.
- The local TOML config contains a non-secret `email` field under each
  `[accounts.<name>]` table.
- The GUI binds to `127.0.0.1` and uses an ephemeral session token for API
  requests. This boundary must not be weakened.
- Browser preferences may be stored in local storage. Credentials, message
  bodies, and keyring values must never be stored there.
- User-facing text remains German; code and project documentation remain
  English.
- The first slice does not add compose, send, delete, bulk actions, remote
  access, background synchronization, or a unified inbox.

## Design

### Account identity and address display

The server loads the account list from Himalaya and reads only the `email`
field from the configured TOML file. A dedicated mapping function returns
`accountName -> email | null`; it never returns the rest of the account table.
The mapping is joined by account name and included in the bootstrap account
payload as `email: string | null`.

The account row displays the existing alias as the primary label and the
configured email as the secondary label, followed by the backend summary only
when there is enough room. The account search matches both alias and email.
Missing or malformed entries remain usable and show a German fallback such as
`Adresse nicht konfiguriert` rather than blocking account discovery.

### Account favorites

Account favorites remain browser-local and are keyed by the stable Himalaya
account name. The account panel receives a compact filter control with
`Alle` and `Favoriten` states. The existing star button toggles membership,
keeps favorites at the top in `Alle`, and applies the filter immediately.
When no account is favorited, the `Favoriten` view explains the empty state and
offers no destructive action.

### Mailbox favorites

Mailbox favorites are independent from account favorites and are keyed as
`<account-name>:<mailbox-id>`. The mailbox strip gets the same `Alle` and
`Favoriten` filter states plus a star control per mailbox. Selecting a different
account changes the mailbox key scope but does not erase preferences.

The default selection remains the saved mailbox, then `INBOX`, then the first
available mailbox among the currently visible filter results. If a favorited
mailbox disappears from the provider response, the preference stays harmlessly
stored and can be removed when the account is shown again.

### Themes

The client defines semantic CSS custom properties for page background, panel,
field, border, text, muted text, accent, accent contrast, selected state,
success, warning, and error. Each theme is a data entry that maps those
properties to colors; component CSS uses semantic variables only.

The initial selector offers:

- `Midnight` — the current purple-black default;
- `VS Code Dark` — blue-gray editor palette;
- `Catppuccin Mocha` — warm dark pastel palette;
- `Catppuccin Latte` — light pastel palette;
- `Nord` — cool blue-gray palette;
- `Tokyo Night` — deep navy and electric blue palette.

The selected theme is stored under a versioned local-storage key and applied as
`data-theme` on the document root before the main UI renders where practical.
The selector is keyboard accessible, the current choice has a visible label,
and every theme must preserve readable text and focus indicators.

### Local account availability

The account panel exposes a `Konten verwalten` action that opens an accessible
local dialog listing every account returned by the provider. Each account has
independent `Aktiv` and `Sichtbar` controls. The normal account list contains
only accounts that are both active and visible; changing the state of the
currently selected account immediately chooses the saved account when still
allowed, then the configured default, then the first remaining selectable
account. If none remain, the mail panes are cleared and the dialog remains the
single path back to a usable state.

The browser stores only a versioned alias-to-boolean map under
`himalaya-web-account-state-v1`. Unknown accounts default to active and
visible, malformed entries are ignored, and storage failures leave the current
state in memory. The web UI does not mutate Himalaya configuration: adding or
permanently removing accounts requires the explicit `himalaya configure`
workflow, after which the dialog can reload the local configuration.

### App shell and versioning

The standalone app keeps the three-pane workflow but treats the shell as a
first-class product surface. The header exposes the local app identity and
version, while the account, folder, message, and reader panes retain their
existing responsibilities.

The mailbox navigation is a non-shrinking, wrapping flex section with a
bounded height and two-axis overflow. The account and envelope lists use the
remaining panel height explicitly. Desktop breakpoints widen the account and
message panes while preserving a usable reader pane. The package manifest is
the single source of truth for the semantic app version; the current release
is `0.2.0`.

### Standalone project layout

The application source lives at the repository root. Runtime installation
artifacts are kept separate from source:

```text
himalaya-web/
├── src/                       # React client and Fastify/Himalaya server
├── docs/superpowers/specs/    # reviewed design documents
├── docs/superpowers/plans/    # implementation plans after spec approval
├── deploy/systemd/            # user-service template
├── deploy/omarchy/            # bar widget and installation guidance
├── README.md
├── AGENTS.md
└── HANDOFF.md
```

The active service and plugin remain in `~/.config`; deployment templates must
use explicit paths or documented variables and must not embed credentials.

## Data flow and error handling

1. The bootstrap request invokes the existing Himalaya account command.
2. The server reads the local TOML file separately and extracts only email
   values for known account names.
3. The response joins safe account metadata and email values.
4. The browser derives account visibility, activation, and account/mailbox
   favorite state locally and sends only the selected account/mailbox
   identifiers for mail operations.
5. A config read failure is reported as a non-fatal address warning; account
   listing remains available.
6. Invalid theme names fall back to `midnight` and replace the stored value.
7. If a service restart invalidates an open page's ephemeral session, the
   client performs at most one browser reload and clears the recovery marker
   after a successful API response.

## Testing and acceptance criteria

- Unit tests reject or safely handle missing, duplicate, malformed, and
  unrelated TOML account sections without exposing secret fields.
- API tests assert that bootstrap includes the configured email and does not
  change the 401 behavior for missing session headers.
- Client behavior tests cover account favorite filtering, mailbox favorite
  scoping by account, empty favorite views, and favorite persistence keys.
- Account state tests cover malformed persistence, default active/visible
  behavior, independent controls, and safe account-selection fallback.
- Theme tests cover registry completeness, fallback to Midnight, persistence,
  and semantic variable presence.
- A headless browser check covers the account dialog, local persistence, and
  fallback after disabling the selected account using synthetic API data.
- `npm run typecheck`, `npm test`, `npm run build`, and the production npm audit
  pass.
- The post-move live smoke check confirms loopback root `200`, API `401`
  without a session, and an authorized read-only bootstrap.

## Explicit non-goals

- No automatic migration of credentials to another store.
- No server-side persistence of favorites or themes.
- No server-side persistence of account visibility or activation.
- No account creation or destructive account removal from the web UI.
- No remote browser access.
- No live send, delete, bulk move, or tag operation as part of this slice.
