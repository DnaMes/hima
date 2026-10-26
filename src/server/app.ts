import fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import { timingSafeEqual } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { UNIFIED_INBOX_MAX_PAGE, type Attachment, type Envelope, type MessageDetail, type MessageRef } from "../shared/types.js";
import type { AiProvider } from "./ai.js";
import { ATTACHMENT_LIMITS, composeRequestSchema, type ComposeRequest } from "./compose.js";
import { hasSearchCriteria, isoDateSchema, messageRef, type SearchInput } from "./contracts.js";
import { exportFilename, renderMarkdown } from "./export.js";
import { HimalayaError, type HimalayaService } from "./himalaya.js";
import { parseRawMessage } from "./mime.js";
import { createOutbox } from "./outbox.js";
import { createWatcher, type Watcher } from "./watcher.js";
import {
  defaultSentCopyMode,
  readAccountsConfig,
  resolveSpecialFolder,
  writeAccountFolderSettings,
} from "./special-folders.js";
import { findJunkMailbox, resolveSources } from "./search-scope.js";
import { previewRule, readStoredRules, ruleSchema, rulesSchema, writeStoredRules } from "./rules-store.js";
import { createSenderStore } from "./senders.js";
import { createLabelStore } from "./labels.js";
import { createSnoozeStore } from "./snooze.js";
import type { Warmer } from "./warmer.js";
import { listSources, listUnifiedInbox } from "./unified-inbox.js";

export type AppOptions = {
  token: string;
  staticDir?: string;
  ai?: AiProvider;
  widgetToken?: string;
  notify?: (title: string, body: string) => void;
  watchIntervalMs?: number;
  /** Where the trusted/reported sender lists live; defaults to ~/.config/himalaya-web/senders.json. */
  sendersPath?: string;
  /** Where snoozed messages are remembered; defaults to ~/.config/himalaya-web/snoozed.json. */
  snoozePath?: string;
  /** Where local message labels live; defaults to ~/.config/himalaya-web/labels.json. */
  labelsPath?: string;
  /** Keeps the first unified inbox page warm while the GUI is in use. */
  warmer?: Warmer;
  /** The mail watcher must see current mail even when `service` may answer from a stale cache. */
  watchService?: HimalayaService;
  /** Where rules.json lives; defaults to ~/.config/himalaya-web/rules.json. */
  rulesPath?: string;
};

const refQuerySchema = z.object({
  account: z.string().min(1).max(512),
  mailbox: z.string().min(1).max(512),
  message: z.string().min(1).max(512),
});

const exportQuerySchema = z.object({
  ...refQuerySchema.shape,
  format: z.literal("markdown"),
});

const aiBodySchema = z.discriminatedUnion("task", [
  z.object({ task: z.enum(["summarize", "reply-draft", "suggest-rule"]), ref: refQuerySchema }),
  z.object({ task: z.literal("polish-draft"), draftText: z.string().min(1).max(64_000) }),
]);

const filterShape = {
  from: isoDateSchema.optional(),
  until: isoDateSchema.optional(),
  flag: z.enum(["flagged", "seen", "unseen", "answered"]).optional(),
  order: z.enum(["desc", "asc"]).default("desc"),
};
const validRange = (value: { from?: string | undefined; until?: string | undefined }): boolean =>
  !value.from || !value.until || value.from <= value.until;

const messageListQuerySchema = z.object({
  mailbox: z.string().min(1).max(512),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  field: z.enum(["all", "subject", "from", "to", "body"]).default("all"),
  q: z.string().max(512).default(""),
  unread: z.enum(["true", "false"]).default("false"),
  ...filterShape,
}).refine(validRange, "from must not be after until");

const accountAliasSchema = z.string().min(1).max(512).refine((alias) => !alias.includes("\u0000"));

const unifiedInboxBodySchema = z.object({
  accounts: z.array(accountAliasSchema).max(100),
  page: z.number().int().min(1).max(UNIFIED_INBOX_MAX_PAGE).default(1),
  pageSize: z.number().int().min(1).max(50).default(50),
  field: messageListQuerySchema.shape.field,
  q: z.string().max(512).default(""),
  unread: z.boolean().default(false),
  ...filterShape,
}).refine(validRange, "from must not be after until");

