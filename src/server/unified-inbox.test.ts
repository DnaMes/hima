import { describe, expect, it, vi } from "vitest";

import type { Envelope, Mailbox } from "../shared/types.js";
import type { SearchInput } from "./contracts.js";
import { HimalayaError, type EnvelopeQuery, type HimalayaService } from "./himalaya.js";
import { listUnifiedInbox, SOURCE_CONCURRENCY, type UnifiedInboxQuery } from "./unified-inbox.js";

type Service = Pick<HimalayaService, "listMailboxes" | "listEnvelopes">;
type Fixture = { mailboxes: Mailbox[]; envelopes: Envelope[] };
const date = "2026-09-18T10:00:00Z";

function mailbox(id: string, name = id): Mailbox {
  return { id, name, total: null, unread: null };
}

function envelope(id: string, sent: string | null = date): Envelope {
  return { id, date: sent, flags: [], from: [], to: [], subject: "Synthetic mail", size: 12, hasAttachment: false };
}

function queryFor(accounts: readonly string[]): UnifiedInboxQuery {
  return { accounts, page: 1, pageSize: 20 };
}

function serviceWith(fixtures: Record<string, Fixture>) {
  return {
    listMailboxes: vi.fn(async (account: string) => fixtures[account]!.mailboxes),
    listEnvelopes: vi.fn(async ({ account, page, pageSize }: EnvelopeQuery) =>
      fixtures[account]!.envelopes.slice((page - 1) * pageSize, page * pageSize)),
  } satisfies Service;
}

function serviceWithFailure(account: string): Service {
  const service = serviceWith({ andre: { mailboxes: [mailbox("INBOX")], envelopes: [envelope("andre-1")] } });
  return {
    ...service,
    async listMailboxes(alias) {
      if (alias === account) throw new HimalayaError("synthetic auth guidance", "AUTH_REQUIRED", false);
      return service.listMailboxes(alias);
    },
  };
}

function serviceWithPages() {
  return serviceWith({
    andre: {
      mailboxes: [mailbox("INBOX")],
      envelopes: ["andre-4", "andre-2", "andre-3", "andre-1", "andre-6", "andre-5"].map((id) => envelope(id)),
    },
  });
}

