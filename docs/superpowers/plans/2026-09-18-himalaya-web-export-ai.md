# Mail Export and MiniMax Assist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe Markdown/PDF export and explicit MiniMax summary/reply-draft actions to the selected-message reader.

**Architecture:** Keep mail reading in `HimalayaService`, put Markdown rendering and AI provider logic in small server modules, and expose both through the existing authenticated Fastify app. MiniMax is called directly from the server using environment-backed configuration; the browser sends only a validated message reference and fixed task enum.

**Tech Stack:** TypeScript, React 19, Fastify 5, Zod, DOMPurify, mailparser, Vitest, Playwright, OpenAI-compatible HTTP chat completions.

**Spec:** `docs/superpowers/specs/2026-09-18-himalaya-web-export-ai-design.md`

## Global Constraints

- Keep user-facing UI text German; keep code, tests, and planning documents English.
- Never copy passwords, OAuth tokens, 1Password tokens, or keyring contents into source, tests, browser storage, logs, or Git.
- Use synthetic MIME data in automated tests and never send, delete, bulk-move, or tag real mail.
- Preserve loopback binding and the `X-Himalaya-Session` API session boundary.
- The client sends a message reference, never a client-supplied message body, to server export and AI endpoints.
- Do not use OpenCode as a runtime agent and do not fall back to OpenRouter Free for private mail.
- Do not add a binary server-side PDF renderer in this first slice; use the browser print-to-PDF path.

---

### Task 1: Add deterministic Markdown rendering

**Files:**
- Create: `src/server/export.ts`
- Create: `src/server/export.test.ts`

**Interfaces:**
- Consumes: `MessageDetail` and `MessageRef` from `src/shared/types.ts`.
- Produces: `renderMarkdown(detail: MessageDetail): string`, `exportFilename(detail: MessageDetail): string`, and a bounded HTML-to-text fallback used when `detail.text` is empty.

- [ ] **Step 1: Write failing renderer tests**

Create synthetic `MessageDetail` fixtures and assert:

```typescript
const markdown = renderMarkdown(detail);
expect(markdown).toContain("# Hello");
expect(markdown).toContain("From: Alice <alice@example.test>");
expect(markdown).toContain("## Attachments");
expect(markdown).toContain("report.pdf");
expect(exportFilename(detail)).toBe("2026-09-18-hello.md");
```

Add a separate HTML-only fixture with `<script>`, links, and entities; assert that the fallback contains readable text, excludes script content, and does not emit raw HTML tags. Assert that path separators and control characters in subjects become underscores in the filename.

- [ ] **Step 2: Run the renderer tests and verify they fail**

Run:

```bash
npm test -- src/server/export.test.ts
```

Expected: FAIL because the export module does not exist.

- [ ] **Step 3: Implement the minimal renderer**

Render stable metadata lines, a `## Body` section, and a `## Attachments` list. Prefer `detail.text`; otherwise convert only the supplied HTML into plain text by removing non-content tags, translating common block boundaries to newlines, decoding the basic HTML entities used by the parser, and collapsing excessive blank lines. Escape Markdown-sensitive metadata delimiters where needed. Normalize filenames to a maximum of 120 characters, replace `/`, `\\`, control characters, and `..`, and append `.md`.

- [ ] **Step 4: Run the renderer tests and verify they pass**

Run:

```bash
npm test -- src/server/export.test.ts
```

Expected: all renderer and filename tests PASS.

### Task 2: Expose Markdown export through the authenticated API

**Files:**
- Modify: `src/server/app.ts`
- Test: `src/server/app.test.ts`
- Modify: `src/server/contracts.ts`

**Interfaces:**
- Consumes: `HimalayaService.readRaw()`, `HimalayaService.listAttachments()`, `parseRawMessage()`, and `renderMarkdown()`.
- Produces: `GET /api/message/export` with `format=markdown`, `text/markdown; charset=utf-8`, `Cache-Control: no-store`, and a safe attachment filename.

- [ ] **Step 1: Write failing API tests**

Add tests that request `/api/message/export?account=andre&mailbox=INBOX&message=7&format=markdown` with the valid session and assert status `200`, Markdown content type, no-store cache control, attachment disposition, and synthetic subject/body/attachment content. Add tests for an invalid format and missing session.

- [ ] **Step 2: Run the focused API tests and verify the new route fails**

Run:

```bash
npm test -- src/server/app.test.ts
```

Expected: the new route test fails with `404` before implementation.

- [ ] **Step 3: Implement the route with existing reference validation**

Add a `format` enum to the validated query, call `readRaw()` and `listAttachments()` with the existing `MessageRef`, parse the detail, and send the rendered Markdown as an attachment. Do not log raw message content and do not accept a body containing message content.

