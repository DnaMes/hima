import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Envelope, UnifiedInboxResult } from "../../src/shared/types.js";

test.use({ launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH ?? "/home/dnames/bin/chromium-ai" } });

const COLORS_KEY = "himalaya-web-account-colors-v1";
const DENSITY_KEY = "himalaya-web-list-density-v1";
const AMBER = "rgb(234, 204, 144)";
const SKY = "rgb(144, 196, 234)";

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

function envelope(id: string, subject: string, overrides: Partial<Envelope> = {}): Envelope {
  return {
    id,
    subject,
    date: daysAgo(0),
    flags: [],
    from: [{ email: "sender@example.test", name: "Sender" }],
    to: [{ email: "me@example.test", name: null }],
    hasAttachment: false,
    size: 2048,
    ...overrides,
  };
}

const NORMAL_LIST: Envelope[] = [
  envelope("1", "Synthetic today unread", { hasAttachment: true }),
  envelope("2", "Synthetic today flagged", { flags: [{ iana: "seen", raw: "\\Seen" }, { iana: "flagged", raw: "\\Flagged" }] }),
  envelope("3", "Synthetic yesterday answered", { date: daysAgo(1), flags: [{ iana: "seen", raw: "\\Seen" }, { iana: "answered", raw: "\\Answered" }] }),
  envelope("4", "Synthetic last week", { date: daysAgo(9), flags: [{ iana: "seen", raw: "\\Seen" }] }),
  envelope("5", "Synthetic undated", { date: null, flags: [{ iana: "seen", raw: "\\Seen" }] }),
];

const UNIFIED: UnifiedInboxResult = {
  envelopes: [
    envelope("u1", "Synthetic unified alpha", { source: { account: "alpha", mailbox: "INBOX" } }),
    envelope("u2", "Synthetic unified beta", { source: { account: "beta", mailbox: "Inbox" } }),
  ],
  hasMore: false,
  warnings: [{ account: "broken", code: "AUTH_REQUIRED", message: "Bitte prüfe die Anmeldung dieses Kontos." }],
};

type Seed = { colors?: unknown; blockNewKeys?: boolean };

async function setup(page: Page, seed: Seed = {}): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/bootstrap") {
      await route.fulfill({ json: {
        accounts: ["alpha", "beta", "broken"].map((name) => ({ name, default: name === "alpha", backends: ["imap"], email: `${name}@example.test` })),
        addressWarning: null,
      } });
    } else if (url.pathname === "/api/unified/inbox") await route.fulfill({ json: UNIFIED });
    else if (url.pathname.endsWith("/mailboxes")) {
      const account = url.pathname.split("/")[3];
      await route.fulfill({ json: { mailboxes: [{ id: account === "beta" ? "Inbox" : "INBOX", name: "INBOX", total: 5, unread: 1 }] } });
    } else if (url.pathname.endsWith("/messages")) await route.fulfill({ json: { envelopes: NORMAL_LIST } });
    else { await route.abort(); throw new Error(`Unexpected API request: ${url.pathname}`); }
  });

  await page.addInitScript(({ colors, blockNewKeys, colorsKey, densityKey }) => {
    // Seed once per tab so a reload keeps whatever the UI stored afterwards.
    if (colors !== undefined && !sessionStorage.getItem("seeded")) {
      localStorage.setItem(colorsKey, JSON.stringify(colors));
      sessionStorage.setItem("seeded", "1");
    }
    if (blockNewKeys) {
      const guarded = new Set([colorsKey, densityKey]);
      const originalGet = Storage.prototype.getItem;
      const originalSet = Storage.prototype.setItem;
      Storage.prototype.getItem = function (key: string) {
        if (guarded.has(key)) throw new Error("blocked");
        return originalGet.call(this, key);
      };
      Storage.prototype.setItem = function (key: string, value: string) {
        if (guarded.has(key)) throw new Error("blocked");
        return originalSet.call(this, key, value);
      };
    }
  }, { colors: seed.colors, blockNewKeys: seed.blockNewKeys ?? false, colorsKey: COLORS_KEY, densityKey: DENSITY_KEY });
  // These tests assert on the alpha/INBOX message list, not the fresh-session
  // unified default.
  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));

  await page.goto("/");
  await expect(page.getByRole("button", { name: /Synthetic today unread/ })).toBeVisible();
}

