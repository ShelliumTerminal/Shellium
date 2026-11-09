/**
 * Terminal color schemes: background, foreground, cursor, selection and the 16 ANSI colors.
 *
 * A session's scheme resolves as: the host's own scheme > its environment's scheme > the default in
 * Options > Terminal. Built-in schemes live here; custom ones are copies the user edited, stored in
 * the app options. No React here.
 */

export const ansiColorNames = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
] as const;
export type AnsiColorName = (typeof ansiColorNames)[number];

export type TerminalScheme = {
  id: string;
  name: string;
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
  /** The 16 ANSI colors in ansiColorNames order. */
  ansi: string[];
};

export const defaultTerminalSchemeId = "shellium-dark";
export const maxCustomSchemes = 40;

const scheme = (id: string, name: string, [background, foreground, cursor, selection]: string[], ansi: string[]): TerminalScheme => ({
  id, name, background, foreground, cursor, selection, ansi,
});

export const builtInTerminalSchemes: TerminalScheme[] = [
  scheme("shellium-dark", "Shellium Dark", ["#0b0d0e", "#d1fae5", "#5eead4", "#134e4a"], [
    "#09090b", "#f87171", "#22c55e", "#facc15", "#60a5fa", "#d946ef", "#5eead4", "#f4f4f5",
    "#52525b", "#fca5a5", "#4ade80", "#fde047", "#93c5fd", "#f0abfc", "#99f6e4", "#ffffff",
  ]),
  scheme("shellium-light", "Shellium Light", ["#f8fafc", "#1e293b", "#0891b2", "#bae6fd"], [
    "#1e293b", "#dc2626", "#16a34a", "#a16207", "#2563eb", "#c026d3", "#0e7490", "#cbd5e1",
    "#64748b", "#ef4444", "#22c55e", "#ca8a04", "#3b82f6", "#d946ef", "#0891b2", "#e2e8f0",
  ]),
  scheme("shellium-production", "Shellium Production", ["#1a0b0f", "#fde2e4", "#fb7185", "#5b1a26"], [
    "#140709", "#f87171", "#4ade80", "#fbbf24", "#93c5fd", "#f0abfc", "#67e8f9", "#fce7e9",
    "#6b3a42", "#fca5a5", "#86efac", "#fcd34d", "#bfdbfe", "#f5d0fe", "#a5f3fc", "#ffffff",
  ]),
  scheme("dracula", "Dracula", ["#282a36", "#f8f8f2", "#f8f8f2", "#44475a"], [
    "#21222c", "#ff5555", "#50fa7b", "#f1fa8c", "#bd93f9", "#ff79c6", "#8be9fd", "#f8f8f2",
    "#6272a4", "#ff6e6e", "#69ff94", "#ffffa5", "#d6acff", "#ff92df", "#a4ffff", "#ffffff",
  ]),
  scheme("nord", "Nord", ["#2e3440", "#d8dee9", "#d8dee9", "#434c5e"], [
    "#3b4252", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#88c0d0", "#e5e9f0",
    "#4c566a", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#8fbcbb", "#eceff4",
  ]),
  scheme("one-dark", "One Dark", ["#282c34", "#abb2bf", "#528bff", "#3e4451"], [
    "#282c34", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#dcdfe4",
    "#5c6370", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#ffffff",
  ]),
  scheme("tokyo-night", "Tokyo Night", ["#1a1b26", "#c0caf5", "#c0caf5", "#33467c"], [
    "#15161e", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#a9b1d6",
    "#414868", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#c0caf5",
  ]),
  scheme("catppuccin-mocha", "Catppuccin Mocha", ["#1e1e2e", "#cdd6f4", "#f5e0dc", "#585b70"], [
    "#45475a", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#f5c2e7", "#94e2d5", "#bac2de",
    "#585b70", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#f5c2e7", "#94e2d5", "#a6adc8",
  ]),
  scheme("gruvbox-dark", "Gruvbox Dark", ["#282828", "#ebdbb2", "#ebdbb2", "#504945"], [
    "#282828", "#cc241d", "#98971a", "#d79921", "#458588", "#b16286", "#689d6a", "#a89984",
    "#928374", "#fb4934", "#b8bb26", "#fabd2f", "#83a598", "#d3869b", "#8ec07c", "#ebdbb2",
  ]),
  scheme("solarized-dark", "Solarized Dark", ["#002b36", "#839496", "#93a1a1", "#073642"], [
    "#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5",
    "#586e75", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4", "#93a1a1", "#fdf6e3",
  ]),
  scheme("solarized-light", "Solarized Light", ["#fdf6e3", "#657b83", "#586e75", "#eee8d5"], [
    "#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5",
    "#002b36", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4", "#93a1a1", "#fdf6e3",
  ]),
  scheme("github-dark", "GitHub Dark", ["#0d1117", "#e6edf3", "#2f81f7", "#264f78"], [
    "#484f58", "#ff7b72", "#3fb950", "#d29922", "#58a6ff", "#bc8cff", "#39c5cf", "#b1bac4",
    "#6e7681", "#ffa198", "#56d364", "#e3b341", "#79c0ff", "#d2a8ff", "#56d4dd", "#ffffff",
  ]),
  scheme("github-light", "GitHub Light", ["#ffffff", "#1f2328", "#0969da", "#add6ff"], [
    "#24292f", "#cf222e", "#116329", "#4d2d00", "#0969da", "#8250df", "#1b7c83", "#6e7781",
    "#57606a", "#a40e26", "#1a7f37", "#633c01", "#218bff", "#a475f9", "#3192aa", "#8c959f",
  ]),
  scheme("monokai", "Monokai", ["#272822", "#f8f8f2", "#f8f8f0", "#49483e"], [
    "#272822", "#f92672", "#a6e22e", "#f4bf75", "#66d9ef", "#ae81ff", "#a1efe4", "#f8f8f2",
    "#75715e", "#f92672", "#a6e22e", "#f4bf75", "#66d9ef", "#ae81ff", "#a1efe4", "#f9f8f5",
  ]),
];

