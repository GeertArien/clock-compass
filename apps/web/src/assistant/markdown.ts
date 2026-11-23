/**
 * The small, safe subset of Markdown the assistant's answers may use (issue
 * #104), parsed to a tree that `Markdown.tsx` renders with React elements
 * only. Nothing from the model is ever inserted as HTML.
 *
 * Rendered: **bold**, *italic* / _italic_, `code`, bullet and numbered lists
 * (one level of nesting), paragraphs and line breaks, and a heading line
 * (shown as a bold line). Shown as text: HTML, images, tables. A link shows
 * its text followed by the address in plain text, never as a clickable link.
 *
 * An answer arrives in pieces, so a marker that is not closed (yet) is shown
 * as typed: nothing flickers and no character is lost.
 *
 * Framework-free; tested in markdown.test.ts.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "code"; text: string };

export interface ListItem {
  content: Inline[][];
  /** One nested list, at most. */
  sublist?: Extract<Block, { type: "list" }>;
}

export type Block =
  /** Lines of one paragraph, shown with line breaks between them. */
  | { type: "paragraph"; lines: Inline[][] }
  | { type: "heading"; content: Inline[] }
  | { type: "list"; ordered: boolean; start: number; items: ListItem[] };

const BULLET = /^( *)([-*+])\s+(.*)$/;
const NUMBERED = /^( *)(\d{1,9})[.)]\s+(.*)$/;
const HEADING = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/;

interface ListMarker {
  indent: number;
  ordered: boolean;
  number: number;
  text: string;
}

function listMarker(line: string): ListMarker | null {
  const bullet = BULLET.exec(line);
  // "**bold** at the start" is not a bullet: a bullet needs a space after the marker.
  if (bullet) return { indent: bullet[1]!.length, ordered: false, number: 1, text: bullet[3]! };
  const numbered = NUMBERED.exec(line);
  if (numbered) return { indent: numbered[1]!.length, ordered: true, number: Number(numbered[2]), text: numbered[3]! };
  return null;
}

/** Parses an answer into blocks. Never throws. */
export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: Inline[][] | null = null;
  let list: Extract<Block, { type: "list" }> | null = null;
  let listIndent = 0;

  const endParagraph = () => {
    if (paragraph) blocks.push({ type: "paragraph", lines: paragraph });
    paragraph = null;
  };
  const endList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\t/g, "  ");
    if (!line.trim()) {
      endParagraph();
      endList();
      continue;
    }
    const marker = listMarker(line);
    if (marker) {
      endParagraph();
      const current = list as Extract<Block, { type: "list" }> | null;
      const lastItem = current?.items.at(-1);
      // Indented under an item of the current list: a nested list (one level).
      if (current && lastItem && marker.indent >= listIndent + 2) {
        if (!lastItem.sublist || lastItem.sublist.ordered !== marker.ordered) {
          lastItem.sublist = { type: "list", ordered: marker.ordered, start: marker.number, items: [] };
        }
        lastItem.sublist.items.push({ content: [parseInline(marker.text)] });
        continue;
      }
      if (!current || current.ordered !== marker.ordered) {
        endList();
        list = { type: "list", ordered: marker.ordered, start: marker.number, items: [] };
        listIndent = marker.indent;
      }
      list!.items.push({ content: [parseInline(marker.text)] });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      endParagraph();
      endList();
      blocks.push({ type: "heading", content: parseInline(heading[1]!) });
      continue;
    }
    // An indented line right after a list item continues that item.
    const current = list as Extract<Block, { type: "list" }> | null;
    if (current && /^ {2,}\S/.test(line)) {
      const item = current.items.at(-1)!;
      const target = item.sublist?.items.at(-1) ?? item;
      target.content.push(parseInline(line.trim()));
      continue;
    }
    endList();
    (paragraph ??= []).push(parseInline(line.trim()));
  }
  endParagraph();
  endList();
  return blocks;
}

const isWord = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
const isSpace = (ch: string | undefined) => ch === undefined || /\s/.test(ch);

/** Where an emphasis run opened at `from` closes, or -1 (then it is shown as typed). */
function closingOf(text: string, from: number, marker: string): number {
  const ch = marker[0]!;
  for (let i = from + marker.length; i <= text.length - marker.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text.startsWith(marker, i)) {
      // A closing marker follows a non-space; `_` must not sit inside a word (snake_case).
      if (isSpace(text[i - 1]) || i === from + marker.length) continue;
      if (ch === "_" && isWord(text[i + marker.length])) continue;
      // `*x*` must not close on the first star of a `**`.
      if (marker === "*" && text[i + 1] === "*") {
        i++;
        continue;
      }
      return i;
    }
  }
  return -1;
}

/** Parses one line of inline Markdown. Unclosed markers stay as typed. Never throws. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ type: "text", text: buffer });
    buffer = "";
  };

  for (let i = 0; i < text.length; ) {
    const ch = text[i]!;
    if (ch === "\\" && i + 1 < text.length && /[\\`*_[\]()#!-]/.test(text[i + 1]!)) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ type: "code", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "*" || ch === "_") {
      const marker = text[i + 1] === ch ? ch + ch : ch;
      const opensWord = !isSpace(text[i + marker.length]) && !(ch === "_" && isWord(text[i - 1]));
      if (opensWord) {
        const end = closingOf(text, i, marker);
        if (end !== -1) {
          flush();
          const children = parseInline(text.slice(i + marker.length, end));
          out.push(marker.length === 2 ? { type: "strong", children } : { type: "em", children });
          i = end + marker.length;
          continue;
        }
      }
      buffer += marker;
      i += marker.length;
      continue;
    }
    // [text](address): the text, then the address as plain text. Images stay as typed.
    if (ch === "[" && text[i - 1] !== "!") {
      const link = /^\[([^\]\n]*)\]\(([^)\s]*)\)/.exec(text.slice(i));
      if (link) {
        flush();
        out.push(...parseInline(link[1]!));
        if (link[2]) out.push({ type: "text", text: ` (${link[2]})` });
        i += link[0].length;
        continue;
      }
    }
    buffer += ch;
    i++;
  }
  flush();
  return out;
}

function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.type === "text" || n.type === "code" ? n.text : inlineText(n.children))).join("");
}

/**
 * The answer's words without the markers, for the screen-reader
 * announcement: paragraphs and list items as sentences on their own lines.
 */
export function plainText(source: string): string {
  const lines: string[] = [];
  const list = (block: Extract<Block, { type: "list" }>) => {
    for (const item of block.items) {
      lines.push(item.content.map(inlineText).join(" "));
      if (item.sublist) list(item.sublist);
    }
  };
  for (const block of parseMarkdown(source)) {
    if (block.type === "paragraph") lines.push(block.lines.map(inlineText).join(" "));
    else if (block.type === "heading") lines.push(inlineText(block.content));
    else list(block);
  }
  return lines.join("\n");
}
