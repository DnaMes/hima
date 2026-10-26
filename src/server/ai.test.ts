import { describe, expect, it } from "vitest";

import type { MessageDetail } from "../shared/types.js";
import {
  buildAiPrompt,
  createMiniMaxProvider,
  readAiConfig,
  type AiConfig,
} from "./ai.js";

const detail: MessageDetail = {
  ref: { account: "andre", mailbox: "INBOX", message: "7" },
  envelope: {
    id: "7",
    date: "2026-09-18T09:30:00Z",
    flags: [],
    from: [{ name: "Alice", email: "alice@example.test" }],
    to: [{ name: "André", email: "andre@example.test" }],
    subject: "Synthetic subject",
    size: 12,
    hasAttachment: true,
  },
  text: "Please summarize this synthetic message.",
  html: null,
  attachments: [{ id: "2", filename: "report.pdf", mime: "application/pdf", size: 42, inline: false }],
  sender: { replyTo: null, returnPath: null, messageIdDomain: null, auth: null, received: [], risk: { level: "none", score: 0, reasons: [] }, trust: null },
};

const config: AiConfig = {
  provider: "minimax",
  baseUrl: "https://api.minimax.test/v1",
  model: "MiniMax-M3",
  apiKey: "synthetic-api-key",
  timeoutMs: 30_000,
};

describe("AI provider boundary", () => {
  it("builds a bounded prompt that treats message content as untrusted data", () => {
    const prompt = buildAiPrompt("summarize", { kind: "message", detail });

    expect(prompt.system).toContain("untrusted");
    expect(prompt.user).toContain("BEGIN MESSAGE DATA");
    expect(prompt.user).toContain("Please summarize this synthetic message.");
    expect(prompt.user).toContain("report.pdf");
    expect(prompt.user).not.toContain("application/pdf bytes");
    expect(prompt.truncated).toBe(false);
  });

  it("builds a suggest-rule prompt that asks for a candidate condition and action, not an executed one", () => {
    const prompt = buildAiPrompt("suggest-rule", { kind: "message", detail });
    expect(prompt.system).toContain("mail assistant");
    expect(prompt.user).toContain("Bedingung");
    expect(prompt.user).toContain("Aktion");
  });

  it("does not create a provider without an API key", () => {
    expect(readAiConfig({ HIMALAYA_AI_PROVIDER: "minimax", HIMALAYA_AI_MODEL: "MiniMax-M3" })).toBeNull();
  });

  it("reads only the supported MiniMax configuration shape", () => {
    const result = readAiConfig({
      HIMALAYA_AI_PROVIDER: "minimax",
      HIMALAYA_AI_BASE_URL: "https://api.minimax.io/v1",
      HIMALAYA_AI_MODEL: "MiniMax-M3",
      HIMALAYA_AI_API_KEY: "synthetic-api-key",
    });

    expect(result).toMatchObject({
      provider: "minimax",
      baseUrl: "https://api.minimax.io/v1",
      model: "MiniMax-M3",
    });
  });

  it("sends one OpenAI-compatible request and returns bounded text", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({ choices: [{ message: { content: "Synthetic summary" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await createMiniMaxProvider(config, fetchImpl).complete({ task: "summarize", source: { kind: "message", detail } });
    const headers = new Headers(requestInit?.headers);
    const body = JSON.parse(String(requestInit?.body)) as { model: string; max_tokens: number };

    expect(requestUrl).toBe("https://api.minimax.test/v1/chat/completions");
    expect(headers.get("authorization")).toBe("Bearer synthetic-api-key");
    expect(body).toMatchObject({ model: "MiniMax-M3", max_tokens: 4000 });
    expect(result).toEqual({ text: "Synthetic summary", truncated: false });
  });

  it("maps malformed and rejected provider responses to stable errors", async () => {
    const malformed = async (): Promise<Response> => new Response("not-json", { status: 200 });
    await expect(createMiniMaxProvider(config, malformed).complete({ task: "summarize", source: { kind: "message", detail } }))
      .rejects.toMatchObject({ code: "AI_PROVIDER_ERROR" });

    const rejected = async (): Promise<Response> => new Response("upstream failure", { status: 429 });
    await expect(createMiniMaxProvider(config, rejected).complete({ task: "summarize", source: { kind: "message", detail } }))
      .rejects.toMatchObject({ code: "AI_PROVIDER_ERROR", retryable: true });
  });

  it("rejects a completion without message text", async () => {
    const missingText = async (): Promise<Response> => new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 });

    await expect(createMiniMaxProvider(config, missingText).complete({ task: "summarize", source: { kind: "message", detail } }))
      .rejects.toMatchObject({ code: "AI_PROVIDER_ERROR" });
  });

  it("times out a provider request without retrying it", async () => {
    const slow = async (_input: string, init?: RequestInit): Promise<Response> => new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });

    await expect(createMiniMaxProvider({ ...config, timeoutMs: 1_000 }, slow).complete({ task: "summarize", source: { kind: "message", detail } }))
      .rejects.toMatchObject({ code: "AI_TIMEOUT", retryable: true });
  });

  it("marks long message input as truncated", () => {
    const prompt = buildAiPrompt("reply-draft", { kind: "message", detail: { ...detail, text: "x".repeat(70_000) } });

    expect(prompt.truncated).toBe(true);
    expect(prompt.user).toContain("[message content truncated]");
  });
});

describe("buildAiPrompt for polish-draft", () => {
  it("builds a German polishing prompt from the user's own draft text, not a MessageDetail", () => {
    const prompt = buildAiPrompt("polish-draft", { kind: "draft", draftText: "hi pls send me the file thx" });

    expect(prompt.system).toContain("Never send mail");
    expect(prompt.user).toContain("hi pls send me the file thx");
    expect(prompt.user.toLowerCase()).toContain("höflich");
    expect(prompt.truncated).toBe(false);
  });

  it("truncates an overlong draft the same way message content is truncated", () => {
    const prompt = buildAiPrompt("polish-draft", { kind: "draft", draftText: "x".repeat(70_000) });
    expect(prompt.truncated).toBe(true);
  });
});
