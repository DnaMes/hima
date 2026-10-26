import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const SENDER = "anna@evil.example";
const current = {
  id: "7", date: "2026-10-02T05:20:00Z", flags: [], from: [{ name: "Anna", email: SENDER }],
  to: [{ name: "Synthetic", email: "synthetic@example.test" }], subject: "Statusmail", size: 12, hasAttachment: false,
};

type Recorded = { statusBodies: any[]; reportBodies: any[] };
const second = { ...current, id: "8", subject: "Zweite Mail", from: [{ name: "Ben", email: "ben@example.test" }] };

type Options = {
  reportResponse?: { moved: boolean; mailbox: string | null };
  gate?: Promise<void>;
  reportGate?: Promise<void>;
  /** The server's cached list verdict for the first message. */
  listRisk?: "high";
  /** The verdict the detail route reports once the sender is trusted. */
  riskAfterTrust?: { level: "high"; score: number; reasons: string[] };
};

async function setup(page: Page, options: Options = {}): Promise<Recorded> {
  const recorded: Recorded = { statusBodies: [], reportBodies: [] };
  let trust: "trusted" | "blocked" | null = null;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/bootstrap") {
      await route.fulfill({ json: { accounts: [{ name: "alpha", default: true, backends: ["imap"], email: "alpha@example.test" }], addressWarning: null } });
    } else if (url.pathname.endsWith("/mailboxes")) {
      await route.fulfill({ json: { mailboxes: [{ id: "INBOX", name: "INBOX", total: 1, unread: 0 }] } });
    } else if (url.pathname.endsWith("/messages")) {
      await route.fulfill({ json: { envelopes: [{ ...current, ...(options.listRisk ? { risk: options.listRisk } : {}) }, second] } });
    } else if (url.pathname === "/api/message") {
      const envelope = url.searchParams.get("message") === "8" ? second : current;
      const risk = trust === "trusted" && options.riskAfterTrust ? options.riskAfterTrust : { level: "none", score: 0, reasons: [] };
      await route.fulfill({ json: {
        ref: Object.fromEntries(url.searchParams), envelope, text: "Inhalt", html: null, attachments: [],
        sender: { replyTo: null, returnPath: envelope.from[0]!.email, messageIdDomain: "evil.example", auth: null, received: [], risk, trust },
      } });
    } else if (url.pathname === "/api/message/seen") {
      await route.fulfill({ json: { ok: true } });
    } else if (url.pathname === "/api/senders/status") {
      const body = request.postDataJSON();
      recorded.statusBodies.push(body);
      await options.gate;
      trust = body.status;
      await route.fulfill({ json: { ok: true } });
    } else if (url.pathname === "/api/message/report") {
      recorded.reportBodies.push(request.postDataJSON());
      await options.reportGate;
      trust = "blocked";
      await route.fulfill({ json: { ok: true, ...(options.reportResponse ?? { moved: true, mailbox: "Junk" }) } });
    } else {
      await route.abort();
      throw new Error(`Unexpected API request: ${url.pathname}`);
    }
  });
  await page.addInitScript(() => localStorage.setItem("himalaya-web-last-view", "account"));
  await page.goto("/");
  await page.getByRole("button", { name: /Statusmail/ }).click();
  await expect(page.getByRole("heading", { name: "Statusmail" })).toBeVisible();
  await page.getByText("Absenderdetails").click();
  return recorded;
}

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

test("trusts the sender and revokes it again, reloading the message each time", async ({ page }) => {
  const recorded = await setup(page);
  await expect(page.getByText("Nicht eingestuft")).toBeVisible();

  await button(page, "Absender vertrauen").click();
  await expect(page.getByText("Vertrauenswürdig", { exact: true })).toBeVisible();
  await expect(page.getByText("Absender wird vertraut.")).toBeVisible();

  await button(page, "Vertrauen widerrufen").click();
  await expect(page.getByText("Nicht eingestuft")).toBeVisible();
  await expect(page.getByText("Vertrauen widerrufen.")).toBeVisible();
  expect(recorded.statusBodies).toEqual([{ email: SENDER, status: "trusted" }, { email: SENDER, status: null }]);
});

