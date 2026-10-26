import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const dryRule = {
  id: "Newsletter", account: "alpha", enabled: true, dryRun: true,
  condition: { field: "from", match: "contains", value: "news@x.test" }, actions: [{ type: "flag", flag: "seen", value: true }],
};
const liveRule = {
  id: "Rechnung", account: "beta", enabled: true, dryRun: false,
  condition: { field: "subject", match: "contains", value: "Rechnung" }, actions: [{ type: "move", mailbox: "Archive" }],
};

type Recorded = { putBodies: any[]; previewBodies: any[] };
type Options = { failSave?: boolean; preservedInvalid?: number; previewGate?: Promise<void>; unreadable?: boolean };

async function setup(page: Page, options: Options = {}): Promise<Recorded> {
  const recorded: Recorded = { putBodies: [], previewBodies: [] };
  let stored: any[] = [dryRule, liveRule];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/bootstrap") {
      await route.fulfill({ json: {
        accounts: ["alpha", "beta"].map((name) => ({ name, default: name === "alpha", backends: ["imap"], email: `${name}@example.test` })),
        addressWarning: null,
      } });
    } else if (url.pathname.endsWith("/mailboxes")) {
      await route.fulfill({ json: { mailboxes: ["INBOX", "Newsletter", "Archive"].map((id) => ({ id, name: id, total: 0, unread: 0 })) } });
    } else if (url.pathname.endsWith("/messages")) {
      await route.fulfill({ json: { envelopes: [] } });
    } else if (url.pathname === "/api/rules" && request.method() === "GET") {
      await route.fulfill({ json: { rules: stored, preservedInvalid: options.preservedInvalid ?? 1, unreadable: options.unreadable ?? false } });
    } else if (url.pathname === "/api/rules" && request.method() === "PUT") {
      recorded.putBodies.push(request.postDataJSON());
      if (options.failSave) {
        await route.fulfill({ status: 500, json: { error: "Synthetischer Speicherfehler", code: "INTERNAL_ERROR" } });
        return;
      }
      stored = request.postDataJSON().rules;
      await route.fulfill({ json: { ok: true, rules: stored, preservedInvalid: options.preservedInvalid ?? 1, unreadable: false } });
    } else if (url.pathname === "/api/rules/preview") {
      recorded.previewBodies.push(request.postDataJSON());
      await options.previewGate;
      await route.fulfill({ json: { checked: 50, matchCount: 3, samples: [{ subject: "Erste Mail", from: "news@x.test" }, { subject: "Zweite Mail", from: "news@x.test" }] } });
    } else {
      await route.abort();
      throw new Error(`Unexpected API request: ${url.pathname}`);
    }
  });
  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));
  await page.goto("/");
  await page.getByRole("button", { name: "Regeln", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Regeln" })).toBeVisible();
  return recorded;
}

const cards = (page: Page) => page.locator(".rule-card");
const card = (page: Page, index: number) => cards(page).nth(index);
const save = (page: Page) => page.getByRole("button", { name: "Speichern", exact: true });

test("shows the stored rules, what rules act on, and the preserved invalid entries", async ({ page }) => {
  await setup(page);

  await expect(cards(page)).toHaveCount(2);
  await expect(card(page, 0).getByLabel("Name")).toHaveValue("Newsletter");
  await expect(card(page, 0).getByLabel("Probelauf")).toBeChecked();
  await expect(card(page, 1).getByLabel("Probelauf")).not.toBeChecked();
  await expect(card(page, 1).getByLabel("In Ordner verschieben")).toHaveValue("Archive");
  await expect(page.getByText("Regeln wirken nur auf neu eintreffende Mails.")).toBeVisible();
  await expect(page.getByText("1 ungültiger Eintrag in rules.json bleibt unverändert.")).toBeVisible();
});

test("a new rule starts in dry-run and saves without a confirmation", async ({ page }) => {
  const recorded = await setup(page);
  page.on("dialog", () => { throw new Error("A dry-run rule must not ask for confirmation"); });
  await page.getByRole("button", { name: "Neue Regel" }).click();

  await expect(cards(page)).toHaveCount(3);
  await expect(card(page, 2).getByLabel("Probelauf")).toBeChecked();
  await card(page, 2).getByLabel("Suchtext").fill("shop@x.test");
  await card(page, 2).getByLabel("Als gelesen markieren").check();
  await save(page).click();

  await expect.poll(() => recorded.putBodies.length).toBe(1);
  expect(recorded.putBodies[0].rules).toHaveLength(3);
  expect(recorded.putBodies[0].rules[2]).toMatchObject({
    id: "Regel 1", account: "alpha", enabled: true, dryRun: true,
    condition: { field: "from", match: "contains", value: "shop@x.test" }, actions: [{ type: "flag", flag: "seen", value: true }],
  });
});

test("switching a rule live asks first, naming it; dismissing sends nothing, accepting saves", async ({ page }) => {
  const recorded = await setup(page);
  await card(page, 0).getByLabel("Probelauf").uncheck();

  const message = new Promise<string>((resolve) => page.once("dialog", (dialog) => { resolve(dialog.message()); void dialog.dismiss(); }));
  await save(page).click();
  expect(await message).toContain("Newsletter");
  await page.waitForTimeout(300);
  expect(recorded.putBodies).toEqual([]);

  page.once("dialog", (dialog) => void dialog.accept());
  await save(page).click();
  await expect.poll(() => recorded.putBodies.length).toBe(1);
  expect(recorded.putBodies[0].rules[0]).toMatchObject({ id: "Newsletter", dryRun: false });
});

test("previews a rule read-only and leaves the editor state alone", async ({ page }) => {
  const recorded = await setup(page);
  await card(page, 0).getByRole("button", { name: "Vorschau" }).click();

  await expect(card(page, 0).getByText("3 von 50 Mails passen: Erste Mail · Zweite Mail")).toBeVisible();
  expect(recorded.previewBodies).toHaveLength(1);
  expect(recorded.previewBodies[0].rule).toMatchObject({ id: "Newsletter", account: "alpha", dryRun: true });
  expect(recorded.putBodies).toEqual([]);
});

test("reorders and deletes rules, and saves the new order", async ({ page }) => {
  const recorded = await setup(page);
  await card(page, 0).getByRole("button", { name: "Nach unten" }).click();
  await expect(card(page, 0).getByLabel("Name")).toHaveValue("Rechnung");
  await save(page).click();
  await expect.poll(() => recorded.putBodies.length).toBe(1);
  expect(recorded.putBodies[0].rules.map((rule: { id: string }) => rule.id)).toEqual(["Rechnung", "Newsletter"]);

  await card(page, 1).getByRole("button", { name: "Löschen" }).click();
  await expect(cards(page)).toHaveCount(1);
  await save(page).click();
  await expect.poll(() => recorded.putBodies.length).toBe(2);
  expect(recorded.putBodies[1].rules.map((rule: { id: string }) => rule.id)).toEqual(["Rechnung"]);
});

test("shows validation problems and sends nothing", async ({ page }) => {
  const recorded = await setup(page);
  await card(page, 0).getByLabel("Suchtext").fill("   ");
  await save(page).click();

  await expect(page.getByRole("alert").filter({ hasText: "Regel „Newsletter“: Bitte einen Suchtext eingeben." })).toBeVisible();
  expect(recorded.putBodies).toEqual([]);
});

test("a failed save shows the error and keeps the dialog and the edits", async ({ page }) => {
  await setup(page, { failSave: true });
  await card(page, 0).getByLabel("Suchtext").fill("changed@x.test");
  await save(page).click();

  await expect(page.getByRole("alert").filter({ hasText: "Synthetischer Speicherfehler" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Regeln" })).toBeVisible();
  await expect(card(page, 0).getByLabel("Suchtext")).toHaveValue("changed@x.test");
});

test("editing a rule clears its shown preview", async ({ page }) => {
  await setup(page);
  await card(page, 0).getByRole("button", { name: "Vorschau" }).click();
  await expect(card(page, 0).getByText(/3 von 50 Mails passen/)).toBeVisible();

  await card(page, 0).getByLabel("Suchtext").fill("anderer@x.test");

  await expect(card(page, 0).getByText(/3 von 50 Mails passen/)).toHaveCount(0);
});

test("a preview answer that arrives after an edit is ignored", async ({ page }) => {
  let release!: () => void;
  const previewGate = new Promise<void>((resolve) => { release = resolve; });
  const recorded = await setup(page, { previewGate });
  await card(page, 0).getByRole("button", { name: "Vorschau" }).click();
  await expect.poll(() => recorded.previewBodies.length).toBe(1);

  await card(page, 0).getByLabel("Suchtext").fill("anderer@x.test");
  release();

  await page.waitForTimeout(300);
  await expect(card(page, 0).getByText(/3 von 50 Mails passen/)).toHaveCount(0);
});

test("the dialog takes focus, keeps it inside, closes with Escape and gives the focus back", async ({ page }) => {
  await setup(page);
  await expect(page.getByRole("button", { name: "Regeln schließen" })).toBeFocused();

  await save(page).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Regeln schließen" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(save(page)).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Regeln" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Regeln", exact: true })).toBeFocused();
});

test("warns when rules.json cannot be read and that a backup is made on save", async ({ page }) => {
  await setup(page, { unreadable: true });

  await expect(page.getByText("rules.json ist nicht lesbar. Beim Speichern wird zuerst eine Sicherungskopie davon angelegt.")).toBeVisible();
});
