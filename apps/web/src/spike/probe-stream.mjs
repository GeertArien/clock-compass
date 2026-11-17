/* global console */
// Streaming probe: one component per updateComponents message, children first
// (root last) and root first (children missing), on both protocol cores.
const week = [
  { id: "root", component: "Column", children: ["title", "note"] },
  { id: "title", component: "Text", text: "## Hello" },
  { id: "note", component: "TextField", label: "Note", value: { "@path": "/note" } },
];
const stream = (order) => [
  { version: "1.0", createSurface: { surfaceId: "s", catalogId: "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json" } },
  ...order.map((i) => ({ version: "1.0", updateComponents: { surfaceId: "s", components: [week[i]] } })),
  { version: "1.0", updateDataModel: { surfaceId: "s", value: { note: "hi" } } },
];
const c = await import("@a2ui/web_core/v1_0");
for (const [label, order] of [["root first", [0, 1, 2]], ["root last", [1, 2, 0]]]) {
  const processor = new c.MessageProcessor([c.basicCatalog]);
  let resolver; const states = [];
  processor.onSurfaceCreated((s) => { resolver = new c.NodeResolver(s); });
  try {
    for (const m of stream(order)) {
      processor.processMessages([m]);
      const root = resolver && c.peekValue(resolver.rootNode);
      states.push(root ? `${root.type}[${(c.peekValue(root.props).children ?? []).map((n) => n.state).join(",")}]` : "-");
    }
    console.log("web_core", label, "->", states.join(" | "));
  } catch (e) { console.log("web_core", label, "-> REJECTED after", states.length, "msgs:", e.message.slice(0, 140)); }
}
const p = await import("svelte-a2ui/protocol");
for (const [label, order] of [["root first", [0, 1, 2]], ["root last", [1, 2, 0]]]) {
  let state = p.INITIAL_STATE; const seen = [];
  for (const m of stream(order)) { const r = p.reduce(state, m); state = r.state ?? r; const s = state.surfaces?.s ?? state.surfaces?.get?.("s"); seen.push(s ? Object.keys(s.components ?? {}).length || s.components?.size || 0 : 0); }
  console.log("svelte-a2ui", label, "-> component counts", seen.join(" | "));
}
