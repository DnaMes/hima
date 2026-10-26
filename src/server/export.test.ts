import { describe, expect, it } from "vitest";

import type { MessageDetail } from "../shared/types.js";
import { exportFilename, renderMarkdown } from "./export.js";

const detail: MessageDetail = {
  ref: { account: "andre", mailbox: "INBOX", message: "7" },
  envelope: {
    id: "7",
    date: "2026-09-18T09:30:00Z",
    flags: [],
    from: [{ name: "Alice", email: "alice@example.test" }],
    to: [{ name: "André", email: "andre@example.test" }],
    subject: "Hello",
    size: 12,
    hasAttachment: true,
  },
  text: "Hello from the synthetic message.",
  html: null,
  attachments: [{ id: "2", filename: "report.pdf", mime: "application/pdf", size: 42, inline: false }],
  sender: { replyTo: null, returnPath: null, messageIdDomain: null, auth: null, received: [], risk: { level: "none", score: 0, reasons: [] }, trust: null },
};

describe("message export", () => {
  it("renders deterministic Markdown metadata, body, and attachments", () => {
    const markdown = renderMarkdown(detail);

    expect(markdown).toContain("# Hello");
    expect(markdown).toContain("From: Alice <alice@example.test>");
    expect(markdown).toContain("To: André <andre@example.test>");
    expect(markdown).toContain("## Attachments");
    expect(markdown).toContain("report.pdf");
    expect(markdown).toContain("Hello from the synthetic message.");
    expect(exportFilename(detail)).toBe("2026-09-18-hello.md");
    expect(exportFilename(detail, "eml")).toBe("2026-09-18-hello.eml");
  });

  it("falls back from HTML to readable text without script content", () => {
    const htmlOnly = { ...detail, text: "", html: "<p>Hello <strong>HTML</strong></p><script>alert('x')</script><p>Next &amp; line</p>" };

    const markdown = renderMarkdown(htmlOnly);

    expect(markdown).toContain("Hello HTML");
    expect(markdown).toContain("Next & line");
    expect(markdown).not.toContain("alert");
    expect(markdown).not.toContain("<strong>");
  });

  it("sanitizes unsafe subject characters in export filenames", () => {
    const unsafe = { ...detail, envelope: { ...detail.envelope, subject: "../invoice\\2026\u0000" } };

    expect(exportFilename(unsafe)).toBe("2026-09-18-__invoice_2026_.md");
  });

  it("keeps the extension when a long subject has to be shortened", () => {
    const long = { ...detail, envelope: { ...detail.envelope, subject: "a".repeat(300) } };
    for (const [extension, name] of [["md", exportFilename(long)], ["eml", exportFilename(long, "eml")]] as const) {
      expect(name.endsWith(`.${extension}`)).toBe(true);
      expect(name.length).toBeLessThanOrEqual(120);
    }
  });
});
