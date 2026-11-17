import { describe, expect, it } from "vitest";
import { projectNameFromEntry, unzipCsvFiles } from "./zip.js";

/**
 * Build a minimal ZIP (single central directory, no data descriptors) from a
 * set of named entries so we can round-trip through {@link unzipCsvFiles}
 * without a zip dependency. `deflate` picks compression method 8 (via the
 * platform CompressionStream) vs. stored (0).
 */
async function makeZip(
  files: { name: string; text: string }[],
  deflate = false,
): Promise<Blob> {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const raw = enc.encode(f.text);
    const stored = deflate
      ? new Uint8Array(
          await new Response(
            new Blob([raw as BlobPart])
              .stream()
              .pipeThrough(new CompressionStream("deflate-raw")),
          ).arrayBuffer(),
        )
      : raw;
    const method = deflate ? 8 : 0;

    const local = new Uint8Array(30 + nameBytes.length + stored.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, stored.length, true); // compressed size
    lv.setUint32(22, raw.length, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(stored, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, stored.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true); // local header offset
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralOffset = offset;
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true);

  return new Blob([...locals, ...centrals, eocd] as BlobPart[]);
}

describe("unzipCsvFiles", () => {
  const csvA = "TYPE,CONTENT\ntask,Alpha\n";
  const csvB = "TYPE,CONTENT\ntask,Beta\n";

  it("extracts stored (uncompressed) CSV entries as UTF-8 text", async () => {
    const zip = await makeZip([
      { name: "Errands [111].csv", text: csvA },
      { name: "Work [222].csv", text: csvB },
    ]);
    const entries = await unzipCsvFiles(zip);
    expect(entries.map((e) => e.name)).toEqual([
      "Errands [111].csv",
      "Work [222].csv",
    ]);
    expect(entries[0]!.text).toBe(csvA);
    expect(entries[1]!.text).toBe(csvB);
  });

  it("inflates deflate-compressed entries", async () => {
    const long = "TYPE,CONTENT\n" + "task,Repeated row\n".repeat(50);
    const zip = await makeZip([{ name: "Big [9].csv", text: long }], true);
    const [entry] = await unzipCsvFiles(zip);
    expect(entry!.text).toBe(long);
  });

  it("ignores non-CSV and directory entries", async () => {
    const zip = await makeZip([
      { name: "readme.txt", text: "not a csv" },
      { name: "nested/", text: "" },
      { name: "Home [3].csv", text: csvA },
    ]);
    const entries = await unzipCsvFiles(zip);
    expect(entries.map((e) => e.name)).toEqual(["Home [3].csv"]);
  });

  it("rejects a file with no central directory", async () => {
    await expect(unzipCsvFiles(new Blob(["nonsense"]))).rejects.toThrow(
      /valid \.zip/,
    );
  });
});

describe("projectNameFromEntry", () => {
  it("strips the directory, .csv, and Todoist id suffix", () => {
    expect(projectNameFromEntry("Errands [2345678901].csv")).toBe("Errands");
    expect(projectNameFromEntry("sub/dir/Work Projects [42].csv")).toBe(
      "Work Projects",
    );
    expect(projectNameFromEntry("Inbox.csv")).toBe("Inbox");
  });
});
