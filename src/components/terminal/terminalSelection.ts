/**
 * Mouse selection units for the terminal's own selection (TerminalPane), SecureCRT style: a double
 * click selects a word, a triple click the whole line, and dragging after either grows the
 * selection word by word / line by line. React-free, so it can be tested on its own.
 *
 * Points are buffer rows and string columns; an end point is exclusive.
 */

export type SelectionPoint = { row: number; column: number };
export type SelectionSpan = { start: SelectionPoint; end: SelectionPoint };

/** What the selection needs to know about the terminal buffer. */
export type SelectionRows = {
  /** Number of rows in the buffer. */
  length: number;
  /** The row's text with trailing spaces kept (a row the terminal wrapped is full width). */
  text(row: number): string;
  /** Length of the row's text without trailing spaces. */
  contentLength(row: number): number;
  /** True when the row continues the row above it (the terminal wrapped a long line). */
  isWrapped(row: number): boolean;
};

/**
 * Characters that end a word besides white space. Paths (/u01/app/oracle), names with - _ . $ and
 * user@host stay one word; quotes, brackets, ":", ",", ";", "|" and "=" split, so a double click
 * picks ORA-01843 out of "ORA-01843:" and ORCL out of ORACLE_SID=ORCL.
 */
export const defaultWordDelimiters = "\"'`()[]{}<>,;:|=";

/** Keeps the delimiters a user typed in Options: white space always delimits, at most 64 characters. */
export function normalizeWordDelimiters(value: unknown) {
  if (typeof value !== "string") {
    return defaultWordDelimiters;
  }
  return Array.from(new Set(Array.from(value.replace(/\s/g, "")))).join("").slice(0, 64);
}

export function comparePoints(left: SelectionPoint, right: SelectionPoint) {
  return left.row === right.row ? left.column - right.column : left.row - right.row;
}

const isSpace = (character: string | undefined) => character === undefined || /\s/.test(character);

/**
 * The word under the point, also when the terminal wrapped it onto the next row. A delimiter
 * character selects itself, a run of spaces inside the line selects the spaces; past the end of the
 * line there is nothing to select (null).
 */
export function findWordSpan(rows: SelectionRows, point: SelectionPoint, delimiters: string): SelectionSpan | null {
  const { row, column } = point;
  if (row < 0 || row >= rows.length || column >= rows.contentLength(row)) {
    return null;
  }

  const text = rows.text(row);
  const character = text[column];

  if (isSpace(character)) {
    let start = column;
    let end = column + 1;
    while (start > 0 && isSpace(text[start - 1])) {
      start -= 1;
    }
    while (end < rows.contentLength(row) && isSpace(text[end])) {
      end += 1;
    }
    return { start: { row, column: start }, end: { row, column: end } };
  }

  if (delimiters.includes(character)) {
    return { start: { row, column }, end: { row, column: column + 1 } };
  }

  const isWordCharacter = (value: string | undefined) => !isSpace(value) && !delimiters.includes(value as string);

  let startRow = row;
  let startColumn = column;
  for (;;) {
    if (startColumn > 0 && isWordCharacter(rows.text(startRow)[startColumn - 1])) {
      startColumn -= 1;
      continue;
    }
    if (startColumn === 0 && startRow > 0 && rows.isWrapped(startRow)) {
      const previous = rows.text(startRow - 1);
      if (previous.length > 0 && isWordCharacter(previous[previous.length - 1])) {
        startRow -= 1;
        startColumn = previous.length - 1;
        continue;
      }
    }
    break;
  }

  let endRow = row;
  let endColumn = column + 1;
  for (;;) {
    const current = rows.text(endRow);
    if (endColumn < current.length && isWordCharacter(current[endColumn])) {
      endColumn += 1;
      continue;
    }
    if (endColumn >= current.length && endRow + 1 < rows.length && rows.isWrapped(endRow + 1) && isWordCharacter(rows.text(endRow + 1)[0])) {
      endRow += 1;
      endColumn = 1;
      continue;
    }
    break;
  }

  return { start: { row: startRow, column: startColumn }, end: { row: endRow, column: endColumn } };
}

/** The whole line the row belongs to: every row the terminal wrapped it onto. */
export function findLineSpan(rows: SelectionRows, row: number): SelectionSpan {
  let first = row;
  while (first > 0 && rows.isWrapped(first)) {
    first -= 1;
  }
  let last = row;
  while (last + 1 < rows.length && rows.isWrapped(last + 1)) {
    last += 1;
  }
  return { start: { row: first, column: 0 }, end: { row: last, column: rows.contentLength(last) } };
}

/**
 * Dragging after a double / triple click: the selection always holds the word / line clicked first
 * (origin) and reaches out to the whole word / line under the pointer (unit), forwards or backwards.
 */
export function extendSpan(origin: SelectionSpan, unit: SelectionSpan): { anchor: SelectionPoint; focus: SelectionPoint } {
  if (comparePoints(unit.end, origin.end) > 0) {
    return { anchor: origin.start, focus: unit.end };
  }
  if (comparePoints(unit.start, origin.start) < 0) {
    return { anchor: origin.end, focus: unit.start };
  }
  return { anchor: origin.start, focus: origin.end };
}

/** Alt+drag (block / column selection): the rows and the columns [left, right) of the rectangle. */
export function getBlockBounds(anchor: SelectionPoint, focus: SelectionPoint) {
  return {
    top: Math.min(anchor.row, focus.row),
    bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.column, focus.column),
    right: Math.max(anchor.column, focus.column) + 1,
  };
}

/** The text of a block selection: the same columns of every row, one line per row. */
export function getBlockText(rows: SelectionRows, anchor: SelectionPoint, focus: SelectionPoint) {
  const { top, bottom, left, right } = getBlockBounds(anchor, focus);
  const lines: string[] = [];
  for (let row = top; row <= bottom && row < rows.length; row += 1) {
    lines.push(rows.text(row).slice(left, right).trimEnd());
  }
  return lines.join("\n");
}
