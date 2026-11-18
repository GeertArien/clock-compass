/**
 * Back closes what's open. Every open sheet or dialog is a "layer" with its
 * own history entry: the same URL and the router's own state (so React Router
 * sees a no-op when it's popped), plus a marker naming the layer. Back pops
 * that entry and closes the layer instead of leaving the screen; closing a
 * layer with its own controls steps back off its entry, so no stray entry is
 * left for the next back to swallow.
 *
 * Framework-free and driven through a small history interface, so the rules
 * are tested without a browser (history-layers.test.ts). The React side is
 * useHistoryLayer in use-history-layer.ts.
 */

export interface HistoryLike {
  readonly state: unknown;
  pushState(state: unknown, unused: string): void;
  go(delta: number): void;
}

const MARK = "ccLayer";

interface Marker {
  /** The page load that pushed the entry: markers from before a reload never match. */
  page: string;
  id: number;
}

interface Layer {
  id: number;
  close: () => void;
  /** Closed by its own controls; its entry is waiting to be stepped off. */
  closed: boolean;
}

export class HistoryLayers {
  readonly #history: HistoryLike;
  readonly #page: string;
  readonly #defer: (fn: () => void) => void;
  /** Open layers with an entry in history, oldest first. */
  #layers: Layer[] = [];
  #seq = 0;
  /** Popstates caused by our own steps back: not the user's back. */
  #ownSteps = 0;
  #flushQueued = false;

  constructor(
    history: HistoryLike,
    page = Math.random().toString(36).slice(2),
    // Wrapped: queueMicrotask called as a method of this class throws
    // "Illegal invocation" (it needs the window as its receiver).
    defer: (fn: () => void) => void = (fn) => queueMicrotask(fn),
  ) {
    this.#history = history;
    this.#page = page;
    this.#defer = defer;
  }

  /** Number of layers currently open (for tests and debugging). */
  get openCount(): number {
    return this.#layers.filter((l) => !l.closed).length;
  }

  #marker(): Marker | null {
    const state = this.#history.state as Record<string, unknown> | null;
    const mark = state?.[MARK] as Marker | undefined;
    return mark && typeof mark.id === "number" ? mark : null;
  }

  #step(delta: number): void {
    this.#ownSteps += 1;
    this.#history.go(delta);
  }

  /** A layer opened: push its entry. Returns the id to pass to closed(). */
  open(close: () => void): number {
    const id = ++this.#seq;
    const state = (this.#history.state as Record<string, unknown> | null) ?? {};
    this.#history.pushState({ ...state, [MARK]: { page: this.#page, id } }, "");
    this.#layers.push({ id, close, closed: false });
    return id;
  }

  /**
   * A layer closed by its own controls (or unmounted). Its entry is stepped
   * off once every layer above it has closed too, in one step for all of them
   * (a dialog and its sheet closing together go back two entries at once).
   */
  closed(id: number): void {
    const layer = this.#layers.find((l) => l.id === id);
    if (!layer || layer.closed) return; // already closed by back
    layer.closed = true;
    if (this.#flushQueued) return;
    this.#flushQueued = true;
    this.#defer(() => {
      this.#flushQueued = false;
      let n = 0;
      while (this.#layers.length > 0 && this.#layers[this.#layers.length - 1]!.closed) {
        this.#layers.pop();
        n += 1;
      }
      if (n > 0) this.#step(-n);
    });
  }

  /** The browser moved through history (back, forward, or our own step). */
  onPopState(): void {
    const own = this.#ownSteps > 0;
    if (own) this.#ownSteps -= 1;
    const mark = this.#marker();
    const here = mark?.page === this.#page ? this.#layers.findIndex((l) => l.id === mark.id) : -1;
    if (!own) {
      // The user went back: close every open layer above the entry now current.
      const above = this.#layers.slice(here + 1).reverse();
      this.#layers = this.#layers.slice(0, here + 1);
      for (const layer of above) if (!layer.closed) layer.close();
    }
    // Landed on a layer entry with no open layer behind it (forward onto a
    // closed sheet, or a sheet open before a reload): step back off it.
    if (mark && (here === -1 || this.#layers[here]!.closed)) this.#step(-1);
  }

  /** On start: an entry left by a sheet that was open before a reload. */
  start(): void {
    if (this.#marker()) this.#step(-1);
  }
}
