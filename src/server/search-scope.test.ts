import { describe, expect, it, vi } from "vitest";

import type { Envelope, Mailbox } from "../shared/types.js";
import { HimalayaError, type EnvelopeQuery } from "./himalaya.js";
import { findJunkMailbox, isGmailAggregate, isJunkOrTrash, MAX_SOURCES, resolveSources } from "./search-scope.js";
import { listSources } from "./unified-inbox.js";

const mailbox = (id: string): Mailbox => ({ id, name: id, total: null, unread: null });

function mailboxService(byAccount: Record<string, string[]>) {
  return {
    listMailboxes: vi.fn(async (account: string) => {
      if (!(account in byAccount)) throw new HimalayaError("synthetic auth guidance", "AUTH_REQUIRED", false);
      return byAccount[account]!.map(mailbox);
    }),
  };
}

describe("isJunkOrTrash", () => {
  it.each(["Junk", "Spam", "Trash", "Papierkorb", "Deleted Messages", "Deleted Items", "[Google Mail]/Spam", "[Gmail]/Trash"])(
    "treats %s as junk or trash",
    (name) => expect(isJunkOrTrash(mailbox(name))).toBe(true),
  );

  it.each(["INBOX", "Archive", "Newsletter", "Junkyard"])("keeps %s", (name) => expect(isJunkOrTrash(mailbox(name))).toBe(false));
});

describe("findJunkMailbox", () => {
  const find = (...names: string[]) => findJunkMailbox(names.map(mailbox))?.id ?? null;

  it.each(["Junk", "[Google Mail]/Spam", "[Gmail]/Spam", "INBOX.Junk", "Junk E-Mail", "Junk Email", "SPAM"])("picks %s", (name) => {
    expect(find("INBOX", "Trash", name)).toBe(name);
  });

  it("never picks the trash and returns null when there is no junk folder", () => {
    expect(find("INBOX", "Trash", "Papierkorb", "Deleted Messages", "Junkyard")).toBeNull();
    expect(find()).toBeNull();
  });
});

describe("isGmailAggregate", () => {
  it.each(["[Google Mail]/Alle Nachrichten", "[Gmail]/All Mail", "[Google Mail]/Wichtig", "[Gmail]/Important", "[Google Mail]/Markiert", "[Gmail]/Starred"])(
    "flags %s",
    (name) => expect(isGmailAggregate(mailbox(name))).toBe(true),
  );

  it.each(["Wichtig", "Starred", "All Mail", "[Google Mail]/Gesendet", "INBOX"])("keeps %s", (name) => expect(isGmailAggregate(mailbox(name))).toBe(false));
});

