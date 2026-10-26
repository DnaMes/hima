import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Envelope, Mailbox } from "../shared/types.js";
import { HimalayaError, type HimalayaService } from "./himalaya.js";
import type { Rule } from "./rules.js";
import type { AccountFolderSettings } from "./special-folders.js";
import { createWatcher } from "./watcher.js";

function envelope(id: string, from: string, subject: string): Envelope {
  return {
    id,
    date: null,
    flags: [],
    from: [{ email: from, name: null }],
    to: [],
    subject,
    size: 10,
    hasAttachment: false,
  };
}

function inbox(unread: number | null): Mailbox {
  return { id: "INBOX", name: "INBOX", total: unread, unread };
}

type FakeService = Pick<HimalayaService, "listMailboxes" | "listEnvelopes" | "setFlag" | "move"> & Partial<Pick<HimalayaService, "readRaw">>;

type FakeDeps = {
  service: FakeService;
  readAccountsConfig: () => Promise<Record<string, AccountFolderSettings>>;
  readRules: () => Promise<Rule[]>;
  notify: ReturnType<typeof vi.fn>;
};

function makeDeps(overrides: Partial<FakeDeps> = {}): FakeDeps {
  return {
    service: {
      listMailboxes: vi.fn().mockResolvedValue([inbox(0)]),
      listEnvelopes: vi.fn().mockResolvedValue([]),
      setFlag: vi.fn().mockResolvedValue(undefined),
      move: vi.fn().mockResolvedValue(undefined),
    },
    readAccountsConfig: vi.fn().mockResolvedValue({}),
    readRules: vi.fn().mockResolvedValue([]),
    notify: vi.fn(),
    ...overrides,
  };
}

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "r1",
    account: "andre",
    enabled: true,
    dryRun: false,
    condition: { field: "from", match: "contains", value: "newsletter@x.test" },
    actions: [{ type: "flag", flag: "seen", value: true }],
    ...overrides,
  };
}

