import { expect, test } from "@playwright/test";

const envelope = (id: string, subject: string) => ({
  id, date: "2026-09-18T09:30:00Z", flags: [], from: [{ name: "Alice", email: "alice@example.test" }],
  to: [{ name: "Synthetic", email: "synthetic@example.test" }], subject, size: 12, hasAttachment: false,
});

test("jumps to a folder with Ctrl+K and runs an action", async ({ page }) => {
  await page.route("**/api/bootstrap", (route) => route.fulfill({ json: {
    accounts: [{ name: "synthetic", default: true, backends: ["imap", "smtp"], email: "synthetic@example.test" }], addressWarning: null,
  } }));
  await page.route("**/api/accounts/synthetic/mailboxes", (route) => route.fulfill({ json: { mailboxes: [
    { id: "INBOX", name: "INBOX", total: 1, unread: 1 }, { id: "Archive", name: "Archive", total: 1, unread: 0 },
  ] } }));
  await page.route("**/api/accounts/synthetic/messages**", async (route) => {
    const mailbox = new URL(route.request().url()).searchParams.get("mailbox");
    await route.fulfill({ json: { envelopes: [envelope("1", mailbox === "Archive" ? "Archive mail" : "Inbox mail")] } });
  });
  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Inbox mail/ })).toBeVisible();

  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Befehlspalette" })).toBeVisible();
  await page.getByLabel("Befehl suchen").fill("archive");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Archive mail/ })).toBeVisible();

  await page.keyboard.press("Control+k");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Befehl suchen")).toBeFocused();
  await page.getByLabel("Befehl suchen").fill("neue nachricht");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: /Neue Nachricht|Nachricht/ })).toBeVisible();
});
