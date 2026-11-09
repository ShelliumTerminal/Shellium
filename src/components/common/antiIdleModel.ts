/**
 * Anti-idle settings (SecureCRT-style), used by the renderer and the main process.
 *
 * - "NO-OP" is the SSH keep-alive (ssh2 `keepaliveInterval`): a protocol message every N seconds that
 *   never reaches the shell. Unlike SecureCRT's NO-OP it expects an answer, so a dead link is noticed
 *   after `keepaliveCountMax` unanswered ones and the tab turns red (no automatic reconnect).
 * - "String" is text written to the shell after N seconds without traffic in either direction, for
 *   firewalls / bastions that cut idle sessions even while keep-alives flow. It reaches whatever
 *   program is running, so it is off by default.
 */
export type AntiIdleOptions = {
  noopEnabled: boolean;
  noopSeconds: number;
  stringEnabled: boolean;
  /** Escapes: \r \n \t \\ */
  stringText: string;
  stringSeconds: number;
};

export const ANTI_IDLE_NOOP_RANGE = { min: 5, max: 3600 };
export const ANTI_IDLE_STRING_RANGE = { min: 10, max: 86400 };
export const ANTI_IDLE_STRING_MAX_LENGTH = 64;
export const KEEPALIVE_COUNT_MAX_RANGE = { min: 1, max: 30 };

export const defaultAntiIdle: AntiIdleOptions = {
  noopEnabled: true,
  noopSeconds: 60,
  stringEnabled: false,
  stringText: "",
  stringSeconds: 300,
};

export const defaultKeepaliveCountMax = 3;

function clampInteger(value: unknown, range: { min: number; max: number }, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(range.max, Math.max(range.min, Math.round(value)))
    : fallback;
}

export function normalizeAntiIdle(value: unknown, fallback: AntiIdleOptions = defaultAntiIdle): AntiIdleOptions {
  const parsed = typeof value === "object" && value !== null ? value as Partial<AntiIdleOptions> : {};
  const stringText = typeof parsed.stringText === "string" ? parsed.stringText.slice(0, ANTI_IDLE_STRING_MAX_LENGTH) : fallback.stringText;
  return {
    noopEnabled: typeof parsed.noopEnabled === "boolean" ? parsed.noopEnabled : fallback.noopEnabled,
    noopSeconds: clampInteger(parsed.noopSeconds, ANTI_IDLE_NOOP_RANGE, fallback.noopSeconds),
    // Nothing to send means nothing is sent.
    stringEnabled: (typeof parsed.stringEnabled === "boolean" ? parsed.stringEnabled : fallback.stringEnabled) && stringText.length > 0,
    stringText,
    stringSeconds: clampInteger(parsed.stringSeconds, ANTI_IDLE_STRING_RANGE, fallback.stringSeconds),
  };
}

/** A host's own settings, or undefined when it follows the Options default. */
export function normalizeHostAntiIdle(value: unknown): AntiIdleOptions | undefined {
  return typeof value === "object" && value !== null ? normalizeAntiIdle(value) : undefined;
}

export function normalizeKeepaliveCountMax(value: unknown) {
  return clampInteger(value, KEEPALIVE_COUNT_MAX_RANGE, defaultKeepaliveCountMax);
}

/** "\r" typed in the settings becomes a carriage return, and so on. */
export function decodeAntiIdleString(text: string) {
  return text.replace(/\\(r|n|t|\\)/g, (_match, code: string) => (code === "r" ? "\r" : code === "n" ? "\n" : code === "t" ? "\t" : "\\"));
}

/** What the main process applies to one terminal connection. */
export type ConnectionKeepalive = {
  /** ssh2 keepaliveInterval in ms, 0 = off. */
  keepaliveIntervalMs: number;
  keepaliveCountMax: number;
  antiIdle?: { text: string; seconds: number };
};

export function resolveConnectionKeepalive(hostSettings: AntiIdleOptions | undefined, defaults: AntiIdleOptions, countMax: number): ConnectionKeepalive {
  const settings = normalizeAntiIdle(hostSettings ?? defaults);
  const text = decodeAntiIdleString(settings.stringText);
  return {
    keepaliveIntervalMs: settings.noopEnabled ? settings.noopSeconds * 1000 : 0,
    keepaliveCountMax: normalizeKeepaliveCountMax(countMax),
    ...(settings.stringEnabled && text ? { antiIdle: { text, seconds: settings.stringSeconds } } : {}),
  };
}

/** The main process re-checks what the window sent (bounds, length) before using it. */
export function normalizeConnectionKeepalive(value: unknown): ConnectionKeepalive {
  const parsed = typeof value === "object" && value !== null ? value as Partial<ConnectionKeepalive> : {};
  const interval = typeof parsed.keepaliveIntervalMs === "number" && Number.isFinite(parsed.keepaliveIntervalMs) ? parsed.keepaliveIntervalMs : defaultAntiIdle.noopSeconds * 1000;
  const antiIdle = parsed.antiIdle;
  const text = antiIdle && typeof antiIdle.text === "string" ? antiIdle.text.slice(0, ANTI_IDLE_STRING_MAX_LENGTH) : "";
  return {
    keepaliveIntervalMs: interval <= 0 ? 0 : Math.min(ANTI_IDLE_NOOP_RANGE.max, Math.max(ANTI_IDLE_NOOP_RANGE.min, Math.round(interval / 1000))) * 1000,
    keepaliveCountMax: normalizeKeepaliveCountMax(parsed.keepaliveCountMax),
    ...(text ? { antiIdle: { text, seconds: clampInteger(antiIdle?.seconds, ANTI_IDLE_STRING_RANGE, defaultAntiIdle.stringSeconds) } } : {}),
  };
}
