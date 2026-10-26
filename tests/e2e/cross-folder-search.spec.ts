import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

type Recorded = { searchBodies: any[]; listQueries: Array<Record<string, string>>; messageQueries: Array<Record<string, string>>; seenBodies: any[] };

const hit = {
  id: "9", date: "2026-09-18T10:00:00Z", flags: [], from: [{ name: "Bea", email: "bea@example.test" }], to: [],
  subject: "Treffer im Archiv", size: 12, hasAttachment: false, source: { account: "beta", mailbox: "Archive" },
};
const searchBtn = (page: Page) => page.getByRole("button", { name: "Suchen", exact: true });
const scopeSelect = (page: Page) => page.getByLabel("Suchbereich");

async function setup(page: Page, options: { view?: "account" | "unified"; listEnvelopes?: unknown[]; search?: { envelopes: unknown[]; hasMore: boolean } } = {}): Promise<Recorded> {
  const recorded: Recorded = { searchBodies: [], listQueries: [], messageQueries: [], seenBodies: [] };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/bootstrap") {
      await route.fulfill({ json: {
        accounts: ["alpha", "beta"].map((name) => ({ name, default: name === "alpha", backends: ["imap"], email: `${name}@example.test` })),
        addressWarning: null,
      } });
    } else if (url.pathname.endsWith("/mailboxes")) {
      await route.fulfill({ json: { mailboxes: [{ id: "INBOX", name: "INBOX", total: 0, unread: 0 }, { id: "Archive", name: "Archive", total: 0, unread: 0 }] } });
    } else if (url.pathname === "/api/search") {
      recorded.searchBodies.push(request.postDataJSON());
      await route.fulfill({ json: options.search
        ? { ...options.search, warnings: [] }
        : { envelopes: [hit], hasMore: false, warnings: [{ account: "beta", mailbox: "Work", code: "AUTH_REQUIRED", message: "Synthetische Warnung" }] } });
    } else if (url.pathname === "/api/unified/inbox") {
      await route.fulfill({ json: { envelopes: [], hasMore: false, warnings: [] } });
    } else if (url.pathname.endsWith("/messages")) {
      recorded.listQueries.push(Object.fromEntries(url.searchParams));
      await route.fulfill({ json: { envelopes: options.listEnvelopes ?? [] } });
    } else if (url.pathname === "/api/message") {
      recorded.messageQueries.push(Object.fromEntries(url.searchParams));
      await route.fulfill({ json: { ref: Object.fromEntries(url.searchParams), envelope: hit, text: "Synthetischer Inhalt", html: null, attachments: [] } });
    } else if (url.pathname === "/api/message/seen") {
      recorded.seenBodies.push(request.postDataJSON());
      await route.fulfill({ json: { ok: true } });
    } else {
      await route.abort();
      throw new Error(`Unexpected API request: ${url.pathname}`);
    }
  });
  await page.addInitScript((view) => localStorage.setItem("himalaya-web-last-view", view), options.view ?? "account");
  await page.goto("/");
  return recorded;
}

test("the all scope posts the account list to /api/search", async ({ page }) => {
  const recorded = await setup(page);
  await page.getByLabel("Nachrichten suchen").fill("invoice");
  await scopeSelect(page).selectOption("all");
  await searchBtn(page).click();

  await expect.poll(() => recorded.searchBodies.at(-1)).toMatchObject({ scope: "all", accounts: ["alpha", "beta"], q: "invoice" });
  expect(recorded.searchBodies.at(-1)).not.toHaveProperty("account");
});

test("the account scope posts the open account and folder", async ({ page }) => {
  const recorded = await setup(page);
  await page.getByLabel("Nachrichten suchen").fill("invoice");
  await scopeSelect(page).selectOption("account");
  await searchBtn(page).click();

  await expect.poll(() => recorded.searchBodies.at(-1)).toMatchObject({ scope: "account", account: "alpha", mailbox: "INBOX" });
});

