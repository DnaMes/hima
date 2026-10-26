# Himalaya Web Slice 5e-3: Saved Searches

**Date:** 2026-10-02

**Status:** Designed autonomously under the operator's goal "work autonomously
until everything is done". Every decision below is judgment to correct on
review; nothing here is a prior operator decision.

## Goal

Let the operator name a search (text, field, unread flag, scope and filters
from Slice 5c) and run it again with one click.

## Context and constraints

- Client-only: the state a search needs already lives in the client
  (`activeSearch` = `{ text, field, unread, filters }`, `SearchFilters` from
  `src/client/search-state.ts`). No server route is needed, and no mail data is
  stored: only the operator's own search terms.
- Browser storage is already used for local UI state with versioned keys
  (`himalaya-web-account-state-v1`, favorites, last view). A saved search follows
  the same pattern, so it is per browser, like those.
- `AGENTS.md`: never store passwords, tokens or mail content in browser storage.
  Search terms can contain personal words, which is accepted for local-only
  preferences but is noted in the README.

## Decisions

| Topic | Decision |
|---|---|
| Storage | `localStorage` key `himalaya-web-saved-searches-v1`; a JSON array of entries; at most 30 entries. Not synced to the server (out of scope). |
| Entry | `{ id: string, name: string, text: string, field: SearchField, unread: boolean, filters: SearchFilters }`. |
| Names | Trimmed, 1–40 characters; saving under an existing name (case-insensitive) replaces that entry instead of adding a second one. |
| What a saved search contains | The applied search, i.e. what the list currently shows: `activeSearch`. The scope is stored as chosen ("Dieser Ordner" means: the folder open when it is run). |
| Applying | Fills the search form (text, field, unread, filters), sets `activeSearch` and resets to page 1; same code path as typing and pressing "Suchen". |
| Saving an empty search | Rejected (text empty and all filters default): there is nothing to save. |
| Corrupt storage | Treated as an empty list, never thrown; invalid entries are dropped on read. |

## Architecture

### `src/client/saved-searches.ts` (new, pure)

```ts
type SavedSearch = { id: string; name: string; text: string; field: SearchField; unread: boolean; filters: SearchFilters };
const SAVED_SEARCHES_KEY = "himalaya-web-saved-searches-v1";
const MAX_SAVED_SEARCHES = 30;
function readSavedSearches(storage: Pick<Storage, "getItem">): SavedSearch[];
function writeSavedSearches(storage: Pick<Storage, "setItem">, list: readonly SavedSearch[]): void;
function isSearchWorthSaving(search: { text: string; unread: boolean; filters: SearchFilters }): boolean;
function upsertSavedSearch(list: readonly SavedSearch[], draft: Omit<SavedSearch, "id">): { list: SavedSearch[]; error: string | null };
function removeSavedSearch(list: readonly SavedSearch[], id: string): SavedSearch[];
```

`readSavedSearches` validates every field (types, enum values for `field`, `scope`,
`flag`, `order`, date strings via the same `YYYY-MM-DD` shape, name length) and drops
what does not fit. `upsertSavedSearch` returns a German `error` for an empty or
too long name, an empty search, or a full list (30 entries, new name).

### Client (`main.tsx`)

A "Gespeicherte Suchen" control under the search form: a select listing the saved
names ("Gespeicherte Suche wählen …" first); choosing one applies it. Next to it
"Suche speichern" opens a small inline form (name field plus "Speichern"/"Abbrechen")
and, when a search is selected, "Löschen". Notices: "Suche gespeichert.",
"Gespeicherte Suche gelöscht."; errors use the existing error area.

## Error handling

Storage errors (full, disabled) are swallowed on write like the other preferences
and the in-memory list stays valid; validation errors are shown, nothing is saved.

## Testing

- Unit: round-trip, corrupt JSON, invalid entries dropped, field/scope/flag/order
  validation, name rules, replace-by-name (case-insensitive), cap of 30,
  `isSearchWorthSaving`, removal.
- Playwright (synthetic API): save a search, reload the page, pick it and see the
  request body/query; replace by name; delete; an empty search cannot be saved;
  the stored value never contains anything but the search terms.

## Out of scope

Syncing across browsers or devices, renaming in place, folders of saved searches,
a counter of new matches per saved search, a saved sort order beyond the filter
fields already in `SearchFilters`.
