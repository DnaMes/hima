import { describe, expect, it } from "vitest";

import { formatRowTime, GROUP_LABELS, groupKey, withGroupHeaders } from "./message-groups.js";

const local = (year: number, month: number, day: number, hour = 12): Date => new Date(year, month - 1, day, hour, 0, 0);
const iso = (date: Date): string => date.toISOString();
const NOW = local(2026, 9, 18, 15);

describe("groupKey", () => {
  it("classifies by local calendar-day difference", () => {
    expect(groupKey(iso(local(2026, 9, 18, 0)), NOW)).toBe("today");
    expect(groupKey(iso(local(2026, 9, 17, 23)), NOW)).toBe("yesterday");
    expect(groupKey(iso(local(2026, 9, 16)), NOW)).toBe("this-week");
    expect(groupKey(iso(local(2026, 9, 12)), NOW)).toBe("this-week");
    expect(groupKey(iso(local(2026, 9, 11)), NOW)).toBe("last-week");
    expect(groupKey(iso(local(2026, 9, 5)), NOW)).toBe("last-week");
    expect(groupKey(iso(local(2026, 9, 4)), NOW)).toBe("older");
  });

  it("treats future dates as today and missing or invalid dates as none", () => {
    expect(groupKey(iso(local(2026, 9, 25)), NOW)).toBe("today");
    expect(groupKey(null, NOW)).toBe("none");
    expect(groupKey("not a date", NOW)).toBe("none");
  });

  it("counts calendar days across a daylight-saving change", () => {
    const now = local(2026, 3, 30, 10);
    expect(groupKey(iso(local(2026, 3, 29, 23)), now)).toBe("yesterday");
    expect(groupKey(iso(local(2026, 3, 28, 12)), now)).toBe("this-week");
  });
});

describe("withGroupHeaders", () => {
  it("adds a header only when the group changes and keeps the original order", () => {
    const rows = withGroupHeaders([
      { id: "a", date: iso(local(2026, 9, 18, 9)) },
      { id: "b", date: iso(local(2026, 9, 18, 8)) },
      { id: "c", date: iso(local(2026, 9, 17, 8)) },
      { id: "d", date: null },
    ], NOW);

    expect(rows.map((row) => row.item.id)).toEqual(["a", "b", "c", "d"]);
    expect(rows.map((row) => row.header)).toEqual([GROUP_LABELS.today, null, GROUP_LABELS.yesterday, GROUP_LABELS.none]);
  });

  it("repeats a header when an unsorted list returns to an earlier group", () => {
    const rows = withGroupHeaders([
      { id: "a", date: iso(local(2026, 9, 18)) },
      { id: "b", date: iso(local(2026, 9, 17)) },
      { id: "c", date: iso(local(2026, 9, 18)) },
    ], NOW);

    expect(rows.map((row) => row.header)).toEqual(["Heute", "Gestern", "Heute"]);
  });

  it("returns an empty list for no messages", () => {
    expect(withGroupHeaders([], NOW)).toEqual([]);
  });
});

describe("formatRowTime", () => {
  it("shows the clock time for today and a short date otherwise", () => {
    expect(formatRowTime(iso(local(2026, 9, 18, 9)), NOW)).toMatch(/^\d{2}:\d{2}$/);
    expect(formatRowTime(iso(local(2026, 9, 17, 9)), NOW)).toMatch(/^\d{2}\.\d{2}\.\d{2}$/);
  });

  it("returns an empty string for missing or invalid dates", () => {
    expect(formatRowTime(null, NOW)).toBe("");
    expect(formatRowTime("nope", NOW)).toBe("");
  });
});
