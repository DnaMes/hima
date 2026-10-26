export type GroupKey = "today" | "yesterday" | "this-week" | "last-week" | "older" | "none";

export const GROUP_LABELS: Record<GroupKey, string> = {
  today: "Heute",
  yesterday: "Gestern",
  "this-week": "Diese Woche",
  "last-week": "Letzte Woche",
  older: "Älter",
  none: "Ohne Datum",
};

// Whole local calendar days, so a 23- or 25-hour day never shifts a message by one group.
function dayNumber(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

export function groupKey(value: string | null, now: Date): GroupKey {
  if (!value) return "none";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "none";

  const difference = dayNumber(now) - dayNumber(date);
  if (difference <= 0) return "today";
  if (difference === 1) return "yesterday";
  if (difference <= 6) return "this-week";
  if (difference <= 13) return "last-week";
  return "older";
}

export type GroupedRow<T> = { item: T; header: string | null };

export function withGroupHeaders<T extends { date: string | null }>(
  items: readonly T[],
  now: Date,
): GroupedRow<T>[] {
  let previous: GroupKey | null = null;
  return items.map((item) => {
    const key = groupKey(item.date, now);
    const header = key === previous ? null : GROUP_LABELS[key];
    previous = key;
    return { item, header };
  });
}

const CLOCK = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const SHORT_DATE = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });

export function formatRowTime(value: string | null, now: Date): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return dayNumber(now) - dayNumber(date) <= 0 ? CLOCK.format(date) : SHORT_DATE.format(date);
}
