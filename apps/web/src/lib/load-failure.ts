/**
 * Why a lazily loaded part of the app (the assistant) did not start (#114).
 * Only a module that could not be downloaded is a connection problem; a
 * module that downloaded and then failed while starting is not, and the
 * user should not be told to check their connection.
 */

export const LOAD_FAILED = "The assistant could not be loaded. Check your connection and reload.";
export const START_FAILED = "The assistant could not start in this browser. Reload the app to try again.";

/**
 * A download failure as browsers report a failed `import()`: Chromium
 * ("Failed to fetch dynamically imported module"), Firefox ("error loading
 * dynamically imported module"), Safari ("Importing a module script
 * failed"), and Vite's preload error for the chunk's CSS.
 */
export function isDownloadFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(err.message);
}

/** The message for a part of the app that did not load or start. */
export function loadFailureMessage(err: unknown): string {
  return isDownloadFailure(err) ? LOAD_FAILED : START_FAILED;
}
