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
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Target } from "lucide-react";
import { createComponentImplementation, useA2uiSurface, type ReactA2uiComponentProps } from "@a2ui/react";
import type { ComponentContext } from "@a2ui/web_core/v1_0";
import type { Task } from "@clock-compass/web-client/api";
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
  type TaskChange,
} from "@clock-compass/assistant-catalog";
import { Button as UiButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TaskCard as AppTaskCard, type CardEditing } from "@/components/TaskCard";
import { QuadrantGrid } from "@/components/QuadrantGrid";
import { GoalProgress } from "@/components/GoalProgress";
import { HabitCheckInRow } from "@/components/HabitCheckInRow";
import { useAllTasks, useTasksQuery } from "@/lib/queries/tasks";
import { goalsQuery } from "@/lib/queries/goals";
import { habitsQuery, useHabits } from "@/lib/queries/renewal";
import { cn } from "@/lib/utils";
import { readConfirmEvent, watchSurfaceData } from "./confirm";
import { applyTaskChange, pendingProposal, type TaskSet } from "./proposal";
import { Markdown, MarkdownInline } from "../Markdown";

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
        <MarkdownInline text={heading[2]!} />
      </p>
    );
  }
  return (
    <div style={weightStyle(props.weight)}>
      <Markdown
        text={text}
        className={props.variant === "caption" ? "text-xs text-muted-foreground" : "text-sm text-foreground"}
      />
    </div>
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
 * What the unconfirmed proposals in this card's surface would set on its task
 * (#145), or null. Read again when the surface's data changes (a day field
 * the user edits) and when a proposal is confirmed or declined.
 */
function usePendingSet(context: ComponentContext, taskId: string | undefined): { set: TaskSet; keys: string[] } | null {
  const host = useContext(ConfirmHostContext);
  const surface = useA2uiSurface();
  const [, changed] = useReducer((n: number) => n + 1, 0);
  useEffect(() => watchSurfaceData(context, changed), [context]);
  useEffect(() => host?.subscribe(changed), [host]);
  const taskChanges = host?.taskChanges;
  if (!host || !taskChanges || !surface || !taskId) return null;
  return pendingProposal(surface as never, { taskChanges, stateOf: host.stateOf }, taskId);
}

const PROPOSAL_LABEL = "After you confirm";

/**
 * The task as it will be after Confirm, read-only, its changed parts marked
 * (#145). The label is printed once per proposal, above its first card; each
 * card still carries it as its group name for a screen reader.
 */
function ProposalCard({ task, set, edit }: { task: Task; set: TaskSet; edit: CardEdit | null }) {
  const { after, changed } = applyTaskChange(task, set);
  const ref = useRef<HTMLDivElement>(null);
  const [first, setFirst] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const Fields = edit?.Fields;
  const editing: CardEditing | undefined = edit
    ? {
        set: edit.set,
        fieldsOpen: fieldsOpen && !!Fields,
        toggleFields: () => setFieldsOpen((open) => !open),
        fields: Fields ? <Fields task={after} set={edit.set} /> : null,
      }
    : undefined;
  // After every render on purpose: which card comes first depends on the
  // other cards in the surface (one going back to live, say). Setting the
  // same value again does not render again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = ref.current;
    setFirst(!!el && el.closest("[data-surface]")?.querySelector("[data-proposal-card]") === el);
  });
  return (
    <div ref={ref} data-proposal-card role="group" aria-label={PROPOSAL_LABEL} className="flex flex-col gap-1">
      {first ? (
        <p aria-hidden="true" className="text-[0.625rem] font-semibold tracking-wide text-muted-foreground uppercase">
          {PROPOSAL_LABEL}
        </p>
      ) : null}
      <AppTaskCard task={after} proposal={{ changed }} editing={editing} />
    </div>
  );
}

/**
 * TaskCard: the app's live task card, looked up by id in the tasks query. A
 * skeleton until tasks first load; a short note if the task is gone. Inside
 * an unconfirmed proposal that changes it, the task as it will be after
 * Confirm, read-only (#145); once confirmed or declined, the live card.
 */
export const TaskCard = createComponentImplementation(TaskCardApi, ({ props, context }) => {
  // By id: a "later" occurrence the model names is still a task to show.
  const { loading } = useTasksQuery();
  const task = useAllTasks().find((t) => t.id === props.taskId);
  const pending = usePendingSet(context, props.taskId);
  const host = useContext(ConfirmHostContext);
  // Editable only when one proposal sets this card, and its host offers it (#159).
  const edit = pending?.keys.length === 1 ? (host?.edit?.(pending.keys[0]!) ?? null) : null;
  if (task && pending) return <ProposalCard task={task} set={pending.set} edit={edit} />;
  if (task) return <AppTaskCard task={task} />;
  // A proposed new task declined: its draft card is gone with it (#159).
  if (props.taskId && host?.isDraft?.(props.taskId)) return null;
  if (loading) {
    return <div aria-hidden className="h-16 animate-pulse rounded-md border border-border bg-muted" />;
  }
  return (
    <p className="rounded-md border border-dashed border-border p-2.5 text-xs text-muted-foreground">
      This task no longer exists.
    </p>
  );
});

