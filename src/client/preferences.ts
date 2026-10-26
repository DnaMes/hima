import type { Mailbox } from "../shared/types.js";

export type InitialView = "unified" | "account";

export const LAST_VIEW_KEY = "himalaya-web-last-view";
export const MISSING_ADDRESS_LABEL = "Adresse nicht konfiguriert";

/**
 * A fresh session, and any saved value other than the explicit "account"
 * marker, starts in the unified inbox. Only a session that previously chose
 * a single account restores that account view.
 */
export function chooseInitialView(savedView: string | null): InitialView {
  return savedView === "account" ? "account" : "unified";
}

// Mirrors the Sent candidates in src/server/special-folders.ts (the client has no folder-kind field).
const SENT_NAME = /^(sent( (items|messages|mail))?|gesendet|\[(gmail|google mail)]\/(sent mail|gesendet))$/i;

export function isSentMailbox(mailbox: { id: string; name: string } | undefined): boolean {
  return mailbox !== undefined && (SENT_NAME.test(mailbox.name) || SENT_NAME.test(mailbox.id));
}

export function isInboxMailbox(mailbox: { id: string; name: string }): boolean {
  return mailbox.name.toUpperCase() === "INBOX" || mailbox.id.toUpperCase() === "INBOX";
}

// Inbox then Sent, always shown at the top of an account.
export function pinnedMailboxes(mailboxes: readonly Mailbox[]): Mailbox[] {
  const inbox = mailboxes.find(isInboxMailbox);
  const sent = mailboxes.find(isSentMailbox);
  return [inbox, sent].filter((mailbox): mailbox is Mailbox => mailbox !== undefined);
}

export function chooseMailbox(
  mailboxes: readonly Mailbox[],
  savedMailboxId: string | null,
): string | null {
  return mailboxes.find((mailbox) => mailbox.id === savedMailboxId)?.id
    ?? mailboxes.find((mailbox) => mailbox.name.toUpperCase() === "INBOX")?.id
    ?? mailboxes[0]?.id
    ?? null;
}
