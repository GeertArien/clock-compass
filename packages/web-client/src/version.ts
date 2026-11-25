/**
 * Which version this device's app is, and which the server runs (#140).
 * Each carries the commit, build time and tag of its own build; a build
 * without them is "unknown", never a made-up value.
 */
export interface BuildVersion {
  commit: string | null;
  date: string | null;
  tag: string | null;
}

export const UNKNOWN_VERSION = "unknown: built without version information";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A version from loose values (the build's `define`, an older server's missing field). */
export function versionOf(raw: unknown): BuildVersion {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);
  const commit = str(v.commit)?.toLowerCase() ?? null;
  const date = str(v.date);
  return {
    commit: commit && /^[0-9a-f]{7,40}$/.test(commit) ? commit : null,
    date: date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null,
    tag: str(v.tag),
  };
}

/** `6f47381 · 24 Nov 2026 (v1.2.0)`, or the fallback text. The day is the build's, in UTC. */
export function describeVersion(v: BuildVersion): string {
  if (!v.commit) return UNKNOWN_VERSION;
  const d = v.date ? new Date(v.date) : null;
  const day = d ? ` · ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : "";
  return `${v.commit.slice(0, 7)}${day}${v.tag ? ` (${v.tag})` : ""}`;
}

/**
 * What to say when this device's app and the server differ, in words; null
 * when they are the same, or when either is unknown (nothing to compare).
 */
export function versionNote(app: BuildVersion, server: BuildVersion): string | null {
  if (!app.commit || !server.commit || app.commit === server.commit) return null;
  if (app.date && server.date && app.date < server.date) {
    return "This device has an older version of the app; reload to update.";
  }
  return "This device's app and the server are different versions; reload to get the server's.";
}
