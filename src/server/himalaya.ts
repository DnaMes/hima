import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import type { Attachment, Envelope, Mailbox, MessageRef } from "../shared/types.js";
import type { Account } from "../shared/types.js";
import { loadAccountEmails } from "./account-config.js";
import {
  buildSearchQuery,
  hasSearchCriteria,
  messageRef,
  parseAccounts,
  parseAttachments,
  parseEnvelopes,
  parseMailboxes,
  validateRefPart,
  type SearchInput,
} from "./contracts.js";
import { providerError } from "./provider-errors.js";
import { buildComposeArgs, type ComposeRequest } from "./compose.js";

export type CommandResult = {
  stdout: Buffer;
  stderr: Buffer;
  code: number | null;
};

export type RunOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
  stdin?: string | Buffer;
};

export interface CommandRunner {
  run(args: string[], options?: RunOptions): Promise<CommandResult>;
}

export interface HimalayaService {
  listAccounts(): Promise<AccountListResult>;
  listMailboxes(account: string, options?: { counts?: boolean }): Promise<Mailbox[]>;
  listEnvelopes(query: EnvelopeQuery): Promise<Envelope[]>;
  readRaw(ref: MessageRef, signal?: AbortSignal): Promise<Buffer>;
  listAttachments(ref: MessageRef): Promise<Attachment[]>;
  setSeen(ref: MessageRef, seen: boolean): Promise<void>;
  setFlag(ref: MessageRef, flag: "seen" | "answered" | "flagged" | "draft", value: boolean): Promise<void>;
  move(ref: MessageRef, destination: string): Promise<void>;
  /** Copies within the ref's account; the source stays. */
  copy(ref: MessageRef, destinationMailbox: string): Promise<void>;
  /** Appends a raw RFC 5322 message to a mailbox, optionally with flags. */
  addRaw(account: string, mailbox: string, raw: Buffer, flags?: readonly ("seen" | "answered" | "flagged")[]): Promise<void>;
  downloadAttachment(
    ref: MessageRef,
    attachmentId: string,
    filename: string | null,
  ): Promise<{ data: Buffer; filename: string }>;
  composePreview(request: ComposeRequest): Promise<string>;
  composeSend(
    request: ComposeRequest,
    options: { send: boolean; saveTo?: string; attachmentPaths: readonly string[] },
  ): Promise<void>;
  deleteMessage(ref: MessageRef): Promise<void>;
}

export type AccountListResult = {
  accounts: Account[];
  addressWarning: string | null;
};

export class HimalayaError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "HimalayaError";
  }
}

export class SpawnRunner implements CommandRunner {
  constructor(private readonly binary = process.env.HIMALAYA_BIN ?? "himalaya") {}

  run(args: string[], options: RunOptions = {}): Promise<CommandResult> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const maxOutputBytes = options.maxOutputBytes ?? 50 * 1024 * 1024;

    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const child = spawn(this.binary, args, {
        env: process.env,
        shell: false,
        stdio: [options.stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
        signal: controller.signal,
      });
      if (options.stdin !== undefined && child.stdin) {
        child.stdin.on("error", (error) => {
          if ((error as NodeJS.ErrnoException).code !== "EPIPE") {
            settleError(error);
          }
        });
        child.stdin.end(options.stdin);
      }
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let settled = false;

      const settleError = (error: Error): void => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      const abort = (reason: string): void => {
        if (settled) return;
        // Settle first: controller.abort() emits the child's "error" event synchronously, which
        // would otherwise win and report a timeout as "could not be started".
        settleError(new HimalayaError(reason, "TIMEOUT", true));
        controller.abort();
      };

      const timer = setTimeout(() => abort("Himalaya took too long to respond."), timeoutMs);
      const externalAbort = (): void => abort("The Himalaya operation was cancelled.");
      options.signal?.addEventListener("abort", externalAbort, { once: true });

      const collect = (target: Buffer[]): ((chunk: Buffer) => void) => (chunk) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > maxOutputBytes) {
          abort("Himalaya returned too much data.");
          return;
        }
        target.push(chunk);
      };

      child.stdout?.on("data", collect(stdout));
      child.stderr?.on("data", collect(stderr));
      child.on("error", (error) => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", externalAbort);
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          settleError(new HimalayaError("The Himalaya binary was not found.", "BINARY_NOT_FOUND", false));
          return;
        }
        settleError(new HimalayaError("Himalaya could not be started.", "SPAWN_FAILED", true));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", externalAbort);
        if (settled) return;
        settled = true;
        resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), code });
      });
    });
  }
}

