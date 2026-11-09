import { randomBytes, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { WebContents } from "electron";
import {
  SftpTransferCanceledError,
  getSftpSessionOrNull,
  getSftpEntryType,
  getSftpSession,
  joinRemotePath,
  onSftpSessionClosed,
  readRemoteDirectory,
  transferStream,
} from "./terminalSsh";
import type { SftpClient, SftpFileAttributes, SftpTransferController } from "./terminalSsh";

/**
 * SFTP transfer queue, conflict handling, recursive delete, chmod and editing remote files.
 *
 * Every upload / download is a job. A job is planned first - folders expanded, existing targets
 * found - and waits for the user's decision when something would be overwritten. Jobs of a session
 * run one at a time over its SFTP channel.
 *
 * Safety (production servers):
 * - An upload goes to a temporary name in the target folder and is renamed into place only when
 *   complete, so a failed or canceled upload never damages the existing file. Overwriting keeps the
 *   old file's permissions and, by default, the old file itself as name.bak-<timestamp>.
 * - Downloads land in a temporary local file first too; names from the server are sanitized for
 *   the local file system and can't leave the target folder.
 *
 * Pause / resume: a paused job keeps the temporary file of the file it was on and continues from its
 * size - after checking that the source did not change and that the last 64 KB of the temporary
 * file match the source; otherwise that file starts over. A dropped connection pauses the session's
 * jobs the same way (Start reconnects and continues); closing the SFTP view cancels them.
 */

const require = createRequire(import.meta.url);
const { app, dialog, ipcMain, shell } = require("electron") as typeof import("electron");

export type SftpJobDirection = "upload" | "download";
export type SftpJobStatus = "planning" | "conflicts" | "queued" | "running" | "paused" | "done" | "error" | "canceled";
export type SftpConflictAction = "overwrite" | "rename" | "skip";

export type SftpConflict = {
  id: string;
  /** Path relative to the job's target folder, e.g. "logs/alert.log". */
  relativePath: string;
  existing: { size: number; modifiedAt: number };
  incoming: { size: number; modifiedAt: number };
};

export type SftpJob = {
  id: string;
  sessionId: string;
  direction: SftpJobDirection;
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
  /** Remote uploads: whether overwritten files are kept as name.bak-<timestamp>. */
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

type PlanItem = {
  kind: "file" | "dir";
  source: string;
  relativePath: string;
  size: number;
  modifiedAt: number;
  conflictId?: string;
};

/** Temporary file of the item a job stopped on, kept so the item can continue where it stopped. */
type PartialFile = {
  index: number;
  temp: string;
  finalPath: string;
};

type JobState = {
  job: SftpJob;
  sender: WebContents;
  sources: string[];
  items: PlanItem[];
  decision?: SftpConflictDecision;
  controller?: SftpTransferController;
  canceled: boolean;
  resolveDecision?: () => void;
  /** Planned and conflicts decided: a resumed job continues at nextItem instead of planning again. */
  planned: boolean;
  nextItem: number;
  finishedBytes: number;
  partial?: PartialFile;
  pauseRequested: boolean;
  pauseReason?: string;
  samples: Array<{ at: number; bytes: number }>;
};

const jobs = new Map<string, JobState>();
const runningSessions = new Set<string>();
const lastPublished = new Map<string, number>();
const MAX_EDIT_BYTES = 50 * 1024 * 1024;
const TAIL_CHECK_BYTES = 64 * 1024;
const LOST_MESSAGE = "Connection lost - Start reconnects and continues";

// -------------------------------------------------------------------------------------------------
// Registration

export function registerSftpJobHandlers() {
  onSftpSessionClosed(async (sessionId, reason, sftp) => {
    const open = [...jobs.values()].filter((state) => state.job.sessionId === sessionId && !isFinished(state.job.status));
    if (reason === "lost") {
      // Nothing is thrown away: transfers pause with their temporary files, edited copies stay.
      open.forEach((state) => pauseJobState(state, LOST_MESSAGE));
      return;
    }
    await Promise.all(open.map((state) => cancelJobState(state, "Connection closed", sftp)));
    await stopEditsForSession(sessionId);
  });
  app.on("will-quit", () => {
    removeEditRoot();
    removeLocalPartials();
  });

  ipcMain.handle("sftp:enqueue", (event, sessionId: unknown, direction: unknown, sources: unknown, targetDir: unknown) => {
    if (typeof sessionId !== "string" || (direction !== "upload" && direction !== "download")
        || !Array.isArray(sources) || typeof targetDir !== "string" || !targetDir) {
      throw new Error("Invalid transfer request.");
    }
    const paths = sources.filter((source): source is string => typeof source === "string" && source.length > 0);
    if (paths.length === 0) {
      throw new Error("Nothing to transfer.");
    }
    getSftpSession(sessionId);
    return { jobId: enqueue(event.sender, sessionId, direction, paths, targetDir) };
  });

  ipcMain.handle("sftp:pickAndUpload", async (event, sessionId: unknown, targetDir: unknown, folders: unknown) => {
    if (typeof sessionId !== "string" || typeof targetDir !== "string") {
      throw new Error("Invalid upload request.");
    }
    getSftpSession(sessionId);
    const result = await dialog.showOpenDialog({
      title: folders === true ? "Upload folders" : "Upload files",
      properties: folders === true ? ["openDirectory", "multiSelections"] : ["openFile", "multiSelections"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    return { canceled: false, jobId: enqueue(event.sender, sessionId, "upload", result.filePaths, targetDir) };
  });

  ipcMain.handle("sftp:resolveConflicts", (_event, jobId: unknown, decision: unknown) => {
    const state = typeof jobId === "string" ? jobs.get(jobId) : undefined;
    if (!state || state.job.status !== "conflicts") {
      throw new Error("That transfer is not waiting for a decision.");
    }
    state.decision = parseDecision(decision);
    state.resolveDecision?.();
  });

  ipcMain.handle("sftp:cancelJob", async (_event, jobId: unknown) => {
    const state = typeof jobId === "string" ? jobs.get(jobId) : undefined;
    if (state && !isFinished(state.job.status)) {
      await cancelJobState(state, "Canceled");
    }
  });

  ipcMain.handle("sftp:pauseJob", (_event, jobId: unknown) => {
    const state = typeof jobId === "string" ? jobs.get(jobId) : undefined;
    if (state && ["queued", "planning", "running"].includes(state.job.status)) {
      pauseJobState(state, "Paused");
    }
  });

  ipcMain.handle("sftp:resumeJob", (_event, jobId: unknown) => {
    const state = typeof jobId === "string" ? jobs.get(jobId) : undefined;
    if (!state || state.job.status !== "paused") {
      throw new Error("That transfer is not paused.");
    }
    getSftpSession(state.job.sessionId); // "not connected" -> the window reconnects and asks again
    state.pauseRequested = false;
    state.pauseReason = undefined;
    state.job.pausedBy = undefined;
    state.job.status = "queued";
    state.job.message = "Waiting for the transfer before it";
    publish(state.sender, state.job.sessionId, true);
    pump(state.job.sessionId);
  });

  ipcMain.handle("sftp:clearFinishedJobs", (event, sessionId: unknown) => {
    for (const [id, state] of jobs) {
      if (state.job.sessionId === sessionId && isFinished(state.job.status)) {
        jobs.delete(id);
      }
    }
    publish(event.sender, String(sessionId), true);
  });

  ipcMain.handle("sftp:listJobs", (_event, sessionId: unknown) => sessionJobs(String(sessionId)));

  ipcMain.handle("sftp:inspect", async (_event, sessionId: unknown, remotePaths: unknown) => {
    const session = getSftpSession(String(sessionId));
    return inspectRemote(session.sftp, stringList(remotePaths));
  });

  ipcMain.handle("sftp:deletePaths", async (_event, sessionId: unknown, remotePaths: unknown) => {
    const session = getSftpSession(String(sessionId));
    let deleted = 0;
    for (const remotePath of stringList(remotePaths)) {
      requireDeletable(remotePath);
      deleted += await deleteRemoteTree(session.sftp, remotePath);
    }
    return { deleted };
  });

  ipcMain.handle("sftp:chmod", async (_event, sessionId: unknown, remotePaths: unknown, mode: unknown) => {
    const session = getSftpSession(String(sessionId));
    if (typeof mode !== "number" || !Number.isInteger(mode) || mode < 0 || mode > 0o7777) {
      throw new Error("Invalid permissions.");
    }
    for (const remotePath of stringList(remotePaths)) {
      await call((cb) => session.sftp.chmod(remotePath, mode, cb), "SFTP chmod error");
    }
  });

  ipcMain.handle("sftp:editStart", async (event, sessionId: unknown, remotePath: unknown) => {
    if (typeof sessionId !== "string" || typeof remotePath !== "string") {
      throw new Error("Invalid edit request.");
    }
    return startEdit(event.sender, sessionId, remotePath);
  });

  ipcMain.handle("sftp:editUpload", async (_event, editId: unknown, force: unknown) => {
    const edit = typeof editId === "string" ? edits.get(editId) : undefined;
    if (!edit) {
      throw new Error("That file is no longer open for editing.");
    }
    return uploadEdit(edit, force === true);
  });

  ipcMain.handle("sftp:editStop", async (_event, editId: unknown) => {
    const edit = typeof editId === "string" ? edits.get(editId) : undefined;
    if (edit) {
      await stopEdit(edit);
    }
  });

  ipcMain.handle("sftp:editList", (_event, sessionId: unknown) =>
    [...edits.values()].filter((edit) => edit.sessionId === sessionId).map(editView));
}

// -------------------------------------------------------------------------------------------------
// Queue

function enqueue(sender: WebContents, sessionId: string, direction: SftpJobDirection, sources: string[], targetDir: string) {
  const id = randomUUID();
  const first = direction === "upload" ? path.basename(sources[0]) : path.posix.basename(sources[0]);
  const job: SftpJob = {
    id,
    sessionId,
    direction,
    label: sources.length === 1 ? first : `${first} and ${sources.length - 1} more`,
    targetDir,
    // Jobs of one session run one after another; "planning" starts when this one's turn comes.
    status: "queued",
    message: "Waiting for the transfer before it",
    totalFiles: 0,
    doneFiles: 0,
    skippedFiles: 0,
    totalBytes: 0,
    transferredBytes: 0,
    conflicts: [],
    backupDefault: direction === "upload",
    createdAt: Date.now(),
  };
  jobs.set(id, {
    job, sender, sources, items: [], canceled: false,
    planned: false, nextItem: 0, finishedBytes: 0, pauseRequested: false, samples: [],
  });
  publish(sender, sessionId, true);
  pump(sessionId);
  return id;
}

/** Runs the session's jobs one after another; a job waiting for a decision holds the queue. */
async function pump(sessionId: string) {
  if (runningSessions.has(sessionId)) {
    return;
  }
  runningSessions.add(sessionId);
  try {
    for (;;) {
      const next = [...jobs.values()]
        .filter((state) => state.job.sessionId === sessionId && (state.job.status === "planning" || state.job.status === "queued"))
        .sort((a, b) => a.job.createdAt - b.job.createdAt)[0];
      if (!next) {
        break;
      }
      await runJob(next);
    }
  } finally {
    runningSessions.delete(sessionId);
  }
}

async function runJob(state: JobState) {
  const { job } = state;
  let sftp: SftpClient | undefined;
  try {
    sftp = getSftpSession(job.sessionId).sftp;
    if (!state.planned) {
      job.status = "planning";
      job.message = "Checking files...";
      publish(state.sender, job.sessionId, true);
      state.items = job.direction === "upload"
        ? await planUpload(sftp, state.sources, job.targetDir)
        : await planDownload(sftp, state.sources, job.targetDir);
      if (state.canceled || state.pauseRequested) {
        return;
      }
      const files = state.items.filter((item) => item.kind === "file");
      job.totalFiles = files.length;
      job.totalBytes = files.reduce((sum, item) => sum + item.size, 0);
      job.doneFiles = 0;
      job.skippedFiles = 0;
      job.transferredBytes = 0;
      state.nextItem = 0;
      state.finishedBytes = 0;

      const conflicts = job.direction === "upload"
        ? await findRemoteConflicts(sftp, state.items, job.targetDir)
        : await findLocalConflicts(state.items, job.targetDir);
      job.conflicts = conflicts;
      if (conflicts.length > 0) {
        job.status = "conflicts";
        job.message = `${conflicts.length} file${conflicts.length === 1 ? "" : "s"} already exist${conflicts.length === 1 ? "s" : ""}`;
        publish(state.sender, job.sessionId, true);
        await new Promise<void>((resolve) => {
          state.resolveDecision = resolve;
        });
        state.resolveDecision = undefined;
        if (state.canceled || state.pauseRequested) {
          return;
        }
      }
      state.planned = true;
    }

    job.status = "running";
    job.startedAt = job.startedAt ?? Date.now();
    job.message = undefined;
    state.samples = [];
    publish(state.sender, job.sessionId, true);
    if (job.direction === "upload") {
      await executeUpload(state, sftp);
    } else {
      await executeDownload(state, sftp);
    }
    if (state.canceled || state.pauseRequested) {
      return;
    }
    job.status = "done";
    job.currentFile = undefined;
    job.message = summary(job);
  } catch (error) {
    if (!state.canceled && !state.pauseRequested && await connectionLost(job.sessionId, sftp)) {
      state.pauseRequested = true;
      state.pauseReason = LOST_MESSAGE;
    }
    if (state.pauseRequested && !state.canceled) {
      // ends as paused below
    } else if (state.canceled || error instanceof SftpTransferCanceledError) {
      job.status = "canceled";
      job.message = job.message ?? "Canceled";
    } else {
      job.status = "error";
      job.message = error instanceof Error ? error.message : String(error);
    }
  } finally {
    job.bytesPerSecond = undefined;
    if (state.pauseRequested && !state.canceled && !isFinished(job.status)) {
      job.status = "paused";
      job.message = state.pauseReason ?? "Paused";
      job.pausedBy = state.pauseReason === LOST_MESSAGE ? "connection" : "user";
    } else {
      job.finishedAt = job.finishedAt ?? Date.now();
      if (!isFinished(job.status)) {
        job.status = "canceled";
      }
    }
    publish(state.sender, job.sessionId, true);
  }
}

/** Queued: paused at once. Planning / deciding / running: runJob stops at the next step and ends as paused. */
function pauseJobState(state: JobState, reason: string) {
  const { job } = state;
  if (isFinished(job.status) || job.status === "paused") {
    if (job.status === "paused" && reason === LOST_MESSAGE) {
      job.message = reason;
      publish(state.sender, job.sessionId, true);
    }
    return;
  }
  state.pauseRequested = true;
  state.pauseReason = reason;
  if (job.status === "queued") {
    job.status = "paused";
    job.message = reason;
    job.pausedBy = reason === LOST_MESSAGE ? "connection" : "user";
    publish(state.sender, job.sessionId, true);
    return;
  }
  if (job.status === "conflicts") {
    state.planned = false; // decided again after resuming: the files may have changed meanwhile
  }
  state.controller?.cancel();
  state.resolveDecision?.();
}

async function cancelJobState(state: JobState, message: string, sftp?: SftpClient) {
  const wasPaused = state.job.status === "paused";
  state.canceled = true;
  state.job.status = "canceled";
  state.job.message = message;
  state.job.finishedAt = Date.now();
  state.controller?.cancel();
  state.resolveDecision?.();
  publish(state.sender, state.job.sessionId, true);
  // A running job removes its temporary file itself; a paused one has none running.
  if (wasPaused && state.partial) {
    const partial = state.partial;
    state.partial = undefined;
    if (state.job.direction === "download") {
      await fs.rm(partial.temp, { force: true }).catch(() => undefined);
      return;
    }
    const channel = sftp ?? getSftpSessionOrNull(state.job.sessionId)?.sftp;
    const removed = channel ? await call((cb) => channel.unlink(partial.temp, cb), "").then(() => true, () => false) : false;
    if (!removed) {
      state.job.message = `${message} - temporary file left on the server: ${partial.temp}`;
      publish(state.sender, state.job.sessionId, true);
    }
  }
}

/** True when the job's SFTP channel is gone or was replaced (waits briefly for the close event). */
async function connectionLost(sessionId: string, sftp: SftpClient | undefined) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = getSftpSessionOrNull(sessionId);
    if (!current || current.sftp !== sftp) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

/** Whether to keep the temporary file of a transfer that just stopped (pause / lost connection). */
async function keepPartial(state: JobState, sftp: SftpClient) {
  if (state.canceled) {
    return false;
  }
  if (!state.pauseRequested && await connectionLost(state.job.sessionId, sftp)) {
    state.pauseRequested = true;
    state.pauseReason = LOST_MESSAGE;
  }
  return state.pauseRequested;
}

function reportProgress(state: JobState, fileBytes: number) {
  const { job } = state;
  job.transferredBytes = state.finishedBytes + fileBytes;
  const now = Date.now();
  state.samples.push({ at: now, bytes: job.transferredBytes });
  while (state.samples.length > 2 && now - state.samples[0].at > 5000) {
    state.samples.shift();
  }
  const first = state.samples[0];
  if (now - first.at >= 500) {
    job.bytesPerSecond = (job.transferredBytes - first.bytes) / ((now - first.at) / 1000);
  }
  if (jobs.has(job.id)) {
    publish(state.sender, job.sessionId);
  }
}

function removeLocalPartials() {
  for (const state of jobs.values()) {
    if (state.job.direction === "download" && state.partial) {
      try {
        require("node:fs").rmSync(state.partial.temp, { force: true });
      } catch {
        // best effort on quit
      }
    }
  }
}

function summary(job: SftpJob) {
  const verb = job.direction === "upload" ? "Uploaded" : "Downloaded";
  const done = `${verb} ${job.doneFiles} file${job.doneFiles === 1 ? "" : "s"}`;
  return job.skippedFiles > 0 ? `${done}, skipped ${job.skippedFiles}` : done;
}

function isFinished(status: SftpJobStatus) {
  return status === "done" || status === "error" || status === "canceled";
}

function sessionJobs(sessionId: string): SftpJob[] {
  return [...jobs.values()]
    .filter((state) => state.job.sessionId === sessionId)
    .map((state) => ({ ...state.job, conflicts: state.job.conflicts.slice(0, 500) }))
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Sends the session's queue to the window; progress updates are throttled. */
function publish(sender: WebContents, sessionId: string, force = false) {
  const now = Date.now();
  if (!force && now - (lastPublished.get(sessionId) ?? 0) < 150) {
    return;
  }
  lastPublished.set(sessionId, now);
  if (!sender.isDestroyed()) {
    sender.send("sftp:jobs", { sessionId, jobs: sessionJobs(sessionId) });
  }
}

// -------------------------------------------------------------------------------------------------
// Planning

async function planUpload(sftp: SftpClient, sources: string[], targetDir: string): Promise<PlanItem[]> {
  void sftp;
  void targetDir;
  const items: PlanItem[] = [];
  const walk = async (localPath: string, relativePath: string) => {
    const stats = await fs.lstat(localPath);
    if (stats.isSymbolicLink()) {
      const target = await fs.stat(localPath).catch(() => null);
      if (target?.isFile()) {
        items.push({ kind: "file", source: localPath, relativePath, size: target.size, modifiedAt: target.mtimeMs });
      }
      return; // linked folders are not followed (loops)
    }
    if (stats.isDirectory()) {
      items.push({ kind: "dir", source: localPath, relativePath, size: 0, modifiedAt: stats.mtimeMs });
      for (const name of (await fs.readdir(localPath)).sort()) {
        await walk(path.join(localPath, name), `${relativePath}/${name}`);
      }
    } else if (stats.isFile()) {
      items.push({ kind: "file", source: localPath, relativePath, size: stats.size, modifiedAt: stats.mtimeMs });
    }
  };
  for (const source of sources) {
    await walk(source, path.basename(source));
  }
  return items;
}

async function planDownload(sftp: SftpClient, sources: string[], targetDir: string): Promise<PlanItem[]> {
  void targetDir;
  const items: PlanItem[] = [];
  const walk = async (remotePath: string, relativePath: string, attrs: SftpFileAttributes) => {
    let type = getSftpEntryType(attrs);
    let resolved = attrs;
    if (type === "symlink") {
      resolved = await stat(sftp, remotePath).catch(() => attrs);
      type = getSftpEntryType(resolved);
      if (type === "directory") {
        return; // linked folders are not followed (loops)
      }
    }
    if (type === "directory") {
      items.push({ kind: "dir", source: remotePath, relativePath, size: 0, modifiedAt: resolved.mtime * 1000 });
      for (const entry of await readRemoteDirectory(sftp, remotePath)) {
        await walk(entry.path, `${relativePath}/${safeLocalName(entry.name)}`, await lstat(sftp, entry.path));
      }
    } else if (type === "file") {
      items.push({ kind: "file", source: remotePath, relativePath, size: resolved.size, modifiedAt: resolved.mtime * 1000 });
    }
  };
  for (const source of sources) {
    await walk(source, safeLocalName(path.posix.basename(source)), await lstat(sftp, source));
  }
  return items;
}

async function findRemoteConflicts(sftp: SftpClient, items: PlanItem[], targetDir: string): Promise<SftpConflict[]> {
  const conflicts: SftpConflict[] = [];
  for (const item of items) {
    const existing = await stat(sftp, joinRemotePath(targetDir, item.relativePath)).catch(() => null);
    if (!existing) {
      continue;
    }
    const existingType = getSftpEntryType(existing);
    if (item.kind === "dir") {
      if (existingType !== "directory") {
        throw new Error(`${item.relativePath} exists on the server as a file - a folder can't be uploaded over it.`);
      }
      continue; // folders merge
    }
    if (existingType === "directory") {
      throw new Error(`${item.relativePath} exists on the server as a folder - a file can't be uploaded over it.`);
    }
    item.conflictId = randomUUID();
    conflicts.push({ id: item.conflictId, relativePath: item.relativePath,
      existing: { size: existing.size, modifiedAt: existing.mtime * 1000 },
      incoming: { size: item.size, modifiedAt: item.modifiedAt } });
  }
  return conflicts;
}

async function findLocalConflicts(items: PlanItem[], targetDir: string): Promise<SftpConflict[]> {
  const conflicts: SftpConflict[] = [];
  for (const item of items) {
    const existing = await fs.stat(localTarget(targetDir, item.relativePath)).catch(() => null);
    if (!existing) {
      continue;
    }
    if (item.kind === "dir") {
      if (!existing.isDirectory()) {
        throw new Error(`${item.relativePath} exists here as a file - a folder can't be downloaded over it.`);
      }
      continue;
    }
    if (existing.isDirectory()) {
      throw new Error(`${item.relativePath} exists here as a folder - a file can't be downloaded over it.`);
    }
    item.conflictId = randomUUID();
    conflicts.push({ id: item.conflictId, relativePath: item.relativePath,
      existing: { size: existing.size, modifiedAt: existing.mtimeMs },
      incoming: { size: item.size, modifiedAt: item.modifiedAt } });
  }
  return conflicts;
}

function actionFor(state: JobState, item: PlanItem): SftpConflictAction | null {
  if (!item.conflictId) {
    return null;
  }
  return state.decision?.perItem?.[item.conflictId] ?? state.decision?.defaultAction ?? "skip";
}

// -------------------------------------------------------------------------------------------------
// Execution

async function executeUpload(state: JobState, sftp: SftpClient) {
  const { job } = state;
  const backup = state.decision?.backup ?? job.backupDefault;
  for (; state.nextItem < state.items.length; state.nextItem += 1) {
    if (state.canceled || state.pauseRequested) {
      return;
    }
    const item = state.items[state.nextItem];
    const target = joinRemotePath(job.targetDir, item.relativePath);
    if (item.kind === "dir") {
      if (!(await stat(sftp, target).catch(() => null))) {
        await call((cb) => sftp.mkdir(target, cb), "SFTP mkdir error");
      }
      continue;
    }
    const action = actionFor(state, item);
    if (action === "skip") {
      job.skippedFiles += 1;
      state.finishedBytes += item.size;
      job.transferredBytes = state.finishedBytes;
      continue;
    }
    const resume = state.partial?.index === state.nextItem ? state.partial : undefined;
    const finalPath = resume?.finalPath ?? (action === "rename" ? await uniqueRemoteName(sftp, target) : target);
    job.currentFile = item.relativePath;
    publish(state.sender, job.sessionId, true);
    await safeUpload(state, sftp, item, finalPath, action === "overwrite", backup);
    state.finishedBytes += item.size;
    job.transferredBytes = state.finishedBytes;
    job.doneFiles += 1;
  }
}

/**
 * Upload to a temporary name next to the target, then move it into place. On overwrite the
 * existing file is renamed to a backup (or removed) only after the new content arrived completely,
 * and its permission bits are carried over (new files get 0644). A kept temporary file of this item
 * (paused / lost connection) is continued from its size when it still matches the local file.
 */
async function safeUpload(
  state: JobState, sftp: SftpClient, item: PlanItem, remotePath: string, overwrite: boolean, backup: boolean,
) {
  const localPath = item.source;
  const size = (await fs.stat(localPath)).size;
  let partial = state.partial?.index === state.nextItem ? state.partial : undefined;
  let offset = 0;
  if (partial) {
    offset = await uploadResumeOffset(sftp, item, partial.temp);
    if (offset === 0 && await connectionLost(state.job.sessionId, sftp)) {
      throw new Error("SFTP upload error: connection lost"); // keep the temporary file for the next Start
    }
    if (offset === 0) {
      const stale = partial.temp;
      await call((cb) => sftp.unlink(stale, cb), "").catch(() => undefined);
      partial = undefined;
    }
  }
  if (!partial) {
    const name = path.posix.basename(remotePath);
    partial = {
      index: state.nextItem,
      temp: joinRemotePath(path.posix.dirname(remotePath), `.${name}.shellium-${randomBytes(4).toString("hex")}.part`),
      finalPath: remotePath,
    };
  }
  state.partial = partial;
  const temp = partial.temp;
  state.controller = { canceled: false, cancel() { this.canceled = true; } };
  try {
    reportProgress(state, offset);
    await transferStream(
      createReadStream(localPath, { start: offset }),
      offset > 0 ? sftp.createWriteStream(temp, { flags: "r+", start: offset }) : sftp.createWriteStream(temp, { mode: 0o600 }),
      size - offset, (progress) => reportProgress(state, offset + progress.transferredBytes), "SFTP upload error", state.controller);
  } catch (error) {
    if (!(await keepPartial(state, sftp))) {
      state.partial = undefined;
      await call((cb) => sftp.unlink(temp, cb), "").catch(() => undefined);
    }
    throw error;
  } finally {
    state.controller = undefined;
  }
  state.partial = undefined;

  try {
    const existing = overwrite ? await stat(sftp, remotePath).catch(() => null) : null;
    if (existing) {
      if (backup) {
        await call((cb) => sftp.rename(remotePath, backupName(remotePath), cb), "Could not keep a backup of the existing file");
      } else {
        await call((cb) => sftp.unlink(remotePath, cb), "Could not replace the existing file");
      }
    }
    await call((cb) => sftp.rename(temp, remotePath, cb), "SFTP rename error");
    // The temporary file is private (0600) while it is written; a new file then gets the usual 0644.
    await call((cb) => sftp.chmod(remotePath, existing ? existing.mode & 0o7777 : 0o644, cb), "").catch(() => undefined);
  } catch (error) {
    await call((cb) => sftp.unlink(temp, cb), "").catch(() => undefined);
    throw error;
  }
}

async function executeDownload(state: JobState, sftp: SftpClient) {
  const { job } = state;
  await fs.mkdir(job.targetDir, { recursive: true });
  for (; state.nextItem < state.items.length; state.nextItem += 1) {
    if (state.canceled || state.pauseRequested) {
      return;
    }
    const item = state.items[state.nextItem];
    const target = localTarget(job.targetDir, item.relativePath);
    if (item.kind === "dir") {
      await fs.mkdir(target, { recursive: true });
      continue;
    }
    const action = actionFor(state, item);
    if (action === "skip") {
      job.skippedFiles += 1;
      state.finishedBytes += item.size;
      job.transferredBytes = state.finishedBytes;
      continue;
    }
    let partial = state.partial?.index === state.nextItem ? state.partial : undefined;
    const finalPath = partial?.finalPath ?? (action === "rename" ? await uniqueLocalName(target) : target);
    job.currentFile = item.relativePath;
    publish(state.sender, job.sessionId, true);
    let offset = 0;
    if (partial) {
      offset = await downloadResumeOffset(sftp, item, partial.temp);
      if (offset === 0 && await connectionLost(state.job.sessionId, sftp)) {
        throw new Error("SFTP download error: connection lost"); // keep the temporary file for the next Start
      }
      if (offset === 0) {
        await fs.rm(partial.temp, { force: true }).catch(() => undefined);
        partial = undefined;
      }
    }
    if (!partial) {
      partial = { index: state.nextItem, temp: `${finalPath}.shellium-${randomBytes(4).toString("hex")}.part`, finalPath };
    }
    state.partial = partial;
    const temp = partial.temp;
    state.controller = { canceled: false, cancel() { this.canceled = true; } };
    try {
      reportProgress(state, offset);
      await transferStream(
        sftp.createReadStream(item.source, { start: offset }),
        offset > 0 ? createWriteStream(temp, { flags: "r+", start: offset }) : createWriteStream(temp),
        item.size - offset, (progress) => reportProgress(state, offset + progress.transferredBytes), "SFTP download error", state.controller);
      await fs.rename(temp, finalPath);
      const mtime = new Date(item.modifiedAt);
      await fs.utimes(finalPath, mtime, mtime).catch(() => undefined);
    } catch (error) {
      if (!(await keepPartial(state, sftp))) {
        state.partial = undefined;
        await fs.rm(temp, { force: true }).catch(() => undefined);
      }
      throw error;
    } finally {
      state.controller = undefined;
    }
    state.partial = undefined;
    state.finishedBytes += item.size;
    job.transferredBytes = state.finishedBytes;
    job.doneFiles += 1;
  }
}

/**
 * Where a kept temporary upload file can continue: its size, if the local file is unchanged since
 * planning and the last bytes written match it - otherwise 0 (start the file over).
 */
async function uploadResumeOffset(sftp: SftpClient, item: PlanItem, temp: string) {
  const local = await fs.stat(item.source).catch(() => null);
  if (!local || local.size !== item.size || Math.floor(local.mtimeMs) !== Math.floor(item.modifiedAt)) {
    return 0;
  }
  const part = await stat(sftp, temp).catch(() => null);
  if (!part || part.size === 0 || part.size > local.size) {
    return 0;
  }
  const length = Math.min(TAIL_CHECK_BYTES, part.size);
  const [mine, theirs] = await Promise.all([
    readLocalRange(item.source, part.size - length, length),
    readRemoteRange(sftp, temp, part.size - length, length),
  ]).catch(() => [Buffer.alloc(0), Buffer.alloc(1)]);
  return mine.equals(theirs) ? part.size : 0;
}

/** The same for a kept temporary download file: the server file must be unchanged. */
async function downloadResumeOffset(sftp: SftpClient, item: PlanItem, temp: string) {
  const remote = await stat(sftp, item.source).catch(() => null);
  if (!remote || remote.size !== item.size || remote.mtime * 1000 !== item.modifiedAt) {
    return 0;
  }
  const part = await fs.stat(temp).catch(() => null);
  if (!part || part.size === 0 || part.size > remote.size) {
    return 0;
  }
  const length = Math.min(TAIL_CHECK_BYTES, part.size);
  const [mine, theirs] = await Promise.all([
    readLocalRange(temp, part.size - length, length),
    readRemoteRange(sftp, item.source, part.size - length, length),
  ]).catch(() => [Buffer.alloc(0), Buffer.alloc(1)]);
  return mine.equals(theirs) ? part.size : 0;
}

async function readLocalRange(localPath: string, start: number, length: number) {
  const handle = await fs.open(localPath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function readRemoteRange(sftp: SftpClient, remotePath: string, start: number, length: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = sftp.createReadStream(remotePath, { start, end: start + length - 1 });
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

// -------------------------------------------------------------------------------------------------
// Delete / inspect

async function inspectRemote(sftp: SftpClient, remotePaths: string[]) {
  let files = 0;
  let folders = 0;
  let bytes = 0;
  const walk = async (remotePath: string) => {
    const attrs = await lstat(sftp, remotePath);
    if (getSftpEntryType(attrs) === "directory") {
      folders += 1;
      for (const entry of await readRemoteDirectory(sftp, remotePath)) {
        await walk(entry.path);
      }
    } else {
      files += 1;
      bytes += attrs.size;
    }
  };
  for (const remotePath of remotePaths) {
    await walk(remotePath);
  }
  return { files, folders, bytes };
}

/** Deletes a file, link or folder with everything in it. Links are removed, never followed. */
async function deleteRemoteTree(sftp: SftpClient, remotePath: string): Promise<number> {
  const attrs = await lstat(sftp, remotePath);
  if (getSftpEntryType(attrs) !== "directory") {
    await call((cb) => sftp.unlink(remotePath, cb), "SFTP delete error");
    return 1;
  }
  let count = 0;
  for (const entry of await readRemoteDirectory(sftp, remotePath)) {
    count += await deleteRemoteTree(sftp, entry.path);
  }
  await call((cb) => sftp.rmdir(remotePath, cb), "SFTP delete error");
  return count + 1;
}

/** Refuses the root and top-level system folders whatever the UI asked for. */
function requireDeletable(remotePath: string) {
  const normalized = path.posix.normalize(remotePath).replace(/\/+$/, "") || "/";
  const protectedPaths = new Set(["/", "/bin", "/boot", "/dev", "/etc", "/home", "/lib", "/lib64", "/opt", "/proc",
    "/root", "/run", "/sbin", "/srv", "/sys", "/tmp", "/u01", "/usr", "/var"]);
  if (protectedPaths.has(normalized)) {
    throw new Error(`Shellium does not delete ${normalized}.`);
  }
}

// -------------------------------------------------------------------------------------------------
// Editing remote files in a local editor

type Edit = {
  id: string;
  sessionId: string;
  sender: WebContents;
  remotePath: string;
  localPath: string;
  dir: string;
  remoteMtime: number;
  remoteSize: number;
  localMtime: number;
  status: "open" | "changed" | "uploading" | "uploaded" | "conflict" | "error";
  message?: string;
  backedUp: boolean;
  timer?: ReturnType<typeof setInterval>;
};

const edits = new Map<string, Edit>();

function editRoot() {
  return path.join(app.getPath("temp"), "shellium-edit");
}

function removeEditRoot() {
  try {
    require("node:fs").rmSync(editRoot(), { recursive: true, force: true });
  } catch {
    // best effort on quit
  }
}

function editView(edit: Edit) {
  return { id: edit.id, sessionId: edit.sessionId, remotePath: edit.remotePath, status: edit.status, message: edit.message };
}

function publishEdit(edit: Edit) {
  if (!edit.sender.isDestroyed()) {
    edit.sender.send("sftp:edit", editView(edit));
  }
}

async function startEdit(sender: WebContents, sessionId: string, remotePath: string) {
  const existing = [...edits.values()].find((edit) => edit.sessionId === sessionId && edit.remotePath === remotePath);
  if (existing) {
    await shell.openPath(existing.localPath);
    return editView(existing);
  }
  const sftp = getSftpSession(sessionId).sftp;
  const attrs = await stat(sftp, remotePath);
  if (getSftpEntryType(attrs) !== "file") {
    throw new Error("Only files can be edited.");
  }
  if (attrs.size > MAX_EDIT_BYTES) {
    throw new Error("The file is larger than 50 MB - download it instead.");
  }
  const id = randomUUID();
  const dir = path.join(editRoot(), id);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const localPath = path.join(dir, safeLocalName(path.posix.basename(remotePath)));
  const controller = { canceled: false, cancel() { this.canceled = true; } };
  await transferStream(sftp.createReadStream(remotePath), createWriteStream(localPath, { mode: 0o600 }), attrs.size,
    undefined, "SFTP download error", controller);
  const local = await fs.stat(localPath);
  const edit: Edit = { id, sessionId, sender, remotePath, localPath, dir, remoteMtime: attrs.mtime, remoteSize: attrs.size,
    localMtime: local.mtimeMs, status: "open", backedUp: false };
  edits.set(id, edit);
  // Editors often replace the file rather than write into it, so poll the time stamp.
  edit.timer = setInterval(() => {
    fs.stat(localPath).then((stats) => {
      if (stats.mtimeMs !== edit.localMtime && edit.status !== "uploading") {
        edit.localMtime = stats.mtimeMs;
        edit.status = "changed";
        edit.message = "Saved locally - not uploaded yet";
        publishEdit(edit);
      }
    }).catch(() => undefined);
  }, 1000);
  const opened = await shell.openPath(localPath);
  if (opened) {
    await stopEdit(edit);
    throw new Error(`Could not open an editor: ${opened}`);
  }
  publishEdit(edit);
  return editView(edit);
}

/**
 * Uploads the edited copy. Refuses (status "conflict") when the server file changed since it was
 * opened, unless forced. The first upload of an edit keeps the original as name.bak-<timestamp>, and so
 * does a forced upload over a version someone else changed on the server.
 */
async function uploadEdit(edit: Edit, force: boolean) {
  const sftp = getSftpSession(edit.sessionId).sftp;
  const current = await stat(sftp, edit.remotePath).catch(() => null);
  const changedOnServer = current !== null && (current.mtime !== edit.remoteMtime || current.size !== edit.remoteSize);
  if (changedOnServer && !force) {
    edit.status = "conflict";
    edit.message = "The file changed on the server since you opened it";
    publishEdit(edit);
    return editView(edit);
  }
  edit.status = "uploading";
  edit.message = "Uploading...";
  publishEdit(edit);
  // A one-file job that is not in the queue (never published, no pause / resume).
  const local = await fs.stat(edit.localPath);
  const item: PlanItem = { kind: "file", source: edit.localPath, relativePath: path.posix.basename(edit.remotePath),
    size: local.size, modifiedAt: local.mtimeMs };
  const state: JobState = {
    job: { id: edit.id, sessionId: edit.sessionId, direction: "upload" } as SftpJob, sender: edit.sender, sources: [], items: [item],
    canceled: false, planned: true, nextItem: 0, finishedBytes: 0, pauseRequested: false, samples: [],
  };
  try {
    await safeUpload(state, sftp, item, edit.remotePath, true, !edit.backedUp || changedOnServer);
    edit.backedUp = true;
    const after = await stat(sftp, edit.remotePath);
    edit.remoteMtime = after.mtime;
    edit.remoteSize = after.size;
    edit.status = "uploaded";
    edit.message = "Uploaded " + new Date().toLocaleTimeString()
      + (changedOnServer ? " - the version changed on the server was kept as a .bak file" : "");
  } catch (error) {
    edit.status = "error";
    edit.message = error instanceof Error ? error.message : String(error);
  }
  publishEdit(edit);
  return editView(edit);
}

async function stopEdit(edit: Edit) {
  if (edit.timer) {
    clearInterval(edit.timer);
  }
  edits.delete(edit.id);
  await fs.rm(edit.dir, { recursive: true, force: true }).catch(() => undefined);
  if (!edit.sender.isDestroyed()) {
    edit.sender.send("sftp:edit", { ...editView(edit), status: "closed" });
  }
}

async function stopEditsForSession(sessionId: string) {
  for (const edit of [...edits.values()]) {
    if (edit.sessionId === sessionId) {
      await stopEdit(edit);
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Helpers

function call(run: (callback: (error?: Error) => void) => void, prefix: string) {
  return new Promise<void>((resolve, reject) => {
    run((error) => (error ? reject(new Error(prefix ? `${prefix}: ${error.message}` : error.message)) : resolve()));
  });
}

function stat(sftp: SftpClient, remotePath: string) {
  return new Promise<SftpFileAttributes>((resolve, reject) => {
    sftp.stat(remotePath, (error, attrs) => (error ? reject(error) : resolve(attrs)));
  });
}

function lstat(sftp: SftpClient, remotePath: string) {
  return new Promise<SftpFileAttributes>((resolve, reject) => {
    sftp.lstat(remotePath, (error, attrs) => (error ? reject(new Error(`SFTP stat error: ${error.message}`)) : resolve(attrs)));
  });
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error("Invalid paths.");
  }
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function parseDecision(value: unknown): SftpConflictDecision {
  const raw = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const isAction = (action: unknown): action is SftpConflictAction => action === "overwrite" || action === "rename" || action === "skip";
  const perItem: Record<string, SftpConflictAction> = {};
  if (typeof raw.perItem === "object" && raw.perItem !== null) {
    for (const [id, action] of Object.entries(raw.perItem as Record<string, unknown>)) {
      if (isAction(action)) {
        perItem[id] = action;
      }
    }
  }
  return { defaultAction: isAction(raw.defaultAction) ? raw.defaultAction : "skip", perItem, backup: raw.backup !== false };
}

function timestamp() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function backupName(remotePath: string) {
  return `${remotePath}.bak-${timestamp()}`;
}

/** "report.txt" -> "report (1).txt", the first name not taken. */
function numberedName(name: string, n: number) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
}

async function uniqueRemoteName(sftp: SftpClient, remotePath: string) {
  const dir = path.posix.dirname(remotePath);
  const name = path.posix.basename(remotePath);
  for (let n = 1; n < 1000; n++) {
    const candidate = joinRemotePath(dir, numberedName(name, n));
    if (!(await stat(sftp, candidate).catch(() => null))) {
      return candidate;
    }
  }
  throw new Error(`No free name for ${name}.`);
}

async function uniqueLocalName(localPath: string) {
  const dir = path.dirname(localPath);
  const name = path.basename(localPath);
  for (let n = 1; n < 1000; n++) {
    const candidate = path.join(dir, numberedName(name, n));
    if (!(await fs.stat(candidate).catch(() => null))) {
      return candidate;
    }
  }
  throw new Error(`No free name for ${name}.`);
}

/** Local path for a relative path built from (sanitized) remote names; never leaves targetDir. */
function localTarget(targetDir: string, relativePath: string) {
  const resolved = path.resolve(targetDir, ...relativePath.split("/"));
  const root = path.resolve(targetDir);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Refusing to write outside the target folder: ${relativePath}`);
  }
  return resolved;
}

/** Remote names may hold characters the local file system refuses (Windows: <>:"/\|?* and more). */
export function safeLocalName(name: string) {
  // Control characters are exactly what must not reach a local file name.
  // eslint-disable-next-line no-control-regex
  let safe = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  if (os.platform() === "win32") {
    safe = safe.replace(/[. ]+$/g, "");
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(safe)) {
      safe = `_${safe}`;
    }
  }
  if (safe === "" || safe === "." || safe === "..") {
    safe = "_";
  }
  return safe;
}
