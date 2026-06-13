import { getAiStatus } from "@/lib/api";

/** AI provider status — gates the ✦ surfaces and the sign-in card in Settings. */
class AiStore {
  /** A provider is configured on the server. */
  available = $state(false);
  /** Ready to call right now (for sign-in providers, an account is connected). */
  connected = $state(false);
  /** The provider connects via sign-in (Codex / ChatGPT subscription). */
  oauth = $state(false);

  async check(): Promise<void> {
    try {
      const status = await getAiStatus();
      this.available = status.available;
      this.connected = status.connected;
      this.oauth = status.oauth;
    } catch {
      this.available = false;
      this.connected = false;
      this.oauth = false;
    }
  }
}

export const aiStore = new AiStore();
