# Himalaya Web UI Slice Implementation Plan

> **For agentic workers:** Implement this plan task-by-task with a failing test before each production behavior change. Do not commit unless the user explicitly requests a commit.

**Goal:** Add safe configured account addresses, independent account/mailbox favorites, and six persisted local themes to the standalone Himalaya Web GUI.

**Architecture:** Keep mail-provider access and configuration enrichment on the server, returning only `email: string | null` alongside the existing safe account metadata. Keep favorite sets and theme choice in browser-local versioned preferences, with pure client helpers for filtering, scoping, selection, and theme validation so the behavior is testable without a browser or real mail. Keep the existing loopback Fastify boundary, ephemeral session header, and read-only development constraints unchanged.

**Tech Stack:** TypeScript 5.9, React 19, Fastify 5, Vite 7, Vitest 3, Zod 4, Himalaya v2.1.0, TOML parsing through `@iarna/toml`, CSS custom properties.

**Spec:** `docs/superpowers/specs/2026-09-18-himalaya-web-ui-design.md`

## Global Constraints

- Keep user-facing UI text German; keep code, tests, and planning documents English.
- Never copy passwords, OAuth tokens, 1Password tokens, keyring contents, message bodies, or other secrets into source, tests, browser storage, logs, or Git.
- Read only the non-secret `email` field from `~/.config/himalaya/config.toml`; return no other TOML account fields.
- Preserve loopback binding at `127.0.0.1` and the `X-Himalaya-Session` API session boundary.
- Use synthetic TOML and synthetic mail data in automated tests; never send, delete, bulk-move, or tag real mail during tests.
- Do not add compose, send, delete, bulk actions, remote access, background synchronization, or unified inbox behavior.
- Do not modify or restart the active user service as part of implementation; the current active unit still points at `/home/dnames/projects/private/himalaya-web`, while deployment templates remain under `deploy/`.
- Do not commit or push changes unless explicitly requested.

---

### Task 1: Add non-secret account address enrichment

**Files:**
- Create: `src/server/account-config.ts`
- Create: `src/server/account-config.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/server/contracts.ts`
- Modify: `src/server/himalaya.ts`
- Modify: `src/server/himalaya.test.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/app.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- `Account` gains `email: string | null`.
- `AccountListResult` is `{ accounts: Account[]; addressWarning: string | null }`.
- `parseAccountEmails(source: string, accountNames: readonly string[])` returns `{ emails: Record<string, string | null>; warning: string | null }` and never exposes the parsed TOML object.
- `loadAccountEmails(accountNames: readonly string[], configPath?: string)` reads the default path `${HOME}/.config/himalaya/config.toml`, or `HIMALAYA_CONFIG_PATH` when set, and returns the same safe result.
- `HimalayaService.listAccounts()` returns `Promise<AccountListResult>`.
- `HimalayaCli.listAccounts()` keeps the existing Himalaya command and joins its account names with the config-derived email values.

- [ ] **Step 1: Add the parser dependency without reading live configuration.**

Run:

```bash
npm install @iarna/toml
```

Expected: `package.json` and `package-lock.json` contain the runtime dependency; no user configuration is read or printed.

- [ ] **Step 2: Write failing parser tests against synthetic TOML.**

Add tests with these exact behaviors:

```ts
it("returns only configured emails for known accounts", () => {
  const result = parseAccountEmails(
    [
      "[accounts.andre]",
      'email = "andre@example.test"',
      'description = "synthetic-unrelated-field"',
      "",
      "[accounts.other]",
      'email = "other@example.test"',
      "",
      "[not-an-account]",
      'email = "unrelated@example.test"',
    ].join("\\n"),
    ["andre", "missing"],
  );

  expect(result.warning).toBeNull();
  expect(result.emails).toEqual({ andre: "andre@example.test", missing: null });
  expect(JSON.stringify(result)).not.toContain("synthetic-unrelated-field");
});

