import { expect, test } from "@playwright/test";

const bootstrap = { accounts: [{ name: "synthetic", default: true, backends: ["imap", "smtp"], email: "synthetic@example.test" }], addressWarning: null };

async function open(page: import("@playwright/test").Page): Promise<void> {
  await page.route("**/api/bootstrap", (route) => route.fulfill({ json: bootstrap }));
  await page.route("**/api/accounts/synthetic/mailboxes", (route) => route.fulfill({ json: { mailboxes: [{ id: "INBOX", name: "INBOX", total: 0, unread: 0 }] } }));
  await page.route("**/api/accounts/synthetic/messages**", (route) => route.fulfill({ json: { envelopes: [] } }));
  await page.goto("/");
}

test.describe("browser language de", () => {
  test.use({ locale: "de-DE" });
  test("starts German, switches to English, and keeps the choice", async ({ page }) => {
    await open(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.getByRole("button", { name: "Neue Nachricht" })).toBeVisible();
    await page.getByLabel("Sprache auswählen").selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("button", { name: "New message" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "New message" })).toBeVisible();
  });
});

test.describe("browser language en", () => {
  test.use({ locale: "en-US" });
  test("starts English and the palette is translated", async ({ page }) => {
    await open(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("button", { name: "New message" })).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    await page.getByLabel("Search commands").fill("zzzz");
    await expect(page.getByText("Nothing found")).toBeVisible();
  });
});

test.describe("about panel", () => {
  test.use({ locale: "de-DE" });
  test("opens from the version badge and shows version, licence and label", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Über Hima" }).click();
    const dialog = page.getByRole("dialog", { name: "Über" });
    await expect(dialog).toContainText(/Hima v\d+\.\d+\.\d+/);
    await expect(dialog).toContainText("Lizenz: MIT");
    await expect(dialog).toContainText("Teil von erdlabs");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});
