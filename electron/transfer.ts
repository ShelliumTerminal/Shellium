import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import {
  decryptBackupFile,
  normalizeScriptButtonLibrary,
  parseImportedFolders,
  readFolders,
  readScriptButtonLibrary,
  readSettingsObject,
  replaceStoredContents,
  withConnectionDatabase,
} from "./connectionsDb";
import type { Folder, Host, ScriptButtonCategory, ScriptButtonLibrary } from "./connectionsDb";
import { mergeKnownHosts, normalizeKnownHostEntries, readKnownHosts, replaceKnownHosts } from "./knownHosts";
import type { KnownHostEntry, KnownHostsMergeResult } from "./knownHosts";
import { getSettingsPath, writePrivateFile } from "./storageConfig";
import { getSecurityStatus } from "./security";
import { createEnvironmentId, deriveEnvironmentBadge, normalizeEnvironments } from "../src/components/common/environmentModel";
import { describeFields, readXmlSource, suggestMapping } from "./xmlImport";
import type { MappingTarget, XmlRecord, XmlSource } from "./xmlImport";
import type { Environment } from "../src/components/common/environmentModel";

/**
 * Export / import between Shellium installations.
 *
 * .shellium is an opaque binary container only Shellium reads: no readable header, no JSON.
 *   magic(4, not ASCII) | version(1) | scrypt logN(1) | r(1) | p(1) | salt(16) | iv(12) | ciphertext | GCM tag(16)
 * The key is scrypt(passphrase); the 36-byte header is authenticated as AAD, so a tampered
 * header (e.g. weaker KDF parameters) fails like a wrong password. Plaintext = gzip(JSON payload).
 *
 * CSV is the deliberately limited, plaintext format (no passwords) for spreadsheets and other tools.
 * Other tools' XML exports (and a CSV whose columns are not recognized) go through a mapping step:
 * the user picks which of the file's fields is the host, port, username... (xmlImport.ts).
 *
 * An opened import file stays in the main process under a token; passwords never reach the
 * renderer, which only sees summaries and conflict lists.
 */

const require = createRequire(import.meta.url);
const { dialog, ipcMain } = require("electron") as typeof import("electron");

const MAGIC = Buffer.from([0x9e, 0x3c, 0xd1, 0x47]);
const FORMAT_VERSION = 1;
const HEADER_LENGTH = 4 + 4 + 16 + 12;
const TAG_LENGTH = 16;
const KDF = { logN: 17, r: 8, p: 1 };
const MIN_PASSPHRASE = 12;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const CSV_COLUMNS = ["name", "host", "port", "username", "folder", "environment", "tags", "description"] as const;
const BOM = String.fromCharCode(0xfeff);
const BOM_PATTERN = new RegExp(`^${BOM}`);

const scryptAsync = promisify(crypto.scrypt) as (password: string, salt: Buffer, keylen: number, options: crypto.ScryptOptions) => Promise<Buffer>;

type TransferPayload = {
  /** "shellv-transfer" / "rshell-transfer" in files made under the former names; still imported. */
  format: "shellium-transfer" | "shellv-transfer" | "rshell-transfer";
  version: 1;
  exportedAt: string;
  connections?: { folders: Folder[]; includesPasswords: boolean };
  scriptButtons?: ScriptButtonLibrary;
  /** Every environment when chosen; otherwise only those the exported hosts point at. */
  environments?: Environment[];
  /** Options (appOptions) without the environment list. */
  settings?: Record<string, unknown>;
  knownHosts?: Record<string, KnownHostEntry>;
};

type ExportSelection = {
  connections: boolean;
  /** Folders to export (each with everything under it); omitted = all. */
  folderIds?: string[];
  includePasswords: boolean;
  scriptCategoryIds: string[];
  environments: boolean;
  settings: boolean;
  knownHosts: boolean;
};

type ImportKind = "shellium" | "legacy" | "csv" | "xml";

/** A row / entry left out of the import: CSV rows by line, XML entries by folder and name. */
type ImportIssue = { line?: number; where?: string; message: string };

/**
 * Host fields an import may change on a host that is already here. A file only changes what it
 * carries: a CSV / XML has no X11, anti-idle or legacy options and no passwords, so those never
 * count as differences and an update never resets them.
 */
type HostField = "name" | "description" | "tags" | "environment" | "options" | "password";
const ALL_HOST_FIELDS: HostField[] = ["name", "description", "tags", "environment", "options", "password"];

type Mappable = XmlSource & { folderFromTree: boolean };

/** The user's choice in the mapping step: target -> source field name. */
type FieldMapping = Partial<Record<Exclude<MappingTarget, "folder">, string>> & {
  /** "#tree" = the file's folder structure, "" = no folders, else a field holding "A/B". */
  folder: string;
  defaultUsername: string;
};

/** An import file after decryption / parsing, normalized to one shape for all formats. */
type ImportData = {
  kind: ImportKind;
  exportedAt?: string;
  folders: Folder[] | null;
  includesPasswords: boolean;
  scriptButtons: ScriptButtonLibrary | null;
  environments: Environment[];
  settings: Record<string, unknown> | null;
  knownHosts: Record<string, KnownHostEntry> | null;
  issues: ImportIssue[];
  hostFields: HostField[];
};

type ImportSession = {
  filePath: string;
  kind: ImportKind;
  raw: Buffer;
  data?: ImportData;
  /** XML, or a CSV with unrecognized columns: entries waiting for the mapping step. */
  mappable?: Mappable;
};

type ImportSelection = {
  connections: boolean;
  /** Folders of the file to import; omitted = all. */
  folderIds?: string[];
  scriptCategoryIds: string[];
  environments: boolean;
  settings: boolean;
  knownHosts: boolean;
  /** merge: add to what is here; replace: the selected parts replace this device's. */
  mode: "merge" | "replace";
  /** merge only: put the imported folders under this existing folder instead of the top level. */
  targetFolderId?: string | null;
};

type ConflictDecision = "skip" | "update";
type ImportDecisions = { hosts: ConflictDecision; scripts: ConflictDecision };

type SummaryFolder = { id: string; name: string; hostCount: number; folders: SummaryFolder[] };

type Snapshot = {
  folders: Folder[];
  library: ScriptButtonLibrary;
  knownHosts: Record<string, KnownHostEntry>;
  settingsText: string | null;
};

