<script lang="ts">
  import { onMount } from "svelte";
  import { BookOpen, Sparkles } from "lucide-svelte";
  import {
    DIMENSION_META,
    cadenceText,
    renewalStore,
  } from "@/lib/stores/renewal.svelte";
  import { navStore } from "@/lib/stores/nav.svelte";
  import { aiStore } from "@/lib/stores/ai.svelte";
  import { aiReview } from "@/lib/api";
  import { startOfIsoWeekIso } from "@/lib/week";

  // Read-only by design: this panel only loads and renders the record.
  onMount(() => renewalStore.loadRecord());

  // The one ✦ surface in the Almanac: the weekly review, generated on demand.
  let review = $state<string | null>(null);
  let reviewing = $state(false);
  async function generateReview() {
    if (reviewing) return;
    reviewing = true;
    try {
      review = (await aiReview()).summary;
    } catch {
      review = null;
    } finally {
      reviewing = false;
    }
  }

  const trends = $derived(renewalStore.trends);
  const empty = $derived(
    renewalStore.habits.length === 0 && renewalStore.activities.length === 0,
  );

  const DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

  function heatLevel(count: number): string {
    if (count === 0) return "bg-[var(--color-muted)]";
    if (count === 1) return "bg-[#cbd9c6]";
    if (count <= 2) return "bg-[#8fb89f]";
    return "bg-[var(--pine)]";
  }

  function weekLabel(weeksAgo: number): string {
    const monday = new Date(
      new Date(startOfIsoWeekIso()).getTime() - weeksAgo * 7 * 86_400_000,
    );
    return monday.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  const delta = $derived(trends ? trends.thisWeek - trends.lastWeek : 0);
</script>

{#if empty}
  <section
    class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--color-input)] bg-[var(--color-card)] px-6 py-14 text-center shadow-sm"
  >
    <BookOpen class="size-7 text-[var(--gold)]" />
    <h2 class="font-display text-lg font-semibold">The record will gather here.</h2>
    <p class="max-w-md font-display text-sm italic leading-relaxed text-[var(--color-muted-foreground)]">
      Define a habit in Compass · Renew, check it off in Clock · Today — the
      Almanac writes itself as you live the weeks.
    </p>
  </section>
{:else if navStore.sub === "season"}
  <!-- The Season: streaks + heatmap -->
  <section class="flex flex-col gap-4">
    <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-sm">
      <h3 class="font-display text-base font-semibold">Habit streaks</h3>
      <p class="text-xs text-[var(--color-muted-foreground)]">
        This week's marks · streaks count weeks the target was met — an unfinished week never breaks the chain.
      </p>
      <div class="mt-2">
        {#each renewalStore.habits as habit (habit.id)}
          <div class="flex items-center gap-3 border-b border-dotted border-[var(--color-border)] py-2.5 last:border-b-0">
            <span class="min-w-0 flex-1 truncate text-[0.84375rem] font-medium">{habit.name}</span>
            <span class="hidden text-[0.6875rem] text-[var(--color-muted-foreground)] sm:inline">
              {cadenceText(habit.targetPerWeek)}
            </span>
            <span class="flex gap-1">
              {#each habit.weekDays as on, i (i)}
                <span
                  class="flex size-5 items-center justify-center rounded-md border text-[0.5rem] {on
                    ? 'border-[var(--pine)] bg-[var(--pine)] text-white'
                    : 'border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-muted-foreground)]'}"
                >
                  {DOW[i]}
                </span>
              {/each}
            </span>
            <span class="w-16 text-right text-[0.75rem] text-[var(--color-muted-foreground)]">
              <b class="text-[var(--color-foreground)]">{habit.streak} wk{habit.streak === 1 ? "" : "s"}</b>
              {habit.streak >= 3 ? "🔥" : ""}
            </span>
          </div>
        {/each}
      </div>
    </div>

    {#if trends}
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-sm">
        <h3 class="font-display text-base font-semibold">Last 12 weeks</h3>
        <p class="text-xs text-[var(--color-muted-foreground)]">
          All habits and one-offs, intensity by daily completions.
        </p>
        <div class="mt-3 flex flex-col gap-1">
          {#each trends.heatmap as row, w (w)}
            <div class="flex items-center gap-1">
              <span class="w-12 text-[0.625rem] text-[var(--color-muted-foreground)]">
                {weekLabel(11 - w)}
              </span>
              {#each row as count, d (d)}
                <span class="size-3.5 rounded-[3px] {heatLevel(count)}" title={`${count}`}></span>
              {/each}
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </section>
{:else}
  <!-- Review: dimension aggregates + week delta + goal momentum -->
  <section class="flex flex-col gap-4">
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {#each renewalStore.summary as dim (dim.dimension)}
        {@const meta = DIMENSION_META[dim.dimension]}
        {@const pct = dim.habitsTarget
          ? Math.min(100, Math.round((100 * dim.habitsDone) / dim.habitsTarget))
          : 0}
        <div
          class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 shadow-sm"
          style={`border-top: 3px solid ${meta.color}`}
        >
          <p class="font-display text-[0.8125rem] font-semibold">{meta.label}</p>
          <p class="mt-1 font-display text-xl font-semibold">
            {dim.total}
            <span class="text-xs font-normal text-[var(--color-muted-foreground)]">this week</span>
          </p>
          <p class="text-[0.65625rem] text-[var(--color-muted-foreground)]">
            {dim.habitsDone}/{dim.habitsTarget} habit · {dim.oneOffs} one-off
          </p>
          <div class="mt-2 h-1 overflow-hidden rounded-full bg-[var(--color-muted)]">
            <div
              class="h-full rounded-full {pct >= 100 ? 'bg-[var(--star)]' : 'bg-[var(--pine)]'}"
              style={`width: ${pct}%`}
            ></div>
          </div>
        </div>
      {/each}
    </div>

    {#if trends}
      <div class="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-sm">
          <h3 class="font-display text-base font-semibold">This week vs last</h3>
          <p class="text-xs text-[var(--color-muted-foreground)]">Habits and one-offs combined</p>
          <div class="mt-2 flex flex-col">
            <div class="flex items-baseline gap-2 border-b border-dotted border-[var(--color-border)] py-2">
              <span class="flex-1 text-[0.84375rem]">Completions this week</span>
              <span class="font-display text-[0.9375rem] font-semibold">{trends.thisWeek}</span>
              {#if delta !== 0}
                <span
                  class="rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold {delta > 0
                    ? 'bg-[var(--pine-soft)] text-[var(--pine)]'
                    : 'bg-[var(--terra-soft)] text-[var(--terra)]'}"
                >
                  {delta > 0 ? "+" : ""}{delta}
                </span>
              {/if}
            </div>
            <div class="flex items-baseline gap-2 border-b border-dotted border-[var(--color-border)] py-2">
              <span class="flex-1 text-[0.84375rem]">Completions last week</span>
              <span class="font-display text-[0.9375rem] font-semibold">{trends.lastWeek}</span>
            </div>
            <div class="flex items-baseline gap-2 py-2">
              <span class="flex-1 text-[0.84375rem]">Longest active streak</span>
              <span class="font-display text-[0.9375rem] font-semibold">
                {trends.longestStreak.weeks} wks
              </span>
              {#if trends.longestStreak.habitName}
                <span class="text-[0.6875rem] text-[var(--color-muted-foreground)]">
                  {trends.longestStreak.habitName}
                </span>
              {/if}
            </div>
          </div>
        </div>

        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-sm">
          <h3 class="font-display text-base font-semibold">Goal momentum</h3>
          <p class="text-xs text-[var(--color-muted-foreground)]">Last 30 days, via linked habits</p>
          <div class="mt-2 flex flex-col">
            {#each trends.goalMomentum as goal (goal.goalId)}
              <div class="flex items-baseline gap-2 border-b border-dotted border-[var(--color-border)] py-2 last:border-b-0">
                <span class="min-w-0 flex-1 truncate text-[0.84375rem]">{goal.title}</span>
                <span class="font-display text-[0.9375rem] font-semibold">{goal.pct}%</span>
              </div>
            {:else}
              <p class="py-2 font-display text-sm italic text-[var(--color-muted-foreground)]">
                Link a habit to a goal to see its momentum here.
              </p>
            {/each}
          </div>
        </div>
      </div>

      {#if aiStore.connected}
        <div class="rounded-xl border-l-[3px] border border-[var(--color-border)] border-l-[var(--plum)] bg-[var(--color-card)] p-4 shadow-sm">
          <div class="flex items-center gap-2">
            <Sparkles class="size-4 text-[var(--plum)]" />
            <h3 class="font-display text-base font-semibold">Weekly review</h3>
            <span class="rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-[0.625rem] font-semibold text-[var(--color-muted-foreground)]">AI</span>
          </div>
          {#if review}
            <p class="mt-2 font-display text-sm italic leading-relaxed text-[var(--color-foreground)]/80">
              “{review}”
            </p>
          {:else}
            <button
              onclick={generateReview}
              disabled={reviewing}
              class="mt-2 text-sm font-semibold text-[var(--plum)] hover:underline disabled:opacity-50"
            >
              {reviewing ? "Reading the week…" : "✦ Generate this week's review"}
            </button>
          {/if}
        </div>
      {/if}

      {#if renewalStore.activities.length > 0}
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-sm">
          <h3 class="font-display text-base font-semibold">One-off renewal</h3>
          <p class="text-xs text-[var(--color-muted-foreground)]">Last 30 days</p>
          <div class="mt-1">
            {#each renewalStore.activities as activity (activity.id)}
              <div class="flex items-center gap-2.5 border-b border-dotted border-[var(--color-border)] py-2 last:border-b-0">
                <span
                  class="size-2.5 rounded-full"
                  style={`background: ${DIMENSION_META[activity.dimension].color}`}
                ></span>
                <span class="min-w-0 flex-1 truncate text-[0.84375rem]">{activity.title}</span>
                <span class="text-[0.6875rem] text-[var(--color-muted-foreground)]">
                  {new Date(activity.occurredAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </section>
{/if}
