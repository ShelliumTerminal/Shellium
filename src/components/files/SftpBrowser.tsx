import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import {
  Download, FilePen, FolderOpen, FolderPlus, FolderUp, HardDrive, KeyRound, PanelLeft, Pencil, Server, Trash2, Upload, X,
} from "lucide-react";
import type { Session } from "../palette/types";
import type { SftpEdit, SftpJob } from "../../shellium-env";
import FilePane from "./FilePane";
import LocalPlaces from "./LocalPlaces";
import TransferQueue from "./TransferQueue";
import { isSftpNotConnected, withSftpConnection } from "./sftpConnection";
import { ChmodDialog, ConflictDialog, DeleteDialog } from "./SftpDialogs";
import { errorText, localParent, remoteParent } from "./fileModel";
import type { PaneEntry, PaneSide } from "./fileModel";

/** `active`: a transfer is running or queued. `unsavedEdits`: edited copies not uploaded yet (lost on close). */
export type SftpActivity = { active: boolean; direction?: "download" | "upload"; fileName?: string; unsavedEdits?: number };

type PaneState = {
  cwd: string;
  entries: PaneEntry[];
  status: "idle" | "connecting" | "loading" | "ready" | "error";
  message: string;
  selection: Set<string>;
};

type InlineDialog = { mode: "mkdir" | "rename"; value: string; entry?: PaneEntry; error?: string; busy?: boolean };

const emptyPane = (): PaneState => ({ cwd: "", entries: [], status: "idle", message: "", selection: new Set() });

/** Whether the local pane shows its drives / folders sidebar (per viewer, all sessions). */
const placesStorageKey = "shellium:sftpPlaces";

function loadShowPlaces() {
  try {
    return window.localStorage.getItem(placesStorageKey) !== "hidden";
  } catch {
    return true;
  }
}

/** Width of that sidebar in px (per viewer); double-clicking its border resets it. */
const placesWidthStorageKey = "shellium:sftpPlacesWidth";
const DEFAULT_PLACES_WIDTH = 172;
const MIN_PLACES_WIDTH = 120;
const MAX_PLACES_WIDTH = 360;
/** Smallest usable local file list next to the sidebar. */
const MIN_LOCAL_LIST = 260;

function loadPlacesWidth() {
  try {
    const stored = Number(window.localStorage.getItem(placesWidthStorageKey));
    return stored ? Math.max(MIN_PLACES_WIDTH, Math.min(MAX_PLACES_WIDTH, stored)) : DEFAULT_PLACES_WIDTH;
  } catch {
    return DEFAULT_PLACES_WIDTH;
  }
}

function savePlacesWidth(width: number) {
  try {
    window.localStorage.setItem(placesWidthStorageKey, String(width));
  } catch {
    // per-viewer convenience only
  }
}

type SftpBrowserProps = {
  session: Session;
  hidden: boolean;
  onActivityChange(activity: SftpActivity): void;
};

/**
 * Local and remote file panes with a transfer queue. Transfers, conflict checks, recursive delete,
 * chmod and editing run in the main process (electron/sftpJobs.ts); this only drives them.
 */
