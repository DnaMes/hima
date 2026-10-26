import { expect, test } from "@playwright/test";

const envelope = (id: string) => ({
  id, date: `2026-09-18T0${9 - Number(id)}:30:00Z`, flags: [{ iana: "seen", raw: "\\Seen" }], from: [{ name: "Alice", email: "alice@example.test" }],
  to: [{ name: "Synthetic", email: "synthetic@example.test" }], subject: `Subject ${id}`, size: 12, hasAttachment: false,
});

test("fetches the neighbouring messages once the open one is shown and reuses them", async ({ page }) => {
  const list = [envelope("1"), envelope("2"), envelope("3")];
  const detailCalls: string[] = [];
  await page.route("**/api/bootstrap", (route) => route.fulfill({ json: {
    accounts: [{ name: "synthetic", default: true, backends: ["imap", "smtp"], email: "synthetic@example.test" }], addressWarning: null,
  } }));
  await page.route("**/api/accounts/synthetic/mailboxes", (route) => route.fulfill({ json: { mailboxes: [{ id: "INBOX", name: "INBOX", total: 3, unread: 0 }] } }));
  await page.route("**/api/accounts/synthetic/messages**", (route) => route.fulfill({ json: { envelopes: list } }));
  await page.route("**/api/message?**", async (route) => {
    const message = new URL(route.request().url()).searchParams.get("message") ?? "1";
    detailCalls.push(message);
    const found = list.find((item) => item.id === message)!;
    await route.fulfill({ json: { ref: { account: "synthetic", mailbox: "INBOX", message }, envelope: found, text: `Body ${message}`, html: null, attachments: [],
      sender: { replyTo: null, returnPath: null, messageIdDomain: null, auth: null, received: [], risk: { level: "none", reasons: [] }, trust: null } } });
  });
  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));
  await page.goto("/");
  await expect(page.locator(".envelope-row")).toHaveCount(3);

  await page.getByRole("button", { name: /Subject 2/ }).click();
  await expect(page.getByRole("heading", { name: "Subject 2" })).toBeVisible();
  await expect.poll(() => [...new Set(detailCalls)].sort()).toEqual(["1", "2", "3"]);

  // Wait until no prefetch request is still on its way, so the count below belongs to the j press alone.
  let settled = -1;
  await expect.poll(async () => { const now = detailCalls.length; const stable = now === settled; settled = now; await page.waitForTimeout(250); return stable; }).toBe(true);
  const before = detailCalls.length;
  await page.keyboard.press("j");
  await expect(page.getByRole("heading", { name: "Subject 3" })).toBeVisible();
  // Subject 3 came from the cache; only its own neighbour (none further down, 2 cached) may be fetched.
  // A negative cannot be awaited for; half a second is long past the prefetch for a cached neighbour on loopback.
  await page.waitForTimeout(500);
  expect(detailCalls.slice(before)).toEqual([]);
});
