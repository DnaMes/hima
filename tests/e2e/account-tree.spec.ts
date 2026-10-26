import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

test.use({ launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH ?? "/home/dnames/bin/chromium-ai" } });

const folders = [
  { id: "INBOX", name: "INBOX", total: 4, unread: 2 },
  { id: "Archive", name: "Archiv", total: 3, unread: 0 },
];

async function setup(
  page: Page,
  onFolders?: (name: string, route: Route) => Promise<void>,
  options: { view?: "account" | "unified" } = {},
) {
  const calls: string[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    calls.push(url.pathname + url.search);
    if (url.pathname === "/api/bootstrap") {
      await route.fulfill({ json: { accounts: ["alpha", "beta", "gamma"].map((name) => ({
        name, default: name === "alpha", backends: ["imap"], email: `${name}@example.test`,
      })) } });
    } else if (url.pathname.endsWith("/mailboxes")) {
      if (onFolders) await onFolders(url.pathname.split("/")[3]!, route);
      else await route.fulfill({ json: { mailboxes: folders } });
    } else if (url.pathname.endsWith("/messages")) {
      await route.fulfill({ json: { envelopes: [] } });
    } else if (url.pathname === "/api/unified/inbox") {
      await route.fulfill({ json: { envelopes: [], hasMore: false, warnings: [] } });
    } else {
      await route.abort();
      throw new Error(`Unexpected API request: ${url.pathname}`);
    }
  });
  // Most of these tests exercise the account/folder tree itself, not the
  // default start view, so pin the session to account view (alpha, the
  // default account) the way a returning user would have it. Pass
  // { view: "unified" } to instead leave a fresh session untouched.
  if (options.view !== "unified") {
    await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));
  }
  return calls;
}

const account = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const folder = (page: Page, name: string, id: string) => account(page, name).getByRole("button", { name: `Ordner auswählen: ${id} (${name})`, exact: true });
const disclosure = (page: Page, name: string) => account(page, name).getByRole("button", { name: new RegExp(`Ordner (ein|aus)klappen: ${name}`) });

