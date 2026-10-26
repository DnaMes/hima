import { describe, expect, it } from "vitest";

import type { Envelope, UnifiedInboxResult, UnifiedWarning } from "../shared/types.js";
import { DEFAULT_FILTERS } from "./search-state.js";
import { historyLines, senderHistoryBody, senderSearchState, summarizeSenderHistory } from "./sender-history.js";

const current = { account: "andre", mailbox: "INBOX", message: "7" };

const EMAIL = "anna@evil.example";

function hit(id: string, date: string | null, account = "andre", mailbox = "INBOX", from = EMAIL): Envelope {
  return { id, date, flags: [], from: [{ name: null, email: from }], to: [], subject: id, size: 1, hasAttachment: false, source: { account, mailbox } };
}

const result = (envelopes: Envelope[], overrides: Partial<UnifiedInboxResult> = {}): UnifiedInboxResult => ({ envelopes, hasMore: false, warnings: [], ...overrides });
const NOW = "2026-10-02T05:20:00Z";

describe("summarizeSenderHistory", () => {
  it("reports a first contact when nothing was found", () => {
    expect(summarizeSenderHistory(result([]), current, NOW, EMAIL)).toMatchObject({ kind: "first-contact", laterCount: 0 });
  });

  it("reports a first contact when the only hit is the open message itself", () => {
    expect(summarizeSenderHistory(result([hit("7", NOW)]), current, NOW, EMAIL)).toMatchObject({ kind: "first-contact", laterCount: 0 });
  });

  it("only treats a hit as the open message when account, mailbox and id all match", () => {
    const history = summarizeSenderHistory(result([hit("7", "2026-01-01T00:00:00Z", "beta", "INBOX"), hit("7", NOW)]), current, NOW, EMAIL);

    expect(history).toMatchObject({ kind: "known", count: 1, earliest: { account: "beta", mailbox: "INBOX" } });
  });

  it("knows the sender when an earlier mail exists, with its date and place", () => {
    const history = summarizeSenderHistory(result([hit("1", "2025-03-12T10:00:00Z", "andre", "Archive"), hit("7", NOW)]), current, NOW, EMAIL);

    expect(history).toMatchObject({ kind: "known", count: 1, atLeast: false, earliest: { date: "2025-03-12T10:00:00Z", account: "andre", mailbox: "Archive" } });
  });

  it("still calls it a first contact when the open message is the oldest and later mails exist", () => {
    const history = summarizeSenderHistory(result([hit("7", NOW), hit("8", "2026-10-03T00:00:00Z"), hit("9", "2026-10-04T00:00:00Z")]), current, NOW, EMAIL);

    expect(history).toMatchObject({ kind: "first-contact", laterCount: 2 });
  });

  it("marks the count as a lower bound when the search has more pages", () => {
    const history = summarizeSenderHistory(result([hit("1", "2025-01-01T00:00:00Z")], { hasMore: true }), current, NOW, EMAIL);

    expect(history).toMatchObject({ kind: "known", atLeast: true });
  });

  it("cannot compare undated mail, so it counts as known history", () => {
    expect(summarizeSenderHistory(result([hit("1", null)]), current, null, EMAIL)).toMatchObject({ kind: "known", count: 1 });
  });

  it("ignores hits from look-alike addresses, because the sender search matches substrings", () => {
    const history = summarizeSenderHistory(result([hit("1", "2025-01-01T00:00:00Z", "andre", "INBOX", "banna@evil.example"), hit("2", "2025-02-01T00:00:00Z", "andre", "INBOX", "anna@evil.example.org")]), current, NOW, EMAIL);

    expect(history).toMatchObject({ kind: "first-contact", laterCount: 0 });
  });

  it("matches the address case-insensitively", () => {
    const history = summarizeSenderHistory(result([hit("1", "2025-01-01T00:00:00Z", "andre", "INBOX", "Anna@Evil.Example")]), current, NOW, EMAIL);

    expect(history).toMatchObject({ kind: "known", count: 1 });
  });

  it("passes the search warnings through", () => {
    const warnings: UnifiedWarning[] = [{ account: "beta", code: "SOURCE_CAP", message: "3 Ordner nicht durchsucht (Obergrenze 30)." }];

    expect(summarizeSenderHistory(result([], { warnings }), current, NOW, EMAIL).warnings).toEqual(warnings);
  });
});

describe("historyLines", () => {
  it("explains a first contact in German, with the coverage limit", () => {
    const lines = historyLines(summarizeSenderHistory(result([]), current, NOW, EMAIL));

    expect(lines[0]).toBe("Erstkontakt: keine früheren Mails dieses Absenders gefunden.");
    expect(lines.at(-1)).toBe("Durchsucht wurden höchstens 30 Ordner (INBOX zuerst).");
  });

  it("mentions later mails for a first contact seen from an old message", () => {
    const lines = historyLines(summarizeSenderHistory(result([hit("7", NOW), hit("8", "2026-10-03T00:00:00Z")]), current, NOW, EMAIL));

    expect(lines[0]).toContain("Erstkontakt");
    expect(lines).toContain("Danach folgten 1 weitere Mail(s) dieses Absenders.");
  });

  it("describes a known sender with the earliest hit and a lower bound when needed", () => {
    const exact = historyLines(summarizeSenderHistory(result([hit("1", "2025-03-12T10:00:00Z", "andre", "Archive"), hit("2", "2025-04-01T00:00:00Z")]), current, NOW, EMAIL));
    const bounded = historyLines(summarizeSenderHistory(result([hit("1", "2025-03-12T10:00:00Z")], { hasMore: true }), current, NOW, EMAIL));

    expect(exact).toContain("Bekannter Absender: 2 frühere Mails in den durchsuchten Ordnern.");
    expect(exact).toContain("Frühester Treffer: 12.03.2025 · andre / Archive");
    expect(bounded[0]).toBe("Bekannter Absender: mindestens 1 frühere Mail in den durchsuchten Ordnern.");
  });

  it("lists warnings per account so missing coverage is visible", () => {
    const warnings: UnifiedWarning[] = [{ account: "beta", mailbox: "Work", code: "AUTH_REQUIRED", message: "Anmeldung nötig" }];
    const lines = historyLines(summarizeSenderHistory(result([], { warnings }), current, NOW, EMAIL));

    expect(lines).toContain("Nicht durchsucht: beta/Work: Anmeldung nötig");
  });
});

describe("request helpers", () => {
  it("asks for the oldest mails from the address across all accounts", () => {
    expect(senderHistoryBody("anna@evil.example", ["alpha", "beta"])).toEqual({
      scope: "all", accounts: ["alpha", "beta"], includeJunk: false, hasAttachment: false,
      page: 1, pageSize: 50, field: "from", q: "anna@evil.example", unread: false, order: "asc",
    });
  });

  it("builds the search state for showing all mails of the sender", () => {
    expect(senderSearchState("anna@evil.example")).toEqual({
      text: "anna@evil.example", field: "from", unread: false, filters: { ...DEFAULT_FILTERS, scope: "all" },
    });
  });
});
