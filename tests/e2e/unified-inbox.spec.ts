import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import type { Envelope, UnifiedInboxResult } from "../../src/shared/types.js";

test.use({ launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH ?? "/home/dnames/bin/chromium-ai" } });

const envelope = (account: string, mailbox = "INBOX"): Envelope => ({
  id: "7", subject: `Synthetic ${account} ${mailbox}`, date: "2026-09-18T10:00:00Z",
  flags: [], from: [], to: [], hasAttachment: true, size: 12, source: { account, mailbox },
});
const warning = { account: "broken", code: "AUTH_REQUIRED", message: "Bitte prüfe die Anmeldung dieses Kontos." };
const result = (envelopes = [envelope("alpha"), envelope("beta", "Inbox")], hasMore = false): UnifiedInboxResult => ({ envelopes, hasMore, warnings: [warning] });
const unified = (page: Page) => page.getByRole("button", { name: "Alle Eingänge", exact: true });
const row = (page: Page, account: string, mailbox = "INBOX") => page.getByRole("button", { name: new RegExp(`Synthetic ${account} ${mailbox}`) });
// Returns to the "normal" (non-unified) view by selecting the alpha account,
// which opens its INBOX without requiring the tree to be expanded.
const normal = (page: Page) => page.getByRole("region", { name: "alpha", exact: true }).locator(".account-select");

type Call = { path: string; query: Record<string, string>; method: string; body: any; authenticated: boolean };
async function setup(page: Page, handle?: (route: Route) => Promise<void>) {
  const calls: Call[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    calls.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), method: request.method(),
      body: request.postData() ? request.postDataJSON() : null, authenticated: Boolean(request.headers()["x-himalaya-session"]) });
    if (url.pathname === "/api/bootstrap") await route.fulfill({ json: {
      accounts: ["alpha", "beta", "broken", "hidden", "inactive"].map((name) => ({ name, default: name === "alpha", backends: ["imap"], email: `${name}@example.test` })), addressWarning: null,
    } });
    else if (url.pathname === "/api/unified/inbox") {
      if (handle) await handle(route);
      else await route.fulfill({ json: result() });
    } else if (url.pathname.endsWith("/mailboxes")) {
      const account = url.pathname.split("/")[3];
      await route.fulfill({ json: { mailboxes: [
        { id: account === "beta" ? "Inbox" : "INBOX", name: "INBOX", total: 1, unread: 1 },
        { id: `${account}-archive`, name: `${account} archive`, total: 0, unread: 0 },
      ] } });
    } else if (url.pathname.endsWith("/messages")) await route.fulfill({ json: { envelopes: [{ ...envelope("normal"), source: { account: "untrusted", mailbox: "wrong" } }] } });
    else if (url.pathname === "/api/message") {
      const ref = Object.fromEntries(url.searchParams);
      await route.fulfill({ json: { ref, envelope: envelope(ref.account!, ref.mailbox!), text: `Body ${ref.account}/${ref.mailbox}/${ref.message}`, html: null,
        attachments: [{ id: "attachment-1", filename: "synthetic.txt", mime: "text/plain", size: 12, inline: false }] } });
    } else if (["/api/message/seen", "/api/message/move"].includes(url.pathname)) await route.fulfill({ json: { ok: true } });
    else if (url.pathname === "/api/ai/assist") await route.fulfill({ json: { task: request.postDataJSON().task, text: "Synthetic AI output", provider: "synthetic", model: "synthetic", truncated: false } });
    else if (["/api/attachment", "/api/message/export"].includes(url.pathname)) await route.fulfill({ contentType: "text/plain", body: "Synthetic download" });
    else { await route.abort(); throw new Error(`Unexpected API request: ${url.pathname}`); }
  });
  await page.addInitScript(() => {
    localStorage.setItem("himalaya-web-account-order-v1", JSON.stringify(["beta", "hidden", "alpha", "inactive", "broken"]));
    localStorage.setItem("himalaya-web-account-state-v1", JSON.stringify({ hidden: { active: true, visible: false }, inactive: { active: false, visible: true } }));
    // These tests exercise the unified inbox against a baseline account
    // selection, not the fresh-session unified default.
    localStorage.setItem("himalaya-web-last-view", "account");
  });
  await page.goto("/");
  await expect(normal(page)).toHaveAttribute("aria-current", "page");
  return calls;
}

