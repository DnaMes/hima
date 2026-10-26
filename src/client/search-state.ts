export type SearchScope = "folder" | "account" | "all";
export type SearchFlag = "flagged" | "seen" | "unseen" | "answered";

export type SearchFilters = {
  scope: SearchScope;
  includeJunk: boolean;
  from: string;
  until: string;
  flag: "" | SearchFlag;
  order: "desc" | "asc";
  hasAttachment: boolean;
};

export type FilterChip = { key: keyof SearchFilters; label: string };

export const DEFAULT_FILTERS: SearchFilters = {
  scope: "folder",
  includeJunk: false,
  from: "",
  until: "",
  flag: "",
  order: "desc",
  hasAttachment: false,
};

const FLAG_LABELS: Record<SearchFlag, string> = {
  flagged: "Markiert",
  seen: "Gelesen",
  unseen: "Ungelesen",
  answered: "Beantwortet",
};

// "2026-09-30" -> "30.09.2026" by string, so no timezone can shift the day.
const germanDate = (isoDate: string): string => isoDate.split("-").reverse().join(".");

export function activeChips(filters: SearchFilters): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filters.scope === "account") chips.push({ key: "scope", label: "Dieses Konto" });
  if (filters.scope === "all") chips.push({ key: "scope", label: "Alle Konten" });
  if (filters.from) chips.push({ key: "from", label: `Von ${germanDate(filters.from)}` });
  if (filters.until) chips.push({ key: "until", label: `Bis ${germanDate(filters.until)}` });
  if (filters.flag) chips.push({ key: "flag", label: FLAG_LABELS[filters.flag] });
  if (filters.order === "asc") chips.push({ key: "order", label: "Älteste zuerst" });
  if (filters.hasAttachment) chips.push({ key: "hasAttachment", label: "Mit Anhang" });
  if (filters.includeJunk) chips.push({ key: "includeJunk", label: "Auch Papierkorb/Spam" });
  return chips;
}

export function clearFilter(filters: SearchFilters, key: keyof SearchFilters): SearchFilters {
  return { ...filters, [key]: DEFAULT_FILTERS[key] };
}

/** The filter fields the server routes understand; defaults are left out. */
export function filterFields(filters: SearchFilters): { from?: string; until?: string; flag?: SearchFlag; order?: "asc" } {
  return {
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.until ? { until: filters.until } : {}),
    ...(filters.flag ? { flag: filters.flag } : {}),
    ...(filters.order === "asc" ? { order: "asc" as const } : {}),
  };
}

export type SearchBodyArgs = {
  filters: SearchFilters;
  text: string;
  field: string;
  unread: boolean;
  page: number;
  pageSize: number;
  accounts: readonly string[];
  current: { account: string; mailbox: string } | null;
};

/** Body for `POST /api/search`. */
export function searchBody(args: SearchBodyArgs): Record<string, unknown> {
  const { filters, current } = args;
  return {
    scope: filters.scope,
    accounts: [...args.accounts],
    ...(filters.scope !== "all" && current ? { account: current.account, mailbox: current.mailbox } : {}),
    includeJunk: filters.includeJunk,
    hasAttachment: filters.hasAttachment,
    page: args.page,
    pageSize: args.pageSize,
    field: args.field,
    q: args.text,
    unread: args.unread,
    ...filterFields(filters),
  };
}

export function usesSearchRoute(filters: SearchFilters): boolean {
  return filters.scope !== "folder";
}
