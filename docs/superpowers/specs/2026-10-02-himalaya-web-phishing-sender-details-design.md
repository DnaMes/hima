# Himalaya Web Slice 5a: Phishing Early Warning + Sender Details

**Date:** 2026-10-02

**Status:** Implemented and verified. No outstanding decisions; this slice is
closed and ready for merge.

## Goal

Assess incoming messages for phishing signals (brand impersonation, mixed-script
domains, suspicious link patterns, urgency language) and display a verdict to
the operator in the message reader and list. The assessment runs
opportunistically as mail arrives in the watcher (Slice 2), and is also
Display a ⚠ badge in the message list and a risk-level banner in the reader, along with the specific
signals that triggered the verdict. Opening any message computes the full verdict.
Never auto-move or auto-delete mail based on a phishing score — only alert and mark; the operator decides.

## Context and constraints

- **Scored against a hand-maintained brand table.** `src/server/phishing.ts`'s
  `BRANDS` array holds brand names (German labels), display-name patterns
  (case-insensitive regex), a short token for domain lookalike detection, and
  the list of official registrable domains. A German sender impersonating
  "Bundeszentralamt für Steuern / Finanzverwaltung" (tax authority) is the
  canonical threat model; real phishing samples targeting the operator's own
  account are the test data.
- **Scoring is additive, capped, and gates on anchor signals.** A message
  accumulates points for impersonation, mixed-script domains, mismatched
  Reply-To/Return-Path, DKIM/DMARC failures, suspicious links, forms, and
  urgency language. The total is capped at 100. A verdict of `suspicious`
  (≥30 points) or `high` (≥45 points) requires at least one "anchor" signal
  (brand/lookalike impersonation, mixed-script domain, name-address mismatch,
  IP/userinfo link, or link-text-href mismatch) — pure urgency language or a
  single redirector link never triggers a warning by itself.
- **Integrates with the watcher, not a separate poll.** The watcher's existing
  Slice 2 infrastructure already fetches and parses fresh envelopes; phishing
  assessment reuses that same read, never adds a second one. Only messages
  ≤2 MiB are assessed (skipped silently if larger); parse errors are swallowed,
  not surfaced.
- **Verdicts are transient and in-memory.** A map capped at 500 entries (old
  verdicts evicted on insert) holds the watcher's computed risk levels. A
  message assessed while the service is running with `watch: true` for that
  account is decorated with a `risk` field in the API. Opening a message
  always assesses it regardless of watch state (inside the existing
  `GET /api/message`), so the operator sees the verdict even for older mail
  or accounts without the watcher running.
