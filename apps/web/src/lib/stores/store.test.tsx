import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Store, useStore } from "./store";

class Counter extends Store<{ count: number; label: string }> {
  constructor() {
    super({ count: 2, label: "rocks" });
  }
  bump(): void {
    this.setState({ count: this.state.count + 1 });
  }
}

describe("useStore", () => {
  it("returns the whole snapshot, or the selected slice", () => {
    const store = new Counter();
    store.bump();
    function Whole() {
      const s = useStore(store);
      return <p>{`${s.count} ${s.label}`}</p>;
    }
    function Selected() {
      const count = useStore(store, (s) => s.count);
      return <p>{count}</p>;
    }
    expect(renderToString(<Whole />)).toBe("<p>3 rocks</p>");
    expect(renderToString(<Selected />)).toBe("<p>3</p>");
  });
});
