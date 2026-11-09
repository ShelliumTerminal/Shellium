import type { KeyboardEventHandler } from "react";

import TreeNode from "./TreeNode";
import type { Folder, Host } from "./types";

type TreeViewProps = {
  folders: Folder[];
  expandedFolders: Set<string>;
  liveHostIds: Set<string>;
  selectedFolderId?: string;
  selectedHostId?: string;
  onToggle: (folderId: string) => void;
  onSelectFolder: (folder: Folder) => void;
  onSelectHost: (host: Host) => void;
  onConnectHost: (host: Host) => void;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
};

export default function TreeView({
  folders,
  expandedFolders,
  liveHostIds,
  selectedFolderId,
  selectedHostId,
  onToggle,
  onSelectFolder,
  onSelectHost,
  onConnectHost,
  onKeyDown,
}: TreeViewProps) {
  return (
    <div className="pl-treeview" tabIndex={0} onKeyDown={onKeyDown}>
      {folders.map((folder) => (
        <TreeNode
          key={folder.id}
          folder={folder}
          expandedFolders={expandedFolders}
          liveHostIds={liveHostIds}
          selectedFolderId={selectedFolderId}
          selectedHostId={selectedHostId}
          onToggle={onToggle}
          onSelectFolder={onSelectFolder}
          onSelectHost={onSelectHost}
          onConnectHost={onConnectHost}
        />
      ))}
    </div>
  );
}
