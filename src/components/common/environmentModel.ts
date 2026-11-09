/**
 * Environments (Production, Test, ...) are defined in Options > Environments and stored with
 * the app options; a host points at one through `environmentId`. No React here: the main
 * process uses this too (import / export).
 */

export const environmentColors = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "grey"] as const;
export type EnvironmentColor = (typeof environmentColors)[number];

export type Environment = {
  id: string;
  /** Full name, e.g. "Production". */
  name: string;
  /** Short badge text shown on tabs and host rows, e.g. "PROD". */
  badge: string;
  color: EnvironmentColor;
  /** Show a warning banner above sessions of this environment. */
  warn: boolean;
  /** Terminal color scheme for hosts of this environment (terminalSchemeModel); absent = the default. */
  terminalSchemeId?: string;
};

export const defaultEnvironments: Environment[] = [
  { id: "env-production", name: "Production", badge: "PROD", color: "red", warn: true, terminalSchemeId: "shellium-production" },
  { id: "env-test", name: "Test", badge: "TEST", color: "green", warn: false },
  { id: "env-development", name: "Development", badge: "DEV", color: "blue", warn: false },
];

export const maxEnvironmentBadgeLength = 8;

export function createEnvironmentId() {
  return `env-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function deriveEnvironmentBadge(name: string) {
  return name.trim().slice(0, 4).toUpperCase();
}

/** Accepts whatever settings.json holds; falls back to the defaults when nothing valid is stored. */
export function normalizeEnvironments(value: unknown): Environment[] {
  if (!Array.isArray(value)) {
    return defaultEnvironments;
  }

  const seen = new Set<string>();
  return value.flatMap((item): Environment[] => {
    if (typeof item !== "object" || item === null) {
      return [];
    }

    const candidate = item as Partial<Environment>;
    const id = typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : createEnvironmentId();
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";

    if (!name || seen.has(id)) {
      return [];
    }

    seen.add(id);
    const badge = typeof candidate.badge === "string" && candidate.badge.trim()
      ? candidate.badge.trim().slice(0, maxEnvironmentBadgeLength).toUpperCase()
      : deriveEnvironmentBadge(name);

    return [{
      id,
      name,
      badge,
      color: environmentColors.includes(candidate.color as EnvironmentColor) ? candidate.color as EnvironmentColor : "grey",
      warn: candidate.warn === true,
      ...(typeof candidate.terminalSchemeId === "string" && /^[a-z0-9-]{1,64}$/.test(candidate.terminalSchemeId) ? { terminalSchemeId: candidate.terminalSchemeId } : {}),
    }];
  });
}
