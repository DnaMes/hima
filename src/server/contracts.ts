import { z } from "zod";

import type { Account, Address, Attachment, Envelope, Flag, Mailbox, MessageRef } from "../shared/types.js";

const addressSchema = z.object({
  email: z.string(),
  name: z.string().nullable(),
});

const flagSchema = z.object({
  iana: z.string().nullable(),
  raw: z.string(),
});

const cliAccountSchema = z.object({
  name: z.string(),
  default: z.boolean(),
  backends: z.array(z.string()),
});

const mailboxSchema = z.object({
  id: z.string(),
  name: z.string(),
  total: z.number().int().nonnegative().nullable(),
  unread: z.number().int().nonnegative().nullable(),
});

const envelopeSchema = z.object({
  id: z.string(),
  date: z.string().nullable(),
  flags: z.array(flagSchema),
  from: z.array(addressSchema),
  to: z.array(addressSchema),
  subject: z.string(),
  size: z.number().int().nonnegative(),
  "has-attachment": z.boolean().nullable(),
  // Threading hints are optional: a field of an unexpected type is ignored instead of failing the whole list.
  "message-id": z.string().nullish().catch(undefined),
  // An array keeps its text entries (one odd entry must not cost the others); a single string counts as one id.
  "in-reply-to": z.union([
    z.array(z.unknown()).transform((ids) => ids.filter((id): id is string => typeof id === "string")),
    z.string().transform((id) => [id]),
  ]).nullish().catch(undefined),
});

const attachmentSchema = z.object({
  id: z.string(),
  filename: z.string().nullable(),
  mime: z.string().nullable(),
  size: z.number().int().nonnegative(),
  inline: z.boolean(),
});

export const accountsResponseSchema = z.object({ accounts: z.array(cliAccountSchema) });
export const mailboxesResponseSchema = z.object({ mailboxes: z.array(mailboxSchema) });
export const envelopesResponseSchema = z.object({ envelopes: z.array(envelopeSchema) });
export const attachmentsResponseSchema = z.object({ attachments: z.array(attachmentSchema) });

export type SearchField = "all" | "subject" | "from" | "to" | "body";

export type SearchFlag = "flagged" | "seen" | "unseen" | "answered";
export type SearchOrder = "desc" | "asc";

export type SearchInput = {
  field: SearchField;
  text: string;
  unread?: boolean;
  /** Inclusive start day, YYYY-MM-DD. */
  from?: string;
  /** Inclusive end day, YYYY-MM-DD. */
  until?: string;
  flag?: SearchFlag;
  order?: SearchOrder;
};

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export const isoDateSchema = z.string().refine(isCalendarDate, "Invalid date");

// Himalaya's `after D` excludes day D, so an inclusive start needs the day before.
export function previousDay(date: string): string {
  if (!isCalendarDate(date)) throw new Error("Invalid date");
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

export function validateRefPart(value: string, label: string): string {
  if (value.length === 0 || value.length > 512 || value.includes("\u0000")) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

// Verified against Himalaya v2.1: the query is re-joined with spaces and parsed, so a pattern
// must backslash-escape whitespace, parentheses and backslashes; quotes are taken literally.
function escapePattern(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/[()]/g, "\\$&").replace(/\s+/g, "\\ ");
}

function textSearch(field: Exclude<SearchField, "all">, text: string): string[] {
  return [field, escapePattern(text)];
}

const FLAG_CLAUSES: Record<SearchFlag, string[]> = {
  flagged: ["flag", "flagged"],
  seen: ["flag", "seen"],
  unseen: ["not", "flag", "seen"],
  answered: ["flag", "answered"],
};

/** True when any clause would be emitted, i.e. `envelope search` instead of `envelope list` is needed. */
export function hasSearchCriteria(search: SearchInput | undefined): boolean {
  return search !== undefined && (
    search.text.trim() !== "" || search.unread === true || Boolean(search.from) || Boolean(search.until)
    || Boolean(search.flag) || search.order === "asc"
  );
}

export function buildSearchQuery(input: SearchInput): string[] {
  const text = input.text.trim();
  const clauses: string[][] = [];
  if (text) {
    if (input.field === "all") {
      // "( subject" does not parse; the grouping parentheses must touch their neighbours.
      const group = ["subject", "from", "to", "body"].flatMap((field, index) => [...(index > 0 ? ["or"] : []), ...textSearch(field as Exclude<SearchField, "all">, text)]);
      group[0] = `(${group[0]}`;
      group[group.length - 1] = `${group[group.length - 1]})`;
      clauses.push(group);
    } else {
      clauses.push(textSearch(input.field, text));
    }
  }
  if (input.from) clauses.push(["after", previousDay(input.from)]);
  if (input.until) {
    if (!isCalendarDate(input.until)) throw new Error("Invalid date");
    clauses.push(["not", "after", input.until]);
  }
  if (input.flag) clauses.push(FLAG_CLAUSES[input.flag]);
  if (input.unread && input.flag !== "unseen") clauses.push(FLAG_CLAUSES.unseen);

  const query = clauses.flatMap((clause, index) => (index === 0 ? clause : ["and", ...clause]));
  return input.order === "asc" ? [...query, "order", "by", "date", "asc"] : query;
}

export function parseAccounts(value: unknown): Account[] {
  return accountsResponseSchema.parse(value).accounts.map((account) => ({
    ...account,
    email: null,
  }));
}

export function parseMailboxes(value: unknown): Mailbox[] {
  return mailboxesResponseSchema.parse(value).mailboxes;
}

export function parseEnvelopes(value: unknown): Envelope[] {
  return envelopesResponseSchema.parse(value).envelopes.map(({ "message-id": messageId, "in-reply-to": inReplyTo, ...envelope }) => ({
    ...envelope,
    hasAttachment: envelope["has-attachment"],
    ...(messageId?.trim() ? { messageId: messageId.trim() } : {}),
    ...(inReplyTo && inReplyTo.length > 0 ? { inReplyTo: inReplyTo.map((id) => id.trim()).filter(Boolean) } : {}),
  }));
}

export function parseAttachments(value: unknown): Attachment[] {
  return attachmentsResponseSchema.parse(value).attachments;
}

export function messageRef(account: string, mailbox: string, message: string): MessageRef {
  return {
    account: validateRefPart(account, "account"),
    mailbox: validateRefPart(mailbox, "mailbox"),
    message: validateRefPart(message, "message"),
  };
}

export function address(email: string, name: string | null = null): Address {
  return { email, name };
}

export function flag(raw: string, iana: string | null = null): Flag {
  return { raw, iana };
}