test("the folder scope keeps using the single-folder list route", async ({ page }) => {
  const recorded = await setup(page);
  await page.getByLabel("Nachrichten suchen").fill("invoice");
  await searchBtn(page).click();

  await expect.poll(() => recorded.listQueries.at(-1)).toMatchObject({ mailbox: "INBOX", q: "invoice" });
  expect(recorded.searchBodies).toEqual([]);
});

test("a hit from another account opens, marks seen and shows warnings through its own source", async ({ page }) => {
  const recorded = await setup(page);
  await scopeSelect(page).selectOption("all");
  await searchBtn(page).click();

  await expect(page.getByText("beta/Work: Synthetische Warnung")).toBeVisible();
  await page.getByRole("button", { name: /Treffer im Archiv/ }).click();
  await expect.poll(() => recorded.messageQueries.at(-1)).toMatchObject({ account: "beta", mailbox: "Archive", message: "9" });

  // Opening already marks the hit as read; toggling it again must target the same source, not the open alpha folder.
  await expect.poll(() => recorded.seenBodies.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: /als (un)?gelesen markieren/i }).first().click();
  await expect.poll(() => recorded.seenBodies.length).toBeGreaterThan(1);
  for (const body of recorded.seenBodies) expect(body.ref).toEqual({ account: "beta", mailbox: "Archive", message: "9" });
});

test("choosing another folder returns to the folder scope", async ({ page }) => {
  await setup(page);
  await scopeSelect(page).selectOption("all");
  await searchBtn(page).click();
  await expect(scopeSelect(page)).toHaveValue("all");

  await page.locator('[data-account="alpha"]').click();
  await expect(scopeSelect(page)).toHaveValue("folder");
});

test("the unified view offers only the inbox and all-accounts scopes", async ({ page }) => {
  await setup(page, { view: "unified" });
  await expect(scopeSelect(page).locator("option")).toHaveText(["Alle Eingänge (Posteingänge)", "Alle Konten (alle Ordner)"]);
});

const openFilters = (page: Page) => page.getByText("Filter", { exact: true }).click();
const chips = (page: Page) => page.getByRole("group", { name: "Aktive Filter" });
const listed = (id: string, subject: string, hasAttachment: boolean) => ({
  id, date: "2026-09-18T10:00:00Z", flags: [], from: [{ name: "Ann", email: "ann@example.test" }], to: [], subject, size: 12, hasAttachment,
});

test("a filter-only search sends the filters and shows chips", async ({ page }) => {
  const recorded = await setup(page);
  await openFilters(page);
  await page.getByLabel("Datum (Sendedatum) von").fill("2026-09-01");
  await page.getByLabel("Datum (Sendedatum) bis").fill("2026-09-30");
  await page.getByLabel("Status").selectOption("unseen");
  await page.getByLabel("Sortierung").selectOption("asc");
  await searchBtn(page).click();

  await expect.poll(() => recorded.listQueries.at(-1)).toMatchObject({ q: "", from: "2026-09-01", until: "2026-09-30", flag: "unseen", order: "asc" });
  for (const label of ["Von 01.09.2026", "Bis 30.09.2026", "Ungelesen", "Älteste zuerst"]) {
    await expect(chips(page)).toContainText(label);
  }
});

test("removing a chip drops that filter from the next request", async ({ page }) => {
  const recorded = await setup(page);
  await openFilters(page);
  await page.getByLabel("Datum (Sendedatum) von").fill("2026-09-01");
  await page.getByLabel("Status").selectOption("flagged");
  await searchBtn(page).click();
  await expect.poll(() => recorded.listQueries.at(-1)).toMatchObject({ from: "2026-09-01", flag: "flagged" });

  await page.getByRole("button", { name: "Filter entfernen: Von 01.09.2026" }).click();

  await expect.poll(() => recorded.listQueries.at(-1)).toMatchObject({ flag: "flagged" });
  expect(recorded.listQueries.at(-1)).not.toHaveProperty("from");
  await expect(page.getByLabel("Datum (Sendedatum) von")).toHaveValue("");
});