const sessions = new Map<string, ImportSession>();
let undoSnapshot: Snapshot | null = null;

/** Drops opened import files and the undo point (called when Shellium locks). */
export function clearTransferSessions() {
  sessions.clear();
  undoSnapshot = null;
}

function assertUnlocked() {
  if (!getSecurityStatus().unlocked) {
    throw new Error("Unlock Shellium to export or import.");
  }
}

export function registerTransferHandlers() {
  ipcMain.handle("transfer:exportSources", async () => {
    assertUnlocked();
    return withConnectionDatabase((db) => {
      const folders = readFolders(db);
      return {
        folders: summarizeFolders(folders),
        hasPasswords: allHosts(folders).some((host) => !!host.password),
        scriptCategories: readScriptButtonLibrary(db).categories.map((c) => ({ id: c.id, name: c.name, buttonCount: c.buttons.length })),
        environmentCount: readLocalEnvironments().length,
        knownHostCount: Object.keys(readKnownHosts(db)).length,
      };
    }, { persist: false });
  });

  ipcMain.handle("transfer:export", async (_event, rawSelection: unknown, passphrase: unknown) => {
    assertUnlocked();
    const selection = parseExportSelection(rawSelection);
    if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE) {
      throw new Error(`The file password must be at least ${MIN_PASSPHRASE} characters.`);
    }

    const payload = await withConnectionDatabase((db) => buildPayload(db, selection), { persist: false });
    const result = await dialog.showSaveDialog({
      title: "Export to Shellium file",
      defaultPath: `shellium-export-${timestamp()}.shellium`,
      filters: [{ name: "Shellium export", extensions: ["shellium"] }],
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    writePrivateFile(result.filePath, await sealPayload(payload, passphrase));
    const folders = payload.connections?.folders ?? [];
    return {
      canceled: false,
      filePath: result.filePath,
      hostCount: allHosts(folders).length,
      includesPasswords: payload.connections?.includesPasswords ?? false,
      scriptButtonCount: (payload.scriptButtons?.categories ?? []).reduce((n, c) => n + c.buttons.length, 0),
      environmentCount: payload.environments?.length ?? 0,
      settings: payload.settings !== undefined,
      knownHostCount: Object.keys(payload.knownHosts ?? {}).length,
    };
  });

  ipcMain.handle("transfer:exportCsv", async (_event, rawFolderIds: unknown, rawDelimiter: unknown) => {
    assertUnlocked();
    const folderIds = Array.isArray(rawFolderIds) ? rawFolderIds.filter((id): id is string => typeof id === "string") : undefined;
    const delimiter = rawDelimiter === ";" ? ";" : ",";
    const folders = await withConnectionDatabase((db) => readFolders(db), { persist: false });
    const selected = folderIds ? pickFolders(folders, new Set(folderIds)) : folders;
    const environments = readLocalEnvironments();

    const result = await dialog.showSaveDialog({
      title: "Export hosts to CSV",
      defaultPath: `shellium-hosts-${timestamp()}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    const lines = [CSV_COLUMNS.join(delimiter)];
    walkHosts(selected, [], (host, folderPath) => {
      const environment = environments.find((env) => env.id === host.environmentId);
      lines.push([
        host.name,
        host.hostname,
        String(host.port),
        host.username,
        folderPath.join("/"),
        environment?.name ?? "",
        (host.tags ?? []).join("|"),
        host.description ?? "",
      ].map((cell) => csvCell(cell, delimiter)).join(delimiter));
    });
    // BOM so Excel reads UTF-8 (Turkish characters) correctly.
    fs.writeFileSync(result.filePath, BOM + lines.join("\r\n") + "\r\n", "utf8");
    return { canceled: false, filePath: result.filePath, hostCount: lines.length - 1 };
  });

  ipcMain.handle("transfer:openImport", async () => {
    assertUnlocked();
    const result = await dialog.showOpenDialog({
      title: "Import into Shellium",
      filters: [
        { name: "Shellium export, ShellV / RShell export or backup, CSV, XML", extensions: ["shellium", "shellv", "rshell", "rshellbak", "csv", "xml"] },
        { name: "All files", extensions: ["*"] },
      ],
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const filePath = result.filePaths[0];
    if (fs.statSync(filePath).size > MAX_FILE_BYTES) {
      throw new Error("The file is too large to be a Shellium export.");
    }
    const raw = fs.readFileSync(filePath);
    const kind = detectKind(raw, filePath);
    const token = crypto.randomUUID();
    const session: ImportSession = { filePath, kind, raw };
    sessions.set(token, session);

    const fileName = path.basename(filePath);
    if (kind === "xml") {
      session.mappable = { ...readXmlSource(raw), folderFromTree: true };
      return { canceled: false, token, kind, fileName, needsPassword: false, mapping: describeMappable(session.mappable) };
    }
    if (kind === "csv") {
      const parsed = parseCsvImport(raw);
      if ("mappable" in parsed) {
        session.mappable = parsed.mappable;
        return { canceled: false, token, kind, fileName, needsPassword: false, mapping: describeMappable(session.mappable) };
      }
      session.data = parsed;
      return { canceled: false, token, kind, fileName, needsPassword: false, summary: summarize(session.data) };
    }
    return { canceled: false, token, kind, fileName, needsPassword: true };
  });

  ipcMain.handle("transfer:mapImport", async (_event, token: unknown, rawMapping: unknown) => {
    assertUnlocked();
    const session = getSession(token);
    if (!session.mappable) {
      throw new Error("This file does not need a field mapping.");
    }
    session.data = importDataFromRecords(session.kind, session.mappable, parseMapping(rawMapping, session.mappable));
    return summarize(session.data);
  });

  ipcMain.handle("transfer:unlockImport", async (_event, token: unknown, passphrase: unknown) => {
    assertUnlocked();
    const session = getSession(token);
    if (typeof passphrase !== "string" || !passphrase) {
      throw new Error("Enter the file password.");
    }
    if (session.kind === "shellium") {
      session.data = importDataFromPayload(await openPayload(session.raw, passphrase));
    } else if (session.kind === "legacy") {
      session.data = importDataFromLegacy(session.raw, passphrase);
    }
    return summarize(requireData(session));
  });

  ipcMain.handle("transfer:previewImport", async (_event, token: unknown, rawSelection: unknown) => {
    assertUnlocked();
    const data = requireData(getSession(token));
    const selection = parseImportSelection(rawSelection);
    return withConnectionDatabase((db) => previewImport(db, data, selection), { persist: false });
  });

  ipcMain.handle("transfer:applyImport", async (_event, token: unknown, rawSelection: unknown, rawDecisions: unknown) => {
    assertUnlocked();
    const data = requireData(getSession(token));
    const selection = parseImportSelection(rawSelection);
    const decisions = parseDecisions(rawDecisions);
    const result = await applyImport(data, selection, decisions);
    sessions.delete(String(token));
    return result;
  });

  ipcMain.handle("transfer:undoImport", async () => {
    assertUnlocked();
    if (!undoSnapshot) {
      throw new Error("There is no import to undo.");
    }
    await restoreSnapshot(undoSnapshot);
    undoSnapshot = null;
    return { settings: { appOptions: readSettingsObject().appOptions } };
  });

  ipcMain.handle("transfer:discard", (_event, token: unknown) => {
    if (typeof token === "string") {
      sessions.delete(token);
    }
    undoSnapshot = null;
  });
}

// ---------------------------------------------------------------------------------------------
// Binary container

async function deriveKey(passphrase: string, salt: Buffer, logN: number, r: number, p: number) {
  const N = 2 ** logN;
  return scryptAsync(passphrase.normalize("NFC"), salt, 32, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 });
}

async function sealPayload(payload: TransferPayload, passphrase: string): Promise<Buffer> {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const header = Buffer.concat([MAGIC, Buffer.from([FORMAT_VERSION, KDF.logN, KDF.r, KDF.p]), salt, iv]);
  const key = await deriveKey(passphrase, salt, KDF.logN, KDF.r, KDF.p);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(header);
  const plaintext = zlib.gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([header, ciphertext, cipher.getAuthTag()]);
}

async function openPayload(raw: Buffer, passphrase: string): Promise<unknown> {
  if (raw.length < HEADER_LENGTH + TAG_LENGTH || !raw.subarray(0, 4).equals(MAGIC)) {
    throw new Error("This is not a Shellium export file.");
  }
  const [version, logN, r, p] = raw.subarray(4, 8);
  if (version !== FORMAT_VERSION) {
    throw new Error("This Shellium export was made by a newer Shellium version.");
  }
  // Bounds keep a crafted file from making the key derivation take minutes or gigabytes.
  if (logN < 14 || logN > 20 || r < 1 || r > 16 || p < 1 || p > 4) {
    throw new Error("The Shellium export file is damaged.");
  }
  const header = raw.subarray(0, HEADER_LENGTH);
  const salt = raw.subarray(8, 24);
  const iv = raw.subarray(24, HEADER_LENGTH);
  const ciphertext = raw.subarray(HEADER_LENGTH, raw.length - TAG_LENGTH);
  const tag = raw.subarray(raw.length - TAG_LENGTH);
  const key = await deriveKey(passphrase, salt, logN, r, p);

  let plaintext: Buffer;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("Wrong password, or the file is damaged.");
  }
  return JSON.parse(zlib.gunzipSync(plaintext, { maxOutputLength: 512 * 1024 * 1024 }).toString("utf8")) as unknown;
}

function detectKind(raw: Buffer, filePath: string): ImportKind {
  if (raw.length >= 4 && raw.subarray(0, 4).equals(MAGIC)) {
    return "shellium";
  }
  const text = raw.subarray(0, 4096).toString("utf8").replace(BOM_PATTERN, "").trimStart();
  if (text.startsWith("{") && text.includes("rshell-encrypted-backup")) {
    return "legacy";
  }
  const utf16 = (raw[0] === 0xff && raw[1] === 0xfe) || (raw[0] === 0xfe && raw[1] === 0xff);
  if (path.extname(filePath).toLowerCase() === ".xml" || text.startsWith("<") || utf16) {
    return "xml";
  }
  if (path.extname(filePath).toLowerCase() === ".csv" || !raw.subarray(0, 4096).includes(0)) {
    return "csv";
  }
  throw new Error("Shellium does not recognize this file.");
}

// ---------------------------------------------------------------------------------------------
// Export

function buildPayload(db: Parameters<typeof readFolders>[0], selection: ExportSelection): TransferPayload {
  const payload: TransferPayload = { format: "shellium-transfer", version: 1, exportedAt: new Date().toISOString() };
  const environments = readLocalEnvironments();

  if (selection.connections) {
    const all = readFolders(db);
    let folders = selection.folderIds ? pickFolders(all, new Set(selection.folderIds)) : all;
    if (!selection.includePasswords) {
      folders = mapHosts(folders, (host) => ({ ...host, password: undefined }));
    }
    payload.connections = { folders, includesPasswords: selection.includePasswords && allHosts(folders).some((h) => !!h.password) };
  }

  if (selection.scriptCategoryIds.length > 0) {
    const wanted = new Set(selection.scriptCategoryIds);
    payload.scriptButtons = { categories: readScriptButtonLibrary(db).categories.filter((c) => wanted.has(c.id)) };
  }

  if (selection.environments) {
    payload.environments = environments;
  } else if (payload.connections) {
    // Hosts keep their environment on the other side even when the list itself is not exported.
    const used = new Set(allHosts(payload.connections.folders).map((h) => h.environmentId).filter(Boolean));
    const referenced = environments.filter((env) => used.has(env.id));
    if (referenced.length > 0) {
      payload.environments = referenced;
    }
  }

  if (selection.settings) {
    const appOptions = readSettingsObject().appOptions;
    if (typeof appOptions === "object" && appOptions !== null) {
      const rest = { ...(appOptions as Record<string, unknown>) };
      delete rest.environments;
      payload.settings = rest;
    }
  }

  if (selection.knownHosts) {
    payload.knownHosts = readKnownHosts(db);
  }
  return payload;
}

/** Selected folders with everything under them, plus the (otherwise empty) folders on the way to them. */
function pickFolders(folders: Folder[], ids: Set<string>): Folder[] {
  return folders.flatMap((folder): Folder[] => {
    if (ids.has(folder.id)) {
      return [folder];
    }
    const children = pickFolders(folder.folders ?? [], ids);
    return children.length > 0 ? [{ ...folder, folders: children, hosts: [] }] : [];
  });
}

// ---------------------------------------------------------------------------------------------
// Import: reading files

function importDataFromPayload(value: unknown): ImportData {
  const payload = typeof value === "object" && value !== null ? value as Partial<TransferPayload> : {};
  if (!["shellium-transfer", "shellv-transfer", "rshell-transfer"].includes(payload.format ?? "") || payload.version !== 1) {
    throw new Error("This Shellium export was made by a newer Shellium version.");
  }
  const folders = payload.connections ? parseImportedFolders(payload.connections.folders) : null;
  return {
    kind: "shellium",
    exportedAt: typeof payload.exportedAt === "string" ? payload.exportedAt : undefined,
    folders,
    includesPasswords: !!folders && allHosts(folders).some((h) => !!h.password),
    scriptButtons: payload.scriptButtons ? normalizeScriptButtonLibrary(payload.scriptButtons) : null,
    environments: Array.isArray(payload.environments) ? normalizeEnvironments(payload.environments) : [],
    settings: isRecord(payload.settings) ? payload.settings : null,
    knownHosts: payload.knownHosts ? normalizeKnownHostEntries(payload.knownHosts) : null,
    issues: [],
    hostFields: ALL_HOST_FIELDS,
  };
}

function importDataFromLegacy(raw: Buffer, passphrase: string): ImportData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8").replace(BOM_PATTERN, ""));
  } catch {
    throw new Error("The backup file is damaged.");
  }
  const backup = decryptBackupFile(parsed, passphrase);
  const appOptions = isRecord(backup.settings.appOptions) ? backup.settings.appOptions : null;
  const { environments, ...settings } = appOptions ?? {};
  return {
    kind: "legacy",
    exportedAt: backup.exportedAt,
    folders: backup.connections.folders,
    includesPasswords: allHosts(backup.connections.folders).some((h) => !!h.password),
    scriptButtons: backup.scriptButtons,
    environments: Array.isArray(environments) ? normalizeEnvironments(environments) : [],
    settings: appOptions ? settings : null,
    knownHosts: backup.knownHosts ?? null,
    issues: [],
    hostFields: ALL_HOST_FIELDS,
  };
}

const CSV_HEADER_ALIASES: Record<string, (typeof CSV_COLUMNS)[number]> = {
  name: "name", label: "name", session: "name",
  host: "host", hostname: "host", address: "host", ip: "host", server: "host",
  port: "port",
  username: "username", user: "username", login: "username",
  folder: "folder", path: "folder", group: "folder",
  environment: "environment", env: "environment",
  tags: "tags", tag: "tags",
  description: "description", desc: "description", notes: "description", note: "description",
};

/** A CSV with a recognized "host" column is read directly; any other goes to the mapping step. */
function parseCsvImport(raw: Buffer): ImportData | { mappable: Mappable } {
  const text = raw.toString("utf8").replace(BOM_PATTERN, "");
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const delimiter = [";", "\t", ","].reduce((best, candidate) =>
    firstLine.split(candidate).length > firstLine.split(best).length ? candidate : best, ",");
  const rows = parseCsv(text, delimiter);
  const headerCells = (rows.shift()?.cells ?? []).map((cell) => cell.trim());
  const header = headerCells.map((cell) => CSV_HEADER_ALIASES[cell.toLowerCase()]);
  if (!header.includes("host")) {
    const records: XmlRecord[] = rows
      .filter(({ cells }) => cells.some((cell) => cell.trim()))
      .map(({ line, cells }) => ({
        fields: Object.fromEntries(headerCells.map((key, index) => [key || `Column ${index + 1}`, uncsvCell(cells[index] ?? "").trim()])),
        path: [],
        label: `Line ${line}`,
      }));
    if (headerCells.filter(Boolean).length === 0 || records.length === 0) {
      throw new Error("The CSV has no header row or no rows.");
    }
    return { mappable: { format: null, records, folderFromTree: false } };
  }

  const issues: ImportIssue[] = [];
  const root: Folder = { id: "csv-root", name: "", folders: [], hosts: [] };
  const environments: Environment[] = [];

  rows.forEach(({ line, cells }) => {
    if (cells.every((cell) => !cell.trim())) {
      return;
    }
    const get = (column: (typeof CSV_COLUMNS)[number]) => {
      const index = header.indexOf(column);
      return index >= 0 ? uncsvCell(cells[index] ?? "").trim() : "";
    };
    const hostname = get("host");
    const username = get("username");
    const portText = get("port");
    const port = portText ? Number(portText) : 22;
    if (!hostname) {
      issues.push({ line, message: "host is empty" });
      return;
    }
    if (/\s/.test(hostname)) {
      issues.push({ line, message: `host "${hostname}" contains spaces` });
      return;
    }
    if (!username) {
      issues.push({ line, message: "username is empty" });
      return;
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      issues.push({ line, message: `port "${portText}" is not 1-65535` });
      return;
    }

    let environmentId: string | undefined;
    const environmentName = get("environment");
    if (environmentName) {
      let environment = environments.find((env) => sameName(env.name, environmentName));
      if (!environment) {
        environment = { id: createEnvironmentId(), name: environmentName, badge: deriveEnvironmentBadge(environmentName), color: "grey", warn: false };
        environments.push(environment);
      }
      environmentId = environment.id;
    }

    const folderPath = get("folder").split("/").map((part) => part.trim()).filter(Boolean);
    let folder = root;
    for (const name of folderPath.length > 0 ? folderPath : ["Imported"]) {
      let child = folder.folders!.find((f) => sameName(f.name, name));
      if (!child) {
        child = { id: newId("folder"), name, folders: [], hosts: [] };
        folder.folders!.push(child);
      }
      folder = child;
    }

    const tags = get("tags").split("|").map((tag) => tag.trim()).filter(Boolean);
    const description = get("description");
    folder.hosts!.push({
      id: newId("host"),
      name: get("name") || hostname,
      hostname,
      port,
      username,
      tags,
      ...(description ? { description } : {}),
      ...(environmentId ? { environmentId } : {}),
    });
  });

  return {
    kind: "csv",
    folders: root.folders!,
    includesPasswords: false,
    scriptButtons: null,
    environments,
    settings: null,
    knownHosts: null,
    issues,
    hostFields: [
      ...(header.includes("name") ? ["name" as const] : []),
      ...(header.includes("description") ? ["description" as const] : []),
      ...(header.includes("tags") ? ["tags" as const] : []),
      ...(header.includes("environment") ? ["environment" as const] : []),
    ],
  };
}

function describeMappable(source: Mappable) {
  const fields = describeFields(source);
  return {
    format: source.format,
    recordCount: source.records.length,
    folderFromTree: source.folderFromTree,
    hasFolders: source.records.some((record) => record.path.length > 0),
    fields,
    suggested: suggestMapping(fields.map((field) => field.key)),
  };
}

function parseMapping(value: unknown, source: Mappable): FieldMapping {
  const raw = isRecord(value) ? value : {};
  const known = new Set(describeFields(source).map((field) => field.key));
  const pick = (key: string) => (typeof raw[key] === "string" && known.has(raw[key] as string) ? raw[key] as string : undefined);
  const host = pick("host");
  if (!host) {
    throw new Error("Choose which field holds the host name or address.");
  }
  const folder = raw.folder === "#tree" && source.folderFromTree ? "#tree" : pick("folder") ?? "";
  const defaultUsername = typeof raw.defaultUsername === "string" ? raw.defaultUsername.trim() : "";
  if (/\s|@/.test(defaultUsername)) {
    throw new Error("The default username must not contain spaces or @.");
  }
  return {
    host,
    name: pick("name"),
    port: pick("port"),
    username: pick("username"),
    description: pick("description"),
    tags: pick("tags"),
    environment: pick("environment"),
    protocol: pick("protocol"),
    folder,
    defaultUsername,
  };
}

/** Mapped XML / CSV entries -> the import shape; entries that cannot be hosts are listed, never dropped silently. */
function importDataFromRecords(kind: ImportKind, source: XmlSource, mapping: FieldMapping): ImportData {
  const issues: ImportIssue[] = [];
  const root: Folder = { id: "map-root", name: "", folders: [], hosts: [] };
  const environments: Environment[] = [];

  source.records.forEach((record) => {
    const get = (key: string | undefined) => (key ? record.fields[key] ?? "" : "").trim();
    const skip = (message: string) => issues.push(kind === "csv"
      ? { line: Number(record.label.replace(/\D/g, "")) || undefined, message }
      : { where: [...record.path, record.label].join(" / "), message });

    const protocol = get(mapping.protocol);
    if (protocol && !/ssh/i.test(protocol)) {
      skip(`protocol ${protocol} (only SSH is imported)`);
      return;
    }
    const hostname = get(mapping.host);
    if (!hostname) {
      skip("host is empty");
      return;
    }
    if (/\s/.test(hostname)) {
      skip(`host "${hostname}" contains spaces`);
      return;
    }
    const username = get(mapping.username) || mapping.defaultUsername;
    if (!username) {
      skip("username is empty (set a default username)");
      return;
    }
    const portText = get(mapping.port);
    const port = portText ? Number(portText) : 22;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      skip(`port "${portText}" is not 1-65535`);
      return;
    }

    let environmentId: string | undefined;
    const environmentName = get(mapping.environment);
    if (environmentName) {
      let environment = environments.find((env) => sameName(env.name, environmentName));
      if (!environment) {
        environment = { id: createEnvironmentId(), name: environmentName, badge: deriveEnvironmentBadge(environmentName), color: "grey", warn: false };
        environments.push(environment);
      }
      environmentId = environment.id;
    }

    const folderPath = mapping.folder === "#tree"
      ? record.path
      : get(mapping.folder).split(/[\\/]/).map((part) => part.trim()).filter(Boolean);
    let folder = root;
    for (const name of folderPath.length > 0 ? folderPath : ["Imported"]) {
      let child = folder.folders!.find((f) => sameName(f.name, name));
      if (!child) {
        child = { id: newId("folder"), name, folders: [], hosts: [] };
        folder.folders!.push(child);
      }
      folder = child;
    }

    const description = get(mapping.description);
    folder.hosts!.push({
      id: newId("host"),
      name: get(mapping.name) || hostname,
      hostname,
      port,
      username,
      tags: get(mapping.tags).split(/[,;|]/).map((tag) => tag.trim()).filter(Boolean),
      ...(description ? { description } : {}),
      ...(environmentId ? { environmentId } : {}),
    });
  });

  return {
    kind,
    folders: root.folders!,
    includesPasswords: false,
    scriptButtons: null,
    environments,
    settings: null,
    knownHosts: null,
    issues,
    hostFields: [
      ...(mapping.name ? ["name" as const] : []),
      ...(mapping.description ? ["description" as const] : []),
      ...(mapping.tags ? ["tags" as const] : []),
      ...(mapping.environment ? ["environment" as const] : []),
    ],
  };
}

/** RFC 4180: quoted cells may hold the delimiter, doubled quotes and line breaks. */
function parseCsv(text: string, delimiter: string): { line: number; cells: string[] }[] {
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        if (char === "\n") line += 1;
        cell += char;
      }
    } else if (char === '"' && cell === "") {
      quoted = true;
    } else if (char === delimiter) {
      cells.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      cells.push(cell);
      rows.push({ line: rowLine, cells });
      cells = [];
      cell = "";
      line += 1;
      rowLine = line;
    } else {
      cell += char;
    }
  }
  if (cell !== "" || cells.length > 0) {
    cells.push(cell);
    rows.push({ line: rowLine, cells });
  }
  return rows;
}

/**
 * Quotes when needed. Cells a spreadsheet would run as a formula get a leading apostrophe
 * (CSV injection); uncsvCell removes it again on import.
 */
function csvCell(value: string, delimiter: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return safe.includes(delimiter) || /["\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function uncsvCell(value: string) {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

// ---------------------------------------------------------------------------------------------
// Import: summary, preview, apply

function summarize(data: ImportData) {
  return {
    kind: data.kind,
    exportedAt: data.exportedAt,
    connections: data.folders
      ? { hostCount: allHosts(data.folders).length, includesPasswords: data.includesPasswords, folders: summarizeFolders(data.folders) }
      : null,
    scriptCategories: data.scriptButtons
      ? data.scriptButtons.categories.map((c) => ({ id: c.id, name: c.name, buttonCount: c.buttons.length }))
      : null,
    environments: data.environments.map((env) => ({ name: env.name, badge: env.badge, color: env.color })),
    settings: data.settings !== null,
    knownHostCount: data.knownHosts ? Object.keys(data.knownHosts).length : 0,
    issues: data.issues,
  };
}

function summarizeFolders(folders: Folder[]): SummaryFolder[] {
  return folders.map((folder) => ({
    id: folder.id,
    name: folder.name,
    hostCount: allHosts([folder]).length,
    folders: summarizeFolders(folder.folders ?? []),
  }));
}

function selectedImportFolders(data: ImportData, selection: ImportSelection): Folder[] {
  if (!selection.connections || !data.folders) {
    return [];
  }
  return selection.folderIds ? pickFolders(data.folders, new Set(selection.folderIds)) : data.folders;
}

function selectedImportCategories(data: ImportData, selection: ImportSelection): ScriptButtonCategory[] {
  const wanted = new Set(selection.scriptCategoryIds);
  return (data.scriptButtons?.categories ?? []).filter((c) => wanted.has(c.id));
}

type HostConflict = { name: string; hostname: string; port: number; username: string; existingPath: string; importedPath: string; existingName: string; differences: string[] };
type ScriptConflict = { category: string; label: string };

function previewImport(db: Parameters<typeof readFolders>[0], data: ImportData, selection: ImportSelection) {
  const localFolders = readFolders(db);
  const localLibrary = readScriptButtonLibrary(db);
  const importFolders = selectedImportFolders(data, selection);
  const importCategories = selectedImportCategories(data, selection);
  const envPlan = planEnvironments(data, selection, importFolders);

  const hosts = { new: 0, unchanged: 0, duplicatesInFile: 0, conflicts: [] as HostConflict[], replacedCount: 0 };
  const scripts = { new: 0, unchanged: 0, conflicts: [] as ScriptConflict[], replacedCount: 0 };

  if (selection.mode === "replace") {
    hosts.replacedCount = importFolders.length > 0 || selection.connections ? allHosts(localFolders).length : 0;
    hosts.new = allHosts(importFolders).length;
    scripts.replacedCount = importCategories.length > 0 ? localLibrary.categories.reduce((n, c) => n + c.buttons.length, 0) : 0;
    scripts.new = importCategories.reduce((n, c) => n + c.buttons.length, 0);
  } else {
    const index = indexHosts(localFolders);
    const seen = new Set<string>();
    walkHosts(importFolders, [], (host, folderPath) => {
      const key = hostKey(host);
      if (seen.has(key)) {
        hosts.duplicatesInFile += 1;
        return;
      }
      seen.add(key);
      const existing = index.get(key);
      const differences = existing ? hostDifferences(existing.host, host, envPlan.idMap, data.hostFields) : [];
      if (!existing) {
        hosts.new += 1;
      } else if (differences.length === 0) {
        hosts.unchanged += 1;
      } else {
        hosts.conflicts.push({
          differences,
          name: host.name,
          hostname: host.hostname,
          port: host.port,
          username: host.username,
          existingName: existing.host.name,
          existingPath: existing.path.join(" / "),
          importedPath: folderPath.join(" / "),
        });
      }
    });

    importCategories.forEach((category) => {
      const local = localLibrary.categories.find((c) => sameName(c.name, category.name));
      category.buttons.forEach((button) => {
        const existing = local?.buttons.find((b) => sameName(b.label, button.label));
        if (!existing) {
          scripts.new += 1;
        } else if (existing.script === button.script && existing.color === button.color) {
          scripts.unchanged += 1;
        } else {
          scripts.conflicts.push({ category: category.name, label: button.label });
        }
      });
    });
  }

  let knownHosts: KnownHostsMergeResult | null = null;
  if (selection.knownHosts && data.knownHosts) {
    const local = readKnownHosts(db);
    knownHosts = { added: 0, alreadyKnown: 0, conflicts: 0 };
    for (const [id, entry] of Object.entries(data.knownHosts)) {
      if (!local[id]) knownHosts.added += 1;
      else if (local[id].fingerprint === entry.fingerprint) knownHosts.alreadyKnown += 1;
      else knownHosts.conflicts += 1;
    }
  }

  return {
    mode: selection.mode,
    /** What "Update from the file" changes on a host that is already here. */
    hostUpdates: data.hostFields.filter((field) => field !== "password" || data.includesPasswords),
    hosts,
    scripts,
    newEnvironments: envPlan.created.map((env) => env.name),
    knownHosts,
    settings: selection.settings && data.settings !== null,
  };
}

/**
 * Environments are matched by name. Imported ones missing here are added: all of the file's when
 * chosen, otherwise only those the imported hosts use.
 */
function planEnvironments(data: ImportData, selection: ImportSelection, importFolders: Folder[]) {
  const local = readLocalEnvironments();
  const used = new Set(allHosts(importFolders).map((h) => h.environmentId).filter(Boolean));
  const wanted = data.environments.filter((env) => selection.environments || used.has(env.id));
  const idMap = new Map<string, string>();
  const created: Environment[] = [];
  const result = [...local];

  wanted.forEach((env) => {
    const match = result.find((candidate) => sameName(candidate.name, env.name));
    if (match) {
      idMap.set(env.id, match.id);
    } else {
      const id = result.some((candidate) => candidate.id === env.id) ? createEnvironmentId() : env.id;
      const next = { ...env, id };
      result.push(next);
      created.push(next);
      idMap.set(env.id, id);
    }
  });
  return { environments: result, created, idMap };
}

async function applyImport(data: ImportData, selection: ImportSelection, decisions: ImportDecisions) {
  const snapshot = await takeSnapshot();
  const importFolders = selectedImportFolders(data, selection);
  const importCategories = selectedImportCategories(data, selection);
  const envPlan = planEnvironments(data, selection, importFolders);
  const mapEnv = (host: Host): Host => ({
    ...host,
    environmentId: host.environmentId ? envPlan.idMap.get(host.environmentId) : undefined,
  });

  const counts = { hostsAdded: 0, hostsUpdated: 0, hostsSkipped: 0, scriptsAdded: 0, scriptsUpdated: 0, scriptsSkipped: 0 };
  let knownHosts: KnownHostsMergeResult | null = null;

  try {
    await withConnectionDatabase((db) => {
      let folders = readFolders(db);
      let library = readScriptButtonLibrary(db);

      if (selection.connections && importFolders.length > 0) {
        if (selection.mode === "replace") {
          // A file without passwords must not wipe the ones saved here for the same hosts.
          const index = indexHosts(folders);
          folders = mapHosts(importFolders, (host) => {
            const mapped = mapEnv(host);
            return mapped.password ? mapped : { ...mapped, password: index.get(hostKey(host))?.host.password };
          });
          counts.hostsAdded = allHosts(folders).length;
        } else {
          folders = mergeFolders(folders, importFolders, selection.targetFolderId ?? null, decisions.hosts, mapEnv, counts, data.hostFields);
        }
      }

      if (importCategories.length > 0) {
        if (selection.mode === "replace") {
          library = { categories: importCategories };
          counts.scriptsAdded = importCategories.reduce((n, c) => n + c.buttons.length, 0);
        } else {
          library = mergeScripts(library, importCategories, decisions.scripts, counts);
        }
      }

      replaceStoredContents(db, folders, library);
      if (selection.knownHosts && data.knownHosts) {
        // Merge, never replace: a key already trusted on this device wins over the file's.
        knownHosts = mergeKnownHosts(db, data.knownHosts, "backup");
      }
    }, { persist: true });

    const settingsChanged = (selection.settings && data.settings !== null) || envPlan.created.length > 0;
    if (settingsChanged) {
      const current = readSettingsObject();
      const currentOptions = isRecord(current.appOptions) ? current.appOptions : {};
      const baseOptions = selection.settings && data.settings ? data.settings : currentOptions;
      writeSettingsObject({ ...current, version: 1, appOptions: { ...baseOptions, environments: envPlan.environments } });
    }
  } catch (error) {
    try {
      await restoreSnapshot(snapshot);
    } catch {
      // Keep the import error; it is the one the user can act on.
    }
    throw error;
  }

  undoSnapshot = snapshot;
  return {
    ...counts,
    environmentsAdded: envPlan.created.map((env) => env.name),
    knownHosts,
    settings: { appOptions: readSettingsObject().appOptions },
  };
}

type Counts = { hostsAdded: number; hostsUpdated: number; hostsSkipped: number; scriptsAdded: number; scriptsUpdated: number; scriptsSkipped: number };

/**
 * Folders are matched by name under the same parent, hosts by hostname + port + username anywhere
 * in the tree. A conflicting host is skipped or updated in place (its folder, id and favorite stay).
 */
function mergeFolders(
  local: Folder[],
  incoming: Folder[],
  targetFolderId: string | null,
  decision: ConflictDecision,
  mapEnv: (host: Host) => Host,
  counts: Counts,
  fields: HostField[],
): Folder[] {
  const tree = structuredClone(local);
  const index = indexHosts(tree);
  let container: Folder[] = tree;
  if (targetFolderId) {
    const target = findFolder(tree, targetFolderId);
    if (!target) {
      throw new Error("The target folder no longer exists.");
    }
    target.folders ??= [];
    container = target.folders;
  }

  const mergeInto = (siblings: Folder[], folder: Folder) => {
    let destination = siblings.find((candidate) => sameName(candidate.name, folder.name));
    if (!destination) {
      destination = { id: newId("folder"), name: folder.name, folders: [], hosts: [] };
      siblings.push(destination);
    }
    destination.folders ??= [];
    destination.hosts ??= [];

    for (const raw of folder.hosts ?? []) {
      const host = mapEnv(raw);
      const key = hostKey(host);
      const existing = index.get(key);
      if (!existing) {
        const added: Host = { ...host, id: newId("host") };
        if (!added.password) delete added.password;
        destination.hosts.push(added);
        index.set(key, { host: added, path: [] });
        counts.hostsAdded += 1;
      } else if (hostDifferences(existing.host, host, null, fields).length === 0) {
        // identical in everything the file carries: nothing to do
      } else if (decision === "update") {
        // Only what the file carries; the rest of the host (folder, id, favorite, options a CSV
        // or XML does not have) stays as it is.
        const has = (field: HostField) => fields.includes(field);
        Object.assign(existing.host, {
          ...(has("name") ? { name: host.name } : {}),
          ...(has("description") ? { description: host.description } : {}),
          ...(has("tags") ? { tags: host.tags } : {}),
          ...(has("environment") ? { environmentId: host.environmentId } : {}),
          ...(has("options") ? { x11: host.x11, legacyAlgorithms: host.legacyAlgorithms, antiIdle: host.antiIdle, terminalSchemeId: host.terminalSchemeId } : {}),
          ...(has("password") && host.password ? { password: host.password } : {}),
        });
        counts.hostsUpdated += 1;
      } else {
        counts.hostsSkipped += 1;
      }
    }
    for (const child of folder.folders ?? []) {
      mergeInto(destination.folders, child);
    }
  };

  incoming.forEach((folder) => mergeInto(container, folder));
  return tree;
}

function mergeScripts(local: ScriptButtonLibrary, incoming: ScriptButtonCategory[], decision: ConflictDecision, counts: Counts): ScriptButtonLibrary {
  const library = structuredClone(local);
  incoming.forEach((category) => {
    let destination = library.categories.find((c) => sameName(c.name, category.name));
    if (!destination) {
      destination = { id: newId("script-category"), name: category.name, sortOrder: library.categories.length, buttons: [] };
      library.categories.push(destination);
    }
    const target = destination;
    category.buttons.forEach((button) => {
      const existing = target.buttons.find((b) => sameName(b.label, button.label));
      if (!existing) {
        target.buttons.push({ ...button, id: newId("script-button"), categoryId: target.id, sortOrder: target.buttons.length });
        counts.scriptsAdded += 1;
      } else if (existing.script === button.script && existing.color === button.color) {
        // identical
      } else if (decision === "update") {
        existing.script = button.script;
        existing.color = button.color;
        counts.scriptsUpdated += 1;
      } else {
        counts.scriptsSkipped += 1;
      }
    });
  });
  return library;
}

async function takeSnapshot(): Promise<Snapshot> {
  const settingsPath = getSettingsPath();
  return withConnectionDatabase((db) => ({
    folders: readFolders(db),
    library: readScriptButtonLibrary(db),
    knownHosts: readKnownHosts(db),
    settingsText: fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, "utf8") : null,
  }), { persist: false });
}

async function restoreSnapshot(snapshot: Snapshot) {
  await withConnectionDatabase((db) => {
    replaceStoredContents(db, snapshot.folders, snapshot.library);
    replaceKnownHosts(db, snapshot.knownHosts);
  }, { persist: true });
  const settingsPath = getSettingsPath();
  if (snapshot.settingsText === null) {
    fs.rmSync(settingsPath, { force: true });
  } else {
    writePrivateFile(settingsPath, snapshot.settingsText);
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers

function getSession(token: unknown): ImportSession {
  const session = typeof token === "string" ? sessions.get(token) : undefined;
  if (!session) {
    throw new Error("The import file is no longer open. Choose it again.");
  }
  return session;
}

function requireData(session: ImportSession): ImportData {
  if (!session.data) {
    throw new Error("Enter the file password first.");
  }
  return session.data;
}

function readLocalEnvironments(): Environment[] {
  const appOptions = readSettingsObject().appOptions;
  return normalizeEnvironments(isRecord(appOptions) ? appOptions.environments : undefined);
}

function writeSettingsObject(settings: Record<string, unknown>) {
  writePrivateFile(getSettingsPath(), JSON.stringify(settings, null, 2));
}

function allHosts(folders: Folder[]): Host[] {
  const hosts: Host[] = [];
  walkHosts(folders, [], (host) => hosts.push(host));
  return hosts;
}

function walkHosts(folders: Folder[], parentPath: string[], visit: (host: Host, folderPath: string[]) => void) {
  folders.forEach((folder) => {
    const folderPath = [...parentPath, folder.name];
    (folder.hosts ?? []).forEach((host) => visit(host, folderPath));
    walkHosts(folder.folders ?? [], folderPath, visit);
  });
}

function mapHosts(folders: Folder[], map: (host: Host) => Host): Folder[] {
  return folders.map((folder) => ({
    ...folder,
    hosts: (folder.hosts ?? []).map(map),
    folders: mapHosts(folder.folders ?? [], map),
  }));
}

function findFolder(folders: Folder[], id: string): Folder | null {
  for (const folder of folders) {
    if (folder.id === id) return folder;
    const found = findFolder(folder.folders ?? [], id);
    if (found) return found;
  }
  return null;
}

function indexHosts(folders: Folder[]) {
  const index = new Map<string, { host: Host; path: string[] }>();
  walkHosts(folders, [], (host, folderPath) => {
    const key = hostKey(host);
    if (!index.has(key)) index.set(key, { host, path: folderPath });
  });
  return index;
}

function hostKey(host: Pick<Host, "hostname" | "port" | "username">) {
  return `${host.hostname.trim().toLowerCase()}|${host.port}|${host.username.trim().toLowerCase()}`;
}

/**
 * What an update would change, among the fields the file carries; a file without a password never
 * counts as a difference.
 */
function hostDifferences(existing: Host, incoming: Host, envMap: Map<string, string> | null, fields: HostField[]): string[] {
  const has = (field: HostField) => fields.includes(field);
  const incomingEnv = envMap && incoming.environmentId ? envMap.get(incoming.environmentId) : incoming.environmentId;
  const differences: string[] = [];
  if (has("name") && existing.name !== incoming.name) differences.push("name");
  if (has("description") && (existing.description ?? "") !== (incoming.description ?? "")) differences.push("description");
  if (has("tags") && JSON.stringify(existing.tags ?? []) !== JSON.stringify(incoming.tags ?? [])) differences.push("tags");
  if (has("environment") && (existing.environmentId ?? "") !== (incomingEnv ?? "")) differences.push("environment");
  if (has("options") && (!!existing.legacyAlgorithms !== !!incoming.legacyAlgorithms || JSON.stringify(existing.x11 ?? null) !== JSON.stringify(incoming.x11 ?? null)
    || JSON.stringify(existing.antiIdle ?? null) !== JSON.stringify(incoming.antiIdle ?? null)
    || (existing.terminalSchemeId ?? "") !== (incoming.terminalSchemeId ?? ""))) {
    differences.push("options");
  }
  if (has("password") && incoming.password && incoming.password !== existing.password) differences.push("password");
  return differences;
}

function sameName(a: string, b: string) {
  return a.trim().localeCompare(b.trim(), undefined, { sensitivity: "accent" }) === 0;
}

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestamp() {
  const now = new Date();
  const pad = (part: number) => part.toString().padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function parseExportSelection(value: unknown): ExportSelection {
  const raw = isRecord(value) ? value : {};
  return {
    connections: raw.connections === true,
    folderIds: Array.isArray(raw.folderIds) ? raw.folderIds.filter((id): id is string => typeof id === "string") : undefined,
    includePasswords: raw.includePasswords === true,
    scriptCategoryIds: Array.isArray(raw.scriptCategoryIds) ? raw.scriptCategoryIds.filter((id): id is string => typeof id === "string") : [],
    environments: raw.environments === true,
    settings: raw.settings === true,
    knownHosts: raw.knownHosts === true,
  };
}

function parseImportSelection(value: unknown): ImportSelection {
  const raw = isRecord(value) ? value : {};
  return {
    connections: raw.connections === true,
    folderIds: Array.isArray(raw.folderIds) ? raw.folderIds.filter((id): id is string => typeof id === "string") : undefined,
    scriptCategoryIds: Array.isArray(raw.scriptCategoryIds) ? raw.scriptCategoryIds.filter((id): id is string => typeof id === "string") : [],
    environments: raw.environments === true,
    settings: raw.settings === true,
    knownHosts: raw.knownHosts === true,
    mode: raw.mode === "replace" ? "replace" : "merge",
    targetFolderId: typeof raw.targetFolderId === "string" && raw.targetFolderId ? raw.targetFolderId : null,
  };
}

function parseDecisions(value: unknown): ImportDecisions {
  const raw = isRecord(value) ? value : {};
  return {
    hosts: raw.hosts === "update" ? "update" : "skip",
    scripts: raw.scripts === "update" ? "update" : "skip",
  };
}
