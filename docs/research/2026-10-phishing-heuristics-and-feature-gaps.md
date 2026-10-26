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
map at https://github.com/rspamd/rspamd/blob/master/conf/maps.d/redirectors.inc.
Thunderbird has a built-in scam detector (link text vs URL, scam banner). Gmail uses
server-side ML plus `Authentication-Results`, a "via" display for unaligned senders,
external-image blocking, and link warnings.

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

HIBP (fetched 2026-10, https://haveibeenpwned.com/Subscription and `/API/v3`):

- **Free:** browser email search, email notifications, Pwned Passwords, breach-monitoring API,
  and domain monitoring with a small breached-address cap.
- **Domain search** requires proving ownership (DNS or email) and an API key; unverified
  domains return HTTP 403. Paid Core/Pro tiers cover single-address API, higher RPM, and
  K-anonymity — current prices live on the HIBP Subscription page only (do not copy dollar
  figures here). Agent model and stack subscription costs live only in
  `~/projects/ai-stack/docs/roles.md` and `~/projects/ai-stack/subscriptions/SUBSCRIPTIONS.md`.
- **Mitigation:** per-service plus-addressing/aliases (`user+service@domain`) so a leak
  identifies the sender; rotate the alias after a hit; enable free HIBP Notify per address;
  use free domain monitoring if the user owns the domain. Verify lima-city's spam-filter
  options in its panel (**needs web check**). HIBP never exposes cleartext credentials.

## 4. Feature gaps and top-10 value/effort

Status as of Hima **0.35.0** (`README.md`, `CHANGELOG.md`, `src/server/phishing.ts`):
most of the October research gaps below are **shipped**. Remaining work is polish and
operator-side HIBP domain monitoring, not the original top-10 list.

| # | Item | State in 0.35.0 |
|---|---|---|
| 1 | Sender details + SPF/DKIM/DMARC | Shipped (`src/client/sender-panel.tsx`) |
| 2 | Copy body / copy to folder / `.eml` | Shipped |
| 3 | Unified-inbox account/folder chooser | Shipped (account tree + tabs) |
| 4 | Cross-folder / cross-account search | Shipped (`src/server/search-scope.ts`) |
| 5 | Phishing/scam score banner (§1) | Shipped (`src/server/phishing.ts`, offline heuristics) |
| 6 | Visual filter UI over `rules.json` | Shipped (`src/client/rules-dialog.tsx`) |
| 7 | Saved searches | Shipped (`src/client/saved-searches.ts`) |
| 8 | Sender history panel | Shipped (`src/client/sender-history.ts`) |
| 9 | Report-phishing / whitelist | Shipped (trust/report sender routes) |
| 10 | Copy sender address / copy link | Shipped with copy actions |

**Still open (low urgency):** live threat-feed refresh (OpenPhish/URLhaus) is intentionally
out of scope — scoring stays offline; HIBP free domain monitoring for owned domains is an
operator task, not app code.

## Sources

Local: `README.md`, `HANDOFF.md`, `src/server/mime.ts`, `src/server/himalaya.ts`,
`src/shared/types.ts`, `src/server/unified-inbox.ts`, `src/server/rules.ts`,
`src/server/phishing.ts`.
HIBP https://haveibeenpwned.com/Subscription and `/API/v3`; OpenPhish
https://openphish.com/phishing_feeds.html / terms / feed.txt; URLhaus
https://urlhaus.abuse.ch/api/ and https://urlhaus.abuse.ch/downloads/text/;
https://phishtank.org/developer_info.php; Apache SpamAssassin trunk rules; rspamd
phishing and url_redirector docs plus
https://github.com/rspamd/rspamd/blob/master/conf/maps.d/redirectors.inc;
npm downloads/registry APIs;
https://support.mozilla.org/en-US/kb/thunderbird-and-scams;
https://support.google.com/mail/answer/8253.
Stack model/subscription inventory (not duplicated here):
`~/projects/ai-stack/docs/roles.md`,
`~/projects/ai-stack/subscriptions/SUBSCRIPTIONS.md`.

**Remaining web checks:** official federal domain list; lima-city spam-filter capabilities;
per-client feature cells (Apple/Proton/Superhuman/Mailspring) not verified first-hand.