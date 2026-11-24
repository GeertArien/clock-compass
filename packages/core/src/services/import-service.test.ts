import { beforeEach, describe, expect, it } from "vitest";
import { ImportService } from "./import-service.js";
import type { CreateTaskInput, TaskService } from "./task-service.js";
import type { ProjectService } from "./project-service.js";

const EXPORT = `TYPE,CONTENT,DESCRIPTION,PRIORITY,DATE
task,Buy groceries,,4,
task,Ship the newsletter,Draft first,2,2026-06-20
note,ignore me,,,
`;

describe("ImportService", () => {
  let created: CreateTaskInput[];
  let projects: { id: string; name: string }[];
  let service: ImportService;

  beforeEach(() => {
    created = [];
    projects = [{ id: "p_existing", name: "Errands" }];

    const tasks = {
      create: async (input: CreateTaskInput) => {
        created.push(input);
        return { id: `t_${created.length}` };
      },
    } as unknown as TaskService;

    const projectService = {
      list: async () => projects,
      create: async ({ name }: { name: string }) => {
        const project = { id: `p_${projects.length + 1}`, name };
        projects.push(project);
        return project;
      },
    } as unknown as ProjectService;

    service = new ImportService(tasks, projectService);
  });

  it("imports tasks with the p-seed flags, notes, due date, and provenance", async () => {
    const result = await service.importTodoist(EXPORT);
    expect(result).toMatchObject({ imported: 2, skipped: 0, projectId: null });
    expect(created[0]).toMatchObject({
      title: "Buy groceries",
      important: false,
      urgent: false,
      source: "TODOIST",
      externalPriority: 4,
    });
    expect(created[1]).toMatchObject({
      title: "Ship the newsletter",
      notes: "Draft first",
      important: true,
      urgent: false,
      externalPriority: 2,
    });
    expect(created[1]!.dueDate?.getFullYear()).toBe(2026);
  });

  it("keeps a recurring phrase in the notes instead of dropping it (#105 follow-up)", async () => {
    const csv = `TYPE,CONTENT,DESCRIPTION,PRIORITY,DATE
task,Buitenkraan afsluiten,Hoofdkraan in de kelder,2,every year
task,Water the plants,,4,elke maandag
`;
    await service.importTodoist(csv);
    expect(created.map((t) => [t.title, t.notes, t.dueDate ?? null])).toEqual([
      ["Buitenkraan afsluiten", "Hoofdkraan in de kelder\n\nRepeats in Todoist: every year", null],
      ["Water the plants", "Repeats in Todoist: elke maandag", null],
    ]);
  });

  it("groups tasks under an existing project by case-insensitive name", async () => {
    const result = await service.importTodoist(EXPORT, { projectName: "errands" });
    expect(result.projectId).toBe("p_existing");
    expect(created.every((t) => t.projectId === "p_existing")).toBe(true);
  });

  it("creates the project when the name is new", async () => {
    const result = await service.importTodoist(EXPORT, { projectName: "Newsletter" });
    expect(result.projectId).toBe("p_2");
    expect(projects.map((p) => p.name)).toContain("Newsletter");
  });

  it("counts failed rows as skipped without aborting the import", async () => {
    let calls = 0;
    const flaky = {
      create: async (input: CreateTaskInput) => {
        if (++calls === 1) throw new Error("boom");
        created.push(input);
        return { id: "t" };
      },
    } as unknown as TaskService;
    const svc = new ImportService(flaky, { list: async () => [] } as unknown as ProjectService);
    const result = await svc.importTodoist(EXPORT);
    expect(result).toMatchObject({ imported: 1, skipped: 1 });
  });
});
