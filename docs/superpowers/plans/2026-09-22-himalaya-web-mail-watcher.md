# Himalaya Web Slice 2: Mail Watcher, Notifications, and Omarchy Bar Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Himalaya Web a background watcher that polls each opted-in account's INBOX, fires a desktop notification on genuinely new mail, and exposes a live unread badge to the Omarchy bar widget — without a browser tab open and without weakening the existing loopback/session-token boundary.

**Architecture:** A new in-memory, timer-driven `watcher.ts` module (same shape as the existing `outbox.ts`) polls `HimalayaService.listMailboxes`/`listEnvelopes` for accounts marked `watch: true` in `accounts.json`, dispatches notifications through a new `notify.ts` process-spawn wrapper, and exposes its live state via a new `GET /api/watch/summary` route authorized by a second, narrowly-scoped, disk-persisted "widget token" (the main session token stays never-written-to-disk). The Omarchy `Widget.qml` polls that route and shows an unread-count badge.

**Tech Stack:** TypeScript, Fastify 5, Vitest 3 (fake timers), Node `child_process.spawn`, Quickshell QML (Omarchy bar widget).

**Spec:** `docs/superpowers/specs/2026-09-22-himalaya-web-mail-watcher-design.md`

## Global Constraints

- Loopback-only (`127.0.0.1`), session-token gated on every `/api/*` route via the existing `onRequest` hook (`app.ts`); the new widget token authorizes `GET /api/watch/summary` only — every other route continues to accept only the main session token.
- The main session token is never written to disk (unchanged). The widget token is a separate token, written to `~/.config/himalaya-web/widget-token` (mode `0600`) only when ≥1 account has `watch: true`, rotated every process restart, deleted when no account is watched.
- User-facing text is German; code, tests, comments, commit messages, and planning docs are English.
- Himalaya and all other external processes are invoked only via argv arrays (`spawn(bin, args, { shell: false })`) — never a shell string.
- Automated tests use synthetic data (fake `HimalayaService`, mocked `child_process.spawn`); at most one reversible live check, scoped to the operator's own account.
- Poll interval defaults to `60_000` ms, overridable via `HIMALAYA_WEB_WATCH_INTERVAL_MS`.
- Notification coalescing: >3 new envelopes for one account in one tick → a single summary notification instead of one per message.
- `notifiedIds` is capped at 200 entries per watched account (oldest evicted first).
- The first tick after a (re)start is baseline-only for every account: it must never notify.

## Review Focus

