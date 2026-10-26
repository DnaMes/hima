import { expect, test } from "@playwright/test";

test("collapses the sidebar into icon tabs, displays horizontal account and folder tabs, supports collapsible search, and persists across reload", async ({ page }) => {
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

  // Starts in default expanded mode without mailbox tabs
  await expect(page.locator(".workspace")).not.toHaveClass(/sidebar-collapsed/);
  await expect(page.locator(".accounts-panel")).not.toHaveClass(/collapsed/);
  await expect(page.locator(".mailbox-tabs")).toHaveCount(0);
  await expect(page.getByLabel("Nachrichten suchen")).toBeVisible();

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

  // Click collapse button
  const toggleBtn = page.getByRole("button", { name: "Postfächer einklappen" });
  await expect(toggleBtn).toBeVisible();
  await toggleBtn.click();

  // Sidebar is now collapsed
  await expect(page.locator(".workspace")).toHaveClass(/sidebar-collapsed/);
  await expect(page.locator(".accounts-panel")).toHaveClass(/collapsed/);
  await expect(page.getByRole("button", { name: "Postfächer ausklappen" })).toBeVisible();

  // Horizontal account and folder tabs appear
  await expect(page.locator(".account-tabs")).toBeVisible();
  await expect(page.locator(".mailbox-tabs")).toBeVisible();
  await expect(page.getByRole("tab", { name: "INBOX" })).toBeVisible();
  const sentTab = page.getByRole("tab", { name: "Sent" });
  await expect(sentTab).toBeVisible();
  await expect(page.getByRole("tab", { name: "Drafts" })).toBeVisible();

  // Switching account via horizontal account tabs
  const workTab = page.getByRole("tab", { name: /work/i });
  await expect(workTab).toBeVisible();
  await workTab.click();
  await expect(page.getByRole("tab", { name: "Archive" })).toBeVisible();

  // Persistence check: reload preserves collapsed state
  await page.reload();
  await expect(page.locator(".workspace")).toHaveClass(/sidebar-collapsed/);
  await expect(page.locator(".accounts-panel")).toHaveClass(/collapsed/);
  await expect(page.locator(".mailbox-tabs")).toBeVisible();

  // Click expand toggle to restore full view
  await page.getByRole("button", { name: "Postfächer ausklappen" }).click();
  await expect(page.locator(".workspace")).not.toHaveClass(/sidebar-collapsed/);
  await expect(page.locator(".accounts-panel")).not.toHaveClass(/collapsed/);
  await expect(page.locator(".mailbox-tabs")).toHaveCount(0);

  // Topbar layout toggle test: click 'Tabs-Modus' button in topbar
  const topbarTabsBtn = page.getByRole("button", { name: "In Tabs-Modus wechseln" });
  await expect(topbarTabsBtn).toBeVisible();
  await topbarTabsBtn.click();
  await expect(page.locator(".workspace")).toHaveClass(/sidebar-collapsed/);
  await expect(page.locator(".account-tabs")).toBeVisible();

  // Click 'Seitenleiste' button in topbar to return to full sidebar view
  const topbarSidebarBtn = page.getByRole("button", { name: "Seitenleiste anzeigen" });
  await expect(topbarSidebarBtn).toBeVisible();
  await topbarSidebarBtn.click();
  await expect(page.locator(".workspace")).not.toHaveClass(/sidebar-collapsed/);
});
