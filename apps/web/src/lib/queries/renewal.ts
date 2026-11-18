import { mutationOptions, queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";
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
} from "@clock-compass/web-client/api";
import { errorMessage } from "@clock-compass/web-client/meta";
import { replaceById, restoreAt, withoutId } from "@clock-compass/web-client/rollback";
import { toast } from "@/lib/stores/toast";
import { editsFor } from "./edits";

export { DIMENSION_META, DIMENSIONS, cadenceText } from "@clock-compass/web-client/meta";

/*
 * Habits + renewal (Habit 7). Habits are defined in Compass · Renew, checked
 * off in Clock · Today, and the Almanac reads the derived record. Everything
 * here sits under ["renewal"].
 */

type Intentions = Partial<Record<RenewalDimension, string>>;
type TrackedIntention = { id: RenewalDimension; text?: string };

// In-flight edits: whatever order requests succeed or fail in, what is shown
// is the server-confirmed value plus the edits still pending. Intentions are
// tracked per dimension (as {id, text}).
const habitEdits = editsFor<HabitView>();
const intentionEdits = editsFor<TrackedIntention>();

export const habitsQuery = queryOptions({
  queryKey: ["renewal", "habits"],
  queryFn: async ({ client }) => {
    const habits = await listHabits();
    habitEdits(client).reset();
    return habits;
  },
});

/** Per-dimension totals (habit check-ins plus one-off activities). */
export const summaryQuery = queryOptions({
  queryKey: ["renewal", "summary"],
  queryFn: getRenewalSummary,
});

/** This week's intention per dimension. */
export const intentionsQuery = queryOptions({
  queryKey: ["renewal", "intentions"],
  queryFn: async ({ client }): Promise<Intentions> => {
    const intentions = await getIntentions();
    intentionEdits(client).reset();
    return Object.fromEntries(intentions.map((i) => [i.dimension, i.text]));
  },
});

/** The Almanac's trend lines (loaded when the Almanac opens). */
export const trendsQuery = queryOptions({
  queryKey: ["renewal", "trends"],
  queryFn: getRenewalTrends,
});

/** The Almanac's one-off renewal log (loaded when the Almanac opens). */
export const activitiesQuery = queryOptions({
  queryKey: ["renewal", "activities"],
  queryFn: listRenewalActivities,
});

const NO_HABITS: HabitView[] = [];
const NO_SUMMARY: DimensionSummary[] = [];
const NO_ACTIVITIES: RenewalActivity[] = [];
const NO_INTENTIONS: Intentions = {};

/** The habits, or none until they've loaded (a stable empty list). */
export function useHabits(): HabitView[] {
  return useQuery(habitsQuery).data ?? NO_HABITS;
}

/**
 * Compass · Renew's data. A load error shows until Retry starts, as it did
 * ("Failed to load habits" whichever part failed); Retry reloads all three.
 */
export function useRenew() {
  const habits = useQuery(habitsQuery);
  const summary = useQuery(summaryQuery);
  const intentions = useQuery(intentionsQuery);
  const parts = [habits, summary, intentions];
  const fetching = parts.some((q) => q.isFetching);
  const failed = parts.find((q) => q.isError);
  return {
    habits: habits.data ?? NO_HABITS,
    intentions: intentions.data ?? NO_INTENTIONS,
    loading: fetching,
    error: failed && !fetching ? errorMessage(failed.error, "Failed to load habits") : null,
    retry: () => parts.forEach((q) => void q.refetch()),
  };
}

/**
 * The Almanac's read-only record, refetched each time the Almanac opens (as
 * loadRecord did): trends, the one-off log, and fresh habits and summary.
 */
export function useRenewalRecord() {
  const always = { refetchOnMount: "always" } as const;
  return {
    habits: useQuery({ ...habitsQuery, ...always }).data ?? NO_HABITS,
    summary: useQuery({ ...summaryQuery, ...always }).data ?? NO_SUMMARY,
    trends: useQuery({ ...trendsQuery, ...always }).data ?? null,
    activities: useQuery({ ...activitiesQuery, ...always }).data ?? NO_ACTIVITIES,
  };
}

function cachedHabits(client: QueryClient): HabitView[] {
  return client.getQueryData(habitsQuery.queryKey) ?? [];
}

function writeHabits(client: QueryClient, update: (habits: HabitView[]) => HabitView[]): void {
  client.setQueryData(habitsQuery.queryKey, (habits) => update(habits ?? []));
}

/** Silent summary reload after a write (a failure is surfaced on the next interaction). */
async function refreshSummary(client: QueryClient): Promise<void> {
  try {
    client.setQueryData(summaryQuery.queryKey, await getRenewalSummary());
  } catch {
    /* keep what's shown */
  }
}

