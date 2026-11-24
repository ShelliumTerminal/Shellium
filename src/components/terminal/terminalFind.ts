import type { IBufferLine, IDecoration, IDisposable, IMarker, Terminal } from "@xterm/xterm";

export type TerminalFindOptions = {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
};

/** `index` is 0-based from the top of the scrollback, -1 when no match is selected. */
export type TerminalFindResults = { index: number; count: number; limited: boolean };

/** A match in cells: it starts at (row, col) and covers `cells` cells, continuing on the next rows. */
type Match = { row: number; col: number; cells: number };

/** One line as the program wrote it: its rows (the terminal wraps long lines) joined. */
type LogicalLine = { startRow: number; rowCount: number; text: string };

/** Matches counted and highlighted at most; past it the count shows "N+". */
const MATCH_LIMIT = 2000;
/** Waits this long after output before matches are counted again (tail -f). */
const REFRESH_DELAY_MS = 250;
const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** A regular expression the user typed that JavaScript cannot compile, or null. */
export function findPatternError(query: string, options: TerminalFindOptions) {
  if (!options.regex || !query) {
    return null;
  }
  try {
    new RegExp(query, "u");
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid pattern";
  }
}

/**
 * Lower case that keeps every character at its index, so a match's position in the folded text is its
 * position in the line. "İ".toLowerCase() is two characters ("i" + a combining dot) and would shift every
 * match after it in Turkish output; it folds to "i" here (and "I" to "i", as in an English search).
 */
export function foldCase(text: string) {
  const lower = text.toLowerCase();
  if (lower.length === text.length) {
    return lower;
  }
  let folded = "";
  for (const char of text) {
    const lowerChar = char === "İ" ? "i" : char.toLowerCase();
    folded += lowerChar.length === char.length ? lowerChar : char;
  }
  return folded;
}

function isWordBoundary(text: string, index: number, length: number) {
  const before = index > 0 ? text[index - 1] : "";
  const after = text[index + length] ?? "";
  return !(before && WORD_CHAR.test(before)) && !(after && WORD_CHAR.test(after));
}

