import { mutationOptions, queryOptions } from "@tanstack/react-query";
import {
  getNotificationSettings,
  updateNotificationSettings,
  type NotificationSettings,
} from "@clock-compass/web-client/api";
import { errorMessage } from "@clock-compass/web-client/meta";
import { toast } from "@/lib/stores/toast";
import { editsFor } from "./edits";

/** The preferences are a single record; OptimisticEdits tracks items by id. */
const ID = "settings";
type Tracked = NotificationSettings & { id: string };
const track = (settings: NotificationSettings): Tracked => ({ ...settings, id: ID });
const untrack = ({ id: _id, ...settings }: Tracked): NotificationSettings => settings;

const edits = editsFor<Tracked>();

/** The server-side notification preferences. */
export const notificationSettingsQuery = queryOptions({
  queryKey: ["notification-settings"],
  queryFn: async ({ client }) => {
    const before = edits(client).latestTicket;
    const settings = await getNotificationSettings();
    // Unless a save started meanwhile (its onMutate cancelled this request).
    if (edits(client).latestTicket === before) edits(client).reset();
    return settings;
  },
});

/**
 * Save preferences optimistically. Overlapping saves reconcile like every
 * other edit: a failed save drops only its own patch (two quick toggles that
 * both fail end where they started), and a late response to an older save
 * can't overwrite a newer one.
 */
export const saveNotificationSettings = mutationOptions({
  mutationKey: ["notification-settings", "save"],
  mutationFn: (partial: Partial<NotificationSettings>) => updateNotificationSettings(partial),
  onMutate: async (partial, { client }) => {
    // A list request already in flight may predate this write: drop its answer.
    await client.cancelQueries({ queryKey: notificationSettingsQuery.queryKey });
    const current = client.getQueryData(notificationSettingsQuery.queryKey);
    if (!current) return undefined;
    const { item, ticket } = edits(client).apply(track(current), partial);
    client.setQueryData(notificationSettingsQuery.queryKey, untrack(item));
    return { ticket };
  },
  onSuccess: (saved, _partial, ctx, { client }) => {
    const shown = ctx ? untrack(edits(client).succeed(ID, ctx.ticket, track(saved))) : saved;
    client.setQueryData(notificationSettingsQuery.queryKey, shown);
  },
  onError: (err, _partial, ctx, { client }) => {
    const shown = ctx ? edits(client).fail(ID, ctx.ticket) : undefined;
    if (shown) client.setQueryData(notificationSettingsQuery.queryKey, untrack(shown));
    toast.error(errorMessage(err, "Could not save"));
  },
});
