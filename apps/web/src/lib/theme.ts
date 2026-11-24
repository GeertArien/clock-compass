import { Store } from "@/lib/stores/store";

/**
 * The colour theme (#95): Light, Dark, or Follow the device. The choice is
 * kept on this device (localStorage); nothing goes to the server.
 *
 * The class is first set by the small script in `index.html`, before the
 * first paint, so a dark-mode user never sees a light flash. That script and
 * `resolveTheme` / `applyTheme` here must agree; `theme.test.ts` runs the
 * script against the same cases.
 */
export type ThemeChoice = "light" | "dark" | "system";
export type Theme = "light" | "dark";

export const THEME_KEY = "clockcompass_theme";
/** Used when nothing is stored: dark when the device is (the reviewer's recommendation; owner confirms in the PR). */
export const DEFAULT_CHOICE: ThemeChoice = "system";
/** The browser chrome (address bar, PWA status bar) per theme: each theme's `--background`. */
export const THEME_COLORS: Record<Theme, string> = {
  light: "#f5f1e8",
  dark: "#1e1b15",
};

const CHOICES: readonly ThemeChoice[] = ["light", "dark", "system"];
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** The stored choice, or the default; never throws (private mode, blocked storage). */
export function readChoice(
  storage: Pick<Storage, "getItem"> | undefined = safeStorage(),
): ThemeChoice {
  try {
    const value = storage?.getItem(THEME_KEY);
    return CHOICES.includes(value as ThemeChoice)
      ? (value as ThemeChoice)
      : DEFAULT_CHOICE;
  } catch {
    return DEFAULT_CHOICE;
  }
}

export function resolveTheme(choice: ThemeChoice, deviceDark: boolean): Theme {
  return choice === "system" ? (deviceDark ? "dark" : "light") : choice;
}

/** Puts a theme on the page: the `dark` class, the native controls' scheme, and the browser chrome's colour. */
export function applyTheme(theme: Theme, doc: Document = document): void {
  const root = doc.documentElement;
  root.classList.toggle("dark", theme === "dark");
  // Native controls (selects, scrollbars) in dark; light leaves it unset, as before (#95).
  root.style.colorScheme = theme === "dark" ? "dark" : "";
  doc
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLORS[theme]);
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/**
 * The choice as app state. With "Follow the device" it listens to the
 * device's mode and switches live, without a reload.
 */
export class ThemeStore extends Store<{ choice: ThemeChoice; theme: Theme }> {
  readonly #media: MediaQueryList | null;

  constructor(
    private readonly storage:
      | Pick<Storage, "getItem" | "setItem">
      | undefined = safeStorage(),
    media: MediaQueryList | null = typeof matchMedia === "undefined"
      ? null
      : matchMedia(DARK_QUERY),
    private readonly apply: (theme: Theme) => void = (theme) => {
      if (typeof document !== "undefined") applyTheme(theme);
    },
  ) {
    const choice = readChoice(storage);
    super({ choice, theme: resolveTheme(choice, media?.matches ?? false) });
    this.#media = media;
    media?.addEventListener("change", () => {
      if (this.state.choice === "system") this.#show("system");
    });
    this.apply(this.state.theme);
  }

  /** Choose a theme; remembered on this device. */
  choose(choice: ThemeChoice): void {
    try {
      this.storage?.setItem(THEME_KEY, choice);
    } catch {
      // Storage blocked: the choice holds until the page is closed.
    }
    this.#show(choice);
  }

  #show(choice: ThemeChoice): void {
    const theme = resolveTheme(choice, this.#media?.matches ?? false);
    this.setState({ choice, theme });
    this.apply(theme);
  }
}

export const themeStore = new ThemeStore();
