import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { parse } from "@iarna/toml";

const ADDRESS_WARNING = "Adressen konnten nicht aus der Himalaya-Konfiguration gelesen werden.";

export type AccountEmailResult = {
  emails: Record<string, string | null>;
  providers: Record<string, string>;
  warning: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emptyEmails(accountNames: readonly string[]): Record<string, string | null> {
  return Object.fromEntries(accountNames.map((name) => [name, null]));
}

function defaultProviders(accountNames: readonly string[]): Record<string, string> {
  return Object.fromEntries(accountNames.map((name) => [name, "custom"]));
}

function extractServer(account: Record<string, unknown>): string | null {
  if (isRecord(account.imap)) {
    if (typeof account.imap.server === "string") return account.imap.server;
    if (typeof account.imap.host === "string") return account.imap.host;
  }
  if (isRecord(account.smtp)) {
    if (typeof account.smtp.server === "string") return account.smtp.server;
    if (typeof account.smtp.host === "string") return account.smtp.host;
  }
  if (typeof account["imap.server"] === "string") return account["imap.server"];
  return null;
}

function extractHostname(serverOrHost: string): string {
  const trimmed = serverOrHost.trim().toLowerCase();
  if (!trimmed) return "";
  try {
    const candidate = trimmed.includes("://") ? trimmed : `imaps://${trimmed}`;
    const url = new URL(candidate);
    return url.hostname.toLowerCase();
  } catch {
    return trimmed.replace(/^[^:]+:\/\//, "").split(/[:/]/)[0]?.toLowerCase() ?? "";
  }
}

function matchesDomain(hostname: string, domain: string): boolean {
  if (!hostname) return false;
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function detectProvider(
  serverOrHost: string | null | undefined,
  email: string | null | undefined,
  accountName: string,
): string {
  const host = extractHostname(serverOrHost ?? "");
  const em = (email ?? "").toLowerCase().trim();
  const name = accountName.toLowerCase().trim();

  if (
    matchesDomain(host, "gmail.com") ||
    matchesDomain(host, "googlemail.com") ||
    em.endsWith("@gmail.com") ||
    em.endsWith("@googlemail.com") ||
    name.startsWith("gmail")
  ) {
    return "gmail";
  }
  if (
    matchesDomain(host, "mail.me.com") ||
    matchesDomain(host, "icloud.com") ||
    em.endsWith("@icloud.com") ||
    em.endsWith("@me.com") ||
    em.endsWith("@mac.com")
  ) {
    return "icloud";
  }
  if (matchesDomain(host, "goneo.de") || em.endsWith("@goneo.de")) {
    return "goneo";
  }
  if (matchesDomain(host, "lima-city.de") || em.endsWith("@lima-city.de")) {
    return "lima-city";
  }
  if (
    matchesDomain(host, "outlook.com") ||
    matchesDomain(host, "office365.com") ||
    matchesDomain(host, "hotmail.com") ||
    em.endsWith("@outlook.com") ||
    em.endsWith("@hotmail.com") ||
    em.endsWith("@live.com")
  ) {
    return "outlook";
  }
  if (
    matchesDomain(host, "fastmail.com") ||
    matchesDomain(host, "fastmail.fm") ||
    matchesDomain(host, "messagingengine.com") ||
    em.endsWith("@fastmail.com") ||
    em.endsWith("@fastmail.fm")
  ) {
    return "fastmail";
  }
  if (
    matchesDomain(host, "protonmail.ch") ||
    matchesDomain(host, "protonmail.com") ||
    matchesDomain(host, "proton.me") ||
    em.endsWith("@proton.me") ||
    em.endsWith("@protonmail.com")
  ) {
    return "proton";
  }
  if (
    matchesDomain(host, "gmx.net") ||
    matchesDomain(host, "gmx.de") ||
    em.endsWith("@gmx.de") ||
    em.endsWith("@gmx.net")
  ) {
    return "gmx";
  }
  if (matchesDomain(host, "web.de") || em.endsWith("@web.de")) {
    return "webde";
  }
  if (
    matchesDomain(host, "posteo.de") ||
    matchesDomain(host, "posteo.net") ||
    em.endsWith("@posteo.de") ||
    em.endsWith("@posteo.net")
  ) {
    return "posteo";
  }
  if (matchesDomain(host, "mailbox.org") || em.endsWith("@mailbox.org")) {
    return "mailboxorg";
  }
  if (matchesDomain(host, "strato.de") || em.endsWith("@strato.de")) {
    return "strato";
  }
  if (
    matchesDomain(host, "your-server.de") ||
    matchesDomain(host, "hetzner.com") ||
    matchesDomain(host, "hetzner.de") ||
    em.endsWith("@hetzner.de")
  ) {
    return "hetzner";
  }
  if (
    matchesDomain(host, "ionos.de") ||
    matchesDomain(host, "ionos.com") ||
    matchesDomain(host, "1und1.de") ||
    em.endsWith("@ionos.de") ||
    em.endsWith("@1und1.de")
  ) {
    return "ionos";
  }
  return "custom";
}

export function parseAccountEmails(source: string, accountNames: readonly string[]): AccountEmailResult {
  try {
    const parsed = parse(source) as unknown;
    const accounts = isRecord(parsed) && isRecord(parsed.accounts) ? parsed.accounts : {};
    const emails = emptyEmails(accountNames);
    const providers = defaultProviders(accountNames);

    for (const accountName of accountNames) {
      const account = accounts[accountName];
      if (!isRecord(account)) continue;
      const email = account.email;
      const cleanEmail = typeof email === "string" && email.trim() ? email.trim() : null;
      if (cleanEmail) emails[accountName] = cleanEmail;
      const server = extractServer(account);
      providers[accountName] = detectProvider(server, cleanEmail, accountName);
    }

    return { emails, providers, warning: null };
  } catch {
    return { emails: emptyEmails(accountNames), providers: defaultProviders(accountNames), warning: ADDRESS_WARNING };
  }
}

export async function loadAccountEmails(
  accountNames: readonly string[],
  configPath = process.env.HIMALAYA_CONFIG_PATH ?? join(homedir(), ".config", "himalaya", "config.toml"),
): Promise<AccountEmailResult> {
  try {
    return parseAccountEmails(await readFile(configPath, "utf8"), accountNames);
  } catch {
    return { emails: emptyEmails(accountNames), providers: defaultProviders(accountNames), warning: ADDRESS_WARNING };
  }
}
