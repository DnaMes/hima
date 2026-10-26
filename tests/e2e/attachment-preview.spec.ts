import { expect, test } from "@playwright/test";

const envelope = { id: "1", date: "2026-09-18T09:30:00Z", flags: [], from: [{ name: "Alice", email: "alice@example.test" }],
  to: [{ name: "Synthetic", email: "synthetic@example.test" }], subject: "Synthetic attachments", size: 12, hasAttachment: true };
const GIF = Buffer.from("R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==", "base64");

test("previews images and text inline but keeps active content download-only", async ({ page }) => {
  await page.route("**/api/bootstrap", (route) => route.fulfill({ json: {
    accounts: [{ name: "synthetic", default: true, backends: ["imap", "smtp"], email: "synthetic@example.test" }], addressWarning: null,
  } }));
  await page.route("**/api/accounts/synthetic/mailboxes", (route) => route.fulfill({ json: { mailboxes: [{ id: "INBOX", name: "INBOX", total: 1, unread: 0 }] } }));
  await page.route("**/api/accounts/synthetic/messages**", (route) => route.fulfill({ json: { envelopes: [{ ...envelope, flags: [{ iana: "seen", raw: "\\Seen" }] }] } }));
  await page.route("**/api/message?**", (route) => route.fulfill({ json: {
    ref: { account: "synthetic", mailbox: "INBOX", message: "1" }, envelope, text: "Hi", html: null,
    attachments: [
      { id: "1", filename: "pixel.gif", mime: "image/gif", size: 40, inline: false },
      { id: "2", filename: "notes.txt", mime: "text/plain", size: 20, inline: false },
      { id: "3", filename: "logo.svg", mime: "image/svg+xml", size: 20, inline: false },
      { id: "4", filename: "fake.pdf", mime: "text/html", size: 20, inline: false },
    ],
    sender: { replyTo: null, returnPath: null, messageIdDomain: null, auth: null, received: [], risk: { level: "none", reasons: [] }, trust: null },
  } }));
  await page.route("**/api/attachment?**", (route) => {
    const id = new URL(route.request().url()).searchParams.get("attachment");
    return id === "2"
      ? route.fulfill({ contentType: "text/plain", body: "Hello attachment text" })
      : route.fulfill({ contentType: "image/gif", body: GIF });
  });
  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));
  await page.goto("/");
  await page.getByRole("button", { name: /Synthetic attachments/ }).click();

  await expect(page.getByRole("button", { name: /^Vorschau:/ })).toHaveCount(2);
  await page.getByRole("button", { name: "Vorschau: pixel.gif" }).click();
  const dialog = page.getByRole("dialog", { name: "Vorschau: pixel.gif" });
  await expect(dialog.getByRole("img", { name: "pixel.gif" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Vorschau: notes.txt" }).click();
  await expect(page.getByRole("dialog").getByText("Hello attachment text")).toBeVisible();
  await page.getByRole("button", { name: "Vorschau schließen" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
