import type { Envelope } from "../shared/types.js";

export type Contact = { email: string; name: string | null };

/** Addresses seen on loaded mail, most frequent first; the operator's own addresses are left out. */
export function collectContacts(envelopes: readonly Envelope[], ownAddresses: readonly string[]): Contact[] {
  const own = new Set(ownAddresses.map((address) => address.toLowerCase()));
  const seen = new Map<string, { contact: Contact; count: number }>();
  // The loaded list and remembered lists overlap; one message must count once.
  const messages = new Set<string>();
  const unique = envelopes.filter((envelope) => {
    const key = `${envelope.id}|${envelope.date}|${envelope.subject}`;
    return messages.has(key) ? false : (messages.add(key), true);
  });
  for (const address of unique.flatMap((envelope) => [...envelope.from, ...envelope.to])) {
    const key = address.email.toLowerCase();
    if (!key || own.has(key)) continue;
    const entry = seen.get(key);
    if (entry) {
      entry.count += 1;
      if (!entry.contact.name && address.name) entry.contact.name = address.name;
    } else seen.set(key, { contact: { email: address.email, name: address.name || null }, count: 1 });
  }
  return [...seen.values()].sort((left, right) => right.count - left.count).map((entry) => entry.contact);
}

const SEPARATOR = /[,\n]/;

function lastToken(value: string): string {
  return value.split(SEPARATOR).at(-1)!.trim();
}

/** Contacts matching the recipient being typed (after the last comma), skipping addresses already in the field. */
export function suggestContacts(value: string, contacts: readonly Contact[], limit = 6): Contact[] {
  const token = lastToken(value).toLowerCase();
  if (token.length < 2) return [];
  const present = new Set(value.split(SEPARATOR).map((part) => part.trim().toLowerCase()));
  return contacts
    .filter((contact) => !present.has(contact.email.toLowerCase()) && `${contact.name ?? ""} ${contact.email}`.toLowerCase().includes(token))
    .slice(0, limit);
}

export function applyContact(value: string, contact: Contact): string {
  const head = value.split(SEPARATOR).slice(0, -1).map((part) => part.trim()).filter(Boolean);
  return `${[...head, contact.email].join(", ")}, `;
}
