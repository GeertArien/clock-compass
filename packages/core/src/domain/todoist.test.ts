import { describe, expect, it } from "vitest";
import {
  parseCsv,
  parseTodoistCsv,
  parseTodoistDate,
  priorityToFlags,
  recurringPhrase,
  todoistNotes,
} from "./todoist.js";

const EXPORT = `TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE
task,Buy groceries,,4,1,Geert (123),,2026-06-13,en,Europe/Brussels
note,"a comment on the task",,,,,,,,
task,"Reply to HOA, politely","Keep it short",3,1,Geert (123),,,en,
section,Errands,,,,,,,,
task,"Quote ""everything"" carefully",,1,1,Geert (123),,every day,en,
task,Plan the family trip,,2,1,Geert (123),,13 Jun,en,
`;

describe("parseCsv", () => {
  it("handles quoted fields, escaped quotes, and embedded commas", () => {
    const rows = parseCsv('a,"b,c","say ""hi"""\nd,e,f');
    expect(rows).toEqual([
      ["a", "b,c", 'say "hi"'],
      ["d", "e", "f"],
    ]);
  });
});

describe("parseTodoistCsv", () => {
  it("imports task rows only, with content, notes, priority, and date", () => {
    const tasks = parseTodoistCsv(EXPORT);
    expect(tasks).toHaveLength(4);
    expect(tasks[0]).toEqual({
      content: "Buy groceries",
      description: null,
      priority: 4,
      date: "2026-06-13",
    });
    expect(tasks[1]).toMatchObject({
      content: "Reply to HOA, politely",
      description: "Keep it short",
      priority: 3,
    });
    expect(tasks[2]).toMatchObject({
      content: 'Quote "everything" carefully',
      priority: 1,
      date: "every day",
    });
  });

  it("rejects files that are not Todoist exports", () => {
    expect(() => parseTodoistCsv("name,email\nGeert,x@y.z")).toThrow(/Todoist/);
  });

  it("handles real backup files: BOM, meta rows, blank rows, multiline notes", () => {
    const backup =
      "﻿TYPE,CONTENT,DESCRIPTION,IS_COLLAPSED,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE,DURATION,DURATION_UNIT,DEADLINE,DEADLINE_LANG\n" +
      "meta,view_style=list,,,,,,,,,,,,,\n" +
      ",,,,,,,,,,,,,,\n" +
      'task,Selfbill regelen,"Via het Peppol netwerk.\nTweede regel.",,4,1,Geert (1),,elke 1e,nl,Europe/Brussels,,,,\n';
    const tasks = parseTodoistCsv(backup);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      content: "Selfbill regelen",
      description: "Via het Peppol netwerk.\nTweede regel.",
      priority: 4,
      date: "elke 1e",
    });
  });
});

describe("priorityToFlags", () => {
  it("seeds quadrants from p1-p4 (1 = highest, per Todoist CSV)", () => {
    expect(priorityToFlags(1)).toEqual({ important: true, urgent: true }); // Q1
    expect(priorityToFlags(2)).toEqual({ important: true, urgent: false }); // Q2
    expect(priorityToFlags(3)).toEqual({ important: false, urgent: true }); // Q3
    expect(priorityToFlags(4)).toEqual({ important: false, urgent: false }); // Q4
  });
});

describe("parseTodoistDate", () => {
  it("parses real dates and drops recurring phrases", () => {
    expect(parseTodoistDate("2026-06-13")?.getFullYear()).toBe(2026);
    expect(parseTodoistDate("every day")).toBeNull();
    expect(parseTodoistDate("not a date at all")).toBeNull();
    expect(parseTodoistDate(null)).toBeNull();
  });

  it("drops Dutch recurring phrases from real exports", () => {
    for (const phrase of ["elke 4e donderdag", "elke maand", "jaarlijks", "elke 14e okt"]) {
      expect(parseTodoistDate(phrase)).toBeNull();
    }
  });
});

describe("a recurring phrase kept in the notes (#105 follow-up)", () => {
  it("recognises Todoist's recurring phrases in English and Dutch, and nothing else", () => {
    expect(recurringPhrase("every year")).toBe("every year");
    expect(recurringPhrase(" every 2 weeks ")).toBe("every 2 weeks");
    expect(recurringPhrase("elke maandag")).toBe("elke maandag");
    expect(recurringPhrase("jaarlijks")).toBe("jaarlijks");
    expect(recurringPhrase("2026-06-13")).toBeNull();
    expect(recurringPhrase("13 Jun")).toBeNull();
    expect(recurringPhrase(null)).toBeNull();
  });

  it("adds the phrase on a line of its own after the description, or alone", () => {
    expect(todoistNotes({ description: "Hoofdkraan in de kelder", date: "every year" })).toBe(
      "Hoofdkraan in de kelder\n\nRepeats in Todoist: every year",
    );
    expect(todoistNotes({ description: null, date: "elke maandag" })).toBe("Repeats in Todoist: elke maandag");
    expect(todoistNotes({ description: "Keep it short", date: "2026-06-13" })).toBe("Keep it short");
    expect(todoistNotes({ description: null, date: null })).toBeUndefined();
  });

  it("keeps any other date text that gave no due date, and never invents a year", () => {
    expect(todoistNotes({ description: null, date: "chaque lundi" })).toBe("Date in Todoist: chaque lundi");
    expect(todoistNotes({ description: "Bellen", date: "morgen" })).toBe("Bellen\n\nDate in Todoist: morgen");
    // "13 Jun" has no year: no due date (not 13 June 2001), and the text is kept.
    expect(parseTodoistDate("13 Jun")).toBeNull();
    expect(todoistNotes({ description: null, date: "13 Jun" })).toBe("Date in Todoist: 13 Jun");
    expect(todoistNotes({ description: null, date: "2026-06-13" })).toBeUndefined();
    expect(todoistNotes({ description: null, date: "13 Jun 2026" })).toBeUndefined();
  });
});
