import fs from "node:fs";
import { createRequire } from "node:module";
import { getDataDirectory, getSettingsPath, setDataDirectory, writePrivateFile } from "./storageConfig";

const require = createRequire(import.meta.url);
const { dialog, ipcMain } = require("electron") as typeof import("electron");

type AppSettingsFile = {
  version: 1;
  appOptions?: unknown;
  palette?: {
    treeWidth?: number;
    frame?: { left?: number; top?: number; width?: number; height?: number };
    expandedFolderIds?: string[];
  };
  security?: unknown;
};

type StorageLocationChangedCallback = () => void;

export function registerAppSettingsHandlers(onStorageLocationChanged: StorageLocationChangedCallback) {
  ipcMain.handle("settings:get", async () => ({
    dataDirectory: getDataDirectory(),
    settings: readSettings(),
  }));

  ipcMain.handle("settings:saveAppOptions", async (_event, appOptions: unknown) => {
    const settings = readSettings();
    writeSettings({ ...settings, appOptions });
    return readSettings();
  });

  ipcMain.handle("settings:savePaletteTreeWidth", async (_event, treeWidth: unknown) => {
    const settings = readSettings();
    const normalizedTreeWidth = typeof treeWidth === "number" && Number.isFinite(treeWidth) ? treeWidth : undefined;
    writeSettings({
      ...settings,
      palette: {
        ...(settings.palette ?? {}),
        treeWidth: normalizedTreeWidth,
      },
    });
    return readSettings();
  });

  ipcMain.handle("settings:savePaletteFrame", async (_event, frame: unknown) => {
    const settings = readSettings();
    const normalizedFrame = normalizePaletteFrame(frame);
    writeSettings({
      ...settings,
      palette: {
        ...(settings.palette ?? {}),
        frame: normalizedFrame,
      },
    });
    return readSettings();
  });

  ipcMain.handle("settings:savePaletteExpandedFolders", async (_event, expandedFolderIds: unknown) => {
    const settings = readSettings();
    const normalizedExpandedFolderIds = Array.isArray(expandedFolderIds)
      ? expandedFolderIds.filter((folderId): folderId is string => typeof folderId === "string" && folderId.trim().length > 0)
      : undefined;
    writeSettings({
      ...settings,
      palette: {
        ...(settings.palette ?? {}),
        expandedFolderIds: normalizedExpandedFolderIds,
      },
    });
    return readSettings();
  });

  ipcMain.handle("settings:chooseDataDirectory", async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose Shellium Data Folder",
      defaultPath: getDataDirectory(),
      properties: ["openDirectory", "createDirectory"],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, dataDirectory: getDataDirectory(), settings: readSettings() };
    }

    const dataDirectory = setDataDirectory(result.filePaths[0]);
    onStorageLocationChanged();

    return {
      canceled: false,
      dataDirectory,
      settings: readSettings(),
    };
  });

  ipcMain.handle("settings:chooseXServerExecutable", async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose Local X Server Executable",
      properties: ["openFile"],
      filters: process.platform === "win32"
        ? [{ name: "Applications", extensions: ["exe"] }, { name: "All Files", extensions: ["*"] }]
        : [{ name: "All Files", extensions: ["*"] }],
    });

    return {
      canceled: result.canceled || result.filePaths.length === 0,
      filePath: result.filePaths[0],
    };
  });
  ipcMain.handle("settings:chooseTerminalRecordingDirectory", async (_event, currentPath: unknown) => {
    const defaultPath = typeof currentPath === "string" && currentPath.trim() ? currentPath.trim() : getDataDirectory();
    const result = await dialog.showOpenDialog({
      title: "Choose Terminal Recording Folder",
      defaultPath,
      properties: ["openDirectory", "createDirectory"],
    });

    return {
      canceled: result.canceled || result.filePaths.length === 0,
      filePath: result.filePaths[0],
    };
  });
}

function normalizePaletteFrame(frame: unknown) {
  if (typeof frame !== "object" || frame === null) {
    return undefined;
  }

  const candidate = frame as Record<string, unknown>;
  const left = typeof candidate.left === "number" && Number.isFinite(candidate.left) ? candidate.left : undefined;
  const top = typeof candidate.top === "number" && Number.isFinite(candidate.top) ? candidate.top : undefined;
  const width = typeof candidate.width === "number" && Number.isFinite(candidate.width) ? candidate.width : undefined;
  const height = typeof candidate.height === "number" && Number.isFinite(candidate.height) ? candidate.height : undefined;

  return { left, top, width, height };
}
function readSettings(): AppSettingsFile {
  const settingsPath = getSettingsPath();

  if (!fs.existsSync(settingsPath)) {
    return { version: 1 };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Partial<AppSettingsFile>;
    return {
      version: 1,
      appOptions: parsed.appOptions,
      palette: typeof parsed.palette === "object" && parsed.palette !== null ? parsed.palette : undefined,
      security: parsed.security,
    };
  } catch {
    return { version: 1 };
  }
}

function writeSettings(settings: AppSettingsFile) {
  writePrivateFile(getSettingsPath(), JSON.stringify({ ...settings, version: 1 }, null, 2));
}





