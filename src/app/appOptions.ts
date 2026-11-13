import { defaultEnvironments, normalizeEnvironments } from "../components/common/environmentModel";
import type { Environment } from "../components/common/environmentModel";
import type { PasteDialogBounds, TerminalAppearance, TerminalFontStyle } from "../components/terminal/TerminalPane";
import { clampLargeDialogFrame, createDefaultScriptEditorFrame } from "./dialogFrame";
import { defaultAntiIdle, defaultKeepaliveCountMax, normalizeAntiIdle, normalizeKeepaliveCountMax } from "../components/common/antiIdleModel";
import type { AntiIdleOptions } from "../components/common/antiIdleModel";
import type { DialogFrame } from "./dialogFrame";
import { builtInTerminalSchemes, defaultTerminalSchemeId, findTerminalScheme, isSchemeId, normalizeCustomSchemes } from "../components/common/terminalSchemeModel";
import type { TerminalScheme } from "../components/common/terminalSchemeModel";
import { defaultWordDelimiters, normalizeWordDelimiters } from "../components/terminal/terminalSelection";
import { defaultHighlightOptions, normalizeHighlightOptions } from "../components/terminal/terminalHighlights";
import type { HighlightOptions } from "../components/terminal/terminalHighlights";

/** The Options (settings.json "appOptions"): types, defaults and validation of stored values. */

export type ThemeMode = "dark" | "light";
export type ScriptButtonBarPosition = "bottom" | "top" | "left" | "right";
export type TerminalTabPosition = "top" | "left" | "right";
/** "inverse": selected cells swap to inverted colors; "highlight": a tinted layer. */
export type TerminalSelectionStyle = "inverse" | "highlight";

export type AppOptions = {
  openDuplicateSessions: boolean;
  /** New tabs start protected (tmux / screen on the server); switched on for critical periods. */
  protectNewSessions: boolean;
  uiScale: number;
  uiFontSize: number;
  theme: ThemeMode;
  terminalAppearance: TerminalAppearance;
  /** Default terminal color scheme (built-in or custom id). */
  terminalSchemeId: string;
  /** The user's own schemes (copies of a built-in one, edited in Options > Terminal). */
  customTerminalSchemes: TerminalScheme[];
  terminalScrollback: number;
  terminalSelectionStyle: TerminalSelectionStyle;
  /** Characters besides white space that end a word for the double click. */
  terminalWordDelimiters: string;
  /** New output brings the view back down when it is scrolled back less than one screen (SecureCRT). */
  terminalScrollOnOutput: boolean;
  /** Colors for matches in terminal output (ORA- errors, warnings...), the same for every session. */
  terminalHighlights: HighlightOptions;
  terminalTabPosition: TerminalTabPosition;
  terminalTabSize: number;
  scriptButtonBarPosition: ScriptButtonBarPosition;
  scriptButtonBarSize: number;
  scriptButtonEditorFrame: DialogFrame;
  pasteDialogBounds: PasteDialogBounds;
  x11ServerMode: "auto" | "manual";
  x11ExecutablePath: string;
  terminalRecordingDirectory: string;
  environments: Environment[];
  /** Anti-idle default for hosts without their own settings. */
  antiIdle: AntiIdleOptions;
  /** Unanswered keep-alives before a terminal connection counts as dead (all hosts). */
  keepaliveCountMax: number;
  /** After a session reconnects, continue the SFTP transfers a lost connection paused. */
  sftpAutoResume: boolean;
  /** Play the handshake on the password screen's brand stage (still anyway with reduced motion). */
  startupAnimation: boolean;
};

