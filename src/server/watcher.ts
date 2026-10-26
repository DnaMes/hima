import { messageRef } from "./contracts.js";
import type { Envelope, Mailbox, MessageRef, Risk } from "../shared/types.js";
import { HimalayaError, type HimalayaService } from "./himalaya.js";
import { parseRawMessage } from "./mime.js";
import type { SenderStore } from "./senders.js";
import { planActions, readRules as defaultReadRules, type Rule } from "./rules.js";
import { readAccountsConfig as defaultReadAccountsConfig, type AccountFolderSettings } from "./special-folders.js";

export type WatchAccountSummary = {
  account: string;
  unread: number | null;
  error: string | null;
};

export type WatchSummary = {
  accounts: WatchAccountSummary[];
  totalUnread: number;
};

export interface Watcher {
  start(): void;
  stop(): void;
  summary(): WatchSummary;
  /** Phishing verdict computed when the message arrived; undefined when clean or never assessed. */
  riskFor(ref: MessageRef): Exclude<Risk["level"], "none"> | undefined;
  /** Drops the cached verdicts of one sender, after the operator trusted or reported it. */
  forgetSender(email: string): void;
}

const DEFAULT_INTERVAL_MS = 60_000;
const NOTIFIED_ID_CAP = 200;
const COALESCE_THRESHOLD = 3;
const NEW_MAIL_PAGE_SIZE = 10;
const RISK_CAP = 500;
const MAX_ASSESS_BYTES = 2 * 1024 * 1024;
const UNKNOWN_ERROR_MESSAGE = "Unbekannter Fehler beim Abrufen des Postfachs.";
const NO_INBOX_ERROR_MESSAGE = "INBOX für dieses Konto nicht gefunden.";

type AccountState = {
  lastUnread: number | null;
  notifiedIds: string[];
  seen: Set<string>;
};

