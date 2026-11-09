import { createHash } from "node:crypto";
import fs from "node:fs";

/**
 * Trusted SSH host keys (Shellium's equivalent of OpenSSH's known_hosts), stored in the
 * known_hosts table of the connection database so they are encrypted with it. Keyed by
 * "hostname:port" so the same machine on another port is a separate identity, as in OpenSSH.
 *
 * The functions here take the open database and do not persist it; callers go through
 * withConnectionDatabase (connectionsDb.ts), which writes the file after a change.
 */

/** The part of sql.js's Database used here. */
export type KnownHostsDatabase = {
  run(sql: string, params?: unknown[]): unknown;
  exec(sql: string, params?: unknown[]): Array<{ columns: string[]; values: unknown[][] }>;
};

export type HostKeyInfo = {
  keyType: string;
  /** OpenSSH-style fingerprint, e.g. "SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s". */
  fingerprint: string;
};

export type KnownHostEntry = HostKeyInfo & {
  addedAt: string;
  lastSeenAt: string;
  /** How the key became trusted; absent for keys accepted at a connection prompt. */
  source?: "openssh-import" | "backup";
};

/** One trusted key as the Options > Security list shows it. */
export type KnownHostListItem = KnownHostEntry & {
  id: string;
  hostname: string;
  port: number;
};

export type KnownHostsMergeResult = {
  added: number;
  alreadyKnown: number;
  /** Same host:port already trusted with a different key - the existing key is kept. */
  conflicts: number;
};

export type OpenSshImportResult = KnownHostsMergeResult & {
  canceled: boolean;
  filePath?: string;
  /** Lines with hashed host names (HashKnownHosts) - the host cannot be recovered. */
  skippedHashed: number;
  /** Wildcard / negated patterns, @cert-authority / @revoked markers, unreadable lines. */
  skippedOther: number;
};

export type HostKeyCheck =
  | { status: "trusted" }
  | { status: "unknown" }
  | { status: "changed"; previous: HostKeyInfo };

export function hostKeyId(hostname: string, port: number) {
  return `${hostname.trim().toLowerCase()}:${port || 22}`;
}

/** Key type and fingerprint of a raw SSH public key blob (as ssh2's hostVerifier receives it). */
export function describeHostKey(key: Buffer): HostKeyInfo {
  let keyType = "unknown";
  if (key.length >= 4) {
    const typeLength = key.readUInt32BE(0);
    if (typeLength > 0 && typeLength < 64 && key.length >= 4 + typeLength) {
      keyType = key.subarray(4, 4 + typeLength).toString("ascii");
    }
  }
  const digest = createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
  return { keyType, fingerprint: `SHA256:${digest}` };
}

export function ensureKnownHostsTable(db: KnownHostsDatabase) {
  db.run(`
    CREATE TABLE IF NOT EXISTS known_hosts (
      id TEXT PRIMARY KEY,
      key_type TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      added_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      source TEXT
    )
  `);
}

export function readKnownHosts(db: KnownHostsDatabase): Record<string, KnownHostEntry> {
  const hosts: Record<string, KnownHostEntry> = {};
  db.exec("SELECT id, key_type, fingerprint, added_at, last_seen_at, source FROM known_hosts")[0]?.values.forEach((row) => {
    const [id, keyType, fingerprint, addedAt, lastSeenAt, source] = row as [string, string, string, string, string, string | null];
    hosts[id] = { keyType, fingerprint, addedAt, lastSeenAt, ...(source === "openssh-import" || source === "backup" ? { source } : {}) };
  });
  return hosts;
}

function readKnownHost(db: KnownHostsDatabase, id: string): HostKeyInfo | null {
  const row = db.exec("SELECT key_type, fingerprint FROM known_hosts WHERE id = ?", [id])[0]?.values[0];
  return row ? { keyType: String(row[0]), fingerprint: String(row[1]) } : null;
}

function insertKnownHost(db: KnownHostsDatabase, id: string, entry: KnownHostEntry) {
  db.run(
    "INSERT OR REPLACE INTO known_hosts (id, key_type, fingerprint, added_at, last_seen_at, source) VALUES (?, ?, ?, ?, ?, ?)",
    [id, entry.keyType, entry.fingerprint, entry.addedAt, entry.lastSeenAt, entry.source ?? null],
  );
}

export function checkHostKey(db: KnownHostsDatabase, hostname: string, port: number, key: HostKeyInfo): HostKeyCheck {
  const entry = readKnownHost(db, hostKeyId(hostname, port));
  if (!entry) {
    return { status: "unknown" };
  }
  if (entry.fingerprint === key.fingerprint) {
    return { status: "trusted" };
  }
  return { status: "changed", previous: entry };
}

export function trustHostKey(db: KnownHostsDatabase, hostname: string, port: number, key: HostKeyInfo) {
  const now = new Date().toISOString();
  insertKnownHost(db, hostKeyId(hostname, port), { ...key, addedAt: now, lastSeenAt: now });
}

export function touchHostKey(db: KnownHostsDatabase, hostname: string, port: number) {
  db.run("UPDATE known_hosts SET last_seen_at = ? WHERE id = ?", [new Date().toISOString(), hostKeyId(hostname, port)]);
}

