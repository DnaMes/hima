import { describe, expect, it } from "vitest";

import {
  beginSessionRecovery,
  clearSessionRecovery,
  SESSION_RECOVERY_KEY,
} from "./session-recovery.js";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("session recovery", () => {
  it("allows only one reload attempt for one expired session", () => {
    const storage = new MemoryStorage();

    expect(beginSessionRecovery(storage)).toBe(true);
    expect(storage.getItem(SESSION_RECOVERY_KEY)).toBe("1");
    expect(beginSessionRecovery(storage)).toBe(false);
  });

  it("clears the reload marker after a successful request", () => {
    const storage = new MemoryStorage();

    beginSessionRecovery(storage);
    clearSessionRecovery(storage);

    expect(storage.getItem(SESSION_RECOVERY_KEY)).toBeNull();
    expect(beginSessionRecovery(storage)).toBe(true);
  });
});
