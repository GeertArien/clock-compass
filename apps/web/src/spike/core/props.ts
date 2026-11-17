import { ResolvedBinding, isWritable, type NodeProps } from "@a2ui/web_core/v1_0";

/**
 * Flattens a node's resolved props for a Svelte component: a binding becomes
 * its current value plus a `set<Name>` writer (as the official Lit controller
 * does); child nodes and action closures pass through untouched.
 */
export function unwrapProps(props: NodeProps): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value instanceof ResolvedBinding) {
      out[key] = value.value;
      if (isWritable(value)) {
        out[`set${key.charAt(0).toUpperCase()}${key.slice(1)}`] = value.set;
      }
    } else {
      out[key] = value;
    }
  }
  return out;
}
