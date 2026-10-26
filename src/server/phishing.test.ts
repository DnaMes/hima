import { describe, expect, it } from "vitest";

import { assessMessage, parseAuthResults, type AssessInput } from "./phishing.js";

const AUTH_NO_DKIM = parseAuthResults(
  "mail.lima-city.de;\tdkim=none;\tspf=pass (domain of x designates 1.2.3.4 as permitted sender) smtp.mailfrom=x;\tdmarc=pass (policy=reject) header.from=x",
);

function input(overrides: Partial<AssessInput> = {}): AssessInput {
  const fromEmail = overrides.fromEmail ?? "anna@example.org";
  return {
    fromName: "Anna Beispiel",
    fromEmail,
    replyTo: null,
    returnPath: fromEmail,
    auth: { spf: "pass", dkim: "pass", dmarc: "pass" },
    html: "<p>Hallo, bis morgen!</p>",
    text: "Hallo, bis morgen!",
    subject: "Treffen",
    ...overrides,
  };
}

describe("parseAuthResults", () => {
  it("reads the three mechanisms and ignores trailing comments", () => {
    expect(AUTH_NO_DKIM).toEqual({ spf: "pass", dkim: "none", dmarc: "pass" });
  });

  it("returns null for a missing header and nulls for absent mechanisms", () => {
    expect(parseAuthResults(null)).toBeNull();
    expect(parseAuthResults("mx.example; spf=fail")).toEqual({ spf: "fail", dkim: null, dmarc: null });
  });
});

describe("assessMessage", () => {
  it("flags the BZSt phishing sample as high", () => {
    const risk = assessMessage(input({
      fromName: "Hr. Bundeszentralamt für Steuern | Finn Lindner 🔔 Information",
      fromEmail: "support@swordshieldconsulting.com",
      returnPath: "support@swordshieldconsulting.com",
      auth: AUTH_NO_DKIM,
      subject: "Automatische Benachrichtigung BZSt-Wcl zu Ihrem Steuerkonto",
      html: '<a href="https://google.de/share.google?q=OShkSrP5WuEQ60e82">Benachrichtigung abrufen und bestätigen</a>',
      text: "FRIST LÄUFT Sperrfolge: Ohne Bestätigung ... Benachrichtigung abrufen und bestätigen",
    }));
    expect(risk.level).toBe("high");
    expect(risk.reasons.join(" ")).toMatch(/Bundeszentralamt|Behörde|Marke/i);
    expect(risk.reasons.join(" ")).toMatch(/Weiterleit/i);
  });

  it("leaves ordinary mail alone", () => {
    expect(assessMessage(input()).level).toBe("none");
  });

  it("does not warn on the real brand domain", () => {
    const risk = assessMessage(input({
      fromName: "PayPal",
      fromEmail: "service@paypal.de",
      returnPath: "bounce@mail.paypal.de",
      subject: "Beleg für Ihre Zahlung - bestätigen",
    }));
    expect(risk.level).toBe("none");
  });

  it("flags brand names on a foreign domain as suspicious without further signals", () => {
    const risk = assessMessage(input({ fromName: "DHL Paket", fromEmail: "info@lieferung-now.net" }));
    expect(risk.level).toBe("suspicious");
  });

  it("flags a brand lookalike domain", () => {
    const risk = assessMessage(input({ fromName: "Support", fromEmail: "noreply@paypal-secure-login.com" }));
    expect(risk.level).not.toBe("none");
    expect(risk.reasons.join(" ")).toMatch(/PayPal/);
  });

  it("does not treat amazonaws.com as an Amazon impostor", () => {
    expect(assessMessage(input({ fromName: "AWS", fromEmail: "no-reply@sns.amazonaws.com" })).level).toBe("none");
  });

  it("flags a mixed-script From domain", () => {
    const risk = assessMessage(input({ fromEmail: "info@pаypal.com" })); // Cyrillic "а"
    expect(risk.level).not.toBe("none");
  });

  it("flags an email address inside the display name that differs from the sender", () => {
    const risk = assessMessage(input({ fromName: "service@paypal.com", fromEmail: "x@evil.example" }));
    expect(risk.level).not.toBe("none");
  });

  it("flags link text that names a different domain than the href", () => {
    const risk = assessMessage(input({
      html: '<a href="https://evil.example/login">www.sparkasse.de/login</a>',
    }));
    expect(risk.level).toBe("suspicious");
    expect(risk.reasons.join(" ")).toMatch(/Linktext/);
  });

  it("accepts click-tracking links whose text names the sender's own domain", () => {
    const risk = assessMessage(input({
      fromEmail: "email@txn-email.playstation.com",
      html: '<a href="https://click.exct.net/?qs=abc">www.playstation.com</a>',
    }));
    expect(risk.level).toBe("none");
  });

  it("flags IP-literal and userinfo links", () => {
    expect(assessMessage(input({ html: '<a href="http://203.0.113.9/x">hier</a>' })).level).toBe("suspicious");
    expect(assessMessage(input({ html: '<a href="https://bank.de@evil.example/">hier</a>' })).level).toBe("suspicious");
  });

  it("does not warn on non-anchor signals alone (newsletter style)", () => {
    const risk = assessMessage(input({
      replyTo: "news@other-esp.example",
      returnPath: "bounce@esp.example",
      auth: { spf: "pass", dkim: "fail", dmarc: "pass" },
      html: '<a href="https://bit.ly/abc">Angebot</a>',
      text: "Dringend: Frist läuft, sofort bestätigen, Zahlung, Rechnung",
    }));
    expect(risk.score).toBeGreaterThanOrEqual(45);
    expect(risk.level).toBe("none");
  });

  it("caps the score at 100", () => {
    const risk = assessMessage(input({
      fromName: "PayPal service@paypal.com",
      fromEmail: "x@paypal-login.example",
      replyTo: "y@other.example",
      returnPath: "z@third.example",
      auth: { spf: "pass", dkim: "fail", dmarc: "fail" },
      html: '<form></form><a href="http://203.0.113.9/">www.paypal.com</a>',
    }));
    expect(risk.score).toBe(100);
    expect(risk.level).toBe("high");
  });

  describe("sender status", () => {
    const phish = { fromName: "PayPal", fromEmail: "x@evil.example", html: '<a href="http://203.0.113.9/">hier</a>' };

    it("flags a reported sender as high, whatever the message looks like", () => {
      const risk = assessMessage(input({ senderStatus: "blocked" }));

      expect(risk).toEqual({ level: "high", score: 100, reasons: ["Du hast diesen Absender als Phishing gemeldet."] });
    });

    it("lets a trusted sender through even when the heuristics would warn", () => {
      expect(assessMessage(input({ ...phish })).level).not.toBe("none");
      expect(assessMessage(input({ ...phish, senderStatus: "trusted" }))).toEqual({ level: "none", score: 0, reasons: [] });
    });

    it("ignores an SPF failure alone for a trusted sender (forwarding breaks SPF)", () => {
      expect(assessMessage(input({ senderStatus: "trusted", auth: { spf: "fail", dkim: "pass", dmarc: "pass" } })).level).toBe("none");
    });

    it.each([{ dkim: "fail", dmarc: "pass" }, { dkim: "pass", dmarc: "fail" }])("keeps a trusted sender with a failed %j high, as a possible forgery", (auth) => {
      const risk = assessMessage(input({ senderStatus: "trusted", auth: { spf: "pass", ...auth } }));

      expect(risk.level).toBe("high");
      expect(risk.reasons).toContain("Vertrauter Absender, aber die Absenderprüfung ist fehlgeschlagen (mögliche Fälschung).");
    });
  });
});
