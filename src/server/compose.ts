import { z } from "zod";

import type { MessageRef } from "../shared/types.js";
import { validateRefPart } from "./contracts.js";

export type ComposeMode = "new" | "reply" | "reply-all" | "forward";

const MAX_RECIPIENTS = 100;
const MAX_SUBJECT_BYTES = 998;
const MAX_BODY_BYTES = 1_048_576;
const MAX_ATTACHMENTS = 20;
const MAX_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;

const noHeaderInjection = (label: string) =>
  z.string().refine((value) => !/[\r\n]/.test(value), { message: `${label} enthält ungültige Zeilenumbrüche.` });

const addressSchema = noHeaderInjection("Adresse").min(1).max(320);
const sourceRefSchema = z.object({
  account: z.string().min(1).max(512),
  mailbox: z.string().min(1).max(512),
  message: z.string().min(1).max(512),
});

export const composeRequestSchema = z.object({
  account: z.string().min(1).max(512),
  mode: z.enum(["new", "reply", "reply-all", "forward"]),
  sourceRef: sourceRefSchema.optional(),
  to: z.array(addressSchema).max(MAX_RECIPIENTS),
  cc: z.array(addressSchema).max(MAX_RECIPIENTS),
  bcc: z.array(addressSchema).max(MAX_RECIPIENTS),
  subject: noHeaderInjection("Betreff").refine((value) => Buffer.byteLength(value, "utf8") <= MAX_SUBJECT_BYTES, {
    message: "Der Betreff ist zu lang.",
  }),
  body: z.string().refine((value) => Buffer.byteLength(value, "utf8") <= MAX_BODY_BYTES, {
    message: "Der Nachrichtentext ist zu lang.",
  }),
  includeOriginalAttachments: z.boolean(),
})
  .refine((request) => request.to.length + request.cc.length + request.bcc.length <= MAX_RECIPIENTS, {
    message: "Zu viele Empfänger.",
  })
  .refine((request) => request.mode === "new" || request.sourceRef !== undefined, {
    message: "Für Antworten und Weiterleitungen wird die Ursprungsnachricht benötigt.",
    path: ["sourceRef"],
  })
  .refine((request) => request.mode === "new" || request.sourceRef?.account === request.account, {
    message: "Antwort und Weiterleitung müssen vom Konto der Ursprungsnachricht ausgehen.",
    path: ["account"],
  })
  .refine((request) => (
    request.mode === "reply" || request.to.length + request.cc.length + request.bcc.length >= 1
  ), {
    message: "Mindestens ein Empfänger wird benötigt.",
    path: ["to"],
  });

export type ComposeRequest = z.infer<typeof composeRequestSchema>;

export type ComposeAttachmentLimits = {
  maxCount: number;
  maxTotalBytes: number;
};

export const ATTACHMENT_LIMITS: ComposeAttachmentLimits = {
  maxCount: MAX_ATTACHMENTS,
  maxTotalBytes: MAX_ATTACHMENT_TOTAL_BYTES,
};

function repeatedFlag(flag: string, values: readonly string[]): string[] {
  return values.flatMap((value) => [flag, value]);
}

export function buildComposeArgs(
  request: ComposeRequest,
  options: {
    send: boolean;
    saveTo?: string;
    attachmentPaths?: readonly string[];
    inlineBody?: boolean;
  },
): string[] {
  const ref = request.sourceRef as MessageRef | undefined;
  const base: string[] =
    request.mode === "reply" || request.mode === "reply-all"
      ? ["message", "reply", validateRefPart(ref!.message, "message"), "--mailbox", validateRefPart(ref!.mailbox, "mailbox")]
      : request.mode === "forward"
        ? ["message", "forward", validateRefPart(ref!.message, "message"), "--mailbox", validateRefPart(ref!.mailbox, "mailbox")]
        : ["message", "compose"];

  return [
    ...base,
    ...repeatedFlag("--to", request.to),
    ...repeatedFlag("--cc", request.cc),
    ...repeatedFlag("--bcc", request.bcc),
    ...(request.subject ? ["--subject", request.subject] : []),
    ...(options.inlineBody && request.body ? ["--body", request.body] : []),
    ...repeatedFlag("--attach", options.attachmentPaths ?? []),
    ...(options.saveTo ? ["--save", options.saveTo] : []),
    ...(options.send ? ["--send"] : []),
  ];
}
