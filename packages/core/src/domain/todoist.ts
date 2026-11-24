/**
 * Todoist CSV export parsing (build-order step 8). The user exports a project
 * as CSV from Todoist and uploads the file — no token, no OAuth, nothing
 * Todoist-related in the server env.
 *
 * Template/export columns (the stable subset we read):
 *   TYPE     - "task" | "section" | "note" (we import tasks only)
 *   CONTENT  - the task text
 *   PRIORITY - 1..4 where 1 = p1 (highest), matching Todoist's CSV templates
 *   DATE     - free-form due date ("13 Jun", "2026-06-13", recurring phrases)
 */

export interface TodoistRow {
  content: string;
  description: string | null;
  /** 1 (p1, highest) … 4 (p4, none). */
  priority: number;
  /** Raw DATE cell — may be empty or a recurring phrase. */
  date: string | null;
}

/** Minimal RFC-4180 CSV reader: quoted fields, escaped quotes, embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

/** Extract the task rows from a Todoist export (sections/notes/meta are skipped). */
export function parseTodoistCsv(csv: string): TodoistRow[] {
  // Real backup files start with a UTF-8 BOM, which would corrupt the first header.
  const rows = parseCsv(csv.replace(/^\uFEFF/, ""));
  if (rows.length === 0) return [];

  const header = rows[0]!.map((h) => h.trim().toUpperCase());
  const col = (name: string) => header.indexOf(name);
  const type = col("TYPE");
  const content = col("CONTENT");
  if (type === -1 || content === -1) {
    throw new Error("Not a Todoist export: missing TYPE/CONTENT columns");
  }
  const description = col("DESCRIPTION");
  const priority = col("PRIORITY");
  const date = col("DATE");

  const tasks: TodoistRow[] = [];
  for (const cells of rows.slice(1)) {
    if ((cells[type] ?? "").trim().toLowerCase() !== "task") continue;
    const text = (cells[content] ?? "").trim();
    if (!text) continue;
    const rawPriority = Number((priority !== -1 && cells[priority]) || 4);
    tasks.push({
      content: text,
      description:
        description !== -1 ? (cells[description] ?? "").trim() || null : null,
      priority: rawPriority >= 1 && rawPriority <= 4 ? rawPriority : 4,
      date: date !== -1 ? (cells[date] ?? "").trim() || null : null,
    });
  }
  return tasks;
}

/**
 * The p1–p4 seed mapping (the AI can refine later): p1 = a crisis (Q1),
 * p2 = important (Q2), p3 = merely urgent (Q3), p4 = neither (Q4).
 */
export function priorityToFlags(priority: number): {
  important: boolean;
  urgent: boolean;
} {
  switch (priority) {
    case 1:
      return { important: true, urgent: true };
    case 2:
      return { important: true, urgent: false };
    case 3:
      return { important: false, urgent: true };
    default:
      return { important: false, urgent: false };
  }
}

/**
 * Best-effort due date: real dates pass; recurring phrases don't (English and
 * Dutch, the DATE_LANGs seen in real exports — anything else unparseable
 * falls through to null anyway).
 */
export function parseTodoistDate(raw: string | null): Date | null {
  if (!raw) return null;
  if (recurringPhrase(raw)) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Todoist's recurring phrases, in English and Dutch ("every year", "elke maandag", "jaarlijks"). */
const RECURRING = /every|after|elke|jaarlijks|maandelijks|wekelijks|dagelijks/i;

/** The DATE cell when it is a recurring phrase (it has no date to import), else null. */
export function recurringPhrase(raw: string | null): string | null {
  return raw && RECURRING.test(raw) ? raw.trim() : null;
}

/**
 * The notes an imported task gets (#105 follow-up): its description, and a
 * recurring phrase kept as a line of its own ("Repeats in Todoist: every
 * year"), so nothing the export held is lost. The phrase is not turned into
 * a repeat rule; the task does not repeat until the user says so.
 */
export function todoistNotes(row: { description: string | null; date: string | null }): string | undefined {
  const phrase = recurringPhrase(row.date);
  const parts = [row.description, phrase ? `Repeats in Todoist: ${phrase}` : null].filter((p): p is string => !!p);
  return parts.length ? parts.join("\n\n") : undefined;
}
