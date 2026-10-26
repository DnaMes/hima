import { SEARCH_MAX_SOURCES, type Mailbox, type UnifiedWarning } from "../shared/types.js";
import { HimalayaError, type HimalayaService } from "./himalaya.js";

export type SearchScope = "folder" | "account" | "all";
export type SourceRef = { account: string; mailbox: string };

// Measured live (19 accounts, field "all"): 60 sources took ~100 s end to end, so the cap is 30.
export const MAX_SOURCES = SEARCH_MAX_SOURCES;
const ACCOUNT_CONCURRENCY = 4;
const JUNK_NAME = /^(junk|spam|trash|papierkorb|deleted messages|deleted items|gelöschte elemente)$/i;
// Gmail's virtual folders hold copies of mail that also lives in the INBOX or a label, so searching
// them produces duplicate hits. Open the folder and use the "Dieser Ordner" scope to search them.
const GMAIL_AGGREGATE = /^\[(gmail|google mail)\]\/(all mail|alle nachrichten|important|wichtig|starred|markiert)$/i;

export type ResolveInput = {
  scope: SearchScope;
  accounts: readonly string[];
  current?: SourceRef;
  includeJunk: boolean;
};

export function isJunkOrTrash(mailbox: Mailbox): boolean {
  return [mailbox.id, mailbox.name].some((value) => JUNK_NAME.test(value.split(/[/.]/).pop() ?? value));
}

const JUNK_ONLY = /^(junk|spam|junk e-?mail)$/i;

/** The account's spam folder (never the trash), by name. */
export function findJunkMailbox(mailboxes: readonly Mailbox[]): Mailbox | null {
  return mailboxes.find((candidate) => [candidate.id, candidate.name].some((value) => JUNK_ONLY.test(value.split(/[/.]/).pop() ?? value))) ?? null;
}

export function isGmailAggregate(mailbox: Mailbox): boolean {
  return [mailbox.id, mailbox.name].some((value) => GMAIL_AGGREGATE.test(value));
}

const isInbox = (mailbox: Mailbox): boolean => [mailbox.id, mailbox.name].some((value) => value.toLowerCase() === "inbox");

function warningFor(account: string, error: unknown): UnifiedWarning {
  return {
    account,
    code: error instanceof HimalayaError ? error.code : "MAIL_OPERATION_FAILED",
    message: error instanceof HimalayaError ? error.message : "Das Konto konnte nicht geladen werden.",
  };
}

type AccountFolders = { inbox: SourceRef | null; rest: SourceRef[] };

export async function resolveSources(
  service: Pick<HimalayaService, "listMailboxes">,
  input: ResolveInput,
): Promise<{ sources: SourceRef[]; warnings: UnifiedWarning[] }> {
  if (input.scope === "folder") {
    return { sources: input.current ? [input.current] : [], warnings: [] };
  }
  if (input.scope === "account" && !input.current) {
    throw new HimalayaError("An account is required for the account scope.", "INVALID_INPUT", false);
  }
  const accounts = input.scope === "account" ? [input.current!.account] : [...new Set(input.accounts)];

  const warnings: UnifiedWarning[] = [];
  const perAccount: AccountFolders[] = [];
  for (let offset = 0; offset < accounts.length; offset += ACCOUNT_CONCURRENCY) {
    const batch = await Promise.all(accounts.slice(offset, offset + ACCOUNT_CONCURRENCY).map(async (account): Promise<AccountFolders> => {
      try {
        const mailboxes = (await service.listMailboxes(account, { counts: false }))
          .filter((candidate) => !isGmailAggregate(candidate) && (input.includeJunk || !isJunkOrTrash(candidate)));
        const inbox = mailboxes.find(isInbox);
        return {
          inbox: inbox ? { account, mailbox: inbox.id } : null,
          rest: mailboxes.filter((candidate) => candidate !== inbox).map((candidate) => ({ account, mailbox: candidate.id })),
        };
      } catch (error) {
        warnings.push(warningFor(account, error));
        return { inbox: null, rest: [] };
      }
    }));
    perAccount.push(...batch);
  }

  // Under the cap every account's INBOX comes first, then one more folder per account in turn.
  const ordered: SourceRef[] = perAccount.flatMap((entry) => (entry.inbox ? [entry.inbox] : []));
  for (let round = 0; perAccount.some((entry) => entry.rest[round]); round++) {
    for (const entry of perAccount) {
      const source = entry.rest[round];
      if (source) ordered.push(source);
    }
  }

  const skipped = new Map<string, number>();
  for (const source of ordered.slice(MAX_SOURCES)) skipped.set(source.account, (skipped.get(source.account) ?? 0) + 1);
  for (const [account, count] of skipped) {
    warnings.push({ account, code: "SOURCE_CAP", message: `${count} Ordner nicht durchsucht (Obergrenze ${MAX_SOURCES}).` });
  }
  return { sources: ordered.slice(0, MAX_SOURCES), warnings };
}