const searchBodySchema = z.object({
  scope: z.enum(["folder", "account", "all"]),
  accounts: z.array(accountAliasSchema).max(100).default([]),
  account: accountAliasSchema.optional(),
  mailbox: z.string().min(1).max(512).optional(),
  includeJunk: z.boolean().default(false),
  page: z.number().int().min(1).max(UNIFIED_INBOX_MAX_PAGE).default(1),
  pageSize: z.number().int().min(1).max(50).default(50),
  field: messageListQuerySchema.shape.field,
  q: z.string().max(512).default(""),
  unread: z.boolean().default(false),
  hasAttachment: z.boolean().default(false),
  ...filterShape,
}).refine(validRange, "from must not be after until")
  .refine((body) => body.scope !== "folder" || (body.account !== undefined && body.mailbox !== undefined), "The folder scope needs account and mailbox.")
  .refine((body) => body.scope !== "account" || body.account !== undefined, "The account scope needs an account.")
  .refine((body) => body.scope !== "all" || body.accounts.length > 0, "The all scope needs at least one account.");

function toSearch(input: {
  field: SearchInput["field"]; q: string; unread: boolean;
  from?: string | undefined; until?: string | undefined; flag?: SearchInput["flag"] | undefined; order: "desc" | "asc";
}): SearchInput | undefined {
  const candidate: SearchInput = {
    field: input.field,
    text: input.q,
    unread: input.unread,
    ...(input.from ? { from: input.from } : {}),
    ...(input.until ? { until: input.until } : {}),
    ...(input.flag ? { flag: input.flag } : {}),
    ...(input.order === "asc" ? { order: "asc" as const } : {}),
  };
  return hasSearchCriteria(candidate) ? candidate : undefined;
}

const seenBodySchema = z.object({
  ref: refQuerySchema,
  seen: z.boolean(),
});

const moveBodySchema = z.object({
  ref: refQuerySchema,
  destination: z.string().min(1).max(512),
});

const copyBodySchema = z.object({
  ref: refQuerySchema,
  destination: z.object({ account: z.string().min(1).max(512), mailbox: z.string().min(1).max(512) }),
}).refine(
  (body) => body.ref.account !== body.destination.account || body.ref.mailbox !== body.destination.mailbox,
  "A copy needs a different account or mailbox than the message's own.",
);

const senderStatusBodySchema = z.object({
  email: z.string().min(1).max(512),
  status: z.enum(["trusted", "blocked"]).nullable(),
});

const snoozeBodySchema = z.object({ ref: refQuerySchema, until: z.string().datetime(), subject: z.string().max(300).optional() });
const snoozeCancelBodySchema = z.object({ ref: refQuerySchema });
const labelsBodySchema = z.object({ ref: refQuerySchema, labels: z.array(z.string().max(200)).max(20) });

const rulesBodySchema = z.object({ rules: rulesSchema });
const rulePreviewBodySchema = z.object({ rule: ruleSchema });

const reportBodySchema = z.object({ ref: refQuerySchema });

const deleteBodySchema = z.object({ ref: refQuerySchema, confirmPermanent: z.boolean().optional() });

const specialFoldersBodySchema = z.object({
  overrides: z.object({
    sent: z.string().max(512).optional(),
    drafts: z.string().max(512).optional(),
    trash: z.string().max(512).optional(),
  }),
  sentCopy: z.enum(["auto", "none"]),
});

