import { describe, expect, it } from "vitest";
import {
  MAX_STORED_ITEMS,
  emptyConversation,
  localConversationStore,
  parseConversation,
  toAguiMessages,
  type ChatItem,
  type Conversation,
} from "./conversation";

/** A Storage stand-in; `quota` throws on writes larger than it. */
function memoryStorage(quota = Infinity) {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (v.length > quota) throw new DOMException("full", "QuotaExceededError");
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
  };
}

const items: ChatItem[] = [
  { kind: "user", id: "u1", text: "Show my matrix" },
  { kind: "assistant", id: "a1", text: "Here it is." },
  { kind: "surface", id: "a2ui-surface-r1", operations: [{ version: "1.0", createSurface: { surfaceId: "m-1", catalogId: "c" } }] },
  { kind: "notice", id: "n1", text: "Stopped.", tone: "info" },
];

describe("the conversation store (on the device)", () => {
  it("saves and loads the conversation as plain JSON", () => {
    const storage = memoryStorage();
    const store = localConversationStore(storage, "k");
    const conversation: Conversation = { version: 1, threadId: "t1", items };
    store.save(conversation);
    expect(JSON.parse(storage.data.get("k")!)).toEqual(conversation);
    expect(store.load()).toEqual(conversation);
  });

  it("clears it", () => {
    const storage = memoryStorage();
    const store = localConversationStore(storage, "k");
    store.save(emptyConversation("t1"));
    store.clear();
    expect(store.load()).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it("reads a corrupt or foreign entry as nothing, and drops malformed items", () => {
    const storage = memoryStorage();
    const store = localConversationStore(storage, "k");
    storage.setItem("k", "{not json");
    expect(store.load()).toBeNull();
    storage.setItem("k", JSON.stringify({ version: 2, threadId: "t", items: [] }));
    expect(store.load()).toBeNull();
    expect(
      parseConversation({
        version: 1,
        threadId: "t",
        items: [items[0], { kind: "user", id: 5, text: "x" }, { kind: "script", id: "x" }, { kind: "surface", id: "s", operations: "no" }],
      }),
    ).toEqual({ version: 1, threadId: "t", items: [items[0]] });
  });

  it("keeps only the last items, and the newer half when storage is full", () => {
    const storage = memoryStorage();
    const store = localConversationStore(storage, "k");
    const many = Array.from({ length: MAX_STORED_ITEMS + 10 }, (_, i): ChatItem => ({ kind: "user", id: `u${i}`, text: "x" }));
    store.save({ version: 1, threadId: "t", items: many });
    expect(store.load()!.items).toHaveLength(MAX_STORED_ITEMS);
    expect(store.load()!.items[0]!.id).toBe("u10");

    const small = memoryStorage(4000);
    const tight = localConversationStore(small, "k");
    tight.save({ version: 1, threadId: "t", items: many.slice(0, 120) });
    const kept = tight.load()!.items;
    expect(kept.length).toBe(60);
    expect(kept.at(-1)!.id).toBe("u119");
  });

  it("never throws when storage is missing or refuses everything", () => {
    const none = localConversationStore(undefined);
    expect(() => none.save(emptyConversation("t"))).not.toThrow();
    expect(none.load()).toBeNull();
    const refusing = localConversationStore(memoryStorage(0), "k");
    expect(() => refusing.save({ version: 1, threadId: "t", items })).not.toThrow();
  });
});

describe("toAguiMessages", () => {
  it("sends user and assistant text and screens, and keeps the app's notices out", () => {
    expect(toAguiMessages(items)).toEqual([
      { id: "u1", role: "user", content: "Show my matrix" },
      { id: "a1", role: "assistant", content: "Here it is." },
      { id: "a2ui-surface-r1", role: "activity", activityType: "a2ui-surface", content: { a2ui_operations: items[2]!.kind === "surface" ? items[2]!.operations : [] } },
    ]);
  });
});
