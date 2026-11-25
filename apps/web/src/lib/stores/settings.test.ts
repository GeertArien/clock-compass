import { describe, expect, it } from "vitest";
import { HistoryLayers, type HistoryLike } from "../history-layers";
import { SettingsStore, sectionForMessage, sectionFromSearch, stepSection } from "./settings";

/** A browser-like history stack (as in history-layers.test.ts). */
class FakeHistory implements HistoryLike {
  entries: unknown[] = [{ key: "home" }];
  index = 0;
  onPop: () => void = () => {};
  get state(): unknown {
    return this.entries[this.index];
  }
  pushState(state: unknown): void {
    this.entries = [...this.entries.slice(0, this.index + 1), state];
    this.index += 1;
  }
  go(delta: number): void {
    const next = Math.min(Math.max(this.index + delta, 0), this.entries.length - 1);
    if (next === this.index) return;
    this.index = next;
    this.onPop();
  }
}

/**
 * Settings on a phone as the sheet wires it: the sheet is one history layer,
 * an open section one more (useHistoryLayer on each), and closing goes
 * through requestClose.
 */
function phone() {
  const history = new FakeHistory();
  const queue: (() => void)[] = [];
  const layers = new HistoryLayers(history, "p", (fn) => queue.push(fn));
  history.onPop = () => layers.onPopState();
  const store = new SettingsStore();
  let sheetLayer: number | null = null;
  let sectionLayer: number | null = null;
  /** What the hooks do on every render: a layer per open thing. */
  const sync = () => {
    const { open, section } = store.state;
    if (open && sheetLayer === null) sheetLayer = layers.open(() => store.requestClose());
    if (!open && sheetLayer !== null) {
      layers.closed(sheetLayer);
      sheetLayer = null;
    }
    const sectionOpen = open && section !== null;
    if (sectionOpen && sectionLayer === null) sectionLayer = layers.open(() => store.show(null));
    if (!sectionOpen && sectionLayer !== null) {
      layers.closed(sectionLayer);
      sectionLayer = null;
    }
    while (queue.length) queue.shift()!();
  };
  store.subscribe(sync);
  const back = () => {
    history.go(-1);
    // A layer closed by back is gone from the stack; the hook's id goes with it.
    if (!store.state.open) sheetLayer = null;
    if (store.state.section === null) sectionLayer = null;
    sync();
  };
  return { history, store, back };
}

describe("Settings in sections (#141)", () => {
  it("on a phone: the list, a section, back to the list, back closes Settings, on the same screen", () => {
    const { history, store, back } = phone();
    store.openSettings();
    expect(store.state).toMatchObject({ open: true, section: null });
    store.show("ai");
    expect(history.entries).toHaveLength(3);
    back();
    expect(store.state).toMatchObject({ open: true, section: null });
    back();
    expect(store.state.open).toBe(false);
    expect(history.index).toBe(0);
  });

  it("openSettings(\"ai\") opens straight on the section; back goes to the list, not out", () => {
    const { store, back } = phone();
    store.openSettings("ai");
    expect(store.state).toMatchObject({ open: true, section: "ai" });
    back();
    expect(store.state).toMatchObject({ open: true, section: null });
  });

  it("asks before closing only when a form holds typing", () => {
    const store = new SettingsStore();
    store.openSettings("connection");
    expect(store.requestClose()).toBe("closed");
    store.openSettings("connection");
    store.setDirty("token", true);
    expect(store.requestClose()).toBe("ask");
    expect(store.state.open).toBe(true);
    // Typing undone: nothing to lose.
    store.setDirty("token", false);
    expect(store.requestClose()).toBe("closed");
    // A new open starts clean.
    store.setDirty("provider", true);
    store.openSettings();
    expect(store.hasUnsaved).toBe(false);
  });

  it("a link pressed while Settings is open goes to the section and keeps what is typed", () => {
    const store = new SettingsStore();
    store.openSettings("agents");
    const { key } = store.state;
    store.setDirty("key", true);
    store.openSettings("connection");
    // No new key: the sheet is not remounted, so the draft stays.
    expect(store.state).toMatchObject({ open: true, section: "connection", key });
    expect(store.hasUnsaved).toBe(true);
    // With no section named, it stays where it is.
    store.openSettings();
    expect(store.state.section).toBe("connection");
  });

  it("the address opens a section: ?settings=ai, ?settings for the list, nothing otherwise", () => {
    expect(sectionFromSearch("?settings=ai")).toBe("ai");
    expect(sectionFromSearch("?settings")).toBeNull();
    expect(sectionFromSearch("?settings=nope")).toBeNull();
    expect(sectionFromSearch("?x=1")).toBeUndefined();
  });

  it("a notice that names Settings → AI opens AI; a refused token opens Connection", () => {
    expect(sectionForMessage("Task classification is off because tasks are not shared with AI (Settings → AI).")).toBe("ai");
    expect(sectionForMessage("The server did not accept the API token. Check it in Settings.")).toBe("connection");
    expect(sectionForMessage("Unauthorized")).toBe("connection");
    expect(sectionForMessage("Capture failed")).toBeNull();
  });

  it("the list's arrow keys wrap around", () => {
    expect(stepSection("general", -1)).toBe("data");
    expect(stepSection("data", 1)).toBe("general");
    expect(stepSection("ai", 1)).toBe("agents");
  });
});
