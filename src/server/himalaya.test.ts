import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { HimalayaCli, SpawnRunner, type CommandResult, type CommandRunner, type RunOptions } from "./himalaya.js";

class RecordingRunner implements CommandRunner {
  calls: string[][] = [];
  callOptions: (RunOptions | undefined)[] = [];
  response: CommandResult = {
    stdout: Buffer.from(JSON.stringify({
      envelopes: [
        {
          id: "7",
          date: null,
          flags: [],
          from: [],
          to: [],
          subject: "Hello",
          size: 12,
          "has-attachment": false,
        },
      ],
    })),
    stderr: Buffer.alloc(0),
    code: 0,
  };

  async run(args: string[], options?: RunOptions): Promise<CommandResult> {
    this.calls.push(args);
    this.callOptions.push(options);
    return this.response;
  }
}

describe("HimalayaCli", () => {
  it("joins configured account emails without exposing other TOML fields", async () => {
    const directory = await mkdtemp(join(tmpdir(), "himalaya-web-config-test-"));
    const configPath = join(directory, "config.toml");
    await writeFile(configPath, [
      "[accounts.andre]",
      'email = "andre@example.test"',
      'description = "synthetic-unrelated-field"',
      "",
      "[accounts.missing]",
    ].join("\n"));

    const runner = new RecordingRunner();
    runner.response = {
      stdout: Buffer.from(JSON.stringify({ accounts: [
        { name: "andre", default: true, backends: ["imap", "smtp"] },
        { name: "missing", default: false, backends: ["imap", "smtp"] },
      ] })),
      stderr: Buffer.alloc(0),
      code: 0,
    };
    const previousConfigPath = process.env.HIMALAYA_CONFIG_PATH;
    process.env.HIMALAYA_CONFIG_PATH = configPath;

    try {
      const accounts = await new HimalayaCli(runner).listAccounts();
      expect(accounts).toEqual({
        accounts: [
          { name: "andre", default: true, backends: ["imap", "smtp"], email: "andre@example.test", provider: "custom" },
          { name: "missing", default: false, backends: ["imap", "smtp"], email: null, provider: "custom" },
        ],
        addressWarning: null,
      });
      expect(JSON.stringify(accounts)).not.toContain("synthetic-unrelated-field");
    } finally {
      if (previousConfigPath === undefined) delete process.env.HIMALAYA_CONFIG_PATH;
      else process.env.HIMALAYA_CONFIG_PATH = previousConfigPath;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("scopes envelope listing to the requested account and mailbox", async () => {
    const runner = new RecordingRunner();
    const cli = new HimalayaCli(runner);

    const envelopes = await cli.listEnvelopes({
      account: "andre",
      mailbox: "INBOX",
      page: 2,
      pageSize: 50,
    });

    expect(envelopes[0]?.subject).toBe("Hello");
    expect(runner.calls).toEqual([
      [
        "--json",
        "--account",
        "andre",
        "envelope",
        "list",
        "--mailbox",
        "INBOX",
        "--page",
        "2",
        "--page-size",
        "50",
        "--has-attachment",
      ],
    ]);
  });

  it("runs a real search for a text-less filter instead of silently listing", async () => {
    const runner = new RecordingRunner();
    const cli = new HimalayaCli(runner);

    await cli.listEnvelopes({
      account: "andre", mailbox: "INBOX", page: 1, pageSize: 25,
      search: { field: "all", text: "", unread: true },
    });

    const args = runner.calls[0]!;
    // Himalaya's trailing query swallows anything after it, so options come first and `--` ends them.
    expect(args.indexOf("--mailbox")).toBeLessThan(args.indexOf("--"));
    expect(args.slice(args.indexOf("--") + 1)).toEqual(["not", "flag", "seen"]);

    await cli.listEnvelopes({ account: "andre", mailbox: "INBOX", page: 1, pageSize: 25, search: { field: "all", text: "" } });
    expect(runner.calls[1]).toContain("list");
  });

  it("keeps user search text positional, so text that looks like an option is never parsed as one", async () => {
    const runner = new RecordingRunner();
    await new HimalayaCli(runner).listEnvelopes({
      account: "andre", mailbox: "INBOX", page: 1, pageSize: 25, search: { field: "subject", text: "--mailbox" },
    });

    const args = runner.calls[0]!;
    expect(args.slice(args.indexOf("--") + 1)).toEqual(["subject", "--mailbox"]);
    expect(args.filter((arg) => arg === "--mailbox")).toHaveLength(2);
    expect(args.indexOf("--mailbox")).toBeLessThan(args.indexOf("--"));
  });

  it("can list mailboxes without the slow per-folder counts when a caller does not need them", async () => {
    const runner = new RecordingRunner();
    runner.response = { ...runner.response, stdout: Buffer.from(JSON.stringify({ mailboxes: [{ id: "INBOX", name: "INBOX", total: null, unread: null }] })) };
    const cli = new HimalayaCli(runner);

    await cli.listMailboxes("andre", { counts: false });
    await cli.listMailboxes("andre");

    expect(runner.calls[0]).not.toContain("--counts");
    expect(runner.calls[1]).toContain("--counts");
  });

  it("requests per-mailbox counts, since Himalaya leaves total/unread null without --counts", async () => {
    // Regression test: verified live against a real Gmail account that
    // `himalaya mailbox list` (no flags) returns total/unread: null for
    // every mailbox — the mail watcher's rising-unread detection, and the
    // existing unread-pill badge in the account tree, both depend on this
    // flag being present.
    const runner = new RecordingRunner();
    runner.response = {
      stdout: Buffer.from(JSON.stringify({
        mailboxes: [{ id: "INBOX", name: "INBOX", total: 106, unread: 14 }],
      })),
      stderr: Buffer.alloc(0),
      code: 0,
    };

    const mailboxes = await new HimalayaCli(runner).listMailboxes("andre");

    expect(runner.calls).toEqual([["--json", "--account", "andre", "mailbox", "list", "--counts"]]);
    expect(mailboxes).toEqual([{ id: "INBOX", name: "INBOX", total: 106, unread: 14 }]);
  });

  it("setFlag adds or removes any of the four supported flags", async () => {
    const runner = new RecordingRunner();
    const cli = new HimalayaCli(runner);

    await cli.setFlag({ account: "andre", mailbox: "INBOX", message: "7" }, "flagged", true);
    await cli.setFlag({ account: "andre", mailbox: "INBOX", message: "7" }, "answered", false);

    expect(runner.calls).toEqual([
      ["--account", "andre", "flag", "add", "--flag", "flagged", "7", "--mailbox", "INBOX"],
      ["--account", "andre", "flag", "remove", "--flag", "answered", "7", "--mailbox", "INBOX"],
    ]);
  });

  it("never invokes the runner for an invalid account reference", async () => {
    const runner = new RecordingRunner();
    const cli = new HimalayaCli(runner);

    await expect(cli.listMailboxes("bad\u0000account")).rejects.toThrow("account");
    expect(runner.calls).toHaveLength(0);
  });

  it("explains when Gmail requires an app password", async () => {
    const runner = new RecordingRunner();
    runner.response = {
      stdout: Buffer.from(JSON.stringify({
        error: "IMAP AUTHENTICATE PLAIN failed: NO Application-specific password required: https://support.google.com/accounts/answer/185833",
        sources: [],
        backtrace: null,
      })),
      stderr: Buffer.alloc(0),
      code: 1,
    };

    await expect(new HimalayaCli(runner).listMailboxes("gmail"))
      .rejects.toMatchObject({ code: "AUTH_REQUIRED", retryable: false, message: expect.stringContaining("App-Passwort") });
  });

  it("explains when the provider disables Basic authentication", async () => {
    const runner = new RecordingRunner();
    runner.response = {
      stdout: Buffer.from(JSON.stringify({
        error: "IMAP AUTHENTICATE PLAIN failed: NO Basic authentication is disabled.",
        sources: [],
        backtrace: null,
      })),
      stderr: Buffer.alloc(0),
      code: 1,
    };

    await expect(new HimalayaCli(runner).listMailboxes("gmail"))
      .rejects.toMatchObject({ code: "AUTH_REQUIRED", retryable: false, message: expect.stringMatching(/OAuth2|App-Passwort/) });
  });
});

import type { ComposeRequest } from "./compose.js";

describe("HimalayaCli compose and delete", () => {
  const composeRequest: ComposeRequest = {
    account: "andre",
    mode: "new",
    to: ["alice@example.test"],
    cc: [],
    bcc: [],
    subject: "Hello",
    body: "Hi there",
    includeOriginalAttachments: false,
  };

  it("previews a composed message without --send", async () => {
    const runner = new RecordingRunner();
    runner.response = { stdout: Buffer.from("From: <andre@example.test>\r\n\r\nHi there\r\n"), stderr: Buffer.alloc(0), code: 0 };

    const mime = await new HimalayaCli(runner).composePreview(composeRequest);

    expect(mime).toContain("Hi there");
    expect(runner.calls).toEqual([[
      "--account", "andre", "message", "compose",
      "--to", "alice@example.test", "--subject", "Hello",
    ]]);
    expect(runner.callOptions[0]?.stdin).toBe("Hi there");
  });

  it("sends a composed message with a Sent-mailbox copy and attachments", async () => {
    const runner = new RecordingRunner();
    runner.response = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), code: 0 };

    await new HimalayaCli(runner).composeSend(composeRequest, { send: true, saveTo: "Sent", attachmentPaths: ["/tmp/a.pdf"] });

    expect(runner.calls).toEqual([[
      "--account", "andre", "message", "compose",
      "--to", "alice@example.test", "--subject", "Hello",
      "--attach", "/tmp/a.pdf", "--save", "Sent", "--send",
    ]]);
    expect(runner.callOptions[0]?.stdin).toBe("Hi there");
  });

  it("raises a mapped provider error when sending fails", async () => {
    const runner = new RecordingRunner();
    runner.response = {
      stdout: Buffer.from(JSON.stringify({ error: "IMAP AUTHENTICATE PLAIN failed: NO Application-specific password required" })),
      stderr: Buffer.alloc(0), code: 1,
    };

    await expect(new HimalayaCli(runner).composeSend(composeRequest, { send: true, attachmentPaths: [] }))
      .rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("deletes a message trash-first, scoped to its account and mailbox", async () => {
    const runner = new RecordingRunner();
    runner.response = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), code: 0 };

    await new HimalayaCli(runner).deleteMessage({ account: "andre", mailbox: "INBOX", message: "7" });

    expect(runner.calls).toEqual([["--account", "andre", "message", "delete", "--mailbox", "INBOX", "7"]]);
  });
});

describe("SpawnRunner", () => {
  it("reports a timeout as TIMEOUT, not as a failure to start", async () => {
    const directory = await mkdtemp(join(tmpdir(), "himalaya-web-runner-test-"));
    const script = join(directory, "slow-himalaya");
    await writeFile(script, "#!/bin/sh\nsleep 5\n", { mode: 0o755 });
    try {
      const runner = new SpawnRunner(script);
      await expect(runner.run([], { timeoutMs: 100 })).rejects.toMatchObject({ code: "TIMEOUT" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

// Reads the temp file the way the CLI would, while the call is in flight.
class InspectingRunner extends RecordingRunner {
  file = "";
  seen: { mode: number; bytes: Buffer; joined: string } | null = null;

  override async run(args: string[]): Promise<CommandResult> {
    this.file = args.at(-1)!;
    this.seen = { mode: (await stat(this.file)).mode & 0o777, bytes: await readFile(this.file), joined: args.join(" ") };
    return super.run(args);
  }
}

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false);

describe("copy", () => {
  const ref = { account: "andre", mailbox: "INBOX", message: "7" };

  it("copies within the account with the same argument shape as move", async () => {
    const runner = new RecordingRunner();
    await new HimalayaCli(runner).copy(ref, "Archive");

    expect(runner.calls).toEqual([["--account", "andre", "message", "copy", "--from", "INBOX", "--to", "Archive", "7"]]);
  });

  it.each(["", "a\u0000b"])("rejects the destination %j before spawning anything", async (destination) => {
    const runner = new RecordingRunner();
    await expect(new HimalayaCli(runner).copy(ref, destination)).rejects.toThrow();
    expect(runner.calls).toEqual([]);
  });
});

describe("addRaw", () => {
  const raw = Buffer.from("From: a@example.test\r\nSubject: Marker-Body-XYZ\r\n\r\nMarker-Body-XYZ\r\n");

  it("hands the message over as a private temp file after `--`, never as an argument, and removes it", async () => {
    const runner = new InspectingRunner();
    await new HimalayaCli(runner).addRaw("beta", "Archive", raw, ["seen"]);

    expect(runner.calls[0]).toEqual(["--account", "beta", "message", "add", "--mailbox", "Archive", "-f", "seen", "--", runner.file]);
    expect(runner.seen?.mode).toBe(0o600);
    expect(runner.seen?.bytes.equals(raw)).toBe(true);
    expect(runner.seen?.joined).not.toContain("Marker-Body-XYZ");
    expect(await exists(runner.file)).toBe(false);
    expect(await exists(dirname(runner.file))).toBe(false);
  });

  it("omits -f without flags and passes several flags in one group", async () => {
    const plain = new InspectingRunner();
    await new HimalayaCli(plain).addRaw("beta", "Archive", raw);
    expect(plain.calls[0]).not.toContain("-f");

    const flagged = new InspectingRunner();
    await new HimalayaCli(flagged).addRaw("beta", "Archive", raw, ["seen", "flagged"]);
    expect(flagged.calls[0]!.slice(6, 10)).toEqual(["-f", "seen", "flagged", "--"]);
  });

  it("removes the temp file even when the CLI fails", async () => {
    const runner = new InspectingRunner();
    runner.response = { stdout: Buffer.alloc(0), stderr: Buffer.from("synthetic failure"), code: 1 };

    await expect(new HimalayaCli(runner).addRaw("beta", "Archive", raw)).rejects.toThrow();
    expect(await exists(dirname(runner.file))).toBe(false);
  });

  it.each([["", "Archive"], ["beta", ""], ["be\u0000ta", "Archive"]])("rejects account %j and mailbox %j before spawning anything", async (account, mailbox) => {
    const runner = new RecordingRunner();
    await expect(new HimalayaCli(runner).addRaw(account, mailbox, raw)).rejects.toThrow();
    expect(runner.calls).toEqual([]);
  });
});
