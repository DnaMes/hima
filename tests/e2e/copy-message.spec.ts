import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const envelope = {
  id: "7", date: "2026-10-02T05:20:00Z", flags: [], from: [{ name: "Anna", email: "anna@evil.example" }],
  to: [{ name: "Synthetic", email: "synthetic@example.test" }], subject: "Kopiertest", size: 12, hasAttachment: false,
};

type Recorded = { copyBodies: any[] };

async function setup(page: Page, options: { gate?: Promise<void> } = {}): Promise<Recorded> {
  const recorded: Recorded = { copyBodies: [] };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/bootstrap") {
      await route.fulfill({ json: {
        accounts: ["alpha", "beta"].map((name) => ({ name, default: name === "alpha", backends: ["imap"], email: `${name}@example.test` })),
        addressWarning: null,
      } });
    } else if (url.pathname.endsWith("/mailboxes")) {
      await route.fulfill({ json: { mailboxes: [
        { id: "INBOX", name: "INBOX", total: 1, unread: 0 }, { id: "Archive", name: "Archiv", total: 0, unread: 0 },
      ] } });
    } else if (url.pathname.endsWith("/messages")) {
      await route.fulfill({ json: { envelopes: [envelope] } });
    } else if (url.pathname === "/api/message") {
      await route.fulfill({ json: {
        ref: Object.fromEntries(url.searchParams), envelope, text: "Synthetischer Inhalt", html: null, attachments: [],
        sender: {
          replyTo: null, returnPath: "anna@evil.example", messageIdDomain: "evil.example",
          auth: { spf: "pass", dkim: "none", dmarc: "pass" }, received: [],
          risk: { level: "none", score: 0, reasons: [] },
        },
      } });
    } else if (url.pathname === "/api/message/seen") {
      await route.fulfill({ json: { ok: true } });
    } else if (url.pathname === "/api/message/raw") {
      await route.fulfill({ contentType: "message/rfc822", body: "From: a@x\r\nSubject: s\r\n\r\nbody" });
    } else if (url.pathname === "/api/message/copy") {
      recorded.copyBodies.push(request.postDataJSON());
      await options.gate;
      await route.fulfill({ json: { ok: true, mode: "append" } });
    } else {
      await route.abort();
      throw new Error(`Unexpected API request: ${url.pathname}`);
    }
  });
  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));
  await page.goto("/");
  await page.getByRole("button", { name: /Kopiertest/ }).click();
  await expect(page.getByRole("heading", { name: "Kopiertest" })).toBeVisible();
  return recorded;
}

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
const copyButton = (page: Page) => page.getByRole("button", { name: "Kopie anlegen" });

test("copies the message as plain text, with or without the sender check", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Text kopieren" }).click();
  await expect(page.getByText("In die Zwischenablage kopiert.")).toBeVisible();
  const plain = await clipboard(page);
  expect(plain).toContain("Betreff: Kopiertest");
  expect(plain).not.toContain("Absenderprüfung");

  await page.getByRole("button", { name: "Mit Prüfung kopieren" }).click();
  await expect.poll(() => clipboard(page)).toContain("Absenderprüfung");
  expect(await clipboard(page)).toContain("SPF: pass | DKIM: none | DMARC: pass");
});

test("copies only the header block of the raw source", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Header kopieren" }).click();

  await expect(page.getByText("Header kopiert.")).toBeVisible();
  expect(await clipboard(page)).toBe("From: a@x\nSubject: s");
});

test("downloads the raw source as an .eml file", async ({ page }) => {
  await setup(page);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Quelltext (.eml)" }).click()]);

  expect(download.suggestedFilename()).toBe("message-7.eml");
});

test("copies into another account's folder only after the confirmation", async ({ page }) => {
  const recorded = await setup(page);
  await page.getByLabel("Zielkonto").selectOption("beta");
  await page.getByLabel("Zielordner").selectOption("Archive");
  const message = new Promise<string>((resolve) => page.once("dialog", (dialog) => { resolve(dialog.message()); void dialog.accept(); }));
  await copyButton(page).click();

  expect(await message).toContain("beta");
  await expect(page.getByText("Kopie angelegt.")).toBeVisible();
  expect(recorded.copyBodies).toEqual([{
    ref: { account: "alpha", mailbox: "INBOX", message: "7" },
    destination: { account: "beta", mailbox: "Archive" },
  }]);
});

test("a dismissed confirmation sends nothing", async ({ page }) => {
  const recorded = await setup(page);
  await page.getByLabel("Zielordner").selectOption("Archive");
  page.once("dialog", (dialog) => void dialog.dismiss());
  await copyButton(page).click();

  await page.waitForTimeout(300);
  expect(recorded.copyBodies).toEqual([]);
});

test("the message's own folder is not offered as a destination", async ({ page }) => {
  await setup(page);

  await expect(page.getByLabel("Zielkonto")).toHaveValue("alpha");
  await expect(page.getByLabel("Zielordner").locator("option")).toHaveText(["Ordner wählen …", "Archiv"]);
  await page.getByLabel("Zielkonto").selectOption("beta");
  await expect(page.getByLabel("Zielordner").locator("option")).toHaveText(["Ordner wählen …", "INBOX", "Archiv"]);
});

test("a second click while the copy runs sends no second request", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const recorded = await setup(page, { gate });
  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByLabel("Zielordner").selectOption("Archive");
  await copyButton(page).click();

  await expect(copyButton(page)).toBeDisabled();
  // A second submit (Enter in a select, a scripted submit) must hit the in-flight guard, not the server.
  await page.locator("form.copy-form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
  await page.waitForTimeout(200);
  expect(recorded.copyBodies).toHaveLength(1);
  release();
  await expect(page.getByText("Kopie angelegt.")).toBeVisible();
  expect(recorded.copyBodies).toHaveLength(1);
});
