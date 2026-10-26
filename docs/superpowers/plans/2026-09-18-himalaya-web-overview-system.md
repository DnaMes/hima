# Himalaya Web Overview System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every account a stable colour, tint the three main areas, group the message list by date, show status badges, and offer two list densities, without any backend change.

**Architecture:** Small pure modules (`account-colors`, `message-groups`, `list-density`, `hue-style`) hold the logic and are unit-tested. A new `message-list.tsx` component renders grouped rows and badges and is extracted from `main.tsx`. Themes gain area and title tokens plus eight account hues, applied as CSS custom properties, verified by a contrast test over all six themes.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), React 19, Vite, Vitest (node environment, `src/**/*.test.ts` only), Playwright (Chromium, synthetic API fixtures).

**Spec:** `docs/superpowers/specs/2026-09-18-himalaya-web-overview-system-design.md`

## Global Constraints

- Frontend-only: no API route, backend contract, session rule, or provider call changes.
- Browser storage holds aliases and UI choices only, never credentials, message content, or AI data. Every storage read and write is wrapped so the UI renders when storage is empty, blocked, or throwing.
- User-facing text is German; code, tests, and docs are English. Comments are sparse and explain why, not what.
- Existing behaviour stays intact: account tree, lazy folders, unified inbox, favorites, local ordering, account manager, export, AI actions, six themes. The existing 146 unit tests and 42 browser tests must keep passing.
- Colour is never the only carrier of meaning: every badge has an icon plus text or accessible text.
- Contrast for every theme (WCAG relative luminance): body and muted text against each `area*` background at least 4.5:1; each `title*` against its own `area*` at least 4.5:1; each account hue against each `area*` as dot or line at least 3:1; each hue as chip text on its own 14% tint over each `area*` at least 4.5:1.
- Storage keys: `himalaya-web-account-colors-v1`, `himalaya-web-list-density-v1`. Account hue count is exactly 8.
- Do not commit unless the user has explicitly authorized commits for this run (see `AGENTS.md`). Task 10 asks once; until then leave the tree uncommitted and stage nothing.
- Do not send, delete, move, or tag real mail. Tests use synthetic data only.

## File Structure

| File | Responsibility |
|---|---|
| `src/client/list-density.ts` (+ test) | Density type, default, storage read/write |
| `src/client/message-groups.ts` (+ test) | Date group classification, header insertion, row time text |
| `src/client/account-colors.ts` (+ test) | Manual/auto colour state, deterministic assignment, storage |
| `src/client/hue-style.ts` | One helper mapping a hue index to the `--c` custom property |
| `src/client/themes.ts` (+ tests) | New area/title tokens, `accountHues`, latte muted fix, `applyTheme` |
| `src/client/theme-contrast.test.ts` | Contrast rules for all six themes |
| `src/client/message-list.tsx` (+ `message-list.test.ts`) | Badges, grouped rows, `isSeen`, sender label |
| `src/client/main.tsx` | Wiring only: colour state, density state, manager control, list swap |
| `src/client/styles.css`, `layout-contract.test.ts` | Row, badge, swatch, area styles and their contract tests |
| `tests/e2e/overview.spec.ts` | Synthetic browser coverage |
| `README.md`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `src/shared/app-meta.test.ts`, `HANDOFF.md`, `AGENTS.md` | Release `0.4.0` |

---

### Task 1: List density module

**Files:**
- Create: `src/client/list-density.ts`
- Test: `src/client/list-density.test.ts`

**Interfaces:**
- Produces:
  - `type ListDensity = "compact" | "comfortable"`
  - `const LIST_DENSITY_KEY = "himalaya-web-list-density-v1"`
  - `resolveListDensity(value: unknown): ListDensity`
  - `readListDensity(storage: Pick<Storage, "getItem">): ListDensity`
  - `writeListDensity(storage: Pick<Storage, "setItem">, density: ListDensity): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/client/list-density.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { LIST_DENSITY_KEY, readListDensity, resolveListDensity, writeListDensity } from "./list-density.js";

describe("list density", () => {
  it("defaults to compact for missing, unknown, and non-string values", () => {
    expect(resolveListDensity(null)).toBe("compact");
    expect(resolveListDensity("dense")).toBe("compact");
    expect(resolveListDensity(42)).toBe("compact");
    expect(resolveListDensity("comfortable")).toBe("comfortable");
  });

  it("reads the stored value and survives a throwing storage", () => {
    expect(readListDensity({ getItem: (key) => (key === LIST_DENSITY_KEY ? "comfortable" : null) })).toBe("comfortable");
    expect(readListDensity({ getItem: () => { throw new Error("blocked"); } })).toBe("compact");
  });

  it("writes valid values and reports storage failures", () => {
    const values = new Map<string, string>();
    expect(writeListDensity({ setItem: (key, value) => { values.set(key, value); } }, "comfortable")).toBe(true);
    expect(values.get(LIST_DENSITY_KEY)).toBe("comfortable");
    expect(writeListDensity({ setItem: () => { throw new Error("full"); } }, "compact")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/client/list-density.test.ts`
Expected: FAIL, `Cannot find module './list-density.js'` (or equivalent resolve error).

- [ ] **Step 3: Write the implementation**

Create `src/client/list-density.ts`:

```ts
export type ListDensity = "compact" | "comfortable";

export const LIST_DENSITY_KEY = "himalaya-web-list-density-v1";

export function resolveListDensity(value: unknown): ListDensity {
  return value === "comfortable" ? "comfortable" : "compact";
}

export function readListDensity(storage: Pick<Storage, "getItem">): ListDensity {
  try {
    return resolveListDensity(storage.getItem(LIST_DENSITY_KEY));
  } catch {
    return "compact";
  }
}

export function writeListDensity(storage: Pick<Storage, "setItem">, density: ListDensity): boolean {
  try {
    storage.setItem(LIST_DENSITY_KEY, resolveListDensity(density));
    return true;
  } catch {
    // Browser storage can be unavailable or full; the in-memory choice still applies.
    return false;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/client/list-density.test.ts && npm run typecheck`
Expected: 3 tests PASS, typecheck exits 0.

---

### Task 2: Date groups and row time

**Files:**
- Create: `src/client/message-groups.ts`
- Test: `src/client/message-groups.test.ts`

**Interfaces:**
- Produces:
  - `type GroupKey = "today" | "yesterday" | "this-week" | "last-week" | "older" | "none"`
  - `const GROUP_LABELS: Record<GroupKey, string>` (German)
  - `groupKey(value: string | null, now: Date): GroupKey`
  - `type GroupedRow<T> = { item: T; header: string | null }`
  - `withGroupHeaders<T extends { date: string | null }>(items: readonly T[], now: Date): GroupedRow<T>[]`
  - `formatRowTime(value: string | null, now: Date): string`

- [ ] **Step 1: Write the failing test**

