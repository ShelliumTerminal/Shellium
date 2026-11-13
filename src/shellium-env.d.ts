import type { Folder, Host } from "./components/palette/types";
import type { ConnectionKeepalive } from "./components/common/antiIdleModel";

type ProtectionTool = "tmux" | "screen";
type SessionProtection = { tool: ProtectionTool; name: string; asUser?: string };

type TerminalConnectRequest = {
  sessionId: string;
  host: Host;
  cols: number;
  rows: number;
  keepalive?: ConnectionKeepalive;
  protection?: { mode: "new" } | (SessionProtection & { mode: "attach" });
};

type ProtectionProbe = {
  tool: ProtectionTool | null;
  orphans: Array<SessionProtection & { command: string | null }>;
};

type TerminalProtectionPayload = { sessionId: string; protection: SessionProtection | null; notice?: string };

type HostKeyInfo = {
  keyType: string;
  fingerprint: string;
};

type ConnectionPromptTarget = {
  requestId: string;
  hostId: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
};

/** A trusted SSH host key (electron/knownHosts.ts). */
export type KnownHostListItem = {
  id: string;
  hostname: string;
  port: number;
  keyType: string;
  fingerprint: string;
  addedAt: string;
  lastSeenAt: string;
  source?: "openssh-import" | "backup";
};

export type OpenSshImportResult = {
  canceled: boolean;
  filePath?: string;
  added: number;
  alreadyKnown: number;
  conflicts: number;
  skippedHashed: number;
  skippedOther: number;
};

/** A security question the SSH layer asks mid-handshake (see electron/connectionPrompts.ts). */
export type ConnectionPrompt =
  | ({ kind: "host-key-new"; key: HostKeyInfo } & ConnectionPromptTarget)
  | ({ kind: "host-key-changed"; key: HostKeyInfo; previous: HostKeyInfo } & ConnectionPromptTarget)
  | ({ kind: "legacy-algorithms"; detail: string } & ConnectionPromptTarget);

export type ConnectionPromptDecision = "trust" | "once" | "always" | "reject";

type TerminalDataPayload = {
  sessionId: string;
  data: string;
};

type TerminalExitPayload = {
  sessionId: string;
  reason: string;
  /** The connection dropped (or a network error): a protected tab reconnects. */
  lost?: boolean;
  protection?: SessionProtection | null;
};

type SftpConnectRequest = {
  sessionId: string;
  host: Host;
};

export type SftpEntry = {
  name: string;
  path: string;
  type: "directory" | "file" | "symlink" | "other";
  size: number;
  modifiedAt: number;
  /** Permission bits (mode & 0o7777). */
  permissions: number;
  owner?: string;
};

/* Transfer queue (electron/sftpJobs.ts). */
export type SftpJobStatus = "planning" | "conflicts" | "queued" | "running" | "paused" | "done" | "error" | "canceled";
export type SftpConflictAction = "overwrite" | "rename" | "skip";

export type SftpConflict = {
  id: string;
  relativePath: string;
  existing: { size: number; modifiedAt: number };
  incoming: { size: number; modifiedAt: number };
};

export type SftpJob = {
  id: string;
  sessionId: string;
  direction: "upload" | "download";
  label: string;
  targetDir: string;
  status: SftpJobStatus;
  totalFiles: number;
  doneFiles: number;
  skippedFiles: number;
  totalBytes: number;
  transferredBytes: number;
  /** Over the last few seconds while running. */
  bytesPerSecond?: number;
  currentFile?: string;
  message?: string;
  /** Why a paused job is paused: the user (Pause) or a lost connection (resumes after reconnecting). */
  pausedBy?: "user" | "connection";
  conflicts: SftpConflict[];
  backupDefault: boolean;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
};

export type SftpConflictDecision = {
  defaultAction: SftpConflictAction;
  perItem?: Record<string, SftpConflictAction>;
  backup?: boolean;
};

export type SftpEdit = {
  id: string;
  sessionId: string;
  remotePath: string;
  status: "open" | "changed" | "uploading" | "uploaded" | "conflict" | "error" | "closed";
  message?: string;
};

type SftpListResult = {
  cwd: string;
  entries: SftpEntry[];
};

type SftpTransferResult = {
  canceled: boolean;
  filePath?: string;
  filePaths?: string[];
  count?: number;
};

