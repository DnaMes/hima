import { expect, test } from "@playwright/test";

const envelope = (id: string, subject: string) => ({
  id, date: "2026-09-18T09:30:00Z", flags: [], from: [{ name: "Alice", email: "alice@example.test" }],
  to: [{ name: "Synthetic", email: "synthetic@example.test" }], subject, size: 12, hasAttachment: false,
});

test("marks and deletes several selected messages in one go", async ({ page }) => {
  const seenCalls: string[] = [];
  const deleteBodies: Array<{ ref: { message: string }; confirmPermanent: boolean }> = [];
  const list = [envelope("1", "First synthetic"), envelope("2", "Second synthetic"), envelope("3", "Third synthetic")];
  await page.route("**/api/bootstrap", (route) => route.fulfill({ json: {
    accounts: [{ name: "synthetic", default: true, backends: ["imap", "smtp"], email: "synthetic@example.test" }], addressWarning: null,
  } }));
  await page.route("**/api/accounts/synthetic/mailboxes", (route) => route.fulfill({ json: { mailboxes: [{ id: "INBOX", name: "INBOX", total: 3, unread: 3 }] } }));
  await page.route("**/api/accounts/synthetic/messages**", (route) => route.fulfill({ json: { envelopes: list } }));
  await page.route("**/api/message/seen", async (route) => {
    seenCalls.push(JSON.stringify(route.request().postDataJSON()));
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/message/delete", async (route) => {
    const body = route.request().postDataJSON() as (typeof deleteBodies)[number];
    deleteBodies.push(body);
    await route.fulfill(body.ref.message === "3" ? { status: 409, json: { error: "permanent" } } : { json: { ok: true } });
  });
  page.on("dialog", (dialog) => void dialog.accept());
  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));
  await page.goto("/");
  await expect(page.locator(".envelope-row")).toHaveCount(3);

  await page.getByRole("button", { name: "Auswählen", exact: true }).click();
  await page.getByRole("button", { name: /First synthetic/ }).click();
  await page.getByRole("button", { name: /Second synthetic/ }).click();
  await expect(page.getByText("2 ausgewählt")).toBeVisible();
  // Selecting never opens a message.
  await expect(page.getByRole("heading", { name: "First synthetic" })).toHaveCount(0);

  await page.getByRole("button", { name: "Gelesen", exact: true }).click();
  await expect(page.getByText("2 Nachricht(en) als gelesen markiert.")).toBeVisible();
  expect(seenCalls).toHaveLength(2);

  await page.getByRole("button", { name: "Alle auf dieser Seite" }).click();
  await page.getByRole("button", { name: "Löschen", exact: true }).click();
  await expect(page.getByText("2 Nachricht(en) gelöscht, 1 im Papierkorb übersprungen.")).toBeVisible();
  expect(deleteBodies.map((body) => body.confirmPermanent)).toEqual([false, false, false]);
});

test("moves the selected messages to another folder after a confirmation", async ({ page }) => {
  const moves: Array<{ ref: { message: string }; destination: string }> = [];
  const list = [envelope("1", "First synthetic"), envelope("2", "Second synthetic")];
  await page.route("**/api/bootstrap", (route) => route.fulfill({ json: {
    accounts: [{ name: "synthetic", default: true, backends: ["imap", "smtp"], email: "synthetic@example.test" }], addressWarning: null,
  } }));
  await page.route("**/api/accounts/synthetic/mailboxes", (route) => route.fulfill({ json: { mailboxes: [
    { id: "INBOX", name: "INBOX", total: 2, unread: 2 }, { id: "Archive", name: "Archive", total: 0, unread: 0 },
  ] } }));
  await page.route("**/api/accounts/synthetic/messages**", (route) => route.fulfill({ json: { envelopes: list } }));
  await page.route("**/api/message/move", async (route) => {
    moves.push(route.request().postDataJSON() as (typeof moves)[number]);
    await route.fulfill({ json: { ok: true } });
  });
  page.on("dialog", (dialog) => void dialog.accept());
  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));
  await page.goto("/");
  await page.getByRole("button", { name: "Auswählen", exact: true }).click();
  await page.getByRole("button", { name: /First synthetic/ }).click();
  await page.getByRole("button", { name: /Second synthetic/ }).click();
  await page.getByLabel("Ausgewählte verschieben nach").selectOption("Archive");
  await expect(page.getByText("2 Nachricht(en) verschoben.")).toBeVisible();
  expect(moves.map((move) => [move.ref.message, move.destination])).toEqual([["1", "Archive"], ["2", "Archive"]]);
});

