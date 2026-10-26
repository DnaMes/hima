import { describe, expect, it } from "vitest";

import {
  ACCOUNT_COLORS_KEY,
  ACCOUNT_HUE_COUNT,
  ACCOUNT_HUE_NAMES,
  emptyAccountColorState,
  readAccountColorState,
  resolveAccountColors,
  setManualAccountColor,
  writeAccountColorState,
} from "./account-colors.js";

const storageWith = (value: string | null) => ({ getItem: () => value });
const aliases = (count: number): string[] => Array.from({ length: count }, (_, index) => `account-${String(index).padStart(2, "0")}`);

describe("account colour storage", () => {
  it("returns an empty state for missing, malformed, or non-object storage", () => {
    expect(readAccountColorState(storageWith(null))).toEqual(emptyAccountColorState());
    expect(readAccountColorState(storageWith("{bad"))).toEqual(emptyAccountColorState());
    expect(readAccountColorState(storageWith("[1,2]"))).toEqual(emptyAccountColorState());
    expect(readAccountColorState({ getItem: () => { throw new Error("blocked"); } })).toEqual(emptyAccountColorState());
  });

  it("keeps only string aliases mapped to integer hue indexes", () => {
    const stored = '{"manual":{"alpha":2,"beta":8,"gamma":-1,"delta":1.5,"epsilon":"3","__proto__":4},"auto":{"zeta":7,"eta":null}}';

    expect(readAccountColorState(storageWith(stored))).toEqual({ manual: { alpha: 2 }, auto: { zeta: 7 } });
  });

  it("round-trips through storage and reports write failures", () => {
    const values = new Map<string, string>();
    const state = { manual: { alpha: 1 }, auto: { beta: 5 } };

    expect(writeAccountColorState({ setItem: (key, value) => { values.set(key, value); } }, state)).toBe(true);
    expect(readAccountColorState(storageWith(values.get(ACCOUNT_COLORS_KEY) ?? null))).toEqual(state);
    expect(writeAccountColorState({ setItem: () => { throw new Error("full"); } }, state)).toBe(false);
  });
});

describe("resolveAccountColors", () => {
  it("gives eight accounts eight distinct colours", () => {
    const { colors } = resolveAccountColors(aliases(8), emptyAccountColorState());
    expect(new Set(Object.values(colors)).size).toBe(ACCOUNT_HUE_COUNT);
  });

  it("balances usage when there are more accounts than hues", () => {
    const { colors } = resolveAccountColors(aliases(19), emptyAccountColorState());
    const usage = new Array<number>(ACCOUNT_HUE_COUNT).fill(0);
    for (const index of Object.values(colors)) usage[index] = (usage[index] ?? 0) + 1;

    expect(Math.max(...usage) - Math.min(...usage)).toBeLessThanOrEqual(1);
  });

  it("does not depend on the order of the alias list", () => {
    const forward = resolveAccountColors(["alpha", "beta", "gamma", "delta"], emptyAccountColorState());
    const reversed = resolveAccountColors(["delta", "gamma", "beta", "alpha"], emptyAccountColorState());

    expect(reversed.colors).toEqual(forward.colors);
  });

  it("keeps existing colours when accounts are added or removed", () => {
    const first = resolveAccountColors(["beta", "gamma", "delta"], emptyAccountColorState());
    const added = resolveAccountColors(["aardvark", "beta", "gamma", "delta"], first.state);
    const removed = resolveAccountColors(["beta", "delta"], added.state);

    for (const alias of ["beta", "gamma", "delta"]) expect(added.colors[alias]).toBe(first.colors[alias]);
    expect(removed.colors).toEqual({ beta: first.colors.beta, delta: first.colors.delta });
    expect(Object.keys(removed.state.auto).sort()).toEqual(["beta", "delta"]);
  });

  it("lets a manual colour win and prunes unknown aliases from both maps", () => {
    const state = { manual: { alpha: 6, ghost: 3 }, auto: { alpha: 1, beta: 2, ghost: 4 } };
    const resolved = resolveAccountColors(["alpha", "beta"], state);

    expect(resolved.colors).toEqual({ alpha: 6, beta: 2 });
    expect(resolved.state).toEqual({ manual: { alpha: 6 }, auto: { beta: 2 } });
  });
});

describe("setManualAccountColor", () => {
  it("sets, clears, and ignores invalid overrides without mutating the input", () => {
    const state = { manual: { alpha: 1 }, auto: { alpha: 4 } };

    expect(setManualAccountColor(state, "alpha", 5).manual).toEqual({ alpha: 5 });
    expect(setManualAccountColor(state, "alpha", null).manual).toEqual({});
    expect(setManualAccountColor(state, "alpha", 9)).toEqual(state);
    expect(setManualAccountColor(state, "alpha", 0.5)).toEqual(state);
    expect(state).toEqual({ manual: { alpha: 1 }, auto: { alpha: 4 } });
  });

  it("names exactly eight colours", () => {
    expect(ACCOUNT_HUE_NAMES).toHaveLength(ACCOUNT_HUE_COUNT);
  });
});
