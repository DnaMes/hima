// SPDX-License-Identifier: MIT
// Copyright (C) 2026 erdlabs
import { useSyncExternalStore } from "react";

import { de } from "./de.js";
import { en } from "./en.js";
import type { Key } from "./en.js";

export type Locale = "de" | "en";
export type LocalePreference = "auto" | Locale;
export type { Key };

export const LOCALE_KEY = "himalaya-web-locale";
const CATALOGS: Record<Locale, Record<Key, string>> = { de, en };

/** An explicit choice wins; otherwise the first browser language we ship, else English (the template). */
export function resolveLocale(preference: string | null, languages: readonly string[]): Locale {
  if (preference === "de" || preference === "en") return preference;
  for (const language of languages) {
    const base = language.toLowerCase().split("-")[0];
    if (base === "de" || base === "en") return base;
  }
  return "en";
}

export function translate(locale: Locale, key: Key, vars: Record<string, string | number> = {}): string {
  return CATALOGS[locale][key].replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

function readPreference(): LocalePreference {
  try {
    const saved = window.localStorage.getItem(LOCALE_KEY);
    return saved === "de" || saved === "en" ? saved : "auto";
  } catch {
    return "auto";
  }
}

let preference: LocalePreference = typeof window === "undefined" ? "auto" : readPreference();
const listeners = new Set<() => void>();

function currentLocale(): Locale {
  return resolveLocale(preference, typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language]);
}

function applyDocumentLang(): void {
  if (typeof document !== "undefined") document.documentElement.lang = currentLocale();
}
applyDocumentLang();

export function setLocalePreference(next: LocalePreference): void {
  preference = next;
  try {
    if (next === "auto") window.localStorage.removeItem(LOCALE_KEY);
    else window.localStorage.setItem(LOCALE_KEY, next);
  } catch {
    // Storage blocked: the choice still holds for this page load.
  }
  applyDocumentLang();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders the calling component when the language changes. */
export function useI18n(): {
  locale: Locale;
  preference: LocalePreference;
  t: (key: Key, vars?: Record<string, string | number>) => string;
} {
  const locale = useSyncExternalStore(subscribe, currentLocale, () => "en" as const);
  const pref = useSyncExternalStore(subscribe, () => preference, () => "auto" as const);
  return { locale, preference: pref, t: (key, vars) => translate(locale, key, vars) };
}
