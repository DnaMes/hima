import { describe, expect, it } from "vitest";

import { snoozeKey, wakeOptions } from "./snooze.js";

describe("wakeOptions", () => {
  it("offers evening only while it is still before 18:00 and always tomorrow and Monday", () => {
    const noon = new Date(2026, 9, 26, 12, 0); // Monday
    expect(wakeOptions(noon).map((option) => option.id)).toEqual(["3h", "evening", "tomorrow", "monday"]);
    const night = new Date(2026, 9, 26, 20, 0);
    expect(wakeOptions(night).map((option) => option.id)).toEqual(["3h", "tomorrow", "monday"]);
  });

  it("puts 'next Monday' on a Monday strictly after today", () => {
    const monday = new Date(2026, 9, 26, 12, 0);
    const wake = wakeOptions(monday).find((option) => option.id === "monday")!.until;
    expect([wake.getDay(), wake.getDate(), wake.getHours()]).toEqual([1, 2, 8]);
    const sunday = new Date(2026, 9, 25, 12, 0);
    expect(wakeOptions(sunday).find((option) => option.id === "monday")!.until.getDate()).toBe(26);
  });
});

describe("snoozeKey", () => {
  it("is stable for the same message", () => {
    expect(snoozeKey({ account: "a", mailbox: "INBOX", message: "1" })).toBe(snoozeKey({ account: "a", mailbox: "INBOX", message: "1" }));
  });
});
