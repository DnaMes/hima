export type Account = {
  name: string;
  default: boolean;
  backends: string[];
  email: string | null;
  provider?: string | null;
};

export type Address = {
  email: string;
  name: string | null;
};

export type Flag = {
  iana: string | null;
  raw: string;
};

export type Mailbox = {
  id: string;
  name: string;
  total: number | null;
  unread: number | null;
};

export type EnvelopeSource = { account: string; mailbox: string };
export type UnifiedWarning = { account: string; mailbox?: string; code: string; message: string };
export const UNIFIED_INBOX_MAX_PAGE = 10;
/** Most folders one cross-folder search request covers (server cap, shown in the UI). */
export const SEARCH_MAX_SOURCES = 30;
export type UnifiedInboxResult = {
  envelopes: Envelope[];
  hasMore: boolean;
  warnings: UnifiedWarning[];
};

export type Envelope = {
  id: string;
  date: string | null;
  flags: Flag[];
  from: Address[];
  to: Address[];
  subject: string;
  size: number;
  hasAttachment: boolean | null;
  /** From the CLI list view; used to build conversations. */
  messageId?: string;
  inReplyTo?: string[];
  source?: EnvelopeSource;
  /** Phishing verdict the watcher already computed for this message, if any. */
  risk?: Exclude<RiskLevel, "none">;
};

export type Attachment = {
  id: string;
  filename: string | null;
  mime: string | null;
  size: number;
  inline: boolean;
};

export type MessageRef = {
  account: string;
  mailbox: string;
  message: string;
};

export type RiskLevel = "none" | "suspicious" | "high";

export type Risk = {
  level: RiskLevel;
  score: number;
  reasons: string[];
};

export type AuthResults = {
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
};

export type ReceivedHop = {
  from: string | null;
  by: string | null;
  ip: string | null;
};

export type SenderInfo = {
  replyTo: string | null;
  returnPath: string | null;
  messageIdDomain: string | null;
  auth: AuthResults | null;
  received: ReceivedHop[];
  risk: Risk;
  /** The operator's verdict on this exact From address. */
  trust: "trusted" | "blocked" | null;
};

export type MessageDetail = {
  ref: MessageRef;
  envelope: Envelope;
  text: string;
  html: string | null;
  attachments: Attachment[];
  sender: SenderInfo;
  /** From the List-Unsubscribe header: an https link and/or a mail address; absent for other mail. */
  unsubscribe?: Unsubscribe;
};

export type Unsubscribe = { url: string | null; mail: string | null };

export type ApiError = {
  error: string;
  code?: string;
  retryable?: boolean;
};

/** A mail rule as the server stores it in rules.json (mirrors the engine's Rule). */
export type RuleActionDto =
  | { type: "flag"; flag: "seen" | "answered" | "flagged" | "draft"; value: boolean }
  | { type: "move"; mailbox: string };

export type RuleDto = {
  id: string;
  account: string;
  enabled: boolean;
  dryRun: boolean;
  condition: { field: "from" | "subject" | "to"; match: "contains" | "equals"; value: string };
  actions: RuleActionDto[];
};

export type RulePreviewDto = { checked: number; matchCount: number; samples: Array<{ subject: string; from: string }> };
