import { useMemo, useState } from "react";
import { ChevronRight, FolderOpen, Inbox, Plus, Trash2, TriangleAlert } from "lucide-react";
import type { Goal, Project, ProjectStatus, Role } from "@clock-compass/web-client/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { useStore } from "@/lib/stores/store";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@clock-compass/web-client/meta";
import {
  PROJECT_STATUS_LABELS,
  addProject as addProjectMutation,
  editProject,
  projectGoalEdit,
  projectStatusEdit,
  projectsQuery,
  refreshProjects,
  removeProject,
} from "@/lib/queries/projects";
import { useGoals } from "@/lib/queries/goals";
import { useRoles } from "@/lib/queries/roles";
import { tasksStore } from "@/lib/stores/tasks";
import { TaskCard } from "./TaskCard";
import { useSheet } from "./use-sheet";

const statuses: ProjectStatus[] = ["ACTIVE", "SOMEDAY", "DONE"];
const field =
  "rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** "Goal › Role" for a project, or null when it serves no goal. */
function lineage(project: Project, goals: Goal[], roles: Role[]): string | null {
  const goal = goals.find((g) => g.id === project.goalId);
  if (!goal) return null;
  const role = goal.roleId ? roles.find((r) => r.id === goal.roleId) : undefined;
  return role ? `${goal.title} › ${role.name}` : goal.title;
}

const NO_PROJECTS: Project[] = [];

