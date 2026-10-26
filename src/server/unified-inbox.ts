import {
  UNIFIED_INBOX_MAX_PAGE,
  type Envelope,
  type EnvelopeSource,
  type UnifiedInboxResult,
  type UnifiedWarning,
} from "../shared/types.js";
import type { SearchInput } from "./contracts.js";
import { HimalayaError, type HimalayaService } from "./himalaya.js";
import type { SourceRef } from "./search-scope.js";

export type UnifiedInboxQuery = {
  accounts: readonly string[];
  page: number;
  pageSize: number;
  search?: SearchInput;
};

export type SourcesQuery = {
  page: number;
  pageSize: number;
  search?: SearchInput;
};

const SOURCE_PAGE_SIZE = 100;
// Each account is its own IMAP server, so a wide fan-out is safe; measured live: 19 accounts took 18 s at 4 in parallel.
export const SOURCE_CONCURRENCY = 10;
type SourcedEnvelope = Envelope & { source: EnvelopeSource };
type SourceResult = {
  envelopes: SourcedEnvelope[];
  hasMore: boolean;
  warnings: UnifiedWarning[];
};

function dateValue(date: string | null): number {
  const value = date === null ? NaN : Date.parse(date);
  return Number.isFinite(value) ? value : -Infinity;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function warningFor(account: string, error: unknown, mailbox?: string): UnifiedWarning {
  return {
    account,
    ...(mailbox === undefined ? {} : { mailbox }),
    code: error instanceof HimalayaError ? error.code : "MAIL_OPERATION_FAILED",
    message: error instanceof HimalayaError ? error.message : "Das Konto konnte nicht geladen werden.",
  };
}

function assertPaging(query: { page: number; pageSize: number }): void {
  if (!Number.isInteger(query.page) || query.page < 1 || query.page > UNIFIED_INBOX_MAX_PAGE) {
    throw new HimalayaError("Invalid unified inbox page.", "INVALID_INPUT", false);
  }
  if (!Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 50) {
    throw new HimalayaError("Invalid unified inbox page size.", "INVALID_INPUT", false);
  }
}

function createSourceLoader(
  service: Pick<HimalayaService, "listEnvelopes">,
  query: SourcesQuery,
  sourceLimit: number,
): (source: SourceRef) => Promise<SourceResult> {
  return async (source) => {
    try {
      const envelopes: SourcedEnvelope[] = [];
      let hasMore = false;
      // Fixed-size source pages can overfetch by at most 99 envelopes.
      for (let page = 1; page <= Math.ceil(sourceLimit / SOURCE_PAGE_SIZE); page++) {
        const items = await service.listEnvelopes({
          account: source.account,
          mailbox: source.mailbox,
          page,
          pageSize: SOURCE_PAGE_SIZE,
          ...(query.search === undefined ? {} : { search: query.search }),
        });
        envelopes.push(...items.map((item) => ({ ...item, source: { account: source.account, mailbox: source.mailbox } })));
        hasMore = items.length === SOURCE_PAGE_SIZE;
        if (!hasMore) break;
      }
      return {
        envelopes: envelopes.slice(0, sourceLimit),
        hasMore: hasMore || envelopes.length > sourceLimit,
        warnings: [],
      };
    } catch (error) {
      return { envelopes: [], hasMore: false, warnings: [warningFor(source.account, error, source.mailbox)] };
    }
  };
}

async function inBatches<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let offset = 0; offset < items.length; offset += SOURCE_CONCURRENCY) {
    results.push(...await Promise.all(items.slice(offset, offset + SOURCE_CONCURRENCY).map(work)));
  }
  return results;
}

function sortEnvelopes(envelopes: SourcedEnvelope[], query: SourcesQuery): void {
  const direction = query.search?.order === "asc" ? 1 : -1;
  envelopes.sort((left, right) => {
    const leftDate = dateValue(left.date);
    const rightDate = dateValue(right.date);
    // Undated mail sorts last in both directions.
    if ((leftDate === -Infinity) !== (rightDate === -Infinity)) return leftDate === -Infinity ? 1 : -1;
    return (leftDate === -Infinity ? 0 : direction * (leftDate - rightDate))
      || compareText(left.source.account, right.source.account)
      || compareText(left.source.mailbox, right.source.mailbox)
      || compareText(left.id, right.id);
  });
}

