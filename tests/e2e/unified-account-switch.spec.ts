import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const unifiedButton = (page: Page) => page.locator(".account-tab").first();
const managerRow = (page: Page, account: string) =>
  page.locator(".account-manager-row").filter({ has: page.locator("strong", { hasText: new RegExp(`^${account}$`) }) });

async function setup(page: Page): Promise<string[][]> {
  const unifiedRequests: string[][] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/bootstrap") {
      await route.fulfill({ json: {
        accounts: ["alpha", "beta"].map((name) => ({ name, default: name === "alpha", backends: ["imap"], email: `${name}@example.test` })),
        addressWarning: null,
      } });
    } else if (url.pathname === "/api/unified/inbox") {
      unifiedRequests.push(route.request().postDataJSON().accounts);
      await route.fulfill({ json: { envelopes: [], hasMore: false, warnings: [] } });
    } else if (url.pathname.endsWith("/mailboxes")) {
      await route.fulfill({ json: { mailboxes: [{ id: "INBOX", name: "INBOX", total: 0, unread: 0 }] } });
    } else {
      await route.abort();
      throw new Error(`Unexpected API request: ${url.pathname}`);
    }
  });
  await page.goto("/");
  return unifiedRequests;
}

test("a per-account switch removes it from the unified inbox but not from the tree", async ({ page }) => {
  const requests = await setup(page);
  await expect(unifiedButton(page)).toContainText("2 Konten");
  await expect.poll(() => requests.at(-1)).toEqual(["alpha", "beta"]);

  await page.getByRole("button", { name: "Konten verwalten" }).first().click();
  await managerRow(page, "beta").getByLabel("In Alle Eingänge").uncheck();
  await expect(managerRow(page, "beta")).toContainText("Nicht in Alle Eingänge");
  await page.getByRole("button", { name: "Kontenverwaltung schließen" }).click();

  await expect.poll(() => requests.at(-1)).toEqual(["alpha"]);
  await expect(unifiedButton(page)).toContainText("1 Konto");
  await expect(page.locator('[data-account="beta"]')).toBeVisible();
});

test("with no account selected the unified inbox says so, links to the manager, and the choice survives a reload", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Konten verwalten" }).first().click();
  await managerRow(page, "alpha").getByLabel("In Alle Eingänge").uncheck();
  await managerRow(page, "beta").getByLabel("In Alle Eingänge").uncheck();
  await page.getByRole("button", { name: "Kontenverwaltung schließen" }).click();

  await expect(page.getByText("Kein Konto für Alle Eingänge ausgewählt")).toBeVisible();
  await expect(page.locator(".empty-state").getByRole("button", { name: "Konten verwalten" })).toBeVisible();

  await page.reload();
  await expect(page.getByText("Kein Konto für Alle Eingänge ausgewählt")).toBeVisible();
  await expect(unifiedButton(page)).toContainText("0 Konten");
});