describe("createWatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does nothing and never throws when no account is watched (Review Focus: empty accounts.json)", async () => {
    const deps = makeDeps();
    const watcher = createWatcher({ ...deps, intervalMs: 60_000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(deps.service.listMailboxes).not.toHaveBeenCalled();
    expect(watcher.summary()).toEqual({ accounts: [], totalUnread: 0 });
    watcher.stop();
  });

  it("does not notify on the first tick after startup, but seeds notifiedIds from the existing unread backlog (baseline only)", async () => {
    const deps = makeDeps({
      service: {
        listMailboxes: vi.fn().mockResolvedValue([inbox(5)]),
        listEnvelopes: vi.fn().mockResolvedValue([
          envelope("p1", "a@x.test", "Old 1"),
          envelope("p2", "a@x.test", "Old 2"),
        ]),
        setFlag: vi.fn().mockResolvedValue(undefined),
        move: vi.fn().mockResolvedValue(undefined),
      },
      readAccountsConfig: vi.fn().mockResolvedValue({ andre: { overrides: {}, watch: true } }),
    });
    const watcher = createWatcher({ ...deps, intervalMs: 60_000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(deps.notify).not.toHaveBeenCalled();
    expect(deps.service.listEnvelopes).toHaveBeenCalledWith({
      account: "andre",
      mailbox: "INBOX",
      page: 1,
      pageSize: 10,
      search: { field: "all", text: "", unread: true },
    });
    expect(watcher.summary()).toEqual({ accounts: [{ account: "andre", unread: 5, error: null }], totalUnread: 5 });
    watcher.stop();
  });

  it("notifies once per new envelope when unread rises, fetching only the watched account's INBOX", async () => {
    const listMailboxes = vi.fn().mockResolvedValueOnce([inbox(2)]).mockResolvedValueOnce([inbox(4)]);
    const listEnvelopes = vi.fn()
      .mockResolvedValueOnce([]) // baseline seed: nothing pre-existing to seed
      .mockResolvedValueOnce([
        envelope("1", "a@x.test", "Hallo"),
        envelope("2", "b@x.test", "Zweite"),
      ]);
    const deps = makeDeps({
      service: { listMailboxes, listEnvelopes, setFlag: vi.fn().mockResolvedValue(undefined), move: vi.fn().mockResolvedValue(undefined) },
      readAccountsConfig: vi.fn().mockResolvedValue({ andre: { overrides: {}, watch: true } }),
    });
    const watcher = createWatcher({ ...deps, intervalMs: 60_000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(0); // baseline tick, unread=2
    await vi.advanceTimersByTimeAsync(60_000); // second tick, unread=4 (rose)

    expect(listEnvelopes).toHaveBeenCalledWith({
      account: "andre",
      mailbox: "INBOX",
      page: 1,
      pageSize: 10,
      search: { field: "all", text: "", unread: true },
    });
    expect(deps.notify).toHaveBeenCalledTimes(2);
    expect(deps.notify).toHaveBeenNthCalledWith(1, "andre", "a@x.test: Hallo");
    expect(deps.notify).toHaveBeenNthCalledWith(2, "andre", "b@x.test: Zweite");
    watcher.stop();
  });

  it("coalesces more than 3 new envelopes into one summary notification", async () => {
    const many = Array.from({ length: 5 }, (_, i) => envelope(String(i), `a${i}@x.test`, "Hallo"));
    const listMailboxes = vi.fn().mockResolvedValueOnce([inbox(0)]).mockResolvedValueOnce([inbox(5)]);
    const listEnvelopes = vi.fn()
      .mockResolvedValueOnce([]) // baseline seed: nothing pre-existing to seed
      .mockResolvedValueOnce(many);
    const deps = makeDeps({
      service: { listMailboxes, listEnvelopes, setFlag: vi.fn().mockResolvedValue(undefined), move: vi.fn().mockResolvedValue(undefined) },
      readAccountsConfig: vi.fn().mockResolvedValue({ andre: { overrides: {}, watch: true } }),
    });
    const watcher = createWatcher({ ...deps, intervalMs: 60_000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledWith("andre", "5 neue Nachrichten in andre");
    watcher.stop();
  });

  it("does not re-notify for an envelope id already notified in an earlier tick", async () => {
    const listMailboxes = vi.fn()
      .mockResolvedValueOnce([inbox(1)])
      .mockResolvedValueOnce([inbox(2)])
      .mockResolvedValueOnce([inbox(2)]);
    const listEnvelopes = vi.fn()
      .mockResolvedValueOnce([]) // baseline seed: nothing pre-existing to seed
      .mockResolvedValue([envelope("1", "a@x.test", "Hallo")]);
    const deps = makeDeps({
      service: { listMailboxes, listEnvelopes, setFlag: vi.fn().mockResolvedValue(undefined), move: vi.fn().mockResolvedValue(undefined) },
      readAccountsConfig: vi.fn().mockResolvedValue({ andre: { overrides: {}, watch: true } }),
    });
    const watcher = createWatcher({ ...deps, intervalMs: 60_000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(deps.notify).toHaveBeenCalledTimes(1);
    watcher.stop();
  });

  it("does not report an account's pre-existing unread backlog as new mail on the first real rise after startup", async () => {
    // Regression test: a watched account with unread mail already sitting in
    // its INBOX at service start must not have that backlog reported as "new"
    // the moment one genuinely new message arrives — the baseline tick must
    // seed notifiedIds from the existing backlog, not leave it empty.
    const preExisting = [
      envelope("p1", "a@x.test", "Old 1"),
      envelope("p2", "a@x.test", "Old 2"),
    ];
    const listMailboxes = vi.fn().mockResolvedValueOnce([inbox(2)]).mockResolvedValueOnce([inbox(3)]);
    const listEnvelopes = vi.fn()
      .mockResolvedValueOnce(preExisting) // baseline seed
      .mockResolvedValueOnce([...preExisting, envelope("n1", "b@x.test", "New 1")]); // second tick
    const deps = makeDeps({
      service: { listMailboxes, listEnvelopes, setFlag: vi.fn().mockResolvedValue(undefined), move: vi.fn().mockResolvedValue(undefined) },
      readAccountsConfig: vi.fn().mockResolvedValue({ andre: { overrides: {}, watch: true } }),
    });
    const watcher = createWatcher({ ...deps, intervalMs: 60_000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(0); // baseline: unread=2, seeds p1/p2
    expect(deps.notify).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000); // unread rises 2 -> 3, one genuinely new message
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledWith("andre", "b@x.test: New 1");
    watcher.stop();
  });

  it("still detects a later rise after an intermediate drop (Review Focus: read-elsewhere then new mail)", async () => {
    const listMailboxes = vi.fn()
      .mockResolvedValueOnce([inbox(5)]) // baseline
      .mockResolvedValueOnce([inbox(1)]) // dropped (read elsewhere) — must not notify
      .mockResolvedValueOnce([inbox(2)]); // rose again — must notify
    const listEnvelopes = vi.fn()
      .mockResolvedValueOnce([]) // baseline seed: nothing pre-existing to seed
      .mockResolvedValue([envelope("new-1", "a@x.test", "Neu")]);
    const deps = makeDeps({
      service: { listMailboxes, listEnvelopes, setFlag: vi.fn().mockResolvedValue(undefined), move: vi.fn().mockResolvedValue(undefined) },
      readAccountsConfig: vi.fn().mockResolvedValue({ andre: { overrides: {}, watch: true } }),
    });
    const watcher = createWatcher({ ...deps, intervalMs: 60_000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deps.notify).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledWith("andre", "a@x.test: Neu");
    watcher.stop();
  });

  it("isolates a per-account error without stopping other watched accounts (Review Focus)", async () => {
    const authError = new HimalayaError(
      "Gmail benötigt ein App-Passwort oder eine OAuth2-Anmeldung. Prüfe die Zugangsdaten dieses Kontos.",
      "AUTH_REQUIRED",
      false,
    );
    const listMailboxes = vi.fn(async (account: string) => {
      if (account === "broken") throw authError;
      return [inbox(1)];
    });
    const deps = makeDeps({
      service: {
        listMailboxes, listEnvelopes: vi.fn().mockResolvedValue([]),
        setFlag: vi.fn().mockResolvedValue(undefined), move: vi.fn().mockResolvedValue(undefined),
      },
      readAccountsConfig: vi.fn().mockResolvedValue({
        broken: { overrides: {}, watch: true },
        ok: { overrides: {}, watch: true },
      }),
    });
    const watcher = createWatcher({ ...deps, intervalMs: 60_000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(0);

    const summary = watcher.summary();
    expect(summary.accounts).toContainEqual({ account: "ok", unread: 1, error: null });
    expect(summary.accounts).toContainEqual({
      account: "broken",
      unread: null,
      error: "Gmail benötigt ein App-Passwort oder eine OAuth2-Anmeldung. Prüfe die Zugangsdaten dieses Kontos.",
    });
    watcher.stop();
  });

  it("reports an error instead of silently doing nothing when a watched account has no INBOX mailbox", async () => {
    const listMailboxes = vi.fn().mockResolvedValue([
      { id: "Sent", name: "Sent", total: 0, unread: 0 },
    ]);
    const deps = makeDeps({
      service: { listMailboxes, listEnvelopes: vi.fn(), setFlag: vi.fn().mockResolvedValue(undefined), move: vi.fn().mockResolvedValue(undefined) },
      readAccountsConfig: vi.fn().mockResolvedValue({ andre: { overrides: {}, watch: true } }),
    });
    const watcher = createWatcher({ ...deps, intervalMs: 60_000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(deps.service.listEnvelopes).not.toHaveBeenCalled();
    expect(watcher.summary()).toEqual({
      accounts: [{ account: "andre", unread: null, error: "INBOX für dieses Konto nicht gefunden." }],
      totalUnread: 0,
    });
    watcher.stop();
  });

  it("re-reads accounts.json every tick, dropping an account from the summary once watch turns off (Review Focus)", async () => {
    const deps = makeDeps({
      service: {
        listMailboxes: vi.fn().mockResolvedValue([inbox(1)]), listEnvelopes: vi.fn().mockResolvedValue([]),
        setFlag: vi.fn().mockResolvedValue(undefined), move: vi.fn().mockResolvedValue(undefined),
      },
      readAccountsConfig: vi.fn()
        .mockResolvedValueOnce({ andre: { overrides: {}, watch: true } })
        .mockResolvedValueOnce({ andre: { overrides: {}, watch: false } }),
    });
    const watcher = createWatcher({ ...deps, intervalMs: 60_000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(watcher.summary().accounts).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(watcher.summary().accounts).toHaveLength(0);
    watcher.stop();
  });

  it("stop() clears the interval so no further ticks run", async () => {
    const deps = makeDeps({
      service: {
        listMailboxes: vi.fn().mockResolvedValue([inbox(1)]), listEnvelopes: vi.fn().mockResolvedValue([]),
        setFlag: vi.fn().mockResolvedValue(undefined), move: vi.fn().mockResolvedValue(undefined),
      },
      readAccountsConfig: vi.fn().mockResolvedValue({ andre: { overrides: {}, watch: true } }),
    });
    const watcher = createWatcher({ ...deps, intervalMs: 60_000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    watcher.stop();

    vi.mocked(deps.service.listMailboxes).mockClear();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(deps.service.listMailboxes).not.toHaveBeenCalled();
  });

  it("does not overlap ticks when one tick is still in flight when the next timer fires", async () => {
    const pending: { resolve: (() => void) | null } = { resolve: null };
    const listMailboxes = vi.fn()
      .mockImplementationOnce(() => new Promise<Mailbox[]>((resolve) => { pending.resolve = () => resolve([inbox(1)]); }))
      .mockResolvedValue([inbox(1)]);
    const deps = makeDeps({
      service: {
        listMailboxes, listEnvelopes: vi.fn().mockResolvedValue([]),
        setFlag: vi.fn().mockResolvedValue(undefined), move: vi.fn().mockResolvedValue(undefined),
      },
      readAccountsConfig: vi.fn().mockResolvedValue({ andre: { overrides: {}, watch: true } }),
    });
    const watcher = createWatcher({ ...deps, intervalMs: 60_000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(0); // first tick starts and hangs on listMailboxes
    await vi.advanceTimersByTimeAsync(60_000); // timer fires again while the first tick is still in flight

    expect(listMailboxes).toHaveBeenCalledTimes(1); // the second firing was skipped, not queued
    pending.resolve?.();
    await vi.advanceTimersByTimeAsync(0);
    watcher.stop();
  });

  it("applies a matching live rule's flag action and suppresses the notification for a seen: true match", async () => {
    const listMailboxes = vi.fn().mockResolvedValueOnce([inbox(0)]).mockResolvedValueOnce([inbox(1)]);
    const listEnvelopes = vi.fn()
      .mockResolvedValueOnce([]) // baseline seed
      .mockResolvedValueOnce([envelope("1", "newsletter@x.test", "Weekly digest")]);
    const deps = makeDeps({
      service: {
        listMailboxes, listEnvelopes,
        setFlag: vi.fn().mockResolvedValue(undefined),
        move: vi.fn().mockResolvedValue(undefined),
      },
      readAccountsConfig: vi.fn().mockResolvedValue({ andre: { overrides: {}, watch: true } }),
      readRules: vi.fn().mockResolvedValue([rule()]),
    });
    const watcher = createWatcher({ ...deps, intervalMs: 60_000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(deps.service.setFlag).toHaveBeenCalledWith(
      { account: "andre", mailbox: "INBOX", message: "1" }, "seen", true,
    );
    expect(deps.notify).not.toHaveBeenCalled();
    watcher.stop();
  });

  it("a matching live rule's move action moves the message and suppresses the notification", async () => {
    const listMailboxes = vi.fn().mockResolvedValueOnce([inbox(0)]).mockResolvedValueOnce([inbox(1)]);
    const listEnvelopes = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([envelope("1", "newsletter@x.test", "Weekly digest")]);
    const deps = makeDeps({
      service: {
        listMailboxes, listEnvelopes,
        setFlag: vi.fn().mockResolvedValue(undefined),
        move: vi.fn().mockResolvedValue(undefined),
      },
      readAccountsConfig: vi.fn().mockResolvedValue({ andre: { overrides: {}, watch: true } }),
      readRules: vi.fn().mockResolvedValue([rule({ actions: [{ type: "move", mailbox: "Newsletter" }] })]),
    });
    const watcher = createWatcher({ ...deps, intervalMs: 60_000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(deps.service.move).toHaveBeenCalledWith(
      { account: "andre", mailbox: "INBOX", message: "1" }, "Newsletter",
    );
    expect(deps.notify).not.toHaveBeenCalled();
    watcher.stop();
  });

  it("a rule that only sets a non-seen flag (e.g. flagged) still notifies normally", async () => {
    const listMailboxes = vi.fn().mockResolvedValueOnce([inbox(0)]).mockResolvedValueOnce([inbox(1)]);
    const listEnvelopes = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([envelope("1", "newsletter@x.test", "Weekly digest")]);
    const deps = makeDeps({
      service: {
        listMailboxes, listEnvelopes,
        setFlag: vi.fn().mockResolvedValue(undefined),
        move: vi.fn().mockResolvedValue(undefined),
      },
      readAccountsConfig: vi.fn().mockResolvedValue({ andre: { overrides: {}, watch: true } }),
      readRules: vi.fn().mockResolvedValue([rule({ actions: [{ type: "flag", flag: "flagged", value: true }] })]),
    });
    const watcher = createWatcher({ ...deps, intervalMs: 60_000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(deps.service.setFlag).toHaveBeenCalledWith(
      { account: "andre", mailbox: "INBOX", message: "1" }, "flagged", true,
    );
    expect(deps.notify).toHaveBeenCalledWith("andre", "newsletter@x.test: Weekly digest");
    watcher.stop();
  });

  it("a dry-run rule never calls setFlag/move and the message still notifies normally (Review Focus)", async () => {
    const listMailboxes = vi.fn().mockResolvedValueOnce([inbox(0)]).mockResolvedValueOnce([inbox(1)]);
    const listEnvelopes = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([envelope("1", "newsletter@x.test", "Weekly digest")]);
    const deps = makeDeps({
      service: {
        listMailboxes, listEnvelopes,
        setFlag: vi.fn().mockResolvedValue(undefined),
        move: vi.fn().mockResolvedValue(undefined),
      },
      readAccountsConfig: vi.fn().mockResolvedValue({ andre: { overrides: {}, watch: true } }),
      readRules: vi.fn().mockResolvedValue([rule({ dryRun: true, actions: [{ type: "move", mailbox: "Newsletter" }] })]),
    });
    const watcher = createWatcher({ ...deps, intervalMs: 60_000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(deps.service.setFlag).not.toHaveBeenCalled();
    expect(deps.service.move).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith("andre", "newsletter@x.test: Weekly digest");
    watcher.stop();
  });

  it("a rule action failure for one envelope does not stop the tick or other envelopes (Review Focus)", async () => {
    const listMailboxes = vi.fn().mockResolvedValueOnce([inbox(0)]).mockResolvedValueOnce([inbox(2)]);
    const listEnvelopes = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        envelope("1", "newsletter@x.test", "Weekly digest"),
        envelope("2", "someone-else@x.test", "Hello"),
      ]);
    const move = vi.fn().mockRejectedValueOnce(new Error("Zielordner existiert nicht")).mockResolvedValue(undefined);
    const deps = makeDeps({
      service: { listMailboxes, listEnvelopes, setFlag: vi.fn().mockResolvedValue(undefined), move },
      readAccountsConfig: vi.fn().mockResolvedValue({ andre: { overrides: {}, watch: true } }),
      readRules: vi.fn().mockResolvedValue([rule({ actions: [{ type: "move", mailbox: "Missing" }] })]),
    });
    const watcher = createWatcher({ ...deps, intervalMs: 60_000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);

    // The second envelope doesn't match the rule (different sender), so it
    // still notifies even though the first envelope's rule action failed.
    expect(deps.notify).toHaveBeenCalledWith("andre", "someone-else@x.test: Hello");
    watcher.stop();
  });

  it("a rule for a different account never fires", async () => {
    const listMailboxes = vi.fn().mockResolvedValueOnce([inbox(0)]).mockResolvedValueOnce([inbox(1)]);
    const listEnvelopes = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([envelope("1", "newsletter@x.test", "Weekly digest")]);
    const deps = makeDeps({
      service: {
        listMailboxes, listEnvelopes,
        setFlag: vi.fn().mockResolvedValue(undefined),
        move: vi.fn().mockResolvedValue(undefined),
      },
      readAccountsConfig: vi.fn().mockResolvedValue({ andre: { overrides: {}, watch: true } }),
      readRules: vi.fn().mockResolvedValue([rule({ account: "someone-else" })]),
    });
    const watcher = createWatcher({ ...deps, intervalMs: 60_000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(deps.service.setFlag).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith("andre", "newsletter@x.test: Weekly digest");
    watcher.stop();
  });

  describe("phishing warning", () => {
    // mailparser needs real setImmediate/microtasks, so only fake the polling interval here.
    beforeEach(() => {
      vi.useRealTimers();
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    });

    const PHISH = Buffer.from([
      'From: "Bundeszentralamt für Steuern" <support@swordshieldconsulting.com>',
      "To: andre@semek.org",
      "Subject: Steuerkonto - Frist",
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=utf-8",
      "",
      '<a href="https://bit.ly/x">jetzt bestätigen</a>',
    ].join("\r\n"));
    const CLEAN = Buffer.from("From: a@x.test\r\nTo: b@x.test\r\nSubject: Hallo\r\n\r\nhi\r\n");

    async function run(raw: (id: string) => Buffer | Error, fresh: Envelope[], senders?: { lists(): Promise<{ trusted: ReadonlySet<string>; blocked: ReadonlySet<string> }> }) {
      const readRaw = vi.fn(async (ref: { message: string }) => {
        const value = raw(ref.message);
        if (value instanceof Error) throw value;
        return value;
      });
      const deps = makeDeps({
        service: {
          listMailboxes: vi.fn().mockResolvedValueOnce([inbox(0)]).mockResolvedValueOnce([inbox(fresh.length)]),
          listEnvelopes: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(fresh),
          setFlag: vi.fn().mockResolvedValue(undefined),
          move: vi.fn().mockResolvedValue(undefined),
          readRaw,
        },
        readAccountsConfig: vi.fn().mockResolvedValue({ andre: { overrides: {}, watch: true } }),
      });
      const watcher = createWatcher({ ...deps, ...(senders ? { senders } : {}), intervalMs: 60_000 });
      watcher.start();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.waitFor(() => expect(deps.notify).toHaveBeenCalled());
      watcher.stop();
      return { deps, watcher, readRaw };
    }

    it("warns about a phishing verdict, remembers it for the list badge, and never coalesces it away", async () => {
      const many = [
        envelope("p", "support@swordshieldconsulting.com", "Steuerkonto"),
        ...Array.from({ length: 4 }, (_, i) => envelope(`c${i}`, `a${i}@x.test`, "Hallo")),
      ];
      const { deps, watcher } = await run((id) => (id === "p" ? PHISH : CLEAN), many);

      expect(deps.notify).toHaveBeenCalledWith("andre", "⚠ Phishing-Verdacht: support@swordshieldconsulting.com: Steuerkonto");
      expect(deps.notify).toHaveBeenCalledWith("andre", "4 neue Nachrichten in andre");
      expect(watcher.riskFor({ account: "andre", mailbox: "INBOX", message: "p" })).toBe("high");
      expect(watcher.riskFor({ account: "andre", mailbox: "INBOX", message: "c0" })).toBeUndefined();
    });

    it("flags a reported sender and forgets the verdict when its status changes", async () => {
      const senders = { lists: async () => ({ trusted: new Set<string>(), blocked: new Set(["a@x.test"]) }) };
      const { deps, watcher } = await run(() => CLEAN, [envelope("c", "a@x.test", "Hallo")], senders);
      const ref = { account: "andre", mailbox: "INBOX", message: "c" };

      expect(deps.notify).toHaveBeenCalledWith("andre", "⚠ Phishing-Verdacht: a@x.test: Hallo");
      expect(watcher.riskFor(ref)).toBe("high");

      watcher.forgetSender("A@X.test");
      expect(watcher.riskFor(ref)).toBeUndefined();
    });

    it("skips oversized messages and survives a failing read", async () => {
      const big = { ...envelope("b", "x@x.test", "Big"), size: 3 * 1024 * 1024 };
      const broken = envelope("e", "y@x.test", "Broken");
      const { deps, readRaw } = await run(() => new Error("boom"), [big, broken]);

      expect(readRaw).toHaveBeenCalledTimes(1);
      expect(deps.notify).toHaveBeenCalledTimes(2);
      expect(deps.notify).toHaveBeenCalledWith("andre", "y@x.test: Broken");
    });
  });
});
