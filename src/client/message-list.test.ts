import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Envelope } from "../shared/types.js";
import { hueStyle } from "./hue-style.js";
import { envelopeBadges, isSeen, MessageList } from "./message-list.js";
import type { MessageListProps } from "./message-list.js";

const NOW = new Date(2026, 8, 18, 15, 0, 0);
const at = (day: number, hour = 9): string => new Date(2026, 8, day, hour, 0, 0).toISOString();

function envelope(id: string, overrides: Partial<Envelope> = {}): Envelope {
  return {
    id,
    date: at(18),
    flags: [],
    from: [{ email: "alice@example.test", name: "Alice" }],
    to: [{ email: "bob@example.test", name: null }],
    subject: `Subject ${id}`,
    size: 2048,
    hasAttachment: false,
    ...overrides,
  };
}

const props = (overrides: Partial<MessageListProps> = {}): MessageListProps => ({
  envelopes: [],
  now: NOW,
  density: "compact",
  unified: false,
  currentAccount: "alpha",
  colorIndexFor: (account) => (account === "beta" ? 4 : 2),
  isSelected: () => false,
  onOpen: () => undefined,
  rowKey: (item) => item.id,
  ...overrides,
});

const render = (overrides: Partial<MessageListProps> = {}): string => (
  renderToStaticMarkup(createElement(MessageList, props(overrides)))
);

describe("envelope badges", () => {
  it("derives badges from real flags and attachments only", () => {
    expect(envelopeBadges(envelope("1")).map((badge) => badge.kind)).toEqual(["new"]);
    expect(envelopeBadges(envelope("2", { flags: [{ iana: "seen", raw: "\\Seen" }] }))).toEqual([]);
    expect(envelopeBadges(envelope("3", { hasAttachment: true, flags: [{ iana: null, raw: "\\Seen" }, { iana: "flagged", raw: "\\Flagged" }, { iana: null, raw: "\\Answered" }] })).map((badge) => badge.kind))
      .toEqual(["attachment", "flagged", "answered"]);
    expect(envelopeBadges(envelope("4", { flags: [{ iana: null, raw: "\\Draft" }, { iana: null, raw: "\\Deleted" }, { iana: "seen", raw: "seen" }] }))).toEqual([]);
  });

  it("recognises the seen flag in every supported spelling", () => {
    expect(isSeen(envelope("a", { flags: [{ iana: "seen", raw: "x" }] }))).toBe(true);
    expect(isSeen(envelope("b", { flags: [{ iana: null, raw: "\\SEEN" }] }))).toBe(true);
    expect(isSeen(envelope("c", { flags: [{ iana: null, raw: "seen" }] }))).toBe(true);
    expect(isSeen(envelope("d"))).toBe(false);
  });

  it("gives every badge an icon and a German label", () => {
    const badges = envelopeBadges(envelope("5", { hasAttachment: true, flags: [{ iana: "flagged", raw: "\\Flagged" }, { iana: "answered", raw: "\\Answered" }] }));
    expect(badges.map((badge) => badge.label)).toEqual(["Neu", "Anhang", "Markiert", "Beantwortet"]);
    for (const badge of badges) expect(badge.icon.length).toBeGreaterThan(0);
  });
});

describe("hueStyle", () => {
  it("points the row colour at the theme hue variable", () => {
    expect(hueStyle(3)).toEqual({ "--c": "var(--account-hue-3)" });
  });
});