export default function SftpBrowser({ session, hidden, onActivityChange }: SftpBrowserProps) {
  const [remote, setRemote] = useState<PaneState>(emptyPane);
  const [local, setLocal] = useState<PaneState>(emptyPane);
  const [jobs, setJobs] = useState<SftpJob[]>([]);
  const [edits, setEdits] = useState<SftpEdit[]>([]);
  const [inline, setInline] = useState<InlineDialog | null>(null);
  const [resolving, setResolving] = useState<SftpJob | null>(null);
  const [deleting, setDeleting] = useState<{ entries: PaneEntry[]; summary: { files: number; folders: number; bytes: number } | null; error: string | null; busy: boolean } | null>(null);
  const [chmod, setChmod] = useState<{ entries: PaneEntry[]; error: string | null; busy: boolean } | null>(null);
  const [localWidth, setLocalWidth] = useState(46);
  const [showPlaces, setShowPlaces] = useState(loadShowPlaces);
  const [placesWidth, setPlacesWidth] = useState(loadPlacesWidth);
  const connectedRef = useRef(false);
  const remoteCwdRef = useRef("");
  const localCwdRef = useRef("");
  const finishedRef = useRef(new Set<string>());
  /** Conflict dialogs closed with "Later": not reopened automatically (the queue has a Decide button). */
  const dismissedRef = useRef(new Set<string>());
  const api = window.shellium?.sftp;

  const loadRemote = useCallback(async (remotePath?: string, retried = false): Promise<void> => {
    if (!api) {
      return;
    }
    try {
      if (!connectedRef.current) {
        setRemote((current) => ({ ...current, status: "connecting", message: "Connecting..." }));
        const connection = await api.connect({ sessionId: session.id, host: session.host });
        connectedRef.current = true;
        remoteCwdRef.current = connection.cwd;
      }
      setRemote((current) => ({ ...current, status: "loading", message: "Loading..." }));
      const result = await api.list(session.id, remotePath ?? (remoteCwdRef.current || "."));
      remoteCwdRef.current = result.cwd;
      setRemote((current) => ({
        cwd: result.cwd,
        entries: result.entries,
        status: "ready",
        message: `${result.entries.length} item${result.entries.length === 1 ? "" : "s"}`,
        selection: result.cwd === current.cwd
          ? new Set([...current.selection].filter((path) => result.entries.some((entry) => entry.path === path)))
          : new Set(),
      }));
    } catch (error) {
      // The channel may be gone (the server dropped it): connect again, once right away.
      connectedRef.current = false;
      if (!retried && isSftpNotConnected(error)) {
        return loadRemote(remotePath, true);
      }
      setRemote((current) => ({ ...current, status: "error", message: errorText(error) }));
    }
  }, [api, session.host, session.id]);

  const loadLocal = useCallback(async (localPath?: string) => {
    const files = window.shellium?.localFiles;
    if (!files) {
      return;
    }
    try {
      setLocal((current) => ({ ...current, status: "loading", message: "Loading..." }));
      const result = await files.list(localPath || localCwdRef.current || undefined);
      localCwdRef.current = result.cwd;
      setLocal((current) => ({
        cwd: result.cwd,
        entries: result.entries,
        status: "ready",
        message: `${result.entries.length} item${result.entries.length === 1 ? "" : "s"}`,
        selection: result.cwd === current.cwd
          ? new Set([...current.selection].filter((path) => result.entries.some((entry) => entry.path === path)))
          : new Set(),
      }));
    } catch (error) {
      setLocal((current) => ({ ...current, status: "error", message: errorText(error) }));
    }
  }, []);

  useEffect(() => {
    loadLocal().catch(() => undefined);
    loadRemote().catch(() => undefined);
    api?.listJobs(session.id).then(setJobs).catch(() => undefined);
    api?.editList(session.id).then(setEdits).catch(() => undefined);
    // Mount only: the panel opens with home folders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const offJobs = api?.onJobs((payload) => {
      if (payload.sessionId === session.id) {
        setJobs(payload.jobs);
      }
    });
    const offEdit = api?.onEdit((edit) => {
      if (edit.sessionId !== session.id) {
        return;
      }
      setEdits((current) => edit.status === "closed"
        ? current.filter((item) => item.id !== edit.id)
        : current.some((item) => item.id === edit.id) ? current.map((item) => item.id === edit.id ? edit : item) : [...current, edit]);
    });
    // Safety net: a window that was hidden or minimized catches up when it is shown again.
    const refresh = () => {
      if (document.visibilityState === "visible") {
        api?.listJobs(session.id).then(setJobs).catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      offJobs?.();
      offEdit?.();
    };
  }, [api, session.id]);

  // Refresh the receiving side when a job finishes; open the decision dialog when one is needed.
  useEffect(() => {
    for (const job of jobs) {
      if (["done", "error", "canceled"].includes(job.status) && !finishedRef.current.has(job.id)) {
        finishedRef.current.add(job.id);
        if (job.direction === "upload" && job.targetDir === remoteCwdRef.current) {
          loadRemote(remoteCwdRef.current).catch(() => undefined);
        }
        if (job.direction === "download" && job.targetDir === localCwdRef.current) {
          loadLocal(localCwdRef.current).catch(() => undefined);
        }
      }
    }
    setResolving((current) => {
      if (current) {
        const fresh = jobs.find((job) => job.id === current.id);
        return fresh?.status === "conflicts" ? fresh : null;
      }
      return jobs.find((job) => job.status === "conflicts" && !dismissedRef.current.has(job.id)) ?? null;
    });
  }, [jobs, loadLocal, loadRemote]);

  useEffect(() => {
    const running = jobs.find((job) => !["done", "error", "canceled"].includes(job.status));
    const unsavedEdits = edits.filter((edit) => ["changed", "uploading", "conflict", "error"].includes(edit.status)).length;
    onActivityChange(running
      ? { active: true, direction: running.direction, fileName: running.label, unsavedEdits }
      : { active: false, unsavedEdits });
  }, [jobs, edits, onActivityChange]);

  const selectedRemote = remote.entries.filter((entry) => remote.selection.has(entry.path));
  const selectedLocal = local.entries.filter((entry) => local.selection.has(entry.path));
  const remoteBusy = remote.status === "connecting" || remote.status === "loading";
  const localBusy = local.status === "loading";

  const enqueue = (direction: "upload" | "download", sources: string[], targetDir: string) => {
    if (!api || sources.length === 0 || !targetDir) {
      return;
    }
    withSftpConnection(session, () => api.enqueue(session.id, direction, sources, targetDir)).catch((error) => {
      const message = errorText(error);
      if (direction === "upload") setRemote((current) => ({ ...current, status: "error", message }));
      else setLocal((current) => ({ ...current, status: "error", message }));
    });
  };

  const upload = (paths = selectedLocal.map((entry) => entry.path), targetDir = remote.cwd) => enqueue("upload", paths, targetDir);
  const download = (paths = selectedRemote.map((entry) => entry.path), targetDir = local.cwd) => enqueue("download", paths, targetDir);

  const handleDrop = (side: PaneSide) => (paths: string[], from: PaneSide | "os", targetDir: string) => {
    if (side === "remote" && (from === "local" || from === "os")) {
      upload(paths, targetDir);
    } else if (side === "local" && from === "remote") {
      download(paths, targetDir);
    }
  };

  const pickUpload = (folders: boolean) => {
    if (!api || !remote.cwd) {
      return;
    }
    const targetDir = remote.cwd;
    withSftpConnection(session, () => api.pickAndUpload(session.id, targetDir, folders)).catch((error) => {
      setRemote((current) => ({ ...current, status: "error", message: errorText(error) }));
    });
  };

  const openEdit = (entry: PaneEntry) => {
    if (!api || entry.type === "directory") {
      return;
    }
    setRemote((current) => ({ ...current, message: `Opening ${entry.name}...` }));
    withSftpConnection(session, () => api.editStart(session.id, entry.path))
      .then(() => setRemote((current) => ({ ...current, message: `Opened ${entry.name} - changes are uploaded when you choose Upload` })))
      .catch((error) => setRemote((current) => ({ ...current, status: "error", message: errorText(error) })));
  };

  const startDelete = () => {
    if (!api || selectedRemote.length === 0) {
      return;
    }
    const entries = selectedRemote;
    setDeleting({ entries, summary: null, error: null, busy: false });
    api.inspect(session.id, entries.map((entry) => entry.path))
      .then((summary) => setDeleting((current) => current && { ...current, summary }))
      .catch((error) => setDeleting((current) => current && { ...current, error: errorText(error) }));
  };

  const confirmDelete = () => {
    if (!api || !deleting) {
      return;
    }
    setDeleting({ ...deleting, busy: true, error: null });
    api.deletePaths(session.id, deleting.entries.map((entry) => entry.path))
      .then(async (result) => {
        setDeleting(null);
        await loadRemote(remote.cwd);
        setRemote((current) => ({ ...current, message: `Deleted ${result.deleted} item${result.deleted === 1 ? "" : "s"}` }));
      })
      .catch(async (error) => {
        setDeleting((current) => current && { ...current, busy: false, error: errorText(error) });
        await loadRemote(remote.cwd);
      });
  };

  const applyChmod = (mode: number) => {
    if (!api || !chmod) {
      return;
    }
    setChmod({ ...chmod, busy: true, error: null });
    api.chmod(session.id, chmod.entries.map((entry) => entry.path), mode)
      .then(async () => {
        setChmod(null);
        await loadRemote(remote.cwd);
      })
      .catch((error) => setChmod((current) => current && { ...current, busy: false, error: errorText(error) }));
  };

  const submitInline = async () => {
    if (!api || !inline) {
      return;
    }
    const value = inline.value.trim();
    if (!value) {
      setInline({ ...inline, error: inline.mode === "mkdir" ? "Folder name is required." : "Name is required." });
      return;
    }
    setInline({ ...inline, busy: true, error: undefined });
    try {
      if (inline.mode === "mkdir") {
        await api.mkdir(session.id, remote.cwd, value);
      } else if (inline.entry) {
        await api.rename(session.id, inline.entry.path, value);
      }
      setInline(null);
      await loadRemote(remote.cwd);
    } catch (error) {
      setInline((current) => current && { ...current, busy: false, error: errorText(error) });
    }
  };

  const handleSplitterPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const panes = event.currentTarget.closest(".ft-panes") as HTMLElement | null;
    if (!panes || window.innerWidth <= 760) {
      return;
    }
    event.preventDefault();
    const rect = panes.getBoundingClientRect();
    const move = (moveEvent: PointerEvent) => setLocalWidth(Math.max(30, Math.min(70, ((moveEvent.clientX - rect.left) / rect.width) * 100)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const handlePlacesResizerPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const localSide = event.currentTarget.closest(".ft-local") as HTMLElement | null;
    const places = localSide?.querySelector<HTMLElement>(".ft-places");
    if (!localSide || !places || event.button !== 0) {
      return;
    }
    event.preventDefault();
    const localWidthPx = localSide.getBoundingClientRect().width;
    const start = { x: event.clientX, width: places.getBoundingClientRect().width };
    let latest = start.width;
    const move = (moveEvent: PointerEvent) => {
      latest = Math.round(Math.max(MIN_PLACES_WIDTH, Math.min(MAX_PLACES_WIDTH, localWidthPx - MIN_LOCAL_LIST, start.width + moveEvent.clientX - start.x)));
      setPlacesWidth(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      savePlacesWidth(latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const single = selectedRemote.length === 1 ? selectedRemote[0] : null;

  return (
    <section className="ft-panel" aria-label="SFTP file browser" hidden={hidden}>
      {edits.length > 0 && (
        <div className="ft-edits" aria-label="Files open for editing">
          {edits.map((edit) => (
            <div key={edit.id} className={`ft-edit ft-edit-${edit.status}`}>
              <FilePen aria-hidden="true" size={14} />
              <span className="ft-mono ft-edit-path" title={edit.remotePath}>{edit.remotePath}</span>
              <span className="ft-edit-msg">{edit.message ?? "Open in your editor - save there, then upload here"}</span>
              {(edit.status === "changed" || edit.status === "error") && (
                <button type="button" className="sh-btn sh-btn-primary sh-btn-sm" onClick={() => api && withSftpConnection(session, () => api.editUpload(edit.id, false)).catch(() => undefined)}>Upload</button>
              )}
              {edit.status === "conflict" && (
                <button type="button" className="sh-btn sh-btn-danger sh-btn-sm" onClick={() => api && withSftpConnection(session, () => api.editUpload(edit.id, true)).catch(() => undefined)}>Overwrite anyway</button>
              )}
              <button type="button" className="ft-tool" title="Stop editing (local copy is deleted)" aria-label={`Stop editing ${edit.remotePath}`}
                onClick={() => api?.editStop(edit.id)}>
                <X aria-hidden="true" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="ft-panes" style={{ "--ft-local-width": `${localWidth}%`, "--ft-places-w": `${placesWidth}px` } as CSSProperties}>
        <div className="ft-local">
          {showPlaces && <LocalPlaces cwd={local.cwd} busy={localBusy} onNavigate={(path) => { loadLocal(path).catch(() => undefined); }} />}
          {showPlaces && (
            <button type="button" className="ft-places-resizer" aria-label="Resize drives and folders" title="Drag to resize - double-click resets"
              onPointerDown={handlePlacesResizerPointerDown}
              onDoubleClick={() => { setPlacesWidth(DEFAULT_PLACES_WIDTH); savePlacesWidth(DEFAULT_PLACES_WIDTH); }} />
          )}
          <FilePane
            sessionId={session.id}
            side="local"
            title={<><HardDrive aria-hidden="true" size={15} />Local</>}
            cwd={local.cwd}
            entries={local.entries}
            status={local.status}
            message={local.message}
            busy={localBusy}
            selection={local.selection}
            onSelectionChange={(selection) => setLocal((current) => ({ ...current, selection }))}
            onNavigate={(path) => loadLocal(path)}
            onUp={() => loadLocal(localParent(local.cwd))}
            onRefresh={() => loadLocal(local.cwd)}
            onDrop={handleDrop("local")}
            tools={(
              <>
                <button type="button" className={"ft-tool" + (showPlaces ? " active" : "")} aria-pressed={showPlaces}
                  onClick={() => {
                    const next = !showPlaces;
                    setShowPlaces(next);
                    try {
                      window.localStorage.setItem(placesStorageKey, next ? "shown" : "hidden");
                    } catch {
                      // per-viewer convenience only
                    }
                  }} title={showPlaces ? "Hide drives and folders" : "Show drives and folders"} aria-label="Toggle drives and folders">
                  <PanelLeft aria-hidden="true" size={15} />
                </button>
                <button type="button" className="ft-tool" onClick={() => {
                  window.shellium?.localFiles.chooseDirectory().then((result) => {
                    if (!result.canceled && result.filePath) {
                      loadLocal(result.filePath).catch(() => undefined);
                    }
                  }).catch(() => undefined);
                }} disabled={localBusy} title="Choose folder" aria-label="Choose local folder">
                  <FolderOpen aria-hidden="true" size={15} />
                </button>
                <span className="ft-tools-sep" aria-hidden="true" />
                <button type="button" className="sh-btn sh-btn-secondary sh-btn-sm" onClick={() => upload()}
                  disabled={selectedLocal.length === 0 || !remote.cwd} title="Upload the selected files and folders to the remote folder">
                  <Upload aria-hidden="true" size={14} />
                  Upload{selectedLocal.length > 1 ? ` ${selectedLocal.length}` : ""}
                </button>
              </>
            )}
          />
        </div>
        <button type="button" className="ft-splitter" onPointerDown={handleSplitterPointerDown} title="Resize file browsers" aria-label="Resize local and remote file browsers" />
        <FilePane
          sessionId={session.id}
          side="remote"
          title={<><Server aria-hidden="true" size={15} />Remote<span className="ft-pane-host">{session.host.username}@{session.host.hostname}</span></>}
          cwd={remote.cwd}
          entries={remote.entries}
          status={remote.status}
          message={remote.message}
          busy={remoteBusy}
          selection={remote.selection}
          onSelectionChange={(selection) => setRemote((current) => ({ ...current, selection }))}
          onNavigate={(path) => loadRemote(path)}
          onUp={() => loadRemote(remoteParent(remote.cwd))}
          onRefresh={() => loadRemote(remote.cwd)}
          onOpenFile={openEdit}
          onDrop={handleDrop("remote")}
          onDeleteKey={startDelete}
          onRenameKey={() => single && setInline({ mode: "rename", value: single.name, entry: single })}
          acceptsOsFiles
          inline={inline && (
            <form className="ft-inline" onSubmit={(event) => { event.preventDefault(); submitInline().catch(() => undefined); }}>
              <strong>{inline.mode === "mkdir" ? "New folder" : "Rename"}</strong>
              <input autoFocus value={inline.value} placeholder={inline.mode === "mkdir" ? "Folder name" : "New name"}
                onChange={(event) => setInline((current) => current && { ...current, value: event.target.value, error: undefined })} disabled={inline.busy} />
              <button type="button" className="sh-btn sh-btn-ghost sh-btn-sm" onClick={() => setInline(null)} disabled={inline.busy}>Cancel</button>
              <button type="submit" className="sh-btn sh-btn-primary sh-btn-sm" disabled={inline.busy}>{inline.mode === "mkdir" ? "Create" : "Rename"}</button>
              {inline.error && <div className="ft-inline-error">{inline.error}</div>}
            </form>
          )}
          tools={(
            <>
              <span className="ft-tools-sep" aria-hidden="true" />
              <button type="button" className="ft-tool" onClick={() => setInline({ mode: "mkdir", value: "" })} disabled={remoteBusy || !remote.cwd} title="New folder" aria-label="New folder">
                <FolderPlus aria-hidden="true" size={15} />
              </button>
              <button type="button" className="ft-tool" onClick={() => single && setInline({ mode: "rename", value: single.name, entry: single })}
                disabled={!single || remoteBusy} title="Rename (F2)" aria-label="Rename selected">
                <Pencil aria-hidden="true" size={15} />
              </button>
              <button type="button" className="ft-tool" onClick={() => single && openEdit(single)}
                disabled={!single || single.type === "directory" || remoteBusy} title="Edit in your editor (double click)" aria-label="Edit selected file">
                <FilePen aria-hidden="true" size={15} />
              </button>
              <button type="button" className="ft-tool" onClick={() => setChmod({ entries: selectedRemote, error: null, busy: false })}
                disabled={selectedRemote.length === 0 || remoteBusy} title="Permissions (chmod)" aria-label="Change permissions">
                <KeyRound aria-hidden="true" size={15} />
              </button>
              <button type="button" className="ft-tool ft-tool-danger" onClick={startDelete} disabled={selectedRemote.length === 0 || remoteBusy}
                title="Delete (Del)" aria-label="Delete selected">
                <Trash2 aria-hidden="true" size={15} />
              </button>
              <span className="ft-tools-sep" aria-hidden="true" />
              <button type="button" className="ft-tool" onClick={() => pickUpload(false)} disabled={remoteBusy || !remote.cwd} title="Upload files from this computer" aria-label="Upload files">
                <Upload aria-hidden="true" size={15} />
              </button>
              <button type="button" className="ft-tool" onClick={() => pickUpload(true)} disabled={remoteBusy || !remote.cwd} title="Upload folders from this computer" aria-label="Upload folders">
                <FolderUp aria-hidden="true" size={15} />
              </button>
              <button type="button" className="sh-btn sh-btn-secondary sh-btn-sm" onClick={() => download()}
                disabled={selectedRemote.length === 0 || !local.cwd} title="Download the selected files and folders to the local folder">
                <Download aria-hidden="true" size={14} />
                Download{selectedRemote.length > 1 ? ` ${selectedRemote.length}` : ""}
              </button>
            </>
          )}
        />
      </div>
      <TransferQueue
        jobs={jobs}
        onCancel={(jobId) => api?.cancelJob(jobId)}
        onPause={(jobId) => api?.pauseJob(jobId)}
        onResume={(jobId) => {
          if (api) {
            withSftpConnection(session, () => api.resumeJob(jobId))
              .catch((error) => setRemote((current) => ({ ...current, status: "error", message: errorText(error) })));
          }
        }}
        onResolve={setResolving}
        onClearFinished={() => api?.clearFinishedJobs(session.id)}
      />
      {resolving && (
        <ConflictDialog
          key={resolving.id}
          job={resolving}
          onSubmit={(decision) => {
            api?.resolveConflicts(resolving.id, decision).catch(() => undefined);
            setResolving(null);
          }}
          onCancelJob={() => {
            api?.cancelJob(resolving.id);
            setResolving(null);
          }}
          onClose={() => {
            dismissedRef.current.add(resolving.id);
            setResolving(null);
          }}
        />
      )}
      {deleting && (
        <DeleteDialog
          names={deleting.entries.map((entry) => entry.name)}
          summary={deleting.summary}
          error={deleting.error}
          busy={deleting.busy}
          onConfirm={confirmDelete}
          onClose={() => !deleting.busy && setDeleting(null)}
        />
      )}
      {chmod && (
        <ChmodDialog
          names={chmod.entries.map((entry) => entry.name)}
          initial={chmod.entries[0]?.permissions ?? 0o644}
          error={chmod.error}
          busy={chmod.busy}
          onApply={applyChmod}
          onClose={() => !chmod.busy && setChmod(null)}
        />
      )}
    </section>
  );
}