// Let response handlers and their React updates render before checking absence.
async function settleResponse(page: Page, route: Route, response: Parameters<Route["fulfill"]>[0]) {
  const received = page.waitForResponse((item) => item.request() === route.request());
  await route.fulfill(response);
  await (await received).finished();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function changeListContext(page: Page, change: "pagination" | "search" | "refresh") {
  if (change === "pagination") await page.getByRole("button", { name: "›", exact: true }).click();
  else if (change === "search") {
    await page.getByRole("textbox", { name: "Nachrichten suchen" }).fill("current");
    await page.getByRole("button", { name: "Suchen", exact: true }).click();
  } else await page.getByRole("button", { name: "Nachrichten aktualisieren" }).click();
}

for (const change of ["pagination", "search", "refresh"] as const) {
  test(`discards delayed detail after ${change} without marking the old message seen`, async ({ page }) => {
    await setup(page);
    const envelope = { id: "old", subject: "Old synthetic message", date: null, flags: [], from: [], to: [], hasAttachment: false, size: 1 };
    let listCalls = 0;
    let seenCalls = 0;
    let pending: Route | undefined;
    await page.route("**/api/accounts/alpha/messages?**", async (route) => {
      listCalls += 1;
      await route.fulfill({ json: { envelopes: listCalls === 1
        ? Array.from({ length: 50 }, (_, i) => ({ ...envelope, id: String(i) }))
        : [{ ...envelope, id: "current", subject: "Current synthetic message" }] } });
    });
    await page.route("**/api/message?**", async (route) => { pending = route; });
    await page.route("**/api/message/seen", async (route) => {
      seenCalls += 1;
      await route.fulfill({ json: { ok: true } });
    });
    await page.goto("/");
    await page.locator(".envelope-row").first().click();
    await expect.poll(() => Boolean(pending)).toBe(true);
    await changeListContext(page, change);
    await expect(page.getByRole("button", { name: /Current synthetic message/ })).toBeVisible();
    await settleResponse(page, pending!, { json: {
      ref: { account: "alpha", mailbox: "INBOX", message: "0" }, envelope: { ...envelope, id: "0" },
      text: "Obsolete synthetic body", html: null, attachments: [],
    } });
    await expect.soft(page.locator(".reader-content, .spinner")).toHaveCount(0);
    expect(seenCalls).toBe(0);
    await expect(page.getByRole("heading", { name: "Wähle eine Nachricht" })).toBeVisible();
  });
}

async function setupAiRace(page: Page) {
  await setup(page);
  const pending: Route[] = [];
  const envelope = { id: "0", subject: "Synthetic AI message", date: null, flags: [{ iana: "seen", raw: "Seen" }], from: [], to: [], hasAttachment: false, size: 1 };
  await page.route("**/api/accounts/*/messages?**", async (route) => {
    await route.fulfill({ json: { envelopes: Array.from({ length: 50 }, (_, i) => ({ ...envelope, id: String(i) })) } });
  });
  await page.route("**/api/message?**", async (route) => {
    const ref = Object.fromEntries(new URL(route.request().url()).searchParams);
    await route.fulfill({ json: {
      ref, envelope: { ...envelope, id: ref.message },
      text: `Synthetic body ${ref.account}/${ref.mailbox}/${ref.message}`, html: null, attachments: [],
    } });
  });
  await page.route("**/api/ai/assist", async (route) => { pending.push(route); });
  await page.goto("/");
  await page.locator(".envelope-row").first().click();
  await expect(page.getByText("Synthetic body alpha/INBOX/0", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Zusammenfassen", exact: true }).click();
  await expect.poll(() => pending.length).toBe(1);
  return pending;
}

for (const change of ["account", "mailbox", "unified", "message", "pagination", "search", "refresh"] as const) {
  test(`discards delayed AI after ${change} selection changes`, async ({ page }) => {
    const pending = await setupAiRace(page);
    if (change === "account") await account(page, "beta").locator(".account-select").click();
    else if (change === "mailbox") {
      await disclosure(page, "alpha").click();
      await folder(page, "alpha", "Archiv").click();
    } else if (change === "unified") {
      await page.getByRole("button", { name: "Alle Eingänge", exact: true }).click();
      await disclosure(page, "alpha").click();
      await folder(page, "alpha", "INBOX").click();
    } else if (change !== "message") await changeListContext(page, change);
    await page.locator(".envelope-row").nth(1).click();
    const source = change === "account" ? "beta/INBOX" : change === "mailbox" ? "alpha/Archive" : "alpha/INBOX";
    await expect(page.getByText(`Synthetic body ${source}/1`, { exact: true })).toBeVisible();
    await settleResponse(page, pending[0]!, { json: {
      task: "summarize", text: "Obsolete synthetic AI result", provider: "synthetic", model: "test", truncated: true,
    } });
    await expect(page.locator(".ai-result, .notice-banner")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Zusammenfassen", exact: true })).toBeEnabled();
  });
}

for (const outcome of ["success", "failure"] as const) {
  test(`obsolete AI ${outcome} cannot finish a newer AI request`, async ({ page }) => {
    const pending = await setupAiRace(page);
    await page.locator(".envelope-row").nth(1).click();
    await expect(page.getByText("Synthetic body alpha/INBOX/1", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Antwortentwurf", exact: true }).click();
    await expect.poll(() => pending.length).toBe(2);
    await settleResponse(page, pending[0]!, outcome === "success"
      ? { json: { task: "summarize", text: "Obsolete result", provider: "synthetic", model: "test", truncated: true } }
      : { status: 502, json: { error: "Obsolete synthetic error" } });
    await expect(page.getByRole("button", { name: "Entwurf läuft …", exact: true })).toBeDisabled();
    await expect(page.locator(".ai-result, .notice-banner, .error-banner")).toHaveCount(0);
    await settleResponse(page, pending[1]!, { json: {
      task: "reply-draft", text: "Current synthetic reply", provider: "synthetic", model: "test", truncated: false,
    } });
    await expect(page.getByText("Current synthetic reply", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Zusammenfassen", exact: true })).toBeEnabled();
  });
}

test("loads mailboxes for the selected account without expanding its tree, caches folders, and selects folders in their source account", async ({ page }) => {
  const calls = await setup(page);
  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-mailbox:alpha", "Archive"));
  await page.goto("/");
  await expect(disclosure(page, "alpha")).toHaveAttribute("aria-expanded", "false");
  // Wait for the account-selection chain (mailboxes -> auto-picked mailbox ->
  // its messages) to settle before asserting on the calls it made.
  await expect.poll(() => calls.some((path) => path.startsWith("/api/accounts/alpha/messages?mailbox=Archive"))).toBe(true);
  expect(calls.filter((path) => path.endsWith("/mailboxes"))).toEqual(["/api/accounts/alpha/mailboxes"]);
  await disclosure(page, "alpha").click();
  await expect(folder(page, "alpha", "Archiv")).toHaveAttribute("aria-current", "page");
  await disclosure(page, "alpha").click();
  await expect(disclosure(page, "beta")).toHaveAttribute("aria-expanded", "false");
  await disclosure(page, "beta").click();
  await expect(folder(page, "beta", "INBOX")).toBeVisible();
  await expect(account(page, "beta").getByLabel("2 ungelesen")).toBeVisible();
  await disclosure(page, "beta").click();
  await disclosure(page, "beta").click();
  expect(calls.filter((path) => path === "/api/accounts/beta/mailboxes")).toHaveLength(1);
  await folder(page, "beta", "Archiv").click();
  await expect(folder(page, "beta", "Archiv")).toHaveAttribute("aria-current", "page");
  await expect.poll(() => calls.some((path) => path.startsWith("/api/accounts/beta/messages?mailbox=Archive"))).toBe(true);
  expect(calls.some((path) => path.startsWith("/api/accounts/beta/messages?mailbox=INBOX"))).toBe(false);
  await expect(page.locator(".mailbox-tabs, .mailbox-toolbar")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("himalaya-web-last-account"))).toBe("beta");
});

test("isolates folder failures and favorites by account and keeps unified selection stable", async ({ page }) => {
  await setup(page, async (name, route) => {
    await route.fulfill(name === "gamma"
      ? { status: 502, json: { error: "Ordner konnten nicht geladen werden." } }
      : { json: { mailboxes: folders } });
  });
  await page.goto("/");
  await disclosure(page, "alpha").click();
  await expect(folder(page, "alpha", "INBOX")).toBeVisible();
  await disclosure(page, "beta").click();
  await disclosure(page, "gamma").click();
  await expect(account(page, "gamma").getByRole("alert")).toContainText("Ordner konnten nicht geladen werden.");
  await account(page, "alpha").getByRole("button", { name: "Ordner als Favorit markieren: Archiv (alpha)" }).click();
  await page.getByRole("button", { name: "Ordner: Favoriten", exact: true }).click();
  await expect(folder(page, "alpha", "Archiv")).toHaveAttribute("aria-current", "page");
  await expect(folder(page, "beta", "INBOX")).toBeVisible(); // Inbox and Sent stay pinned even in the favorites view
  await expect(folder(page, "beta", "Archiv")).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("himalaya-web-mailbox-favorites-v1")!))).toEqual(["alpha:Archive"]);
  await page.getByRole("button", { name: "Alle Eingänge", exact: true }).click();
  await expect(page.getByRole("button", { name: "Alle Eingänge", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".account-select[aria-current], .mailbox-select[aria-current]")).toHaveCount(0);
  await page.getByRole("button", { name: "Ordner: Alle", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Alle Eingänge", exact: true })).toBeVisible();
  await folder(page, "beta", "INBOX").click();
  await expect(folder(page, "beta", "INBOX")).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Alle Eingänge", exact: true })).not.toHaveAttribute("aria-current", "page");
});

test("ignores collapsed and superseded folder responses", async ({ page }) => {
  const pending: Route[] = [];
  await setup(page, async (name, route) => {
    if (name === "beta") pending.push(route);
    else await route.fulfill({ json: { mailboxes: folders } });
  });
  await page.goto("/");
  await disclosure(page, "alpha").click();
  await expect(folder(page, "alpha", "INBOX")).toBeVisible();
  await disclosure(page, "beta").click();
  await expect.poll(() => pending.length).toBe(1);
  await expect(account(page, "beta")).toContainText("Ordner werden geladen");
  await disclosure(page, "beta").click();
  await disclosure(page, "beta").click();
  await expect.poll(() => pending.length).toBe(2);
  await pending[1]!.fulfill({ json: { mailboxes: folders } });
  await expect(folder(page, "beta", "Archiv")).toBeVisible();
  const oldResponse = page.waitForResponse((response) => response.url().endsWith("/beta/mailboxes"));
  await pending[0]!.fulfill({ json: { mailboxes: [{ id: "stale", name: "Stale folder", total: 0, unread: 0 }] } });
  await (await oldResponse).finished();
  await expect(folder(page, "beta", "Archiv")).toBeVisible();
  await expect(account(page, "beta")).not.toContainText("Stale folder");
});

test("supports keyboard and pointer moves without losing selection or refetching cached folders", async ({ page }) => {
  const calls = await setup(page);
  await page.goto("/");
  await disclosure(page, "alpha").click();
  await expect(folder(page, "alpha", "INBOX")).toHaveAttribute("aria-current", "page");
  const names = page.locator(".account-list .account-copy strong");
  const up = account(page, "beta").getByRole("button", { name: "Nach oben verschieben: beta" });
  await up.focus();
  await page.keyboard.press("Enter");
  await expect(names).toHaveText(["beta", "alpha", "gamma"]);
  await expect(up).toBeFocused();
  await expect(up).toBeDisabled();
  await expect(page.locator(".accounts-panel [aria-live=polite]")).toContainText("Konto beta verschoben");
  await account(page, "gamma").locator(".account-row").dragTo(account(page, "beta").locator(".account-row"));
  await expect(names).toHaveText(["gamma", "beta", "alpha"]);
  await expect(folder(page, "alpha", "INBOX")).toHaveAttribute("aria-current", "page");
  expect(calls.filter((path) => path.endsWith("/mailboxes"))).toEqual(["/api/accounts/alpha/mailboxes"]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("himalaya-web-account-order-v1")!))).toEqual(["gamma", "beta", "alpha"]);
  await page.reload();
  await expect(names).toHaveText(["gamma", "beta", "alpha"]);
});

test("reorders accounts only within their rendered favorite group", async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => {
    localStorage.setItem("himalaya-web-favorites", JSON.stringify(["beta", "gamma"]));
  });
  await page.goto("/");

  const names = page.locator(".account-list .account-copy strong");
  const firstFavoriteUp = account(page, "beta").getByRole("button", { name: "Nach oben verschieben: beta" });
  await expect(names).toHaveText(["beta", "gamma", "alpha"]);
  await expect(firstFavoriteUp).toHaveAttribute("aria-disabled", "true");
  await firstFavoriteUp.focus();
  await page.keyboard.press("Enter");
  await expect(names).toHaveText(["beta", "gamma", "alpha"]);
  await expect(page.locator(".accounts-panel [aria-live=polite]")).toBeEmpty();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("himalaya-web-account-order-v1")!)))
    .toEqual(["alpha", "beta", "gamma"]);

  await account(page, "gamma").getByRole("button", { name: "Nach oben verschieben: gamma" }).click();
  await expect(names).toHaveText(["gamma", "beta", "alpha"]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("himalaya-web-account-order-v1")!)))
    .toEqual(["alpha", "gamma", "beta"]);

  await account(page, "alpha").locator(".account-row").dragTo(account(page, "gamma").locator(".account-row"));
  await expect(names).toHaveText(["gamma", "beta", "alpha"]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("himalaya-web-account-order-v1")!)))
    .toEqual(["alpha", "gamma", "beta"]);
});

