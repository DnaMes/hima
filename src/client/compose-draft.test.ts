import { describe, expect, it } from "vitest";

import { clearDraft, composeDraftId, draftStorageKey, readDraft, writeDraft } from "./compose-draft.js";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

const fields = { to: ["a@example.test"], cc: [], bcc: [], subject: "Hi", body: "Hello", attachmentNames: ["a.pdf"] };

describe("compose-draft", () => {
  it("namespaces compose draft id by mode, account, mailbox, and message", () => {
    const replyA = composeDraftId({
      mode: "reply",
      account: "accA",
      sourceDetail: { ref: { account: "accA", mailbox: "INBOX", message: "1" } },
    });
    const replyB = composeDraftId({
      mode: "reply",
      account: "accB",
      sourceDetail: { ref: { account: "accB", mailbox: "INBOX", message: "1" } },
    });
    const newA = composeDraftId({ mode: "new", account: "accA" });
    const newB = composeDraftId({ mode: "new", account: "accB" });

    expect(replyA).toBe("reply-accA-INBOX-1");
    expect(replyB).toBe("reply-accB-INBOX-1");
    expect(replyA).not.toBe(replyB);
    expect(newA).toBe("new-accA");
    expect(newB).toBe("new-accB");
    expect(newA).not.toBe(newB);
  });

  it("namespaces the storage key by compose id", () => {
    expect(draftStorageKey("abc")).toBe("himalaya-web-draft-abc");
    expect(draftStorageKey("abc")).not.toBe(draftStorageKey("def"));
  });

  it("round-trips a draft", () => {
    const storage = memoryStorage();
    writeDraft(storage, "abc", fields);
    expect(readDraft(storage, "abc")).toEqual(fields);
  });

  it("returns null for a missing or corrupt draft", () => {
    const storage = memoryStorage();
    expect(readDraft(storage, "missing")).toBeNull();
    storage.setItem(draftStorageKey("bad"), "not json");
    expect(readDraft(storage, "bad")).toBeNull();
  });

  it("clears a draft", () => {
    const storage = memoryStorage();
    writeDraft(storage, "abc", fields);
    clearDraft(storage, "abc");
    expect(readDraft(storage, "abc")).toBeNull();
  });
});
