/**
 * React views for the assistant catalog, on the official renderer
 * (`@a2ui/react`). Each view gets props the protocol core has already
 * resolved (bindings to values plus setters, actions to functions, checks to
 * `isValid` / `validationErrors`), so these stay presentational.
 *
 * `TaskCard` renders the app's own `TaskCard`, read through the tasks query
 * module, so a task changed here changes everywhere and vice versa.
 */
import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { createComponentImplementation, type ReactA2uiComponentProps } from "@a2ui/react";
import { Button as UiButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TaskCard as AppTaskCard } from "@/components/TaskCard";
import { useTasksQuery } from "@/lib/queries/tasks";
import { cn } from "@/lib/utils";
import {
  ButtonApi,
  CardApi,
  ColumnApi,
  ConfirmBarApi,
  DividerApi,
  ListApi,
  RowApi,
  TaskCardApi,
  TextApi,
  TextFieldApi,
} from "./catalog";

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

export const COMPONENTS = [Text, Column, Row, List, Card, Divider, Button, TextField, TaskCard, ConfirmBar];