test("invalidates pending folders on reorder and allows an explicit retry", async ({ page }) => {
  let pending: Route | undefined;
  const calls = await setup(page, async (name, route) => {
    if (name === "beta" && !pending) pending = route;
    else await route.fulfill({ json: { mailboxes: folders } });
  });
  await page.goto("/");
  await disclosure(page, "alpha").click();
  await expect(folder(page, "alpha", "INBOX")).toBeVisible();
  await disclosure(page, "beta").click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await account(page, "beta").getByRole("button", { name: "Nach oben verschieben: beta" }).click();
  await pending!.fulfill({ json: { mailboxes: [{ id: "stale", name: "Stale folder", total: 0, unread: 0 }] } });
  await expect(account(page, "beta").getByRole("button", { name: "Ordner erneut laden: beta" })).toBeVisible();
  expect(calls.filter((path) => path === "/api/accounts/beta/mailboxes")).toHaveLength(1);
  await account(page, "beta").getByRole("button", { name: "Ordner erneut laden: beta" }).click();
  await expect(folder(page, "beta", "Archiv")).toBeVisible();
  await expect(account(page, "beta")).not.toContainText("Stale folder");
});

test("selects an account, opens its INBOX without expanding the tree, and falls back to its first folder when INBOX is absent", async ({ page }) => {
  const calls = await setup(page, async (name, route) => {
    await route.fulfill({ json: { mailboxes: name === "beta" ? folders.slice(1) : folders } });
  });
  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-mailbox:beta", "removed"));
  await page.goto("/");
  await disclosure(page, "alpha").click();
  await expect(folder(page, "alpha", "INBOX")).toHaveAttribute("aria-current", "page");
  await disclosure(page, "alpha").click();
  await account(page, "beta").locator(".account-select").click();
  await expect(account(page, "beta").locator(".account-select")).toHaveAttribute("aria-current", "page");
  await expect(disclosure(page, "beta")).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => calls.some((path) => path.startsWith("/api/accounts/beta/messages?mailbox=Archive"))).toBe(true);
  await disclosure(page, "beta").click();
  await expect(folder(page, "beta", "Archiv")).toHaveAttribute("aria-current", "page");
  await disclosure(page, "beta").click();
  await account(page, "beta").locator(".account-select").click();
  await disclosure(page, "beta").click();
  await expect(folder(page, "beta", "Archiv")).toHaveAttribute("aria-current", "page");
  expect(calls.filter((path) => path === "/api/accounts/beta/mailboxes")).toHaveLength(1);
});

