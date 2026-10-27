import { Fragment, useState } from "react";
import type { JSX } from "react";

import type { Envelope } from "../shared/types.js";
import { hueStyle } from "./hue-style.js";
import { labelHueIndex } from "./labels.js";
import type { ListDensity } from "./list-density.js";
import { isSentMailbox } from "./preferences.js";
import { groupThreads } from "./threads.js";
import { formatRowTime, withGroupHeaders } from "./message-groups.js";
import {
  IconAlertTriangle,
  IconCheckSquare,
  IconFlag,
  IconPaperclip,
  IconReply,
  IconSquare,
} from "./icons.js";

export type EnvelopeBadge = {
  kind: "phishing" | "new" | "attachment" | "flagged" | "answered";
  label: string;
  icon: string;
};

const BADGES: Record<EnvelopeBadge["kind"], EnvelopeBadge> = {
  phishing: { kind: "phishing", label: "Phishing-Verdacht", icon: "⚠" },
  new: { kind: "new", label: "Neu", icon: "●" },
  attachment: { kind: "attachment", label: "Anhang", icon: "📎" },
  flagged: { kind: "flagged", label: "Markiert", icon: "⚑" },
  answered: { kind: "answered", label: "Beantwortet", icon: "↩" },
};

function hasFlag(envelope: Envelope, name: string): boolean {
  return envelope.flags.some((flag) => {
    const raw = flag.raw.toLowerCase();
    return flag.iana === name || raw === `\\${name}` || raw === name;
  });
}

export function isSeen(envelope: Envelope): boolean {
  return hasFlag(envelope, "seen");
}

export function labelForEnvelope(envelope: Envelope): string {
  return envelope.from[0]?.name || envelope.from[0]?.email || "Unbekannter Absender";
}

// In a Sent folder the interesting party is who received the mail, not the owner.
export function labelForRecipients(envelope: Envelope): string {
  const names = envelope.to.map((address) => address.name || address.email).filter(Boolean);
  return `An: ${names.length > 0 ? names.join(", ") : "(kein Empfänger)"}`;
}

export function envelopeBadges(envelope: Envelope): EnvelopeBadge[] {
  const badges: EnvelopeBadge[] = [];
  if (envelope.risk) badges.push(BADGES.phishing);
  if (!isSeen(envelope)) badges.push(BADGES.new);
  if (envelope.hasAttachment === true) badges.push(BADGES.attachment);
  if (hasFlag(envelope, "flagged")) badges.push(BADGES.flagged);
  if (hasFlag(envelope, "answered")) badges.push(BADGES.answered);
  return badges;
}