test("reports after the confirmation: the mail moves away and the reader closes", async ({ page }) => {
  const recorded = await setup(page);
  const message = new Promise<string>((resolve) => page.once("dialog", (dialog) => { resolve(dialog.message()); void dialog.accept(); }));
  await button(page, "Als Phishing melden").click();

  expect(await message).toContain("Junk");
  await expect(page.getByText("Mail in Junk verschoben und Absender gemeldet.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Statusmail" })).toHaveCount(0);
  expect(recorded.reportBodies).toEqual([{ ref: { account: "alpha", mailbox: "INBOX", message: "7" } }]);
});

test("a dismissed confirmation reports nothing", async ({ page }) => {
  const recorded = await setup(page);
  page.once("dialog", (dialog) => void dialog.dismiss());
  await button(page, "Als Phishing melden").click();

  await page.waitForTimeout(300);
  expect(recorded.reportBodies).toEqual([]);
});

test("without a Junk folder the sender is only remembered, the reader stays open, and the report can be revoked", async ({ page }) => {
  const recorded = await setup(page, { reportResponse: { moved: false, mailbox: null } });
  page.once("dialog", (dialog) => void dialog.accept());
  await button(page, "Als Phishing melden").click();

  await expect(page.getByText("Absender gemeldet (kein Junk-Ordner gefunden).")).toBeVisible();
  await expect(page.getByText("Als Phishing gemeldet", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Statusmail" })).toBeVisible();

  await button(page, "Meldung widerrufen").click();
  await expect(page.getByText("Meldung widerrufen.")).toBeVisible();
  expect(recorded.statusBodies).toEqual([{ email: SENDER, status: null }]);
});

test("the buttons are disabled while a status change runs, so a second click sends nothing", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const recorded = await setup(page, { gate });
  await button(page, "Absender vertrauen").click();

  await expect(button(page, "Absender vertrauen")).toBeDisabled();
  await expect(button(page, "Als Phishing melden")).toBeDisabled();
  expect(recorded.statusBodies).toHaveLength(1);
  release();
  await expect(page.getByText("Vertrauenswürdig", { exact: true })).toBeVisible();
  expect(recorded.statusBodies).toHaveLength(1);
});

test("a report that finishes after another message was opened leaves that message open", async ({ page }) => {
  let release!: () => void;
  const reportGate = new Promise<void>((resolve) => { release = resolve; });
  const recorded = await setup(page, { reportGate });
  page.once("dialog", (dialog) => void dialog.accept());
  await button(page, "Als Phishing melden").click();
  await expect.poll(() => recorded.reportBodies.length).toBe(1);

  await page.getByRole("button", { name: /Zweite Mail/ }).click();
  await expect(page.getByRole("heading", { name: "Zweite Mail" })).toBeVisible();
  release();

  await expect(page.getByText("Mail in Junk verschoben und Absender gemeldet.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Zweite Mail" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Statusmail/ })).toHaveCount(0);
});

test("keeps the list warning when the trusted sender's message still fails authentication", async ({ page }) => {
  const risk = { level: "high" as const, score: 70, reasons: ["Vertrauter Absender, aber die Absenderprüfung ist fehlgeschlagen (mögliche Fälschung)."] };
  await setup(page, { listRisk: "high", riskAfterTrust: risk });
  const row = page.getByRole("button", { name: /Statusmail/ });
  await expect(row.locator(".badge-phishing")).toBeVisible();

  await button(page, "Absender vertrauen").click();
  await expect(page.getByText("Absender wird vertraut.")).toBeVisible();

  await expect(row.locator(".badge-phishing")).toBeVisible();
});

test("drops the list warning once trusting makes the sender's verdict clean", async ({ page }) => {
  await setup(page, { listRisk: "high" });
  const row = page.getByRole("button", { name: /Statusmail/ });
  await expect(row.locator(".badge-phishing")).toBeVisible();

  await button(page, "Absender vertrauen").click();
  await expect(page.getByText("Absender wird vertraut.")).toBeVisible();

  await expect(row.locator(".badge-phishing")).toHaveCount(0);
});
