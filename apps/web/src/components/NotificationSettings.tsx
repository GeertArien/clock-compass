import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPushStatus,
  pushSubscribe,
  pushTest,
  pushUnsubscribe,
  type NotificationSettings as NotificationSettingsData,
} from "@clock-compass/web-client/api";
import { errorMessage } from "@clock-compass/web-client/meta";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  notificationSettingsQuery,
  saveNotificationSettings,
} from "@/lib/queries/notification-prefs";
import { toast } from "@/lib/stores/toast";
import { openSettings, settingsStore } from "@/lib/stores/settings";

const TOGGLES = [
  { key: "overdueCommitments", label: "Overdue commitments", hint: "when a cadence slips · max 1/day" },
  { key: "morningRocks", label: "Morning rock reminder", hint: "open big rocks, at your morning hour" },
  { key: "weeklyReview", label: "Weekly review", hint: "Sunday evening — look back, plan ahead" },
] as const;

const HOURS = {
  morningHour: [5, 6, 7, 8, 9, 10],
  quietStart: [20, 21, 22, 23],
  quietEnd: [5, 6, 7, 8, 9],
} as const;

const HOUR_LABELS: Record<keyof typeof HOURS, string> = {
  morningHour: "Morning hour",
  quietStart: "Quiet hours start",
  quietEnd: "Quiet hours end",
};

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Web push on this device plus the server-side notification preferences
 * (the notification-settings query and its save). Loads on mount (Settings remounts on
 * each open).
 */
export function NotificationSettings() {
  const [configured, setConfigured] = useState(false);
  /** The status check itself failed (offline, bad token) — not the same as unconfigured. */
  const [statusError, setStatusError] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const queryClient = useQueryClient();
  // Read from the cache; the effect below fetches, after the push status.
  const settings = useQuery({ ...notificationSettingsQuery, enabled: false }).data ?? null;
  const saveMutation = useMutation(saveNotificationSettings);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  // The Notifications row on the Settings list shows On or Off (#141).
  useEffect(() => {
    settingsStore.setPushOn(statusError ? null : configured && subscribed);
  }, [configured, subscribed, statusError]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        // Status and preferences first: the service worker may never become
        // ready (dev server, failed registration), and that mustn't hide them.
        const status = await getPushStatus();
        if (!live) return;
        setStatusError(false);
        setConfigured(status.configured);
        setPublicKey(status.publicKey);
        await queryClient.fetchQuery({ ...notificationSettingsQuery, staleTime: 0 });
        if (!live) return;
        const registration = await navigator.serviceWorker?.ready;
        const subscription = await registration?.pushManager.getSubscription();
        if (live) setSubscribed(!!subscription);
      } catch {
        if (!live) return;
        setConfigured(false);
        setStatusError(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [queryClient]);

  /** Runs one push action at a time; `busy` drives the buttons. */
  async function exclusive(run: () => Promise<void>): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await run();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function enable() {
    if (!publicKey) return;
    void exclusive(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          toast.error("Notifications were not allowed by the browser");
          return;
        }
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
        await pushSubscribe(subscription.toJSON());
        setSubscribed(true);
        toast.success("This device will receive notifications");
      } catch (err) {
        toast.error(errorMessage(err, "Could not enable push"));
      }
    });
  }

  function disable() {
    void exclusive(async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await pushUnsubscribe(subscription.endpoint);
          await subscription.unsubscribe();
        }
        setSubscribed(false);
        toast.success("Push disabled on this device");
      } catch (err) {
        toast.error(errorMessage(err, "Could not disable push"));
      }
    });
  }

  function test() {
    pushTest().then(
      () => toast.success("Test sent"),
      (err: unknown) => toast.error(errorMessage(err, "Could not send a test")),
    );
  }

  const save = (partial: Partial<NotificationSettingsData>) => saveMutation.mutate(partial);

  const select = (key: keyof typeof HOURS) =>
    settings && (
      <select
        aria-label={HOUR_LABELS[key]}
        value={settings[key]}
        onChange={(e) => void save({ [key]: Number(e.currentTarget.value) })}
        className="rounded-md border border-input bg-transparent px-1.5 py-0.5 text-xs"
      >
        {HOURS[key].map((h) => (
          <option key={h} value={h}>
            {h}:00
          </option>
        ))}
      </select>
    );

  return (
    <div className="flex flex-col gap-2">
      {statusError ? (
        <p className="text-xs text-[var(--terra)]">
          Couldn't check the push status. Check the API token in{" "}
          <button type="button" className="underline underline-offset-2" onClick={() => openSettings("connection")}>
            Connection
          </button>
          , then come back here.
        </p>
      ) : !configured ? (
        <p className="text-xs text-muted-foreground">
          Web push is off — set <code>VAPID_PUBLIC_KEY</code>/<code>VAPID_PRIVATE_KEY</code> on
          the server to enable it.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <div>
              <p className="text-[0.8125rem] font-medium">Push on this device</p>
              <p className="text-[0.6875rem] text-muted-foreground">
                Works installed as a PWA, even with the app closed.
              </p>
            </div>
            {subscribed ? (
              <div className="flex gap-1.5">
                <Button variant="outline" size="sm" onClick={test}>
                  Test
                </Button>
                <Button variant="outline" size="sm" onClick={disable} disabled={busy}>
                  Disable
                </Button>
              </div>
            ) : (
              <Button size="sm" onClick={enable} disabled={busy}>
                {busy ? "Enabling…" : "Enable"}
              </Button>
            )}
          </div>

          {settings && (
            <>
              {TOGGLES.map((toggle) => (
                <div key={toggle.key} className="flex items-center justify-between gap-3 py-1">
                  <div>
                    <p className="text-[0.8125rem] font-medium">{toggle.label}</p>
                    <p className="text-[0.6875rem] text-muted-foreground">{toggle.hint}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings[toggle.key]}
                    aria-label={toggle.label}
                    onClick={() => void save({ [toggle.key]: !settings[toggle.key] })}
                    className={cn(
                      "relative h-6 w-10 shrink-0 rounded-full transition-colors",
                      settings[toggle.key] ? "bg-[var(--pine)]" : "bg-input",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 size-5 rounded-full bg-white transition-[left]",
                        settings[toggle.key] ? "left-[18px]" : "left-0.5",
                      )}
                    />
                  </button>
                </div>
              ))}

              <div className="flex flex-wrap items-center gap-2 pt-1 text-[0.75rem] text-muted-foreground">
                <span>Morning hour</span>
                {select("morningHour")}
                <span className="ml-2">Quiet</span>
                {select("quietStart")}
                <span>–</span>
                {select("quietEnd")}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