/** Where a confirmed proposal stands (the sheet's session tracks it by action key). */
export type ConfirmState =
  | { status: "running" }
  /** `already`: the server answered that nothing needed changing (a second press after the MCP App page was drawn again, #118). */
  | { status: "applied"; createdId?: string; already?: boolean }
  | { status: "failed"; error: string }
  /** Declined with "Not now", kept with the conversation (#145). */
  | { status: "dismissed" };

/**
 * Editing one proposal in its card (#159; only the MCP App page offers it):
 * `set` changes the proposal, never the task; `Fields` is what the pencil
 * opens inside the card (the title, the dates and the project).
 */
export interface CardEdit {
  set(patch: Record<string, unknown>): void;
  Fields?: ComponentType<{ task: Task; set(patch: Record<string, unknown>): void }>;
}

/**
 * What a ConfirmBar asks of the app around it (the assistant sheet): the
 * app's own wording of the action it would send, its key, and where that
 * action stands. Without a host (the dev preview) the bar only sends.
 */
export interface ConfirmHost {
  /**
   * The app's wording and key of a confirmable action; an error for invalid
   * arguments; null when not a write. `blocked` (#159): Confirm is off, and
   * this says why (an edit that leaves nothing to change, or is not valid).
   */
  preview(event: { name: string; surfaceId: string; context?: Record<string, unknown> }):
    | { key: string; text: string; blocked?: string }
    | { error: string }
    | null;
  /** The tasks a confirmable action would change, and its key (#145); null when it is not a write. */
  taskChanges?(event: { name: string; surfaceId: string; context?: Record<string, unknown> }):
    | { key: string; changes: TaskChange[] }
    | null;
  /** Remember "Not now" on a proposal (#145). */
  dismiss?(key: string): void;
  /** Stable per state (same object until it changes), for useSyncExternalStore. */
  stateOf(key: string): ConfirmState | undefined;
  subscribe(listener: () => void): () => void;
  /** The name of a task, goal or project a confirmed create made, if the app has it. */
  createdName?(id: string): string | undefined;
  /** Editing the proposal with this key in its card, or null (#159; absent: never). */
  edit?(key: string): CardEdit | null;
  /** Whether this task id names a proposed new task's draft card, not a task (#159). */
  isDraft?(taskId: string): boolean;
}

export const ConfirmHostContext = createContext<ConfirmHost | null>(null);

const noSubscribe = () => () => {};

/**
 * ConfirmBar: the explicit accept/decline step every proposal ends with.
 * Before anything is pressed it shows the app's own wording of the action
 * (from the items it touches, whatever the model wrote around it). The accept
 * button stays disabled while a check fails or the action is invalid; once
 * pressed it waits for the app: done locks the bar, a failure says why and
 * unlocks it so the user can try again. Dismiss locks it.
 */