/** Compass · Projects, with the Inbox of loose tasks. */
export function ProjectsPanel() {
  const queryClient = useQueryClient();
  const query = useQuery(projectsQuery);
  const all = query.data ?? NO_PROJECTS;
  // A load error shows until Retry starts, as it did.
  const error =
    query.isError && !query.isFetching
      ? errorMessage(query.error, "Failed to load projects")
      : null;
  const add = useMutation(addProjectMutation);
  const edit = useMutation(editProject);
  const remove = useMutation(removeProject);
  const goals = useGoals();
  const roles = useRoles();
  const tasks = useStore(tasksStore, (s) => s.tasks);
  const deleting = useSheet<Project>();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newGoalId, setNewGoalId] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");

  const loadingFirst = query.isFetching && all.length === 0;
  // Done projects sink to the bottom.
  const projects = useMemo(
    () => [...all].sort((a, b) => Number(a.status === "DONE") - Number(b.status === "DONE")),
    [all],
  );
  const inboxTasks = tasks.filter((t) => !t.projectId && t.status !== "DONE");

  function toggle(id: string) {
    setExpanded(expanded === id ? null : id);
    setNewTaskTitle("");
  }

  async function addProject() {
    const name = newName.trim();
    if (!name) return;
    await add.mutateAsync({ name, goalId: newGoalId || undefined }).catch(() => {});
    setNewName("");
    setNewGoalId("");
  }

  async function addTask(project: Project) {
    const title = newTaskTitle.trim();
    if (!title) return;
    // Project tasks default to Q2 (important, not urgent) and inherit the goal.
    await tasksStore.add({
      title,
      important: true,
      projectId: project.id,
      goalId: project.goalId ?? undefined,
    });
    setNewTaskTitle("");
    void refreshProjects(queryClient);
  }

  return (
    <>
      <section className="flex flex-col gap-4">
        {error ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-[var(--terra)] bg-[var(--terra-soft)] px-3 py-2 text-sm text-[var(--terra)]">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </div>
        ) : null}

        {/* New project */}
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-sm sm:flex-row">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="An outcome worth pursuing…"
            onKeyDown={(e) => {
              if (e.key === "Enter") void addProject();
            }}
            className={cn("flex-1", field)}
          />
          <select
            value={newGoalId}
            onChange={(e) => setNewGoalId(e.target.value)}
            aria-label="Serves which goal?"
            className="rounded-md border border-input bg-transparent px-2 py-2 text-sm text-muted-foreground"
          >
            <option value="">— no goal yet —</option>
            {goals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.title}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={() => void addProject()} disabled={!newName.trim()}>
            <Plus className="size-4" />
            Project
          </Button>
        </div>

        {loadingFirst ? (
          <div className="flex flex-col gap-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl border border-border bg-card" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title="No projects yet"
            hint="A project is any outcome that takes more than one step — “Launch the newsletter”, “Plan the trip”."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {projects.map((project) => {
              const lin = lineage(project, goals, roles);
              const open = expanded === project.id;
              const projectTasks = tasks.filter((t) => t.projectId === project.id);
              return (
                <div key={project.id} className="rounded-xl border border-border bg-card shadow-sm">
                  <button
                    type="button"
                    onClick={() => toggle(project.id)}
                    className="flex w-full items-start gap-2.5 p-3 text-left"
                    aria-expanded={open}
                  >
                    <ChevronRight
                      className={cn(
                        "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
                        open && "rotate-90",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-display text-[0.9375rem] font-semibold">
                          {project.name}
                        </h3>
                        <span className="text-xs text-muted-foreground">
                          {project.progress.done} / {project.progress.total}
                        </span>
                      </div>
                      {lin ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">Goal: {lin}</p>
                      ) : (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--gold)]">
                          <TriangleAlert className="size-3" />
                          Not linked to a goal — worth doing, or worth dropping?
                        </p>
                      )}
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2.5 py-0.5 text-[0.6875rem] font-semibold",
                        project.status === "ACTIVE"
                          ? "bg-[var(--pine-soft)] text-[var(--pine)]"
                          : project.status === "DONE"
                            ? "bg-[var(--plum-soft)] text-[var(--plum)]"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {PROJECT_STATUS_LABELS[project.status]}
                    </span>
                  </button>

                  {open ? (
                    <div className="border-t border-border bg-secondary/40 p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <select
                          value={project.goalId ?? ""}
                          onChange={(e) =>
                            edit.mutate(projectGoalEdit(project, e.currentTarget.value || null))
                          }
                          aria-label="Serves which goal?"
                          className="rounded-md border border-input bg-transparent px-2 py-1 text-xs text-muted-foreground"
                        >
                          <option value="">— no goal —</option>
                          {goals.map((goal) => (
                            <option key={goal.id} value={goal.id}>
                              {goal.title}
                            </option>
                          ))}
                        </select>
                        <select
                          value={project.status}
                          onChange={(e) =>
                            edit.mutate(
                              projectStatusEdit(project, e.currentTarget.value as ProjectStatus),
                            )
                          }
                          aria-label="Project status"
                          className="rounded-md border border-input bg-transparent px-2 py-1 text-xs text-muted-foreground"
                        >
                          {statuses.map((s) => (
                            <option key={s} value={s}>
                              {PROJECT_STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => deleting.show(project)}
                          aria-label="Delete project"
                          title="Delete (tasks go back to the Inbox)"
                          className="ml-auto flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>

                      <div className="flex flex-col gap-2">
                        {projectTasks.length === 0 ? (
                          <p className="py-1 text-center font-display text-sm text-muted-foreground italic">
                            No tasks yet.
                          </p>
                        ) : (
                          projectTasks.map((task) => <TaskCard key={task.id} task={task} />)
                        )}
                      </div>

                      <div className="mt-2 flex gap-2">
                        <input
                          value={newTaskTitle}
                          onChange={(e) => setNewTaskTitle(e.target.value)}
                          placeholder="Add a task…"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void addTask(project);
                          }}
                          className="flex-1 rounded-md border border-input bg-card px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        />
                        <Button variant="outline" size="sm" onClick={() => void addTask(project)}>
                          Add
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {/* Inbox: loose tasks with no project */}
        <div className="flex flex-col gap-2 rounded-xl border border-dashed border-input bg-secondary/40 p-3">
          <div className="flex items-center gap-2">
            <Inbox className="size-4 text-muted-foreground" />
            <h3 className="font-display text-[0.9375rem] font-semibold">Inbox</h3>
            <span className="text-xs text-muted-foreground">{inboxTasks.length} unsorted</span>
          </div>
          <div className="flex flex-col gap-2">
            {inboxTasks.length === 0 ? (
              <p className="py-1 text-center font-display text-sm text-muted-foreground italic">
                Inbox empty.
              </p>
            ) : (
              inboxTasks.map((task) => (
                <div key={task.id} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <TaskCard task={task} />
                  </div>
                  {projects.length > 0 ? (
                    <select
                      value=""
                      onChange={(e) => {
                        const id = e.currentTarget.value;
                        if (id) void tasksStore.setProject(task, id);
                      }}
                      aria-label="Move to project"
                      className="max-w-28 shrink-0 rounded-md border border-input bg-transparent px-1.5 py-1 text-[0.6875rem] text-muted-foreground"
                    >
                      <option value="">move to…</option>
                      {projects
                        .filter((p) => p.status !== "DONE")
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={deleting.open}
        onOpenChange={deleting.setOpen}
        title="Delete project?"
        description={
          deleting.item
            ? `“${deleting.item.name}” will be removed. Its tasks go back to the Inbox.`
            : ""
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          const project = deleting.item;
          if (project) remove.mutate(project); // reloads the tasks itself
        }}
      />
    </>
  );
}