function requireSuccess(result: CommandResult): Buffer {
  if (result.code !== 0) {
    throw providerError(result);
  }
  return result.stdout;
}

function parseJson(result: CommandResult): unknown {
  const stdout = requireSuccess(result).toString("utf8");
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    throw new HimalayaError("Himalaya returned invalid data.", "INVALID_OUTPUT", true);
  }
}

export type EnvelopeQuery = {
  account: string;
  mailbox: string;
  page: number;
  pageSize: number;
  search?: SearchInput;
};

export class HimalayaCli implements HimalayaService {
  constructor(private readonly runner: CommandRunner = new SpawnRunner()) {}

  async listAccounts(): Promise<AccountListResult> {
    const accounts = parseAccounts(parseJson(await this.runner.run(["--json", "account", "list"])));
    const addressResult = await loadAccountEmails(accounts.map((account) => account.name));
    return {
      accounts: accounts.map((account) => ({
        ...account,
        email: addressResult.emails[account.name] ?? null,
        provider: addressResult.providers[account.name] ?? "custom",
      })),
      addressWarning: addressResult.warning,
    };
  }

  // Counts cost one IMAP STATUS per folder (12 s for a 71-folder Gmail account); callers that
  // only need folder names, such as search, pass { counts: false }.
  async listMailboxes(account: string, options: { counts?: boolean } = {}): Promise<Mailbox[]> {
    validateRefPart(account, "account");
    return parseMailboxes(
      parseJson(await this.runner.run([
        "--json", "--account", account, "mailbox", "list", ...(options.counts === false ? [] : ["--counts"]),
      ])),
    );
  }

  async listEnvelopes(query: EnvelopeQuery): Promise<Envelope[]> {
    validateRefPart(query.account, "account");
    validateRefPart(query.mailbox, "mailbox");
    if (!Number.isInteger(query.page) || query.page < 1 || query.page > 10_000) {
      throw new HimalayaError("Invalid page.", "INVALID_INPUT", false);
    }
    if (!Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100) {
      throw new HimalayaError("Invalid page size.", "INVALID_INPUT", false);
    }

    const searchQuery = query.search && hasSearchCriteria(query.search) ? buildSearchQuery(query.search) : null;
    const args = [
      "--json",
      "--account",
      query.account,
      "envelope",
      searchQuery ? "search" : "list",
      "--mailbox",
      query.mailbox,
      "--page",
      String(query.page),
      "--page-size",
      String(query.pageSize),
      "--has-attachment",
      // Himalaya's trailing query swallows every option after it (verified live: "Mailbox is
      // required"), and `--` keeps user text such as "--help" from being read as an option.
      ...(searchQuery ? ["--", ...searchQuery] : []),
    ];
    return parseEnvelopes(parseJson(await this.runner.run(args)));
  }

  async readRaw(ref: MessageRef, signal?: AbortSignal): Promise<Buffer> {
    const safe = messageRef(ref.account, ref.mailbox, ref.message);
    const result = await this.runner.run(
      [
        "--account",
        safe.account,
        "message",
        "read",
        safe.message,
        "--mailbox",
        safe.mailbox,
        "--raw",
      ],
      { ...(signal ? { signal } : {}), timeoutMs: 60_000, maxOutputBytes: 50 * 1024 * 1024 },
    );
    return requireSuccess(result);
  }

  async listAttachments(ref: MessageRef): Promise<Attachment[]> {
    const safe = messageRef(ref.account, ref.mailbox, ref.message);
    return parseAttachments(
      parseJson(
        await this.runner.run([
          "--json",
          "--account",
          safe.account,
          "attachment",
          "list",
          safe.message,
          "--mailbox",
          safe.mailbox,
        ]),
      ),
    );
  }

  async setSeen(ref: MessageRef, seen: boolean): Promise<void> {
    await this.setFlag(ref, "seen", seen);
  }

  async setFlag(ref: MessageRef, flag: "seen" | "answered" | "flagged" | "draft", value: boolean): Promise<void> {
    const safe = messageRef(ref.account, ref.mailbox, ref.message);
    const action = value ? "add" : "remove";
    requireSuccess(
      await this.runner.run([
        "--account",
        safe.account,
        "flag",
        action,
        "--flag",
        flag,
        safe.message,
        "--mailbox",
        safe.mailbox,
      ]),
    );
  }

