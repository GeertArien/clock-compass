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
import {
  OptimisticEdits,
  replaceById,
  restoreAt,
  withoutId,
} from "@clock-compass/web-client/rollback";
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
 * off in Clock · Today, and the Almanac reads the derived record.
 */
export class RenewalStore extends Store<RenewalState> {
  // In-flight edits: whatever order requests succeed or fail in, what is shown
  // is the server-confirmed value plus the edits still pending. Intentions are
  // tracked per dimension (as {id, text}).
  readonly #habitEdits = new OptimisticEdits<HabitView>();
  readonly #intentionEdits = new OptimisticEdits<{ id: RenewalDimension; text?: string }>();

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
      this.#habitEdits.reset();
      this.#intentionEdits.reset();
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
    const trimmed = text.trim();
    const patched = trimmed || undefined;
    const show = (item: { text?: string }) =>
      this.setState({ intentions: { ...this.state.intentions, [dimension]: item.text } });
    const { item, ticket } = this.#intentionEdits.apply(
      { id: dimension, text: this.state.intentions[dimension] },
      { text: patched },
    );
    show(item);
    try {
      await setIntention(dimension, trimmed);
      show(this.#intentionEdits.succeed(dimension, ticket, { id: dimension, text: patched }));
    } catch (err) {
      const shown = this.#intentionEdits.fail(dimension, ticket);
      if (shown) show(shown);
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
      this.#habitEdits.reset();
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
    const index = this.state.habits.findIndex((h) => h.id === habit.id);
    const removed = this.state.habits[index] ?? habit;
    // With an edit in flight, `removed` carries a patch that may yet fail.
    const edited = this.#habitEdits.inFlight(habit.id);
    this.setState({ habits: withoutId(this.state.habits, habit.id) });
    try {
      await deleteHabit(habit.id);
      toast.success("Habit deleted");
      void this.#refreshSummary();
    } catch (err) {
      const back = (edited ? this.#habitEdits.shown(habit.id) : undefined) ?? removed;
      this.setState({ habits: restoreAt(this.state.habits, back, index) });
      toast.error(errorMessage(err));
    }
  }

  /** Optimistic today-toggle; the server returns the authoritative view. */
  async toggleToday(habit: HabitView): Promise<void> {
    const current = this.state.habits.find((h) => h.id === habit.id);
    if (!current) return;
    const { item, ticket } = this.#habitEdits.apply(current, {
      markedToday: !current.markedToday,
      doneThisWeek: current.doneThisWeek + (current.markedToday ? -1 : 1),
    });
    this.setState({ habits: replaceById(this.state.habits, item) });
    try {
      const updated = await toggleHabit(habit.id);
      this.setState({
        habits: replaceById(this.state.habits, this.#habitEdits.succeed(habit.id, ticket, updated)),
      });
      void this.#refreshSummary();
    } catch (err) {
      // Drop only this call's patch; edits still in flight or confirmed stay.
      const shown = this.#habitEdits.fail(habit.id, ticket);
      if (shown) this.setState({ habits: replaceById(this.state.habits, shown) });
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
