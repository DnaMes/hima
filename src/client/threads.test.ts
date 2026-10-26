import { describe, expect, it } from "vitest";

import type { Envelope } from "../shared/types.js";
import { groupThreads, threadKey } from "./threads.js";

const envelope = (id: string, subject: string, account?: string, headers: { messageId?: string; inReplyTo?: string[] } = {}): Envelope => ({
  id, date: null, flags: [], from: [], to: [], subject, size: 1, hasAttachment: false,
  ...(account ? { source: { account, mailbox: "INBOX" } } : {}),
  ...headers,
});

describe("threadKey", () => {
  it("drops stacked reply and forward prefixes in several languages", () => {
    expect(threadKey("Re: AW:  WG: Fwd: Angebot  Projekt")).toBe("angebot projekt");
    expect(threadKey("RE[2]: Hallo")).toBe("hallo");
    expect(threadKey("Report: Q3")).toBe("report: q3");
  });
});

describe("groupThreads", () => {
  it("groups by subject in list order and keeps the first message as head", () => {
    const threads = groupThreads([envelope("1", "Re: Plan"), envelope("2", "Other"), envelope("3", "plan"), envelope("4", "AW: Plan")]);
    expect(threads.map((thread) => [thread.head.id, thread.rest.map((item) => item.id)])).toEqual([["1", ["3", "4"]], ["2", []]]);
  });

  it("never groups empty subjects and keeps scopes apart", () => {
    expect(groupThreads([envelope("1", ""), envelope("2", "Re:")])).toHaveLength(2);
    const scoped = groupThreads([envelope("1", "Plan", "a"), envelope("2", "Plan", "b")], (item) => item.source?.account ?? "");
    expect(scoped).toHaveLength(2);
  });
});

describe("groupThreads with Message-ID headers", () => {
  const ids = (threads: ReturnType<typeof groupThreads>) => threads.map((thread) => [thread.head.id, thread.rest.map((item) => item.id)]);

  it("links replies through In-Reply-To even when the subject changed and the parent is not on the page", () => {
    const list = [
      envelope("1", "Re: Offer", undefined, { messageId: "<c@x>", inReplyTo: ["<b@x>"] }),
      envelope("2", "Totally different subject", undefined, { messageId: "<d@x>", inReplyTo: ["<b@x>"] }),
      envelope("3", "Offer", undefined, { messageId: "<a@x>" }),
      envelope("4", "Offer", undefined, { messageId: "<z@x>" }),
    ];
    // 1 and 2 answer the same (missing) parent; 3 and 4 share a subject but have no relation, so they stay apart.
    expect(ids(groupThreads(list))).toEqual([["1", ["2"]], ["3", []], ["4", []]]);
  });

  it("follows a chain across the page and ignores angle brackets and case", () => {
    const list = [
      envelope("1", "Re: Re: x", undefined, { messageId: "<C@x>", inReplyTo: ["<b@X>"] }),
      envelope("2", "Re: x", undefined, { messageId: "b@x", inReplyTo: ["<A@x>"] }),
      envelope("3", "x", undefined, { messageId: "<a@x>" }),
    ];
    expect(ids(groupThreads(list))).toEqual([["1", ["2", "3"]]]);
  });

  it("keeps accounts apart and falls back to the subject only for mail without a Message-ID", () => {
    const apart = [
      envelope("1", "Plan", "a", { messageId: "<m@x>" }),
      envelope("2", "Re: Plan", "b", { messageId: "<n@x>", inReplyTo: ["<m@x>"] }),
    ];
    expect(groupThreads(apart, (item) => item.source?.account ?? "")).toHaveLength(2);
    const mixed = [envelope("1", "Plan", undefined, { messageId: "<m@x>" }), envelope("2", "Re: Plan"), envelope("3", "plan")];
    expect(ids(groupThreads(mixed))).toEqual([["1", []], ["2", ["3"]]]);
  });

  it("uses only the last In-Reply-To id, so a mass reply does not glue other threads together", () => {
    const list = [
      envelope("1", "Re: A", undefined, { messageId: "<r1@x>", inReplyTo: ["<other1@x>", "<other2@x>", "<parent@x>"] }),
      envelope("2", "B", undefined, { messageId: "<other1@x>" }),
      envelope("3", "C", undefined, { messageId: "<other2@x>" }),
      envelope("4", "A", undefined, { messageId: "<parent@x>" }),
    ];
    expect(ids(groupThreads(list))).toEqual([["1", ["4"]], ["2", []], ["3", []]]);
  });
});
