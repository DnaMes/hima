import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { JSX } from "react";

import type { Mailbox, RuleDto, RulePreviewDto } from "../shared/types.js";
import { api } from "./api-client.js";
import { draftToRule, goesLive, moveRule, newRuleDraft, ruleToDraft, validateDrafts, type RuleDraft } from "./rules-form.js";

type Props = {
  token: string;
  accounts: readonly string[];
  defaultAccount: string;
  mailboxesFor: (account: string) => readonly Mailbox[];
  loadMailboxes: (account: string) => void;
  onClose: () => void;
  onNotice: (message: string) => void;
};

type RulesResponse = { rules: RuleDto[]; preservedInvalid: number; unreadable: boolean };
const JSON_HEADERS = { "Content-Type": "application/json" };

const FIELD_LABELS = { from: "Absender", subject: "Betreff", to: "Empfänger" } as const;
const MATCH_LABELS = { contains: "enthält", equals: "ist gleich" } as const;

const invalidNote = (count: number): string =>
  count === 1 ? "1 ungültiger Eintrag in rules.json bleibt unverändert." : `${count} ungültige Einträge in rules.json bleiben unverändert.`;

export function RulesDialog({ token, accounts, defaultAccount, mailboxesFor, loadMailboxes, onClose, onNotice }: Props): JSX.Element {
  const [drafts, setDrafts] = useState<RuleDraft[]>([]);
  const [saved, setSaved] = useState<RuleDto[]>([]);
  const [preserved, setPreserved] = useState(0);
  const [unreadable, setUnreadable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [problems, setProblems] = useState<string[]>([]);
  const [previews, setPreviews] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  // Bumped on every edit, so a preview answer for older values is dropped instead of shown.
  const edits = useRef(0);
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);

  // Like the account manager: take focus when opened, close on Escape, give the focus back on close.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      opener?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- set up once per open
  }, []);

  function keepFocusInside(event: ReactKeyboardEvent<HTMLElement>): void {
    if (event.key !== "Tab" || !dialog.current) return;
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)")];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function apply(response: RulesResponse): void {
    edits.current += 1;
    setSaved(response.rules);
    setDrafts(response.rules.map(ruleToDraft));
    setPreserved(response.preservedInvalid);
    setUnreadable(response.unreadable);
    setPreviews({});
    for (const account of new Set(response.rules.map((rule) => rule.account))) loadMailboxes(account);
  }

  useEffect(() => {
    let cancelled = false;
    api<RulesResponse>(token, "/api/rules")
      .then((response) => { if (!cancelled) apply(response); })
      .catch((reason: unknown) => { if (!cancelled) setProblems([reason instanceof Error ? reason.message : "Die Regeln konnten nicht geladen werden."]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once when the dialog opens
  }, []);

  function update(index: number, patch: Partial<RuleDraft>): void {
    edits.current += 1;
    setDrafts((current) => current.map((draft, position) => (position === index ? { ...draft, ...patch } : draft)));
    setPreviews((current) => {
      const { [index]: _stale, ...rest } = current;
      return rest;
    });
  }

  function restructure(next: RuleDraft[]): void {
    edits.current += 1;
    setDrafts(next);
    setPreviews({});
  }

  async function preview(index: number): Promise<void> {
    const draft = drafts[index]!;
    const issues = validateDrafts([draft]);
    if (issues.length > 0) {
      setProblems(issues);
      return;
    }
    setProblems([]);
    const version = edits.current;
    try {
      const result = await api<RulePreviewDto>(token, "/api/rules/preview", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ rule: draftToRule(draft) }) });
      if (version !== edits.current) return;
      const names = result.samples.map((sample) => sample.subject).join(" · ");
      setPreviews((current) => ({ ...current, [index]: `${result.matchCount} von ${result.checked} Mails passen${names ? `: ${names}` : "."}` }));
    } catch (reason: unknown) {
      if (version !== edits.current) return;
      setPreviews((current) => ({ ...current, [index]: reason instanceof Error ? reason.message : "Die Vorschau ist fehlgeschlagen." }));
    }
  }

  async function save(): Promise<void> {
    if (saving) return;
    const issues = validateDrafts(drafts);
    setProblems(issues);
    if (issues.length > 0) return;
    const rules = drafts.map(draftToRule);
    const live = goesLive(saved, rules);
    if (live.length > 0 && !window.confirm(`Diese Regel(n) gelten ab jetzt für neu eintreffende Mails: ${live.join(", ")}. Fortfahren?`)) return;
    setSaving(true);
    try {
      apply(await api<RulesResponse>(token, "/api/rules", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ rules }) }));
      onNotice("Regeln gespeichert.");
    } catch (reason: unknown) {
      setProblems([reason instanceof Error ? reason.message : "Die Regeln konnten nicht gespeichert werden."]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="account-manager-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialog} className="account-manager rules-dialog" role="dialog" aria-modal="true" aria-labelledby="rules-title" onKeyDown={keepFocusInside}>
        <div className="account-manager-header">
          <div><span className="eyebrow">AUTOMATIK</span><h2 id="rules-title">Regeln</h2></div>
          <button ref={closeButton} className="icon-button" type="button" onClick={onClose} aria-label="Regeln schließen">×</button>
        </div>
        <p className="account-manager-intro">Regeln wirken nur auf neu eintreffende Mails. Probelauf: es wird nur protokolliert, nichts verändert. Die Reihenfolge entscheidet: Nur die erste passende aktive Regel verschiebt.</p>
        {unreadable && <p className="rules-note" role="status">rules.json ist nicht lesbar. Beim Speichern wird zuerst eine Sicherungskopie davon angelegt.</p>}
        {preserved > 0 && <p className="rules-note">{invalidNote(preserved)}</p>}
        <div className="rules-list">
          {loading && <p>Regeln werden geladen …</p>}
          {drafts.map((draft, index) => {
            const folders = mailboxesFor(draft.account);
            const hasTarget = draft.moveTo === "" || folders.some((folder) => folder.id === draft.moveTo);
            return (
              <div className="rule-card" role="group" aria-label={`Regel ${draft.id}`} key={index}>
                <div className="rule-row">
                  <label>Name <input aria-label="Name" maxLength={64} value={draft.id} onChange={(event) => update(index, { id: event.target.value })} /></label>
                  <label className="toggle-control"><input type="checkbox" checked={draft.enabled} onChange={(event) => update(index, { enabled: event.target.checked })} /><span>Aktiv</span></label>
                  <label className="toggle-control"><input type="checkbox" checked={draft.dryRun} onChange={(event) => update(index, { dryRun: event.target.checked })} /><span>Probelauf</span></label>
                </div>
                <div className="rule-row">
                  <label>Konto <select aria-label="Konto" value={draft.account} onChange={(event) => { update(index, { account: event.target.value, moveTo: "" }); loadMailboxes(event.target.value); }}>
                    {[...new Set([draft.account, ...accounts])].map((name) => <option key={name} value={name}>{name}</option>)}
                  </select></label>
                  <select aria-label="Feld" value={draft.field} onChange={(event) => update(index, { field: event.target.value as RuleDraft["field"] })}>
                    {Object.entries(FIELD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <select aria-label="Vergleich" value={draft.match} onChange={(event) => update(index, { match: event.target.value as RuleDraft["match"] })}>
                    {Object.entries(MATCH_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <input aria-label="Suchtext" maxLength={200} value={draft.value} onChange={(event) => update(index, { value: event.target.value })} />
                </div>
                <div className="rule-row">
                  <label className="toggle-control"><input type="checkbox" checked={draft.markSeen} onChange={(event) => update(index, { markSeen: event.target.checked })} /><span>Als gelesen markieren</span></label>
                  <label className="toggle-control"><input type="checkbox" checked={draft.markFlagged} onChange={(event) => update(index, { markFlagged: event.target.checked })} /><span>Markieren</span></label>
                  <label>Verschieben <select aria-label="In Ordner verschieben" value={draft.moveTo} onChange={(event) => update(index, { moveTo: event.target.value })}>
                    <option value="">—</option>
                    {!hasTarget && <option value={draft.moveTo}>{draft.moveTo}</option>}
                    {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                  </select></label>
                  {draft.extraActions.length > 0 && <small>{draft.extraActions.length} weitere Aktion(en) aus rules.json bleiben erhalten.</small>}
                </div>
                <div className="rule-row">
                  <button className="subtle-button" type="button" onClick={() => void preview(index)}>Vorschau</button>
                  <button className="subtle-button" type="button" disabled={index === 0} onClick={() => restructure(moveRule(drafts, index, -1))}>Nach oben</button>
                  <button className="subtle-button" type="button" disabled={index === drafts.length - 1} onClick={() => restructure(moveRule(drafts, index, 1))}>Nach unten</button>
                  <button className="subtle-button" type="button" onClick={() => restructure(drafts.filter((_, position) => position !== index))}>Löschen</button>
                </div>
                {previews[index] && <p role="status" className="rule-preview">{previews[index]}</p>}
              </div>
            );
          })}
        </div>
        {problems.length > 0 && <div role="alert" className="rules-problems">{problems.map((problem) => <div key={problem}>{problem}</div>)}</div>}
        <div className="account-manager-footer">
          <button className="subtle-button" type="button" onClick={() => restructure([...drafts, newRuleDraft(defaultAccount, drafts.map((draft) => draft.id))])}>Neue Regel</button>
          <button className="primary-button" type="button" disabled={saving} onClick={() => void save()}>Speichern</button>
        </div>
      </section>
    </div>
  );
}
