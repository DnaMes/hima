import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const SENDER = "anna@evil.example";
const envelope = (id: string, date: string, subject: string, source?: { account: string; mailbox: string }) => ({
  id, date, flags: [], from: [{ name: "Anna", email: SENDER }], to: [{ name: "Synthetic", email: "synthetic@example.test" }],
  subject, size: 12, hasAttachment: false, ...(source ? { source } : {}),
});
const current = envelope("7", "2026-10-02T05:20:00Z", "Aktuelle Mail");
const self = envelope("7", "2026-10-02T05:20:00Z", "Aktuelle Mail", { account: "alpha", mailbox: "INBOX" });
const older = envelope("3", "2025-03-12T10:00:00Z", "Frühere Mail", { account: "beta", mailbox: "Archive" });

type Recorded = { searchBodies: any[] };

async function setup(page: Page, responses: Array<{ status?: number; json: unknown }>): Promise<Recorded> {
  const recorded: Recorded = { searchBodies: [] };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/bootstrap") {
      await route.fulfill({ json: {
        accounts: ["alpha", "beta"].map((name) => ({ name, default: name === "alpha", backends: ["imap"], email: `${name}@example.test` })),
        addressWarning: null,
      } });
    } else if (url.pathname.endsWith("/mailboxes")) {
      await route.fulfill({ json: { mailboxes: [{ id: "INBOX", name: "INBOX", total: 1, unread: 0 }, { id: "Archive", name: "Archive", total: 0, unread: 0 }] } });
    } else if (url.pathname.endsWith("/messages")) {
      await route.fulfill({ json: { envelopes: [current] } });
    } else if (url.pathname === "/api/message") {
      await route.fulfill({ json: {
        ref: Object.fromEntries(url.searchParams), envelope: current, text: "Inhalt", html: null, attachments: [],
        sender: { replyTo: null, returnPath: SENDER, messageIdDomain: "evil.example", auth: null, received: [], risk: { level: "none", score: 0, reasons: [] } },
      } });
    } else if (url.pathname === "/api/message/seen") {
      await route.fulfill({ json: { ok: true } });
    } else if (url.pathname === "/api/search") {
      recorded.searchBodies.push(request.postDataJSON());
      const response = responses[Math.min(recorded.searchBodies.length - 1, responses.length - 1)]!;
      await route.fulfill({ status: response.status ?? 200, json: response.json });
    } else {
      await route.abort();
      throw new Error(`Unexpected API request: ${url.pathname}`);
    }
  });
  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));
  await page.goto("/");
  await page.getByRole("button", { name: /Aktuelle Mail/ }).click();
  await expect(page.getByRole("heading", { name: "Aktuelle Mail" })).toBeVisible();
  await page.getByText("Absenderdetails").click();
  return recorded;
}

const ok = (envelopes: unknown[], extra: Record<string, unknown> = {}) => ({ json: { envelopes, hasMore: false, warnings: [], ...extra } });
const checkButton = (page: Page) => page.getByRole("button", { name: "Verlauf prüfen" });

test("searches only on request and calls a lone own mail a first contact", async ({ page }) => {
  const recorded = await setup(page, [ok([self])]);
  expect(recorded.searchBodies).toEqual([]);

  await checkButton(page).click();

  await expect(page.getByText("Erstkontakt: keine früheren Mails dieses Absenders gefunden.")).toBeVisible();
  expect(recorded.searchBodies).toHaveLength(1);
  expect(recorded.searchBodies[0]).toMatchObject({ scope: "all", accounts: ["alpha", "beta"], field: "from", q: SENDER, order: "asc", pageSize: 50, page: 1 });
});

test("recognizes a known sender with the earliest hit and its place", async ({ page }) => {
  await setup(page, [ok([older, self])]);
  await checkButton(page).click();

  await expect(page.getByText("Bekannter Absender: 1 frühere Mail in den durchsuchten Ordnern.")).toBeVisible();
  await expect(page.getByText("Frühester Treffer: 12.03.2025 · beta / Archive")).toBeVisible();
  await expect(page.getByText("Durchsucht wurden höchstens 30 Ordner (INBOX zuerst).")).toBeVisible();
});

test("shows search warnings as missing coverage", async ({ page }) => {
  await setup(page, [ok([self], { warnings: [{ account: "beta", code: "SOURCE_CAP", message: "2 Ordner nicht durchsucht (Obergrenze 30)." }] })]);
  await checkButton(page).click();

  await expect(page.getByText("Nicht durchsucht: beta: 2 Ordner nicht durchsucht (Obergrenze 30).")).toBeVisible();
});

test("reports a failed search and allows another try", async ({ page }) => {
  await setup(page, [{ status: 502, json: { error: "Synthetischer Fehler", code: "PROVIDER_ERROR" } }, ok([self])]);
  await checkButton(page).click();

  await expect(page.getByRole("alert").filter({ hasText: "Synthetischer Fehler" })).toBeVisible();
  await page.getByRole("button", { name: "Erneut prüfen" }).click();
  await expect(page.getByText("Erstkontakt: keine früheren Mails dieses Absenders gefunden.")).toBeVisible();
});

test("shows every mail of the sender through the normal search", async ({ page }) => {
  const recorded = await setup(page, [ok([older, self]), ok([self, older])]);
  await checkButton(page).click();
  await page.getByRole("button", { name: "Alle Mails dieses Absenders anzeigen" }).click();

  await expect(page.getByRole("heading", { name: "Suchergebnisse" })).toBeVisible();
  await expect(page.getByLabel("Suchbereich")).toHaveValue("all");
  await expect(page.getByLabel("Nachrichten suchen")).toHaveValue(SENDER);
  await expect(page.getByRole("button", { name: /Frühere Mail/ })).toBeVisible();
  expect(recorded.searchBodies[1]).toMatchObject({ scope: "all", field: "from", q: SENDER, page: 1 });
  expect(recorded.searchBodies[1]).not.toHaveProperty("order");
});
