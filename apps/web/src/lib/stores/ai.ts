import { getAiStatus } from "@clock-compass/web-client/api";
import { Store } from "./store";

interface AiState {
  /** A provider is configured on the server. */
  available: boolean;
  /** Ready to call right now (for sign-in providers, an account is connected). */
  connected: boolean;
  /** The provider connects via sign-in (Codex / ChatGPT subscription). */
  oauth: boolean;
}

/** AI provider status — gates the ✦ surfaces. */
export class AiStore extends Store<AiState> {
  constructor() {
    super({ available: false, connected: false, oauth: false });
  }

  async check(): Promise<void> {
    try {
      const status = await getAiStatus();
      this.setState({
        available: status.available,
        connected: status.connected,
        oauth: status.oauth,
      });
    } catch {
      this.setState({ available: false, connected: false, oauth: false });
    }
  }
}

export const aiStore = new AiStore();
