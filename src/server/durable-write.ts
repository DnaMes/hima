import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const STALE_TEMP_MS = 60 * 60 * 1000;
// Filesystems that cannot fsync a directory answer with one of these; anything else is worth a log line.
const DIRECTORY_SYNC_UNSUPPORTED = new Set(["EINVAL", "ENOTSUP", "ENOSYS", "EPERM", "EBADF", "EISDIR"]);
// The sweep is housekeeping for crashes of an earlier process, so once per file and process is enough.
const swept = new Set<string>();

/** Removes temp files an earlier crash left behind (only our own `<name>.<uuid>.tmp` pattern, only when old). */
async function removeStaleTempFiles(path: string): Promise<void> {
  if (swept.has(path)) return;
  const pattern = new RegExp(`^${basename(path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.[0-9a-f-]{36}\\.tmp$`);
  try {
    const names = await readdir(dirname(path));
    swept.add(path); // only a sweep that could read the directory counts; a transient failure is retried by the next write
    for (const name of names) {
      if (!pattern.test(name)) continue;
      const file = join(dirname(path), name);
      const info = await stat(file).catch(() => null);
      if (info?.isFile() && Date.now() - info.mtimeMs > STALE_TEMP_MS) await rm(file, { force: true });
    }
  } catch {
    // Housekeeping only; a failure here must never stop the real write.
  }
}

/**
 * Replaces `path` with `content` so that a crash or power loss leaves either the old or the new file, never a
 * partial one: a random temp file (no leftover can keep an old mode or block the write), mode 0600, flushed before
 * the rename, and the directory flushed after it. The temp file is removed when anything fails, and temp files of
 * an earlier crash are swept when they are older than an hour. A directory created on the way is private (0700);
 * its own parent is not flushed, because the data file is only valuable once its directory entry is.
 */
export async function writeFileDurably(
  path: string,
  content: string,
  openDirectory: typeof open = open, // injectable so the flush error handling can be tested
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await removeStaleTempFiles(path);
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, content, { mode: 0o600, flush: true });
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  try {
    const directory = await openDirectory(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    if (!DIRECTORY_SYNC_UNSUPPORTED.has((error as NodeJS.ErrnoException).code ?? "")) {
      process.stderr.write(`[store] could not flush the directory of ${path}: ${(error as Error).message}\n`);
    }
  }
}
