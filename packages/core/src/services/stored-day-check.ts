/**
 * The permanent guard of #137. Stored days have been plain dates since #112
 * (habit marks, weekly intentions) and #136 (scheduled days), and the code
 * that read or moved the older form is gone. An installation that updates
 * straight from before those would show its old days on the wrong day
 * without any error, so the server stops instead, before it changes
 * anything, and says which version to pass through first.
 */

/** The version that still moves the old form: the last commit before #137. */
export const PASS_THROUGH_TAG = "plain-days";
export const PASS_THROUGH_COMMIT = "f86705c";

/** What the server prints when it refuses to start. */
export function notPlainDaysMessage(count: number): string {
  return [
    `The server did not start and changed nothing: ${count} stored day${count === 1 ? " was" : "s were"} written by a version from before 25 November 2026 and ${count === 1 ? "is" : "are"} not a plain date, which this version can no longer read.`,
    "To move them:",
    `  1. Update to the git tag ${PASS_THROUGH_TAG} (commit ${PASS_THROUGH_COMMIT}): git fetch --tags && git checkout ${PASS_THROUGH_TAG}, then build and start it as usual.`,
    "  2. Start it once and open the app: it moves scheduled days by itself. Habit marks and weekly intentions from a server that ran outside UTC need its command (node apps/server/dist/days-migrate.js --from <zone>); the README of that version explains it.",
    "  3. Update to this version again.",
  ].join("\n");
}
