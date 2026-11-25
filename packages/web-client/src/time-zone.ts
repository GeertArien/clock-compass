/**
 * The app reports its zone on purpose (#136): when it starts, and when it
 * comes back to the foreground in a different zone than it last reported.
 * The server then uses it where no device asks (MCP, scripts, push hours).
 * A failed report (offline, no token yet) is tried again at the next return
 * to the foreground. Framework-neutral, so it is tested without React.
 */
export interface ZoneReporterPorts {
  /** The device's zone now (IANA), or undefined when the runtime cannot say. */
  zone(): string | undefined;
  report(zone: string): Promise<unknown>;
  /** Subscribes to "the app is in the foreground again"; returns the unsubscribe. */
  onForeground(listener: () => void): () => void;
}

/** `retry` reports now even if the zone did not change (after a new token is saved). */
export function startZoneReporting(ports: ZoneReporterPorts): { stop: () => void; retry: () => void } {
  let reported: string | undefined;
  let pending: string | undefined;
  const check = (force: boolean) => {
    const zone = ports.zone();
    if (!zone || zone === pending || (!force && zone === reported)) return;
    pending = zone;
    ports.report(zone).then(
      () => {
        reported = zone;
        if (pending === zone) pending = undefined;
      },
      () => {
        if (pending === zone) pending = undefined;
      },
    );
  };
  check(true);
  return { stop: ports.onForeground(() => check(false)), retry: () => check(true) };
}

/** The browser's "back in the foreground": the page becomes visible again. */
export function onVisible(listener: () => void): () => void {
  const handler = () => {
    if (document.visibilityState === "visible") listener();
  };
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
}
