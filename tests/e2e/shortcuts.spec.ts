import { expect, test } from "@playwright/test";

const envelope = (id: string, subject: string) => ({
  id, date: "2026-09-18T09:30:00Z", flags: [], from: [{ name: "Alice", email: "alice@example.test" }],
  to: [{ name: "Synthetic", email: "synthetic@example.test" }], subject, size: 12, hasAttachment: false,
});

test("moves through the list with j/k, opens the help with ? and ignores typing", async ({ page }) => {
  const list = [envelope("1", "First synthetic"), envelope("2", "Second synthetic"), envelope("3", "Third synthetic")];
  await page.route("**/api/bootstrap", (route) => route.fulfill({ json: {
    accounts: [{ name: "synthetic", default: true, backends: ["imap", "smtp"], email: "synthetic@example.test" }], addressWarning: null,
  } }));
  await page.route("**/api/accounts/synthetic/mailboxes", (route) => route.fulfill({ json: { mailboxes: [{ id: "INBOX", name: "INBOX", total: 3, unread: 3 }] } }));
  await page.route("**/api/accounts/synthetic/messages**", (route) => route.fulfill({ json: { envelopes: list } }));
  await page.route("**/api/message?**", async (route) => {
    const message = new URL(route.request().url()).searchParams.get("message") ?? "1";
    const found = list.find((item) => item.id === message)!;
    await route.fulfill({ json: { ref: { account: "synthetic", mailbox: "INBOX", message }, envelope: found, text: `Body ${found.subject}`, html: null, attachments: [] } });
  });
  await page.route("**/api/message/seen", (route) => route.fulfill({ json: { ok: true } }));
  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));
  await page.goto("/");
  await expect(page.locator(".envelope-row")).toHaveCount(3);

  await page.keyboard.press("j");
  await expect(page.getByRole("heading", { name: "First synthetic" })).toBeVisible();
  await page.keyboard.press("j");
  await expect(page.getByRole("heading", { name: "Second synthetic" })).toBeVisible();
  await page.keyboard.press("k");
  await expect(page.getByRole("heading", { name: "First synthetic" })).toBeVisible();

  await page.getByLabel("Nachrichten suchen").first().pressSequentially("jjj");
  await expect(page.getByRole("heading", { name: "First synthetic" })).toBeVisible();

  await page.getByLabel("Nachrichten suchen").first().blur();
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Tastenkürzel" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.keyboard.press("l");
  await expect(page.getByLabel("Etikett hinzufügen")).toBeFocused();
  await page.getByLabel("Etikett hinzufügen").blur();

  await page.keyboard.press("r");
  await expect(page.getByRole("dialog")).toBeVisible();
});
