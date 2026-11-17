/* global console, URL */
// Spike probe: feed the A2UI v1.0 spec's own example stream to both protocol
// cores, headless, and report how each one resolves a `{"@path": …}` binding.
import { readFileSync } from "node:fs";
const lines = readFileSync(new URL("./spec-example.jsonl", import.meta.url), "utf8")
  .trim().split("\n").map((l) => JSON.parse(l));

// --- svelte-a2ui 0.2.0 -----------------------------------------------------
{
  const p = await import("svelte-a2ui/protocol");
  let state = p.INITIAL_STATE;
  const out = [];
  const warn = console.warn; const warns = [];
  console.warn = (...a) => warns.push(a.join(" "));
  for (const m of lines) {
    const r = p.reduce(state, m);
    state = r.state ?? r; if (r.outbound) out.push(...r.outbound);
  }
  console.warn = warn;
  const surface = state.surfaces?.contact_form_1 ?? state.surfaces?.get?.("contact_form_1");
  const comps = surface?.components;
  const field = comps?.first_name_field ?? comps?.get?.("first_name_field");
  console.log("svelte-a2ui: warnings:", [...new Set(warns)]);
  console.log("svelte-a2ui: first_name_field.value spec =", JSON.stringify(field?.value));
  console.log("svelte-a2ui: isPathRef({'@path'}) =", p.isPathRef(field?.value), "| isFunctionRef({'@call'}) =", p.isFunctionRef({ "@call": "required" }));
  console.log("svelte-a2ui: isPathRef(draft {path}) =", p.isPathRef({ path: "/contact/firstName" }));
  console.log("svelte-a2ui: outbound version tag =", p.A2UI_VERSION);
}

// --- @a2ui/web_core 0.15.0 (official) ---------------------------------------
{
  const c = await import("@a2ui/web_core/v1_0");
  const processor = new c.MessageProcessor([c.basicCatalog]);
  let surface;
  processor.onSurfaceCreated((s) => (surface = s));
  processor.processMessages(lines);
  const resolver = new c.NodeResolver(surface);
  const root = c.peekValue(resolver.rootNode);
  const find = (n, id) => {
    if (!c.isComponentNode(n)) return;
    if (n.componentId === id) return n;
    for (const v of Object.values(c.peekValue(n.props))) {
      for (const x of Array.isArray(v) ? v : [v]) { const hit = find(x, id); if (hit) return hit; }
    }
  };
  const field = find(root, "first_name_field");
  console.log("web_core: root type =", root?.type, "| nodes =", resolver.activeNodeCount);
  console.log("web_core: first_name_field resolved =", JSON.stringify(field?.toJSON()));
}
