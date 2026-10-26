import { expect, test } from "@playwright/test";

const envelope = (id: string, subject: string) => ({
  id, date: "2026-09-18T09:30:00Z", flags: [{ iana: "seen", raw: "\\Seen" }], from: [{ name: "Alice", email: "alice@example.test" }],
  to: [{ name: "Synthetic", email: "synthetic@example.test" }], subject, size: 12, hasAttachment: false,
});

test("hides a snoozed message until it is brought back", async ({ page }) => {
  const list = [envelope("1", "Snooze me"), envelope("2", "Stay visible")];
  let snoozed: Array<Record<string, string>> = [];
  await page.route("**/api/bootstrap", (route) => route.fulfill({ json: {
    accounts: [{ name: "synthetic", default: true, backends: ["imap", "smtp"], email: "synthetic@example.test" }], addressWarning: null,
  } }));
  await page.route("**/api/accounts/synthetic/mailboxes", (route) => route.fulfill({ json: { mailboxes: [{ id: "INBOX", name: "INBOX", total: 2, unread: 0 }] } }));
  await page.route("**/api/accounts/synthetic/messages**", (route) => route.fulfill({ json: { envelopes: list } }));
  await page.route("**/api/message?**", async (route) => {
    const message = new URL(route.request().url()).searchParams.get("message") ?? "1";
    await route.fulfill({ json: { ref: { account: "synthetic", mailbox: "INBOX", message }, envelope: list.find((item) => item.id === message), text: "Body", html: null, attachments: [],
      sender: { replyTo: null, returnPath: null, messageIdDomain: null, auth: null, received: [], risk: { level: "none", reasons: [] }, trust: null } } });
  });
  await page.route("**/api/snoozed", (route) => route.fulfill({ json: { snoozed } }));
  await page.route("**/api/snooze", async (route) => {
    const body = route.request().postDataJSON() as { ref: Record<string, string>; until: string; subject?: string };
    snoozed = [{ ...body.ref, until: body.until, ...(body.subject ? { subject: body.subject } : {}) }];
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/snooze/cancel", async (route) => { snoozed = []; await route.fulfill({ json: { ok: true } }); });
  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));
  await page.goto("/");
  await expect(page.locator(".envelope-row")).toHaveCount(2);

  await page.getByRole("button", { name: /Snooze me/ }).click();
  await page.getByLabel("Später erinnern").selectOption("3h");
  await expect(page.getByText(/Zurückgestellt bis/)).toBeVisible();
  await expect(page.locator(".envelope-row")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Stay visible/ })).toBeVisible();

  await page.getByRole("button", { name: "Zurückgestellt (1)" }).click();
  await expect(page.getByRole("dialog").getByText("Snooze me")).toBeVisible();
  await page.getByRole("button", { name: "Zurückholen" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".envelope-row")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /Zurückgestellt \(/ })).toHaveCount(0);
});