Create `src/client/message-groups.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { formatRowTime, GROUP_LABELS, groupKey, withGroupHeaders } from "./message-groups.js";

const local = (year: number, month: number, day: number, hour = 12): Date => new Date(year, month - 1, day, hour, 0, 0);
const iso = (date: Date): string => date.toISOString();
const NOW = local(2026, 9, 18, 15);

describe("groupKey", () => {
  it("classifies by local calendar-day difference", () => {
    expect(groupKey(iso(local(2026, 9, 18, 0)), NOW)).toBe("today");
    expect(groupKey(iso(local(2026, 9, 17, 23)), NOW)).toBe("yesterday");
    expect(groupKey(iso(local(2026, 9, 16)), NOW)).toBe("this-week");
    expect(groupKey(iso(local(2026, 9, 12)), NOW)).toBe("this-week");
    expect(groupKey(iso(local(2026, 9, 11)), NOW)).toBe("last-week");
    expect(groupKey(iso(local(2026, 9, 5)), NOW)).toBe("last-week");
    expect(groupKey(iso(local(2026, 9, 4)), NOW)).toBe("older");
  });

  it("treats future dates as today and missing or invalid dates as none", () => {
    expect(groupKey(iso(local(2026, 9, 25)), NOW)).toBe("today");
    expect(groupKey(null, NOW)).toBe("none");
    expect(groupKey("not a date", NOW)).toBe("none");
  });

  it("counts calendar days across a daylight-saving change", () => {
    const now = local(2026, 3, 30, 10);
    expect(groupKey(iso(local(2026, 3, 29, 23)), now)).toBe("yesterday");
    expect(groupKey(iso(local(2026, 3, 28, 12)), now)).toBe("this-week");
  });
});

describe("withGroupHeaders", () => {
  it("adds a header only when the group changes and keeps the original order", () => {
    const rows = withGroupHeaders([
      { id: "a", date: iso(local(2026, 9, 18, 9)) },
      { id: "b", date: iso(local(2026, 9, 18, 8)) },
      { id: "c", date: iso(local(2026, 9, 17, 8)) },
      { id: "d", date: null },
    ], NOW);

    expect(rows.map((row) => row.item.id)).toEqual(["a", "b", "c", "d"]);
    expect(rows.map((row) => row.header)).toEqual([GROUP_LABELS.today, null, GROUP_LABELS.yesterday, GROUP_LABELS.none]);
  });

  it("repeats a header when an unsorted list returns to an earlier group", () => {
    const rows = withGroupHeaders([
      { id: "a", date: iso(local(2026, 9, 18)) },
      { id: "b", date: iso(local(2026, 9, 17)) },
      { id: "c", date: iso(local(2026, 9, 18)) },
    ], NOW);

    expect(rows.map((row) => row.header)).toEqual(["Heute", "Gestern", "Heute"]);
  });

  it("returns an empty list for no messages", () => {
    expect(withGroupHeaders([], NOW)).toEqual([]);
  });
});

describe("formatRowTime", () => {
  it("shows the clock time for today and a short date otherwise", () => {
    expect(formatRowTime(iso(local(2026, 9, 18, 9)), NOW)).toMatch(/^\d{2}:\d{2}$/);
    expect(formatRowTime(iso(local(2026, 9, 17, 9)), NOW)).toMatch(/^\d{2}\.\d{2}\.\d{2}$/);
  });

  it("returns an empty string for missing or invalid dates", () => {
    expect(formatRowTime(null, NOW)).toBe("");
    expect(formatRowTime("nope", NOW)).toBe("");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/client/message-groups.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

Create `src/client/message-groups.ts`:

```ts
export type GroupKey = "today" | "yesterday" | "this-week" | "last-week" | "older" | "none";

export const GROUP_LABELS: Record<GroupKey, string> = {
  today: "Heute",
  yesterday: "Gestern",
  "this-week": "Diese Woche",
  "last-week": "Letzte Woche",
  older: "Älter",
  none: "Ohne Datum",
};

// Whole local calendar days, so a 23- or 25-hour day never shifts a message by one group.
function dayNumber(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

export function groupKey(value: string | null, now: Date): GroupKey {
  if (!value) return "none";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "none";

  const difference = dayNumber(now) - dayNumber(date);
  if (difference <= 0) return "today";
  if (difference === 1) return "yesterday";
  if (difference <= 6) return "this-week";
  if (difference <= 13) return "last-week";
  return "older";
}

export type GroupedRow<T> = { item: T; header: string | null };

export function withGroupHeaders<T extends { date: string | null }>(
  items: readonly T[],
  now: Date,
): GroupedRow<T>[] {
  let previous: GroupKey | null = null;
  return items.map((item) => {
    const key = groupKey(item.date, now);
    const header = key === previous ? null : GROUP_LABELS[key];
    previous = key;
    return { item, header };
  });
}

const CLOCK = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const SHORT_DATE = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });

export function formatRowTime(value: string | null, now: Date): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return dayNumber(now) - dayNumber(date) <= 0 ? CLOCK.format(date) : SHORT_DATE.format(date);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/client/message-groups.test.ts && npm run typecheck`
Expected: all tests PASS, typecheck exits 0.

---

### Task 3: Account colour state

**Files:**
- Create: `src/client/account-colors.ts`
- Test: `src/client/account-colors.test.ts`

**Interfaces:**
- Produces:
  - `const ACCOUNT_COLORS_KEY = "himalaya-web-account-colors-v1"`, `const ACCOUNT_HUE_COUNT = 8`
  - `const ACCOUNT_HUE_NAMES: readonly ["Violett", "Türkis", "Bernstein", "Rosé", "Himmelblau", "Orange", "Limette", "Magenta"]`
  - `type AccountColors = Record<string, number>`; `type AccountColorState = { manual: AccountColors; auto: AccountColors }`
  - `emptyAccountColorState(): AccountColorState`
  - `readAccountColorState(storage: Pick<Storage, "getItem">): AccountColorState`
  - `writeAccountColorState(storage: Pick<Storage, "setItem">, state: AccountColorState): boolean`
  - `resolveAccountColors(aliases: readonly string[], state: AccountColorState): { colors: AccountColors; state: AccountColorState }`
  - `setManualAccountColor(state: AccountColorState, alias: string, index: number | null): AccountColorState`

- [ ] **Step 1: Write the failing test**

Create `src/client/account-colors.test.ts`:

```ts
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
    const stored = JSON.stringify({
      manual: { alpha: 2, beta: 8, gamma: -1, delta: 1.5, epsilon: "3", __proto__: 4 },
      auto: { zeta: 7, eta: null },
    });

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/client/account-colors.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

Create `src/client/account-colors.ts`:

```ts
export const ACCOUNT_COLORS_KEY = "himalaya-web-account-colors-v1";
export const ACCOUNT_HUE_COUNT = 8;
export const ACCOUNT_HUE_NAMES = ["Violett", "Türkis", "Bernstein", "Rosé", "Himmelblau", "Orange", "Limette", "Magenta"] as const;

export type AccountColors = Record<string, number>;
export type AccountColorState = { manual: AccountColors; auto: AccountColors };

export function emptyAccountColorState(): AccountColorState {
  return { manual: {}, auto: {} };
}

function isHueIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < ACCOUNT_HUE_COUNT;
}

function validColors(value: unknown): AccountColors {
  const colors: AccountColors = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return colors;
  for (const [alias, index] of Object.entries(value)) {
    if (alias !== "__proto__" && isHueIndex(index)) colors[alias] = index;
  }
  return colors;
}

export function readAccountColorState(storage: Pick<Storage, "getItem">): AccountColorState {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(ACCOUNT_COLORS_KEY) ?? "null");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return emptyAccountColorState();
    const record = parsed as Record<string, unknown>;
    return { manual: validColors(record.manual), auto: validColors(record.auto) };
  } catch {
    return emptyAccountColorState();
  }
}

export function writeAccountColorState(storage: Pick<Storage, "setItem">, state: AccountColorState): boolean {
  try {
    storage.setItem(ACCOUNT_COLORS_KEY, JSON.stringify(state));
    return true;
  } catch {
    // Browser storage can be unavailable or full; the resolved colours still apply in memory.
    return false;
  }
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function pickLeastUsed(alias: string, usage: readonly number[]): number {
  const least = Math.min(...usage);
  const preferred = fnv1a(alias) % ACCOUNT_HUE_COUNT;
  return usage[preferred] === least ? preferred : usage.findIndex((count) => count === least);
}

export function resolveAccountColors(
  aliases: readonly string[],
  state: AccountColorState,
): { colors: AccountColors; state: AccountColorState } {
  // Sorted, so the outcome never depends on the user's display order.
  const known = [...new Set(aliases)].sort();
  const manual: AccountColors = {};
  const auto: AccountColors = {};
  const usage = new Array<number>(ACCOUNT_HUE_COUNT).fill(0);
  const use = (index: number): void => { usage[index] = (usage[index] ?? 0) + 1; };

  for (const alias of known) {
    const chosen = state.manual[alias];
    if (isHueIndex(chosen)) {
      manual[alias] = chosen;
      use(chosen);
      continue;
    }
    const kept = state.auto[alias];
    if (isHueIndex(kept)) {
      auto[alias] = kept;
      use(kept);
    }
  }

  for (const alias of known) {
    if (manual[alias] !== undefined || auto[alias] !== undefined) continue;
    const index = pickLeastUsed(alias, usage);
    auto[alias] = index;
    use(index);
  }

  const colors: AccountColors = {};
  for (const alias of known) colors[alias] = manual[alias] ?? auto[alias] ?? 0;
  return { colors, state: { manual, auto } };
}

export function setManualAccountColor(
  state: AccountColorState,
  alias: string,
  index: number | null,
): AccountColorState {
  if (index === null) {
    const { [alias]: _removed, ...manual } = state.manual;
    return { manual, auto: { ...state.auto } };
  }
  if (!isHueIndex(index)) return { manual: { ...state.manual }, auto: { ...state.auto } };
  return { manual: { ...state.manual, [alias]: index }, auto: { ...state.auto } };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/client/account-colors.test.ts && npm run typecheck`
Expected: all tests PASS, typecheck exits 0. If the balance test fails, the bug is in `pickLeastUsed` (it must return an index whose usage equals the minimum); do not loosen the test.

---

### Task 4: Theme tokens, hues, and contrast test

