import { describe, expect, it, vi } from "vitest";
import { HistoryLayers, type HistoryLike } from "./history-layers";

/** A browser-like history stack: entries, a position, and popstate on go(). */
class FakeHistory implements HistoryLike {
  entries: unknown[] = [{ idx: 0, key: "home" }];
  index = 0;
  onPop: () => void = () => {};
  get state(): unknown {
    return this.entries[this.index];
  }
  /** What a screen navigation (React Router's push) does. */
  navigate(key: string): void {
    this.pushState({ idx: this.index + 1, key }, "");
  }
  pushState(state: unknown, _unused = ""): void {
    this.entries = [...this.entries.slice(0, this.index + 1), state];
    this.index += 1;
  }
  go(delta: number): void {
    const next = Math.min(Math.max(this.index + delta, 0), this.entries.length - 1);
    if (next === this.index) return;
    this.index = next;
    this.onPop();
  }
  back(): void {
    this.go(-1);
  }
  forward(): void {
    this.go(1);
  }
  /** The router's key of the current entry (the screen). */
  get key(): string {
    return (this.state as { key: string }).key;
  }
}

function setup(page = "p1") {
  const history = new FakeHistory();
  const queue: (() => void)[] = [];
  const layers = new HistoryLayers(history, page, (fn) => queue.push(fn));
  history.onPop = () => layers.onPopState();
  const flush = () => {
    while (queue.length) queue.shift()!();
  };
  /** A sheet whose own "close" (back or controls) reports back like the hook. */
  const sheet = () => {
    const close = vi.fn();
    const id = layers.open(close);
    return { id, close, closedByControls: () => layers.closed(id) };
  };
  return { history, layers, flush, sheet };
}

describe("history layers: back closes what's open", () => {
  it("opening pushes one entry on the same screen; back closes it and stays", () => {
    const { history, layers, sheet } = setup();
    history.navigate("goals");
    const s = sheet();
    expect(history.entries).toHaveLength(3);
    expect(history.key).toBe("goals"); // same screen, router's state kept
    history.back();
    expect(s.close).toHaveBeenCalledTimes(1);
    expect(history.key).toBe("goals");
    expect(layers.openCount).toBe(0);
    history.back(); // the second back navigates as usual
    expect(history.key).toBe("home");
  });

  it("closing with its own controls leaves no entry for back to swallow", () => {
    const { history, flush, sheet } = setup();
    history.navigate("goals");
    const s = sheet();
    s.closedByControls();
    flush();
    expect(history.index).toBe(1);
    expect(history.key).toBe("goals");
    expect(s.close).not.toHaveBeenCalled(); // already closed by its controls
    history.back();
    expect(history.key).toBe("home");
  });

  it("a dialog over a sheet takes one back each", () => {
    const { history, layers, sheet } = setup();
    const s = sheet();
    const d = sheet();
    history.back();
    expect(d.close).toHaveBeenCalledTimes(1);
    expect(s.close).not.toHaveBeenCalled();
    history.back();
    expect(s.close).toHaveBeenCalledTimes(1);
    expect(layers.openCount).toBe(0);
    expect(history.index).toBe(0);
  });

  it("a dialog and its sheet closing together step back once, past both", () => {
    const { history, flush, sheet } = setup();
    history.navigate("goals");
    const s = sheet();
    const d = sheet();
    d.closedByControls();
    s.closedByControls();
    flush();
    expect(history.index).toBe(1);
    expect(history.key).toBe("goals");
  });

  it("a layer closing under one still open is stepped off when that one closes", () => {
    const { history, flush, sheet } = setup();
    const s = sheet();
    const d = sheet();
    s.closedByControls();
    flush();
    expect(history.index).toBe(2); // the dialog's entry is still current
    d.closedByControls();
    flush();
    expect(history.index).toBe(0);
  });

  it("back from the first entry of a session closes the sheet instead of leaving", () => {
    const { history, sheet } = setup();
    const capture = sheet();
    history.back();
    expect(capture.close).toHaveBeenCalledTimes(1);
    expect(history.index).toBe(0); // still in the app
  });

  it("forward onto a closed layer's entry steps back off it", () => {
    const { history, flush, sheet } = setup();
    history.navigate("goals");
    const s = sheet();
    s.closedByControls();
    flush();
    history.forward(); // onto the stale entry
    expect(history.index).toBe(1);
    expect(s.close).not.toHaveBeenCalled();
    history.back();
    expect(history.key).toBe("home"); // back still navigates
  });

  it("after a reload with a sheet open, start() steps off its entry (and a stacked one)", () => {
    const before = setup("before-reload");
    before.history.navigate("goals");
    before.sheet();
    before.sheet();
    // Reload: same history, a new page load with no layers open.
    const history = before.history;
    const layers = new HistoryLayers(history, "after-reload", (fn) => fn());
    history.onPop = () => layers.onPopState();
    layers.start();
    expect(history.index).toBe(1);
    expect(history.key).toBe("goals");
    history.back();
    expect(history.key).toBe("home");
  });

  it("a marker from another page load never matches a layer opened now", () => {
    const { history, sheet } = setup("now");
    history.pushState({ idx: 0, key: "home", ccLayer: { page: "earlier", id: 1 } });
    const s = sheet(); // id 1 too, but this page's
    history.back(); // onto the old page's marker: not s's entry
    expect(s.close).toHaveBeenCalledTimes(1);
    expect(history.index).toBe(0); // and stepped off the stale entry
  });

  it("navigating to another screen with nothing open is untouched", () => {
    const { history, layers } = setup();
    history.navigate("goals");
    history.navigate("people");
    history.back();
    expect(history.key).toBe("goals");
    expect(layers.openCount).toBe(0);
  });
});
