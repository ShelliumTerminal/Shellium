import type { Folder, Host, Session } from "../components/palette/types";

export type VaultHostSearchResult = {
  host: Host;
  folderPath: string;
};

export type PendingCloseState =
  | { kind: "single"; sessionId: string; title: string }
  | { kind: "others"; sessionId: string; count: number }
  | { kind: "app" };

export function getSessionTitle(session: Session) {
  return session.title?.trim() || session.host.name;
}

export function collectVaultHosts(folders: Folder[], parentPath = ""): VaultHostSearchResult[] {
  return folders.flatMap((folder) => {
    const folderPath = parentPath ? `${parentPath} / ${folder.name}` : folder.name;
    return [
      ...(folder.hosts ?? []).map((host) => ({ host, folderPath })),
      ...collectVaultHosts(folder.folders ?? [], folderPath),
    ];
  });
}
