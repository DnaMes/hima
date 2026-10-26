import { describe, expect, it } from "vitest";

import type { Account } from "../shared/types.js";
import {
  ACCOUNT_ORDER_KEY,
  moveAccount,
  normalizeAccountOrder,
  orderedAccounts,
  readAccountOrder,
  writeAccountOrder,
} from "./account-order.js";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  private readonly values = new Map<string, string>();

  constructor(entries: readonly [string, string][] = []) {
    for (const [key, value] of entries) this.values.set(key, value);
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function account(name: string): Account {
  return {
    name,
    default: name === "andre",
    backends: ["imap"],
    email: `${name}@example.test`,
  };
}

describe("account order", () => {
  it("ignores malformed order storage", () => {
    const storage = { getItem: () => "{bad" };

    expect(readAccountOrder(storage)).toEqual([]);
  });

  it("accepts only a string array and deduplicates aliases in first-seen order", () => {
    const storage = new MemoryStorage([
      [ACCOUNT_ORDER_KEY, JSON.stringify(["cloudflare", "andre", "cloudflare"])],
    ]);

    expect(readAccountOrder(storage)).toEqual(["cloudflare", "andre"]);
    expect(readAccountOrder(new MemoryStorage([[ACCOUNT_ORDER_KEY, JSON.stringify(["andre", 7])]]))).toEqual([]);
  });

  it("round-trips the order and tolerates unavailable browser storage", () => {
    const storage = new MemoryStorage();

    writeAccountOrder(storage, ["anna", "andre"]);

    expect(storage.getItem(ACCOUNT_ORDER_KEY)).toBe(JSON.stringify(["anna", "andre"]));
    expect(readAccountOrder(storage)).toEqual(["anna", "andre"]);
    expect(readAccountOrder({ getItem: () => { throw new Error("unavailable"); } })).toEqual([]);
    expect(() => writeAccountOrder({ setItem: () => { throw new Error("full"); } }, ["anna"])).not.toThrow();
  });

  it("deduplicates known aliases and appends new provider accounts", () => {
    const accounts = [account("anna"), account("andre"), account("cloudflare")];

    expect(normalizeAccountOrder(accounts, ["cloudflare", "andre", "andre", "removed"]))
      .toEqual(["cloudflare", "andre", "anna"]);
  });

  it("orders accounts without mutating the provider list", () => {
    const accounts = [account("anna"), account("andre"), account("cloudflare")];

    expect(orderedAccounts(accounts, ["cloudflare", "anna", "andre"]).map(({ name }) => name))
      .toEqual(["cloudflare", "anna", "andre"]);
    expect(accounts.map(({ name }) => name)).toEqual(["anna", "andre", "cloudflare"]);
  });

  it("moves only within bounds", () => {
    const order = ["andre", "anna", "cloudflare"];

    expect(moveAccount(order, "andre", "up")).toEqual(order);
    expect(moveAccount(order, "anna", "down")).toEqual(["andre", "cloudflare", "anna"]);
    expect(moveAccount(order, "missing", "down")).toEqual(order);
    expect(moveAccount(order, "cloudflare", "down")).toEqual(order);
    expect(order).toEqual(["andre", "anna", "cloudflare"]);
  });
});
