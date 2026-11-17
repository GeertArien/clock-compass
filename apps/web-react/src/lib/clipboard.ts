import { toast } from "@/lib/stores/toast";

/**
 * Copy text and confirm with a toast. `navigator.clipboard` only exists in a
 * secure context, so a plain-HTTP self-host gets an explicit "copy it by hand"
 * rather than a silent failure (which matters for a key shown only once).
 */
export function copyText(text: string, label: string): void {
  const failed = () => toast.error(`Couldn't copy the ${label.toLowerCase()} — select it and copy by hand`);
  if (!navigator.clipboard) {
    failed();
    return;
  }
  navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`), failed);
}
