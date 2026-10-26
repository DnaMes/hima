// src/client/composer.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";

import { api } from "./api-client.js";
import { clearDraft, composeDraftId, readDraft, writeDraft } from "./compose-draft.js";
import { applyContact, suggestContacts } from "./contacts.js";
import type { Contact } from "./contacts.js";
import type { ComposeRequestForClient, SendFlow } from "./send-flow.js";
import type { Account, MessageDetail } from "../shared/types.js";

export type ComposerMode = "new" | "reply" | "reply-all" | "forward";

export type ComposerSeed = {
  mode: ComposerMode;
  account: string;
  sourceDetail?: MessageDetail;
};

type AiPolishState = "idle" | "loading";

function seedFields(seed: ComposerSeed): { to: string; cc: string; bcc: string; subject: string; body: string } {
  if (!seed.sourceDetail) return { to: "", cc: "", bcc: "", subject: "", body: "" };
  const { envelope } = seed.sourceDetail;
  const from = envelope.from[0];
  if (seed.mode === "reply") {
    return { to: from ? from.email : "", cc: "", bcc: "", subject: `Re: ${envelope.subject}`, body: "" };
  }
  if (seed.mode === "reply-all") {
    const to = [from?.email, ...envelope.to.map((address) => address.email)].filter((value): value is string => Boolean(value));
    return { to: to.join(", "), cc: "", bcc: "", subject: `Re: ${envelope.subject}`, body: "" };
  }
  if (seed.mode === "forward") {
    return { to: "", cc: "", bcc: "", subject: `Fwd: ${envelope.subject}`, body: "" };
  }
  return { to: "", cc: "", bcc: "", subject: "", body: "" };
}

