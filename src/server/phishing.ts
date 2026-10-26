import { domainToUnicode } from "node:url";

import { getDomain, parse } from "tldts";

import type { AuthResults, Risk } from "../shared/types.js";
import type { SenderStatus } from "./senders.js";

export type AssessInput = {
  fromName: string | null;
  fromEmail: string;
  replyTo: string | null;
  returnPath: string | null;
  auth: AuthResults | null;
  html: string | null;
  text: string;
  subject: string;
  /** The operator's verdict on this exact address, if any. */
  senderStatus?: SenderStatus;
};

type Brand = {
  label: string;
  name: RegExp;
  token: string;
  domains: readonly string[];
};

// Hand-kept brand/authority table. A display name that matches `name` must
// come from one of `domains`; extend it when a legitimate sender is flagged.
const BRANDS: readonly Brand[] = [
  { label: "Bundeszentralamt für Steuern / Finanzverwaltung", name: /bundeszentralamt|\bbzst\b|finanzamt|\belster\b|steuerverwaltung/i, token: "bzst", domains: ["bund.de", "bzst.de", "elster.de", "finanzamt.de", "zoll.de"] },
  { label: "Bundesagentur für Arbeit", name: /arbeitsagentur|bundesagentur/i, token: "arbeitsagentur", domains: ["arbeitsagentur.de", "bund.de"] },
  { label: "Deutsche Rentenversicherung", name: /rentenversicherung/i, token: "rentenversicherung", domains: ["deutsche-rentenversicherung.de", "bund.de"] },
  { label: "Polizei / BKA", name: /\bpolizei\b|bundeskriminalamt|\bbka\b/i, token: "polizei", domains: ["polizei.de", "bka.de", "bund.de"] },
  { label: "PayPal", name: /paypal/i, token: "paypal", domains: ["paypal.com", "paypal.de", "paypal-communication.com"] },
  { label: "DHL", name: /\bdhl\b/i, token: "dhl", domains: ["dhl.de", "dhl.com", "deutschepost.de"] },
  { label: "Amazon", name: /amazon/i, token: "amazon", domains: ["amazon.de", "amazon.com", "amazon.co.uk", "amazonaws.com"] },
  { label: "Sparkasse", name: /sparkasse/i, token: "sparkasse", domains: ["sparkasse.de"] },
  { label: "DKB", name: /\bdkb\b/i, token: "dkb", domains: ["dkb.de"] },
  { label: "Trade Republic", name: /trade\s*republic/i, token: "traderepublic", domains: ["traderepublic.com"] },
  { label: "Microsoft", name: /microsoft/i, token: "microsoft", domains: ["microsoft.com", "microsoftonline.com", "office.com", "outlook.com"] },
  { label: "Apple", name: /\bapple\b/i, token: "apple", domains: ["apple.com", "icloud.com"] },
  { label: "Netflix", name: /netflix/i, token: "netflix", domains: ["netflix.com"] },
];

const REDIRECTOR_HOSTS = new Set([
  "bit.ly", "t.co", "tinyurl.com", "cutt.ly", "goo.gl", "ow.ly", "is.gd", "rebrand.ly", "buff.ly", "lnkd.in", "share.google",
]);
const GOOGLE_REDIRECT_PATHS = /^\/(url|amp\/|share\.google)/;

const URGENCY = [
  "dringend", "sofort", "frist", "letzte mahnung", "gesperrt", "sperrung", "sperrfolge", "verifizieren",
  "bestätigen", "zahlung", "überweisung", "rechnung", "erstattung", "steuer", "passwort", "zugangsdaten",
  "urgent", "immediate", "final notice", "suspended", "verify", "confirm", "payment", "wire transfer",
  "invoice", "refund", "password", "credentials", "act now",
];
const URGENCY_PATTERN = new RegExp(`(?<!\\p{L})(${URGENCY.join("|")})(?!\\p{L})`, "giu");

const SCORE_CAP = 100;
const SUSPICIOUS_AT = 30;
const HIGH_AT = 45;

export function parseAuthResults(header: string | null): AuthResults | null {
  if (!header) return null;
  const pick = (name: string): string | null => header.match(new RegExp(`\\b${name}=([a-z]+)`, "i"))?.[1]?.toLowerCase() ?? null;
  return { spf: pick("spf"), dkim: pick("dkim"), dmarc: pick("dmarc") };
}

function registrable(host: string): string {
  const lower = host.toLowerCase();
  return getDomain(lower) ?? lower;
}

function emailDomain(address: string | null): string | null {
  const at = address?.lastIndexOf("@") ?? -1;
  return address && at >= 0 ? registrable(address.slice(at + 1)) : null;
}

function isOfficial(domain: string, brand: Brand): boolean {
  return brand.domains.some((official) => domain === official || domain.endsWith(`.${official}`));
}

function labelOf(domain: string): string {
  return domain.split(".")[0] ?? domain;
}

function looksLikeBrand(domain: string, brand: Brand): boolean {
  const label = labelOf(domain);
  return brand.token.length >= 5 ? label.includes(brand.token) : label.split("-").includes(brand.token);
}

function hasMixedScript(domain: string): boolean {
  return domainToUnicode(domain)
    .split(".")
    .some((label) => /[a-z]/i.test(label) && /[Ͱ-ϿЀ-ӿ]/.test(label));
}

