import { addDays, inWeek, isoWeekStart, type PlainDay } from "./week.js";

/** Marks falling inside the ISO week that starts on Monday `weekStart`. */
function countInWeek(marks: readonly PlainDay[], weekStart: PlainDay): number {
  return marks.filter((day) => inWeek(day, weekStart)).length;
}

/**
 * Week-streak (the locked-in streak model): consecutive ISO weeks the target
 * was met, counting back from the week of `today`. The in-progress current
 * week NEVER breaks a streak — it simply doesn't count until the target is
 * met. Marks and `today` are plain days (#112), so the server's zone plays no
 * part.
 */
export function weekStreak(
  marks: readonly PlainDay[],
  targetPerWeek: number,
  today: PlainDay,
  maxWeeks = 104,
): number {
  const target = Math.max(1, targetPerWeek);
  const thisWeek = isoWeekStart(today);
  let streak = 0;
  for (let i = 0; i < maxWeeks; i++) {
    const met = countInWeek(marks, addDays(thisWeek, -7 * i)) >= target;
    if (i === 0) {
      // Current week: extend if already met, otherwise skip without breaking.
      if (met) streak++;
      continue;
    }
    if (met) streak++;
    else break;
  }
  return streak;
}

/** Marks in the ISO week containing `today`. */
export function countThisWeek(marks: readonly PlainDay[], today: PlainDay): number {
  return countInWeek(marks, isoWeekStart(today));
}
