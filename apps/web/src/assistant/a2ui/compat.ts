/**
 * Wire-format shim for `@a2ui/web_core` 0.15.0.
 *
 * The final A2UI 1.0 schemas moved the component envelope keys into the `@`
 * namespace (`@checks`, `@accessibility`, `@catalogId`, `@metadata`). 0.15.0
 * still expects the bare names, so a spec-valid payload is rejected. The fix
 * is merged upstream but unreleased; until it ships we un-prefix those four
 * keys at the component root, which is the only place they are legal.
 * `catalog.test.ts` fails once the core accepts the final keys itself, which
 * is the cue to delete this file.
 */
export type A2uiMessage = Record<string, unknown>;

const ENVELOPE_KEYS: Record<string, string> = {
  "@checks": "checks",
  "@accessibility": "accessibility",
  "@catalogId": "catalogId",
  "@metadata": "metadata",
};

type ComponentsHolder = { components?: Record<string, unknown>[] };

function withBareKeys(holder: ComponentsHolder | undefined): ComponentsHolder | undefined {
  if (!holder?.components) return holder;
  return {
    ...holder,
    components: holder.components.map((component) =>
      Object.fromEntries(
        Object.entries(component).map(([key, value]) => [ENVELOPE_KEYS[key] ?? key, value]),
      ),
    ),
  };
}

export function acceptFinalEnvelopeKeys(messages: A2uiMessage[]): A2uiMessage[] {
  return messages.map((message) => ({
    ...message,
    ...("createSurface" in message
      ? { createSurface: withBareKeys(message.createSurface as ComponentsHolder) }
      : {}),
    ...("updateComponents" in message
      ? { updateComponents: withBareKeys(message.updateComponents as ComponentsHolder) }
      : {}),
  }));
}
