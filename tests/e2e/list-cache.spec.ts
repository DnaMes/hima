import { expect, test } from "@playwright/test";

const envelope = (id: string, subject: string) => ({
  id, date: "2026-09-18T09:30:00Z", flags: [], from: [{ name: "Alice", email: "alice@example.test" }],
  to: [{ name: "Synthetic", email: "synthetic@example.test" }], subject, size: 12, hasAttachment: false,
});

test("shows a remembered folder list at once and refreshes it afterwards", async ({ page }) => {
  let inboxCalls = 0;
  let releaseSecond: (() => void) | undefined;
  let secondRequested!: () => void;
  const secondSeen = new Promise<void>((resolve) => { secondRequested = resolve; });
  await page.route("**/api/bootstrap", (route) => route.fulfill({ json: {
    accounts: [{ name: "synthetic", default: true, backends: ["imap", "smtp"], email: "synthetic@example.test" }], addressWarning: null,
  } }));
  await page.route("**/api/accounts/synthetic/mailboxes", (route) => route.fulfill({ json: { mailboxes: [
    { id: "INBOX", name: "INBOX", total: 1, unread: 1 }, { id: "Archive", name: "Archive", total: 1, unread: 0 },
  ] } }));
  await page.route("**/api/accounts/synthetic/messages**", async (route) => {
    const mailbox = new URL(route.request().url()).searchParams.get("mailbox");
    if (mailbox === "INBOX") {
      inboxCalls += 1;
      if (inboxCalls === 2) {
        secondRequested();
        await new Promise<void>((resolve) => { releaseSecond = resolve; });
      }
      await route.fulfill({ json: { envelopes: [envelope("1", inboxCalls === 1 ? "Inbox first" : "Inbox refreshed")] } });
    } else await route.fulfill({ json: { envelopes: [envelope("9", "Archive mail")] } });
  });
  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Inbox first/ })).toBeVisible();

  await page.locator(".mailbox-tab").filter({ hasText: "Archive" }).click();
  await expect(page.getByRole("button", { name: /Archive mail/ })).toBeVisible();

  await page.locator(".mailbox-tab").filter({ hasText: "INBOX" }).click();
  // The second INBOX request is held back, so this text can only come from the remembered list.
  await expect(page.getByRole("button", { name: /Inbox first/ })).toBeVisible();
  await secondSeen;
  releaseSecond?.();
  await expect(page.getByRole("button", { name: /Inbox refreshed/ })).toBeVisible();
});
