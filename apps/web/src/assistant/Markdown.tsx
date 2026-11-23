/**
 * The assistant's Markdown (issue #104): the upstream `react-markdown`
 * renderer with an explicit list of elements, for the sheet's answers and the
 * catalog's Text component alike. It builds React elements and never inserts
 * HTML: raw HTML in the text is shown as typed (react-markdown's default; no
 * rehype-raw), and there is no GFM plugin, so a table stays text.
 *
 * - Rendered: bold, italics, inline code, bullet and numbered lists,
 *   paragraphs and line breaks; a heading line as a bold line.
 * - A link shows its text and then its address as plain text; it is never
 *   clickable. An image shows its alt text and is never loaded.
 * - An unclosed marker in a streaming answer (`**Frost is`) is shown as typed
 *   until it closes.
 */
import ReactMarkdown, { type Components } from "react-markdown";
import { cn } from "@/lib/utils";

/** Every element the answers may produce; anything else is unwrapped to its text. */
const ALLOWED = ["p", "br", "strong", "em", "code", "pre", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "a", "img", "blockquote"];

const heading: Components["h1"] = ({ children }) => <p className="font-semibold">{children}</p>;

const COMPONENTS: Components = {
  p: ({ children }) => <p>{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  code: ({ children }) => <code className="rounded bg-muted px-1 py-px font-mono text-[0.9em]">{children}</code>,
  pre: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children, start }) => (
    <ol start={start} className="list-decimal space-y-1 pl-5">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  blockquote: ({ children }) => <div className="border-l-2 border-border pl-3">{children}</div>,
  h1: heading,
  h2: heading,
  h3: heading,
  h4: heading,
  h5: heading,
  h6: heading,
  // Never clickable: a model can be steered by text in a task, and a link in
  // the assistant's voice is an easy lure. The address is shown as text.
  a: ({ children, href }) => (
    <>
      {children}
      {href ? ` (${href})` : null}
    </>
  ),
  // Never loaded: the alt text only.
  img: ({ alt }) => <>{alt ?? ""}</>,
};

/** An answer (or a Text component's text) in the assistant's Markdown. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <ReactMarkdown allowedElements={ALLOWED} unwrapDisallowed components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

const INLINE: Components = { ...COMPONENTS, p: ({ children }) => <>{children}</> };

/** One line of Markdown inside an element of its own (a Text component's heading). */
export function MarkdownInline({ text }: { text: string }) {
  return (
    <ReactMarkdown allowedElements={ALLOWED} unwrapDisallowed components={INLINE}>
      {text}
    </ReactMarkdown>
  );
}
