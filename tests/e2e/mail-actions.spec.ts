import { expect, test } from "@playwright/test";

test("exports a selected message and calls AI only after an explicit action", async ({ page }) => {
  let aiCalls = 0;

  await page.route("**/api/bootstrap", async (route) => {
    await route.fulfill({
      json: {
        accounts: [{ name: "synthetic", default: true, backends: ["imap", "smtp"], email: "synthetic@example.test" }],
        addressWarning: null,
      },
    });
  });
  await page.route("**/api/accounts/synthetic/mailboxes", async (route) => {
    await route.fulfill({ json: { mailboxes: [{ id: "INBOX", name: "INBOX", total: 1, unread: 1 }] } });
  });
  await page.route("**/api/accounts/synthetic/messages**", async (route) => {
    await route.fulfill({
      json: {
        envelopes: [{
          id: "7",
          date: "2026-09-18T09:30:00Z",
          flags: [],
          from: [{ name: "Alice", email: "alice@example.test" }],
          to: [{ name: "Synthetic", email: "synthetic@example.test" }],
          subject: "Synthetic subject",
          size: 12,
          hasAttachment: false,
        }],
      },
    });
  });
  await page.route("**/api/message?**", async (route) => {
    await route.fulfill({
      json: {
        ref: { account: "synthetic", mailbox: "INBOX", message: "7" },
        envelope: {
          id: "7",
          date: "2026-09-18T09:30:00Z",
          flags: [],
          from: [{ name: "Alice", email: "alice@example.test" }],
          to: [{ name: "Synthetic", email: "synthetic@example.test" }],
          subject: "Synthetic subject",
          size: 12,
          hasAttachment: false,
        },
        text: "Synthetic browser body",
        html: null,
        attachments: [],
      },
    });
  });
  await page.route("**/api/message/seen", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/message/export?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/markdown; charset=utf-8",
      headers: { "content-disposition": "attachment; filename=synthetic.md" },
      body: "# Synthetic subject\n\nSynthetic browser body\n",
    });
  });
  await page.route("**/api/ai/assist", async (route) => {
    aiCalls += 1;
    await route.fulfill({ json: { task: "summarize", text: "Synthetic AI result", provider: "minimax", model: "MiniMax-M3", truncated: false } });
  });

  // A single-account fixture with no unified route wired up; start in the
  // account view instead of the fresh-session unified default.
  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Synthetic subject/ })).toBeVisible();
  await page.getByRole("button", { name: /Synthetic subject/ }).click();
  await expect(page.getByRole("heading", { name: "Synthetic subject" })).toBeVisible();
  expect(aiCalls).toBe(0);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Markdown herunterladen" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("message-7.md");

  await page.getByRole("button", { name: "Zusammenfassen" }).click();
  await expect(page.getByText("Synthetic AI result")).toBeVisible();
  expect(aiCalls).toBe(1);

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Als PDF drucken" }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveTitle("Synthetic subject");
});

test("opens a link inside an HTML message body in a new browser tab", async ({ page, context }) => {
  await page.route("**/api/bootstrap", async (route) => {
    await route.fulfill({
      json: {
        accounts: [{ name: "synthetic", default: true, backends: ["imap", "smtp"], email: "synthetic@example.test" }],
        addressWarning: null,
      },
    });
  });
  await page.route("**/api/accounts/synthetic/mailboxes", async (route) => {
    await route.fulfill({ json: { mailboxes: [{ id: "INBOX", name: "INBOX", total: 1, unread: 1 }] } });
  });
  await page.route("**/api/accounts/synthetic/messages**", async (route) => {
    await route.fulfill({
      json: {
        envelopes: [{
          id: "7",
          date: "2026-09-18T09:30:00Z",
          flags: [],
          from: [{ name: "Alice", email: "alice@example.test" }],
          to: [{ name: "Synthetic", email: "synthetic@example.test" }],
          subject: "HTML subject",
          size: 12,
          hasAttachment: false,
        }],
      },
    });
  });
  await page.route("**/api/message?**", async (route) => {
    await route.fulfill({
      json: {
        ref: { account: "synthetic", mailbox: "INBOX", message: "7" },
        envelope: {
          id: "7",
          date: "2026-09-18T09:30:00Z",
          flags: [],
          from: [{ name: "Alice", email: "alice@example.test" }],
          to: [{ name: "Synthetic", email: "synthetic@example.test" }],
          subject: "HTML subject",
          size: 12,
          hasAttachment: false,
        },
        text: "",
        html: '<p>Siehe <a href="https://example.test/synthetic-link">diesen Link</a>.</p>',
        attachments: [],
      },
    });
  });
  await page.route("**/api/message/seen", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });

  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));
  await page.goto("/");
  await page.getByRole("button", { name: /HTML subject/ }).click();
  await expect(page.getByRole("heading", { name: "HTML subject" })).toBeVisible();

  const bodyFrame = page.frameLocator('iframe[title="HTML-Mail"]');
  const link = bodyFrame.getByRole("link", { name: "diesen Link" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);

  // example.test is a reserved, unroutable TLD (RFC 2606); stub it so the
  // new tab actually loads instead of hitting a real DNS failure — the
  // point of this test is that the link opened a separate tab at the
  // right URL, not that a real page exists there.
  await context.route("https://example.test/synthetic-link", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/html", body: "<title>Synthetic target</title>" });
  });

  const popupPromise = context.waitForEvent("page");
  await link.click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  expect(popup.url()).toBe("https://example.test/synthetic-link");
});
