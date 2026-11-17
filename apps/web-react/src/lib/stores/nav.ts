import { Store } from "./store";

/**
 * Navigation model (docs/design/ui-ux.md): three modes as tenses —
 * Compass defines, Clock does, Almanac remembers — each with sub-screens.
 * Mirrors apps/web/src/lib/stores/nav.svelte.ts; icons live with the
 * components so this module stays free of React.
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

const DEFAULT_SUB: Record<Mode, Sub> = {
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

/** The active mode's metadata (derived, never stored). */
export function modeItem(state: NavState): ModeItem {
  return MODES.find((m) => m.id === state.mode) ?? MODES[0]!;
}

/** The active sub-screen's metadata (derived, never stored). */
export function subItem(state: NavState): SubItem {
  return SUBS[state.mode].find((s) => s.id === state.sub) ?? SUBS[state.mode][0]!;
}

export class NavStore extends Store<NavState> {
  constructor() {
    /** Clock · Today is the everyday home screen. */
    super({ mode: "clock", sub: "today" });
  }

  go(mode: Mode, sub?: Sub): void {
    this.setState({ mode, sub: sub ?? DEFAULT_SUB[mode] });
  }

  goSub(sub: Sub): void {
    this.setState({ sub });
  }

  /** Notification deep links: "/?go=compass.people" → the People screen. */
  navigateTo(url: string, base: string): void {
    const go = new URL(url, base).searchParams.get("go");
    if (!go) return;
    const [mode, sub] = go.split(".");
    if (isMode(mode)) this.go(mode, sub as Sub | undefined);
  }
}

export const navStore = new NavStore();
