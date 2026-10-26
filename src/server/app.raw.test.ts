import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp, type HimalayaService } from "./app.js";

// Parsing is only needed for the filename; a message the parser chokes on must still download.
vi.mock("./mime.js", () => ({ parseRawMessage: vi.fn().mockRejectedValue(new Error("synthetic parse failure")) }));

let previous: string | undefined;
beforeEach(() => {
  previous = process.env.HIMALAYA_WEB_ACCOUNTS_PATH;
  process.env.HIMALAYA_WEB_ACCOUNTS_PATH = join(tmpdir(), "himalaya-web-app-raw-test-no-accounts-file", "accounts.json");
  process.env.HIMALAYA_WEB_SENDERS_PATH = join(tmpdir(), "himalaya-web-app-raw-test-no-senders-file", "senders.json");
});
afterEach(() => {
  if (previous === undefined) delete process.env.HIMALAYA_WEB_ACCOUNTS_PATH;
  else process.env.HIMALAYA_WEB_ACCOUNTS_PATH = previous;
  delete process.env.HIMALAYA_WEB_SENDERS_PATH;
});

describe("GET /api/message/raw when the message cannot be parsed", () => {
  it("still serves the original bytes under a generic .eml name", async () => {
    const raw = Buffer.from("\u0000\u0001 not a parsable message \r\n");
    const service = { readRaw: async () => raw } as unknown as HimalayaService;
    const app = await createApp(service, { token: "test-token" });
    try {
      const response = await app.inject({
        method: "GET", url: "/api/message/raw?account=andre&mailbox=INBOX&message=7",
        headers: { host: "127.0.0.1", "x-himalaya-session": "test-token" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.rawPayload.equals(raw)).toBe(true);
      expect(String(response.headers["content-disposition"])).toContain("message.eml");
    } finally {
      await app.close();
    }
  });
});