function renderBadgeIcon(kind: EnvelopeBadge["kind"]): JSX.Element {
  switch (kind) {
    case "phishing":
      return <IconAlertTriangle size={13} />;
    case "new":
      return <span className="badge-dot" aria-hidden="true">●</span>;
    case "attachment":
      return <IconPaperclip size={13} />;
    case "flagged":
      return <IconFlag size={13} filled={true} />;
    case "answered":
      return <IconReply size={13} />;
    default:
      return <span aria-hidden="true">●</span>;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export type MessageListProps = {
  envelopes: readonly Envelope[];
  now: Date;
  density: ListDensity;
  unified: boolean;
  sentFolder?: boolean;
  threads?: boolean;
  labelsFor?: (envelope: Envelope) => readonly string[] | undefined;
  selectMode?: boolean;
  isChecked?: (envelope: Envelope) => boolean;
  currentAccount: string | null;
  colorIndexFor: (account: string) => number;
  isSelected: (envelope: Envelope) => boolean;
  onOpen: (envelope: Envelope) => void;
  rowKey: (envelope: Envelope) => string;
};

export function MessageList({
  envelopes,
  now,
  density,
  unified,
  sentFolder = false,
  threads = false,
  labelsFor = () => undefined,
  selectMode = false,
  isChecked = () => false,
  currentAccount,
  colorIndexFor,
  isSelected,
  onOpen,
  rowKey,
}: MessageListProps): JSX.Element {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const grouped = threads && !selectMode
    ? groupThreads(envelopes, (item) => item.source?.account ?? currentAccount ?? "")
    : envelopes.map((head) => ({ head, rest: [] as Envelope[] }));

  function toggle(key: string): void {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  function renderRow(envelope: Envelope, child: boolean): JSX.Element {
    const account = unified ? envelope.source?.account ?? currentAccount : currentAccount;
    return (
      <button
        key={rowKey(envelope)}
        className={`envelope-row ${isSelected(envelope) ? "active" : ""} ${isSeen(envelope) ? "seen" : "unread"}${selectMode ? " selecting" : ""}${child ? " thread-child" : ""}`}
        aria-pressed={selectMode ? isChecked(envelope) : undefined}
        style={hueStyle(account ? colorIndexFor(account) : 0)}
        type="button"
        onClick={() => onOpen(envelope)}
      >
        {selectMode
          ? <span className="select-mark" aria-hidden="true">{isChecked(envelope) ? "☑" : "☐"}</span>
          : <span className="account-dot" aria-hidden="true" />}
        <span className="envelope-sender" title={sentFolder ? labelForRecipients(envelope) : undefined}>{sentFolder || isSentMailbox(envelope.source && { id: envelope.source.mailbox, name: envelope.source.mailbox }) ? labelForRecipients(envelope) : labelForEnvelope(envelope)}</span>
        <span className="envelope-main">
          {unified && envelope.source && (
            <span className="envelope-source" title={envelope.source.account}>{`${envelope.source.account} · ${envelope.source.mailbox}`}</span>
          )}
          <span className="envelope-subject">{envelope.subject || "(ohne Betreff)"}</span>
          {(labelsFor(envelope) ?? []).map((label) => (
            <span className="row-label" key={label} style={hueStyle(labelHueIndex(label))}>
              <span className="label-dot" aria-hidden="true" />
              <span>{label}</span>
            </span>
          ))}
        </span>
        <span className="envelope-badges">
          {envelopeBadges(envelope).map((badge) => (
            <span key={badge.kind} className={`badge badge-${badge.kind}`} title={badge.label}>
              <span aria-hidden="true" className="badge-icon-wrapper">
                <span className="badge-svg">{renderBadgeIcon(badge.kind)}</span>
                <span className="visually-hidden">{badge.icon}</span>
              </span>
              <span className={density === "compact" ? "visually-hidden" : "badge-text"}>{badge.label}</span>
            </span>
          ))}
        </span>
        <time className="envelope-time" dateTime={envelope.date ?? undefined}>{formatRowTime(envelope.date, now)}</time>
        {density === "comfortable" && (
          <span className="envelope-detail">{`${envelope.to[0]?.email ?? ""} · ${formatSize(envelope.size)}`}</span>
        )}
      </button>
    );
  }

  return (
    <>
      {withGroupHeaders(grouped.map((thread) => thread.head), now).map(({ item: head, header }, index) => {
        const { rest } = grouped[index]!;
        const key = rowKey(head);
        // A thread holding the open message stays open, so keyboard navigation never lands on a hidden row.
        const open = expanded.has(key) || rest.some(isSelected);
        const unreadInside = rest.filter((item) => !isSeen(item)).length;
        return (
          <Fragment key={key}>
            {header && <div className="group-header">{header}</div>}
            {renderRow(head, false)}
            {rest.length > 0 && (
              <button className="thread-toggle" type="button" aria-expanded={open} onClick={() => toggle(key)}>
                {`${open ? "▾" : "▸"} ${rest.length} weitere im Gespräch${unreadInside > 0 ? ` · ${unreadInside} ungelesen` : ""}`}
              </button>
            )}
            {open && rest.map((item) => renderRow(item, true))}
          </Fragment>
        );
      })}
    </>
  );
}
