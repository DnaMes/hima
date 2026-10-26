import type { CommandResult, CommandRunner, RunOptions } from "./himalaya.js";

const DEFAULT_TTL_MS = 45_000;
const MAX_ENTRIES = 200;

type Command = { cmd: string; sub: string };

// Skips Himalaya's global options (--json, --account <name>) to find "<command> <subcommand>".
function commandOf(args: readonly string[]): Command {
  let index = 0;
  while (index < args.length && args[index]!.startsWith("--")) index += args[index] === "--account" ? 2 : 1;
  return { cmd: args[index] ?? "", sub: args[index + 1] ?? "" };
}

function isCacheableRead({ cmd, sub }: Command): boolean {
  return (cmd === "envelope" && (sub === "list" || sub === "search"))
    || ((cmd === "mailbox" || cmd === "account") && sub === "list");
}

function isReadOnly({ cmd, sub }: Command): boolean {
  // `message read` leaves flags alone unless `--seen` is passed, which this app never does.
  return isCacheableRead({ cmd, sub }) || (cmd === "message" && sub === "read") || cmd === "attachment";
}

/**
 * Short-lived cache for list commands: every spawn pays a fresh IMAP connect, so repeated
 * navigation and the watcher reuse one answer. Any command that may change mail clears it.
 *
 * `withStale()` is a view for the GUI: an answer older than the TTL but younger than `staleMs` is returned at
 * once while a refresh runs in the background. The plain runner (watcher, warmer) never gets stale data.
 */
type Entry = {
  at: number;
  result: Promise<CommandResult>;
  /** The settled answer once it is in (successful, still current). */
  value?: CommandResult;
  /** What this entry replaced: the GUI keeps serving it while the new fetch is still running. */
  previous?: { at: number; value: CommandResult };
};

export class CachingRunner implements CommandRunner {
  private readonly entries = new Map<string, Entry>();
  private readonly refreshing = new Set<string>();
  private generation = 0;

  constructor(
    private readonly inner: CommandRunner,
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly now: () => number = Date.now,
    private readonly staleMs = 0,
  ) {}

  run(args: string[], options?: RunOptions): Promise<CommandResult> {
    return this.runWith(args, options, false);
  }

  withStale(): CommandRunner {
    return { run: (args, options) => this.runWith(args, options, true) };
  }

  private runWith(args: string[], options: RunOptions | undefined, allowStale: boolean): Promise<CommandResult> {
    const command = commandOf(args);
    if (!isCacheableRead(command)) {
      if (isReadOnly(command)) return this.inner.run(args, options);
      this.invalidate();
      return this.inner.run(args, options).finally(() => this.invalidate());
    }

    const key = JSON.stringify(args);
    const hit = this.entries.get(key);
    if (hit) {
      const age = this.now() - hit.at;
      // A fetch that is still running is joined, however old its start: it ends by itself (the runner has a timeout).
      if (!allowStale) {
        if (age < this.ttlMs || !hit.value) return hit.result;
      } else {
        if (hit.value && age < this.ttlMs) return hit.result;
        // The GUI never waits for a fetch that is still running when it holds any older answer.
        const old = hit.value ? { at: hit.at, value: hit.value } : hit.previous;
        if (old && this.now() - old.at < this.staleMs) {
          if (hit.value) this.refresh(key, args, options);
          return Promise.resolve(old.value);
        }
        if (!hit.value) return hit.result;
      }
    }

    const generation = this.generation;
    const result = this.inner.run(args, options);
    if (this.entries.size >= MAX_ENTRIES) this.entries.clear();
    const previous = hit?.value ? { at: hit.at, value: hit.value } : hit?.previous;
    const entry: Entry = { at: this.now(), result, ...(previous ? { previous } : {}) };
    this.entries.set(key, entry);
    // Failures and non-zero exits are never reused; a mutation since the start makes the answer stale.
    const drop = (): void => { if (this.entries.get(key) === entry) this.entries.delete(key); };
    result.then((value) => {
      if (value.code !== 0 || generation !== this.generation) drop();
      else if (this.entries.get(key) === entry) entry.value = value;
    }, drop);
    return result;
  }

  // The old answer stays usable until a successful, still-current replacement arrives.
  private refresh(key: string, args: string[], options: RunOptions | undefined): void {
    if (this.refreshing.has(key)) return;
    this.refreshing.add(key);
    const generation = this.generation;
    this.inner.run(args, options).then((value) => {
      if (value.code === 0 && generation === this.generation) this.entries.set(key, { at: this.now(), result: Promise.resolve(value), value });
    }).catch(() => undefined).finally(() => this.refreshing.delete(key));
  }

  private invalidate(): void {
    this.generation += 1;
    this.entries.clear();
  }
}
