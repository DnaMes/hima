import { DEFAULT_FILTERS, type SearchFilters } from "./search-state.js";

export type SearchField = "all" | "subject" | "from" | "to" | "body";

export type SavedSearch = {
  id: string;
  name: string;
  text: string;
  field: SearchField;
  unread: boolean;
  filters: SearchFilters;
};

export const SAVED_SEARCHES_KEY = "himalaya-web-saved-searches-v1";
export const MAX_SAVED_SEARCHES = 30;
const MAX_NAME = 40;
const MAX_TEXT = 512;

const FIELDS: readonly string[] = ["all", "subject", "from", "to", "body"];
const SCOPES: readonly string[] = ["folder", "account", "all"];
const FLAGS: readonly string[] = ["", "flagged", "seen", "unseen", "answered"];
const ORDERS: readonly string[] = ["desc", "asc"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isDay = (value: unknown): value is string => value === "" || (typeof value === "string" && DAY.test(value));

function parseFilters(value: unknown): SearchFilters | null {
  if (!isRecord(value)) return null;
  const { scope, includeJunk, from, until, flag, order, hasAttachment } = value;
  if (typeof scope !== "string" || !SCOPES.includes(scope) || typeof includeJunk !== "boolean" || typeof hasAttachment !== "boolean") return null;
  if (!isDay(from) || !isDay(until) || typeof flag !== "string" || !FLAGS.includes(flag) || typeof order !== "string" || !ORDERS.includes(order)) return null;
  return { scope, includeJunk, from, until, flag, order, hasAttachment } as SearchFilters;
}

function parseEntry(value: unknown): SavedSearch | null {
  if (!isRecord(value)) return null;
  const { id, name, text, field, unread } = value;
  if (typeof id !== "string" || id.length === 0 || id.length > 64) return null;
  if (typeof name !== "string" || name.trim().length === 0 || name.length > MAX_NAME) return null;
  if (typeof text !== "string" || text.length > MAX_TEXT) return null;
  if (typeof field !== "string" || !FIELDS.includes(field) || typeof unread !== "boolean") return null;
  const filters = parseFilters(value.filters);
  return filters ? { id, name, text, field: field as SearchField, unread, filters } : null;
}

export function readSavedSearches(storage: Pick<Storage, "getItem">): SavedSearch[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SAVED_SEARCHES_KEY) ?? "null");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => parseEntry(item) ?? []).slice(0, MAX_SAVED_SEARCHES);
  } catch {
    return [];
  }
}

export function writeSavedSearches(storage: Pick<Storage, "setItem">, list: readonly SavedSearch[]): void {
  try {
    storage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(list));
  } catch {
    // Browser storage can be unavailable or full; the in-memory list stays valid.
  }
}

export function isSearchWorthSaving(search: { text: string; unread: boolean; filters: SearchFilters }): boolean {
  return search.text.trim() !== "" || search.unread || (Object.keys(DEFAULT_FILTERS) as Array<keyof SearchFilters>).some((key) => search.filters[key] !== DEFAULT_FILTERS[key]);
}

let counter = 0;
const newId = (): string => globalThis.crypto?.randomUUID?.() ?? `ss-${Date.now()}-${counter++}`;

export function upsertSavedSearch(list: readonly SavedSearch[], draft: Omit<SavedSearch, "id">): { list: SavedSearch[]; error: string | null } {
  const name = draft.name.trim();
  const fail = (error: string) => ({ list: [...list], error });
  if (name.length === 0) return fail("Bitte einen Namen eingeben.");
  if (name.length > MAX_NAME) return fail("Der Name darf höchstens 40 Zeichen haben.");
  if (!isSearchWorthSaving(draft)) return fail("Es gibt nichts zu speichern: Suchtext oder Filter fehlen.");

  const existing = list.find((item) => item.name.toLowerCase() === name.toLowerCase());
  if (existing) return { list: list.map((item) => (item === existing ? { ...draft, name, id: existing.id } : item)), error: null };
  if (list.length >= MAX_SAVED_SEARCHES) return fail("Es können höchstens 30 Suchen gespeichert werden.");
  return { list: [...list, { ...draft, name, id: newId() }], error: null };
}

export function removeSavedSearch(list: readonly SavedSearch[], id: string): SavedSearch[] {
  return list.filter((item) => item.id !== id);
}
