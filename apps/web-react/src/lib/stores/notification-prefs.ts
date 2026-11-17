import {
  getNotificationSettings,
  updateNotificationSettings,
  type NotificationSettings,
} from "@clock-compass/web-client/api";
import { errorMessage } from "@clock-compass/web-client/meta";
import { OptimisticEdits } from "@clock-compass/web-client/rollback";
import { Store } from "./store";
import { toast } from "./toast";

interface PrefsState {
  /** The server-side notification preferences; null until loaded. */
  settings: NotificationSettings | null;
}

/** The preferences are a single record; OptimisticEdits tracks items by id. */
const ID = "settings";
type Tracked = NotificationSettings & { id: string };
const track = (settings: NotificationSettings): Tracked => ({ ...settings, id: ID });
const untrack = ({ id: _id, ...settings }: Tracked): NotificationSettings => settings;

/**
 * Notification preferences, saved optimistically. Overlapping saves are
 * reconciled the way the task and renewal stores do it: a failed save drops
 * only its own patch (so two quick toggles that both fail end where they
 * started), and a late response to an older save can't overwrite a newer one.
 */
export class NotificationPrefsStore extends Store<PrefsState> {
  readonly #edits = new OptimisticEdits<Tracked>();

  constructor() {
    super({ settings: null });
  }

  /** Throws when the request fails, so the caller can show its own message. */
  async load(): Promise<void> {
    const settings = await getNotificationSettings();
    this.#edits.reset();
    this.setState({ settings });
  }

  async save(partial: Partial<NotificationSettings>): Promise<void> {
    const current = this.state.settings;
    if (!current) return;
    const { item, ticket } = this.#edits.apply(track(current), partial);
    this.setState({ settings: untrack(item) });
    try {
      const saved = await updateNotificationSettings(partial);
      this.setState({ settings: untrack(this.#edits.succeed(ID, ticket, track(saved))) });
    } catch (err) {
      const shown = this.#edits.fail(ID, ticket);
      if (shown) this.setState({ settings: untrack(shown) });
      toast.error(errorMessage(err, "Could not save"));
    }
  }
}

export const notificationPrefsStore = new NotificationPrefsStore();
