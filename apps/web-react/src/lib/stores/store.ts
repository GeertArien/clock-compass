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

/** Subscribe a component to a store; re-renders when its state changes. */
export function useStore<S extends object>(store: Store<S>): S {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
