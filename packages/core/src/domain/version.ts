/**
 * Which version is running (#140): the commit, the build time and the git
 * tag, baked into the image as build arguments by the release workflow
 * (`GIT_COMMIT`, `BUILD_DATE`, `GIT_TAG`). Never made up: without them the
 * version is unknown and says so.
 */
export interface BuildVersion {
  /** The full commit id, lower case; null when the build had none. */
  commit: string | null;
  /** When the image was built, ISO; null when unknown. */
  date: string | null;
  /** The git tag the build was for (e.g. `v1.2.0`); null when none. */
  tag: string | null;
}

export const UNKNOWN_VERSION = "unknown: built without version information";

/** The build values from the environment, each checked; anything malformed counts as missing. */
export function versionFromEnv(env: NodeJS.ProcessEnv = process.env): BuildVersion {
  const commit = env.GIT_COMMIT?.trim().toLowerCase() ?? "";
  const date = env.BUILD_DATE?.trim() ?? "";
  const tag = env.GIT_TAG?.trim() ?? "";
  const when = date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null;
  return {
    commit: /^[0-9a-f]{7,40}$/.test(commit) ? commit : null,
    date: when,
    tag: /^[\w.+-]{1,100}$/.test(tag) ? tag : null,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `6f47381 · 24 Nov 2026 (v1.2.0)`, or the fallback text. The date is the build's, in UTC. */
export function describeVersion(v: BuildVersion): string {
  if (!v.commit) return UNKNOWN_VERSION;
  const d = v.date ? new Date(v.date) : null;
  const day = d ? ` · ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : "";
  return `${v.commit.slice(0, 7)}${day}${v.tag ? ` (${v.tag})` : ""}`;
}