function validToken(request: FastifyRequest, token: string): boolean {
  const supplied = request.headers["x-himalaya-session"];
  if (typeof supplied !== "string") return false;
  const expected = Buffer.from(token);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function loopbackHost(value: string | undefined): boolean {
  if (!value) return false;
  const host = value.replace(/^\[/, "").replace(/\](:\d+)?$/, "").split(":")[0];
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function loopbackOrigin(value: string | undefined): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && loopbackHost(url.host);
  } catch {
    return false;
  }
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function errorResponse(error: unknown, reply: FastifyReply): void {
  if (error instanceof z.ZodError) {
    reply.code(400).send({ error: "Die Anfrage ist ungültig.", code: "INVALID_REQUEST" });
    return;
  }
  if (error instanceof HimalayaError) {
    const status = error.code === "TIMEOUT" || error.code === "AI_TIMEOUT"
      ? 504
      : error.code === "INVALID_INPUT" || error.code === "INVALID_REQUEST"
        ? 400
        : error.code === "AI_UNAVAILABLE"
          ? 503
          : error.code === "AI_BUSY" || error.code === "AI_RATE_LIMIT"
            ? 429
            : error.code === "OUTBOX_NOT_FOUND" || error.code === "FOLDER_NOT_FOUND"
              ? 404
              : error.code === "CONFIRM_REQUIRED"
                ? 409
                : 502;
    reply.code(status).send({ error: error.message, code: error.code, retryable: error.retryable });
    return;
  }
  reply.code(500).send({ error: "Die Mail-Operation ist fehlgeschlagen.", code: "INTERNAL_ERROR" });
}

function refFromQuery(query: unknown): MessageRef {
  const parsed = refQuerySchema.parse(query);
  return messageRef(parsed.account, parsed.mailbox, parsed.message);
}

export async function createApp(service: HimalayaService, options: AppOptions): Promise<FastifyInstance> {
  const app = fastify({ logger: false });
  const aiInFlight = new Set<string>();
  const aiLastRequest = new Map<string, number>();
  const AI_COOLDOWN_MS = 1_500;

  const outbox = createOutbox();
  const senderStore = createSenderStore(options.sendersPath);
  const snoozeStore = createSnoozeStore(options.snoozePath);
  const labelStore = createLabelStore(options.labelsPath);
  // Best effort: the move or delete already happened, so a failing labels file must not turn it into an error.
  const forgetLabels = async (ref: { account: string; mailbox: string; message: string }): Promise<void> => {
    try {
      await labelStore.set(ref, []);
    } catch {
      process.stderr.write("[labels] could not update labels.json after a move or delete\n");
    }
  };
  const parseMessage = async (raw: Buffer, attachments: Attachment[], ref: MessageRef): Promise<MessageDetail> =>
    parseRawMessage(raw, attachments, ref, { senders: await senderStore.lists() });
  const watcher: Watcher = createWatcher({
    service: options.watchService ?? service,
    senders: senderStore,
    notify: options.notify ?? (() => {}),
    ...(options.watchIntervalMs !== undefined ? { intervalMs: options.watchIntervalMs } : {}),
  });
  watcher.start();
  const withRisk = (account: string, mailbox: string, envelopes: Envelope[]): Envelope[] =>
    envelopes.map((envelope) => {
      const risk = watcher.riskFor({ account, mailbox, message: envelope.id });
      return risk ? { ...envelope, risk } : envelope;
    });
  const withSourceRisk = (envelopes: Envelope[]): Envelope[] =>
    envelopes.map((envelope) =>
      envelope.source ? withRisk(envelope.source.account, envelope.source.mailbox, [envelope])[0]! : envelope);
  const pendingCleanups = new Map<string, () => Promise<void>>();
  app.addHook("onClose", async () => {
    watcher.stop();
    options.warmer?.stop();
    outbox.dispose();
    const cleanups = [...pendingCleanups.values()];
    pendingCleanups.clear();
    await Promise.all(cleanups.map((cleanup) => cleanup()));
  });
  await app.register(multipart, {
    limits: {
      fileSize: ATTACHMENT_LIMITS.maxTotalBytes,
      files: ATTACHMENT_LIMITS.maxCount,
      fields: 10,
      fieldSize: 4_194_304,
    },
  });

  app.addHook("onRequest", async (request, reply) => {
    let pathname: string;
    try {
      const parsed = new URL(request.url, "http://127.0.0.1").pathname;
      pathname = decodeURIComponent(parsed);
      if (pathname.includes("\0")) throw new Error("null byte");
    } catch {
      await reply.code(400).send({ error: "Ungültige URL.", code: "BAD_REQUEST" });
      return;
    }

    if (!loopbackHost(request.headers.host) || !loopbackOrigin(request.headers.origin)) {
      await reply.code(403).send({ error: "Lokaler Zugriff erforderlich.", code: "LOCAL_ONLY" });
      return;
    }

    if (!pathname.startsWith("/api/")) return;
    const isWatchSummary = pathname.startsWith("/api/watch/summary");
    const widgetAuthorized = isWatchSummary && options.widgetToken !== undefined
      && validToken(request, options.widgetToken);
    if (!validToken(request, options.token) && !widgetAuthorized) {
      await reply.code(401).send({ error: "Die lokale Sitzung ist nicht autorisiert.", code: "UNAUTHORIZED" });
      return;
    }
    // Timers poll (the widget, and the open GUI refreshing snoozed mail); only a person using the GUI counts as use.
    if (!isWatchSummary && !pathname.startsWith("/api/snoozed")) options.warmer?.touch();
  });

  app.setErrorHandler((error, _request, reply) => errorResponse(error, reply));

  app.get("/api/bootstrap", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    // Snoozed mail rides along so the first list can already hide it.
    return reply.send({ ...await service.listAccounts(), snoozed: await snoozeStore.active(), labels: await labelStore.all() });
  });

  app.get("/api/watch/summary", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return reply.send(watcher.summary());
  });

  app.get<{ Params: { account: string } }>("/api/accounts/:account/mailboxes", async (request, reply) => {
    const account = z.string().min(1).max(512).parse(request.params.account);
    reply.header("Cache-Control", "no-store");
    return reply.send({ mailboxes: await service.listMailboxes(account) });
  });

  app.get<{ Params: { account: string }; Querystring: Record<string, unknown> }>(
    "/api/accounts/:account/messages",
    async (request, reply) => {
      const account = z.string().min(1).max(512).parse(request.params.account);
      const query = messageListQuerySchema.parse(request.query);
      const search = toSearch({ ...query, unread: query.unread === "true" });
      reply.header("Cache-Control", "no-store");
      const envelopes = await service.listEnvelopes({
        account,
        mailbox: query.mailbox,
        page: query.page,
        pageSize: query.pageSize,
        ...(search ? { search } : {}),
      });
      return reply.send({ envelopes: withRisk(account, query.mailbox, envelopes) });
    },
  );

  app.post<{ Body: unknown }>("/api/unified/inbox", async (request, reply) => {
    const body = unifiedInboxBodySchema.parse(request.body);
    const search = toSearch(body);
    reply.header("Cache-Control", "no-store");
    // Only the plain, unfiltered view is what the warmer can pre-fetch.
    if (!search) options.warmer?.remember(body.accounts);
    const result = await listUnifiedInbox(service, {
      accounts: body.accounts,
      page: body.page,
      pageSize: body.pageSize,
      ...(search ? { search } : {}),
    });
    return reply.send({ ...result, envelopes: withSourceRisk(result.envelopes) });
  });

  app.post<{ Body: unknown }>("/api/search", async (request, reply) => {
    const body = searchBodySchema.parse(request.body);
    const search = toSearch(body);
    const { sources, warnings } = await resolveSources(service, {
      scope: body.scope,
      accounts: body.accounts,
      ...(body.account ? { current: { account: body.account, mailbox: body.mailbox ?? "" } } : {}),
      includeJunk: body.includeJunk,
    });
    const result = await listSources(service, sources, {
      page: body.page,
      pageSize: body.pageSize,
      ...(search ? { search } : {}),
    });
    // The CLI cannot filter by attachment, so this only trims the page that was loaded.
    const envelopes = body.hasAttachment ? result.envelopes.filter((envelope) => envelope.hasAttachment === true) : result.envelopes;
    reply.header("Cache-Control", "no-store");
    return reply.send({ ...result, envelopes: withSourceRisk(envelopes), warnings: [...warnings, ...result.warnings] });
  });

  app.get<{ Querystring: Record<string, unknown> }>("/api/message", async (request, reply) => {
    const ref = refFromQuery(request.query);
    const [raw, attachments] = await Promise.all([
      service.readRaw(ref),
      service.listAttachments(ref).catch(() => []),
    ]);
    const detail = await parseMessage(raw, attachments, ref);
    detail.envelope.id = ref.message;
    reply.header("Cache-Control", "no-store");
    return reply.send(detail);
  });

  app.get<{ Querystring: Record<string, unknown> }>("/api/message/raw", async (request, reply) => {
    const ref = refFromQuery(request.query);
    const raw = await service.readRaw(ref);
    // Parsing only names the file; the bytes are what matters, so an unparsable message still downloads.
    let filename = "message.eml";
    try {
      const detail = await parseRawMessage(raw, [], ref);
      detail.envelope.id = ref.message;
      filename = exportFilename(detail, "eml");
    } catch {
      // keep the generic name
    }
    reply
      .header("Cache-Control", "no-store")
      .header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
      .type("message/rfc822");
    return reply.send(raw);
  });

  app.get("/api/rules", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return reply.send(await readStoredRules(options.rulesPath));
  });

  app.put<{ Body: unknown }>("/api/rules", async (request, reply) => {
    const body = rulesBodySchema.parse(request.body);
    await writeStoredRules(body.rules, options.rulesPath);
    reply.header("Cache-Control", "no-store");
    return reply.send({ ok: true, ...(await readStoredRules(options.rulesPath)) });
  });

  // Read-only: lists the account's newest INBOX mail and tests the condition; no flag or move call is made.
  app.post<{ Body: unknown }>("/api/rules/preview", async (request, reply) => {
    const { rule } = rulePreviewBodySchema.parse(request.body);
    const inbox = (await service.listMailboxes(rule.account, { counts: false }))
      .find(({ id, name }) => id.toLowerCase() === "inbox" || name.toLowerCase() === "inbox");
    if (!inbox) throw new HimalayaError("Kein INBOX-Ordner für dieses Konto gefunden.", "FOLDER_NOT_FOUND", false);
    const envelopes = await service.listEnvelopes({ account: rule.account, mailbox: inbox.id, page: 1, pageSize: 50 });
    reply.header("Cache-Control", "no-store");
    return reply.send(previewRule(rule, envelopes));
  });

  app.get("/api/snoozed", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return reply.send({ snoozed: await snoozeStore.active() });
  });

  app.post<{ Body: unknown }>("/api/snooze", async (request, reply) => {
    const body = snoozeBodySchema.parse(request.body);
    await snoozeStore.add(body.ref, new Date(body.until), new Date(), body.subject);
    reply.header("Cache-Control", "no-store");
    return reply.send({ ok: true });
  });

  app.post<{ Body: unknown }>("/api/snooze/cancel", async (request, reply) => {
    await snoozeStore.cancel(snoozeCancelBodySchema.parse(request.body).ref);
    reply.header("Cache-Control", "no-store");
    return reply.send({ ok: true });
  });

  app.post<{ Body: unknown }>("/api/labels", async (request, reply) => {
    const body = labelsBodySchema.parse(request.body);
    await labelStore.set(body.ref, body.labels);
    reply.header("Cache-Control", "no-store");
    return reply.send({ ok: true });
  });

  app.post<{ Body: unknown }>("/api/senders/status", async (request, reply) => {
    const body = senderStatusBodySchema.parse(request.body);
    await senderStore.setStatus(body.email, body.status);
    watcher.forgetSender(body.email);
    reply.header("Cache-Control", "no-store");
    return reply.send({ ok: true });
  });

  // Reporting moves the mail to Junk first: if that fails nothing is remembered.
  app.post<{ Body: unknown }>("/api/message/report", async (request, reply) => {
    const body = reportBodySchema.parse(request.body);
    const ref = messageRef(body.ref.account, body.ref.mailbox, body.ref.message);
    const detail = await parseMessage(await service.readRaw(ref), [], ref);
    const address = detail.envelope.from[0]?.email;
    if (!address) throw new HimalayaError("Die Mail hat keine Absenderadresse.", "INVALID_INPUT", false);

    const junk = findJunkMailbox(await service.listMailboxes(ref.account, { counts: false }));
    const alreadyThere = junk !== null && junk.id === ref.mailbox;
    if (junk && !alreadyThere) {
      await service.move(ref, junk.id);
      await forgetLabels(ref);
    }
    await senderStore.setStatus(address, "blocked");
    watcher.forgetSender(address);
    reply.header("Cache-Control", "no-store");
    return reply.send({ ok: true, moved: junk !== null && !alreadyThere, mailbox: junk?.id ?? null });
  });

  app.post<{ Body: unknown }>("/api/message/copy", async (request, reply) => {
    const body = copyBodySchema.parse(request.body);
    const ref = messageRef(body.ref.account, body.ref.mailbox, body.ref.message);
    reply.header("Cache-Control", "no-store");
    if (body.destination.account === ref.account) {
      await service.copy(ref, body.destination.mailbox);
      return reply.send({ ok: true, mode: "copy" });
    }
    // The CLI cannot copy across accounts, so read the original and append it; as "seen" so the copy adds no unread noise.
    await service.addRaw(body.destination.account, body.destination.mailbox, await service.readRaw(ref), ["seen"]);
    return reply.send({ ok: true, mode: "append" });
  });

  app.get<{ Querystring: Record<string, unknown> }>("/api/message/export", async (request, reply) => {
    const query = exportQuerySchema.parse(request.query);
    const ref = messageRef(query.account, query.mailbox, query.message);
    const [raw, attachments] = await Promise.all([
      service.readRaw(ref),
      service.listAttachments(ref).catch(() => []),
    ]);
    const detail = await parseMessage(raw, attachments, ref);
    detail.envelope.id = ref.message;
    reply
      .header("Cache-Control", "no-store")
      .header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(exportFilename(detail))}`)
      .type("text/markdown; charset=utf-8");
    return reply.send(renderMarkdown(detail));
  });

  app.post<{ Body: unknown }>("/api/ai/assist", async (request, reply) => {
    const body = aiBodySchema.parse(request.body);
    const provider = options.ai;
    if (!provider) {
      throw new HimalayaError("Der KI-Dienst ist nicht konfiguriert.", "AI_UNAVAILABLE", false);
    }

    const sessionKey = typeof request.headers["x-himalaya-session"] === "string"
      ? request.headers["x-himalaya-session"]
      : "local-session";
    if (aiInFlight.has(sessionKey)) {
      throw new HimalayaError("Eine KI-Anfrage läuft bereits.", "AI_BUSY", true);
    }
    const now = Date.now();
    const previous = aiLastRequest.get(sessionKey) ?? 0;
    if (now - previous < AI_COOLDOWN_MS) {
      throw new HimalayaError("Bitte warte kurz vor der nächsten KI-Anfrage.", "AI_RATE_LIMIT", true);
    }

    aiInFlight.add(sessionKey);
    aiLastRequest.set(sessionKey, now);
    try {
      const source = body.task === "polish-draft"
        ? { kind: "draft" as const, draftText: body.draftText }
        : await (async () => {
            const ref = messageRef(body.ref.account, body.ref.mailbox, body.ref.message);
            const [raw, attachments] = await Promise.all([
              service.readRaw(ref),
              service.listAttachments(ref).catch(() => []),
            ]);
            const detail = await parseMessage(raw, attachments, ref);
            detail.envelope.id = ref.message;
            return { kind: "message" as const, detail };
          })();
      const result = await provider.complete({ task: body.task, source });
      reply.header("Cache-Control", "no-store");
      return reply.send({
        task: body.task,
        text: result.text,
        provider: provider.provider,
        model: provider.model,
        truncated: result.truncated,
      });
    } finally {
      aiInFlight.delete(sessionKey);
    }
  });

  app.post<{ Body: unknown }>("/api/message/seen", async (request, reply) => {
    const body = seenBodySchema.parse(request.body);
    await service.setSeen(messageRef(body.ref.account, body.ref.mailbox, body.ref.message), body.seen);
    return reply.send({ ok: true });
  });

  app.post<{ Body: unknown }>("/api/message/move", async (request, reply) => {
    const body = moveBodySchema.parse(request.body);
    const ref = messageRef(body.ref.account, body.ref.mailbox, body.ref.message);
    await service.move(ref, body.destination);
    await forgetLabels(ref); // the message gets a new id in the target, so its labels end here
    return reply.send({ ok: true });
  });

  app.post<{ Body: unknown }>("/api/compose/preview", async (request, reply) => {
    const composeRequest = composeRequestSchema.parse(request.body) as ComposeRequest;
    const mime = await service.composePreview(composeRequest);
    reply.header("Cache-Control", "no-store");
    return reply.send({ mime });
  });

  app.post<{ Body: unknown }>("/api/compose/draft", async (request, reply) => {
    const composeRequest = composeRequestSchema.parse(request.body) as ComposeRequest;
    const mailboxes = await service.listMailboxes(composeRequest.account);
    const accountsConfig = await readAccountsConfig();
    const accountSettings = accountsConfig[composeRequest.account];
    const draftsMailbox = resolveSpecialFolder("drafts", mailboxes, accountSettings?.overrides);
    if (!draftsMailbox) {
      throw new HimalayaError("Kein Entwürfe-Ordner für dieses Konto gefunden.", "FOLDER_NOT_FOUND", false);
    }
    await service.composeSend(
      composeRequest,
      { send: false, saveTo: draftsMailbox, attachmentPaths: [] },
    );
    return reply.send({ ok: true });
  });

  app.post<{ Body: unknown }>("/api/message/delete", async (request, reply) => {
    const body = deleteBodySchema.parse(request.body);
    const ref = messageRef(body.ref.account, body.ref.mailbox, body.ref.message);
    const mailboxes = await service.listMailboxes(ref.account);
    const accountsConfig = await readAccountsConfig();
    const accountSettings = accountsConfig[ref.account];
    const trashMailbox = resolveSpecialFolder("trash", mailboxes, accountSettings?.overrides);
    if (!trashMailbox) {
      throw new HimalayaError("Kein Papierkorb-Ordner für dieses Konto gefunden.", "FOLDER_NOT_FOUND", false);
    }
    const isPermanent = ref.mailbox === trashMailbox;
    if (isPermanent && !body.confirmPermanent) {
      throw new HimalayaError("Die Nachricht ist bereits im Papierkorb und würde endgültig gelöscht.", "CONFIRM_REQUIRED", false);
    }
    if (isPermanent) {
      await service.deleteMessage(ref);
    } else {
      await service.move(ref, trashMailbox);
    }
    await forgetLabels(ref);
    return reply.send({ ok: true, permanent: isPermanent });
  });

  app.get<{ Params: { account: string } }>("/api/accounts/:account/special-folders", async (request, reply) => {
    const account = z.string().min(1).max(512).parse(request.params.account);
    const config = await readAccountsConfig();
    const existing = config[account];
    reply.header("Cache-Control", "no-store");
    if (existing?.sentCopy !== undefined) return reply.send(existing);

    const accountResult = await service.listAccounts();
    const email = accountResult.accounts.find((item) => item.name === account)?.email ?? null;
    return reply.send({ overrides: existing?.overrides ?? {}, sentCopy: defaultSentCopyMode(email) });
  });

  app.put<{ Params: { account: string }; Body: unknown }>("/api/accounts/:account/special-folders", async (request, reply) => {
    const account = z.string().min(1).max(512).parse(request.params.account);
    const parsed = specialFoldersBodySchema.parse(request.body);
    await writeAccountFolderSettings(account, {
      overrides: {
        ...(parsed.overrides.sent !== undefined ? { sent: parsed.overrides.sent } : {}),
        ...(parsed.overrides.drafts !== undefined ? { drafts: parsed.overrides.drafts } : {}),
        ...(parsed.overrides.trash !== undefined ? { trash: parsed.overrides.trash } : {}),
      },
      sentCopy: parsed.sentCopy,
    });
    return reply.send({ ok: true });
  });

  app.post("/api/compose/send", async (request, reply) => {
    let composeRequest: ComposeRequest | null = null;
    const attachmentPaths: string[] = [];
    let totalBytes = 0;
    const directory = await mkdtemp(join(tmpdir(), "himalaya-web-send-"));
    let cleanedUp = false;
    const cleanup = async (): Promise<void> => {
      if (cleanedUp) return;
      cleanedUp = true;
      await rm(directory, { recursive: true, force: true });
    };

    try {
      for await (const part of request.parts()) {
        if (part.type === "field" && part.fieldname === "payload") {
          if (part.valueTruncated) {
            throw new HimalayaError("Die Anfrage ist zu groß.", "INVALID_INPUT", false);
          }
          composeRequest = composeRequestSchema.parse(JSON.parse(String(part.value))) as ComposeRequest;
        } else if (part.type === "file") {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            totalBytes += chunk.length;
            if (totalBytes > ATTACHMENT_LIMITS.maxTotalBytes) {
              throw new HimalayaError("Die Anhänge sind zu groß.", "INVALID_INPUT", false);
            }
            chunks.push(chunk as Buffer);
          }
          const rawName = part.filename ?? "attachment";
          const safeName = rawName.replace(/[\\/\u0000]/g, "_").replace(/\.\./g, "_").slice(0, 180) || "attachment";
          const filePath = join(directory, `${attachmentPaths.length}-${safeName}`);
          await writeFile(filePath, Buffer.concat(chunks));
          attachmentPaths.push(filePath);
        }
      }

      if (!composeRequest) {
        throw new HimalayaError("Die Anfrage ist ungültig.", "INVALID_REQUEST", false);
      }
      const finalRequest = composeRequest;

      if (finalRequest.includeOriginalAttachments && finalRequest.mode === "forward" && finalRequest.sourceRef) {
        const sourceRef = messageRef(finalRequest.sourceRef.account, finalRequest.sourceRef.mailbox, finalRequest.sourceRef.message);
        const sourceAttachments = await service.listAttachments(sourceRef);
        for (const attachment of sourceAttachments) {
          const downloaded = await service.downloadAttachment(sourceRef, attachment.id, attachment.filename);
          const filePath = join(directory, `${attachmentPaths.length}-${downloaded.filename}`);
          await writeFile(filePath, downloaded.data);
          attachmentPaths.push(filePath);
        }
      }

      const mailboxes = await service.listMailboxes(finalRequest.account);
      const accountsConfig = await readAccountsConfig();
      const accountSettings = accountsConfig[finalRequest.account];
      // Without an explicit accounts.json entry the provider default decides:
      // Gmail already stores its own Sent copy, so a second --save duplicates it.
      const accountList = await service.listAccounts();
      const accountEmail = accountList.accounts.find((item) => item.name === finalRequest.account)?.email ?? null;
      const effectiveSentCopy = accountSettings?.sentCopy ?? defaultSentCopyMode(accountEmail);
      const saveTo = effectiveSentCopy === "none"
        ? undefined
        : resolveSpecialFolder("sent", mailboxes, accountSettings?.overrides) ?? undefined;

      const job = outbox.schedule(async () => {
        try {
          await service.composeSend(finalRequest, { send: true, ...(saveTo ? { saveTo } : {}), attachmentPaths });
        } finally {
          pendingCleanups.delete(job.id);
          await cleanup();
        }
      });
      pendingCleanups.set(job.id, cleanup);
      reply.header("Cache-Control", "no-store");
      return reply.send({ jobId: job.id, sendAt: job.sendAt });
    } catch (error) {
      await cleanup();
      throw error;
    }
  });

  app.delete<{ Params: { id: string } }>("/api/outbox/:id", async (request, reply) => {
    const cancelled = outbox.cancel(request.params.id);
    if (!cancelled) {
      throw new HimalayaError("Der Versand konnte nicht mehr zurückgenommen werden.", "OUTBOX_NOT_FOUND", false);
    }
    const cleanup = pendingCleanups.get(request.params.id);
    pendingCleanups.delete(request.params.id);
    if (cleanup) await cleanup();
    return reply.send({ ok: true });
  });

  app.get<{ Params: { id: string } }>("/api/outbox/:id", async (request, reply) => {
    const job = outbox.get(request.params.id);
    if (!job) throw new HimalayaError("Der Sendevorgang wurde nicht gefunden.", "OUTBOX_NOT_FOUND", false);
    reply.header("Cache-Control", "no-store");
    return reply.send(job);
  });

  app.get<{ Querystring: Record<string, unknown> }>("/api/attachment", async (request, reply) => {
    const query = z.object({
      ...refQuerySchema.shape,
      attachment: z.string().min(1).max(512),
    }).parse(request.query);
    const ref = messageRef(query.account, query.mailbox, query.message);
    const attachments = await service.listAttachments(ref);
    const selected = attachments.find((item) => item.id === query.attachment);
    if (!selected) {
      throw new HimalayaError("Der Anhang wurde nicht gefunden.", "ATTACHMENT_NOT_FOUND", false);
    }
    const result = await service.downloadAttachment(ref, selected.id, selected.filename);
    reply
      .header("Cache-Control", "no-store")
      .header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`)
      .type(selected.mime ?? "application/octet-stream");
    return reply.send(result.data);
  });

  if (options.staticDir) {
    await app.register(fastifyStatic, {
      root: options.staticDir,
      prefix: "/",
      wildcard: true,
      index: false,
    });

    app.get("/", async (_request, reply) => {
      const index = await readFile(join(options.staticDir as string, "index.html"), "utf8");
      const sessionMeta = `<meta name="himalaya-session" content="${escapeHtmlAttribute(options.token)}" />`;
      const html = index.includes("</head>") ? index.replace("</head>", `    ${sessionMeta}\n  </head>`) : `${sessionMeta}\n${index}`;
      reply
        .header("Cache-Control", "no-store")
        .header("X-Frame-Options", "DENY")
        .header("Content-Security-Policy", "frame-ancestors 'none'")
        .type("text/html; charset=utf-8");
      return reply.send(html);
    });
  }

  return app;
}

export { HimalayaCli } from "./himalaya.js";
export type { HimalayaService } from "./himalaya.js";
