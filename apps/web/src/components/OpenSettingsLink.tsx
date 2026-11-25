import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { openSettings, sectionForMessage, type SettingsSection } from "@/lib/stores/settings";

const SECTION_NAMES: Record<SettingsSection, string> = {
  general: "General",
  connection: "Connection",
  ai: "AI",
  agents: "Agents",
  notifications: "Notifications",
  data: "Data",
};

/**
 * Opens Settings on the section a notice is about (#141): "Settings → AI",
 * "Settings → Connection". A button, so it never leaves the screen.
 */
export function OpenSettingsLink({ section, className, children }: { section: SettingsSection; className?: string; children?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => openSettings(section)}
      className={cn("font-medium underline underline-offset-2 hover:opacity-80", className)}
    >
      {children ?? `Settings → ${SECTION_NAMES[section]}`}
    </button>
  );
}

/** The link for a message that names a section of Settings, or nothing. */
export function SettingsLinkFor({ message, className }: { message: string; className?: string }) {
  const section = sectionForMessage(message);
  return section ? <OpenSettingsLink section={section} className={className} /> : null;
}
