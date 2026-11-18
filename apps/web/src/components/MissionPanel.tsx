import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { aiRefineMission } from "@clock-compass/web-client/api";
import { errorMessage } from "@clock-compass/web-client/meta";
import { Button } from "@/components/ui/button";
import { missionQuery, saveMission } from "@/lib/queries/mission";
import { useAiStatus } from "@/lib/queries/ai";
import { toast } from "@/lib/stores/toast";

/** The personal mission statement editor. */
export function MissionPanel() {
  const queryClient = useQueryClient();
  const { data: mission, isPending, error: loadError } = useQuery(missionQuery);
  const save = useMutation(saveMission(queryClient));
  const saving = save.isPending;
  const error = save.error
    ? errorMessage(save.error, "Failed to save mission")
    : loadError && mission === undefined
      ? errorMessage(loadError, "Failed to load mission")
      : null;
  const connected = useAiStatus().connected;
  // null until the user types: until then the editor shows the saved mission,
  // so the draft is seeded once the mission has loaded.
  const [edited, setEdited] = useState<string | null>(null);
  const [refining, setRefining] = useState(false);
  const draft = edited ?? mission?.content ?? "";
  const dirty = draft.trim() !== (mission?.content ?? "").trim();

  // Habit 2: AI refinement edits the DRAFT only — saving stays the user's call.
  async function refine() {
    if (!draft.trim() || refining) return;
    setRefining(true);
    try {
      setEdited((await aiRefineMission(draft.trim())).content);
      toast.success("Draft refined — save to keep it");
    } catch (err) {
      toast.error(errorMessage(err, "Refine failed"));
    } finally {
      setRefining(false);
    }
  }

  function saveDraft() {
    if (!draft.trim()) return;
    save.mutate(draft.trim());
  }

  if (isPending) {
    return <div className="h-56 animate-pulse rounded-lg border border-border bg-card" />;
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Personal mission statement</h2>
          {mission ? (
            <span className="text-xs text-muted-foreground">
              Updated {new Date(mission.updatedAt).toLocaleDateString()}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Begin with the end in mind. This sits at the top of your mission → goals → tasks
          hierarchy. Saving keeps previous versions as history.
        </p>

        <textarea
          value={draft}
          onChange={(e) => setEdited(e.target.value)}
          rows={6}
          aria-label="Personal mission statement"
          placeholder="What matters most? What do you want to be and do?"
          className="w-full resize-y rounded-md border border-border bg-transparent p-3 text-sm leading-relaxed focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />

        {error ? <p className="text-xs text-red-600">{error}</p> : null}

        <div className="flex items-center justify-end gap-2">
          {connected ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refine()}
              disabled={!draft.trim() || refining}
            >
              <Sparkles className="size-4" />
              {refining ? "Refining…" : "Refine with AI"}
            </Button>
          ) : null}
          <Button size="sm" onClick={saveDraft} disabled={!dirty || !draft.trim() || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </section>
  );
}