it("keeps malformed or missing email fields non-fatal", () => {
  const result = parseAccountEmails(
    ["[accounts.andre]", "email = 42", "", "[accounts.empty]"].join("\\n"),
    ["andre", "empty", "missing"],
  );

  expect(result.warning).toBeNull();
  expect(result.emails).toEqual({ andre: null, empty: null, missing: null });
});

it("reports malformed TOML and duplicate account tables without returning data", () => {
  expect(parseAccountEmails("[accounts.andre\\nemail = \\\"broken", ["andre"]).warning).toContain("Adressen");
  expect(parseAccountEmails(
    ["[accounts.andre]", 'email = "one@example.test"', "[accounts.andre]", 'email = "two@example.test"'].join("\\n"),
    ["andre"],
  ).warning).toContain("Adressen");
});
```

Run: `npm test -- src/server/account-config.test.ts`

Expected: FAIL because the module and parser functions do not exist yet. If the test errors during collection, fix only the test import or fixture syntax until it fails for the missing behavior.

- [ ] **Step 3: Implement the safe config boundary.**

Implement `src/server/account-config.ts` with these rules:

```ts
export type AccountEmailResult = {
  emails: Record<string, string | null>;
  warning: string | null;
};

export function parseAccountEmails(source: string, accountNames: readonly string[]): AccountEmailResult;
export async function loadAccountEmails(configPath?: string): Promise<AccountEmailResult>;
```

Parse with `@iarna/toml`; catch parse/read errors and return `null` for every requested account plus the German non-fatal warning `Adressen konnten nicht aus der Himalaya-Konfiguration gelesen werden.`. Accept only non-empty string `email` values from `accounts[accountName]`; trim them and map every known name, including missing names, to either the email or `null`. Ignore unrelated tables. Do not include any other parsed field in the result or error text.

- [ ] **Step 4: Run parser tests to verify they pass.**

Run: `npm test -- src/server/account-config.test.ts`

Expected: PASS with all parser cases green and no secret fixture value present in the result.

- [ ] **Step 5: Write the failing account/API contract tests.**

Extend the account type and test fixtures with `email: string | null`. Add a Himalaya CLI test whose synthetic account-list response contains two aliases and whose temporary synthetic TOML contains one configured email; assert `listAccounts()` returns the joined email and `null` for the missing one. Add an app test asserting an authorized `GET /api/bootstrap` returns:

```ts
expect(response.json()).toEqual({
  accounts: [{ name: "andre", default: true, backends: ["imap", "smtp"], email: "andre@example.test" }],
  addressWarning: null,
});
```

Keep the existing missing-session test and assert it remains `401` before the service is consulted.

Run: `npm test -- src/server/himalaya.test.ts src/server/app.test.ts`

Expected: FAIL because `listAccounts()` and the bootstrap payload do not yet have the new result shape.

- [ ] **Step 6: Implement the joined account result.**

Update `Account`, the CLI-account parser, `HimalayaService`, `HimalayaCli`, and `createApp` so the Himalaya command still supplies `name`, `default`, and `backends`, then `HimalayaCli` calls `loadAccountEmails()` with the returned account names and attaches only `email`. Keep the account list usable when config loading fails by returning `email: null` for all accounts and the non-fatal `addressWarning`. Update synthetic test services with the explicit result shape.

- [ ] **Step 7: Verify the account/API slice and existing server behavior.**

Run:

```bash
npm test -- src/server/account-config.test.ts src/server/himalaya.test.ts src/server/app.test.ts
npm run typecheck
```

Expected: PASS; invalid session requests are still `401`, loopback/session checks remain unchanged, and no test reads the real Himalaya config.

---

### Task 2: Extract and test browser-local favorite behavior

**Files:**
- Create: `src/client/preferences.ts`
- Create: `src/client/preferences.test.ts`
- Modify: `src/client/main.tsx`
- Modify: `src/client/styles.css`

**Interfaces:**
- `FavoriteFilter` is `"all" | "favorites"`.
- `ACCOUNT_FAVORITES_KEY` preserves the existing account-favorite storage key `himalaya-web-favorites`.
- `MAILBOX_FAVORITES_KEY` is the new versioned key `himalaya-web-mailbox-favorites-v1`.
- `mailboxFavoriteKey(accountName, mailboxId)` returns `${accountName}:${mailboxId}`.
- `filterAccounts(accounts, query, filter, favoriteNames)` matches name or email case-insensitively, filters favorites when requested, then sorts favorites first and names alphabetically.
- `filterMailboxes(accountName, mailboxes, filter, favoriteKeys)` filters by account-scoped keys while preserving provider order.
- `chooseMailbox(mailboxes, savedMailboxId, filter, favoriteKeys, accountName)` chooses the saved visible mailbox, then `INBOX`, then the first visible mailbox, or `null`.

- [ ] **Step 1: Write failing pure behavior tests.**

Create synthetic accounts and mailboxes, then cover:

```ts
it("searches accounts by alias and configured email", () => {
  expect(filterAccounts(accounts, "example.test", "all", new Set()).map((account) => account.name)).toEqual(["andre"]);
});

