import { describe, expect, it } from "vitest";

import { buildComposeArgs, composeRequestSchema } from "./compose.js";

const base = {
  account: "andre",
  mode: "new" as const,
  to: ["alice@example.test"],
  cc: [],
  bcc: [],
  subject: "Hello",
  body: "Hi there",
  includeOriginalAttachments: false,
};

describe("composeRequestSchema", () => {
  it("accepts a minimal new message", () => {
    expect(composeRequestSchema.parse(base)).toMatchObject(base);
  });

  it("rejects a header-injection attempt in an address", () => {
    expect(() => composeRequestSchema.parse({ ...base, to: ["alice@example.test\r\nBcc: eve@evil.test"] }))
      .toThrow();
  });

  it("rejects a header-injection attempt in the subject", () => {
    expect(() => composeRequestSchema.parse({ ...base, subject: "Hi\nBcc: eve@evil.test" })).toThrow();
  });

  it("rejects more than 100 total recipients", () => {
    const to = Array.from({ length: 101 }, (_, i) => `user${i}@example.test`);
    expect(() => composeRequestSchema.parse({ ...base, to })).toThrow();
  });

  it("rejects a subject over 998 bytes", () => {
    expect(() => composeRequestSchema.parse({ ...base, subject: "x".repeat(999) })).toThrow();
  });

  it("rejects a subject with multi-byte UTF-8 characters that exceeds 998 bytes", () => {
    // "ä" is 2 bytes in UTF-8, so 500 characters = 1000 bytes (exceeds 998 limit)
    // The old implementation using .max(998) would have accepted this (500 chars < 998)
    expect(() => composeRequestSchema.parse({ ...base, subject: "ä".repeat(500) })).toThrow();
  });

  it("rejects a body over 1 MiB", () => {
    expect(() => composeRequestSchema.parse({ ...base, body: "x".repeat(1_048_577) })).toThrow();
  });

  it("requires at least one recipient for new mail", () => {
    expect(() => composeRequestSchema.parse({ ...base, to: [], cc: [], bcc: [] })).toThrow();
  });

  it("requires at least one recipient for reply-all", () => {
    expect(() => composeRequestSchema.parse({
      ...base, mode: "reply-all", to: [], cc: [], bcc: [],
      sourceRef: { account: "andre", mailbox: "INBOX", message: "1" },
    })).toThrow();
  });

  it("requires at least one recipient for forward", () => {
    expect(() => composeRequestSchema.parse({
      ...base, mode: "forward", to: [], cc: [], bcc: [],
      sourceRef: { account: "andre", mailbox: "INBOX", message: "1" },
    })).toThrow();
  });

  it("allows an empty recipient list for a plain reply, since Himalaya derives it", () => {
    expect(composeRequestSchema.parse({
      ...base, mode: "reply", to: [], cc: [], bcc: [],
      sourceRef: { account: "andre", mailbox: "INBOX", message: "1" },
    }).to).toEqual([]);
  });

  it("requires a sourceRef for reply, reply-all, and forward", () => {
    expect(() => composeRequestSchema.parse({ ...base, mode: "reply" })).toThrow();
    expect(() => composeRequestSchema.parse({ ...base, mode: "forward" })).toThrow();
  });

  it.each(["reply", "reply-all", "forward"])(
    "rejects a %s whose account differs from the source message's account",
    (mode) => {
      expect(() => composeRequestSchema.parse({
        ...base, mode, account: "anna",
        sourceRef: { account: "andre", mailbox: "INBOX", message: "1" },
      })).toThrow();
    },
  );

  it("accepts a reply that stays on the source message's account", () => {
    const sourceRef = { account: "andre", mailbox: "INBOX", message: "1" };
    expect(composeRequestSchema.parse({ ...base, mode: "reply", sourceRef }).sourceRef).toEqual(sourceRef);
  });
});

describe("buildComposeArgs", () => {
  it("builds a new-message send with repeated recipient flags and omits --body for stdin streaming", () => {
    expect(buildComposeArgs(base, { send: true })).toEqual([
      "message", "compose",
      "--to", "alice@example.test",
      "--subject", "Hello",
      "--send",
    ]);
  });

  it("supports explicit inlineBody when requested", () => {
    expect(buildComposeArgs(base, { send: true, inlineBody: true })).toEqual([
      "message", "compose",
      "--to", "alice@example.test",
      "--subject", "Hello",
      "--body", "Hi there",
      "--send",
    ]);
  });

  it("adds cc, bcc, and a save mailbox in order", () => {
    const request = { ...base, cc: ["carl@example.test"], bcc: ["blake@example.test"] };
    expect(buildComposeArgs(request, { send: true, saveTo: "Sent" })).toEqual([
      "message", "compose",
      "--to", "alice@example.test",
      "--cc", "carl@example.test",
      "--bcc", "blake@example.test",
      "--subject", "Hello",
      "--save", "Sent",
      "--send",
    ]);
  });

  it("omits --send for a preview or a draft save", () => {
    expect(buildComposeArgs(base, { send: false })).toEqual([
      "message", "compose", "--to", "alice@example.test", "--subject", "Hello",
    ]);
  });

  it("targets reply with the source id and mailbox, omitting --to when empty", () => {
    const request = {
      ...base, mode: "reply" as const, to: [], cc: [], bcc: [],
      sourceRef: { account: "andre", mailbox: "INBOX", message: "42" },
    };
    expect(buildComposeArgs(request, { send: true })).toEqual([
      "message", "reply", "42", "--mailbox", "INBOX",
      "--subject", "Hello", "--send",
    ]);
  });

  it("targets forward with the source id and mailbox", () => {
    const request = {
      ...base, mode: "forward" as const,
      sourceRef: { account: "andre", mailbox: "INBOX", message: "42" },
    };
    expect(buildComposeArgs(request, { send: true })).toEqual([
      "message", "forward", "42", "--mailbox", "INBOX",
      "--to", "alice@example.test", "--subject", "Hello", "--send",
    ]);
  });
});