**Files:**
- Modify: `src/client/themes.ts` (`SEMANTIC_THEME_KEYS`, `ThemeDefinition`, all six `THEMES` entries, `applyTheme`)
- Modify: `src/client/themes.test.ts` (one new test)
- Create: `src/client/theme-contrast.test.ts`

**Interfaces:**
- Produces:
  - `SEMANTIC_THEME_KEYS` additionally contains, in this order after `"focus"`: `"areaAccounts"`, `"areaList"`, `"areaReader"`, `"titleAccounts"`, `"titleList"`, `"titleReader"` (CSS variables `--area-accounts`, `--area-list`, `--area-reader`, `--title-accounts`, `--title-list`, `--title-reader`).
  - `type AccountHues = readonly [string, string, string, string, string, string, string, string]`; every `ThemeDefinition` has `accountHues: AccountHues` (CSS variables `--account-hue-0` to `--account-hue-7`).

- [ ] **Step 1: Write the failing tests**

Create `src/client/theme-contrast.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { THEMES } from "./themes.js";

const channels = (hex: string): number[] => [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));

function luminance(hex: string): number {
  const [red, green, blue] = channels(hex).map((value) => {
    const raw = value / 255;
    return raw <= 0.03928 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: string, second: string): number {
  const left = luminance(first);
  const right = luminance(second);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

function blend(foreground: string, background: string, alpha: number): string {
  const mixed = channels(background).map((value, index) => Math.round(value * (1 - alpha) + (channels(foreground)[index] ?? 0) * alpha));
  return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

describe.each(Object.entries(THEMES))("theme contrast: %s", (_name, theme) => {
  const areas = {
    areaAccounts: theme.colors.areaAccounts,
    areaList: theme.colors.areaList,
    areaReader: theme.colors.areaReader,
  };

  it("keeps the three area backgrounds distinct", () => {
    expect(new Set(Object.values(areas)).size).toBe(3);
  });

  it("keeps body and muted text readable on every area", () => {
    for (const background of Object.values(areas)) {
      expect(contrast(theme.colors.text, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.colors.mutedText, background)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(theme.colors.mutedText, theme.colors.field)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps each area title readable on its own area", () => {
    expect(contrast(theme.colors.titleAccounts, theme.colors.areaAccounts)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.colors.titleList, theme.colors.areaList)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.colors.titleReader, theme.colors.areaReader)).toBeGreaterThanOrEqual(4.5);
  });

  it("provides eight distinct account hues that work as dots, lines, and chip text", () => {
    expect(theme.accountHues).toHaveLength(8);
    expect(new Set(theme.accountHues).size).toBe(8);
    for (const hue of theme.accountHues) {
      expect(hue).toMatch(/^#[0-9a-f]{6}$/i);
      for (const background of Object.values(areas)) {
        expect(contrast(hue, background)).toBeGreaterThanOrEqual(3);
        expect(contrast(hue, blend(hue, background, 0.14))).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
```

Add this test at the end of the `describe("themes", ...)` block in `src/client/themes.test.ts`, before its closing `});`:

```ts
  it("applies the area tokens and the eight account hues", () => {
    const properties = new Map<string, string>();
    const root = {
      dataset: {} as DOMStringMap,
      style: { setProperty: (name: string, value: string) => properties.set(name, value) },
    } as unknown as HTMLElement;

    applyTheme(root, "midnight");

    expect(properties.get("--area-accounts")).toBe(THEMES.midnight.colors.areaAccounts);
    expect(properties.get("--title-reader")).toBe(THEMES.midnight.colors.titleReader);
    for (let index = 0; index < 8; index += 1) {
      expect(properties.get(`--account-hue-${index}`)).toBe(THEMES.midnight.accountHues[index]);
    }
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/client/theme-contrast.test.ts src/client/themes.test.ts`
Expected: FAIL (`accountHues` and the area keys do not exist; TypeScript-level property errors surface as runtime `undefined`).

- [ ] **Step 3: Implement the token and application changes**

In `src/client/themes.ts`:

1. Append the six keys to `SEMANTIC_THEME_KEYS` after `"focus",` (keep `] as const;`):

```ts
  "areaAccounts",
  "areaList",
  "areaReader",
  "titleAccounts",
  "titleList",
  "titleReader",
```

2. Replace the `ThemeDefinition` type and add `AccountHues` above it:

```ts
export type AccountHues = readonly [string, string, string, string, string, string, string, string];

export type ThemeDefinition = {
  label: string;
  colors: Record<ThemeColorKey, string>;
  accountHues: AccountHues;
};
```

3. Replace `applyTheme` with:

```ts
export function applyTheme(root: HTMLElement, theme: ThemeName): void {
  root.dataset.theme = theme;
  for (const key of SEMANTIC_THEME_KEYS) root.style.setProperty(cssVariableName(key), THEMES[theme].colors[key]);
  THEMES[theme].accountHues.forEach((hue, index) => root.style.setProperty(`--account-hue-${index}`, hue));
}
```

4. In each theme entry inside `THEMES`, add the six colour keys after `focus: ...,` (same order as the keys above) and add an `accountHues` array after the `colors` object. Use exactly these values (they were generated and checked against every rule in the contrast test):

| Theme | areaAccounts | areaList | areaReader | titleAccounts | titleList | titleReader | accountHues |
|---|---|---|---|---|---|---|---|
| `midnight` | `#1c1725` | `#211b2b` | `#261f31` | `#9d7cff` | `#90c4ea` | `#66d1ad` | `#ab90ea`, `#90eacc`, `#eacc90`, `#ea90ae`, `#90c4ea`, `#eab190`, `#c4ea90`, `#ea90ea` |
| `vscode-dark` | `#222222` | `#252526` | `#2b2b2c` | `#569cd6` | `#90c4ea` | `#89d185` | `#b49cec`, `#90eacc`, `#eacc90`, `#ea90ae`, `#90c4ea`, `#eab190`, `#c4ea90`, `#ea90ea` |
| `catppuccin-mocha` | `#1b1b2a` | `#181825` | `#252535` | `#cba6f7` | `#90c4ea` | `#a6e3a1` | `#b096eb`, `#90eacc`, `#eacc90`, `#ea90ae`, `#90c4ea`, `#eab190`, `#c4ea90`, `#ea90ea` |
| `catppuccin-latte` | `#ebedf2` | `#e6e9ef` | `#e1e5ec` | `#8839ef` | `#205d88` | `#2c6f1e` | `#5129ae`, `#17634a`, `#70531a`, `#a1264f`, `#205d88`, `#884620`, `#446317`, `#952395` |
| `nord` | `#353b49` | `#3b4252` | `#3f4758` | `#88c0d0` | `#b6d9f1` | `#a3be8c` | `#dbd0f6`, `#90eacc`, `#ebcf96`, `#f4c3d3`, `#b6d9f1`, `#f1ccb6`, `#c4ea90`, `#f4c3f4` |
| `tokyo-night` | `#181922` | `#1a1b26` | `#1f2231` | `#7aa2f7` | `#90c4ea` | `#9ece6a` | `#ab90ea`, `#90eacc`, `#eacc90`, `#ea90ae`, `#90c4ea`, `#eab190`, `#c4ea90`, `#ea90ea` |

Example for `midnight` (apply the same shape to the others):

```ts
      focus: "#c8b8ff",
      areaAccounts: "#1c1725",
      areaList: "#211b2b",
      areaReader: "#261f31",
      titleAccounts: "#9d7cff",
      titleList: "#90c4ea",
      titleReader: "#66d1ad",
    },
    accountHues: ["#ab90ea", "#90eacc", "#eacc90", "#ea90ae", "#90c4ea", "#eab190", "#c4ea90", "#ea90ea"],
  },
```

Also change the `catppuccin-latte` entry's `mutedText` from `"#6c6f85"` to `"#5c5f77"`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/client/theme-contrast.test.ts src/client/themes.test.ts && npm run typecheck`
Expected: PASS for all six themes, typecheck exits 0. If a contrast assertion fails, replace that single value in the table (never relax the test).

- [ ] **Step 5: Run the whole unit suite**

Run: `npm test`
Expected: all test files PASS (the existing 146 tests plus the new ones).

---

### Task 5: Message list component and badges

**Files:**
- Create: `src/client/hue-style.ts`
- Create: `src/client/message-list.tsx`
- Test: `src/client/message-list.test.ts`

