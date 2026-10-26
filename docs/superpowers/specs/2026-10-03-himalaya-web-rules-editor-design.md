# Himalaya Web Slice 5e-4: Rules Editor

**Date:** 2026-10-03

**Status:** Designed autonomously under the operator's goal "work autonomously
until everything is done". Every decision below is judgment to correct on
review; nothing here is a prior operator decision.

## Goal

Let the operator view, add, edit, reorder, enable, put into dry-run, and delete
the mail rules from Slice 3 in the browser, with a read-only preview that shows
what a rule would match, instead of hand-editing `rules.json`.

## Context and constraints

- Rules live in `~/.config/himalaya-web/rules.json` (`HIMALAYA_WEB_RULES_PATH`
  overrides). The watcher re-reads the file on every tick, so a saved change
  applies from the next poll without a restart. Rules only act on mail that
  arrives while the watcher runs (fresh envelopes), never on existing mail.
- Existing engine (`src/server/rules.ts`): condition `{ field: from|subject|to,
  match: contains|equals, value }`; actions `flag` (seen/answered/flagged/draft,
  true/false) and `move` (mailbox); `enabled`, `dryRun`; only the first
  matching live rule's move fires; a dry-run rule only logs.
- **`src/server/rules.ts` and its test carry another session's uncommitted
  changes. This slice must not edit them.** New server code therefore lives in a
  new file and imports only what `rules.ts` already exports (`matchesCondition`,
  the `Rule` types).
- `readRules` drops invalid entries silently (it only logs to stderr). A writer
  that rewrote the file from the valid rules would destroy hand-edited entries
  that merely have a typo, so the editor must preserve them.
- Real mail is never mutated by this slice: the preview is read-only and
  automated tests use fakes.

## Decisions

| Topic | Decision |
|---|---|
| Storage | The same `rules.json`; the editor writes it atomically (temp file + rename), keeping the existing file mode (new file: `0600`). |
| Invalid entries | Kept verbatim at the end of the file on every save; the UI says how many there are. They are neither shown nor editable. |
| New rules | Start enabled and **in dry-run**. Going live (a new live rule, or dry-run switched off) asks for a confirmation that states the rule only affects mail arriving from then on. |
| Ids | Free text, trimmed, 1–64 characters, unique; shown as the rule's name. |
| Order | List order = file order = evaluation order; the editor has move up / move down buttons. |
| Limits | At most 100 rules, condition value ≤ 200 characters, mailbox name ≤ 512, at most 8 actions per rule. |
| Preview | `POST /api/rules/preview` evaluates one rule against the account's newest 50 INBOX messages and returns the count plus up to 10 sample subjects; strictly read-only. |
| Dry-run feedback | Dry-run matches are logged by the service (journal) as before; the UI states that, it does not stream the log. |

## Architecture

### Server (`src/server/rules-store.ts`, new)

```ts
interface StoredRules { rules: Rule[]; preservedInvalid: number }
function readStoredRules(path?: string): Promise<StoredRules>;
function writeStoredRules(rules: readonly Rule[], path?: string): Promise<void>;  // preserves invalid raw entries
const rulesSchema: z.ZodType<Rule[]>;   // strict: exact enums, booleans required, unique ids, limits above
function previewRule(rule: Rule, envelopes: readonly Envelope[]): { checked: number; matchCount: number; samples: Array<{ subject: string; from: string }> }
```

`readStoredRules` parses the JSON array entry by entry with the same schema and
returns the valid rules plus how many entries were invalid (a missing or
corrupt file reads as no rules). `writeStoredRules` re-reads the file, keeps the
raw invalid entries, writes `[...rules, ...invalid]` atomically, serialized
through one promise chain. The default path replicates `rules.ts`' private
`defaultRulesPath()` (same environment variable).

### Routes (`src/server/app.ts`)

- `GET /api/rules` → `{ rules, preservedInvalid }`.
- `PUT /api/rules` body `{ rules: Rule[] }` → `{ ok: true, rules, preservedInvalid }`; schema failures → `400 INVALID_REQUEST`.
- `POST /api/rules/preview` body `{ rule: Rule }` → `{ checked, matchCount, samples }`: resolves the rule's account INBOX
  (`listMailboxes(account, { counts: false })`, id or name `inbox`, case-insensitive; none → `404 FOLDER_NOT_FOUND`),
  lists its newest 50 envelopes, runs `matchesCondition`. No flag or move call is ever made.
- All three sit behind the existing loopback/session hooks.

### Client

A "Regeln" button in the top bar opens a dialog (same pattern as the account
manager): the rule cards (name, enabled, "Probelauf", account, condition,
actions: "Als gelesen markieren", "Markieren" and "In Ordner verschieben" with the
account's folders), up/down/delete buttons, "Neue Regel", per-rule "Vorschau",
and "Speichern" (one `PUT`). A pure `src/client/rules-form.ts` holds the draft
model, the new-rule defaults, validation messages (German) and the
"goes live" detection used for the confirmation. Texts state: "Regeln wirken nur
auf neu eintreffende Mails." and "Probelauf: es wird nur protokolliert, nichts
verändert."

## Error handling

- A failed save keeps the dialog open with the error; the file is untouched
  (temp file + rename).
- Preview errors show in the card; no rule state changes.
- Concurrent saves are serialized; the last one wins (single operator).

## Testing

- Store (real temp files): read valid/invalid split, missing/corrupt file,
  write keeps invalid entries verbatim, atomic replace, mode handling, schema
  errors (duplicate ids, bad enums, empty actions, limits), concurrent writes.
- `previewRule` and the preview route with a fake service: matches counted,
  samples capped at 10, `move`/`setFlag` never called, unknown account INBOX → 404.
- Routes: GET/PUT validation, session boundary, round trip through the store.
- Client: `rules-form` unit tests (defaults, validation, go-live detection);
  Playwright with synthetic routes: add a rule (dry-run by default), edit,
  preview, reorder, delete, save body, confirmation when going live and
  dismissal, error on a failed save.

## Out of scope

Rules on existing mail, multi-condition or regex rules, the AI rule suggestion
button, editing or showing invalid entries, a log viewer for dry-run output, rule
history or undo.