function mergeResults(results: readonly SourceResult[], query: SourcesQuery): UnifiedInboxResult {
  const end = query.page * query.pageSize;
  const envelopes = results.flatMap((result) => result.envelopes);
  sortEnvelopes(envelopes, query);

  return {
    envelopes: envelopes.slice(end - query.pageSize, end),
    hasMore: query.page < UNIFIED_INBOX_MAX_PAGE && (results.some((result) => result.hasMore) || envelopes.length > end),
    warnings: results.flatMap((result) => result.warnings),
  };
}

// A cut source may hide mail that ties with, or sorts before, the page boundary. The small window is
// only trusted when the boundary mail is strictly newer than where every cut source stopped.
function windowIsSafe(results: readonly SourceResult[], window: number, query: SourcesQuery): boolean {
  const cut = results.filter((result) => result.hasMore && result.envelopes.length >= window);
  if (cut.length === 0) return true;
  if (query.search?.order === "asc") return false;
  const merged = results.flatMap((result) => result.envelopes);
  sortEnvelopes(merged, query);
  const boundary = merged[query.page * query.pageSize - 1];
  if (!boundary) return false;
  const boundaryDate = dateValue(boundary.date);
  return cut.every((result) => boundaryDate > dateValue(result.envelopes.at(-1)?.date ?? null));
}

// Page 1 needs one source page per account; deeper pages or unsafe ties widen to the full bounded window.
async function mergeWithWindow(
  query: SourcesQuery,
  load: (limit: number) => Promise<SourceResult[]>,
): Promise<UnifiedInboxResult> {
  const full = UNIFIED_INBOX_MAX_PAGE * query.pageSize;
  // One envelope more than the page end tells "more pages" apart from "exactly full".
  const small = Math.min(full, Math.ceil((query.page * query.pageSize + 1) / SOURCE_PAGE_SIZE) * SOURCE_PAGE_SIZE);
  const results = await load(small);
  return mergeResults(small < full && !windowIsSafe(results, small, query) ? await load(full) : results, query);
}

export async function listSources(
  service: Pick<HimalayaService, "listEnvelopes">,
  sources: readonly SourceRef[],
  query: SourcesQuery,
): Promise<UnifiedInboxResult> {
  assertPaging(query);
  return mergeWithWindow(query, (limit) => inBatches(sources, createSourceLoader(service, query, limit)));
}

export async function listUnifiedInbox(
  service: Pick<HimalayaService, "listMailboxes" | "listEnvelopes">,
  query: UnifiedInboxQuery,
): Promise<UnifiedInboxResult> {
  assertPaging(query);

  async function loadAccount(account: string, limit: number): Promise<SourceResult> {
    try {
      const mailboxes = await service.listMailboxes(account, { counts: false });
      const inbox = mailboxes.find(({ id, name }) => id.toLowerCase() === "inbox" || name.toLowerCase() === "inbox");
      if (!inbox) {
        return {
          envelopes: [], hasMore: false,
          warnings: [{ account, code: "INBOX_NOT_FOUND", message: "Kein INBOX-Ordner für dieses Konto gefunden." }],
        };
      }
      const result = await createSourceLoader(service, query, limit)({ account, mailbox: inbox.id });
      // The unified inbox always means "the INBOX of an account", so its warnings stay account-level.
      return { ...result, warnings: result.warnings.map(({ mailbox: _mailbox, ...warning }) => warning) };
    } catch (error) {
      return { envelopes: [], hasMore: false, warnings: [warningFor(account, error)] };
    }
  }

  const accounts = [...new Set(query.accounts)];
  return mergeWithWindow(query, (limit) => inBatches(accounts, (account) => loadAccount(account, limit)));
}