**Interfaces:**
- Consumes: `ListDensity` (Task 1), `withGroupHeaders`, `formatRowTime` (Task 2).
- Produces:
  - `hueStyle(index: number): CSSProperties` (sets `--c` to `var(--account-hue-<index>)`)
  - `isSeen(envelope: Envelope): boolean`, `labelForEnvelope(envelope: Envelope): string`
  - `type EnvelopeBadge = { kind: "new" | "attachment" | "flagged" | "answered"; label: string; icon: string }`
  - `envelopeBadges(envelope: Envelope): EnvelopeBadge[]`
  - `MessageList(props: MessageListProps): JSX.Element` with
    `MessageListProps = { envelopes: readonly Envelope[]; now: Date; density: ListDensity; unified: boolean; currentAccount: string | null; colorIndexFor: (account: string) => number; isSelected: (envelope: Envelope) => boolean; onOpen: (envelope: Envelope) => void; rowKey: (envelope: Envelope) => string }`

- [ ] **Step 1: Write the failing test**

Create `src/client/message-list.test.ts`:

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Envelope } from "../shared/types.js";
import { hueStyle } from "./hue-style.js";
import { envelopeBadges, isSeen, MessageList } from "./message-list.js";
import type { MessageListProps } from "./message-list.js";

const NOW = new Date(2026, 8, 18, 15, 0, 0);
const at = (day: number, hour = 9): string => new Date(2026, 8, day, hour, 0, 0).toISOString();

function envelope(id: string, overrides: Partial<Envelope> = {}): Envelope {
  return {
    id,
    date: at(18),
    flags: [],
    from: [{ email: "alice@example.test", name: "Alice" }],
    to: [{ email: "bob@example.test", name: null }],
    subject: `Subject ${id}`,
    size: 2048,
    hasAttachment: false,
    ...overrides,
  };
}

const props = (overrides: Partial<MessageListProps> = {}): MessageListProps => ({
  envelopes: [],
  now: NOW,
  density: "compact",
  unified: false,
  currentAccount: "alpha",
  colorIndexFor: (account) => (account === "beta" ? 4 : 2),
  isSelected: () => false,
  onOpen: () => undefined,
  rowKey: (item) => item.id,
  ...overrides,
});

const render = (overrides: Partial<MessageListProps> = {}): string => (
  renderToStaticMarkup(createElement(MessageList, props(overrides)))
);

describe("envelope badges", () => {
  it("derives badges from real flags and attachments only", () => {
    expect(envelopeBadges(envelope("1")).map((badge) => badge.kind)).toEqual(["new"]);
    expect(envelopeBadges(envelope("2", { flags: [{ iana: "seen", raw: "\\Seen" }] }))).toEqual([]);
    expect(envelopeBadges(envelope("3", { hasAttachment: true, flags: [{ iana: null, raw: "\\Seen" }, { iana: "flagged", raw: "\\Flagged" }, { iana: null, raw: "\\Answered" }] })).map((badge) => badge.kind))
      .toEqual(["attachment", "flagged", "answered"]);
    expect(envelopeBadges(envelope("4", { flags: [{ iana: null, raw: "\\Draft" }, { iana: null, raw: "\\Deleted" }, { iana: "seen", raw: "seen" }] }))).toEqual([]);
  });

  it("recognises the seen flag in every supported spelling", () => {
    expect(isSeen(envelope("a", { flags: [{ iana: "seen", raw: "x" }] }))).toBe(true);
    expect(isSeen(envelope("b", { flags: [{ iana: null, raw: "\\SEEN" }] }))).toBe(true);
    expect(isSeen(envelope("c", { flags: [{ iana: null, raw: "seen" }] }))).toBe(true);
    expect(isSeen(envelope("d"))).toBe(false);
  });

  it("gives every badge an icon and a German label", () => {
    const badges = envelopeBadges(envelope("5", { hasAttachment: true, flags: [{ iana: "flagged", raw: "\\Flagged" }, { iana: "answered", raw: "\\Answered" }] }));
    expect(badges.map((badge) => badge.label)).toEqual(["Neu", "Anhang", "Markiert", "Beantwortet"]);
    for (const badge of badges) expect(badge.icon.length).toBeGreaterThan(0);
  });
});

describe("hueStyle", () => {
  it("points the row colour at the theme hue variable", () => {
    expect(hueStyle(3)).toEqual({ "--c": "var(--account-hue-3)" });
  });
});

