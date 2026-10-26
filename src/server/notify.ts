import { spawn } from "node:child_process";

export type Notifier = (title: string, body: string) => void;

const MAX_FIELD_LENGTH = 200;

function sanitizeField(value: string): string {
  const cleaned = value.replace(/[\r\n]+/g, " ").slice(0, MAX_FIELD_LENGTH);
  // omarchy-notification-send's headline is always taken positionally, but
  // its second positional (the description) is parsed as an option instead
  // of text when it exactly matches a recognized flag (--glyph=..., --exec,
  // --urgency=..., etc.). A leading space defeats that match while leaving
  // the visible text effectively unchanged — applied uniformly to both
  // fields since either could end up in that position.
  return cleaned.startsWith("-") ? ` ${cleaned}` : cleaned;
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
