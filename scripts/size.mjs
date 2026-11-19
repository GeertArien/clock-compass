#!/usr/bin/env node
// Frontend bundle size. Builds apps/web (skip with --no-build) and prints, in
// gzip (level 9, as Vite reports) and raw bytes:
//
// - First-load JS/CSS: what index.html pulls in through static imports, read
//   from the Vite build manifest. This is what every visit pays for.
// - Lazy JS: code reached only through import(), grouped by what loads it.
// - The service-worker precache size and entry count (from dist/sw.js).
//
// Until the assistant sheet ships in the app (issue #62), its code is reached
// only from the dev-only A2UI preview page. A second "probe" build
// (CC_SIZE_PROBE=1, output in dist-size-probe/, never deployed) adds that page
// so the assistant chunk can be measured on its own.
//
//   pnpm size              # build, print tables
//   pnpm size --no-build   # measure existing dist/ folders
//   pnpm size --markdown   # print Markdown tables for PR descriptions

import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
const args = new Set(process.argv.slice(2));
const app = { label: "Web (apps/web)", pkg: "@clock-compass/web", dir: "apps/web" };
const dist = join(root, app.dir, "dist");
const probeDist = join(root, app.dir, "dist-size-probe");
const ASSISTANT = "src/assistant/";

if (!args.has("--no-build")) {
  // The app imports the shared client package as source; no other build is needed.
  const build = (env, label) => {
    console.error(`Building ${app.pkg}${label}…`);
    execSync(`pnpm --filter ${app.pkg} build --manifest`, {
      cwd: root,
      stdio: ["ignore", "ignore", "inherit"],
      env: { ...process.env, ...env },
    });
  };
  build({}, "");
  build({ CC_SIZE_PROBE: "1" }, " (size probe with the A2UI preview page)");
}

function manifestOf(dir) {
  const path = join(dir, ".vite", "manifest.json");
  if (!existsSync(path)) throw new Error(`${path} not found — run without --no-build`);
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Manifest keys reachable from `entries` through static imports. */
function staticClosure(manifest, entries) {
  const seen = new Set();
  const visit = (key) => {
    if (seen.has(key) || !manifest[key]) return;
    seen.add(key);
    for (const next of manifest[key].imports ?? []) visit(next);
  };
  entries.forEach(visit);
  return seen;
}

/** The JS and CSS files of a set of manifest keys. */
function filesOf(manifest, keys) {
  const js = new Set();
  const css = new Set();
  for (const key of keys) {
    const chunk = manifest[key];
    if (chunk.file.endsWith(".js")) js.add(chunk.file);
    for (const file of chunk.css ?? []) css.add(file);
  }
  return { js: [...js], css: [...css] };
}

function measure(dir, files) {
  let raw = 0;
  let gzip = 0;
  for (const file of files) {
    const buf = readFileSync(join(dir, file));
    raw += buf.length;
    gzip += gzipSync(buf, { level: 9 }).length;
  }
  return { raw, gzip, files: files.length };
}

/** Code reached only through import() from `dynamicEntries`, minus `loaded`. */
function lazyFiles(manifest, dynamicEntries, loaded) {
  const keys = [...staticClosure(manifest, dynamicEntries)].filter((k) => !loaded.has(k));
  const files = filesOf(manifest, keys);
  const loadedFiles = filesOf(manifest, loaded);
  return {
    js: files.js.filter((f) => !loadedFiles.js.includes(f)),
    css: files.css.filter((f) => !loadedFiles.css.includes(f)),
  };
}

/** Precache entries injected by vite-plugin-pwa (injectManifest) into dist/sw.js. */
function precache(dir) {
  const sw = readFileSync(join(dir, "sw.js"), "utf8");
  // Counted the way vite-plugin-pwa reports it ("precache N entries (X KiB)"):
  // every manifest entry counts (the web-manifest icons appear twice), each
  // file's bytes once.
  const urls = [...sw.matchAll(/"url":\s*"([^"]+)"/g)].map((m) => m[1]);
  const bytes = [...new Set(urls)].reduce((sum, url) => sum + statSync(join(dir, url)).size, 0);
  return { entries: urls.length, bytes };
}

const kB = (n) => `${(n / 1000).toFixed(1)} kB`;
const KiB = (n) => `${(n / 1024).toFixed(1)} KiB`;
const size = (m) => (m.files === 0 ? "—" : `${kB(m.raw)} (${kB(m.gzip)} gzip)`);

// The app as deployed.
const manifest = manifestOf(dist);
const firstLoadKeys = staticClosure(manifest, ["index.html"]);
const firstLoad = filesOf(manifest, firstLoadKeys);
const appDynamic = Object.keys(manifest).filter((k) => manifest[k].isDynamicEntry);
const appLazy = lazyFiles(manifest, appDynamic, firstLoadKeys);

// The assistant chunk, from the probe build: everything the assistant's
// dynamic entries reach that neither page loads up front.
const probe = manifestOf(probeDist);
const probeLoaded = staticClosure(probe, Object.keys(probe).filter((k) => probe[k].isEntry));
const assistantEntries = Object.keys(probe).filter(
  (k) => probe[k].isDynamicEntry && k.startsWith(ASSISTANT),
);
const assistant = lazyFiles(probe, assistantEntries, probeLoaded);

const rows = [
  ["First-load JS", size(measure(dist, firstLoad.js))],
  ["First-load CSS", size(measure(dist, firstLoad.css))],
  ["Lazy JS in the app", size(measure(dist, appLazy.js))],
  ["Assistant chunk JS (lazy, probe build)", size(measure(probeDist, assistant.js))],
  ["Assistant chunk CSS (lazy, probe build)", size(measure(probeDist, assistant.css))],
];
const pc = precache(dist);
rows.push(["SW precache", `${KiB(pc.bytes)}, ${pc.entries} entries`]);

const header = [app.label, "Size"];
if (args.has("--markdown")) {
  console.log(`| ${header.join(" | ")} |`);
  console.log(`|${header.map(() => "---").join("|")}|`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
} else {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(line(header));
  console.log(line(widths.map((w) => "-".repeat(w))));
  for (const row of rows) console.log(line(row));
}