describe("MessageList", () => {
  it("renders group headers only when the group changes, in the given order", () => {
    const html = render({ envelopes: [envelope("a"), envelope("b"), envelope("c", { date: at(17) }), envelope("d", { date: null })] });

    expect(html.match(/class="group-header"/g)).toHaveLength(3);
    expect(html.indexOf("Heute")).toBeLessThan(html.indexOf("Gestern"));
    expect(html.indexOf("Gestern")).toBeLessThan(html.indexOf("Ohne Datum"));
    expect(html.indexOf("Subject a")).toBeLessThan(html.indexOf("Subject b"));
  });

  it("marks unread and selected rows and keeps the row a button", () => {
    const html = render({
      envelopes: [envelope("a"), envelope("b", { flags: [{ iana: "seen", raw: "\\Seen" }] })],
      isSelected: (item) => item.id === "b",
    });

    expect(html).toContain('class="envelope-row  unread"');
    expect(html).toContain('class="envelope-row active seen"');
    expect(html.match(/<button/g)).toHaveLength(2);
  });

  it("uses icon-only badges with accessible text in compact density", () => {
    const html = render({ envelopes: [envelope("a", { hasAttachment: true })] });

    expect(html).toContain('title="Neu"');
    expect(html).toContain('class="visually-hidden">Anhang<');
    expect(html).not.toContain("envelope-detail");
  });

  it("shows badge text and a detail line in comfortable density", () => {
    const html = render({ density: "comfortable", envelopes: [envelope("a", { hasAttachment: true })] });

    expect(html).toContain('class="badge-text">Anhang<');
    expect(html).toContain("envelope-detail");
    expect(html).toContain("bob@example.test");
    expect(html).toContain("2 KB");
  });

  it("colours the dot from the row's account and shows the exact source chip in the unified inbox", () => {
    const html = render({
      unified: true,
      envelopes: [envelope("a", { source: { account: "beta", mailbox: "INBOX" } }), envelope("b", { source: { account: "alpha", mailbox: "Inbox" } })],
    });

    expect(html).toContain("--c:var(--account-hue-4)");
    expect(html).toContain("--c:var(--account-hue-2)");
    expect(html).toContain(">beta · INBOX<");
    expect(html).toContain(">alpha · Inbox<");
  });

  it("does not show a source chip and falls back to the current account outside the unified inbox", () => {
    const html = render({ envelopes: [envelope("a")] });

    expect(html).not.toContain("envelope-source");
    expect(html).toContain("--c:var(--account-hue-2)");
  });

  it("falls back to readable placeholders for a missing sender or subject", () => {
    const html = render({ envelopes: [envelope("a", { from: [], subject: "" })] });

    expect(html).toContain("Unbekannter Absender");
    expect(html).toContain("(ohne Betreff)");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/client/message-list.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the implementation**

Create `src/client/hue-style.ts`:

```ts
import type { CSSProperties } from "react";

export function hueStyle(index: number): CSSProperties {
  return { "--c": `var(--account-hue-${index})` } as CSSProperties;
}
```

Create `src/client/message-list.tsx`:

```tsx
import { Fragment } from "react";
import type { JSX } from "react";

import type { Envelope } from "../shared/types.js";
import { hueStyle } from "./hue-style.js";
import type { ListDensity } from "./list-density.js";
import { formatRowTime, withGroupHeaders } from "./message-groups.js";

export type EnvelopeBadge = {
  kind: "new" | "attachment" | "flagged" | "answered";
  label: string;
  icon: string;
};

const BADGES: Record<EnvelopeBadge["kind"], EnvelopeBadge> = {
  new: { kind: "new", label: "Neu", icon: "●" },
  attachment: { kind: "attachment", label: "Anhang", icon: "📎" },
  flagged: { kind: "flagged", label: "Markiert", icon: "⚑" },
  answered: { kind: "answered", label: "Beantwortet", icon: "↩" },
};

function hasFlag(envelope: Envelope, name: string): boolean {
  return envelope.flags.some((flag) => {
    const raw = flag.raw.toLowerCase();
    return flag.iana === name || raw === `\\${name}` || raw === name;
  });
}

export function isSeen(envelope: Envelope): boolean {
  return hasFlag(envelope, "seen");
}

export function labelForEnvelope(envelope: Envelope): string {
  return envelope.from[0]?.name || envelope.from[0]?.email || "Unbekannter Absender";
}

export function envelopeBadges(envelope: Envelope): EnvelopeBadge[] {
  const badges: EnvelopeBadge[] = [];
  if (!isSeen(envelope)) badges.push(BADGES.new);
  if (envelope.hasAttachment === true) badges.push(BADGES.attachment);
  if (hasFlag(envelope, "flagged")) badges.push(BADGES.flagged);
  if (hasFlag(envelope, "answered")) badges.push(BADGES.answered);
  return badges;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export type MessageListProps = {
  envelopes: readonly Envelope[];
  now: Date;
  density: ListDensity;
  unified: boolean;
  currentAccount: string | null;
  colorIndexFor: (account: string) => number;
  isSelected: (envelope: Envelope) => boolean;
  onOpen: (envelope: Envelope) => void;
  rowKey: (envelope: Envelope) => string;
};

export function MessageList({
  envelopes,
  now,
  density,
  unified,
  currentAccount,
  colorIndexFor,
  isSelected,
  onOpen,
  rowKey,
}: MessageListProps): JSX.Element {
  return (
    <>
      {withGroupHeaders(envelopes, now).map(({ item: envelope, header }) => {
        const account = unified ? envelope.source?.account ?? currentAccount : currentAccount;
        return (
          <Fragment key={rowKey(envelope)}>
            {header && <div className="group-header">{header}</div>}
            <button
              className={`envelope-row ${isSelected(envelope) ? "active" : ""} ${isSeen(envelope) ? "seen" : "unread"}`}
              style={hueStyle(account ? colorIndexFor(account) : 0)}
              type="button"
              onClick={() => onOpen(envelope)}
            >
              <span className="account-dot" aria-hidden="true" />
              <span className="envelope-sender">{labelForEnvelope(envelope)}</span>
              <span className="envelope-main">
                {unified && envelope.source && (
                  <span className="envelope-source" title={envelope.source.account}>{`${envelope.source.account} · ${envelope.source.mailbox}`}</span>
                )}
                <span className="envelope-subject">{envelope.subject || "(ohne Betreff)"}</span>
              </span>
              <span className="envelope-badges">
                {envelopeBadges(envelope).map((badge) => (
                  <span key={badge.kind} className={`badge badge-${badge.kind}`} title={badge.label}>
                    <span aria-hidden="true">{badge.icon}</span>
                    <span className={density === "compact" ? "visually-hidden" : "badge-text"}>{badge.label}</span>
                  </span>
                ))}
              </span>
              <time className="envelope-time" dateTime={envelope.date ?? undefined}>{formatRowTime(envelope.date, now)}</time>
              {density === "comfortable" && (
                <span className="envelope-detail">{`${envelope.to[0]?.email ?? ""} · ${formatSize(envelope.size)}`}</span>
              )}
            </button>
          </Fragment>
        );
      })}
    </>
  );
}
```

Note on the class assertions in the test: the row class string is `envelope-row ${active-or-empty} ${seen-or-unread}`, so an unselected row renders `class="envelope-row  unread"` (two spaces). Keep that exact template so the test and the existing E2E selectors (`.envelope-row`, `.envelope-row.active`) stay valid.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/client/message-list.test.ts && npm run typecheck`
Expected: all tests PASS, typecheck exits 0. If the `--c:var(--account-hue-4)` assertion fails, check how React serialises the custom property (it renders `style="--c:var(--account-hue-4)"`); adjust the test string, not the component.

---

### Task 6: Account colours in the tree and the manager

**Files:**
- Modify: `src/client/main.tsx`
- Modify: `src/client/styles.css`

**Interfaces:**
- Consumes: everything from Task 3, `hueStyle` (Task 5).
- Produces (inside `App`): `colorState`, `accountColors` (memo), `colorIndexFor(alias: string): number`, `chooseAccountColor(alias: string, index: number | null): void`. Task 7 passes `colorIndexFor` to `MessageList`.

- [ ] **Step 1: Add imports**

In `src/client/main.tsx`, after the `import { UNIFIED_INBOX_MAX_PAGE } from "../shared/types.js";` line add:

```ts
import {
  ACCOUNT_HUE_NAMES,
  emptyAccountColorState,
  readAccountColorState,
  resolveAccountColors,
  setManualAccountColor,
  writeAccountColorState,
} from "./account-colors.js";
import type { AccountColorState } from "./account-colors.js";
import { hueStyle } from "./hue-style.js";
```

- [ ] **Step 2: Add state and memo**

After the line `const [accountMoveNotice, setAccountMoveNotice] = useState<{ name: string; sequence: number } | null>(null);` add:

```ts
  const [colorState, setColorState] = useState<AccountColorState>(() => (
    preferenceStorage ? readAccountColorState(preferenceStorage) : emptyAccountColorState()
  ));
  const accountColors = useMemo(
    () => resolveAccountColors(accounts.map((account) => account.name), colorState).colors,
    [accounts, colorState],
  );
```

- [ ] **Step 3: Persist the first resolution when accounts load**

In the bootstrap `.then((result) => { ... })`, directly after `if (storage) writeAccountOrder(storage, order);` add:

```ts
        const resolvedColors = resolveAccountColors(
          result.accounts.map((account) => account.name),
          storage ? readAccountColorState(storage) : emptyAccountColorState(),
        );
        setColorState(resolvedColors.state);
        if (storage) writeAccountColorState(storage, resolvedColors.state);
```

- [ ] **Step 4: Add the helper functions**

Next to `function mailboxState(name: string): MailboxLoadState {` (inside `App`), insert before it:

```ts
  function colorIndexFor(alias: string): number {
    return accountColors[alias] ?? 0;
  }

  function chooseAccountColor(alias: string, index: number | null): void {
    const next = resolveAccountColors(accounts.map((account) => account.name), setManualAccountColor(colorState, alias, index)).state;
    setColorState(next);
    if (preferenceStorage) writeAccountColorState(preferenceStorage, next);
  }
```

- [ ] **Step 5: Tint the account mark (tree and manager) and add the warning badge**

Replace **every** occurrence (two: the tree and the manager identity) of

```tsx
<span className="account-mark">{account.name.slice(0, 1).toUpperCase()}</span>
```

with

```tsx
<span className="account-mark" style={hueStyle(colorIndexFor(account.name))}>{account.name.slice(0, 1).toUpperCase()}</span>
```

In the tree, immediately before the account favorite button (the line starting `<button className={`favorite-button ${accountFavorites.has(account.name) ? "favorite" : ""}`}`), insert:

```tsx
                  {unifiedWarnings.some((warning) => warning.account === account.name) && <span className="account-warning" role="img" aria-label="Warnung beim letzten Laden" title="Warnung beim letzten Laden">⚠</span>}
```

- [ ] **Step 6: Add the manager colour control**

In the account manager row, after the `account-manager-order-controls` `</div>` and before the row's closing `</div>;`, insert (keep the surrounding indentation):

```tsx
                <div className="account-color-control" role="group" aria-label={`Farbe: ${account.name}`}>
                  <button type="button" className="color-auto" aria-label={`Automatische Farbe: ${account.name}`} aria-pressed={colorState.manual[account.name] === undefined} onClick={() => chooseAccountColor(account.name, null)}>Auto</button>
                  {ACCOUNT_HUE_NAMES.map((hueName, hueIndex) => (
                    <button key={hueName} type="button" className="color-swatch" style={hueStyle(hueIndex)} title={hueName} aria-label={`${hueName}: ${account.name}`} aria-pressed={colorState.manual[account.name] === hueIndex} onClick={() => chooseAccountColor(account.name, hueIndex)} />
                  ))}
                </div>
```

- [ ] **Step 7: Add the styles**

In `src/client/styles.css`, replace the `.account-mark { ... }` rule (line beginning `.account-mark { flex: 0 0 auto;`) with:

```css
.account-mark { flex: 0 0 auto; width: 29px; height: 29px; display: grid; place-items: center; color: var(--text); background: color-mix(in srgb, var(--c, var(--accent)) 18%, var(--field)); border: 2px solid var(--c, var(--border)); border-radius: 8px; font-size: 12px; font-weight: 800; }
```

Append at the end of the file:

```css
.account-warning { flex: 0 0 auto; color: var(--warning); font-size: 13px; padding: 0 4px; }
.account-color-control { grid-column: 1 / -1; display: flex; align-items: center; flex-wrap: wrap; gap: 7px; padding-top: 2px; }
.color-auto { border: 1px solid var(--border); border-radius: 999px; padding: 3px 10px; background: var(--field); color: var(--text); font-size: 11px; }
.color-auto[aria-pressed="true"] { border-color: var(--accent); background: var(--selected); font-weight: 800; }
.color-swatch { width: 22px; height: 22px; padding: 0; border-radius: 50%; border: 2px solid var(--border); background: var(--c); }
.color-swatch[aria-pressed="true"] { border-color: var(--text); box-shadow: 0 0 0 2px var(--field), 0 0 0 4px var(--c); }
.color-auto:focus-visible, .color-swatch:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
```

- [ ] **Step 8: Verify**

Run: `npm run typecheck && npm test`
Expected: typecheck exits 0; all unit tests PASS.

Run: `npx playwright test tests/e2e/account-order.spec.ts tests/e2e/account-tree.spec.ts`
Expected: PASS (the account tree, ordering, and manager tests still find their elements).

---

### Task 7: Integrate the message list, density, and row styles

**Files:**
- Modify: `src/client/main.tsx`
- Modify: `src/client/styles.css`

**Interfaces:**
- Consumes: `MessageList`, `isSeen` (Task 5); `readListDensity`, `writeListDensity`, `ListDensity` (Task 1); `colorIndexFor` (Task 6).

- [ ] **Step 1: Move the helpers out of `main.tsx`**

Delete these three function blocks from `src/client/main.tsx` (they now live in `message-list.tsx`):

```ts
function isSeen(envelope: Envelope): boolean {
  return envelope.flags.some((flag) => flag.iana === "seen" || flag.raw.toLowerCase() === "\\seen" || flag.raw.toLowerCase() === "seen");
}
```

```ts
function labelForEnvelope(envelope: Envelope): string {
  return envelope.from[0]?.name || envelope.from[0]?.email || "Unbekannter Absender";
}
```

```ts
function shortDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(date);
}
```

Keep `withSeen` and `fullDate`. Add imports next to the other `./` imports:

```ts
import { readListDensity, writeListDensity } from "./list-density.js";
import type { ListDensity } from "./list-density.js";
import { isSeen, MessageList } from "./message-list.js";
```

- [ ] **Step 2: Add density state and handler**

After the `colorState`/`accountColors` block from Task 6 add:

```ts
  const [density, setDensity] = useState<ListDensity>(() => (
    preferenceStorage ? readListDensity(preferenceStorage) : "compact"
  ));
```

Next to `chooseAccountColor` add:

```ts
  function chooseDensity(next: ListDensity): void {
    setDensity(next);
    if (preferenceStorage) writeListDensity(preferenceStorage, next);
  }
```

- [ ] **Step 3: Add the density toggle to the toolbar**

In the `message-toolbar` line, change the start of the right-hand `<div>`:

```tsx
</span><div><button className="subtle-button" disabled={page <= 1 || loadingMessages}
```

to

```tsx
</span><div><div className="density-toggle" role="group" aria-label="Listendichte"><button className="subtle-button" type="button" aria-pressed={density === "compact"} onClick={() => chooseDensity("compact")}>Kompakt</button><button className="subtle-button" type="button" aria-pressed={density === "comfortable"} onClick={() => chooseDensity("comfortable")}>Komfortabel</button></div><button className="subtle-button" disabled={page <= 1 || loadingMessages}
```

- [ ] **Step 4: Replace the row rendering**

Read the lines around `{envelopes.map((envelope) => <button key=...` and replace the whole expression, from `{envelopes.map(` through its closing `</button>)}` (five lines: the button, the unified source span, the `envelope-top`/`envelope-subject`/`envelope-preview` line, and the close), with:

```tsx
            <MessageList
              envelopes={envelopes}
              now={new Date()}
              density={density}
              unified={unifiedSelected}
              currentAccount={selectedAccount}
              colorIndexFor={colorIndexFor}
              isSelected={(envelope) => matchesRef(envelope, selectedMessage)}
              onOpen={(envelope) => void openMessage(envelope)}
              rowKey={(envelope) => JSON.stringify(envelopeRef(envelope) ?? [envelope.id])}
            />
```

- [ ] **Step 5: Replace the row styles**

In `src/client/styles.css`, replace the block from `.envelope-row {` through `.envelope-source { ... }` (the seven rules `.envelope-row`, `.envelope-row:hover, .envelope-row.active`, `.envelope-row.unread strong, ...`, `.envelope-top`, `.envelope-top time`, `.envelope-subject`, `.envelope-preview`, `.envelope-source`) with:

```css
.envelope-row { width: 100%; display: grid; grid-template-columns: 8px minmax(72px, 128px) minmax(0, 1fr) auto auto; grid-template-areas: "dot sender main badges time"; align-items: center; column-gap: 9px; border: 0; border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent); background: transparent; padding: 6px 12px; min-height: 32px; color: var(--text); text-align: left; }
.envelope-row:hover, .envelope-row.active { background: var(--selected); }
.envelope-row.unread .envelope-sender, .envelope-row.unread .envelope-subject { font-weight: 800; }
.account-dot { grid-area: dot; width: 8px; height: 8px; border-radius: 50%; background: var(--c, var(--accent)); }
.envelope-sender { grid-area: sender; }
.envelope-main { grid-area: main; min-width: 0; display: flex; align-items: center; gap: 7px; }
.envelope-badges { grid-area: badges; display: flex; gap: 4px; }
.envelope-time { grid-area: time; color: var(--muted-text); font-size: 10px; white-space: nowrap; }
.envelope-detail { grid-area: detail; color: var(--muted-text); font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.envelope-row.active .envelope-time, .envelope-row.active .envelope-detail, .envelope-row:hover .envelope-time, .envelope-row:hover .envelope-detail { color: var(--text); }
.envelope-sender, .envelope-subject { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.envelope-source { flex: 0 1 auto; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 1px 7px; border-radius: 6px; border: 1px solid var(--c, var(--accent)); color: var(--text); background: color-mix(in srgb, var(--c, var(--accent)) 14%, transparent); font-size: 10px; font-weight: 800; }
.badge { display: inline-flex; align-items: center; gap: 4px; padding: 0 6px; border-radius: 999px; border: 1px solid var(--b); color: var(--text); background: color-mix(in srgb, var(--b) 14%, transparent); font-size: 10px; font-weight: 800; white-space: nowrap; }
.badge > [aria-hidden="true"] { color: var(--b); }
.badge-new { --b: var(--accent); }
.badge-attachment { --b: var(--title-list, var(--accent)); }
.badge-flagged { --b: var(--warning); }
.badge-answered { --b: var(--success); }
.visually-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.group-header { position: sticky; top: 0; z-index: 1; padding: 4px 12px; font-size: 9.5px; font-weight: 900; letter-spacing: .09em; text-transform: uppercase; color: var(--muted-text); background: var(--field); border-bottom: 1px solid var(--border); }
.density-toggle { display: flex; gap: 2px; margin-right: 8px; }
.density-toggle .subtle-button[aria-pressed="true"] { background: var(--selected); color: var(--text); font-weight: 800; }
```

Then add the comfortable layout at the end of the file. The `comfortable` class is not rendered by the component; the density difference is expressed through the presence of `.envelope-detail`, so use `:has()`:

```css
.envelope-row:has(.envelope-detail) { grid-template-areas: "dot sender main badges time" ". detail detail detail detail"; row-gap: 3px; padding: 9px 12px; }
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm test`
Expected: typecheck exits 0; all unit tests PASS.

Run: `npx playwright test`
Expected: all 42 existing browser tests PASS. If a test breaks because it looked for removed text (for example the old `· Anhang` preview), update that assertion to the new equivalent; do not restore the old markup.

---

### Task 8: Area tones and layout contract

**Files:**
- Modify: `src/client/styles.css`
- Modify: `src/client/layout-contract.test.ts`

**Interfaces:**
- Consumes: the `--area-*`, `--title-*`, `--account-hue-*` custom properties set by `applyTheme` (Task 4).

- [ ] **Step 1: Write the failing contract test**

Add to `src/client/layout-contract.test.ts`, inside the `describe` block before its closing `});`:

```ts
  it("tints the three areas from theme tokens with a coloured top line and title", () => {
    expect(stylesheet).toMatch(/\.accounts-panel\s*\{[^}]*background:\s*var\(--area-accounts\)[^}]*inset 0 3px 0 var\(--title-accounts\)/);
    expect(stylesheet).toMatch(/\.messages-panel\s*\{[^}]*background:\s*var\(--area-list\)[^}]*inset 0 3px 0 var\(--title-list\)/);
    expect(stylesheet).toMatch(/\.reader-panel\s*\{[^}]*background:\s*var\(--area-reader\)[^}]*inset 0 3px 0 var\(--title-reader\)/);
    expect(stylesheet).toMatch(/\.accounts-panel \.eyebrow\s*\{[^}]*var\(--title-accounts\)/);
    expect(stylesheet).toMatch(/\.messages-panel \.eyebrow\s*\{[^}]*var\(--title-list\)/);
    expect(stylesheet).toMatch(/\.reader-panel \.eyebrow\s*\{[^}]*var\(--title-reader\)/);
  });

  it("declares Midnight fallbacks for the new tokens before the theme is applied", () => {
    const root = /:root\s*\{([^}]*)\}/.exec(stylesheet)?.[1] ?? "";
    for (const token of ["--area-accounts", "--area-list", "--area-reader", "--title-accounts", "--title-list", "--title-reader"]) {
      expect(root).toContain(`${token}:`);
    }
    for (let index = 0; index < 8; index += 1) expect(root).toContain(`--account-hue-${index}:`);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/client/layout-contract.test.ts`
Expected: the two new tests FAIL.

- [ ] **Step 3: Add the fallbacks to `:root`**

In `src/client/styles.css`, inside the first `:root { ... }` block, after `--shadow: 0 20px 60px rgba(0, 0, 0, .28);` add:

```css
  --area-accounts: #1c1725;
  --area-list: #211b2b;
  --area-reader: #261f31;
  --title-accounts: #9d7cff;
  --title-list: #90c4ea;
  --title-reader: #66d1ad;
  --account-hue-0: #ab90ea;
  --account-hue-1: #90eacc;
  --account-hue-2: #eacc90;
  --account-hue-3: #ea90ae;
  --account-hue-4: #90c4ea;
  --account-hue-5: #eab190;
  --account-hue-6: #c4ea90;
  --account-hue-7: #ea90ea;
```

- [ ] **Step 4: Add the area rules**

Directly after the `.panel { ... }` rule add:

```css
.workspace .panel { border-color: color-mix(in srgb, var(--title-accounts) 35%, var(--border)); }
.accounts-panel { background: var(--area-accounts); box-shadow: inset 0 3px 0 var(--title-accounts), var(--shadow); }
.messages-panel { background: var(--area-list); box-shadow: inset 0 3px 0 var(--title-list), var(--shadow); }
.reader-panel { background: var(--area-reader); box-shadow: inset 0 3px 0 var(--title-reader), var(--shadow); }
.accounts-panel .eyebrow { color: var(--title-accounts); }
.messages-panel .eyebrow { color: var(--title-list); }
.reader-panel .eyebrow { color: var(--title-reader); }
```

The existing `.reader-panel { overflow: auto; }` rule stays as is; the new `.reader-panel` rule only adds background and shadow.

- [ ] **Step 5: Run the contract test and the whole suites**

Run: `npx vitest run src/client/layout-contract.test.ts && npm run typecheck && npm test`
Expected: PASS.

Run: `npx playwright test`
Expected: all existing browser tests PASS.

---

### Task 9: Browser coverage

**Files:**
- Create: `tests/e2e/overview.spec.ts`

**Interfaces:**
- Consumes: the finished UI from Tasks 6 to 8 and the storage keys `himalaya-web-account-colors-v1`, `himalaya-web-list-density-v1`.

- [ ] **Step 1: Write the spec**

Create `tests/e2e/overview.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Envelope, UnifiedInboxResult } from "../../src/shared/types.js";

test.use({ launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH ?? "/home/dnames/bin/chromium-ai" } });

const COLORS_KEY = "himalaya-web-account-colors-v1";
const DENSITY_KEY = "himalaya-web-list-density-v1";
const AMBER = "rgb(234, 204, 144)";
const SKY = "rgb(144, 196, 234)";

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

function envelope(id: string, subject: string, overrides: Partial<Envelope> = {}): Envelope {
  return {
    id,
    subject,
    date: daysAgo(0),
    flags: [],
    from: [{ email: "sender@example.test", name: "Sender" }],
    to: [{ email: "me@example.test", name: null }],
    hasAttachment: false,
    size: 2048,
    ...overrides,
  };
}

const NORMAL_LIST: Envelope[] = [
  envelope("1", "Synthetic today unread", { hasAttachment: true }),
  envelope("2", "Synthetic today flagged", { flags: [{ iana: "seen", raw: "\\Seen" }, { iana: "flagged", raw: "\\Flagged" }] }),
  envelope("3", "Synthetic yesterday answered", { date: daysAgo(1), flags: [{ iana: "seen", raw: "\\Seen" }, { iana: "answered", raw: "\\Answered" }] }),
  envelope("4", "Synthetic last week", { date: daysAgo(9), flags: [{ iana: "seen", raw: "\\Seen" }] }),
  envelope("5", "Synthetic undated", { date: null, flags: [{ iana: "seen", raw: "\\Seen" }] }),
];

const UNIFIED: UnifiedInboxResult = {
  envelopes: [
    envelope("u1", "Synthetic unified alpha", { source: { account: "alpha", mailbox: "INBOX" } }),
    envelope("u2", "Synthetic unified beta", { source: { account: "beta", mailbox: "Inbox" } }),
  ],
  hasMore: false,
  warnings: [{ account: "broken", code: "AUTH_REQUIRED", message: "Bitte prüfe die Anmeldung dieses Kontos." }],
};

type Seed = { colors?: unknown; blockNewKeys?: boolean };

async function setup(page: Page, seed: Seed = {}): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/bootstrap") {
      await route.fulfill({ json: {
        accounts: ["alpha", "beta", "broken"].map((name) => ({ name, default: name === "alpha", backends: ["imap"], email: `${name}@example.test` })),
        addressWarning: null,
      } });
    } else if (url.pathname === "/api/unified/inbox") await route.fulfill({ json: UNIFIED });
    else if (url.pathname.endsWith("/mailboxes")) {
      const account = url.pathname.split("/")[3];
      await route.fulfill({ json: { mailboxes: [{ id: account === "beta" ? "Inbox" : "INBOX", name: "INBOX", total: 5, unread: 1 }] } });
    } else if (url.pathname.endsWith("/messages")) await route.fulfill({ json: { envelopes: NORMAL_LIST } });
    else { await route.abort(); throw new Error(`Unexpected API request: ${url.pathname}`); }
  });

  await page.addInitScript(({ colors, blockNewKeys, colorsKey, densityKey }) => {
    if (colors !== undefined && !sessionStorage.getItem("seeded")) {
      localStorage.setItem(colorsKey, JSON.stringify(colors));
      sessionStorage.setItem("seeded", "1");
    }
    if (blockNewKeys) {
      const guarded = new Set([colorsKey, densityKey]);
      const originalGet = Storage.prototype.getItem;
      const originalSet = Storage.prototype.setItem;
      Storage.prototype.getItem = function (key: string) {
        if (guarded.has(key)) throw new Error("blocked");
        return originalGet.call(this, key);
      };
      Storage.prototype.setItem = function (key: string, value: string) {
        if (guarded.has(key)) throw new Error("blocked");
        return originalSet.call(this, key, value);
      };
    }
  }, { colors: seed.colors, blockNewKeys: seed.blockNewKeys ?? false, colorsKey: COLORS_KEY, densityKey: DENSITY_KEY });

  await page.goto("/");
  await expect(page.getByRole("button", { name: /Synthetic today unread/ })).toBeVisible();
}