function RecipientField({ label, value, onChange, contacts }: { label: string; value: string; onChange: (value: string) => void; contacts: readonly Contact[] }): JSX.Element {
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const matches = focused ? suggestContacts(value, contacts) : [];
  const pick = (contact: Contact): void => { onChange(applyContact(value, contact)); setActive(-1); };

  // Arrow keys move through the list; Enter only takes a suggestion that was highlighted, so it never hijacks normal typing.
  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (matches.length === 0) return;
    if (event.key === "ArrowDown") setActive((current) => Math.min(current + 1, matches.length - 1));
    else if (event.key === "ArrowUp") setActive((current) => Math.max(current - 1, 0));
    else if (event.key === "Enter" && matches[active]) pick(matches[active]);
    else if (event.key === "Escape" && active >= 0) setActive(-1);
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div className="contact-field">
      <label className="composer-field"><span>{label}</span>
        <input value={value} autoComplete="off" onKeyDown={onKeyDown}
          onChange={(event) => { setActive(-1); onChange(event.target.value); }}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
      </label>
      {matches.length > 0 && (
        <ul className="contact-suggestions" role="listbox" aria-label={`Vorschläge für ${label}`}>
          {matches.map((contact, index) => (
            // mousedown, not click: the input would lose focus and hide the list before a click lands.
            <li key={contact.email} role="option" aria-selected={index === active} className={index === active ? "active" : undefined}
              onMouseDown={(event) => { event.preventDefault(); pick(contact); }}>
              {contact.name ? <>{contact.name} <small>{contact.email}</small></> : contact.email}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function splitAddresses(value: string): string[] {
  return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
}

export function Composer({ token, accounts, seed, contacts, flow, onClose }: {
  token: string;
  accounts: Account[];
  seed: ComposerSeed;
  contacts: readonly Contact[];
  flow: SendFlow;
  onClose: () => void;
}): JSX.Element {
  const composeId = useMemo(() => composeDraftId(seed), [seed]);
  const initial = useMemo(() => seedFields(seed), [seed]);
  const draftStorage = typeof window === "undefined" ? null : window.localStorage;
  const savedDraft = draftStorage ? readDraft(draftStorage, composeId) : null;

  const [account, setAccount] = useState(seed.account);
  const [to, setTo] = useState(savedDraft ? savedDraft.to.join(", ") : initial.to);
  const [cc, setCc] = useState(savedDraft ? savedDraft.cc.join(", ") : initial.cc);
  const [bcc, setBcc] = useState(savedDraft ? savedDraft.bcc.join(", ") : initial.bcc);
  const [subject, setSubject] = useState(savedDraft?.subject ?? initial.subject);
  const [body, setBody] = useState(savedDraft?.body ?? initial.body);
  const [includeOriginalAttachments, setIncludeOriginalAttachments] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [aiPolish, setAiPolish] = useState<AiPolishState>("idle");
  const [aiError, setAiError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // The flow outlives this panel, so only a send started here may close it.
  const sendStartedHere = useRef(false);

  useEffect(() => {
    if (!draftStorage) return;
    const timer = window.setTimeout(() => {
      writeDraft(draftStorage, composeId, {
        to: splitAddresses(to), cc: splitAddresses(cc), bcc: splitAddresses(bcc), subject, body,
        attachmentNames: attachments.map((file) => file.name),
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [draftStorage, composeId, to, cc, bcc, subject, body, attachments]);

  useEffect(() => {
    if (!sendStartedHere.current) return;
    if (flow.state.phase === "resolved" && flow.state.status === "sent") {
      if (draftStorage) clearDraft(draftStorage, composeId);
      onClose();
    }
  }, [flow.state, draftStorage, composeId, onClose]);

  function buildRequest(): ComposeRequestForClient {
    return {
      account,
      mode: seed.mode,
      ...(seed.sourceDetail ? { sourceRef: seed.sourceDetail.ref } : {}),
      to: splitAddresses(to),
      cc: splitAddresses(cc),
      bcc: splitAddresses(bcc),
      subject,
      body,
      includeOriginalAttachments,
    };
  }

  async function saveDraft(): Promise<void> {
    if (attachments.length > 0 && !window.confirm(
      `Anhänge werden beim Speichern als Entwurf nicht mitgespeichert (${attachments.length} Datei${attachments.length === 1 ? "" : "en"}). Trotzdem als Entwurf speichern?`,
    )) return;
    setSaveError(null);
    try {
      await api(token, "/api/compose/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequest()),
      });
      if (draftStorage) clearDraft(draftStorage, composeId);
      onClose();
    } catch (reason: unknown) {
      setSaveError(reason instanceof Error ? reason.message : "Entwurf konnte nicht gespeichert werden.");
    }
  }

  async function insertAiDraft(): Promise<void> {
    if (!seed.sourceDetail) return;
    setAiPolish("loading");
    setAiError(null);
    try {
      const result = await api<{ text: string }>(token, "/api/ai/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: seed.sourceDetail.ref, task: "reply-draft" }),
      });
      setBody((current) => (current ? `${current}\n\n${result.text}` : result.text));
    } catch (reason: unknown) {
      setAiError(reason instanceof Error ? reason.message : "KI-Entwurf konnte nicht geladen werden.");
    } finally {
      setAiPolish("idle");
    }
  }

  async function polishDraft(): Promise<void> {
    if (!body.trim()) return;
    setAiPolish("loading");
    setAiError(null);
    try {
      const result = await api<{ text: string }>(token, "/api/ai/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftText: body, task: "polish-draft" }),
      });
      setBody(result.text);
    } catch (reason: unknown) {
      setAiError(reason instanceof Error ? reason.message : "Text konnte nicht verbessert werden.");
    } finally {
      setAiPolish("idle");
    }
  }

  return (
    <div className="composer-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="composer-panel" role="dialog" aria-modal="true" aria-labelledby="composer-title">
        <div className="composer-header">
          <h2 id="composer-title">
            {seed.mode === "reply" ? "Antworten" : seed.mode === "reply-all" ? "Allen antworten" : seed.mode === "forward" ? "Weiterleiten" : "Neue Nachricht"}
          </h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Editor schließen">×</button>
        </div>
        <label className="composer-field"><span>Von</span>
          <select value={account} onChange={(event) => setAccount(event.target.value)} disabled={seed.mode !== "new"}>
            {accounts.map((item) => <option key={item.name} value={item.name}>{item.email ?? item.name}</option>)}
          </select>
        </label>
        <RecipientField label="An" value={to} onChange={setTo} contacts={contacts} />
        <RecipientField label="Cc" value={cc} onChange={setCc} contacts={contacts} />
        <RecipientField label="Bcc" value={bcc} onChange={setBcc} contacts={contacts} />
        <label className="composer-field"><span>Betreff</span><input value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
        <textarea className="composer-body" value={body} onChange={(event) => setBody(event.target.value)} rows={12} />
        {seed.mode === "forward" && (
          <label className="check-label">
            <input type="checkbox" checked={includeOriginalAttachments} onChange={(event) => setIncludeOriginalAttachments(event.target.checked)} />
            Original-Anhänge mitsenden
          </label>
        )}
        <div className="composer-attachments">
          <input ref={fileInput} type="file" multiple onChange={(event) => setAttachments((current) => [...current, ...Array.from(event.target.files ?? [])])} />
          {attachments.map((file, index) => (
            <span key={`${file.name}-${index}`} className="composer-attachment-chip">
              {file.name}
              <button type="button" onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Anhang entfernen: ${file.name}`}>×</button>
            </span>
          ))}
        </div>
        {aiError && <p className="error-text">{aiError}</p>}
        <div className="composer-ai-actions">
          {seed.mode !== "new" && (
            <button className="subtle-button" type="button" disabled={aiPolish === "loading"} onClick={() => void insertAiDraft()}>
              {aiPolish === "loading" ? "Entwurf läuft …" : "KI-Entwurf einfügen"}
            </button>
          )}
          <button className="subtle-button" type="button" disabled={aiPolish === "loading" || !body.trim()} onClick={() => void polishDraft()}>
            {aiPolish === "loading" ? "Wird verbessert …" : "Text verbessern"}
          </button>
        </div>
        {saveError && <p className="error-text">{saveError}</p>}
        <div className="composer-footer">
          <button className="subtle-button" type="button" onClick={() => void saveDraft()}>In Entwürfe speichern</button>
          {/* Reopening the dialog mid-countdown would drop the pending job id. */}
          <button className="primary-button" type="button" disabled={flow.state.phase === "counting"} onClick={() => { sendStartedHere.current = true; flow.open(buildRequest(), attachments); }}>Senden</button>
        </div>
      </section>
    </div>
  );
}