const row = (page: Page, text: RegExp) => page.getByRole("button", { name: text });

test("groups the list by date and shows real-flag badges", async ({ page }) => {
  await setup(page);

  await expect(page.locator(".group-header")).toHaveText(["Heute", "Gestern", "Letzte Woche", "Ohne Datum"]);
  await expect(page.locator(".envelope-row")).toHaveCount(5);
  await expect(row(page, /Synthetic today unread/).locator(".badge")).toHaveCount(2);
  await expect(row(page, /Synthetic today unread/).locator(".badge-new")).toHaveAttribute("title", "Neu");
  await expect(row(page, /Synthetic today flagged/).locator(".badge-flagged")).toHaveAttribute("title", "Markiert");
  await expect(row(page, /Synthetic yesterday answered/).locator(".badge-answered")).toHaveAttribute("title", "Beantwortet");
  await expect(row(page, /Synthetic last week/).locator(".badge")).toHaveCount(0);
});

test("switches density and remembers it after a reload", async ({ page }) => {
  await setup(page);
  const compact = page.getByRole("button", { name: "Kompakt", exact: true });
  const comfortable = page.getByRole("button", { name: "Komfortabel", exact: true });

  await expect(compact).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".envelope-detail")).toHaveCount(0);
  await comfortable.click();
  await expect(comfortable).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".envelope-detail")).toHaveCount(5);
  await expect(page.locator(".badge-text").first()).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Komfortabel", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".envelope-detail")).toHaveCount(5);
  await page.getByRole("button", { name: "Kompakt", exact: true }).click();
  await expect(page.locator(".envelope-detail")).toHaveCount(0);
});

test("overrides an account colour, keeps it after a reload, and restores Auto", async ({ page }) => {
  await setup(page, { colors: { manual: { alpha: 2 }, auto: { beta: 4, broken: 6 } } });
  const dot = page.locator(".envelope-row .account-dot").first();

  await expect(dot).toHaveCSS("background-color", AMBER);

  await page.getByRole("button", { name: "Konten verwalten", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Bernstein: alpha", exact: true })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "Himmelblau: alpha", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Himmelblau: alpha", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("button", { name: "Automatische Farbe: alpha", exact: true })).toHaveAttribute("aria-pressed", "false");
  await dialog.getByRole("button", { name: "Kontenverwaltung schließen", exact: true }).click();
  await expect(dot).toHaveCSS("background-color", SKY);

  await page.reload();
  await expect(page.locator(".envelope-row .account-dot").first()).toHaveCSS("background-color", SKY);

  await page.getByRole("button", { name: "Konten verwalten", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Automatische Farbe: alpha", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Automatische Farbe: alpha", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("still renders when the two new storage keys are blocked", async ({ page }) => {
  await setup(page, { blockNewKeys: true });

  await expect(page.locator(".envelope-row")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Kompakt", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Komfortabel", exact: true }).click();
  await expect(page.locator(".envelope-detail")).toHaveCount(5);
});

test("shows the source chip, the account dot colour, and a warning badge in the unified inbox", async ({ page }) => {
  await setup(page, { colors: { manual: { alpha: 2, beta: 4 }, auto: { broken: 6 } } });
  await page.locator(".account-tab").first().click();

  await expect(page.getByText("alpha · INBOX", { exact: true })).toBeVisible();
  await expect(page.getByText("beta · Inbox", { exact: true })).toBeVisible();
  await expect(row(page, /Synthetic unified alpha/).locator(".account-dot")).toHaveCSS("background-color", AMBER);
  await expect(row(page, /Synthetic unified beta/).locator(".account-dot")).toHaveCSS("background-color", SKY);
  await expect(page.locator('[data-account="broken"]').getByRole("img", { name: "Warnung beim letzten Laden" })).toBeVisible();
  await expect(page.locator('[data-account="alpha"]').getByRole("img", { name: "Warnung beim letzten Laden" })).toHaveCount(0);
});