describe("MessageList", () => {
  it("renders group headers only when the group changes, in the given order", () => {
    const html = render({ envelopes: [envelope("a"), envelope("b"), envelope("c", { date: at(17) }), envelope("d", { date: null })] });

    expect(html.match(/class="group-header"/g)).toHaveLength(3);
    expect(html.indexOf("Heute")).toBeLessThan(html.indexOf("Gestern"));
    expect(html.indexOf("Gestern")).toBeLessThan(html.indexOf("Ohne Datum"));
    expect(html.indexOf("Subject a")).toBeLessThan(html.indexOf("Subject b"));
  });

  it("marks unread and selected rows and keeps the row a button", () => {
    const html = render({
      envelopes: [envelope("a"), envelope("b", { flags: [{ iana: "seen", raw: "\\Seen" }] })],
      isSelected: (item) => item.id === "b",
    });

    expect(html).toContain('class="envelope-row  unread"');
    expect(html).toContain('class="envelope-row active seen"');
    expect(html.match(/<button/g)).toHaveLength(2);
  });

  it("uses icon-only badges with accessible text in compact density", () => {
    const html = render({ envelopes: [envelope("a", { hasAttachment: true })] });

    expect(html).toContain('title="Neu"');
    expect(html).toContain('class="visually-hidden">Anhang<');
    expect(html).not.toContain("envelope-detail");
  });

  it("shows badge text and a detail line in comfortable density", () => {
    const html = render({ density: "comfortable", envelopes: [envelope("a", { hasAttachment: true })] });

    expect(html).toContain('class="badge-text">Anhang<');
    expect(html).toContain("envelope-detail");
    expect(html).toContain("bob@example.test");
    expect(html).toContain("2 KB");
  });

  it("colours the dot from the row's account and shows the exact source chip in the unified inbox", () => {
    const html = render({
      unified: true,
      envelopes: [envelope("a", { source: { account: "beta", mailbox: "INBOX" } }), envelope("b", { source: { account: "alpha", mailbox: "Inbox" } })],
    });

    expect(html).toContain("--c:var(--account-hue-4)");
    expect(html).toContain("--c:var(--account-hue-2)");
    expect(html).toContain(">beta · INBOX<");
    expect(html).toContain(">alpha · Inbox<");
  });

  it("does not show a source chip and falls back to the current account outside the unified inbox", () => {
    const html = render({ envelopes: [envelope("a")] });

    expect(html).not.toContain("envelope-source");
    expect(html).toContain("--c:var(--account-hue-2)");
  });

  it("falls back to readable placeholders for a missing sender or subject", () => {
    const html = render({ envelopes: [envelope("a", { from: [], subject: "" })] });

    expect(html).toContain("Unbekannter Absender");
    expect(html).toContain("(ohne Betreff)");
  });
});

describe("phishing badge", () => {
  it("leads the badge list when the watcher flagged the envelope", () => {
    const badges = envelopeBadges(envelope("p", { risk: "high" }));
    expect(badges[0]).toMatchObject({ kind: "phishing", label: "Phishing-Verdacht" });
    expect(envelopeBadges(envelope("c")).some((badge) => badge.kind === "phishing")).toBe(false);
  });

  it("shows the recipients instead of the sender in a Sent folder", () => {
    const sent = envelope("s1", { to: [{ email: "bob@example.test", name: "Bob" }, { email: "carol@example.test", name: null }] });
    const html = renderToStaticMarkup(createElement(MessageList, props({ envelopes: [sent], sentFolder: true })));
    expect(html).toContain("An: Bob, carol@example.test");
    expect(html).not.toContain("Alice");
    const empty = renderToStaticMarkup(createElement(MessageList, props({ envelopes: [envelope("s2", { to: [] })], sentFolder: true })));
    expect(empty).toContain("An: (kein Empfänger)");
  });

  it("shows a check mark and pressed state for every row in select mode", () => {
    const html = renderToStaticMarkup(createElement(MessageList, props({
      envelopes: [envelope("1"), envelope("2")], selectMode: true, isChecked: (item) => item.id === "1",
    })));
    expect(html).toContain("☑");
    expect(html).toContain("☐");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain("account-dot");
  });

  it("collapses a subject thread behind a toggle and keeps the open message visible", () => {
    const list = [envelope("1", { subject: "Plan" }), envelope("2", { subject: "Re: Plan" }), envelope("3", { subject: "Other" })];
    const collapsed = renderToStaticMarkup(createElement(MessageList, props({ envelopes: list, threads: true })));
    expect(collapsed.match(/<button class="envelope-row/g)).toHaveLength(2);
    expect(collapsed).toContain("1 weitere im Gespräch");
    expect(collapsed).toContain('aria-expanded="false"');
    const open = renderToStaticMarkup(createElement(MessageList, props({ envelopes: list, threads: true, isSelected: (item) => item.id === "2" })));
    expect(open.match(/<button class="envelope-row/g)).toHaveLength(3);
    expect(open).toContain("thread-child");
    const select = renderToStaticMarkup(createElement(MessageList, props({ envelopes: list, threads: true, selectMode: true })));
    expect(select.match(/<button class="envelope-row/g)).toHaveLength(3);
  });
});
