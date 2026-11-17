import {
  createHabit,
  deleteHabit,
  getIntentions,
  getRenewalSummary,
  getRenewalTrends,
  listHabits,
  listRenewalActivities,
  logRenewalActivity,
  setIntention,
  toggleHabit,
  type DimensionSummary,
  type HabitView,
  type RenewalActivity,
  type RenewalDimension,
  type RenewalTrends,
} from "@/lib/api";
import { toast } from "@/lib/components/ui/toast";
import {
  fieldsBefore,
  restoreAt,
  revertKey,
  revertPatch,
  withoutId,
} from "@clock-compass/web-client/rollback";

function message(err: unknown, fallback = "Something went wrong"): string {
  return err instanceof Error ? err.message : fallback;
}

// Shared with the React app (issue #64): one definition in @clock-compass/web-client.
export { DIMENSION_META, DIMENSIONS, cadenceText } from "@clock-compass/web-client/meta";

/**
 * Habits + renewal (Habit 7). Habits are defined in Compass · Renew, checked
 * off in Clock · Today, and the Almanac reads the derived record.
 */
class RenewalStore {
  habits = $state<HabitView[]>([]);
  summary = $state<DimensionSummary[]>([]);
  trends = $state<RenewalTrends | null>(null);
  activities = $state<RenewalActivity[]>([]);
  intentions = $state<Partial<Record<RenewalDimension, string>>>({});
  loading = $state(false);
  error = $state<string | null>(null);

  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const [habits, summary, intentions] = await Promise.all([
        listHabits(),
        getRenewalSummary(),
        getIntentions(),
      ]);
      this.habits = habits;
      this.summary = summary;
      this.intentions = Object.fromEntries(intentions.map((i) => [i.dimension, i.text]));
    } catch (err) {
      this.error = message(err, "Failed to load habits");
    } finally {
      this.loading = false;
    }
  }

  /** Set (or clear, with empty text) this week's intention — optimistic. */
  async setIntention(dimension: RenewalDimension, text: string): Promise<void> {
    const before = this.intentions[dimension];
    const trimmed = text.trim();
    const patched = trimmed || undefined;
    this.intentions = { ...this.intentions, [dimension]: patched };
    try {
      await setIntention(dimension, trimmed);
    } catch (err) {
      this.intentions = revertKey(this.intentions, dimension, patched, before);
      toast.error(message(err));
    }
  }

  /** The Almanac's read-only payload (loaded on demand). */
  async loadRecord(): Promise<void> {
    try {
      [this.trends, this.activities, this.summary, this.habits] = await Promise.all([
        getRenewalTrends(),
        listRenewalActivities(),
        getRenewalSummary(),
        listHabits(),
      ]);
    } catch (err) {
      this.error = message(err, "Failed to load the record");
    }
  }

  private async refreshSummary(): Promise<void> {
    try {
      this.summary = await getRenewalSummary();
    } catch {
      /* surfaced on next interaction */
    }
  }

  async add(body: {
    name: string;
    dimension?: RenewalDimension;
    goalId?: string;
    targetPerWeek?: number;
  }): Promise<void> {
    try {
      const created = await createHabit(body);
      this.habits = [...this.habits, created];
      toast.success("Habit added");
      this.refreshSummary();
    } catch (err) {
      toast.error(message(err));
    }
  }

  async remove(habit: HabitView): Promise<void> {
    const index = this.habits.findIndex((h) => h.id === habit.id);
    const removed = this.habits[index] ?? habit;
    this.habits = withoutId(this.habits, habit.id);
    try {
      await deleteHabit(habit.id);
      toast.success("Habit deleted");
      this.refreshSummary();
    } catch (err) {
      this.habits = restoreAt(this.habits, removed, index);
      toast.error(message(err));
    }
  }

  /** Optimistic today-toggle; the server returns the authoritative view. */
  async toggleToday(habit: HabitView): Promise<void> {
    const current = this.habits.find((h) => h.id === habit.id) ?? habit;
    const optimistic = {
      markedToday: !current.markedToday,
      doneThisWeek: current.doneThisWeek + (current.markedToday ? -1 : 1),
    };
    const before = fieldsBefore(current, optimistic);
    this.habits = this.habits.map((h) => (h.id === habit.id ? { ...h, ...optimistic } : h));
    try {
      const updated = await toggleHabit(habit.id);
      this.habits = this.habits.map((h) => (h.id === updated.id ? updated : h));
      this.refreshSummary();
    } catch (err) {
      this.habits = revertPatch(this.habits, habit.id, optimistic, before);
      toast.error(message(err));
    }
  }

  async logActivity(body: {
    dimension: RenewalDimension;
    title: string;
    note?: string;
  }): Promise<void> {
    try {
      await logRenewalActivity(body);
      toast.success("Renewal logged");
      this.refreshSummary();
    } catch (err) {
      toast.error(message(err));
    }
  }
}

export const renewalStore = new RenewalStore();