it("puts account favorites first and filters to favorites", () => {
  const favorites = new Set(["work"]);
  expect(filterAccounts(accounts, "", "all", favorites).map((account) => account.name)).toEqual(["work", "andre"]);
  expect(filterAccounts(accounts, "", "favorites", favorites).map((account) => account.name)).toEqual(["work"]);
});

it("scopes mailbox favorites by account", () => {
  const favorites = new Set([mailboxFavoriteKey("andre", "INBOX")]);
  expect(filterMailboxes("andre", mailboxes, "favorites", favorites).map((mailbox) => mailbox.id)).toEqual(["INBOX"]);
  expect(filterMailboxes("work", mailboxes, "favorites", favorites)).toEqual([]);
});

it("chooses only a visible mailbox and returns null for an empty favorite view", () => {
  const favorites = new Set([mailboxFavoriteKey("andre", "Archive")]);
  expect(chooseMailbox(mailboxes, "INBOX", "favorites", favorites, "andre")).toBe("Archive");
  expect(chooseMailbox(mailboxes, "INBOX", "favorites", new Set(), "andre")).toBeNull();
});
```

Run: `npm test -- src/client/preferences.test.ts`

Expected: FAIL because the helper module does not exist.

- [ ] **Step 2: Implement the minimal pure preference helpers.**

Use the existing `Account` and `Mailbox` types. Treat a missing email as the searchable German fallback `Adresse nicht konfiguriert`, but do not mutate the account. Make `mailboxFavoriteKey` deterministic and do not use mailbox names without the account prefix.

- [ ] **Step 3: Run the pure behavior tests.**

Run: `npm test -- src/client/preferences.test.ts`

Expected: PASS with the account search, favorite ordering/filtering, account-scoped mailbox key, and empty-view selection cases.

- [ ] **Step 4: Integrate account favorites without changing existing persistence.**

In `main.tsx`, replace the inline account filtering with `filterAccounts`, add `accountFilterMode`, and add compact keyboard-accessible `Alle`/`Favoriten` controls. Keep the existing account favorite key so current users retain their preferences. Show the configured email below the alias and use `Adresse nicht konfiguriert` when `email` is `null`; keep backend text secondary. Render `Keine bevorzugten Konten` when the favorite filter has no result, without a destructive action. Account search must match both alias and email.

- [ ] **Step 5: Integrate independently scoped mailbox favorites.**

Add a separate `mailboxFavorites` set loaded from `MAILBOX_FAVORITES_KEY`, a `mailboxFilterMode`, and one star button per visible mailbox. Derive visible mailboxes with `filterMailboxes(selectedAccount, ...)`, use `chooseMailbox` after a mailbox response, and include the account name in every mailbox favorite key. When the favorite view is empty, show `Keine bevorzugten Ordner` and do not issue a message request with a hidden mailbox. When changing accounts, preserve both sets and scope only the displayed mailbox keys to the selected account. Keep the saved mailbox, then `INBOX`, then first visible mailbox selection order.

- [ ] **Step 6: Add focused styling and German accessible labels.**

Add styles for filter controls, mailbox rows with a star, selected/favorite states, compact account address text, and empty favorite views. Every star and filter control must have an explicit German accessible name or visible label. Do not introduce hard-coded theme colors in the new rules; use the semantic variables introduced in Task 3.

- [ ] **Step 7: Verify the favorite slice and regression behavior.**

Run:

```bash
npm test -- src/client/preferences.test.ts src/server/app.test.ts src/server/contracts.test.ts
npm run typecheck
```

Expected: PASS; account favorites still load from the existing key, mailbox favorites use a separate scoped key, and API/session tests remain green.

---

### Task 3: Add the six local themes and semantic CSS variables

**Files:**
- Create: `src/client/themes.ts`
- Create: `src/client/themes.test.ts`
- Modify: `src/client/main.tsx`
- Modify: `src/client/styles.css`
- Modify: `index.html`

**Interfaces:**
- `ThemeName` is `"midnight" | "vscode-dark" | "catppuccin-mocha" | "catppuccin-latte" | "nord" | "tokyo-night"`.
- `THEME_STORAGE_KEY` is `himalaya-web-theme-v1`.
- Every `ThemeDefinition` has a display label and values for `page`, `panel`, `field`, `border`, `text`, `mutedText`, `accent`, `accentContrast`, `selected`, `success`, `warning`, `error`, and `focus`.
- `resolveTheme(value: unknown)` returns a valid `ThemeName`, falling back to `midnight`.
- `applyTheme(root: HTMLElement, name: ThemeName)` sets `data-theme` and all semantic custom properties on the supplied root.
- `readStoredTheme(storage: Storage)` returns a valid theme and rewrites invalid storage to `midnight`.

- [ ] **Step 1: Write failing theme registry and persistence tests.**

Cover exact registry membership, semantic variable completeness, fallback, persistence repair, and a readable contrast threshold. The contrast helper may remain test-local:

```ts
it("contains exactly the six supported themes", () => {
  expect(Object.keys(THEMES)).toEqual([
    "midnight", "vscode-dark", "catppuccin-mocha", "catppuccin-latte", "nord", "tokyo-night",
  ]);
});

