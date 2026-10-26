import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const KEY = "himalaya-web-saved-searches-v1";
type Recorded = { searchBodies: any[]; listQueries: Array<Record<string, string>> };

async function setup(page: Page, options: { view?: "account" | "unified"; seed?: unknown[] } = {}): Promise<Recorded> {
  const recorded: Recorded = { searchBodies: [], listQueries: [] };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/bootstrap") {
      await route.fulfill({ json: {
        accounts: ["alpha", "beta"].map((name) => ({ name, default: name === "alpha", backends: ["imap"], email: `${name}@example.test` })),
        addressWarning: null,
      } });
    } else if (url.pathname.endsWith("/mailboxes")) {
      await route.fulfill({ json: { mailboxes: [{ id: "INBOX", name: "INBOX", total: 0, unread: 0 }] } });
    } else if (url.pathname === "/api/unified/inbox") {
      await route.fulfill({ json: { envelopes: [], hasMore: false, warnings: [] } });
    } else if (url.pathname === "/api/search") {
      recorded.searchBodies.push(request.postDataJSON());
      await route.fulfill({ json: { envelopes: [], hasMore: false, warnings: [] } });
    } else if (url.pathname.endsWith("/messages")) {
      recorded.listQueries.push(Object.fromEntries(url.searchParams));
      await route.fulfill({ json: { envelopes: [] } });
    } else {
      await route.abort();
      throw new Error(`Unexpected API request: ${url.pathname}`);
    }
  });
  await page.addInitScript(([view, seed, key]) => {
    localStorage.setItem("himalaya-web-last-view", view as string);
    if (seed) localStorage.setItem(key as string, JSON.stringify(seed));
  }, [options.view ?? "account", options.seed ?? null, KEY]);
  await page.goto("/");
  await expect(page.getByLabel("Nachrichten suchen")).toBeVisible();
  return recorded;
}

const picker = (page: Page) => page.getByLabel("Gespeicherte Suchen");
const stored = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), KEY);

async function runSearch(page: Page): Promise<void> {
  await page.getByLabel("Nachrichten suchen").fill("rechnung");
  await page.getByLabel("Suchfeld").selectOption("subject");
  await page.getByLabel("Suchbereich").selectOption("all");
  await page.getByText("Filter", { exact: true }).click();
  await page.getByLabel("Datum (Sendedatum) von").fill("2026-01-01");
  await page.getByRole("button", { name: "Suchen", exact: true }).click();
}

async function save(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Suche speichern" }).click();
  await page.getByLabel("Name der Suche").fill(name);
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
}

test("saves a search, keeps it across a reload and applies it with its scope and filters", async ({ page }) => {
  const recorded = await setup(page);
  await runSearch(page);
  await expect.poll(() => recorded.searchBodies.length).toBe(1);
  await save(page, "Rechnungen");
  await expect(page.getByText("Suche gespeichert.")).toBeVisible();

  await page.reload();
  await expect(picker(page)).toBeVisible();
  // Accounts arriving after the pick would re-run the search once more; wait until they are in.
  await expect(page.locator(".account-tab[data-account]").first()).toBeVisible();
  await picker(page).selectOption({ label: "Rechnungen" });

  await expect.poll(() => recorded.searchBodies.length).toBe(2);
  expect(recorded.searchBodies[1]).toMatchObject({ scope: "all", field: "subject", q: "rechnung", from: "2026-01-01", page: 1 });
  await expect(page.getByLabel("Nachrichten suchen")).toHaveValue("rechnung");
  await expect(page.getByLabel("Suchbereich")).toHaveValue("all");
});

test("saving under the same name in another case replaces the entry", async ({ page }) => {
  const recorded = await setup(page);
  await runSearch(page);
  await expect.poll(() => recorded.searchBodies.length).toBe(1);
  await save(page, "Rechnungen");
  await save(page, "RECHNUNGEN");

  expect(await stored(page)).toHaveLength(1);
  expect((await stored(page))[0].name).toBe("RECHNUNGEN");
  await expect(picker(page).locator("option")).toHaveCount(2);
});

test("an empty search cannot be saved", async ({ page }) => {
  await setup(page);
  await save(page, "Nichts");

  await expect(page.getByText("Es gibt nichts zu speichern: Suchtext oder Filter fehlen.")).toBeVisible();
  expect(await stored(page)).toBeNull();
});

test("deletes the chosen saved search", async ({ page }) => {
  const recorded = await setup(page);
  await runSearch(page);
  await expect.poll(() => recorded.searchBodies.length).toBe(1);
  await save(page, "Weg damit");
  await picker(page).selectOption({ label: "Weg damit" });
  await page.getByRole("button", { name: "Löschen" }).click();

  await expect(page.getByText("Gespeicherte Suche gelöscht.")).toBeVisible();
  expect(await stored(page)).toEqual([]);
  await expect(picker(page).locator("option")).toHaveCount(1);
});

test("stores only search terms and filters", async ({ page }) => {
  const recorded = await setup(page);
  await runSearch(page);
  await expect.poll(() => recorded.searchBodies.length).toBe(1);
  await save(page, "Nur Suchbegriffe");

  const [entry] = await stored(page);
  expect(Object.keys(entry).sort()).toEqual(["field", "filters", "id", "name", "text", "unread"]);
});

test("a saved 'Dieses Konto' search applied from the unified view runs over all accounts", async ({ page }) => {
  const filters = { scope: "account", includeJunk: false, from: "", until: "", flag: "", order: "desc", hasAttachment: false };
  const recorded = await setup(page, {
    view: "unified",
    seed: [{ id: "one", name: "Konto-Suche", text: "rechnung", field: "all", unread: false, filters }],
  });
  await picker(page).selectOption({ label: "Konto-Suche" });

  await expect.poll(() => recorded.searchBodies.length).toBe(1);
  expect(recorded.searchBodies[0]).toMatchObject({ scope: "all", q: "rechnung", page: 1 });
  expect(recorded.searchBodies[0]).not.toHaveProperty("account");
  await expect(page.getByLabel("Suchbereich")).toHaveValue("all");
});

test("a saved 'Dieses Konto' search keeps its scope from an account view", async ({ page }) => {
  const filters = { scope: "account", includeJunk: false, from: "", until: "", flag: "", order: "desc", hasAttachment: false };
  const recorded = await setup(page, {
    seed: [{ id: "one", name: "Konto-Suche", text: "rechnung", field: "all", unread: false, filters }],
  });
  await picker(page).selectOption({ label: "Konto-Suche" });

  await expect.poll(() => recorded.searchBodies.length).toBe(1);
  expect(recorded.searchBodies[0]).toMatchObject({ scope: "account", account: "alpha", mailbox: "INBOX" });
});
