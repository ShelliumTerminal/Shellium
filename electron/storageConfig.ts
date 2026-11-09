import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { app } = require("electron") as typeof import("electron");

type StorageLocationFile = {
  version: 1;
  dataDirectory: string;
};

const storageLocationFileName = "storage-location.json";
const defaultDataDirectoryName = "data";

export function getDefaultDataDirectory() {
  return path.join(app.getPath("userData"), defaultDataDirectoryName);
}

export function getDataDirectory() {
  const configuredDirectory = readConfiguredDataDirectory();
  const dataDirectory = configuredDirectory ?? getDefaultDataDirectory();

  if (configuredDirectory) {
    fs.mkdirSync(dataDirectory, { recursive: true });
  } else {
    // Our own folder: owner-only. A folder the user picked in Options keeps its permissions.
    fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
    restrictToOwner(dataDirectory, 0o700);
  }
  migrateLegacyConnectionsDatabase(dataDirectory);
  return dataDirectory;
}

/**
 * Writes a data file readable by its owner only (0600) on Linux / macOS - also when the file
 * already existed with wider permissions. Windows ignores POSIX modes; there the file inherits the
 * ACL of the user's profile folder, as before.
 */
export function writePrivateFile(filePath: string, data: string | Uint8Array) {
  fs.writeFileSync(filePath, data, { mode: 0o600 });
  restrictToOwner(filePath, 0o600);
}

function restrictToOwner(target: string, mode: number) {
  if (process.platform === "win32") {
    return;
  }

  try {
    fs.chmodSync(target, mode);
  } catch {
    // Not ours to change (e.g. a mounted folder); the content is encrypted either way.
  }
}

export function getConnectionDatabasePath() {
  return path.join(getDataDirectory(), "connections.sqlite");
}

export function getSettingsPath() {
  return path.join(getDataDirectory(), "settings.json");
}

export function getStorageLocationFilePath() {
  return path.join(app.getPath("userData"), storageLocationFileName);
}

export function setDataDirectory(nextDirectory: string) {
  const normalizedDirectory = path.resolve(nextDirectory);
  const previousDirectory = getDataDirectory();

  fs.mkdirSync(normalizedDirectory, { recursive: true });
  copyIfMissing(path.join(previousDirectory, "connections.sqlite"), path.join(normalizedDirectory, "connections.sqlite"));
  copyIfMissing(path.join(previousDirectory, "settings.json"), path.join(normalizedDirectory, "settings.json"));

  const storageLocation: StorageLocationFile = {
    version: 1,
    dataDirectory: normalizedDirectory,
  };

  writePrivateFile(getStorageLocationFilePath(), JSON.stringify(storageLocation, null, 2));
  return normalizedDirectory;
}

function readConfiguredDataDirectory() {
  const locationPath = getStorageLocationFilePath();

  if (!fs.existsSync(locationPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(locationPath, "utf8")) as Partial<StorageLocationFile>;
    return typeof parsed.dataDirectory === "string" && parsed.dataDirectory.trim()
      ? path.resolve(parsed.dataDirectory)
      : null;
  } catch {
    return null;
  }
}

/** Where versions before the data folder kept the (unencrypted) connection database. */
export function getLegacyConnectionDatabasePath() {
  return path.join(app.getPath("userData"), "connections.sqlite");
}

function migrateLegacyConnectionsDatabase(dataDirectory: string) {
  const legacyPath = getLegacyConnectionDatabasePath();
  const nextPath = path.join(dataDirectory, "connections.sqlite");

  copyIfMissing(legacyPath, nextPath);
}

function copyIfMissing(sourcePath: string, targetPath: string) {
  if (!fs.existsSync(sourcePath) || fs.existsSync(targetPath)) {
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  restrictToOwner(targetPath, 0o600);
}






