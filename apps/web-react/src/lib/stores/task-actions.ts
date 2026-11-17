import type { Task } from "@clock-compass/web-client/api";
import { Store } from "./store";

interface TaskActionsState {
  editing: Task | null;
  editOpen: boolean;
  /** Bumped on every open, so the form remounts and re-seeds its fields. */
  editSeq: number;
  deleting: Task | null;
  deleteOpen: boolean;
}

/**
 * Shared UI state for editing/deleting a task. Task cards live in several
 * panels, so one edit sheet and one confirm dialog are mounted in the app shell
 * and driven through this store rather than one per card.
 */
export class TaskActions extends Store<TaskActionsState> {
  constructor() {
    super({ editing: null, editOpen: false, editSeq: 0, deleting: null, deleteOpen: false });
  }

  /** Open the form sheet to edit an existing task, or create one with `null`. */
  edit(task: Task | null): void {
    this.setState({ editing: task, editOpen: true, editSeq: this.state.editSeq + 1 });
  }

  create(): void {
    this.edit(null);
  }

  setEditOpen(open: boolean): void {
    this.setState({ editOpen: open });
  }

  askDelete(task: Task): void {
    this.setState({ deleting: task, deleteOpen: true });
  }

  setDeleteOpen(open: boolean): void {
    this.setState({ deleteOpen: open });
  }
}

export const taskActions = new TaskActions();
