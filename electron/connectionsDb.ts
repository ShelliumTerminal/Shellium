import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { getConnectionDatabasePath, getLegacyConnectionDatabasePath, getSettingsPath, writePrivateFile } from "./storageConfig";
import { decryptDatabaseData, decryptSensitiveValue, encryptDatabaseData, encryptSensitiveValue } from "./security";
import { ensureKnownHostsTable, mergeKnownHosts, readLegacyKnownHostsFile } from "./knownHosts";
import { normalizeAntiIdle, normalizeHostAntiIdle } from "../src/components/common/antiIdleModel";
import type { AntiIdleOptions } from "../src/components/common/antiIdleModel";

type HostX11Options = {
  enabled?: boolean;
  autoStart?: boolean;
  serverMode?: "auto" | "custom";
  serverCommand?: string;
  displayHost?: string;
  displayNumber?: number;
  screen?: number;
  trusted?: boolean;
};

export type Host = {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  password?: string;
  description?: string;
  tags?: string[];
  x11?: HostX11Options;
  legacyAlgorithms?: boolean;
  environmentId?: string;
  favorite?: boolean;
  /** Own anti-idle settings; absent = the Options default. */
  antiIdle?: AntiIdleOptions;
  /** Own terminal color scheme id; absent = the environment's or the Options default. */
  terminalSchemeId?: string;
};

const terminalSchemeIdPattern = /^[a-z0-9-]{1,64}$/;
const schemeIdOrNull = (value: unknown) => (typeof value === "string" && terminalSchemeIdPattern.test(value) ? value : null);

export type Folder = {
  id: string;
  name: string;
  folders?: Folder[];
  hosts?: Host[];
};

type ScriptButtonColor = "black" | "blue" | "cyan" | "green" | "grey" | "magenta" | "orange" | "purple" | "red" | "white" | "yellow";

export type ScriptButton = {
  id: string;
  categoryId: string;
  label: string;
  script: string;
  color: ScriptButtonColor;
  /** Show the send string as a tooltip on the script bar (off for buttons that type a password). */
  showTooltip: boolean;
  sortOrder: number;
};

export type ScriptButtonCategory = {
  id: string;
  name: string;
  sortOrder: number;
  buttons: ScriptButton[];
};

export type ScriptButtonLibrary = {
  categories: ScriptButtonCategory[];
};


type SqlJsStatic = {
  Database: new (data?: Uint8Array) => Database;
};

type InitSqlJs = () => Promise<SqlJsStatic>;

type ConnectionsExportFile = {
  version: 1;
  exportedAt: string;
  folders: Folder[];
};

const require = createRequire(import.meta.url);
const { ipcMain } = require("electron") as typeof import("electron");
const initSqlJs = require("sql.js/dist/sql-asm.js") as InitSqlJs;

export type Database = {
  run(sql: string, params?: unknown[]): Database;
  exec(sql: string, params?: unknown[]): Array<{ columns: string[]; values: unknown[][] }>;
  prepare(sql: string): { run(params?: unknown[]): void; free(): void };
  export(): Uint8Array;
};

type NodeRow = {
  id: string;
  parentId: string | null;
  type: "folder" | "host";
  name: string;
  hostname: string | null;
  port: number | null;
  username: string | null;
  password: string | null;
  description: string | null;
  tagsJson: string | null;
  x11Json: string | null;
  antiIdleJson: string | null;
  terminalScheme: string | null;
  legacyAlgorithms: number;
  environmentId: string | null;
  favorite: number;
  sortOrder: number;
};

type ScriptButtonCategoryRow = {
  id: string;
  name: string;
  sortOrder: number;
};

type ScriptButtonRow = {
  id: string;
  categoryId: string;
  label: string;
  script: string;
  color: ScriptButtonColor;
  /** Show the send string as a tooltip on the script bar (off for buttons that type a password). */
  showTooltip: boolean;
  sortOrder: number;
};

const scriptButtonColors: ScriptButtonColor[] = ["black", "blue", "cyan", "green", "grey", "magenta", "orange", "purple", "red", "white", "yellow"];

function normalizeScriptButtonColor(value: unknown): ScriptButtonColor {
  return typeof value === "string" && scriptButtonColors.includes(value as ScriptButtonColor) ? value as ScriptButtonColor : "green";
}