test("removed rows disappear at once, before the reload finishes", async ({ page }) => {
  let deleted = false;
  const list = [envelope("1", "First synthetic"), envelope("2", "Second synthetic")];
  await page.route("**/api/bootstrap", (route) => route.fulfill({ json: {
    accounts: [{ name: "synthetic", default: true, backends: ["imap", "smtp"], email: "synthetic@example.test" }], addressWarning: null,
  } }));
  await page.route("**/api/accounts/synthetic/mailboxes", (route) => route.fulfill({ json: { mailboxes: [{ id: "INBOX", name: "INBOX", total: 2, unread: 2 }] } }));
  await page.route("**/api/accounts/synthetic/messages**", async (route) => {
    // The reload after the delete is slow, so only the local removal can explain a quick change.
    if (deleted) await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.fulfill({ json: { envelopes: deleted ? [list[1]] : list } });
  });
  await page.route("**/api/message/delete", async (route) => { deleted = true; await route.fulfill({ json: { ok: true } }); });
  page.on("dialog", (dialog) => void dialog.accept());
  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));
  await page.goto("/");
  await expect(page.locator(".envelope-row")).toHaveCount(2);
  await page.getByRole("button", { name: "Auswählen", exact: true }).click();
  await page.getByRole("button", { name: /First synthetic/ }).click();
  await page.locator(".bulk-bar").getByRole("button", { name: "Löschen", exact: true }).click();
  await expect(page.getByText("1 Nachricht(en) gelöscht.")).toBeVisible();
  await expect(page.locator(".envelope-row")).toHaveCount(1, { timeout: 1500 });
  await expect(page.getByRole("button", { name: /First synthetic/ })).toHaveCount(0);
});

for (const action of ["bulk move", "single delete"] as const) {
  test(`${action} drops the row at once while the reload is still pending`, async ({ page }) => {
    let changed = false;
    const calls: string[] = [];
    const list = [envelope("1", "First synthetic"), envelope("2", "Second synthetic")];
    await page.route("**/api/bootstrap", (route) => route.fulfill({ json: {
      accounts: [{ name: "synthetic", default: true, backends: ["imap", "smtp"], email: "synthetic@example.test" }], addressWarning: null,
    } }));
    await page.route("**/api/accounts/synthetic/mailboxes", (route) => route.fulfill({ json: { mailboxes: [
      { id: "INBOX", name: "INBOX", total: 2, unread: 2 }, { id: "Archive", name: "Archive", total: 0, unread: 0 },
    ] } }));
    await page.route("**/api/accounts/synthetic/messages**", async (route) => {
      if (changed) await new Promise((resolve) => setTimeout(resolve, 5000));
      await route.fulfill({ json: { envelopes: changed ? [list[1]] : list } });
    });
    await page.route("**/api/message?**", (route) => route.fulfill({ json: {
      ref: { account: "synthetic", mailbox: "INBOX", message: "1" }, envelope: list[0], text: "Body", html: null, attachments: [],
      sender: { replyTo: null, returnPath: null, messageIdDomain: null, auth: null, received: [], risk: { level: "none", reasons: [] }, trust: null },
    } }));
    await page.route("**/api/message/seen", (route) => route.fulfill({ json: { ok: true } }));
    await page.route(/\/api\/message\/(move|delete)$/, async (route) => {
      calls.push(new URL(route.request().url()).pathname);
      changed = true;
      await route.fulfill({ json: { ok: true } });
    });
    page.on("dialog", (dialog) => {
      // Only the expected confirmations are accepted: a bulk move asks about the move, a single delete asks nothing.
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toMatch(/verschieben\?$/);
      void dialog.accept();
    });
    await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));
    await page.goto("/");
    await expect(page.locator(".envelope-row")).toHaveCount(2);

    if (action === "bulk move") {
      await page.getByRole("button", { name: "Auswählen", exact: true }).click();
      await page.getByRole("button", { name: /First synthetic/ }).click();
      await page.getByLabel("Ausgewählte verschieben nach").selectOption("Archive");
      await expect(page.getByText("1 Nachricht(en) verschoben.")).toBeVisible();
    } else {
      await page.getByRole("button", { name: /First synthetic/ }).click();
      await page.getByRole("heading", { name: "First synthetic" }).waitFor();
      await page.locator(".reader-panel").getByRole("button", { name: "Löschen", exact: true }).click();
      await expect(page.getByText("Nachricht gelöscht.")).toBeVisible();
    }
    await expect(page.locator(".envelope-row")).toHaveCount(1, { timeout: 2500 });
    await expect(page.getByRole("button", { name: /First synthetic/ })).toHaveCount(0);
    expect(calls).toEqual([action === "bulk move" ? "/api/message/move" : "/api/message/delete"]);
    // The held-back reload must not outlive the test.
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });
}