test("removing the scope chip returns to the single-folder route", async ({ page }) => {
  const recorded = await setup(page);
  await scopeSelect(page).selectOption("all");
  await searchBtn(page).click();
  await expect.poll(() => recorded.searchBodies.length).toBe(1);

  await page.getByRole("button", { name: "Filter entfernen: Alle Konten" }).click();

  await expect(scopeSelect(page)).toHaveValue("folder");
  await expect.poll(() => recorded.listQueries.length).toBeGreaterThan(0);
});

test("the attachment filter hides envelopes without one and warns about short pages", async ({ page }) => {
  await setup(page, { listEnvelopes: [listed("1", "Mit Anhang", true), listed("2", "Ohne Anhang", false)] });
  await expect(page.getByRole("button", { name: /^Ann Ohne Anhang/ })).toBeVisible();
  await openFilters(page);
  await page.getByLabel("Nur mit Anhang").check();
  await searchBtn(page).click();

  await expect(page.getByRole("button", { name: /^Ann Mit Anhang/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Ann Ohne Anhang/ })).toHaveCount(0);
  await expect(page.getByText("Seite kann weniger Treffer enthalten")).toBeVisible();
});

test("junk inclusion is offered only for the cross-folder scopes", async ({ page }) => {
  const recorded = await setup(page);
  await openFilters(page);
  await expect(page.getByLabel("Papierkorb/Spam einschließen")).toHaveCount(0);
  await scopeSelect(page).selectOption("all");
  await page.getByLabel("Papierkorb/Spam einschließen").check();
  await searchBtn(page).click();

  await expect.poll(() => recorded.searchBodies.at(-1)).toMatchObject({ scope: "all", includeJunk: true });
});

test("a start date after the end date is rejected before any request", async ({ page }) => {
  const recorded = await setup(page);
  await expect.poll(() => recorded.listQueries.length).toBeGreaterThan(0);
  const before = recorded.listQueries.length;
  await openFilters(page);
  await page.getByLabel("Datum (Sendedatum) von").fill("2026-09-30");
  await page.getByLabel("Datum (Sendedatum) bis").fill("2026-09-01");
  await searchBtn(page).click();

  await expect(page.getByText("Das Startdatum liegt nach dem Enddatum.")).toBeVisible();
  expect(recorded.listQueries.length).toBe(before);
});

const many = (count: number, withAttachment: (index: number) => boolean = () => false) =>
  Array.from({ length: count }, (_, index) => ({ ...listed(String(index), `Nachricht ${index}`, withAttachment(index)), source: { account: "alpha", mailbox: "INBOX" } }));
const nextButton = (page: Page) => page.getByRole("button", { name: "›", exact: true });

test("the next page follows the search route's hasMore, not the page length", async ({ page }) => {
  const recorded = await setup(page, { search: { envelopes: many(1), hasMore: true } });
  await scopeSelect(page).selectOption("all");
  await searchBtn(page).click();
  await expect(page.getByRole("button", { name: /Nachricht 0/ })).toBeVisible();

  await expect(nextButton(page)).toBeEnabled();
  await nextButton(page).click();
  await expect.poll(() => recorded.searchBodies.at(-1)?.page).toBe(2);
});

test("a full page without more results leaves the next button disabled on the search route", async ({ page }) => {
  await setup(page, { search: { envelopes: many(50), hasMore: false } });
  await scopeSelect(page).selectOption("all");
  await searchBtn(page).click();
  await expect(page.getByRole("button", { name: /Nachricht 49/ })).toBeVisible();

  await expect(nextButton(page)).toBeDisabled();
});

test("the attachment filter on the folder route does not mistake a trimmed page for the last one", async ({ page }) => {
  await setup(page, { listEnvelopes: many(50, (index) => index % 2 === 0) });
  await openFilters(page);
  await page.getByLabel("Nur mit Anhang").check();
  await searchBtn(page).click();

  await expect(page.getByText("25 Nachrichten")).toBeVisible();
  await expect(nextButton(page)).toBeEnabled();
});
