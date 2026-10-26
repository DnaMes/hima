import { describe, expect, it } from "vitest";

import type { Account, Mailbox } from "../shared/types.js";
import {
  chooseInitialView,
  chooseMailbox,
  filterAccounts,
  filterMailboxes,
  isSentMailbox,
  pinnedMailboxes,
  mailboxFavoriteKey,
} from "./preferences.js";

const accounts: Account[] = [
  { name: "andre", default: true, backends: ["imap"], email: "andre@example.test" },
  { name: "work", default: false, backends: ["imap"], email: "team@work.test" },
];

const mailboxes: Mailbox[] = [
  { id: "INBOX", name: "INBOX", total: 2, unread: 1 },
  { id: "Archive", name: "Archive", total: 1, unread: 0 },
];

describe("client preferences", () => {
  it("searches accounts by alias and configured email", () => {
    expect(filterAccounts(accounts, "example.test", "all", new Set()).map((account) => account.name)).toEqual(["andre"]);
  });

  it("puts account favorites first and filters to favorites", () => {
    const favorites = new Set(["work"]);
    expect(filterAccounts(accounts, "", "all", favorites).map((account) => account.name)).toEqual(["work", "andre"]);
    expect(filterAccounts(accounts, "", "favorites", favorites).map((account) => account.name)).toEqual(["work"]);
  });

  it("preserves canonical account order inside favorite groups and search results", () => {
    const ordered: Account[] = [
      ...accounts,
      { name: "personal", default: false, backends: ["imap"], email: "personal@example.test" },
    ];
    const favorites = new Set(["andre", "personal"]);
    const accountOrder = ["personal", "work", "andre"];

    expect(filterAccounts(ordered, "", "all", favorites, accountOrder).map((account) => account.name))
      .toEqual(["personal", "andre", "work"]);
    expect(filterAccounts(ordered, "example.test", "favorites", favorites, accountOrder).map((account) => account.name))
      .toEqual(["personal", "andre"]);
  });

  it("keeps manual order in search results across favorite groups", () => {
    const matching: Account[] = [
      ...accounts,
      { name: "zebra", default: false, backends: ["imap"], email: "zebra@example.test" },
      { name: "alpha", default: false, backends: ["imap"], email: "alpha@example.test" },
    ];

    expect(filterAccounts(matching, "example.test", "all", new Set(["andre"]), ["zebra", "work", "alpha", "andre"])
      .map((account) => account.name)).toEqual(["andre", "zebra", "alpha"]);
  });

  it("scopes mailbox favorites by account", () => {
    const favorites = new Set([mailboxFavoriteKey("andre", "INBOX")]);
    expect(filterMailboxes("andre", mailboxes, "favorites", favorites).map((mailbox) => mailbox.id)).toEqual(["INBOX"]);
    expect(filterMailboxes("work", mailboxes, "favorites", favorites)).toEqual([]);
  });

  it("pins Inbox then Sent and recognises localized Sent folders", () => {
    const list = [
      { id: "Archive", name: "Archive", total: null, unread: null },
      { id: "[Google Mail]/Gesendet", name: "[Google Mail]/Gesendet", total: null, unread: null },
      { id: "INBOX", name: "INBOX", total: null, unread: null },
    ];
    expect(pinnedMailboxes(list).map((mailbox) => mailbox.id)).toEqual(["INBOX", "[Google Mail]/Gesendet"]);
    expect(isSentMailbox(list[0])).toBe(false);
    expect(isSentMailbox(undefined)).toBe(false);
  });

  it("chooses only a visible mailbox and returns null for an empty favorite view", () => {
    const favorites = new Set([mailboxFavoriteKey("andre", "Archive")]);
    expect(chooseMailbox(mailboxes, "INBOX", "favorites", favorites, "andre")).toBe("Archive");
    expect(chooseMailbox(mailboxes, "INBOX", "favorites", new Set(), "andre")).toBeNull();
  });

  it("defaults to the unified inbox on a fresh session and for any unrecognized saved value", () => {
    expect(chooseInitialView(null)).toBe("unified");
    expect(chooseInitialView("")).toBe("unified");
    expect(chooseInitialView("unified")).toBe("unified");
    expect(chooseInitialView("bogus")).toBe("unified");
  });

  it("restores the account view only when it was explicitly saved", () => {
    expect(chooseInitialView("account")).toBe("account");
  });
});
