import type { JSX } from "react";

import type { SenderInfo } from "../shared/types.js";
import type { HistoryView } from "./sender-history.js";

const AUTH_LABELS = ["spf", "dkim", "dmarc"] as const;

export function RiskBanner({ risk }: { risk: SenderInfo["risk"] }): JSX.Element | null {
  if (risk.level === "none") return null;
  return (
    <div className={`risk-banner ${risk.level}`} role="alert">
      <strong>{risk.level === "high" ? "⚠ Warnung: sehr wahrscheinlich Phishing" : "⚠ Verdächtige Nachricht"}</strong>
      <ul>{risk.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      <small>Keine Links anklicken, nichts bestätigen, keine Daten eingeben.</small>
    </div>
  );
}

type SenderDetailsProps = {
  from: string;
  sender: SenderInfo;
  history?: HistoryView;
  onCheckHistory?: () => void;
  onShowAll?: () => void;
  /** Trust (`"trusted"`) or clear the rating (`null`) of this sender. */
  onSetStatus?: (status: "trusted" | null) => void;
  onReport?: () => void;
  busy?: boolean;
};

function StatusRow({ trust, onSetStatus, onReport, busy }: { trust: SenderInfo["trust"]; onSetStatus: (status: "trusted" | null) => void; onReport: (() => void) | undefined; busy: boolean }): JSX.Element {
  const label = trust === "trusted" ? "Vertrauenswürdig" : trust === "blocked" ? "Als Phishing gemeldet" : "Nicht eingestuft";
  return (
    <>
      <dt>Einstufung</dt>
      <dd>
        <div>{label}</div>
        {trust === "trusted"
          ? <button className="subtle-button" type="button" disabled={busy} onClick={() => onSetStatus(null)}>Vertrauen widerrufen</button>
          : <button className="subtle-button" type="button" disabled={busy} onClick={() => onSetStatus("trusted")}>Absender vertrauen</button>}
        {trust === "blocked"
          ? <button className="subtle-button" type="button" disabled={busy} onClick={() => onSetStatus(null)}>Meldung widerrufen</button>
          : <button className="subtle-button" type="button" disabled={busy} onClick={onReport}>Als Phishing melden</button>}
      </dd>
    </>
  );
}

function HistoryRow({ history, onCheckHistory, onShowAll }: { history: HistoryView; onCheckHistory: (() => void) | undefined; onShowAll: (() => void) | undefined }): JSX.Element {
  return (
    <>
      <dt>Verlauf</dt>
      <dd>
        {(history.status === "idle" || history.status === "error") && (
          <>
            {history.status === "error" && <div role="alert">{history.message}</div>}
            <button className="subtle-button" type="button" onClick={onCheckHistory}>{history.status === "error" ? "Erneut prüfen" : "Verlauf prüfen"}</button>
          </>
        )}
        {history.status === "loading" && <span role="status">Suche läuft …</span>}
        {history.status === "ready" && (
          <>
            {history.lines.map((line) => <div key={line}>{line}</div>)}
            <button className="subtle-button" type="button" onClick={onShowAll}>Alle Mails dieses Absenders anzeigen</button>
          </>
        )}
      </dd>
    </>
  );
}

export function SenderDetails({ from, sender, history, onCheckHistory, onShowAll, onSetStatus, onReport, busy = false }: SenderDetailsProps): JSX.Element {
  const rows: Array<[string, string | null]> = [
    ["Absender", from],
    ["Antwort an", sender.replyTo],
    ["Return-Path", sender.returnPath],
    ["Message-ID-Domain", sender.messageIdDomain],
  ];
  return (
    <details className="sender-details">
      <summary>Absenderdetails</summary>
      <dl>
        {rows.filter(([, value]) => value).map(([label, value]) => <div key={label} style={{ display: "contents" }}><dt>{label}</dt><dd>{value}</dd></div>)}
        <dt>Prüfung</dt>
        <dd>
          {sender.auth === null ? "Keine Authentication-Results vorhanden" : AUTH_LABELS.map((key) => {
            const result = sender.auth![key] ?? "–";
            return <span key={key} className={`auth-chip ${result === "pass" ? "pass" : result === "fail" ? "fail" : ""}`}>{`${key.toUpperCase()} ${result}`}</span>;
          })}
        </dd>
        {onSetStatus && <StatusRow trust={sender.trust} onSetStatus={onSetStatus} onReport={onReport} busy={busy} />}
        {history && <HistoryRow history={history} onCheckHistory={onCheckHistory} onShowAll={onShowAll} />}
        {sender.received.length > 0 && (
          <>
            <dt>Übertragungsweg</dt>
            <dd>{sender.received.map((hop, index) => <div key={index}>{`${hop.from ?? "?"}${hop.ip ? ` [${hop.ip}]` : ""} → ${hop.by ?? "?"}`}</div>)}</dd>
          </>
        )}
      </dl>
    </details>
  );
}