test("unified selection clears the reader and page and ignores pending message and detail responses", async ({ page }) => {
  await setup(page);
  const envelope = { id: "1", subject: "Synthetic tree message", date: null, flags: [{ iana: "seen", raw: "Seen" }], from: [], to: [], hasAttachment: false, size: 1 };
  const detail = { ref: { account: "alpha", mailbox: "INBOX", message: "1" }, envelope, text: "Synthetic tree body", html: null, attachments: [] };
  let pendingList: Route | undefined;
  let pendingDetail: Route | undefined;
  let delayList = false;
  let delayDetail = false;
  await page.route("**/api/accounts/alpha/messages?**", async (route) => {
    if (delayList) pendingList = route;
    else await route.fulfill({ json: { envelopes: Array.from({ length: 50 }, (_, i) => ({ ...envelope, id: String(i + 1) })) } });
  });
  await page.route("**/api/message?**", async (route) => {
    if (delayDetail) pendingDetail = route;
    else await route.fulfill({ json: detail });
  });
  await page.goto("/");
  await disclosure(page, "alpha").click();
  await page.locator(".envelope-row").first().click();
  await expect(page.getByText("Synthetic tree body", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Alle Eingänge", exact: true }).click();
  await expect(page.locator(".reader-content")).toHaveCount(0);
  await folder(page, "alpha", "INBOX").click();
  await expect(page.locator(".envelope-row")).toHaveCount(50);
  delayList = true;
  await page.getByRole("button", { name: "›", exact: true }).click();
  await expect.poll(() => Boolean(pendingList)).toBe(true);
  await expect(page.locator(".page-number")).toHaveText("2");
  await page.getByRole("button", { name: "Alle Eingänge", exact: true }).click();
  await expect(page.locator(".page-number")).toHaveText("1");
  const oldList = page.waitForResponse((response) => response.url().includes("/alpha/messages?"));
  await pendingList!.fulfill({ json: { envelopes: [envelope] } });
  await (await oldList).finished();
  await expect(page.locator(".envelope-row, .reader-content")).toHaveCount(0);
  delayList = false;
  delayDetail = true;
  await folder(page, "alpha", "INBOX").click();
  await page.locator(".envelope-row").first().click();
  await expect.poll(() => Boolean(pendingDetail)).toBe(true);
  await page.getByRole("button", { name: "Alle Eingänge", exact: true }).click();
  const oldDetail = page.waitForResponse((response) => response.url().includes("/api/message?"));
  await pendingDetail!.fulfill({ json: detail });
  await (await oldDetail).finished();
  await expect(page.getByRole("heading", { name: "Wähle eine Nachricht" })).toBeVisible();
  await expect(page.locator(".envelope-row, .reader-content, .spinner")).toHaveCount(0);
});

test("keeps long folder trees in a bounded scroll area with visible keyboard controls", async ({ page }) => {
  await setup(page, async (_name, route) => {
    await route.fulfill({ json: { mailboxes: Array.from({ length: 60 }, (_, i) => ({ id: `folder-${i}`, name: `Synthetic folder ${i}`, total: 1, unread: 1 })) } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  // Expand via keyboard, not a mouse click: a click here would switch
  // Chromium's focus-visible input modality to pointer and mask the
  // later programmatic-focus outline assertion below.
  await disclosure(page, "alpha").focus();
  await page.keyboard.press("Enter");
  const first = folder(page, "alpha", "Synthetic folder 0");
  await expect(first).toHaveAttribute("aria-current", "page");
  const nav = page.getByRole("navigation", { name: "Kontenliste" });
  const metrics = await nav.evaluate((element) => ({ height: element.clientHeight, scrollHeight: element.scrollHeight, overflow: getComputedStyle(element).overflowY }));
  expect(metrics.height).toBeGreaterThan(0);
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.height);
  expect(metrics.overflow).toBe("auto");
  await expect(account(page, "alpha").locator(".mailbox-children")).toHaveCSS("margin-left", "22px");
  const up = account(page, "beta").getByRole("button", { name: "Nach oben verschieben: beta" });
  await up.focus();
  await expect(up).toBeFocused();
  await expect(account(page, "beta").locator(".account-order-controls")).toHaveCSS("opacity", "1");
  expect(await up.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
  await page.setViewportSize({ width: 1120, height: 800 });
  const last = folder(page, "alpha", "Synthetic folder 59");
  await last.click();
  await expect(last).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".mailbox-tabs, .mailbox-toolbar")).toHaveCount(0);
});

test("starts a fresh session in the unified inbox instead of any single account", async ({ page }) => {
  await setup(page, undefined, { view: "unified" });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Alle Eingänge", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".account-row.active")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Alle Eingänge", exact: true })).toBeVisible();
});

test("opens an account's INBOX on click without expanding its folder tree", async ({ page }) => {
  await setup(page);
  await page.goto("/");
  await account(page, "beta").locator(".account-select").click();
  await expect(account(page, "beta").locator(".account-select")).toHaveAttribute("aria-current", "page");
  await expect(disclosure(page, "beta")).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => page.locator(".message-toolbar").isVisible()).toBe(true);
  await expect(page.locator(".mailbox-children")).toHaveCount(0);
});

test("restores the previously selected mailbox after a reload", async ({ page }) => {
  await setup(page);
  await page.goto("/");
  await disclosure(page, "alpha").click();
  await folder(page, "alpha", "Archiv").click();
  await expect(folder(page, "alpha", "Archiv")).toHaveAttribute("aria-current", "page");
  await page.reload();
  await disclosure(page, "alpha").click();
  await expect(folder(page, "alpha", "Archiv")).toHaveAttribute("aria-current", "page");
  expect(await page.evaluate(() => localStorage.getItem("himalaya-web-last-view"))).toBe("account");
});
