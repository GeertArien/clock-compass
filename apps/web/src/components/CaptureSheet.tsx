import { useState } from "react";
import { Sparkles, Star } from "lucide-react";
import { aiClassify, aiIntake, type TaskClassification } from "@clock-compass/web-client/api";
import { deriveQuadrant, errorMessage } from "@clock-compass/web-client/meta";
import { Button } from "@/components/ui/button";
import { AppSheet } from "@/components/ui/app-sheet";
import { useAiStatus } from "@/lib/queries/ai";
import { tasksStore } from "@/lib/stores/tasks";
import { toast } from "@/lib/stores/toast";

const tag =
  "rounded-full border border-[#ddd6ea] bg-card px-2.5 py-1 text-[0.71875rem] font-semibold text-foreground/80";

/**
 * Half-typed text kept between opens: closing capture without saving (back,
 * Escape, tapping outside) keeps it for the next open. A capture or Cancel
 * clears it. Memory only, so a reload starts empty.
 */
let draft = "";

/**
 * Capture: with AI connected, a plain sentence is
 * classified and created by the server; without it, a quick-add to the Inbox.
 * The shell remounts it on every open; the text starts from the draft above.
 */
export function CaptureSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const connected = useAiStatus().connected;
  const [text, setTextState] = useState(() => draft);
  const setText = (value: string) => {
    draft = value;
    setTextState(value);
  };
  const [preview, setPreview] = useState<TaskClassification | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  const quadrant = preview ? deriveQuadrant(preview.important, preview.urgent) : null;

  async function doPreview() {
    const sentence = text.trim();
    if (!sentence || previewing) return;
    setPreviewing(true);
    try {
      setPreview(await aiClassify(sentence));
    } catch (err) {
      toast.error(errorMessage(err, "Classification failed"));
    } finally {
      setPreviewing(false);
    }
  }

  async function save(asBigRock: boolean) {
    const sentence = text.trim();
    if (!sentence || saving) return;
    setSaving(true);
    try {
      if (connected) {
        const { task } = await aiIntake(sentence);
        await tasksStore.load();
        if (asBigRock) {
          const created = tasksStore.state.tasks.find((t) => t.id === task.id);
          if (created) await tasksStore.toggleBigRock(created);
        }
        toast.success("Captured");
      } else {
        // No AI configured: capture is a plain quick-add into the Inbox.
        await tasksStore.add({ title: sentence });
      }
      draft = "";
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, "Capture failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Capture"
      description={
        connected
          ? "A plain sentence — the AI fills in quadrant, tags, and date."
          : "Quick-add a task to the Inbox."
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              draft = "";
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void save(true)}
            disabled={saving || !text.trim()}
          >
            {/* 16px: the design forces button icons to size-4. */}
            <Star className="size-4" />
            Big rock
          </Button>
          <Button size="sm" onClick={() => void save(false)} disabled={saving || !text.trim()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          aria-label="Capture"
          placeholder="Take Noor to the climbing gym Saturday morning…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save(false);
          }}
          className="w-full resize-none rounded-xl border border-input bg-transparent p-3 text-sm leading-relaxed focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />

        {connected ? (
          preview ? (
            <div className="flex flex-col gap-2 rounded-xl border border-[#ddd6ea] bg-[var(--plum-soft)] p-3">
              <p className="flex items-center gap-1.5 text-[0.65625rem] font-bold tracking-[0.14em] text-[var(--plum)] uppercase">
                <Sparkles className="size-3" />
                AI understood
              </p>
              <div className="flex flex-wrap gap-1.5">
                <span className="rounded-full border border-[#bcd8cc] bg-[var(--pine-soft)] px-2.5 py-1 text-[0.71875rem] font-semibold text-[var(--pine)]">
                  {quadrant}
                </span>
                <span className={tag}>{preview.title}</span>
                {preview.dueDate ? (
                  <span className={tag}>
                    📅{" "}
                    {new Date(preview.dueDate).toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                ) : null}
                {preview.proactivity ? (
                  <span className={tag}>
                    {preview.proactivity === "INFLUENCE" ? "⊙ influence" : "◌ concern"}
                  </span>
                ) : null}
              </div>
              <p className="font-display text-xs text-muted-foreground italic">{preview.rationale}</p>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void doPreview()}
              disabled={!text.trim() || previewing}
              className="self-start"
            >
              <Sparkles className="size-4" />
              {previewing ? "Thinking…" : "Preview"}
            </Button>
          )
        ) : null}
      </div>
    </AppSheet>
  );
}