const row = (page: Page, text: RegExp) => page.getByRole("button", { name: text });

test("groups the list by date and shows real-flag badges", async ({ page }) => {
  await setup(page);

  await expect(page.locator(".group-header")).toHaveText(["Heute", "Gestern", "Letzte Woche", "Ohne Datum"]);
  await expect(page.locator(".envelope-row")).toHaveCount(5);
  await expect(row(page, /Synthetic today unread/).locator(".badge")).toHaveCount(2);
  await expect(row(page, /Synthetic today unread/).locator(".badge-new")).toHaveAttribute("title", "Neu");
  await expect(row(page, /Synthetic today flagged/).locator(".badge-flagged")).toHaveAttribute("title", "Markiert");
  await expect(row(page, /Synthetic yesterday answered/).locator(".badge-answered")).toHaveAttribute("title", "Beantwortet");
  await expect(row(page, /Synthetic last week/).locator(".badge")).toHaveCount(0);
});

test("switches density and remembers it after a reload", async ({ page }) => {
  await setup(page);
  const compact = page.getByRole("button", { name: "Kompakt", exact: true });
  const comfortable = page.getByRole("button", { name: "Komfortabel", exact: true });

  await expect(compact).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".envelope-detail")).toHaveCount(0);
  await comfortable.click();
  await expect(comfortable).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".envelope-detail")).toHaveCount(5);
  await expect(page.locator(".badge-text").first()).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Komfortabel", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".envelope-detail")).toHaveCount(5);
  await page.getByRole("button", { name: "Kompakt", exact: true }).click();
  await expect(page.locator(".envelope-detail")).toHaveCount(0);
});

