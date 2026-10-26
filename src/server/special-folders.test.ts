import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  defaultSentCopyMode,
  readAccountsConfig,
  resolveSpecialFolder,
  writeAccountFolderSettings,
} from "./special-folders.js";
import type { Mailbox } from "../shared/types.js";

const mailboxes: Mailbox[] = [
  { id: "INBOX", name: "Inbox", total: 1, unread: 1 },
  { id: "Sent", name: "Sent", total: 0, unread: 0 },
  { id: "Drafts", name: "Drafts", total: 0, unread: 0 },
  { id: "Trash", name: "Trash", total: 0, unread: 0 },
];

describe("resolveSpecialFolder", () => {
  it("matches a Sent mailbox by common name", () => {
    expect(resolveSpecialFolder("sent", mailboxes)).toBe("Sent");
    expect(resolveSpecialFolder("drafts", mailboxes)).toBe("Drafts");
    expect(resolveSpecialFolder("trash", mailboxes)).toBe("Trash");
  });

  it("matches German and Gmail-style names", () => {
    const german: Mailbox[] = [
      { id: "Gesendet", name: "Gesendet", total: 0, unread: 0 },
      { id: "Entwürfe", name: "Entwürfe", total: 0, unread: 0 },
      { id: "Papierkorb", name: "Papierkorb", total: 0, unread: 0 },
    ];
    expect(resolveSpecialFolder("sent", german)).toBe("Gesendet");
    expect(resolveSpecialFolder("drafts", german)).toBe("Entwürfe");
    expect(resolveSpecialFolder("trash", german)).toBe("Papierkorb");

    const gmail: Mailbox[] = [{ id: "[Gmail]/Sent Mail", name: "[Gmail]/Sent Mail", total: 0, unread: 0 }];
    expect(resolveSpecialFolder("sent", gmail)).toBe("[Gmail]/Sent Mail");
  });

  it("matches a German-localized Gmail account's [Google Mail]/... names", () => {
    // Verified against a live German Gmail account's `himalaya mailbox list`
    // output: the IMAP prefix is "[Google Mail]", not the English "[Gmail]".
    const germanGmail: Mailbox[] = [
      { id: "[Google Mail]/Gesendet", name: "[Google Mail]/Gesendet", total: 0, unread: 0 },
      { id: "[Google Mail]/Entwürfe", name: "[Google Mail]/Entwürfe", total: 0, unread: 0 },
      { id: "[Google Mail]/Papierkorb", name: "[Google Mail]/Papierkorb", total: 0, unread: 0 },
    ];
    expect(resolveSpecialFolder("sent", germanGmail)).toBe("[Google Mail]/Gesendet");
    expect(resolveSpecialFolder("drafts", germanGmail)).toBe("[Google Mail]/Entwürfe");
    expect(resolveSpecialFolder("trash", germanGmail)).toBe("[Google Mail]/Papierkorb");
  });

  it("prefers a valid override over the heuristic", () => {
    expect(resolveSpecialFolder("sent", mailboxes, { sent: "INBOX" })).toBe("INBOX");
  });

  it("falls back to the heuristic when the override mailbox no longer exists", () => {
    expect(resolveSpecialFolder("sent", mailboxes, { sent: "Vanished" })).toBe("Sent");
  });

  it("returns null when nothing matches, per Review Focus", () => {
    expect(resolveSpecialFolder("trash", [{ id: "INBOX", name: "Inbox", total: 0, unread: 0 }])).toBeNull();
  });
});

describe("defaultSentCopyMode", () => {
  it("defaults Gmail addresses to none, since Gmail copies sent mail itself", () => {
    expect(defaultSentCopyMode("person@gmail.com")).toBe("none");
    expect(defaultSentCopyMode("Person@Gmail.com")).toBe("none");
  });

  it("defaults everything else to auto", () => {
    expect(defaultSentCopyMode("person@example.test")).toBe("auto");
    expect(defaultSentCopyMode(null)).toBe("auto");
  });
});

describe("accounts.json store", () => {
  it("round-trips one account's settings without disturbing others", async () => {
    const directory = await mkdtemp(join(tmpdir(), "himalaya-web-accounts-test-"));
    const path = join(directory, "accounts.json");
    try {
      await writeAccountFolderSettings("andre", { overrides: { sent: "Sent" }, sentCopy: "auto" }, path);
      await writeAccountFolderSettings("gmail", { overrides: {}, sentCopy: "none" }, path);

      const all = await readAccountsConfig(path);
      expect(all).toEqual({
        andre: { overrides: { sent: "Sent" }, sentCopy: "auto" },
        gmail: { overrides: {}, sentCopy: "none" },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns an empty object when the file does not exist", async () => {
    expect(await readAccountsConfig(join(tmpdir(), "himalaya-web-accounts-test-missing", "accounts.json")))
      .toEqual({});
  });

  it("leaves sentCopy undefined for an overrides-only entry instead of defaulting it to auto", async () => {
    const directory = await mkdtemp(join(tmpdir(), "himalaya-web-accounts-test-"));
    const path = join(directory, "accounts.json");
    try {
      // Written by hand, as the README documents, to set only a trash override.
      await writeFile(path, JSON.stringify({ gmail: { overrides: { trash: "[Google Mail]/Papierkorb" } } }));
      const all = await readAccountsConfig(path);
      expect(all.gmail).toEqual({ overrides: { trash: "[Google Mail]/Papierkorb" } });
      expect(all.gmail?.sentCopy).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

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
});
