/**
 * What a ConfirmBar would send, read from the surface's data as it is now.
 * The action's arguments are bound to that data, which the user can edit (a
 * day field), so the bar reads them again on every change: the wording, the
 * checks and the key always describe what Confirm sends at that moment.
 * React-free; tested against the official core in confirm.test.ts.
 */
import type { ComponentContext } from "@a2ui/web_core/v1_0";

export interface ConfirmEvent {
  name: string;
  context?: Record<string, unknown>;
}

/** The confirm action's event, resolved against the current data; null when it has none. */
export function readConfirmEvent(context: ComponentContext): ConfirmEvent | null {
  const resolved = context.dataContext.resolveAction(context.componentModel.properties.confirm) as {
    event?: { name?: unknown; context?: Record<string, unknown> };
  };
  const name = resolved?.event?.name;
  return typeof name === "string" ? { name, context: resolved.event?.context } : null;
}

/** Calls `onChange` whenever any of the surface's data changes. Returns the unsubscribe. */
export function watchSurfaceData(context: ComponentContext, onChange: () => void): () => void {
  const subscription = context.dataContext.dataModel.subscribe("/", () => onChange());
  return () => subscription.unsubscribe();
}
