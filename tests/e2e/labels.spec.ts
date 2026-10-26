import { expect, test } from "@playwright/test";

const envelope = (id: string, subject: string) => ({
  id, date: "2026-09-18T09:30:00Z", flags: [{ iana: "seen", raw: "\\Seen" }], from: [{ name: "Alice", email: "alice@example.test" }],
  to: [{ name: "Synthetic", email: "synthetic@example.test" }], subject, size: 12, hasAttachment: false,
});

test("labels a message, shows chips, filters by label and keeps them across a reload", async ({ page }) => {
  const list = [envelope("1", "First synthetic"), envelope("2", "Second synthetic")];
  let stored: Array<{ account: string; mailbox: string; message: string; labels: string[] }> = [];
  await page.route("**/api/bootstrap", (route) => route.fulfill({ json: {
    accounts: [{ name: "synthetic", default: true, backends: ["imap", "smtp"], email: "synthetic@example.test" }], addressWarning: null, labels: stored,
  } }));
  await page.route("**/api/accounts/synthetic/mailboxes", (route) => route.fulfill({ json: { mailboxes: [{ id: "INBOX", name: "INBOX", total: 2, unread: 0 }] } }));
  await page.route("**/api/accounts/synthetic/messages**", (route) => route.fulfill({ json: { envelopes: list } }));
  await page.route("**/api/message?**", async (route) => {
    const message = new URL(route.request().url()).searchParams.get("message") ?? "1";
    await route.fulfill({ json: { ref: { account: "synthetic", mailbox: "INBOX", message }, envelope: list.find((item) => item.id === message), text: "Body", html: null, attachments: [],
      sender: { replyTo: null, returnPath: null, messageIdDomain: null, auth: null, received: [], risk: { level: "none", reasons: [] }, trust: null } } });
  });
  await page.route("**/api/labels", async (route) => {
    const body = route.request().postDataJSON() as { ref: { account: string; mailbox: string; message: string }; labels: string[] };
    stored = [...stored.filter((entry) => entry.message !== body.ref.message), ...(body.labels.length ? [{ ...body.ref, labels: body.labels }] : [])];
    await route.fulfill({ json: { ok: true } });
  });
  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));
  await page.goto("/");
  await expect(page.locator(".envelope-row")).toHaveCount(2);

  await page.getByRole("button", { name: /First synthetic/ }).click();
  await page.getByLabel("Etikett hinzufügen").fill("Rechnung, Steuer");
  await page.getByLabel("Etikett hinzufügen").press("Enter");
  await expect(page.locator(".label-chip")).toHaveText(["Rechnung×", "Steuer×"]);
  await expect(page.locator(".envelope-row", { hasText: "First synthetic" }).locator(".row-label")).toHaveText(["Rechnung", "Steuer"]);

  // A duplicate is refused with a hint instead of being stored twice.
  await page.getByLabel("Etikett hinzufügen").fill("rechnung");
  await page.getByLabel("Etikett hinzufügen").press("Enter");
  await expect(page.getByText(/Etikett nicht hinzugefügt/)).toBeVisible();
  await expect(page.locator(".label-chip")).toHaveCount(2);

  await page.getByLabel("Nach Etikett filtern").selectOption("Steuer");
  await expect(page.locator(".envelope-row")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Second synthetic/ })).toHaveCount(0);
  await page.getByLabel("Nach Etikett filtern").selectOption("");
  await expect(page.locator(".envelope-row")).toHaveCount(2);

  await page.reload();
  await expect(page.locator(".envelope-row", { hasText: "First synthetic" }).locator(".row-label")).toHaveText(["Rechnung", "Steuer"]);

  await page.getByRole("button", { name: /First synthetic/ }).click();
  await page.getByRole("button", { name: "Etikett entfernen: Rechnung" }).click();
  await expect(page.locator(".label-chip")).toHaveText(["Steuer×"]);
  expect(stored[0]?.labels).toEqual(["Steuer"]);
});
