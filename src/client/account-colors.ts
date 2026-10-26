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
