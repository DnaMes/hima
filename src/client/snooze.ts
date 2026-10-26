export type SnoozedMessage = { account: string; mailbox: string; message: string; until: string; subject?: string };

export const snoozeKey = (ref: { account: string; mailbox: string; message: string }): string =>
  JSON.stringify([ref.account, ref.mailbox, ref.message]);

export type WakeOption = { id: string; label: string; until: Date };

function at(base: Date, days: number, hour: number): Date {
  const date = new Date(base);
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date;
}

/** Wake-up choices relative to `now` (local time); only times in the future are offered. */
export function wakeOptions(now: Date): WakeOption[] {
  const untilMonday = ((8 - now.getDay()) % 7) || 7;
  const options: WakeOption[] = [
    { id: "3h", label: "In 3 Stunden", until: new Date(now.getTime() + 3 * 3_600_000) },
    { id: "evening", label: "Heute Abend (18:00)", until: at(now, 0, 18) },
    { id: "tomorrow", label: "Morgen früh (8:00)", until: at(now, 1, 8) },
    { id: "monday", label: "Nächsten Montag (8:00)", until: at(now, untilMonday, 8) },
  ];
  return options.filter((option) => option.until.getTime() > now.getTime());
}

export function formatWake(until: string): string {
  return new Date(until).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
