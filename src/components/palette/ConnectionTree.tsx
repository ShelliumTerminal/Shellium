import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { KeyboardEvent } from "react";

import TreeView from "./TreeView";
import { HostRow } from "./TreeNode";
import type { Folder, Host, SelectedNode } from "./types";

type ConnectionTreeProps = {
  folders: Folder[];
  search: string;
  selectedNode: SelectedNode | null;
  expandedFolderIds: string[];
  liveHostIds: Set<string>;
  onExpandedFolderIdsChange: (folderIds: string[]) => void;
  onSelectFolder: (folder: Folder) => void;
  onSelectHost: (host: Host) => void;
  onConnectHost: (host: Host) => void;
};

export type ConnectionTreeHandle = {
  /** Arrow keys move the host selection and Enter connects; used by the search box too. */
  handleKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
};

export type SearchGroup = {
  folderId: string;
  path: string;
  hosts: Host[];
};

function hostMatches(host: Host, search: string) {
  return [host.name, host.hostname, host.username, host.description, ...(host.tags ?? [])]
    .filter(Boolean)
    .some((value) => value?.toLowerCase().includes(search));
}

/**
 * Hosts matching the search, grouped by their folder path in tree order. A folder whose
 * name matches contributes all of its hosts, so "oracle" also finds the Oracle folder.
 */
export function buildSearchGroups(folders: Folder[], search: string, parentPath: string[] = [], parentMatches = false): SearchGroup[] {
  return folders.flatMap((folder) => {
    const path = [...parentPath, folder.name];
    const folderMatches = parentMatches || folder.name.toLowerCase().includes(search);
    const hosts = (folder.hosts ?? []).filter((host) => folderMatches || hostMatches(host, search));
    const own = hosts.length > 0 ? [{ folderId: folder.id, path: path.join(" / "), hosts }] : [];

    return [...own, ...buildSearchGroups(folder.folders ?? [], search, path, folderMatches)];
  });
}

function collectVisibleHosts(folders: Folder[], expandedFolders: Set<string>) {
  return folders.flatMap((folder): Host[] => {
    if (!expandedFolders.has(folder.id)) {
      return [];
    }

    return [
      ...collectVisibleHosts(folder.folders ?? [], expandedFolders),
      ...(folder.hosts ?? []),
    ];
  });
}

const ConnectionTree = forwardRef<ConnectionTreeHandle, ConnectionTreeProps>(function ConnectionTree({
  folders,
  search,
  selectedNode,
  expandedFolderIds,
  liveHostIds,
  onExpandedFolderIdsChange,
  onSelectFolder,
  onSelectHost,
  onConnectHost,
}, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const expandedFolders = useMemo(() => new Set(expandedFolderIds), [expandedFolderIds]);
  const searchGroups = useMemo(() => (search ? buildSearchGroups(folders, search) : []), [folders, search]);
  const visibleHosts = useMemo(
    () => (search ? searchGroups.flatMap((group) => group.hosts) : collectVisibleHosts(folders, expandedFolders)),
    [expandedFolders, folders, search, searchGroups],
  );
  const selectedHostId = selectedNode?.type === "host" ? selectedNode.id : undefined;

  useEffect(() => {
    if (!selectedHostId) {
      return;
    }

    containerRef.current
      ?.querySelector(`[data-host-id="${CSS.escape(selectedHostId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedHostId]);

  const handleTreeKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key) || visibleHosts.length === 0) {
      return;
    }

    const selectedHostIndex = selectedHostId
      ? visibleHosts.findIndex((host) => host.id === selectedHostId)
      : -1;

    if (event.key === "Enter") {
      if (selectedHostIndex >= 0) {
        event.preventDefault();
        onConnectHost(visibleHosts[selectedHostIndex]);
      }

      return;
    }

    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = selectedHostIndex < 0
      ? (direction > 0 ? 0 : visibleHosts.length - 1)
      : (selectedHostIndex + direction + visibleHosts.length) % visibleHosts.length;

    onSelectHost(visibleHosts[nextIndex]);
  };

  useImperativeHandle(ref, () => ({ handleKeyDown: handleTreeKeyDown }));

  const handleToggleFolder = (folderId: string) => {
    const next = new Set(expandedFolders);

    if (next.has(folderId)) {
      next.delete(folderId);
    } else {
      next.add(folderId);
    }

    onExpandedFolderIdsChange([...next]);
  };

  if (folders.length === 0) {
    return <div className="pl-tree-empty">No saved hosts yet.</div>;
  }

  if (search) {
    if (searchGroups.length === 0) {
      return <div className="pl-tree-empty">No matching hosts</div>;
    }

    return (
      <div className="pl-treeview" ref={containerRef} tabIndex={0} onKeyDown={handleTreeKeyDown}>
        {searchGroups.map((group) => (
          <div key={group.folderId}>
            <div className="pl-tree-path">{group.path}</div>
            {group.hosts.map((host) => (
              <HostRow
                key={host.id}
                host={host}
                selected={selectedHostId === host.id}
                live={liveHostIds.has(host.id)}
                indent={8}
                onSelectHost={onSelectHost}
                onConnectHost={onConnectHost}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div ref={containerRef}>
      <TreeView
        folders={folders}
        expandedFolders={expandedFolders}
        liveHostIds={liveHostIds}
        selectedFolderId={selectedNode?.type === "folder" ? selectedNode.id : undefined}
        selectedHostId={selectedHostId}
        onToggle={handleToggleFolder}
        onSelectFolder={onSelectFolder}
        onSelectHost={onSelectHost}
        onConnectHost={onConnectHost}
        onKeyDown={handleTreeKeyDown}
      />
    </div>
  );
});

export default ConnectionTree;
