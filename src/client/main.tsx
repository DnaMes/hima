import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, JSX } from "react";
import { createRoot } from "react-dom/client";
import DOMPurify from "dompurify";

import { APP_NAME, APP_VERSION_LABEL } from "../shared/app-meta.js";
import type {
  Account,
  ApiError,
  Attachment,
  Envelope,
  Mailbox,
  MessageDetail,
  MessageRef,
  UnifiedWarning,
} from "../shared/types.js";
import { UNIFIED_INBOX_MAX_PAGE } from "../shared/types.js";
import {
  ACCOUNT_HUE_NAMES,
  emptyAccountColorState,
  readAccountColorState,
  resolveAccountColors,
  setManualAccountColor,
  writeAccountColorState,
} from "./account-colors.js";
import type { AccountColorState } from "./account-colors.js";
import { hueStyle } from "./hue-style.js";
import { readListDensity, writeListDensity } from "./list-density.js";
import type { ListDensity } from "./list-density.js";
import { isSeen, MessageList } from "./message-list.js";
import { historyLines, senderHistoryBody, senderSearchState, summarizeSenderHistory } from "./sender-history.js";
import type { HistoryView } from "./sender-history.js";
import { collectContacts } from "./contacts.js";
import { previewFor } from "./attachment-preview.js";
import type { PreviewKind } from "./attachment-preview.js";
import { addLabels, hasLabel, labelNames } from "./labels.js";
import type { LabeledMessage } from "./labels.js";
import { ListCache } from "./list-cache.js";
import { formatWake, snoozeKey, wakeOptions } from "./snooze.js";
import type { SnoozedMessage } from "./snooze.js";
import { countRemoteImages, readImageSenders, writeImageSenders } from "./remote-images.js";
import { CommandPalette } from "./palette-dialog.js";
import type { PaletteCommand } from "./command-palette.js";
import { RulesDialog } from "./rules-dialog.js";
import { SHORTCUTS, shortcutFor } from "./shortcuts.js";
import type { ShortcutAction } from "./shortcuts.js";
import { RiskBanner, SenderDetails } from "./sender-panel.js";
import {
  chooseInitialView,
  isSentMailbox,
  pinnedMailboxes,
  chooseMailbox as chooseInitialMailbox,
  LAST_VIEW_KEY,
  MISSING_ADDRESS_LABEL,
} from "./preferences.js";
import {
  chooseInitialAccount,
  filterSelectableAccounts,
  filterUnifiedAccounts,
  preferenceForAccount,
  readAccountPreferences,
  updateAccountPreference,
  writeAccountPreferences,
} from "./account-state.js";
import type { AccountPreferencePatch, AccountPreferences } from "./account-state.js";
import { activeChips, clearFilter, DEFAULT_FILTERS, filterFields, searchBody, usesSearchRoute } from "./search-state.js";
import type { SearchFilters, SearchFlag, SearchScope } from "./search-state.js";
import { readSavedSearches, removeSavedSearch, upsertSavedSearch, writeSavedSearches } from "./saved-searches.js";
import type { SavedSearch, SearchField } from "./saved-searches.js";
import {
  moveAccount,
  normalizeAccountOrder,
  orderedAccounts,
  readAccountOrder,
  writeAccountOrder,
} from "./account-order.js";
import { api } from "./api-client.js";
import { aiTaskLabel, buildPrintDocument, messageExportUrl, messageRawUrl } from "./message-actions.js";
import { formatMessageText, rawHeaderBlock } from "./message-copy.js";
import type { ClientAiTask } from "./message-actions.js";
import { Composer, type ComposerSeed } from "./composer.js";
import { SendFlowUi, useSendFlow } from "./send-flow.js";
import {
  applyTheme,
  persistTheme,
  readStoredTheme,
  resolveTheme,
  THEMES,
} from "./themes.js";
import type { ThemeName } from "./themes.js";
import {
  IconCompose,
  IconRefresh,
  IconSearch,
  IconFilter,
  IconInbox,
  IconFolder,
  IconSettings,
  IconStar,
  IconTrash,
  IconMove,
  IconReply,
  IconReplyAll,
  IconForward,
  IconSnooze,
  IconTag,
  IconSparkles,
  IconPaperclip,
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconKeyboard,
  IconRules,
  IconTheme,
  IconPrinter,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconMail,
} from "./icons.js";
import { ProviderLogo, providerLabel } from "./provider-logos.js";
import "./styles.css";

const PAGE_SIZE = 50;
const LAST_ACCOUNT_KEY = "himalaya-web-last-account";
const LAST_MAILBOX_KEY = "himalaya-web-last-mailbox";
const SEARCH_EXPANDED_KEY = "himalaya-web-search-expanded";

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const preferenceStorage = typeof window === "undefined" ? null : browserStorage();
const initialTheme: ThemeName = preferenceStorage ? readStoredTheme(preferenceStorage) : "midnight";
if (typeof document !== "undefined") applyTheme(document.documentElement, initialTheme);


type MessageListResponse = { envelopes: Envelope[] };
type UnifiedInboxResponse = { envelopes: Envelope[]; hasMore: boolean; warnings: UnifiedWarning[] };
type MailboxResponse = { mailboxes: Mailbox[] };
type BootstrapResponse = { accounts: Account[]; addressWarning: string | null; snoozed?: SnoozedMessage[]; labels?: LabeledMessage[] };
type AiResponse = { task: ClientAiTask; text: string; provider: string; model: string; truncated: boolean };

