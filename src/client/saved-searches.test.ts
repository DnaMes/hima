import { describe, expect, it } from "vitest";

import { DEFAULT_FILTERS, type SearchFilters } from "./search-state.js";
import {
  isSearchWorthSaving,
  MAX_SAVED_SEARCHES,
  readSavedSearches,
  removeSavedSearch,
  SAVED_SEARCHES_KEY,
  upsertSavedSearch,
  writeSavedSearches,
  type SavedSearch,
} from "./saved-searches.js";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const filters = (overrides: Partial<SearchFilters> = {}): SearchFilters => ({ ...DEFAULT_FILTERS, ...overrides });
const draft = (overrides: Partial<Omit<SavedSearch, "id">> = {}): Omit<SavedSearch, "id"> => ({
  name: "Rechnungen", text: "rechnung", field: "subject", unread: false, filters: filters({ scope: "all", from: "2026-01-01" }), ...overrides,
});
const entry = (overrides: Partial<SavedSearch> = {}): SavedSearch => ({ id: "id-1", ...draft(), ...overrides });
const stored = (value: unknown): MemoryStorage => {
  const storage = new MemoryStorage();
  storage.setItem(SAVED_SEARCHES_KEY, typeof value === "string" ? value : JSON.stringify(value));
  return storage;
};

describe("readSavedSearches / writeSavedSearches", () => {
  it("round-trips a list", () => {
    const storage = new MemoryStorage();
    writeSavedSearches(storage, [entry(), entry({ id: "id-2", name: "Andere" })]);

    expect(readSavedSearches(storage)).toEqual([entry(), entry({ id: "id-2", name: "Andere" })]);
  });

  it.each([null, "{not json", "42", JSON.stringify({ a: 1 }), JSON.stringify("text")])("reads %j as an empty list", (value) => {
    const storage = new MemoryStorage();
    if (value !== null) storage.setItem(SAVED_SEARCHES_KEY, value);

    expect(readSavedSearches(storage)).toEqual([]);
  });

  it("drops invalid entries and keeps valid ones", () => {
    const bad: unknown[] = [
      { ...entry(), id: 7 },
      { ...entry(), name: "" },
      { ...entry(), name: "x".repeat(41) },
      { ...entry(), text: "x".repeat(513) },
      { ...entry(), field: "everything" },
      { ...entry(), unread: "yes" },
      { ...entry(), filters: { ...DEFAULT_FILTERS, scope: "galaxy" } },
      { ...entry(), filters: { ...DEFAULT_FILTERS, flag: "deleted" } },
      { ...entry(), filters: { ...DEFAULT_FILTERS, order: "sideways" } },
      { ...entry(), filters: { ...DEFAULT_FILTERS, from: "2026-9-1" } },
      { ...entry(), filters: { ...DEFAULT_FILTERS, hasAttachment: "no" } },
      { ...entry(), filters: null },
      "string", null, 5,
    ];

    expect(readSavedSearches(stored([...bad, entry({ id: "ok" })]))).toEqual([entry({ id: "ok" })]);
  });

  it("reads at most the first 30 entries", () => {
    const many = Array.from({ length: 31 }, (_, index) => entry({ id: `id-${index}`, name: `Suche ${index}` }));

    expect(readSavedSearches(stored(many))).toHaveLength(MAX_SAVED_SEARCHES);
  });

  it("does not throw when the storage refuses a write", () => {
    expect(() => writeSavedSearches({ setItem: () => { throw new Error("quota"); } }, [entry()])).not.toThrow();
  });
});

describe("isSearchWorthSaving", () => {
  it("needs text, the unread flag, or a filter", () => {
    expect(isSearchWorthSaving({ text: "  ", unread: false, filters: DEFAULT_FILTERS })).toBe(false);
    expect(isSearchWorthSaving({ text: "x", unread: false, filters: DEFAULT_FILTERS })).toBe(true);
    expect(isSearchWorthSaving({ text: "", unread: true, filters: DEFAULT_FILTERS })).toBe(true);
    expect(isSearchWorthSaving({ text: "", unread: false, filters: filters({ flag: "flagged" }) })).toBe(true);
    expect(isSearchWorthSaving({ text: "", unread: false, filters: filters({ scope: "all" }) })).toBe(true);
  });
});

describe("upsertSavedSearch", () => {
  it("adds a trimmed entry with a unique id", () => {
    const first = upsertSavedSearch([], draft({ name: "  Eins  " }));
    const second = upsertSavedSearch(first.list, draft({ name: "Zwei" }));

    expect(first.error).toBeNull();
    expect(first.list[0]?.name).toBe("Eins");
    expect(second.list).toHaveLength(2);
    expect(second.list[0]!.id).not.toBe(second.list[1]!.id);
  });

  it("replaces an entry of the same name, ignoring case, and keeps its id", () => {
    const { list } = upsertSavedSearch([entry({ id: "keep" })], draft({ name: "RECHNUNGEN", text: "neu" }));

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "keep", name: "RECHNUNGEN", text: "neu" });
  });

  it.each([
    [{ name: "   " }, "Bitte einen Namen eingeben."],
    [{ name: "x".repeat(41) }, "Der Name darf höchstens 40 Zeichen haben."],
    [{ text: " ", unread: false, filters: DEFAULT_FILTERS }, "Es gibt nichts zu speichern: Suchtext oder Filter fehlen."],
  ])("rejects %j", (overrides, message) => {
    const existing = [entry()];
    const result = upsertSavedSearch(existing, draft(overrides));

    expect(result.error).toBe(message);
    expect(result.list).toEqual(existing);
  });

  it("refuses a new name on a full list but still replaces an existing one", () => {
    const full = Array.from({ length: MAX_SAVED_SEARCHES }, (_, index) => entry({ id: `id-${index}`, name: `Suche ${index}` }));

    expect(upsertSavedSearch(full, draft({ name: "Neu" })).error).toBe("Es können höchstens 30 Suchen gespeichert werden.");
    expect(upsertSavedSearch(full, draft({ name: "suche 3" })).error).toBeNull();
  });
});

describe("removeSavedSearch", () => {
  it("removes by id and ignores unknown ids", () => {
    const list = [entry(), entry({ id: "id-2", name: "Zwei" })];

    expect(removeSavedSearch(list, "id-1").map((item) => item.id)).toEqual(["id-2"]);
    expect(removeSavedSearch(list, "nope")).toEqual(list);
  });
});
