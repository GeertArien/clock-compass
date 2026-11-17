import { useState } from "react";

/**
 * Open/close state for a sheet or dialog about one item. `key` changes on every
 * open, so keying the sheet with it remounts the form and re-seeds its fields
 * (as apps/web re-seeds on open), while the sheet stays mounted on close so its
 * exit animation plays.
 */
export function useSheet<T>() {
  const [state, setState] = useState<{ open: boolean; item: T | null; key: number }>({
    open: false,
    item: null,
    key: 0,
  });
  return {
    open: state.open,
    item: state.item,
    key: state.key,
    show: (item: T | null) => setState((s) => ({ open: true, item, key: s.key + 1 })),
    setOpen: (open: boolean) => setState((s) => ({ ...s, open })),
  };
}
