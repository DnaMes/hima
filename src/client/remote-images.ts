export const IMAGE_SENDERS_KEY = "himalaya-web-image-senders-v1";

/** Number of http(s) images in a message's HTML, which the reader blocks until the operator allows them. */
export function countRemoteImages(html: string | null): number {
  if (!html) return 0;
  return (html.match(/<img\b[^>]*\bsrc\s*=\s*["']?\s*https?:/gi) ?? []).length;
}

export function readImageSenders(storage: Pick<Storage, "getItem">): Set<string> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(IMAGE_SENDERS_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.includes("@")) : []);
  } catch {
    return new Set();
  }
}

export function writeImageSenders(storage: Pick<Storage, "setItem">, senders: ReadonlySet<string>): void {
  try {
    storage.setItem(IMAGE_SENDERS_KEY, JSON.stringify([...senders].slice(-200)));
  } catch {
    // Storage may be full or blocked; the choice then only lasts for this session.
  }
}
