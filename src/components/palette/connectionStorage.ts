import type { Folder } from "./types";

export async function loadConnectionFolders(): Promise<Folder[]> {
  if (!window.shellium?.connections) {
    throw new Error("Shellium preload bridge is unavailable; connection database was not loaded.");
  }

  return window.shellium.connections.list();
}

export async function saveConnectionFolders(folders: Folder[]): Promise<Folder[]> {
  if (!window.shellium?.connections) {
    throw new Error("Shellium preload bridge is unavailable; connection database was not saved.");
  }

  return window.shellium.connections.save(folders);
}
