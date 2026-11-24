/**
 * A host's own terminal settings (connect dialog > Terminal). Each one left out follows the default:
 * UTF-8, xterm-256color, and Options > Terminal > Backspace sends. Shared by the window and the main
 * process (which decodes / encodes the shell's bytes and asks the server for the terminal type).
 */
export type BackspaceKey = "del" | "ctrl-h";

export type HostTerminalSettings = {
  /** Character set of the server's terminal; absent = UTF-8. */
  encoding?: TerminalEncoding;
  /** What Backspace sends on this host; absent = the Options default. */
  backspace?: BackspaceKey;
  /** TERM the server is asked for; absent = xterm-256color. */
  termType?: TerminalType;
};

export const DEFAULT_TERMINAL_ENCODING = "utf-8";
export const DEFAULT_TERMINAL_TYPE = "xterm-256color";

/** UTF-8 and single-byte sets only: each of these maps one byte to one character both ways. */
export const terminalEncodings = [
  { value: "utf-8", label: "UTF-8" },
  { value: "iso-8859-9", label: "ISO-8859-9 (Turkish)" },
  { value: "windows-1254", label: "Windows-1254 (Turkish)" },
  { value: "iso-8859-1", label: "ISO-8859-1 (Western European)" },
  { value: "iso-8859-15", label: "ISO-8859-15 (Western European, €)" },
  { value: "windows-1252", label: "Windows-1252 (Western European)" },
] as const;

export type TerminalEncoding = (typeof terminalEncodings)[number]["value"];

export const terminalTypes = [
  { value: "xterm-256color", label: "xterm-256color" },
  { value: "xterm", label: "xterm" },
  { value: "xterm-color", label: "xterm-color" },
  { value: "vt220", label: "vt220" },
  { value: "vt100", label: "vt100" },
  { value: "linux", label: "linux" },
] as const;

export type TerminalType = (typeof terminalTypes)[number]["value"];

const encodingValues = new Set<string>(terminalEncodings.map((item) => item.value));
const typeValues = new Set<string>(terminalTypes.map((item) => item.value));

export function isTerminalEncoding(value: unknown): value is TerminalEncoding {
  return typeof value === "string" && encodingValues.has(value);
}

export function isTerminalType(value: unknown): value is TerminalType {
  return typeof value === "string" && typeValues.has(value);
}

/** Only the settings that differ from the defaults; undefined when there are none. */
export function normalizeHostTerminal(value: unknown): HostTerminalSettings | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const settings: HostTerminalSettings = {
    ...(isTerminalEncoding(source.encoding) && source.encoding !== DEFAULT_TERMINAL_ENCODING ? { encoding: source.encoding } : {}),
    ...(source.backspace === "del" || source.backspace === "ctrl-h" ? { backspace: source.backspace } : {}),
    ...(isTerminalType(source.termType) && source.termType !== DEFAULT_TERMINAL_TYPE ? { termType: source.termType } : {}),
  };
  return Object.keys(settings).length > 0 ? settings : undefined;
}

export function terminalEncodingLabel(value: string | undefined) {
  return terminalEncodings.find((item) => item.value === (value ?? DEFAULT_TERMINAL_ENCODING))?.label.replace(/ \(.*\)$/, "") ?? "UTF-8";
}
