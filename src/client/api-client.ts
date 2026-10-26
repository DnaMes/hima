import { beginSessionRecovery, clearSessionRecovery } from "./session-recovery.js";
import type { ApiError } from "../shared/types.js";

function browserSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export async function api<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      "X-Himalaya-Session": token,
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  const recoveryStorage = typeof window === "undefined" ? null : browserSessionStorage();
  if (response.ok && recoveryStorage) clearSessionRecovery(recoveryStorage);
  if (!response.ok) {
    if (response.status === 401 && recoveryStorage && beginSessionRecovery(recoveryStorage)) {
      window.location.reload();
    }
    const error = body as ApiError;
    throw new Error(error.error ?? "Die Anfrage ist fehlgeschlagen.");
  }
  return body as T;
}
