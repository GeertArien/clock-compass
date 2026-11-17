import {
  codexDisconnect,
  getCodexLogin,
  getCodexStatus,
  startCodexDevice,
  type CodexStatus,
} from "@clock-compass/web-client/api";
import { errorMessage } from "@clock-compass/web-client/meta";
import { Store } from "./store";
import { aiStore } from "./ai";
import { toast } from "./toast";

export type CodexPhase = "idle" | "starting" | "pending" | "error";

interface CodexState {
  status: CodexStatus | null;
  phase: CodexPhase;
  userCode: string;
  verificationUri: string;
  errorMsg: string;
}

export const CODEX_POLL_MS = 3000;

/**
 * ChatGPT subscription sign-in (Codex device code). The flow lives here, not
 * in the Settings card, so it outlives the sheet: in apps/web the card stays
 * mounted while Settings is closed and keeps polling, so an approval made in
 * another tab still connects the AI surfaces. Mirrors CodexConnect.svelte.
 */
export class CodexStore extends Store<CodexState> {
  #timer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped whenever polling stops, so a poll already in flight can't restart it. */
  #generation = 0;

  constructor() {
    super({ status: null, phase: "idle", userCode: "", verificationUri: "", errorMsg: "" });
  }

  /** Refresh the persisted connection state. Called when Settings opens. */
  async load(): Promise<void> {
    try {
      this.setState({ status: await getCodexStatus() });
    } catch {
      this.setState({ status: null });
    }
  }

  stopPolling(): void {
    this.#generation++;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  async connect(): Promise<void> {
    this.stopPolling();
    this.setState({ phase: "starting", errorMsg: "" });
    try {
      const start = await startCodexDevice();
      this.setState({
        phase: "pending",
        userCode: start.userCode,
        verificationUri: start.verificationUri,
      });
      this.#poll();
    } catch (err) {
      this.setState({ phase: "error", errorMsg: errorMessage(err, "Couldn't start sign-in.") });
    }
  }

  async disconnect(): Promise<void> {
    try {
      await codexDisconnect();
      this.stopPolling();
      this.setState({ phase: "idle" });
      toast.success("ChatGPT disconnected");
      await this.load();
      await aiStore.check();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't disconnect"));
    }
  }

  // The server waits for approval in the background; we poll its login state.
  #poll(): void {
    this.stopPolling();
    const gen = this.#generation;
    this.#timer = setTimeout(async () => {
      this.#timer = null;
      try {
        const login = await getCodexLogin();
        if (gen !== this.#generation) return;
        if (login.state === "connected") {
          this.setState({ phase: "idle" });
          toast.success("ChatGPT connected");
          await this.load();
          await aiStore.check();
          return;
        }
        if (login.state === "error" || login.state === "idle") {
          // "idle": the server dropped the flow (e.g. it restarted).
          this.setState({
            phase: "error",
            errorMsg:
              login.state === "error" ? login.message : "Sign-in was interrupted — try again.",
          });
          return;
        }
      } catch {
        // transient — keep waiting
      }
      if (gen === this.#generation) this.#poll();
    }, CODEX_POLL_MS);
  }
}

export const codexStore = new CodexStore();
