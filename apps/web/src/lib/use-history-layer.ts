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
 *
 * A back the owner declines (Settings asking "Leave without saving?", then
 * "Keep editing") has already used the layer's entry: changing `key` pushes a
 * new one, so the next back is caught again.
 */
export function useHistoryLayer(open: boolean, close: () => void, key: unknown = 0): void {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!open) return;
    const id = historyLayers.open(() => closeRef.current());
    return () => historyLayers.closed(id);
    // `key`: a new value puts the layer back (after a back the owner declined).
  }, [open, key]);
}
