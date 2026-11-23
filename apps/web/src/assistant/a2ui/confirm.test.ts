import { describe, expect, it } from "vitest";
import { ComponentContext, MessageProcessor, type ComponentApi } from "@a2ui/web_core/v1_0";
import { acceptFinalEnvelopeKeys, ccApiCatalog, parseAction } from "@clock-compass/assistant-catalog";
import { scheduleProposal } from "@clock-compass/assistant-catalog/fixtures";
import { readConfirmEvent, watchSurfaceData } from "./confirm";

/** The schedule proposal (a day field bound to /day) as the official core holds it. */
function proposal() {
  const processor = new MessageProcessor<ComponentApi>([ccApiCatalog]);
  processor.processMessages(acceptFinalEnvelopeKeys(scheduleProposal("t1", "2026-11-25", "schedule-ab12")) as never);
  const surface = processor.model.surfacesMap.get("schedule-ab12")!;
  return { surface, context: new ComponentContext(surface as never, "confirm") };
}

describe("a ConfirmBar reads what it would send from the data as it is now", () => {
  it("follows the user's edit of a bound field: the event, the app's wording and the key all change", () => {
    const { surface, context } = proposal();
    const before = readConfirmEvent(context)!;
    expect(before).toEqual({ name: "scheduleTask", context: { taskId: "t1", day: "2026-11-25" } });

    surface.dataModel.set("/day", "2026-11-27");
    const after = readConfirmEvent(context)!;
    expect(after.context).toEqual({ taskId: "t1", day: "2026-11-27" });

    const parse = (e: typeof before) => parseAction({ name: e.name, surfaceId: surface.id, context: e.context });
    const [a, b] = [parse(before), parse(after)];
    if (a.kind !== "write" || b.kind !== "write") throw new Error("not writes");
    const lookup = { name: () => "Plan the garden", pinnedTaskIds: () => [] };
    expect(b.describe(lookup)).toBe("Schedule “Plan the garden” on 2026-11-27");
    expect(b.key).not.toBe(a.key);
  });

  it("turns an impossible day into an invalid action, so the bar can refuse it before a press", () => {
    const { surface, context } = proposal();
    surface.dataModel.set("/day", "2026-02-31");
    const event = readConfirmEvent(context)!;
    expect(parseAction({ name: event.name, surfaceId: surface.id, context: event.context })).toMatchObject({
      kind: "invalid",
      error: expect.stringMatching(/day: a real calendar date/),
    });
  });

  it("tells the bar about every change to the surface's data, until unsubscribed", () => {
    const { surface, context } = proposal();
    let changes = 0;
    const stop = watchSurfaceData(context, () => changes++);
    surface.dataModel.set("/day", "2026-11-26");
    surface.dataModel.set("/taskId", "t2");
    expect(changes).toBe(2);
    stop();
    surface.dataModel.set("/day", "2026-11-28");
    expect(changes).toBe(2);
  });
});
