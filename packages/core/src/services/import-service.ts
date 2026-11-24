import {
  parseTodoistCsv,
  parseTodoistDate,
  todoistNotes,
  priorityToFlags,
} from "../domain/todoist.js";
import type { TaskService } from "./task-service.js";
import type { ProjectService } from "./project-service.js";

export interface TodoistImportResult {
  imported: number;
  skipped: number;
  projectId: string | null;
}

/**
 * Todoist CSV import (build-order step 8). The upload is a one-shot file from
 * the user — no credentials are ever stored. Tasks are seeded into quadrants
 * from p1–p4 and marked source=TODOIST so the AI can refine them later.
 */
export class ImportService {
  constructor(
    private readonly tasks: TaskService,
    private readonly projects: ProjectService,
  ) {}

  /**
   * Import one export file. `projectName` (usually the file name) groups the
   * tasks under a Project — found by name or created; empty = Inbox.
   */
  async importTodoist(
    csv: string,
    options: { projectName?: string } = {},
  ): Promise<TodoistImportResult> {
    const rows = parseTodoistCsv(csv);

    let projectId: string | null = null;
    const name = options.projectName?.trim();
    if (name && rows.length > 0) {
      const existing = (await this.projects.list()).find(
        (p) => p.name.toLowerCase() === name.toLowerCase(),
      );
      projectId = existing
        ? existing.id
        : (await this.projects.create({ name })).id;
    }

    let imported = 0;
    let skipped = 0;
    for (const row of rows) {
      try {
        const flags = priorityToFlags(row.priority);
        await this.tasks.create({
          title: row.content,
          notes: todoistNotes(row),
          important: flags.important,
          urgent: flags.urgent,
          dueDate: parseTodoistDate(row.date),
          projectId,
          source: "TODOIST",
          externalPriority: row.priority,
        });
        imported++;
      } catch {
        skipped++;
      }
    }
    return { imported, skipped, projectId };
  }
}
