import { useEffect, useRef } from "react";
import { HistoryLayers } from "./history-layers";

/** The app's one layer stack, over the browser history. */
export const historyLayers = new HistoryLayers(window.history);
window.addEventListener("popstate", () => historyLayers.onPopState());

/**
 * Makes an open sheet or dialog a history layer: back closes it (and leaves the
 * screen behind as it is), and closing it any other way steps back off its
 * entry. Used by the two overlay primitives, AppSheet and ConfirmDialog, so
 * every sheet and dialog in the app behaves the same.
 */
export function useHistoryLayer(open: boolean, close: () => void): void {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!open) return;
    const id = historyLayers.open(() => closeRef.current());
    return () => historyLayers.closed(id);
  }, [open]);
}
