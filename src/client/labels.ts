export type LabeledMessage = { account: string; mailbox: string; message: string; labels: string[] };

export const LABELS_PER_MESSAGE = 5;
export const LABEL_MAX_LENGTH = 24;

/** Every label in use, case-insensitively unique (first spelling wins), sorted for the filter list. */
export function labelNames(entries: readonly LabeledMessage[]): string[] {
  const byKey = new Map<string, string>();
  for (const label of entries.flatMap((entry) => entry.labels)) {
    const key = label.toLocaleLowerCase("de-DE");
    if (!byKey.has(key)) byKey.set(key, label);
  }
  return [...byKey.values()].sort((left, right) => left.localeCompare(right, "de-DE"));
}

export function hasLabel(labels: readonly string[] | undefined, wanted: string): boolean {
  const key = wanted.toLocaleLowerCase("de-DE");
  return (labels ?? []).some((label) => label.toLocaleLowerCase("de-DE") === key);
}

/** The labels after adding the typed text (comma separated); returns null when nothing can be added. */
export function addLabels(current: readonly string[], typed: string): string[] | null {
  const additions = typed.split(",").map((part) => part.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (additions.length === 0 || additions.some((label) => label.length > LABEL_MAX_LENGTH)) return null;
  const next = [...current];
  for (const label of additions) if (!hasLabel(next, label)) next.push(label);
  return next.length > current.length && next.length <= LABELS_PER_MESSAGE ? next : null;
}

/** Deterministically maps a label name to a hue index 0..7. */
export function labelHueIndex(name: string): number {
  let hash = 0x811c9dc5;
  const normalized = name.toLocaleLowerCase("de-DE").trim();
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash) % 8;
}

