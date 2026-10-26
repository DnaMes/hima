import type { Address, Attachment, MessageDetail } from "../shared/types.js";

const BLOCK_TAGS = /<\/?(?:br|div|li|p|section|table|tr|h[1-6])\b[^>]*>/gi;
const SCRIPT_BLOCKS = /<(?:script|style|noscript|template)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript|template)>/gi;
const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function formatAddress(address: Address): string {
  return address.name ? `${address.name} <${address.email}>` : address.email;
}

function formatAddresses(addresses: Address[]): string {
  return addresses.length > 0 ? addresses.map(formatAddress).join(", ") : "—";
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower in HTML_ENTITIES) return HTML_ENTITIES[lower] ?? whole;
    if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    return whole;
  });
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(SCRIPT_BLOCKS, "")
      .replace(BLOCK_TAGS, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function messageBody(detail: MessageDetail): string {
  const text = detail.text.trim();
  if (text) return text;
  return detail.html ? htmlToText(detail.html) : "(Keine darstellbare Nachricht.)";
}

function attachmentLine(attachment: Attachment): string {
  const filename = attachment.filename ?? "Anhang";
  const mime = attachment.mime ?? "unbekannter Typ";
  return `- ${filename} (${mime}, ${attachment.size} Bytes)`;
}

export function renderMarkdown(detail: MessageDetail): string {
  const subject = detail.envelope.subject.trim() || "(Ohne Betreff)";
  const attachments = detail.attachments.length > 0
    ? detail.attachments.map(attachmentLine).join("\n")
    : "- Keine Anhänge";

  return [
    `# ${subject}`,
    "",
    `- From: ${formatAddresses(detail.envelope.from)}`,
    `- To: ${formatAddresses(detail.envelope.to)}`,
    `- Date: ${detail.envelope.date ?? "Unbekannt"}`,
    `- Account: ${detail.ref.account}`,
    `- Mailbox: ${detail.ref.mailbox}`,
    `- Message: ${detail.ref.message}`,
    "",
    "## Body",
    "",
    messageBody(detail),
    "",
    "## Attachments",
    attachments,
    "",
  ].join("\n");
}

function safeFilenamePart(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\\/\u0000-\u001f\u007f]/g, "_")
    .replace(/\.\./g, "_")
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}._-]/gu, "_")
    .slice(0, 100) || "message";
}

export function exportFilename(detail: MessageDetail, extension: "md" | "eml" = "md"): string {
  const date = detail.envelope.date?.slice(0, 10).match(/^\d{4}-\d{2}-\d{2}$/)
    ? detail.envelope.date.slice(0, 10)
    : "message";
  return `${date}-${safeFilenamePart(detail.envelope.subject.toLocaleLowerCase("de-DE"))}.${extension}`.slice(0, 120);
}
