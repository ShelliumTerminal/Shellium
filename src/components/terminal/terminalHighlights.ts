/**
 * Highlight rules (Options > Terminal): regular expressions whose matches in new terminal output are
 * drawn in a color - ORA-01555 red, WARNING yellow, "completed successfully" green. Global for all
 * sessions. React-free: TerminalPane applies the matches as xterm decorations.
 */

export const highlightColors = ["red", "yellow", "green", "blue", "magenta", "cyan"] as const;
export type HighlightColor = (typeof highlightColors)[number];

export type HighlightRule = {
  id: string;
  pattern: string;
  color: HighlightColor;
  ignoreCase: boolean;
  enabled: boolean;
};

export type HighlightOptions = {
  enabled: boolean;
  rules: HighlightRule[];
};

/** Errors and messages DBAs look for: Oracle, SQL*Plus, RMAN, Data Pump, listener, OS tools. */
export const oracleHighlightRules: HighlightRule[] = [
  { id: "oracle-errors", pattern: "\\b(ORA|TNS|RMAN|SP2|PLS|EXP|IMP|UDE|UDI|LRM|DGM|CRS|PRCR|CLSRSC)-\\d{3,5}\\b", color: "red", ignoreCase: false, enabled: true },
  // not inside file names and paths: error.log, /var/log/failed, warn-2024.trc stay plain
  { id: "error-words", pattern: "(?<![./-])\\b(error|errors|failed|failure|fatal|corrupt\\w*|denied|refused|invalid|abort\\w*)\\b(?![./-]\\w)", color: "red", ignoreCase: true, enabled: true },
  { id: "warning-words", pattern: "(?<![./-])\\b(warning|warn|deprecated|timeout|timed out|retrying)\\b(?![./-]\\w)", color: "yellow", ignoreCase: true, enabled: true },
  { id: "success-words", pattern: "\\b(success(ful|fully)?|completed successfully|succeeded)\\b", color: "green", ignoreCase: true, enabled: true },
  // Status columns of v$ views and crsctl / srvctl, in capitals only: "open" in a sentence stays plain.
  { id: "status-bad", pattern: "\\b(OFFLINE|INVALID|UNUSABLE|UNAVAILABLE|INTERMEDIATE|UNKNOWN|STALE)\\b", color: "red", ignoreCase: false, enabled: true },
  { id: "status-good", pattern: "\\b(ONLINE|OPEN|READ WRITE|VALID|AVAILABLE|USABLE|ACTIVE|STABLE)\\b", color: "green", ignoreCase: false, enabled: true },
];

export const defaultHighlightOptions: HighlightOptions = {
  enabled: true,
  rules: oracleHighlightRules,
};

const maxRules = 50;
const maxPatternLength = 500;

function isHighlightColor(value: unknown): value is HighlightColor {
  return typeof value === "string" && (highlightColors as readonly string[]).includes(value);
}

export function normalizeHighlightOptions(value: unknown): HighlightOptions {
  if (typeof value !== "object" || value === null) {
    return defaultHighlightOptions;
  }
  const raw = value as Partial<HighlightOptions>;
  const rules = Array.isArray(raw.rules)
    ? raw.rules.slice(0, maxRules).flatMap((item, index): HighlightRule[] => {
      if (typeof item !== "object" || item === null || typeof item.pattern !== "string") {
        return [];
      }
      return [{
        id: typeof item.id === "string" && item.id ? item.id : `rule-${index}`,
        pattern: item.pattern.slice(0, maxPatternLength),
        color: isHighlightColor(item.color) ? item.color : "red",
        ignoreCase: Boolean(item.ignoreCase),
        enabled: item.enabled !== false,
      }];
    })
    : defaultHighlightOptions.rules;
  return { enabled: raw.enabled !== false, rules };
}

/** Null when the pattern is a valid regular expression, else the browser's message. */
export function getPatternError(pattern: string) {
  if (!pattern.trim()) {
    return "Empty pattern";
  }
  try {
    new RegExp(pattern);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid pattern";
  }
}

export type CompiledHighlightRule = { regex: RegExp; color: HighlightColor };

/** The rules that are on and valid, ready to run. Invalid patterns are skipped, not thrown. */
export function compileHighlightRules(options: HighlightOptions): CompiledHighlightRule[] {
  if (!options.enabled) {
    return [];
  }
  return options.rules.flatMap((rule) => {
    if (!rule.enabled || getPatternError(rule.pattern)) {
      return [];
    }
    return [{ regex: new RegExp(rule.pattern, rule.ignoreCase ? "gi" : "g"), color: rule.color }];
  });
}

export type HighlightMatch = { start: number; end: number; color: HighlightColor };

/**
 * Matches of all rules in one line of text. Where matches overlap the earlier rule wins, so a red
 * "ORA-01555" is not repainted by a later rule. At most `limit` matches per line.
 */
export function findHighlights(text: string, rules: CompiledHighlightRule[], limit = 64): HighlightMatch[] {
  const matches: HighlightMatch[] = [];
  const taken: Array<[number, number]> = [];
  for (const rule of rules) {
    rule.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.regex.exec(text)) !== null && matches.length < limit) {
      if (match[0].length === 0) {
        rule.regex.lastIndex += 1;
        continue;
      }
      const start = match.index;
      const end = start + match[0].length;
      if (!taken.some(([from, to]) => start < to && end > from)) {
        taken.push([start, end]);
        matches.push({ start, end, color: rule.color });
      }
    }
  }
  return matches.sort((left, right) => left.start - right.start);
}

/** Bright ANSI color of the session's scheme for each highlight color (xterm needs #RRGGBB). */
export function highlightColorHex(color: HighlightColor, ansi: readonly string[]) {
  const index = { red: 9, green: 10, yellow: 11, blue: 12, magenta: 13, cyan: 14 }[color];
  const fallback = { red: "#ff5555", green: "#50fa7b", yellow: "#f1fa8c", blue: "#6cb6ff", magenta: "#ff79c6", cyan: "#8be9fd" }[color];
  const value = ansi[index];
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}
