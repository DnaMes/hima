import type { Address, MessageDetail } from "../shared/types.js";

const formatAddress = (address: Address): string => (address.name ? `${address.name} <${address.email}>` : address.email);
const formatAddresses = (addresses: readonly Address[]): string => addresses.map(formatAddress).join(", ");

function senderBlock(sender: MessageDetail["sender"]): string[] {
  const { risk } = sender;
  const verdict = risk.level === "high" ? `Warnung (${risk.score})` : risk.level === "suspicious" ? `Verdächtig (${risk.score})` : "Unauffällig";
  const lines = ["Absenderprüfung", `Bewertung: ${verdict}`, ...risk.reasons.map((reason) => `- ${reason}`)];
  if (sender.trust) lines.push(`Einstufung: ${sender.trust === "trusted" ? "Vertrauenswürdig" : "Als Phishing gemeldet"}`);
  if (sender.replyTo) lines.push(`Reply-To: ${sender.replyTo}`);
  if (sender.returnPath) lines.push(`Return-Path: ${sender.returnPath}`);
  if (sender.messageIdDomain) lines.push(`Message-ID-Domain: ${sender.messageIdDomain}`);
  const auth = sender.auth;
  lines.push(auth
    ? `SPF: ${auth.spf ?? "–"} | DKIM: ${auth.dkim ?? "–"} | DMARC: ${auth.dmarc ?? "–"}`
    : "Keine Authentication-Results vorhanden");
  if (sender.received.length > 0) {
    lines.push("Übertragungsweg:");
    sender.received.forEach((hop, index) => lines.push(`${index + 1}. ${hop.from ?? "?"}${hop.ip ? ` [${hop.ip}]` : ""} → ${hop.by ?? "?"}`));
  }
  return lines;
}

/** Plain text for pasting into a chat or ticket: the headers, optionally the sender check, then the body. */
export function formatMessageText(detail: MessageDetail, withSender: boolean): string {
  const { envelope } = detail;
  const lines = [
    `Von: ${formatAddresses(envelope.from)}`,
    `An: ${formatAddresses(envelope.to)}`,
    `Datum: ${envelope.date ?? "(unbekannt)"}`,
    `Betreff: ${envelope.subject || "(ohne Betreff)"}`,
    "",
    ...(withSender ? [...senderBlock(detail.sender), ""] : []),
    detail.text.trim() || "(Kein Text)",
  ];
  return lines.join("\n");
}

/** Everything before the first blank line of a raw message, with LF line endings. */
export function rawHeaderBlock(raw: string): string {
  const normalized = raw.replace(/\r\n/g, "\n");
  const end = normalized.indexOf("\n\n");
  return (end === -1 ? normalized : normalized.slice(0, end)).replace(/\n+$/, "");
}