const seedFolders: Folder[] = [
  {
    id: "production",
    name: "Production",
    folders: [
      {
        id: "production-oracle",
        name: "Oracle",
        hosts: [
          {
            id: "prod-ora01",
            name: "PROD-ORA01",
            hostname: "10.10.1.11",
            port: 22,
            username: "oracle",
            description: "Primary production Oracle host",
            tags: ["prod", "oracle"],
          },
          {
            id: "prod-ora02",
            name: "PROD-ORA02",
            hostname: "10.10.1.12",
            port: 22,
            username: "oracle",
            description: "Standby production Oracle host",
            tags: ["prod", "oracle"],
          },
        ],
      },
    ],
  },
  {
    id: "test",
    name: "Test",
    folders: [
      {
        id: "test-oracle",
        name: "Oracle",
        hosts: [
          {
            id: "test01",
            name: "TEST01",
            hostname: "10.20.1.21",
            port: 22,
            username: "tester",
            description: "Shared test host",
            tags: ["test", "oracle"],
          },
        ],
      },
    ],
  },
];

let databasePromise: Promise<Database> | null = null;

export function resetConnectionDatabase() {
  databasePromise = null;
}

/**
 * Runs a read or change against the open connection database; a change is written to disk
 * (encrypted like the rest of the database) before the promise resolves.
 */
