import { simpleParser } from "mailparser";

import type { Address, Attachment, Envelope, MessageDetail, MessageRef, ReceivedHop, SenderInfo, Unsubscribe } from "../shared/types.js";
import { assessMessage, parseAuthResults } from "./phishing.js";
import type { SenderLists } from "./senders.js";

type MailboxValue = {
  value?: Array<{ address?: string; name?: string }>;
};

function addresses(value: unknown): Address[] {
  if (!value || typeof value !== "object" || !("value" in value)) return [];
  const entries = (value as MailboxValue).value;
  if (!entries) return [];
  return entries
    .filter((entry) => typeof entry.address === "string")
    .map((entry) => ({ email: entry.address as string, name: entry.name ?? null }));
}

function envelopeFromParsed(parsed: Awaited<ReturnType<typeof simpleParser>>): Envelope {
  return {
    id: parsed.messageId ?? "",
    date: parsed.date?.toISOString() ?? null,
    flags: [],
    from: addresses(parsed.from),
    to: addresses(parsed.to),
    subject: parsed.subject ?? "",
    size: 0,
    hasAttachment: parsed.attachments.length > 0,
  };
}

function headerText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "text" in value && typeof (value as { text: unknown }).text === "string") {
    return (value as { text: string }).text;
  }
  return null;
}

function singleAddress(value: unknown): string | null {
  return addresses(value)[0]?.email ?? null;
}

// ponytail: reads "from X (rdns [ip]) by Y" textually; exotic Received formats just yield nulls.
function parseReceived(line: string): ReceivedHop {
  const flat = line.replace(/\s+/g, " ");
  return {
    from: flat.match(/\bfrom\s+(\S+)/i)?.[1] ?? null,
    by: flat.match(/\bby\s+(\S+)/i)?.[1] ?? null,
    ip: flat.match(/\[((?:\d{1,3}\.){3}\d{1,3}|[0-9a-f:]{3,})\]/i)?.[1] ?? null,
  };
}

function senderInfo(parsed: Awaited<ReturnType<typeof simpleParser>>, envelope: Envelope, html: string | null, senders?: SenderLists): SenderInfo {
  const replyTo = singleAddress(parsed.replyTo);
  const returnPath = singleAddress(parsed.headers.get("return-path"));
  // The topmost Authentication-Results is added by our own MX; lower ones may be forged.
  const authHeader = parsed.headers.get("authentication-results");
  const auth = parseAuthResults(headerText(Array.isArray(authHeader) ? authHeader[0] : authHeader));
  const received = [parsed.headers.get("received")].flat().flatMap((value) => {
    const text = headerText(value) ?? (typeof value === "string" ? value : null);
    return text ? [parseReceived(text)] : [];
  });
  const messageId = parsed.messageId ?? "";
  const messageIdDomain = messageId.includes("@") ? messageId.replace(/^<|>$/g, "").split("@").pop() ?? null : null;
  const from = envelope.from[0];
  const address = from?.email.toLowerCase() ?? "";
  const trust = senders?.blocked.has(address) ? "blocked" : senders?.trusted.has(address) ? "trusted" : null;
  const risk = assessMessage({
    ...(trust ? { senderStatus: trust } : {}),
    fromName: from?.name ?? null,
    fromEmail: from?.email ?? "",
    replyTo,
    returnPath,
    auth,
    html,
    text: parsed.text ?? "",
    subject: envelope.subject,
  });
  return { replyTo, returnPath, messageIdDomain, auth, received, risk, trust };
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    // A user:pass@ part is a classic way to dress up the real host.
    return url.protocol === "https:" && !url.username && !url.password && !/[\s<>"]/.test(value);
  } catch {
    return false;
  }
}

/** Only https links and plain addresses are kept; the server never calls the link, the operator opens it. */
export function parseUnsubscribe(list: unknown): Unsubscribe | undefined {
  const entry = (list as { unsubscribe?: { url?: unknown; mail?: unknown } } | null)?.unsubscribe;
  const rawUrl = typeof entry?.url === "string" ? entry.url : null;
  const url = rawUrl && isHttpsUrl(rawUrl) ? rawUrl : null;
  const rawMail = typeof entry?.mail === "string" ? entry.mail.split("?")[0]! : null;
  const mail = rawMail && /^[^\s@<>":/]+@[^\s@<>":/]+$/.test(rawMail) ? rawMail : null;
  return url || mail ? { url, mail } : undefined;
}

export async function parseRawMessage(
  raw: Buffer,
  attachments: Attachment[],
  ref: MessageRef,
  options: { senders?: SenderLists } = {},
): Promise<MessageDetail> {
  const parsed = await simpleParser(raw, { skipHtmlToText: false });
  const envelope = envelopeFromParsed(parsed);
  envelope.size = raw.byteLength;
  envelope.hasAttachment = attachments.length > 0 || parsed.attachments.length > 0;

  const html = typeof parsed.html === "string" ? parsed.html : null;
  const unsubscribe = parseUnsubscribe(parsed.headers.get("list"));

  return {
    ref,
    envelope,
    text: parsed.text ?? "",
    html,
    attachments,
    sender: senderInfo(parsed, envelope, html, options.senders),
    ...(unsubscribe ? { unsubscribe } : {}),
  };
}