type SftpTransferProgressPayload = {
  sessionId: string;
  direction: "download" | "upload";
  fileName: string;
  transferredBytes: number;
  totalBytes: number;
  percent: number;
  currentFileIndex: number;
  totalFiles: number;
};

export type LocalFileEntry = {
  name: string;
  path: string;
  type: "directory" | "file" | "other";
  size: number;
  modifiedAt: number;
};

type LocalFileListResult = {
  cwd: string;
  entries: LocalFileEntry[];
};

export type LocalDrive = {
  path: string;
  label: string;
  kind: "fixed" | "removable" | "network" | "optical" | "volume";
  totalBytes?: number;
  freeBytes?: number;
};

export type LocalPlace = {
  path: string;
  label: string;
  kind: "home" | "desktop" | "documents" | "downloads";
};

type ScriptButtonColor = "black" | "blue" | "cyan" | "green" | "grey" | "magenta" | "orange" | "purple" | "red" | "white" | "yellow";

type ScriptButton = {
  id: string;
  categoryId: string;
  label: string;
  script: string;
  color: ScriptButtonColor;
  sortOrder: number;
};

type ScriptButtonCategory = {
  id: string;
  name: string;
  sortOrder: number;
  buttons: ScriptButton[];
};

type ScriptButtonLibrary = {
  categories: ScriptButtonCategory[];
};

type SecurityStatus = {
  enabled: boolean;
  unlocked: boolean;
};


/* Export / import (electron/transfer.ts). Passwords never cross into the renderer. */
export type TransferFolder = { id: string; name: string; hostCount: number; folders: TransferFolder[] };

export type TransferExportSources = {
  folders: TransferFolder[];
  hasPasswords: boolean;
  scriptCategories: { id: string; name: string; buttonCount: number }[];
  environmentCount: number;
  knownHostCount: number;
};

export type TransferExportSelection = {
  connections: boolean;
  /** Omitted = all folders. */
  folderIds?: string[];
  includePasswords: boolean;
  scriptCategoryIds: string[];
  environments: boolean;
  settings: boolean;
  knownHosts: boolean;
};

export type TransferExportResult = {
  canceled: boolean;
  filePath?: string;
  hostCount?: number;
  includesPasswords?: boolean;
  scriptButtonCount?: number;
  environmentCount?: number;
  settings?: boolean;
  knownHostCount?: number;
};

export type TransferImportKind = "shellium" | "csv" | "xml";

export type TransferImportSummary = {
  kind: TransferImportKind;
  exportedAt?: string;
  connections: { hostCount: number; includesPasswords: boolean; folders: TransferFolder[] } | null;
  scriptCategories: { id: string; name: string; buttonCount: number }[] | null;
  environments: { name: string; badge: string; color: string }[];
  settings: boolean;
  knownHostCount: number;
  /** Rows / entries left out: CSV by line, XML by folder and name. */
  issues: { line?: number; where?: string; message: string }[];
};

/** Shellium fields the mapping step fills from the file's fields. */
export type TransferMappingTarget = "name" | "host" | "port" | "username" | "description" | "tags" | "environment" | "protocol" | "folder";

/** An XML file (or a CSV with unrecognized columns) before the mapping step. */
export type TransferMappingInfo = {
  recordCount: number;
  /** The file has a folder structure of its own (XML). */
  folderFromTree: boolean;
  hasFolders: boolean;
  fields: { key: string; filled: number; samples: string[] }[];
  suggested: Partial<Record<TransferMappingTarget, string>>;
};

export type TransferFieldMapping = Partial<Record<Exclude<TransferMappingTarget, "folder">, string>> & {
  /** "#tree" = the file's folders, "" = none, else a field holding "A/B". */
  folder: string;
  defaultUsername: string;
};

export type TransferOpenResult =
  | { canceled: true }
  | { canceled: false; token: string; kind: TransferImportKind; fileName: string; needsPassword: boolean; summary?: TransferImportSummary; mapping?: TransferMappingInfo };

export type TransferImportSelection = {
  connections: boolean;
  folderIds?: string[];
  scriptCategoryIds: string[];
  environments: boolean;
  settings: boolean;
  knownHosts: boolean;
  mode: "merge" | "replace";
  targetFolderId?: string | null;
};

export type TransferConflictDecision = "skip" | "update";

type KnownHostsMergeCounts = { added: number; alreadyKnown: number; conflicts: number };

