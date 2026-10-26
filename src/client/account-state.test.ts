import { describe, expect, it } from "vitest";

import type { Account } from "../shared/types.js";
import {
  ACCOUNT_STATE_KEY,
  chooseInitialAccount,
  filterSelectableAccounts,
  filterUnifiedAccounts,
  preferenceForAccount,
  readAccountPreferences,
  updateAccountPreference,
  writeAccountPreferences,
} from "./account-state.js";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const accounts: Account[] = [
  { name: "default", default: true, backends: ["imap"], email: "default@example.test" },
  { name: "hidden", default: false, backends: ["imap"], email: "hidden@example.test" },
  { name: "disabled", default: false, backends: ["imap"], email: "disabled@example.test" },
  { name: "available", default: false, backends: ["imap"], email: "available@example.test" },
];

describe("account state", () => {
  it("defaults unknown accounts to active and visible", () => {
    expect(preferenceForAccount({}, "new-account")).toEqual({ active: true, visible: true, inUnified: true });
  });

  it("round-trips only the versioned local account state", () => {
    const storage = new MemoryStorage();
    const preferences = updateAccountPreference({}, "hidden", { visible: false });

    writeAccountPreferences(storage, preferences);

    expect(storage.getItem(ACCOUNT_STATE_KEY)).toBe(JSON.stringify({ hidden: { active: true, visible: false, inUnified: true } }));
    expect(readAccountPreferences(storage)).toEqual(preferences);
  });

  it("ignores malformed browser state without exposing or accepting arbitrary values", () => {
    const storage = new MemoryStorage();
    storage.setItem(ACCOUNT_STATE_KEY, JSON.stringify({ hidden: { visible: false }, broken: "secret-like-value" }));

    expect(readAccountPreferences(storage)).toEqual({ hidden: { active: true, visible: false, inUnified: true } });
  });

  it("filters disabled and hidden accounts from normal selection", () => {
    const preferences = updateAccountPreference(
      updateAccountPreference({}, "hidden", { visible: false }),
      "disabled",
      { active: false },
    );

    expect(filterSelectableAccounts(accounts, preferences).map((account) => account.name)).toEqual(["default", "available"]);
    expect(chooseInitialAccount(accounts, "disabled", preferences)).toBe("default");
    expect(chooseInitialAccount(accounts, "available", preferences)).toBe("available");
  });

  it("returns no selection when every account is unavailable", () => {
    const preferences = accounts.reduce(
      (current, account) => updateAccountPreference(current, account.name, { active: false }),
      {},
    );

    expect(chooseInitialAccount(accounts, "default", preferences)).toBeNull();
  });

  it("treats state saved before the unified switch existed as included", () => {
    const storage = new MemoryStorage();
    storage.setItem(ACCOUNT_STATE_KEY, JSON.stringify({ old: { active: true, visible: true } }));

    expect(readAccountPreferences(storage).old?.inUnified).toBe(true);
  });

  it("rejects a non-boolean inUnified value instead of coercing it", () => {
    const storage = new MemoryStorage();
    storage.setItem(ACCOUNT_STATE_KEY, JSON.stringify({ odd: { active: true, visible: true, inUnified: "false" } }));

    expect(readAccountPreferences(storage).odd?.inUnified).toBe(true);
  });

  it("keeps an account selectable but out of the unified inbox when only inUnified is off", () => {
    const preferences = updateAccountPreference({}, "available", { inUnified: false });

    expect(filterSelectableAccounts(accounts, preferences).map((account) => account.name)).toContain("available");
    expect(filterUnifiedAccounts(accounts, preferences).map((account) => account.name)).toEqual(["default", "hidden", "disabled"]);
  });

  it("never feeds disabled or hidden accounts into the unified inbox, whatever inUnified says", () => {
    const preferences = updateAccountPreference(
      updateAccountPreference({}, "hidden", { visible: false }),
      "disabled",
      { active: false },
    );

    expect(filterUnifiedAccounts(accounts, preferences).map((account) => account.name)).toEqual(["default", "available"]);
  });
});
