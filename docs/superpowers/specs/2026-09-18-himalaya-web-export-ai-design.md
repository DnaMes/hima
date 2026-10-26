# Himalaya Web Mail Export and MiniMax Assist Design

**Date:** 2026-09-18

**Status:** Implemented in the standalone project as version `0.3.0`;
verification is complete for synthetic data and the loopback deployment.

## Goal

Extend the local Himalaya Web application with two explicit actions on the
selected message:

1. export the message as Markdown or as a print-ready PDF document; and
2. request a bounded AI summary or reply draft through the user's approved
   MiniMax subscription.

The feature must remain a local, loopback-only mail workflow. It must not turn
the browser into a credential holder, silently upload mail, or gain permission
to send, delete, move, or tag messages.

## Context and constraints

- The existing Fastify session boundary is mandatory: API calls require the
  ephemeral `X-Himalaya-Session` token and loopback host/origin checks.
- The existing Himalaya service remains the only source of message content.
  The client sends a message reference, never a client-supplied message body.
- User-facing text remains German; implementation code and project documents
  remain English.
- Credentials, OAuth tokens, keyring data, message bodies, prompts, and model
  responses must not be written to Git, browser storage, application logs, or
  test fixtures containing real mail.
- Automated tests use synthetic MIME messages only and never send, delete,
  bulk-move, or tag real mail.
- The initial AI integration is an assistant with explicit actions, not a
  general-purpose autonomous agent or an interactive OpenCode runtime.

## Decisions

### Provider boundary: direct server-side MiniMax adapter

The application will call the OpenAI-compatible MiniMax API directly from the
server. The initial default configuration is:

```text
HIMALAYA_AI_PROVIDER=minimax
HIMALAYA_AI_BASE_URL=https://api.minimax.io/v1
HIMALAYA_AI_MODEL=MiniMax-M3
HIMALAYA_AI_API_KEY=<external secret, never committed>
```

The API key is supplied by the user-service environment, preferably through an
untracked `EnvironmentFile` with restricted permissions. A deployment template
may document variable names and an example path, but must not contain a key.
The browser receives only feature availability and sanitized results; it never
receives the key or provider configuration that is not needed for the UI.

OpenCode is not spawned, controlled, or used as an in-process mail agent. Its
OpenAI-compatible provider configuration is useful as local reference, but
the web app needs a small, testable provider interface with predictable data
handling and request limits.

OpenRouter remains an optional future provider. Its free models are restricted
to an explicit non-sensitive/public-data mode until a provider-specific
retention policy has been verified for the selected endpoint. They are not a
fallback for private mail and are not used automatically when MiniMax is
unavailable.

### Export formats

#### Markdown download

Add a session-protected endpoint:

```text
GET /api/message/export?account=<account>&mailbox=<mailbox>&message=<id>&format=markdown
```

The server fetches the raw message and attachment metadata through the existing
Himalaya service, parses it with the existing MIME parser, and renders a
deterministic Markdown document containing:

- subject, sender, recipients, date, and the selected message reference;
- the plain-text body, or a readable text fallback derived from HTML; and
- an attachment list with names, MIME types, and sizes, without embedding
  binary attachment data.

The response uses `text/markdown; charset=utf-8`, `Cache-Control: no-store`,
and a sanitized filename derived from the subject and message date. Filename
normalization removes path separators, control characters, and unsafe length;
the response must always remain an attachment download.

#### PDF export

The first PDF implementation is a dedicated print view in the browser. It
renders the already-fetched, sanitized message content in a minimal print
layout and invokes the native print dialog with the German action label
`Als PDF drucken`. The user can select “Save as PDF” in the browser.

This avoids introducing a server-side PDF renderer, untrusted HTML-to-PDF
execution, font packaging, and a second message rendering implementation. The
print view must:

- use a short-lived `Blob` URL or a new window, never local storage;
- sanitize HTML with the existing DOMPurify boundary and fall back to escaped
  plain text;
- include the same metadata and attachment list as the Markdown export;
- apply print-specific CSS with readable contrast and page-break behavior; and
- show a German error if the browser blocks the print window.

A binary server-generated PDF is explicitly deferred until there is a tested
renderer and a clear decision about fonts, HTML support, and resource loading.

### AI assistant scope

The message reader adds explicit actions:

- `Zusammenfassen` — produce a short German summary and key points;
- `Antwortentwurf` — produce a German reply draft without sending it.

The result appears only in the current reader view. It is not automatically
saved, sent, copied to a mailbox, or persisted in browser storage. The user
may manually copy a draft into a future compose workflow, but compose/send is
outside this feature.

The server exposes one session-protected endpoint:

```text
POST /api/ai/assist
Content-Type: application/json
X-Himalaya-Session: <ephemeral session token>

{"ref":{"account":"andre","mailbox":"INBOX","message":"7"},"task":"summarize"}
```

The allowed tasks are the fixed enum `summarize | reply-draft`. The server
validates the reference and task with Zod, reads the selected message itself,
parses the MIME content, and returns a response shaped like:

