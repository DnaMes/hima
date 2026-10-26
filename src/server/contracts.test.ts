import { describe, expect, it } from "vitest";
import { buildSearchQuery, hasSearchCriteria, isoDateSchema, parseEnvelopes, previousDay, validateRefPart } from "./contracts.js";

describe("buildSearchQuery", () => {
  it("builds a single safe subject query", () => {
    expect(buildSearchQuery({ field: "subject", text: "invoice 2026" })).toEqual([
      "subject",
      "invoice\\ 2026",
    ]);
  });

  it("supports unread filtering without changing the caller's text", () => {
    expect(buildSearchQuery({ field: "all", text: "alice", unread: true })).toEqual([
      "(subject",
      "alice",
      "or",
      "from",
      "alice",
      "or",
      "to",
      "alice",
      "or",
      "body",
      "alice)",
      "and",
      "not",
      "flag",
      "seen",
    ]);
  });
});

describe("validateRefPart", () => {
  it("accepts provider identifiers including spaces", () => {
    expect(validateRefPart("[Gmail]/All Mail", "mailbox")).toBe("[Gmail]/All Mail");
  });

  it("rejects NUL bytes and oversized values", () => {
    expect(() => validateRefPart("bad\u0000value", "message")).toThrow("message");
    expect(() => validateRefPart("x".repeat(513), "account")).toThrow("account");
  });
});

describe("filter-aware buildSearchQuery", () => {
  it("turns an inclusive start date into `after` the day before", () => {
    expect(buildSearchQuery({ field: "all", text: "", from: "2026-09-30" })).toEqual(["after", "2026-09-29"]);
  });

  it("rolls the previous day over months, years and leap days", () => {
    expect(previousDay("2026-03-01")).toBe("2026-02-28");
    expect(previousDay("2026-01-01")).toBe("2025-12-31");
    expect(previousDay("2028-03-01")).toBe("2028-02-29");
  });

  it("turns an inclusive end date into `not after`", () => {
    expect(buildSearchQuery({ field: "all", text: "", until: "2026-09-30" })).toEqual(["not", "after", "2026-09-30"]);
  });

  it("joins text, range and flag clauses with `and`", () => {
    expect(buildSearchQuery({
      field: "subject", text: "x", from: "2026-09-25", until: "2026-09-30", flag: "unseen",
    })).toEqual([
      "subject", "x", "and", "after", "2026-09-24", "and", "not", "after", "2026-09-30", "and", "not", "flag", "seen",
    ]);
  });

  it("maps every flag value to its DSL clause", () => {
    expect(buildSearchQuery({ field: "all", text: "", flag: "flagged" })).toEqual(["flag", "flagged"]);
    expect(buildSearchQuery({ field: "all", text: "", flag: "seen" })).toEqual(["flag", "seen"]);
    expect(buildSearchQuery({ field: "all", text: "", flag: "answered" })).toEqual(["flag", "answered"]);
  });

  it("appends `order by date asc` without an `and`", () => {
    expect(buildSearchQuery({ field: "all", text: "", order: "asc" })).toEqual(["order", "by", "date", "asc"]);
    expect(buildSearchQuery({ field: "subject", text: "x", order: "asc" })).toEqual(["subject", "x", "order", "by", "date", "asc"]);
  });

  it("emits `not flag seen` once when unread and flag unseen are both set", () => {
    expect(buildSearchQuery({ field: "all", text: "", unread: true, flag: "unseen" })).toEqual(["not", "flag", "seen"]);
  });
});

describe("hasSearchCriteria", () => {
  it("is false without any usable criterion", () => {
    expect(hasSearchCriteria(undefined)).toBe(false);
    expect(hasSearchCriteria({ field: "all", text: "  " })).toBe(false);
    expect(hasSearchCriteria({ field: "all", text: "", order: "desc" })).toBe(false);
  });

  it("is true for text-less filters, which must run a real search", () => {
    expect(hasSearchCriteria({ field: "all", text: "", order: "asc" })).toBe(true);
    expect(hasSearchCriteria({ field: "all", text: "", unread: true })).toBe(true);
    expect(hasSearchCriteria({ field: "all", text: "", from: "2026-09-30" })).toBe(true);
    expect(hasSearchCriteria({ field: "all", text: "", flag: "flagged" })).toBe(true);
  });
});

describe("isoDateSchema", () => {
  it("accepts real calendar dates only", () => {
    expect(isoDateSchema.safeParse("2028-02-29").success).toBe(true);
    expect(isoDateSchema.safeParse("2026-02-30").success).toBe(false);
    expect(isoDateSchema.safeParse("2026-9-1").success).toBe(false);
    expect(() => previousDay("2026-02-30")).toThrow("Invalid date");
  });
});

describe("search text escaping (verified against Himalaya v2.1)", () => {
  it("escapes whitespace, parentheses and backslashes, which the query parser would otherwise split or reject", () => {
    expect(buildSearchQuery({ field: "subject", text: "a  b\tc" })).toEqual(["subject", "a\\ b\\ c"]);
    expect(buildSearchQuery({ field: "subject", text: "re: (2026)" })).toEqual(["subject", "re:\\ \\(2026\\)"]);
    expect(buildSearchQuery({ field: "subject", text: "a\\b" })).toEqual(["subject", "a\\\\b"]);
  });

  it("leaves quotes and other characters alone, since the parser takes them literally", () => {
    expect(buildSearchQuery({ field: "subject", text: `it's "x" 100% ä,b` })).toEqual(["subject", `it's\\ "x"\\ 100%\\ ä,b`]);
  });

  it("attaches the grouping parentheses to their neighbours, because `( subject` does not parse", () => {
    const query = buildSearchQuery({ field: "all", text: "a b" });
    expect(query[0]).toBe("(subject");
    expect(query.at(-1)).toBe("a\\ b)");
    expect(query).not.toContain("(");
    expect(query).not.toContain(")");
  });
});

describe("envelope threading headers", () => {
  const base = { id: "1", date: null, flags: [], from: [], to: [], subject: "s", size: 1, "has-attachment": false };

  it("keeps the message id and the in-reply-to ids, trimmed, and leaves them out when absent", () => {
    const [withIds, without] = parseEnvelopes({ envelopes: [
      { ...base, "message-id": " <a@x> ", "in-reply-to": ["<b@x>", "  "] },
      { ...base, id: "2", "in-reply-to": [] },
    ] });
    expect(withIds).toMatchObject({ messageId: "<a@x>", inReplyTo: ["<b@x>"] });
    expect(without).not.toHaveProperty("messageId");
    expect(without).not.toHaveProperty("inReplyTo");
  });

  it("ignores threading fields of an unexpected type and accepts a single in-reply-to string", () => {
    const [odd, single] = parseEnvelopes({ envelopes: [
      { ...base, "message-id": 42, "in-reply-to": { nope: true } },
      { ...base, id: "2", "in-reply-to": "<p@x>" },
    ] });
    expect(odd).not.toHaveProperty("messageId");
    expect(odd).not.toHaveProperty("inReplyTo");
    expect(single).toMatchObject({ inReplyTo: ["<p@x>"] });
  });

  it("keeps the text entries of an in-reply-to array that also holds something else", () => {
    const [mixed] = parseEnvelopes({ envelopes: [{ ...base, "in-reply-to": ["<a@x>", 7, null, "<b@x>"] }] });
    expect(mixed).toMatchObject({ inReplyTo: ["<a@x>", "<b@x>"] });
  });
});
