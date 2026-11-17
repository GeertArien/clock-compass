import { describe, expect, it } from "vitest";
import { fieldsBefore, restoreAt, revertKey, revertPatch, withoutId } from "./rollback";

type Item = { id: string; a: number; b: string };
const items: Item[] = [
  { id: "1", a: 1, b: "x" },
  { id: "2", a: 2, b: "y" },
];

describe("rollback helpers", () => {
  it("restores only the failed patch's fields on that one item", () => {
    const before = fieldsBefore(items[0], { a: 10 });
    const patched = items.map((i) => (i.id === "1" ? { ...i, a: 10, b: "later edit" } : i));
    const reverted = revertPatch(patched, "1", { a: 10 }, before);
    expect(reverted[0]).toEqual({ id: "1", a: 1, b: "later edit" });
    expect(reverted[1]).toBe(patched[1]);
  });

  it("leaves a field alone when a later edit changed it again", () => {
    const before = fieldsBefore(items[0], { a: 10 });
    const later = items.map((i) => (i.id === "1" ? { ...i, a: 20 } : i));
    expect(revertPatch(later, "1", { a: 10 }, before)[0]!.a).toBe(20);
  });

  it("drops a placeholder and restores a removed item in place", () => {
    expect(withoutId(items, "1")).toEqual([items[1]]);
    expect(restoreAt([items[1]!], items[0]!, 0)).toEqual(items);
    expect(restoreAt(items, items[0]!, 1)).toBe(items);
  });

  it("reverts a record key only if it still holds the patched value", () => {
    expect(revertKey({ A: "new" }, "A", "new", "old")).toEqual({ A: "old" });
    const later = { A: "newer" };
    expect(revertKey(later, "A", "new", "old")).toBe(later);
  });
});
