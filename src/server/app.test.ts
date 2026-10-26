import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Account, Attachment, Envelope, Mailbox, MessageDetail, MessageRef } from "../shared/types.js";
import { createApp, type HimalayaService } from "./app.js";
import type { AiProvider } from "./ai.js";
import { HimalayaError } from "./himalaya.js";

const accounts: Account[] = [{ name: "andre", default: true, backends: ["imap", "smtp"], email: null }];
const mailboxes: Mailbox[] = [{ id: "INBOX", name: "INBOX", total: 1, unread: 1 }];
const envelope: Envelope = {
  id: "7",
  date: null,
  flags: [{ iana: null, raw: "\\Seen" }],
  from: [],
  to: [],
  subject: "Hello",
  size: 12,
  hasAttachment: false,
};
const attachment: Attachment = {
  id: "2",
  filename: "report.pdf",
  mime: "application/pdf",
  size: 42,
  inline: false,
};
const detail: MessageDetail = {
  ref: { account: "andre", mailbox: "INBOX", message: "7" },
  envelope,
  text: "Hello",
  html: null,
  attachments: [attachment],
  sender: { replyTo: null, returnPath: null, messageIdDomain: null, auth: null, received: [], risk: { level: "none", score: 0, reasons: [] }, trust: null },
};

function fakeService(): HimalayaService {
  return {
    listAccounts: async () => ({ accounts, addressWarning: null }),
    listMailboxes: async () => mailboxes,
    listEnvelopes: async () => [envelope],
    readRaw: async () => Buffer.from("From: alice@example.org\r\n\r\nHello\r\n"),
    listAttachments: async () => [attachment],
    setSeen: async () => undefined,
    setFlag: async () => undefined,
    move: async () => undefined,
    copy: async () => undefined,
    addRaw: async () => undefined,
    downloadAttachment: async () => ({ data: Buffer.from("pdf"), filename: "report.pdf" }),
    composePreview: async () => "MIME preview",
    composeSend: async () => undefined,
    deleteMessage: async () => undefined,
  };
}

// Both the delete and the send route read accounts.json, so every test that
// depends on its contents pins the path instead of reading the real user file.
async function withAccountsConfig<T>(
  contents: Record<string, unknown> | null,
  run: () => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "himalaya-web-accounts-config-test-"));
  const path = join(directory, "accounts.json");
  if (contents) await writeFile(path, JSON.stringify(contents));
  const previous = process.env.HIMALAYA_WEB_ACCOUNTS_PATH;
  process.env.HIMALAYA_WEB_ACCOUNTS_PATH = path;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.HIMALAYA_WEB_ACCOUNTS_PATH;
    else process.env.HIMALAYA_WEB_ACCOUNTS_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

// createApp() always starts a real watcher (Task 4), which reads
// accounts.json on its very first, immediate tick — independent of which
// route a given test actually exercises. Without this, any test that
// doesn't call withAccountsConfig itself is silently vulnerable to
// whatever the real operator's ~/.config/himalaya-web/accounts.json
// happens to contain (e.g. an account with watch: true pollutes
// service.listMailboxes' spy call list from a background tick racing the
// test's own assertions). Pin every test in this file to a nonexistent
// path by default; withAccountsConfig's own save/restore composes safely
// on top of this.
let defaultAccountsPathPrevious: string | undefined;
let previousSendersPath: string | undefined;
let previousRulesPath: string | undefined;
let previousSnoozePath: string | undefined;
let previousLabelsPath: string | undefined;
beforeEach(() => {
  defaultAccountsPathPrevious = process.env.HIMALAYA_WEB_ACCOUNTS_PATH;
  process.env.HIMALAYA_WEB_ACCOUNTS_PATH = join(tmpdir(), "himalaya-web-app-test-no-accounts-file", "accounts.json");
  previousRulesPath = process.env.HIMALAYA_WEB_RULES_PATH;
  process.env.HIMALAYA_WEB_RULES_PATH = join(tmpdir(), "himalaya-web-app-test-no-rules-file", "rules.json");
  previousSendersPath = process.env.HIMALAYA_WEB_SENDERS_PATH;
  process.env.HIMALAYA_WEB_SENDERS_PATH = join(tmpdir(), "himalaya-web-app-test-no-senders-file", "senders.json");
  previousSnoozePath = process.env.HIMALAYA_WEB_SNOOZE_PATH;
  process.env.HIMALAYA_WEB_SNOOZE_PATH = join(tmpdir(), "himalaya-web-app-test-no-snooze-file", "snoozed.json");
  previousLabelsPath = process.env.HIMALAYA_WEB_LABELS_PATH;
  process.env.HIMALAYA_WEB_LABELS_PATH = join(tmpdir(), "himalaya-web-app-test-no-labels-file", "labels.json");
});
afterEach(() => {
  if (defaultAccountsPathPrevious === undefined) delete process.env.HIMALAYA_WEB_ACCOUNTS_PATH;
  else process.env.HIMALAYA_WEB_ACCOUNTS_PATH = defaultAccountsPathPrevious;
  if (previousRulesPath === undefined) delete process.env.HIMALAYA_WEB_RULES_PATH;
  else process.env.HIMALAYA_WEB_RULES_PATH = previousRulesPath;
  if (previousSendersPath === undefined) delete process.env.HIMALAYA_WEB_SENDERS_PATH;
  else process.env.HIMALAYA_WEB_SENDERS_PATH = previousSendersPath;
  if (previousSnoozePath === undefined) delete process.env.HIMALAYA_WEB_SNOOZE_PATH;
  else process.env.HIMALAYA_WEB_SNOOZE_PATH = previousSnoozePath;
  if (previousLabelsPath === undefined) delete process.env.HIMALAYA_WEB_LABELS_PATH;
  else process.env.HIMALAYA_WEB_LABELS_PATH = previousLabelsPath;
});

