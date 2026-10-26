import { describe, expect, it } from "vitest";

import { activeChips, clearFilter, DEFAULT_FILTERS, filterFields, searchBody, usesSearchRoute, type SearchFilters } from "./search-state.js";

const filters = (overrides: Partial<SearchFilters> = {}): SearchFilters => ({ ...DEFAULT_FILTERS, ...overrides });

describe("activeChips", () => {
  it("shows nothing for the default filters", () => {
    expect(activeChips(DEFAULT_FILTERS)).toEqual([]);
  });

  it("labels every non-default filter in German, in a stable order", () => {
    expect(activeChips(filters({
      scope: "all", from: "2026-09-01", until: "2026-09-30", flag: "unseen", order: "asc", hasAttachment: true, includeJunk: true,
    }))).toEqual([
      { key: "scope", label: "Alle Konten" },
      { key: "from", label: "Von 01.09.2026" },
      { key: "until", label: "Bis 30.09.2026" },
      { key: "flag", label: "Ungelesen" },
      { key: "order", label: "Älteste zuerst" },
      { key: "hasAttachment", label: "Mit Anhang" },
      { key: "includeJunk", label: "Auch Papierkorb/Spam" },
    ]);
  });

  it("names the account scope and every flag", () => {
    expect(activeChips(filters({ scope: "account" }))[0]?.label).toBe("Dieses Konto");
    const labels = (["flagged", "seen", "unseen", "answered"] as const).map((flag) => activeChips(filters({ flag }))[0]?.label);
    expect(labels).toEqual(["Markiert", "Gelesen", "Ungelesen", "Beantwortet"]);
  });
});

describe("clearFilter", () => {
  it("resets only the named filter to its default", () => {
    const cleared = clearFilter(filters({ from: "2026-09-01", flag: "seen", scope: "all" }), "from");
    expect(cleared).toEqual(filters({ flag: "seen", scope: "all" }));
  });
});

describe("filterFields", () => {
  it("emits only non-default values and order only when ascending", () => {
    expect(filterFields(DEFAULT_FILTERS)).toEqual({});
    expect(filterFields(filters({ order: "desc", flag: "flagged" }))).toEqual({ flag: "flagged" });
    expect(filterFields(filters({ from: "2026-09-01", until: "2026-09-30", order: "asc" })))
      .toEqual({ from: "2026-09-01", until: "2026-09-30", order: "asc" });
  });
});

describe("searchBody", () => {
  const base = { text: "invoice", field: "subject", unread: true, page: 2, pageSize: 25, accounts: ["alpha", "beta"] };

  it("sends the account list but no folder identity for the all scope", () => {
    const body = searchBody({ ...base, filters: filters({ scope: "all", includeJunk: true, hasAttachment: true }), current: { account: "alpha", mailbox: "INBOX" } });
    expect(body).toEqual({
      scope: "all", accounts: ["alpha", "beta"], includeJunk: true, hasAttachment: true,
      page: 2, pageSize: 25, field: "subject", q: "invoice", unread: true,
    });
  });

  it("sends the open account and folder for the account scope, plus the filter fields", () => {
    const body = searchBody({ ...base, filters: filters({ scope: "account", from: "2026-09-01", flag: "unseen" }), current: { account: "alpha", mailbox: "INBOX" } });
    expect(body).toMatchObject({ scope: "account", account: "alpha", mailbox: "INBOX", from: "2026-09-01", flag: "unseen" });
    expect(body).not.toHaveProperty("until");
    expect(body).not.toHaveProperty("order");
  });
});

describe("usesSearchRoute", () => {
  it("is false only for the folder scope", () => {
    expect(usesSearchRoute(filters({ scope: "folder" }))).toBe(false);
    expect(usesSearchRoute(filters({ scope: "account" }))).toBe(true);
    expect(usesSearchRoute(filters({ scope: "all" }))).toBe(true);
  });
});
