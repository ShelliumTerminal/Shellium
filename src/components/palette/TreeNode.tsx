import { ChevronDown, ChevronRight, Folder as FolderIcon, FolderOpen } from "lucide-react";

import { EnvironmentBadge, useEnvironment } from "../common/environments";
import type { Folder, Host } from "./types";

type HostRowProps = {
  host: Host;
  selected: boolean;
  live: boolean;
  indent: number;
  onSelectHost: (host: Host) => void;
  onConnectHost: (host: Host) => void;
};

export function HostRow({ host, selected, live, indent, onSelectHost, onConnectHost }: HostRowProps) {
  const firstTag = host.tags?.[0];
  const environment = useEnvironment(host.environmentId);

  return (
    <button
      className={`pl-host${selected ? " selected" : ""}`}
      type="button"
      data-host-id={host.id}
      style={{ paddingLeft: indent }}
      title={host.description ? `${host.name} - ${host.description}` : host.name}
      onClick={() => onSelectHost(host)}
      onDoubleClick={() => onConnectHost(host)}
    >
      <span className={`pl-host-dot${live ? " is-live" : ""}`} aria-hidden="true" />
      <span className="pl-host-text">
        <span className="pl-host-name">{host.name}</span>
        <span className="pl-host-meta">{host.username ? `${host.username}@` : ""}{host.hostname}</span>
      </span>
      {environment ? <EnvironmentBadge environmentId={host.environmentId} /> : firstTag && <span className="pl-tag">{firstTag}</span>}
    </button>
  );
}

type TreeNodeProps = {
  folder: Folder;
  expandedFolders: Set<string>;
  liveHostIds: Set<string>;
  selectedFolderId?: string;
  selectedHostId?: string;
  level?: number;
  onToggle: (folderId: string) => void;
  onSelectFolder: (folder: Folder) => void;
  onSelectHost: (host: Host) => void;
  onConnectHost: (host: Host) => void;
};

function countHosts(folder: Folder): number {
  return (folder.hosts?.length ?? 0) + (folder.folders ?? []).reduce((total, child) => total + countHosts(child), 0);
}

export default function TreeNode({
  folder,
  expandedFolders,
  liveHostIds,
  selectedFolderId,
  selectedHostId,
  level = 0,
  onToggle,
  onSelectFolder,
  onSelectHost,
  onConnectHost,
}: TreeNodeProps) {
  const isExpanded = expandedFolders.has(folder.id);
  const hasChildren = Boolean(folder.folders?.length || folder.hosts?.length);

  return (
    <div className="pl-node">
      <button
        className={`pl-folder${selectedFolderId === folder.id ? " selected" : ""}`}
        type="button"
        style={{ paddingLeft: 8 + level * 16 }}
        title={folder.name}
        onClick={() => {
          onSelectFolder(folder);
          onToggle(folder.id);
        }}
      >
        <span className="pl-caret" aria-hidden="true">
          {hasChildren ? (isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}
        </span>
        {isExpanded ? <FolderOpen size={15} className="pl-folder-icon" /> : <FolderIcon size={15} className="pl-folder-icon" />}
        <span className="pl-folder-name">{folder.name}</span>
        <span className="pl-folder-count">{countHosts(folder)}</span>
      </button>

      {isExpanded && (
        <div>
          {folder.folders?.map((childFolder) => (
            <TreeNode
              key={childFolder.id}
              folder={childFolder}
              expandedFolders={expandedFolders}
              liveHostIds={liveHostIds}
              selectedFolderId={selectedFolderId}
              selectedHostId={selectedHostId}
              level={level + 1}
              onToggle={onToggle}
              onSelectFolder={onSelectFolder}
              onSelectHost={onSelectHost}
              onConnectHost={onConnectHost}
            />
          ))}

          {folder.hosts?.map((host) => (
            <HostRow
              key={host.id}
              host={host}
              selected={selectedHostId === host.id}
              live={liveHostIds.has(host.id)}
              indent={30 + level * 16}
              onSelectHost={onSelectHost}
              onConnectHost={onConnectHost}
            />
          ))}
        </div>
      )}
    </div>
  );
}
