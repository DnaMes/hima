# Gmail Provider Error Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve actionable Himalaya provider failures and show German Gmail authentication guidance instead of the generic mail-operation error.

**Architecture:** Keep the Himalaya CLI boundary unchanged, but parse the structured JSON error that Himalaya emits on stdout when a command exits non-zero. Map known Gmail authentication failures to stable, non-secret application messages and retain a safe generic provider error for other failures. The Fastify API continues to enforce the existing loopback and session boundary.

**Tech Stack:** TypeScript, Fastify, Zod, Vitest, Himalaya v2.1.0.

**Spec:** The root-cause evidence recorded in `HANDOFF.md` and the approved project constraints in `AGENTS.md`.

## Global Constraints

- Keep user-facing UI text German; keep code, tests, and planning documents English.
- Never copy passwords, OAuth tokens, 1Password tokens, or keyring contents into source, tests, browser storage, logs, or Git.
- Use synthetic command results in automated tests; do not authenticate against or mutate real mail during tests.
- Preserve loopback binding and the `X-Himalaya-Session` API session boundary.
- Fix the root cause in provider-error handling rather than hiding it with a client-only message.

---

### Task 1: Lock the failing provider-error behavior with tests

**Files:**
- Modify: `src/server/himalaya.test.ts`
- Test: `src/server/himalaya.test.ts`

**Interfaces:**
- Consumes: the existing `CommandRunner` test double and `HimalayaCli.listMailboxes()`.
- Produces: regression cases proving that structured Himalaya JSON failures become actionable `HimalayaError` values without exposing raw secret fields.

- [ ] **Step 1: Write the failing test for the Gmail app-password failure**

Add a test that configures `RecordingRunner.response` as a non-zero command result with stdout:

```json
{"error":"IMAP AUTHENTICATE PLAIN failed: NO Application-specific password required: https://support.google.com/accounts/answer/185833","sources":[],"backtrace":null}
```

Call `new HimalayaCli(runner).listMailboxes("gmail")` and assert that the rejected error has a stable authentication code and German guidance containing `App-Passwort`. Assert that the error text does not contain `password.command`, `token`, or a raw secret value.

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```bash
npm test -- src/server/himalaya.test.ts
```

Expected: the new test fails because `requireSuccess()` currently returns the English generic `PROVIDER_ERROR` message.

- [ ] **Step 3: Write the failing test for disabled Basic authentication**

Add a separate test with the structured error:

```json
{"error":"IMAP AUTHENTICATE PLAIN failed: NO Basic authentication is disabled.","sources":[],"backtrace":null}
```

Assert a stable authentication code and German guidance containing `OAuth2` or `App-Passwort`, while retaining the existing retryable flag as `false` for a configuration/authentication failure.

- [ ] **Step 4: Run the focused test and verify it fails for the same root cause**

Run:

```bash
npm test -- src/server/himalaya.test.ts
```

Expected: the new test fails with the current generic provider error.

### Task 2: Implement safe structured provider-error mapping

**Files:**
- Create: `src/server/provider-errors.ts`
- Test: `src/server/provider-errors.test.ts`
- Modify: `src/server/himalaya.ts`
- Test: `src/server/himalaya.test.ts`

**Interfaces:**
- Consumes: `CommandResult` from `src/server/himalaya.ts` and structured Himalaya JSON error output.
- Produces: `providerError(result: CommandResult): HimalayaError`, with stable codes/messages for known authentication failures and a bounded generic message otherwise.

- [ ] **Step 1: Write focused unit tests for the pure mapper**

Create tests for `providerError()` covering:

```typescript
expect(providerError(failedWith("...Application-specific password required..."))).toMatchObject({
  code: "AUTH_REQUIRED",
  retryable: false,
});
expect(providerError(failedWith("...Basic authentication is disabled..."))).toMatchObject({
  code: "AUTH_REQUIRED",
  retryable: false,
});
expect(providerError(failedWith("Temporary provider failure"))).toMatchObject({
  code: "PROVIDER_ERROR",
  retryable: true,
});
```

Also test that malformed stdout and a non-JSON stderr never throw a parser error, never return an empty message, and never include `password`, `token`, or `secret` field contents.

- [ ] **Step 2: Run the mapper tests and verify they fail**

Run:

```bash
npm test -- src/server/provider-errors.test.ts
```

Expected: FAIL because `src/server/provider-errors.ts` does not exist.

- [ ] **Step 3: Implement the minimal mapper**

Implement a pure parser that:

1. decodes `stdout` as UTF-8 and reads only a top-level string `error` from JSON;
2. uses the raw text only for pattern matching, never for secrets or logs;
3. maps `Application-specific password required` and `Basic authentication is disabled` to the German message `Gmail benötigt ein App-Passwort oder eine OAuth2-Anmeldung. Prüfe die Zugangsdaten dieses Kontos.` with code `AUTH_REQUIRED` and `retryable: false`;
4. maps all other non-zero results to `Der Mail-Provider hat die angeforderte Operation abgelehnt.` with code `PROVIDER_ERROR` and `retryable: true`; and
5. truncates any internal candidate string before pattern matching so a provider cannot create an unbounded error object.

- [ ] **Step 4: Run the mapper tests and verify they pass**

Run:

```bash
npm test -- src/server/provider-errors.test.ts
```

Expected: all mapper tests PASS.

- [ ] **Step 5: Route all non-zero CLI results through the mapper**

Replace the body of `requireSuccess()` in `src/server/himalaya.ts` with a call to `providerError(result)` while keeping the existing successful stdout behavior. Ensure JSON parsing still receives the successful stdout buffer unchanged.

- [ ] **Step 6: Run the Himalaya regression tests**

Run:

```bash
npm test -- src/server/himalaya.test.ts src/server/provider-errors.test.ts
```

Expected: the Gmail app-password, Basic-authentication, generic failure, and existing command-shape tests PASS.

### Task 3: Verify API presentation and documentation

**Files:**
- Modify: `src/server/app.ts`
- Test: `src/server/app.test.ts`
- Modify: `README.md`
- Modify: `HANDOFF.md`

**Interfaces:**
- Consumes: `HimalayaError` codes from Task 2 and the existing Fastify error handler.
- Produces: an authenticated API response that exposes only the stable German message/code/retryability fields.

- [ ] **Step 1: Write the failing API test**

Create a fake service whose `listMailboxes()` throws `new HimalayaError("Gmail benötigt ein App-Passwort oder eine OAuth2-Anmeldung. Prüfe die Zugangsdaten dieses Kontos.", "AUTH_REQUIRED", false)`. Request the mailbox endpoint with the valid local session and assert status `502`, code `AUTH_REQUIRED`, German message, and `retryable: false`.

- [ ] **Step 2: Run the focused API test**

Run:

```bash
npm test -- src/server/app.test.ts
```

Expected: the test passes if the existing error handler preserves the structured error; if it fails, adjust only the error-status mapping needed for `AUTH_REQUIRED` and rerun.

- [ ] **Step 3: Verify the browser-facing contract and docs**

Confirm the client `api()` helper already renders `ApiError.error` and does not need to know provider internals. Document in `README.md` that a Gmail account still needs an app password or OAuth2 token configured in Himalaya; the web app does not create or store those credentials. Update `HANDOFF.md` with the observed root cause and the stable error mapping.

- [ ] **Step 4: Run the regression suite**

Run:

```bash
npm test
npm run typecheck
```

Expected: all existing and new tests pass with no TypeScript errors.
