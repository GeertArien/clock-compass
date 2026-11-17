/**
 * Rollback for optimistic updates, shared by both web apps.
 *
 * Restoring a snapshot of the whole list taken before an edit also undoes any
 * other edit that landed while the failed request was in flight, although the
 * server saved it. These helpers undo only what the failed call changed.
 */

interface Identified {
  id: string;
}

interface Patch<T> {
  ticket: number;
  patch: Partial<T>;
}

/**
 * In-flight optimistic edits, per item. For each item with requests pending it
 * keeps the last server-confirmed version and the patches still in flight, in
 * the order they were sent. What the screen shows is always the confirmed
 * version with those patches applied, then `derive` (for values that are
 * computed, never stored, such as a task's quadrant). A success replaces the
 * confirmed version with the server's answer and drops its patch; a failure
 * just drops its patch. Either way the shown item is recomputed, so the result
 * is the same whatever order the requests settle or fail in.
 *
 * Responses can also arrive out of order. A success only replaces the confirmed
 * version when its request was sent after the one that produced it; an older
 * response just drops its patch. This assumes the server applies requests in
 * the order they were sent, which is the case for this app's single client.
 */
export class OptimisticEdits<T extends Identified> {
  readonly #derive: (item: T) => T;
  readonly #confirmed = new Map<string, T>();
  /** The ticket whose response set the confirmed version (0: none yet). */
  readonly #confirmedBy = new Map<string, number>();
  readonly #pending = new Map<string, Patch<T>[]>();
  #seq = 0;

  constructor(derive: (item: T) => T = (item) => item) {
    this.#derive = derive;
  }

  /**
   * Forget every pending edit, for when the whole list has just been reloaded
   * from the server: that is now the confirmed state. A request still in flight
   * then settles harmlessly — a success shows the server's answer, a failure
   * changes nothing.
   */
  reset(): void {
    this.#confirmed.clear();
    this.#confirmedBy.clear();
    this.#pending.clear();
  }

  /** Start an edit on `current` (the item as shown now); returns what to show. */
  apply(current: T, patch: Partial<T>): { item: T; ticket: number } {
    const queue = this.#pending.get(current.id) ?? [];
    // With nothing in flight, what is shown is what the server last confirmed.
    if (queue.length === 0) {
      this.#confirmed.set(current.id, current);
      this.#confirmedBy.set(current.id, 0);
    }
    const ticket = ++this.#seq;
    this.#pending.set(current.id, [...queue, { ticket, patch }]);
    return { item: this.#view(current.id)!, ticket };
  }

  /** The request succeeded and the server returned `server`; returns what to show. */
  succeed(id: string, ticket: number, server: T): T {
    // A response to an older request than the one already confirmed is stale.
    if (ticket > (this.#confirmedBy.get(id) ?? 0)) {
      this.#confirmed.set(id, server);
      this.#confirmedBy.set(id, ticket);
    }
    return this.#settle(id, ticket) ?? server;
  }

  /** The request failed; returns what to show, or undefined for an unknown item. */
  fail(id: string, ticket: number): T | undefined {
    return this.#settle(id, ticket);
  }

  #settle(id: string, ticket: number): T | undefined {
    const queue = (this.#pending.get(id) ?? []).filter((p) => p.ticket !== ticket);
    this.#pending.set(id, queue);
    const item = this.#view(id);
    if (queue.length === 0) {
      this.#pending.delete(id);
      this.#confirmed.delete(id);
      this.#confirmedBy.delete(id);
    }
    return item;
  }

  #view(id: string): T | undefined {
    const base = this.#confirmed.get(id);
    if (!base) return undefined;
    const patched = (this.#pending.get(id) ?? []).reduce<T>(
      (item, p) => ({ ...item, ...p.patch }),
      base,
    );
    return this.#derive(patched);
  }
}

/** Replace one item in a list by id (no-op if it is gone). */
export function replaceById<T extends Identified>(list: T[], item: T): T[] {
  return list.map((x) => (x.id === item.id ? item : x));
}

/** Drop one item (a failed create's placeholder). */
export function withoutId<T extends Identified>(list: T[], id: string): T[] {
  return list.filter((item) => item.id !== id);
}

/** Put a removed item back where it was, unless it is already there again. */
export function restoreAt<T extends Identified>(list: T[], item: T, index: number): T[] {
  if (list.some((x) => x.id === item.id)) return list;
  const next = [...list];
  next.splice(Math.min(Math.max(index, 0), next.length), 0, item);
  return next;
}
