import { describe, expect, it } from "vitest";

import type { MessageDetail, MessageRef } from "../shared/types.js";
import { aiTaskLabel, buildPrintDocument, messageExportUrl, messageRawUrl } from "./message-actions.js";

const ref: MessageRef = { account: "andre", mailbox: "INBOX", message: "7" };
const detail: MessageDetail = {
  ref,
  envelope: {
    id: "7",
    date: "2026-09-18T09:30:00Z",
    flags: [],
    from: [{ name: "Alice", email: "alice@example.test" }],
    to: [{ name: "André", email: "andre@example.test" }],
    subject: "Print <this>",
    size: 12,
    hasAttachment: false,
  },
  text: "Plain body & details",
  html: null,
  attachments: [],
  sender: { replyTo: null, returnPath: null, messageIdDomain: null, auth: null, received: [], risk: { level: "none", score: 0, reasons: [] }, trust: null },
};

describe("message actions", () => {
  it("builds the raw-source URL from a reference", () => {
    expect(messageRawUrl(ref)).toBe("/api/message/raw?account=andre&mailbox=INBOX&message=7");
  });

  it("builds an authenticated-session-compatible Markdown URL from a reference", () => {
    expect(messageExportUrl(ref)).toBe("/api/message/export?account=andre&mailbox=INBOX&message=7&format=markdown");
  });

  it("builds a print document from escaped metadata and sanitized HTML", () => {
    const document = buildPrintDocument(detail, "<p>Sanitized <strong>HTML</strong></p>");
    const textDocument = buildPrintDocument(detail, "");

    expect(document).toContain("<title>Print &lt;this&gt;</title>");
    expect(document).toContain("Sanitized <strong>HTML</strong>");
    expect(textDocument).toContain("Plain body &amp; details");
    expect(document).toContain("@media print");
    expect(document).not.toContain("localStorage");
  });

  it("provides German labels for the supported AI tasks", () => {
    expect(aiTaskLabel("summarize")).toBe("Zusammenfassen");
    expect(aiTaskLabel("reply-draft")).toBe("Antwortentwurf");
  });
});
