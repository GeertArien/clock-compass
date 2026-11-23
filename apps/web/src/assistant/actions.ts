/**
 * Carries out a confirmed action (issue #62; one generic executor since #109).
 *
 * Every action the assistant may propose is an operation of the registry
 * (`@clock-compass/assistant-catalog`), so one path carries out all of them:
 * 1. check the proposal against the data the app shows (the items it names
 *    exist, rocks are Quadrant II): a refused action sends nothing;
 * 2. `POST /api/operations/{name}`: the server checks again with its own
 *    data and writes. Operations state a target ("done: true"), so an item
 *    already in that state is left alone: confirming again is harmless. A
 *    create sends the action's key as its idempotency key, so it makes one
 *    item however often it is sent;
 * 3. refresh what the operation touches.
 *
 * Nothing is read from the server before the write (the habit check-off is a
 * target state on the server now, not a toggle), and the change shows on the
 * screens once the server answered, not optimistically.
 *
 * The server and the query cache come in through OperationPorts, so this is
 * tested without React or a server (actions.test.ts); `live-ports.ts` binds
 * them to the app.
 */
import {
  checkOperation,
  operation,
  type CheckData,
  type ParsedAction,
  type Touches,
} from "@clock-compass/assistant-catalog";
import { ApiError } from "@clock-compass/web-client/api";

export type WriteAction = Extract<ParsedAction, { kind: "write" }>;

export interface OperationPorts {
  /** The data the app shows now, to check a proposal before it is sent (none: the server checks alone). */
  data(): CheckData | undefined;
  /**
   * Runs the operation on the server; rejects when it did not run. `key` is
   * the action's key: a create sends it as its idempotency key, so pressing
   * again, or retrying after a lost answer, finds the item made the first time.
   */
  run(name: string, input: Record<string, unknown>, key: string): Promise<unknown>;
  /** Reloads what the operation changed. */
  refresh(touches: readonly Touches[]): Promise<void>;
}

/** `createdId`: the item a create made (or found, when it was made before). */
export type ActionResult = { ok: true; changed: number; createdId?: string } | { ok: false; error: string };

/**
 * Why the app cannot carry out an action with this data, or null when it can.
 * Runs before the bar is shown and again when Confirm is pressed.
 */
export function checkAction(action: WriteAction, data: CheckData): string | null {
  return checkOperation(operation(action.name), action.args, data);
}

/** Runs one parsed, confirmed action. Never throws: failures come back as a result. */
export async function executeAction(action: WriteAction, ports: OperationPorts): Promise<ActionResult> {
  const data = ports.data();
  const refused = data ? checkAction(action, data) : null;
  if (refused) return { ok: false, error: refused };
  let result: unknown;
  try {
    result = await ports.run(action.name, action.args, action.key);
  } catch (err) {
    // 422: the server refused with the app's own words ("That task no longer exists.").
    if (err instanceof ApiError && err.status === 422) return { ok: false, error: err.message };
    const reason = err instanceof Error && err.message ? err.message : "the server did not accept it";
    return { ok: false, error: `This was not done: ${reason}.` };
  }
  // The write landed; a failed reload shows on the screens, not here.
  await ports.refresh(operation(action.name).touches).catch(() => {});
  const { changed, id } = (result ?? {}) as { changed?: unknown; id?: unknown };
  return {
    ok: true,
    changed: typeof changed === "number" ? changed : 1,
    ...(operation(action.name).creates && typeof id === "string" ? { createdId: id } : {}),
  };
}
