import { useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { ArrowDown, ArrowUp, CornerDownLeft, Eye, EyeOff, File as FileIcon, Folder, Link2, RefreshCw } from "lucide-react";
import { formatSize, formatTime, isHidden, octal, PANE_DRAG_TYPE, permissionString, sortEntries } from "./fileModel";
import type { PaneDragPayload, PaneEntry, PaneSide, SortKey, SortState } from "./fileModel";

type FilePaneProps = {
  sessionId: string;
  side: PaneSide;
  title: ReactNode;
  cwd: string;
  entries: PaneEntry[];
  status: string;
  message: string;
  busy: boolean;
  selection: Set<string>;
  onSelectionChange(selection: Set<string>): void;
  onNavigate(path: string): void;
  onUp(): void;
  onRefresh(): void;
  /** Double click / Enter on a file (folders always open). */
  onOpenFile?(entry: PaneEntry): void;
  /** Files dropped here: from the other pane, or (remote pane) from Explorer / Finder. */
  onDrop(paths: string[], from: PaneSide | "os", targetDir: string): void;
  onDeleteKey?(): void;
  onRenameKey?(): void;
  tools: ReactNode;
  inline?: ReactNode;
  /** Files dragged in from the operating system are accepted (remote pane). */
  acceptsOsFiles?: boolean;
};

const COLUMNS: Array<{ key: SortKey; label: string; remoteOnly?: boolean }> = [
  { key: "name", label: "Name" },
  { key: "size", label: "Size" },
  { key: "modifiedAt", label: "Modified" },
  { key: "permissions", label: "Permissions", remoteOnly: true },
];

/** One side of the SFTP browser: path bar, sortable multi-select list, drag and drop. */
export default function FilePane({
  sessionId, side, title, cwd, entries, status, message, busy, selection, onSelectionChange, onNavigate, onUp, onRefresh,
  onOpenFile, onDrop, onDeleteKey, onRenameKey, tools, inline, acceptsOsFiles,
}: FilePaneProps) {
  const [pathInput, setPathInput] = useState(cwd);
  const [lastCwd, setLastCwd] = useState(cwd);
  const [showHidden, setShowHidden] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: "name", descending: false });
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const anchorRef = useRef<string | null>(null);
  const columns = COLUMNS.filter((column) => side === "remote" || !column.remoteOnly);

  if (cwd !== lastCwd) {
    setLastCwd(cwd);
    setPathInput(cwd);
  }

  const visible = useMemo(
    () => sortEntries(showHidden ? entries : entries.filter((entry) => !isHidden(entry)), sort),
    [entries, showHidden, sort],
  );
  const hiddenCount = entries.length - entries.filter((entry) => !isHidden(entry)).length;
  const selected = visible.filter((entry) => selection.has(entry.path));
  const selectedBytes = selected.filter((entry) => entry.type !== "directory").reduce((sum, entry) => sum + entry.size, 0);

  const toggleSort = (key: SortKey) => {
    setSort((current) => current.key === key ? { key, descending: !current.descending } : { key, descending: key !== "name" });
  };

  const handleRowClick = (event: ReactMouseEvent, entry: PaneEntry) => {
    if (event.shiftKey && anchorRef.current) {
      const from = visible.findIndex((item) => item.path === anchorRef.current);
      const to = visible.findIndex((item) => item.path === entry.path);
      if (from >= 0 && to >= 0) {
        const range = visible.slice(Math.min(from, to), Math.max(from, to) + 1).map((item) => item.path);
        const next = event.ctrlKey || event.metaKey ? new Set([...selection, ...range]) : new Set(range);
        onSelectionChange(next);
        return;
      }
    }
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(selection);
      if (next.has(entry.path)) {
        next.delete(entry.path);
      } else {
        next.add(entry.path);
      }
      anchorRef.current = entry.path;
      onSelectionChange(next);
      return;
    }
    anchorRef.current = entry.path;
    onSelectionChange(new Set([entry.path]));
  };

  const open = (entry: PaneEntry) => {
    if (entry.type === "directory") {
      onNavigate(entry.path);
    } else {
      onOpenFile?.(entry);
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      onSelectionChange(new Set(visible.map((entry) => entry.path)));
    } else if (event.key === "Escape" && selection.size > 0) {
      event.preventDefault();
      event.stopPropagation();
      onSelectionChange(new Set());
    } else if (event.key === "Delete" && selection.size > 0) {
      event.preventDefault();
      onDeleteKey?.();
    } else if (event.key === "F2" && selection.size === 1) {
      event.preventDefault();
      onRenameKey?.();
    } else if (event.key === "Backspace") {
      event.preventDefault();
      onUp();
    } else if (event.key === "Enter" && selected.length === 1) {
      event.preventDefault();
      open(selected[0]);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const index = visible.findIndex((entry) => entry.path === anchorRef.current);
      const next = visible[Math.max(0, Math.min(visible.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
      if (next) {
        anchorRef.current = next.path;
        onSelectionChange(new Set([next.path]));
        document.getElementById(rowId(sessionId, side, next.path))?.scrollIntoView({ block: "nearest" });
      }
    }
  };

  const handleDragStart = (event: DragEvent, entry: PaneEntry) => {
    const paths = selection.has(entry.path) ? [...selection] : [entry.path];
    if (!selection.has(entry.path)) {
      onSelectionChange(new Set([entry.path]));
    }
    const payload: PaneDragPayload = { sessionId, side, paths };
    event.dataTransfer.setData(PANE_DRAG_TYPE, JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", paths.join("\n"));
    event.dataTransfer.effectAllowed = "copy";
  };

  /** Whether this drag may land here; the payload itself is only readable on drop. */
  const acceptsDrag = (event: DragEvent) => {
    const types = [...event.dataTransfer.types];
    return types.includes(PANE_DRAG_TYPE) || (acceptsOsFiles === true && types.includes("Files"));
  };

  const handleDragOver = (event: DragEvent, target: string) => {
    if (!acceptsDrag(event) || busy) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setDropTarget(target);
  };

  const handleDrop = (event: DragEvent, targetDir: string) => {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    const raw = event.dataTransfer.getData(PANE_DRAG_TYPE);
    if (raw) {
      try {
        const payload = JSON.parse(raw) as PaneDragPayload;
        if (payload.sessionId === sessionId && payload.side !== side && payload.paths.length > 0) {
          onDrop(payload.paths, payload.side, targetDir);
        }
      } catch {
        // not ours
      }
      return;
    }
    if (acceptsOsFiles && event.dataTransfer.files.length > 0) {
      const paths = [...event.dataTransfer.files].map((file) => window.shellium?.sftp.pathForFile(file) ?? "").filter(Boolean);
      if (paths.length > 0) {
        onDrop(paths, "os", targetDir);
      }
    }
  };

  return (
    <section className="ft-pane" aria-label={side === "local" ? "Local files" : "Remote files"}>
      <div className="ft-pane-head">
        <span className="ft-pane-title">{title}</span>
        <div className="ft-tools">
          <button type="button" className="ft-tool" onClick={onUp} disabled={busy || !cwd} title="Parent folder (Backspace)" aria-label={`${side} parent folder`}>
            <ArrowUp aria-hidden="true" size={15} />
          </button>
          <button type="button" className="ft-tool" onClick={onRefresh} disabled={busy || !cwd} title="Refresh" aria-label={`Refresh ${side}`}>
            <RefreshCw aria-hidden="true" size={15} />
          </button>
          <button
            type="button"
            className={"ft-tool" + (showHidden ? " active" : "")}
            onClick={() => setShowHidden((current) => !current)}
            title={showHidden ? "Hide hidden files" : "Show hidden files"}
            aria-label={showHidden ? `Hide hidden ${side} files` : `Show hidden ${side} files`}
            aria-pressed={showHidden}
          >
            {showHidden ? <Eye aria-hidden="true" size={15} /> : <EyeOff aria-hidden="true" size={15} />}
          </button>
          {tools}
        </div>
      </div>
      <form
        className="ft-path"
        onSubmit={(event) => {
          event.preventDefault();
          onNavigate(pathInput);
        }}
      >
        <input value={pathInput} onChange={(event) => setPathInput(event.target.value)} disabled={busy} aria-label={`${side} path`} spellCheck={false} />
        <button type="submit" className="ft-tool" disabled={busy || !pathInput.trim()} title="Go" aria-label={`Go ${side}`}>
          <CornerDownLeft aria-hidden="true" size={14} />
        </button>
      </form>
      {inline}
      <div className={"ft-columns" + (side === "remote" ? " ft-columns-remote" : "")} role="row">
        {columns.map((column) => (
          <button
            key={column.key}
            type="button"
            className={`ft-sort ft-col-${column.key}` + (sort.key === column.key ? " active" : "")}
            aria-sort={sort.key === column.key ? (sort.descending ? "descending" : "ascending") : "none"}
            onClick={() => toggleSort(column.key)}
          >
            {column.label}
            {sort.key === column.key && (sort.descending ? <ArrowDown aria-hidden="true" size={11} /> : <ArrowUp aria-hidden="true" size={11} />)}
          </button>
        ))}
      </div>
      <div
        className={"ft-list" + (dropTarget === cwd ? " ft-drop" : "")}
        role="listbox"
        aria-multiselectable="true"
        aria-label={side === "local" ? "Local files" : "Remote files"}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onDragOver={(event) => handleDragOver(event, cwd)}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDropTarget(null);
          }
        }}
        onDrop={(event) => handleDrop(event, cwd)}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            onSelectionChange(new Set());
          }
        }}
      >
        {visible.map((entry) => {
          const isSelected = selection.has(entry.path);
          const isDir = entry.type === "directory";
          return (
            <div
              key={entry.path}
              id={rowId(sessionId, side, entry.path)}
              role="option"
              aria-selected={isSelected}
              className={"ft-row" + (side === "remote" ? " ft-row-remote" : "") + (isSelected ? " selected" : "")
                + (isDir && dropTarget === entry.path ? " ft-drop-row" : "")}
              title={entry.path}
              draggable
              onDragStart={(event) => handleDragStart(event, entry)}
              onDragOver={isDir ? (event) => handleDragOver(event, entry.path) : undefined}
              onDrop={isDir ? (event) => handleDrop(event, entry.path) : undefined}
              onClick={(event) => handleRowClick(event, entry)}
              onDoubleClick={() => open(entry)}
            >
              <span className="ft-name">
                {isDir ? <Folder className="ft-icon-dir" aria-hidden="true" size={15} />
                  : entry.type === "symlink" ? <Link2 className="ft-icon-file" aria-hidden="true" size={15} />
                    : <FileIcon className="ft-icon-file" aria-hidden="true" size={15} />}
                <span>{entry.name}</span>
              </span>
              <span className="ft-size">{isDir ? "" : formatSize(entry.size)}</span>
              <span className="ft-time">{formatTime(entry.modifiedAt)}</span>
              {side === "remote" && (
                <span className="ft-perm" title={`${octal(entry.permissions)}${entry.owner ? " · " + entry.owner : ""}`}>
                  {permissionString(entry.permissions)}
                </span>
              )}
            </div>
          );
        })}
        {visible.length === 0 && !busy && <div className="ft-empty">No files</div>}
      </div>
      <div className={"ft-status ft-status-" + status}>
        <span>
          {message || "Not loaded"}
          {hiddenCount > 0 && !showHidden ? ` · ${hiddenCount} hidden` : ""}
        </span>
        {selected.length > 0 && (
          <span className="ft-status-selection">
            {selected.length === 1 ? selected[0].name : `${selected.length} selected`}
            {selectedBytes > 0 ? ` · ${formatSize(selectedBytes)}` : ""}
          </span>
        )}
      </div>
    </section>
  );
}

function rowId(sessionId: string, side: PaneSide, path: string) {
  return `ft-${side}-${sessionId}-${path}`;
}
