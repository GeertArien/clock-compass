/** Monday of the current ISO week, as an ISO string (matches the server). */
export function startOfIsoWeekIso(reference: Date = new Date()): string {
  const d = new Date(reference);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + ((day === 0 ? -6 : 1) - day));
  return d.toISOString();
}

/** The seven Dates (local midnight, Mon–Sun) of the week `offset` weeks away. */
export function weekDays(offset = 0, reference: Date = new Date()): Date[] {
  const monday = new Date(startOfIsoWeekIso(reference));
  monday.setDate(monday.getDate() + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

/** True when the ISO timestamp falls on the same local calendar day as `day`. */
export function isSameLocalDay(iso: string | null, day: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return (
    d.getFullYear() === day.getFullYear() &&
    d.getMonth() === day.getMonth() &&
    d.getDate() === day.getDate()
  );
}

/** "7:30 pm" from "19:30"; null passes through. */
export function formatTime(hhmm: string | null): string | null {
  if (!hhmm) return null;
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}