const hexColor = /^#[0-9a-f]{6}$/i;
const schemeId = /^[a-z0-9-]{1,64}$/;

export function isSchemeId(value: unknown): value is string {
  return typeof value === "string" && schemeId.test(value);
}

export function createCustomSchemeId() {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** A stored custom scheme, repaired against `base` where a color is missing or malformed; null when unusable. */
export function normalizeTerminalScheme(value: unknown, base: TerminalScheme = builtInTerminalSchemes[0]): TerminalScheme | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Partial<TerminalScheme>;
  if (!isSchemeId(raw.id) || builtInTerminalSchemes.some((item) => item.id === raw.id)) return null;
  const color = (candidate: unknown, fallback: string) => (typeof candidate === "string" && hexColor.test(candidate) ? candidate.toLowerCase() : fallback);
  const ansi = Array.isArray(raw.ansi) ? raw.ansi : [];
  return {
    id: raw.id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 40) : "Custom",
    background: color(raw.background, base.background),
    foreground: color(raw.foreground, base.foreground),
    cursor: color(raw.cursor, base.cursor),
    selection: color(raw.selection, base.selection),
    ansi: base.ansi.map((fallback, index) => color(ansi[index], fallback)),
  };
}

export function normalizeCustomSchemes(value: unknown): TerminalScheme[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    const normalized = normalizeTerminalScheme(item);
    if (!normalized || seen.has(normalized.id)) return [];
    seen.add(normalized.id);
    return [normalized];
  }).slice(0, maxCustomSchemes);
}

export function allTerminalSchemes(custom: TerminalScheme[]) {
  return [...builtInTerminalSchemes, ...custom];
}

export function findTerminalScheme(id: string | undefined, custom: TerminalScheme[]): TerminalScheme | undefined {
  return id ? allTerminalSchemes(custom).find((item) => item.id === id) : undefined;
}

/**
 * The scheme a session uses: the host's own > its environment's > the default. An id that no longer
 * exists (deleted custom scheme, a host imported from another machine) falls through to the next.
 */
export function resolveTerminalScheme(
  hostSchemeId: string | undefined,
  environmentSchemeId: string | undefined,
  defaultSchemeId: string,
  custom: TerminalScheme[],
): TerminalScheme {
  return findTerminalScheme(hostSchemeId, custom)
    ?? findTerminalScheme(environmentSchemeId, custom)
    ?? findTerminalScheme(defaultSchemeId, custom)
    ?? builtInTerminalSchemes[0];
}

/** xterm.js theme for a scheme. */
export function xtermTheme(item: TerminalScheme) {
  const theme: Record<string, string> = {
    background: item.background,
    foreground: item.foreground,
    cursor: item.cursor,
    cursorAccent: item.background,
    selectionBackground: item.selection,
  };
  ansiColorNames.forEach((name, index) => {
    theme[name] = item.ansi[index];
  });
  return theme;
}
