/**
 * Display metadata and small derivations: one definition for quadrant, status,
 * dimension and cadence labels, kept free of any UI framework.
 */
import type {
  CadenceUnit,
  GoalStatus,
  ProjectStatus,
  Quadrant,
  RenewalDimension,
} from "./api";

/** A task's quadrant is derived from importance × urgency, never stored. */
export function deriveQuadrant(important: boolean, urgent: boolean): Quadrant {
  if (important && urgent) return "Q1";
  if (important) return "Q2";
  if (urgent) return "Q3";
  return "Q4";
}

export const QUADRANT_META: Record<
  Quadrant,
  { title: string; hint: string; dot: string }
> = {
  Q1: { title: "Urgent & Important", hint: "Do now", dot: "bg-[var(--q1)]" },
  Q2: {
    title: "Important, Not Urgent",
    hint: "Big rocks — plan first",
    dot: "bg-[var(--q2)]",
  },
  Q3: {
    title: "Urgent, Not Important",
    hint: "Delegate / minimize",
    dot: "bg-[var(--q3)]",
  },
  Q4: {
    title: "Not Urgent, Not Important",
    hint: "Eliminate",
    dot: "bg-[var(--q4)]",
  },
};

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  ACHIEVED: "Achieved",
  DROPPED: "Dropped",
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  ACTIVE: "Active",
  SOMEDAY: "Someday",
  DONE: "Done",
};

/** Display metadata for the four fixed renewal dimensions. */
export const DIMENSION_META: Record<
  RenewalDimension,
  { label: string; sub: string; color: string; soft: string }
> = {
  PHYSICAL: {
    label: "Physical",
    sub: "exercise · nutrition · rest",
    color: "var(--q1)",
    soft: "var(--terra-soft)",
  },
  MENTAL: {
    label: "Mental",
    sub: "reading · learning · planning",
    color: "var(--pine)",
    soft: "var(--pine-soft)",
  },
  SOCIAL_EMOTIONAL: {
    label: "Social / Emotional",
    sub: "connection · service · empathy",
    color: "var(--gold)",
    soft: "var(--gold-soft)",
  },
  SPIRITUAL: {
    label: "Spiritual",
    sub: "values · reflection · meaning",
    color: "var(--plum)",
    soft: "var(--plum-soft)",
  },
};

export const DIMENSIONS = Object.keys(DIMENSION_META) as RenewalDimension[];

/** A relationship commitment's cadence: "weekly", "every 2 weeks"… */
export function cadenceLabel(unit: CadenceUnit, value: number): string {
  if (value === 1) {
    return { DAY: "daily", WEEK: "weekly", MONTH: "monthly", YEAR: "yearly" }[unit];
  }
  const noun = { DAY: "days", WEEK: "weeks", MONTH: "months", YEAR: "years" }[unit];
  return `every ${value} ${noun}`;
}

/** A recurring task's rule for people: "Repeats every year", "Repeats every 2 weeks after completion". */
export function recurrenceLabel(rule: { unit: CadenceUnit; every: number; from: "SCHEDULE" | "COMPLETION" }): string {
  const noun = { DAY: "day", WEEK: "week", MONTH: "month", YEAR: "year" }[rule.unit];
  const every = rule.every === 1 ? `every ${noun}` : `every ${rule.every} ${noun}s`;
  return `Repeats ${every}${rule.from === "COMPLETION" ? " after completion" : ""}`;
}

/** A habit's weekly target: "daily" or "3×/wk". */
export function cadenceText(targetPerWeek: number): string {
  return targetPerWeek >= 7 ? "daily" : `${targetPerWeek}×/wk`;
}

/** The message to show for a failed request. */
export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  return err instanceof Error ? err.message : fallback;
}
