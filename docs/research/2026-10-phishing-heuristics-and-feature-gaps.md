# Offline phishing heuristics, free data sources, leaked-address handling, feature gaps

For the local `himalaya-web` client (Himalaya 2.1 wrapper). Motivating sample:
`Hr. Bundeszentralamt für Steuern | Finn Lindner 🔔 Information <support@swordshieldconsulting.com>`,
DKIM=none, SPF=pass, DMARC=pass for the attacker domain, link to an open redirect. SPF/DMARC
"pass" only proves the attacker owns their domain, so detection must compare display name /
link text against the actual registrable domain, offline.

## 1. Heuristics and scoring

| Signal | W |
|---|---:|
| Authority/brand in display name, From registrable domain not in that brand's official set | +40 |
| From domain confusable to a brand/authority (IDN/punycode, mixed script, edit distance ≤2, added hyphen/subdomain) | +40 |
| Link anchor text looks like a domain/brand but its registrable domain ≠ href registrable domain | +30 |
| Link host is IP literal / odd port / `user@` URL | +30 |
| HTML form or credential prompt in body | +30 |
| Reply-To domain ≠ From domain (Reply-To not a known ESP) | +15 |
| Return-Path domain ≠ From domain (envelope mismatch) | +15 |
| href on known shortener/redirector host | +15 |
| DKIM fail, or DMARC fail/unaligned | +20 |
| DMARC `none`/no policy on From domain | +10 |
| Newly seen sender domain (no prior sent/reply history) | +10 |
| Urgency/credential keywords (DE+EN), capped | +20 |
| Attachment macro/executable | +20 |

**Low-false-positive rule:** warn only when an *anchor* (impersonation, lookalike,
anchor/href mismatch, IP-literal link) is present **and** total ≥45. Bands: 0–29 neutral,
30–44 "Verdächtig", ≥45 "Warnung" (banner only, never auto-delete). Always allow a
per-contact/domain whitelist; never penalise a correctly DMARC-aligned known contact; never
fetch pixels/redirects to score.

**Urgency keywords.** DE: *dringend, sofort, Frist, letzte Mahnung, Konto gesperrt,
verifizieren, bestätigen, Zahlung, Überweisung, Rechnung, Erstattung, Steuer, Passwort,
Zugangsdaten, Warnung, wichtiges Dokument.* EN: *urgent, immediate, final notice, account
suspended, verify, confirm, payment, wire transfer, invoice, refund, tax, password,
credentials, warning, act now.* Word-boundary matching; cap the sum at +20.

**Upstream practice.** SpamAssassin ships generic header/anomaly rules, not display-name-
brand rules: `FROM_BLANK_NAME`, `FROM_NO_USER`, `FROM_DOMAIN_NOVOWEL`, `FROM_ILLEGAL_CHARS`
(`rules/20_head_tests.cf`). Shorteners/redirectors are enumerated in
`rules/25_url_redirectors.cf` and `25_url_shortener.cf` (hundreds incl. `bit.ly`, `cutt.ly`,
`t.co`, `goo.gl`, `youtu.be`); auth rules in `25_spf.cf`, `25_dkim.cf`, `25_dmarc.cf`
(`DKIM_INVALID`, `DKIM_VALID_AU`, `DMARC_PASS/REJECT/QUAR/NONE/MISSING`); brand/feed matching
is delegated to the `Phishing` plugin. rspamd does link-text-vs-href TLD comparison in its
`phishing` module and follows redirectors via `url_redirector` with a 1,197-entry
`conf/maps.d/redirectors.inc`. Thunderbird has a built-in scam detector (link text vs URL,
scam banner). Gmail uses server-side ML plus `Authentication-Results`, a "via" display for
unaligned senders, external-image blocking, and link warnings.

## 2. Free offline data sources

- **Registrable domains:** npm `tldts` (v7.4.16, modified 2026-09-27, ~106.5M downloads/wk)
  or `psl` (~49.5M/wk, updated 2024-12); `parse-domain` ~0.56M/wk. Prefer `tldts`; refresh
  its PSL snapshot.
- **Confusables:** no well-maintained pure npm package. `confusables` (~49k/wk, last publish
  2022-06), `unicode-confusables` (2022), `homoglyph` (211/wk, 2022). Use Node's built-in
  `url.domainToASCII()` for IDN/punycode plus Unicode `confusables.txt`, refreshed like the PSL.
- **Feeds (verified 2026-10):** OpenPhish community `https://openphish.com/feed.txt`
  (HTTP 200, ~16 KB, 12 h refresh) — free for personal/academic only, **no commercial use**.
  URLhaus `https://urlhaus.abuse.ch/downloads/text/` (HTTP 200, ~2.7 MB) — free under fair
  use, commercial may need the paid abuse.ch API. PhishTank hourly
  `data.phishtank.com/data/online-valid.csv[.gz]` — free application key required, plus a
  descriptive User-Agent; unkeyed downloads are rate-limited.
