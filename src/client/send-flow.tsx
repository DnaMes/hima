import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";

import { api } from "./api-client.js";

export type ComposeRequestForClient = {
  account: string;
  mode: "new" | "reply" | "reply-all" | "forward";
  sourceRef?: { account: string; mailbox: string; message: string };
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  includeOriginalAttachments: boolean;
};

type PendingSend = {
  request: ComposeRequestForClient;
  attachments: File[];
};

type OutboxState =
  | { phase: "idle" }
  | { phase: "confirming"; request: ComposeRequestForClient; attachments: File[]; mime: string | null; loadingPreview: boolean; sendError?: string }
  | { phase: "counting"; jobId: string; sendAt: number }
  | { phase: "resolved"; status: "sent" | "failed" | "cancelled"; error?: string };

export function useSendFlow(token: string) {
  const [state, setState] = useState<OutboxState>({ phase: "idle" });
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [sending, setSending] = useState(false);
  // Retried sends reuse the last confirmed payload without widening OutboxState.
  const lastPending = useRef<PendingSend | null>(null);

  const open = useCallback((request: ComposeRequestForClient, attachments: File[]) => {
    setSending(false);
    setState({ phase: "confirming", request, attachments, mime: null, loadingPreview: true });
    void api<{ mime: string }>(token, "/api/compose/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    })
      .then((result) => setState((current) => (
        current.phase === "confirming" ? { ...current, mime: result.mime, loadingPreview: false } : current
      )))
      .catch(() => setState((current) => (
        current.phase === "confirming" ? { ...current, mime: null, loadingPreview: false } : current
      )));
  }, [token]);

  const cancelConfirm = useCallback(() => setState({ phase: "idle" }), []);

  const confirmSend = useCallback(async (pending: PendingSend) => {
    lastPending.current = pending;
    setSending(true);
    try {
      const form = new FormData();
      form.set("payload", JSON.stringify(pending.request));
      pending.attachments.forEach((file) => form.append("attachments", file, file.name));
      const result = await api<{ jobId: string; sendAt: number }>(token, "/api/compose/send", {
        method: "POST",
        body: form,
      });
      setState({ phase: "counting", jobId: result.jobId, sendAt: result.sendAt });
    } catch (reason: unknown) {
      setState((current) => (
        current.phase === "confirming"
          ? { ...current, sendError: reason instanceof Error ? reason.message : "Senden fehlgeschlagen." }
          : current
      ));
    } finally {
      setSending(false);
    }
  }, [token]);

  const retrySend = useCallback(() => {
    const pending = lastPending.current;
    if (!pending) return;
    open(pending.request, pending.attachments);
  }, [open]);

  const undoSend = useCallback(async () => {
    if (state.phase !== "counting") return;
    try {
      await api(token, `/api/outbox/${state.jobId}`, { method: "DELETE" });
      setState({ phase: "resolved", status: "cancelled" });
    } catch {
      // Too late to cancel; the poll below will surface the real outcome.
    }
  }, [state, token]);

  useEffect(() => {
    if (state.phase !== "counting") {
      if (countdownTimer.current) clearInterval(countdownTimer.current);
      return;
    }
    const tick = (): void => setSecondsLeft(Math.max(0, Math.ceil((state.sendAt - Date.now()) / 1000)));
    tick();
    countdownTimer.current = setInterval(tick, 250);
    return () => {
      if (countdownTimer.current) clearInterval(countdownTimer.current);
    };
  }, [state]);

  useEffect(() => {
    if (state.phase !== "counting" || secondsLeft > 0) return;
    let active = true;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let consecutiveFailures = 0;
    const jobId = state.jobId;
    const MAX_CONSECUTIVE_POLL_FAILURES = 5;

    function poll(): void {
      void api<{ status: "queued" | "sending" | "sent" | "failed" | "cancelled"; error?: string }>(
        token, `/api/outbox/${jobId}`,
      ).then((job) => {
        if (!active) return;
        consecutiveFailures = 0;
        if (job.status === "sent" || job.status === "failed" || job.status === "cancelled") {
          setState({ phase: "resolved", status: job.status, ...(job.error ? { error: job.error } : {}) });
          return;
        }
        pollTimer = setTimeout(poll, 500);
      }).catch(() => {
        if (!active) return;
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
          setState({ phase: "resolved", status: "failed", error: "Sendestatus konnte nicht abgefragt werden." });
          return;
        }
        pollTimer = setTimeout(poll, 1000);
      });
    }
    poll();

    return () => {
      active = false;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [state, secondsLeft, token]);

  const dismiss = useCallback(() => setState({ phase: "idle" }), []);

  return { state, secondsLeft, sending, open, cancelConfirm, confirmSend, retrySend, undoSend, dismiss };
}

export type SendFlow = ReturnType<typeof useSendFlow>;

export function SendFlowUi({ flow }: { flow: SendFlow }): JSX.Element | null {
  const { state, secondsLeft, sending, cancelConfirm, confirmSend, retrySend, undoSend, dismiss } = flow;

  if (state.phase === "confirming") {
    return (
      <div className="send-confirm-backdrop" onClick={(event) => { if (event.target === event.currentTarget) cancelConfirm(); }}>
        <section className="send-confirm" role="dialog" aria-modal="true" aria-labelledby="send-confirm-title">
          <h2 id="send-confirm-title">Nachricht senden?</h2>
          <dl className="send-confirm-summary">
            <dt>Von</dt><dd>{state.request.account}</dd>
            <dt>An</dt><dd>{state.request.to.join(", ") || "—"}</dd>
            {state.request.cc.length > 0 && <><dt>Cc</dt><dd>{state.request.cc.join(", ")}</dd></>}
            {state.request.bcc.length > 0 && <><dt>Bcc</dt><dd>{state.request.bcc.join(", ")}</dd></>}
            <dt>Betreff</dt><dd>{state.request.subject || "(ohne Betreff)"}</dd>
            {state.attachments.length > 0 && <><dt>Anhänge</dt><dd>{state.attachments.map((file) => file.name).join(", ")}</dd></>}
          </dl>
          <details className="send-confirm-preview">
            <summary>Rohtext anzeigen</summary>
            <pre>{state.loadingPreview ? "Vorschau wird geladen …" : state.mime ?? "Vorschau nicht verfügbar."}</pre>
          </details>
          {state.sendError && <p role="alert">{state.sendError}</p>}
          <div className="send-confirm-actions">
            <button className="subtle-button" type="button" onClick={cancelConfirm}>Abbrechen</button>
            <button className="primary-button" type="button" disabled={sending} onClick={() => void confirmSend(state)}>
              {sending ? "Wird gesendet …" : "Jetzt senden"}
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (state.phase === "counting") {
    return (
      <div className="banner notice-banner send-flow-banner send-undo-banner" role="status">
        <span>Wird in {secondsLeft}s gesendet …</span>
        <button type="button" onClick={() => void undoSend()}>Rückgängig</button>
      </div>
    );
  }

  if (state.phase === "resolved") {
    const label = state.status === "sent" ? "Gesendet." : state.status === "cancelled" ? "Senden zurückgenommen." : state.error ?? "Senden fehlgeschlagen.";
    const className = state.status === "sent" || state.status === "cancelled" ? "notice-banner" : "error-banner";
    return (
      <div className={`banner ${className} send-flow-banner`} role="status">
        <span>{label}</span>
        <span className="send-flow-banner-actions">
          {state.status === "failed" && <button type="button" onClick={retrySend}>Erneut versuchen</button>}
          <button type="button" onClick={dismiss} aria-label="Hinweis schließen">×</button>
        </span>
      </div>
    );
  }

  return null;
}
