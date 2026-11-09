import { FolderPlus, KeyRound, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

import SearchBox from "./SearchBox";
import ConnectionTree, { buildSearchGroups } from "./ConnectionTree";
import type { ConnectionTreeHandle } from "./ConnectionTree";
import SessionInfo from "./SessionInfo";
import type { SessionInfoMode } from "./SessionInfo";
import { loadConnectionFolders, saveConnectionFolders } from "./connectionStorage";
import {
  addFolder,
  addHost,
  createId,
  deleteFolder,
  deleteHost,
  findFolderById,
  findHostById,
  findHostParentFolderId,
  firstFolderId,
  updateFolderName,
  updateHost,
} from "./treeUtils";
import type { Folder, Host, SelectedNode } from "./types";

import "./palette.css";
import { useEscapeLayer } from "../../app/escapeLayers";
import { askConfirm } from "../../app/confirmDialog";

type ConnectionPaletteProps = {
  onClose: () => void;
  onConnect: (host: Host) => void;
  /** Hosts with a connected session, shown with a live dot. */
  liveHostIds?: string[];
};

// Tree pane width in pixels. Older builds stored a percentage (28-70); those values fall
// back to the default.
const minTreeWidth = 220;
const maxTreeWidth = 560;
const defaultTreeWidth = 320;
const paletteViewportMargin = 16;
const defaultExpandedFolderIds = ["production", "production-oracle", "test", "test-oracle"];
const minPaletteWidth = 560;
const minPaletteHeight = 500;

type PaletteFrame = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function clampTreeWidth(value: number) {
  return Math.min(maxTreeWidth, Math.max(minTreeWidth, value));
}

function normalizeStoredTreeWidth(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 100 ? clampTreeWidth(value) : defaultTreeWidth;
}

function normalizeStoredExpandedFolderIds(value: unknown) {
  return Array.isArray(value) && value.every((folderId) => typeof folderId === "string")
    ? value
    : defaultExpandedFolderIds;
}

function createCenteredPaletteFrame(value: unknown): PaletteFrame {
  const storedFrame = typeof value === "object" && value !== null ? value as Partial<PaletteFrame> : {};
  const maxWidth = Math.max(minPaletteWidth, window.innerWidth - paletteViewportMargin * 2);
  const maxHeight = Math.max(minPaletteHeight, window.innerHeight - paletteViewportMargin * 2);
  const width = typeof storedFrame.width === "number" && Number.isFinite(storedFrame.width)
    ? Math.min(maxWidth, Math.max(minPaletteWidth, storedFrame.width))
    : Math.min(1000, maxWidth);
  const height = typeof storedFrame.height === "number" && Number.isFinite(storedFrame.height)
    ? Math.min(maxHeight, Math.max(minPaletteHeight, storedFrame.height))
    : Math.min(720, maxHeight);

  return {
    left: Math.max(paletteViewportMargin, Math.round((window.innerWidth - width) / 2)),
    top: Math.max(paletteViewportMargin, Math.round((window.innerHeight - height) / 2)),
    width,
    height,
  };
}

function findNodePath(folders: Folder[], node: SelectedNode, parentPath: string[] = []): string[] | null {
  for (const folder of folders) {
    const path = [...parentPath, folder.name];

    if (node.type === "folder" ? folder.id === node.id : folder.hosts?.some((host) => host.id === node.id)) {
      return path;
    }

    const childPath = findNodePath(folder.folders ?? [], node, path);

    if (childPath) {
      return childPath;
    }
  }

  return null;
}

function countTree(folders: Folder[]): { folders: number; hosts: number } {
  return folders.reduce((total, folder) => {
    const child = countTree(folder.folders ?? []);

    return {
      folders: total.folders + 1 + child.folders,
      hosts: total.hosts + (folder.hosts?.length ?? 0) + child.hosts,
    };
  }, { folders: 0, hosts: 0 });
}

export default function ConnectionPalette({ onClose, onConnect, liveHostIds = [] }: ConnectionPaletteProps) {
  useEscapeLayer(onClose);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [search, setSearch] = useState("");
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [treeWidth, setTreeWidth] = useState(defaultTreeWidth);
  const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>(defaultExpandedFolderIds);
  const [isPaletteSettingsLoaded, setIsPaletteSettingsLoaded] = useState(false);
  const [paletteFrame, setPaletteFrame] = useState<PaletteFrame | null>(null);
  const [editorMode, setEditorMode] = useState<SessionInfoMode>(null);
  const [footerSlot, setFooterSlot] = useState<HTMLDivElement | null>(null);
  const paletteRef = useRef<HTMLDivElement | null>(null);
  const paletteBodyRef = useRef<HTMLDivElement | null>(null);
  const treeRef = useRef<ConnectionTreeHandle | null>(null);
  const liveHosts = useMemo(() => new Set(liveHostIds), [liveHostIds]);

  const normalizedSearch = useMemo(() => search.trim().toLowerCase(), [search]);
  const selectedFolder = useMemo(
    () => (selectedNode?.type === "folder" ? findFolderById(folders, selectedNode.id) : null),
    [folders, selectedNode],
  );
  const selectedHost = useMemo(
    () => (selectedNode?.type === "host" ? findHostById(folders, selectedNode.id) : null),
    [folders, selectedNode],
  );
  const targetFolderId = useMemo(() => {
    if (selectedNode?.type === "folder") {
      return selectedNode.id;
    }

    if (selectedNode?.type === "host") {
      return findHostParentFolderId(folders, selectedNode.id);
    }

    return firstFolderId(folders);
  }, [folders, selectedNode]);
  const selectedPath = useMemo(
    () => (selectedNode ? findNodePath(folders, selectedNode)?.join(" / ") ?? "" : ""),
    [folders, selectedNode],
  );
  const targetFolderPath = useMemo(
    () => (targetFolderId ? findNodePath(folders, { type: "folder", id: targetFolderId })?.join(" / ") ?? "" : ""),
    [folders, targetFolderId],
  );
  const treeCounts = useMemo(() => countTree(folders), [folders]);
  const matchCount = useMemo(
    () => (normalizedSearch ? buildSearchGroups(folders, normalizedSearch).reduce((total, group) => total + group.hosts.length, 0) : 0),
    [folders, normalizedSearch],
  );


  useEffect(() => {
    let isMounted = true;

    window.shellium?.settings.get()
      .then((result) => {
        if (isMounted) {
          setTreeWidth(normalizeStoredTreeWidth(result.settings.palette?.treeWidth));
          setExpandedFolderIds(normalizeStoredExpandedFolderIds(result.settings.palette?.expandedFolderIds));
          setPaletteFrame(createCenteredPaletteFrame(result.settings.palette?.frame));
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsPaletteSettingsLoaded(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

useEffect(() => {
    if (!isPaletteSettingsLoaded) {
      return;
    }

    window.shellium?.settings.savePaletteTreeWidth(treeWidth).catch(() => undefined);
  }, [isPaletteSettingsLoaded, treeWidth]);

  useEffect(() => {
    if (!isPaletteSettingsLoaded) {
      return;
    }

    window.shellium?.settings.savePaletteExpandedFolders(expandedFolderIds).catch(() => undefined);
  }, [expandedFolderIds, isPaletteSettingsLoaded]);

  useEffect(() => {
    if (!isPaletteSettingsLoaded || !paletteFrame) {
      return;
    }

    const timeout = window.setTimeout(() => {
      window.shellium?.settings.savePaletteFrame(paletteFrame).catch(() => undefined);
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [isPaletteSettingsLoaded, paletteFrame]);

  useEffect(() => {
    let isMounted = true;

    loadConnectionFolders()
      .then((loadedFolders) => {
        if (isMounted) {
          setFolders(loadedFolders);
          setStorageError(null);
        }
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setStorageError(error instanceof Error ? error.message : "Connection database could not be loaded.");
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    saveConnectionFolders(folders).catch((error: unknown) => {
      setStorageError(error instanceof Error ? error.message : "Connection database could not be saved.");
    });
  }, [folders, isLoading]);

  useEffect(() => {
    if (!selectedNode) {
      return;
    }

    const exists = selectedNode.type === "folder"
      ? findFolderById(folders, selectedNode.id)
      : findHostById(folders, selectedNode.id);

    if (!exists) {
      setSelectedNode(null);
    }
  }, [folders, selectedNode]);

  const handleCreateFolder = (parentFolderId: string | null, name: string) => {
    const folder: Folder = {
      id: createId("folder"),
      name,
      folders: [],
      hosts: [],
    };

    setFolders((current) => addFolder(current, parentFolderId, folder));
    setSelectedNode({ type: "folder", id: folder.id });
  };

  const handleCreateHost = (parentFolderId: string, hostFields: Omit<Host, "id">) => {
    const host: Host = {
      ...hostFields,
      id: createId("host"),
    };

    setFolders((current) => addHost(current, parentFolderId, host));
    setSelectedNode({ type: "host", id: host.id });
  };

  const handleDeleteFolder = async (folderId: string) => {
    const folder = findFolderById(folders, folderId);
    const count = (list: Folder[]): { hosts: number; folders: number } => list.reduce((total, child) => {
      const inner = count(child.folders ?? []);
      return { hosts: total.hosts + (child.hosts?.length ?? 0) + inner.hosts, folders: total.folders + 1 + inner.folders };
    }, { hosts: 0, folders: 0 });
    const inside = folder ? count([folder]) : { hosts: 0, folders: 1 };
    const parts = [
      inside.hosts > 0 ? `${inside.hosts} connection${inside.hosts === 1 ? "" : "s"}` : "",
      inside.folders > 1 ? `${inside.folders - 1} subfolder${inside.folders === 2 ? "" : "s"}` : "",
    ].filter(Boolean);
    const confirmed = await askConfirm({
      title: "Delete folder",
      body: `Delete "${folder?.name ?? "this folder"}"${parts.length > 0 ? ` and the ${parts.join(" and ")} in it` : ""}? Saved passwords of these connections are deleted too.`,
      confirmLabel: "Delete folder",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    setFolders((current) => deleteFolder(current, folderId));
    setSelectedNode(null);
  };

  const handleDeleteHost = async (hostId: string) => {
    const host = findHostById(folders, hostId);
    const confirmed = await askConfirm({
      title: "Delete connection",
      body: host
        ? `Delete "${host.name}" (${host.username}@${host.hostname}${host.port !== 22 ? `:${host.port}` : ""})? Its saved password is deleted too.`
        : "Delete this connection?",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    setFolders((current) => deleteHost(current, hostId));
    setSelectedNode(null);
  };

  const handleSplitterPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const bodyRect = paletteBodyRef.current?.getBoundingClientRect();

      if (!bodyRect) {
        return;
      }

      setTreeWidth(clampTreeWidth(moveEvent.clientX - bodyRect.left));
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  };

  const clampPaletteFrame = (frame: PaletteFrame): PaletteFrame => {
    const maxWidth = Math.max(minPaletteWidth, window.innerWidth - paletteViewportMargin * 2);
    const maxHeight = Math.max(minPaletteHeight, window.innerHeight - paletteViewportMargin * 2);
    const width = Math.min(maxWidth, Math.max(minPaletteWidth, frame.width));
    const height = Math.min(maxHeight, Math.max(minPaletteHeight, frame.height));
    const maxLeft = Math.max(paletteViewportMargin, window.innerWidth - width - paletteViewportMargin);
    const maxTop = Math.max(paletteViewportMargin, window.innerHeight - height - paletteViewportMargin);

    return {
      left: Math.min(maxLeft, Math.max(paletteViewportMargin, frame.left)),
      top: Math.min(maxTop, Math.max(paletteViewportMargin, frame.top)),
      width,
      height,
    };
  };

  const updatePaletteFrame = (nextFrame: PaletteFrame) => {
    const clampedFrame = clampPaletteFrame(nextFrame);

    setPaletteFrame((current) => {
      if (
        current
        && Math.abs(current.left - clampedFrame.left) < 1
        && Math.abs(current.top - clampedFrame.top) < 1
        && Math.abs(current.width - clampedFrame.width) < 1
        && Math.abs(current.height - clampedFrame.height) < 1
      ) {
        return current;
      }

      return clampedFrame;
    });
  };

  const handleHeaderPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && event.target.closest("button")) {
      return;
    }

    const paletteRect = paletteRef.current?.getBoundingClientRect();

    if (!paletteRect) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const pointerOffset = {
      x: event.clientX - paletteRect.left,
      y: event.clientY - paletteRect.top,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updatePaletteFrame({
        left: moveEvent.clientX - pointerOffset.x,
        top: moveEvent.clientY - pointerOffset.y,
        width: paletteRect.width,
        height: paletteRect.height,
      });
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    updatePaletteFrame({
      left: paletteRect.left,
      top: paletteRect.top,
      width: paletteRect.width,
      height: paletteRect.height,
    });
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  };

  useEffect(() => {
    if (!isPaletteSettingsLoaded || !paletteRef.current) {
      return;
    }

    const observer = new ResizeObserver(() => {
      const paletteRect = paletteRef.current?.getBoundingClientRect();

      if (!paletteRect) {
        return;
      }

      updatePaletteFrame({
        left: paletteRect.left,
        top: paletteRect.top,
        width: paletteRect.width,
        height: paletteRect.height,
      });
    });

    observer.observe(paletteRef.current);

    return () => observer.disconnect();
  }, [isPaletteSettingsLoaded]);

  const paletteBodyStyle = {
    "--palette-tree-width": `${treeWidth}px`,
  } as CSSProperties;

  const paletteStyle = paletteFrame
    ? ({ left: paletteFrame.left, top: paletteFrame.top, width: paletteFrame.width, height: paletteFrame.height } as CSSProperties)
    : undefined;

  const handleSelectFolder = (folder: Folder) => {
    setEditorMode(null);
    setSelectedNode({ type: "folder", id: folder.id });
  };

  const handleSelectHost = (host: Host) => {
    setEditorMode(null);
    setSelectedNode({ type: "host", id: host.id });
  };

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    treeRef.current?.handleKeyDown(event);
  };


  return (
    <div className="pl-overlay" role="presentation">
      <div
        className={`pl-dialog ${paletteFrame ? "is-positioned" : ""}`}
        ref={paletteRef}
        style={paletteStyle}
        role="dialog"
        aria-modal="true"
        aria-label="Connect to host"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="pl-header" onPointerDown={handleHeaderPointerDown}>
          <div className="pl-title">
            <strong>Connect to host</strong>
            <span>
              {isLoading
                ? "Loading connections..."
                : `${treeCounts.hosts === 1 ? "1 host" : `${treeCounts.hosts} hosts`} in ${treeCounts.folders === 1 ? "1 folder" : `${treeCounts.folders} folders`} · Enter or double-click to connect`}
            </span>
          </div>
          <button type="button" className="pl-close" onClick={onClose} title="Close (Esc)" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <SearchBox value={search} onChange={setSearch} onKeyDown={handleSearchKeyDown} matchCount={matchCount} />

        {storageError && <div className="pl-alert pl-alert-error">{storageError}</div>}

        <div className="pl-body" ref={paletteBodyRef} style={paletteBodyStyle}>
          <div className="pl-tree">
            <div className="pl-tree-head">
              <span>Hosts</span>
              <div className="pl-tree-tools">
                <button type="button" className="pl-icon-btn" title="New folder" aria-label="New folder" onClick={() => setEditorMode("create-folder")}>
                  <FolderPlus size={15} />
                </button>
                <button
                  type="button"
                  className="pl-icon-btn"
                  title="New connection"
                  aria-label="New connection"
                  disabled={!targetFolderId}
                  onClick={() => setEditorMode("create-host")}
                >
                  <Plus size={15} />
                </button>
              </div>
            </div>
            <div className="pl-tree-scroll">
              {isLoading ? (
                <div className="pl-tree-empty">Loading connections...</div>
              ) : (
                <ConnectionTree
                  ref={treeRef}
                  folders={folders}
                  search={normalizedSearch}
                  selectedNode={selectedNode}
                  expandedFolderIds={expandedFolderIds}
                  liveHostIds={liveHosts}
                  onExpandedFolderIdsChange={setExpandedFolderIds}
                  onSelectFolder={handleSelectFolder}
                  onSelectHost={handleSelectHost}
                  onConnectHost={onConnect}
                />
              )}
            </div>
          </div>

          <div
            className="pl-splitter"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize host list"
            onPointerDown={handleSplitterPointerDown}
          />

          <div className="pl-info">
            {!isLoading && (
              <SessionInfo
                mode={editorMode}
                onModeChange={setEditorMode}
                selectedFolder={selectedFolder}
                selectedHost={selectedHost}
                selectedPath={selectedPath}
                targetFolderId={targetFolderId}
                targetFolderPath={targetFolderPath}
                isSelectedHostLive={selectedHost ? liveHosts.has(selectedHost.id) : false}
                footerSlot={footerSlot}
                onClose={onClose}
                onConnect={onConnect}
                onCreateFolder={handleCreateFolder}
                onCreateHost={handleCreateHost}
                onRenameFolder={(folderId, name) => {
                  setFolders((current) => updateFolderName(current, folderId, name));
                }}
                onUpdateHost={(host) => {
                  setFolders((current) => updateHost(current, host));
                }}
                onDeleteFolder={handleDeleteFolder}
                onDeleteHost={handleDeleteHost}
              />
            )}
          </div>
        </div>

        <div className="pl-footer">
          <span className="pl-footer-note">
            <KeyRound size={14} />
            Credentials are stored encrypted in the local vault.
          </span>
          <div className="pl-footer-actions" ref={setFooterSlot} />
        </div>
      </div>
    </div>
  );
}
