import { describe, expect, it } from "vitest";

import type { MessageDetail } from "../shared/types.js";
import { formatMessageText, rawHeaderBlock } from "./message-copy.js";

const detail: MessageDetail = {
  ref: { account: "andre", mailbox: "INBOX", message: "7" },
  envelope: {
    id: "7",
    date: "2026-09-18T09:30:00Z",
    flags: [],
    from: [{ name: "Alice", email: "alice@example.test" }],
    to: [{ name: "André", email: "andre@example.test" }, { name: null, email: "carol@example.test" }],
    subject: "Hello",
    size: 12,
    hasAttachment: false,
  },
  text: "Body text\n",
  html: null,
  attachments: [],
  sender: {
    replyTo: "other@example.net",
    returnPath: "support@evil.example",
    messageIdDomain: "evil.example",
    auth: { spf: "pass", dkim: null, dmarc: "fail" },
    received: [{ from: "srv1.example", by: "mx.example", ip: "203.0.113.5" }, { from: null, by: "mx2.example", ip: null }],
    risk: { level: "high", score: 70, reasons: ["Grund A", "Grund B"] },
    trust: null,
  },
};

describe("formatMessageText", () => {
  it("renders the plain variant as headers, a blank line and the trimmed body", () => {
    expect(formatMessageText(detail, false)).toBe([
      "Von: Alice <alice@example.test>",
      "An: André <andre@example.test>, carol@example.test",
      "Datum: 2026-09-18T09:30:00Z",
      "Betreff: Hello",
      "",
      "Body text",
    ].join("\n"));
  });

  it("adds the sender check between the headers and the body", () => {
    const text = formatMessageText(detail, true);

    expect(text.indexOf("Absenderprüfung")).toBeGreaterThan(text.indexOf("Betreff: Hello"));
    expect(text.indexOf("Absenderprüfung")).toBeLessThan(text.indexOf("Body text"));
    for (const line of [
      "Bewertung: Warnung (70)",
      "- Grund A",
      "- Grund B",
      "Reply-To: other@example.net",
      "Return-Path: support@evil.example",
      "Message-ID-Domain: evil.example",
      "SPF: pass | DKIM: – | DMARC: fail",
      "Übertragungsweg:",
      "1. srv1.example [203.0.113.5] → mx.example",
      "2. ? → mx2.example",
    ]) expect(text.split("\n")).toContain(line);
  });

  it("names the operator's rating of the sender when there is one", () => {
    expect(formatMessageText({ ...detail, sender: { ...detail.sender, trust: "trusted" } }, true).split("\n")).toContain("Einstufung: Vertrauenswürdig");
    expect(formatMessageText({ ...detail, sender: { ...detail.sender, trust: "blocked" } }, true).split("\n")).toContain("Einstufung: Als Phishing gemeldet");
    expect(formatMessageText(detail, true)).not.toContain("Einstufung");
  });

  it("labels the other verdicts and omits absent sender fields", () => {
    const quiet = { ...detail, sender: { ...detail.sender, replyTo: null, returnPath: null, messageIdDomain: null, received: [], auth: null, risk: { level: "none" as const, score: 0, reasons: [] } } };
    const lines = formatMessageText(quiet, true).split("\n");

    expect(lines).toContain("Bewertung: Unauffällig");
    expect(lines).toContain("Keine Authentication-Results vorhanden");
    expect(lines.some((line) => line.startsWith("Reply-To:") || line.startsWith("Return-Path:") || line.startsWith("Übertragungsweg:"))).toBe(false);
    expect(formatMessageText({ ...detail, sender: { ...detail.sender, risk: { level: "suspicious", score: 35, reasons: [] } } }, true)).toContain("Bewertung: Verdächtig (35)");
  });

  it("falls back for a missing date, subject and text", () => {
    const bare = { ...detail, text: "  ", envelope: { ...detail.envelope, date: null, subject: "", from: [] } };
    const lines = formatMessageText(bare, false).split("\n");

    expect(lines).toContain("Datum: (unbekannt)");
    expect(lines).toContain("Betreff: (ohne Betreff)");
    expect(lines).toContain("(Kein Text)");
  });
});

describe("rawHeaderBlock", () => {
  it("cuts a CRLF message at the first blank line and normalizes line endings", () => {
    expect(rawHeaderBlock("From: a@x\r\nSubject: s\r\n\r\nbody\r\nmore")).toBe("From: a@x\nSubject: s");
  });

  it("copes with LF-only messages", () => {
    expect(rawHeaderBlock("From: a@x\nSubject: s\n\nbody")).toBe("From: a@x\nSubject: s");
  });

  it("returns everything when there is no blank line, and drops a trailing blank line", () => {
    expect(rawHeaderBlock("From: a@x\r\nSubject: s")).toBe("From: a@x\nSubject: s");
    expect(rawHeaderBlock("From: a@x\r\n\r\n")).toBe("From: a@x");
  });
});