it("provides every semantic variable and a visible focus color", () => {
  for (const theme of Object.values(THEMES)) {
    expect(theme.colors).toMatchObject({ page: expect.any(String), panel: expect.any(String), field: expect.any(String), border: expect.any(String), text: expect.any(String), mutedText: expect.any(String), accent: expect.any(String), accentContrast: expect.any(String), selected: expect.any(String), success: expect.any(String), warning: expect.any(String), error: expect.any(String), focus: expect.any(String) });
  }
});

it("falls back to Midnight and repairs invalid storage", () => {
  const storage = new MemoryStorage([[THEME_STORAGE_KEY, "not-a-theme"]]);
  expect(readStoredTheme(storage)).toBe("midnight");
  expect(storage.getItem(THEME_STORAGE_KEY)).toBe("midnight");
});
```

Run: `npm test -- src/client/themes.test.ts`

Expected: FAIL because the registry and persistence functions do not exist.

- [ ] **Step 2: Implement the data-only theme registry and safe persistence.**

Define the six named palettes from the spec with stable labels `Midnight`, `VS Code Dark`, `Catppuccin Mocha`, `Catppuccin Latte`, `Nord`, and `Tokyo Night`. Use only local data; never fetch a theme or asset from the network. `resolveTheme` must accept only exact registry keys. `readStoredTheme` must catch storage errors, return `midnight`, and attempt to replace invalid values without allowing a storage failure to block rendering.

- [ ] **Step 3: Run theme tests to verify the registry.**

Run: `npm test -- src/client/themes.test.ts`

Expected: PASS with all six themes, all semantic fields, fallback repair, and contrast assertions green.

- [ ] **Step 4: Apply themes before React renders and expose a keyboard-accessible selector.**

In `main.tsx`, read the versioned theme before `createRoot`, call `applyTheme(document.documentElement, initialTheme)`, and use a controlled `<select>` with a visible German label such as `Farbschema`. On change, persist the validated theme and reapply its variables. The selected theme label must remain visible in the top bar. Keep all preference storage limited to theme names, account favorite names, and account-scoped mailbox favorite keys.

- [ ] **Step 5: Replace hard-coded component palette variables.**

In `styles.css`, define the Midnight defaults and replace `--ink`, `--muted`, `--soft`, `--line`, `--accent-dark`, `--accent-soft`, `--danger`, and direct page/panel colors with semantic variables. Add rules for all six `data-theme` values only where a component-specific adjustment is necessary; otherwise let `applyTheme` set the values. Preserve visible `:focus-visible` outlines and use the theme variables for status, selection, panel, field, border, text, and error/success/warning states. Keep the sanitized HTML message iframe intentionally readable on its white document background.

- [ ] **Step 6: Keep the document metadata compatible with selected themes.**

Update `index.html` color-scheme metadata only if required by the final palettes; do not add remote fonts, images, or scripts. The startup path must continue to work when local storage is missing, malformed, or unavailable.

- [ ] **Step 7: Verify the theme slice and build.**

Run:

```bash
npm test -- src/client/themes.test.ts src/client/preferences.test.ts
npm run typecheck
npm run build
```

Expected: PASS with a production bundle that contains no missing CSS variables or TypeScript errors.

---

### Task 4: Documentation, full verification, and local smoke check

**Files:**
- Modify: `README.md`
- Modify: `HANDOFF.md`

**Interfaces:**
- Documentation describes the implemented address mapping, separate browser-local favorite keys, six themes, and the fact that the live user service is external to this repository.

- [ ] **Step 1: Update English project documentation.**

Change the current-status and verification sections in `README.md` to state that account addresses come from the non-secret TOML `email` field, account and mailbox favorites are independent browser preferences, and the selector offers the six local themes. Record the active service path discrepancy as deployment still pending rather than claiming this repository is live.

- [ ] **Step 2: Update the handoff with observed implementation state.**

Replace the pending-slice notes in `HANDOFF.md` with the implemented feature summary, exact storage keys, test commands, and the fact that no live mail mutation was performed. Do not include any real account address, token, password, or keyring output.

- [ ] **Step 3: Run the complete verification suite.**

Run:

```bash
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

