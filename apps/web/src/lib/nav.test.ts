import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUB,
  HOME_PATH,
  MODES,
  SUBS,
  appPathFor,
  goToPath,
  modeItem,
  pathFor,
  resolvePath,
  subItem,
  titleFor,
  type Mode,
} from "./nav";

const ORIGIN = "http://localhost";

describe("route resolution", () => {
  it("gives every screen its own path, and resolves it back to that screen", () => {
    for (const mode of MODES.map((m) => m.id)) {
      for (const { id: sub } of SUBS[mode]) {
        const path = pathFor(mode, sub);
        expect(path).toBe(`/${mode}/${sub}`);
        expect(resolvePath(path)).toEqual({ screen: { mode, sub } });
      }
    }
  });

  it("sends / home to Clock · Today", () => {
    expect(HOME_PATH).toBe("/clock/today");
    expect(resolvePath("/")).toEqual({ redirect: "/clock/today" });
    const home = resolvePath(HOME_PATH);
    expect(home).toEqual({ screen: { mode: "clock", sub: "today" } });
    if ("screen" in home) {
      expect(modeItem(home.screen).label).toBe("Clock");
      expect(subItem(home.screen).label).toBe("Today");
    }
  });

  it("opens a bare mode on that mode's default sub-tab", () => {
    expect(resolvePath("/compass")).toEqual({ redirect: "/compass/goals" });
    expect(resolvePath("/clock")).toEqual({ redirect: "/clock/today" });
    expect(resolvePath("/almanac/")).toEqual({ redirect: "/almanac/review" });
    for (const mode of Object.keys(DEFAULT_SUB) as Mode[]) {
      expect(pathFor(mode)).toBe(`/${mode}/${DEFAULT_SUB[mode]}`);
    }
  });

  it("redirects an unknown sub-tab to the mode's default, and an unknown mode home", () => {
    expect(resolvePath("/compass/bogus")).toEqual({ redirect: "/compass/goals" });
    // A real sub-tab of another mode is still unknown here.
    expect(resolvePath("/clock/people")).toEqual({ redirect: "/clock/today" });
    expect(resolvePath("/nowhere/today")).toEqual({ redirect: "/clock/today" });
    expect(resolvePath("/index.html")).toEqual({ redirect: "/clock/today" });
  });

  it("redirects a trailing slash or extra segments to the canonical path", () => {
    expect(resolvePath("/compass/people/extra")).toEqual({ redirect: "/compass/people" });
    expect(resolvePath("/compass/people/")).toEqual({ redirect: "/compass/people" });
    expect(resolvePath("/clock/week/")).toEqual({ redirect: "/clock/week" });
    expect(resolvePath("//clock//week")).toEqual({ redirect: "/clock/week" });
  });
});

describe("?go= notification links", () => {
  // The URLs packages/core/src/domain/notifications.ts sends (and that
  // notifications already delivered carry).
  it.each([
    ["/?go=compass.people", "/compass/people"],
    ["/?go=clock.today", "/clock/today"],
    ["/?go=almanac.review", "/almanac/review"],
  ])("%s redirects to %s", (url, path) => {
    const parsed = new URL(url, ORIGIN);
    expect(resolvePath(parsed.pathname, parsed.search)).toEqual({ redirect: path });
    expect(appPathFor(url, ORIGIN)).toBe(path);
  });

  it("opens the mode's default for a bare mode or unknown sub-tab", () => {
    expect(goToPath("compass")).toBe("/compass/goals");
    expect(goToPath("clock.bogus")).toBe("/clock/today");
    expect(resolvePath("/", "?go=almanac.nope")).toEqual({ redirect: "/almanac/review" });
  });

  it("goes home for an unknown or empty mode, wherever the link points", () => {
    expect(goToPath("nowhere.x")).toBeNull();
    expect(resolvePath("/", "?go=nowhere.x")).toEqual({ redirect: "/clock/today" });
    expect(resolvePath("/compass/people", "?go=")).toEqual({ redirect: "/clock/today" });
    expect(appPathFor("/?go=nowhere", ORIGIN)).toBe("/clock/today");
  });

  it("keeps any other URL's own path for the router", () => {
    expect(appPathFor("/compass/people", ORIGIN)).toBe("/compass/people");
    expect(appPathFor(`${ORIGIN}/almanac/season?x=1`, ORIGIN)).toBe("/almanac/season?x=1");
    expect(appPathFor("/", ORIGIN)).toBe("/");
  });
});

describe("screen titles", () => {
  it("names the screen in the tab title", () => {
    expect(titleFor({ mode: "clock", sub: "today" })).toBe("Today · Clock & Compass");
    expect(titleFor({ mode: "compass", sub: "goals" })).toBe("Mission & Goals · Clock & Compass");
    expect(titleFor({ mode: "almanac", sub: "season" })).toBe("The Season · Clock & Compass");
  });
});
