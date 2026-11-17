/**
 * A tiny, dependency-free ZIP reader — just enough to pull the CSV entries out
 * of a Todoist full-account backup (one CSV per project). We read the central
 * directory for reliable sizes/offsets and inflate DEFLATE entries with the
 * platform's `DecompressionStream('deflate-raw')` (no npm dependency).
 *
 * Only the two compression methods real exports use are handled: stored (0)
 * and deflate (8). Encrypted or other methods throw.
 */

export interface ZipEntry {
  /** Full path inside the archive (may include directories). */
  name: string;
  /** Decoded UTF-8 text of the entry. */
  text: string;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** Locate the End Of Central Directory record by scanning backwards. */
function findEocd(view: DataView): number {
  // The EOCD is 22 bytes plus an optional comment (max 65535). Scan from the
  // earliest position it could start.
  const min = Math.max(0, view.byteLength - (22 + 0xffff));
  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

async function inflate(bytes: Uint8Array, method: number): Promise<Uint8Array> {
  if (method === 0) return bytes;
  if (method !== 8) {
    throw new Error(`Unsupported ZIP compression method ${method}`);
  }
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Extract every entry whose name ends in `.csv` from a ZIP file, decoded as
 * UTF-8 text. Directory entries and other files are ignored.
 */
export async function unzipCsvFiles(file: Blob): Promise<ZipEntry[]> {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);

  const eocd = findEocd(view);
  if (eocd === -1) throw new Error("Not a valid .zip file");

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  const decoder = new TextDecoder("utf-8");
  const entries: ZipEntry[] = [];

  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new Error("Corrupt ZIP central directory");
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(
      new Uint8Array(buffer, offset + 46, nameLen),
    );

    // Advance to the next central-directory record before any early continue.
    offset += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/") || !name.toLowerCase().endsWith(".csv")) continue;

    if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
      throw new Error("Corrupt ZIP local header");
    }
    // The local header repeats name/extra lengths, which may differ from the
    // central record's — read them here to find where the data starts.
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = new Uint8Array(buffer, dataStart, compressedSize);

    const inflated = await inflate(compressed, method);
    entries.push({ name, text: decoder.decode(inflated) });
  }

  return entries;
}

/**
 * Derive a Project name from a backup CSV's path: drop any directory, the
 * `.csv` extension, and the ` [1234567890]` id suffix Todoist appends.
 */
export function projectNameFromEntry(name: string): string {
  const base = name.split("/").pop() ?? name;
  return base.replace(/\.csv$/i, "").replace(/ \[[^\]]+\]$/, "").trim();
}
