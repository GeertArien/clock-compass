/**
 * React views for the assistant catalog, on the official renderer
 * (`@a2ui/react`). Each view gets props the protocol core has already
 * resolved (bindings to values plus setters, actions to functions, checks to
 * `isValid` / `validationErrors`), so these stay presentational.
 *
 * The app components render the app's own components (`TaskCard`,
 * `QuadrantGrid`, `GoalProgress`, `HabitCheckInRow`), read through the query
 * modules, so an item changed here changes everywhere and vice versa. The
 * APIs (schemas) live in `@clock-compass/assistant-catalog`.
 */
import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Target } from "lucide-react";
import { createComponentImplementation, type ReactA2uiComponentProps } from "@a2ui/react";
import {
  ButtonApi,
  CardApi,
  ChartApi,
  ChartBarsSchema,
  ColumnApi,
  ConfirmBarApi,
  DividerApi,
  GoalListApi,
  HabitCheckInApi,
  ListApi,
  QuadrantBoardApi,
  RowApi,
  TaskCardApi,
  TextApi,
  TextFieldApi,
} from "@clock-compass/assistant-catalog";
import { Button as UiButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TaskCard as AppTaskCard } from "@/components/TaskCard";
import { QuadrantGrid } from "@/components/QuadrantGrid";
import { GoalProgress } from "@/components/GoalProgress";
import { HabitCheckInRow } from "@/components/HabitCheckInRow";
import { useTasksQuery } from "@/lib/queries/tasks";
import { goalsQuery } from "@/lib/queries/goals";
import { habitsQuery, useHabits } from "@/lib/queries/renewal";
import { cn } from "@/lib/utils";

type Children = ReadonlyArray<string | { id: string; basePath: string }> | undefined;
type BuildChild = ReactA2uiComponentProps<unknown>["buildChild"];

function renderChildren(children: Children, buildChild: BuildChild): ReactNode[] {
  return (children ?? []).map((child) =>
    typeof child === "string" ? (
      <ChildSlot key={child}>{buildChild(child)}</ChildSlot>
    ) : (
      <ChildSlot key={`${child.id}@${child.basePath}`}>{buildChild(child.id, child.basePath)}</ChildSlot>
    ),
  );
}

/** Keyed wrapper so React can track template children across data changes. */
function ChildSlot({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

const JUSTIFY: Record<string, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  spaceBetween: "justify-between",
  spaceAround: "justify-around",
  spaceEvenly: "justify-evenly",
  stretch: "justify-stretch",
};
const ALIGN: Record<string, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};

/** `weight` is a flex-grow hint on any component inside a Row or Column. */
const weightStyle = (weight: number | undefined): CSSProperties | undefined =>
  weight === undefined ? undefined : { flexGrow: weight, flexBasis: 0, minWidth: 0 };

/**
 * Text: plain text with the small Markdown subset the spec allows. Headings
 * (`#`…`######`) map to the app's display type; anything else renders as
 * written. Fuller Markdown can come with the catalog step if prompts need it.
 */