const legacyOptionsStorageKey = "shellium:options";
export const scriptButtonBarPositions: Array<{ value: ScriptButtonBarPosition; label: string }> = [
  { value: "bottom", label: "Bottom" },
  { value: "top", label: "Top" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
];
export const terminalTabPositions: Array<{ value: TerminalTabPosition; label: string }> = [
  { value: "top", label: "Top" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
];

export const uiScaleOptions = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
export const uiFontSizeOptions = [11, 12, 13, 14, 15, 16];
const platform = typeof window === "undefined" ? undefined : window.shellium?.app.platform;

/**
 * Terminal fonts offered in the font dialog. Windows keeps its own list; macOS and Linux get fonts
 * they actually have, led by JetBrains Mono, which ships with Shellium (src/styles/fonts.css).
 */
export const terminalFontFamilies = platform === "darwin"
  ? ["JetBrains Mono", "SF Mono", "Menlo", "Monaco", "Courier New"]
  : platform === "linux"
    ? ["JetBrains Mono", "DejaVu Sans Mono", "Ubuntu Mono", "Liberation Mono", "Noto Sans Mono"]
    : ["Cascadia Mono", "Consolas", "Lucida Console", "Courier New", "MS Gothic", "NSimSun", "SimSun-ExtB", "SimSun-ExtG"];

/**
 * Font for xterm and the font preview. On macOS / Linux a font the system lacks (e.g. a Windows
 * font from an imported profile) would fall back to a proportional font, which xterm measures
 * wrongly - letters end up far apart - so the bundled JetBrains Mono and "monospace" follow it.
 * Windows is left as it was.
 */
export function terminalFontStack(fontFamily: string) {
  return platform === "win32" || platform === undefined
    ? fontFamily
    : `"${fontFamily.replace(/"/g, "")}", "JetBrains Mono Variable", monospace`;
}
export const terminalFontStyles: Array<{ value: TerminalFontStyle; label: string }> = [
  { value: "regular", label: "Regular" },
  { value: "italic", label: "Oblique" },
  { value: "bold", label: "Bold" },
  { value: "boldItalic", label: "Bold Oblique" },
];
export const terminalFontSizes = Array.from({ length: 41 }, (_, index) => index + 8);
export const terminalScrollbackOptions = [1000, 5000, 10000, 20000, 50000, 100000];
const defaultTerminalAppearance: TerminalAppearance = {
  fontFamily: platform === "darwin" || platform === "linux" ? "JetBrains Mono" : "Cascadia Mono",
  fontStyle: "regular",
  fontSize: 14,
};

export const defaultOptions: AppOptions = {
  openDuplicateSessions: false,
  protectNewSessions: false,
  uiScale: 1,
  uiFontSize: 13,
  theme: "dark",
  terminalAppearance: defaultTerminalAppearance,
  terminalSchemeId: defaultTerminalSchemeId,
  customTerminalSchemes: [],
  terminalScrollback: 10000,
  terminalSelectionStyle: "inverse",
  terminalWordDelimiters: defaultWordDelimiters,
  terminalScrollOnOutput: true,
  terminalHighlights: defaultHighlightOptions,
  terminalTabPosition: "top",
  terminalTabSize: 248,
  scriptButtonBarPosition: "bottom",
  scriptButtonBarSize: 168,
  scriptButtonEditorFrame: createDefaultScriptEditorFrame(),
  pasteDialogBounds: createDefaultPasteDialogBounds(),
  x11ServerMode: "auto",
  x11ExecutablePath: "",
  terminalRecordingDirectory: "",
  environments: defaultEnvironments,
  antiIdle: defaultAntiIdle,
  keepaliveCountMax: defaultKeepaliveCountMax,
  sftpAutoResume: true,
  startupAnimation: true,
};

export function normalizeUiScale(value: unknown) {
  return typeof value === "number" && uiScaleOptions.includes(value) ? value : defaultOptions.uiScale;
}

export function normalizeUiFontSize(value: unknown) {
  return typeof value === "number" && uiFontSizeOptions.includes(value) ? value : defaultOptions.uiFontSize;
}

export function normalizeTheme(value: unknown): ThemeMode {
  return value === "light" || value === "dark" ? value : defaultOptions.theme;
}

export function normalizeTerminalFontStyle(value: unknown): TerminalFontStyle {
  return value === "regular" || value === "italic" || value === "bold" || value === "boldItalic" ? value : defaultTerminalAppearance.fontStyle;
}

export function normalizeColor(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export function normalizeTerminalScrollback(value: unknown) {
  return typeof value === "number" && terminalScrollbackOptions.includes(value) ? value : defaultOptions.terminalScrollback;
}

export function normalizeTerminalTabPosition(value: unknown): TerminalTabPosition {
  return value === "left" || value === "right" || value === "top" ? value : defaultOptions.terminalTabPosition;
}

export function normalizeTerminalTabSize(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(420, Math.max(200, value)) : defaultOptions.terminalTabSize;
}

export function normalizeScriptButtonBarPosition(value: unknown): ScriptButtonBarPosition {
  return value === "left" || value === "right" || value === "bottom" || value === "top" ? value : defaultOptions.scriptButtonBarPosition;
}

export function normalizeScriptButtonBarSize(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(360, Math.max(120, value)) : defaultOptions.scriptButtonBarSize;
}

export function createDefaultPasteDialogBounds(): PasteDialogBounds {
  const width = Math.min(720, Math.max(420, window.innerWidth - 32));
  const height = Math.min(520, Math.max(300, window.innerHeight - 96));

  return {
    left: Math.max(16, Math.round((window.innerWidth - width) / 2)),
    top: Math.max(48, Math.round((window.innerHeight - height) / 2)),
    width,
    height,
  };
}

export function normalizeTerminalAppearance(value: unknown): TerminalAppearance {
  const parsed = typeof value === "object" && value !== null ? value as Partial<TerminalAppearance> : {};
  const normalizedSize = typeof parsed.fontSize === "number" && parsed.fontSize >= 8 && parsed.fontSize <= 48 ? parsed.fontSize : defaultTerminalAppearance.fontSize;

  return {
    fontFamily: typeof parsed.fontFamily === "string" && parsed.fontFamily.trim().length > 0 ? parsed.fontFamily : defaultTerminalAppearance.fontFamily,
    fontStyle: normalizeTerminalFontStyle(parsed.fontStyle),
    fontSize: normalizedSize,
  };
}

/**
 * Before color schemes (2.0.0) the terminal had four colors of its own. Colors that differ from the
 * old defaults become a custom scheme "My colors" (selected), so nobody loses their look.
 */
function migrateLegacyTerminalColors(appearance: unknown): TerminalScheme | null {
  if (typeof appearance !== "object" || appearance === null) return null;
  const old = appearance as Record<string, unknown>;
  const base = builtInTerminalSchemes[0];
  const pick = (key: string, fallback: string) => normalizeColor(old[key], fallback).toLowerCase();
  const colors = {
    background: pick("backgroundColor", base.background),
    foreground: pick("foregroundColor", base.foreground),
    cursor: pick("cursorColor", base.cursor),
    selection: pick("selectionBackground", base.selection),
  };
  const changed = colors.background !== base.background || colors.foreground !== base.foreground
    || colors.cursor !== base.cursor || colors.selection !== base.selection;
  return changed ? { ...base, ...colors, ansi: [...base.ansi], id: "custom-my-colors", name: "My colors" } : null;
}

function normalizeStoredScriptButtonEditorFrame(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return createDefaultScriptEditorFrame();
  }

  const frame = value as Partial<DialogFrame>;
  return clampLargeDialogFrame({
    x: typeof frame.x === "number" && Number.isFinite(frame.x) ? frame.x : createDefaultScriptEditorFrame().x,
    y: typeof frame.y === "number" && Number.isFinite(frame.y) ? frame.y : createDefaultScriptEditorFrame().y,
    width: typeof frame.width === "number" && Number.isFinite(frame.width) ? frame.width : createDefaultScriptEditorFrame().width,
    height: typeof frame.height === "number" && Number.isFinite(frame.height) ? frame.height : createDefaultScriptEditorFrame().height,
  });
}

function normalizeStoredPasteDialogBounds(value: unknown) {
  const defaults = createDefaultPasteDialogBounds();

  if (typeof value !== "object" || value === null) {
    return defaults;
  }

  const bounds = value as Partial<PasteDialogBounds>;
  const width = typeof bounds.width === "number" && Number.isFinite(bounds.width) ? Math.min(Math.max(bounds.width, 420), Math.max(420, window.innerWidth - 32)) : defaults.width;
  const height = typeof bounds.height === "number" && Number.isFinite(bounds.height) ? Math.min(Math.max(bounds.height, 300), Math.max(300, window.innerHeight - 32)) : defaults.height;

  return {
    left: typeof bounds.left === "number" && Number.isFinite(bounds.left) ? Math.min(Math.max(16, bounds.left), Math.max(16, window.innerWidth - width - 16)) : defaults.left,
    top: typeof bounds.top === "number" && Number.isFinite(bounds.top) ? Math.min(Math.max(16, bounds.top), Math.max(16, window.innerHeight - height - 16)) : defaults.top,
    width,
    height,
  };
}

export function areDialogFramesEqual(left: DialogFrame, right: DialogFrame) {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}
export function normalizeAppOptions(value: unknown): AppOptions {
  const parsedOptions = typeof value === "object" && value !== null ? { ...defaultOptions, ...(value as Partial<AppOptions>) } : defaultOptions;

  return {
    ...parsedOptions,
    openDuplicateSessions: typeof parsedOptions.openDuplicateSessions === "boolean" ? parsedOptions.openDuplicateSessions : defaultOptions.openDuplicateSessions,
    protectNewSessions: typeof parsedOptions.protectNewSessions === "boolean" ? parsedOptions.protectNewSessions : defaultOptions.protectNewSessions,
    uiScale: normalizeUiScale(parsedOptions.uiScale),
    uiFontSize: normalizeUiFontSize(parsedOptions.uiFontSize),
    theme: normalizeTheme(parsedOptions.theme),
    terminalAppearance: normalizeTerminalAppearance(parsedOptions.terminalAppearance),
    ...normalizeTerminalSchemeOptions(value),
    terminalScrollback: normalizeTerminalScrollback(parsedOptions.terminalScrollback),
    terminalSelectionStyle: parsedOptions.terminalSelectionStyle === "highlight" ? "highlight" : "inverse",
    terminalWordDelimiters: normalizeWordDelimiters(parsedOptions.terminalWordDelimiters),
    terminalHighlights: normalizeHighlightOptions(parsedOptions.terminalHighlights),
    terminalScrollOnOutput: typeof parsedOptions.terminalScrollOnOutput === "boolean" ? parsedOptions.terminalScrollOnOutput : defaultOptions.terminalScrollOnOutput,
    terminalTabPosition: normalizeTerminalTabPosition(parsedOptions.terminalTabPosition),
    terminalTabSize: normalizeTerminalTabSize(parsedOptions.terminalTabSize),
    scriptButtonBarPosition: normalizeScriptButtonBarPosition(parsedOptions.scriptButtonBarPosition),
    scriptButtonBarSize: normalizeScriptButtonBarSize(parsedOptions.scriptButtonBarSize),
    scriptButtonEditorFrame: normalizeStoredScriptButtonEditorFrame(parsedOptions.scriptButtonEditorFrame),
    pasteDialogBounds: normalizeStoredPasteDialogBounds(parsedOptions.pasteDialogBounds),
    x11ServerMode: parsedOptions.x11ServerMode === "manual" ? "manual" : "auto",
    x11ExecutablePath: typeof parsedOptions.x11ExecutablePath === "string" ? parsedOptions.x11ExecutablePath : "",
    terminalRecordingDirectory: typeof parsedOptions.terminalRecordingDirectory === "string" ? parsedOptions.terminalRecordingDirectory : "",
    environments: normalizeEnvironments(parsedOptions.environments),
    antiIdle: normalizeAntiIdle(parsedOptions.antiIdle),
    keepaliveCountMax: normalizeKeepaliveCountMax(parsedOptions.keepaliveCountMax),
    sftpAutoResume: typeof parsedOptions.sftpAutoResume === "boolean" ? parsedOptions.sftpAutoResume : defaultOptions.sftpAutoResume,
    startupAnimation: typeof parsedOptions.startupAnimation === "boolean" ? parsedOptions.startupAnimation : defaultOptions.startupAnimation,
  };
}

export function loadLegacyOptions(): AppOptions | null {
  try {
    const storedOptions = window.localStorage.getItem(legacyOptionsStorageKey);
    return storedOptions ? normalizeAppOptions(JSON.parse(storedOptions)) : null;
  } catch {
    return null;
  }
}


function normalizeTerminalSchemeOptions(value: unknown): Pick<AppOptions, "terminalSchemeId" | "customTerminalSchemes"> {
  const raw = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  let custom = normalizeCustomSchemes(raw.customTerminalSchemes);
  let selected = isSchemeId(raw.terminalSchemeId) ? raw.terminalSchemeId : undefined;
  if (raw.terminalSchemeId === undefined) {
    const migrated = migrateLegacyTerminalColors(raw.terminalAppearance);
    if (migrated && !custom.some((item) => item.id === migrated.id)) {
      custom = [...custom, migrated];
      selected = migrated.id;
    }
  }
  return {
    customTerminalSchemes: custom,
    terminalSchemeId: findTerminalScheme(selected, custom) ? selected as string : defaultTerminalSchemeId,
  };
}
