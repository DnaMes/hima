import { expect, test } from "@playwright/test";

// Renders the README screenshots from synthetic data. Run with:
//   SCREENSHOTS=1 npx playwright test tests/e2e/screenshots.spec.ts
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to render docs/screenshots");
test.use({ launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH ?? "/home/dnames/bin/chromium-ai" } });

const accounts = [
  { name: "work", default: true, email: "alex@example.test", provider: "custom" },
  { name: "private", default: false, email: "alex@gmail.example.test", provider: "gmail" },
  { name: "newsletters", default: false, email: "news@example.test", provider: "custom" },
].map((account) => ({ ...account, backends: ["imap", "smtp"] }));

const mailboxes = [
  { id: "INBOX", name: "Inbox", total: 5, unread: 3 },
  { id: "Sent", name: "Sent", total: 12, unread: 0 },
  { id: "Archive", name: "Archive", total: 40, unread: 0 },
  { id: "Projects", name: "Projects", total: 8, unread: 1 },
];

const envelope = (id: string, name: string, email: string, subject: string, unread: boolean) => ({
  id, date: "2026-10-26T08:30:00Z", flags: unread ? [] : [{ iana: "seen", raw: "Seen" }],
  from: [{ name, email }], to: [{ name: "Alex", email: "alex@example.test" }], subject, size: 4200, hasAttachment: id === "2",
});
const envelopes = [
  envelope("1", "Mara Lindqvist", "mara@example.test", "Roadmap review: agenda and open questions", true),
  envelope("2", "Billing", "billing@example.test", "Your invoice for October", true),
  envelope("3", "Jonas Weber", "jonas@example.test", "Re: Release checklist", true),
  envelope("4", "Design Team", "design@example.test", "New mockups are ready for feedback", false),
  envelope("5", "Priya Nair", "priya@example.test", "Lunch on Thursday?", false),
];

for (const theme of ["midnight", "catppuccin-latte"] as const) {
  test(`renders the ${theme} screenshot`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/bootstrap") await route.fulfill({ json: { accounts } });
      else if (url.pathname.endsWith("/mailboxes")) await route.fulfill({ json: { mailboxes } });
      else if (url.pathname.endsWith("/messages")) await route.fulfill({ json: { envelopes } });
      else if (url.pathname === "/api/message") {
        await route.fulfill({ json: {
          ref: { account: "work", mailbox: "INBOX", message: "1" }, envelope: envelopes[0],
          text: "Hi Alex,\n\nhere is the agenda for Thursday's roadmap review:\n\n1. Release 0.36 scope\n2. Mailbox bar feedback\n3. Open questions on threading\n\nSee you there,\nMara", html: null, attachments: [],
        } });
      } else await route.fulfill({ json: { envelopes: [], hasMore: false, warnings: [] } });
    });
    await page.addInitScript((name) => {
      localStorage.setItem("himalaya-web-last-view", "account");
      localStorage.setItem("himalaya-web-theme-v1", name);
    }, theme);
    await page.goto("/");
    await page.locator(".envelope-row").first().click();
    await expect(page.getByText("Release 0.36 scope")).toBeVisible();
    expect(await page.evaluate(() => document.querySelector(".app-shell")!.scrollHeight - document.querySelector(".app-shell")!.clientHeight)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `docs/screenshots/hima-${theme}.png` });
  });
}