export type TransferImportPreview = {
  mode: "merge" | "replace";
  /** What "Update from the file" changes on a host that is already here. */
  hostUpdates: ("name" | "description" | "tags" | "environment" | "options" | "password")[];
  hosts: {
    new: number;
    unchanged: number;
    duplicatesInFile: number;
    replacedCount: number;
    conflicts: { name: string; hostname: string; port: number; username: string; existingName: string; existingPath: string; importedPath: string; differences: string[] }[];
  };
  scripts: { new: number; unchanged: number; replacedCount: number; conflicts: { category: string; label: string }[] };
  newEnvironments: string[];
  knownHosts: KnownHostsMergeCounts | null;
  settings: boolean;
};

export type TransferImportResult = {
  hostsAdded: number;
  hostsUpdated: number;
  hostsSkipped: number;
  scriptsAdded: number;
  scriptsUpdated: number;
  scriptsSkipped: number;
  environmentsAdded: string[];
  knownHosts: KnownHostsMergeCounts | null;
  settings: { appOptions?: unknown };
};

declare global {
  interface Window {
    shellium?: {
      app: {
        /** process.platform of the main process: "win32", "darwin", "linux". */
        platform: string;
        /** Runtime versions for Help > About. */
        versions: { electron: string; chrome: string; node: string; arch: string };
        setZoomFactor(factor: number): void;
        edit(command: "cut" | "copy" | "paste" | "selectAll"): void;
        onShortcut(callback: (shortcut: "connect") => void): () => void;
        onCloseRequest(callback: () => void): () => void;
        confirmClose(): Promise<void>;
        openExternal(url: string): Promise<void>;
        requestAttention(): void;
        focusWindow(): void;
      };
      security: {
        status(): Promise<SecurityStatus>;
        setup(password: string): Promise<SecurityStatus>;
        unlock(password: string): Promise<SecurityStatus>;
        lock(): Promise<SecurityStatus>;
      };
      settings: {
        get(): Promise<{
          dataDirectory: string;
          settings: {
            appOptions?: unknown;
            palette?: { treeWidth?: number; frame?: { left?: number; top?: number; width?: number; height?: number }; expandedFolderIds?: string[] };
          };
        }>;
        saveAppOptions(options: unknown): Promise<void>;
        savePaletteTreeWidth(treeWidth: number): Promise<void>;
        savePaletteFrame(frame: { left?: number; top?: number; width?: number; height?: number }): Promise<void>;
        savePaletteExpandedFolders(expandedFolderIds: string[]): Promise<void>;
        chooseDataDirectory(): Promise<{
          canceled: boolean;
          dataDirectory: string;
          settings: {
            appOptions?: unknown;
            palette?: { treeWidth?: number; frame?: { left?: number; top?: number; width?: number; height?: number }; expandedFolderIds?: string[] };
          };
        }>;
        chooseXServerExecutable(): Promise<{ canceled: boolean; filePath?: string }>;
        chooseTerminalRecordingDirectory(currentPath?: string): Promise<{ canceled: boolean; filePath?: string }>;
      };
      clipboard: {
        readText(): Promise<string>;
        writeText(text: string): Promise<void>;
      };
      connections: {
        list(): Promise<Folder[]>;
        save(folders: Folder[]): Promise<Folder[]>;
      };
      scriptButtons: {
        list(): Promise<ScriptButtonLibrary>;
        save(library: ScriptButtonLibrary): Promise<ScriptButtonLibrary>;
      };
      transfer: {
        exportSources(): Promise<TransferExportSources>;
        exportFile(selection: TransferExportSelection, passphrase: string): Promise<TransferExportResult>;
        exportCsv(folderIds: string[] | undefined, delimiter: "," | ";"): Promise<{ canceled: boolean; filePath?: string; hostCount?: number }>;
        openImport(): Promise<TransferOpenResult>;
        unlockImport(token: string, passphrase: string): Promise<TransferImportSummary>;
        mapImport(token: string, mapping: TransferFieldMapping): Promise<TransferImportSummary>;
        previewImport(token: string, selection: TransferImportSelection): Promise<TransferImportPreview>;
        applyImport(token: string, selection: TransferImportSelection, decisions: { hosts: TransferConflictDecision; scripts: TransferConflictDecision }): Promise<TransferImportResult>;
        undoImport(): Promise<{ settings: { appOptions?: unknown } }>;
        discard(token?: string): Promise<void>;
      };
      knownHosts: {
        list(): Promise<KnownHostListItem[]>;
        remove(id: string): Promise<boolean>;
        importOpenSsh(): Promise<OpenSshImportResult>;
      };
      connectionPrompt: {
        onAsk(callback: (prompt: ConnectionPrompt) => void): () => void;
        onCancel(callback: (requestId: string) => void): () => void;
        respond(requestId: string, decision: ConnectionPromptDecision): Promise<void>;
      };
      terminal: {
        connect(request: TerminalConnectRequest): Promise<void>;
        info(sessionId: string): Promise<{
          term: string;
          connectedAt?: number;
          bytesIn: number;
          bytesOut: number;
          latencyMs?: number;
          serverSoftware?: string;
          kex?: string;
          cipher?: string;
          mac?: string;
          compression?: string;
          hostKeyType?: string;
          hostKeyFingerprint?: string;
        } | null>;
        write(sessionId: string, data: string): void;
        sendScript(sessionId: string, parts: Array<{ kind: "text"; value: string } | { kind: "pause" }>): Promise<void>;
        resize(sessionId: string, cols: number, rows: number): Promise<void>;
        disconnect(sessionId: string): Promise<void>;
        saveTranscript(request: { title?: string; transcript: string }): Promise<{ canceled: boolean; filePath?: string }>;
        startRecording(request: { sessionId: string; title?: string; directoryPath?: string }): Promise<{ canceled: boolean; active: boolean; filePath?: string }>;
        stopRecording(sessionId: string): Promise<{ active: boolean; filePath?: string }>;
        onData(callback: (payload: TerminalDataPayload) => void): () => void;
        onExit(callback: (payload: TerminalExitPayload) => void): () => void;
        protectProbe(sessionId: string): Promise<ProtectionProbe>;
        protectStart(sessionId: string, target: SessionProtection, adopt: boolean): Promise<SessionProtection>;
        protectState(sessionId: string): Promise<{ alive: boolean; running: string | null }>;
        protectStop(sessionId: string): Promise<void>;
        protectionName(sessionId: string): Promise<string>;
        onProtection(callback: (payload: TerminalProtectionPayload) => void): () => void;
      };
      sftp: {
        connect(request: SftpConnectRequest): Promise<{ cwd: string }>;
        list(sessionId: string, remotePath?: string): Promise<SftpListResult>;
        disconnect(sessionId: string): Promise<void>;
        mkdir(sessionId: string, remoteDirectory: string, folderName: string): Promise<{ path: string }>;
        rename(sessionId: string, remotePath: string, newName: string): Promise<{ path: string }>;
        enqueue(sessionId: string, direction: "upload" | "download", sources: string[], targetDir: string): Promise<{ jobId: string }>;
        pickAndUpload(sessionId: string, targetDir: string, folders: boolean): Promise<{ canceled: boolean; jobId?: string }>;
        resolveConflicts(jobId: string, decision: SftpConflictDecision): Promise<void>;
        cancelJob(jobId: string): Promise<void>;
        pauseJob(jobId: string): Promise<void>;
        /** Rejects with "SFTP session is not connected" when the connection was lost: connect, then ask again. */
        resumeJob(jobId: string): Promise<void>;
        clearFinishedJobs(sessionId: string): Promise<void>;
        listJobs(sessionId: string): Promise<SftpJob[]>;
        onJobs(callback: (payload: { sessionId: string; jobs: SftpJob[] }) => void): () => void;
        inspect(sessionId: string, remotePaths: string[]): Promise<{ files: number; folders: number; bytes: number }>;
        deletePaths(sessionId: string, remotePaths: string[]): Promise<{ deleted: number }>;
        chmod(sessionId: string, remotePaths: string[], mode: number): Promise<void>;
        editStart(sessionId: string, remotePath: string): Promise<SftpEdit>;
        editUpload(editId: string, force: boolean): Promise<SftpEdit>;
        editStop(editId: string): Promise<void>;
        editList(sessionId: string): Promise<SftpEdit[]>;
        onEdit(callback: (edit: SftpEdit) => void): () => void;
        pathForFile(file: File): string;
      };
      localFiles: {
        list(localPath?: string): Promise<LocalFileListResult>;
        chooseDirectory(): Promise<{ canceled: boolean; filePath?: string }>;
        /** Drives / volumes and the home, desktop, documents and downloads folders. */
        places(): Promise<{ places: LocalPlace[]; drives: LocalDrive[] }>;
      };
    };
  }
}

export {};