/** Set (or clear, with empty text) this week's intention, optimistically. */
export const saveIntention = mutationOptions({
  mutationKey: ["renewal", "intention"],
  mutationFn: ({ dimension, text }: { dimension: RenewalDimension; text: string }) =>
    setIntention(dimension, text.trim()),
  onMutate: ({ dimension, text }, { client }) => {
    const current = client.getQueryData(intentionsQuery.queryKey) ?? {};
    const { item, ticket } = intentionEdits(client).apply(
      { id: dimension, text: current[dimension] },
      { text: text.trim() || undefined },
    );
    showIntention(client, item);
    return { ticket };
  },
  onSuccess: (_data, { dimension, text }, ctx, { client }) => {
    const confirmed = { id: dimension, text: text.trim() || undefined };
    showIntention(client, intentionEdits(client).succeed(dimension, ctx.ticket, confirmed));
  },
  onError: (err, { dimension }, ctx, { client }) => {
    const shown = ctx ? intentionEdits(client).fail(dimension, ctx.ticket) : undefined;
    if (shown) showIntention(client, shown);
    toast.error(errorMessage(err));
  },
});

function showIntention(client: QueryClient, item: TrackedIntention): void {
  client.setQueryData(intentionsQuery.queryKey, (all) => ({ ...all, [item.id]: item.text }));
}

/** Add a habit (not optimistic: it shows once the server has created it). */
export const addHabit = mutationOptions({
  mutationKey: ["renewal", "habit-add"],
  mutationFn: (body: {
    name: string;
    dimension?: RenewalDimension;
    goalId?: string;
    targetPerWeek?: number;
  }) => createHabit(body),
  onSuccess: (created, _body, _ctx, { client }) => {
    writeHabits(client, (habits) => [...habits, created]);
    toast.success("Habit added");
    void refreshSummary(client);
  },
  onError: (err) => toast.error(errorMessage(err)),
});

/** Delete a habit; a failure puts it back in place. */
export const removeHabit = mutationOptions({
  mutationKey: ["renewal", "habit-remove"],
  mutationFn: (habit: HabitView) => deleteHabit(habit.id),
  onMutate: (habit, { client }) => {
    const habits = cachedHabits(client);
    const index = habits.findIndex((h) => h.id === habit.id);
    const removed = habits[index] ?? habit;
    writeHabits(client, (list) => withoutId(list, habit.id));
    // With an edit in flight, `removed` carries a patch that may yet fail.
    return { removed, index, edited: habitEdits(client).inFlight(habit.id) };
  },
  onSuccess: (_data, _habit, _ctx, { client }) => {
    toast.success("Habit deleted");
    void refreshSummary(client);
  },
  onError: (err, habit, ctx, { client }) => {
    if (ctx) {
      const back = (ctx.edited ? habitEdits(client).shown(habit.id) : undefined) ?? ctx.removed;
      writeHabits(client, (habits) => restoreAt(habits, back, ctx.index));
    }
    toast.error(errorMessage(err));
  },
});

/** Check a habit off for today (or undo it), optimistically; the server returns the view. */
export const toggleHabitToday = mutationOptions({
  mutationKey: ["renewal", "habit-toggle"],
  mutationFn: (habit: HabitView) => toggleHabit(habit.id),
  onMutate: (habit, { client }) => {
    const current = cachedHabits(client).find((h) => h.id === habit.id);
    if (!current) return undefined;
    const { item, ticket } = habitEdits(client).apply(current, {
      markedToday: !current.markedToday,
      doneThisWeek: current.doneThisWeek + (current.markedToday ? -1 : 1),
    });
    writeHabits(client, (habits) => replaceById(habits, item));
    return { ticket };
  },
  onSuccess: (updated, habit, ctx, { client }) => {
    if (ctx) {
      const shown = habitEdits(client).succeed(habit.id, ctx.ticket, updated);
      writeHabits(client, (habits) => replaceById(habits, shown));
    }
    void refreshSummary(client);
  },
  onError: (err, habit, ctx, { client }) => {
    // Drop only this call's patch; edits still in flight or confirmed stay.
    const shown = ctx ? habitEdits(client).fail(habit.id, ctx.ticket) : undefined;
    if (shown) writeHabits(client, (habits) => replaceById(habits, shown));
    toast.error(errorMessage(err));
  },
});

/** Log a one-off renewal activity (a retreat, a long hike). */
export const logActivity = mutationOptions({
  mutationKey: ["renewal", "activity"],
  mutationFn: (body: { dimension: RenewalDimension; title: string; note?: string }) =>
    logRenewalActivity(body),
  onSuccess: (_data, _body, _ctx, { client }) => {
    toast.success("Renewal logged");
    void refreshSummary(client);
  },
  onError: (err) => toast.error(errorMessage(err)),
});
