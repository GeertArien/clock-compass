/** The on/off pill used for importance, urgency and proactivity toggles. */
export function chip(active: boolean): string {
  return active
    ? "bg-primary text-primary-foreground border-transparent"
    : "bg-transparent text-muted-foreground border-border";
}
