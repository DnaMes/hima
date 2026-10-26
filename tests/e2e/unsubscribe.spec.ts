import { expect, test } from "@playwright/test";

const envelope = {
  id: "1", date: "2026-09-18T09:30:00Z", flags: [], from: [{ name: "News", email: "news@example.test" }],
  to: [{ name: "Synthetic", email: "synthetic@example.test" }], subject: "Synthetic newsletter", size: 12, hasAttachment: false,
};

test("offers the unsubscribe link only after a confirmation and opens it in a new tab", async ({ page, context }) => {
  await page.route("**/api/bootstrap", (route) => route.fulfill({ json: {
    accounts: [{ name: "synthetic", default: true, backends: ["imap", "smtp"], email: "synthetic@example.test" }], addressWarning: null,
  } }));
  await page.route("**/api/accounts/synthetic/mailboxes", (route) => route.fulfill({ json: { mailboxes: [{ id: "INBOX", name: "INBOX", total: 1, unread: 1 }] } }));
  await page.route("**/api/accounts/synthetic/messages**", (route) => route.fulfill({ json: { envelopes: [envelope] } }));
  await page.route("**/api/message?**", (route) => route.fulfill({ json: {
    ref: { account: "synthetic", mailbox: "INBOX", message: "1" }, envelope, text: "Body", html: null, attachments: [],
    sender: { replyTo: null, returnPath: null, messageIdDomain: null, auth: null, received: [], risk: { level: "none", reasons: [] }, trust: null },
    unsubscribe: { url: "https://news.example.test/unsubscribe?id=1", mail: null },
  } }));
  await page.route("**/api/message/seen", (route) => route.fulfill({ json: { ok: true } }));
  await context.route("https://news.example.test/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>Abgemeldet</title>" }));
  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));
  await page.goto("/");
  await page.getByRole("button", { name: /Synthetic newsletter/ }).click();

  let asked = "";
  page.once("dialog", (dialog) => { asked = dialog.message(); void dialog.dismiss(); });
  await page.getByRole("button", { name: "Abmelden", exact: true }).click();
  await expect.poll(() => asked).toContain("https://news.example.test");
  expect(context.pages()).toHaveLength(1);

  page.once("dialog", (dialog) => void dialog.accept());
  const opened = context.waitForEvent("page");
  await page.getByRole("button", { name: "Abmelden", exact: true }).click();
  const popup = await opened;
  await popup.waitForLoadState();
  expect(popup.url()).toContain("https://news.example.test/unsubscribe?id=1");
});
