/**
 * Targeted rollback for optimistic updates, shared by both web apps.
 *
 * Restoring a snapshot of the whole list taken before an edit also undoes any
 * other edit that landed while the failed request was in flight, although the
 * server saved it. These helpers undo only what the failed call changed.
 */

interface Identified {
  id: string;
}

/** The current values of the fields an optimistic patch is about to change. */
export function fieldsBefore<T extends object>(item: T | undefined, patch: Partial<T>): Partial<T> {
  if (!item) return {};
  const before: Partial<T> = {};
  for (const key of Object.keys(patch) as (keyof T)[]) before[key] = item[key];
  return before;
}

/**
 * Undo an optimistic patch on one item: each patched field goes back to its
 * earlier value, but only while it still holds the patched value — a later
 * edit to the same field wins.
 */
export function revertPatch<T extends Identified>(
  list: T[],
  id: string,
  patch: Partial<T>,
  before: Partial<T>,
): T[] {
  return list.map((item) => {
    if (item.id !== id) return item;
    let changed = false;
    const next = { ...item };
    for (const key of Object.keys(patch) as (keyof T)[]) {
      if (Object.is(item[key], patch[key]) && key in before) {
        next[key] = before[key] as T[keyof T];
        changed = true;
      }
    }
    return changed ? next : item;
  });
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

/** Undo one key of an optimistic record update, unless it changed again since. */
export function revertKey<K extends string, V>(
  record: Partial<Record<K, V>>,
  key: K,
  patched: V | undefined,
  before: V | undefined,
): Partial<Record<K, V>> {
  return Object.is(record[key], patched) ? { ...record, [key]: before } : record;
}
