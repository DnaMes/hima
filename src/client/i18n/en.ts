// SPDX-License-Identifier: MIT
// Copyright (C) 2026 erdlabs
// English is the template: add a key here first, then de.ts (a missing key fails typecheck and i18n.test.ts).
// One key per line, flat, so scripts/preflight.sh in the erdlabs repo can read the key set.
export const en = {
  "app.tagline": "Local mail workspace",
  "theme.label": "Color scheme",
  "theme.aria": "Choose color scheme",
  "language.label": "Language",
  "language.aria": "Choose language",
  "language.auto": "Automatic",
  "language.de": "Deutsch",
  "language.en": "English",
  "topbar.compose": "New message",
  "topbar.accounts": "Accounts",
  "topbar.accountsAria": "Manage accounts",
  "topbar.rules": "Rules",
  "topbar.shortcuts": "Keyboard shortcuts",
  "topbar.snoozed": "Snoozed ({count})",
  "topbar.accountCount": "{ready}/{total} accounts",
  "topbar.local": "local",
  "palette.aria": "Command palette",
  "palette.placeholder": "Account, folder or action …",
  "palette.inputAria": "Search commands",
  "palette.empty": "Nothing found",
} as const;

export type Key = keyof typeof en;
