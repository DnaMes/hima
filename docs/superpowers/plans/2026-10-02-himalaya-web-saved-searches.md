# Saved Searches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Name a search (text, field, unread, scope, filters) and run it again with one click.

**Architecture:** A pure `saved-searches.ts` (storage, validation, upsert/remove) plus a small control under the search form in `main.tsx`; client-only, `localStorage`.

**Tech Stack:** TypeScript (strict), React 19, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-02-himalaya-web-saved-searches-design.md`

## Global Constraints

- Client-only; only search terms and filters are stored, under `himalaya-web-saved-searches-v1`; at most 30 entries; names 1–40 characters, replaced case-insensitively by name.
- UI text German; code, tests, docs, commits English. No server change.
- One commit for the slice via `git-ops`; never stage `src/server/rules.ts` / `src/server/rules.test.ts`.

## Review Focus

- Corrupt or hostile storage (not JSON, wrong types, unknown enum values, 31+ entries, huge strings) must read as a clean, bounded list — Task 1 tests.
- Saving under the same name in a different case replaces instead of duplicating; an empty search and an over-long name are rejected with a German message — Task 1 tests.
- A saved scope "Dieses Konto"/"Alle Konten" must apply correctly from any open view, and applying must reset to page 1 — Task 2 Playwright test.

---

### Task 1: Pure storage and validation

**Files:** Create `src/client/saved-searches.ts`, `src/client/saved-searches.test.ts`.

**Interfaces — Produces:** `SavedSearch`, `SAVED_SEARCHES_KEY`, `MAX_SAVED_SEARCHES = 30`, `readSavedSearches(storage: Pick<Storage,"getItem">): SavedSearch[]`, `writeSavedSearches(storage: Pick<Storage,"setItem">, list: readonly SavedSearch[]): void` (swallows storage errors), `isSearchWorthSaving(search: { text: string; unread: boolean; filters: SearchFilters }): boolean` (text non-blank, `unread`, or any filter differing from `DEFAULT_FILTERS`), `upsertSavedSearch(list: readonly SavedSearch[], draft: Omit<SavedSearch,"id">): { list: SavedSearch[]; error: string | null }`, `removeSavedSearch(list: readonly SavedSearch[], id: string): SavedSearch[]`. Types come from `search-state.ts` (`SearchFilters`) and `main.tsx`'s `SearchField` literal union `"all" | "subject" | "from" | "to" | "body"` (define it locally and export it).

- [ ] **Step 1: Failing tests:** write/read round trip with an in-memory storage; `null`, invalid JSON, a non-array, entries with wrong field types, unknown `field`/`scope`/`flag`/`order`, a malformed date, a name longer than 40 or empty, text longer than 512 are dropped while valid entries survive; more than 30 stored entries read as the first 30; `upsertSavedSearch` adds with a generated unique `id`, replaces by name ignoring case and keeps the `id`, returns the German errors "Bitte einen Namen eingeben.", "Der Name darf höchstens 40 Zeichen haben.", "Es gibt nichts zu speichern: Suchtext oder Filter fehlen.", "Es können höchstens 30 Suchen gespeichert werden." (new name on a full list; replacing still works); `isSearchWorthSaving` cases; `removeSavedSearch`; `writeSavedSearches` does not throw when `setItem` throws.
- [ ] **Step 2:** `npx vitest run src/client/saved-searches.test.ts` → FAIL.
- [ ] **Step 3: Implement** (ids via `crypto.randomUUID()` with a counter fallback).
- [ ] **Step 4:** the test file and `npm run typecheck` → PASS.

### Task 2: The control in the search form

**Files:** Modify `src/client/main.tsx`, `src/client/styles.css`; create `tests/e2e/saved-searches.spec.ts`.

**Interfaces — Consumes:** Task 1; `activeSearch`, `setSearchText/Field/UnreadOnly`, `setSearchFilters`, `setActiveSearch`, `setPage`. **Produces:** state `savedSearches` (read once from `localStorage`, written on change), a `<select aria-label="Gespeicherte Suchen">` ("Gespeicherte Suche wählen …" first) that applies the chosen entry (form state + `activeSearch`, page 1), a button "Suche speichern" opening an inline form (`<input aria-label="Name der Suche">`, "Speichern", "Abbrechen") that saves `activeSearch` via `upsertSavedSearch`, and a button "Löschen" (visible when an entry is chosen). Notices "Suche gespeichert." / "Gespeicherte Suche gelöscht."; validation errors through `setError`.

- [ ] **Step 1: Failing Playwright tests (synthetic routes as in `tests/e2e/cross-folder-search.spec.ts`):** run a search with text, filters and the "Alle Konten" scope, save it as "Rechnungen", reload the page, pick it: the request (GET query or `/api/search` body) carries the text, filters and scope and the page is 1; saving the same name in other case replaces (one option left); an empty search shows "Es gibt nichts zu speichern: Suchtext oder Filter fehlen." and stores nothing; "Löschen" removes the entry and the stored list; `localStorage` holds only the keys `id,name,text,field,unread,filters`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `npx playwright test` (all), `npx vitest run`, typecheck, build → PASS.

### Task 3: Release

- [ ] Bump to `0.15.0`; `doc-ops` updates README/HANDOFF/AGENTS; full verification; independent diff review by `summarizer` and a fix pass; rebuild, restart `himalaya-web.service`, check `/api/watch/summary` `error: null`, correct commit-state wording in the docs, `git-ops` commits once (`feat: add saved searches (0.15.0)`) with explicit paths including new files and pushes `main`.