- An account's unread count **drops then rises back**, e.g. read elsewhere then new mail arrives (user reads on phone, then gets more mail) — the watcher must still notify on the later rise; it must not get stuck comparing against a stale high-water mark.
- Toggling `watch: false` for an account **mid-run** (no service restart) must drop that account from the summary and stop the watcher from tracking it, not leak memory or a stale badge count forever.
- An **empty or newly-created `accounts.json`** (nothing watched yet, or the file doesn't exist) must not crash the watcher's tick loop — `readAccountsConfig()` already swallows parse errors and returns `{}`.
- A **leaked widget token must not gain access to any other route** — every route besides `GET /api/watch/summary` must keep rejecting it exactly like an unrelated wrong token.
- A notification's title/body, built from **IMAP-reported sender/subject** (not user input, but not trusted either), must have embedded `\r`/`\n` stripped before being spawned, so a crafted subject line can't corrupt the desktop notification's rendering even though the argv-array spawn already prevents shell/CLI-flag injection.

---

### Task 1: `accounts.json` gains an optional per-account `watch` flag

**Files:**
- Modify: `src/server/special-folders.ts`
- Test: `src/server/special-folders.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `AccountFolderSettings.watch?: boolean`, read by `readAccountsConfig()`. Task 3 (`watcher.ts`) filters accounts by `settings.watch === true`.

- [ ] **Step 1: Write the failing tests**

Add to `src/server/special-folders.test.ts`, inside the existing `describe("accounts.json store", ...)` block (after the `"leaves sentCopy undefined..."` test added in the earlier `sentCopy` fix):

```ts
  it("parses watch: true from an entry and leaves it undefined when absent or the wrong type", async () => {
    const directory = await mkdtemp(join(tmpdir(), "himalaya-web-accounts-test-"));
    const path = join(directory, "accounts.json");
    try {
      await writeFile(
        path,
        JSON.stringify({
          watched: { overrides: {}, watch: true },
          unwatched: { overrides: {} },
          malformed: { overrides: {}, watch: "yes" },
        }),
      );
      const all = await readAccountsConfig(path);
      expect(all.watched?.watch).toBe(true);
      expect(all.unwatched?.watch).toBeUndefined();
      expect(all.malformed?.watch).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("round-trips watch: true through writeAccountFolderSettings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "himalaya-web-accounts-test-"));
    const path = join(directory, "accounts.json");
    try {
      await writeAccountFolderSettings("andre", { overrides: {}, sentCopy: "auto", watch: true }, path);
      const all = await readAccountsConfig(path);
      expect(all.andre).toEqual({ overrides: {}, sentCopy: "auto", watch: true });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/server/special-folders.test.ts`
Expected: FAIL — `all.watched?.watch` is `undefined` (the field doesn't exist yet on the parsed type/value), and the round-trip test's `toEqual` fails because `watch` is silently dropped.

- [ ] **Step 3: Implement `watch` in the type and the parser**

In `src/server/special-folders.ts`, change the type:

```ts
export type AccountFolderSettings = {
  overrides: Partial<Record<SpecialFolderKind, string>>;
  sentCopy?: SentCopyMode;
  watch?: boolean;
};
```

And in `readAccountsConfig`'s loop body, change:

```ts
      const overrides = isRecord(value.overrides) ? value.overrides : {};
      const sentCopy = value.sentCopy === "auto" || value.sentCopy === "none" ? value.sentCopy : undefined;
      result[account] = {
        overrides: {
          ...(typeof overrides.sent === "string" ? { sent: overrides.sent } : {}),
          ...(typeof overrides.drafts === "string" ? { drafts: overrides.drafts } : {}),
          ...(typeof overrides.trash === "string" ? { trash: overrides.trash } : {}),
        },
        ...(sentCopy !== undefined ? { sentCopy } : {}),
      };
```

to:

```ts
      const overrides = isRecord(value.overrides) ? value.overrides : {};
      const sentCopy = value.sentCopy === "auto" || value.sentCopy === "none" ? value.sentCopy : undefined;
      const watch = value.watch === true ? true : undefined;
      result[account] = {
        overrides: {
          ...(typeof overrides.sent === "string" ? { sent: overrides.sent } : {}),
          ...(typeof overrides.drafts === "string" ? { drafts: overrides.drafts } : {}),
          ...(typeof overrides.trash === "string" ? { trash: overrides.trash } : {}),
        },
        ...(sentCopy !== undefined ? { sentCopy } : {}),
        ...(watch !== undefined ? { watch } : {}),
      };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/server/special-folders.test.ts`
Expected: PASS (all tests in the file, including the pre-existing ones).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/server/special-folders.ts src/server/special-folders.test.ts
git commit -m "feat(server): add an optional per-account watch flag to accounts.json"
```

---

### Task 2: `notify.ts` — spawn a click-to-open desktop notification

**Files:**
- Create: `src/server/notify.ts`
- Test: `src/server/notify.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `export type Notifier = (title: string, body: string) => void;` and `export function createNotifier(openUrl: string): Notifier`. Task 3's `watcher.ts` takes a `Notifier` as an injected dependency (typed the same way, not importing this file directly, to keep the watcher testable without spawning anything). Task 5 (`index.ts`) calls `createNotifier(...)` for the real one.

- [ ] **Step 1: Write the failing tests**

Create `src/server/notify.test.ts`:

```ts
import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

import { spawn } from "node:child_process";
import { createNotifier } from "./notify.js";

function fakeChild(): EventEmitter & { unref: ReturnType<typeof vi.fn> } {
  const emitter = new EventEmitter() as EventEmitter & { unref: ReturnType<typeof vi.fn> };
  emitter.unref = vi.fn();
  return emitter;
}

describe("createNotifier", () => {
  it("spawns omarchy-notification-send with title, body, and a click-to-open --exec target, never a shell string", () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const notify = createNotifier("http://127.0.0.1:47831/");

    notify("andre@example.test", "Neue Nachricht: Hallo");

    expect(spawn).toHaveBeenCalledWith(
      "omarchy-notification-send",
      ["andre@example.test", "Neue Nachricht: Hallo", "--exec", "xdg-open", "http://127.0.0.1:47831/"],
      expect.objectContaining({ shell: false }),
    );
  });

  it("strips embedded CR/LF from title and body before spawning (Review Focus)", () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const notify = createNotifier("http://127.0.0.1:47831/");

    notify("andre\r\nX-Injected: yes", "line1\nline2");

    const args = vi.mocked(spawn).mock.calls[0]?.[1] as string[];
    expect(args[0]).toBe("andre X-Injected: yes");
    expect(args[1]).toBe("line1 line2");
  });

  it("truncates an overlong title or body instead of spawning an unbounded argv element", () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const notify = createNotifier("http://127.0.0.1:47831/");

    notify("x".repeat(500), "y".repeat(500));

    const args = vi.mocked(spawn).mock.calls[0]?.[1] as string[];
    expect(args[0]?.length).toBe(200);
    expect(args[1]?.length).toBe(200);
  });

  it("never throws when the spawned process itself errors (e.g. binary missing)", () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const notify = createNotifier("http://127.0.0.1:47831/");

    expect(() => notify("a", "b")).not.toThrow();
    expect(() => child.emit("error", new Error("ENOENT"))).not.toThrow();
  });

  it("unrefs the spawned child so it never keeps the process alive", () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const notify = createNotifier("http://127.0.0.1:47831/");

    notify("a", "b");

    expect(child.unref).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/server/notify.test.ts`
Expected: FAIL — `Cannot find module './notify.js'` (the file doesn't exist yet).

- [ ] **Step 3: Implement `notify.ts`**

Create `src/server/notify.ts`:

```ts
import { spawn } from "node:child_process";

export type Notifier = (title: string, body: string) => void;

const MAX_FIELD_LENGTH = 200;

function sanitizeField(value: string): string {
  return value.replace(/[\r\n]+/g, " ").slice(0, MAX_FIELD_LENGTH);
}

/**
 * Spawns omarchy-notification-send with a click-to-open --exec target. Never
 * throws — a missing binary or a spawn failure must not crash the caller
 * (the watcher's background tick loop), so the spawned process's own "error"
 * event is swallowed rather than propagated.
 */
export function createNotifier(openUrl: string): Notifier {
  return (title: string, body: string): void => {
    const args = [sanitizeField(title), sanitizeField(body), "--exec", "xdg-open", openUrl];
    const child = spawn("omarchy-notification-send", args, { env: process.env, shell: false, stdio: "ignore" });
    child.on("error", () => {
      // Best-effort: a missing binary or spawn failure must not crash the watcher.
    });
    child.unref();
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/server/notify.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/server/notify.ts src/server/notify.test.ts
git commit -m "feat(server): add a click-to-open desktop notification spawner"
```

---

### Task 3: `watcher.ts` — the polling engine

**Files:**
- Create: `src/server/watcher.ts`
- Test: `src/server/watcher.test.ts`

**Interfaces:**
- Consumes: `HimalayaService.listMailboxes`/`listEnvelopes` (from `himalaya.ts`, unchanged), `AccountFolderSettings`/`readAccountsConfig` (from Task 1's `special-folders.ts`), a `Notifier`-shaped function (Task 2's type, injected — this file does not import `notify.ts`).
- Produces: `export type WatchAccountSummary`, `export type WatchSummary`, `export interface Watcher { start(): void; stop(): void; summary(): WatchSummary }`, `export function createWatcher(deps): Watcher`. Task 4 (`app.ts`) imports `createWatcher`, `Watcher`, `WatchSummary` from this file.

- [ ] **Step 1: Write the failing tests**

Create `src/server/watcher.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Envelope, Mailbox } from "../shared/types.js";
import { HimalayaError, type HimalayaService } from "./himalaya.js";
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

type FakeDeps = {
  service: Pick<HimalayaService, "listMailboxes" | "listEnvelopes">;
  readAccountsConfig: () => Promise<Record<string, AccountFolderSettings>>;
  notify: ReturnType<typeof vi.fn>;
};

function makeDeps(overrides: Partial<FakeDeps> = {}): FakeDeps {
  return {
    service: {
      listMailboxes: vi.fn().mockResolvedValue([inbox(0)]),
      listEnvelopes: vi.fn().mockResolvedValue([]),
    },
    readAccountsConfig: vi.fn().mockResolvedValue({}),
    notify: vi.fn(),
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

  it("does not notify on the first tick after startup (baseline only)", async () => {
    const deps = makeDeps({
      service: { listMailboxes: vi.fn().mockResolvedValue([inbox(5)]), listEnvelopes: vi.fn() },
      readAccountsConfig: vi.fn().mockResolvedValue({ andre: { overrides: {}, watch: true } }),
    });
    const watcher = createWatcher({ ...deps, intervalMs: 60_000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(deps.notify).not.toHaveBeenCalled();
    expect(deps.service.listEnvelopes).not.toHaveBeenCalled();
    expect(watcher.summary()).toEqual({ accounts: [{ account: "andre", unread: 5, error: null }], totalUnread: 5 });
    watcher.stop();
  });

  it("notifies once per new envelope when unread rises, fetching only the watched account's INBOX", async () => {
    const listMailboxes = vi.fn().mockResolvedValueOnce([inbox(2)]).mockResolvedValueOnce([inbox(4)]);
    const listEnvelopes = vi.fn().mockResolvedValue([
      envelope("1", "a@x.test", "Hallo"),
      envelope("2", "b@x.test", "Zweite"),
    ]);
    const deps = makeDeps({
      service: { listMailboxes, listEnvelopes },
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
    const listEnvelopes = vi.fn().mockResolvedValue(many);
    const deps = makeDeps({
      service: { listMailboxes, listEnvelopes },
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
    const listEnvelopes = vi.fn().mockResolvedValue([envelope("1", "a@x.test", "Hallo")]);
    const deps = makeDeps({
      service: { listMailboxes, listEnvelopes },
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

  it("still detects a later rise after an intermediate drop (Review Focus: read-elsewhere then new mail)", async () => {
    const listMailboxes = vi.fn()
      .mockResolvedValueOnce([inbox(5)]) // baseline
      .mockResolvedValueOnce([inbox(1)]) // dropped (read elsewhere) — must not notify
      .mockResolvedValueOnce([inbox(2)]); // rose again — must notify
    const listEnvelopes = vi.fn().mockResolvedValue([envelope("new-1", "a@x.test", "Neu")]);
    const deps = makeDeps({
      service: { listMailboxes, listEnvelopes },
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
      service: { listMailboxes, listEnvelopes: vi.fn().mockResolvedValue([]) },
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

  it("re-reads accounts.json every tick, dropping an account from the summary once watch turns off (Review Focus)", async () => {
    const deps = makeDeps({
      service: { listMailboxes: vi.fn().mockResolvedValue([inbox(1)]), listEnvelopes: vi.fn().mockResolvedValue([]) },
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
      service: { listMailboxes: vi.fn().mockResolvedValue([inbox(1)]), listEnvelopes: vi.fn().mockResolvedValue([]) },
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
    let resolveFirst: (() => void) | null = null;
    const listMailboxes = vi.fn()
      .mockImplementationOnce(() => new Promise<Mailbox[]>((resolve) => { resolveFirst = () => resolve([inbox(1)]); }))
      .mockResolvedValue([inbox(1)]);
    const deps = makeDeps({
      service: { listMailboxes, listEnvelopes: vi.fn().mockResolvedValue([]) },
      readAccountsConfig: vi.fn().mockResolvedValue({ andre: { overrides: {}, watch: true } }),
    });
    const watcher = createWatcher({ ...deps, intervalMs: 60_000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(0); // first tick starts and hangs on listMailboxes
    await vi.advanceTimersByTimeAsync(60_000); // timer fires again while the first tick is still in flight

    expect(listMailboxes).toHaveBeenCalledTimes(1); // the second firing was skipped, not queued
    resolveFirst?.();
    await vi.advanceTimersByTimeAsync(0);
    watcher.stop();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/server/watcher.test.ts`
Expected: FAIL — `Cannot find module './watcher.js'`.

- [ ] **Step 3: Implement `watcher.ts`**

Create `src/server/watcher.ts`:

```ts
import type { Envelope, Mailbox } from "../shared/types.js";
import { HimalayaError, type HimalayaService } from "./himalaya.js";
import { readAccountsConfig as defaultReadAccountsConfig, type AccountFolderSettings } from "./special-folders.js";

export type WatchAccountSummary = {
  account: string;
  unread: number | null;
  error: string | null;
};

export type WatchSummary = {
  accounts: WatchAccountSummary[];
  totalUnread: number;
};

export interface Watcher {
  start(): void;
  stop(): void;
  summary(): WatchSummary;
}

const DEFAULT_INTERVAL_MS = 60_000;
const NOTIFIED_ID_CAP = 200;
const COALESCE_THRESHOLD = 3;
const NEW_MAIL_PAGE_SIZE = 10;
const UNKNOWN_ERROR_MESSAGE = "Unbekannter Fehler beim Abrufen des Postfachs.";

type AccountState = {
  lastUnread: number | null;
  notifiedIds: string[];
  seen: Set<string>;
};

export function createWatcher(deps: {
  service: Pick<HimalayaService, "listMailboxes" | "listEnvelopes">;
  readAccountsConfig?: () => Promise<Record<string, AccountFolderSettings>>;
  notify: (title: string, body: string) => void;
  intervalMs?: number;
}): Watcher {
  const readAccountsConfig = deps.readAccountsConfig ?? defaultReadAccountsConfig;
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const states = new Map<string, AccountState>();
  const currentSummary = new Map<string, WatchAccountSummary>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;

  function findInbox(mailboxes: readonly Mailbox[]): Mailbox | null {
    return mailboxes.find(({ id, name }) => id.toLowerCase() === "inbox" || name.toLowerCase() === "inbox") ?? null;
  }

  function remember(state: AccountState, id: string): void {
    if (state.seen.has(id)) return;
    state.seen.add(id);
    state.notifiedIds.push(id);
    if (state.notifiedIds.length > NOTIFIED_ID_CAP) {
      const evicted = state.notifiedIds.shift();
      if (evicted !== undefined) state.seen.delete(evicted);
    }
  }

  function errorMessage(error: unknown): string {
    return error instanceof HimalayaError ? error.message : UNKNOWN_ERROR_MESSAGE;
  }

  function describeEnvelope(envelope: Envelope): string {
    const from = envelope.from[0]?.name ?? envelope.from[0]?.email ?? "Unbekannter Absender";
    return `${from}: ${envelope.subject || "(kein Betreff)"}`;
  }

  async function tickAccount(account: string): Promise<void> {
    let state = states.get(account);
    const isFirstTick = state === undefined;
    if (!state) {
      state = { lastUnread: null, notifiedIds: [], seen: new Set() };
      states.set(account, state);
    }

    try {
      const mailboxes = await deps.service.listMailboxes(account);
      const inbox = findInbox(mailboxes);
      const unread = inbox?.unread ?? null;
      const rose = !isFirstTick && state.lastUnread !== null && unread !== null && unread > state.lastUnread;
      state.lastUnread = unread;
      currentSummary.set(account, { account, unread, error: null });

      if (!rose || !inbox) return;

      const envelopes = await deps.service.listEnvelopes({
        account,
        mailbox: inbox.id,
        page: 1,
        pageSize: NEW_MAIL_PAGE_SIZE,
        search: { field: "all", text: "", unread: true },
      });
      const fresh = envelopes.filter((envelope) => !state!.seen.has(envelope.id));
      if (fresh.length === 0) return;

      if (fresh.length > COALESCE_THRESHOLD) {
        deps.notify(account, `${fresh.length} neue Nachrichten in ${account}`);
      } else {
        for (const envelope of fresh) deps.notify(account, describeEnvelope(envelope));
      }
      for (const envelope of fresh) remember(state, envelope.id);
    } catch (error) {
      currentSummary.set(account, { account, unread: null, error: errorMessage(error) });
    }
  }

  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      const config = await readAccountsConfig();
      const watched = Object.entries(config)
        .filter(([, settings]) => settings.watch === true)
        .map(([account]) => account);

      const stillWatched = new Set(watched);
      for (const account of [...states.keys()]) {
        if (!stillWatched.has(account)) {
          states.delete(account);
          currentSummary.delete(account);
        }
      }

      for (const account of watched) {
        await tickAccount(account);
      }
    } finally {
      ticking = false;
    }
  }

  function start(): void {
    if (timer) return;
    timer = setInterval(() => { void tick(); }, intervalMs);
    void tick();
  }

  function stop(): void {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function summary(): WatchSummary {
    const accounts = [...currentSummary.values()];
    const totalUnread = accounts.reduce((sum, entry) => sum + (entry.unread ?? 0), 0);
    return { accounts, totalUnread };
  }

  return { start, stop, summary };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/server/watcher.test.ts`
Expected: PASS (all 10 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/server/watcher.ts src/server/watcher.test.ts
git commit -m "feat(server): add the mail watcher's polling and notification engine"
```

---

### Task 4: Wire the watcher into `app.ts` — `GET /api/watch/summary` and the widget token

**Files:**
- Modify: `src/server/app.ts`
- Test: `src/server/app.test.ts`

**Interfaces:**
- Consumes: `createWatcher`, `Watcher`, `WatchSummary` (Task 3's `watcher.ts`).
- Produces: `AppOptions` gains `widgetToken?: string`, `notify?: (title: string, body: string) => void`, `watchIntervalMs?: number`. `GET /api/watch/summary` route, authorized by either the main token or `widgetToken`. Task 5 (`index.ts`) passes these three new options.

- [ ] **Step 1: Write the failing tests**

Add to `src/server/app.test.ts`, in a new `describe` block near the end of the file (after the `describe("compose send and outbox", ...)` block):

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/server/app.test.ts -t "mail watcher summary route"`
Expected: FAIL — 404 (route doesn't exist) on the first two tests; the third test's assertions on `/api/watch/summary` still pass by coincidence (the generic 401/403 checks already work for any unknown `/api/*` path), so confirm the first two genuinely fail with 404 before proceeding.

- [ ] **Step 3: Implement the route, options, and auth branch**

In `src/server/app.ts`, add the import (alongside the existing `outbox.js` import):

```ts
import { createWatcher, type Watcher } from "./watcher.js";
```

Change `AppOptions`:

```ts
export type AppOptions = {
  token: string;
  staticDir?: string;
  ai?: AiProvider;
  widgetToken?: string;
  notify?: (title: string, body: string) => void;
  watchIntervalMs?: number;
};
```

Change the `onRequest` hook (currently):

```ts
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    if (!loopbackHost(request.headers.host) || !loopbackOrigin(request.headers.origin)) {
      await reply.code(403).send({ error: "Lokaler Zugriff erforderlich.", code: "LOCAL_ONLY" });
      return;
    }
    if (!validToken(request, options.token)) {
      await reply.code(401).send({ error: "Die lokale Sitzung ist nicht autorisiert.", code: "UNAUTHORIZED" });
    }
  });
```

to:

```ts
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    if (!loopbackHost(request.headers.host) || !loopbackOrigin(request.headers.origin)) {
      await reply.code(403).send({ error: "Lokaler Zugriff erforderlich.", code: "LOCAL_ONLY" });
      return;
    }
    const isWatchSummary = request.url.startsWith("/api/watch/summary");
    const widgetAuthorized = isWatchSummary && options.widgetToken !== undefined
      && validToken(request, options.widgetToken);
    if (!validToken(request, options.token) && !widgetAuthorized) {
      await reply.code(401).send({ error: "Die lokale Sitzung ist nicht autorisiert.", code: "UNAUTHORIZED" });
    }
  });
```

Instantiate the watcher next to the existing `outbox` instantiation (right after `const outbox = createOutbox();`):

```ts
  const watcher: Watcher = createWatcher({
    service,
    notify: options.notify ?? (() => {}),
    ...(options.watchIntervalMs !== undefined ? { intervalMs: options.watchIntervalMs } : {}),
  });
  watcher.start();
```

Extend the existing `onClose` hook (currently `outbox.dispose(); ...`) to also stop the watcher — change:

```ts
  app.addHook("onClose", async () => {
    outbox.dispose();
    const cleanups = [...pendingCleanups.values()];
    pendingCleanups.clear();
    await Promise.all(cleanups.map((cleanup) => cleanup()));
  });
```

to:

```ts
  app.addHook("onClose", async () => {
    watcher.stop();
    outbox.dispose();
    const cleanups = [...pendingCleanups.values()];
    pendingCleanups.clear();
    await Promise.all(cleanups.map((cleanup) => cleanup()));
  });
```

Add the route (near the other simple `GET` routes, e.g. right after the `/api/bootstrap` route):

```ts
  app.get("/api/watch/summary", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return reply.send(watcher.summary());
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/server/app.test.ts`
Expected: PASS (all tests in the file — this confirms the new route and auth branch didn't regress any existing route).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/server/app.ts src/server/app.test.ts
git commit -m "feat(server): expose GET /api/watch/summary, authorized by a scoped widget token"
```

---

### Task 5: Wire the widget token and notifier into `index.ts`

**Files:**
- Modify: `src/server/index.ts`

**Interfaces:**
- Consumes: `createNotifier` (Task 2), `readAccountsConfig` (Task 1, already exported), `AppOptions.widgetToken`/`notify`/`watchIntervalMs` (Task 4).
- Produces: the running service. No new exports — this is the bootstrap entry point, matching the codebase's existing convention that `index.ts` has no test file (verified: `src/server/*.test.ts` has no `index.test.ts`); it's exercised by the manual smoke check instead, same as `0.6.0`'s.

- [ ] **Step 1: Implement the changes**

Replace the full contents of `src/server/index.ts`:

```ts
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createMiniMaxProvider, readAiConfig } from "./ai.js";
import { createApp } from "./app.js";
import { HimalayaCli } from "./himalaya.js";
import { createNotifier } from "./notify.js";
import { readAccountsConfig } from "./special-folders.js";

const port = Number(process.env.HIMALAYA_WEB_PORT ?? "47831");
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("HIMALAYA_WEB_PORT must be an integer between 1024 and 65535.");
}

const watchIntervalMs = Number(process.env.HIMALAYA_WEB_WATCH_INTERVAL_MS ?? "60000");
if (!Number.isInteger(watchIntervalMs) || watchIntervalMs < 1000) {
  throw new Error("HIMALAYA_WEB_WATCH_INTERVAL_MS must be an integer of at least 1000 (milliseconds).");
}

const sourceDir = dirname(fileURLToPath(import.meta.url));
const staticDir = join(sourceDir, "../../dist");
const token = randomBytes(32).toString("hex");

// The main session token is never written to disk (see the log line below).
// A separate, narrower-scoped widget token authorizes only the read-only
// GET /api/watch/summary route, so the Omarchy bar widget (a process with no
// access to the browser's injected page) can poll it. It is written to disk
// only while at least one account has watch: true, and removed otherwise.
const widgetTokenPath = join(homedir(), ".config", "himalaya-web", "widget-token");
const accountsConfig = await readAccountsConfig();
const anyWatched = Object.values(accountsConfig).some((settings) => settings.watch === true);
let widgetToken: string | undefined;
if (anyWatched) {
  widgetToken = randomBytes(32).toString("hex");
  await mkdir(dirname(widgetTokenPath), { recursive: true });
  await writeFile(widgetTokenPath, widgetToken, { mode: 0o600 });
} else {
  await rm(widgetTokenPath, { force: true });
}

const baseOptions = {
  token,
  ...(existsSync(staticDir) ? { staticDir } : {}),
  ...(widgetToken !== undefined ? { widgetToken } : {}),
  notify: createNotifier(`http://127.0.0.1:${port}/`),
  watchIntervalMs,
};
const aiConfig = readAiConfig();
const app = await createApp(
  new HimalayaCli(),
  aiConfig ? { ...baseOptions, ai: createMiniMaxProvider(aiConfig) } : baseOptions,
);

try {
  await app.listen({ host: "127.0.0.1", port });
  process.stdout.write(`Himalaya GUI: http://127.0.0.1:${port}/\n`);
  process.stdout.write("Stop with Ctrl-C. The session token is not written to disk.\n");
  if (widgetToken !== undefined) {
    process.stdout.write(
      "A widget-only, read-only summary token was written to ~/.config/himalaya-web/widget-token (mode 0600) because at least one account has watch: true.\n",
    );
  }
} catch (error) {
  await app.close();
  if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
    throw new Error(`Port ${port} is already in use. Set HIMALAYA_WEB_PORT to another local port.`);
  }
  throw error;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean (no errors). This is the verification for this task — `index.ts` has no unit test by existing convention; its behavior is covered by the manual smoke check in the final docs task.

- [ ] **Step 3: Commit**

```bash
git add src/server/index.ts
git commit -m "feat(server): generate and rotate the widget token, wire the real notifier and watch interval"
```

---

### Task 6: Omarchy bar widget badge

**Files:**
- Modify: `deploy/omarchy/dnames.himalaya-mail/manifest.json`
- Modify: `deploy/omarchy/dnames.himalaya-mail/Widget.qml`
- Modify: `deploy/omarchy/README.md`

**Interfaces:**
- Consumes: `GET /api/watch/summary` (Task 4's contract: `{ accounts: [...], totalUnread: number }`, authorized by the `x-himalaya-session` header), `~/.config/himalaya-web/widget-token` (Task 5's file).
- Produces: nothing consumed by another task — this is the terminal, presentation-only piece.

No automated test exists for this file (Quickshell/QML is outside this repo's Vitest/Playwright surface, matching the existing widget's untested status). Verification is manual, against the live Omarchy shell, and is explicitly **not** run automatically as part of this task — see Step 3.

- [ ] **Step 1: Bump the manifest version**

In `deploy/omarchy/dnames.himalaya-mail/manifest.json`, change `"version": "1.0.0"` to `"version": "1.1.0"`.

- [ ] **Step 2: Add the polling badge to the widget**

Replace `deploy/omarchy/dnames.himalaya-mail/Widget.qml`:

```qml
import QtQuick
import Quickshell
import Quickshell.Io
import qs.Ui

BarWidget {
    id: root
    moduleName: "dnames.himalaya-mail"
    implicitWidth: button.implicitWidth
    implicitHeight: barSize

    property int unreadCount: 0
    readonly property string tokenPath: Quickshell.env("HOME") + "/.config/himalaya-web/widget-token"
    readonly property string summaryUrl: "http://127.0.0.1:47831/api/watch/summary"

    WidgetButton {
        id: button
        bar: root.bar
        text: root.unreadCount > 0 ? "✉ " + root.unreadCount : "✉"
        tooltipText: "Himalaya Mail im Browser öffnen"
        horizontalMargin: 7
        onPressed: function(mouseButton) {
            if (mouseButton === Qt.LeftButton)
                Quickshell.execDetached(["xdg-open", "http://127.0.0.1:47831/"])
        }
    }

    // Reads the widget token from disk fresh on every poll rather than caching
    // it, since the server rotates it on every restart (see index.ts).
    Process {
        id: pollProcess
        command: [
            "sh", "-c",
            "token=$(cat " + root.tokenPath + " 2>/dev/null) && " +
            "curl -sf -m 5 -H \"x-himalaya-session: $token\" " + root.summaryUrl
        ]
        stdout: StdioCollector {
            onStreamFinished: {
                try {
                    const summary = JSON.parse(text)
                    root.unreadCount = typeof summary.totalUnread === "number" ? summary.totalUnread : 0
                } catch (e) {
                    // Keep the last known badge value on a parse failure (server
                    // not running, watching disabled, or a transient error).
                }
            }
        }
    }

    Timer {
        interval: 60000
        running: true
        repeat: true
        triggeredOnStart: true
        onTriggered: pollProcess.running = true
    }
}
```

- [ ] **Step 3: Update the deploy README**

In `deploy/omarchy/README.md`, add a paragraph after the existing install steps:

```markdown
## The widget token

Once at least one account has `watch: true` in
`~/.config/himalaya-web/accounts.json`, the running service writes a
read-only, badge-only token to `~/.config/himalaya-web/widget-token` (mode
`0600`). It authorizes only `GET /api/watch/summary` (unread counts, no
message content) and rotates every service restart. The widget reads this
file itself; nothing needs to be configured manually. If no account is
watched, the file does not exist and the widget stays a plain `✉` icon.
```

- [ ] **Step 4: Commit (repo template; live install is manual and explicitly out of this step)**

```bash
git add deploy/omarchy/dnames.himalaya-mail/manifest.json deploy/omarchy/dnames.himalaya-mail/Widget.qml deploy/omarchy/README.md
git commit -m "feat(omarchy): show a live unread badge on the bar widget"
```

**Manual verification (required before considering Slice 2 fully done, not part of the automated suite):** this QML is best-effort against Quickshell's documented `Process`/`StdioCollector` API and has not been exercised against the live shell in this session. Before relying on it: `cp` the updated `manifest.json`/`Widget.qml` into `~/.config/omarchy/plugins/dnames.himalaya-mail/`, `omarchy plugin validate ...`, `omarchy restart shell`, enable `watch: true` for one account, and confirm the badge shows a number within one poll interval. If the exact `Process`/`StdioCollector` property names differ from the installed Quickshell version, fix them against `omarchy plugin validate`'s output and the installed Quickshell QML docs at that point — get explicit confirmation before installing into the live shell config, since it changes the operator's running desktop, not just this repository.

---

### Task 7: Docs, version, and full verification

**Files:**
- Modify: `README.md`
- Modify: `HANDOFF.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: the shipped behavior of Tasks 1–6.
- Produces: nothing consumed by another task — this is the closing documentation and release task.

- [ ] **Step 1: Update `README.md`**

In the "Current status" section, after the existing compose paragraph (ending "...cannot trigger a send."), add a new paragraph:

```markdown
An opt-in background watcher polls each account whose `accounts.json` entry
sets `"watch": true` and fires a desktop notification on genuinely new mail
in that account's INBOX, without a browser tab open. The Omarchy bar widget
shows a live unread-count badge across every watched account. Watching is
off by default; there is no settings UI yet, so it is enabled the same way
Sent/Drafts/Trash overrides are — by hand-editing
`~/.config/himalaya-web/accounts.json`.
```

Update the line "Current standalone app version: `0.6.0`." to "Current standalone app version: `0.7.0`."

In the security/`accounts.json` paragraph (the one this session's `sentCopy` fix already edited, ending "...instead of silently switching to `auto`."), append:

```markdown
An entry may also set `"watch": true` to opt that account into the mail
watcher above; it is `false`/absent by default. While at least one account
has `watch: true`, the running service also writes a second, read-only,
badge-only token to `~/.config/himalaya-web/widget-token` (mode `0600`,
rotated every restart, removed again once nothing is watched) so the
Omarchy bar widget can poll `GET /api/watch/summary` without the main
session token, which is still never written to disk.
```

Do not add the "Re-run the security review" backlog line yet — Step 3 below
performs that review and writes the one, final line with its actual dated
outcome directly; adding a draft line here first would just be a placeholder
this plan avoids.

- [ ] **Step 2: Update `HANDOFF.md`**

Update the top progress bullet's `Slice 2 (mail watcher/notifications) is next` sentence to reflect it as implemented; update the "Current Progress" bullet's version/commit reference once this branch's final commit hash is known (fill in at commit time, not before); add a "Known Limitations" entry:

```markdown
- The Omarchy bar-widget badge (`deploy/omarchy/dnames.himalaya-mail/Widget.qml`)
  is best-effort QML against Quickshell's `Process`/`StdioCollector` API and
  has not been verified against the live shell as of this commit — see the
  manual verification note on the mail-watcher plan's Task 6. Install it to
  `~/.config/omarchy/plugins/dnames.himalaya-mail/` and confirm the badge
  before relying on it; the server-side watcher/notification/summary-route
  behavior is independently verified by the automated suite regardless.
```

Update "Next Steps" to move past Slice 2 to Slice 3 (rules engine) per the roadmap.

- [ ] **Step 3: Run the security review and add its one, final backlog line**

Re-read `GET /api/watch/summary`'s auth branch in `app.ts` (Task 4) end to
end — confirm the widget token cannot reach any route besides this one (the
`app.test.ts` tests from Task 4 already assert this; re-derive it by reading
the `onRequest` hook's final form, not by re-running the tests, since a
security review reads the code a fresh reviewer would). Confirm `notify.ts`
(Task 2) never interpolates title/body into a shell string. Confirm
`widget-token` is written with mode `0600` and only while `anyWatched` is
true (Task 5). Then add exactly one new line to README's "English
implementation backlog" section, in the same style as the file's existing
"Re-run the security review when compose, send..." entry, stating today's
date and the actual outcome — for example (adjust the specifics to what the
review actually finds):

```markdown
- [x] Re-run the security review when the mail watcher is added. Done
  2026-09-22: manual review of the `onRequest` hook's widget-token branch
  (scoped to `GET /api/watch/summary` only), `notify.ts`'s argv-array spawn
  (no shell interpolation), and the widget-token file's `0600` mode and
  watch-gated write/removal in `index.ts`. No High/Critical findings.
```

- [ ] **Step 4: Add the `CHANGELOG.md` entry and bump `package.json`**

In `CHANGELOG.md`, add a new section above the existing `## 0.6.0 — 2026-09-22`:

```markdown
## 0.7.0 — 2026-09-22

- Added an opt-in mail watcher: accounts with `"watch": true` in
  `accounts.json` are polled for new INBOX mail and get a desktop
  notification (click to open the app), coalesced into one summary
  notification when more than 3 arrive in one poll.
- Added a live unread-count badge to the Omarchy bar widget, backed by a new
  `GET /api/watch/summary` route authorized by a separate, narrowly-scoped,
  rotate-on-restart widget token — the main session token is still never
  written to disk.
```

In `package.json`, change `"version": "0.6.0"` to `"version": "0.7.0"`.

- [ ] **Step 5: Full verification suite**

Run each of the following and confirm the stated outcome before committing:

```bash
npm run typecheck
```
Expected: no errors.

```bash
npm test
```
Expected: every test passes, including all new tests from Tasks 1–4 (the total test count should be the pre-Slice-2 count plus this plan's new tests — confirm the printed total, don't just check for zero failures).

```bash
npm run build
```
Expected: clean Vite + `tsc --noEmit` build.

```bash
env HIMALAYA_WEB_PORT=47832 npx playwright test
```
Expected: all existing Playwright specs still pass (this plan adds no new Playwright coverage, per the spec's stated testing scope — a regression here means Task 4's `onRequest` hook change broke something unrelated).

```bash
npm audit --omit=dev --audit-level=high
```
Expected: 0 findings (no new dependency was added — `child_process.spawn` and Quickshell are already available, not new packages).

- [ ] **Step 6: Commit docs and version**

```bash
git add README.md HANDOFF.md CHANGELOG.md package.json
git commit -m "docs: document the mail watcher and bump to 0.7.0"
```

- [ ] **Step 7: Restart the live service and smoke-check it**

```bash
systemctl --user restart himalaya-web.service
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:47831/
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:47831/api/bootstrap
```

Expected: `200` for `/`, `401` for the unauthenticated `/api/bootstrap` call (matching the existing smoke-check pattern from `0.6.0`).

- [ ] **Step 8: One reversible live check (get explicit operator confirmation first)**

This step touches the operator's real account configuration and sends a real,
externally-triggered check — do not run it without asking first, per this
project's "at most one reversible live check" rule and this session's
broader "confirm before actions with real-world effects" default. Ask the
operator (or wait for their next message, since Slice 1's equivalent check
was also done at the very end with the operator present) before proceeding:

1. Add `"watch": true` to one real account's `accounts.json` entry (the
   operator's own account, e.g. `erdna1982@gmail.com`'s `gmail-erdna1982-gmail-com-main`
   alias — confirm the exact alias name with `himalaya account list` or the
   already-known `~/.config/himalaya/config.toml` entry first).
2. Restart the service (Step 7's command) so the watcher picks up the new
   config on its next tick (or wait one poll interval — `readAccountsConfig`
   is re-read every tick regardless, so a restart is not strictly required,
   but confirms the widget-token file gets written for the first time).
3. Send one email to that account from outside (or from another of the
   operator's own accounts).
4. Confirm one desktop notification fires within one poll interval (default
   60 s) and, once Task 6's widget is live-installed, that the bar badge
   updates.
5. Set `"watch"` back to `false` (or remove the key) afterward if the
   operator does not want ongoing watching yet, and restart the service
   once more so the widget-token file is removed again.

No further real mail is touched by this check.

## Self-Review

**1. Spec coverage:** Watched-accounts opt-in (Task 1), poll interval/env override (Task 3/5), detection signal + baseline-first-tick + coalescing + per-account error isolation + notifiedIds cap (Task 3), notification transport via `omarchy-notification-send --exec` (Task 2), widget token + `GET /api/watch/summary` (Task 4/5), Omarchy widget badge (Task 6), docs/CHANGELOG/version (Task 7). The spec's explicitly deferred items (quick actions/archive) have no task — correct, they're out of scope by design. The spec's "Open questions" were resolved during spec review (notification click-to-open mechanism, D-Bus environment) except the poll-interval-vs-rate-limits question, which stays a judgment call at `60_000` ms default with an env override, matching the spec's own stated decision.

**2. Placeholder scan:** No "TBD"/"TODO"/"implement later"/unshown code anywhere in this plan. Task 7 deliberately does not pre-write the security-review backlog line as a draft to fill in later — Step 3 performs the review first and writes that one line, with its real dated outcome, directly.

**3. Type consistency:** `WatchSummary`/`WatchAccountSummary` (Task 3) match exactly what Task 4's route returns and what Task 4/6's tests assert (`{ accounts: [...], totalUnread }`). `AccountFolderSettings.watch?: boolean` (Task 1) is the exact field `watcher.ts` (Task 3) filters on via `settings.watch === true`. `Notifier`'s signature (`(title: string, body: string) => void`, Task 2) matches `AppOptions.notify` (Task 4) and `createWatcher`'s `notify` dependency (Task 3) exactly.

**4. Review Focus:** All five items have an owning task and an explicit test: drop-then-rise → Task 3's "still detects a later rise after an intermediate drop" test; `watch` toggled off mid-run → Task 3's "re-reads accounts.json every tick" test; empty/missing `accounts.json` → Task 3's "does nothing and never throws when no account is watched" test; widget token scoped to one route → Task 4's "accepts the widget token for this route only, and rejects it on every other route" test; notification title/body CR/LF stripping → Task 2's "strips embedded CR/LF" test.