Expected: all commands exit successfully, tests remain synthetic, and the audit reports no high-severity production finding.

- [ ] **Step 4: Perform a read-only local smoke check without touching the active service.**

Start the repository build on an unused loopback port, for example:

```bash
HIMALAYA_WEB_PORT=47832 npm start
```

In a separate shell, verify the root returns `200`, `/api/bootstrap` without `X-Himalaya-Session` returns `401`, and stop before any mail mutation. If an authorized bootstrap is needed, use only the locally printed ephemeral session header and record only the status code and account count, never the response body containing addresses.

- [ ] **Step 5: Report remaining deployment work explicitly.**

Report that the repository build and local smoke check are complete, but the enabled `himalaya-web.service` still points to `/home/dnames/projects/private/himalaya-web`. Do not restart, migrate, or publish the service until the user explicitly asks for that deployment action.

---

## Plan self-review

- Spec coverage: account address mapping and non-fatal config errors are covered by Task 1; independent account/mailbox favorites and scoped keys by Task 2; all six themes, semantic variables, persistence, focus, and fallback by Task 3; documentation and all acceptance commands by Task 4.
- Security coverage: no task returns parsed secret fields, stores mail bodies, changes loopback/session checks, or performs live mail mutation.
- Type consistency: `Account.email` is nullable from Task 1; all client filtering helpers consume that type; `AccountListResult` is used by both `HimalayaCli` and `createApp`; theme functions use the exact `ThemeName` union and registry keys.
- Placeholder scan: no implementation step depends on an unresolved design choice or an unstated external service.
- Scope check: the three independent features share only the existing account/bootstrap and client preference boundaries, so one plan preserves a working green application after each task.
