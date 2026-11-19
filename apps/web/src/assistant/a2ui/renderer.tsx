/**
 * The assistant's A2UI renderer: the official protocol core
 * (`@a2ui/web_core`, v1.0) and the official React renderer (`@a2ui/react`)
 * with our catalog. Everything under `src/assistant/` is reached only through
 * a dynamic `import()`, so it ships in its own chunk, off the first load.
 */
import { useEffect, useState } from "react";
import { A2uiSurface, type ReactCatalogComponent } from "@a2ui/react";
import {
  Catalog,
  MessageProcessor,
  type ActionPayload,
  type SurfaceModel,
} from "@a2ui/web_core/v1_0";
import { CATALOG_FUNCTIONS, CATALOG_INSTRUCTIONS, CC_CATALOG_ID } from "./catalog";
import { COMPONENTS } from "./components";
import { acceptFinalEnvelopeKeys, type A2uiMessage } from "./compat";

export type { A2uiMessage, ActionPayload };

const reactCatalog = new Catalog<ReactCatalogComponent>(
  CC_CATALOG_ID,
  "1.0",
  COMPONENTS,
  CATALOG_FUNCTIONS,
  { instructions: CATALOG_INSTRUCTIONS },
);

export type AssistantProcessor = MessageProcessor<ReactCatalogComponent>;

/** One processor per conversation; `onAction` receives every user action. */
export function createProcessor(onAction: (action: ActionPayload) => void): AssistantProcessor {
  return new MessageProcessor<ReactCatalogComponent>([reactCatalog], onAction);
}

/** Feeds A2UI 1.0 messages (final wire format) to the processor. */
export function processMessages(processor: AssistantProcessor, messages: A2uiMessage[]): void {
  processor.processMessages(acceptFinalEnvelopeKeys(messages) as never);
}

/** Renders every surface the processor holds, in creation order. */
export function A2uiSurfaces({ processor }: { processor: AssistantProcessor }) {
  const [surfaces, setSurfaces] = useState<SurfaceModel<ReactCatalogComponent>[]>(() => [
    ...processor.model.surfacesMap.values(),
  ]);
  useEffect(() => {
    const sync = () => setSurfaces([...processor.model.surfacesMap.values()]);
    sync();
    const created = processor.onSurfaceCreated(sync);
    const deleted = processor.onSurfaceDeleted(sync);
    return () => {
      created.unsubscribe();
      deleted.unsubscribe();
    };
  }, [processor]);

  return (
    <div className="flex flex-col gap-4">
      {surfaces.map((surface) => (
        <section key={surface.id} data-surface={surface.id} className="min-w-0">
          <A2uiSurface surface={surface} />
        </section>
      ))}
    </div>
  );
}
