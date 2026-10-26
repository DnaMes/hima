import { describe, expect, it, vi } from "vitest";

import { createWarmer } from "./warmer.js";

function setup() {
  let time = 1_000_000;
  const service = {
    listMailboxes: vi.fn(async (account: string) => [{ id: "INBOX", name: account === "odd" ? "Posteingang" : "INBOX", total: null, unread: null }]),
    listEnvelopes: vi.fn(async (_query: unknown) => []),
  };
  const warmer = createWarmer(service, { intervalMs: 40_000, idleMs: 300_000, now: () => time });
  return { service, warmer, advance: (ms: number) => { time += ms; } };
}

describe("warmer", () => {
  it("does nothing until the GUI was used and accounts are known", async () => {
    const { service, warmer } = setup();
    await warmer.warm();
    warmer.remember(["a"]);
    await warmer.warm();
    expect(service.listEnvelopes).not.toHaveBeenCalled();
  });

  it("requests page 1 of each remembered inbox exactly like the unified inbox does", async () => {
    const { service, warmer } = setup();
    warmer.touch();
    warmer.remember(["a", "a", "b"]);
    await warmer.warm();
    expect(service.listMailboxes.mock.calls).toEqual([["a", { counts: false }], ["b", { counts: false }]]);
    expect(service.listEnvelopes.mock.calls.map(([query]) => query)).toEqual([
      { account: "a", mailbox: "INBOX", page: 1, pageSize: 100 },
      { account: "b", mailbox: "INBOX", page: 1, pageSize: 100 },
    ]);
  });

  it("stops after the idle time and survives a failing account", async () => {
    const { service, warmer, advance } = setup();
    service.listMailboxes.mockRejectedValueOnce(new Error("down"));
    warmer.touch();
    warmer.remember(["bad", "good"]);
    await warmer.warm();
    expect(service.listEnvelopes).toHaveBeenCalledTimes(1);
    advance(400_000);
    await warmer.warm();
    expect(service.listEnvelopes).toHaveBeenCalledTimes(1);
  });
});
