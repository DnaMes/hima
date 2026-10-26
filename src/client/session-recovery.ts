export const SESSION_RECOVERY_KEY = "himalaya-web-session-recovery-v1";

export type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function beginSessionRecovery(storage: RecoveryStorage): boolean {
  try {
    if (storage.getItem(SESSION_RECOVERY_KEY) === "1") return false;
    storage.setItem(SESSION_RECOVERY_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

export function clearSessionRecovery(storage: RecoveryStorage): void {
  try {
    storage.removeItem(SESSION_RECOVERY_KEY);
  } catch {
    // A restricted browser storage must not break normal API requests.
  }
}