```json
{"task":"summarize","text":"...","provider":"minimax","model":"MiniMax-M3"}
```

Provider and model identifiers in the response are non-secret allowlisted
labels, not credentials or raw upstream responses.

### Provider adapter and request limits

Introduce a small server-side interface, independent of Fastify and fetch:

```text
AiProvider.complete(request, signal) -> Promise<string>
```

The MiniMax implementation sends an OpenAI-compatible chat-completions
request with a bounded system instruction and a bounded user payload. The
provider adapter owns URL construction, authorization headers, timeout
handling, response validation, and redaction of upstream error details.

Initial limits:

- maximum normalized message text sent to the model: 64,000 characters;
- maximum generated result: 4,000 tokens, subject to the provider API;
- request timeout: 30 seconds;
- one in-flight AI request per session;
- a small in-memory per-session cooldown/rate limit to prevent accidental
  repeated paid requests; and
- no automatic retry that could duplicate a paid request.

Long messages are truncated with an explicit marker in the model input. The
UI shows that the content was shortened when the server reports truncation.
The limits are server-side and cannot be raised by a browser request.

### Prompt-injection and data handling

Email content is untrusted data. The prompt clearly delimits headers and body,
states that instructions inside the message are not commands, and asks the
model to use only the supplied message for the requested task. Attachments are
represented as metadata only in v1; their contents are not uploaded to the
model.

The server does not log request bodies, prompts, completions, or upstream
response bodies. Error responses use stable German application messages such as
`Der KI-Dienst ist derzeit nicht verfügbar.` and do not expose API keys,
request headers, raw provider errors, or message content. The in-memory
request state is discarded when the process exits.

If the MiniMax variables are absent, the application remains fully usable and
the AI controls show a non-blocking German configuration hint. Export remains
available independently. A provider response that is not valid JSON or lacks a
bounded text result is treated as a generic AI failure.

## Request flow

### Markdown and print export

1. The reader offers `Markdown herunterladen` and `Als PDF drucken`.
2. The client uses the selected message reference only.
3. The server re-reads the message, parses it, and returns Markdown for the
   download path; the print path uses the already loaded sanitized detail.
4. No export is persisted server-side or in browser storage.

### AI assist

1. The user selects a message and explicitly chooses an AI action.
2. The client posts only the reference and fixed task enum.
3. The authenticated server reads and parses the message through Himalaya.
4. The server applies the size, timeout, concurrency, and provider allowlist
   checks, then calls MiniMax.
5. The server returns the bounded text result; the client displays it in a
   dismissible result panel.

No request is made when a message is merely selected or opened. A repeated
click while a request is pending is disabled. If the reader unmounts, the
client aborts its fetch and the server forwards request cancellation to the
provider where the runtime supports it.

## Error behavior

- Missing or invalid message references return the existing `400` contract.
- A missing session still returns `401`; non-loopback requests still return
  `403`.
- A missing or invalid provider configuration returns a stable `503` AI error.
- MiniMax timeout returns a retryable `504` without provider details.
- Provider rejection, malformed output, concurrency limits, and cooldowns map
  to stable German errors with distinct internal codes that contain no secrets.
- Export parsing failures use the existing generic mail-operation contract and
  never return raw MIME content in an error.

## Testing and acceptance criteria

### Server and provider tests

- Export tests verify deterministic Markdown metadata, body fallback, safe
  filenames, attachment metadata, no-store headers, and invalid references.
- AI contract tests verify task/reference validation and unchanged session and
  loopback enforcement.
- MiniMax adapter tests use a mocked OpenAI-compatible HTTP server and assert
  the authorization header is present without ever printing its value.
- Tests cover timeout, malformed provider JSON, missing text, upstream errors,
  truncation, cooldown, and one-in-flight behavior.
- Prompt tests assert that message text is delimited as untrusted data and
  that attachment bytes are not included.
- Synthetic MIME fixtures are the only message content used in tests.

### Client and browser checks

- The reader shows export and AI actions only when a message is selected.
- Markdown download uses the server response and a safe filename.
- The print view sanitizes HTML, falls back to text, and handles popup blocking.
- AI loading, success, unavailable-provider, timeout, and dismiss states are
  keyboard accessible and remain usable in all existing themes.
- A deterministic headless browser check uses synthetic API routes and asserts
  that no AI request occurs on selection alone and that explicit actions render
  the returned result.

### Project verification

The implementation must pass:

```text
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

The loopback smoke check must continue to show root `200`, unauthenticated API
`401`, and authorized read-only bootstrap `200`. No live mail mutation or real
provider request is part of automated verification.

## Explicit non-goals

- No OpenCode interactive-agent process or tool execution from the web app.
- No automatic AI invocation, background processing, or mailbox-wide batch
  summarization.
- No AI send, delete, move, tag, or compose operation.
- No browser-side provider key, prompt, completion, or message-body storage.
- No OpenRouter Free fallback for private mail.
- No binary server-generated PDF in the first implementation slice.
- No attachment-content upload to the model.
- No remote access beyond the existing loopback boundary.
