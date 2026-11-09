import type { Folder, Host } from "./types";

export function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function findFolderById(folders: Folder[], folderId: string): Folder | null {
  for (const folder of folders) {
    if (folder.id === folderId) {
      return folder;
    }

    const match = findFolderById(folder.folders ?? [], folderId);
    if (match) {
      return match;
    }
  }

  return null;
}

export function findHostById(folders: Folder[], hostId: string): Host | null {
  for (const folder of folders) {
    const host = folder.hosts?.find((item) => item.id === hostId);
    if (host) {
      return host;
    }

    const match = findHostById(folder.folders ?? [], hostId);
    if (match) {
      return match;
    }
  }

  return null;
}

export function findHostParentFolderId(folders: Folder[], hostId: string): string | null {
  for (const folder of folders) {
    if (folder.hosts?.some((host) => host.id === hostId)) {
      return folder.id;
    }

    const match = findHostParentFolderId(folder.folders ?? [], hostId);
    if (match) {
      return match;
    }
  }

  return null;
}

export function addFolder(folders: Folder[], parentFolderId: string | null, folder: Folder): Folder[] {
  if (!parentFolderId) {
    return [...folders, folder];
  }

  return folders.map((item) => {
    if (item.id === parentFolderId) {
      return { ...item, folders: [...(item.folders ?? []), folder] };
    }

    return { ...item, folders: addFolder(item.folders ?? [], parentFolderId, folder) };
  });
}

export function addHost(folders: Folder[], parentFolderId: string, host: Host): Folder[] {
  return folders.map((item) => {
    if (item.id === parentFolderId) {
      return { ...item, hosts: [...(item.hosts ?? []), host] };
    }

    return { ...item, folders: addHost(item.folders ?? [], parentFolderId, host) };
  });
}

export function updateFolderName(folders: Folder[], folderId: string, name: string): Folder[] {
  return folders.map((folder) => {
    if (folder.id === folderId) {
      return { ...folder, name };
    }

    return { ...folder, folders: updateFolderName(folder.folders ?? [], folderId, name) };
  });
}

export function updateHost(folders: Folder[], host: Host): Folder[] {
  return folders.map((folder) => ({
    ...folder,
    folders: updateHost(folder.folders ?? [], host),
    hosts: folder.hosts?.map((item) => (item.id === host.id ? host : item)),
  }));
}

export function deleteFolder(folders: Folder[], folderId: string): Folder[] {
  return folders
    .filter((folder) => folder.id !== folderId)
    .map((folder) => ({ ...folder, folders: deleteFolder(folder.folders ?? [], folderId) }));
}

export function deleteHost(folders: Folder[], hostId: string): Folder[] {
  return folders.map((folder) => ({
    ...folder,
    folders: deleteHost(folder.folders ?? [], hostId),
    hosts: folder.hosts?.filter((host) => host.id !== hostId),
  }));
}

export function firstFolderId(folders: Folder[]): string | null {
  const first = folders[0];
  return first?.id ?? null;
}