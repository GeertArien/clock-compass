#!/usr/bin/env node
// Frontend bundle size. Builds apps/web (skip with --no-build), then prints raw
// and gzipped totals for the JS and CSS the page loads (dist/assets/*.js and
// *.css; the service worker is counted separately) and the service-worker
// precache size and entry count from the dist/sw.js manifest.
//
//   pnpm size              # build, print a table
//   pnpm size --no-build   # measure existing dist/ folders
//   pnpm size --markdown   # print a Markdown table for PR descriptions

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
const args = new Set(process.argv.slice(2));

const APPS = [{ label: "Web (apps/web)", pkg: "@clock-compass/web", dir: "apps/web" }];

if (!args.has("--no-build")) {
  // The app imports the shared client package as source; no other build is needed.
  for (const app of APPS) {
    console.error(`Building ${app.pkg}…`);
    execSync(`pnpm --filter ${app.pkg} build`, { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
  }
}

/** Sum raw and gzip (level 9, as Vite reports) sizes for files with one extension. */
function totals(assetsDir, ext) {
  let raw = 0;
  let gzip = 0;
  let files = 0;
  for (const name of readdirSync(assetsDir)) {
    if (!name.endsWith(ext)) continue;
    const buf = readFileSync(join(assetsDir, name));
    raw += buf.length;
    gzip += gzipSync(buf, { level: 9 }).length;
    files += 1;
  }
  return { raw, gzip, files };
}

/** Precache entries injected by vite-plugin-pwa (injectManifest) into dist/sw.js. */
function precache(dist) {
  const sw = readFileSync(join(dist, "sw.js"), "utf8");
  // Counted the way vite-plugin-pwa reports it ("precache N entries (X KiB)"):
  // every manifest entry counts (the web-manifest icons appear twice), each
  // file's bytes once.
  const urls = [...sw.matchAll(/"url":\s*"([^"]+)"/g)].map((m) => m[1]);
  const bytes = [...new Set(urls)].reduce((sum, url) => sum + statSync(join(dist, url)).size, 0);
  return { entries: urls.length, bytes };
}

function measure(app) {
  const dist = join(root, app.dir, "dist");
  if (!existsSync(dist)) throw new Error(`${app.dir}/dist not found — run without --no-build`);
  const assets = join(dist, "assets");
  return { ...app, js: totals(assets, ".js"), css: totals(assets, ".css"), precache: precache(dist) };
}

const kB = (n) => `${(n / 1000).toFixed(1)} kB`;
const KiB = (n) => `${(n / 1024).toFixed(1)} KiB`;

const rows = APPS.map(measure).map((r) => [
  r.label,
  `${kB(r.js.raw)} (${kB(r.js.gzip)} gzip)`,
  `${kB(r.css.raw)} (${kB(r.css.gzip)} gzip)`,
  `${KiB(r.precache.bytes)}, ${r.precache.entries} entries`,
]);
const header = ["App", "JS", "CSS", "SW precache"];

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
