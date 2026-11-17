/* global console, URL */
import { readFileSync } from "node:fs";
const c = await import("@a2ui/web_core/v1_0");
const raw = readFileSync(new URL("./spec-example.jsonl", import.meta.url), "utf8").trim();
function run(label, text) {
  const lines = text.split("\n").map((l) => JSON.parse(l));
  const processor = new c.MessageProcessor([c.basicCatalog]);
  let surface; processor.onSurfaceCreated((s) => (surface = s));
  try { processor.processMessages(lines); } catch (e) { console.log(label, "-> REJECTED:", e.message.slice(0, 160)); return; }
  const resolver = new c.NodeResolver(surface);
  const root = c.peekValue(resolver.rootNode);
  const find = (n, id) => {
    if (!c.isComponentNode(n)) return;
    if (n.componentId === id) return n;
    for (const v of Object.values(c.peekValue(n.props))) for (const x of Array.isArray(v) ? v : [v]) { const h = find(x, id); if (h) return h; }
  };
  const j = find(root, "email_field")?.toJSON();
  console.log(label, "-> OK root=" + root?.type, "nodes=" + resolver.activeNodeCount, "email_field=", JSON.stringify(j));
}
run("spec example verbatim (@checks)", raw);
run("with bare `checks` (early-1.0 draft key)", raw.replaceAll('"@checks"', '"checks"'));
run("with @accessibility", raw.replace('"id":"header_icon","component":"Icon"', '"id":"header_icon","@accessibility":{"label":"Mail"},"component":"Icon"').replaceAll('"@checks"', '"checks"'));
run("with @catalogId", raw.replace('"id":"header_icon","component":"Icon"', '"id":"header_icon","@catalogId":"https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json","component":"Icon"').replaceAll('"@checks"', '"checks"'));
run("with version v1.0", raw.replaceAll('"version": "1.0"', '"version": "v1.0"').replaceAll('"@checks"', '"checks"'));
