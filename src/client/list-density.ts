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
