import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { Mailbox } from "../shared/types.js";

export type SpecialFolderKind = "sent" | "drafts" | "trash";
export type SentCopyMode = "auto" | "none";

export type AccountFolderSettings = {
  overrides: Partial<Record<SpecialFolderKind, string>>;
  sentCopy?: SentCopyMode;
  watch?: boolean;
};

// Gmail's IMAP folder-name prefix is "[Gmail]" for English-localized accounts
// and "[Google Mail]" for German-localized ones (verified against a live
// German Gmail account's `mailbox list` output: "[Google Mail]/Papierkorb",
// "[Google Mail]/Gesendet", "[Google Mail]/Entwürfe" — not "[Gmail]/...").
const CANDIDATES: Record<SpecialFolderKind, RegExp> = {
  sent: /^(sent( (items|messages|mail))?|gesendet|\[(gmail|google mail)]\/(sent mail|gesendet))$/i,
  drafts: /^(drafts?|entw(ü|u)rfe|\[(gmail|google mail)]\/entw(ü|u)rfe)$/i,
  trash: /^(trash|papierkorb|deleted( items)?|\[(gmail|google mail)]\/(trash|papierkorb))$/i,
};

export function resolveSpecialFolder(
  kind: SpecialFolderKind,
  mailboxes: readonly Mailbox[],
  overrides?: Partial<Record<SpecialFolderKind, string>>,
): string | null {
  const overrideId = overrides?.[kind];
  if (overrideId && mailboxes.some((mailbox) => mailbox.id === overrideId)) return overrideId;

  const pattern = CANDIDATES[kind];
  const match = mailboxes.find((mailbox) => pattern.test(mailbox.name) || pattern.test(mailbox.id));
  return match?.id ?? null;
}

export function defaultSentCopyMode(email: string | null): SentCopyMode {
  return email && /@gmail\.com$/i.test(email) ? "none" : "auto";
}

function defaultAccountsPath(): string {
  return process.env.HIMALAYA_WEB_ACCOUNTS_PATH ?? join(homedir(), ".config", "himalaya-web", "accounts.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readAccountsConfig(
  path: string = defaultAccountsPath(),
): Promise<Record<string, AccountFolderSettings>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(parsed)) return {};
    const result: Record<string, AccountFolderSettings> = {};
    for (const [account, value] of Object.entries(parsed)) {
      if (!isRecord(value)) continue;
      const overrides = isRecord(value.overrides) ? value.overrides : {};
      const sentCopy = value.sentCopy === "auto" || value.sentCopy === "none" ? value.sentCopy : undefined;
      const watch = value.watch === true ? true : undefined;
      result[account] = {
        overrides: {
          ...(typeof overrides.sent === "string" ? { sent: overrides.sent } : {}),
          ...(typeof overrides.drafts === "string" ? { drafts: overrides.drafts } : {}),
          ...(typeof overrides.trash === "string" ? { trash: overrides.trash } : {}),
        },
        ...(sentCopy !== undefined ? { sentCopy } : {}),
        ...(watch !== undefined ? { watch } : {}),
      };
    }
    return result;
  } catch {
    return {};
  }
}

export async function writeAccountFolderSettings(
  account: string,
  settings: AccountFolderSettings,
  path: string = defaultAccountsPath(),
): Promise<void> {
  const current = await readAccountsConfig(path);
  const next = { ...current, [account]: settings };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(next, null, 2), { mode: 0o600 });
}
