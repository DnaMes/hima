import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

test.use({ launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH ?? "/home/dnames/bin/chromium-ai" } });

const ORDER_KEY = "himalaya-web-account-order-v1";
const syntheticAccounts = ["alpha", "beta", "gamma", "hidden"].map((name) => ({
  name, default: name === "alpha", backends: ["imap"], email: `${name}@example.test`,
}));

async function mockAccounts(page: Page): Promise<string[]> {
  const requests: string[] = [];
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    requests.push(`${route.request().method()} ${pathname}`);
    if (pathname === "/api/bootstrap") {
      await route.fulfill({ json: { accounts: syntheticAccounts, addressWarning: null } });
    } else if (/^\/api\/accounts\/(alpha|beta|gamma|hidden)\/mailboxes$/.test(pathname)) {
      await route.fulfill({ json: { mailboxes: [{ id: "INBOX", name: "INBOX", total: 0, unread: 0 }] } });
    } else if (/^\/api\/accounts\/(alpha|beta|gamma|hidden)\/messages$/.test(pathname)) {
      await route.fulfill({ json: { envelopes: [] } });
    } else {
      await route.abort();
      throw new Error(`Unexpected API request: ${pathname}`);
    }
  });
  return requests;
}

test("reorders accounts locally with keyboard focus, boundaries, favorites, and reload persistence", async ({ page }) => {
  const requests = await mockAccounts(page);
  await page.addInitScript(() => {
    if (sessionStorage.getItem("order-test-seeded")) return;
    sessionStorage.setItem("order-test-seeded", "true");
    localStorage.setItem("himalaya-web-account-order-v1", JSON.stringify(["gamma", "hidden", "beta", "alpha", "gamma", "removed"]));
    localStorage.setItem("himalaya-web-account-state-v1", JSON.stringify({ hidden: { active: false, visible: false } }));
    localStorage.setItem("himalaya-web-favorites", JSON.stringify(["alpha"]));
    localStorage.setItem("himalaya-web-last-account", "beta");
    localStorage.setItem("himalaya-web-last-view", "account");
  });
  await page.goto("/");
  const navigationNames = page.locator(".account-tab[data-account] > span:not(.tab-unread-pill)");
  await expect(navigationNames).toHaveText(["gamma", "beta", "alpha"]);
  await expect(page.locator(".account-tab.active")).toHaveAttribute("data-account", "beta");
  await expect(page.locator(".message-toolbar")).toContainText("0");
  await page.getByRole("button", { name: "Konten verwalten", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const managerNames = dialog.locator(".account-manager-identity strong");
  await expect(managerNames).toHaveText(["gamma", "hidden", "beta", "alpha"]);
  await expect(dialog.getByRole("button", { name: "Nach oben verschieben: gamma", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Nach unten verschieben: alpha", exact: true })).toBeDisabled();

  const requestsBeforeMove = [...requests];
  const moveUp = dialog.getByRole("button", { name: "Nach oben verschieben: beta", exact: true });
  await moveUp.focus();
  await page.keyboard.press("Enter");
  await expect(managerNames).toHaveText(["gamma", "beta", "hidden", "alpha"]);
  await expect(moveUp).toBeFocused();
  await expect(dialog.locator('[aria-live="polite"]')).toHaveText("Konto beta verschoben");
  await page.keyboard.press("Space");
  await expect(managerNames).toHaveText(["beta", "gamma", "hidden", "alpha"]);
  await expect(moveUp).toBeFocused();
  await expect(moveUp).toBeDisabled();
  await page.keyboard.press("Enter");
  await expect(managerNames).toHaveText(["beta", "gamma", "hidden", "alpha"]);
  await expect(navigationNames).toHaveText(["beta", "gamma", "alpha"]);
  await expect(page.locator(".account-tab.active")).toHaveAttribute("data-account", "beta");
  expect(requests).toEqual(requestsBeforeMove);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), ORDER_KEY))
    .toEqual(["beta", "gamma", "hidden", "alpha"]);

  const moveDown = dialog.getByRole("button", { name: "Nach unten verschieben: beta", exact: true });
  await moveDown.click();
  await expect(managerNames).toHaveText(["gamma", "beta", "hidden", "alpha"]);
  await expect(moveDown).toBeFocused();
  await dialog.getByRole("button", { name: "Konfiguration neu laden" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(navigationNames).toHaveText(["gamma", "beta", "alpha"]);
  await expect(page.locator(".account-tab.active")).toHaveAttribute("data-account", "beta");
  await page.getByRole("button", { name: "Konten verwalten", exact: true }).click();
  await expect(managerNames).toHaveText(["gamma", "beta", "hidden", "alpha"]);
  const hiddenRow = dialog.locator(".account-manager-row").filter({ has: page.getByText("hidden", { exact: true }) });
  await expect(hiddenRow.getByLabel("Aktiv", { exact: true })).not.toBeChecked();
  await expect(hiddenRow.getByLabel("Sichtbar", { exact: true })).not.toBeChecked();
  await hiddenRow.getByLabel("Aktiv", { exact: true }).check();
  await hiddenRow.getByLabel("Sichtbar", { exact: true }).check();
  await expect(navigationNames).toHaveText(["gamma", "beta", "hidden", "alpha"]);
});

for (const scenario of [
  { name: "saved account", saved: "beta", disabled: [], expected: "beta" },
  { name: "default account", saved: "removed", disabled: [], expected: "alpha" },
  { name: "first selectable in manual order", saved: "alpha", disabled: ["alpha"], expected: "gamma" },
  { name: "no selectable accounts", saved: "beta", disabled: ["alpha", "beta", "gamma", "hidden"], expected: null },
]) {
  test(`bootstrap preserves selection priority: ${scenario.name}`, async ({ page }) => {
    await mockAccounts(page);
    await page.addInitScript(({ saved, disabled }) => {
      localStorage.setItem("himalaya-web-account-order-v1", JSON.stringify(["gamma", "beta", "alpha"]));
      localStorage.setItem("himalaya-web-last-account", saved);
      localStorage.setItem("himalaya-web-last-view", "account");
      localStorage.setItem("himalaya-web-account-state-v1", JSON.stringify(Object.fromEntries(
        disabled.map((name) => [name, { active: false, visible: true }]),
      )));
    }, scenario);
    await page.goto("/");
    if (scenario.expected) {
      await expect(page.locator(".account-tab.active")).toHaveAttribute("data-account", scenario.expected);
    } else {
      await expect(page.getByText("Keine aktiven Konten sichtbar")).toBeVisible();
      await expect(page.locator(".account-tab.active[data-account]")).toHaveCount(0);
    }
  });
}
