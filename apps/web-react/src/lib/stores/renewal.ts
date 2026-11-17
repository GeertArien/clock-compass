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
} from "@clock-compass/web-client/api";
import { errorMessage } from "@clock-compass/web-client/meta";
import { Store } from "./store";
import { toast } from "./toast";

export { DIMENSION_META, DIMENSIONS, cadenceText } from "@clock-compass/web-client/meta";

interface RenewalState {
  habits: HabitView[];
  summary: DimensionSummary[];
  trends: RenewalTrends | null;
  activities: RenewalActivity[];
  intentions: Partial<Record<RenewalDimension, string>>;
  loading: boolean;
  error: string | null;
}

/**
 * Habits + renewal (Habit 7). Habits are defined in Compass · Renew, checked
 * off in Clock · Today, and the Almanac reads the derived record. Mirrors
 * renewal.svelte.ts.
 */
export class RenewalStore extends Store<RenewalState> {
  constructor() {
    super({
      habits: [],
      summary: [],
      trends: null,
      activities: [],
      intentions: {},
      loading: false,
      error: null,
    });
  }

  async load(): Promise<void> {
    this.setState({ loading: true, error: null });
    try {
      const [habits, summary, intentions] = await Promise.all([
        listHabits(),
        getRenewalSummary(),
        getIntentions(),
      ]);
      this.setState({
        habits,
        summary,
        intentions: Object.fromEntries(intentions.map((i) => [i.dimension, i.text])),
      });
    } catch (err) {
      this.setState({ error: errorMessage(err, "Failed to load habits") });
    } finally {
      this.setState({ loading: false });
    }
  }

  /** Set (or clear, with empty text) this week's intention — optimistic. */
  async setIntention(dimension: RenewalDimension, text: string): Promise<void> {
    const prev = this.state.intentions;
    const trimmed = text.trim();
    this.setState({ intentions: { ...prev, [dimension]: trimmed || undefined } });
    try {
      await setIntention(dimension, trimmed);
    } catch (err) {
      this.setState({ intentions: prev });
      toast.error(errorMessage(err));
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
      this.setState({ trends, activities, summary, habits });
    } catch (err) {
      this.setState({ error: errorMessage(err, "Failed to load the record") });
    }
  }

  async #refreshSummary(): Promise<void> {
    try {
      this.setState({ summary: await getRenewalSummary() });
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
      this.setState({ habits: [...this.state.habits, created] });
      toast.success("Habit added");
      void this.#refreshSummary();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async remove(habit: HabitView): Promise<void> {
    const prev = this.state.habits;
    this.setState({ habits: prev.filter((h) => h.id !== habit.id) });
    try {
      await deleteHabit(habit.id);
      toast.success("Habit deleted");
      void this.#refreshSummary();
    } catch (err) {
      this.setState({ habits: prev });
      toast.error(errorMessage(err));
    }
  }

  /** Optimistic today-toggle; the server returns the authoritative view. */
  async toggleToday(habit: HabitView): Promise<void> {
    const prev = this.state.habits;
    this.setState({
      habits: prev.map((h) =>
        h.id === habit.id
          ? {
              ...h,
              markedToday: !h.markedToday,
              doneThisWeek: h.doneThisWeek + (h.markedToday ? -1 : 1),
            }
          : h,
      ),
    });
    try {
      const updated = await toggleHabit(habit.id);
      this.setState({ habits: this.state.habits.map((h) => (h.id === updated.id ? updated : h)) });
      void this.#refreshSummary();
    } catch (err) {
      this.setState({ habits: prev });
      toast.error(errorMessage(err));
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
      void this.#refreshSummary();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
}

export const renewalStore = new RenewalStore();
