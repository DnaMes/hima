import { expect, test } from "@playwright/test";

const envelope = (id: string, from: { name: string; email: string }) => ({
  id, date: "2026-09-18T09:30:00Z", flags: [], from: [from],
  to: [{ name: "Synthetic", email: "synthetic@example.test" }], subject: `Mail ${id}`, size: 12, hasAttachment: false,
});

test("suggests known addresses while typing a recipient and keeps the earlier ones", async ({ page }) => {
  await page.route("**/api/bootstrap", (route) => route.fulfill({ json: {
    accounts: [{ name: "synthetic", default: true, backends: ["imap", "smtp"], email: "synthetic@example.test" }], addressWarning: null,
  } }));
  await page.route("**/api/accounts/synthetic/mailboxes", (route) => route.fulfill({ json: { mailboxes: [{ id: "INBOX", name: "INBOX", total: 2, unread: 2 }] } }));
  await page.route("**/api/accounts/synthetic/messages**", (route) => route.fulfill({ json: { envelopes: [
    envelope("1", { name: "Alice Muster", email: "alice@example.test" }), envelope("2", { name: "Bernd Beispiel", email: "bernd@example.test" }),
  ] } }));
  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));
  await page.goto("/");
  await expect(page.locator(".envelope-row")).toHaveCount(2);

  await page.getByRole("button", { name: "Neue Nachricht" }).click();
  const to = page.getByLabel("An", { exact: true });
  await to.pressSequentially("ali");
  await expect(page.getByRole("listbox", { name: /Vorschläge/ }).getByRole("option", { name: /Alice Muster/ })).toBeVisible();
  await page.getByRole("listbox", { name: /Vorschläge/ }).getByRole("option", { name: /Alice Muster/ }).click();
  await expect(to).toHaveValue("alice@example.test, ");

  await to.pressSequentially("bern");
  await expect(page.getByRole("listbox", { name: /Vorschläge/ }).getByRole("option")).toHaveCount(1);
  await page.getByRole("listbox", { name: /Vorschläge/ }).getByRole("option", { name: /Bernd Beispiel/ }).click();
  await expect(to).toHaveValue("alice@example.test, bernd@example.test, ");
  // The operator's own address is never offered.
  await to.pressSequentially("synth");
  await expect(page.getByRole("listbox", { name: /Vorschläge/ }).getByRole("option")).toHaveCount(0);

  // Keyboard: arrows highlight, Enter takes the highlighted suggestion.
  await to.fill("");
  await to.pressSequentially("be");
  await page.keyboard.press("Enter");
  await expect(to).toHaveValue("be");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(to).toHaveValue("bernd@example.test, ");
});
