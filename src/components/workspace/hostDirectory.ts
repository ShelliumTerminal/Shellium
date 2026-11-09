import type { Environment } from "../common/environments";
import type { Host } from "../palette/types";

/** A saved host with its folder path, as listed on Home and in the quick-connect menu. */
export type DirectoryHost = {
  host: Host;
  folderPath: string;
};

export type RecentConnection = {
  hostId: string;
  connectedAt: number;
};

// Recent connections are a per-device convenience (host ids and times only, no secrets),
// kept in the renderer's localStorage rather than the encrypted connection store.
const recentStorageKey = "shellium:recentConnections";
const maxRecentConnections = 20;

export function loadRecentConnections(): RecentConnection[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(recentStorageKey) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is RecentConnection => (
          typeof item === "object" && item !== null
          && typeof (item as RecentConnection).hostId === "string"
          && typeof (item as RecentConnection).connectedAt === "number"
        ))
      : [];
  } catch {
    return [];
  }
}

export function recordRecentConnection(current: RecentConnection[], hostId: string): RecentConnection[] {
  const next = [{ hostId, connectedAt: Date.now() }, ...current.filter((item) => item.hostId !== hostId)].slice(0, maxRecentConnections);

  try {
    window.localStorage.setItem(recentStorageKey, JSON.stringify(next));
  } catch {
    // Storage can be unavailable (private profile, quota); the list then lives for this run only.
  }

  return next;
}

export function matchesHost(entry: DirectoryHost, query: string, environments: Environment[]) {
  if (!query) {
    return true;
  }

  const environment = entry.host.environmentId ? environments.find((item) => item.id === entry.host.environmentId) : undefined;
  return [
    entry.host.name,
    entry.host.hostname,
    entry.host.username,
    entry.host.description,
    entry.folderPath,
    environment?.name,
    environment?.badge,
    ...(entry.host.tags ?? []),
  ].some((value) => value?.toLowerCase().includes(query));
}

export function formatRelativeTime(timestamp: number, now = Date.now()) {
  const minutes = Math.round((now - timestamp) / 60000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;

  return new Date(timestamp).toLocaleDateString();
}
