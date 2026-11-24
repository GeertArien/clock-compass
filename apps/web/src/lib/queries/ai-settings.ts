import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import {
  addAiProvider,
  getAiSettings,
  removeAiProvider,
  setAiDataPolicy,
  setAiJobs,
  updateAiProvider,
  type AiJobKey,
  type AiProviderInput,
  type AiProviderView,
  type AiSettings,
} from "@clock-compass/web-client/api";
import { errorMessage } from "@clock-compass/web-client/meta";
import { toast } from "@/lib/stores/toast";

/**
 * Settings → AI (#94): providers, a provider and model per job, and what data
 * AI may use. Server data: the server checks every change (addresses, models,
 * which token may change it), so the edits here wait for its answer instead
 * of showing a guess, and refresh everything AI-related afterwards (the ✦
 * surfaces follow the job choices). Keys go to the server and never come back.
 */
const AI_KEY = ["ai"] as const;

export const aiSettingsQuery = queryOptions({
  queryKey: [...AI_KEY, "settings"],
  queryFn: getAiSettings,
  // Only Settings shows it, and only the owner's token may read it.
  refetchOnMount: "always",
});

/** After a change: the settings and the AI status (✦ surfaces) reload together. */
function refresh(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: AI_KEY });
}

/** A refusal in the server's words (an address, a model, the token), as a toast. */
function refused(what: string) {
  return (err: Error) => toast.error(`${what}: ${errorMessage(err)}`);
}

export type ProviderSave = { id?: string; input: AiProviderInput };

export const saveProvider = mutationOptions<AiProviderView, Error, ProviderSave>({
  mutationFn: ({ id, input }) => (id ? updateAiProvider(id, input) : addAiProvider(input)),
  onSuccess: (saved, { id }, _ctx, { client }) => {
    toast.success(id ? `${saved.name} saved` : `${saved.name} added`);
    return refresh(client);
  },
  onError: refused("Not saved"),
});

export const removeProvider = mutationOptions<void, Error, AiProviderView>({
  mutationFn: (provider) => removeAiProvider(provider.id),
  onSuccess: (_void, provider, _ctx, { client }) => {
    toast.success(`${provider.name} removed`);
    return refresh(client);
  },
  onError: refused("Not removed"),
});

export type JobChoice = { job: AiJobKey; providerId: string | null; model: string | null };

/**
 * Change one job's choice. The server takes the whole list, so the others are
 * sent as they are; "use the default" is a job left out.
 */
export const saveJob = mutationOptions<void, Error, JobChoice>({
  mutationFn: (choice, { client }) => {
    const current = client.getQueryData<AiSettings>(aiSettingsQuery.queryKey)?.jobs ?? [];
    const others = current
      .filter((j) => j.job !== choice.job && j.providerId)
      .map(({ job, providerId, model }) => ({ job, providerId, model }));
    return setAiJobs(choice.providerId ? [...others, choice] : others);
  },
  onSuccess: (_void, _choice, _ctx, { client }) => refresh(client),
  onError: refused("Not saved"),
});

export const saveSwitch = mutationOptions<void, Error, { category: string; enabled: boolean }>({
  mutationFn: (s) => setAiDataPolicy([s]),
  onSuccess: (_void, _s, _ctx, { client }) => refresh(client),
  onError: refused("Not saved"),
});

/** How Settings names each job. */
export const JOB_LABELS: Record<AiJobKey, string> = {
  default: "Default (every job without its own choice)",
  assistant: "Assistant",
  classifyTask: "Task classification",
  tagProactivity: "Influence or concern",
  refineMission: "Mission refinement",
  weeklyReview: "Weekly review",
};

/** How Settings names each data category. */
export const CATEGORY_LABELS: Record<string, string> = {
  tasks: "Tasks",
  taskNotes: "Task notes",
  goalsAndProjects: "Goals, projects and roles",
  mission: "Mission",
  people: "People and commitments (names, status, streaks)",
  personNotes: "Notes on people",
  ebaBalance: "Emotional-bank-account balance",
  ebaEntryNotes: "Emotional-bank-account entry notes",
  habitsAndRenewal: "Habits and renewal (including this week's intentions)",
};

export const KIND_LABELS = {
  anthropic: "Anthropic",
  "openai-compatible": "OpenAI-compatible (OpenAI, a local model, a gateway)",
  codex: "ChatGPT subscription",
} as const;
