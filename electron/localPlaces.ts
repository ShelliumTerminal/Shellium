import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { app } = require("electron") as typeof import("electron");

/*
 * Drives and well-known folders for the SFTP browser's local sidebar (`localFiles:places`).
 * Windows: Win32_LogicalDisk through PowerShell (letter, label, type, size, free space) - a separate
 * process, so a sleeping network share cannot block this one; only if PowerShell fails are the
 * letters probed with statfs. macOS: "/" plus /Volumes. Linux: "/" plus /media, /run/media, /mnt.
 * statfs is never started twice for the same path (a hung one keeps a libuv thread busy): a probe
 * still running is shared, and a path that does not answer within PROBE_MS is left out of that call.
 */

export type LocalDriveKind = "fixed" | "removable" | "network" | "optical" | "volume";

export type LocalDrive = {
  path: string;
  /** "Local Disk", a volume label or a mount name; the letter / path is shown separately. */
  label: string;
  kind: LocalDriveKind;
  totalBytes?: number;
  freeBytes?: number;
};

export type LocalPlace = {
  path: string;
  label: string;
  kind: "home" | "desktop" | "documents" | "downloads";
};

export type LocalPlacesResult = {
  places: LocalPlace[];
  drives: LocalDrive[];
};

const PROBE_MS = 1500;
const CACHE_MS = 10_000;
let cache: { at: number; result: LocalPlacesResult } | null = null;

export async function listLocalPlaces(): Promise<LocalPlacesResult> {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return cache.result;
  }
  const [places, drives] = await Promise.all([listPlaces(), listDrives()]);
  const result = { places, drives };
  cache = { at: Date.now(), result };
  return result;
}

async function listPlaces(): Promise<LocalPlace[]> {
  const wanted: Array<[LocalPlace["kind"], string, Parameters<typeof app.getPath>[0]]> = [
    ["home", "Home", "home"],
    ["desktop", "Desktop", "desktop"],
    ["documents", "Documents", "documents"],
    ["downloads", "Downloads", "downloads"],
  ];
  const places = await Promise.all(wanted.map(async ([kind, label, name]) => {
    try {
      const placePath = app.getPath(name);
      return (await isDirectory(placePath)) ? { kind, label, path: placePath } : null;
    } catch {
      return null;
    }
  }));
  return places.filter((place): place is LocalPlace => place !== null);
}

async function listDrives(): Promise<LocalDrive[]> {
  if (process.platform === "win32") {
    return listWindowsDrives();
  }
  const candidates = process.platform === "darwin"
    ? ["/", ...(await subdirectories("/Volumes"))]
    : ["/", ...(await subdirectories(`/media/${os.userInfo().username}`)), ...(await subdirectories(`/run/media/${os.userInfo().username}`)),
      ...(await subdirectories("/mnt"))];
  // /Volumes/Macintosh HD is a link to "/": list it once. readlink only reads the link itself, it
  // does not touch the target (realpath on a dead network mount could hang).
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const candidate of candidates) {
    const target = await fs.readlink(candidate).then((link) => path.resolve(path.dirname(candidate), link), () => candidate);
    if (!seen.has(target)) {
      seen.add(target);
      unique.push(candidate);
    }
  }
  const drives = await Promise.all(unique.map(async (drivePath) => {
    const space = await probe(drivePath);
    if (space === undefined && drivePath !== "/") {
      return null;
    }
    const drive: LocalDrive = {
      path: drivePath,
      label: drivePath === "/" ? (process.platform === "darwin" ? "Macintosh HD" : "File system") : path.basename(drivePath),
      kind: drivePath === "/" ? "fixed" : "volume",
      ...spaceOf(space),
    };
    return drive;
  }));
  return drives.filter((drive): drive is LocalDrive => drive !== null);
}

async function listWindowsDrives(): Promise<LocalDrive[]> {
  const drives = await windowsDrives();
  if (drives) {
    return drives;
  }
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const probed = await Promise.all(letters.map(async (letter) => {
    const root = `${letter}:\\`;
    const space = await probe(root);
    return space ? { path: root, label: defaultWindowsLabel("fixed"), kind: "fixed" as const, ...spaceOf(space) } : null;
  }));
  return probed.filter((drive): drive is NonNullable<typeof drive> => drive !== null);
}

type LogicalDisk = { DeviceID?: string; DriveType?: number; VolumeName?: string | null; Size?: number | null; FreeSpace?: number | null };

/** Win32_LogicalDisk; null when PowerShell is missing, slow or answers something unexpected. */
function windowsDrives(): Promise<LocalDrive[] | null> {
  const script = "Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,DriveType,VolumeName,Size,FreeSpace | ConvertTo-Json -Compress";
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 5000, windowsHide: true }, (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve(null);
        return;
      }
      try {
        const parsed: unknown = JSON.parse(stdout);
        const rows = (Array.isArray(parsed) ? parsed : [parsed]) as LogicalDisk[];
        resolve(rows.flatMap((row): LocalDrive[] => {
          const letter = row.DeviceID?.charAt(0).toUpperCase();
          if (!letter || !/^[A-Z]$/.test(letter)) {
            return [];
          }
          const kind: LocalDriveKind = row.DriveType === 2 ? "removable" : row.DriveType === 4 ? "network" : row.DriveType === 5 ? "optical" : "fixed";
          const drive: LocalDrive = { path: `${letter}:\\`, label: (row.VolumeName ?? "").trim() || defaultWindowsLabel(kind), kind };
          if (typeof row.Size === "number" && row.Size > 0 && typeof row.FreeSpace === "number") {
            drive.totalBytes = row.Size;
            drive.freeBytes = row.FreeSpace;
          }
          return [drive];
        }));
      } catch {
        resolve(null);
      }
    });
  });
}

function defaultWindowsLabel(kind: LocalDriveKind) {
  return kind === "removable" ? "USB Drive" : kind === "network" ? "Network Drive" : kind === "optical" ? "CD Drive" : "Local Disk";
}

function spaceOf(space: { bsize: number; blocks: number; bavail: number } | undefined) {
  if (!space || !space.blocks) {
    return {};
  }
  return { totalBytes: space.blocks * space.bsize, freeBytes: space.bavail * space.bsize };
}

async function subdirectories(parent: string) {
  try {
    const entries = await fs.readdir(parent, { withFileTypes: true });
    return entries
      .filter((entry) => !entry.name.startsWith(".") && (entry.isDirectory() || entry.isSymbolicLink()))
      .map((entry) => path.join(parent, entry.name));
  } catch {
    return [];
  }
}

async function isDirectory(dirPath: string) {
  try {
    return (await fs.stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}

const probes = new Map<string, Promise<{ bsize: number; blocks: number; bavail: number } | undefined>>();

/** statfs with a timeout; a probe still running for the same path is reused, never started again. */
function probe(target: string) {
  let running = probes.get(target);
  if (!running) {
    running = fs.statfs(target).then((space) => space, () => undefined).finally(() => probes.delete(target));
    probes.set(target, running);
  }
  return withTimeout(running, PROBE_MS).catch(() => undefined);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}
