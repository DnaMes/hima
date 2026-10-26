import type { CommandResult } from "./himalaya.js";
import { HimalayaError } from "./himalaya.js";

const MAX_PROVIDER_DETAIL_LENGTH = 512;
const AUTH_REQUIRED_MESSAGE = "Gmail benötigt ein App-Passwort oder eine OAuth2-Anmeldung. Prüfe die Zugangsdaten dieses Kontos.";
const GENERIC_PROVIDER_MESSAGE = "Der Mail-Provider hat die angeforderte Operation abgelehnt.";

function structuredError(result: CommandResult): string {
  try {
    const parsed: unknown = JSON.parse(result.stdout.toString("utf8"));
    if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
      const message = (parsed as { error?: unknown }).error;
      if (typeof message === "string") return message.slice(0, MAX_PROVIDER_DETAIL_LENGTH);
    }
  } catch {
    // Himalaya may return plain text for non-JSON failures.
  }
  return "";
}

export function providerError(result: CommandResult): HimalayaError {
  const detail = structuredError(result);
  if (/application-specific password required|basic authentication is disabled/i.test(detail)) {
    return new HimalayaError(AUTH_REQUIRED_MESSAGE, "AUTH_REQUIRED", false);
  }
  return new HimalayaError(GENERIC_PROVIDER_MESSAGE, "PROVIDER_ERROR", true);
}