- **Brand→official-domain list:** no canonical public dataset. Maintain a small hand-reviewed
  allowlist for authorities/banks/parcel/payment brands, seeded from OpenPhish's published
  "Top Targeted Brands"; extract hosts from feeds at build time, keep runtime offline.
- **German authority allowlist** (all verified HTTP 200): `bund.de`/`*.bund.de`,
  `verwaltung.bund.de`, `elster.de`, `bzst.de`, `bsi.bund.de`, `zoll.de`,
  `arbeitsagentur.de`, `bundesregierung.de`, `bundestag.de`, `bka.de`, `polizei.de`,
  `rentenversicherung.de`. No single machine-readable federal list; treat `*.bund.de` as
  authoritative.

## 3. Leaked-address handling

HIBP (fetched 2026-10, `haveibeenpwned.com/Subscription`, `/API/v3`):

- **Free:** browser email search, email notifications, Pwned Passwords, breach-monitoring API,
  and domain monitoring with **up to 10 breached addresses**.
- **Domain search** requires proving ownership (DNS or email) and an API key; unverified
  domains return HTTP 403. Core starts at **$4.39/mo** (Core 1: 10 RPM, 25 breached addresses,
  1 domain; Core 2: 50 RPM, 100 addresses, 3 domains, $21.59/mo; Core 5: 1,000 RPM, unlimited,
  20 domains, $319/mo). Single-address API = Core or above (free is browser-only).
  K-anonymity search is **Pro-exclusive**, from $379/mo; High RPM from $1,150/mo.
- **Mitigation:** per-service plus-addressing/aliases (`user+service@domain`) so a leak
  identifies the sender; rotate the alias after a hit; enable free HIBP Notify per address;
  use free domain monitoring if the user owns the domain. Verify lima-city's spam-filter
  options in its panel (**needs web check**). HIBP never exposes cleartext credentials.

## 4. Feature gaps and top-10 value/effort

Current state (`README.md`, `src/shared/types.ts`, `src/server/unified-inbox.ts`,
`src/server/rules.ts`): single-account move only (no copy), Markdown export + PDF print but
no `.eml` save, no clipboard copy, no header/auth panel, unified inbox hard-coded to each
visible+active account's `INBOX`, field-scoped search per mailbox, hand-edited `rules.json`
that runs only at watcher time, no saved searches/smart folders, no filter UI. Thunderbird,
Apple Mail, Fastmail, Superhuman and Mailspring all offer copy-to-folder, message source/
headers, unified-inbox selection, cross-account search, saved searches and a filter UI;
Proton is the closest analogue in limitations.

1. **Sender details panel: full headers + SPF/DKIM/DMARC** — high value, low effort
   (`readRaw` already returns the raw buffer; `parseRawMessage` already feeds `mailparser`).
2. **Copy actions: body to clipboard, copy message to folder, download `.eml`** — medium,
   low (`readRaw` + raw parse exist).
3. **Unified-inbox account/folder chooser** — high, low-medium.
4. **Cross-folder / cross-account search** — high, medium-high (`buildSearchQuery`/paging exist).
5. **Phishing/scam score banner from §1** — high, medium (pure local parse, off by default).
6. **Visual filter UI over `rules.json`** — medium, low-medium.
7. **Saved searches / smart folders** — medium, medium.
8. **Sender history panel (first-seen, prior replies)** — high, medium-high (small local index).
9. **Report-phishing / whitelist actions** — medium, low.
10. **Copy sender address / copy link** — low, low.

## Sources

Local: `README.md`, `HANDOFF.md`, `src/server/mime.ts`, `src/server/himalaya.ts`,
`src/shared/types.ts`, `src/server/unified-inbox.ts`, `src/server/rules.ts`.
HIBP `haveibeenpwned.com/Subscription` + `/API/v3`; OpenPhish
`phishing_feeds.html`/`terms.html`/`feed.txt`; `urlhaus.abuse.ch/api/` + `/downloads/text/`;
`phishtank.org/developer_info.php`; Apache SpamAssassin trunk `rules/…`; rspamd
`phishing.html`, `url_redirector.html`, `conf/maps.d/redirectors.inc`; npm downloads/registry
APIs; `support.mozilla.org/en-US/kb/thunderbird-and-scams`; `support.google.com/mail/answer/8253`.

**Remaining web checks:** official federal domain list; lima-city spam-filter capabilities;
per-client feature cells (Apple/Proton/Superhuman/Mailspring) not verified first-hand.