/** Where each match starts in the line's text, and its length in characters. */
export function findInText(text: string, query: string, options: TerminalFindOptions, limit = MATCH_LIMIT) {
  const found: Array<{ index: number; length: number }> = [];
  if (!query) {
    return found;
  }
  if (options.regex) {
    const flags = "gu" + (options.caseSensitive ? "" : "i");
    const source = options.wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${query})(?![\\p{L}\\p{N}_])` : query;
    const pattern = new RegExp(source, flags);
    for (const match of text.matchAll(pattern)) {
      if (match[0].length === 0) {
        continue; // an empty match (^, a*) shows nothing
      }
      found.push({ index: match.index ?? 0, length: match[0].length });
      if (found.length >= limit) {
        break;
      }
    }
    return found;
  }
  const haystack = options.caseSensitive ? text : foldCase(text);
  const needle = options.caseSensitive ? query : foldCase(query);
  let index = haystack.indexOf(needle);
  while (index !== -1 && found.length < limit) {
    if (!options.wholeWord || isWordBoundary(text, index, needle.length)) {
      found.push({ index, length: needle.length });
    }
    index = haystack.indexOf(needle, index + 1);
  }
  return found;
}

function luminance(color: string | undefined) {
  const match = /^#?([0-9a-f]{6})$/i.exec(color?.trim() ?? "");
  if (!match) {
    return 0;
  }
  const value = parseInt(match[1], 16);
  const channel = (shift: number) => {
    const c = ((value >> shift) & 0xff) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

function matchColors(terminal: Terminal) {
  return luminance(terminal.options.theme?.background) > 0.5
    ? { match: "#fff0a0", active: "#ffb347", ruler: "#d9a400", activeRuler: "#b35c00" }
    : { match: "#5c4a12", active: "#b86a00", ruler: "#c9a227", activeRuler: "#ffc266" };
}

/**
 * Find in the terminal. Works in cells, not string offsets: wide characters (CJK, emoji) take two cells
 * and Turkish "İ" keeps its place, so the highlighted cells are the matched text. A line the terminal
 * wrapped is searched as one line. "older" goes up the scrollback, "newer" down; a search without a
 * current match starts at the bottom, so the first hit is the latest output. While a search is shown,
 * new output (tail -f) is searched too and the current match stays the same text.
 */
export function createTerminalFind(terminal: Terminal, onResults: (results: TerminalFindResults) => void) {
  let lines: LogicalLine[] | null = null;
  let query = "";
  let options: TerminalFindOptions = { caseSensitive: false, wholeWord: false, regex: false };
  let matches: Match[] = [];
  let limited = false;
  let current = -1;
  /** Follows the current match's row while the scrollback moves (lines dropped at the top). */
  let currentMarker: IMarker | null = null;
  let currentCol = -1;
  let decorations: IDecoration[] = [];
  let markers: IMarker[] = [];
  let refreshTimer: number | null = null;

  const readLines = () => {
    if (lines) {
      return lines;
    }
    const buffer = terminal.buffer.active;
    const result: LogicalLine[] = [];
    let row = 0;
    while (row < buffer.length) {
      const startRow = row;
      let text = "";
      do {
        const isLast = !buffer.getLine(row + 1)?.isWrapped;
        // keep a wrapped row's trailing spaces: they belong to the text; trim the line's real end
        text += buffer.getLine(row)?.translateToString(isLast) ?? "";
        row += 1;
      } while (row < buffer.length && buffer.getLine(row)?.isWrapped);
      result.push({ startRow, rowCount: row - startRow, text });
    }
    lines = result;
    return result;
  };

  /** Cell positions of the line's characters: start cell of each UTF-16 index (and one past the end). */
  const cellsOf = (line: LogicalLine) => {
    const buffer = terminal.buffer.active;
    const cols = terminal.cols;
    const starts: number[] = [];
    let cellIndex = 0; // cells counted from the line's first row
    for (let r = 0; r < line.rowCount; r += 1) {
      const bufferLine: IBufferLine | undefined = buffer.getLine(line.startRow + r);
      for (let x = 0; x < cols; x += 1) {
        const cell = bufferLine?.getCell(x);
        const width = cell?.getWidth() ?? 1;
        if (width === 0) {
          continue; // the second half of a wide character
        }
        const chars = cell?.getChars() || " ";
        for (let i = 0; i < chars.length; i += 1) {
          starts.push(r * cols + x);
        }
      }
      cellIndex = (r + 1) * cols;
    }
    starts.push(cellIndex);
    return starts;
  };

  const clearDecorations = () => {
    decorations.forEach((decoration) => decoration.dispose());
    markers.forEach((marker) => marker.dispose());
    decorations = [];
    markers = [];
  };

  const setCurrentMarker = (match: Match | undefined) => {
    currentMarker?.dispose();
    currentMarker = null;
    currentCol = -1;
    if (!match) {
      return;
    }
    const buffer = terminal.buffer.active;
    currentMarker = terminal.registerMarker(match.row - (buffer.baseY + buffer.cursorY)) ?? null;
    currentCol = match.col;
  };

  /** Colors every match (one decoration per row a match covers); the current one stronger. */
  const decorate = () => {
    clearDecorations();
    const colors = matchColors(terminal);
    const buffer = terminal.buffer.active;
    const cursorRow = buffer.baseY + buffer.cursorY;
    const cols = terminal.cols;
    matches.forEach((match, index) => {
      const isCurrent = index === current;
      let remaining = match.cells;
      let row = match.row;
      let x = match.col;
      while (remaining > 0) {
        const width = Math.min(remaining, cols - x);
        const marker = terminal.registerMarker(row - cursorRow);
        if (marker) {
          markers.push(marker);
          const decoration = terminal.registerDecoration({
            marker,
            x,
            width,
            backgroundColor: isCurrent ? colors.active : colors.match,
            layer: "top",
            overviewRulerOptions: row === match.row ? { color: isCurrent ? colors.activeRuler : colors.ruler, position: isCurrent ? "full" : "center" } : undefined,
          });
          if (decoration) {
            decorations.push(decoration);
          }
        }
        remaining -= width;
        row += 1;
        x = 0;
      }
    });
  };

  const report = () => onResults({ index: current, count: matches.length, limited });

  const collect = () => {
    const all: Match[] = [];
    limited = false;
    if (!query || findPatternError(query, options)) {
      return all;
    }
    const cols = terminal.cols;
    const allLines = readLines();
    // from the bottom up: past the limit, the newest matches are the ones kept
    for (let lineIndex = allLines.length - 1; lineIndex >= 0; lineIndex -= 1) {
      const line = allLines[lineIndex];
      if (!line.text) {
        continue;
      }
      const found = findInText(line.text, query, options);
      if (found.length === 0) {
        continue;
      }
      const starts = cellsOf(line);
      const lineMatches = found.map(({ index, length }) => {
        const startCell = starts[index] ?? 0;
        const endCell = starts[index + length] ?? starts[starts.length - 1];
        return {
          row: line.startRow + Math.floor(startCell / cols),
          col: startCell % cols,
          cells: Math.max(1, endCell - startCell),
        };
      });
      for (let i = lineMatches.length - 1; i >= 0 && all.length < MATCH_LIMIT; i -= 1) {
        all.push(lineMatches[i]);
      }
      if (all.length >= MATCH_LIMIT) {
        limited = true;
        break;
      }
    }
    return all.reverse();
  };

  const reveal = (match: Match) => {
    const buffer = terminal.buffer.active;
    const lastRow = match.row + Math.floor((match.col + match.cells - 1) / terminal.cols);
    if (match.row < buffer.viewportY || lastRow >= buffer.viewportY + terminal.rows) {
      terminal.scrollToLine(Math.max(0, Math.min(buffer.baseY, match.row - Math.floor(terminal.rows / 2))));
    }
    // selected too, so Copy takes the match
    terminal.select(match.col, match.row, match.cells);
  };

  /** Index of the match at or before (row, col), or -1. */
  const lastAtOrBefore = (row: number, col: number) => {
    for (let i = matches.length - 1; i >= 0; i -= 1) {
      const match = matches[i];
      if (match.row < row || (match.row === row && match.col <= col)) {
        return i;
      }
    }
    return -1;
  };

  const currentPosition = () =>
    currentMarker && !currentMarker.isDisposed && currentMarker.line >= 0 ? { row: currentMarker.line, col: currentCol } : null;

  const refresh = () => {
    refreshTimer = null;
    if (!query) {
      return;
    }
    const position = currentPosition();
    matches = collect();
    current = position ? matches.findIndex((match) => match.row === position.row && match.col === position.col) : -1;
    if (current === -1) {
      setCurrentMarker(undefined);
    }
    decorate();
    report();
  };

  const scheduleRefresh = () => {
    lines = null;
    if (!query || refreshTimer !== null) {
      return;
    }
    refreshTimer = window.setTimeout(refresh, REFRESH_DELAY_MS);
  };

  const disposables: IDisposable[] = [
    terminal.onWriteParsed(scheduleRefresh),
    terminal.onResize(scheduleRefresh),
  ];

  const clear = () => {
    if (refreshTimer !== null) {
      window.clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    query = "";
    matches = [];
    current = -1;
    limited = false;
    lines = null;
    setCurrentMarker(undefined);
    clearDecorations();
    terminal.clearSelection();
    report();
  };

  return {
    /**
     * Searches `nextQuery` and moves to a match: "older" one up, "newer" one down. `incremental` (typing,
     * an option changed) stays on the current match if it still matches, else takes the nearest older one.
     * Returns whether there is any match.
     */
    find(nextQuery: string, nextOptions: TerminalFindOptions, direction: "older" | "newer", incremental = false) {
      if (!nextQuery || findPatternError(nextQuery, nextOptions)) {
        clear();
        return false;
      }
      const changed = nextQuery !== query || JSON.stringify(nextOptions) !== JSON.stringify(options);
      const position = currentPosition();
      query = nextQuery;
      options = { ...nextOptions };
      if (changed || refreshTimer !== null) {
        if (refreshTimer !== null) {
          window.clearTimeout(refreshTimer);
          refreshTimer = null;
        }
        matches = collect();
      }
      if (matches.length === 0) {
        current = -1;
        setCurrentMarker(undefined);
        clearDecorations();
        terminal.clearSelection();
        report();
        return false;
      }
      const atPosition = position ? matches.findIndex((match) => match.row === position.row && match.col === position.col) : -1;
      if (incremental || changed) {
        if (atPosition !== -1) {
          current = atPosition;
        } else if (position) {
          const before = lastAtOrBefore(position.row, position.col);
          current = before !== -1 ? before : matches.length - 1;
        } else {
          current = matches.length - 1;
        }
      } else if (atPosition === -1) {
        current = matches.length - 1;
      } else if (direction === "older") {
        current = atPosition > 0 ? atPosition - 1 : matches.length - 1;
      } else {
        current = atPosition < matches.length - 1 ? atPosition + 1 : 0;
      }
      setCurrentMarker(matches[current]);
      decorate();
      reveal(matches[current]);
      report();
      return true;
    },
    clear,
    dispose() {
      clear();
      disposables.forEach((disposable) => disposable.dispose());
    },
  };
}

export type TerminalFind = ReturnType<typeof createTerminalFind>;