- **Durable decisions:** MiniMax is optional, server-side only, no AI key reaches
  the browser (Slice 1's durable rule); AI actions can never send/move/delete/tag
  mail (Slice 3's rule). This slice adds no exceptions.
- User-facing text (banner prose and reason strings) stays German; code, tests,
  and this spec stay English.

## Non-goals (this slice)

- Threat feeds (OpenPhish, URLhaus, PhishTank) — licensing and network
  complexity deferred.
- Sender history or reputation tracking — would require a persistent index.
- Edit-distance or fuzzy lookalikes beyond brand-token substring matching and
  mixed-script detection — the hand-kept brand table covers the real threats
  in the operator's own mail.
- Auto-quarantine, auto-move, or auto-delete based on risk level — only
  warn and mark.
- A settings UI for the brand table — it is hand-edited in source for now
  (`phishing.ts`'s `BRANDS`). Scale to user-editable JSON later if needed.

## Decisions

| Topic | Decision | Rationale |
|---|---|---|
| Scoring algorithm | Additive points-based, capped 100, gates on anchor signals, thresholds at 30 (suspicious) and 45 (high) | Transparent to the operator (they see the score and reasons); avoids ML/model complexity; hand-tuned weights based on real samples; anchor gate prevents false positives from urgency language alone |
| Brand data store | Hand-maintained `BRANDS` array in `phishing.ts`, extended when a legitimate sender is flagged | Matches the operator's threat model (German public institutions, common ESPs, banking, e-commerce); no network dependency; transparent (changes go through code review) |
| Verdict integration | Watcher assesses fresh envelopes and stores verdicts in `riskFor()` map (cap 500, evict oldest on insert); app decorates list/unified-inbox envelopes with `risk: RiskLevel` (level only); reader calls parseRawMessage (existing GET /api/message route) which computes full `SenderInfo.risk: Risk` (score + reasons) | Fresh mail gets verdicts (level-only badge) automatically if watched; opening any message computes the full verdict from headers/body; verdicts survive one page reload within session, lost on service restart (acceptable — a refresh re-assesses) |
| UI signal | ⚠ badge in message list (only shows for mail arriving while watched), full banner in reader with score + reason list in German | Badge is subtle (not alarmist), reason list is the ground truth (operator can decide if the score matches their risk tolerance) |
| Large-message handling | Skip assessment for mail >2 MiB, no error message | Avoids blocking on slow parses or giant attachments; operator never sees an error for a large mail, so no distraction |
| Link extraction | HTML `<a href>` tags + bare `https?://` URLs in text; no JavaScript execution, no link shortener expansion | Covers the common phishing patterns (shortened URLs, domain mismatches in text); no browser/sandbox overhead |
| DKIM/DMARC interpretation | `dkim=fail` or `dmarc=fail` flags failure; `dkim=none` is NOT a fail (unsigned mail is normal for many legitimate senders) | Avoids false positives for unsigned mail; aligns with DMARC's own spec (fail only if a policy explicitly requires it) |
| Registrable domains | Use `tldts` library's `getDomain()` to normalize subdomains for comparison (e.g. `mail.example.com` → `example.com`) | Handles subdomain decoys correctly; prevents trivial `anysubdomain.legitimate.de` spoofs |

## Architecture

### `src/server/phishing.ts` (new module)

Pure functions, no I/O, injectable for testing:

```ts
export type AssessInput = {
  fromName: string | null;
  fromEmail: string;
  replyTo: string | null;
  returnPath: string | null;
  auth: AuthResults | null;  // { spf, dkim, dmarc }
  html: string | null;
  text: string;
  subject: string;
};

export function assessMessage(input: AssessInput): Risk;
// input.from* and auth come from parseRawMessage (mime.ts, below);
// html/text/subject are message content. Returns { level, score, reasons[] },
// reasons in German.

export function parseAuthResults(header: string | null): AuthResults | null;
// Extracts spf/dkim/dmarc from the Authentication-Results header.
```

Scoring breakdown (all weights additive, max 100):
- Brand display-name on foreign domain: +40 anchor
- Brand-lookalike From domain: +40 anchor
- Mixed-script From domain (Latin + Cyrillic/Greek/etc.): +40 anchor
- Address in display name differing from From: +30 anchor
- Reply-To registrable-domain mismatch: +15
- Return-Path registrable-domain mismatch: +15
- DKIM fail or DMARC fail: +20
- Redirector/shortener href (bit.ly, t.co, etc., or Google redirect path): +15
- IP-literal or userinfo in link (e.g., `user:pass@host`, `http://1.2.3.4`): +30 anchor
- Link text names different domain than href (except sender's own): +30 anchor
- HTML form or password input: +30
- Urgency vocabulary (dringend, frist, zahlung, verify, payment, etc.): up to +20 (capped per-message)

Verdict gate: `level = "none"` unless `anchor=true AND score >= suspicious_threshold (30)`;
then `"suspicious"` if score < 45, else `"high"`.

### `src/server/mime.ts` changes

`parseRawMessage()` now returns a `sender` object:

```ts
export type AuthResults = {
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
};

export interface ParsedMessage {
  // ... existing fields
  sender: {
    replyTo: string | null;
    returnPath: string | null;
    auth: AuthResults | null;
  };
}
```

Extracted from the `From`, `Reply-To`, `Return-Path`, and `Authentication-Results`
headers via `parseAuthResults()`.

### `src/server/watcher.ts` changes

```ts
interface Watcher {
  // ... existing
  riskFor(ref: MessageRef): Exclude<Risk["level"], "none"> | undefined;
}

// In the tick loop, after fresh-envelope detection:
for (const envelope of fresh) {
  const msg = await readRaw(ref);  // existing call, now used for phishing too
  const input = buildAssessInput(msg);
  const risk = assessMessage(input);
  if (risk.level !== "none") {
    risks.set(riskKey(ref), risk.level);
  }
}
```

The `risks` map caps at 500 entries (oldest first). A verdict other than
`"none"` is stored; `"none"` verdicts are not stored (saves space, matches
"only alert on warning" design).

### `src/server/app.ts` changes

```ts
// Existing route for message list:
app.get("/api/accounts/:account/messages", async (req, res) => {
  // ... fetch envelopes
  const withRisk = (envelopes: Envelope[]): Envelope[] =>
    envelopes.map((e) => ({
      ...e,
      risk: watcher.riskFor({ account, mailbox, message: e.id }),
    }));
  res.send(withRisk(envelopes));
});

// Same for unified inbox:
app.get("/api/unified/inbox", async (req, res) => {
  // ... fetch unified envelopes
  res.send(withRisk(envelopes));
});


```

### Client: `src/client/sender-panel.tsx` (new file)

New components for the message reader's sender area:

```tsx
export function RiskBanner({ risk }: { risk: Risk }): JSX.Element | null {
  // Render ⚠ + level label + expandable reason list in German.
  // level="suspicious" → orange, level="high" → red.
}

export function SenderDetails({ message }: { message: MessageDetail }): JSX.Element {
  // Display From, Reply-To, Return-Path, SPF/DKIM/DMARC results,
  // alongside RiskBanner if message.risk is set.
}
```

### Client: `src/client/message-list.tsx` changes

Add a ⚠ badge to envelope rows where `envelope.risk` is truthy (only for
mail that arrived while watched, so only badge entries in the active
watcher's verdict map). Badge uses an `aria-label` ("Phishing-Verdacht,
level: high" etc.) for accessibility.

### Types: `src/shared/types.ts` changes

```ts
export type RiskLevel = "none" | "suspicious" | "high";

export type Risk = {
  level: RiskLevel;
  score: number;
  reasons: string[];  // German prose explaining each point contributor
};

export type Envelope = {
  // ... existing
  risk?: Exclude<RiskLevel, "none">;  // only "suspicious" or "high" if present
};

export type SenderInfo = {
  // ... existing auth, replyTo, returnPath, messageIdDomain, received
  risk: Risk;  // full verdict (level, score, reasons[]) computed from headers/body
};

export type MessageDetail = {
  // ... existing
  sender: SenderInfo;  // includes full risk assessment
};
```

## Error handling

- A message >2 MiB is skipped from assessment silently (no error, no badge,
  no log line).
- A parse error (malformed MIME, missing headers) swallows the error and
  returns `{ level: "none", score: 0, reasons: [] }` — treated as "not
  assessable, assume clean."
- A registrable-domain lookup failure (e.g., invalid TLD) returns the input
  domain as-is and continues (`getDomain()` fallback in `phishing.ts`).

## Testing

- Unit (`phishing.test.ts`): each scoring signal (brand/lookalike/mixed-script/
  name-address/reply-domain/return-domain/dkim/dmarc/redirector/IP-link/
  text-href-mismatch/form/urgency), anchor gating (verdict requires ≥1
  anchor + score threshold), score capping.
- `mime.test.ts` additions: `parseAuthResults` for each auth result value,
  `sender` object shape.
- `watcher.test.ts` additions: a phishing verdict for a fresh envelope is
  stored in `riskFor()` and returned by the watcher's public API; verdicts
  persist across ticks until evicted by cap.
- `app.test.ts` additions: `GET /api/accounts/*/messages` decorates envelopes
  with `risk` if available; `GET /api/message` returns MessageDetail with full
  SenderInfo.risk for the message being read.
- Integration (`sender-panel.test.ts`, new): `RiskBanner` and `SenderDetails`
  render correctly for each risk level and auth-result combination; reason
  list is German.
- Playwright (`tests/e2e/phishing-warning.spec.ts`, new): Open a watched
  account with a synthetic phishing message; badge appears in list; reader
  shows risk banner + sender details (the test mocks the API; the list badge
  comes from the mocked `risk` field).
- Manual verification: Real phishing sample (BZSt tax-authority spoof,
  already in the operator's account) scores high (70+), passes; 14 recent
  real non-phishing mails from the operator's account score none or low
  (PlayStation click-tracking links scored suspiciously, then re-tuned to
  pass).

## Docs to update in the same change

`README.md` (phishing feature, watcher's new assessment capabilities), (progress, version 0.9.0, verification
evidence), a link to `docs/research/2026-10-phishing-heuristics-and-feature-gaps.md`
(research document covering decision rationale and known ceilings).

## Known limitations / Future work

- Brand table is hand-kept in `phishing.ts`; no UI to edit it. Scale to a
  JSON file or database if the operator needs to frequently add/remove
  brands, but current hand-editing covers the operator's threat model.
- No sender history or reputation tracking — would require persistent mail
  index. Deferred to a future slice when that infrastructure exists.
- No threat feeds (OpenPhish, URLhaus, PhishTank) — licensing/network burden
  not justified given the hand-brand-table's accuracy against real samples.
- Link shortener expansion is not performed — verdict is based on the
  shortened href as-is. User can click `target="_blank"` to inspect the
  destination; a future enhancement could log the expanded URL without
  following it.
- DKIM/DMARC interpretation is per the existing `Authentication-Results`
  header, parsed as-is — no second validation. Trust the mail server's own
  audit.
- False positives from email service provider click-tracking (e.g., ESP links
  where text names a domain different from href but both are the ESP's own)
  are deferred to careful tuning via real mail. The "text naming sender's own
  domain = ESP tracking" exemption catches the common case.

## Open questions for plan review / Deferring to next slice

None. This slice is closed.
