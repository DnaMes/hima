import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SenderInfo } from "../shared/types.js";
import type { HistoryView } from "./sender-history.js";
import { RiskBanner, SenderDetails } from "./sender-panel.js";

const sender = (overrides: Partial<SenderInfo> = {}): SenderInfo => ({
  replyTo: null,
  returnPath: "support@evil.example",
  messageIdDomain: "evil.example",
  auth: { spf: "pass", dkim: "none", dmarc: "fail" },
  received: [{ from: "srv1.trm.com", by: "mx.example", ip: "143.246.202.177" }],
  risk: { level: "high", score: 75, reasons: ["Grund A", "Grund B"] },
  trust: null,
  ...overrides,
});

describe("RiskBanner", () => {
  it("lists every reason for a high verdict", () => {
    const html = renderToStaticMarkup(createElement(RiskBanner, { risk: sender().risk }));
    expect(html).toContain("sehr wahrscheinlich Phishing");
    expect(html).toContain("Grund A");
    expect(html).toContain("Grund B");
  });

  it("renders nothing for a clean verdict", () => {
    const risk = { level: "none" as const, score: 0, reasons: [] };
    expect(renderToStaticMarkup(createElement(RiskBanner, { risk }))).toBe("");
  });
});

describe("SenderDetails", () => {
  it("shows the real address, auth chips and the transfer path, and hides absent fields", () => {
    const html = renderToStaticMarkup(createElement(SenderDetails, { from: "support@evil.example", sender: sender() }));
    expect(html).toContain("support@evil.example");
    expect(html).toContain("SPF pass");
    expect(html).toContain("DMARC fail");
    expect(html).toContain("srv1.trm.com [143.246.202.177] → mx.example");
    expect(html).not.toContain("Antwort an");
  });

  it("says so when no Authentication-Results exist", () => {
    const html = renderToStaticMarkup(createElement(SenderDetails, { from: "a@b.c", sender: sender({ auth: null }) }));
    expect(html).toContain("Keine Authentication-Results");
  });
});

describe("SenderDetails history row", () => {
  const render = (history: HistoryView | undefined) =>
    renderToStaticMarkup(createElement(SenderDetails, { from: "a@b.c", sender: sender(), ...(history ? { history, onCheckHistory: () => undefined, onShowAll: () => undefined } : {}) }));

  it("is absent without a history state", () => {
    expect(render(undefined)).not.toContain("Verlauf");
  });

  it("offers the check, shows progress and errors, and renders the result with the show-all button", () => {
    expect(render({ status: "idle" })).toContain("Verlauf prüfen");
    expect(render({ status: "loading" })).toContain("Suche läuft");
    const failed = render({ status: "error", message: "Boom" });
    expect(failed).toContain("Boom");
    expect(failed).toContain("Erneut prüfen");
    const ready = render({ status: "ready", lines: ["Erstkontakt: keine früheren Mails dieses Absenders gefunden.", "Durchsucht wurden höchstens 30 Ordner (INBOX zuerst)."] });
    expect(ready).toContain("Erstkontakt: keine früheren Mails");
    expect(ready).toContain("Alle Mails dieses Absenders anzeigen");
  });
});

describe("SenderDetails status row", () => {
  const render = (trust: SenderInfo["trust"], busy = false, withHandlers = true) =>
    renderToStaticMarkup(createElement(SenderDetails, {
      from: "a@b.c", sender: sender({ trust }),
      ...(withHandlers ? { onSetStatus: () => undefined, onReport: () => undefined, busy } : {}),
    }));

  it("is absent without handlers", () => {
    expect(render(null, false, false)).not.toContain("Einstufung");
  });

  it("offers trust and report for a sender that is not rated", () => {
    const html = render(null);
    expect(html).toContain("Nicht eingestuft");
    expect(html).toContain("Absender vertrauen");
    expect(html).toContain("Als Phishing melden");
  });

  it("offers to revoke trust, and to trust or report again", () => {
    const html = render("trusted");
    expect(html).toContain("Vertrauenswürdig");
    expect(html).toContain("Vertrauen widerrufen");
    expect(html).toContain("Als Phishing melden");
  });

  it("offers to revoke a report, and still to trust the sender", () => {
    const html = render("blocked");
    expect(html).toContain("Als Phishing gemeldet");
    expect(html).toContain("Meldung widerrufen");
    expect(html).toContain("Absender vertrauen");
  });

  it("disables every button while an action runs", () => {
    const buttons = render(null, true).match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    expect(buttons.every((tag) => tag.includes("disabled"))).toBe(true);
  });
});
