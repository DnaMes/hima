import type { Account, Mailbox } from "../shared/types.js";

export type FavoriteFilter = "all" | "favorites";
export type InitialView = "unified" | "account";

export const ACCOUNT_FAVORITES_KEY = "himalaya-web-favorites";
export const MAILBOX_FAVORITES_KEY = "himalaya-web-mailbox-favorites-v1";
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

export function mailboxFavoriteKey(accountName: string, mailboxId: string): string {
  return `${accountName}:${mailboxId}`;
}

export function filterAccounts(
  accounts: readonly Account[],
  query: string,
  filter: FavoriteFilter,
  favoriteNames: ReadonlySet<string>,
  accountOrder?: readonly string[],
): Account[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("de-DE");
  const orderIndex = new Map(accountOrder?.map((name, index) => [name, index]));
  return accounts
    .filter((account) => {
      if (filter === "favorites" && !favoriteNames.has(account.name)) return false;
      if (!normalizedQuery) return true;
      const email = account.email ?? MISSING_ADDRESS_LABEL;
      return `${account.name} ${email}`.toLocaleLowerCase("de-DE").includes(normalizedQuery);
    })
    .sort((left, right) => {
      const favoriteComparison = Number(favoriteNames.has(right.name)) - Number(favoriteNames.has(left.name));
      if (favoriteComparison !== 0) return favoriteComparison;

      const leftIndex = orderIndex.get(left.name);
      const rightIndex = orderIndex.get(right.name);
      if (leftIndex !== undefined && rightIndex !== undefined) return leftIndex - rightIndex;
      if (leftIndex !== undefined) return -1;
      if (rightIndex !== undefined) return 1;
      return left.name.localeCompare(right.name, "de-DE");
    });
}

export function filterMailboxes(
  accountName: string,
  mailboxes: readonly Mailbox[],
  filter: FavoriteFilter,
  favoriteKeys: ReadonlySet<string>,
): Mailbox[] {
  return mailboxes.filter((mailbox) => (
    filter === "all" || favoriteKeys.has(mailboxFavoriteKey(accountName, mailbox.id))
  ));
}

// Mirrors the Sent candidates in src/server/special-folders.ts (the client has no folder-kind field).
const SENT_NAME = /^(sent( (items|messages|mail))?|gesendet|\[(gmail|google mail)]\/(sent mail|gesendet))$/i;

export function isSentMailbox(mailbox: { id: string; name: string } | undefined): boolean {
  return mailbox !== undefined && (SENT_NAME.test(mailbox.name) || SENT_NAME.test(mailbox.id));
}

export function isInboxMailbox(mailbox: { id: string; name: string }): boolean {
  return mailbox.name.toUpperCase() === "INBOX" || mailbox.id.toUpperCase() === "INBOX";
}

// Inbox then Sent, always shown at the top of an account regardless of favorites or filter.
export function pinnedMailboxes(mailboxes: readonly Mailbox[]): Mailbox[] {
  const inbox = mailboxes.find(isInboxMailbox);
  const sent = mailboxes.find(isSentMailbox);
  return [inbox, sent].filter((mailbox): mailbox is Mailbox => mailbox !== undefined);
}

export function chooseMailbox(
  mailboxes: readonly Mailbox[],
  savedMailboxId: string | null,
  filter: FavoriteFilter,
  favoriteKeys: ReadonlySet<string>,
  accountName: string,
): string | null {
  const visible = filterMailboxes(accountName, mailboxes, filter, favoriteKeys);
  return visible.find((mailbox) => mailbox.id === savedMailboxId)?.id
    ?? visible.find((mailbox) => mailbox.name.toUpperCase() === "INBOX")?.id
    ?? visible[0]?.id
    ?? null;
}