  async copy(ref: MessageRef, destinationMailbox: string): Promise<void> {
    const safe = messageRef(ref.account, ref.mailbox, ref.message);
    validateRefPart(destinationMailbox, "destination mailbox");
    requireSuccess(
      await this.runner.run([
        "--account",
        safe.account,
        "message",
        "copy",
        "--from",
        safe.mailbox,
        "--to",
        destinationMailbox,
        safe.message,
      ]),
    );
  }

  async addRaw(
    account: string,
    mailbox: string,
    raw: Buffer,
    flags: readonly ("seen" | "answered" | "flagged")[] = [],
  ): Promise<void> {
    validateRefPart(account, "account");
    validateRefPart(mailbox, "mailbox");
    // The raw message must not travel as an argument (visible to other processes, size-limited), so it
    // goes through a private temp file; mkdtemp creates the directory 0700.
    const directory = await mkdtemp(join(tmpdir(), "himalaya-web-add-"));
    try {
      const file = join(directory, "message.eml");
      await writeFile(file, raw, { mode: 0o600 });
      // `-f` takes a variadic list, so `--` must end it before the file path.
      requireSuccess(
        await this.runner.run([
          "--account", account, "message", "add", "--mailbox", mailbox,
          ...(flags.length > 0 ? ["-f", ...flags] : []),
          "--", file,
        ]),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async move(ref: MessageRef, destination: string): Promise<void> {
    const safe = messageRef(ref.account, ref.mailbox, ref.message);
    validateRefPart(destination, "destination mailbox");
    requireSuccess(
      await this.runner.run([
        "--account",
        safe.account,
        "message",
        "move",
        "--from",
        safe.mailbox,
        "--to",
        destination,
        safe.message,
      ]),
    );
  }

  async downloadAttachment(
    ref: MessageRef,
    attachmentId: string,
    filename: string | null,
  ): Promise<{ data: Buffer; filename: string }> {
    const safe = messageRef(ref.account, ref.mailbox, ref.message);
    validateRefPart(attachmentId, "attachment");
    const directory = await mkdtemp(join(tmpdir(), "himalaya-web-"));
    try {
      requireSuccess(
        await this.runner.run([
          "--json",
          "--account",
          safe.account,
          "attachment",
          "download",
          safe.message,
          attachmentId,
          "--mailbox",
          safe.mailbox,
          "--dir",
          directory,
        ], { timeoutMs: 60_000, maxOutputBytes: 2 * 1024 * 1024 }),
      );
      const files = (await readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name);
      if (files.length !== 1) {
        throw new HimalayaError("The attachment could not be downloaded.", "DOWNLOAD_FAILED", true);
      }
      const file = files[0];
      if (!file) throw new HimalayaError("The attachment could not be downloaded.", "DOWNLOAD_FAILED", true);
      return {
        data: await readFile(join(directory, file)),
        filename: safeFilename(filename ?? file),
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async composePreview(request: ComposeRequest): Promise<string> {
    const args = buildComposeArgs(request, { send: false });
    const result = requireSuccess(
      await this.runner.run(["--account", request.account, ...args], { stdin: request.body ?? "" }),
    );
    return result.toString("utf8");
  }

  async composeSend(
    request: ComposeRequest,
    options: { send: boolean; saveTo?: string; attachmentPaths: readonly string[] },
  ): Promise<void> {
    const args = buildComposeArgs(request, {
      send: options.send,
      ...(options.saveTo ? { saveTo: options.saveTo } : {}),
      attachmentPaths: options.attachmentPaths,
    });
    requireSuccess(
      await this.runner.run(
        ["--account", request.account, ...args],
        { timeoutMs: 60_000, stdin: request.body ?? "" },
      ),
    );
  }

  async deleteMessage(ref: MessageRef): Promise<void> {
    const safe = messageRef(ref.account, ref.mailbox, ref.message);
    requireSuccess(
      await this.runner.run([
        "--account", safe.account, "message", "delete", "--mailbox", safe.mailbox, safe.message,
      ]),
    );
  }
}

function safeFilename(value: string): string {
  const normalized = value.replace(/[\\/\u0000]/g, "_").replace(/\.\./g, "_").trim();
  return normalized.slice(0, 180) || "attachment";
}
