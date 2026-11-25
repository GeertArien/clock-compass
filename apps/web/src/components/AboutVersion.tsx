import { useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { describeVersion, versionNote, versionOf, type BuildVersion } from "@clock-compass/web-client/version";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import { appVersion } from "@/lib/version";
import { healthQuery } from "@/lib/queries/health";

/** One "App …" or "Server …" line; the commit can be selected or copied whole. */
function VersionLine({ label, version }: { label: string; version: BuildVersion | null }) {
  const text = version ? describeVersion(version) : "…";
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="min-w-0 text-xs">
        <span className="text-muted-foreground">{label} </span>
        <code className="select-all break-all">{text}</code>
      </p>
      {version?.commit && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={`Copy the ${label.toLowerCase()}'s commit`}
          onClick={() => copyText(version.commit!, "Commit")}
        >
          <Copy className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

/**
 * Settings → About (#140): this device's app version and the server's, each
 * as a short commit and its build day, and in words when they differ.
 */
export function AboutVersion() {
  const { data, isError } = useQuery(healthQuery);
  const server = data ? versionOf(data.version) : isError ? versionOf(null) : null;
  const note = server ? versionNote(appVersion, server) : null;
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
      <span className="text-sm font-medium">About</span>
      <VersionLine label="App" version={appVersion} />
      <VersionLine label="Server" version={server} />
      {note && (
        <div className="flex items-center justify-between gap-2">
          <p role="status" className="text-xs text-[var(--terra)]">
            {note}
          </p>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      )}
    </div>
  );
}
