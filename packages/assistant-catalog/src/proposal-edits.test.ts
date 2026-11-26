import { describe, expect, it } from "vitest";
import {
  NOTHING_TO_CHANGE,
  draftChange,
  editProblem,
  editableFields,
  editedInput,
  ownerChanges,
} from "./proposal-edits";
import { PROPOSABLE } from "./proposals";
import { operation, operationSentence, sentenceNotes, updateChangesNothing, type ActionLookup, type LookupTask } from "./operations";

const current: LookupTask = {
  title: "Call the plumber",
  notes: null,
  important: true,
  urgent: true,
  proactivity: null,
  dueDate: null,
  scheduledDay: null,
  scheduledTime: null,
  projectId: null,
  goalId: null,
  repeat: null,
};
const lookup: ActionLookup = {
  name: (kind, id) => (kind === "project" && id === "p1" ? "Taxes" : kind === "task" && id === "t1" ? current.title : undefined),
  pinnedTaskIds: () => [],
  task: (id) => (id === "t1" ? current : undefined),
};

describe("what may be edited in the card (#159)", () => {
  it("only createTask and updateTask, in the eight fields; nothing that removes data", () => {
    const editable = PROPOSABLE.filter((op) => editableFields(op.name).length).map((op) => op.name);
    expect(editable).toEqual(["createTask", "updateTask"]);
    expect(editableFields("updateTask")).toEqual(["title", "important", "urgent", "proactivity", "dueDate", "scheduledDay", "scheduledTime", "projectId", "goalId"]);
    for (const name of editable) {
      expect(editableFields(name)).not.toContain("notes");
      expect(editableFields(name)).not.toContain("repeat");
      expect(editableFields(name)).not.toContain("taskId");
    }
  });

  it("puts the edits on the proposed input; a create leaves a cleared field out, and a day cleared clears its time", () => {
    expect(editedInput("createTask", { title: "A", notes: "n", dueDate: "2027-01-01", scheduledDay: "2027-01-02", scheduledTime: "09:00" }, { dueDate: null, scheduledDay: null, urgent: true })).toEqual({
      title: "A",
      notes: "n",
      urgent: true,
    });
    expect(editedInput("updateTask", { taskId: "t1", scheduledDay: "2027-01-02", scheduledTime: "09:00" }, { scheduledDay: null })).toEqual({
      taskId: "t1",
      scheduledDay: null,
      scheduledTime: null,
    });
    // A field that cannot be edited is never taken from the edits.
    expect(editedInput("updateTask", { taskId: "t1", urgent: true }, { taskId: "t2", notes: "x" } as never)).toEqual({ taskId: "t1", urgent: true });
    expect(editedInput("setTaskDone", { taskId: "t1", done: true }, { title: "x" })).toEqual({ taskId: "t1", done: true });
  });

  it("names what the user changed against what the model proposed (or, for a field it left out, the task now)", () => {
    expect(ownerChanges("createTask", { title: "File taxes", urgent: true }, { title: "File taxes", dueDate: "2027-04-02", projectId: "p1" }, lookup)).toEqual([
      { part: "urgent", now: "not urgent", proposed: "urgent" },
      { part: "dueDate", now: "due 2027-04-02", proposed: "no due date" },
      { part: "projectId", now: "in the project “Taxes” (id p1)", proposed: "in no project" },
    ]);
    expect(ownerChanges("updateTask", { taskId: "t1", urgent: false }, { taskId: "t1", urgent: false, scheduledDay: "2027-01-02", scheduledTime: "09:00" }, lookup)).toEqual([
      { part: "scheduled", now: "on 2027-01-02 at 09:00", proposed: "not on the Clock" },
    ]);
    expect(ownerChanges("updateTask", { taskId: "t1", urgent: false }, { taskId: "t1", urgent: false }, lookup)).toEqual([]);
  });

  it("says why an edited change cannot be confirmed: invalid values, or nothing to change", () => {
    expect(editProblem("createTask", { title: "  " }, lookup)).toBe("A task needs a title.");
    expect(editProblem("updateTask", { taskId: "t1", scheduledDay: null, scheduledTime: "09:00" }, lookup)).toBe("A time needs a day.");
    expect(editProblem("updateTask", { taskId: "t1", urgent: true, important: true }, lookup)).toBe(NOTHING_TO_CHANGE);
    expect(editProblem("updateTask", { taskId: "t1", urgent: false }, lookup)).toBeNull();
    // A task the page does not know: only the server can tell.
    expect(updateChangesNothing({ taskId: "t9", urgent: true } as never, lookup)).toBe(false);
  });

  it("draws a create's edits on its draft card as what changes", () => {
    expect(draftChange("draft-c1", { urgent: true, scheduledDay: null })).toEqual({ taskId: "draft-c1", set: { urgent: true, scheduledDay: null, scheduledTime: null } });
  });

  it("cuts a task's notes to what a sentence quotes, and the sentence stays the same", () => {
    const long = `${"word ".repeat(80)}end`;
    const whole = { ...current, notes: long };
    const cut = { ...current, ...sentenceNotes(long) };
    expect(cut.notes!.length).toBeLessThan(long.length);
    const say = (task: LookupTask) => operationSentence(operation("updateTask"), { taskId: "t1", notes: "new" }, { ...lookup, task: () => task });
    expect(say(cut)).toBe(say(whole));
    expect(sentenceNotes("short   note")).toEqual({ notes: "short note" });
    expect(sentenceNotes(null)).toEqual({ notes: null });
  });
});
