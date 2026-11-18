/**
 * Navigation model (docs/design/ui-ux.md): three modes as tenses —
 * Compass defines, Clock does, Almanac remembers — each with sub-screens.
 * Icons live with the components, and the router hooks in use-nav.ts, so this
 * module stays free of React.
 */
export type Mode = "compass" | "clock" | "almanac";

export type CompassSub = "goals" | "projects" | "matrix" | "people" | "renew";
export type ClockSub = "today" | "week";
export type AlmanacSub = "review" | "season";
export type Sub = CompassSub | ClockSub | AlmanacSub;

export interface ModeItem {
  id: Mode;
  label: string;
  /** CSS color var carrying the mode's accent through the chrome. */
  accent: string;
}

export interface SubItem {
  id: Sub;
  label: string;
  /** Serif page title shown above the sub-tabs. */
  title: string;
  subtitle: string;
}

export const MODES: ModeItem[] = [
  { id: "compass", label: "Compass", accent: "var(--pine)" },
  { id: "clock", label: "Clock", accent: "var(--terra)" },
  { id: "almanac", label: "Almanac", accent: "var(--gold)" },
];

export const SUBS: Record<Mode, SubItem[]> = {
  compass: [
    {
      id: "goals",
      label: "Mission & Goals",
      title: "Begin with the end in mind.",
      subtitle: "Your mission, the roles you live by, and the results that matter most.",
    },
    {
      id: "projects",
      label: "Projects",
      title: "Goals become action.",
      subtitle: "Multi-step outcomes, each traceable to a goal. Loose tasks wait in the Inbox.",
    },
    {
      id: "matrix",
      label: "Matrix",
      title: "The weekly compass.",
      subtitle: "Every open task by importance × urgency. Live in Quadrant II.",
    },
    {
      id: "people",
      label: "People",
      title: "The people who matter.",
      subtitle: "Recurring commitments kept on cadence, and an emotional bank account each.",
    },
    {
      id: "renew",
      label: "Renew",
      title: "Sharpen the saw.",
      subtitle: "Define the habits that renew you — a dimension, a cadence, the goal each serves.",
    },
  ],
  clock: [
    {
      id: "today",
      label: "Today",
      title: "First things first.",
      subtitle: "Today's rocks and today's work. Everything else can wait.",
    },
    {
      id: "week",
      label: "Week",
      title: "Schedule the rocks first.",
      subtitle: "Pin Q2 tasks as big rocks; the small things fill the gaps.",
    },
  ],
  almanac: [
    {
      id: "review",
      label: "Review",
      title: "What you actually did.",
      subtitle: "Read-only by design — only evidence, gathered over weeks.",
    },
    {
      id: "season",
      label: "The Season",
      title: "How the season is trending.",
      subtitle: "Streaks count weeks the target was met — an unfinished week never breaks the chain.",
    },
  ],
};

/** The sub-tab a mode opens on. */
export const DEFAULT_SUB: Record<Mode, Sub> = {
  compass: "goals",
  clock: "today",
  almanac: "review",
};

export interface NavState {
  mode: Mode;
  sub: Sub;
}

export function isMode(value: unknown): value is Mode {
  return value === "compass" || value === "clock" || value === "almanac";
}

/** Whether `sub` is one of `mode`'s sub-tabs. */
export function isSubOf(mode: Mode, sub: unknown): sub is Sub {
  return SUBS[mode].some((s) => s.id === sub);
}

/** The active mode's metadata (derived, never stored). */
export function modeItem(state: NavState): ModeItem {
  return MODES.find((m) => m.id === state.mode) ?? MODES[0]!;
}

/** The active sub-screen's metadata (derived, never stored). */
export function subItem(state: NavState): SubItem {
  return SUBS[state.mode].find((s) => s.id === state.sub) ?? SUBS[state.mode][0]!;
}

// --- Routes -----------------------------------------------------------------
// Every screen has its own path, /:mode/:sub (for example /compass/people).
// The functions below are the whole route table; they are pure, so the
// resolution rules are tested without React or a browser.

/** The path of a screen; without `sub`, the mode's default sub-tab. */
export function pathFor(mode: Mode, sub?: Sub): string {
  return `/${mode}/${sub && isSubOf(mode, sub) ? sub : DEFAULT_SUB[mode]}`;
}

/** Clock · Today is the everyday home screen. */
export const HOME_PATH = pathFor("clock", "today");

/**
 * A notification deep link's `go` value ("compass.people", "clock") as a path,
 * or null when the mode is unknown. An unknown sub-tab opens the mode's default.
 */
export function goToPath(go: string): string | null {
  const [mode, sub] = go.split(".");
  return isMode(mode) ? pathFor(mode, sub as Sub | undefined) : null;
}

export type Resolved = { screen: NavState } | { redirect: string };

/**
 * Resolve a location to a screen, or to the path to redirect to:
 * `/` and unknown modes go home, a bare or unknown sub-tab goes to the mode's
 * default, and the legacy `?go=mode.sub` links (sent by notifications) go to
 * their screen.
 */
export function resolvePath(pathname: string, search = ""): Resolved {
  const go = new URLSearchParams(search).get("go");
  if (go !== null) return { redirect: goToPath(go) ?? HOME_PATH };
  const [mode, sub, ...rest] = pathname.split("/").filter(Boolean);
  if (!isMode(mode)) return { redirect: HOME_PATH };
  if (!isSubOf(mode, sub) || rest.length > 0) return { redirect: pathFor(mode, sub as Sub) };
  return { screen: { mode, sub } };
}

/**
 * Where a URL from outside the app (a notification, the service worker) should
 * take the router: a `?go=` link becomes its screen's path; anything else keeps
 * its own path and query.
 */
export function appPathFor(url: string, origin: string): string {
  const parsed = new URL(url, origin);
  const go = parsed.searchParams.get("go");
  if (go !== null) return goToPath(go) ?? HOME_PATH;
  return `${parsed.pathname}${parsed.search}`;
}

/** The browser tab title for a screen. */
export function titleFor(state: NavState): string {
  return `${subItem(state).label} · Clock & Compass`;
}
