import type { Account } from "../shared/types.js";

export const ACCOUNT_STATE_KEY = "himalaya-web-account-state-v1";

export type AccountPreference = {
  active: boolean;
  visible: boolean;
  /** Feeds the "Alle Eingänge" aggregate; independent of tree visibility. */
  inUnified: boolean;
};

export type AccountPreferencePatch = Partial<AccountPreference>;
export type AccountPreferences = Record<string, AccountPreference>;
type StorageLike = Pick<Storage, "getItem" | "setItem">;

const DEFAULT_PREFERENCE: AccountPreference = { active: true, visible: true, inUnified: true };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function preferenceForAccount(preferences: Readonly<AccountPreferences>, accountName: string): AccountPreference {
  const stored = preferences[accountName];
  return {
    active: stored?.active ?? DEFAULT_PREFERENCE.active,
    visible: stored?.visible ?? DEFAULT_PREFERENCE.visible,
    inUnified: stored?.inUnified ?? DEFAULT_PREFERENCE.inUnified,
  };
}

export function readAccountPreferences(storage: StorageLike): AccountPreferences {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(ACCOUNT_STATE_KEY) ?? "null");
    if (!isRecord(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([accountName, value]) => {
        if (!isRecord(value)) return [];
        const active = typeof value.active === "boolean" ? value.active : DEFAULT_PREFERENCE.active;
        const visible = typeof value.visible === "boolean" ? value.visible : DEFAULT_PREFERENCE.visible;
        const inUnified = typeof value.inUnified === "boolean" ? value.inUnified : DEFAULT_PREFERENCE.inUnified;
        return [[accountName, { active, visible, inUnified } satisfies AccountPreference]];
      }),
    );
  } catch {
    return {};
  }
}

export function writeAccountPreferences(storage: StorageLike, preferences: Readonly<AccountPreferences>): void {
  try {
    storage.setItem(ACCOUNT_STATE_KEY, JSON.stringify(preferences));
  } catch {
    // Browser storage can be unavailable or full; keep the current UI state in memory.
  }
}

export function updateAccountPreference(
  preferences: Readonly<AccountPreferences>,
  accountName: string,
  patch: AccountPreferencePatch,
): AccountPreferences {
  return {
    ...preferences,
    [accountName]: {
      ...preferenceForAccount(preferences, accountName),
      ...patch,
    },
  };
}

export function filterSelectableAccounts(
  accounts: readonly Account[],
  preferences: Readonly<AccountPreferences>,
): Account[] {
  return accounts.filter((account) => {
    const preference = preferenceForAccount(preferences, account.name);
    return preference.active && preference.visible;
  });
}

export function filterUnifiedAccounts(
  accounts: readonly Account[],
  preferences: Readonly<AccountPreferences>,
): Account[] {
  return filterSelectableAccounts(accounts, preferences)
    .filter((account) => preferenceForAccount(preferences, account.name).inUnified);
}

export function chooseInitialAccount(
  accounts: readonly Account[],
  savedAccountName: string | null,
  preferences: Readonly<AccountPreferences>,
): string | null {
  const selectable = filterSelectableAccounts(accounts, preferences);
  return selectable.find((account) => account.name === savedAccountName)?.name
    ?? selectable.find((account) => account.default)?.name
    ?? selectable[0]?.name
    ?? null;
}
