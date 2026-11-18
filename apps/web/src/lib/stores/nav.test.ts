import { describe, expect, it, vi } from "vitest";
import { NavStore, modeItem, subItem } from "./nav";

describe("NavStore", () => {
  it("starts on Clock · Today", () => {
    const nav = new NavStore();
    expect(nav.state).toEqual({ mode: "clock", sub: "today" });
    expect(modeItem(nav.state).label).toBe("Clock");
    expect(subItem(nav.state).label).toBe("Today");
  });

  it("switching mode lands on that mode's default sub-tab", () => {
    const nav = new NavStore();
    nav.go("compass");
    expect(nav.state).toEqual({ mode: "compass", sub: "goals" });
    nav.go("almanac", "season");
    expect(nav.state).toEqual({ mode: "almanac", sub: "season" });
  });

  it("notifies subscribers with a fresh snapshot, and stops after unsubscribe", () => {
    const nav = new NavStore();
    const listener = vi.fn();
    const unsubscribe = nav.subscribe(listener);
    const before = nav.getSnapshot();
    nav.goSub("week");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(nav.getSnapshot()).not.toBe(before);
    unsubscribe();
    nav.goSub("today");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("follows ?go= deep links and ignores unknown modes", () => {
    const nav = new NavStore();
    nav.navigateTo("/?go=compass.people", "http://localhost");
    expect(nav.state).toEqual({ mode: "compass", sub: "people" });
    nav.navigateTo("/?go=nowhere.x", "http://localhost");
    expect(nav.state).toEqual({ mode: "compass", sub: "people" });
    nav.navigateTo("/", "http://localhost");
    expect(nav.state).toEqual({ mode: "compass", sub: "people" });
  });

  it("falls back to the mode's first sub-tab for an unknown sub", () => {
    const nav = new NavStore();
    nav.navigateTo("/?go=clock.bogus", "http://localhost");
    expect(subItem(nav.state).id).toBe("today");
  });
});
