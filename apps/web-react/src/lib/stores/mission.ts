import { getMission, setMission, type Mission } from "@clock-compass/web-client/api";
import { errorMessage } from "@clock-compass/web-client/meta";
import { Store } from "./store";
import { toast } from "./toast";

interface MissionState {
  mission: Mission | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

/** The personal mission statement (Habit 2). Mirrors mission.svelte.ts. */
export class MissionStore extends Store<MissionState> {
  constructor() {
    super({ mission: null, loading: false, saving: false, error: null });
  }

  async load(): Promise<void> {
    this.setState({ loading: true, error: null });
    try {
      this.setState({ mission: await getMission() });
    } catch (err) {
      this.setState({ error: errorMessage(err, "Failed to load mission") });
    } finally {
      this.setState({ loading: false });
    }
  }

  async save(content: string): Promise<void> {
    this.setState({ saving: true, error: null });
    try {
      this.setState({ mission: await setMission(content) });
      toast.success("Mission saved");
    } catch (err) {
      const msg = errorMessage(err, "Failed to save mission");
      this.setState({ error: msg });
      toast.error(msg);
    } finally {
      this.setState({ saving: false });
    }
  }
}

export const missionStore = new MissionStore();
