import { describe, expect, it } from "vitest";
import { parseRawMessage } from "./mime.js";

describe("parseRawMessage", () => {
  it("extracts headers, text, HTML, and CLI attachment metadata", async () => {
    const raw = Buffer.from(
      [
        "From: Alice <alice@example.org>",
        "To: Bob <bob@example.org>",
        "Subject: Test message",
        "Date: Tue, 01 Jan 2030 12:00:00 +0000",
        "MIME-Version: 1.0",
        'Content-Type: multipart/alternative; boundary="x"',
        "",
        "--x",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Hello from the plain part.",
        "--x",
        "Content-Type: text/html; charset=utf-8",
        "",
        "<p>Hello <strong>HTML</strong>.</p>",
        "--x--",
        "",
      ].join("\r\n"),
    );

    const message = await parseRawMessage(raw, [
      { id: "2", filename: "report.pdf", mime: "application/pdf", size: 42, inline: false },
    ], { account: "andre", mailbox: "INBOX", message: "1" });

    expect(message.envelope.subject).toBe("Test message");
    expect(message.envelope.from[0]?.email).toBe("alice@example.org");
    expect(message.text).toContain("Hello from the plain part.");
    expect(message.html).toContain("<strong>HTML</strong>");
    expect(message.attachments[0]?.filename).toBe("report.pdf");
  });

  it("extracts sender details, auth results, received hops and a risk verdict", async () => {
    const raw = Buffer.from(
      [
        "Return-Path: <support@swordshieldconsulting.com>",
        "Authentication-Results: mail.lima-city.de; dkim=none; spf=pass smtp.mailfrom=support@swordshieldconsulting.com; dmarc=pass (policy=reject)",
        "Received: from gw17.site4now.net (gw17.site4now.net [14.1.20.17]) by mail.lima-city.de (Postfix) with ESMTPS id AB1",
        "Received: from 172.18.0.5 (srv1.trm.com [143.246.202.177]) by mail5017.site4now.net with SMTP",
        'From: "Hr. Bundeszentralamt für Steuern" <support@swordshieldconsulting.com>',
        "To: andre@semek.org",
        "Reply-To: other@example.net",
        "Message-ID: <abc@swordshieldconsulting.com>",
        "Subject: Steuerkonto - bestätigen",
        "Date: Fri, 02 Oct 2026 05:20:05 +0000",
        "MIME-Version: 1.0",
        "Content-Type: text/html; charset=utf-8",
        "",
        '<a href="https://google.de/share.google?q=1">Benachrichtigung abrufen</a> Frist läuft',
        "",
      ].join("\r\n"),
    );

    const { sender } = await parseRawMessage(raw, [], { account: "andre", mailbox: "INBOX", message: "1" });

    expect(sender.returnPath).toBe("support@swordshieldconsulting.com");
    expect(sender.replyTo).toBe("other@example.net");
    expect(sender.messageIdDomain).toBe("swordshieldconsulting.com");
    expect(sender.auth).toEqual({ spf: "pass", dkim: "none", dmarc: "pass" });
    expect(sender.received).toEqual([
      { from: "gw17.site4now.net", by: "mail.lima-city.de", ip: "14.1.20.17" },
      { from: "172.18.0.5", by: "mail5017.site4now.net", ip: "143.246.202.177" },
    ]);
    expect(sender.risk.level).toBe("high");
  });

  it("reports a null auth block and a clean verdict for plain mail", async () => {
    const raw = Buffer.from("From: a@example.org\r\nTo: b@example.org\r\nSubject: hi\r\n\r\nhello\r\n");
    const { sender } = await parseRawMessage(raw, [], { account: "a", mailbox: "INBOX", message: "1" });
    expect(sender.auth).toBeNull();
    expect(sender.received).toEqual([]);
    expect(sender.risk.level).toBe("none");
  });

  it("applies the sender lists to the first From address, case-insensitively", async () => {
    const raw = Buffer.from('From: "PayPal" <X@Evil.example>\r\nTo: b@example.org\r\nSubject: hi\r\n\r\nhello\r\n');
    const ref = { account: "a", mailbox: "INBOX", message: "1" };
    const none = { trusted: new Set<string>(), blocked: new Set<string>() };

    const plain = await parseRawMessage(raw, [], ref);
    const trusted = await parseRawMessage(raw, [], ref, { senders: { ...none, trusted: new Set(["x@evil.example"]) } });
    const blocked = await parseRawMessage(raw, [], ref, { senders: { ...none, blocked: new Set(["x@evil.example"]) } });

    expect(plain.sender.trust).toBeNull();
    expect(plain.sender.risk.level).not.toBe("none");
    expect(trusted.sender).toMatchObject({ trust: "trusted", risk: { level: "none" } });
    expect(blocked.sender).toMatchObject({ trust: "blocked", risk: { level: "high", score: 100 } });
  });
});

describe("List-Unsubscribe", () => {
  const ref = { account: "a", mailbox: "INBOX", message: "1" };
  const mail = (header: string) => Buffer.from(`From: n@example.org\r\nTo: b@example.org\r\nSubject: News\r\n${header}\r\n\r\nhi\r\n`);

  it("keeps an https link and a plain address", async () => {
    const detail = await parseRawMessage(mail("List-Unsubscribe: <https://news.example.org/u?id=1>, <mailto:unsub@example.org?subject=bye>"), [], ref);
    expect(detail.unsubscribe).toEqual({ url: "https://news.example.org/u?id=1", mail: "unsub@example.org" });
  });

  it.each(["https://", "https://trusted.example@evil.example/u"])("drops the unusable https link %s", async (link) => {
    const detail = await parseRawMessage(mail(`List-Unsubscribe: <${link}>`), [], ref);
    expect(detail.unsubscribe).toBeUndefined();
  });

  it("drops non-https links and reports nothing when nothing usable is left", async () => {
    const detail = await parseRawMessage(mail("List-Unsubscribe: <http://news.example.org/u>, <javascript:alert(1)>"), [], ref);
    expect(detail.unsubscribe).toBeUndefined();
    expect((await parseRawMessage(mail("X-Other: 1"), [], ref)).unsubscribe).toBeUndefined();
  });
});