export const Text = createComponentImplementation(TextApi, ({ props }) => {
  const text = props.text ?? "";
  const heading = /^(#{1,6})\s+(.*)$/s.exec(text);
  if (heading) {
    const level = heading[1]!.length;
    return (
      <p
        role="heading"
        aria-level={level}
        style={weightStyle(props.weight)}
        className={cn(
          "font-display leading-tight text-foreground",
          level <= 2 ? "text-xl" : level === 3 ? "text-lg" : "text-base",
        )}
      >
        {heading[2]}
      </p>
    );
  }
  return (
    <p
      style={weightStyle(props.weight)}
      className={cn(
        "whitespace-pre-line",
        props.variant === "caption" ? "text-xs text-muted-foreground" : "text-sm text-foreground",
      )}
    >
      {text}
    </p>
  );
});

export const Column = createComponentImplementation(ColumnApi, ({ props, buildChild }) => (
  <div
    style={weightStyle(props.weight)}
    className={cn(
      "flex min-w-0 flex-col gap-3",
      JUSTIFY[props.justify ?? "start"],
      ALIGN[props.align ?? "stretch"],
    )}
  >
    {renderChildren(props.children, buildChild)}
  </div>
));

export const Row = createComponentImplementation(RowApi, ({ props, buildChild }) => (
  <div
    style={weightStyle(props.weight)}
    className={cn(
      "flex min-w-0 flex-row flex-wrap gap-2",
      JUSTIFY[props.justify ?? "start"],
      ALIGN[props.align ?? "stretch"],
    )}
  >
    {renderChildren(props.children, buildChild)}
  </div>
));

export const List = createComponentImplementation(ListApi, ({ props, buildChild }) => (
  <div
    role="list"
    style={weightStyle(props.weight)}
    className={cn(
      "flex min-w-0 gap-2",
      props.direction === "horizontal" ? "flex-row overflow-x-auto" : "flex-col",
      ALIGN[props.align ?? "stretch"],
    )}
  >
    {(props.children ?? []).map((child) => {
      const [id, basePath] = typeof child === "string" ? [child, undefined] : [child.id, child.basePath];
      return (
        <div role="listitem" key={`${id}@${basePath ?? ""}`} className="min-w-0">
          {buildChild(id, basePath)}
        </div>
      );
    })}
  </div>
));

export const Card = createComponentImplementation(CardApi, ({ props, buildChild }) => (
  <div style={weightStyle(props.weight)} className="rounded-lg border border-border bg-card p-3">
    {props.child ? buildChild(props.child) : null}
  </div>
));

export const Divider = createComponentImplementation(DividerApi, () => (
  <hr className="border-border" />
));

export const Button = createComponentImplementation(ButtonApi, ({ props, buildChild }) => (
  <UiButton
    type="button"
    size="sm"
    style={weightStyle(props.weight)}
    variant={props.variant === "primary" ? "default" : props.variant === "borderless" ? "link" : "outline"}
    disabled={props.isValid === false}
    onClick={() => void props.action?.()}
  >
    {props.child ? buildChild(props.child) : null}
  </UiButton>
));

/**
 * TextField: the app's Input, two-way bound to the surface data model. Check
 * messages show once the field has been touched, so a fresh form isn't red.
 */
export const TextField = createComponentImplementation(TextFieldApi, ({ props }) => {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const errors = touched ? (props.validationErrors ?? []) : [];
  const common = {
    id,
    value: props.value ?? "",
    placeholder: props.placeholder,
    "aria-invalid": errors.length > 0 || undefined,
    "aria-describedby": errors.length > 0 ? `${id}-errors` : undefined,
    onBlur: () => setTouched(true),
  };
  return (
    <div style={weightStyle(props.weight)} className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {props.label}
      </label>
      {props.variant === "longText" ? (
        <textarea
          {...common}
          rows={3}
          onChange={(e) => {
            setTouched(true);
            props.setValue?.(e.currentTarget.value);
          }}
          className="w-full min-w-0 rounded-md border border-border bg-transparent px-3 py-2 text-sm shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : (
        <Input
          {...common}
          type={props.variant === "number" ? "number" : props.variant === "obscured" ? "password" : "text"}
          onChange={(e) => {
            setTouched(true);
            props.setValue?.(e.currentTarget.value);
          }}
        />
      )}
      {errors.length > 0 ? (
        <p id={`${id}-errors`} className="text-xs text-destructive">
          {errors.join(" ")}
        </p>
      ) : null}
    </div>
  );
});

/**
 * TaskCard: the app's live task card, looked up by id in the tasks query. A
 * skeleton until tasks first load; a short note if the task is gone.
 */
export const TaskCard = createComponentImplementation(TaskCardApi, ({ props }) => {
  const { tasks, loading } = useTasksQuery();
  const task = tasks.find((t) => t.id === props.taskId);
  if (task) return <AppTaskCard task={task} />;
  if (loading) {
    return <div aria-hidden className="h-16 animate-pulse rounded-md border border-border bg-muted" />;
  }
  return (
    <p className="rounded-md border border-dashed border-border p-2.5 text-xs text-muted-foreground">
      This task no longer exists.
    </p>
  );
});

/**
 * ConfirmBar: the explicit accept/decline step every proposal ends with. The
 * accept button stays disabled while any of its checks fail; after either
 * button is pressed both lock, so an action is sent once.
 */
export const ConfirmBar = createComponentImplementation(ConfirmBarApi, ({ props }) => {
  const hintId = useId();
  const [sent, setSent] = useState<"confirm" | "dismiss" | null>(null);
  const invalid = props.isValid === false;
  const send = (which: "confirm" | "dismiss") => {
    if (sent) return;
    setSent(which);
    void (which === "confirm" ? props.confirm() : props.dismiss?.());
  };
  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-3">
      <div className="flex items-center justify-end gap-2">
        {props.dismiss ? (
          <UiButton type="button" size="sm" variant="ghost" disabled={sent !== null} onClick={() => send("dismiss")}>
            {props.dismissLabel ?? "Not now"}
          </UiButton>
        ) : null}
        <UiButton
          type="button"
          size="sm"
          disabled={invalid || sent !== null}
          aria-describedby={invalid ? hintId : undefined}
          onClick={() => send("confirm")}
        >
          {props.confirmLabel ?? "Confirm"}
        </UiButton>
      </div>
      {invalid && !sent && props.validationErrors?.length ? (
        <p id={hintId} className="text-right text-xs text-muted-foreground">
          {props.validationErrors.join(" ")}
        </p>
      ) : null}
      {sent ? (
        <p role="status" className="text-right text-xs text-muted-foreground">
          {sent === "confirm" ? "Sent." : "Dismissed."}
        </p>
      ) : null}
    </div>
  );
});