export async function withConnectionDatabase<T>(action: (db: Database) => T, options: { persist: boolean }): Promise<T> {
  const db = await getDatabase();
  if (!options.persist) {
    return action(db);
  }
  db.run("BEGIN TRANSACTION");
  let result: T;
  try {
    result = action(db);
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
  persistDatabase(db);
  return result;
}

export async function migrateConnectionSensitiveData() {
  const db = await getDatabase();
  const folders = readFolders(db);
  const scriptButtonLibrary = readScriptButtonLibrary(db);
  writeFolders(db, folders);
  writeScriptButtonLibrary(db, scriptButtonLibrary);
}

export function registerConnectionHandlers() {
  ipcMain.handle("connections:list", async () => {
    const db = await getDatabase();
    const folders = readFolders(db);

    if (folders.length > 0) {
      return folders;
    }

    writeFolders(db, seedFolders);
    return seedFolders;
  });

  ipcMain.handle("connections:save", async (_event, folders: Folder[]) => {
    const db = await getDatabase();
    writeFolders(db, folders);
    return folders;
  });

  ipcMain.handle("scriptButtons:list", async () => {
    const db = await getDatabase();
    return readScriptButtonLibrary(db);
  });

  ipcMain.handle("scriptButtons:save", async (_event, library: ScriptButtonLibrary) => {
    const db = await getDatabase();
    const normalizedLibrary = normalizeScriptButtonLibrary(library);
    writeScriptButtonLibrary(db, normalizedLibrary);
    return normalizedLibrary;
  });
}

async function getDatabase() {
  // A failed open (e.g. still locked) must not stick: the next call after unlocking tries again.
  databasePromise ??= openDatabase().catch((error: unknown) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
}

async function openDatabase(): Promise<Database> {
  const SQL = await initSqlJs();
  const dbPath = getDatabasePath();
  const data = fs.existsSync(dbPath) ? decryptDatabaseData(fs.readFileSync(dbPath)) : undefined;
  const db = data ? new SQL.Database(data) : new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS connection_nodes (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      type TEXT NOT NULL CHECK (type IN ('folder', 'host')),
      name TEXT NOT NULL,
      hostname TEXT,
      port INTEGER,
      username TEXT,
      password TEXT,
      description TEXT,
      tags_json TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS script_button_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS script_buttons (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL,
      label TEXT NOT NULL,
      script TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(category_id) REFERENCES script_button_categories(id) ON DELETE CASCADE
    )
  `);

  ensureColumn(db, "connection_nodes", "password", "TEXT");
  ensureColumn(db, "connection_nodes", "x11_json", "TEXT");
  ensureColumn(db, "connection_nodes", "legacy_algorithms", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "connection_nodes", "environment_id", "TEXT");
  ensureColumn(db, "connection_nodes", "favorite", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "connection_nodes", "anti_idle_json", "TEXT");
  ensureColumn(db, "connection_nodes", "terminal_scheme", "TEXT");
  ensureColumn(db, "script_buttons", "color", "TEXT NOT NULL DEFAULT 'green'");
  ensureColumn(db, "script_buttons", "show_tooltip", "INTEGER NOT NULL DEFAULT 1");
  ensureKnownHostsTable(db);
  ensureDefaultScriptButtonCategory(db);

  // Trusted host keys used to live in a plain known_hosts.json next to the database. Move them in
  // (never replacing a key the table already has) and delete the file only once they are saved.
  const legacyKnownHostsPath = path.join(path.dirname(dbPath), "known_hosts.json");
  const legacyKnownHosts = readLegacyKnownHostsFile(legacyKnownHostsPath);
  if (legacyKnownHosts) {
    mergeKnownHosts(db, legacyKnownHosts, undefined);
  }

  persistDatabase(db);

  if (legacyKnownHosts) {
    fs.rmSync(legacyKnownHostsPath, { force: true });
    fs.rmSync(`${legacyKnownHostsPath}.tmp`, { force: true });
  }
  removeLegacyPlainDatabase(dbPath);
  return db;
}

/**
 * Early versions kept an unencrypted connections.sqlite in the app's userData folder. It was copied
 * into the data folder on first start (storageConfig) and never used again; once the data folder's
 * database is saved encrypted, the plain copy - which can hold passwords in clear text - goes.
 */
function removeLegacyPlainDatabase(dbPath: string) {
  const legacyPath = getLegacyConnectionDatabasePath();
  if (path.resolve(legacyPath) === path.resolve(dbPath) || !fs.existsSync(legacyPath) || !fs.existsSync(dbPath)) {
    return;
  }
  const head = fs.readFileSync(dbPath).subarray(0, 16).toString("utf8");
  if (!head.startsWith("shellium-sec:v1:")) {
    return;
  }
  fs.rmSync(legacyPath, { force: true });
}

function ensureColumn(db: Database, tableName: string, columnName: string, columnType: string) {
  const result = db.exec(`PRAGMA table_info(${tableName})`);
  const hasColumn = result[0]?.values.some((row) => row[1] === columnName);

  if (!hasColumn) {
    db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
  }
}

function getDatabasePath() {
  return getConnectionDatabasePath();
}

function persistDatabase(db: Database) {
  const dbPath = getDatabasePath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  writePrivateFile(dbPath, encryptDatabaseData(db.export()));
}

function ensureDefaultScriptButtonCategory(db: Database) {
  const result = db.exec("SELECT COUNT(*) FROM script_button_categories");
  const count = Number(result[0]?.values[0]?.[0] ?? 0);

  if (count === 0) {
    db.run("INSERT INTO script_button_categories (id, name, sort_order) VALUES (?, ?, ?)", ["default", "Default", 0]);
  }
}

export function readFolders(db: Database): Folder[] {
  const result = db.exec(`
    SELECT id, parent_id, type, name, hostname, port, username, password, description, tags_json, x11_json, sort_order,
      legacy_algorithms, environment_id, favorite, anti_idle_json, terminal_scheme
    FROM connection_nodes
    ORDER BY parent_id IS NOT NULL, parent_id, sort_order, name
  `);

  if (!result[0]) {
    return [];
  }

  const rows = result[0].values.map((value): NodeRow => ({
    id: String(value[0]),
    parentId: value[1] === null ? null : String(value[1]),
    type: value[2] === "host" ? "host" : "folder",
    name: String(value[3]),
    hostname: value[4] === null ? null : String(value[4]),
    port: value[5] === null ? null : Number(value[5]),
    username: value[6] === null ? null : String(value[6]),
    password: decryptSensitiveValue(value[7] === null ? null : String(value[7])),
    description: value[8] === null ? null : String(value[8]),
    tagsJson: value[9] === null ? null : String(value[9]),
    x11Json: value[10] === null ? null : String(value[10]),
    sortOrder: Number(value[11]),
    legacyAlgorithms: Number(value[12] ?? 0),
    environmentId: value[13] === null || value[13] === undefined ? null : String(value[13]),
    favorite: Number(value[14] ?? 0),
    antiIdleJson: value[15] === null || value[15] === undefined ? null : String(value[15]),
    terminalScheme: schemeIdOrNull(value[16]),
  }));

  return rowsToTree(rows);
}

export function writeFolders(db: Database, folders: Folder[]) {
  const rows = treeToRows(folders);
  db.run("BEGIN TRANSACTION");

  try {
    replaceConnectionRows(db, rows);
    db.run("COMMIT");
    persistDatabase(db);
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
}

function replaceConnectionRows(db: Database, rows: NodeRow[]) {
  db.run("DELETE FROM connection_nodes");
  const statement = db.prepare(`
    INSERT INTO connection_nodes (
      id, parent_id, type, name, hostname, port, username, password, description, tags_json, x11_json, sort_order,
      legacy_algorithms, environment_id, favorite, anti_idle_json, terminal_scheme
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    rows.forEach((row) => {
      statement.run([
        row.id,
        row.parentId,
        row.type,
        row.name,
        row.hostname,
        row.port,
        row.username,
        encryptSensitiveValue(row.password),
        row.description,
        row.tagsJson,
        row.x11Json,
        row.sortOrder,
        row.legacyAlgorithms,
        row.environmentId,
        row.favorite,
        row.antiIdleJson,
        row.terminalScheme,
      ]);
    });
  } finally {
    statement.free();
  }
}

export function readScriptButtonLibrary(db: Database): ScriptButtonLibrary {
  ensureDefaultScriptButtonCategory(db);

  const categoryResult = db.exec(`
    SELECT id, name, sort_order
    FROM script_button_categories
    ORDER BY sort_order, name
  `);
  const buttonResult = db.exec(`
    SELECT id, category_id, label, script, color, sort_order, show_tooltip
    FROM script_buttons
    ORDER BY category_id, sort_order, label
  `);

  const categories = (categoryResult[0]?.values ?? []).map((value): ScriptButtonCategoryRow => ({
    id: String(value[0]),
    name: String(value[1]),
    sortOrder: Number(value[2]),
  }));
  const buttons = (buttonResult[0]?.values ?? []).map((value): ScriptButtonRow => ({
    id: String(value[0]),
    categoryId: String(value[1]),
    label: String(value[2]),
    script: decryptSensitiveValue(String(value[3])) ?? "",
    color: normalizeScriptButtonColor(value[4]),
    sortOrder: Number(value[5]),
    showTooltip: Number(value[6]) !== 0,
  }));

  return {
    categories: categories.map((category) => ({
      ...category,
      buttons: buttons
        .filter((button) => button.categoryId === category.id)
        .map((button) => ({ ...button })),
    })),
  };
}

export function writeScriptButtonLibrary(db: Database, library: ScriptButtonLibrary) {
  db.run("BEGIN TRANSACTION");

  try {
    replaceScriptButtonRows(db, library);
    db.run("COMMIT");
    persistDatabase(db);
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
}

function replaceScriptButtonRows(db: Database, library: ScriptButtonLibrary) {
  db.run("DELETE FROM script_buttons");
  db.run("DELETE FROM script_button_categories");

  const categoryStatement = db.prepare(`
    INSERT INTO script_button_categories (id, name, sort_order)
    VALUES (?, ?, ?)
  `);
  const buttonStatement = db.prepare(`
    INSERT INTO script_buttons (id, category_id, label, script, color, sort_order, show_tooltip)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    library.categories.forEach((category, categoryIndex) => {
      categoryStatement.run([category.id, category.name, categoryIndex]);
      category.buttons.forEach((button, buttonIndex) => {
        buttonStatement.run([button.id, category.id, button.label, encryptSensitiveValue(button.script), normalizeScriptButtonColor(button.color), buttonIndex, button.showTooltip === false ? 0 : 1]);
      });
    });
  } finally {
    categoryStatement.free();
    buttonStatement.free();
  }
}

/**
 * Replaces the whole connection tree and script button library. No transaction of its own: call it
 * inside withConnectionDatabase so it commits (or rolls back) together with the other changes.
 */
export function replaceStoredContents(db: Database, folders: Folder[], library: ScriptButtonLibrary) {
  replaceConnectionRows(db, treeToRows(folders));
  replaceScriptButtonRows(db, library);
  ensureDefaultScriptButtonCategory(db);
}

export function normalizeScriptButtonLibrary(value: unknown): ScriptButtonLibrary {
  const parsed = typeof value === "object" && value !== null ? value as Partial<ScriptButtonLibrary> : {};
  const categoriesInput = Array.isArray(parsed.categories) ? parsed.categories : [];
  const categories = categoriesInput.flatMap((item, categoryIndex): ScriptButtonCategory[] => {
    if (typeof item !== "object" || item === null) {
      return [];
    }

    const category = item as Partial<ScriptButtonCategory>;
    const id = typeof category.id === "string" && category.id.trim() ? category.id : `script-category-${categoryIndex}`;
    const name = typeof category.name === "string" && category.name.trim() ? category.name.trim() : `Category ${categoryIndex + 1}`;
    const buttonsInput = Array.isArray(category.buttons) ? category.buttons : [];

    return [{
      id,
      name,
      sortOrder: categoryIndex,
      buttons: buttonsInput.flatMap((buttonItem, buttonIndex): ScriptButton[] => {
        if (typeof buttonItem !== "object" || buttonItem === null) {
          return [];
        }

        const button = buttonItem as Partial<ScriptButton>;
        const label = typeof button.label === "string" ? button.label.trim() : "";
        const script = typeof button.script === "string" ? button.script : "";

        if (!label || !script.trim()) {
          return [];
        }

        return [{
          id: typeof button.id === "string" && button.id.trim() ? button.id : `${id}-button-${buttonIndex}`,
          categoryId: id,
          label,
          script,
          color: normalizeScriptButtonColor(button.color),
          showTooltip: button.showTooltip !== false,
          sortOrder: buttonIndex,
        }];
      }),
    }];
  });

  return {
    categories: categories.length > 0 ? categories : [{ id: "default", name: "Default", sortOrder: 0, buttons: [] }],
  };
}


function rowsToTree(rows: NodeRow[]): Folder[] {
  const foldersById = new Map<string, Folder>();
  const childFoldersByParent = new Map<string | null, Folder[]>();
  const hostsByParent = new Map<string, Host[]>();

  rows.forEach((row) => {
    if (row.type === "folder") {
      const folder: Folder = { id: row.id, name: row.name, folders: [], hosts: [] };
      foldersById.set(row.id, folder);
      childFoldersByParent.set(row.parentId, [...(childFoldersByParent.get(row.parentId) ?? []), folder]);
      return;
    }

    if (!row.parentId || !row.hostname || !row.username) {
      return;
    }

    const host: Host = {
      id: row.id,
      name: row.name,
      hostname: row.hostname,
      port: row.port ?? 22,
      username: row.username,
      password: row.password ?? undefined,
      description: row.description ?? undefined,
      tags: parseTags(row.tagsJson),
      x11: parseX11Options(row.x11Json),
      ...(row.legacyAlgorithms === 1 ? { legacyAlgorithms: true } : {}),
      ...(row.environmentId ? { environmentId: row.environmentId } : {}),
      ...(row.favorite === 1 ? { favorite: true } : {}),
      ...parseAntiIdle(row.antiIdleJson),
      ...(row.terminalScheme ? { terminalSchemeId: row.terminalScheme } : {}),
    };

    hostsByParent.set(row.parentId, [...(hostsByParent.get(row.parentId) ?? []), host]);
  });

  foldersById.forEach((folder) => {
    folder.folders = childFoldersByParent.get(folder.id) ?? [];
    folder.hosts = hostsByParent.get(folder.id) ?? [];
  });

  return childFoldersByParent.get(null) ?? [];
}

function treeToRows(folders: Folder[], parentId: string | null = null): NodeRow[] {
  return folders.flatMap((folder, folderIndex) => {
    const folderRow: NodeRow = {
      id: folder.id,
      parentId,
      type: "folder",
      name: folder.name,
      hostname: null,
      port: null,
      username: null,
      password: null,
      description: null,
      tagsJson: null,
      x11Json: null,
      antiIdleJson: null,
      terminalScheme: null,
      legacyAlgorithms: 0,
      environmentId: null,
      favorite: 0,
      sortOrder: folderIndex,
    };

    const childRows = treeToRows(folder.folders ?? [], folder.id);
    const hostRows = (folder.hosts ?? []).map((host, hostIndex): NodeRow => ({
      id: host.id,
      parentId: folder.id,
      type: "host",
      name: host.name,
      hostname: host.hostname,
      port: host.port,
      username: host.username,
      password: host.password ?? null,
      description: host.description ?? null,
      tagsJson: JSON.stringify(host.tags ?? []),
      x11Json: stringifyX11Options(host.x11),
      antiIdleJson: host.antiIdle ? JSON.stringify(normalizeAntiIdle(host.antiIdle)) : null,
      terminalScheme: schemeIdOrNull(host.terminalSchemeId),
      legacyAlgorithms: host.legacyAlgorithms ? 1 : 0,
      environmentId: host.environmentId ?? null,
      favorite: host.favorite ? 1 : 0,
      sortOrder: hostIndex,
    }));

    return [folderRow, ...childRows, ...hostRows];
  });
}

function parseTags(tagsJson: string | null) {
  if (!tagsJson) {
    return [];
  }

  try {
    const parsed = JSON.parse(tagsJson);
    return Array.isArray(parsed) ? parsed.filter((tag) => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function normalizeX11Options(value: unknown): HostX11Options | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const options = value as Partial<HostX11Options>;

  if (!options.enabled) {
    return undefined;
  }

  return {
    enabled: true,
    autoStart: Boolean(options.autoStart),
    serverMode: options.serverMode === "custom" || options.serverCommand ? "custom" : "auto",
    serverCommand: typeof options.serverCommand === "string" && options.serverCommand.trim() ? options.serverCommand.trim() : undefined,
    displayHost: typeof options.displayHost === "string" && options.displayHost.trim() ? options.displayHost.trim() : "127.0.0.1",
    displayNumber: typeof options.displayNumber === "number" && Number.isFinite(options.displayNumber) ? Math.max(0, Math.floor(options.displayNumber)) : 0,
    screen: typeof options.screen === "number" && Number.isFinite(options.screen) ? Math.max(0, Math.floor(options.screen)) : 0,
    trusted: Boolean(options.trusted),
  };
}

function parseAntiIdle(json: string | null): { antiIdle?: AntiIdleOptions } {
  if (!json) {
    return {};
  }
  try {
    const antiIdle = normalizeHostAntiIdle(JSON.parse(json));
    return antiIdle ? { antiIdle } : {};
  } catch {
    return {};
  }
}

function parseX11Options(x11Json: string | null) {
  if (!x11Json) {
    return undefined;
  }

  try {
    return normalizeX11Options(JSON.parse(x11Json));
  } catch {
    return undefined;
  }
}

function stringifyX11Options(options: HostX11Options | undefined) {
  const normalized = normalizeX11Options(options);
  return normalized ? JSON.stringify(normalized) : null;
}

export function readSettingsObject(): Record<string, unknown> {
  const settingsPath = getSettingsPath();

  if (!fs.existsSync(settingsPath)) {
    return { version: 1 };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : { version: 1 };
  } catch {
    return { version: 1 };
  }
}

export function parseImportedFolders(value: unknown): Folder[] {
  const exportFile = typeof value === "object" && value !== null ? value as Partial<ConnectionsExportFile> : null;
  const folders = Array.isArray(exportFile?.folders) ? exportFile.folders : Array.isArray(value) ? value : null;

  if (!folders) {
    throw new Error("Invalid Shellium connections export file.");
  }

  return normalizeFolders(folders);
}

function normalizeFolders(value: unknown[]): Folder[] {
  return value.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`Invalid folder at index ${index}.`);
    }

    const folder = item as Partial<Folder>;
    const id = typeof folder.id === "string" && folder.id.trim() ? folder.id : `folder-${index}`;
    const name = typeof folder.name === "string" && folder.name.trim() ? folder.name : "Imported Folder";

    return {
      id,
      name,
      folders: Array.isArray(folder.folders) ? normalizeFolders(folder.folders) : [],
      hosts: Array.isArray(folder.hosts) ? normalizeHosts(folder.hosts) : [],
    };
  });
}

function normalizeHosts(value: unknown[]): Host[] {
  return value.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`Invalid host at index ${index}.`);
    }

    const host = item as Partial<Host>;

    if (typeof host.name !== "string" || !host.name.trim() || typeof host.hostname !== "string" || !host.hostname.trim()) {
      throw new Error(`Invalid host at index ${index}.`);
    }

    return {
      id: typeof host.id === "string" && host.id.trim() ? host.id : `host-${index}`,
      name: host.name,
      hostname: host.hostname,
      port: typeof host.port === "number" && Number.isFinite(host.port) ? host.port : 22,
      username: typeof host.username === "string" && host.username.trim() ? host.username : "root",
      password: typeof host.password === "string" ? host.password : undefined,
      description: typeof host.description === "string" ? host.description : undefined,
      tags: Array.isArray(host.tags) ? host.tags.filter((tag): tag is string => typeof tag === "string") : [],
      x11: normalizeX11Options(host.x11),
      ...(host.legacyAlgorithms === true ? { legacyAlgorithms: true } : {}),
      ...(typeof host.environmentId === "string" && host.environmentId ? { environmentId: host.environmentId } : {}),
      ...(host.favorite === true ? { favorite: true } : {}),
      ...(normalizeHostAntiIdle(host.antiIdle) ? { antiIdle: normalizeHostAntiIdle(host.antiIdle) } : {}),
      ...(schemeIdOrNull(host.terminalSchemeId) ? { terminalSchemeId: host.terminalSchemeId } : {}),
    };
  });
}