function extractLinks(html: string | null, text: string): Array<{ href: string; label: string | null }> {
  const links: Array<{ href: string; label: string | null }> = [];
  for (const match of html?.matchAll(/<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi) ?? []) {
    links.push({ href: match[1] ?? "", label: (match[2] ?? "").replace(/<[^>]+>/g, "").trim() });
  }
  for (const match of text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) links.push({ href: match[0], label: null });
  return links;
}

export function assessMessage(input: AssessInput): Risk {
  if (input.senderStatus === "blocked") {
    return { level: "high", score: SCORE_CAP, reasons: ["Du hast diesen Absender als Phishing gemeldet."] };
  }
  const reasons: string[] = [];
  let score = 0;
  let anchor = false;
  const add = (points: number, reason: string, isAnchor = false): void => {
    score += points;
    anchor ||= isAnchor;
    reasons.push(reason);
  };

  const fromDomain = emailDomain(input.fromEmail) ?? "";

  const brand = BRANDS.find((candidate) => candidate.name.test(input.fromName ?? ""));
  const lookalike = BRANDS.find((candidate) => !isOfficial(fromDomain, candidate) && looksLikeBrand(fromDomain, candidate));
  if (brand && !isOfficial(fromDomain, brand)) {
    add(40, `Anzeigename nennt „${brand.label}“, die Absenderdomain ${fromDomain} gehört aber nicht dazu.`, true);
  } else if (lookalike) {
    add(40, `Absenderdomain ${fromDomain} ahmt „${lookalike.label}“ nach, ist aber nicht dessen Domain.`, true);
  }
  if (hasMixedScript(fromDomain)) {
    add(40, `Absenderdomain ${fromDomain} mischt lateinische und fremde Buchstaben (Verwechslungsgefahr).`, true);
  }
  const nameAddress = (input.fromName ?? "").match(/[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/)?.[0];
  if (nameAddress && nameAddress.toLowerCase() !== input.fromEmail.toLowerCase()) {
    add(30, `Anzeigename enthält die Adresse ${nameAddress}, gesendet wurde aber von ${input.fromEmail}.`, true);
  }

  const replyDomain = emailDomain(input.replyTo);
  if (replyDomain && replyDomain !== fromDomain) add(15, `Antworten gehen an eine andere Domain (${replyDomain}).`);
  const pathDomain = emailDomain(input.returnPath);
  if (pathDomain && pathDomain !== fromDomain) add(15, `Absender-Rückweg (Return-Path) nutzt eine andere Domain (${pathDomain}).`);

  if (input.auth?.dkim === "fail" || input.auth?.dmarc === "fail") {
    add(20, "Die Absenderprüfung (DKIM/DMARC) ist fehlgeschlagen.");
  }

  const noted = new Set<string>();
  for (const { href, label } of extractLinks(input.html, input.text)) {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      continue;
    }
    const host = url.hostname.toLowerCase();
    const hostDomain = registrable(host);
    const note = (key: string): boolean => !noted.has(key) && noted.add(key) !== undefined;

    const redirector = REDIRECTOR_HOSTS.has(host) || REDIRECTOR_HOSTS.has(hostDomain)
      || (/^google\./.test(labelOf(hostDomain) + ".") && GOOGLE_REDIRECT_PATHS.test(url.pathname));
    if (redirector && note(`redirect:${host}`)) add(15, `Link läuft über einen Weiterleitungsdienst (${host}), das echte Ziel ist verborgen.`);

    if ((parse(host).isIp || url.username !== "") && note(`ip:${host}`)) {
      add(30, `Link zeigt auf eine IP-Adresse oder enthält Zugangsdaten statt eines Domainnamens (${host}).`, true);
    }

    const shown = label?.match(/^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/:?#]|$)/i)?.[1];
    // Text naming the sender's own domain is the usual ESP click-tracking pattern, not impersonation.
    if (shown && registrable(shown) !== hostDomain && registrable(shown) !== fromDomain && note(`mismatch:${shown}:${host}`)) {
      add(30, `Linktext nennt ${shown}, der Link führt aber zu ${hostDomain}.`, true);
    }
  }

  if (/<form\b|type\s*=\s*["']?password/i.test(input.html ?? "")) add(30, "Die Mail enthält ein Formular zur Dateneingabe.");

  const hits = new Set([...`${input.subject}\n${input.text.slice(0, 5000)}`.matchAll(URGENCY_PATTERN)].map((m) => m[1]!.toLowerCase()));
  if (hits.size > 0) add(Math.min(20, hits.size * 5), `Druck-/Betrugsvokabular: ${[...hits].slice(0, 6).join(", ")}.`);

  score = Math.min(SCORE_CAP, score);
  if (input.senderStatus === "trusted") {
    // Trust is for the real sender: a failed DKIM/DMARC check may mean someone forged the trusted address.
    // SPF alone is ignored because forwarding often breaks it.
    if (input.auth?.dkim !== "fail" && input.auth?.dmarc !== "fail") return { level: "none", score: 0, reasons: [] };
    return {
      level: "high",
      score: Math.max(score, HIGH_AT),
      reasons: [...reasons, "Vertrauter Absender, aber die Absenderprüfung ist fehlgeschlagen (mögliche Fälschung)."],
    };
  }
  const level = !anchor || score < SUSPICIOUS_AT ? "none" : score >= HIGH_AT ? "high" : "suspicious";
  return { level, score, reasons };
}
