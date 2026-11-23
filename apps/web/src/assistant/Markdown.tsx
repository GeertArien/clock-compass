/**
 * Renders the assistant's Markdown subset (markdown.ts) with React elements
 * only: never dangerouslySetInnerHTML, so anything else in the text,
 * HTML included, is shown as text. One renderer for the sheet's answers and
 * the catalog's Text component.
 */
import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { parseInline, parseMarkdown, type Block, type Inline } from "./markdown";

function renderInline(nodes: Inline[], key = ""): ReactNode[] {
  return nodes.map((node, i) => {
    const k = `${key}${i}`;
    switch (node.type) {
      case "text":
        return <Fragment key={k}>{node.text}</Fragment>;
      case "strong":
        return (
          <strong key={k} className="font-semibold">
            {renderInline(node.children, `${k}.`)}
          </strong>
        );
      case "em":
        return <em key={k}>{renderInline(node.children, `${k}.`)}</em>;
      case "code":
        return (
          <code key={k} className="rounded bg-muted px-1 py-px font-mono text-[0.9em]">
            {node.text}
          </code>
        );
    }
  });
}

/** Lines joined with line breaks. */
function renderLines(lines: Inline[][], key: string): ReactNode[] {
  return lines.flatMap((line, i) => [...(i ? [<br key={`${key}br${i}`} />] : []), ...renderInline(line, `${key}l${i}.`)]);
}

function renderList(block: Extract<Block, { type: "list" }>, key: string): ReactNode {
  const items = block.items.map((item, i) => (
    <li key={i} className="pl-0.5">
      {renderLines(item.content, `${key}i${i}`)}
      {item.sublist ? renderList(item.sublist, `${key}i${i}s`) : null}
    </li>
  ));
  return block.ordered ? (
    <ol key={key} start={block.start === 1 ? undefined : block.start} className="list-decimal space-y-1 pl-5">
      {items}
    </ol>
  ) : (
    <ul key={key} className="list-disc space-y-1 pl-5">
      {items}
    </ul>
  );
}

/** An answer in the assistant's Markdown subset, as blocks. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {parseMarkdown(text).map((block, i) => {
        const key = `b${i}`;
        if (block.type === "list") return renderList(block, key);
        if (block.type === "heading") {
          return (
            <p key={key} className="font-semibold">
              {renderInline(block.content, key)}
            </p>
          );
        }
        return <p key={key}>{renderLines(block.lines, key)}</p>;
      })}
    </div>
  );
}

/** One line of the subset (bold, italics, code), for text inside a heading or a label. */
export function MarkdownInline({ text }: { text: string }) {
  return <>{renderInline(parseInline(text))}</>;
}
