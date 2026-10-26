import { expect, test } from "@playwright/test";

const envelope = {
  id: "7",
  date: "2026-10-02T05:20:00Z",
  flags: [],
  from: [{ name: "Bundeszentralamt für Steuern", email: "support@evil.example" }],
  to: [{ name: "Synthetic", email: "synthetic@example.test" }],
  subject: "Steuerkonto",
  size: 12,
  hasAttachment: false,
};

test("shows a phishing badge, a warning banner and the sender details", async ({ page }) => {
  await page.route("**/api/bootstrap", async (route) => {
    await route.fulfill({
      json: {
        accounts: [{ name: "synthetic", default: true, backends: ["imap", "smtp"], email: "synthetic@example.test" }],
        addressWarning: null,
      },
    });
  });
  await page.route("**/api/accounts/synthetic/mailboxes", async (route) => {
    await route.fulfill({ json: { mailboxes: [{ id: "INBOX", name: "INBOX", total: 1, unread: 1 }] } });
  });
  await page.route("**/api/accounts/synthetic/messages**", async (route) => {
    await route.fulfill({ json: { envelopes: [{ ...envelope, risk: "high" }] } });
  });
  await page.route("**/api/message?**", async (route) => {
    await route.fulfill({
      json: {
        ref: { account: "synthetic", mailbox: "INBOX", message: "7" },
        envelope,
        text: "Frist läuft",
        html: null,
        attachments: [],
        sender: {
          replyTo: null,
          returnPath: "support@evil.example",
          messageIdDomain: "evil.example",
          auth: { spf: "pass", dkim: "none", dmarc: "pass" },
          received: [{ from: "srv1.trm.com", by: "mx.example", ip: "143.246.202.177" }],
          risk: { level: "high", score: 75, reasons: ["Synthetischer Grund für die Warnung."] },
        },
      },
    });
  });
  await page.route("**/api/message/seen", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });

  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));
  await page.goto("/");

  const row = page.getByRole("button", { name: /Steuerkonto/ });
  await expect(row.locator(".badge-phishing")).toBeVisible();
  await row.click();

  const banner = page.getByRole("alert").filter({ hasText: "sehr wahrscheinlich Phishing" });
  await expect(banner).toContainText("Synthetischer Grund für die Warnung.");

  await page.getByText("Absenderdetails").click();
  await expect(page.getByText("DKIM none")).toBeVisible();
  await expect(page.getByText("srv1.trm.com [143.246.202.177] → mx.example")).toBeVisible();
});