async function settle(page: Page, route: Route, response: Parameters<Route["fulfill"]>[0]) {
  const received = page.waitForResponse((response) => response.request() === route.request());
  await route.fulfill(response);
  await (await received).finished();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test("posts ordered eligible accounts and search inputs, renders warnings and uses hasMore for paging", async ({ page }) => {
  const calls = await setup(page, async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({ json: result([envelope(body.page === 1 ? "alpha" : "beta")], body.page === 1) });
  });
  await unified(page).click();
  await expect(row(page, "alpha")).toBeVisible();
  expect(calls.find((call) => call.path === "/api/unified/inbox")).toMatchObject({ method: "POST", authenticated: true,
    body: { accounts: ["beta", "alpha", "broken"], page: 1, pageSize: 50, field: "all", q: "", unread: false } });
  await expect(page.getByText("alpha · INBOX", { exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "1 Konto betroffen" })).toContainText(`broken: ${warning.message}`);
  await page.getByRole("button", { name: "›", exact: true }).click();
  await expect(row(page, "beta")).toBeVisible();
  await expect(page.getByRole("button", { name: "›", exact: true })).toBeDisabled();
  await page.getByRole("textbox", { name: "Nachrichten suchen" }).fill("  needle  ");
  await page.getByRole("combobox", { name: "Suchfeld" }).selectOption("subject");
  await page.getByRole("checkbox", { name: "ungelesen", exact: true }).check();
  await page.getByRole("button", { name: "Suchen", exact: true }).click();
  await expect(row(page, "alpha")).toBeVisible();
  expect(calls.filter((call) => call.path === "/api/unified/inbox").at(-1)?.body).toEqual({ accounts: ["beta", "alpha", "broken"], page: 1, pageSize: 50, field: "subject", q: "needle", unread: true });
  await normal(page).click();
  await expect(page.getByText(warning.message, { exact: false })).toHaveCount(0);
  await row(page, "normal").click();
  await expect(page.getByText("Body alpha/INBOX/7", { exact: true })).toBeVisible();
  await unified(page).click();
  await expect(page.locator(".reader-content")).toHaveCount(0);
});

test("stops unified navigation at the maximum API page", async ({ page }) => {
  const calls = await setup(page, async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({ json: result([envelope(`page-${body.page}`)], true) });
  });
  await unified(page).click();

  const next = page.getByRole("button", { name: "›", exact: true });
  for (let expectedPage = 2; expectedPage <= 10; expectedPage += 1) {
    await next.click();
    await expect(page.locator(".page-number")).toHaveText(String(expectedPage));
    await expect(row(page, `page-${expectedPage}`)).toBeVisible();
  }

  await expect(next).toBeDisabled();
  expect(calls.filter((call) => call.path === "/api/unified/inbox").map((call) => call.body.page)).toEqual(
    Array.from({ length: 10 }, (_, index) => index + 1),
  );
});

test("uses source identity for colliding IDs, seen, exports, attachments, print, AI and move", async ({ page }) => {
  const calls = await setup(page);
  await unified(page).click();
  await row(page, "beta", "Inbox").click();
  const ref = { account: "beta", mailbox: "Inbox", message: "7" };
  await expect(page.getByText("Body beta/Inbox/7", { exact: true })).toBeVisible();
  await expect(row(page, "beta", "Inbox")).toHaveClass(/seen/);
  await expect(row(page, "alpha")).toHaveClass(/unread/);
  await expect(page.locator(".envelope-row.active")).toHaveCount(1);
  expect(calls.find((call) => call.path === "/api/message")?.query).toEqual(ref);
  expect(calls.filter((call) => call.path === "/api/ai/assist")).toHaveLength(0);
  await page.getByRole("button", { name: "Ungelesen", exact: true }).click();
  await expect(row(page, "beta", "Inbox")).toHaveClass(/unread/);
  expect(calls.filter((call) => call.path === "/api/message/seen").map((call) => call.body)).toEqual([{ ref, seen: true }, { ref, seen: false }]);
  for (const [label, path] of [["Markdown herunterladen", "/api/message/export"], ["synthetic.txt", "/api/attachment"]]) {
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: label, exact: false }).first().click();
    await downloaded;
    expect(calls.find((call) => call.path === path)?.query).toMatchObject(ref);
  }
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Als PDF drucken" }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveTitle("Synthetic beta Inbox");
  await expect(popup.getByText("Body beta/Inbox/7", { exact: true })).toBeVisible();
  await popup.close();
  for (const [label, task] of [["Zusammenfassen", "summarize"], ["Antwortentwurf", "reply-draft"]]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByText("Synthetic AI output", { exact: true })).toBeVisible();
    expect(calls.filter((call) => call.path === "/api/ai/assist").at(-1)?.body).toEqual({ ref, task });
  }
  const destination = page.locator('select[name="destination"]');
  await expect(destination.locator("option")).toHaveText(["Verschieben nach …", "beta archive"]);
  await destination.selectOption("beta-archive");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Verschieben", exact: true }).click();
  await expect.poll(() => calls.filter((call) => call.path === "/api/unified/inbox").length).toBe(2);
  expect(calls.find((call) => call.path === "/api/message/move")?.body).toEqual({ ref, destination: "beta-archive" });
  await expect(page.locator(".reader-content")).toHaveCount(0);
  expect(calls.filter((call) => call.path.endsWith("/messages")).every((call) => call.path === "/api/accounts/alpha/messages")).toBe(true);
});

