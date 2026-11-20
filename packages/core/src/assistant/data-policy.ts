/**
 * What data the assistant may read and send to an AI provider (issue #62,
 * owner decision; seam for #94).
 *
 * Every read tool declares the category it reads, and the server enforces the
 * policy: a tool for a switched-off category is never offered to the model
 * and refuses to run if asked, and fields of a switched-off category are left
 * out of a tool's result, whatever the client or the model asks for.
 *
 * Today the policy is a constant. #94 stores it per user and adds a Settings
 * screen; it replaces `currentDataPolicy`, not the tools.
 */
export const DATA_CATEGORIES = [
  "tasks",
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

export type DataPolicy = Readonly<Record<DataCategory, boolean>>;

/**
 * Everything on except free-text notes on people and on emotional-bank-account
 * entries, which stay on the server (owner decision on #62).
 */
export const DEFAULT_DATA_POLICY: DataPolicy = Object.freeze({
  tasks: true,
  goalsAndProjects: true,
  mission: true,
  people: true,
  personNotes: false,
  ebaBalance: true,
  ebaEntryNotes: false,
  habitsAndRenewal: true,
});

/** The policy in force. A constant until #94 adds storage. */
export function currentDataPolicy(): DataPolicy {
  return DEFAULT_DATA_POLICY;
}
