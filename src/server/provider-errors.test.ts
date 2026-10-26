import { describe, expect, it } from "vitest";

import type { CommandResult } from "./himalaya.js";
import { providerError } from "./provider-errors.js";

function failedWith(error: string): CommandResult {
  return {
    stdout: Buffer.from(JSON.stringify({ error, sources: [], backtrace: null })),
    stderr: Buffer.alloc(0),
    code: 1,
  };
}

describe("providerError", () => {
  it("maps Gmail app-password failures to stable authentication guidance", () => {
    expect(providerError(failedWith("IMAP AUTHENTICATE PLAIN failed: NO Application-specific password required")))
      .toMatchObject({
        code: "AUTH_REQUIRED",
        retryable: false,
        message: expect.stringContaining("App-Passwort"),
      });
  });

  it("maps disabled Basic authentication to stable authentication guidance", () => {
    expect(providerError(failedWith("IMAP AUTHENTICATE PLAIN failed: NO Basic authentication is disabled.")))
      .toMatchObject({
        code: "AUTH_REQUIRED",
        retryable: false,
        message: expect.stringMatching(/OAuth2|App-Passwort/),
      });
  });

  it("uses a retryable generic error for unknown provider failures", () => {
    expect(providerError(failedWith("Temporary provider failure")))
      .toMatchObject({
        code: "PROVIDER_ERROR",
        retryable: true,
        message: expect.any(String),
      });
  });

  it("handles malformed output without exposing secret-shaped fields", () => {
    const result: CommandResult = {
      stdout: Buffer.from("not-json password=secret token=private"),
      stderr: Buffer.from("provider detail"),
      code: 1,
    };

    const error = providerError(result);
    expect(error.message).toBe("Der Mail-Provider hat die angeforderte Operation abgelehnt.");
    expect(error.message).not.toMatch(/password|token|secret/i);
  });
});
