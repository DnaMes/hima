import type { HimalayaService } from "./himalaya.js";
import { SOURCE_CONCURRENCY } from "./unified-inbox.js";

type WarmService = Pick<HimalayaService, "listMailboxes" | "listEnvelopes">;

export interface Warmer {
  /** The GUI is in use: keep warming. */
  touch(): void;
  /** The accounts of the last unified inbox request; only these are warmed. */
  remember(accounts: readonly string[]): void;
  start(): void;
  stop(): void;
  /** One round, exposed for tests. */
  warm(): Promise<void>;
}

/**
 * Keeps the first unified-inbox page of the accounts in use fresh in the CommandRunner cache, so opening or
 * switching views is instant (measured live: 19 accounts cold 18 s, cached 8 ms). It issues exactly the
 * requests listUnifiedInbox makes for page 1, and stops by itself when the GUI has been idle.
 */
export function createWarmer(
  service: WarmService,
  options: { intervalMs: number; idleMs: number; now?: () => number },
): Warmer {
  const now = options.now ?? Date.now;
  let lastUse = Number.NEGATIVE_INFINITY;
  let accounts: string[] = [];
  let running = false;
  let timer: NodeJS.Timeout | null = null;

  async function warmAccount(account: string): Promise<void> {
    const inbox = (await service.listMailboxes(account, { counts: false })).find(({ id, name }) => id.toLowerCase() === "inbox" || name.toLowerCase() === "inbox");
    if (inbox) await service.listEnvelopes({ account, mailbox: inbox.id, page: 1, pageSize: 100 });
  }

  async function warm(): Promise<void> {
    if (running || accounts.length === 0 || now() - lastUse > options.idleMs) return;
    running = true;
    try {
      for (let offset = 0; offset < accounts.length; offset += SOURCE_CONCURRENCY) {
        await Promise.all(accounts.slice(offset, offset + SOURCE_CONCURRENCY).map((account) => warmAccount(account).catch(() => undefined)));
      }
    } finally {
      running = false;
    }
  }

  return {
    touch() { lastUse = now(); },
    remember(next) { accounts = [...new Set(next)]; },
    start() {
      timer ??= setInterval(() => void warm(), options.intervalMs);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    warm,
  };
}
