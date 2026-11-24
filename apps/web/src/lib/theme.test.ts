import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHOICE,
  THEME_COLORS,
  THEME_KEY,
  ThemeStore,
  readChoice,
  resolveTheme,
  type Theme,
  type ThemeChoice,
} from "./theme";

/** A media query the test can flip, as the device switching to dark mode. */
function fakeMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    flip(dark: boolean) {
      media.matches = dark;
      for (const l of listeners) l();
    },
  };
  return media;
}

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

describe("the theme (#95)", () => {
  it("follows the device by default, and reads only a known choice", () => {
    expect(DEFAULT_CHOICE).toBe("system");
    expect(readChoice(memory())).toBe("system");
    expect(readChoice(memory({ [THEME_KEY]: "dark" }))).toBe("dark");
    expect(readChoice(memory({ [THEME_KEY]: "purple" }))).toBe("system");
    expect(
      readChoice({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe("system");
  });

  it("resolves a choice against the device's mode", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("applies the choice at once, remembers it, and follows the device live only when asked to", () => {
    const storage = memory();
    const media = fakeMedia(false);
    const applied: Theme[] = [];
    const store = new ThemeStore(
      storage,
      media as unknown as MediaQueryList,
      (t) => applied.push(t),
    );
    expect(store.state).toEqual({ choice: "system", theme: "light" });
    media.flip(true); // the device goes dark while the app is open
    expect(store.state.theme).toBe("dark");
    store.choose("light");
    expect(storage.data.get(THEME_KEY)).toBe("light");
    media.flip(false);
    media.flip(true); // a fixed choice ignores the device
    expect(store.state).toEqual({ choice: "light", theme: "light" });
    expect(applied).toEqual(["light", "dark", "light"]);
  });
});

describe("the script in index.html, before the first paint", () => {
  const html = readFileSync(
    new URL("../../index.html", import.meta.url),
    "utf8",
  );
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;

  /** Runs the inline script in a fake page; returns the class, the scheme and the meta colour it set. */
  function run(stored: string | null, deviceDark: boolean) {
    const classes = new Set<string>();
    const meta = {
      content: "",
      setAttribute: (_: string, v: string) => void (meta.content = v),
    };
    const documentElement = {
      classList: { add: (c: string) => classes.add(c) },
      style: { colorScheme: "" },
    };
    const window = { matchMedia: () => ({ matches: deviceDark }) };
    const localStorage = { getItem: () => stored };
    new Function("document", "window", "localStorage", "matchMedia", script)(
      { documentElement, querySelector: () => meta },
      window,
      localStorage,
      window.matchMedia,
    );
    return {
      dark: classes.has("dark"),
      scheme: documentElement.style.colorScheme,
      color: meta.content,
    };
  }

  it.each([
    [null, false],
    [null, true],
    ["light", true],
    ["dark", false],
    ["system", true],
    ["nonsense", true],
  ] as const)(
    "stored %s, device dark %s: the same theme as theme.ts",
    (stored, deviceDark) => {
      const theme = resolveTheme(
        readChoice(
          memory(stored ? { [THEME_KEY]: stored } : {}),
        ) as ThemeChoice,
        deviceDark,
      );
      expect(run(stored, deviceDark)).toEqual({
        dark: theme === "dark",
        scheme: theme === "dark" ? "dark" : "",
        color: THEME_COLORS[theme],
      });
    },
  );

  it("keeps the static theme-color and the manifest on the light colour", () => {
    expect(html).toContain(
      `<meta name="theme-color" content="${THEME_COLORS.light}" />`,
    );
  });
});