test("rejects unified rows without source metadata before requesting a message", async ({ page }) => {
  const missing = envelope("missing");
  delete missing.source;
  const calls = await setup(page, async (route) => { await route.fulfill({ json: result([missing]) }); });
  await unified(page).click();
  await row(page, "missing").click();
  await expect(page.getByRole("alert")).toHaveText(/Die Anfrage ist fehlgeschlagen/);
  expect(calls.filter((call) => call.path === "/api/message")).toHaveLength(0);
});

test("distinguishes no eligible accounts from empty results and all-account failures", async ({ page }) => {
  const calls = await setup(page, async (route) => { await route.fulfill({ json: { envelopes: [], hasMore: false, warnings: [] } }); });
  await unified(page).click();
  await expect(page.getByText("Keine Nachrichten gefunden", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Konten verwalten", exact: true }).click();
  for (const name of ["alpha", "beta", "broken"]) {
    await page.locator(".account-manager-row").filter({ has: page.locator("strong", { hasText: new RegExp(`^${name}$`) }) }).getByRole("checkbox", { name: "Aktiv", exact: true }).uncheck();
  }
  await page.getByRole("button", { name: "Kontenverwaltung schließen" }).click();
  await expect(page.getByText("Keine aktiven und sichtbaren Konten", { exact: true })).toBeVisible();
  await expect(page.getByText("Keine Nachrichten gefunden", { exact: true })).toHaveCount(0);
  const count = calls.filter((call) => call.path === "/api/unified/inbox").length;
  await page.getByRole("button", { name: "Nachrichten aktualisieren" }).click();
  await expect(page.getByText("Keine aktiven und sichtbaren Konten", { exact: true })).toBeVisible();
  expect(calls.filter((call) => call.path === "/api/unified/inbox")).toHaveLength(count);
});

test("keeps warnings visible when every provider fails", async ({ page }) => {
  await setup(page, async (route) => { await route.fulfill({ json: { envelopes: [], hasMore: false, warnings: ["alpha", "beta", "broken"].map((account) => ({ ...warning, account })) } }); });
  await unified(page).click();
  await expect(page.getByRole("status").filter({ hasText: "3 Konten betroffen" })).toContainText(`beta: ${warning.message}`);
  await expect(page.getByText("Nachrichten konnten nicht vollständig geladen werden.", { exact: true })).toBeVisible();
  await expect(page.getByText("Keine Nachrichten gefunden", { exact: true })).toHaveCount(0);
});

test("does not show a successful empty state when the current unified request fails", async ({ page }) => {
  await setup(page, async (route) => {
    await route.fulfill({ status: 502, json: { error: "Synthetic unified failure" } });
  });
  await unified(page).click();
  await expect(page.getByRole("alert")).toHaveText(/Synthetic unified failure/);
  await expect(page.getByText("Alle Eingänge konnten nicht geladen werden.", { exact: true })).toBeVisible();
  await expect(page.getByText("Keine Nachrichten gefunden", { exact: true })).toHaveCount(0);
});

test("ignores obsolete unified list success and failure after switching views", async ({ page }) => {
  const pending: Route[] = [];
  await setup(page, async (route) => { pending.push(route); });
  for (const fails of [false, true]) {
    await unified(page).click();
    await expect.poll(() => pending.length).toBe(fails ? 2 : 1);
    await normal(page).click();
    await expect(row(page, "normal")).toBeVisible();
    await settle(page, pending.at(-1)!, fails ? { status: 502, json: { error: "Obsolete error" } } : { json: result() });
    await expect(row(page, "normal")).toBeVisible();
    await expect(row(page, "beta", "Inbox")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByText(warning.message, { exact: false })).toHaveCount(0);
  }
});

test("page changes invalidate old detail and use the new row source", async ({ page }) => {
  const calls = await setup(page, async (route) => { await route.fulfill({ json: result([envelope(route.request().postDataJSON().page === 1 ? "alpha" : "beta")], route.request().postDataJSON().page === 1) }); });
  let pending: Route | undefined;
  await page.route("**/api/message?account=alpha&**", async (route) => { pending = route; });
  await unified(page).click();
  await row(page, "alpha").click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await page.getByRole("button", { name: "›", exact: true }).click();
  await row(page, "beta").click();
  await expect(page.getByText("Body beta/INBOX/7", { exact: true })).toBeVisible();
  await settle(page, pending!, { json: { ref: { account: "alpha", mailbox: "INBOX", message: "7" }, envelope: envelope("alpha"), text: "Obsolete body", html: null, attachments: [] } });
  await expect(page.getByText("Body beta/INBOX/7", { exact: true })).toBeVisible();
  await expect(page.getByText("Obsolete body", { exact: true })).toHaveCount(0);
  expect(calls.filter((call) => call.path === "/api/message/seen").every((call) => call.body.ref.account === "beta")).toBe(true);
});

for (const action of ["seen", "move"] as const) {
  test(`ignores a delayed ${action} completion after changing views`, async ({ page }) => {
    await setup(page);
    await unified(page).click();
    await row(page, "beta", "Inbox").click();
    await expect(row(page, "beta", "Inbox")).toHaveClass(/seen/);
    let pending: Route | undefined;
    await page.route(`**/api/message/${action}`, async (route) => { pending = route; });
    if (action === "seen") await page.getByRole("button", { name: "Ungelesen", exact: true }).click();
    else {
      await page.locator('select[name="destination"]').selectOption("beta-archive");
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Verschieben", exact: true }).click();
    }
    await expect.poll(() => Boolean(pending)).toBe(true);
    await normal(page).click();
    await row(page, "normal").click();
    await expect(page.getByText("Body alpha/INBOX/7", { exact: true })).toBeVisible();
    await settle(page, pending!, { json: { ok: true } });
    await expect(page.getByText("Body alpha/INBOX/7", { exact: true })).toBeVisible();
    await expect(row(page, "normal")).toHaveClass(/seen/);
    await expect(page.getByText(action === "move" ? "Nachricht verschoben." : "Als ungelesen markiert.", { exact: true })).toHaveCount(0);
  });
}

test("reselecting the unified inbox reloads its list and clears the reader", async ({ page }) => {
  const calls = await setup(page);
  await unified(page).click();
  await row(page, "beta", "Inbox").click();
  await expect(page.getByText("Body beta/Inbox/7", { exact: true })).toBeVisible();
  await unified(page).click();
  await expect(row(page, "beta", "Inbox")).toBeVisible();
  await expect(page.locator(".reader-content")).toHaveCount(0);
  await expect.poll(() => calls.filter((call) => call.path === "/api/unified/inbox").length).toBe(2);
});

for (const [label, path] of [["Markdown herunterladen", "/api/message/export"], ["synthetic.txt", "/api/attachment"]]) {
  test(`ignores a delayed ${path} failure after changing views`, async ({ page }) => {
    await setup(page);
    await unified(page).click();
    await row(page, "beta", "Inbox").click();
    await expect(row(page, "beta", "Inbox")).toHaveClass(/seen/);
    let pending: Route | undefined;
    await page.route(`**${path}?**`, async (route) => { pending = route; });
    await page.getByRole("button", { name: label, exact: false }).first().click();
    await expect.poll(() => Boolean(pending)).toBe(true);
    await normal(page).click();
    await row(page, "normal").click();
    await expect(page.getByText("Body alpha/INBOX/7", { exact: true })).toBeVisible();
    await settle(page, pending!, { status: 502, json: { error: "Obsolete download error" } });
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByText("Body alpha/INBOX/7", { exact: true })).toBeVisible();
  });
}
