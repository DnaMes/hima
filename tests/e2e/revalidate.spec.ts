import { expect, test } from "@playwright/test";

const envelope = (id: string, subject: string) => ({
  id, date: "2026-09-18T09:30:00Z", flags: [{ iana: "seen", raw: "\\Seen" }], from: [{ name: "Alice", email: "alice@example.test" }],
  to: [{ name: "Synthetic", email: "synthetic@example.test" }], subject, size: 12, hasAttachment: false,
});

test("a list that came back at once is quietly requested again twice and replaced by the fresh one", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/bootstrap", (route) => route.fulfill({ json: {
    accounts: [{ name: "synthetic", default: true, backends: ["imap", "smtp"], email: "synthetic@example.test" }], addressWarning: null,
  } }));
  await page.route("**/api/accounts/synthetic/mailboxes", (route) => route.fulfill({ json: { mailboxes: [{ id: "INBOX", name: "INBOX", total: 1, unread: 0 }] } }));
  await page.route("**/api/accounts/synthetic/messages**", (route) => {
    calls += 1;
    return route.fulfill({ json: { envelopes: [envelope("1", calls === 1 ? "Old list" : "Fresh list")] } });
  });
  await page.clock.install();
  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Old list/ })).toBeVisible();
  expect(calls).toBe(1);

  await page.clock.fastForward(7000);
  await expect(page.getByRole("button", { name: /Fresh list/ })).toBeVisible();
  expect(calls).toBe(2);
  // The second quiet re-request (a slow server refresh may not have been done at 6 s) and then no more.
  await page.clock.fastForward(10000);
  await expect.poll(() => calls).toBe(3);
  await page.clock.fastForward(60000);
  expect(calls).toBe(3);
});
