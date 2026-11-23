/**
 * The kinds of data the assistant may read and send to an AI provider
 * (issue #62, owner decision; seam for #94). Declared here, next to the
 * operation registry, so the browser can filter operations by category too;
 * `@clock-compass/core`'s data policy re-exports them.
 */
export const DATA_CATEGORIES = [
  "tasks",
  /** Free-text notes on tasks (on by default; owner decision on #62). */
  "taskNotes",
  "goalsAndProjects",
  "mission",
  /** Names, relationship type, commitments with status and streaks. */
  "people",
  "personNotes",
  "ebaBalance",
  "ebaEntryNotes",
  "habitsAndRenewal",
] as const;
export type DataCategory = (typeof DATA_CATEGORIES)[number];

/** Which categories are on. A category left out counts as on. */
export type CategoryFilter = Readonly<Partial<Record<DataCategory, boolean>>>;
