import {
  mutationOptions,
  queryOptions,
  useQuery,
  type QueryClient,
} from "@tanstack/react-query";
import {
  codexDisconnect,
  getAiStatus,
  getCodexLogin,
  getCodexStatus,
  startCodexDevice,
  type CodexLogin,
} from "@clock-compass/web-client/api";
import { errorMessage } from "@clock-compass/web-client/meta";
import { toast } from "@/lib/stores/toast";

// --- AI provider status: gates the ✦ surfaces ------------------------------

export interface AiStatus {
  /** A provider is configured on the server. */
  available: boolean;
  /** Ready to call right now (for sign-in providers, an account is connected). */
  connected: boolean;
  /** The provider connects via sign-in (Codex / ChatGPT subscription). */
  oauth: boolean;
}

const AI_OFF: AiStatus = { available: false, connected: false, oauth: false };

/** Everything AI-related refetches together (after a sign-in or sign-out). */
const AI_KEY = ["ai"] as const;

export const aiStatusQuery = queryOptions({
  queryKey: [...AI_KEY, "status"],
  // A failed check means no AI: the ✦ surfaces hide, nothing shows an error.
  queryFn: async (): Promise<AiStatus> => {
    try {
      const { available, connected, oauth } = await getAiStatus();
      return { available, connected, oauth };
    } catch {
      return AI_OFF;
    }
  },
});

/** The AI status; everything off until it has loaded. */
export function useAiStatus(): AiStatus {
  return useQuery(aiStatusQuery).data ?? AI_OFF;
}

// --- ChatGPT subscription sign-in (Codex device code) ------------------------

/** The persisted connection; refreshed each time Settings opens. */
export const codexStatusQuery = queryOptions({
  queryKey: [...AI_KEY, "codex"],
  queryFn: async () => {
    try {
      return await getCodexStatus();
    } catch {
      return null;
    }
  },
  refetchOnMount: "always",
});

export type CodexPhase = "idle" | "starting" | "pending" | "error";

export interface CodexFlow {
  phase: CodexPhase;
  userCode: string;
  verificationUri: string;
  errorMsg: string;
}

const IDLE: CodexFlow = { phase: "idle", userCode: "", verificationUri: "", errorMsg: "" };

export const CODEX_POLL_MS = 3000;

/**
 * The sign-in in progress. Client state, not server data, kept in the query
 * cache so it outlives the Settings sheet: a reopened sheet shows the same
 * pending code. Never fetched (so no invalidation can reset it mid-flow); only
 * the mutations and the poll below write it.
 */
export const codexFlowQuery = queryOptions({
  queryKey: ["codex-flow"],
  queryFn: () => IDLE,
  initialData: IDLE,
  enabled: false,
  gcTime: Infinity,
});

function flow(client: QueryClient): CodexFlow {
  return client.getQueryData(codexFlowQuery.queryKey) ?? IDLE;
}

function setFlow(client: QueryClient, next: CodexFlow): void {
  client.setQueryData(codexFlowQuery.queryKey, next);
}

/**
 * Poll the server's login state while `current` is pending. Mounted from the
 * app shell (useCodexPolling), so it keeps polling while Settings is closed and
 * an approval made in another tab still connects the AI surfaces. Keyed by the
 * code, so each sign-in polls afresh; a request error is transient and the
 * interval keeps waiting. It pauses while the tab is hidden (the user is
 * approving at ChatGPT in another tab) and polls again on return, so the
 * "connected" toast is seen; the server keeps the connection until then.
 */
export function codexPoll(current: CodexFlow) {
  return queryOptions({
    queryKey: ["codex-login", current.userCode],
    queryFn: async ({ client }): Promise<CodexLogin> => {
      const login = await getCodexLogin();
      // A poll answered after the flow moved on (disconnected, restarted) is stale.
      const now = flow(client);
      if (now.phase !== "pending" || now.userCode !== current.userCode) return login;
      if (login.state === "connected") {
        setFlow(client, IDLE);
        toast.success("ChatGPT connected");
        void client.invalidateQueries({ queryKey: AI_KEY });
      } else if (login.state === "error" || login.state === "idle") {
        // "idle": the server dropped the flow (e.g. it restarted).
        setFlow(client, {
          ...now,
          phase: "error",
          errorMsg: login.state === "error" ? login.message : "Sign-in was interrupted — try again.",
        });
      }
      return login;
    },
    enabled: current.phase === "pending",
    refetchInterval: CODEX_POLL_MS,
    // A failed poll just keeps waiting: no "couldn't refresh" toast.
    meta: { quiet: true },
    gcTime: 0,
  });
}

/** Run the sign-in poll for as long as the app is open. */
export function useCodexPolling(): void {
  const current = useQuery(codexFlowQuery).data;
  useQuery(codexPoll(current));
}

/** Start a sign-in: the server hands out a device code to enter at ChatGPT. */
export const connectCodex = mutationOptions({
  mutationKey: ["codex-flow", "connect"],
  mutationFn: () => startCodexDevice(),
  onMutate: (_vars, { client }) => setFlow(client, { ...IDLE, phase: "starting" }),
  onSuccess: (start, _vars, _ctx, { client }) =>
    setFlow(client, {
      phase: "pending",
      userCode: start.userCode,
      verificationUri: start.verificationUri,
      errorMsg: "",
    }),
  onError: (err, _vars, _ctx, { client }) =>
    setFlow(client, { ...IDLE, phase: "error", errorMsg: errorMessage(err, "Couldn't start sign-in.") }),
});

export const disconnectCodex = mutationOptions({
  mutationKey: ["codex-flow", "disconnect"],
  mutationFn: () => codexDisconnect(),
  onSuccess: (_data, _vars, _ctx, { client }) => {
    setFlow(client, IDLE); // stops any poll
    toast.success("ChatGPT disconnected");
    void client.invalidateQueries({ queryKey: AI_KEY });
  },
  onError: (err) => toast.error(errorMessage(err, "Couldn't disconnect")),
});
