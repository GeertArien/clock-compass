import { describe, expect, it } from "vitest";
import { OptimisticEdits, replaceById, restoreAt, withoutId } from "./rollback";

type Item = { id: string; a: number; b: string };
const base: Item = { id: "1", a: 1, b: "x" };

describe("OptimisticEdits", () => {
  it("shows patches on top of the confirmed version", () => {
    const edits = new OptimisticEdits<Item>();
    expect(edits.apply(base, { a: 2 }).item).toEqual({ id: "1", a: 2, b: "x" });
  });

  // Two overlapping edits; every combination of outcomes and settle orders.
  const cases: [string, ("A" | "B")[], ("ok" | "fail")[], Item][] = [
    ["both fail, first first", ["A", "B"], ["fail", "fail"], base],
    ["both fail, second first", ["B", "A"], ["fail", "fail"], base],
    ["first fails, second succeeds", ["A", "B"], ["fail", "ok"], { id: "1", a: 1, b: "y" }],
    ["second succeeds, then first fails", ["B", "A"], ["ok", "fail"], { id: "1", a: 1, b: "y" }],
    ["first succeeds, second fails", ["A", "B"], ["ok", "fail"], { id: "1", a: 2, b: "x" }],
    ["both succeed", ["A", "B"], ["ok", "ok"], { id: "1", a: 2, b: "y" }],
  ];
  it.each(cases)("%s", (_name, order, outcomes, expected) => {
    const edits = new OptimisticEdits<Item>();
    const A = edits.apply(base, { a: 2 });
    const B = edits.apply(A.item, { b: "y" });
    const tickets = { A: A.ticket, B: B.ticket };
    // What the server holds after each successful request, in its order.
    let server: Item = base;
    let shown: Item | undefined;
    order.forEach((which, i) => {
      if (outcomes[i] === "ok") {
        server = { ...server, ...(which === "A" ? { a: 2 } : { b: "y" }) };
        shown = edits.succeed("1", tickets[which], server);
      } else {
        shown = edits.fail("1", tickets[which]);
      }
    });
    expect(shown).toEqual(expected);
  });

  it("ignores a response that arrives after a newer one (both succeed)", () => {
    const edits = new OptimisticEdits<Item>();
    const A = edits.apply(base, { a: 2 });
    const B = edits.apply(A.item, { b: "y" });
    // The server applied A then B; B's response arrives first, A's last.
    expect(edits.succeed("1", B.ticket, { id: "1", a: 2, b: "y" })).toEqual({ id: "1", a: 2, b: "y" });
    expect(edits.succeed("1", A.ticket, { id: "1", a: 2, b: "x" })).toEqual({ id: "1", a: 2, b: "y" });
  });

  it("ignores an old response even when a newer edit is still pending", () => {
    const edits = new OptimisticEdits<Item>();
    const A = edits.apply(base, { a: 2 });
    const B = edits.apply(A.item, { b: "y" });
    const C = edits.apply(B.item, { a: 3 });
    edits.succeed("1", B.ticket, { id: "1", a: 2, b: "y" });
    // A's stale response must not replace B's; C is still shown on top.
    expect(edits.succeed("1", A.ticket, { id: "1", a: 2, b: "x" })).toEqual({ id: "1", a: 3, b: "y" });
    expect(edits.fail("1", C.ticket)).toEqual({ id: "1", a: 2, b: "y" });
  });

  it("ignores a stale response after a reload reset the pending edits", () => {
    const edits = new OptimisticEdits<Item>();
    const A = edits.apply(base, { a: 2 });
    const B = edits.apply(A.item, { b: "y" });
    edits.reset(); // the list was reloaded from the server meanwhile
    expect(edits.succeed("1", B.ticket, { id: "1", a: 2, b: "y" })).toEqual({ id: "1", a: 2, b: "y" });
    expect(edits.succeed("1", A.ticket, { id: "1", a: 2, b: "x" })).toEqual({ id: "1", a: 2, b: "y" });
    // A later edit to the same item still lands on top of the newest answer.
    const C = edits.apply({ id: "1", a: 2, b: "y" }, { a: 3 });
    expect(edits.succeed("1", C.ticket, { id: "1", a: 3, b: "y" })).toEqual({ id: "1", a: 3, b: "y" });
  });

  it("re-derives computed values after every change", () => {
    const edits = new OptimisticEdits<Item>((i) => ({ ...i, b: `a=${i.a}` }));
    const A = edits.apply(base, { a: 5 });
    expect(A.item.b).toBe("a=5");
    expect(edits.fail("1", A.ticket)).toEqual({ id: "1", a: 1, b: "a=1" });
  });
});

describe("list helpers", () => {
  const items = [base, { id: "2", a: 2, b: "y" }];
  it("replaces, drops and restores items in place", () => {
    expect(replaceById(items, { ...base, a: 9 })[0]!.a).toBe(9);
    expect(withoutId(items, "1")).toEqual([items[1]]);
    expect(restoreAt([items[1]!], base, 0)).toEqual(items);
    expect(restoreAt(items, base, 1)).toBe(items);
  });
});

// A delete while an edit to the same item is in flight, then the delete fails:
// what goes back is what the edits say should show by then, whichever request
// settles first (review on #84).
describe("a failed delete during an edit", () => {
  type Outcome = "edit-fail" | "edit-ok";
  const cases: [string, Outcome, "before" | "after", Item][] = [
    ["edit fails, then delete fails", "edit-fail", "before", base],
    ["delete fails, then edit fails", "edit-fail", "after", base],
    ["edit succeeds, then delete fails", "edit-ok", "before", { ...base, a: 2 }],
    ["delete fails, then edit succeeds", "edit-ok", "after", { ...base, a: 2 }],
  ];
  it.each(cases)("%s", (_name, outcome, editSettles, expected) => {
    const edits = new OptimisticEdits<Item>();
    let list: Item[] = [base];
    const settleEdit = () => {
      const shown =
        outcome === "edit-ok"
          ? edits.succeed("1", A.ticket, { ...base, a: 2 })
          : edits.fail("1", A.ticket);
      if (shown) list = replaceById(list, shown); // no-op while deleted
    };
    const A = edits.apply(base, { a: 2 });
    list = replaceById(list, A.item);
    // Delete: the copy on screen carries the unconfirmed patch.
    const removed = list[0]!;
    const edited = edits.inFlight("1");
    list = withoutId(list, "1");
    expect(edited).toBe(true);
    if (editSettles === "before") settleEdit();
    // The delete fails.
    list = restoreAt(list, (edited ? edits.shown("1") : undefined) ?? removed, 0);
    if (editSettles === "after") settleEdit();
    expect(list).toEqual([expected]);
  });

  it("with nothing in flight at delete time, puts back the copy it removed", () => {
    const edits = new OptimisticEdits<Item>();
    const A = edits.apply(base, { a: 2 });
    edits.succeed("1", A.ticket, { ...base, a: 2 });
    // Later the item changed outside the edits (a reorder): the edits' own
    // record is now older than the copy on screen.
    const removed = { ...base, a: 2, b: "reordered" };
    expect(edits.inFlight("1")).toBe(false);
    expect(edits.shown("1")).toEqual({ ...base, a: 2 });
    expect(restoreAt([], removed, 0)).toEqual([removed]);
  });
});