function splitHostKeyId(id: string) {
  const separator = id.lastIndexOf(":");
  const port = Number(id.slice(separator + 1));
  return separator > 0 && Number.isInteger(port) ? { hostname: id.slice(0, separator), port } : { hostname: id, port: 22 };
}

export function listKnownHosts(db: KnownHostsDatabase): KnownHostListItem[] {
  return Object.entries(readKnownHosts(db))
    .map(([id, entry]) => ({ ...entry, id, ...splitHostKeyId(id) }))
    .sort((a, b) => a.hostname.localeCompare(b.hostname) || a.port - b.port);
}

export function removeKnownHost(db: KnownHostsDatabase, id: string) {
  if (!readKnownHost(db, id)) {
    return false;
  }
  db.run("DELETE FROM known_hosts WHERE id = ?", [id]);
  return true;
}

/** Restores the table exactly (used to roll back a failed backup import). */
export function replaceKnownHosts(db: KnownHostsDatabase, hosts: Record<string, KnownHostEntry>) {
  db.run("DELETE FROM known_hosts");
  Object.entries(hosts).forEach(([id, entry]) => insertKnownHost(db, id, entry));
}

/**
 * Adds keys for host:port pairs that are not trusted yet. A host that is already trusted keeps
 * its key even if the incoming one differs: importing must never silently replace a trusted key.
 */
export function mergeKnownHosts(db: KnownHostsDatabase, incoming: Record<string, KnownHostEntry>, source: KnownHostEntry["source"]): KnownHostsMergeResult {
  const result: KnownHostsMergeResult = { added: 0, alreadyKnown: 0, conflicts: 0 };

  Object.entries(incoming).forEach(([id, entry]) => {
    const existing = readKnownHost(db, id);
    if (!existing) {
      insertKnownHost(db, id, { ...entry, source: entry.source ?? source });
      result.added += 1;
    } else if (existing.fingerprint === entry.fingerprint) {
      result.alreadyKnown += 1;
    } else {
      result.conflicts += 1;
    }
  });

  return result;
}

/**
 * Entries of the known_hosts.json file that earlier versions kept next to the database, or null
 * when there is none. Entries are validated like a backup's: the file sat unencrypted on disk.
 */
export function readLegacyKnownHostsFile(filePath: string): Record<string, KnownHostEntry> | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as { version?: unknown; hosts?: unknown };
    return parsed?.version === 1 ? normalizeKnownHostEntries(parsed.hosts) : {};
  } catch {
    return {};
  }
}

/** Validates entries read from an untrusted source (a backup file). */
export function normalizeKnownHostEntries(value: unknown): Record<string, KnownHostEntry> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const out: Record<string, KnownHostEntry> = {};
  Object.entries(value as Record<string, unknown>).forEach(([id, raw]) => {
    const entry = raw as Partial<KnownHostEntry> | null;
    if (
      entry && typeof entry.keyType === "string" && typeof entry.fingerprint === "string"
      && /^SHA256:[A-Za-z0-9+/]{43}$/.test(entry.fingerprint) && /^[^\s:][^\s]*:\d+$/.test(id)
    ) {
      const now = new Date().toISOString();
      out[id] = {
        keyType: entry.keyType,
        fingerprint: entry.fingerprint,
        addedAt: typeof entry.addedAt === "string" ? entry.addedAt : now,
        lastSeenAt: typeof entry.lastSeenAt === "string" ? entry.lastSeenAt : now,
        ...(entry.source === "openssh-import" || entry.source === "backup" ? { source: entry.source } : {}),
      };
    }
  });
  return out;
}

/**
 * Parses an OpenSSH known_hosts file. Supports "host1,host2 type key" and "[host]:port type key";
 * skips hashed names (|1|...), wildcard / negated patterns and @cert-authority / @revoked lines.
 */
export function parseOpenSshKnownHosts(text: string) {
  const entries: Record<string, KnownHostEntry> = {};
  let skippedHashed = 0;
  let skippedOther = 0;
  const now = new Date().toISOString();

  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      return;
    }
    if (line.startsWith("@")) {
      skippedOther += 1;
      return;
    }

    const [hostField, keyType, keyBase64] = line.split(/\s+/);
    if (!hostField || !keyType || !keyBase64) {
      skippedOther += 1;
      return;
    }
    if (hostField.startsWith("|1|")) {
      skippedHashed += 1;
      return;
    }

    const blob = Buffer.from(keyBase64, "base64");
    const key = describeHostKey(blob);
    if (key.keyType !== keyType) {
      skippedOther += 1;
      return;
    }

    hostField.split(",").forEach((pattern) => {
      if (!pattern || pattern.startsWith("!") || /[*?]/.test(pattern)) {
        skippedOther += 1;
        return;
      }
      const bracketed = /^\[([^\]]+)\]:(\d+)$/.exec(pattern);
      const hostname = bracketed ? bracketed[1] : pattern;
      const port = bracketed ? Number(bracketed[2]) : 22;
      entries[hostKeyId(hostname, port)] = { ...key, addedAt: now, lastSeenAt: now, source: "openssh-import" };
    });
  });

  return { entries, skippedHashed, skippedOther };
}
