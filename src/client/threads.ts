import type { Envelope } from "../shared/types.js";

export type Thread = { head: Envelope; rest: Envelope[] };

const PREFIX = /^\s*((re|aw|fwd?|wg|antw|sv|vs)\s*(\[\d+\])?\s*:\s*)+/i;

/** Subject without reply/forward prefixes, case and spacing; empty subjects never group. */
export function threadKey(subject: string): string {
  return subject.replace(PREFIX, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("de-DE");
}

const idKey = (id: string): string => id.trim().replace(/^<|>$/g, "").trim().toLowerCase();

/**
 * Groups the loaded list into conversations, keeping its order: the first message of a group (the newest in the
 * default order) is the head. Messages are linked through their Message-ID and In-Reply-To headers (the CLI list
 * view carries both; the parent may be missing from the page, replies to the same parent still end up together).
 * Mail without a Message-ID falls back to a subject match. `scope` keeps messages of different accounts apart; copies
 * of a conversation in several folders of one account (Inbox and Sent) belong together on purpose.
 */
export function groupThreads(envelopes: readonly Envelope[], scope: (envelope: Envelope) => string = () => ""): Thread[] {
  const parent = new Map<string, string>();
  const find = (node: string): string => {
    let root = node;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root)!;
    parent.set(node, root);
    return root;
  };
  const union = (left: string, right: string): void => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent.set(b, a);
    else parent.set(a, a);
  };
  const nodeOf = (envelope: Envelope, id: string): string => `${scope(envelope)}\u0000${idKey(id)}`;

  // The last In-Reply-To id is the direct parent; a mass reply lists many ids and must not glue other threads together.
  const parentOf = (envelope: Envelope): string | null => {
    const id = (envelope.inReplyTo ?? []).filter((candidate) => idKey(candidate)).at(-1);
    return id ? nodeOf(envelope, id) : null;
  };

  for (const envelope of envelopes) {
    const own = envelope.messageId ? nodeOf(envelope, envelope.messageId) : null;
    const parent = parentOf(envelope);
    const parents = parent ? [parent] : [];
    if (own) union(own, own);
    for (const reference of parents) union(own ?? parents[0]!, reference);
  }

  const threads: Thread[] = [];
  const groups = new Map<string, Thread>();
  for (const envelope of envelopes) {
    const anchor = envelope.messageId && idKey(envelope.messageId) ? nodeOf(envelope, envelope.messageId) : parentOf(envelope);
    const subject = threadKey(envelope.subject);
    // Header-linked groups and subject-only groups never mix.
    const key = anchor ? `id:${find(anchor)}` : subject ? `subject:${scope(envelope)}\u0000${subject}` : null;
    if (key === null) {
      threads.push({ head: envelope, rest: [] });
      continue;
    }
    const existing = groups.get(key);
    if (existing) existing.rest.push(envelope);
    else {
      const thread = { head: envelope, rest: [] };
      groups.set(key, thread);
      threads.push(thread);
    }
  }
  return threads;
}
