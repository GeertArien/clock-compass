import { useSyncExternalStore } from "react";

/**
 * A framework-free singleton store: immutable state plus subscribe/notify.
 *
 * Stores hold source data only; derived values (quadrant, progress, momentum…)
 * are computed from the snapshot, never stored. Components read a store with
 * {@link useStore} (React's `useSyncExternalStore`); tests use the class
 * directly with no React involved.
 */
export class Store<S extends object> {
  #state: S;
  readonly #listeners = new Set<() => void>();

  constructor(initial: S) {
    this.#state = initial;
  }

  /** The current immutable snapshot. */
  get state(): S {
    return this.#state;
  }

  /** Replace part of the state and notify subscribers. */
  protected setState(patch: Partial<S>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getSnapshot = (): S => this.#state;
}

/**
 * Subscribe a component to a store.
 *
 * Without a selector the component re-renders on any change to the store. With
 * one it re-renders only when the selected value changes (by `Object.is`), so a
 * card can watch its own task instead of the whole list. The selector must
 * return a stable reference when nothing relevant changed — a primitive or an
 * object taken from the state, never a freshly built object or array —
 * otherwise React sees a new value on every read and re-renders in a loop.
 */
export function useStore<S extends object>(store: Store<S>): S;
export function useStore<S extends object, T>(store: Store<S>, selector: (state: S) => T): T;
export function useStore<S extends object, T>(
  store: Store<S>,
  selector?: (state: S) => T,
): S | T {
  const read: () => S | T = selector ? () => selector(store.getSnapshot()) : store.getSnapshot;
  return useSyncExternalStore(store.subscribe, read, read);
}
