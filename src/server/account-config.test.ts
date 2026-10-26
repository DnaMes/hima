import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectProvider, loadAccountEmails, parseAccountEmails } from "./account-config.js";

describe("detectProvider", () => {
  it("detects Gmail by server host, email, or account name", () => {
    expect(detectProvider("imaps://imap.gmail.com:993", "user@custom.domain", "custom")).toBe("gmail");
    expect(detectProvider(null, "user@gmail.com", "personal")).toBe("gmail");
    expect(detectProvider(null, "user@googlemail.com", "personal")).toBe("gmail");
    expect(detectProvider(null, null, "gmail-main")).toBe("gmail");
  });

  it("detects iCloud by server host or email", () => {
    expect(detectProvider("imaps://imap.mail.me.com:993", "user@custom.domain", "apple")).toBe("icloud");
    expect(detectProvider(null, "user@icloud.com", "apple")).toBe("icloud");
  });

  it("detects goneo and lima-city by server host or email", () => {
    expect(detectProvider("imaps://imap.goneo.de:993", "admin@since.afwh.de", "mgmt")).toBe("goneo");
    expect(detectProvider("imaps://mail.lima-city.de:993", "andre@semek.org", "andre")).toBe("lima-city");
  });

  it("detects other popular providers", () => {
    expect(detectProvider("outlook.office365.com", "work@company.com", "work")).toBe("outlook");
    expect(detectProvider(null, "user@fastmail.com", "fastmail")).toBe("fastmail");
    expect(detectProvider("imap.fastmail.fm", "user@customdomain.com", "mymail")).toBe("fastmail");
    expect(detectProvider("127.0.0.1", "secure@proton.me", "proton")).toBe("proton");
    expect(detectProvider("mail.protonmail.com", "user@customdomain.com", "mymail")).toBe("proton");
    expect(detectProvider(null, "user@gmx.de", "gmx")).toBe("gmx");
    expect(detectProvider(null, "user@web.de", "webde")).toBe("webde");
    expect(detectProvider(null, "user@posteo.de", "posteo")).toBe("posteo");
    expect(detectProvider("mail.posteo.net", "user@customdomain.com", "mymail")).toBe("posteo");
    expect(detectProvider(null, "user@mailbox.org", "mailboxorg")).toBe("mailboxorg");
    expect(detectProvider("imap.strato.de", "info@custom.de", "strato")).toBe("strato");
    expect(detectProvider("mail.your-server.de", "info@custom.de", "hetzner")).toBe("hetzner");
    expect(detectProvider("imap.ionos.de", "info@custom.de", "ionos")).toBe("ionos");
  });

  it("falls back to custom for unrecognized providers", () => {
    expect(detectProvider("mail.customserver.lan", "test@customserver.lan", "custom")).toBe("custom");
    expect(detectProvider("mail.notgmail.com", "test@notgmail.com", "custom")).toBe("custom");
    expect(detectProvider("mail.fakeoutlook.org", "test@fakeoutlook.org", "custom")).toBe("custom");
    expect(detectProvider("imaps://imap.gmail.com:password@evil.example", "test@custom.de", "custom")).toBe("custom");
  });
});

describe("parseAccountEmails", () => {
  it("returns only configured emails and detected providers for known accounts", () => {
    const result = parseAccountEmails(
      [
        "[accounts.andre]",
        'email = "andre@example.test"',
        'description = "synthetic-unrelated-field"',
        "[accounts.andre.imap]",
        'server = "imaps://mail.lima-city.de:993"',
        "",
        "[accounts.other]",
        'email = "other@gmail.com"',
        "",
        "[not-an-account]",
        'email = "unrelated@example.test"',
      ].join("\n"),
      ["andre", "other", "missing"],
    );

    expect(result.warning).toBeNull();
    expect(result.emails).toEqual({ andre: "andre@example.test", other: "other@gmail.com", missing: null });
    expect(result.providers).toEqual({ andre: "lima-city", other: "gmail", missing: "custom" });
    expect(JSON.stringify(result)).not.toContain("synthetic-unrelated-field");
  });

  it("keeps malformed or missing email fields non-fatal", () => {
    const result = parseAccountEmails(
      ["[accounts.andre]", "email = 42", "", "[accounts.empty]"].join("\n"),
      ["andre", "empty", "missing"],
    );

    expect(result.warning).toBeNull();
    expect(result.emails).toEqual({ andre: null, empty: null, missing: null });
    expect(result.providers).toEqual({ andre: "custom", empty: "custom", missing: "custom" });
  });

  it("reports malformed TOML and duplicate account tables without returning data", () => {
    expect(parseAccountEmails('[accounts.andre\nemail = "broken', ["andre"]).warning).toContain("Adressen");
    expect(parseAccountEmails(
      [
        "[accounts.andre]",
        'email = "one@example.test"',
        "[accounts.andre]",
        'email = "two@example.test"',
      ].join("\n"),
      ["andre"],
    ).warning).toContain("Adressen");
  });

  it("reports an unreadable config without blocking account discovery", async () => {
    const result = await loadAccountEmails(["andre"], join(tmpdir(), "himalaya-web-config-does-not-exist.toml"));

    expect(result).toEqual({
      emails: { andre: null },
      providers: { andre: "custom" },
      warning: "Adressen konnten nicht aus der Himalaya-Konfiguration gelesen werden.",
    });
  });
});
