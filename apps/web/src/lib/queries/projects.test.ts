import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryObserver, type QueryClient } from "@tanstack/react-query";
import type { Project } from "@clock-compass/web-client/api";
import { run, testQueryClient, tick } from "./test-client";

const api = vi.hoisted(() => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(async () => undefined),
}));
vi.mock("@clock-compass/web-client/api", () => api);
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/stores/toast", () => ({ toast: toastMock }));
const tasksMock = vi.hoisted(() => ({ reloadTasks: vi.fn(async () => undefined) }));
vi.mock("./tasks", () => tasksMock);

const {
  addProject,
  editProject,
  projectGoalEdit,
  projectStatusEdit,
  projectsQuery,
  refreshProjects,
  removeProject,
} = await import("./projects");

const project = (id: string, name = id): Project => ({
  id,
  name,
  description: null,
  status: "ACTIVE",
  goalId: null,
  progress: { total: 0, done: 0, ratio: 0 },
  createdAt: "2026-07-06T00:00:00.000Z",
  updatedAt: "2026-07-06T00:00:00.000Z",
});

/** A request that stays in flight until the test settles it. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

let client: QueryClient;
const projects = () => client.getQueryData(projectsQuery.queryKey) ?? [];
const ids = () => projects().map((p) => p.id);

describe("projects query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listProjects.mockReset();
    api.updateProject.mockReset();
    client = testQueryClient();
    client.setQueryData(projectsQuery.queryKey, [project("a"), project("b")]);
  });

  it("adds with a placeholder first, replaced by the created project", async () => {
    const request = deferred<Project>();
    api.createProject.mockReturnValueOnce(request.promise);
    const pending = run(client, addProject, { name: "Newsletter" });
    await tick();
    expect(projects()[0]).toMatchObject({ name: "Newsletter", status: "ACTIVE" });
    expect(projects()[0]!.id).toMatch(/^temp_/);
    request.resolve(project("c", "Newsletter"));
    await pending;
    expect(ids()).toEqual(["c", "a", "b"]);
    expect(toastMock.success).toHaveBeenCalledWith("Project added");
  });

  it("a failed add drops its placeholder", async () => {
    api.createProject.mockRejectedValueOnce(new Error("offline"));
    await run(client, addProject, { name: "Newsletter" });
    expect(ids()).toEqual(["a", "b"]);
    expect(toastMock.error).toHaveBeenCalledWith("offline");
  });

  it.each(["first-first", "second-first"] as const)(
    "a status change and a goal link, both failing (%s), end as before",
    async (order) => {
      const s = deferred<Project>();
      const g = deferred<Project>();
      api.updateProject.mockReturnValueOnce(s.promise).mockReturnValueOnce(g.promise);
      const first = run(client, editProject, projectStatusEdit(projects()[0]!, "SOMEDAY"));
      await tick();
      const second = run(client, editProject, projectGoalEdit(projects()[0]!, "g1"));
      await tick();
      expect(projects()[0]).toMatchObject({ status: "SOMEDAY", goalId: "g1" });
      if (order === "first-first") {
        s.reject(new Error("offline"));
        await first;
        g.reject(new Error("offline"));
        await second;
      } else {
        g.reject(new Error("offline"));
        await second;
        s.reject(new Error("offline"));
        await first;
      }
      expect(projects()[0]).toMatchObject({ status: "ACTIVE", goalId: null });
    },
  );

  it("a failed edit keeps a later edit's success", async () => {
    const s = deferred<Project>();
    api.updateProject
      .mockReturnValueOnce(s.promise)
      .mockResolvedValueOnce({ ...project("a"), goalId: "g1" });
    const first = run(client, editProject, projectStatusEdit(projects()[0]!, "DONE"));
    await tick();
    await run(client, editProject, projectGoalEdit(projects()[0]!, "g1"));
    s.reject(new Error("500"));
    await first;
    expect(projects()[0]).toMatchObject({ status: "ACTIVE", goalId: "g1" });
  });

  it("a failed delete during an edit puts back the server's version, in place", async () => {
    const edit = deferred<Project>();
    const del = deferred<undefined>();
    api.updateProject.mockReturnValueOnce(edit.promise);
    api.deleteProject.mockReturnValueOnce(del.promise);
    const editing = run(client, editProject, projectStatusEdit(projects()[0]!, "DONE"));
    await tick();
    const deleting = run(client, removeProject, projects()[0]!);
    await tick();
    expect(ids()).toEqual(["b"]);
    edit.reject(new Error("offline"));
    await editing;
    del.reject(new Error("offline"));
    await deleting;
    expect(ids()).toEqual(["a", "b"]);
    expect(projects()[0]).toMatchObject({ status: "ACTIVE" });
  });

  it("deleting a project reloads the tasks, success or failure, without the screen", async () => {
    await run(client, removeProject, projects()[0]!);
    expect(toastMock.success).toHaveBeenCalledWith("Project deleted — its tasks moved to the Inbox");
    expect(tasksMock.reloadTasks).toHaveBeenCalledTimes(1);
    api.deleteProject.mockRejectedValueOnce(new Error("in use"));
    await run(client, removeProject, projects()[0]!);
    expect(tasksMock.reloadTasks).toHaveBeenCalledTimes(2);
  });

  it("a silent refresh that fails keeps what's shown, with no error", async () => {
    api.listProjects.mockRejectedValueOnce(new Error("offline"));
    await refreshProjects(client);
    expect(ids()).toEqual(["a", "b"]);
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(client.getQueryState(projectsQuery.queryKey)?.status).toBe("success");
  });

  it("one project's selection stays the same object when another project changes", async () => {
    // What useProject gives a task card: no re-render for another project's counts.
    const one = new QueryObserver(client, {
      ...projectsQuery,
      select: (list: Project[]) => list.find((p) => p.id === "a"),
    });
    const unsubscribe = one.subscribe(() => {});
    const before = one.getCurrentResult().data;
    api.listProjects.mockResolvedValueOnce([
      project("a"),
      { ...project("b"), progress: { total: 3, done: 1, ratio: 1 / 3 } },
    ]);
    await refreshProjects(client);
    expect(one.getCurrentResult().data).toBe(before);
    unsubscribe();
  });
});
