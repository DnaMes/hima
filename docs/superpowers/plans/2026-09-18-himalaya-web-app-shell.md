# Himalaya Web App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the three-pane Himalaya Mail shell keep its folder navigation visible, establish a responsive visual hierarchy, and expose a reproducible application version.

**Architecture:** Keep the current React/Fastify boundaries and semantic theme variables. Give the mailbox navigation and message list explicit flex sizing, use responsive grid breakpoints for the three panes, and derive the displayed application version from `package.json` through a small shared metadata module.

**Tech Stack:** React 19, TypeScript, Vite, CSS custom properties, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-18-himalaya-web-ui-design.md` plus the approved visual direction from the 2026-09-18 UI review.

## Global Constraints

- Keep user-facing UI text German; keep code, tests, and planning documents English.
- Preserve loopback binding, the API session boundary, and the existing Himalaya/keyring integration.
- Use no real-mail mutations during testing; layout checks use the local application shell only.
- Do not store or expose passwords, OAuth tokens, keyring contents, or message bodies in source, tests, browser storage, logs, or Git.
- Keep the application local and use existing semantic theme variables; do not add remote fonts, images, or theme services.
- Version the standalone app as `0.2.0` and keep the package manifest as the single version source.

### Task 1: Establish application metadata and regression contracts

**Files:**
- Create: `src/shared/app-meta.ts`
- Test: `src/shared/app-meta.test.ts`
- Test: `src/client/layout-contract.test.ts`
- Modify: `src/server/app.ts`
- Test: `src/server/app.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- `src/shared/app-meta.ts` exports `APP_NAME`, `APP_VERSION`, and `APP_VERSION_LABEL`.
- The layout contract asserts that `.mailbox-tabs` cannot shrink away and `.envelope-list` owns remaining vertical space.

- [x] **Step 1: Write failing tests for app metadata and layout sizing**

  Add tests that expect `APP_NAME` to be `Himalaya Mail`, `APP_VERSION` to be `0.2.0`, and `APP_VERSION_LABEL` to be `v0.2.0`. Add a CSS contract test that reads `styles.css` and expects the mailbox rule to contain `flex: 0 0 auto`, `min-height`, `max-height`, wrapping, and two-axis overflow, while the envelope rule contains `flex: 1 1 auto` and `min-height: 0`.

- [x] **Step 2: Run the focused tests and verify the expected failures**

  Run `npm test -- src/shared/app-meta.test.ts src/client/layout-contract.test.ts`.
  Expected: the metadata module is missing and the current CSS contract fails because the folder navigation is shrinkable and the message list has no explicit flex sizing.

- [x] **Step 3: Add the package version and minimal metadata module**

  Set `package.json` and its lockfile root package metadata to version `0.2.0`. Implement the shared constants by importing the manifest version; do not duplicate the version string in production code.

- [x] **Step 4: Run the focused tests and verify they pass**

  Run `npm test -- src/shared/app-meta.test.ts src/client/layout-contract.test.ts`.
  Expected: all focused tests pass after the CSS changes from Task 2 are present.

### Task 2: Repair the folder navigation and responsive shell

**Files:**
- Modify: `src/client/styles.css`
- Modify: `src/client/main.tsx`
- Test: `src/client/layout-contract.test.ts`

**Interfaces:**
- The mailbox section remains the existing account-scoped favorite view and keeps its current buttons and callbacks.
- The DOM gains a compact German `ORDNER` section label and visible mailbox count without changing API payloads.

- [x] **Step 1: Keep the CSS contract red before implementation**

  Confirm the focused layout test from Task 1 fails against the current shrinkable rules before modifying production CSS.

- [x] **Step 2: Add explicit flex sizing and responsive grid rules**

  Make account and envelope lists flexible with `flex: 1 1 auto` and `min-height: 0`. Make `.mailbox-tabs` a non-shrinking, wrapping navigation with a bounded height, stable scrollbar gutter, and both-axis overflow. Use a wider desktop middle column and a breakpoint for narrower three-pane windows while keeping the reader pane usable.

- [x] **Step 3: Add the mailbox section identity and app chrome**

  Add the `ORDNER` label/count row above the existing `Alle`/`Favoriten` controls. Replace the accidental `PIMALAYA` eyebrow with the product identity, render the shared version label, and keep the local status indicator visible.

- [x] **Step 4: Run the focused tests and verify they pass**

  Run `npm test -- src/shared/app-meta.test.ts src/client/layout-contract.test.ts`.
  Expected: all layout and metadata contracts pass.

### Task 3: Document the standalone app release

**Files:**
- Create: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `HANDOFF.md`
- Modify: `docs/superpowers/specs/2026-09-18-himalaya-web-ui-design.md`

**Interfaces:**
- Documentation records `0.2.0` as the current local app version and describes the repaired folder navigation.
- No deployment unit path or credential handling changes.

- [x] **Step 1: Add the changelog entry and current-version documentation**

  Record the app-shell, theme, account-address, and favorite improvements under `0.2.0` with the date `2026-09-18`. Update README, handoff, and the design spec status to reflect that this approved UI slice is implemented.

- [x] **Step 2: Review the documentation for secret and language constraints**

  Search changed docs for password/token/keyring values and confirm user-facing copy remains German while code/planning prose remains English.

### Task 4: Verify behavior and rendered layout

**Files:**
- Create: temporary Playwright script outside the repository
- Inspect: `dist/`, active loopback service, and generated screenshots

**Interfaces:**
- The test uses the existing local session-injected page read-only and does not invoke send, delete, bulk move, or tag actions.

- [x] **Step 1: Run the complete automated checks**

  Run `npm run typecheck`, `npm test`, `npm run build`, and `npm audit --omit=dev --audit-level=high`.

- [x] **Step 2: Inspect the rendered app at desktop viewports**

  Use Playwright against the active loopback app at 2048×1152 and 1440×900. Capture screenshots and inspect the computed heights of `.mailbox-tabs` and `.envelope-list`, confirming that folder buttons are visible and the message list remains scrollable.

- [x] **Step 3: Recheck the permanent service and loopback boundary**

  Confirm the user service remains active from `/home/dnames/projects/tools/himalaya-web`, root access returns `200`, and an API request without the session header still returns `401`.

- [x] **Step 4: Report evidence and remaining uncertainty**

  Report exact command results, screenshot paths, service state, and any browser-only limitation. Do not claim the work is complete without the verification output.