test("overrides an account colour, keeps it after a reload, and restores Auto", async ({ page }) => {
  await setup(page, { colors: { manual: { alpha: 2 }, auto: { beta: 4, broken: 6 } } });
  const dot = page.locator(".envelope-row .account-dot").first();

  await expect(dot).toHaveCSS("background-color", AMBER);

  await page.getByRole("button", { name: "Konten verwalten", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Bernstein: alpha", exact: true })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "Himmelblau: alpha", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Himmelblau: alpha", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("button", { name: "Automatische Farbe: alpha", exact: true })).toHaveAttribute("aria-pressed", "false");
  await dialog.getByRole("button", { name: "Kontenverwaltung schließen", exact: true }).click();
  await expect(dot).toHaveCSS("background-color", SKY);

  await page.reload();
  await expect(page.locator(".envelope-row .account-dot").first()).toHaveCSS("background-color", SKY);

  await page.getByRole("button", { name: "Konten verwalten", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Automatische Farbe: alpha", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Automatische Farbe: alpha", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("still renders when the two new storage keys are blocked", async ({ page }) => {
  await setup(page, { blockNewKeys: true });

  await expect(page.locator(".envelope-row")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Kompakt", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Komfortabel", exact: true }).click();
  await expect(page.locator(".envelope-detail")).toHaveCount(5);
});

test("shows the source chip, the account dot colour, and a warning badge in the unified inbox", async ({ page }) => {
  await setup(page, { colors: { manual: { alpha: 2, beta: 4 }, auto: { broken: 6 } } });
  await page.getByRole("button", { name: "Alle Eingänge", exact: true }).click();

  await expect(page.getByText("alpha · INBOX", { exact: true })).toBeVisible();
  await expect(page.getByText("beta · Inbox", { exact: true })).toBeVisible();
  await expect(row(page, /Synthetic unified alpha/).locator(".account-dot")).toHaveCSS("background-color", AMBER);
  await expect(row(page, /Synthetic unified beta/).locator(".account-dot")).toHaveCSS("background-color", SKY);
  await expect(page.locator('section[aria-label="broken"]').getByRole("img", { name: "Warnung beim letzten Laden" })).toBeVisible();
  await expect(page.locator('section[aria-label="alpha"]').getByRole("img", { name: "Warnung beim letzten Laden" })).toHaveCount(0);
});
```

- [ ] **Step 2: Run the spec**

Run: `npx playwright test tests/e2e/overview.spec.ts`
Expected: 5 tests PASS. The expected colours come from the `midnight` `accountHues` (index 2 = `#eacc90` = `rgb(234, 204, 144)`, index 4 = `#90c4ea` = `rgb(144, 196, 234)`); the tests run in the default Midnight theme.

- [ ] **Step 3: Run the whole browser suite**

Run: `npx playwright test`
Expected: all tests PASS (42 existing plus the 5 new).

---

### Task 10: Documentation, release `0.4.0`, and full verification

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `src/shared/app-meta.test.ts`, `HANDOFF.md`, `AGENTS.md`

- [ ] **Step 1: Bump the version everywhere**

Run: `npm version 0.4.0 --no-git-tag-version`
Expected: prints `v0.4.0`; `package.json` and `package-lock.json` both show `0.4.0`.

In `src/shared/app-meta.test.ts` change the two expectations to `"0.4.0"` and `"v0.4.0"`.

- [ ] **Step 2: Update the docs**

Add at the top of `CHANGELOG.md`, above `## 0.3.0`:

```markdown
## 0.4.0 — 2026-09-18

- Added stable per-account colours (eight theme-tuned hues, automatic and
  persistent, overridable per account in the account manager) stored as aliases
  only under `himalaya-web-account-colors-v1`.
- Grouped the message list by date (Heute, Gestern, Diese Woche, Letzte Woche,
  Älter, Ohne Datum) without reordering rows, with sticky group headers.
- Added status badges from real IMAP flags (Neu, Anhang, Markiert,
  Beantwortet) with icon plus accessible text, and a warning mark for accounts
  with a current unified-inbox warning.
- Added two list densities, Kompakt and Komfortabel, remembered per browser
  under `himalaya-web-list-density-v1`.
- Tinted the accounts, message, and reader areas from new theme tokens with a
  coloured top line and title, and verified text and hue contrast for all six
  themes. Catppuccin Latte's muted text is darker to meet 4.5:1.
- No API, backend, or session changes.
```

In `README.md`, extend the "Implemented UI slice" list with one bullet each for: account colours with manager override, date-grouped compact list with density toggle, status badges from real flags, and tinted areas with contrast-checked themes. Update any mention of the current version to `0.4.0`, and add to the verification section that the theme contrast test guards the colour tokens.

- [ ] **Step 3: Update the handoff files**

In `HANDOFF.md`, update `Current Progress` (version `0.4.0`, overview system implemented from the plan `docs/superpowers/plans/2026-09-18-himalaya-web-overview-system.md`), `Files Changed` (the new modules, `message-list.tsx`, theme changes, `tests/e2e/overview.spec.ts`), and `Next Steps` (specs still to write, in this order: B keyboard and command palette, D remote-image privacy, C conversations and saved searches, F/G notifications and bar widget). Mirror the summary in the `AGENTS.md` handoff block.

- [ ] **Step 4: Full verification**

Run each and read the real output:

```bash
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
npx playwright test
git diff --check
```

Expected: typecheck exits 0; all unit tests PASS; build succeeds; `found 0 vulnerabilities`; all browser tests PASS (42 existing plus 5 new); `git diff --check` exits 0.

Then restart the live service so the running app serves the new build, and smoke-check it without touching real mail:

```bash
systemctl --user restart himalaya-web.service
sleep 3
systemctl --user is-active himalaya-web.service
curl -s -o /dev/null -w "root:%{http_code}\n" http://127.0.0.1:47831/
curl -s -o /dev/null -w "api-noauth:%{http_code}\n" http://127.0.0.1:47831/api/bootstrap
```

Expected: `active`, `root:200`, `api-noauth:401`. Then ask the user to reload the browser tab and confirm the new look visually; the automated tests do not judge appearance.

- [ ] **Step 5: Ask for commit authorization, then commit**

Ask the user whether to commit. If authorized, stage explicit paths and commit:

```bash
git add src/client/list-density.ts src/client/list-density.test.ts src/client/message-groups.ts src/client/message-groups.test.ts src/client/account-colors.ts src/client/account-colors.test.ts src/client/hue-style.ts src/client/message-list.tsx src/client/message-list.test.ts src/client/theme-contrast.test.ts src/client/themes.ts src/client/themes.test.ts src/client/main.tsx src/client/styles.css src/client/layout-contract.test.ts tests/e2e/overview.spec.ts src/shared/app-meta.test.ts package.json package-lock.json README.md CHANGELOG.md HANDOFF.md AGENTS.md docs/superpowers/specs/2026-09-18-himalaya-web-overview-system-design.md docs/superpowers/plans/2026-09-18-himalaya-web-overview-system.md
git commit -m "feat: add overview system with account colours, date groups and density (0.4.0)"
```

Then rerun `npm test` and the loopback smoke check once more after the commit.

---

## Self-Review Notes

- **Spec coverage:** account colours, storage and manager control (Tasks 3, 6, 9); date groups, header rules, row time (Task 2, 5, 9); density (Tasks 1, 7, 9); badges from real flags and the warning mark (Tasks 5, 6, 9); area tones and top lines (Tasks 4, 8); contrast for all six themes including the Latte muted fix (Task 4); blocked storage (Tasks 1, 3, 9); unified chip text and dots (Tasks 5, 7, 9); docs and `0.4.0` (Task 10). The spec's amended storage format (`{ manual, auto }`) and `aria-pressed` group are what Tasks 3 and 6 implement.
- **Type consistency:** `resolveAccountColors` returns `{ colors, state }` and is used with that shape in Tasks 3 and 6; `colorIndexFor`, `chooseAccountColor`, and `chooseDensity` are defined in Tasks 6 and 7 before `MessageList` consumes them; `MessageListProps` in Task 5 matches the JSX props in Task 7; `hueStyle` is created in Task 5 and imported in Task 6.
- **Known judgement point for the executor:** whether an old browser test asserted the removed `· Anhang` preview text (Task 7). A search of the current tests found no such assertion; if one appears anyway, read the real markup and adapt the assertion, never weaken product behaviour.
- **Verified before writing:** the theme table passes every contrast rule (script check over all six themes, including the Latte `mutedText` change); the vitest config only includes `src/**/*.test.ts`, so the component test is a `.test.ts` file using `createElement` and `renderToStaticMarkup`; existing E2E selectors `.envelope-row`, `.envelope-row.active`, `.message-toolbar`, and the exact text `alpha · INBOX` are preserved.
