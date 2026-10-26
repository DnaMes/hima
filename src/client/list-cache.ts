import type { Envelope, UnifiedWarning } from "../shared/types.js";

export type CachedList = { envelopes: Envelope[]; warnings: UnifiedWarning[]; hasMore: boolean };

const MAX_LISTS = 40;

/** In-memory stale-while-revalidate store: a hit is shown at once and always refreshed afterwards. */
export class ListCache {
  private readonly lists = new Map<string, CachedList>();

  get(key: string): CachedList | undefined {
    return this.lists.get(key);
  }

  set(key: string, value: CachedList): void {
    this.lists.delete(key);
    this.lists.set(key, value);
    if (this.lists.size > MAX_LISTS) this.lists.delete(this.lists.keys().next().value as string);
  }

  /** Every remembered envelope, for building the recipient suggestions. */
  envelopes(): Envelope[] {
    return [...this.lists.values()].flatMap((list) => list.envelopes);
  }

  clear(): void {
    this.lists.clear();
  }
}