describe("resolveSources", () => {
  it("returns just the current folder without listing mailboxes", async () => {
    const service = mailboxService({});
    const result = await resolveSources(service, {
      scope: "folder", accounts: [], current: { account: "a", mailbox: "INBOX" }, includeJunk: false,
    });

    expect(result).toEqual({ sources: [{ account: "a", mailbox: "INBOX" }], warnings: [] });
    expect(service.listMailboxes).not.toHaveBeenCalled();
  });

  it("covers every folder of one account for the account scope", async () => {
    const service = mailboxService({ a: ["INBOX", "Work"], b: ["INBOX"] });
    const { sources } = await resolveSources(service, {
      scope: "account", accounts: ["a", "b"], current: { account: "a", mailbox: "INBOX" }, includeJunk: false,
    });

    expect(sources).toEqual([{ account: "a", mailbox: "INBOX" }, { account: "a", mailbox: "Work" }]);
    expect(service.listMailboxes).toHaveBeenCalledTimes(1);
  });

  it("walks the accounts in order for the all scope", async () => {
    const service = mailboxService({ a: ["INBOX"], b: ["INBOX", "Archive"] });
    const { sources } = await resolveSources(service, { scope: "all", accounts: ["a", "b"], includeJunk: false });

    expect(sources.map((source) => `${source.account}/${source.mailbox}`)).toEqual(["a/INBOX", "b/INBOX", "b/Archive"]);
  });

  it("drops junk and trash unless asked to include them", async () => {
    const folders = ["INBOX", "[Google Mail]/Spam", "Junk", "Papierkorb", "Deleted Messages", "Trash"];
    const service = mailboxService({ a: folders });
    const input = { scope: "all" as const, accounts: ["a"] };

    expect((await resolveSources(service, { ...input, includeJunk: false })).sources).toEqual([{ account: "a", mailbox: "INBOX" }]);
    expect((await resolveSources(service, { ...input, includeJunk: true })).sources).toHaveLength(folders.length);
  });

  it("fills the cap with every account's INBOX first, then one more folder per account in turn", async () => {
    const lots = Array.from({ length: 39 }, (_, index) => `a${index + 1}`);
    const service = mailboxService({ a: ["INBOX", ...lots], b: ["INBOX", "b1", "b2"], c: ["Inbox"] });
    const result = await resolveSources(service, { scope: "all", accounts: ["a", "b", "c"], includeJunk: false });
    const names = result.sources.map((source) => `${source.account}/${source.mailbox}`);

    expect(result.sources).toHaveLength(MAX_SOURCES);
    expect(names.slice(0, 7)).toEqual(["a/INBOX", "b/INBOX", "c/Inbox", "a/a1", "b/b1", "a/a2", "b/b2"]);
    expect(names.filter((name) => name.startsWith("b/"))).toHaveLength(3);
    // 3 INBOXes + (a1,b1,a2,b2) + 23 more from account a: it keeps 26 of its 40 folders.
    expect(result.warnings).toEqual([{ account: "a", code: "SOURCE_CAP", message: `14 Ordner nicht durchsucht (Obergrenze ${MAX_SOURCES}).` }]);
  });

  it("names each account that lost folders when even the INBOXes do not fit", async () => {
    const accounts = Array.from({ length: MAX_SOURCES + 2 }, (_, index) => `acc${index}`);
    const service = mailboxService(Object.fromEntries(accounts.map((account) => [account, ["INBOX", "Extra"]])));
    const result = await resolveSources(service, { scope: "all", accounts, includeJunk: false });

    expect(result.sources).toHaveLength(MAX_SOURCES);
    expect(result.sources.every((source) => source.mailbox === "INBOX")).toBe(true);
    expect(result.warnings).toHaveLength(accounts.length);
    expect(result.warnings.find((warning) => warning.account === "acc0")?.message).toBe(`1 Ordner nicht durchsucht (Obergrenze ${MAX_SOURCES}).`);
    expect(result.warnings.find((warning) => warning.account === `acc${MAX_SOURCES + 1}`)?.message).toBe(`2 Ordner nicht durchsucht (Obergrenze ${MAX_SOURCES}).`);
  });

  it("lists folders without the slow per-folder counts", async () => {
    const service = mailboxService({ a: ["INBOX"] });
    await resolveSources(service, { scope: "all", accounts: ["a"], includeJunk: false });

    expect(service.listMailboxes).toHaveBeenCalledWith("a", { counts: false });
  });

  it("never searches Gmail's duplicating collection folders, whatever the junk setting", async () => {
    const folders = ["INBOX", "[Google Mail]/Alle Nachrichten", "[Gmail]/All Mail", "[Google Mail]/Wichtig", "[Gmail]/Important", "[Google Mail]/Markiert", "[Gmail]/Starred", "Wichtig", "Work"];
    const service = mailboxService({ a: folders });

    for (const includeJunk of [false, true]) {
      const { sources } = await resolveSources(service, { scope: "all", accounts: ["a"], includeJunk });
      expect(sources.map((source) => source.mailbox)).toEqual(["INBOX", "Wichtig", "Work"]);
    }
  });

  it("keeps the cap at the value measured on the real accounts (see the spec's Risks)", () => {
    expect(MAX_SOURCES).toBe(30);
  });

  it("turns a failing account into a warning and still resolves the others", async () => {
    const service = mailboxService({ b: ["INBOX"] });
    const result = await resolveSources(service, { scope: "all", accounts: ["a", "b"], includeJunk: false });

    expect(result.sources).toEqual([{ account: "b", mailbox: "INBOX" }]);
    expect(result.warnings).toEqual([{ account: "a", code: "AUTH_REQUIRED", message: "synthetic auth guidance" }]);
  });
});

const day = (value: number): string => `2026-09-${String(value).padStart(2, "0")}T10:00:00Z`;
const envelope = (id: string, date: string | null): Envelope => (
  { id, date, flags: [], from: [], to: [], subject: id, size: 1, hasAttachment: false }
);

