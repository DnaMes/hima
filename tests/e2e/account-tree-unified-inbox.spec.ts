import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const ORDER_KEY = "himalaya-web-account-order-v1";
const ACCOUNT_STATE_KEY = "himalaya-web-account-state-v1";

type ApiCall = {
  body: unknown;
  method: string;
  path: string;
  query: Record<string, string>;
};

const accounts = ["alpha", "beta", "hidden", "inactive"].map((name) => ({
  name,
  default: name === "alpha",
  backends: ["imap"],
  email: `${name}@example.test`,
}));

const normalEnvelope = {
  id: "normal-1",
  subject: "Normal synthetic message",
  date: "2026-09-18T08:00:00Z",
  flags: [],
  from: [{ name: "Normal Sender", email: "normal-sender@example.test" }],
  to: [{ name: "Alpha", email: "alpha@example.test" }],
  hasAttachment: false,
  size: 10,
};

const unifiedEnvelopes = [
  {
    id: "beta-1",
    subject: "Beta unified message",
    date: "2026-09-18T10:00:00Z",
    flags: [],
    from: [{ name: "Beta Sender", email: "beta-sender@example.test" }],
    to: [{ name: "Beta", email: "beta@example.test" }],
    hasAttachment: false,
    size: 12,
    source: { account: "beta", mailbox: "Inbox" },
  },
  {
    id: "alpha-1",
    subject: "Alpha unified message",
    date: "2026-09-18T09:00:00Z",
    flags: [{ iana: "seen", raw: "Seen" }],
    from: [{ name: "Alpha Sender", email: "alpha-sender@example.test" }],
    to: [{ name: "Alpha", email: "alpha@example.test" }],
    hasAttachment: false,
    size: 11,
    source: { account: "alpha", mailbox: "INBOX" },
  },
];

async function installSyntheticApi(page: Page): Promise<ApiCall[]> {
  const calls: ApiCall[] = [];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const call = {
      body: request.postData() ? request.postDataJSON() : null,
      method: request.method(),
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
    };
    calls.push(call);

    if (url.pathname === "/api/bootstrap") {
      await route.fulfill({ json: { accounts, addressWarning: null } });
    } else if (url.pathname === "/api/accounts/alpha/mailboxes") {
      await route.fulfill({ json: { mailboxes: [{ id: "INBOX", name: "Inbox", total: 1, unread: 1 }] } });
    } else if (url.pathname === "/api/accounts/beta/mailboxes") {
      await route.fulfill({ json: { mailboxes: [{ id: "Inbox", name: "Inbox", total: 1, unread: 1 }] } });
    } else if (url.pathname === "/api/accounts/alpha/messages") {
      await route.fulfill({ json: { envelopes: [normalEnvelope] } });
    } else if (url.pathname === "/api/unified/inbox") {
      await route.fulfill({ json: { envelopes: unifiedEnvelopes, hasMore: false, warnings: [] } });
    } else if (url.pathname === "/api/message") {
      const source = unifiedEnvelopes.find((envelope) => envelope.id === url.searchParams.get("message"));
      await route.fulfill({
        json: {
          ref: call.query,
          envelope: source,
          text: "Synthetic unified body",
          html: null,
          attachments: [],
        },
      });
    } else if (url.pathname === "/api/message/seen") {
      await route.fulfill({ json: { ok: true } });
    } else if (url.pathname === "/api/ai/assist") {
      await route.fulfill({
        json: { task: "summarize", text: "Unexpected AI response", provider: "synthetic", model: "synthetic", truncated: false },
      });
    } else {
      await route.abort();
      throw new Error(`Unexpected API request: ${request.method()} ${url.pathname}`);
    }
  });

  return calls;
}

test("combines the lazy account tree, persisted order, and source-aware unified inbox", async ({ page }) => {
  const calls = await installSyntheticApi(page);
  await page.addInitScript((key) => {
    localStorage.setItem(key, JSON.stringify({
      hidden: { active: true, visible: false },
      inactive: { active: false, visible: true },
    }));
  }, ACCOUNT_STATE_KEY);
  // Combined with account/order/unified behaviour, so start from a returning
  // session that had chosen account view, not the fresh-session unified default.
  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));
  await page.goto("/");

  const accountNames = page.locator(".account-tab[data-account] > span:not(.tab-unread-pill)");
  const alpha = page.locator('[data-account="alpha"]');
  const beta = page.locator('[data-account="beta"]');

  await expect(page.locator(".account-tab").first()).toBeVisible();
  await expect(accountNames).toHaveText(["alpha", "beta"]);
  await expect(alpha).toHaveAttribute("aria-current", "page");
  expect(calls.filter((call) => call.path === "/api/accounts/alpha/mailboxes")).toHaveLength(1);
  expect(calls.filter((call) => call.path === "/api/accounts/beta/mailboxes")).toHaveLength(0);

  await expect(page.locator(".mailbox-tab").filter({ hasText: "INBOX" })).toBeVisible();

  await page.getByRole("button", { name: "Konten verwalten", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Nach oben verschieben: beta", exact: true }).click();
  await page.getByRole("button", { name: "Kontenverwaltung schließen" }).click();
  await expect(accountNames).toHaveText(["beta", "alpha"]);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), ORDER_KEY))
    .toEqual(["beta", "alpha", "hidden", "inactive"]);

  await page.reload();
  await expect(accountNames).toHaveText(["beta", "alpha"]);

  await page.locator(".account-tab").first().click();
  await expect(page.getByRole("button", { name: /Beta unified message/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Alpha unified message/ })).toBeVisible();
  await expect(page.getByText("beta · Inbox", { exact: true })).toBeVisible();
  await expect(page.getByText("alpha · INBOX", { exact: true })).toBeVisible();

  const unifiedCall = calls.find((call) => call.path === "/api/unified/inbox");
  expect(unifiedCall).toMatchObject({
    method: "POST",
    body: { accounts: ["beta", "alpha"], page: 1, pageSize: 50, field: "all", q: "", unread: false },
  });

  await page.getByRole("button", { name: /Beta unified message/ }).click();
  await expect(page.getByRole("heading", { name: "Beta unified message", exact: true })).toBeVisible();
  await expect(page.getByText("Synthetic unified body", { exact: true })).toBeVisible();

  const sourceRef = { account: "beta", mailbox: "Inbox", message: "beta-1" };
  const detailCall = calls.find((call) => call.path === "/api/message");
  expect(detailCall?.query).toEqual(sourceRef);
  await expect.poll(() => calls.find((call) => call.path === "/api/message/seen")?.body)
    .toEqual({ ref: sourceRef, seen: true });
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  expect(calls.filter((call) => call.path === "/api/ai/assist")).toHaveLength(0);
});
