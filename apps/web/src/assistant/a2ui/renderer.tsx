/**
 * The assistant's A2UI renderer: the official protocol core
 * (`@a2ui/web_core`, v1.0) and the official React renderer (`@a2ui/react`)
 * with our catalog. Everything under `src/assistant/` is reached only through
 * a dynamic `import()`, so it ships in its own chunk, off the first load.
 */
import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { A2uiSurface, type ReactCatalogComponent } from "@a2ui/react";
import {
  Catalog,
  MessageProcessor,
  type ActionPayload,
  type SurfaceModel,
} from "@a2ui/web_core/v1_0";
import {
  CATALOG_FUNCTIONS,
  CATALOG_INSTRUCTIONS,
  CC_CATALOG_ID,
  acceptFinalEnvelopeKeys,
  type A2uiMessage,
} from "@clock-compass/assistant-catalog";
import { COMPONENTS } from "./components";

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

/**
 * Contains a surface that throws while rendering, so one bad answer shows a
 * short note instead of unmounting the app around it. Server validation makes
 * this rare; it is the last guard, not the only one.
 */
class SurfaceBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <p role="alert" className="rounded-md border border-dashed border-border p-2.5 text-xs text-muted-foreground">
        This part of the answer could not be shown.
      </p>
    );
  }
}

/** Renders every surface the processor holds, in creation order, each in its own boundary. */
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
          <SurfaceBoundary>
            <A2uiSurface surface={surface} />
          </SurfaceBoundary>
        </section>
      ))}
    </div>
  );
}

/**
 * One answer's screen: its own processor fed with the operations the server
 * sent (validated there), so screens of different answers never share
 * surfaces. Stored operations that the core refuses show a note instead of
 * breaking the conversation.
 */
export function SurfaceView({
  operations,
  onAction,
}: {
  operations: A2uiMessage[];
  onAction: (action: ActionPayload) => void;
}) {
  // The processor lives as long as its operations; the current onAction is
  // subscribed to it in an effect, so a new handler never rebuilds the screen.
  const { processor, listeners } = useMemo(() => {
    const listeners = new Set<(action: ActionPayload) => void>();
    const created = createProcessor((action) => listeners.forEach((listener) => listener(action)));
    try {
      processMessages(created, operations);
      return { processor: created, listeners };
    } catch {
      return { processor: null, listeners };
    }
  }, [operations]);
  useEffect(() => {
    listeners.add(onAction);
    return () => void listeners.delete(onAction);
  }, [listeners, onAction]);
  if (!processor) {
    return (
      <p role="alert" className="rounded-md border border-dashed border-border p-2.5 text-xs text-muted-foreground">
        This part of the answer could not be shown.
      </p>
    );
  }
  return <A2uiSurfaces processor={processor} />;
}