describe("listUnifiedInbox", () => {
  it("finds INBOX case-insensitively and attaches the source", async () => {
    const result = await listUnifiedInbox(serviceWith({
      andre: { mailboxes: [mailbox("Inbox")], envelopes: [envelope("andre-1", "2026-09-18T10:00:00Z")] },
      anna: { mailboxes: [mailbox("INBOX")], envelopes: [envelope("anna-1", "2026-09-18T09:00:00Z")] },
    }), queryFor(["andre", "anna"]));
    expect(result.envelopes.map(({ id, source }) => [id, source])).toEqual([
      ["andre-1", { account: "andre", mailbox: "Inbox" }],
      ["anna-1", { account: "anna", mailbox: "INBOX" }],
    ]);
    expect(result.hasMore).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("keeps successful accounts when one provider fails", async () => {
    const result = await listUnifiedInbox(serviceWithFailure("anna"), queryFor(["andre", "anna"]));
    expect(result.envelopes).toHaveLength(1);
    expect(result.warnings).toEqual([{ account: "anna", code: "AUTH_REQUIRED", message: "synthetic auth guidance" }]);
  });

  it("sorts ties deterministically and reports more data", async () => {
    const result = await listUnifiedInbox(serviceWithPages(), { ...queryFor(["andre"]), page: 2, pageSize: 2 });
    expect(result.envelopes.map((item) => item.id)).toEqual(["andre-3", "andre-4"]);
    expect(result.hasMore).toBe(true);
  });

  it.each([
    { name: "an exact source page of equal dates", count: 100, sent: date },
    { name: "a source-page boundary with null dates", count: 101, sent: null },
  ])("keeps consecutive pages complete and duplicate-free for $name", async ({ count, sent }) => {
    const ids = Array.from({ length: count }, (_, index) => String(count - index).padStart(3, "0"));
    const service = serviceWith({ andre: {
      mailboxes: [mailbox("INBOX")],
      envelopes: ids.map((id) => envelope(id, sent)),
    } });

    const first = await listUnifiedInbox(service, { accounts: ["andre"], page: 1, pageSize: 50 });
    const second = await listUnifiedInbox(service, { accounts: ["andre"], page: 2, pageSize: 50 });
    const combined = [...first.envelopes, ...second.envelopes].map(({ id }) => id);

    expect(combined).toEqual(Array.from({ length: 100 }, (_, index) => String(index + 1).padStart(3, "0")));
    expect(new Set(combined)).toHaveLength(100);
  });

  it("fetches a single source page for the first unified inbox page", async () => {
    const service = serviceWith({ andre: {
      mailboxes: [mailbox("INBOX")],
      envelopes: Array.from({ length: 300 }, (_, index) => envelope(String(index).padStart(3, "0"), new Date(Date.UTC(2026, 8, 18) - index * 60_000).toISOString())),
    } });
    const result = await listUnifiedInbox(service, { accounts: ["andre"], page: 1, pageSize: 50 });
    expect(service.listEnvelopes).toHaveBeenCalledTimes(1);
    expect(result.envelopes).toHaveLength(50);
    expect(result.hasMore).toBe(true);
  });

  it("widens to the full window when equal dates straddle the cut of a source", async () => {
    const service = serviceWith({ andre: {
      mailboxes: [mailbox("INBOX")],
      envelopes: Array.from({ length: 300 }, (_, index) => envelope(String(300 - index).padStart(3, "0"), date)),
    } });
    const result = await listUnifiedInbox(service, { accounts: ["andre"], page: 1, pageSize: 50 });
    expect(result.envelopes.map(({ id }) => id).slice(0, 3)).toEqual(["001", "002", "003"]);
  });

  it("uses the first matching mailbox id even when only its name matches", async () => {
    const service = serviceWith({ andre: {
      mailboxes: [mailbox("Archive"), mailbox("primary", "iNbOx"), mailbox("INBOX")],
      envelopes: [envelope("1")],
    } });
    const result = await listUnifiedInbox(service, queryFor(["andre"]));
    expect(service.listEnvelopes).toHaveBeenCalledWith({ account: "andre", mailbox: "primary", page: 1, pageSize: 100 });
    expect(result.envelopes[0]?.source).toEqual({ account: "andre", mailbox: "primary" });
  });

  it("warns without listing envelopes when INBOX is missing", async () => {
    const service = serviceWith({ anna: { mailboxes: [mailbox("Archive")], envelopes: [] } });
    expect(await listUnifiedInbox(service, queryFor(["anna"]))).toEqual({
      envelopes: [], hasMore: false,
      warnings: [{ account: "anna", code: "INBOX_NOT_FOUND", message: "Kein INBOX-Ordner für dieses Konto gefunden." }],
    });
    expect(service.listEnvelopes).not.toHaveBeenCalled();
  });

  it.each(["mailboxes", "envelopes"])("redacts unknown %s errors and keeps the successful account", async (stage) => {
    const service = serviceWith({
      andre: { mailboxes: [mailbox("INBOX")], envelopes: [envelope("1")] },
      anna: { mailboxes: [mailbox("INBOX")], envelopes: [] },
    });
    const failure = new Error("synthetic internal provider detail");
    const fake: Service = {
      async listMailboxes(account) {
        if (account === "anna" && stage === "mailboxes") throw failure;
        return service.listMailboxes(account);
      },
      async listEnvelopes(query) {
        if (query.account === "anna" && stage === "envelopes") throw failure;
        return service.listEnvelopes(query);
      },
    };
    const result = await listUnifiedInbox(fake, queryFor(["andre", "anna"]));
    expect(result.envelopes.map((item) => item.id)).toEqual(["1"]);
    expect(result.warnings).toEqual([{ account: "anna", code: "MAIL_OPERATION_FAILED", message: "Das Konto konnte nicht geladen werden." }]);
    expect(JSON.stringify(result)).not.toContain(failure.message);
  });

  it("discards an incomplete account when a later source page fails", async () => {
    const service = serviceWith({
      andre: { mailboxes: [mailbox("INBOX")], envelopes: [envelope("good")] },
      anna: { mailboxes: [mailbox("INBOX")], envelopes: Array.from({ length: 100 }, (_, i) => envelope(String(i))) },
    });
    const fake: Service = { ...service, async listEnvelopes(query) {
      if (query.account === "anna" && query.page === 2) throw new HimalayaError("synthetic auth guidance", "AUTH_REQUIRED", false);
      return service.listEnvelopes(query);
    } };
    const result = await listUnifiedInbox(fake, { accounts: ["andre", "anna"], page: 3, pageSize: 50 });
    expect(result.envelopes).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(result.warnings).toEqual([{ account: "anna", code: "AUTH_REQUIRED", message: "synthetic auth guidance" }]);
  });

  it("deduplicates aliases without mutating source envelopes", async () => {
    const original = Object.freeze(envelope("1"));
    const service = serviceWith({ andre: { mailboxes: [mailbox("INBOX")], envelopes: [original] } });
    const result = await listUnifiedInbox(service, queryFor(Object.freeze(["andre", "andre"])));
    expect(result.envelopes).toHaveLength(1);
    expect(service.listMailboxes).toHaveBeenCalledTimes(1);
    expect(service.listEnvelopes).toHaveBeenCalledTimes(1);
    expect(original).not.toHaveProperty("source");
  });

  it("sorts dates newest first with account and id ties and invalid dates last", async () => {
    const service = serviceWith({
      anna: { mailboxes: [mailbox("INBOX")], envelopes: [envelope("1"), envelope("invalid", "bad date")] },
      andre: { mailboxes: [mailbox("INBOX")], envelopes: [envelope("2"), envelope("1"), envelope("null", null), envelope("old", "1960-01-01T00:00:00Z"), envelope("new", "2026-09-18T11:00:00Z")] },
    });
    const result = await listUnifiedInbox(service, queryFor(["anna", "andre"]));
    expect(result.envelopes.map(({ id, source }) => [source?.account, id])).toEqual([
      ["andre", "new"], ["andre", "1"], ["andre", "2"], ["anna", "1"],
      ["andre", "old"], ["andre", "null"], ["anna", "invalid"],
    ]);
  });

  it("slices a global page after merging accounts", async () => {
    const service = serviceWith({
      andre: { mailboxes: [mailbox("INBOX")], envelopes: [envelope("a", "2026-09-18T12:00:00Z"), envelope("c", "2026-09-18T10:00:00Z")] },
      anna: { mailboxes: [mailbox("INBOX")], envelopes: [envelope("b", "2026-09-18T11:00:00Z"), envelope("d", "2026-09-18T09:00:00Z")] },
    });
    const result = await listUnifiedInbox(service, { accounts: ["andre", "anna"], page: 2, pageSize: 2 });
    expect(result.envelopes.map((item) => item.id)).toEqual(["c", "d"]);
    expect(result.hasMore).toBe(false);
  });

  it.each([0, -1, 11, 1.5, NaN, Infinity])("rejects invalid page %s before provider work", async (page) => {
    const service = serviceWith({});
    await expect(listUnifiedInbox(service, { accounts: ["andre"], page, pageSize: 20 }))
      .rejects.toEqual(new HimalayaError("Invalid unified inbox page.", "INVALID_INPUT", false));
    expect(service.listMailboxes).not.toHaveBeenCalled();
  });

  it.each([0, -1, 51, 1.5, NaN, Infinity])("rejects invalid page size %s before provider work", async (pageSize) => {
    const service = serviceWith({});
    await expect(listUnifiedInbox(service, { accounts: ["andre"], page: 1, pageSize }))
      .rejects.toEqual(new HimalayaError("Invalid unified inbox page size.", "INVALID_INPUT", false));
    expect(service.listMailboxes).not.toHaveBeenCalled();
  });

  it("returns an empty result without provider work for no accounts", async () => {
    const service = serviceWith({});
    expect(await listUnifiedInbox(service, queryFor([]))).toEqual({ envelopes: [], hasMore: false, warnings: [] });
    expect(service.listMailboxes).not.toHaveBeenCalled();
    expect(service.listEnvelopes).not.toHaveBeenCalled();
  });

  it.each([
    { page: 2, pageSize: 2, count: 21, sourceLimit: 20, start: 2 },
    { page: 2, pageSize: 2, count: 100, sourceLimit: 20, start: 2 },
    { page: 3, pageSize: 50, count: 501, sourceLimit: 500, start: 100 },
    { page: 3, pageSize: 50, count: 600, sourceLimit: 500, start: 100 },
  ])("merges only the stable source prefix of $sourceLimit with $count available records", async ({ page, pageSize, count, sourceLimit, start }) => {
    const service = serviceWith({ andre: {
      mailboxes: [mailbox("INBOX")],
      envelopes: Array.from({ length: count }, (_, i) =>
        envelope(i < sourceLimit ? `prefix-${String(i).padStart(3, "0")}` : `excess-${i}`)),
    } });

    // Equal-date excess records sort ahead of the permitted prefix by id.
    const result = await listUnifiedInbox(service, { accounts: ["andre"], page, pageSize });

    expect(result.envelopes.map(({ id }) => id)).toEqual(
      Array.from({ length: pageSize }, (_, i) => `prefix-${String(start + i).padStart(3, "0")}`),
    );
    expect(result.hasMore).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("bounds sequential source paging and forwards the same search to every account and page", async () => {
    const search: SearchInput = { field: "subject", text: "synthetic", unread: true };
    const envelopes = Array.from({ length: 600 }, (_, i) => envelope(String(i).padStart(3, "0")));
    const service = serviceWith({
      andre: { mailboxes: [mailbox("INBOX")], envelopes },
      anna: { mailboxes: [mailbox("Inbox")], envelopes },
    });
    const active = new Set<string>();
    let overlap = false;
    const fake: Service = { ...service, async listEnvelopes(query) {
      if (active.has(query.account)) overlap = true;
      active.add(query.account);
      await Promise.resolve();
      const result = await service.listEnvelopes(query);
      active.delete(query.account);
      return result;
    } };
    const result = await listUnifiedInbox(fake, { accounts: ["andre", "anna"], page: 10, pageSize: 50, search });
    expect(result.envelopes).toHaveLength(50);
    expect(result.hasMore).toBe(false);
    expect(overlap).toBe(false);
    for (const account of ["andre", "anna"]) {
      const queries = service.listEnvelopes.mock.calls.map(([query]) => query).filter((query) => query.account === account);
      expect(queries.map(({ page, pageSize }) => [page, pageSize])).toEqual([[1, 100], [2, 100], [3, 100], [4, 100], [5, 100]]);
      for (const query of queries) expect(query.search).toBe(search);
    }
  });

  it("does not report another page beyond the maximum unified page", async () => {
    const service = serviceWith({ andre: {
      mailboxes: [mailbox("INBOX")],
      envelopes: Array.from({ length: 501 }, (_, index) => envelope(String(index).padStart(3, "0"))),
    } });

    const result = await listUnifiedInbox(service, { accounts: ["andre"], page: 10, pageSize: 50 });

    expect(result.envelopes).toHaveLength(50);
    expect(result.hasMore).toBe(false);
  });

  it("stops after a short source page and distinguishes exhaustion from a full final page", async () => {
    for (const count of [100, 101, 200]) {
      const service = serviceWith({ andre: {
        mailboxes: [mailbox("INBOX")], envelopes: Array.from({ length: count }, (_, i) => envelope(String(i))),
      } });
      const result = await listUnifiedInbox(service, { accounts: ["andre"], page: 4, pageSize: 50 });
      expect(service.listEnvelopes.mock.calls.map(([query]) => query.page)).toEqual(count === 200 ? [1, 2, 3] : [1, 2]);
      expect(result.envelopes).toHaveLength(count === 200 ? 50 : 0);
      expect(result.hasMore).toBe(false);
    }
  });

  it("limits concurrent accounts to the fan-out cap and eventually processes all aliases", async () => {
    const accounts = Array.from({ length: SOURCE_CONCURRENCY + 3 }, (_, index) => `acct${String(index).padStart(2, "0")}`);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let ready!: () => void;
    const firstBatchStarted = new Promise<void>((resolve) => { ready = resolve; });
    const started: string[] = [];
    let active = 0;
    let maximum = 0;
    const service: Service = {
      async listMailboxes(account) {
        started.push(account);
        maximum = Math.max(maximum, ++active);
        if (started.length === SOURCE_CONCURRENCY) ready();
        await gate;
        return [mailbox("INBOX")];
      },
      async listEnvelopes({ account }) {
        await Promise.resolve();
        active--;
        return [envelope(account)];
      },
    };
    const pending = listUnifiedInbox(service, queryFor(accounts));
    await firstBatchStarted;
    const initial = [...started];
    release();
    const result = await pending;
    expect(initial).toEqual(accounts.slice(0, SOURCE_CONCURRENCY));
    expect(maximum).toBe(SOURCE_CONCURRENCY);
    expect(started).toEqual(accounts);
    expect(result.envelopes).toHaveLength(accounts.length);
    expect(result.warnings).toEqual([]);
  });
});
