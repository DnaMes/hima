export type DraftFields = {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  attachmentNames: string[];
};

export function composeDraftId(seed: {
  mode: string;
  account: string;
  sourceDetail?: { ref: { account: string; mailbox: string; message: string } };
}): string {
  if (seed.sourceDetail?.ref) {
    const { account, mailbox, message } = seed.sourceDetail.ref;
    return `${seed.mode}-${account}-${mailbox}-${message}`;
  }
  return `${seed.mode}-${seed.account}`;
}

export function draftStorageKey(composeId: string): string {
  return `himalaya-web-draft-${composeId}`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function readDraft(storage: Pick<Storage, "getItem">, composeId: string): DraftFields | null {
  try {
    const raw = storage.getItem(draftStorageKey(composeId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as Record<string, unknown>;
    if (
      !isStringArray(candidate.to) || !isStringArray(candidate.cc) || !isStringArray(candidate.bcc) ||
      typeof candidate.subject !== "string" || typeof candidate.body !== "string" ||
      !isStringArray(candidate.attachmentNames)
    ) return null;
    return {
      to: candidate.to, cc: candidate.cc, bcc: candidate.bcc,
      subject: candidate.subject, body: candidate.body, attachmentNames: candidate.attachmentNames,
    };
  } catch {
    return null;
  }
}

export function writeDraft(storage: Pick<Storage, "setItem">, composeId: string, fields: DraftFields): void {
  try {
    storage.setItem(draftStorageKey(composeId), JSON.stringify(fields));
  } catch {
    // Browser storage can be unavailable or full; the composer keeps the current state in memory.
  }
}

export function clearDraft(storage: Pick<Storage, "removeItem">, composeId: string): void {
  try {
    storage.removeItem(draftStorageKey(composeId));
  } catch {
    // Best-effort cleanup only.
  }
}