// Mimics the CLI: honors `order` and slices by page like `envelope search` does.
function envelopeService(data: Record<string, Envelope[]>, failing: string[] = []) {
  return {
    listEnvelopes: vi.fn(async ({ account, mailbox: folder, page, pageSize, search }: EnvelopeQuery) => {
      const key = `${account}/${folder}`;
      if (failing.includes(key)) throw new HimalayaError("synthetic failure", "AUTH_REQUIRED", false);
      const direction = search?.order === "asc" ? 1 : -1;
      const ordered = [...(data[key] ?? [])].sort((l, r) => direction * (Date.parse(l.date ?? "") - Date.parse(r.date ?? "")) || 0);
      return ordered.slice((page - 1) * pageSize, page * pageSize);
    }),
  };
}

const sources = [
  { account: "a", mailbox: "INBOX" }, { account: "a", mailbox: "Work" },
  { account: "b", mailbox: "INBOX" }, { account: "b", mailbox: "Work" },
];
const ids = (result: { envelopes: Envelope[] }): string[] => result.envelopes.map((item) => item.id);

describe("listSources", () => {
  const data = {
    "a/INBOX": [envelope("a-inbox", day(5))], "a/Work": [envelope("a-work", day(9))],
    "b/INBOX": [envelope("b-inbox", day(7))], "b/Work": [envelope("b-work", day(1))],
  };

  it("merges folders of several accounts newest first and tags each hit with its source", async () => {
    const result = await listSources(envelopeService(data), sources, { page: 1, pageSize: 20 });

    expect(ids(result)).toEqual(["a-work", "b-inbox", "a-inbox", "b-work"]);
    expect(result.envelopes[0]?.source).toEqual({ account: "a", mailbox: "Work" });
  });

  it("sorts oldest first for order asc", async () => {
    const result = await listSources(envelopeService(data), sources, { page: 1, pageSize: 20, search: { field: "all", text: "", order: "asc" } });

    expect(ids(result)).toEqual(["b-work", "a-inbox", "b-inbox", "a-work"]);
  });

  it("breaks equal timestamps by account, mailbox and id, with no overlap or gap between pages", async () => {
    const tied = Object.fromEntries(sources.map((source) => [`${source.account}/${source.mailbox}`, [envelope("2", day(3)), envelope("1", day(3))]]));
    const service = envelopeService(tied);
    const first = await listSources(service, sources, { page: 1, pageSize: 4 });
    const second = await listSources(service, sources, { page: 2, pageSize: 4 });

    expect(first.hasMore).toBe(true);
    expect(first.envelopes.map((item) => `${item.source!.account}/${item.source!.mailbox}/${item.id}`)).toEqual([
      "a/INBOX/1", "a/INBOX/2", "a/Work/1", "a/Work/2",
    ]);
    expect([...ids(first), ...ids(second)]).toHaveLength(8);
    expect(second.envelopes.map((item) => `${item.source!.account}/${item.source!.mailbox}/${item.id}`)).toEqual([
      "b/INBOX/1", "b/INBOX/2", "b/Work/1", "b/Work/2",
    ]);
  });

  it("keeps undated mail last in both directions", async () => {
    const mixed = { "a/INBOX": [envelope("undated", null), envelope("dated", day(2))] };
    const one = [{ account: "a", mailbox: "INBOX" }];

    expect(ids(await listSources(envelopeService(mixed), one, { page: 1, pageSize: 20 }))).toEqual(["dated", "undated"]);
    expect(ids(await listSources(envelopeService(mixed), one, { page: 1, pageSize: 20, search: { field: "all", text: "", order: "asc" } })))
      .toEqual(["dated", "undated"]);
  });

  it("reports a failing folder with account and mailbox and still returns the other hits", async () => {
    const result = await listSources(envelopeService(data, ["b/Work"]), sources, { page: 1, pageSize: 20 });

    expect(ids(result)).toEqual(["a-work", "b-inbox", "a-inbox"]);
    expect(result.warnings).toEqual([{ account: "b", mailbox: "Work", code: "AUTH_REQUIRED", message: "synthetic failure" }]);
  });

  it("rejects an invalid page like the unified inbox does", async () => {
    await expect(listSources(envelopeService(data), sources, { page: 0, pageSize: 20 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
