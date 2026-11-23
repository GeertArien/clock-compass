/**
 * Days in a given IANA time zone. The web app stores a day ("2026-11-23") as
 * the browser's local midnight; an operation run on the server for that
 * browser (issue #109) must store the same instant, so it works in the
 * browser's zone, not the server's.
 */

/** How far the zone's wall clock is ahead of UTC at this instant, in ms. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wall - Math.floor(instant / 1000) * 1000;
}

/**
 * Midnight at the start of `day` (YYYY-MM-DD) in `timeZone`, as an instant.
 * On a day that starts in a DST gap, the first instant of that day.
 */
export function zonedMidnight(day: string, timeZone: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d);
  let instant = wall - zoneOffsetMs(wall, timeZone);
  // The offset at the guess may differ from the offset at midnight (a DST
  // change in between): correct once with the offset at the guess itself.
  const corrected = wall - zoneOffsetMs(instant, timeZone);
  if (corrected !== instant) instant = corrected;
  // In a gap (no local midnight that day), step forward to the day's start.
  if (zonedDay(new Date(instant), timeZone) !== day) instant += 60 * 60 * 1000;
  return new Date(instant);
}

/** The calendar day (YYYY-MM-DD) an instant falls on in `timeZone`. */
export function zonedDay(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/** Whether `timeZone` is a zone this runtime knows. */
export function isTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || !timeZone || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