export function createWatcher(deps: {
  service: Pick<HimalayaService, "listMailboxes" | "listEnvelopes" | "setFlag" | "move"> & Partial<Pick<HimalayaService, "readRaw">>;
  readAccountsConfig?: () => Promise<Record<string, AccountFolderSettings>>;
  readRules?: (path?: string) => Promise<Rule[]>;
  notify: (title: string, body: string) => void;
  senders?: Pick<SenderStore, "lists">;
  intervalMs?: number;
}): Watcher {
  const readAccountsConfig = deps.readAccountsConfig ?? defaultReadAccountsConfig;
  const readRules = deps.readRules ?? defaultReadRules;
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const states = new Map<string, AccountState>();
  const currentSummary = new Map<string, WatchAccountSummary>();
  // ponytail: in-memory, lost on restart and oldest-first eviction; persist to a state file if the badge must survive restarts.
  const risks = new Map<string, { level: Exclude<Risk["level"], "none">; email: string }>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;

  function findInbox(mailboxes: readonly Mailbox[]): Mailbox | null {
    return mailboxes.find(({ id, name }) => id.toLowerCase() === "inbox" || name.toLowerCase() === "inbox") ?? null;
  }

  function remember(state: AccountState, id: string): void {
    if (state.seen.has(id)) return;
    state.seen.add(id);
    state.notifiedIds.push(id);
    if (state.notifiedIds.length > NOTIFIED_ID_CAP) {
      const evicted = state.notifiedIds.shift();
      if (evicted !== undefined) state.seen.delete(evicted);
    }
  }

  function errorMessage(error: unknown): string {
    return error instanceof HimalayaError ? error.message : UNKNOWN_ERROR_MESSAGE;
  }

  function describeEnvelope(envelope: Envelope): string {
    const from = envelope.from[0]?.name ?? envelope.from[0]?.email ?? "Unbekannter Absender";
    return `${from}: ${envelope.subject || "(kein Betreff)"}`;
  }

  const riskKey = (ref: MessageRef): string => `${ref.account}/${ref.mailbox}/${ref.message}`;

  async function assessRisk(account: string, mailbox: string, envelope: Envelope): Promise<boolean> {
    if (!deps.service.readRaw || envelope.size > MAX_ASSESS_BYTES) return false;
    try {
      const ref = messageRef(account, mailbox, envelope.id);
      const detail = await parseRawMessage(await deps.service.readRaw(ref), [], ref, deps.senders ? { senders: await deps.senders.lists() } : {});
      if (detail.sender.risk.level === "none") return false;
      risks.set(riskKey(ref), { level: detail.sender.risk.level, email: (detail.envelope.from[0]?.email ?? "").toLowerCase() });
      if (risks.size > RISK_CAP) risks.delete(risks.keys().next().value as string);
      return true;
    } catch {
      return false;
    }
  }

  async function applyRules(
    account: string,
    mailbox: string,
    envelope: Envelope,
    accountRules: readonly Rule[],
  ): Promise<boolean> {
    const outcomes = planActions(envelope, accountRules);
    let suppressed = false;
    for (const outcome of outcomes) {
      if (outcome.dryRun) {
        if (outcome.flagsApplied.length > 0 || outcome.movedTo) {
          const flagsText = outcome.flagsApplied.map((f) => `${f.flag}=${f.value}`).join(", ");
          const moveText = outcome.movedTo ? `move to "${outcome.movedTo}"` : "";
          process.stdout.write(
            `[rules] dry-run match: rule "${outcome.ruleId}" on ${account}/${envelope.id} would ${[flagsText, moveText].filter(Boolean).join("; ")}\n`,
          );
        }
        continue;
      }
      try {
        const ref = messageRef(account, mailbox, envelope.id);
        for (const flag of outcome.flagsApplied) {
          await deps.service.setFlag(ref, flag.flag, flag.value);
          if (flag.flag === "seen" && flag.value) suppressed = true;
        }
        if (outcome.movedTo) {
          await deps.service.move(ref, outcome.movedTo);
          suppressed = true;
        }
      } catch (error) {
        process.stderr.write(
          `[rules] action failed for rule "${outcome.ruleId}" on ${account}/${envelope.id}: ${errorMessage(error)}\n`,
        );
      }
    }
    return suppressed;
  }

  async function tickAccount(account: string, accountRules: readonly Rule[]): Promise<void> {
    let state = states.get(account);
    const isFirstTick = state === undefined;
    if (!state) {
      state = { lastUnread: null, notifiedIds: [], seen: new Set() };
      states.set(account, state);
    }

    try {
      const mailboxes = await deps.service.listMailboxes(account);
      const inbox = findInbox(mailboxes);
      if (!inbox) {
        state.lastUnread = null;
        currentSummary.set(account, { account, unread: null, error: NO_INBOX_ERROR_MESSAGE });
        return;
      }

      const unread = inbox.unread;
      const rose = !isFirstTick && state.lastUnread !== null && unread !== null && unread > state.lastUnread;
      state.lastUnread = unread;
      currentSummary.set(account, { account, unread, error: null });

      if (isFirstTick) {
        // Seed notifiedIds with the account's existing unread backlog so the
        // next real rise only reports genuinely new mail, not everything
        // that was already sitting in the INBOX when the service started.
        const existing = await deps.service.listEnvelopes({
          account,
          mailbox: inbox.id,
          page: 1,
          pageSize: NEW_MAIL_PAGE_SIZE,
          search: { field: "all", text: "", unread: true },
        });
        for (const envelope of existing) remember(state, envelope.id);
        return;
      }

      if (!rose) return;

      const envelopes = await deps.service.listEnvelopes({
        account,
        mailbox: inbox.id,
        page: 1,
        pageSize: NEW_MAIL_PAGE_SIZE,
        search: { field: "all", text: "", unread: true },
      });
      const fresh = envelopes.filter((envelope) => !state!.seen.has(envelope.id));
      if (fresh.length === 0) return;

      const notifiable: Envelope[] = [];
      const risky: Envelope[] = [];
      for (const envelope of fresh) {
        const suppressed = await applyRules(account, inbox.id, envelope, accountRules);
        if (suppressed) continue;
        (await assessRisk(account, inbox.id, envelope) ? risky : notifiable).push(envelope);
      }
      for (const envelope of fresh) remember(state, envelope.id);

      // A phishing warning is never coalesced into a count.
      for (const envelope of risky) deps.notify(account, `⚠ Phishing-Verdacht: ${describeEnvelope(envelope)}`);
      if (notifiable.length === 0) return;
      if (notifiable.length > COALESCE_THRESHOLD) {
        deps.notify(account, `${notifiable.length} neue Nachrichten in ${account}`);
      } else {
        for (const envelope of notifiable) deps.notify(account, describeEnvelope(envelope));
      }
    } catch (error) {
      currentSummary.set(account, { account, unread: null, error: errorMessage(error) });
    }
  }

  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      const config = await readAccountsConfig();
      const watched = Object.entries(config)
        .filter(([, settings]) => settings.watch === true)
        .map(([account]) => account);

      const stillWatched = new Set(watched);
      for (const account of [...states.keys()]) {
        if (!stillWatched.has(account)) {
          states.delete(account);
          currentSummary.delete(account);
        }
      }

      const allRules = await readRules();
      for (const account of watched) {
        const accountRules = allRules.filter((rule) => rule.account === account && rule.enabled);
        await tickAccount(account, accountRules);
      }
    } finally {
      ticking = false;
    }
  }

  function start(): void {
    if (timer) return;
    timer = setInterval(() => { void tick(); }, intervalMs);
    void tick();
  }

  function stop(): void {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function summary(): WatchSummary {
    const accounts = [...currentSummary.values()];
    const totalUnread = accounts.reduce((sum, entry) => sum + (entry.unread ?? 0), 0);
    return { accounts, totalUnread };
  }

  function riskFor(ref: MessageRef): Exclude<Risk["level"], "none"> | undefined {
    return risks.get(riskKey(ref))?.level;
  }

  function forgetSender(email: string): void {
    const wanted = email.trim().toLowerCase();
    for (const [key, entry] of risks) if (entry.email === wanted) risks.delete(key);
  }

  return { start, stop, summary, riskFor, forgetSender };
}
