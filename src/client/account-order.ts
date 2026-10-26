import type { Account } from "../shared/types.js";

export const ACCOUNT_ORDER_KEY = "himalaya-web-account-order-v1";

export function readAccountOrder(storage: Pick<Storage, "getItem">): string[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(ACCOUNT_ORDER_KEY) ?? "null");
    if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) return [];
    return [...new Set(parsed)];
  } catch {
    return [];
  }
}

export function writeAccountOrder(
  storage: Pick<Storage, "setItem">,
  order: readonly string[],
): void {
  try {
    storage.setItem(ACCOUNT_ORDER_KEY, JSON.stringify(order));
  } catch {
    // Browser storage can be unavailable or full; keep the current UI state in memory.
  }
}

export function normalizeAccountOrder(
  accounts: readonly Account[],
  stored: readonly string[],
): string[] {
  const providerNames = new Set(accounts.map((account) => account.name));
  const normalized = stored.filter((name, index) => (
    providerNames.has(name) && stored.indexOf(name) === index
  ));
  const included = new Set(normalized);

  for (const account of accounts) {
    if (!included.has(account.name)) {
      normalized.push(account.name);
      included.add(account.name);
    }
  }

  return normalized;
}

export function orderedAccounts(accounts: readonly Account[], order: readonly string[]): Account[] {
  const byName = new Map(accounts.map((account) => [account.name, account]));
  return normalizeAccountOrder(accounts, order).flatMap((name) => {
    const account = byName.get(name);
    return account ? [account] : [];
  });
}

export function moveAccount(
  order: readonly string[],
  accountName: string,
  direction: "up" | "down",
): string[] {
  const moved = [...order];
  const from = moved.indexOf(accountName);
  const to = from + (direction === "up" ? -1 : 1);
  if (from < 0 || to < 0 || to >= moved.length) return moved;

  [moved[from], moved[to]] = [moved[to]!, moved[from]!];
  return moved;
}
