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
  OptimisticEdits,
  replaceById,
  restoreAt,
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
  // In-flight edits: whatever order requests succeed or fail in, what is shown
  // is the server-confirmed value plus the edits still pending. Intentions are
  // tracked per dimension (as {id, text}).
  private readonly habitEdits = new OptimisticEdits<HabitView>();
  private readonly intentionEdits = new OptimisticEdits<{ id: RenewalDimension; text?: string }>();
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
      this.habitEdits.reset();
      this.intentionEdits.reset();
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
    const trimmed = text.trim();
    const patched = trimmed || undefined;
    const show = (item: { text?: string }) => {
      this.intentions = { ...this.intentions, [dimension]: item.text };
    };
    const { item, ticket } = this.intentionEdits.apply(
      { id: dimension, text: this.intentions[dimension] },
      { text: patched },
    );
    show(item);
    try {
      await setIntention(dimension, trimmed);
      show(this.intentionEdits.succeed(dimension, ticket, { id: dimension, text: patched }));
    } catch (err) {
      const shown = this.intentionEdits.fail(dimension, ticket);
      if (shown) show(shown);
      toast.error(message(err));
    }
  }

  /** The Almanac's read-only payload (loaded on demand). */
  async loadRecord(): Promise<void> {
    try {
      const [trends, activities, summary, habits] = await Promise.all([
        getRenewalTrends(),
        listRenewalActivities(),
        getRenewalSummary(),
        listHabits(),
      ]);
      this.habitEdits.reset();
      [this.trends, this.activities, this.summary, this.habits] = [trends, activities, summary, habits];
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
    const current = this.habits.find((h) => h.id === habit.id);
    if (!current) return;
    const { item, ticket } = this.habitEdits.apply(current, {
      markedToday: !current.markedToday,
      doneThisWeek: current.doneThisWeek + (current.markedToday ? -1 : 1),
    });
    this.habits = replaceById(this.habits, item);
    try {
      const updated = await toggleHabit(habit.id);
      this.habits = replaceById(this.habits, this.habitEdits.succeed(habit.id, ticket, updated));
      this.refreshSummary();
    } catch (err) {
      // Drop only this call's patch; edits still in flight or confirmed stay.
      const shown = this.habitEdits.fail(habit.id, ticket);
      if (shown) this.habits = replaceById(this.habits, shown);
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
