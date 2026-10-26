import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

test.use({ launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH ?? "/home/dnames/bin/chromium-ai" } });

const envelope = {
  id: "7", subject: "Original subject", date: "2026-09-20T09:00:00Z", flags: [],
  from: [{ name: "Alice", email: "alice@example.test" }], to: [{ name: "Me", email: "me@example.test" }],
  hasAttachment: false, size: 12,
};

async function setup(page: Page, onOutbox?: (route: Route) => Promise<void>) {
  const calls: string[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    calls.push(`${route.request().method()} ${url.pathname}`);
    if (url.pathname === "/api/bootstrap") {
      await route.fulfill({ json: { accounts: [{ name: "andre", default: true, backends: ["imap", "smtp"], email: "andre@example.test" }], addressWarning: null } });
    } else if (url.pathname.endsWith("/mailboxes")) {
      await route.fulfill({ json: { mailboxes: [{ id: "INBOX", name: "INBOX", total: 1, unread: 1 }] } });
    } else if (url.pathname.endsWith("/messages")) {
      await route.fulfill({ json: { envelopes: [envelope] } });
    } else if (url.pathname === "/api/message") {
      await route.fulfill({ json: { ref: { account: "andre", mailbox: "INBOX", message: "7" }, envelope, text: "Original body", html: null, attachments: [] } });
    } else if (url.pathname === "/api/message/seen") {
      await route.fulfill({ json: { ok: true } });
    } else if (url.pathname === "/api/compose/preview") {
      await route.fulfill({ json: { mime: "From: andre\r\n\r\nHi\r\n" } });
    } else if (url.pathname === "/api/compose/send") {
      if (onOutbox) await onOutbox(route);
      else await route.fulfill({ json: { jobId: "job-1", sendAt: Date.now() + 10_000 } });
    } else if (url.pathname.startsWith("/api/outbox/")) {
      if (route.request().method() === "DELETE") await route.fulfill({ json: { ok: true } });
      else await route.fulfill({ json: { id: "job-1", status: "sent", sendAt: Date.now() } });
    } else if (url.pathname === "/api/message/delete") {
      await route.fulfill({ json: { ok: true } });
    } else {
      await route.abort();
      throw new Error(`Unexpected API request: ${url.pathname}`);
    }
  });
  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));
  await page.goto("/");
  await page.getByRole("button", { name: /Original subject/ }).click();
  await expect(page.getByRole("heading", { name: "Original subject" })).toBeVisible();
  return calls;
}

test("reply prefills the recipient and subject from the source message", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Antworten", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Antworten" })).toBeVisible();
  await expect(page.getByLabel("An", { exact: true })).toHaveValue("alice@example.test");
  await expect(page.getByLabel("Betreff")).toHaveValue("Re: Original subject");
});

test("shows the confirmation dialog with the right summary before sending", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Antworten", exact: true }).click();
  await page.locator(".composer-body").fill("Danke!");
  await page.getByRole("button", { name: "Senden", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Nachricht senden?" })).toBeVisible();
  await expect(page.getByText("alice@example.test")).toBeVisible();
});

test("undo cancels the outbox job and no further send call is made", async ({ page }) => {
  let sendCalls = 0;
  await setup(page, async (route) => {
    sendCalls += 1;
    await route.fulfill({ json: { jobId: "job-1", sendAt: Date.now() + 10_000 } });
  });
  await page.getByRole("button", { name: "Antworten", exact: true }).click();
  await page.locator(".composer-body").fill("Danke!");
  await page.getByRole("button", { name: "Senden", exact: true }).click();
  await page.getByRole("button", { name: "Jetzt senden", exact: true }).click();
  await expect(page.locator(".send-undo-banner")).toBeVisible();
  await page.getByRole("button", { name: "Rückgängig", exact: true }).click();
  await expect(page.locator(".send-undo-banner")).toHaveCount(0);
  expect(sendCalls).toBe(1);
});

test("the undo banner survives closing the composer during the countdown", async ({ page }) => {
  await setup(page, async (route) => {
    await route.fulfill({ json: { jobId: "job-1", sendAt: Date.now() + 10_000 } });
  });
  await page.getByRole("button", { name: "Antworten", exact: true }).click();
  await page.locator(".composer-body").fill("Danke!");
  await page.getByRole("button", { name: "Senden", exact: true }).click();
  await page.getByRole("button", { name: "Jetzt senden", exact: true }).click();
  await expect(page.locator(".send-undo-banner")).toBeVisible();
  // The composer stays open while counting; reopening the dialog from it would
  // drop the pending job id and leave a second send with no undo.
  await expect(page.getByRole("button", { name: "Senden", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Editor schließen", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Antworten" })).toHaveCount(0);
  await expect(page.locator(".send-undo-banner")).toBeVisible();
  // A second compose cannot clobber the pending undo window.
  await expect(page.getByRole("button", { name: "Antworten", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Rückgängig", exact: true }).click();
  await expect(page.getByText("Senden zurückgenommen.")).toBeVisible();
});

test("a draft survives a reload", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Neue Nachricht", exact: true }).click();
  await page.getByLabel("An", { exact: true }).fill("someone@example.test");
  await page.locator(".composer-body").fill("Entwurf-Text");
  await page.waitForTimeout(700);
  await page.reload();
  await page.getByRole("button", { name: /Original subject/ }).click();
  await page.getByRole("button", { name: "Neue Nachricht", exact: true }).click();
  await expect(page.locator(".composer-body")).toHaveValue("Entwurf-Text");
});

test("a delete the server resolves to a trash move asks for no confirmation", async ({ page }) => {
  await setup(page);
  page.on("dialog", (dialog) => dialog.dismiss());
  let dialogSeen = false;
  page.once("dialog", () => { dialogSeen = true; });
  await page.getByRole("button", { name: "Löschen", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Wähle eine Nachricht" })).toBeVisible();
  expect(dialogSeen).toBe(false);
});

test("a delete the server reports as permanent is only repeated after the user confirms", async ({ page }) => {
  await setup(page);
  const confirmFlags: Array<boolean | undefined> = [];
  // Registered after setup's catch-all, so Playwright matches this route first.
  await page.route("**/api/message/delete", async (route) => {
    const body = route.request().postDataJSON() as { confirmPermanent?: boolean };
    confirmFlags.push(body.confirmPermanent);
    if (body.confirmPermanent) {
      await route.fulfill({ json: { ok: true, permanent: true } });
      return;
    }
    await route.fulfill({
      status: 409,
      json: { error: "Die Nachricht ist bereits im Papierkorb und würde endgültig gelöscht.", code: "CONFIRM_REQUIRED", retryable: false },
    });
  });
  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Löschen", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Wähle eine Nachricht" })).toBeVisible();
  expect(confirmFlags).toEqual([false, true]);
});

test("a rejected permanent-delete confirmation never repeats the request", async ({ page }) => {
  await setup(page);
  let deleteCalls = 0;
  await page.route("**/api/message/delete", async (route) => {
    deleteCalls += 1;
    await route.fulfill({
      status: 409,
      json: { error: "Die Nachricht ist bereits im Papierkorb und würde endgültig gelöscht.", code: "CONFIRM_REQUIRED", retryable: false },
    });
  });
  page.on("dialog", (dialog) => void dialog.dismiss());
  await page.getByRole("button", { name: "Löschen", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Original subject" })).toBeVisible();
  expect(deleteCalls).toBe(1);
});
