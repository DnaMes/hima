import type { MessageDetail, MessageRef } from "../shared/types.js";

export type ClientAiTask = "summarize" | "reply-draft";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function addressLine(addresses: MessageDetail["envelope"]["from"]): string {
  return addresses.map((address) => address.name ? `${address.name} <${address.email}>` : address.email).join(", ") || "—";
}

export function messageExportUrl(ref: MessageRef): string {
  return `/api/message/export?${new URLSearchParams({ ...ref, format: "markdown" })}`;
}

export function messageRawUrl(ref: MessageRef): string {
  return `/api/message/raw?${new URLSearchParams({ ...ref })}`;
}

export function aiTaskLabel(task: ClientAiTask): string {
  return task === "summarize" ? "Zusammenfassen" : "Antwortentwurf";
}

export function buildPrintDocument(detail: MessageDetail, sanitizedHtml: string): string {
  const subject = detail.envelope.subject || "(Ohne Betreff)";
  const body = sanitizedHtml.trim()
    ? sanitizedHtml
    : `<pre class="plain-text">${escapeHtml(detail.text || "(Keine darstellbare Nachricht.)")}</pre>`;
  const attachments = detail.attachments.length > 0
    ? `<ul>${detail.attachments.map((attachment) => `<li>${escapeHtml(attachment.filename ?? "Anhang")} · ${escapeHtml(attachment.mime ?? "unbekannter Typ")} · ${attachment.size} Bytes</li>`).join("")}</ul>`
    : "<p>Keine Anhänge</p>";

  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(subject)}</title>
    <style>
      :root { color-scheme: light; font-family: system-ui, sans-serif; color: #17131f; background: #fff; }
      body { max-width: 780px; margin: 0 auto; padding: 42px; line-height: 1.6; }
      h1 { font: 700 28px/1.2 Georgia, serif; }
      .meta { color: #57505f; font-size: 13px; }
      .meta p { margin: 4px 0; }
      .body { margin-top: 28px; }
      .attachments { border-top: 1px solid #d9d2df; margin-top: 28px; padding-top: 14px; font-size: 13px; }
      .plain-text { white-space: pre-wrap; font: inherit; }
      @media print { body { max-width: none; padding: 0; } .attachments { break-inside: avoid; } }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(subject)}</h1>
    <div class="meta">
      <p><strong>Von:</strong> ${escapeHtml(addressLine(detail.envelope.from))}</p>
      <p><strong>An:</strong> ${escapeHtml(addressLine(detail.envelope.to))}</p>
      <p><strong>Datum:</strong> ${escapeHtml(detail.envelope.date ?? "Unbekannt")}</p>
    </div>
    <div class="body">${body}</div>
    <section class="attachments"><strong>Anhänge</strong>${attachments}</section>
  </body>
</html>`;
}
