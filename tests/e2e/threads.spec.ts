import { expect, test } from "@playwright/test";

const envelope = (id: string, subject: string) => ({
  id, date: `2026-09-18T0${9 - Number(id)}:30:00Z`, flags: [], from: [{ name: "Alice", email: "alice@example.test" }],
  to: [{ name: "Synthetic", email: "synthetic@example.test" }], subject, size: 12, hasAttachment: false,
});

test("groups replies under one row and remembers the choice", async ({ page }) => {
  const list = [envelope("1", "Plan"), envelope("2", "Re: Plan"), envelope("3", "Other")];
  await page.route("**/api/bootstrap", (route) => route.fulfill({ json: {
    accounts: [{ name: "synthetic", default: true, backends: ["imap", "smtp"], email: "synthetic@example.test" }], addressWarning: null,
  } }));
  await page.route("**/api/accounts/synthetic/mailboxes", (route) => route.fulfill({ json: { mailboxes: [{ id: "INBOX", name: "INBOX", total: 3, unread: 3 }] } }));
  await page.route("**/api/accounts/synthetic/messages**", (route) => route.fulfill({ json: { envelopes: list } }));
  await page.route("**/api/message?**", async (route) => {
    const message = new URL(route.request().url()).searchParams.get("message") ?? "1";
    const found = list.find((item) => item.id === message)!;
    await route.fulfill({ json: { ref: { account: "synthetic", mailbox: "INBOX", message }, envelope: found, text: "Body", html: null, attachments: [],
      sender: { replyTo: null, returnPath: null, messageIdDomain: null, auth: null, received: [], risk: { level: "none", reasons: [] }, trust: null } } });
  });
  await page.route("**/api/message/seen", (route) => route.fulfill({ json: { ok: true } }));
  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));
  await page.goto("/");
  await expect(page.locator(".envelope-row")).toHaveCount(3);

  await page.getByRole("button", { name: "Gespräche", exact: true }).click();
  await expect(page.locator(".envelope-row")).toHaveCount(2);
  await page.getByRole("button", { name: /1 weitere im Gespräch/ }).click();
  await expect(page.locator(".envelope-row.thread-child")).toHaveCount(1);

  await page.reload();
  await expect(page.locator(".envelope-row")).toHaveCount(2);

  // j walks through hidden thread members too and opens them.
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await expect(page.getByRole("heading", { name: "Re: Plan" })).toBeVisible();
  await expect(page.locator(".envelope-row.thread-child")).toHaveCount(1);
});