export const ConfirmBar = createComponentImplementation(ConfirmBarApi, ({ props, context }) => {
  const hintId = useId();
  const host = useContext(ConfirmHostContext);
  const surface = useA2uiSurface();
  const [sent, setSent] = useState<"confirm" | "dismiss" | null>(null);

  // The arguments are bound to the surface's data, which the user can edit (a
  // day field): render again on every change, so the wording, the checks and
  // the key below always describe what Confirm sends now.
  const [, dataChanged] = useReducer((n: number) => n + 1, 0);
  useEffect(() => watchSurfaceData(context, dataChanged), [context]);
  // The host's proposals can change too (an edit in the card, #159).
  useEffect(() => host?.subscribe(dataChanged), [host]);

  let preview: ReturnType<ConfirmHost["preview"]> = null;
  if (host && surface) {
    try {
      const event = readConfirmEvent(context);
      if (event) preview = host.preview({ ...event, surfaceId: surface.id });
    } catch {
      preview = { error: "This proposal could not be read." };
    }
  }
  // A bar that would change something carries the app's own button labels:
  // the model's could name the buttons the wrong way round ("Cancel" on the
  // one that confirms), and the wording above already says what will happen.
  const writes = preview !== null;
  const key = preview && "key" in preview ? preview.key : null;
  const state = useSyncExternalStore(host?.subscribe ?? noSubscribe, () => (host && key ? host.stateOf(key) : undefined));

  const blocked = preview && "blocked" in preview ? preview.blocked : undefined;
  const invalid = props.isValid === false || (preview !== null && "error" in preview) || !!blocked;
  const locked =
    sent === "dismiss" ||
    state?.status === "dismissed" ||
    state?.status === "running" ||
    state?.status === "applied" ||
    (sent === "confirm" && state === undefined);
  const send = (which: "confirm" | "dismiss") => {
    if (locked || (which === "confirm" && invalid)) return;
    setSent(which);
    // A declined write is remembered with the conversation, so its card goes back to the live task (#145).
    if (which === "dismiss" && key) host?.dismiss?.(key);
    void (which === "confirm" ? props.confirm() : props.dismiss?.());
  };
  const createdId = state?.status === "applied" ? state.createdId : undefined;
  // A task, goal or project it made is named; a log entry has no name to give.
  const createdTitle = createdId ? host?.createdName?.(createdId) : undefined;
  const status =
    state?.status === "applied"
      ? state.already
        ? createdTitle !== undefined
          ? `Already done: “${createdTitle}” was created before.`
          : "Already done: nothing changed."
        : createdTitle !== undefined
          ? `Done: created “${createdTitle}”.`
          : "Done."
      : state?.status === "running"
        ? "Working…"
        : sent === "dismiss" || state?.status === "dismissed"
          ? "Dismissed."
          : sent === "confirm" && state === undefined
            ? "Sent."
            : null;
  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-3">
      {/* Once applied the wording is not shown again: it is worked out from the
          data as it is now, which the action itself has changed. */}
      {preview && "text" in preview && state?.status !== "applied" ? (
        <p className="text-xs wrap-anywhere text-muted-foreground">
          If you confirm: <span className="text-foreground">{preview.text}.</span>
        </p>
      ) : null}
      {preview && "error" in preview && state?.status !== "applied" ? (
        <p className="text-xs wrap-anywhere text-destructive">This proposal cannot be carried out: {preview.error}</p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        {props.dismiss ? (
          <UiButton type="button" size="sm" variant="ghost" disabled={locked} onClick={() => send("dismiss")}>
            {writes ? "Not now" : (props.dismissLabel ?? "Not now")}
          </UiButton>
        ) : null}
        <UiButton
          type="button"
          size="sm"
          disabled={invalid || locked}
          aria-describedby={invalid ? hintId : undefined}
          onClick={() => send("confirm")}
        >
          {writes ? "Confirm" : (props.confirmLabel ?? "Confirm")}
        </UiButton>
      </div>
      {props.isValid === false && !locked && props.validationErrors?.length ? (
        <p id={hintId} className="text-right text-xs text-muted-foreground">
          {props.validationErrors.join(" ")}
        </p>
      ) : blocked && !locked ? (
        <p id={hintId} className="text-right text-xs text-muted-foreground">
          {blocked}
        </p>
      ) : null}
      {state?.status === "failed" ? (
        <p role="alert" className="text-right text-xs text-destructive">
          {state.error}
        </p>
      ) : null}
      {status ? (
        <p role="status" className="text-right text-xs text-muted-foreground">
          {status}
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

/** Keeps the items whose id is listed, in the listed order, each once. */
function pick<T extends { id: string }>(items: T[], ids: readonly string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return [...new Set(ids)].flatMap((id) => byId.get(id) ?? []);
}

/** What to say when a list of ids shows nothing: none named, or all gone. */
const nothing = (ids: readonly string[], kind: string) =>
  ids.length === 0 ? `No ${kind} to show.` : `These ${kind} no longer exist.`;

/** A bar's value as text: at most one decimal, so 66.66666666666667 reads "66.7". */
const barValue = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

/**
 * QuadrantBoard: the app's quadrant grid with live task cards. The named
 * tasks, or every open task when no ids are given (as Compass · Matrix).
 */
export const QuadrantBoard = createComponentImplementation(QuadrantBoardApi, ({ props }) => {
  const { tasks, loading } = useTasksQuery();
  if (loading) return <Pending height="h-40" />;
  const shown = props.taskIds ? pick(tasks, props.taskIds) : tasks.filter((t) => t.status !== "DONE");
  if (props.taskIds && shown.length === 0) return <Gone>{nothing(props.taskIds, "tasks")}</Gone>;
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
  if (goals.length === 0) return <Gone>{props.goalIds ? nothing(props.goalIds, "goals") : "No active goals."}</Gone>;
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
  if (habits.length === 0) return <Gone>{props.habitIds ? nothing(props.habitIds, "habits") : "No habits yet."}</Gone>;
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
              {barValue.format(bar.value)}
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