- [ ] **Step 4: Run the API tests and verify they pass**

Run:

```bash
npm test -- src/server/app.test.ts src/server/export.test.ts
```

Expected: export, auth, and existing API tests PASS.

### Task 3: Build the MiniMax provider boundary and prompt contract

**Files:**
- Create: `src/server/ai.ts`
- Create: `src/server/ai.test.ts`

**Interfaces:**
- Consumes: a `MessageDetail`, `AiTask = "summarize" | "reply-draft"`, and environment configuration.
- Produces: `AiProvider`, `createMiniMaxProvider(config, fetchImpl)`, `buildAiPrompt(task, detail)`, `readAiConfig(env)`, and bounded completion text.

- [ ] **Step 1: Write failing prompt and configuration tests**

Assert that `buildAiPrompt("summarize", detail)` contains explicit untrusted-content delimiters, the task instruction, bounded headers/body/attachment metadata, and no attachment bytes. Assert that `readAiConfig()` returns `null` when the API key is absent and returns `baseUrl`, `model`, and provider `minimax` for a complete environment without exposing the key in the returned public metadata.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
npm test -- src/server/ai.test.ts
```

Expected: FAIL because the AI module does not exist.

- [ ] **Step 3: Write failing HTTP adapter tests**

Use an injected fake `fetch` implementation and assert that `createMiniMaxProvider()` posts to `baseUrl + "/chat/completions"` with the configured model, a bounded system message, a user message containing the synthetic content, and `max_tokens: 4000`. Assert that the bearer token is sent to the fake request but never appears in returned metadata or thrown errors. Add tests for non-OK responses, malformed JSON, missing choices/content, and an abort/timeout signal.

- [ ] **Step 4: Run the adapter tests and verify they fail**

Run:

```bash
npm test -- src/server/ai.test.ts
```

Expected: FAIL because the provider factory and completion method do not exist.

- [ ] **Step 5: Implement the minimal provider module**

Normalize message input to 64,000 characters with a `[message content truncated]` marker, build task-specific German instructions, and issue one OpenAI-compatible JSON request. Validate the response shape with Zod, trim the result, cap it at a safe output length, and throw typed `HimalayaError` values for missing configuration, timeout, upstream rejection, malformed JSON, or missing text. Do not retry automatically and do not log request or response bodies.

- [ ] **Step 6: Run the provider tests and verify they pass**

Run:

```bash
npm test -- src/server/ai.test.ts
```

Expected: all prompt, configuration, HTTP, truncation, and failure tests PASS.

### Task 4: Add the authenticated AI endpoint and runtime limits

**Files:**
- Modify: `src/server/app.ts`
- Modify: `src/server/index.ts`
- Test: `src/server/app.test.ts`
- Test: `src/server/ai.test.ts`

**Interfaces:**
- Consumes: `AiProvider`, `buildAiPrompt()`, `HimalayaService.readRaw()`, `parseRawMessage()`, and the existing session hook.
- Produces: `POST /api/ai/assist` accepting `{ref, task}` and returning `{task, text, provider, model, truncated}`.

- [ ] **Step 1: Write failing endpoint tests**

Add an injected fake AI provider and assert that a valid authenticated request reads the synthetic message through the service, calls the provider exactly once, and returns the bounded result. Add tests that invalid tasks, invalid references, missing session, missing provider, and a second concurrent request return their specified status/code without calling the provider.

- [ ] **Step 2: Run the endpoint tests and verify they fail**

Run:

```bash
npm test -- src/server/app.test.ts
```

Expected: FAIL with `404` for the new endpoint and no provider call.

- [ ] **Step 3: Implement provider injection and endpoint validation**

Extend `AppOptions` with an optional AI assistant dependency. Parse the request with Zod, read the raw selected message with an abort-aware signal, parse it, and call the provider. Add an in-memory per-session in-flight set and cooldown timestamp keyed by the already validated session token. Return stable German errors for unavailable configuration, timeout, concurrency, and upstream failure. Keep all existing API routes and session/origin checks unchanged.

- [ ] **Step 4: Wire MiniMax from environment without copying secrets**

In `src/server/index.ts`, call `readAiConfig(process.env)` and create the provider only when configuration is complete. Pass the provider into `createApp`; otherwise pass no provider. Add `deploy/systemd/himalaya-web.env.example` containing only variable names and comments, and update the service template to reference an external optional environment file under `%h/.config/himalaya-web/ai.env`.

- [ ] **Step 5: Run endpoint and type tests**

Run:

```bash
npm test -- src/server/app.test.ts src/server/ai.test.ts
npm run typecheck
```

Expected: all endpoint/provider tests and TypeScript checks PASS without any real MiniMax request.

### Task 5: Add client Markdown, print-to-PDF, and AI actions

**Files:**
- Modify: `src/client/main.tsx`
- Modify: `src/client/styles.css`
- Create: `src/client/message-actions.ts`
- Create: `src/client/message-actions.test.ts`

**Interfaces:**
- Consumes: `MessageDetail`, `MessageRef`, the sanitized HTML string produced by the existing `DOMPurify` boundary, `POST /api/ai/assist`, and `GET /api/message/export`.
- Produces: reader actions `Markdown herunterladen`, `Als PDF drucken`, `Zusammenfassen`, and `Antwortentwurf` with loading, success, dismiss, unavailable, and popup-blocked states.

- [ ] **Step 1: Write failing client helper tests**

Test pure helpers for safe Markdown download URL construction, print document generation, and AI task labels. Assert that print HTML contains escaped metadata, sanitized HTML only, a text fallback, and print CSS; assert that no helper writes message content to `localStorage`.

- [ ] **Step 2: Run the focused client tests and verify they fail**

Run:

```bash
npm test -- src/client/message-actions.test.ts
```

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement pure client helpers**

Implement exact helpers such as `messageExportUrl(ref)` and `buildPrintDocument(detail, sanitizedHtml)`. Use the selected `MessageRef` to construct the Markdown endpoint URL. Build the print document from the current `MessageDetail` and the already sanitized HTML string from `main.tsx`; escape plain text with a detached DOM element. Keep the document in a new window or short-lived Blob URL only.

- [ ] **Step 4: Run helper tests and verify they pass**

Run:

```bash
npm test -- src/client/message-actions.test.ts
```

Expected: all helper tests PASS.

- [ ] **Step 5: Add reader actions and AI state**

Add toolbar buttons beside the existing move/read controls. Use an object URL and synthetic anchor for Markdown download, open the print view and call `print()` after load, and post only `{ref, task}` for AI. Disable duplicate AI clicks, show a dismissible result panel, display the server truncation notice, and clear the result when the selected message changes.

- [ ] **Step 6: Add theme-safe styles and run the client build**

Style the action group, result panel, loading state, and print document using existing semantic variables and focus rules. Run:

```bash
npm test -- src/client/message-actions.test.ts
npm run typecheck
npm run build
```

Expected: all client tests PASS and both typecheck/build exit successfully.

### Task 6: Add deterministic browser coverage and update project docs

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/mail-actions.spec.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `HANDOFF.md`

**Interfaces:**
- Consumes: the built application, synthetic API route fixtures, and the reader action labels.
- Produces: repeatable browser evidence for export and explicit AI behavior plus current setup/documentation.

- [ ] **Step 1: Write the failing browser checks**

Intercept bootstrap, mailbox, envelope, message, export, and AI routes with synthetic data. Assert that selecting a message does not call the AI route; clicking `Zusammenfassen` calls it once and renders the synthetic result; clicking `Markdown herunterladen` receives a Markdown attachment; and clicking `Als PDF drucken` handles a controlled popup/print stub without a console error.

- [ ] **Step 2: Run the browser check and verify missing behavior**

Run:

```bash
npx playwright test tests/e2e/mail-actions.spec.ts
```

Expected: FAIL until the reader controls and routes are implemented; the Playwright configuration starts the local app on port `47832` after a build.

- [ ] **Step 3: Configure and implement the deterministic browser fixture**

Configure `playwright.config.ts` with `testDir: "tests/e2e"`, a `webServer` command that runs `npm run build && HIMALAYA_WEB_PORT=47832 npm run dev`, and `url: "http://127.0.0.1:47832/"`. Intercept bootstrap, mailbox, envelope, message, export, and AI routes with only synthetic accounts and messages. Do not point the test at the live Himalaya service, and do not store message contents in a browser persistence API.

- [ ] **Step 4: Run the browser check and verify it passes**

Run:

```bash
npx playwright test tests/e2e/mail-actions.spec.ts
```

Expected: the export/AI browser check passes with no real provider request.

- [ ] **Step 5: Update user and operator documentation**

Document the two export actions, the MiniMax environment variables, the external environment-file location, the fact that the AI is explicit and non-sending, and the need to configure MiniMax outside Git. Add the user-visible change to `CHANGELOG.md` and record verification plus any deployment pending in `HANDOFF.md`.

- [ ] **Step 6: Run the complete verification suite**

Run:

```bash
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
npx playwright test tests/e2e/mail-actions.spec.ts
```

Expected: all commands exit `0`; the test output contains no real provider call and no secret material.
