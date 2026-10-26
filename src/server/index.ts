import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createMiniMaxProvider, readAiConfig } from "./ai.js";
import { createApp } from "./app.js";
import { CachingRunner } from "./caching-runner.js";
import { createWarmer } from "./warmer.js";
import { HimalayaCli, SpawnRunner } from "./himalaya.js";
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
// only while at least one account has watch: true, and removed otherwise —
// but only once the server has actually bound its port: writing it earlier
// would let a second instance that loses an EADDRINUSE race overwrite the
// running instance's on-disk token with one it will never accept, freezing
// the widget's badge with no running server able to authorize the new value.
const widgetTokenPath = join(homedir(), ".config", "himalaya-web", "widget-token");
const accountsConfig = await readAccountsConfig();
const anyWatched = Object.values(accountsConfig).some((settings) => settings.watch === true);
const widgetToken: string | undefined = anyWatched ? randomBytes(32).toString("hex") : undefined;

const baseOptions = {
  token,
  ...(existsSync(staticDir) ? { staticDir } : {}),
  ...(widgetToken !== undefined ? { widgetToken } : {}),
  notify: createNotifier(`http://127.0.0.1:${port}/`),
  watchIntervalMs,
};
const aiConfig = readAiConfig();
// One cache, two views: the GUI may get an answer up to 6 h old at once (it is refreshed in the background and
// the client re-fetches), while the watcher and the warmer always see current mail.
const cache = new CachingRunner(new SpawnRunner(), 45_000, Date.now, 6 * 3_600_000);
const service = new HimalayaCli(cache.withStale());
const freshService = new HimalayaCli(cache);
// The cache lives 45 s and the warmer renews it every 40 s, but only for 5 minutes after the last GUI request.
const warmer = createWarmer(freshService, { intervalMs: 40_000, idleMs: 300_000 });
const app = await createApp(
  service,
  { ...baseOptions, warmer, watchService: freshService, ...(aiConfig ? { ai: createMiniMaxProvider(aiConfig) } : {}) },
);
warmer.start();

try {
  await app.listen({ host: "127.0.0.1", port });
  if (widgetToken !== undefined) {
    await mkdir(dirname(widgetTokenPath), { recursive: true });
    await writeFile(widgetTokenPath, widgetToken, { mode: 0o600 });
  } else {
    await rm(widgetTokenPath, { force: true });
  }
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
