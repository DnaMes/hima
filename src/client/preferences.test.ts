import { describe, expect, it } from "vitest";

import type { Mailbox } from "../shared/types.js";
import {
  chooseInitialView,
  chooseMailbox,
  isSentMailbox,
  pinnedMailboxes,
} from "./preferences.js";

const mailboxes: Mailbox[] = [
  { id: "INBOX", name: "INBOX", total: 2, unread: 1 },
  { id: "Archive", name: "Archive", total: 1, unread: 0 },
];

describe("client preferences", () => {
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

  it("chooses saved mailbox if present, falls back to INBOX, then first mailbox", () => {
    expect(chooseMailbox(mailboxes, "Archive")).toBe("Archive");
    expect(chooseMailbox(mailboxes, "NonExistent")).toBe("INBOX");
    expect(chooseMailbox([{ id: "Custom", name: "Custom", total: 0, unread: 0 }], null)).toBe("Custom");
    expect(chooseMailbox([], null)).toBeNull();
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
