/** Shared by the local and the remote file pane. */
export type PaneEntry = {
  name: string;
  path: string;
  type: "directory" | "file" | "symlink" | "other";
  size: number;
  modifiedAt: number;
  /** Remote only: permission bits (mode & 0o7777). */
  permissions?: number;
  owner?: string;
};

export type PaneSide = "local" | "remote";
export type SortKey = "name" | "size" | "modifiedAt" | "permissions";
export type SortState = { key: SortKey; descending: boolean };

/** Custom drag type for files dragged between the two panes of one session. */
export const PANE_DRAG_TYPE = "application/x-shellium-files";
export type PaneDragPayload = { sessionId: string; side: PaneSide; paths: string[] };

export function formatSize(size: number) {
  if (!Number.isFinite(size) || size < 0) {
    return "";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function formatTime(modifiedAt: number) {
  return Number.isFinite(modifiedAt) && modifiedAt > 0 ? new Date(modifiedAt).toLocaleString() : "";
}

export function formatDuration(totalSeconds: number | null) {
  if (totalSeconds === null || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "--";
  }
  const rounded = Math.round(totalSeconds);
  const minutes = Math.floor(rounded / 60);
  return minutes <= 0 ? `${rounded % 60}s` : `${minutes}m ${String(rounded % 60).padStart(2, "0")}s`;
}

/** 0o754 -> "rwxr-xr--" (setuid / setgid / sticky shown as s / s / t). */
export function permissionString(mode: number | undefined) {
  if (mode === undefined) {
    return "";
  }
  const bits = ["r", "w", "x"];
  let text = "";
  for (let shift = 6; shift >= 0; shift -= 3) {
    for (let i = 0; i < 3; i++) {
      text += mode & (1 << (shift + 2 - i)) ? bits[i] : "-";
    }
  }
  const chars = text.split("");
  if (mode & 0o4000) chars[2] = chars[2] === "x" ? "s" : "S";
  if (mode & 0o2000) chars[5] = chars[5] === "x" ? "s" : "S";
  if (mode & 0o1000) chars[8] = chars[8] === "x" ? "t" : "T";
  return chars.join("");
}

export function octal(mode: number | undefined) {
  return mode === undefined ? "" : (mode & 0o7777).toString(8).padStart(3, "0");
}

export function isHidden(entry: { name: string }) {
  return entry.name.startsWith(".");
}

/** Folders first, then by the chosen column; names compare naturally (file2 before file10). */
export function sortEntries(entries: PaneEntry[], sort: SortState) {
  const direction = sort.descending ? -1 : 1;
  const byName = (a: PaneEntry, b: PaneEntry) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  return [...entries].sort((a, b) => {
    const aDir = a.type === "directory" ? 0 : 1;
    const bDir = b.type === "directory" ? 0 : 1;
    if (aDir !== bDir) {
      return aDir - bDir;
    }
    let result = 0;
    if (sort.key === "size") {
      result = a.size - b.size;
    } else if (sort.key === "modifiedAt") {
      result = a.modifiedAt - b.modifiedAt;
    } else if (sort.key === "permissions") {
      result = (a.permissions ?? 0) - (b.permissions ?? 0);
    }
    return (result || byName(a, b)) * direction;
  });
}

export function remoteParent(remotePath: string) {
  const normalized = remotePath.replace(/\\/g, "/").replace(/\/+$/g, "") || "/";
  if (normalized === "/") {
    return "/";
  }
  const slash = normalized.lastIndexOf("/");
  return slash <= 0 ? "/" : normalized.slice(0, slash);
}

export function localParent(localPath: string) {
  if (!localPath) {
    return "";
  }
  const normalized = localPath.replace(/\\/g, "/").replace(/\/+$/g, "");
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return localPath.includes(":") ? normalized.slice(0, 3) : "/";
  }
  return normalized.slice(0, slash);
}

export function errorText(error: unknown, fallback = "SFTP operation failed") {
  const message = error instanceof Error ? error.message : "";
  return message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, "") || fallback;
}
