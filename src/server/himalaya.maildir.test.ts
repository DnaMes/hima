import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { HimalayaCli, SpawnRunner } from "./himalaya.js";

// Runs the REAL himalaya binary against a synthetic Maildir in a temp directory, so argument-order
// bugs show up here (the fake runners cannot see them). Skipped when himalaya is not installed.
const hasHimalaya = spawnSync("himalaya", ["--version"]).status === 0;

const RAW = Buffer.from([
  'From: "Test" <t@example.test>',
  "To: a@example.test",
  "Subject: Synthetic Original",
  "Message-ID: <orig@example.test>",
  "Date: Fri, 02 Oct 2026 10:00:00 +0000",
  "",
  "Body text",
  "",
].join("\r\n"));

async function maildir(path: string): Promise<void> {
  for (const sub of ["cur", "new", "tmp"]) await mkdir(join(path, sub), { recursive: true });
}

describe.skipIf(!hasHimalaya)("copy and addRaw against the real himalaya CLI (synthetic Maildir)", () => {
  it("adds, copies within an account and appends across accounts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "himalaya-web-maildir-test-"));
    try {
      await maildir(join(dir, "a"));
      await maildir(join(dir, "a", "Archive"));
      await maildir(join(dir, "b"));
      const config = join(dir, "config.toml");
      await writeFile(config, [
        "[accounts.acc-a]", "default = true", 'email = "a@example.test"', `maildir.root = "${join(dir, "a")}"`,
        "[accounts.acc-b]", 'email = "b@example.test"', `maildir.root = "${join(dir, "b")}"`,
      ].join("\n"));
      const wrapper = join(dir, "himalaya-wrapper");
      await writeFile(wrapper, `#!/bin/sh\nexec himalaya -c "${config}" "$@"\n`);
      await chmod(wrapper, 0o755);
      const cli = new HimalayaCli(new SpawnRunner(wrapper));

      const idOf = async (account: string, name: string): Promise<string> => {
        const found = (await cli.listMailboxes(account, { counts: false })).find((mailbox) => mailbox.name === name);
        if (!found) throw new Error(`no mailbox ${name} in ${account}`);
        return found.id;
      };
      const list = (account: string, mailbox: string) => cli.listEnvelopes({ account, mailbox, page: 1, pageSize: 25 });
      const flagsOf = (envelope: { flags: Array<{ raw: string }> }) => envelope.flags.map((flag) => flag.raw);

      const rootA = await idOf("acc-a", "a");
      await cli.addRaw("acc-a", rootA, RAW, ["seen"]);
      const added = await list("acc-a", rootA);
      expect(added).toHaveLength(1);
      expect(added[0]?.subject).toBe("Synthetic Original");
      expect(flagsOf(added[0]!)).toContain("\\Seen");

      const archiveA = await idOf("acc-a", "Archive");
      await cli.copy({ account: "acc-a", mailbox: rootA, message: added[0]!.id }, archiveA);
      const copied = await list("acc-a", archiveA);
      expect(copied).toHaveLength(1);
      expect(flagsOf(copied[0]!)).toContain("\\Seen");
      expect(await list("acc-a", rootA)).toHaveLength(1);

      const raw = await cli.readRaw({ account: "acc-a", mailbox: rootA, message: added[0]!.id });
      const rootB = await idOf("acc-b", "b");
      await cli.addRaw("acc-b", rootB, raw, ["seen"]);
      const crossed = await list("acc-b", rootB);
      expect(crossed).toHaveLength(1);
      expect(crossed[0]?.subject).toBe("Synthetic Original");
      expect(flagsOf(crossed[0]!)).toContain("\\Seen");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