function sessionToken(): string | null {
  const metaToken = document.querySelector('meta[name="himalaya-session"]')?.getAttribute("content");
  if (metaToken) return metaToken;

  const hash = window.location.hash;
  const match = hash.match(/(?:^#|&)session=([^&]+)/);
  const token = match?.[1] ? decodeURIComponent(match[1]) : null;
  if (token) window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
  return token;
}

function withSeen(envelope: Envelope, seen: boolean): Envelope {
  return {
    ...envelope,
    flags: seen
      ? [...envelope.flags.filter((flag) => flag.iana !== "seen" && flag.raw.toLowerCase() !== "\\seen"), { iana: "seen", raw: "\\Seen" }]
      : envelope.flags.filter((flag) => flag.iana !== "seen" && flag.raw.toLowerCase() !== "\\seen"),
  };
}

function fullDate(value: string | null): string {
  if (!value) return "Unbekanntes Datum";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("de-DE", { dateStyle: "full", timeStyle: "short" }).format(date);
}

type MailboxLoadState =
  | { status: "idle"; mailboxes: Mailbox[] }
  | { status: "loading"; mailboxes: Mailbox[] }
  | { status: "ready"; mailboxes: Mailbox[] }
  | { status: "error"; mailboxes: Mailbox[]; error: string };
type MailboxesByAccount = Record<string, MailboxLoadState>;
const EMPTY_MAILBOX_STATE: MailboxLoadState = { status: "idle", mailboxes: [] };

// A message's HTML renders inside a sandboxed iframe (allow-popups only, no
// scripts, no same-origin, no top-navigation), so a link the sender wrote
// can only ever open as a brand-new, unrelated tab — never navigate this
// app away or run script in its context. Force target/rel on every link
// regardless of what the message's own markup says, since it's untrusted
// content: without rel="noopener", the opened tab would get a
// window.opener reference back into the sandboxed frame (reverse
// tabnabbing), and without target="_blank" a plain link would have nowhere
// to navigate at all inside a sandboxed frame with no allow-top-navigation.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
  // Images only exist here once the operator allowed them: https only, never sending a Referer.
  if (node.tagName === "IMG") {
    for (const attribute of ["srcset", "sizes", "style", "onerror", "onload"]) node.removeAttribute(attribute);
    if (!/^https:\/\//i.test(node.getAttribute("src") ?? "")) node.removeAttribute("src");
    else {
      node.setAttribute("referrerpolicy", "no-referrer");
      node.setAttribute("loading", "lazy");
    }
  }
});

function App(): JSX.Element {
  const token = useMemo(sessionToken, []);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountOrder, setAccountOrder] = useState<string[]>([]);
  const [accountPreferences, setAccountPreferences] = useState<AccountPreferences>(() => (
    preferenceStorage ? readAccountPreferences(preferenceStorage) : {}
  ));
  const [theme, setTheme] = useState<ThemeName>(initialTheme);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [unifiedSelected, setUnifiedSelected] = useState(false);
  const [mailboxesByAccount, setMailboxesByAccount] = useState<MailboxesByAccount>({});
  const [selectedMailbox, setSelectedMailbox] = useState<string | null>(null);
  const [rawEnvelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [snoozed, setSnoozed] = useState<SnoozedMessage[]>([]);
  const [labelEntries, setLabelEntries] = useState<LabeledMessage[]>([]);
  const [labelFilter, setLabelFilter] = useState("");
  const [labelDraft, setLabelDraft] = useState("");
  const [snoozedOpen, setSnoozedOpen] = useState(false);
  const [unifiedWarnings, setUnifiedWarnings] = useState<UnifiedWarning[]>([]);
  const [unifiedHasMore, setUnifiedHasMore] = useState(false);
  const [unifiedLoadFailed, setUnifiedLoadFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [searchText, setSearchText] = useState("");
  const [searchField, setSearchField] = useState<SearchField>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [activeSearch, setActiveSearch] = useState<{ text: string; field: SearchField; unread: boolean; filters: SearchFilters }>(
    { text: "", field: "all", unread: false, filters: DEFAULT_FILTERS },
  );
  const [searchFilters, setSearchFilters] = useState<SearchFilters>(DEFAULT_FILTERS);
  const [selectedMessage, setSelectedMessage] = useState<MessageRef | null>(null);
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [aiResult, setAiResult] = useState<AiResponse | null>(null);
  const [aiLoading, setAiLoading] = useState<ClientAiTask | null>(null);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copyAccount, setCopyAccount] = useState("");
  const [copyMailbox, setCopyMailbox] = useState("");
  const [copying, setCopying] = useState(false);
  const [senderHistory, setSenderHistory] = useState<HistoryView>({ status: "idle" });
  const [senderBusy, setSenderBusy] = useState(false);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>(() => readSavedSearches(localStorage));
  const [savedChoice, setSavedChoice] = useState("");
  const [savingName, setSavingName] = useState<string | null>(null);
  const [addressWarning, setAddressWarning] = useState<string | null>(null);
  const [accountManagerOpen, setAccountManagerOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [preview, setPreview] = useState<{ name: string; kind: PreviewKind; url: string; text: string } | null>(null);
  const [allowedImages, setAllowedImages] = useState<ReadonlySet<string>>(new Set());
  const [imageSenders, setImageSenders] = useState<ReadonlySet<string>>(() => readImageSenders(localStorage));
  const [threadView, setThreadView] = useState(() => localStorage.getItem("himalaya-web-thread-view-v1") === "on");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [composerSeed, setComposerSeed] = useState<ComposerSeed | null>(null);
  const [accountMoveNotice, setAccountMoveNotice] = useState<{ name: string; sequence: number } | null>(null);
  const [colorState, setColorState] = useState<AccountColorState>(() => (
    preferenceStorage ? readAccountColorState(preferenceStorage) : emptyAccountColorState()
  ));
  const accountColors = useMemo(
    () => resolveAccountColors(accounts.map((account) => account.name), colorState).colors,
    [accounts, colorState],
  );
  const [density, setDensity] = useState<ListDensity>(() => (
    preferenceStorage ? readListDensity(preferenceStorage) : "compact"
  ));
  const [searchExpanded, setSearchExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SEARCH_EXPANDED_KEY) !== "false";
    } catch {
      return true;
    }
  });

  const toggleSearch = () => {
    setSearchExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SEARCH_EXPANDED_KEY, String(next));
      } catch {}
      return next;
    });
  };

  const openSearch = () => {
    setSearchExpanded(true);
    try {
      localStorage.setItem(SEARCH_EXPANDED_KEY, "true");
    } catch {}
  };
  // The send flow lives above the composer so the undo and outcome banners
  // survive the composer closing, matching the server-side outbox.
  const sendFlow = useSendFlow(token ?? "");
  const mailboxRequests = useRef(new Map<string, number>());
  const detailRequest = useRef(0);
  const aiRequest = useRef(0);
  const messageRequest = useRef(0);
  const listCache = useRef(new ListCache());
  const detailCache = useRef(new Map<string, MessageDetail>());
  const cacheGeneration = useRef(0);
  const accountManagerButton = useRef<HTMLButtonElement>(null);
  const accountManagerCloseButton = useRef<HTMLButtonElement>(null);
  const accountManagerWasOpen = useRef(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const shortcutHandler = useRef<(action: ShortcutAction) => void>(() => undefined);
  const mailboxes = selectedAccount ? mailboxState(selectedAccount).mailboxes : EMPTY_MAILBOX_STATE.mailboxes;
  const orderedAccountList = useMemo(() => orderedAccounts(accounts, accountOrder), [accounts, accountOrder]);
  const selectableAccounts = filterSelectableAccounts(orderedAccountList, accountPreferences);
  const unifiedAccounts = filterUnifiedAccounts(orderedAccountList, accountPreferences);
  // The applied (not the edited) filters decide where rows come from, so editing the form never flips the list.
  const activeFilters = activeSearch.filters;
  const multiSource = unifiedSelected || usesSearchRoute(activeFilters);
  const noUnifiedAccounts = (unifiedSelected || activeFilters.scope === "all") && unifiedAccounts.length === 0;
  // Membership changes reload the aggregate; order-only changes remain local.
  const unifiedAccountMembership = JSON.stringify(unifiedAccounts.map((account) => account.name).sort());
  // Snoozed mail stays in its folder but is hidden here until it wakes.
  const snoozedKeys = useMemo(() => new Set(snoozed.map(snoozeKey)), [snoozed]);
  const labelsByKey = useMemo(() => new Map(labelEntries.map((entry) => [snoozeKey(entry), entry.labels])), [labelEntries]);
  const allLabels = useMemo(() => labelNames(labelEntries), [labelEntries]);
  const labelsOf = (item: Envelope): string[] | undefined => {
    const ref = envelopeRef(item);
    return ref ? labelsByKey.get(snoozeKey(ref)) : undefined;
  };
  // A filter on a label that no message carries any more falls away instead of leaving an empty list.
  const activeLabelFilter = allLabels.some((label) => hasLabel([label], labelFilter)) ? labelFilter : "";
  useEffect(() => {
    if (labelFilter && !activeLabelFilter) setLabelFilter(""); // forget it, so a later label of that name does not revive it
  }, [labelFilter, activeLabelFilter]);
  const envelopes = useMemo(() => rawEnvelopes.filter((item) => {
    const ref = envelopeRef(item);
    if (ref && snoozedKeys.has(snoozeKey(ref))) return false;
    return !activeLabelFilter || hasLabel(ref ? labelsByKey.get(snoozeKey(ref)) : undefined, activeLabelFilter);
  }), [rawEnvelopes, snoozedKeys, activeLabelFilter, labelsByKey]);

  function loadSnoozed(): void {
    if (!token) return;
    void api<{ snoozed: SnoozedMessage[] }>(token, "/api/snoozed").then((result) => setSnoozed(result.snoozed)).catch(() => undefined);
  }

  // Woken messages reappear on their own: the server drops them, so a minute-by-minute refresh is enough.
  useEffect(() => {
    const timer = window.setInterval(loadSnoozed, 60_000);
    return () => window.clearInterval(timer);
  }, [token]);


  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || document.querySelector('[role="dialog"]')) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      const action = shortcutFor(event);
      if (!action) return;
      event.preventDefault();
      shortcutHandler.current(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!preview) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (preview.url) URL.revokeObjectURL(preview.url);
      setPreview(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [preview]);

  useEffect(() => {
    if (!snoozedOpen) return;
    const closeOnEscape = (event: KeyboardEvent): void => { if (event.key === "Escape") setSnoozedOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [snoozedOpen]);

  useEffect(() => {
    if (!shortcutsOpen) return;
    const closeOnEscape = (event: KeyboardEvent): void => { if (event.key === "Escape") setShortcutsOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [shortcutsOpen]);

  // Keep the selected row in view while moving through the list with the keyboard.
  useEffect(() => {
    document.querySelector(".envelope-row.active")?.scrollIntoView({ block: "nearest" });
  }, [selectedMessage]);

  useEffect(() => {
    if (!accountManagerOpen) {
      if (accountManagerWasOpen.current) accountManagerButton.current?.focus();
      accountManagerWasOpen.current = false;
      return;
    }

    accountManagerWasOpen.current = true;
    accountManagerCloseButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setAccountManagerOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [accountManagerOpen]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoadingAccounts(true);
    api<BootstrapResponse>(token, "/api/bootstrap")
      .then((result) => {
        if (!active) return;
        setSnoozed(result.snoozed ?? []);
        setLabelEntries(result.labels ?? []);
        const storage = browserStorage();
        const order = normalizeAccountOrder(result.accounts, storage ? readAccountOrder(storage) : []);
        setAccountOrder(order);
        if (storage) writeAccountOrder(storage, order);
        const resolvedColors = resolveAccountColors(
          result.accounts.map((account) => account.name),
          storage ? readAccountColorState(storage) : emptyAccountColorState(),
        );
        setColorState(resolvedColors.state);
        if (storage) writeAccountColorState(storage, resolvedColors.state);
        setAccounts(result.accounts);
        setAddressWarning(result.addressWarning ?? null);
        const savedView = localStorage.getItem(LAST_VIEW_KEY);
        if (chooseInitialView(savedView) === "unified") {
          setUnifiedSelected(true);
          setSelectedAccount(null);
        } else {
          const savedAccount = localStorage.getItem(LAST_ACCOUNT_KEY);
          const initial = chooseInitialAccount(orderedAccounts(result.accounts, order), savedAccount, accountPreferences);
          setSelectedAccount(initial);
        }
      })
      .catch((reason: unknown) => active && setError(reason instanceof Error ? reason.message : "Konten konnten nicht geladen werden."))
      .finally(() => active && setLoadingAccounts(false));
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (!token || loadingAccounts || unifiedSelected) return;
    const selectable = filterSelectableAccounts(orderedAccountList, accountPreferences);
    if (selectedAccount && selectable.some((account) => account.name === selectedAccount)) return;

    const savedAccount = localStorage.getItem(LAST_ACCOUNT_KEY);
    const fallback = chooseInitialAccount(orderedAccountList, savedAccount, accountPreferences);
    if (fallback === selectedAccount) return;
    clearMailboxSelection();
    setSelectedAccount(fallback);
    setPage(1);
  }, [accountPreferences, orderedAccountList, loadingAccounts, selectedAccount, token, unifiedSelected]);

  useEffect(() => {
    if (!token || !selectedAccount || unifiedSelected) return;
    localStorage.setItem(LAST_ACCOUNT_KEY, selectedAccount);
    loadMailboxes(selectedAccount);
  }, [token, selectedAccount, unifiedSelected]);

  useEffect(() => () => {
    // Invalidate every outstanding response on unmount.
    for (const [name, sequence] of mailboxRequests.current) mailboxRequests.current.set(name, sequence + 1);
    messageRequest.current += 1;
    detailRequest.current += 1;
    aiRequest.current += 1;
  }, []);

  useEffect(() => {
    if (!selectedAccount || unifiedSelected) return;
    if (selectedMailbox && mailboxes.some((mailbox) => mailbox.id === selectedMailbox)) return;

    const savedMailbox = localStorage.getItem(`${LAST_MAILBOX_KEY}:${selectedAccount}`)
      ?? localStorage.getItem(LAST_MAILBOX_KEY);
    const initial = chooseInitialMailbox(mailboxes, savedMailbox);
    clearMailboxSelection();
    setSelectedMailbox(initial);
    setPage(1);
    if (!initial) {
      setEnvelopes([]);
      setDetail(null);
      setSelectedMessage(null);
    }
  }, [mailboxes, selectedAccount, selectedMailbox, unifiedSelected]);

  useEffect(() => {
    const requestId = ++messageRequest.current;
    setUnifiedWarnings([]);
    setUnifiedHasMore(false);
    setUnifiedLoadFailed(false);
    setLoadingMessages(false);
    setChecked(new Set());
    clearReaderSelection();
    const hasFolder = Boolean(selectedAccount && selectedMailbox);
    if (!token || noUnifiedAccounts || (!unifiedSelected && activeFilters.scope !== "all" && !hasFolder)) {
      setEnvelopes([]);
      return;
    }
    setError(null);
    let send: () => Promise<MessageListResponse | UnifiedInboxResponse>;
    let cacheKey: string;
    if (usesSearchRoute(activeFilters)) {
      const body = JSON.stringify(searchBody({
        filters: activeFilters, text: activeSearch.text, field: activeSearch.field, unread: activeSearch.unread,
        page, pageSize: PAGE_SIZE, accounts: unifiedAccounts.map((account) => account.name),
        current: hasFolder ? { account: selectedAccount!, mailbox: selectedMailbox! } : null,
      }));
      cacheKey = `search:${body}`;
      send = () => api<UnifiedInboxResponse>(token, "/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    } else if (unifiedSelected) {
      const body = JSON.stringify({ accounts: unifiedAccounts.map((account) => account.name), page, pageSize: PAGE_SIZE,
        field: activeSearch.field, q: activeSearch.text, unread: activeSearch.unread, ...filterFields(activeFilters) });
      cacheKey = `unified:${body}`;
      send = () => api<UnifiedInboxResponse>(token, "/api/unified/inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    } else {
      localStorage.setItem(`${LAST_MAILBOX_KEY}:${selectedAccount}`, selectedMailbox!);
      localStorage.setItem(LAST_MAILBOX_KEY, selectedMailbox!);
      const params = new URLSearchParams({
        mailbox: selectedMailbox!, page: String(page), pageSize: String(PAGE_SIZE),
        field: activeSearch.field, q: activeSearch.text, unread: String(activeSearch.unread), ...filterFields(activeFilters),
      });
      cacheKey = `${selectedAccount}:${params}`;
      send = () => api<MessageListResponse>(token, `/api/accounts/${encodeURIComponent(selectedAccount!)}/messages?${params}`);
    }
    // A remembered list shows at once and is replaced when the fresh answer arrives; without one the old list dims.
    const remembered = listCache.current.get(cacheKey);
    if (remembered) {
      setEnvelopes(remembered.envelopes);
      setUnifiedWarnings(remembered.warnings);
      setUnifiedHasMore(remembered.hasMore);
    } else setLoadingMessages(true);
    const apply = (result: MessageListResponse | UnifiedInboxResponse): void => {
      // The search route filters attachments itself; the plain routes can only trim the loaded page.
      const shown = activeFilters.hasAttachment && !usesSearchRoute(activeFilters)
        ? result.envelopes.filter((envelope) => envelope.hasAttachment === true)
        : result.envelopes;
      // The raw page length, before the attachment trim, decides whether another page may exist.
      const warnings = "warnings" in result ? result.warnings : [];
      const hasMore = "warnings" in result ? result.hasMore : result.envelopes.length >= PAGE_SIZE;
      setEnvelopes(shown);
      setUnifiedWarnings(warnings);
      setUnifiedHasMore(hasMore);
      listCache.current.set(cacheKey, { envelopes: shown, warnings, hasMore });
    };
    // An answer that arrives almost at once came from the server's cache and may be old (the server refreshes it in
    // the background, which takes up to ~11 s for 19 accounts); two quiet re-requests, after 6 s and after 16 s,
    // pick up the fresh list.
    const startedAt = performance.now();
    const revalidate: number[] = [];
    send().then((result) => {
        if (requestId !== messageRequest.current) return;
        apply(result);
        if (performance.now() - startedAt < 400) {
          for (const delay of [6000, 16000]) {
            revalidate.push(window.setTimeout(() => {
              void send().then((fresh) => { if (requestId === messageRequest.current) apply(fresh); }).catch(() => undefined);
            }, delay));
          }
        }
      })
      .catch((reason: unknown) => {
        if (requestId !== messageRequest.current) return;
        setEnvelopes([]);
        if (multiSource) setUnifiedLoadFailed(true);
        setError(reason instanceof Error ? reason.message : "Nachrichten konnten nicht geladen werden.");
      })
      .finally(() => requestId === messageRequest.current && setLoadingMessages(false));
    return () => {
      revalidate.forEach((timer) => window.clearTimeout(timer));
      messageRequest.current += 1;
      detailRequest.current += 1;
      aiRequest.current += 1;
    };
  }, [token, selectedAccount, selectedMailbox, page, activeSearch, unifiedSelected, multiSource ? unifiedAccountMembership : null]);

  if (!token) return <main className="blocked"><div className="blocked-card"><span className="eyebrow">HIMALAYA MAIL</span><h1>Lokale Sitzung fehlt</h1><p>Starte die GUI mit <code>npm start</code> und öffne den Link aus dem Terminal.</p></div></main>;
  const session = token;

  const paletteCommands: PaletteCommand[] = [
    { id: "unified", label: "Alle Eingänge", hint: "Ansicht", run: chooseUnifiedInbox },
    ...selectableAccounts.flatMap((account) => [
      { id: `account:${account.name}`, label: account.name, hint: "Konto", run: () => chooseAccount(account.name) },
      ...mailboxState(account.name).mailboxes.map((mailbox) => ({
        id: `mailbox:${account.name}:${mailbox.id}`, label: `${account.name} / ${mailbox.name}`, hint: "Ordner",
        run: () => chooseMailbox(account.name, mailbox.id),
      })),
    ]),
    ...SHORTCUTS.filter((item) => item.action !== "help").map((item) => ({
      id: `action:${item.action}`, label: item.label, hint: `Aktion · ${item.keys}`, run: () => shortcutHandler.current(item.action),
    })),
    { id: "rules", label: "Regeln", hint: "Dialog", run: () => setRulesOpen(true) },
    { id: "accounts", label: "Konten verwalten", hint: "Dialog", run: () => setAccountManagerOpen(true) },
    { id: "shortcuts", label: "Tastenkürzel anzeigen", hint: "Dialog", run: () => setShortcutsOpen(true) },
    { id: "snoozed", label: "Zurückgestellte Nachrichten", hint: "Dialog", run: () => setSnoozedOpen(true) },
    ...allLabels.map((label) => ({ id: `label:${label}`, label: `Etikett: ${label}`, hint: "Filter", run: () => setLabelFilter(label) })),
    ...(activeLabelFilter ? [{ id: "label-off", label: "Etikett-Filter aufheben", hint: "Filter", run: () => setLabelFilter("") }] : []),
  ];

  shortcutHandler.current = (action) => {
    const index = envelopes.findIndex((item) => matchesRef(item, selectedMessage));
    const open = (position: number): void => {
      const target = envelopes[position];
      if (target) void openMessage(target);
    };
    const compose = (mode: "reply" | "reply-all" | "forward"): void => {
      if (selectedMessage && detail && sendFlow.state.phase !== "counting") setComposerSeed({ mode, account: selectedMessage.account, sourceDetail: detail });
    };
    if (action === "next") open(index < 0 ? 0 : Math.min(index + 1, envelopes.length - 1));
    else if (action === "previous") open(index < 0 ? 0 : Math.max(index - 1, 0));
    else if (action === "reply" || action === "reply-all" || action === "forward") compose(action);
    else if (action === "delete") { if (selectedMessage) void deleteMessage(); }
    else if (action === "toggle-seen") {
      const current = envelopes.find((item) => matchesRef(item, selectedMessage));
      if (current) void setMessageSeen(!isSeen(current));
    } else if (action === "compose") setComposerSeed({ mode: "new", account: selectedAccount ?? selectableAccounts[0]?.name ?? "" });
    else if (action === "search") {
      openSearch();
      setTimeout(() => searchInput.current?.focus(), 0);
    }
    else setShortcutsOpen(true);
  };

  const currentMailbox = mailboxes.find((mailbox) => mailbox.id === selectedMailbox);
  const currentAccount = accounts.find((account) => account.name === selectedAccount);
  const readerMailboxes = selectedMessage ? mailboxState(selectedMessage.account).mailboxes : [];
  const affectedAccountCount = new Set(unifiedWarnings.map((warning) => warning.account)).size;

  function envelopeRef(envelope: Envelope): MessageRef | null {
    const source = multiSource ? envelope.source : { account: selectedAccount, mailbox: selectedMailbox };
    return source?.account && source.mailbox ? { account: source.account, mailbox: source.mailbox, message: envelope.id } : null;
  }

  function matchesRef(envelope: Envelope, ref: MessageRef | null): boolean {
    const source = envelopeRef(envelope);
    return Boolean(source && ref && source.account === ref.account && source.mailbox === ref.mailbox && source.message === ref.message);
  }

  function colorIndexFor(alias: string): number {
    return accountColors[alias] ?? 0;
  }

  function chooseAccountColor(alias: string, index: number | null): void {
    const next = resolveAccountColors(accounts.map((account) => account.name), setManualAccountColor(colorState, alias, index)).state;
    setColorState(next);
    if (preferenceStorage) writeAccountColorState(preferenceStorage, next);
  }

  function chooseDensity(next: ListDensity): void {
    setDensity(next);
    if (preferenceStorage) writeListDensity(preferenceStorage, next);
  }

  function mailboxState(name: string): MailboxLoadState {
    return Object.hasOwn(mailboxesByAccount, name) ? mailboxesByAccount[name]! : EMPTY_MAILBOX_STATE;
  }

  function invalidateMailboxRequest(name: string): number {
    const sequence = (mailboxRequests.current.get(name) ?? 0) + 1;
    mailboxRequests.current.set(name, sequence);
    return sequence;
  }

  function loadMailboxes(name: string): void {
    if (!token) return;
    const state = mailboxState(name);
    if (state.status === "ready" || state.status === "loading") return;
    const sequence = invalidateMailboxRequest(name);
    setMailboxesByAccount((current) => ({ ...current, [name]: { status: "loading", mailboxes: state.mailboxes } }));
    void api<MailboxResponse>(token, `/api/accounts/${encodeURIComponent(name)}/mailboxes`)
      .then((result) => {
        if (mailboxRequests.current.get(name) !== sequence) return;
        setMailboxesByAccount((current) => ({ ...current, [name]: { status: "ready", mailboxes: result.mailboxes } }));
      })
      .catch((reason: unknown) => {
        if (mailboxRequests.current.get(name) !== sequence) return;
        setMailboxesByAccount((current) => ({ ...current, [name]: {
          status: "error", mailboxes: state.mailboxes,
          error: reason instanceof Error ? reason.message : "Ordner konnten nicht geladen werden.",
        } }));
      });
  }

  function clearReaderSelection(): void {
    detailRequest.current += 1;
    aiRequest.current += 1;
    setSelectedMessage(null);
    setDetail(null);
    setAiResult(null);
    setAiLoading(null);
    setLoadingMessage(false);
  }

  function clearMailboxSelection(): void {
    messageRequest.current += 1;
    setSelectedMailbox(null);
    setEnvelopes([]);
    setUnifiedWarnings([]);
    setUnifiedHasMore(false);
    setNotice(null);
    clearReaderSelection();
    setLoadingMessages(false);
  }

  // Picking a place in the tree ends a cross-folder search: the list must follow the click.
  function resetScope(): void {
    setSearchFilters((current) => ({ ...current, scope: "folder" }));
    setActiveSearch((current) => ({ ...current, filters: { ...current.filters, scope: "folder" } }));
  }

  function chooseAccount(name: string): void {
    resetScope();
    setError(null);
    if (selectedAccount !== name || unifiedSelected) clearMailboxSelection();
    setUnifiedSelected(false);
    setSelectedAccount(name);
    loadMailboxes(name);
    setPage(1);
    localStorage.setItem(LAST_VIEW_KEY, "account");
  }

  function chooseUnifiedInbox(): void {
    resetScope();
    setError(null);
    clearMailboxSelection();
    setUnifiedSelected(true);
    setSelectedAccount(null);
    setPage(1);
    if (unifiedSelected) setActiveSearch((current) => ({ ...current, filters: { ...current.filters, scope: "folder" } }));
    localStorage.setItem(LAST_VIEW_KEY, "unified");
  }

  function chooseMailbox(account: string, id: string): void {
    resetScope();
    setError(null);
    if (selectedAccount !== account || selectedMailbox !== id || unifiedSelected) clearMailboxSelection();
    setUnifiedSelected(false);
    setSelectedAccount(account);
    setSelectedMailbox(id);
    setPage(1);
    localStorage.setItem(LAST_ACCOUNT_KEY, account);
    localStorage.setItem(`${LAST_MAILBOX_KEY}:${account}`, id);
    localStorage.setItem(LAST_MAILBOX_KEY, id);
    localStorage.setItem(LAST_VIEW_KEY, "account");
  }

  function updateAccountState(name: string, patch: AccountPreferencePatch): void {
    const next = updateAccountPreference(accountPreferences, name, patch);
    setAccountPreferences(next);
    if (preferenceStorage) writeAccountPreferences(preferenceStorage, next);
  }

  function reorderAccount(name: string, destination: "up" | "down" | number): void {
    let moved = accountOrder;
    if (typeof destination === "number") {
      const from = moved.indexOf(name);
      if (from < 0 || destination < 0 || destination >= moved.length) return;
      const direction = destination < from ? "up" : "down";
      for (let step = 0; step < Math.abs(destination - from); step += 1) moved = moveAccount(moved, name, direction);
    } else {
      moved = moveAccount(moved, name, destination);
    }
    applyAccountOrder(name, moved);
  }

  function applyAccountOrder(name: string, moved: readonly string[]): void {
    const next = normalizeAccountOrder(accounts, moved);
    if (next.every((accountName, index) => accountName === accountOrder[index])) return;
    // Reordering never makes a provider call. Pending results need an explicit retry.
    const pending = Object.entries(mailboxesByAccount).filter(([, state]) => state.status === "loading");
    for (const [accountName] of pending) invalidateMailboxRequest(accountName);
    if (pending.length) setMailboxesByAccount((current) => {
      const updated = { ...current };
      for (const [accountName, state] of pending) updated[accountName] = {
        status: "error", mailboxes: state.mailboxes, error: "Reihenfolge geändert. Bitte lade die Ordner erneut.",
      };
      return updated;
    });
    setAccountOrder(next);
    const storage = browserStorage();
    if (storage) writeAccountOrder(storage, next);
    setAccountMoveNotice((previous) => ({ name, sequence: (previous?.sequence ?? 0) + 1 }));
  }

  function selectTheme(value: string): void {
    const next = resolveTheme(value);
    setTheme(next);
    if (preferenceStorage) persistTheme(preferenceStorage, next);
    applyTheme(document.documentElement, next);
  }

  function removeFilter(key: keyof SearchFilters): void {
    setSearchFilters((current) => clearFilter(current, key));
    setActiveSearch((current) => ({ ...current, filters: clearFilter(current.filters, key) }));
    setPage(1);
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[role="tab"]');
    if (!target) return;
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const index = tabs.indexOf(target);
    if (index < 0) return;

    let nextIndex = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % tabs.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex >= 0) {
      event.preventDefault();
      const nextTab = tabs[nextIndex];
      nextTab?.focus();
      nextTab?.click();
    }
  }

  function runSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (searchFilters.from && searchFilters.until && searchFilters.from > searchFilters.until) {
      setError("Das Startdatum liegt nach dem Enddatum.");
      return;
    }
    setError(null);
    setPage(1);
    setActiveSearch({ text: searchText.trim(), field: searchField, unread: unreadOnly, filters: searchFilters });
  }

  function invalidateCaches(): void {
    cacheGeneration.current += 1;
    listCache.current.clear();
    detailCache.current.clear();
  }

  function rememberDetail(detail: MessageDetail): void {
    const key = JSON.stringify(detail.ref);
    detailCache.current.delete(key);
    detailCache.current.set(key, detail);
    if (detailCache.current.size > 30) detailCache.current.delete(detailCache.current.keys().next().value as string);
  }

  // Neighbours of the open message are fetched quietly so j/k feels instant; reading leaves flags alone.
  function prefetchNeighbours(opened: Envelope): void {
    const index = envelopes.findIndex((item) => matchesRef(item, envelopeRef(opened)));
    for (const neighbour of [envelopes[index + 1], envelopes[index - 1]]) {
      const ref = neighbour ? envelopeRef(neighbour) : null;
      if (!ref || detailCache.current.has(JSON.stringify(ref))) continue;
      const generation = cacheGeneration.current;
      // A response that started before a move, delete or rating change must not refill the cache.
      void api<MessageDetail>(session, `/api/message?${new URLSearchParams(ref)}`)
        .then((result) => { if (generation === cacheGeneration.current) rememberDetail(result); })
        .catch(() => undefined);
    }
  }

  async function openMessage(envelope: Envelope): Promise<void> {
    clearReaderSelection();
    const ref = envelopeRef(envelope);
    if (!ref) {
      setError("Die Anfrage ist fehlgeschlagen.");
      return;
    }
    const requestId = ++detailRequest.current;
    setError(null);
    if (multiSource) loadMailboxes(ref.account);
    setSelectedMessage(ref);
    setNotice(null);
    setLoadingMessage(true);
    try {
      const cached = detailCache.current.get(JSON.stringify(ref));
      const result = cached ?? await api<MessageDetail>(session, `/api/message?${new URLSearchParams(ref)}`);
      if (requestId !== detailRequest.current) return;
      rememberDetail(result);
      setDetail(result);
      prefetchNeighbours(envelope);
      if (!isSeen(envelope)) {
        try {
          await api(session, "/api/message/seen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref, seen: true }) });
          if (requestId !== detailRequest.current) return;
          setEnvelopes((current) => current.map((item) => matchesRef(item, ref) ? withSeen(item, true) : item));
        } catch {
          if (requestId !== detailRequest.current) return;
          setNotice("Nachricht geöffnet, aber der Gelesen-Status konnte nicht gesetzt werden.");
        }
      }
    } catch (reason: unknown) {
      if (requestId === detailRequest.current) setError(reason instanceof Error ? reason.message : "Nachricht konnte nicht geladen werden.");
    } finally {
      if (requestId === detailRequest.current) setLoadingMessage(false);
    }
  }

  async function setMessageSeen(seen: boolean): Promise<void> {
    if (!selectedMessage) return;
    const requestId = detailRequest.current;
    try {
      await api(session, "/api/message/seen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: selectedMessage, seen }) });
      if (requestId !== detailRequest.current) return;
      setEnvelopes((current) => current.map((item) => matchesRef(item, selectedMessage) ? withSeen(item, seen) : item));
      setNotice(seen ? "Als gelesen markiert." : "Als ungelesen markiert.");
    } catch (reason: unknown) {
      if (requestId === detailRequest.current) setError(reason instanceof Error ? reason.message : "Gelesen-Status konnte nicht geändert werden.");
    }
  }

  async function moveMessage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedMessage) return;
    const form = new FormData(event.currentTarget);
    const destination = String(form.get("destination") ?? "");
    if (!destination || destination === selectedMessage.mailbox) return;
    const target = readerMailboxes.find((mailbox) => mailbox.id === destination);
    if (!window.confirm(`Nach „${target?.name ?? destination}“ verschieben?`)) return;
    const requestId = detailRequest.current;
    try {
      await api(session, "/api/message/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: selectedMessage, destination }) });
      if (requestId !== detailRequest.current) return;
      setNotice("Nachricht verschoben.");
      const moved = selectedMessage;
      setEnvelopes((current) => current.filter((item) => !matchesRef(item, moved)));
      forgetLabelsOf([moved]);
      clearReaderSelection();
      invalidateCaches();
      setActiveSearch({ ...activeSearch });
    } catch (reason: unknown) {
      if (requestId === detailRequest.current) setError(reason instanceof Error ? reason.message : "Nachricht konnte nicht verschoben werden.");
    }
  }

  // The server resolves the trash mailbox and answers 409 when a delete would
  // be permanent, so the confirmation follows the server, not a name heuristic.
  async function deleteMessage(): Promise<void> {
    if (!selectedMessage) return;
    const requestId = detailRequest.current;
    async function callDelete(confirmPermanent: boolean): Promise<Response> {
      return fetch("/api/message/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Himalaya-Session": session },
        body: JSON.stringify({ ref: selectedMessage, confirmPermanent }),
      });
    }
    try {
      let response = await callDelete(false);
      if (response.status === 409) {
        if (!window.confirm("Die Nachricht ist bereits im Papierkorb. Endgültig löschen?")) return;
        response = await callDelete(true);
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as ApiError;
        throw new Error(body.error ?? "Nachricht konnte nicht gelöscht werden.");
      }
      if (requestId !== detailRequest.current) return;
      setNotice("Nachricht gelöscht.");
      const removed = selectedMessage;
      setEnvelopes((current) => current.filter((item) => !matchesRef(item, removed)));
      forgetLabelsOf([removed]);
      clearReaderSelection();
      invalidateCaches();
      setActiveSearch({ ...activeSearch });
    } catch (reason: unknown) {
      if (requestId === detailRequest.current) setError(reason instanceof Error ? reason.message : "Nachricht konnte nicht gelöscht werden.");
    }
  }

  const checkKey = (envelope: Envelope): string => JSON.stringify(envelopeRef(envelope) ?? [envelope.id]);

  function toggleChecked(envelope: Envelope): void {
    const key = checkKey(envelope);
    setChecked((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  function toggleSelectMode(): void {
    setSelectMode((value) => !value);
    setChecked(new Set());
  }

  // One request per message: the server has no bulk routes, and a partial failure is reported, not hidden.
  async function bulkSeen(seen: boolean): Promise<void> {
    if (bulkBusy) return;
    setBulkBusy(true);
    try {
    const targets = envelopes.filter((item) => checked.has(checkKey(item)));
    let failed = 0;
    const done = new Set<string>();
    for (const item of targets) {
      const ref = envelopeRef(item);
      try {
        if (!ref) throw new Error("ref");
        await api(session, "/api/message/seen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref, seen }) });
        done.add(checkKey(item));
      } catch { failed += 1; }
    }
    setEnvelopes((current) => current.map((item) => done.has(checkKey(item)) ? withSeen(item, seen) : item));
    setNotice(`${done.size} Nachricht(en) als ${seen ? "gelesen" : "ungelesen"} markiert${failed > 0 ? `, ${failed} fehlgeschlagen` : ""}.`);
    } finally { setBulkBusy(false); }
  }

  // Trash-first like the single delete; a message already in the trash is skipped, never deleted for good.
  async function bulkDelete(): Promise<void> {
    if (bulkBusy) return;
    setBulkBusy(true);
    try {
    const targets = envelopes.filter((item) => checked.has(checkKey(item)));
    if (targets.length === 0 || !window.confirm(`${targets.length} Nachricht(en) in den Papierkorb verschieben?`)) return;
    let deleted = 0;
    let skipped = 0;
    let failed = 0;
    const gone = new Set<string>();
    for (const item of targets) {
      const ref = envelopeRef(item);
      try {
        if (!ref) throw new Error("ref");
        const response = await fetch("/api/message/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Himalaya-Session": session },
          body: JSON.stringify({ ref, confirmPermanent: false }),
        });
        if (response.status === 409) skipped += 1;
        else if (response.ok) { deleted += 1; gone.add(checkKey(item)); }
        else failed += 1;
      } catch { failed += 1; }
    }
    clearReaderSelection();
    setChecked(new Set());
    // Gone rows disappear at once; the reload below only confirms.
    setEnvelopes((current) => current.filter((item) => !gone.has(checkKey(item))));
    forgetLabelsOf(rawEnvelopes.filter((item) => gone.has(checkKey(item))).map(envelopeRef));
    setNotice(`${deleted} Nachricht(en) gelöscht${skipped > 0 ? `, ${skipped} im Papierkorb übersprungen` : ""}${failed > 0 ? `, ${failed} fehlgeschlagen` : ""}.`);
    invalidateCaches();
    setActiveSearch({ ...activeSearch });
    } finally { setBulkBusy(false); }
  }

  // The link is opened by the operator in a new tab; the server never calls it, so it cannot reach internal hosts.
  function unsubscribe(): void {
    const target = detail?.unsubscribe;
    if (!target) return;
    const sender = detail?.envelope.from[0]?.email ?? "diesem Absender";
    let origin: string | null = null;
    try { origin = target.url ? new URL(target.url).origin : null; } catch { origin = null; }
    if (target.url && origin) {
      if (window.confirm(`Abmelde-Link (laut Mail von ${sender}) in einem neuen Tab öffnen?\nZiel: ${origin}`)) window.open(target.url, "_blank", "noopener,noreferrer");
    } else if (target.mail) {
      setNotice(`${sender} bietet die Abmeldung nur per Mail an: Schreibe an ${target.mail}.`);
    } else setNotice("Der Abmelde-Link in dieser Nachricht ist ungültig.");
  }

  // Same one-request-per-message approach as the other bulk actions; the destination is an existing folder of this account.
  async function bulkMove(destination: string): Promise<void> {
    if (bulkBusy || !destination) return;
    const targets = envelopes.filter((item) => checked.has(checkKey(item)));
    const target = mailboxes.find((mailbox) => mailbox.id === destination);
    if (targets.length === 0 || !window.confirm(`${targets.length} Nachricht(en) nach „${target?.name ?? destination}“ verschieben?`)) return;
    setBulkBusy(true);
    try {
      let moved = 0;
      let failed = 0;
      const gone = new Set<string>();
      for (const item of targets) {
        const ref = envelopeRef(item);
        try {
          if (!ref) throw new Error("ref");
          await api(session, "/api/message/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref, destination }) });
          moved += 1;
          gone.add(checkKey(item));
        } catch { failed += 1; }
      }
      clearReaderSelection();
      setChecked(new Set());
      setEnvelopes((current) => current.filter((item) => !gone.has(checkKey(item))));
      forgetLabelsOf(rawEnvelopes.filter((item) => gone.has(checkKey(item))).map(envelopeRef));
      setNotice(`${moved} Nachricht(en) verschoben${failed > 0 ? `, ${failed} fehlgeschlagen` : ""}.`);
      invalidateCaches();
      setActiveSearch({ ...activeSearch });
    } finally { setBulkBusy(false); }
  }

  function allowImages(always: boolean): void {
    if (!detail) return;
    if (always && imageSender) {
      const next = new Set(imageSenders).add(imageSender);
      setImageSenders(next);
      writeImageSenders(localStorage, next);
    } else setAllowedImages((current) => new Set(current).add(JSON.stringify(detail.ref)));
  }

  async function previewAttachment(attachment: Attachment): Promise<void> {
    const allowed = previewFor(attachment);
    if (!selectedMessage || !allowed) return;
    const requestId = detailRequest.current;
    try {
      const response = await fetch(`/api/attachment?${new URLSearchParams({ ...selectedMessage, attachment: attachment.id })}`, { headers: { "X-Himalaya-Session": session } });
      if (!response.ok) throw new Error("Anhang konnte nicht geladen werden.");
      // The type comes from the whitelist, never from the response, so a mislabelled file cannot run as a page.
      const blob = new Blob([await response.arrayBuffer()], { type: allowed.type });
      if (requestId !== detailRequest.current) return;
      setPreview({
        name: attachment.filename ?? "Anhang", kind: allowed.kind,
        url: allowed.kind === "text" ? "" : URL.createObjectURL(blob),
        text: allowed.kind === "text" ? (await blob.text()).slice(0, 200_000) : "",
      });
    } catch (reason: unknown) {
      if (requestId === detailRequest.current) setError(reason instanceof Error ? reason.message : "Anhang konnte nicht geladen werden.");
    }
  }

  function closePreview(): void {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  async function snoozeSelected(optionId: string): Promise<void> {
    const option = wakeOptions(new Date()).find((item) => item.id === optionId);
    if (!selectedMessage || !option) return;
    try {
      await api(session, "/api/snooze", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: selectedMessage, until: option.until.toISOString(), ...(detail ? { subject: detail.envelope.subject } : {}) }) });
      setNotice(`Zurückgestellt bis ${formatWake(option.until.toISOString())}.`);
      clearReaderSelection();
      loadSnoozed();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Nachricht konnte nicht zurückgestellt werden.");
    }
  }

  async function wakeSnoozed(item: SnoozedMessage): Promise<void> {
    try {
      await api(session, "/api/snooze/cancel", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: { account: item.account, mailbox: item.mailbox, message: item.message } }) });
      loadSnoozed();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Nachricht konnte nicht zurückgeholt werden.");
    }
  }

  async function saveLabels(ref: MessageRef, labels: string[]): Promise<void> {
    try {
      await api(session, "/api/labels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref, labels }) });
      setLabelEntries((current) => [...current.filter((entry) => snoozeKey(entry) !== snoozeKey(ref)), ...(labels.length > 0 ? [{ ...ref, labels }] : [])]);
      setLabelDraft("");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Etikett konnte nicht gespeichert werden.");
    }
  }

  // The server forgets the labels of a message that moved or was deleted (it gets a new id); mirror that here.
  function forgetLabelsOf(refs: ReadonlyArray<MessageRef | null>): void {
    const gone = new Set(refs.flatMap((ref) => (ref ? [snoozeKey(ref)] : [])));
    if (gone.size > 0) setLabelEntries((current) => current.filter((entry) => !gone.has(snoozeKey(entry))));
  }

  async function downloadAttachment(attachment: Attachment): Promise<void> {
    if (!selectedMessage) return;
    const requestId = detailRequest.current;
    try {
      const response = await fetch(`/api/attachment?${new URLSearchParams({ ...selectedMessage, attachment: attachment.id })}`, { headers: { "X-Himalaya-Session": session } });
      if (!response.ok) throw new Error("Anhang konnte nicht geladen werden.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.filename ?? "attachment";
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason: unknown) {
      if (requestId === detailRequest.current) setError(reason instanceof Error ? reason.message : "Anhang konnte nicht geladen werden.");
    }
  }

  // A newly opened message starts with its own account as the copy target and no folder chosen.
  useEffect(() => {
    setCopyAccount(selectedMessage?.account ?? "");
    setCopyMailbox("");
    setSenderHistory({ status: "idle" });
  }, [selectedMessage?.account, selectedMessage?.mailbox, selectedMessage?.message]);

  /** Loads the message again; null when another message was opened in the meantime. */
  function applySavedSearch(id: string): void {
    setSavedChoice(id);
    const saved = savedSearches.find((item) => item.id === id);
    if (!saved) return;
    // "Dieses Konto" needs an open account; from the unified view the closest meaning is all accounts.
    const filters: SearchFilters = unifiedSelected && saved.filters.scope === "account" ? { ...saved.filters, scope: "all" } : saved.filters;
    setSearchText(saved.text);
    setSearchField(saved.field);
    setUnreadOnly(saved.unread);
    setSearchFilters(filters);
    setPage(1);
    setActiveSearch({ text: saved.text, field: saved.field, unread: saved.unread, filters });
  }

  function saveCurrentSearch(): void {
    const { list, error } = upsertSavedSearch(savedSearches, {
      name: savingName ?? "", text: activeSearch.text, field: activeSearch.field, unread: activeSearch.unread, filters: activeSearch.filters,
    });
    if (error) {
      setError(error);
      return;
    }
    setError(null);
    setSavedSearches(list);
    writeSavedSearches(localStorage, list);
    setSavedChoice(list.find((item) => item.name.toLowerCase() === (savingName ?? "").trim().toLowerCase())?.id ?? "");
    setSavingName(null);
    setNotice("Suche gespeichert.");
  }

  function deleteSavedSearch(): void {
    const list = removeSavedSearch(savedSearches, savedChoice);
    setSavedSearches(list);
    writeSavedSearches(localStorage, list);
    setSavedChoice("");
    setNotice("Gespeicherte Suche gelöscht.");
  }

  async function reloadDetail(ref: MessageRef, requestId: number): Promise<MessageDetail | null> {
    const result = await api<MessageDetail>(session, `/api/message?${new URLSearchParams(ref)}`);
    if (requestId !== detailRequest.current) return null;
    setDetail(result);
    return result;
  }

  // The list badge comes from the server's cache of fresh mail; keep it in step with the operator's choice.
  function patchSenderRisk(email: string, risk: "suspicious" | "high" | null): void {
    const wanted = email.toLowerCase();
    setEnvelopes((current) => current.map((item) => {
      if (!item.from.some((address) => address.email.toLowerCase() === wanted)) return item;
      const { risk: _previous, ...rest } = item;
      return risk ? { ...rest, risk } : rest;
    }));
  }

  async function setSenderStatus(status: "trusted" | null): Promise<void> {
    cacheGeneration.current += 1;
    detailCache.current.clear(); // a changed rating must not come back from the cache
    const email = detail?.envelope.from[0]?.email;
    if (!detail || !selectedMessage || !email || senderBusy) return;
    const ref = selectedMessage;
    const wasReported = detail.sender.trust === "blocked";
    const requestId = detailRequest.current;
    setSenderBusy(true);
    try {
      await api(session, "/api/senders/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, status }) });
      const fresh = await reloadDetail(ref, requestId);
      // Trust does not hide a failed DKIM/DMARC check, so the badge follows the verdict the server just computed.
      if (fresh) patchSenderRisk(email, fresh.sender.risk.level === "none" ? null : fresh.sender.risk.level);
      if (requestId === detailRequest.current) setNotice(status === "trusted" ? "Absender wird vertraut." : wasReported ? "Meldung widerrufen." : "Vertrauen widerrufen.");
    } catch (reason: unknown) {
      if (requestId === detailRequest.current) setError(reason instanceof Error ? reason.message : "Die Einstufung konnte nicht gespeichert werden.");
    } finally {
      setSenderBusy(false);
    }
  }

  async function reportSender(): Promise<void> {
    cacheGeneration.current += 1;
    detailCache.current.clear(); // a changed rating must not come back from the cache
    const email = detail?.envelope.from[0]?.email;
    if (!selectedMessage || !email || senderBusy) return;
    if (!window.confirm("Mail in Junk verschieben und den Absender als Phishing melden?")) return;
    const ref = selectedMessage;
    const requestId = detailRequest.current;
    setSenderBusy(true);
    try {
      const result = await api<{ ok: true; moved: boolean; mailbox: string | null }>(session, "/api/message/report", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref }),
      });
      if (result.moved) {
        setNotice("Mail in Junk verschoben und Absender gemeldet.");
        setEnvelopes((current) => current.filter((item) => !matchesRef(item, ref)));
        // Only close the reader if it still shows this message; the operator may have moved on while the request ran.
        if (requestId === detailRequest.current) clearReaderSelection();
      } else {
        patchSenderRisk(email, "high");
        await reloadDetail(ref, requestId);
        if (requestId === detailRequest.current) setNotice(result.mailbox ? "Absender gemeldet." : "Absender gemeldet (kein Junk-Ordner gefunden).");
      }
    } catch (reason: unknown) {
      if (requestId === detailRequest.current) setError(reason instanceof Error ? reason.message : "Die Meldung ist fehlgeschlagen.");
    } finally {
      setSenderBusy(false);
    }
  }

  // Runs only on request: a cross-account search can take a while.
  async function checkSenderHistory(): Promise<void> {
    const email = detail?.envelope.from[0]?.email;
    if (!detail || !selectedMessage || !email) return;
    if (unifiedAccounts.length === 0) {
      setSenderHistory({ status: "error", message: "Kein Konto für Alle Eingänge ausgewählt." });
      return;
    }
    const requestId = detailRequest.current;
    setSenderHistory({ status: "loading" });
    try {
      const result = await api<UnifiedInboxResponse>(session, "/api/search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(senderHistoryBody(email, unifiedAccounts.map((account) => account.name))),
      });
      if (requestId !== detailRequest.current) return;
      setSenderHistory({ status: "ready", lines: historyLines(summarizeSenderHistory(result, selectedMessage, detail.envelope.date, email)) });
    } catch (reason: unknown) {
      if (requestId !== detailRequest.current) return;
      setSenderHistory({ status: "error", message: reason instanceof Error ? reason.message : "Der Verlauf konnte nicht geladen werden." });
    }
  }

  function showSenderMails(): void {
    const email = detail?.envelope.from[0]?.email;
    if (!email) return;
    const state = senderSearchState(email);
    setSearchText(state.text);
    setSearchField(state.field);
    setUnreadOnly(false);
    setSearchFilters(state.filters);
    setPage(1);
    setActiveSearch(state);
  }

  async function copyToClipboard(text: string, successNotice: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setError(null);
      setNotice(successNotice);
    } catch {
      setError("Die Zwischenablage ist nicht verfügbar.");
    }
  }

  async function fetchRaw(): Promise<Response> {
    const response = await fetch(messageRawUrl(selectedMessage!), { headers: { "X-Himalaya-Session": session } });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as ApiError;
      throw new Error(body.error ?? "Der Quelltext konnte nicht geladen werden.");
    }
    return response;
  }

  async function copyHeaders(): Promise<void> {
    if (!selectedMessage) return;
    try {
      await copyToClipboard(rawHeaderBlock(await (await fetchRaw()).text()), "Header kopiert.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Die Header konnten nicht geladen werden.");
    }
  }

  async function downloadSource(): Promise<void> {
    if (!selectedMessage) return;
    try {
      const url = URL.createObjectURL(await (await fetchRaw()).blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `message-${selectedMessage.message}.eml`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice("Quelltext heruntergeladen.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Der Quelltext konnte nicht heruntergeladen werden.");
    }
  }

  async function copyMessage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedMessage || !copyMailbox || copying) return;
    const folder = mailboxState(copyAccount).mailboxes.find((mailbox) => mailbox.id === copyMailbox);
    if (!window.confirm(`Kopie in „${copyAccount} / ${folder?.name ?? copyMailbox}“ anlegen?`)) return;
    const requestId = detailRequest.current;
    setCopying(true);
    try {
      await api(session, "/api/message/copy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: selectedMessage, destination: { account: copyAccount, mailbox: copyMailbox } }),
      });
      if (requestId === detailRequest.current) setNotice("Kopie angelegt.");
    } catch (reason: unknown) {
      if (requestId === detailRequest.current) setError(reason instanceof Error ? reason.message : "Die Kopie konnte nicht angelegt werden.");
    } finally {
      setCopying(false);
    }
  }

  async function downloadMarkdown(): Promise<void> {
    if (!selectedMessage) return;
    const requestId = detailRequest.current;
    try {
      const response = await fetch(messageExportUrl(selectedMessage), { headers: { "X-Himalaya-Session": session } });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as ApiError;
        throw new Error(body.error ?? "Markdown konnte nicht heruntergeladen werden.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `message-${selectedMessage.message}.md`;
      link.click();
      URL.revokeObjectURL(url);
      if (requestId === detailRequest.current) setNotice("Markdown-Datei heruntergeladen.");
    } catch (reason: unknown) {
      if (requestId === detailRequest.current) setError(reason instanceof Error ? reason.message : "Markdown konnte nicht heruntergeladen werden.");
    }
  }

  function printMessage(): void {
    if (!detail) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setError("Das Druckfenster wurde vom Browser blockiert.");
      return;
    }
    printWindow.opener = null;
    printWindow.document.open();
    printWindow.document.write(buildPrintDocument(detail, cleanHtml));
    printWindow.document.close();
    window.setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 80);
  }

  async function requestAi(task: ClientAiTask): Promise<void> {
    if (!selectedMessage || aiLoading) return;
    const requestId = ++aiRequest.current;
    setError(null);
    setAiResult(null);
    setAiLoading(task);
    try {
      const result = await api<AiResponse>(session, "/api/ai/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: selectedMessage, task }),
      });
      if (requestId !== aiRequest.current) return;
      setAiResult(result);
      if (result.truncated) setNotice("Die Nachricht wurde für die KI-Anfrage gekürzt.");
    } catch (reason: unknown) {
      if (requestId === aiRequest.current) setError(reason instanceof Error ? reason.message : "Die KI-Anfrage ist fehlgeschlagen.");
    } finally {
      if (requestId === aiRequest.current) setAiLoading(null);
    }
  }

  const barState = currentAccount && !unifiedSelected ? mailboxState(currentAccount.name) : null;
  const barPinned = barState ? pinnedMailboxes(barState.mailboxes) : [];
  const barMailboxes = barState ? [...barPinned, ...barState.mailboxes.filter((mb) => !barPinned.some((pin) => pin.id === mb.id))] : [];
  const readerLabels = detail ? labelsByKey.get(snoozeKey(detail.ref)) ?? [] : [];
  const remoteImages = countRemoteImages(detail?.html ?? null);
  const imageSender = detail?.envelope.from[0]?.email.toLowerCase() ?? "";
  const imagesAllowed = detail !== null && (allowedImages.has(JSON.stringify(detail.ref)) || imageSenders.has(imageSender));
  const cleanHtml = detail?.html
    ? DOMPurify.sanitize(detail.html, {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ["audio", "base", "embed", "form", "iframe", ...(imagesAllowed ? [] : ["img"]), "link", "object", "script", "source", "style", "svg", "video"],
        FORBID_ATTR: ["action", "formaction", "style", "srcset"],
      })
    : "";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <IconMail size={16} className="brand-icon" />
          <h1>{APP_NAME}</h1>
          <span className="version-badge">{APP_VERSION_LABEL}</span>
          <span className="visually-hidden">Lokale Mail-Arbeitsfläche</span>
        </div>
        <div className="topbar-controls">
          <label className="theme-picker">
            <IconTheme size={13} />
            <span>Farbschema</span>
            <select value={theme} onChange={(event) => selectTheme(event.target.value)} aria-label="Farbschema auswählen">
              {Object.entries(THEMES).map(([name, definition]) => <option key={name} value={name}>{definition.label}</option>)}
            </select>
          </label>
          <div className="topbar-meta">
            <button className="primary-button topbar-btn compose-button" type="button" aria-label="Neue Nachricht" disabled={selectableAccounts.length === 0 || sendFlow.state.phase === "counting"} onClick={() => setComposerSeed({ mode: "new", account: selectedAccount ?? selectableAccounts[0]?.name ?? "" })}>
              <IconCompose size={13} />
              <span>Neue Nachricht</span>
            </button>
            <button ref={accountManagerButton} className="subtle-button topbar-btn manager-button" type="button" onClick={() => setAccountManagerOpen(true)} aria-haspopup="dialog" aria-expanded={accountManagerOpen} aria-label="Konten verwalten">
              <IconSettings size={13} />
              <span>Konten</span>
            </button>
            <button className="subtle-button topbar-btn" type="button" aria-haspopup="dialog" onClick={() => setRulesOpen(true)}>
              <IconRules size={13} />
              <span>Regeln</span>
            </button>
            <button className="subtle-button topbar-btn" type="button" aria-haspopup="dialog" onClick={() => setShortcutsOpen(true)}>
              <IconKeyboard size={13} />
              <span>Tastenkürzel</span>
            </button>
            {snoozed.length > 0 && (
              <button className="subtle-button topbar-btn" type="button" aria-haspopup="dialog" onClick={() => setSnoozedOpen(true)}>
                <IconSnooze size={13} />
                <span>Zurückgestellt ({snoozed.length})</span>
              </button>
            )}
            <span>{selectableAccounts.length}/{accounts.length} Konten</span>
            <span className="status-dot" /> lokal
          </div>
        </div>
      </header>
      {addressWarning && <div className="banner warning-banner" role="status"><span>{addressWarning}</span></div>}
      {error && <div className="banner error-banner" role="alert"><span>{error}</span><button onClick={() => setError(null)} aria-label="Fehler schließen"><IconClose size={14} /><span className="visually-hidden">×</span></button></div>}
      {notice && <div className="banner notice-banner" role="status"><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="Hinweis schließen"><IconClose size={14} /><span className="visually-hidden">×</span></button></div>}
      <div className="mailbox-bar">
        <div className="tabs-navigation">
          <nav className="account-tabs" role="tablist" aria-label="Konten-Tabs" onKeyDown={handleTabKeyDown}>
            {(() => {
              const unifiedTotalUnread = selectableAccounts.reduce((acc, account) => {
                const state = mailboxState(account.name);
                return acc + state.mailboxes.reduce((mAcc, mb) => mAcc + (mb.unread ?? 0), 0);
              }, 0);
              return (
                <button
                  role="tab"
                  className={`account-tab ${unifiedSelected ? "active" : ""}`}
                  type="button"
                  onClick={chooseUnifiedInbox}
                  aria-selected={unifiedSelected}
                  aria-controls="workspace-panel"
                  tabIndex={unifiedSelected ? 0 : -1}
                  aria-current={unifiedSelected ? "page" : undefined}
                >
                  <IconInbox size={13} />
                  <span>Alle Eingänge</span>
                  <span className="tab-unread-pill" title={unifiedTotalUnread > 0 ? `${unifiedTotalUnread} ungelesen (${unifiedAccounts.length} Konten)` : `${unifiedAccounts.length} Konten`}>
                    {unifiedTotalUnread > 0 ? unifiedTotalUnread : `${unifiedAccounts.length} ${unifiedAccounts.length === 1 ? "Konto" : "Konten"}`}
                  </span>
                </button>
              );
            })()}
            {selectableAccounts.map((account) => {
              const isCurrent = !unifiedSelected && selectedAccount === account.name;
              const state = mailboxState(account.name);
              const totalUnread = state.mailboxes.reduce((acc, mb) => acc + (mb.unread ?? 0), 0);
              return (
                <button
                  key={account.name}
                  data-account={account.name}
                  role="tab"
                  className={`account-tab ${isCurrent ? "active" : ""}`}
                  type="button"
                  onClick={() => chooseAccount(account.name)}
                  aria-selected={isCurrent}
                  aria-controls="workspace-panel"
                  tabIndex={isCurrent ? 0 : -1}
                  aria-current={isCurrent ? "page" : undefined}
                >
                  <ProviderLogo provider={account.provider} size={14} />
                  <span>{account.name}</span>
                  {totalUnread > 0 && <span className="tab-unread-pill">{totalUnread}</span>}
                  {unifiedWarnings.some((warning) => warning.account === account.name) && (
                    <span className="account-warning" aria-hidden="true" title="Warnung beim letzten Laden">⚠</span>
                  )}
                </button>
              );
            })}
          </nav>
          {!loadingAccounts && accounts.length > 0 && selectableAccounts.length === 0 && (
            <div className="empty-state">
              <strong>Keine aktiven Konten sichtbar</strong>
              <span>Aktiviere oder zeige mindestens ein Konto in der Verwaltung.</span>
              <button className="subtle-button" type="button" onClick={() => setAccountManagerOpen(true)}>Konten verwalten</button>
            </div>
          )}
          <div className="mailbox-tabs-bar">
            <nav className="mailbox-tabs" role="tablist" aria-label="Ordner-Tabs" onKeyDown={handleTabKeyDown}>
              {unifiedSelected ? (
                <button
                  role="tab"
                  className="mailbox-tab active"
                  type="button"
                  aria-selected="true"
                  aria-controls="messages-panel"
                  tabIndex={0}
                  aria-current="page"
                >
                  <IconInbox size={13} />
                  <span>Alle Eingänge</span>
                </button>
              ) : currentAccount ? (
                barMailboxes.map((mb) => {
                  const isCurrent = selectedMailbox === mb.id;
                  return (
                    <button
                      key={mb.id}
                      data-mailbox={mb.id}
                      role="tab"
                      className={`mailbox-tab ${isCurrent ? "active" : ""}`}
                      type="button"
                      onClick={() => chooseMailbox(currentAccount.name, mb.id)}
                      aria-selected={isCurrent}
                      aria-controls="messages-panel"
                      tabIndex={isCurrent ? 0 : -1}
                      aria-current={isCurrent ? "page" : undefined}
                    >
                      <IconFolder size={13} />
                      <span>{mb.name}</span>
                      {mb.unread !== null && mb.unread > 0 && <span className="tab-unread-pill">{mb.unread}</span>}
                    </button>
                  );
                })
              ) : null}
            </nav>
            {currentAccount && barState?.status === "loading" && <p className="mailbox-status" role="status">Ordner werden geladen …</p>}
            {currentAccount && barState?.status === "error" && (
              <div className="mailbox-status">
                <p role="alert">{barState.error}</p>
                <button className="subtle-button" type="button" aria-label={`Ordner erneut laden: ${currentAccount.name}`} onClick={() => loadMailboxes(currentAccount.name)}>Erneut laden</button>
              </div>
            )}
          </div>
        </div>
      </div>
      <section id="workspace-panel" className="workspace" role="tabpanel" aria-label="Arbeitsbereich">
        <section id="messages-panel" className="messages-panel panel" role="tabpanel" aria-label="Nachrichten">
          <div className="panel-heading">
            <div>
              {unifiedSelected || multiSource || !currentAccount
                ? <span className="eyebrow">{unifiedSelected ? "POSTEINGÄNGE" : multiSource ? "SUCHE" : "KONTO"}</span>
                : <span className="account-identity" title={currentAccount.name}><ProviderLogo provider={currentAccount.provider} size={14} /><strong>{currentAccount.email ?? currentAccount.name}</strong></span>}
              <h2>{unifiedSelected ? "Alle Eingänge" : multiSource ? "Suchergebnisse" : currentMailbox?.name ?? "Ordner"}</h2>
            </div>
            <div className="panel-heading-actions">
              <button
                className={`icon-button search-toggle-button ${searchExpanded ? "active" : ""}`}
                type="button"
                onClick={toggleSearch}
                aria-label={searchExpanded ? "Suche einklappen" : "Suche ausklappen"}
                title={searchExpanded ? "Suche einklappen" : "Suche ausklappen"}
              >
                <IconSearch size={15} />
              </button>
              <button className="icon-button" onClick={() => setActiveSearch({ ...activeSearch })} aria-label="Nachrichten aktualisieren">
                <IconRefresh size={16} />
                <span className="visually-hidden">↻</span>
              </button>
            </div>
          </div>
          {searchExpanded ? (
            <div className="search-section">
              <form className="message-search" onSubmit={runSearch}>
                <label className="search-input"><span aria-hidden="true"><IconSearch size={14} /></span><input ref={searchInput} value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Nachrichten suchen" aria-label="Nachrichten suchen" /></label>
                <select value={searchFilters.scope} onChange={(event) => setSearchFilters({ ...searchFilters, scope: event.target.value as SearchScope })} aria-label="Suchbereich">
                  <option value="folder">{unifiedSelected ? "Alle Eingänge (Posteingänge)" : "Dieser Ordner"}</option>
                  {!unifiedSelected && <option value="account">Dieses Konto (alle Ordner)</option>}
                  <option value="all">Alle Konten (alle Ordner)</option>
                </select>
                <select value={searchField} onChange={(event) => setSearchField(event.target.value as SearchField)} aria-label="Suchfeld"><option value="all">Alle Felder</option><option value="subject">Betreff</option><option value="from">Absender</option><option value="to">Empfänger</option><option value="body">Text</option></select>
                <label className="check-label"><input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} /> ungelesen</label>
                <button className="primary-button" type="submit">Suchen</button>
                <details className="filter-panel">
                  <summary><IconFilter size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} /><span>Filter</span></summary>
                  <div className="filter-grid">
                    <label className="filter-field"><span>Datum (Sendedatum) von</span><input type="date" value={searchFilters.from} onChange={(event) => setSearchFilters({ ...searchFilters, from: event.target.value })} /></label>
                    <label className="filter-field"><span>Datum (Sendedatum) bis</span><input type="date" value={searchFilters.until} onChange={(event) => setSearchFilters({ ...searchFilters, until: event.target.value })} /></label>
                    <label className="filter-field"><span>Status</span><select value={searchFilters.flag} onChange={(event) => setSearchFilters({ ...searchFilters, flag: event.target.value as "" | SearchFlag })}><option value="">Alle</option><option value="flagged">Markiert</option><option value="seen">Gelesen</option><option value="unseen">Ungelesen</option><option value="answered">Beantwortet</option></select></label>
                    <label className="filter-field"><span>Sortierung</span><select value={searchFilters.order} onChange={(event) => setSearchFilters({ ...searchFilters, order: event.target.value as "desc" | "asc" })}><option value="desc">Neueste zuerst</option><option value="asc">Älteste zuerst</option></select></label>
                    <label className="check-label"><input type="checkbox" checked={searchFilters.hasAttachment} onChange={(event) => setSearchFilters({ ...searchFilters, hasAttachment: event.target.checked })} /> Nur mit Anhang</label>
                    {searchFilters.scope !== "folder" && <label className="check-label"><input type="checkbox" checked={searchFilters.includeJunk} onChange={(event) => setSearchFilters({ ...searchFilters, includeJunk: event.target.checked })} /> Papierkorb/Spam einschließen</label>}
                  </div>
                </details>
              </form>
              {activeChips(activeFilters).length > 0 && <div className="filter-chips" role="group" aria-label="Aktive Filter">
                {activeChips(activeFilters).map((chip) => <span className="filter-chip" key={chip.key}>{chip.label}<button type="button" onClick={() => removeFilter(chip.key)} aria-label={`Filter entfernen: ${chip.label}`}><IconClose size={12} /><span className="visually-hidden">×</span></button></span>)}
              </div>}
              {activeFilters.hasAttachment && <p className="filter-hint" role="note">Seite kann weniger Treffer enthalten</p>}
              <div className="saved-searches">
                <select aria-label="Gespeicherte Suchen" value={savedChoice} onChange={(event) => applySavedSearch(event.target.value)}>
                  <option value="">Gespeicherte Suche wählen …</option>
                  {savedSearches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                {savedChoice && <button className="subtle-button" type="button" onClick={deleteSavedSearch}>Löschen</button>}
                {savingName === null
                  ? <button className="subtle-button" type="button" onClick={() => setSavingName("")}>Suche speichern</button>
                  : <span className="saved-search-form">
                    <input aria-label="Name der Suche" maxLength={40} value={savingName} onChange={(event) => setSavingName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); saveCurrentSearch(); } }} />
                    <button className="subtle-button" type="button" onClick={saveCurrentSearch}>Speichern</button>
                    <button className="subtle-button" type="button" onClick={() => setSavingName(null)}>Abbrechen</button>
                  </span>}
              </div>
            </div>
          ) : (
            (Boolean(activeSearch.text) || activeSearch.unread || activeChips(activeFilters).length > 0) && (
              <div className="search-collapsed-bar" role="status">
                <div className="search-collapsed-chips">
                  <span className="search-collapsed-label">
                    <IconSearch size={12} />
                    <span>{activeSearch.text ? `"${activeSearch.text}"` : "Aktive Filter"}</span>
                  </span>
                  {activeSearch.unread && (
                    <span className="filter-chip" key="unread">
                      Nur ungelesen
                      <button
                        type="button"
                        onClick={() => {
                          setUnreadOnly(false);
                          setActiveSearch((curr) => ({ ...curr, unread: false }));
                        }}
                        aria-label="Ungelesen-Filter entfernen"
                      >
                        <IconClose size={12} />
                        <span className="visually-hidden">×</span>
                      </button>
                    </span>
                  )}
                  {activeChips(activeFilters).map((chip) => (
                    <span className="filter-chip" key={chip.key}>
                      {chip.label}
                      <button type="button" onClick={() => removeFilter(chip.key)} aria-label={`Filter entfernen: ${chip.label}`}>
                        <IconClose size={12} />
                        <span className="visually-hidden">×</span>
                      </button>
                    </span>
                  ))}
                </div>
                <div className="search-collapsed-actions">
                  <button className="subtle-button" type="button" onClick={() => {
                    setSearchText("");
                    setUnreadOnly(false);
                    resetScope();
                    setActiveSearch({ text: "", field: "all", unread: false, filters: DEFAULT_FILTERS });
                  }}>
                    Filter zurücksetzen
                  </button>
                  <button className="subtle-button" type="button" onClick={openSearch}>
                    Suche öffnen
                  </button>
                </div>
              </div>
            )
          )}
          <div className="message-toolbar"><span>{loadingMessages ? "Lade …" : `${envelopes.length} Nachrichten`}</span><div><button className="subtle-button" type="button" aria-pressed={threadView} onClick={() => { localStorage.setItem("himalaya-web-thread-view-v1", threadView ? "off" : "on"); setThreadView(!threadView); }}>Gespräche</button>{allLabels.length > 0 && <select aria-label="Nach Etikett filtern" value={activeLabelFilter} onChange={(event) => setLabelFilter(event.target.value)}><option value="">Etikett: alle</option>{allLabels.map((label) => <option key={label} value={label}>{label}</option>)}</select>}<button className="subtle-button" type="button" aria-pressed={selectMode} onClick={toggleSelectMode}>Auswählen</button><div className="density-toggle" role="group" aria-label="Listendichte"><button className="subtle-button" type="button" aria-pressed={density === "compact"} onClick={() => chooseDensity("compact")}>Kompakt</button><button className="subtle-button" type="button" aria-pressed={density === "comfortable"} onClick={() => chooseDensity("comfortable")}>Komfortabel</button></div><button className="subtle-button" disabled={page <= 1 || loadingMessages} onClick={() => setPage((value) => Math.max(1, value - 1))}>‹</button><span className="page-number">{page}</span><button className="subtle-button" disabled={(multiSource && page >= UNIFIED_INBOX_MAX_PAGE) || !unifiedHasMore || loadingMessages} onClick={() => setPage((value) => value + 1)}>›</button></div></div>
          {selectMode && <div className="bulk-bar" role="group" aria-label="Mehrfachauswahl">
            <strong>{checked.size} ausgewählt</strong>
            <button className="subtle-button" type="button" onClick={() => setChecked(new Set(envelopes.map(checkKey)))}>Alle auf dieser Seite</button>
            <button className="subtle-button" type="button" disabled={checked.size === 0 || bulkBusy} onClick={() => void bulkSeen(true)}><IconEye size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />Gelesen</button>
            <button className="subtle-button" type="button" disabled={checked.size === 0 || bulkBusy} onClick={() => void bulkSeen(false)}><IconEyeOff size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />Ungelesen</button>
            <button className="subtle-button" type="button" disabled={checked.size === 0 || bulkBusy} onClick={() => void bulkDelete()}><IconTrash size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />Löschen</button>
            {!multiSource && <select aria-label="Ausgewählte verschieben nach" disabled={checked.size === 0 || bulkBusy} value="" onChange={(event) => void bulkMove(event.target.value)}>
              <option value="">Verschieben nach …</option>
              {mailboxes.filter((mailbox) => mailbox.id !== selectedMailbox).map((mailbox) => <option key={mailbox.id} value={mailbox.id}>{mailbox.name}</option>)}
            </select>}
          </div>}
          {multiSource && unifiedWarnings.length > 0 && <div className="unified-warnings" role="status">
            <strong>{affectedAccountCount} {affectedAccountCount === 1 ? "Konto betroffen" : "Konten betroffen"}</strong>
            <ul>{unifiedWarnings.map((warning, index) => <li key={`${warning.account}:${warning.mailbox ?? ""}:${index}`}>{warning.mailbox ? `${warning.account}/${warning.mailbox}` : warning.account}: {warning.message}</li>)}</ul>
          </div>}
          <div className="envelope-list" aria-label="Nachrichtenliste">
            {loadingMessages && <div className="empty-state">Nachrichten werden geladen …</div>}
            {!loadingMessages && envelopes.length === 0 && <div className="empty-state"><span className="empty-icon">⌁</span>{multiSource
              ? <><strong>{noUnifiedAccounts ? (selectableAccounts.length === 0 ? "Keine aktiven und sichtbaren Konten" : "Kein Konto für Alle Eingänge ausgewählt") : unifiedLoadFailed ? (unifiedSelected && !usesSearchRoute(activeFilters) ? "Alle Eingänge konnten nicht geladen werden." : "Die Suche konnte nicht geladen werden.") : unifiedWarnings.length > 0 ? "Nachrichten konnten nicht vollständig geladen werden." : "Keine Nachrichten gefunden"}</strong>{noUnifiedAccounts && selectableAccounts.length > 0 && <button className="subtle-button" type="button" onClick={() => setAccountManagerOpen(true)}>Konten verwalten</button>}</>
              : <><strong>Keine Nachrichten</strong><span>Dieser Ordner enthält für die aktuelle Suche nichts.</span></>}</div>}
            <div aria-busy={loadingMessages} inert={loadingMessages} style={loadingMessages ? { opacity: 0.5 } : undefined}>
              <MessageList
                envelopes={envelopes}
                now={new Date()}
                density={density}
                unified={multiSource}
                labelsFor={labelsOf}
              sentFolder={!multiSource && isSentMailbox(currentMailbox)}
              threads={threadView}
              selectMode={selectMode}
              isChecked={(envelope) => checked.has(checkKey(envelope))}
                currentAccount={selectedAccount}
                colorIndexFor={colorIndexFor}
                isSelected={(envelope) => matchesRef(envelope, selectedMessage)}
                onOpen={(envelope) => (selectMode ? toggleChecked(envelope) : void openMessage(envelope))}
                rowKey={(envelope) => JSON.stringify(envelopeRef(envelope) ?? [envelope.id])}
              />
            </div>
          </div>
        </section>
        <article className="reader-panel panel">
          {!detail && !loadingMessage && <div className="reader-empty"><IconMail size={42} className="reader-mark" /><h2>Wähle eine Nachricht</h2><p>Der Inhalt bleibt lokal in deinem Himalaya-Workflow.</p></div>}
          {loadingMessage && <div className="reader-empty"><span className="spinner" /><p>Nachricht wird geladen …</p></div>}
          {detail && <div className="reader-content">
            <div className="reader-header"><div><span className="eyebrow">NACHRICHT</span><h2>{detail.envelope.subject || "(ohne Betreff)"}</h2><p className="reader-meta">{detail.envelope.from.map((sender) => sender.name || sender.email).join(", ")} · {fullDate(detail.envelope.date)}</p></div><button className="icon-button" onClick={() => void setMessageSeen(!isSeen(envelopes.find((item) => matchesRef(item, selectedMessage)) ?? detail.envelope))} aria-label={isSeen(envelopes.find((item) => matchesRef(item, selectedMessage)) ?? detail.envelope) ? "Als ungelesen markieren" : "Als gelesen markieren"}>{isSeen(envelopes.find((item) => matchesRef(item, selectedMessage)) ?? detail.envelope) ? <><IconEyeOff size={18} /><span className="visually-hidden">◌</span></> : <><IconEye size={18} /><span className="visually-hidden">●</span></>}</button></div>
            <div className="reader-quick-bar" role="toolbar" aria-label="Nachrichtenaktionen">
              <div className="reader-action-group">
                <button className="primary-button quick-reply-btn" type="button" disabled={sendFlow.state.phase === "counting"} onClick={() => setComposerSeed({ mode: "reply", account: selectedMessage!.account, sourceDetail: detail })}>
                  <IconReply size={14} style={{ verticalAlign: "-2px", marginRight: 5 }} />Antworten
                </button>
                <button className="subtle-button" type="button" disabled={sendFlow.state.phase === "counting"} onClick={() => setComposerSeed({ mode: "reply-all", account: selectedMessage!.account, sourceDetail: detail })}>
                  <IconReplyAll size={14} style={{ verticalAlign: "-2px", marginRight: 5 }} />Allen antworten
                </button>
                <button className="subtle-button" type="button" disabled={sendFlow.state.phase === "counting"} onClick={() => setComposerSeed({ mode: "forward", account: selectedMessage!.account, sourceDetail: detail })}>
                  <IconForward size={14} style={{ verticalAlign: "-2px", marginRight: 5 }} />Weiterleiten
                </button>
                <select aria-label="Später erinnern" value="" onChange={(event) => void snoozeSelected(event.target.value)}>
                  <option value="">Später erinnern …</option>
                  {wakeOptions(new Date()).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
                {detail?.unsubscribe && <button className="subtle-button" type="button" onClick={unsubscribe}>Abmelden</button>}
                <button className="subtle-button danger-btn" type="button" onClick={() => void deleteMessage()}>
                  <IconTrash size={14} style={{ verticalAlign: "-2px", marginRight: 5 }} />Löschen
                </button>
              </div>
            </div>
            {remoteImages > 0 && !imagesAllowed && <div className="image-bar" role="status">
              <span>{remoteImages} Bild{remoteImages === 1 ? "" : "er"} aus dem Netz blockiert (Tracking-Schutz).</span>
              <button className="subtle-button" type="button" onClick={() => allowImages(false)}>Bilder laden</button>
              <button className="subtle-button" type="button" onClick={() => allowImages(true)}>Immer von {imageSender} laden</button>
            </div>}
            <div className="message-body">{cleanHtml ? <iframe title="HTML-Mail" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>body{font:15px/1.65 system-ui,sans-serif;color:#24202b;background:#fff;margin:24px}a{color:#6b4acb}</style></head><body>${cleanHtml}</body></html>`} /> : <pre>{detail.text || "(Keine darstellbare Nachricht.)"}</pre>}</div>
            {detail.attachments.length > 0 && <div className="attachments"><span className="eyebrow">ANHÄNGE</span>{detail.attachments.map((attachment) => <span className="attachment-item" key={attachment.id}><button onClick={() => void downloadAttachment(attachment)}><IconPaperclip size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} /><span className="visually-hidden">↧</span>{attachment.filename ?? "Anhang"}<small>{Math.max(1, Math.round(attachment.size / 1024))} KB</small></button>{previewFor(attachment) && <button className="attachment-preview-button" type="button" aria-label={`Vorschau: ${attachment.filename ?? "Anhang"}`} onClick={() => void previewAttachment(attachment)}>Vorschau</button>}</span>)}</div>}
            <div className="reader-footer-tools">
              <div className="reader-actions">
                <div className="reader-action-group"><form onSubmit={(event) => void moveMessage(event)}><select name="destination" defaultValue=""><option value="">Verschieben nach …</option>{readerMailboxes.filter((mailbox) => mailbox.id !== selectedMessage?.mailbox).map((mailbox) => <option key={mailbox.id} value={mailbox.id}>{mailbox.name}</option>)}</select><button className="subtle-button" type="submit"><IconMove size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />Verschieben</button></form><button className="subtle-button" type="button" onClick={() => void setMessageSeen(!isSeen(envelopes.find((item) => matchesRef(item, selectedMessage)) ?? detail.envelope))}>{isSeen(envelopes.find((item) => matchesRef(item, selectedMessage)) ?? detail.envelope) ? <><IconEyeOff size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />Ungelesen</> : <><IconEye size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />Gelesen</>}</button></div>
                <div className="reader-action-group"><button className="subtle-button" type="button" onClick={() => void downloadMarkdown()}><IconCopy size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />Markdown herunterladen</button><button className="subtle-button" type="button" onClick={printMessage}><IconPrinter size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />Als PDF drucken</button></div>
                <div className="reader-action-group copy-group" role="group" aria-label="Kopieren">
                  <button className="subtle-button" type="button" onClick={() => void copyToClipboard(formatMessageText(detail, false), "In die Zwischenablage kopiert.")}><IconCopy size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />Text kopieren</button>
                  <button className="subtle-button" type="button" onClick={() => void copyToClipboard(formatMessageText(detail, true), "In die Zwischenablage kopiert.")}><IconCopy size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />Mit Prüfung kopieren</button>
                  <button className="subtle-button" type="button" onClick={() => void copyHeaders()}>Header kopieren</button>
                  <button className="subtle-button" type="button" onClick={() => void downloadSource()}>Quelltext (.eml)</button>
                  <form className="copy-form" onSubmit={(event) => void copyMessage(event)}>
                    <select aria-label="Zielkonto" value={copyAccount} onChange={(event) => { setCopyAccount(event.target.value); setCopyMailbox(""); loadMailboxes(event.target.value); }}>
                      {[...new Set([selectedMessage!.account, ...selectableAccounts.map((account) => account.name)])].map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                    <select aria-label="Zielordner" value={copyMailbox} onChange={(event) => setCopyMailbox(event.target.value)}>
                      <option value="">Ordner wählen …</option>
                      {mailboxState(copyAccount).mailboxes
                        .filter((mailbox) => !(copyAccount === selectedMessage!.account && mailbox.id === selectedMessage!.mailbox))
                        .map((mailbox) => <option key={mailbox.id} value={mailbox.id}>{mailbox.name}</option>)}
                    </select>
                    <button className="subtle-button" type="submit" disabled={!copyMailbox || copying}>Kopie anlegen</button>
                  </form>
                </div>
              </div>
              <div className="label-bar" aria-label="Etiketten">
                <span className="eyebrow">ETIKETTEN</span>
                {readerLabels.map((label) => <span className="label-chip" key={label}>{label}<button type="button" aria-label={`Etikett entfernen: ${label}`} onClick={() => void saveLabels(detail.ref, readerLabels.filter((item) => item !== label))}><IconClose size={12} /><span className="visually-hidden">×</span></button></span>)}
                <input aria-label="Etikett hinzufügen" placeholder="Etikett hinzufügen …" maxLength={60} value={labelDraft} onChange={(event) => setLabelDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    const next = addLabels(readerLabels, labelDraft);
                    if (next) void saveLabels(detail.ref, next);
                    else setNotice("Etikett nicht hinzugefügt: leer, schon vorhanden, zu lang (24 Zeichen) oder mehr als 5.");
                  }} />
              </div>
              <section className="ai-assist" aria-labelledby="ai-assist-title"><div className="ai-assist-heading"><div><span className="eyebrow"><IconSparkles size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />KI-ASSISTENT</span><strong id="ai-assist-title">Lokale Auswahl, explizite Anfrage</strong></div><span className="muted">Sendet nichts</span></div><div className="ai-assist-actions"><button className="subtle-button" type="button" disabled={aiLoading !== null} onClick={() => void requestAi("summarize")}>{aiLoading === "summarize" ? "Zusammenfassung läuft …" : aiTaskLabel("summarize")}</button><button className="subtle-button" type="button" disabled={aiLoading !== null} onClick={() => void requestAi("reply-draft")}>{aiLoading === "reply-draft" ? "Entwurf läuft …" : aiTaskLabel("reply-draft")}</button></div>{aiResult && <div className="ai-result" role="status"><div className="ai-result-heading"><strong>{aiTaskLabel(aiResult.task)}</strong><button className="icon-button" type="button" onClick={() => setAiResult(null)} aria-label="KI-Ergebnis schließen"><IconClose size={14} /><span className="visually-hidden">×</span></button></div><p className="muted">{aiResult.provider} · {aiResult.model}</p><pre>{aiResult.text}</pre></div>}</section>
              {detail.sender && <>
                <RiskBanner risk={detail.sender.risk} />
                <SenderDetails
                  from={detail.envelope.from.map((sender) => sender.email).join(", ")}
                  sender={detail.sender}
                  onSetStatus={(status) => void setSenderStatus(status)}
                  onReport={() => void reportSender()}
                  busy={senderBusy}
                  {...(detail.envelope.from[0]?.email ? { history: senderHistory, onCheckHistory: () => void checkSenderHistory(), onShowAll: showSenderMails } : {})}
                />
              </>}
            </div>
          </div>}
        </article>
      </section>
      {rulesOpen && <RulesDialog
        token={session}
        accounts={selectableAccounts.map((account) => account.name)}
        defaultAccount={selectedAccount ?? selectableAccounts[0]?.name ?? ""}
        mailboxesFor={(account) => mailboxState(account).mailboxes}
        loadMailboxes={loadMailboxes}
        onClose={() => setRulesOpen(false)}
        onNotice={setNotice}
      />}
      {preview && <div className="account-manager-backdrop" onClick={(event) => { if (event.target === event.currentTarget) closePreview(); }}>
        <section className="account-manager preview-dialog" role="dialog" aria-modal="true" aria-label={`Vorschau: ${preview.name}`}>
          <div className="account-manager-header"><div><span className="eyebrow">VORSCHAU</span><h2>{preview.name}</h2></div><button className="icon-button" type="button" onClick={closePreview} aria-label="Vorschau schließen" autoFocus><IconClose size={18} /><span className="visually-hidden">×</span></button></div>
          <div className="preview-body">
            {preview.kind === "image" && <img src={preview.url} alt={preview.name} />}
            {preview.kind === "pdf" && <iframe title={preview.name} src={preview.url} />}
            {preview.kind === "text" && <pre>{preview.text}</pre>}
          </div>
        </section>
      </div>}
      {snoozedOpen && <div className="account-manager-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setSnoozedOpen(false); }}>
        <section className="account-manager" role="dialog" aria-modal="true" aria-labelledby="snoozed-title">
          <div className="account-manager-header"><div><span className="eyebrow">SPÄTER</span><h2 id="snoozed-title">Zurückgestellte Nachrichten</h2></div><button className="icon-button" type="button" onClick={() => setSnoozedOpen(false)} aria-label="Schließen" autoFocus><IconClose size={18} /><span className="visually-hidden">×</span></button></div>
          <ul className="snoozed-list">
            {snoozed.length === 0 && <li>Nichts zurückgestellt.</li>}
            {snoozed.map((item) => <li key={snoozeKey(item)}><span><strong>{item.subject || "(ohne Betreff)"}</strong><small>{item.account} / {item.mailbox} · kommt wieder {formatWake(item.until)}</small></span><button className="subtle-button" type="button" onClick={() => void wakeSnoozed(item)}>Zurückholen</button></li>)}
          </ul>
        </section>
      </div>}
      {paletteOpen && <CommandPalette commands={paletteCommands} onClose={() => setPaletteOpen(false)} />}
      {shortcutsOpen && <div className="account-manager-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setShortcutsOpen(false); }}>
        <section className="account-manager shortcuts-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
          <div className="account-manager-header"><div><span className="eyebrow">TASTATUR</span><h2 id="shortcuts-title">Tastenkürzel</h2></div><button className="icon-button" type="button" onClick={() => setShortcutsOpen(false)} aria-label="Tastenkürzel schließen" autoFocus><IconClose size={18} /><span className="visually-hidden">×</span></button></div>
          <dl className="shortcut-list"><div><dt><kbd>Strg + K</kbd></dt><dd>Befehlspalette: Konto, Ordner oder Aktion suchen</dd></div>{SHORTCUTS.map((item) => <div key={item.action}><dt><kbd>{item.keys}</kbd></dt><dd>{item.label}</dd></div>)}</dl>
        </section>
      </div>}
      {accountManagerOpen && <div className="account-manager-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setAccountManagerOpen(false); }}>
        <section className="account-manager" role="dialog" aria-modal="true" aria-labelledby="account-manager-title">
          <div className="account-manager-header"><div><span className="eyebrow">ARBEITSFLÄCHE</span><h2 id="account-manager-title">Konten verwalten</h2></div><button ref={accountManagerCloseButton} className="icon-button" type="button" onClick={() => setAccountManagerOpen(false)} aria-label="Kontenverwaltung schließen"><IconClose size={18} /><span className="visually-hidden">×</span></button></div>
          <p className="account-manager-intro">Lege die Reihenfolge fest und wähle, welche Konten in der Arbeitsfläche erscheinen und ausgewählt werden können. Diese Einstellungen bleiben nur lokal in deinem Browser.</p>
          <div className="account-manager-summary"><strong>{selectableAccounts.length} von {accounts.length}</strong><span>aktiv und sichtbar</span></div>
          <p className="account-move-status" aria-live="polite" aria-atomic="true">{accountMoveNotice && <span key={accountMoveNotice.sequence}>Konto {accountMoveNotice.name} verschoben</span>}</p>
          <div className="account-manager-list" aria-label="Konteneinstellungen">
            {orderedAccountList.map((account, index) => {
              const preference = preferenceForAccount(accountPreferences, account.name);
              return <div className={`account-manager-row ${preference.active && preference.visible ? "ready" : "muted-row"}`} key={account.name}>
                <div className="account-manager-identity"><span className="account-mark" style={hueStyle(colorIndexFor(account.name))} title={providerLabel(account.provider)}><ProviderLogo provider={account.provider} size={20} /><span className="visually-hidden">{account.name.slice(0, 1).toUpperCase()}</span></span><span className="account-copy"><strong>{account.name}</strong><small>{account.email ?? MISSING_ADDRESS_LABEL}</small><small className="account-backends">{providerLabel(account.provider)}</small></span></div>
                <div className="account-manager-status"><span className="state-chip">{preference.active ? "Aktiv" : "Deaktiviert"}</span><span className="state-chip">{preference.visible ? "Sichtbar" : "Ausgeblendet"}</span><span className="state-chip">{preference.inUnified ? "In Alle Eingänge" : "Nicht in Alle Eingänge"}</span></div>
                <div className="account-manager-controls"><label className="toggle-control"><input type="checkbox" checked={preference.active} onChange={(event) => updateAccountState(account.name, { active: event.target.checked })} /><span>Aktiv</span></label><label className="toggle-control"><input type="checkbox" checked={preference.visible} onChange={(event) => updateAccountState(account.name, { visible: event.target.checked })} /><span>Sichtbar</span></label><label className="toggle-control"><input type="checkbox" checked={preference.inUnified} onChange={(event) => updateAccountState(account.name, { inUnified: event.target.checked })} /><span>In Alle Eingänge</span></label></div>
                {/* Keep boundary controls focusable so a move never drops keyboard focus. */}
                <div className="account-manager-order-controls">
                  <button className="subtle-button" type="button" aria-label={`Nach oben verschieben: ${account.name}`} aria-disabled={index === 0} onClick={() => reorderAccount(account.name, "up")}>Nach oben verschieben</button>
                  <button className="subtle-button" type="button" aria-label={`Nach unten verschieben: ${account.name}`} aria-disabled={index === orderedAccountList.length - 1} onClick={() => reorderAccount(account.name, "down")}>Nach unten verschieben</button>
                </div>
                <div className="account-color-control" role="group" aria-label={`Farbe: ${account.name}`}>
                  <button type="button" className="color-auto" aria-label={`Automatische Farbe: ${account.name}`} aria-pressed={colorState.manual[account.name] === undefined} onClick={() => chooseAccountColor(account.name, null)}>Auto</button>
                  {ACCOUNT_HUE_NAMES.map((hueName, hueIndex) => (
                    <button key={hueName} type="button" className="color-swatch" style={hueStyle(hueIndex)} title={hueName} aria-label={`${hueName}: ${account.name}`} aria-pressed={colorState.manual[account.name] === hueIndex} onClick={() => chooseAccountColor(account.name, hueIndex)} />
                  ))}
                </div>
              </div>;
            })}
          </div>
          <div className="account-manager-footer"><p>Neue Konten hinzufügen oder Konten dauerhaft aus Himalaya entfernen: führe <code>himalaya configure</code> außerhalb dieser lokalen Oberfläche aus und lade danach die Konfiguration neu.</p><button className="subtle-button" type="button" onClick={() => window.location.reload()}>Konfiguration neu laden</button></div>
        </section>
      </div>}
      {composerSeed && (
        <Composer token={session} accounts={selectableAccounts} seed={composerSeed} contacts={collectContacts([...envelopes, ...listCache.current.envelopes()], accounts.flatMap((account) => account.email ?? []))} flow={sendFlow} onClose={() => setComposerSeed(null)} />
      )}
      <SendFlowUi flow={sendFlow} />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
