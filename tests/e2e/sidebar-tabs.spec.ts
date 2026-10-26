import { expect, test } from "@playwright/test";

test("shows the persistent account and folder bar instead of a sidebar, names the open mailbox, and supports collapsible search", async ({ page }) => {
  await page.route("**/api/bootstrap", (route) => route.fulfill({ json: {
    accounts: [
      { name: "synthetic", default: true, backends: ["imap", "smtp"], email: "synthetic@example.test" },
      { name: "work", default: false, backends: ["imap", "smtp"], email: "work@example.test" },
    ],
    addressWarning: null,
  } }));
  await page.route("**/api/accounts/synthetic/mailboxes", (route) => route.fulfill({ json: {
    mailboxes: [
      { id: "INBOX", name: "INBOX", total: 5, unread: 2 },
      { id: "Sent", name: "Sent", total: 10, unread: 0 },
      { id: "Drafts", name: "Drafts", total: 1, unread: 0 },
    ],
  } }));
  await page.route("**/api/accounts/work/mailboxes", (route) => route.fulfill({ json: {
    mailboxes: [
      { id: "INBOX", name: "INBOX", total: 3, unread: 1 },
      { id: "Archive", name: "Archive", total: 8, unread: 0 },
    ],
  } }));
  await page.route("**/api/accounts/**/messages**", (route) => route.fulfill({ json: {
    envelopes: [
      { id: "1", date: "2026-10-26T18:00:00Z", flags: [], from: [{ name: "Alice", email: "alice@example.test" }], to: [], subject: "Welcome", size: 10, hasAttachment: false },
    ],
  } }));
  await page.route("**/api/message?**", (route) => route.fulfill({ json: {
    ref: { account: "synthetic", mailbox: "INBOX", message: "1" },
    envelope: { id: "1", date: "2026-10-26T18:00:00Z", flags: [], from: [{ name: "Alice", email: "alice@example.test" }], to: [], subject: "Welcome", size: 10, hasAttachment: false },
    text: "Hello World", html: null, attachments: [],
  } }));

  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));
  await page.goto("/");

  // The bar is always there; there is no sidebar any more
  await expect(page.locator(".accounts-panel")).toHaveCount(0);
  await expect(page.locator(".mailbox-bar .account-tabs")).toBeVisible();
  await expect(page.getByLabel("Nachrichten suchen")).toBeVisible();
  await expect(page.locator(".account-identity")).toContainText("synthetic@example.test");

  // Collapsible search test: toggle search off
  const searchToggleBtn = page.getByRole("button", { name: "Suche einklappen" });
  await expect(searchToggleBtn).toBeVisible();
  await searchToggleBtn.click();
  await expect(page.getByLabel("Nachrichten suchen")).toHaveCount(0);

  // Reload page to verify search collapsed state persistence
  await page.reload();
  await expect(page.getByLabel("Nachrichten suchen")).toHaveCount(0);
  const searchExpandBtn = page.getByRole("button", { name: "Suche ausklappen" });
  await expect(searchExpandBtn).toBeVisible();
  await searchExpandBtn.click();
  await expect(page.getByLabel("Nachrichten suchen")).toBeVisible();

  // Account and folder tabs
  await expect(page.locator(".mailbox-bar .mailbox-tabs")).toBeVisible();
  await expect(page.getByRole("tab", { name: "INBOX" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Sent" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Drafts" })).toBeVisible();

  // Switching account swaps the folder tabs and the address in the list header
  const workTab = page.getByRole("tab", { name: /work/i });
  await workTab.click();
  await expect(page.getByRole("tab", { name: "Archive" })).toBeVisible();
  await expect(page.locator(".account-identity")).toContainText("work@example.test");

  // Keyboard navigation & roving tabindex on account tabs
  await expect(workTab).toHaveAttribute("tabindex", "0");
  const syntheticTab = page.getByRole("tab", { name: "synthetic" });
  await expect(syntheticTab).toHaveAttribute("tabindex", "-1");
  await workTab.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(syntheticTab).toHaveAttribute("aria-selected", "true");
  await expect(syntheticTab).toBeFocused();

  // Keyboard navigation & roving tabindex on mailbox tabs
  const inboxTab = page.getByRole("tab", { name: "INBOX" });
  await expect(inboxTab).toHaveAttribute("tabindex", "0");
  await inboxTab.focus();
  await page.keyboard.press("ArrowRight");
  const sentTab = page.getByRole("tab", { name: "Sent" });
  await expect(sentTab).toHaveAttribute("aria-selected", "true");
  await expect(sentTab).toBeFocused();

  // Semantic cleanliness: tablists contain only role="tab" elements
  expect(await page.locator(".account-tabs > :not([role='tab'])").count()).toBe(0);
  expect(await page.locator(".mailbox-tabs > :not([role='tab'])").count()).toBe(0);

  // The bar survives a reload
  await page.reload();
  await expect(page.locator(".mailbox-bar .mailbox-tabs")).toBeVisible();
});
