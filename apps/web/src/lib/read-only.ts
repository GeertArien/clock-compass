import { createContext, useContext } from "react";

/**
 * Whether the shared components may change anything (#118, step 2). The app
 * leaves it off. The MCP App page turns it on: there a task card or a habit
 * row shows its state but has no control that writes, since a change inside
 * a host comes only from a proposal confirmed with a press (step 3).
 */
export const ReadOnlyContext = createContext(false);

export const useReadOnly = (): boolean => useContext(ReadOnlyContext);
