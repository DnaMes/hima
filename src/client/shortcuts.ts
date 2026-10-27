export type ShortcutAction =
  | "next" | "previous" | "reply" | "reply-all" | "forward" | "delete" | "archive" | "toggle-seen" | "label" | "search" | "help" | "compose";

export type ShortcutEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
};

export const SHORTCUTS: ReadonlyArray<{ keys: string; action: ShortcutAction; label: string }> = [
  { keys: "j", action: "next", label: "Nächste Nachricht" },
  { keys: "k", action: "previous", label: "Vorherige Nachricht" },
  { keys: "r", action: "reply", label: "Antworten" },
  { keys: "a", action: "reply-all", label: "Allen antworten" },
  { keys: "f", action: "forward", label: "Weiterleiten" },
  { keys: "# / Entf", action: "delete", label: "Löschen (zuerst Papierkorb)" },
  { keys: "e", action: "archive", label: "Archivieren" },
  { keys: "u", action: "toggle-seen", label: "Gelesen / ungelesen umschalten" },
  { keys: "l", action: "label", label: "Etikett fokussieren" },
  { keys: "c", action: "compose", label: "Neue Nachricht" },
  { keys: "/", action: "search", label: "Suche fokussieren" },
  { keys: "?", action: "help", label: "Tastenkürzel anzeigen" },
];

const BY_KEY: Record<string, ShortcutAction> = {
  j: "next", k: "previous", r: "reply", a: "reply-all", f: "forward",
  "#": "delete", Delete: "delete", e: "archive", u: "toggle-seen", l: "label", c: "compose", "/": "search", "?": "help",
};

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as { tagName?: string; isContentEditable?: boolean } | null;
  const tag = element?.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || element?.isContentEditable === true;
}

/** Maps a key press to an action; null while typing, with modifiers, or for unknown keys. */
export function shortcutFor(event: ShortcutEvent): ShortcutAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return null;
  return BY_KEY[event.key] ?? null;
}
