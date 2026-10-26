import { SEARCH_MAX_SOURCES, type MessageRef, type UnifiedInboxResult, type UnifiedWarning } from "../shared/types.js";
import { DEFAULT_FILTERS, searchBody, type SearchFilters } from "./search-state.js";

export type SenderHistory =
  | { kind: "first-contact"; laterCount: number; warnings: UnifiedWarning[] }
  | {
    kind: "known";
    earliest: { date: string | null; account: string; mailbox: string };
    count: number;
    /** The search had more pages, so `count` is only a lower bound. */
    atLeast: boolean;
    warnings: UnifiedWarning[];
  };

export type HistoryView =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; lines: string[] };

const isCurrent = (source: { account: string; mailbox: string } | undefined, id: string, ref: MessageRef): boolean =>
  source?.account === ref.account && source.mailbox === ref.mailbox && id === ref.message;

/**
 * Reads a "mails from this address, oldest first" result: is the open message the sender's first one?
 * Mail dated after the open message does not count as history; undated mail cannot be compared and does.
 * Only hits whose From address equals `senderEmail` count, so look-alike addresses never vouch for the sender.
 */
export function summarizeSenderHistory(
  result: UnifiedInboxResult,
  current: MessageRef,
  currentDate: string | null,
  senderEmail: string,
): SenderHistory {
  // The search matches substrings ("joe@x.com" also finds "bigjoe@x.com"), so keep only the exact address.
  const wanted = senderEmail.toLowerCase();
  const others = result.envelopes.filter((envelope) =>
    !isCurrent(envelope.source, envelope.id, current) && envelope.from.some((address) => address.email.toLowerCase() === wanted));
  const currentTime = currentDate === null ? NaN : Date.parse(currentDate);
  const isLater = (date: string | null): boolean => date !== null && Number.isFinite(currentTime) && Date.parse(date) > currentTime;
  const earlier = others.filter((envelope) => !isLater(envelope.date));
  const first = earlier[0];
  if (!first) {
    return { kind: "first-contact", laterCount: others.length, warnings: result.warnings };
  }
  return {
    kind: "known",
    earliest: { date: first.date, account: first.source?.account ?? "?", mailbox: first.source?.mailbox ?? "?" },
    count: earlier.length,
    atLeast: result.hasMore,
    warnings: result.warnings,
  };
}

// "2026-09-30T…" -> "30.09.2026", by string, so no timezone can shift the day.
const germanDay = (iso: string | null): string => (iso ? iso.slice(0, 10).split("-").reverse().join(".") : "(ohne Datum)");

export function historyLines(history: SenderHistory): string[] {
  const lines: string[] = [];
  if (history.kind === "first-contact") {
    lines.push("Erstkontakt: keine früheren Mails dieses Absenders gefunden.");
    if (history.laterCount > 0) lines.push(`Danach folgten ${history.laterCount} weitere Mail(s) dieses Absenders.`);
  } else {
    const noun = history.count === 1 ? "frühere Mail" : "frühere Mails";
    lines.push(`Bekannter Absender: ${history.atLeast ? "mindestens " : ""}${history.count} ${noun} in den durchsuchten Ordnern.`);
    lines.push(`Frühester Treffer: ${germanDay(history.earliest.date)} · ${history.earliest.account} / ${history.earliest.mailbox}`);
  }
  for (const warning of history.warnings) {
    lines.push(`Nicht durchsucht: ${warning.mailbox ? `${warning.account}/${warning.mailbox}` : warning.account}: ${warning.message}`);
  }
  lines.push(`Durchsucht wurden höchstens ${SEARCH_MAX_SOURCES} Ordner (INBOX zuerst).`);
  return lines;
}

/** Body for `POST /api/search`: the sender's oldest mails across the accounts of "Alle Eingänge". */
export function senderHistoryBody(email: string, accounts: readonly string[]): Record<string, unknown> {
  const filters: SearchFilters = { ...DEFAULT_FILTERS, scope: "all", order: "asc" };
  return searchBody({ filters, text: email, field: "from", unread: false, page: 1, pageSize: 50, accounts, current: null });
}

/** The applied search that lists every mail of the sender. */
export function senderSearchState(email: string): { text: string; field: "from"; unread: false; filters: SearchFilters } {
  return { text: email, field: "from", unread: false, filters: { ...DEFAULT_FILTERS, scope: "all" } };
}
