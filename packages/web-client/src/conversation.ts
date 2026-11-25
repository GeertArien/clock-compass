/**
 * The assistant's conversation, kept on the device (issue #62, decision C):
 * a plain, serialisable format behind a small storage interface, so the
 * storage can change later (#94, another device store) without touching the
 * sheet. Framework-neutral: no React, no browser APIs beyond the Storage the
 * caller hands in.
 */
import type { Message } from "@ag-ui/core";

/** One entry in the conversation, as the sheet shows it. */
export type ChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  /** A validated A2UI screen: the A2UI 1.0 messages the server sent. */
  | { kind: "surface"; id: string; operations: Record<string, unknown>[] }
  /** Said by the app, not the assistant (a run that ended without an answer, an error). Never sent to the server. */
  | { kind: "notice"; id: string; text: string; tone: "info" | "error" };

export interface Conversation {
  version: 1;
  /** The AG-UI thread id; a new one after Clear. */
  threadId: string;
  items: ChatItem[];
  /**
   * Confirmed actions already carried out, by action key (`actionKey`), with
   * when. A proposal whose key is here is never carried out again, after a
   * double tap, a remount or a reload.
   */
  applied?: Record<string, string>;
  /** The id of the item an applied create made, by action key (#109), so its bar can say what it made. */
  created?: Record<string, string>;
  /**
   * The idempotency key of a create, by action key (#114): made at random on
   * the first Confirm and stored before the request goes out, so every retry
   * and a Confirm after a reload send the same key, and the server makes the
   * item once. Older conversations have none; a key is made when needed.
   */
  keys?: Record<string, string>;
  /**
   * Proposals declined with "Not now", by action key, with when (#145). The
   * card in a declined proposal goes back to the live task, also after a
   * reload. Older conversations have none.
   */
  dismissed?: Record<string, string>;
}

/** Where the conversation lives. Today: localStorage. */
export interface ConversationStore {
  load(): Conversation | null;
  save(conversation: Conversation): void;
  clear(): void;
}

/** Items kept on the device; older ones are dropped first. */
export const MAX_STORED_ITEMS = 200;

export function emptyConversation(threadId: string): Conversation {
  return { version: 1, threadId, items: [] };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string";

function parseItem(raw: unknown): ChatItem | null {
  if (!isRecord(raw) || !isText(raw.id)) return null;
  switch (raw.kind) {
    case "user":
    case "assistant":
      return isText(raw.text) ? { kind: raw.kind, id: raw.id, text: raw.text } : null;
    case "surface":
      return Array.isArray(raw.operations) && raw.operations.every(isRecord)
        ? { kind: "surface", id: raw.id, operations: raw.operations }
        : null;
    case "notice":
      return isText(raw.text) && (raw.tone === "info" || raw.tone === "error")
        ? { kind: "notice", id: raw.id, text: raw.text, tone: raw.tone }
        : null;
    default:
      return null;
  }
}

/** A stored conversation, checked: anything malformed is dropped, never thrown. */
export function parseConversation(raw: unknown): Conversation | null {
  if (!isRecord(raw) || raw.version !== 1 || !isText(raw.threadId) || !Array.isArray(raw.items)) return null;
  const texts = (value: unknown) =>
    isRecord(value)
      ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => isText(entry[1])))
      : {};
  const applied = texts(raw.applied);
  const created = texts(raw.created);
  const keys = texts(raw.keys);
  const dismissed = texts(raw.dismissed);
  return {
    version: 1,
    threadId: raw.threadId,
    items: raw.items.map(parseItem).filter((item): item is ChatItem => item !== null),
    ...(Object.keys(applied).length ? { applied } : {}),
    ...(Object.keys(created).length ? { created } : {}),
    ...(Object.keys(keys).length ? { keys } : {}),
    ...(Object.keys(dismissed).length ? { dismissed } : {}),
  };
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const CONVERSATION_KEY = "clockcompass_assistant_conversation";

/**
 * The conversation in localStorage. Reading never throws (a corrupt entry
 * reads as none). Writing keeps the last MAX_STORED_ITEMS items and, when the
 * storage is full, drops the older half and tries once more; if that fails
 * too, the conversation stays in memory only.
 */
export function localConversationStore(
  storage: StorageLike | undefined = typeof localStorage === "undefined" ? undefined : localStorage,
  key = CONVERSATION_KEY,
): ConversationStore {
  return {
    load() {
      try {
        const text = storage?.getItem(key);
        return text ? parseConversation(JSON.parse(text)) : null;
      } catch {
        return null;
      }
    },
    save(conversation) {
      if (!storage) return;
      const items = conversation.items.slice(-MAX_STORED_ITEMS);
      for (const kept of [items, items.slice(Math.floor(items.length / 2))]) {
        try {
          storage.setItem(key, JSON.stringify({ ...conversation, items: kept }));
          return;
        } catch {
          // Full: try again with fewer items.
        }
      }
    },
    clear() {
      try {
        storage?.removeItem(key);
      } catch {
        // Nothing stored, or storage unavailable: nothing to clear.
      }
    },
  };
}

/** The conversation as AG-UI messages for a run. Notices are the app's own and stay out. */
export function toAguiMessages(items: ChatItem[]): Message[] {
  return items.flatMap((item): Message[] => {
    switch (item.kind) {
      case "user":
        return [{ id: item.id, role: "user", content: item.text }];
      case "assistant":
        return item.text ? [{ id: item.id, role: "assistant", content: item.text }] : [];
      case "surface":
        return [
          {
            id: item.id,
            role: "activity",
            activityType: "a2ui-surface",
            content: { a2ui_operations: item.operations },
          } as Message,
        ];
      case "notice":
        return [];
    }
  });
}
