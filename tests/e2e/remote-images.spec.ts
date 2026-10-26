import { expect, test } from "@playwright/test";

const envelope = { id: "1", date: "2026-09-18T09:30:00Z", flags: [], from: [{ name: "News", email: "news@example.test" }],
  to: [{ name: "Synthetic", email: "synthetic@example.test" }], subject: "Synthetic images", size: 12, hasAttachment: false };

test("blocks remote images until allowed, https only, and can remember the sender", async ({ page }) => {
  await page.route("**/api/bootstrap", (route) => route.fulfill({ json: {
    accounts: [{ name: "synthetic", default: true, backends: ["imap", "smtp"], email: "synthetic@example.test" }], addressWarning: null,
  } }));
  await page.route("**/api/accounts/synthetic/mailboxes", (route) => route.fulfill({ json: { mailboxes: [{ id: "INBOX", name: "INBOX", total: 1, unread: 1 }] } }));
  await page.route("**/api/accounts/synthetic/messages**", (route) => route.fulfill({ json: { envelopes: [envelope] } }));
  await page.route("**/api/message?**", (route) => route.fulfill({ json: {
    ref: { account: "synthetic", mailbox: "INBOX", message: "1" }, envelope, text: "Hi", attachments: [],
    html: '<p>Hello</p><img src="https://tracker.example/pixel.gif" srcset="x"><img src="http://tracker.example/plain.gif">',
    sender: { replyTo: null, returnPath: null, messageIdDomain: null, auth: null, received: [], risk: { level: "none", reasons: [] }, trust: null },
  } }));
  await page.route("**/api/message/seen", (route) => route.fulfill({ json: { ok: true } }));
  const imageRequests: string[] = [];
  await page.route("https://tracker.example/**", (route) => { imageRequests.push(route.request().url()); return route.fulfill({ contentType: "image/gif", body: Buffer.from("R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==", "base64") }); });
  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));
  await page.goto("/");
  await page.getByRole("button", { name: /Synthetic images/ }).click();

  await expect(page.getByText(/2 Bilder aus dem Netz blockiert/)).toBeVisible();
  await expect(page.frameLocator("iframe").getByText("Hello")).toBeVisible();
  await expect(page.frameLocator("iframe").locator("img")).toHaveCount(0);
  expect(imageRequests).toEqual([]);

  await page.getByRole("button", { name: "Bilder laden", exact: true }).click();
  const images = page.frameLocator("iframe").locator("img");
  await expect(images).toHaveCount(2);
  await expect(images.first()).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(images.nth(1)).not.toHaveAttribute("src", /.+/);
  await expect(page.getByText(/aus dem Netz blockiert/)).toHaveCount(0);
  // Only the https image is ever requested; the http one lost its src.
  await expect.poll(() => [...new Set(imageRequests)]).toEqual(["https://tracker.example/pixel.gif"]);

  // "Always from this sender" survives a reload.
  await page.reload();
  await page.getByRole("button", { name: /Synthetic images/ }).click();
  await expect(page.getByText(/2 Bilder aus dem Netz blockiert/)).toBeVisible();
  await page.getByRole("button", { name: "Immer von news@example.test laden" }).click();
  await expect(page.frameLocator("iframe").locator("img")).toHaveCount(2);
  await page.reload();
  await page.getByRole("button", { name: /Synthetic images/ }).click();
  await expect(page.frameLocator("iframe").locator("img")).toHaveCount(2);
  await expect(page.getByText(/aus dem Netz blockiert/)).toHaveCount(0);
});