/** Shown while an app component's data has not loaded yet. */
function Pending({ height = "h-16" }: { height?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md border border-border bg-muted", height)} />;
}

/** Shown when the ids the assistant named match nothing (deleted meanwhile). */
function Gone({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-border p-2.5 text-xs text-muted-foreground">{children}</p>
  );
}

/** Keeps the items whose id is listed, in the listed order. */
function pick<T extends { id: string }>(items: T[], ids: readonly string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/**
 * QuadrantBoard: the app's quadrant grid with live task cards. The named
 * tasks, or every open task when no ids are given (as Compass · Matrix).
 */
export const QuadrantBoard = createComponentImplementation(QuadrantBoardApi, ({ props }) => {
  const { tasks, loading } = useTasksQuery();
  if (loading) return <Pending height="h-40" />;
  const shown = props.taskIds ? pick(tasks, props.taskIds) : tasks.filter((t) => t.status !== "DONE");
  if (props.taskIds && props.taskIds.length > 0 && shown.length === 0) {
    return <Gone>These tasks no longer exist.</Gone>;
  }
  return <QuadrantGrid tasks={shown} />;
});

/**
 * GoalList: each goal with its completion and habit momentum, read-only (edit
 * them in Compass · Goals). The named goals, or every active goal.
 */
export const GoalList = createComponentImplementation(GoalListApi, ({ props }) => {
  const goalsResult = useQuery(goalsQuery);
  const habits = useHabits();
  if (goalsResult.data === undefined) return <Pending />;
  const goals = props.goalIds
    ? pick(goalsResult.data, props.goalIds)
    : goalsResult.data.filter((g) => g.status === "ACTIVE");
  if (goals.length === 0) return <Gone>{props.goalIds ? "These goals no longer exist." : "No active goals."}</Gone>;
  return (
    <ul className="flex flex-col gap-2">
      {goals.map((goal) => (
        <li key={goal.id} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <Target className="size-4 shrink-0 text-muted-foreground" />
            <h3 className="min-w-0 truncate font-display text-[0.9375rem] font-semibold">{goal.title}</h3>
          </div>
          <GoalProgress goal={goal} habits={habits} />
        </li>
      ))}
    </ul>
  );
});

/** HabitCheckIn: today's check-ins, as on Clock · Today. The named habits, or all. */
export const HabitCheckIn = createComponentImplementation(HabitCheckInApi, ({ props }) => {
  const habitsResult = useQuery(habitsQuery);
  if (habitsResult.data === undefined) return <Pending />;
  const habits = props.habitIds ? pick(habitsResult.data, props.habitIds) : habitsResult.data;
  if (habits.length === 0) return <Gone>{props.habitIds ? "These habits no longer exist." : "No habits yet."}</Gone>;
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card px-4 py-1 shadow-sm">
      {habits.map((habit) => (
        <HabitCheckInRow key={habit.id} habit={habit} />
      ))}
    </div>
  );
});

/**
 * Chart: horizontal bars. `bars` must resolve to 1–24 {label, value} pairs
 * (ChartBarsSchema); anything else shows a short note instead of a broken
 * chart. Each bar carries its value as text, so the chart reads without colour.
 */
export const Chart = createComponentImplementation(ChartApi, ({ props }) => {
  const parsed = ChartBarsSchema.safeParse(props.bars);
  if (!parsed.success) return <Gone>No chart data.</Gone>;
  const bars = parsed.data;
  const max = props.max ?? Math.max(...bars.map((b) => b.value), 1);
  const unit = props.unit ?? "";
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      {props.title ? <figcaption className="text-xs font-semibold text-muted-foreground">{props.title}</figcaption> : null}
      <ul className="flex flex-col gap-1.5">
        {bars.map((bar, i) => (
          <li key={`${bar.label}-${i}`} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2 text-xs">
            <span className="truncate text-foreground" title={bar.label}>
              {bar.label}
            </span>
            <span aria-hidden className="h-2 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-[var(--pine)]"
                style={{ width: `${Math.min(100, (100 * bar.value) / max)}%` }}
              />
            </span>
            <span className="tabular-nums text-muted-foreground">
              {bar.value}
              {unit}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
});

export const COMPONENTS = [
  Text,
  Column,
  Row,
  List,
  Card,
  Divider,
  Button,
  TextField,
  TaskCard,
  QuadrantBoard,
  GoalList,
  HabitCheckIn,
  Chart,
  ConfirmBar,
];