describe("unified inbox", () => {
  const headers = { host: "127.0.0.1", "x-himalaya-session": "test-token" };

  it.each([
    { name: "missing session", headers: { host: "127.0.0.1" }, status: 401, code: "UNAUTHORIZED" },
    { name: "wrong session", headers: { ...headers, "x-himalaya-session": "wrong-token" }, status: 401, code: "UNAUTHORIZED" },
    { name: "remote host", headers: { ...headers, host: "remote.example.test" }, status: 403, code: "LOCAL_ONLY" },
    { name: "remote origin", headers: { ...headers, origin: "https://remote.example.test" }, status: 403, code: "LOCAL_ONLY" },
  ])("requires the local session and loopback boundary: $name", async ({ headers, status, code }) => {
    const service = fakeService();
    const mailboxCalls = vi.spyOn(service, "listMailboxes");
    const envelopeCalls = vi.spyOn(service, "listEnvelopes");
    const app = await createApp(service, { token: "test-token" });
    try {
      const response = await app.inject({ method: "POST", url: "/api/unified/inbox", headers, payload: { accounts: ["andre"] } });
      expect(response.statusCode).toBe(status);
      expect(response.json().code).toBe(code);
      expect(mailboxCalls).not.toHaveBeenCalled();
      expect(envelopeCalls).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("blocks URL-encoded API requests that lack valid session auth", async () => {
    const service = fakeService();
    const app = await createApp(service, { token: "test-token" });
    try {
      const res = await app.inject({ method: "GET", url: "/%61pi/bootstrap", headers: { host: "127.0.0.1" } });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe("UNAUTHORIZED");
    } finally {
      await app.close();
    }
  });

  it("blocks foreign host requests on the root path", async () => {
    const service = fakeService();
    const app = await createApp(service, { token: "test-token" });
    try {
      const res = await app.inject({ method: "GET", url: "/", headers: { host: "attacker.example.test" } });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("LOCAL_ONLY");
    } finally {
      await app.close();
    }
  });

  it.each(["all", "subject", "from", "to", "body"])("passes only submitted account aliases and %s filters to the aggregate service", async (field) => {
    const service = fakeService();
    const mailboxCalls = vi.spyOn(service, "listMailboxes").mockResolvedValue([{ ...mailboxes[0]!, id: "primary", name: "Inbox" }]);
    const envelopeCalls = vi.spyOn(service, "listEnvelopes").mockResolvedValue([]);
    const accountCalls = vi.spyOn(service, "listAccounts");
    const rawCalls = vi.spyOn(service, "readRaw");
    const attachmentCalls = vi.spyOn(service, "listAttachments");
    const app = await createApp(service, { token: "test-token" });
    try {
      const response = await app.inject({
        method: "POST", url: "/api/unified/inbox", headers,
        payload: { accounts: ["andre", "anna"], page: 1, pageSize: 25, field, q: "invoice", unread: true },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toEqual({ envelopes: [], warnings: [], hasMore: false });
      expect(mailboxCalls.mock.calls).toEqual([["andre", { counts: false }], ["anna", { counts: false }]]);
      expect(envelopeCalls.mock.calls).toEqual([
        [{ account: "andre", mailbox: "primary", page: 1, pageSize: 100, search: { field, text: "invoice", unread: true } }],
        [{ account: "anna", mailbox: "primary", page: 1, pageSize: 100, search: { field, text: "invoice", unread: true } }],
      ]);
      expect(accountCalls).not.toHaveBeenCalled();
      expect(rawCalls).not.toHaveBeenCalled();
      expect(attachmentCalls).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([
    { name: "defaults", options: {}, firstId: "00", count: 50, search: undefined },
    { name: "second page", options: { page: 2, pageSize: 2 }, firstId: "02", count: 2, search: undefined },
    { name: "unread without text runs a real search", options: { q: "", unread: true }, firstId: "00", count: 50, search: { field: "all", text: "", unread: true } },
    { name: "empty query without any filter", options: { q: "" }, firstId: "00", count: 50, search: undefined },
    { name: "whitespace query", options: { q: "  " }, firstId: "00", count: 50, search: undefined },
    { name: "search defaults", options: { q: "invoice" }, firstId: "00", count: 50, search: { field: "all", text: "invoice", unread: false } },
  ])("applies paging and search normalization: $name", async ({ options, firstId, count, search }) => {
    const service = fakeService();
    const envelopeCalls = vi.spyOn(service, "listEnvelopes").mockResolvedValue(
      Array.from({ length: 51 }, (_, index) => ({ ...envelope, id: String(index).padStart(2, "0") })),
    );
    const app = await createApp(service, { token: "test-token" });
    try {
      const response = await app.inject({ method: "POST", url: "/api/unified/inbox", headers, payload: { accounts: ["andre"], ...options } });
      expect(response.statusCode).toBe(200);
      const result = response.json();
      expect(result.envelopes).toHaveLength(count);
      expect(result.envelopes[0]).toEqual({ ...envelope, id: firstId, source: { account: "andre", mailbox: "INBOX" } });
      expect(result.hasMore).toBe(true);
      expect(result.warnings).toEqual([]);
      expect(envelopeCalls.mock.calls).toEqual([[
        { account: "andre", mailbox: "INBOX", page: 1, pageSize: 100, ...(search ? { search } : {}) },
      ]]);
    } finally {
      await app.close();
    }
  });

  it.each([
    ["missing accounts", {}],
    ["non-array accounts", { accounts: "andre" }],
    ["non-string alias", { accounts: [42] }],
    ["empty alias", { accounts: [""] }],
    ["long alias", { accounts: ["a".repeat(513)] }],
    ["NUL alias", { accounts: ["andre", "bad\u0000alias"] }],
    ["too many accounts", { accounts: Array.from({ length: 101 }, (_, index) => `account-${index}`) }],
    ["zero page", { accounts: ["andre"], page: 0 }],
    ["large page", { accounts: ["andre"], page: 11 }],
    ["fractional page", { accounts: ["andre"], page: 1.5 }],
    ["string page", { accounts: ["andre"], page: "1" }],
    ["zero page size", { accounts: ["andre"], pageSize: 0 }],
    ["large page size", { accounts: ["andre"], pageSize: 51 }],
    ["fractional page size", { accounts: ["andre"], pageSize: 1.5 }],
    ["string page size", { accounts: ["andre"], pageSize: "25" }],
    ["unknown field", { accounts: ["andre"], field: "attachments" }],
    ["long query", { accounts: ["andre"], q: "q".repeat(513) }],
    ["non-string query", { accounts: ["andre"], q: 42 }],
    ["string unread", { accounts: ["andre"], unread: "true" }],
  ])("rejects invalid input before invoking Himalaya: %s", async (_name, payload) => {
    const service = fakeService();
    const mailboxCalls = vi.spyOn(service, "listMailboxes");
    const envelopeCalls = vi.spyOn(service, "listEnvelopes");
    const rawCalls = vi.spyOn(service, "readRaw");
    const app = await createApp(service, { token: "test-token" });
    try {
      const response = await app.inject({ method: "POST", url: "/api/unified/inbox", headers, payload });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("INVALID_REQUEST");
      expect(mailboxCalls).not.toHaveBeenCalled();
      expect(envelopeCalls).not.toHaveBeenCalled();
      expect(rawCalls).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([
    { name: "empty selection", aliases: [] },
    { name: "maximum aliases and alias length", aliases: Array.from({ length: 100 }, (_, index) => String(index).padStart(512, "a")) },
  ])("accepts valid bounds: $name", async ({ aliases }) => {
    const service = fakeService();
    const mailboxCalls = vi.spyOn(service, "listMailboxes");
    vi.spyOn(service, "listEnvelopes").mockResolvedValue([]);
    const app = await createApp(service, { token: "test-token" });
    try {
      const response = await app.inject({
        method: "POST", url: "/api/unified/inbox", headers,
        payload: { accounts: aliases, page: 10, pageSize: 50, q: "q".repeat(512), unread: false },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toEqual({ envelopes: [], warnings: [], hasMore: false });
      expect(mailboxCalls.mock.calls).toEqual(aliases.map((alias) => [alias, { counts: false }]));
    } finally {
      await app.close();
    }
  });

  it("does not advertise an invalid page after the maximum unified page", async () => {
    const service = fakeService();
    vi.spyOn(service, "listEnvelopes").mockImplementation(async ({ page, pageSize }) => (
      Array.from({ length: pageSize }, (_, index) => ({
        ...envelope,
        id: String((page - 1) * pageSize + index).padStart(3, "0"),
      }))
    ));
    const app = await createApp(service, { token: "test-token" });
    try {
      const response = await app.inject({
        method: "POST", url: "/api/unified/inbox", headers,
        payload: { accounts: ["andre"], page: 10, pageSize: 50 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ hasMore: false });
    } finally {
      await app.close();
    }
  });

  it("returns source metadata and safe partial warnings without raw provider output", async () => {
    const service = fakeService();
    vi.spyOn(service, "listMailboxes").mockImplementation(async (account) => {
      if (account === "anna") throw new Error("synthetic raw command output");
      return mailboxes;
    });
    const rawCalls = vi.spyOn(service, "readRaw");
    const app = await createApp(service, { token: "test-token" });
    try {
      const response = await app.inject({ method: "POST", url: "/api/unified/inbox", headers, payload: { accounts: ["andre", "anna"] } });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toEqual({
        envelopes: [{ ...envelope, source: { account: "andre", mailbox: "INBOX" } }],
        warnings: [{ account: "anna", code: "MAIL_OPERATION_FAILED", message: "Das Konto konnte nicht geladen werden." }],
        hasMore: false,
      });
      expect(response.body).not.toContain("synthetic raw command output");
      expect(rawCalls).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

describe("local API", () => {
  it("injects the local session into the browser entry page", async () => {
    const directory = await mkdtemp(join(tmpdir(), "himalaya-web-test-"));
    await writeFile(join(directory, "index.html"), "<!doctype html><html><head></head><body></body></html>");

    const app = await createApp(fakeService(), { token: "test-token", staticDir: directory });
    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<meta name="himalaya-session" content="test-token"');
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("serves built client assets from the local entrypoint", async () => {
    const directory = await mkdtemp(join(tmpdir(), "himalaya-web-assets-test-"));
    await mkdir(join(directory, "assets"));
    await writeFile(join(directory, "index.html"), "<!doctype html><html><head></head><body></body></html>");
    await writeFile(join(directory, "assets", "app.js"), "console.log('synthetic asset');");

    const app = await createApp(fakeService(), { token: "test-token", staticDir: directory });
    const response = await app.inject({ method: "GET", url: "/assets/app.js" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("synthetic asset");
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("serves a newly built asset without requiring a process restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "himalaya-web-live-assets-test-"));
    await mkdir(join(directory, "assets"));
    await writeFile(join(directory, "index.html"), "<!doctype html><html><head></head><body></body></html>");

    const app = await createApp(fakeService(), { token: "test-token", staticDir: directory });
    await writeFile(join(directory, "assets", "new-build.js"), "console.log('new build');");
    const response = await app.inject({ method: "GET", url: "/assets/new-build.js" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("new build");
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("requires the ephemeral session token before serving API data", async () => {
    const app = await createApp(fakeService(), { token: "test-token" });
    const response = await app.inject({ method: "GET", url: "/api/bootstrap" });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("includes configured account addresses in the bootstrap response", async () => {
    const addressService = {
      ...fakeService(),
      listAccounts: async () => ({
        accounts: [{
          name: "andre",
          default: true,
          backends: ["imap", "smtp"],
          email: "andre@example.test",
        }],
        addressWarning: null,
      }),
    };
    const app = await createApp(addressService, { token: "test-token" });
    const response = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: {
        host: "127.0.0.1",
        "x-himalaya-session": "test-token",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      accounts: [{ name: "andre", default: true, backends: ["imap", "smtp"], email: "andre@example.test" }],
      snoozed: [],
      labels: [],
      addressWarning: null,
    });
    await app.close();
  });

  it("scopes a message request to the account, mailbox, and message reference", async () => {
    const service = fakeService();
    const app = await createApp(service, { token: "test-token" });
    const response = await app.inject({
      method: "GET",
      url: "/api/message?account=andre&mailbox=INBOX&message=7",
      headers: {
        host: "127.0.0.1",
        "x-himalaya-session": "test-token",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().ref).toEqual({ account: "andre", mailbox: "INBOX", message: "7" });
    await app.close();
  });

  it("returns actionable Gmail authentication errors from mailbox operations", async () => {
    const service: HimalayaService = {
      ...fakeService(),
      listMailboxes: async () => {
        throw new HimalayaError(
          "Gmail benötigt ein App-Passwort oder eine OAuth2-Anmeldung. Prüfe die Zugangsdaten dieses Kontos.",
          "AUTH_REQUIRED",
          false,
        );
      },
    };
    const app = await createApp(service, { token: "test-token" });
    const response = await app.inject({
      method: "GET",
      url: "/api/accounts/andre/mailboxes",
      headers: {
        host: "127.0.0.1",
        "x-himalaya-session": "test-token",
      },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({
      error: "Gmail benötigt ein App-Passwort oder eine OAuth2-Anmeldung. Prüfe die Zugangsdaten dieses Kontos.",
      code: "AUTH_REQUIRED",
      retryable: false,
    });
    await app.close();
  });

  it("exports a selected message as Markdown with download headers", async () => {
    const service: HimalayaService = {
      ...fakeService(),
      readRaw: async () => Buffer.from([
        "From: Alice <alice@example.test>",
        "To: andre@example.test",
        "Subject: Export me",
        "Date: Fri, 18 Sep 2026 09:30:00 +0000",
        "",
        "Synthetic export body",
      ].join("\r\n")),
    };
    const app = await createApp(service, { token: "test-token" });
    const response = await app.inject({
      method: "GET",
      url: "/api/message/export?account=andre&mailbox=INBOX&message=7&format=markdown",
      headers: {
        host: "127.0.0.1",
        "x-himalaya-session": "test-token",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/markdown");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-disposition"]).toContain("attachment");
    expect(response.body).toContain("# Export me");
    expect(response.body).toContain("Synthetic export body");
    expect(response.body).toContain("report.pdf");
    await app.close();
  });

  it("rejects unsupported message export formats", async () => {
    const app = await createApp(fakeService(), { token: "test-token" });
    const response = await app.inject({
      method: "GET",
      url: "/api/message/export?account=andre&mailbox=INBOX&message=7&format=pdf",
      headers: {
        host: "127.0.0.1",
        "x-himalaya-session": "test-token",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("INVALID_REQUEST");
    await app.close();
  });

  it("requires the session token before exporting a message", async () => {
    const app = await createApp(fakeService(), { token: "test-token" });
    const response = await app.inject({
      method: "GET",
      url: "/api/message/export?account=andre&mailbox=INBOX&message=7&format=markdown",
      headers: { host: "127.0.0.1" },
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("runs an explicit authenticated AI action against the selected message", async () => {
    const calls: string[] = [];
    const ai: AiProvider = {
      provider: "minimax",
      model: "MiniMax-M3",
      complete: async ({ task }) => {
        calls.push(task);
        return { text: "Synthetic summary", truncated: false };
      },
    };
    const app = await createApp(fakeService(), { token: "test-token", ai });
    const response = await app.inject({
      method: "POST",
      url: "/api/ai/assist",
      headers: {
        host: "127.0.0.1",
        "x-himalaya-session": "test-token",
        "content-type": "application/json",
      },
      payload: { ref: { account: "andre", mailbox: "INBOX", message: "7" }, task: "summarize" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ task: "summarize", text: "Synthetic summary", provider: "minimax", model: "MiniMax-M3", truncated: false });
    expect(calls).toEqual(["summarize"]);
    await app.close();
  });

  it("rejects an unsupported AI task before reading mail", async () => {
    const service = fakeService();
    let reads = 0;
    service.readRaw = async () => {
      reads += 1;
      return Buffer.from("From: alice@example.org\r\n\r\nHello\r\n");
    };
    const app = await createApp(service, { token: "test-token", ai: {
      provider: "minimax",
      model: "MiniMax-M3",
      complete: async () => ({ text: "unused", truncated: false }),
    } });
    const response = await app.inject({
      method: "POST",
      url: "/api/ai/assist",
      headers: {
        host: "127.0.0.1",
        "x-himalaya-session": "test-token",
        "content-type": "application/json",
      },
      payload: { ref: { account: "andre", mailbox: "INBOX", message: "7" }, task: "send" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("INVALID_REQUEST");
    expect(reads).toBe(0);
    await app.close();
  });

  it("reports an unavailable AI provider without reading mail", async () => {
    const service = fakeService();
    let reads = 0;
    service.readRaw = async () => {
      reads += 1;
      return Buffer.from("From: alice@example.org\r\n\r\nHello\r\n");
    };
    const app = await createApp(service, { token: "test-token" });
    const response = await app.inject({
      method: "POST",
      url: "/api/ai/assist",
      headers: {
        host: "127.0.0.1",
        "x-himalaya-session": "test-token",
        "content-type": "application/json",
      },
      payload: { ref: { account: "andre", mailbox: "INBOX", message: "7" }, task: "summarize" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe("AI_UNAVAILABLE");
    expect(reads).toBe(0);
    await app.close();
  });

  it("keeps the AI endpoint behind the local session boundary", async () => {
    const app = await createApp(fakeService(), {
      token: "test-token",
      ai: { provider: "minimax", model: "MiniMax-M3", complete: async () => ({ text: "unused", truncated: false }) },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/ai/assist",
      headers: { host: "127.0.0.1", "content-type": "application/json" },
      payload: { ref: { account: "andre", mailbox: "INBOX", message: "7" }, task: "summarize" },
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("rejects a second concurrent AI request for the same session", async () => {
    let release: ((value: { text: string; truncated: boolean }) => void) | undefined;
    const pending = new Promise<{ text: string; truncated: boolean }>((resolve) => { release = resolve; });
    const ai: AiProvider = {
      provider: "minimax",
      model: "MiniMax-M3",
      complete: async () => pending,
    };
    const app = await createApp(fakeService(), { token: "test-token", ai });
    const request = {
      method: "POST" as const,
      url: "/api/ai/assist",
      headers: {
        host: "127.0.0.1",
        "x-himalaya-session": "test-token",
        "content-type": "application/json",
      },
      payload: { ref: { account: "andre", mailbox: "INBOX", message: "7" }, task: "summarize" },
    };
    const first = app.inject(request);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const second = await app.inject(request);

    expect(second.statusCode).toBe(429);
    expect(second.json().code).toBe("AI_BUSY");
    release?.({ text: "Synthetic summary", truncated: false });
    expect((await first).statusCode).toBe(200);
    await app.close();
  });
});

describe("compose preview, draft, delete, and special folders", () => {
  const headers = { host: "127.0.0.1", "x-himalaya-session": "test-token" };
  const composeBody = {
    account: "andre", mode: "new", to: ["alice@example.test"], cc: [], bcc: [],
    subject: "Hello", body: "Hi", includeOriginalAttachments: false,
  };

  it("previews without calling send", async () => {
    const service = fakeService();
    const previewCalls = vi.spyOn(service, "composePreview").mockResolvedValue("From: andre\r\n\r\nHi\r\n");
    const sendCalls = vi.spyOn(service, "composeSend");
    const app = await createApp(service, { token: "test-token" });
    try {
      const response = await app.inject({ method: "POST", url: "/api/compose/preview", headers, payload: composeBody });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ mime: "From: andre\r\n\r\nHi\r\n" });
      expect(previewCalls).toHaveBeenCalledTimes(1);
      expect(sendCalls).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("rejects a preview payload with a header-injection attempt", async () => {
    const app = await createApp(fakeService(), { token: "test-token" });
    try {
      const response = await app.inject({
        method: "POST", url: "/api/compose/preview", headers,
        payload: { ...composeBody, subject: "Hi\nBcc: eve@evil.test" },
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("saves a draft to the account's Drafts mailbox without sending", async () => {
    const service = fakeService();
    vi.spyOn(service, "listMailboxes").mockResolvedValue([{ id: "Drafts", name: "Drafts", total: 0, unread: 0 }]);
    const sendCalls = vi.spyOn(service, "composeSend").mockResolvedValue(undefined);
    const app = await createApp(service, { token: "test-token" });
    try {
      const response = await app.inject({ method: "POST", url: "/api/compose/draft", headers, payload: composeBody });
      expect(response.statusCode).toBe(200);
      expect(sendCalls).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "new" }),
        { send: false, saveTo: "Drafts", attachmentPaths: [] },
      );
    } finally {
      await app.close();
    }
  });

  it("preserves a reply's mode and sourceRef when saving a draft", async () => {
    const service = fakeService();
    vi.spyOn(service, "listMailboxes").mockResolvedValue([{ id: "Drafts", name: "Drafts", total: 0, unread: 0 }]);
    const sendCalls = vi.spyOn(service, "composeSend").mockResolvedValue(undefined);
    const app = await createApp(service, { token: "test-token" });
    const sourceRef = { account: "andre", mailbox: "INBOX", message: "7" };
    const replyBody = { ...composeBody, mode: "reply", sourceRef };
    try {
      const response = await app.inject({ method: "POST", url: "/api/compose/draft", headers, payload: replyBody });
      expect(response.statusCode).toBe(200);
      expect(sendCalls).toHaveBeenCalledTimes(1);
      const [sentRequest] = sendCalls.mock.calls[0]!;
      expect(sentRequest.mode).toBe("reply");
      expect(sentRequest.sourceRef).toEqual(sourceRef);
    } finally {
      await app.close();
    }
  });

  it("saves a draft into a configured Drafts override", async () => {
    const service = fakeService();
    vi.spyOn(service, "listMailboxes").mockResolvedValue([
      { id: "Drafts", name: "Drafts", total: 0, unread: 0 },
      { id: "Entwuerfe", name: "Eigene Entwürfe", total: 0, unread: 0 },
    ]);
    const sendCalls = vi.spyOn(service, "composeSend").mockResolvedValue(undefined);
    await withAccountsConfig({ andre: { overrides: { drafts: "Entwuerfe" }, sentCopy: "auto" } }, async () => {
      const app = await createApp(service, { token: "test-token" });
      try {
        const response = await app.inject({ method: "POST", url: "/api/compose/draft", headers, payload: composeBody });
        expect(response.statusCode).toBe(200);
        expect(sendCalls).toHaveBeenCalledWith(
          expect.objectContaining({ mode: "new" }),
          { send: false, saveTo: "Entwuerfe", attachmentPaths: [] },
        );
      } finally {
        await app.close();
      }
    });
  });

  it("reports a missing Drafts mailbox as not found", async () => {
    const service = fakeService();
    vi.spyOn(service, "listMailboxes").mockResolvedValue([{ id: "INBOX", name: "INBOX", total: 0, unread: 0 }]);
    const sendCalls = vi.spyOn(service, "composeSend");
    const app = await createApp(service, { token: "test-token" });
    try {
      const response = await app.inject({ method: "POST", url: "/api/compose/draft", headers, payload: composeBody });
      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe("FOLDER_NOT_FOUND");
      expect(sendCalls).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  const trashMailboxes: Mailbox[] = [
    { id: "INBOX", name: "INBOX", total: 1, unread: 1 },
    { id: "Trash", name: "Trash", total: 0, unread: 0 },
  ];

  it("moves a message that is not in the resolved trash instead of deleting it", async () => {
    const service = fakeService();
    vi.spyOn(service, "listMailboxes").mockResolvedValue(trashMailboxes);
    const moveCalls = vi.spyOn(service, "move").mockResolvedValue(undefined);
    const deleteCalls = vi.spyOn(service, "deleteMessage");
    await withAccountsConfig(null, async () => {
      const app = await createApp(service, { token: "test-token" });
      try {
        const response = await app.inject({
          method: "POST", url: "/api/message/delete", headers,
          payload: { ref: { account: "andre", mailbox: "INBOX", message: "7" } },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ ok: true, permanent: false });
        expect(moveCalls).toHaveBeenCalledWith({ account: "andre", mailbox: "INBOX", message: "7" }, "Trash");
        expect(deleteCalls).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });
  });

  it("honours a configured trash override when deciding where a delete lands", async () => {
    const service = fakeService();
    vi.spyOn(service, "listMailboxes").mockResolvedValue([
      ...trashMailboxes, { id: "Deleted Items", name: "Deleted Items", total: 0, unread: 0 },
    ]);
    const moveCalls = vi.spyOn(service, "move").mockResolvedValue(undefined);
    await withAccountsConfig({ andre: { overrides: { trash: "Deleted Items" }, sentCopy: "auto" } }, async () => {
      const app = await createApp(service, { token: "test-token" });
      try {
        const response = await app.inject({
          method: "POST", url: "/api/message/delete", headers,
          payload: { ref: { account: "andre", mailbox: "INBOX", message: "7" } },
        });
        expect(response.statusCode).toBe(200);
        expect(moveCalls).toHaveBeenCalledWith({ account: "andre", mailbox: "INBOX", message: "7" }, "Deleted Items");
      } finally {
        await app.close();
      }
    });
  });

  it("requires an explicit confirmation before deleting a message already in the trash", async () => {
    const service = fakeService();
    vi.spyOn(service, "listMailboxes").mockResolvedValue(trashMailboxes);
    const deleteCalls = vi.spyOn(service, "deleteMessage");
    const moveCalls = vi.spyOn(service, "move");
    await withAccountsConfig(null, async () => {
      const app = await createApp(service, { token: "test-token" });
      try {
        const response = await app.inject({
          method: "POST", url: "/api/message/delete", headers,
          payload: { ref: { account: "andre", mailbox: "Trash", message: "7" } },
        });
        expect(response.statusCode).toBe(409);
        expect(response.json().code).toBe("CONFIRM_REQUIRED");
        expect(deleteCalls).not.toHaveBeenCalled();
        expect(moveCalls).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });
  });

  it("deletes a message already in the trash once the confirmation is supplied", async () => {
    const service = fakeService();
    vi.spyOn(service, "listMailboxes").mockResolvedValue(trashMailboxes);
    const deleteCalls = vi.spyOn(service, "deleteMessage").mockResolvedValue(undefined);
    const moveCalls = vi.spyOn(service, "move");
    await withAccountsConfig(null, async () => {
      const app = await createApp(service, { token: "test-token" });
      try {
        const response = await app.inject({
          method: "POST", url: "/api/message/delete", headers,
          payload: { ref: { account: "andre", mailbox: "Trash", message: "7" }, confirmPermanent: true },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ ok: true, permanent: true });
        expect(deleteCalls).toHaveBeenCalledWith({ account: "andre", mailbox: "Trash", message: "7" });
        expect(moveCalls).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });
  });

  it("reports a missing trash mailbox as not found instead of deleting permanently", async () => {
    const service = fakeService();
    vi.spyOn(service, "listMailboxes").mockResolvedValue([{ id: "INBOX", name: "INBOX", total: 0, unread: 0 }]);
    const deleteCalls = vi.spyOn(service, "deleteMessage");
    const moveCalls = vi.spyOn(service, "move");
    await withAccountsConfig(null, async () => {
      const app = await createApp(service, { token: "test-token" });
      try {
        const response = await app.inject({
          method: "POST", url: "/api/message/delete", headers,
          payload: { ref: { account: "andre", mailbox: "INBOX", message: "7" } },
        });
        expect(response.statusCode).toBe(404);
        expect(response.json().code).toBe("FOLDER_NOT_FOUND");
        expect(deleteCalls).not.toHaveBeenCalled();
        expect(moveCalls).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });
  });

  it("round-trips a special-folder override through GET and PUT", async () => {
    const directory = await mkdtemp(join(tmpdir(), "himalaya-web-accounts-route-test-"));
    const previous = process.env.HIMALAYA_WEB_ACCOUNTS_PATH;
    process.env.HIMALAYA_WEB_ACCOUNTS_PATH = join(directory, "accounts.json");
    const app = await createApp(fakeService(), { token: "test-token" });
    try {
      const put = await app.inject({
        method: "PUT", url: "/api/accounts/andre/special-folders", headers,
        payload: { overrides: { sent: "INBOX" }, sentCopy: "none" },
      });
      expect(put.statusCode).toBe(200);

      const get = await app.inject({ method: "GET", url: "/api/accounts/andre/special-folders", headers });
      expect(get.statusCode).toBe(200);
      expect(get.json()).toEqual({ overrides: { sent: "INBOX" }, sentCopy: "none" });
    } finally {
      await app.close();
      if (previous === undefined) delete process.env.HIMALAYA_WEB_ACCOUNTS_PATH;
      else process.env.HIMALAYA_WEB_ACCOUNTS_PATH = previous;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("still reports a Gmail account's no-copy default when its accounts.json entry only has an override", async () => {
    const directory = await mkdtemp(join(tmpdir(), "himalaya-web-accounts-route-test-"));
    const path = join(directory, "accounts.json");
    // Hand-written, as the README documents: only a trash override, no sentCopy.
    await writeFile(path, JSON.stringify({ andre: { overrides: { trash: "[Google Mail]/Papierkorb" } } }));
    const previous = process.env.HIMALAYA_WEB_ACCOUNTS_PATH;
    process.env.HIMALAYA_WEB_ACCOUNTS_PATH = path;
    const service: HimalayaService = {
      ...fakeService(),
      listAccounts: async () => ({
        accounts: [{ name: "andre", default: true, backends: ["imap", "smtp"], email: "andre@gmail.com" }],
        addressWarning: null,
      }),
    };
    const app = await createApp(service, { token: "test-token" });
    try {
      const get = await app.inject({ method: "GET", url: "/api/accounts/andre/special-folders", headers });
      expect(get.statusCode).toBe(200);
      expect(get.json()).toEqual({ overrides: { trash: "[Google Mail]/Papierkorb" }, sentCopy: "none" });
    } finally {
      await app.close();
      if (previous === undefined) delete process.env.HIMALAYA_WEB_ACCOUNTS_PATH;
      else process.env.HIMALAYA_WEB_ACCOUNTS_PATH = previous;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("polishes the user's own draft text without a message ref", async () => {
    const provider: AiProvider = { provider: "minimax", model: "test", complete: vi.fn().mockResolvedValue({ text: "Polished text", truncated: false }) };
    const app = await createApp(fakeService(), { token: "test-token", ai: provider });
    try {
      const response = await app.inject({
        method: "POST", url: "/api/ai/assist", headers,
        payload: { draftText: "hi pls send file", task: "polish-draft" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ text: "Polished text", task: "polish-draft" });
      expect(provider.complete).toHaveBeenCalledWith(
        { task: "polish-draft", source: { kind: "draft", draftText: "hi pls send file" } },
      );
    } finally {
      await app.close();
    }
  });
});

describe("compose send and outbox", () => {
  const headers = { host: "127.0.0.1", "x-himalaya-session": "test-token" };
  const sentMailbox = [{ id: "Sent", name: "Sent", total: 0, unread: 0 }];

  function multipartPayload(
    fields: Record<string, unknown>,
    attachments: Array<{ name: string; content: BlobPart; type?: string }> = [],
  ): FormData {
    const form = new FormData();
    form.set("payload", JSON.stringify(fields));
    for (const item of attachments) {
      form.append("attachments", new File([item.content], item.name, { type: item.type ?? "application/octet-stream" }));
    }
    return form;
  }

  it("schedules a send, returns a job id, and only calls composeSend after the delay", async () => {
    const service = fakeService();
    const sendCalls = vi.spyOn(service, "composeSend").mockResolvedValue(undefined);
    vi.spyOn(service, "listMailboxes").mockResolvedValue(sentMailbox);
    const app = await createApp(service, { token: "test-token" });
    try {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      const payload = multipartPayload({
        account: "andre", mode: "new", to: ["alice@example.test"], cc: [], bcc: [],
        subject: "Hello", body: "Hi", includeOriginalAttachments: false,
      });
      const response = await app.inject({ method: "POST", url: "/api/compose/send", headers, payload });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { jobId: string; sendAt: number };
      expect(typeof body.jobId).toBe("string");
      expect(sendCalls).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(10_000);
      expect(sendCalls).toHaveBeenCalledTimes(1);

      // The scheduled job's status flips to "sent" only once its cleanup (a
      // real async fs.rm) resolves; that resolution goes through the real
      // Node event loop, not the faked one, so poll for it under real timers
      // instead of asserting immediately after advanceTimersByTimeAsync.
      vi.useRealTimers();
      await vi.waitFor(async () => {
        const status = await app.inject({ method: "GET", url: `/api/outbox/${body.jobId}`, headers });
        expect(status.json()).toMatchObject({ status: "sent" });
      });
    } finally {
      vi.useRealTimers();
      await app.close();
    }
  });

  it.each([
    { name: "a Gmail account with no accounts.json entry gets no --save", email: "andre@gmail.com", saveTo: undefined },
    { name: "any other account still saves its own Sent copy", email: "andre@example.test", saveTo: "Sent" },
  ])("applies the provider default sent-copy mode on send: $name", async ({ email, saveTo }) => {
    const service: HimalayaService = {
      ...fakeService(),
      listAccounts: async () => ({
        accounts: [{ name: "andre", default: true, backends: ["imap", "smtp"], email }],
        addressWarning: null,
      }),
    };
    let capturedSaveTo: string | undefined = "unset";
    const sendCalls = vi.spyOn(service, "composeSend").mockImplementation(async (_request, options) => {
      capturedSaveTo = options.saveTo;
    });
    vi.spyOn(service, "listMailboxes").mockResolvedValue(sentMailbox);
    await withAccountsConfig(null, async () => {
      const app = await createApp(service, { token: "test-token" });
      try {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
        const payload = multipartPayload({
          account: "andre", mode: "new", to: ["alice@example.test"], cc: [], bcc: [],
          subject: "Hello", body: "Hi", includeOriginalAttachments: false,
        });
        const response = await app.inject({ method: "POST", url: "/api/compose/send", headers, payload });
        expect(response.statusCode).toBe(200);

        await vi.advanceTimersByTimeAsync(10_000);
        expect(sendCalls).toHaveBeenCalledTimes(1);
        expect(capturedSaveTo).toBe(saveTo);
      } finally {
        vi.useRealTimers();
        await app.close();
      }
    });
  });

  it("keeps a Gmail account's default no-copy sent mode when accounts.json holds only a trash override", async () => {
    // Regression test for the reachable hole in the duplicate-Sent-copy fix:
    // an overrides-only entry (written by hand to fix a German Gmail's
    // [Google Mail]/Papierkorb trash resolution) must not silently re-enable the
    // provider default's Gmail --save.
    const service: HimalayaService = {
      ...fakeService(),
      listAccounts: async () => ({
        accounts: [{ name: "andre", default: true, backends: ["imap", "smtp"], email: "andre@gmail.com" }],
        addressWarning: null,
      }),
    };
    let capturedSaveTo: string | undefined = "unset";
    const sendCalls = vi.spyOn(service, "composeSend").mockImplementation(async (_request, options) => {
      capturedSaveTo = options.saveTo;
    });
    vi.spyOn(service, "listMailboxes").mockResolvedValue(sentMailbox);
    await withAccountsConfig({ andre: { overrides: { trash: "[Google Mail]/Papierkorb" } } }, async () => {
      const app = await createApp(service, { token: "test-token" });
      try {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
        const payload = multipartPayload({
          account: "andre", mode: "new", to: ["alice@example.test"], cc: [], bcc: [],
          subject: "Hello", body: "Hi", includeOriginalAttachments: false,
        });
        const response = await app.inject({ method: "POST", url: "/api/compose/send", headers, payload });
        expect(response.statusCode).toBe(200);

        await vi.advanceTimersByTimeAsync(10_000);
        expect(sendCalls).toHaveBeenCalledTimes(1);
        expect(capturedSaveTo).toBeUndefined();
      } finally {
        vi.useRealTimers();
        await app.close();
      }
    });
  });

  it("cancels a queued send before it fires", async () => {
    const service = fakeService();
    const sendCalls = vi.spyOn(service, "composeSend").mockResolvedValue(undefined);
    vi.spyOn(service, "listMailboxes").mockResolvedValue([]);
    const app = await createApp(service, { token: "test-token" });
    try {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      const payload = multipartPayload({
        account: "andre", mode: "new", to: ["alice@example.test"], cc: [], bcc: [],
        subject: "Hello", body: "Hi", includeOriginalAttachments: false,
      });
      const response = await app.inject({ method: "POST", url: "/api/compose/send", headers, payload });
      const { jobId } = response.json() as { jobId: string };

      const cancel = await app.inject({ method: "DELETE", url: `/api/outbox/${jobId}`, headers });
      expect(cancel.statusCode).toBe(200);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(sendCalls).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      await app.close();
    }
  });

  it("returns 404 for cancelling an unknown outbox job", async () => {
    const app = await createApp(fakeService(), { token: "test-token" });
    try {
      const response = await app.inject({ method: "DELETE", url: "/api/outbox/does-not-exist", headers });
      expect(response.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("rejects a send payload with a header-injection attempt before scheduling", async () => {
    const service = fakeService();
    const sendCalls = vi.spyOn(service, "composeSend");
    const app = await createApp(service, { token: "test-token" });
    try {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      const payload = multipartPayload({
        account: "andre", mode: "new", to: ["alice@example.test"], cc: [], bcc: [],
        subject: "Hi\nBcc: eve@evil.test", body: "Hi", includeOriginalAttachments: false,
      });
      const response = await app.inject({ method: "POST", url: "/api/compose/send", headers, payload });
      expect(response.statusCode).toBe(400);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(sendCalls).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      await app.close();
    }
  });

  it("rejects a multipart request with no payload field before scheduling", async () => {
    const service = fakeService();
    const sendCalls = vi.spyOn(service, "composeSend");
    const app = await createApp(service, { token: "test-token" });
    try {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      const form = new FormData();
      form.set("unrelated", "value");
      const response = await app.inject({ method: "POST", url: "/api/compose/send", headers, payload: form });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("INVALID_REQUEST");

      await vi.advanceTimersByTimeAsync(10_000);
      expect(sendCalls).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      await app.close();
    }
  });

  it("uploads an attachment, passes its temp path to composeSend, and removes the temp dir afterwards", async () => {
    const service = fakeService();
    let capturedPaths: readonly string[] = [];
    const sendCalls = vi.spyOn(service, "composeSend").mockImplementation(async (_request, options) => {
      capturedPaths = options.attachmentPaths;
    });
    vi.spyOn(service, "listMailboxes").mockResolvedValue(sentMailbox);
    const app = await createApp(service, { token: "test-token" });
    try {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      const payload = multipartPayload(
        {
          account: "andre", mode: "new", to: ["alice@example.test"], cc: [], bcc: [],
          subject: "Hello", body: "Hi", includeOriginalAttachments: false,
        },
        [{ name: "notes.txt", content: "synthetic attachment body", type: "text/plain" }],
      );
      const response = await app.inject({ method: "POST", url: "/api/compose/send", headers, payload });
      expect(response.statusCode).toBe(200);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(sendCalls).toHaveBeenCalledTimes(1);
      expect(capturedPaths).toHaveLength(1);
      expect(capturedPaths[0]).toContain("notes.txt");

      // Cleanup's fs.rm resolves on the real event loop; poll under real
      // timers instead of asserting immediately (see the "schedules a send"
      // test above for why).
      vi.useRealTimers();
      await vi.waitFor(async () => {
        await expect(stat(capturedPaths[0]!)).rejects.toThrow();
      });
    } finally {
      vi.useRealTimers();
      await app.close();
    }
  });

  it("downloads original attachments for a forward with includeOriginalAttachments and includes them in the send", async () => {
    const service = fakeService();
    const downloadCalls = vi.spyOn(service, "downloadAttachment");
    let capturedPaths: readonly string[] = [];
    vi.spyOn(service, "composeSend").mockImplementation(async (_request, options) => {
      capturedPaths = options.attachmentPaths;
    });
    vi.spyOn(service, "listMailboxes").mockResolvedValue(sentMailbox);
    const app = await createApp(service, { token: "test-token" });
    const sourceRef = { account: "andre", mailbox: "INBOX", message: "7" };
    try {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      const payload = multipartPayload({
        account: "andre", mode: "forward", sourceRef, to: ["alice@example.test"], cc: [], bcc: [],
        subject: "Fwd: Hello", body: "See below", includeOriginalAttachments: true,
      });
      const response = await app.inject({ method: "POST", url: "/api/compose/send", headers, payload });
      expect(response.statusCode).toBe(200);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(downloadCalls).toHaveBeenCalledWith(sourceRef, attachment.id, attachment.filename);
      expect(capturedPaths).toHaveLength(1);
    } finally {
      vi.useRealTimers();
      await app.close();
    }
  });

  it("rejects attachments whose combined size exceeds the configured limit, before scheduling", async () => {
    const service = fakeService();
    const sendCalls = vi.spyOn(service, "composeSend");
    vi.spyOn(service, "listMailboxes").mockResolvedValue(sentMailbox);
    const app = await createApp(service, { token: "test-token" });
    try {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      const chunk = new Uint8Array(13 * 1024 * 1024);
      const payload = multipartPayload(
        {
          account: "andre", mode: "new", to: ["alice@example.test"], cc: [], bcc: [],
          subject: "Hello", body: "Hi", includeOriginalAttachments: false,
        },
        [
          { name: "a.bin", content: chunk, type: "application/octet-stream" },
          { name: "b.bin", content: chunk, type: "application/octet-stream" },
        ],
      );
      const response = await app.inject({ method: "POST", url: "/api/compose/send", headers, payload });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("INVALID_INPUT");

      await vi.advanceTimersByTimeAsync(10_000);
      expect(sendCalls).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      await app.close();
    }
  }, 20_000);
});

describe("mail watcher summary route", () => {
  const headers = { host: "127.0.0.1", "x-himalaya-session": "test-token" };

  it("returns the watch summary shape for the main token, with Cache-Control: no-store", async () => {
    await withAccountsConfig(null, async () => {
      const app = await createApp(fakeService(), { token: "test-token" });
      try {
        const response = await app.inject({ method: "GET", url: "/api/watch/summary", headers });
        expect(response.statusCode).toBe(200);
        expect(response.headers["cache-control"]).toBe("no-store");
        const body = response.json() as { accounts: unknown[]; totalUnread: number };
        expect(Array.isArray(body.accounts)).toBe(true);
        expect(typeof body.totalUnread).toBe("number");
      } finally {
        await app.close();
      }
    });
  });

  it("accepts the widget token for this route only, and rejects it on every other route", async () => {
    await withAccountsConfig(null, async () => {
      const app = await createApp(fakeService(), { token: "test-token", widgetToken: "widget-token-abc" });
      try {
        const widgetHeaders = { host: "127.0.0.1", "x-himalaya-session": "widget-token-abc" };

        const summary = await app.inject({ method: "GET", url: "/api/watch/summary", headers: widgetHeaders });
        expect(summary.statusCode).toBe(200);

        const mainStillWorks = await app.inject({ method: "GET", url: "/api/watch/summary", headers });
        expect(mainStillWorks.statusCode).toBe(200);

        const bootstrap = await app.inject({ method: "GET", url: "/api/bootstrap", headers: widgetHeaders });
        expect(bootstrap.statusCode).toBe(401);
      } finally {
        await app.close();
      }
    });
  });

  it("rejects the summary route with no token, a wrong token, or a non-loopback host, when no widget token is configured", async () => {
    await withAccountsConfig(null, async () => {
      const app = await createApp(fakeService(), { token: "test-token" });
      try {
        const noToken = await app.inject({ method: "GET", url: "/api/watch/summary", headers: { host: "127.0.0.1" } });
        expect(noToken.statusCode).toBe(401);

        const wrongToken = await app.inject({
          method: "GET", url: "/api/watch/summary",
          headers: { host: "127.0.0.1", "x-himalaya-session": "anything" },
        });
        expect(wrongToken.statusCode).toBe(401);

        const remoteHost = await app.inject({
          method: "GET", url: "/api/watch/summary",
          headers: { host: "remote.example.test", "x-himalaya-session": "test-token" },
        });
        expect(remoteHost.statusCode).toBe(403);
      } finally {
        await app.close();
      }
    });
  });
});

describe("cross-folder search route", () => {
  const headers = { host: "127.0.0.1", "x-himalaya-session": "test-token" };
  const search = (app: Awaited<ReturnType<typeof createApp>>, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/search", headers, payload });
  const hit = (id: string, hasAttachment: boolean | null = false): Envelope => ({ ...envelope, id, hasAttachment });

  it.each([
    { name: "an impossible date", payload: { scope: "all", accounts: ["andre"], from: "2026-02-30" } },
    { name: "from after until", payload: { scope: "all", accounts: ["andre"], from: "2026-09-30", until: "2026-09-01" } },
    { name: "the folder scope without a mailbox", payload: { scope: "folder", account: "andre" } },
    { name: "the account scope without an account", payload: { scope: "account" } },
    { name: "the all scope without accounts", payload: { scope: "all", accounts: [] } },
    { name: "an unknown flag", payload: { scope: "all", accounts: ["andre"], flag: "deleted" } },
  ])("rejects $name before any provider work", async ({ payload }) => {
    const service = fakeService();
    const listing = vi.spyOn(service, "listMailboxes");
    const envelopes = vi.spyOn(service, "listEnvelopes");
    const app = await createApp(service, { token: "test-token" });
    try {
      const response = await search(app, payload);
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("INVALID_REQUEST");
      expect(listing).not.toHaveBeenCalled();
      expect(envelopes).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("searches every folder of one account for the account scope, without listing other accounts", async () => {
    const service = fakeService();
    const listing = vi.spyOn(service, "listMailboxes").mockResolvedValue([
      { ...mailboxes[0]!, id: "INBOX" }, { ...mailboxes[0]!, id: "Work", name: "Work" }, { ...mailboxes[0]!, id: "[Google Mail]/Spam", name: "Spam" },
    ]);
    const envelopes = vi.spyOn(service, "listEnvelopes").mockResolvedValue([hit("1")]);
    const app = await createApp(service, { token: "test-token" });
    try {
      const response = await search(app, { scope: "account", account: "andre", mailbox: "INBOX", q: "invoice", from: "2026-09-01", flag: "unseen" });
      expect(response.statusCode).toBe(200);
      expect(listing).toHaveBeenCalledTimes(1);
      expect(envelopes.mock.calls.map(([query]) => query.mailbox).sort()).toEqual(["INBOX", "Work"]);
      expect(envelopes.mock.calls[0]![0].search).toMatchObject({ text: "invoice", from: "2026-09-01", flag: "unseen" });
      expect(response.json().envelopes.map((item: Envelope) => item.source)).toEqual([
        { account: "andre", mailbox: "INBOX" }, { account: "andre", mailbox: "Work" },
      ]);
    } finally {
      await app.close();
    }
  });

  it("includes junk folders only when asked to", async () => {
    const service = fakeService();
    vi.spyOn(service, "listMailboxes").mockResolvedValue([{ ...mailboxes[0]!, id: "INBOX" }, { ...mailboxes[0]!, id: "Junk", name: "Junk" }]);
    const envelopes = vi.spyOn(service, "listEnvelopes").mockResolvedValue([]);
    const app = await createApp(service, { token: "test-token" });
    try {
      await search(app, { scope: "all", accounts: ["andre"], q: "x" });
      expect(envelopes.mock.calls.map(([query]) => query.mailbox)).toEqual(["INBOX"]);
      envelopes.mockClear();
      await search(app, { scope: "all", accounts: ["andre"], q: "x", includeJunk: true });
      expect(envelopes.mock.calls.map(([query]) => query.mailbox).sort()).toEqual(["INBOX", "Junk"]);
    } finally {
      await app.close();
    }
  });

  it("searches one folder for the folder scope without listing mailboxes", async () => {
    const service = fakeService();
    const listing = vi.spyOn(service, "listMailboxes");
    const envelopes = vi.spyOn(service, "listEnvelopes").mockResolvedValue([hit("1")]);
    const app = await createApp(service, { token: "test-token" });
    try {
      const response = await search(app, { scope: "folder", account: "andre", mailbox: "Work", order: "asc" });
      expect(response.statusCode).toBe(200);
      expect(listing).not.toHaveBeenCalled();
      expect(envelopes.mock.calls[0]![0]).toMatchObject({ account: "andre", mailbox: "Work", search: { order: "asc" } });
    } finally {
      await app.close();
    }
  });

  it("keeps only envelopes with an attachment when hasAttachment is set", async () => {
    const service = fakeService();
    vi.spyOn(service, "listMailboxes").mockResolvedValue([{ ...mailboxes[0]!, id: "INBOX" }]);
    vi.spyOn(service, "listEnvelopes").mockResolvedValue([hit("with", true), hit("without", false), hit("unknown", null)]);
    const app = await createApp(service, { token: "test-token" });
    try {
      const response = await search(app, { scope: "all", accounts: ["andre"], q: "x", hasAttachment: true });
      expect(response.json().envelopes.map((item: Envelope) => item.id)).toEqual(["with"]);
    } finally {
      await app.close();
    }
  });

  it("decorates a hit with the watcher's phishing verdict", async () => {
    await withAccountsConfig({ andre: { overrides: {}, watch: true } }, async () => {
      const service = fakeService();
      let unread = 0;
      vi.spyOn(service, "listMailboxes").mockImplementation(async () => [{ id: "INBOX", name: "INBOX", total: unread, unread: unread++ }]);
      vi.spyOn(service, "readRaw").mockResolvedValue(Buffer.from('From: "PayPal" <x@evil-example.net>\r\nSubject: hi\r\n\r\nhi\r\n'));
      // The watcher polls with pageSize 10; the search route below uses 50.
      vi.spyOn(service, "listEnvelopes").mockImplementation(async ({ pageSize }) => (pageSize === 10 && unread > 1 ? [hit("phish")] : pageSize === 10 ? [] : [hit("phish"), hit("clean")]));
      const app = await createApp(service, { token: "test-token", watchIntervalMs: 20 });
      try {
        await vi.waitFor(async () => {
          const response = await search(app, { scope: "folder", account: "andre", mailbox: "INBOX", q: "hi" });
          const risks = Object.fromEntries(response.json().envelopes.map((item: Envelope) => [item.id, item.risk]));
          expect(risks).toEqual({ phish: "suspicious" });
        }, { timeout: 2_000 });
      } finally {
        await app.close();
      }
    });
  });

  it("lets the single-folder route filter without any search text", async () => {
    const service = fakeService();
    const envelopes = vi.spyOn(service, "listEnvelopes").mockResolvedValue([]);
    const app = await createApp(service, { token: "test-token" });
    try {
      const response = await app.inject({ method: "GET", url: "/api/accounts/andre/messages?mailbox=INBOX&flag=unseen&from=2026-09-01&order=asc", headers });
      expect(response.statusCode).toBe(200);
      expect(envelopes.mock.calls[0]![0].search).toMatchObject({ flag: "unseen", from: "2026-09-01", order: "asc" });
      const bad = await app.inject({ method: "GET", url: "/api/accounts/andre/messages?mailbox=INBOX&from=2026-02-30", headers });
      expect(bad.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("lets the unified inbox filter without any search text", async () => {
    const service = fakeService();
    vi.spyOn(service, "listMailboxes").mockResolvedValue([{ ...mailboxes[0]!, id: "INBOX" }]);
    const envelopes = vi.spyOn(service, "listEnvelopes").mockResolvedValue([]);
    const app = await createApp(service, { token: "test-token" });
    try {
      const response = await app.inject({ method: "POST", url: "/api/unified/inbox", headers, payload: { accounts: ["andre"], from: "2026-09-01" } });
      expect(response.statusCode).toBe(200);
      expect(envelopes.mock.calls[0]![0].search).toMatchObject({ from: "2026-09-01" });
    } finally {
      await app.close();
    }
  });
});

describe("copy and raw routes", () => {
  const headers = { host: "127.0.0.1", "x-himalaya-session": "test-token" };
  const ref = { account: "andre", mailbox: "INBOX", message: "7" };
  const post = (app: Awaited<ReturnType<typeof createApp>>, payload: unknown, requestHeaders: Record<string, string> = headers) =>
    app.inject({ method: "POST", url: "/api/message/copy", headers: requestHeaders, payload: payload as Record<string, unknown> });

  it("copies within the same account with the CLI's own copy and touches nothing else", async () => {
    const service = fakeService();
    const copy = vi.spyOn(service, "copy");
    const addRaw = vi.spyOn(service, "addRaw");
    const readRaw = vi.spyOn(service, "readRaw");
    const app = await createApp(service, { token: "test-token" });
    try {
      const response = await post(app, { ref, destination: { account: "andre", mailbox: "Archive" } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true, mode: "copy" });
      expect(copy).toHaveBeenCalledWith(ref, "Archive");
      expect(addRaw).not.toHaveBeenCalled();
      expect(readRaw).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("reads the raw message and appends it as seen for another account", async () => {
    const service = fakeService();
    const raw = Buffer.from("From: a@example.org\r\n\r\nHello\r\n");
    const copy = vi.spyOn(service, "copy");
    const readRaw = vi.spyOn(service, "readRaw").mockResolvedValue(raw);
    const addRaw = vi.spyOn(service, "addRaw");
    const app = await createApp(service, { token: "test-token" });
    try {
      const response = await post(app, { ref, destination: { account: "beta", mailbox: "Archive" } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true, mode: "append" });
      expect(readRaw).toHaveBeenCalledWith(ref);
      expect(addRaw).toHaveBeenCalledWith("beta", "Archive", raw, ["seen"]);
      expect(copy).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([
    { name: "the message's own account and mailbox", payload: { ref, destination: { account: "andre", mailbox: "INBOX" } } },
    { name: "an empty destination mailbox", payload: { ref, destination: { account: "andre", mailbox: "" } } },
    { name: "an empty destination account", payload: { ref, destination: { account: "", mailbox: "Archive" } } },
    { name: "a missing destination", payload: { ref } },
    { name: "a missing ref", payload: { destination: { account: "andre", mailbox: "Archive" } } },
  ])("rejects $name before any provider work", async ({ payload }) => {
    const service = fakeService();
    const copy = vi.spyOn(service, "copy");
    const addRaw = vi.spyOn(service, "addRaw");
    const readRaw = vi.spyOn(service, "readRaw");
    const app = await createApp(service, { token: "test-token" });
    try {
      const response = await post(app, payload);
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("INVALID_REQUEST");
      expect(copy).not.toHaveBeenCalled();
      expect(addRaw).not.toHaveBeenCalled();
      expect(readRaw).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([
    { name: "a missing session", headers: { host: "127.0.0.1" }, status: 401 },
    { name: "a remote host", headers: { ...headers, host: "remote.example.test" }, status: 403 },
  ])("keeps the local session boundary: $name", async ({ headers: requestHeaders, status }) => {
    const service = fakeService();
    const copy = vi.spyOn(service, "copy");
    const app = await createApp(service, { token: "test-token" });
    try {
      expect((await post(app, { ref, destination: { account: "andre", mailbox: "Archive" } }, requestHeaders)).statusCode).toBe(status);
      expect((await app.inject({ method: "GET", url: "/api/message/raw?account=andre&mailbox=INBOX&message=7", headers: requestHeaders })).statusCode).toBe(status);
      expect(copy).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("does not report success when the provider fails", async () => {
    const service = fakeService();
    vi.spyOn(service, "copy").mockRejectedValue(new HimalayaError("synthetic failure", "PROVIDER_ERROR", true));
    const app = await createApp(service, { token: "test-token" });
    try {
      const response = await post(app, { ref, destination: { account: "andre", mailbox: "Archive" } });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.json().ok).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("serves the original bytes as a .eml download", async () => {
    const service = fakeService();
    const raw = Buffer.from("From: alice@example.org\r\nSubject: Hello\r\nDate: Fri, 02 Oct 2026 10:00:00 +0000\r\n\r\nBody \u00e4\r\n");
    vi.spyOn(service, "readRaw").mockResolvedValue(raw);
    const app = await createApp(service, { token: "test-token" });
    try {
      const response = await app.inject({ method: "GET", url: "/api/message/raw?account=andre&mailbox=INBOX&message=7", headers });
      expect(response.statusCode).toBe(200);
      expect(response.rawPayload.equals(raw)).toBe(true);
      expect(String(response.headers["content-type"])).toMatch(/^message\/rfc822/);
      expect(String(response.headers["content-disposition"])).toMatch(/^attachment; filename\*=UTF-8''.*\.eml$/);
      expect(response.headers["cache-control"]).toBe("no-store");
    } finally {
      await app.close();
    }
  });
});

describe("sender status in the message route", () => {
  const headers = { host: "127.0.0.1", "x-himalaya-session": "test-token" };

  it("applies the stored lists when a message is opened", async () => {
    const directory = await mkdtemp(join(tmpdir(), "himalaya-web-senders-route-test-"));
    const sendersPath = join(directory, "senders.json");
    await writeFile(sendersPath, JSON.stringify({ trusted: ["x@evil.example"], blocked: [] }));
    const service = fakeService();
    vi.spyOn(service, "readRaw").mockResolvedValue(Buffer.from('From: "PayPal" <x@evil.example>\r\nTo: b@example.org\r\nSubject: hi\r\n\r\nhello\r\n'));
    const app = await createApp(service, { token: "test-token", sendersPath });
    try {
      const response = await app.inject({ method: "GET", url: "/api/message?account=andre&mailbox=INBOX&message=7", headers });

      expect(response.json().sender).toMatchObject({ trust: "trusted", risk: { level: "none" } });
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("sender status and report routes", () => {
  const headers = { host: "127.0.0.1", "x-himalaya-session": "test-token" };
  const ref = { account: "andre", mailbox: "INBOX", message: "7" };
  const PHISH = Buffer.from('From: "PayPal" <X@Evil.example>\r\nTo: b@example.org\r\nSubject: hi\r\n\r\nhello\r\n');
  let directory = "";
  let sendersPath = "";
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "himalaya-web-report-test-"));
    sendersPath = join(directory, "senders.json");
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const stored = async (): Promise<{ trusted: string[]; blocked: string[] } | null> =>
    readFile(sendersPath, "utf8").then((text) => JSON.parse(text), () => null);
  const open = async (service = fakeService()) => createApp(service, { token: "test-token", sendersPath });
  const post = (app: Awaited<ReturnType<typeof createApp>>, url: string, payload: unknown, requestHeaders: Record<string, string> = headers) =>
    app.inject({ method: "POST", url, headers: requestHeaders, payload: payload as Record<string, unknown> });
  const mailboxes = (...ids: string[]) => ids.map((id) => ({ id, name: id, total: null, unread: null }));

  it("sets and clears a status and shows it on the next message load", async () => {
    const service = fakeService();
    vi.spyOn(service, "readRaw").mockResolvedValue(PHISH);
    const app = await open(service);
    try {
      expect((await post(app, "/api/senders/status", { email: "X@Evil.example", status: "trusted" })).json()).toEqual({ ok: true });
      expect(await stored()).toEqual({ trusted: ["x@evil.example"], blocked: [] });
      const trusted = await app.inject({ method: "GET", url: "/api/message?account=andre&mailbox=INBOX&message=7", headers });
      expect(trusted.json().sender).toMatchObject({ trust: "trusted", risk: { level: "none" } });

      await post(app, "/api/senders/status", { email: "x@evil.example", status: null });
      const cleared = await app.inject({ method: "GET", url: "/api/message?account=andre&mailbox=INBOX&message=7", headers });
      expect(cleared.json().sender.trust).toBeNull();
    } finally {
      await app.close();
    }
  });

  it.each([
    { name: "an invalid address", payload: { email: "nope", status: "trusted" } },
    { name: "an unknown status", payload: { email: "a@b.test", status: "friend" } },
    { name: "a missing status", payload: { email: "a@b.test" } },
  ])("rejects $name without writing", async ({ payload }) => {
    const app = await open();
    try {
      expect((await post(app, "/api/senders/status", payload)).statusCode).toBe(400);
      expect(await stored()).toBeNull();
    } finally {
      await app.close();
    }
  });

  it.each([
    { name: "a missing session", headers: { host: "127.0.0.1" }, status: 401 },
    { name: "a remote host", headers: { ...headers, host: "remote.example.test" }, status: 403 },
  ])("keeps the local boundary for both routes: $name", async ({ headers: requestHeaders, status }) => {
    const service = fakeService();
    const move = vi.spyOn(service, "move");
    const app = await open(service);
    try {
      expect((await post(app, "/api/senders/status", { email: "a@b.test", status: "trusted" }, requestHeaders)).statusCode).toBe(status);
      expect((await post(app, "/api/message/report", { ref }, requestHeaders)).statusCode).toBe(status);
      expect(move).not.toHaveBeenCalled();
      expect(await stored()).toBeNull();
    } finally {
      await app.close();
    }
  });

  it("moves the message to Junk first, then remembers the address as reported", async () => {
    const service = fakeService();
    vi.spyOn(service, "readRaw").mockResolvedValue(PHISH);
    const listing = vi.spyOn(service, "listMailboxes").mockResolvedValue(mailboxes("INBOX", "Junk", "Trash"));
    let storedAtMove: unknown = "not called";
    const move = vi.spyOn(service, "move").mockImplementation(async () => { storedAtMove = await stored(); });
    const app = await open(service);
    try {
      const response = await post(app, "/api/message/report", { ref });

      expect(response.json()).toEqual({ ok: true, moved: true, mailbox: "Junk" });
      expect(listing).toHaveBeenCalledWith("andre", { counts: false });
      expect(move).toHaveBeenCalledWith(ref, "Junk");
      expect(storedAtMove).toBeNull();
      expect(await stored()).toEqual({ trusted: [], blocked: ["x@evil.example"] });
    } finally {
      await app.close();
    }
  });

  it("only remembers the address when the message already sits in Junk", async () => {
    const service = fakeService();
    vi.spyOn(service, "readRaw").mockResolvedValue(PHISH);
    vi.spyOn(service, "listMailboxes").mockResolvedValue(mailboxes("INBOX", "Junk"));
    const move = vi.spyOn(service, "move");
    const app = await open(service);
    try {
      const response = await post(app, "/api/message/report", { ref: { ...ref, mailbox: "Junk" } });

      expect(response.json()).toEqual({ ok: true, moved: false, mailbox: "Junk" });
      expect(move).not.toHaveBeenCalled();
      expect((await stored())?.blocked).toEqual(["x@evil.example"]);
    } finally {
      await app.close();
    }
  });

  it("still remembers the address when the account has no Junk folder", async () => {
    const service = fakeService();
    vi.spyOn(service, "readRaw").mockResolvedValue(PHISH);
    vi.spyOn(service, "listMailboxes").mockResolvedValue(mailboxes("INBOX", "Trash"));
    const move = vi.spyOn(service, "move");
    const app = await open(service);
    try {
      expect((await post(app, "/api/message/report", { ref })).json()).toEqual({ ok: true, moved: false, mailbox: null });
      expect(move).not.toHaveBeenCalled();
      expect((await stored())?.blocked).toEqual(["x@evil.example"]);
    } finally {
      await app.close();
    }
  });

  it("stores nothing when the move fails", async () => {
    const service = fakeService();
    vi.spyOn(service, "readRaw").mockResolvedValue(PHISH);
    vi.spyOn(service, "listMailboxes").mockResolvedValue(mailboxes("INBOX", "Junk"));
    vi.spyOn(service, "move").mockRejectedValue(new HimalayaError("synthetic failure", "PROVIDER_ERROR", true));
    const app = await open(service);
    try {
      const response = await post(app, "/api/message/report", { ref });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.json().ok).toBeUndefined();
      expect(await stored()).toBeNull();
    } finally {
      await app.close();
    }
  });

  it("rejects a message without a usable sender address and a malformed body", async () => {
    const service = fakeService();
    vi.spyOn(service, "readRaw").mockResolvedValue(Buffer.from("Subject: x\r\n\r\nhi\r\n"));
    const move = vi.spyOn(service, "move");
    const app = await open(service);
    try {
      expect((await post(app, "/api/message/report", { ref })).statusCode).toBe(400);
      expect((await post(app, "/api/message/report", {})).statusCode).toBe(400);
      expect(move).not.toHaveBeenCalled();
      expect(await stored()).toBeNull();
    } finally {
      await app.close();
    }
  });
});

describe("rules routes", () => {
  const headers = { host: "127.0.0.1", "x-himalaya-session": "test-token" };
  let directory = "";
  let rulesPath = "";
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "himalaya-web-rules-route-test-"));
    rulesPath = join(directory, "rules.json");
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const rule = (overrides: Record<string, unknown> = {}) => ({
    id: "news", account: "andre", enabled: true, dryRun: true,
    condition: { field: "from", match: "contains", value: "news@x.test" },
    actions: [{ type: "flag", flag: "seen", value: true }],
    ...overrides,
  });
  const fileText = (): Promise<string | null> => readFile(rulesPath, "utf8").then((text) => text, () => null);
  const open = async (service = fakeService()) => createApp(service, { token: "test-token", rulesPath });
  const call = (app: Awaited<ReturnType<typeof createApp>>, method: "GET" | "PUT" | "POST", url: string, payload?: unknown, requestHeaders: Record<string, string> = headers) =>
    app.inject({ method, url, headers: requestHeaders, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
  const envelopeFrom = (id: string, email: string, subject = id): Envelope => ({ ...envelope, id, subject, from: [{ name: null, email }] });

  it("saves rules and reads them back", async () => {
    const app = await open();
    try {
      expect((await call(app, "GET", "/api/rules")).json()).toEqual({ rules: [], preservedInvalid: 0, unreadable: false });
      const saved = await call(app, "PUT", "/api/rules", { rules: [rule(), rule({ id: "two", dryRun: false })] });

      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({ ok: true, preservedInvalid: 0 });
      expect((await call(app, "GET", "/api/rules")).json().rules.map((item: { id: string }) => item.id)).toEqual(["news", "two"]);
    } finally {
      await app.close();
    }
  });

  it("reports an unreadable rules.json and backs it up before the first save", async () => {
    await writeFile(rulesPath, "[{broken,]");
    const app = await open();
    try {
      expect((await call(app, "GET", "/api/rules")).json()).toEqual({ rules: [], preservedInvalid: 0, unreadable: true });
      const saved = await call(app, "PUT", "/api/rules", { rules: [rule()] });

      expect(saved.json()).toMatchObject({ ok: true, unreadable: false });
      const { readdir } = await import("node:fs/promises");
      expect((await readdir(directory)).some((name) => name.startsWith("rules.json.unreadable-"))).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("keeps hand-edited invalid entries through a save and reports them", async () => {
    const invalid = { ...rule({ id: "typo" }), dryRun: "true" };
    await writeFile(rulesPath, JSON.stringify([rule({ id: "old" }), invalid]));
    const app = await open();
    try {
      expect((await call(app, "GET", "/api/rules")).json()).toMatchObject({ preservedInvalid: 1 });
      await call(app, "PUT", "/api/rules", { rules: [rule({ id: "new" })] });

      expect(JSON.parse((await fileText())!)).toEqual([rule({ id: "new" }), invalid]);
    } finally {
      await app.close();
    }
  });

  it.each([
    { name: "duplicate ids", payload: { rules: [rule(), rule()] } },
    { name: "a rule without actions", payload: { rules: [rule({ actions: [] })] } },
    { name: "an unknown condition field", payload: { rules: [rule({ condition: { field: "cc", match: "contains", value: "x" } })] } },
    { name: "a missing rules list", payload: {} },
  ])("rejects $name and leaves the file untouched", async ({ payload }) => {
    await writeFile(rulesPath, "[]");
    const app = await open();
    try {
      const response = await call(app, "PUT", "/api/rules", payload);

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("INVALID_REQUEST");
      expect(await fileText()).toBe("[]");
    } finally {
      await app.close();
    }
  });

  it("previews a rule against the newest INBOX mail without changing anything", async () => {
    const service = fakeService();
    const listing = vi.spyOn(service, "listMailboxes").mockResolvedValue([{ id: "Archive", name: "Archive", total: null, unread: null }, { id: "INBOX", name: "Inbox", total: null, unread: null }]);
    const envelopes = vi.spyOn(service, "listEnvelopes").mockResolvedValue([
      envelopeFrom("1", "NEWS@x.test", "Eins"), envelopeFrom("2", "other@x.test"), ...Array.from({ length: 12 }, (_, index) => envelopeFrom(`n${index}`, "news@x.test")),
    ]);
    const move = vi.spyOn(service, "move");
    const setFlag = vi.spyOn(service, "setFlag");
    const app = await open(service);
    try {
      const response = await call(app, "POST", "/api/rules/preview", { rule: rule() });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ checked: 14, matchCount: 13 });
      expect(response.json().samples).toHaveLength(10);
      expect(listing).toHaveBeenCalledWith("andre", { counts: false });
      expect(envelopes).toHaveBeenCalledWith({ account: "andre", mailbox: "INBOX", page: 1, pageSize: 50 });
      expect(move).not.toHaveBeenCalled();
      expect(setFlag).not.toHaveBeenCalled();
      expect(await fileText()).toBeNull();
    } finally {
      await app.close();
    }
  });

  it("answers 404 when the account has no INBOX, and 400 for an invalid rule without any service call", async () => {
    const service = fakeService();
    vi.spyOn(service, "listMailboxes").mockResolvedValue([{ id: "Archive", name: "Archive", total: null, unread: null }]);
    const envelopes = vi.spyOn(service, "listEnvelopes");
    const app = await open(service);
    try {
      expect((await call(app, "POST", "/api/rules/preview", { rule: rule() })).statusCode).toBe(404);
      expect((await call(app, "POST", "/api/rules/preview", { rule: rule({ actions: [] }) })).statusCode).toBe(400);
      expect(envelopes).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([
    { name: "a missing session", headers: { host: "127.0.0.1" }, status: 401 },
    { name: "a remote host", headers: { ...headers, host: "remote.example.test" }, status: 403 },
  ])("keeps the local boundary for all three routes: $name", async ({ headers: requestHeaders, status }) => {
    const service = fakeService();
    const listing = vi.spyOn(service, "listMailboxes");
    const app = await open(service);
    try {
      expect((await call(app, "GET", "/api/rules", undefined, requestHeaders)).statusCode).toBe(status);
      expect((await call(app, "PUT", "/api/rules", { rules: [rule()] }, requestHeaders)).statusCode).toBe(status);
      expect((await call(app, "POST", "/api/rules/preview", { rule: rule() }, requestHeaders)).statusCode).toBe(status);
      expect(listing).not.toHaveBeenCalled();
      expect(await fileText()).toBeNull();
    } finally {
      await app.close();
    }
  });
});

describe("snooze routes", () => {
  const headers = { host: "127.0.0.1", "x-himalaya-session": "test-token" };
  const ref = { account: "andre", mailbox: "INBOX", message: "7" };

  it("stores, lists and cancels a snoozed message behind the session boundary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "snooze-app-"));
    const app = await createApp(fakeService(), { token: "test-token", snoozePath: join(directory, "snoozed.json") });
    try {
      expect((await app.inject({ method: "GET", url: "/api/snoozed", headers: { host: "127.0.0.1" } })).statusCode).toBe(401);
      const until = new Date(Date.now() + 3_600_000).toISOString();
      expect((await app.inject({ method: "POST", url: "/api/snooze", headers, payload: { ref, until } })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/api/snoozed", headers })).json().snoozed).toEqual([{ ...ref, until }]);
      expect((await app.inject({ method: "POST", url: "/api/snooze", headers, payload: { ref, until: "2020-01-01T00:00:00Z" } })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: "/api/snooze/cancel", headers, payload: { ref } })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/api/snoozed", headers })).json().snoozed).toEqual([]);
    } finally {
      await app.close();
    }
  });
});

describe("cache warmer hooks", () => {
  const headers = { host: "127.0.0.1", "x-himalaya-session": "test-token" };

  it("counts GUI requests as use, remembers the unified accounts, ignores the widget poll and stops on close", async () => {
    const warmer = { touch: vi.fn(), remember: vi.fn(), start: vi.fn(), stop: vi.fn(), warm: vi.fn(async () => undefined) };
    const app = await createApp(fakeService(), { token: "test-token", widgetToken: "widget-token", warmer });
    await app.inject({ method: "GET", url: "/api/watch/summary", headers: { host: "127.0.0.1", "x-himalaya-session": "widget-token" } });
    expect(warmer.touch).not.toHaveBeenCalled();
    await app.inject({ method: "GET", url: "/api/snoozed", headers });
    expect(warmer.touch).not.toHaveBeenCalled();
    await app.inject({ method: "POST", url: "/api/unified/inbox", headers, payload: { accounts: ["andre", "anna"] } });
    expect(warmer.touch).toHaveBeenCalledTimes(1);
    expect(warmer.remember).toHaveBeenCalledWith(["andre", "anna"]);
    await app.inject({ method: "POST", url: "/api/unified/inbox", headers, payload: { accounts: ["andre"], q: "x" } });
    expect(warmer.remember).toHaveBeenCalledTimes(1);
    await app.close();
    expect(warmer.stop).toHaveBeenCalled();
  });
});

describe("label routes", () => {
  const headers = { host: "127.0.0.1", "x-himalaya-session": "test-token" };
  const ref = { account: "andre", mailbox: "INBOX", message: "7" };

  it("stores labels, returns them with the bootstrap, rejects bad input and forgets them when the message moves", async () => {
    const directory = await mkdtemp(join(tmpdir(), "labels-app-"));
    const app = await createApp(fakeService(), { token: "test-token", labelsPath: join(directory, "labels.json") });
    try {
      expect((await app.inject({ method: "POST", url: "/api/labels", headers: { host: "127.0.0.1" }, payload: { ref, labels: ["x"] } })).statusCode).toBe(401);
      expect((await app.inject({ method: "POST", url: "/api/labels", headers, payload: { ref, labels: ["Rechnung", " rechnung ", "Steuer"] } })).statusCode).toBe(200);
      const boot = await app.inject({ method: "GET", url: "/api/bootstrap", headers });
      expect(boot.json().labels).toEqual([{ ...ref, labels: ["Rechnung", "Steuer"] }]);
      expect((await app.inject({ method: "POST", url: "/api/labels", headers, payload: { ref, labels: ["x".repeat(30)] } })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: "/api/message/move", headers, payload: { ref, destination: "Archive" } })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/api/bootstrap", headers })).json().labels).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("keeps a successful move successful when the labels file cannot be written", async () => {
    const directory = await mkdtemp(join(tmpdir(), "labels-app-fail-"));
    const labelsPath = join(directory, "labels.json");
    const app = await createApp(fakeService(), { token: "test-token", labelsPath });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect((await app.inject({ method: "POST", url: "/api/labels", headers, payload: { ref, labels: ["x"] } })).statusCode).toBe(200);
      // A directory where the file goes makes the final rename (the cleanup after the move) fail.
      await rm(labelsPath);
      await mkdir(join(labelsPath, "occupied"), { recursive: true });
      const moved = await app.inject({ method: "POST", url: "/api/message/move", headers, payload: { ref, destination: "Archive" } });
      expect(moved.statusCode).toBe(200);
      expect(stderr.mock.calls.some(([text]) => String(text).includes("could not update labels.json"))).toBe(true);
    } finally {
      stderr.mockRestore();
      await app.close();
    }
  });
});
