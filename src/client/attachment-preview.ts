export type PreviewKind = "image" | "pdf" | "text";

export const PREVIEW_MAX_BYTES = 15 * 1024 * 1024;

// The blob is always built with one of these types, never with the mail's own claim: a mail can call HTML a PDF.
const BY_MIME: Record<string, { kind: PreviewKind; type: string }> = {
  "image/png": { kind: "image", type: "image/png" },
  "image/jpeg": { kind: "image", type: "image/jpeg" },
  "image/gif": { kind: "image", type: "image/gif" },
  "image/webp": { kind: "image", type: "image/webp" },
  "application/pdf": { kind: "pdf", type: "application/pdf" },
  "text/plain": { kind: "text", type: "text/plain" },
};
const BY_EXTENSION: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", pdf: "application/pdf", txt: "text/plain",
};

/** What the reader may show inline; SVG, HTML and everything else stays download-only. */
export function previewFor(
  attachment: { mime: string | null; filename: string | null; size: number },
): { kind: PreviewKind; type: string } | null {
  if (attachment.size > PREVIEW_MAX_BYTES) return null;
  const mime = attachment.mime?.split(";")[0]?.trim().toLowerCase() ?? "";
  const direct = Object.hasOwn(BY_MIME, mime) ? BY_MIME[mime] : undefined;
  if (direct) return direct;
  if (mime && mime !== "application/octet-stream") return null;
  const extension = attachment.filename?.split(".").at(-1)?.toLowerCase() ?? "";
  const guessed = Object.hasOwn(BY_EXTENSION, extension) ? BY_EXTENSION[extension] : undefined;
  return guessed ? BY_MIME[guessed]! : null;
}
