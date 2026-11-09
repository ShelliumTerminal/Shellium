import type { WebContents } from "electron";
import type { Readable, Writable } from "node:stream";
import fs from "node:fs/promises";
import net from "node:net";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { getSettingsPath } from "./storageConfig";
import { listLocalPlaces } from "./localPlaces";
import { askUser, type ConnectionPromptTarget } from "./connectionPrompts";
import { withConnectionDatabase } from "./connectionsDb";
import { checkHostKey, describeHostKey, touchHostKey, trustHostKey } from "./knownHosts";
import type { HostKeyCheck, HostKeyInfo } from "./knownHosts";
import { normalizeConnectionKeepalive } from "../src/components/common/antiIdleModel";
import type { ConnectionKeepalive } from "../src/components/common/antiIdleModel";
import {
  PROBE_COMMAND, PROTECT_OFF_MARKER, execCommand, isValidProtection, parseProbe, parseState, protectionName, runExec,
  stateCommand, stopCommand, typedAttachCommand, typedStartCommand,
} from "./sessionProtection";
import type { ProtectionOpen, ProtectionProbe, SessionProtection } from "./sessionProtection";

const require = createRequire(import.meta.url);
const { dialog, ipcMain } = require("electron") as typeof import("electron");
const { Client } = require("ssh2") as { Client: new () => SshClient };

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

type Host = {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  password?: string;
  x11?: HostX11Options;
  /** Allow SHA-1 key exchange, ssh-rsa/ssh-dss host keys, CBC ciphers (old servers only). */
  legacyAlgorithms?: boolean;
};

type TerminalConnectRequest = {
  sessionId: string;
  host: Host;
  cols: number;
  rows: number;
  /** The host's anti-idle settings merged with the Options default (resolved by the window). */
  keepalive?: ConnectionKeepalive;
  /** Protected session: a new one (tool found on the server), or attach to the one a drop left. */
  protection?: { mode: "new" } | ProtectionOpen;
};

type TerminalTranscriptSaveRequest = {
  title?: string;
  transcript?: string;
};

type TerminalRecordingStartRequest = {
  sessionId?: string;
  title?: string;
  directoryPath?: string;
};

type TerminalRecordingSession = {
  filePath: string;
  pendingWrite: Promise<void>;
  lastDirection: "input" | "output" | null;
};

type SshClient = {
  on(event: "ready", listener: () => void): SshClient;
  on(event: "banner", listener: (message: string) => void): SshClient;
  on(event: "error", listener: (error: Error) => void): SshClient;
  on(event: "keyboard-interactive", listener: KeyboardInteractiveListener): SshClient;
  on(event: "close", listener: () => void): SshClient;
  on(event: "x11", listener: X11ForwardListener): SshClient;
  connect(config: Record<string, unknown>): void;
  shell(options: Record<string, unknown>, callback: (error: Error | undefined, stream: SshStream) => void): void;
  exec(command: string, options: Record<string, unknown>, callback: (error: Error | undefined, stream: SshStream) => void): void;
  sftp(callback: (error: Error | undefined, sftp: SftpClient) => void): void;
  end(): void;
};

type KeyboardInteractiveListener = (
  name: string,
  instructions: string,
  instructionsLang: string,
  prompts: Array<{ prompt: string; echo: boolean }>,
  finish: (responses: string[]) => void,
) => void;

type X11Channel = Readable & Writable & {
  destroy(error?: Error): void;
};

type X11ForwardListener = (
  details: { srcIP: string; srcPort: number },
  accept: () => X11Channel,
  reject: () => void,
) => void;

type SshStream = {
  on(event: "data", listener: (data: Buffer) => void): SshStream;
  on(event: "exit", listener: (code: number | null, signal?: string) => void): SshStream;
  on(event: "close", listener: () => void): SshStream;
  on(event: "error", listener: (error: Error) => void): SshStream;
  write(data: string): void;
  setWindow(rows: number, cols: number, height: number, width: number): void;
  end(): void;
};


export type SftpFileAttributes = {
  size: number;
  mtime: number;
  mode: number;
  uid?: number;
  gid?: number;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
};

export type SftpDirectoryEntry = {
  filename: string;
  longname: string;
  attrs: SftpFileAttributes;
};

type SftpFastTransferOptions = {
  step?: (totalTransferred: number, chunk: number, total: number) => void;
};

export type SftpTransferProgress = {
  transferredBytes: number;
  totalBytes: number;
  percent: number;
};

export type SftpTransferController = {
  canceled: boolean;
  cancel(): void;
};

export type SftpClient = {
  readdir(remotePath: string, callback: (error: Error | undefined, entries: SftpDirectoryEntry[]) => void): void;
  realpath(remotePath: string, callback: (error: Error | undefined, resolvedPath: string) => void): void;
  fastGet(remotePath: string, localPath: string, options: SftpFastTransferOptions, callback: (error?: Error) => void): void;
  fastPut(localPath: string, remotePath: string, options: SftpFastTransferOptions, callback: (error?: Error) => void): void;
  stat(remotePath: string, callback: (error: Error | undefined, attrs: SftpFileAttributes) => void): void;
  createReadStream(remotePath: string, options?: { start?: number; end?: number }): Readable;
  createWriteStream(remotePath: string, options?: { mode?: number; flags?: string; start?: number }): Writable;
  mkdir(remotePath: string, callback: (error?: Error) => void): void;
  rename(sourcePath: string, targetPath: string, callback: (error?: Error) => void): void;
  unlink(remotePath: string, callback: (error?: Error) => void): void;
  rmdir(remotePath: string, callback: (error?: Error) => void): void;
  lstat(remotePath: string, callback: (error: Error | undefined, attrs: SftpFileAttributes) => void): void;
  chmod(remotePath: string, mode: number, callback: (error?: Error) => void): void;
  end(): void;
};

type SftpSession = {
  client: SshClient;
  sftp: SftpClient;
  cwd: string;
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
  /** Owner name as the server's `ls -l` line shows it, when available. */
  owner?: string;
};

type SftpListResult = {
  cwd: string;
  entries: SftpEntry[];
};

type LocalFileEntry = {
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
type TerminalSession = {
  client: SshClient;
  stream?: SshStream;
  webContents: WebContents;
  pendingWrites: string[];
  pendingResize?: { cols: number; rows: number };
  exitSent: boolean;
  /** Last data in either direction, for the anti-idle string. */
  lastActivityAt: number;
  /** Set while a script button waits for the server to take its last line (sendScript). */
  onScriptOutput?: (text: string) => void;
  /** Script buttons of one session run one after another. */
  scriptQueue?: Promise<void>;
  /** What the status bar shows (terminal:info). */
  info: TerminalSessionInfo;
  latencyTimer?: ReturnType<typeof setInterval>;
  /** Sent time of the latency ping still waiting for its answer. */
  pingSentAt?: number;
  antiIdleTimer?: ReturnType<typeof setInterval>;
  /** The tab's shell runs in this tmux / screen session on the server (sessionProtection.ts). */
  protection?: SessionProtection;
  /** The terminal is the tmux client of an exec channel (no shell under it): stopping protection opens a shell. */
  protectedExec?: boolean;
  stoppingProtection?: boolean;
};

/** Connection details for the status bar; read by the window once a second (terminal:info). */
export type TerminalSessionInfo = {
  term: string;
  /** When the shell opened. */
  connectedAt?: number;
  bytesIn: number;
  bytesOut: number;
  /** Round trip of the last answered keep-alive ping; undefined until the first answer. */
  latencyMs?: number;
  serverSoftware?: string;
  kex?: string;
  cipher?: string;
  mac?: string;
  compression?: string;
  hostKeyType?: string;
  hostKeyFingerprint?: string;
};

const TERMINAL_TYPE = "xterm-256color";
const LATENCY_INTERVAL_MS = 10_000;
/** A protected tab whose ping waits this long counts the connection as lost (checked at each ping). */
const PROTECTED_STALL_MS = 20_000;

const sessions = new Map<string, TerminalSession>();
const sftpSessions = new Map<string, SftpSession>();
const terminalRecordings = new Map<string, TerminalRecordingSession>();
/**
 * "closed": the user ended it (SFTP view closed, session closed) - the SFTP channel is still usable
 * while listeners run. "lost": the connection dropped by itself - the channel is already gone.
 */
export type SftpCloseReason = "closed" | "lost";
type SftpSessionClosedListener = (sessionId: string, reason: SftpCloseReason, sftp: SftpClient) => void | Promise<void>;
const sftpSessionClosedListeners: SftpSessionClosedListener[] = [];

export function onSftpSessionClosed(listener: SftpSessionClosedListener) {
  sftpSessionClosedListeners.push(listener);
}

function notifySftpSessionClosed(sessionId: string, reason: SftpCloseReason, sftp: SftpClient) {
  return Promise.all(sftpSessionClosedListeners.map((listener) => Promise.resolve(listener(sessionId, reason, sftp)).catch(() => undefined)));
}

function createTerminalTranscriptFileName(title: unknown) {
  const rawTitle = typeof title === "string" && title.trim() ? title.trim() : "terminal-session";
  const safeTitle = rawTitle.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "terminal-session";
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "");

  return safeTitle + "_" + timestamp + ".txt";
}

function stripAnsiSequences(value: string) {
  return value
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1B[@-_]/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function normalizeTranscriptChunk(value: string) {
  return stripAnsiSequences(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function appendTerminalRecording(sessionId: string, direction: "input" | "output", data: string) {
  const recording = terminalRecordings.get(sessionId);

  if (!recording || !data) {
    return;
  }

  const chunk = normalizeTranscriptChunk(data);

  if (!chunk) {
    return;
  }

  const header = recording.lastDirection === direction ? "" : "\n[" + direction.toUpperCase() + " " + new Date().toISOString() + "]\n";
  recording.lastDirection = direction;
  recording.pendingWrite = recording.pendingWrite
    .then(() => fs.appendFile(recording.filePath, header + chunk, "utf8"))
    .catch(() => undefined);
}

export class SftpTransferCanceledError extends Error {
  constructor() {
    super("SFTP transfer canceled.");
    this.name = "SftpTransferCanceledError";
  }
}

async function stopTerminalRecording(sessionId: string) {
  const recording = terminalRecordings.get(sessionId);

  if (!recording) {
    return { active: false };
  }

  terminalRecordings.delete(sessionId);
  const filePath = recording.filePath;
  await recording.pendingWrite;
  await fs.appendFile(filePath, "\n[RECORDING STOPPED " + new Date().toISOString() + "]\n", "utf8");

  return { active: false, filePath };
}

function normalizeHostX11Options(options: HostX11Options | undefined) {
  if (!options?.enabled) {
    return null;
  }

  const displayHost = typeof options.displayHost === "string" && options.displayHost.trim() ? options.displayHost.trim() : "127.0.0.1";
  const displayNumber = typeof options.displayNumber === "number" && Number.isFinite(options.displayNumber) ? Math.max(0, Math.floor(options.displayNumber)) : 0;
  const screen = typeof options.screen === "number" && Number.isFinite(options.screen) ? Math.max(0, Math.floor(options.screen)) : 0;

  return {
    enabled: true,
    autoStart: Boolean(options.autoStart),
    serverMode: options.serverMode === "custom" || options.serverCommand ? "custom" as const : "auto" as const,
    serverCommand: typeof options.serverCommand === "string" && options.serverCommand.trim() ? options.serverCommand.trim() : undefined,
    displayHost,
    displayNumber,
    displayPort: 6000 + displayNumber,
    screen,
    trusted: Boolean(options.trusted),
  };
}

type X11Endpoint =
  | { transport: "tcp"; host: string; port: number }
  | { transport: "unix"; socketPath: string };

function resolveX11Endpoint(options: NonNullable<ReturnType<typeof normalizeHostX11Options>>): X11Endpoint {
  if (process.platform === "win32") {
    return { transport: "tcp", host: options.displayHost, port: options.displayPort };
  }

  return { transport: "unix", socketPath: `/tmp/.X11-unix/X${options.displayNumber}` };
}

function connectToX11Endpoint(endpoint: X11Endpoint) {
  return endpoint.transport === "unix"
    ? net.connect(endpoint.socketPath)
    : net.connect(endpoint.port, endpoint.host);
}

function describeX11Endpoint(endpoint: X11Endpoint) {
  return endpoint.transport === "unix" ? endpoint.socketPath : `${endpoint.host}:${endpoint.port}`;
}

function isLocalDisplayReachable(endpoint: X11Endpoint, timeoutMs = 450) {
  return new Promise<boolean>((resolve) => {
    const socket = connectToX11Endpoint(endpoint);
    let settled = false;

    const finish = (result: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

type GlobalXServerSettings = {
  mode: "auto" | "manual";
  executablePath?: string;
};

function readGlobalXServerSettings(): GlobalXServerSettings {
  try {
    const settings = JSON.parse(readFileSync(getSettingsPath(), "utf8")) as { appOptions?: Record<string, unknown> };
    const appOptions = settings.appOptions;
    return {
      mode: appOptions?.x11ServerMode === "manual" ? "manual" : "auto",
      executablePath: typeof appOptions?.x11ExecutablePath === "string" && appOptions.x11ExecutablePath.trim()
        ? appOptions.x11ExecutablePath.trim()
        : undefined,
    };
  } catch {
    return { mode: "auto" };
  }
}

function startConfiguredXServer(displayNumber: number) {
  const settings = readGlobalXServerSettings();

  if (settings.mode === "manual") {
    if (!settings.executablePath) {
      throw new Error("No X server executable is selected. Configure one in Options > X11");
    }
    if (!existsSync(settings.executablePath)) {
      throw new Error("The configured X server executable does not exist. Update it in Options > X11");
    }

    const args = process.platform === "win32" ? [`:${displayNumber}`, "-multiwindow", "-clipboard"] : [`:${displayNumber}`];
    const child = spawn(settings.executablePath, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    return path.basename(settings.executablePath);
  }

  if (process.platform === "darwin") {
    const child = spawn("open", ["-a", "XQuartz"], { detached: true, stdio: "ignore" });
    child.unref();
    return "XQuartz";
  }

  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\VcXsrv\\vcxsrv.exe",
      "C:\\Program Files (x86)\\VcXsrv\\vcxsrv.exe",
      "C:\\Program Files\\Xming\\Xming.exe",
      "C:\\Program Files (x86)\\Xming\\Xming.exe",
    ];
    const executable = candidates.find((candidate) => existsSync(candidate));

    if (!executable) {
      throw new Error("VcXsrv or Xming was not found. Select it in Options > X11");
    }

    const child = spawn(executable, [`:${displayNumber}`, "-multiwindow", "-clipboard"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return path.basename(executable);
  }

  return null;
}

function attachX11Forwarding(client: SshClient, sessionId: string, options: NonNullable<ReturnType<typeof normalizeHostX11Options>>) {
  const endpoint = resolveX11Endpoint(options);

  client.on("x11", (_details, accept, reject) => {
    const socket = connectToX11Endpoint(endpoint);
    let channel: X11Channel | null = null;
    let accepted = false;

    socket.once("connect", () => {
      accepted = true;
      channel = accept();
      channel.on("error", () => socket.destroy());
      socket.on("error", () => channel?.destroy());
      channel.pipe(socket).pipe(channel);
    });

    socket.once("error", (error) => {
      if (!accepted) {
        reject();
        sendData(sessionId, "X11 forwarding error: cannot connect to local display " + describeX11Endpoint(endpoint) + " (" + error.message + ")\r\n");
        return;
      }

      channel?.destroy();
    });
  });
}

// Modern defaults, in line with OpenSSH 9's client defaults.
const modernAlgorithms = {
  kex: [
    "curve25519-sha256",
    "curve25519-sha256@libssh.org",
    "ecdh-sha2-nistp256",
    "ecdh-sha2-nistp384",
    "ecdh-sha2-nistp521",
    "diffie-hellman-group-exchange-sha256",
    "diffie-hellman-group14-sha256",
  ],
  serverHostKey: [
    "ssh-ed25519",
    "ecdsa-sha2-nistp256",
    "ecdsa-sha2-nistp384",
    "ecdsa-sha2-nistp521",
    "rsa-sha2-512",
    "rsa-sha2-256",
  ],
  cipher: ["aes128-gcm", "aes256-gcm", "aes128-ctr", "aes192-ctr", "aes256-ctr"],
  hmac: ["hmac-sha2-256", "hmac-sha2-512", "hmac-sha1"],
};

// Old servers (e.g. legacy AIX/RHEL) - only used for hosts the user explicitly allowed.
const legacyAlgorithms = {
  kex: [
    ...modernAlgorithms.kex,
    "diffie-hellman-group-exchange-sha1",
    "diffie-hellman-group14-sha1",
    "diffie-hellman-group1-sha1",
  ],
  serverHostKey: [...modernAlgorithms.serverHostKey, "ssh-rsa", "ssh-dss"],
  cipher: [...modernAlgorithms.cipher, "aes128-cbc", "aes256-cbc", "3des-cbc"],
  hmac: [...modernAlgorithms.hmac, "hmac-md5"],
};

const handshakeTimeoutMs = 20_000;

function isAlgorithmNegotiationError(error: Error) {
  return error.message.startsWith("Handshake failed: no matching");
}

function promptTarget(host: Host): ConnectionPromptTarget {
  return { hostId: host.id, name: host.name, hostname: host.hostname, port: host.port, username: host.username };
}

/**
 * Host key verification plus a handshake timeout that pauses while the user is answering a
 * host key question (ssh2's own readyTimeout would count that time and kill the connection).
 */
function createConnectionGuard(sender: WebContents, host: Host, onTimeout: () => void, onHostKey?: (info: HostKeyInfo) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let remaining = handshakeTimeoutMs;
  let startedAt = Date.now();
  let hostKeyRejected: "unknown" | "changed" | null = null;

  const start = () => {
    startedAt = Date.now();
    timer = setTimeout(onTimeout, Math.max(remaining, 1_000));
  };
  const pause = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
      remaining -= Date.now() - startedAt;
    }
  };
  start();

  const hostVerifier = (key: Buffer, verify: (valid: boolean) => void) => {
    const info = describeHostKey(key);
    onHostKey?.(info);
    // Trusted keys live in the connection database; a trusted host only gets its "last seen" updated.
    withConnectionDatabase((db) => {
      const check = checkHostKey(db, host.hostname, host.port, info);
      if (check.status === "trusted") {
        touchHostKey(db, host.hostname, host.port);
      }
      return check;
    }, { persist: true }).then(
      (check) => (check.status === "trusted" ? verify(true) : askAboutHostKey(info, check, verify)),
      (error: unknown) => {
        console.error("Host key check failed:", error);
        verify(false);
      },
    );
  };

  const askAboutHostKey = (info: HostKeyInfo, check: Exclude<HostKeyCheck, { status: "trusted" }>, verify: (valid: boolean) => void) => {
    pause();
    const prompt = check.status === "unknown"
      ? { kind: "host-key-new" as const, key: info, ...promptTarget(host) }
      : { kind: "host-key-changed" as const, key: info, previous: check.previous, ...promptTarget(host) };
    askUser(sender, prompt).then((decision) => {
      const accepted = decision === "trust" || (decision === "once" && check.status === "unknown");
      if (!accepted) {
        hostKeyRejected = check.status;
      }
      const saved = decision === "trust"
        ? withConnectionDatabase((db) => trustHostKey(db, host.hostname, host.port, info), { persist: true })
        : Promise.resolve();
      // The user accepted the key: connect even if saving it failed (they will be asked again next time).
      saved.catch((error: unknown) => console.error("Could not save the trusted host key:", error)).finally(() => {
        start();
        verify(accepted);
      });
    });
  };

  return {
    hostVerifier,
    stop: () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
    hostKeyRejection: () => hostKeyRejected,
  };
}

function hostKeyRejectionMessage(reason: "unknown" | "changed") {
  return reason === "changed"
    ? "Connection refused: the server's host key has CHANGED since you last connected. This can mean a reinstalled server - or someone intercepting the connection. Verify the new fingerprint with the server owner before accepting it."
    : "Connection cancelled: the server's host key was not accepted.";
}

// Hosts the user said "always" for during this run. The renderer persists the flag on the host,
// but already-open tabs keep their old host object - this stops them asking again on reconnect.
const legacyAllowedHostIds = new Set<string>();

function legacyAllowed(host: Host) {
  return Boolean(host.legacyAlgorithms) || legacyAllowedHostIds.has(host.id);
}

async function askForLegacyAlgorithms(sender: WebContents, host: Host, error: Error) {
  const decision = await askUser(sender, { kind: "legacy-algorithms", detail: error.message, ...promptTarget(host) });
  if (decision === "always") {
    legacyAllowedHostIds.add(host.id);
  }
  return decision === "once" || decision === "always";
}

export function registerTerminalHandlers() {
  ipcMain.handle("terminal:connect", async (event, request: TerminalConnectRequest) => {
    disconnectSession(request.sessionId);

    const password = request.host.password;

    if (!request.host.hostname.trim() || !request.host.username.trim()) {
      sendDirect(event.sender, request.sessionId, "Missing hostname or username.\r\n");
      sendDirectExit(event.sender, request.sessionId, "Missing connection information");
      return;
    }

    if (!password || password.length === 0) {
      sendDirect(event.sender, request.sessionId, "Password is required for SSH password authentication.\r\n");
      sendDirectExit(event.sender, request.sessionId, "Missing password");
      return;
    }

    await startTerminalConnection(event.sender, request, password, legacyAllowed(request.host));
  });

  async function startTerminalConnection(
    sender: WebContents,
    request: TerminalConnectRequest,
    password: string,
    allowLegacy: boolean,
  ) {
    const client = new Client();
    const x11Options = normalizeHostX11Options(request.host.x11);
    const lowLatencyClient = client as unknown as {
      on(event: "connect", listener: () => void): void;
      setNoDelay(noDelay?: boolean): void;
    };

    lowLatencyClient.on("connect", () => {
      lowLatencyClient.setNoDelay(true);
    });
    let reportedFailure = false;
    let isReady = false;
    // While the user decides on legacy algorithms the dead client's "close" must not tear the
    // session down - the retry reuses the same session id.
    let awaitingLegacyDecision = false;
    const keepalive = normalizeConnectionKeepalive(request.keepalive);
    const terminalSession: TerminalSession = {
      client,
      webContents: sender,
      pendingWrites: [],
      exitSent: false,
      lastActivityAt: Date.now(),
      info: { term: TERMINAL_TYPE, bytesIn: 0, bytesOut: 0 },
    };
    sessions.set(request.sessionId, terminalSession);

    if (x11Options) {
      attachX11Forwarding(client, request.sessionId, x11Options);
      if (x11Options.autoStart) {
        const endpoint = resolveX11Endpoint(x11Options);
        const localDisplayRunning = await isLocalDisplayReachable(endpoint);

        if (localDisplayRunning) {
          sendData(request.sessionId, "X11 local display is already running on " + describeX11Endpoint(endpoint) + ".\r\n");
        } else {
          try {
            const detectedServer = startConfiguredXServer(x11Options.displayNumber);
            if (detectedServer) {
              sendData(request.sessionId, "Starting " + detectedServer + ".\r\n");
            } else {
              sendData(request.sessionId, "No local X display was detected. Start Xorg or XWayland, then reconnect.\r\n");
            }
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Unknown X server start error";
            sendData(request.sessionId, "X11 local server start failed: " + message + "\r\n");
          }
        }
      }
    }

    // "handshake" (the negotiated algorithms) is missing from @types/ssh2.
    (client as unknown as {
      on(event: "handshake", listener: (negotiated: { kex: string; cs: { cipher: string; mac: string; compress: string } }) => void): void;
    }).on("handshake", (negotiated) => {
      Object.assign(terminalSession.info, {
        kex: negotiated.kex,
        cipher: negotiated.cs.cipher,
        mac: negotiated.cs.mac,
        compression: negotiated.cs.compress,
      });
    });

    client
      .on("banner", (message) => {
        if (isCurrentSession(request.sessionId, terminalSession)) {
          sendData(request.sessionId, `\r\n${message}\r\n`);
        }
      })
      .on("ready", () => {
        guard.stop();
        if (!isCurrentSession(request.sessionId, terminalSession)) {
          return;
        }

        isReady = true;
        sendData(request.sessionId, `Connected to ${request.host.name}\r\n`);

        const x11Request = (enableX11: boolean) => (enableX11 && x11Options ? { x11: { screen: x11Options.screen } } : {});

        /** Data / close handling of the terminal's channel: a shell, or the tmux client of an exec channel. */
        const wireStream = (stream: SshStream, onEnd?: (exitCode: number | null) => boolean) => {
          let exitCode: number | null = null;
          let exitSeen = false;
          terminalSession.stream = stream;
          terminalSession.lastActivityAt = Date.now();
          flushPendingResize(terminalSession);
          flushPendingWrites(terminalSession);
          startAntiIdle(terminalSession, keepalive);
          terminalSession.info.connectedAt = Date.now();
          terminalSession.info.serverSoftware = (client as unknown as { _remoteVer?: string })._remoteVer;
          startLatencyPings(request.sessionId, terminalSession);
          stream
            .on("data", (data: Buffer) => {
              if (isCurrentSession(request.sessionId, terminalSession) && terminalSession.stream === stream) {
                terminalSession.lastActivityAt = Date.now();
                terminalSession.info.bytesIn += data.length;
                let text = data.toString("utf8");
                if (text.includes(PROTECT_OFF_MARKER)) {
                  // the tmux / screen session typed into this shell ended: back in the plain shell
                  text = text.split(PROTECT_OFF_MARKER).join("");
                  terminalSession.protection = undefined;
                  sendProtection(request.sessionId, null);
                }
                terminalSession.onScriptOutput?.(text);
                if (text) {
                  sendData(request.sessionId, text);
                }
              }
            })
            .on("exit", (code) => {
              exitSeen = true;
              exitCode = code;
            })
            .on("close", () => {
              if (!isCurrentSession(request.sessionId, terminalSession) || terminalSession.stream !== stream) {
                return;
              }
              if (onEnd?.(exitSeen ? exitCode : null)) {
                return;
              }
              // no exit status from the server: the channel died with the connection
              sendExit(request.sessionId, exitSeen ? "Shell closed" : "SSH connection lost", !exitSeen);
              disconnectSession(request.sessionId);
            })
            .on("error", (streamError) => {
              if (isCurrentSession(request.sessionId, terminalSession)) {
                sendExit(request.sessionId, `Stream error: ${streamError.message}`, true);
                disconnectSession(request.sessionId);
              }
            });
        };

        const openShell = (enableX11: boolean) => {
          client.shell(
            {
              term: TERMINAL_TYPE,
              cols: request.cols,
              rows: request.rows,
              ...x11Request(enableX11),
            },
            (error, stream) => {
              if (!isCurrentSession(request.sessionId, terminalSession)) {
                stream?.end();
                return;
              }

              if (error) {
                if (enableX11 && x11Options && error.message.includes("Unable to request X11")) {
                  sendData(request.sessionId, "X11 forwarding request was rejected by the SSH server. Opening shell without X11.\r\n");
                  openShell(false);
                  return;
                }

                sendExit(request.sessionId, `Shell error: ${error.message}`);
                disconnectSession(request.sessionId);
                return;
              }

              if (enableX11 && x11Options) {
                sendData(request.sessionId, "X11 forwarding active: " + x11Options.displayHost + ":" + x11Options.displayNumber + "." + x11Options.screen + "\r\n");
              }

              terminalSession.protectedExec = false;
              wireStream(stream);
            },
          );
        };

        /** tmux / screen on an exec channel with a pty: a new protected session, or back into the one a drop left. */
        const openProtected = async (enableX11: boolean) => {
          const wanted = request.protection!;
          let open: ProtectionOpen;
          if (wanted.mode === "attach") {
            open = wanted;
          } else {
            let probe: ProtectionProbe;
            try {
              probe = parseProbe(await runExec(client, PROBE_COMMAND));
            } catch {
              probe = { tool: null, orphans: [] };
            }
            if (!isCurrentSession(request.sessionId, terminalSession)) {
              return;
            }
            if (!probe.tool) {
              sendData(request.sessionId, "\x1b[33mThis server has neither tmux nor screen: the session is NOT protected.\x1b[0m\r\n");
              sendProtection(request.sessionId, null, "This server has neither tmux nor screen: the session is not protected.");
              openShell(enableX11);
              return;
            }
            open = { tool: probe.tool, name: protectionName(request.sessionId), mode: "new" };
          }
          client.exec(
            execCommand(open),
            { pty: { term: TERMINAL_TYPE, cols: request.cols, rows: request.rows }, ...x11Request(enableX11) },
            (error, stream) => {
              if (!isCurrentSession(request.sessionId, terminalSession)) {
                stream?.end();
                return;
              }
              if (error) {
                sendData(request.sessionId, `\x1b[33mCould not start ${open.tool}: ${error.message}. Opening a normal shell.\x1b[0m\r\n`);
                sendProtection(request.sessionId, null, `Could not start ${open.tool}: the session is not protected.`);
                openShell(enableX11);
                return;
              }
              const openedAt = Date.now();
              terminalSession.protection = { tool: open.tool, name: open.name };
              terminalSession.protectedExec = true;
              terminalSession.stoppingProtection = false;
              sendProtection(request.sessionId, terminalSession.protection);
              wireStream(stream, (exitCode) => {
                if (terminalSession.stoppingProtection) {
                  // protection switched off: the tmux session is gone, carry on in a plain shell
                  terminalSession.protection = undefined;
                  terminalSession.stoppingProtection = false;
                  stopAntiIdle(terminalSession);
                  stopLatencyPings(terminalSession);
                  sendProtection(request.sessionId, null);
                  openShell(enableX11);
                  return true;
                }
                if (open.mode === "attach" && exitCode !== null && exitCode !== 0 && Date.now() - openedAt < 5000) {
                  // the session is not on the server any more (rebooted, or it was ended there)
                  terminalSession.protection = undefined;
                  stopAntiIdle(terminalSession);
                  stopLatencyPings(terminalSession);
                  sendData(request.sessionId, "\r\n\x1b[33mThe protected session is no longer on the server (restarted, or ended there). Opening a normal shell.\x1b[0m\r\n");
                  sendProtection(request.sessionId, null, "The protected session was no longer on the server: this is a new, unprotected shell.");
                  openShell(enableX11);
                  return true;
                }
                return false;
              });
            },
          );
        };

        if (request.protection) {
          void openProtected(Boolean(x11Options));
        } else {
          openShell(Boolean(x11Options));
        }
      })
      .on("keyboard-interactive", (_name, _instructions, _instructionsLang, prompts, finish) => {
        if (prompts.length > 0) {
          finish(prompts.map(() => password));
        } else {
          finish([]);
        }
      })
      .on("error", (error) => {
        reportedFailure = true;
        guard.stop();
        if (!isCurrentSession(request.sessionId, terminalSession)) {
          return;
        }

        const rejection = guard.hostKeyRejection();
        if (rejection) {
          sendExit(request.sessionId, hostKeyRejectionMessage(rejection));
          disconnectSession(request.sessionId);
          return;
        }

        if (!allowLegacy && isAlgorithmNegotiationError(error)) {
          awaitingLegacyDecision = true;
          askForLegacyAlgorithms(sender, request.host, error).then((allowed) => {
            awaitingLegacyDecision = false;
            if (!isCurrentSession(request.sessionId, terminalSession)) {
              return;
            }
            if (allowed) {
              sendData(request.sessionId, "Server requires legacy SSH algorithms - reconnecting with them enabled.\r\n");
              void startTerminalConnection(sender, request, password, true);
            } else {
              sendExit(request.sessionId, `${formatSshError(error)} (the server only offers legacy algorithms)`);
              disconnectSession(request.sessionId);
            }
          });
          return;
        }

        sendExit(request.sessionId, formatSshError(error), isReady || isNetworkError(error));
        disconnectSession(request.sessionId);
      })
      .on("close", () => {
        if (!isCurrentSession(request.sessionId, terminalSession) || awaitingLegacyDecision) {
          return;
        }

        if (!reportedFailure) {
          sendExit(
            request.sessionId,
            isReady ? "SSH connection closed" : "SSH connection closed before authentication completed",
            // closed before authentication is a network / server problem too (a refused password errors instead)
            true,
          );
        }
        stopAntiIdle(terminalSession);
        stopLatencyPings(terminalSession);
        stopTerminalRecording(request.sessionId).catch(() => undefined);
        sessions.delete(request.sessionId);
      });

    const guard = createConnectionGuard(sender, request.host, () => {
      if (!isReady && isCurrentSession(request.sessionId, terminalSession)) {
        reportedFailure = true;
        sendExit(request.sessionId, "SSH error: Timed out while waiting for handshake", true);
        disconnectSession(request.sessionId);
      }
    }, (key) => {
      terminalSession.info.hostKeyType = key.keyType;
      terminalSession.info.hostKeyFingerprint = key.fingerprint;
    });

    client.connect({
      host: request.host.hostname,
      port: request.host.port,
      username: request.host.username,
      password,
      tryKeyboard: true,
      // Our own guard enforces the 20s handshake timeout (paused while the user answers a host
      // key question); this is only an outer safety net.
      readyTimeout: 10 * 60_000,
      // Anti-idle "NO-OP": a keep-alive every N seconds (0 = off); after keepaliveCountMax
      // unanswered ones ssh2 drops the connection and the tab turns red.
      keepaliveInterval: keepalive.keepaliveIntervalMs,
      keepaliveCountMax: keepalive.keepaliveCountMax,
      algorithms: allowLegacy ? legacyAlgorithms : modernAlgorithms,
      hostVerifier: guard.hostVerifier,
    });
  }

  ipcMain.handle("terminal:info", (_event, sessionId: unknown): TerminalSessionInfo | null => {
    const session = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
    if (!session) {
      return null;
    }
    // A ping unanswered for two rounds: the link is stalling, the old number would be misleading.
    const stalled = session.pingSentAt !== undefined && Date.now() - session.pingSentAt > LATENCY_INTERVAL_MS * 2;
    return { ...session.info, latencyMs: stalled ? undefined : session.info.latencyMs };
  });

  ipcMain.handle("terminal:write", async (_event, sessionId: string, data: string) => {
    writeToSession(sessionId, data);
  });

  ipcMain.on("terminal:write", (_event, sessionId: string, data: string) => {
    writeToSession(sessionId, data);
  });

  ipcMain.handle("terminal:sendScript", async (_event, sessionId: unknown, parts: unknown) => {
    if (typeof sessionId !== "string" || !Array.isArray(parts)) {
      throw new Error("Invalid script");
    }
    const valid = parts.flatMap((part: unknown): ScriptPart[] => {
      const candidate = part as { kind?: unknown; value?: unknown } | null;
      if (candidate?.kind === "pause") {
        return [{ kind: "pause" }];
      }
      if (candidate?.kind === "text" && typeof candidate.value === "string") {
        return [{ kind: "text", value: candidate.value.slice(0, 100_000) }];
      }
      return [];
    });
    await sendScript(sessionId, valid);
  });
  ipcMain.handle("terminal:resize", async (_event, sessionId: string, cols: number, rows: number) => {
    const session = sessions.get(sessionId);

    if (!session) {
      return;
    }

    session.pendingResize = { cols, rows };
    flushPendingResize(session);
  });

  ipcMain.handle("terminal:disconnect", async (_event, sessionId: string) => {
    disconnectSession(sessionId);
  });

  // ---- protected sessions (sessionProtection.ts)
  const connectedSession = (sessionId: unknown) => {
    const session = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
    if (!session?.stream) {
      throw new Error("The session is not connected");
    }
    return session;
  };

  ipcMain.handle("terminal:protectProbe", async (_event, sessionId: unknown): Promise<ProtectionProbe> => {
    const session = connectedSession(sessionId);
    const probe = parseProbe(await runExec(session.client, PROBE_COMMAND));
    // this tab's own session is not "left on the server"
    return { ...probe, orphans: probe.orphans.filter((o) => o.name !== session.protection?.name) };
  });

  ipcMain.handle("terminal:protectStart", async (_event, sessionId: unknown, target: unknown, adopt: unknown) => {
    const session = connectedSession(sessionId);
    if (!isValidProtection(target)) {
      throw new Error("Invalid protected session");
    }
    if (session.protection) {
      return session.protection;
    }
    const protection: SessionProtection = { tool: target.tool, name: target.name };
    // Ctrl+U first: whatever was typed on the prompt line would otherwise run in front of the command
    writeToSession(sessionId as string, "\x15" + (adopt === true ? typedAttachCommand(protection) : typedStartCommand(protection)) + "\r");
    session.protection = protection;
    session.protectedExec = false;
    sendProtection(sessionId as string, protection);
    return protection;
  });

  ipcMain.handle("terminal:protectState", async (_event, sessionId: unknown) => {
    const session = connectedSession(sessionId);
    if (!session.protection) {
      return { alive: false, running: null };
    }
    return parseState(session.protection, await runExec(session.client, stateCommand(session.protection)));
  });

  ipcMain.handle("terminal:protectStop", async (_event, sessionId: unknown) => {
    const session = connectedSession(sessionId);
    const protection = session.protection;
    if (!protection) {
      return;
    }
    // exec mode: the channel closes when tmux goes; wireStream's onEnd opens a plain shell instead of ending the tab
    session.stoppingProtection = session.protectedExec === true;
    await runExec(session.client, stopCommand(protection));
  });
  ipcMain.handle("terminal:protectionName", (_event, sessionId: unknown) => (typeof sessionId === "string" ? protectionName(sessionId) : null));
  ipcMain.handle("terminal:saveTranscript", async (_event, request: TerminalTranscriptSaveRequest) => {
    const transcript = typeof request?.transcript === "string" ? request.transcript : "";

    if (!transcript.trim()) {
      throw new Error("Terminal transcript is empty.");
    }

    const result = await dialog.showSaveDialog({
      title: "Save Terminal Output",
      defaultPath: createTerminalTranscriptFileName(request?.title),
      filters: [
        { name: "Text files", extensions: ["txt"] },
        { name: "All files", extensions: ["*"] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    await fs.writeFile(result.filePath, transcript.endsWith("\n") ? transcript : transcript + "\n", "utf8");
    return { canceled: false, filePath: result.filePath };
  });
  ipcMain.handle("terminal:startRecording", async (_event, request: TerminalRecordingStartRequest) => {
    const sessionId = typeof request?.sessionId === "string" ? request.sessionId : "";

    if (!sessionId) {
      throw new Error("Session id is required.");
    }

    const existing = terminalRecordings.get(sessionId);

    if (existing) {
      return { canceled: false, active: true, filePath: existing.filePath };
    }

    const directoryPath = typeof request?.directoryPath === "string" ? request.directoryPath.trim() : "";

    if (!directoryPath) {
      throw new Error("Choose a terminal recording folder in Tools > Options > General.");
    }

    await fs.mkdir(directoryPath, { recursive: true });
    const filePath = path.join(directoryPath, createTerminalTranscriptFileName(request?.title));
    await fs.writeFile(filePath, "[RECORDING STARTED " + new Date().toISOString() + "]\n", "utf8");
    terminalRecordings.set(sessionId, { filePath, pendingWrite: Promise.resolve(), lastDirection: null });

    return { canceled: false, active: true, filePath };
  });

  ipcMain.handle("terminal:stopRecording", async (_event, sessionId: string) => {
    return stopTerminalRecording(sessionId);
  });
  ipcMain.handle("sftp:connect", async (event, request: SftpConnectRequest) => {
    // A live channel is reused: reconnecting must not cut transfers that are still running.
    const existing = sftpSessions.get(request.sessionId);
    if (existing) {
      return { cwd: existing.cwd };
    }

    const password = request.host.password;

    if (!request.host.hostname.trim() || !request.host.username.trim()) {
      throw new Error("Missing hostname or username.");
    }

    if (!password || password.length === 0) {
      throw new Error("Password is required for SFTP password authentication.");
    }

    const client = await connectSftpClient(event.sender, request.host, password, legacyAllowed(request.host));
    const sftp = await openSftp(client).catch((error: unknown) => {
      client.end();
      throw error;
    });
    const cwd = await resolveRemotePath(sftp, ".");

    sftpSessions.set(request.sessionId, { client, sftp, cwd });
    // A dropped connection (keepalive gives up after ~45 s) frees the slot, so the next connect
    // opens a new channel, and lets running transfers pause instead of failing.
    client.on("close", () => {
      if (sftpSessions.get(request.sessionId)?.client === client) {
        sftpSessions.delete(request.sessionId);
        notifySftpSessionClosed(request.sessionId, "lost", sftp).catch(() => undefined);
      }
    });
    return { cwd };
  });

  ipcMain.handle("sftp:list", async (_event, sessionId: string, remotePath?: string): Promise<SftpListResult> => {
    const session = getSftpSession(sessionId);
    const cwd = await resolveRemotePath(session.sftp, remotePath ?? session.cwd);
    const entries = await readRemoteDirectory(session.sftp, cwd);

    session.cwd = cwd;
    return { cwd, entries };
  });

  ipcMain.handle("sftp:disconnect", async (_event, sessionId: string) => {
    await disconnectSftpSession(sessionId);
  });

  ipcMain.handle("sftp:mkdir", async (_event, sessionId: string, remoteDirectory: string, folderName: string) => {
    const session = getSftpSession(sessionId);
    const remotePath = joinRemotePath(remoteDirectory, normalizeRemoteName(folderName));

    await createRemoteDirectory(session.sftp, remotePath);
    return { path: remotePath };
  });

  ipcMain.handle("sftp:rename", async (_event, sessionId: string, remotePath: string, newName: string) => {
    const session = getSftpSession(sessionId);
    const targetPath = joinRemotePath(getRemoteDirectoryName(remotePath), normalizeRemoteName(newName));

    await renameRemoteEntry(session.sftp, remotePath, targetPath);
    return { path: targetPath };
  });

  ipcMain.handle("localFiles:list", async (_event, localPath?: string): Promise<LocalFileListResult> => {
    return readLocalDirectory(localPath);
  });

  ipcMain.handle("localFiles:places", () => listLocalPlaces());

  ipcMain.handle("localFiles:chooseDirectory", async (): Promise<{ canceled: boolean; filePath?: string }> => {
    const result = await dialog.showOpenDialog({
      title: "Choose local folder",
      properties: ["openDirectory"],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    return { canceled: false, filePath: result.filePaths[0] };
  });
}

type ScriptPart = { kind: "text"; value: string } | { kind: "pause" };

/** Splits text after every line ending (CR LF, CR or LF), the ending stays on its line. */
function splitScriptLines(text: string) {
  return text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];
}

const SCRIPT_GRACE_MS = 20; // after the echoed line end: the shell restores the tty mode right after it
const SCRIPT_NO_ECHO_MS = 500; // no line end echoed (password prompt, echo off): go on anyway

/**
 * Script buttons are sent line by line, like a person typing. Sent at once, the lines after a
 * command that starts a program (`sqlplus / as sysdba`) arrive while bash still has the tty in raw
 * mode; their CRs are then no line endings and the program reads the rest as one line
 * (SP2-0158 / SP2-0268). So after each line end the next line waits until the server has echoed
 * a line end (bash / the tty print CR LF once they took the line), at most SCRIPT_NO_ECHO_MS.
 * Buttons of one session run one after another; a pause part (\p) waits one second.
 */
function sendScript(sessionId: string, parts: ScriptPart[]) {
  const session = sessions.get(sessionId);
  if (!session) {
    return Promise.resolve();
  }
  const run = async () => {
    const lines: Array<string | null> = []; // null = pause
    for (const part of parts) {
      if (part.kind === "pause") {
        lines.push(null);
      } else {
        lines.push(...splitScriptLines(part.value));
      }
    }
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (sessions.get(sessionId) !== session) {
        return;
      }
      if (line === null) {
        await delay(1000);
        continue;
      }
      const next = lines[index + 1];
      if (/[\r\n]$/.test(line) && next !== undefined && next !== null) {
        await sendLineAndWaitForEcho(session, sessionId, line);
      } else {
        writeToSession(sessionId, line);
      }
    }
  };
  const result = (session.scriptQueue ?? Promise.resolve()).then(run);
  session.scriptQueue = result.catch(() => undefined);
  return result;
}

function sendLineAndWaitForEcho(session: TerminalSession, sessionId: string, line: string) {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (wait: number) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      session.onScriptOutput = undefined;
      setTimeout(resolve, wait);
    };
    const timer = setTimeout(() => finish(0), SCRIPT_NO_ECHO_MS);
    session.onScriptOutput = (text) => {
      if (text.includes("\n")) {
        finish(SCRIPT_GRACE_MS);
      }
    };
    writeToSession(sessionId, line);
  });
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function writeToSession(sessionId: string, data: string) {
  const session = sessions.get(sessionId);

  if (!session || !data) {
    return;
  }

  appendTerminalRecording(sessionId, "input", data);
  session.info.bytesOut += Buffer.byteLength(data, "utf8");
  session.lastActivityAt = Date.now();

  if (session.stream) {
    session.stream.write(data);
    return;
  }

  session.pendingWrites.push(data);
}
/**
 * Anti-idle "string": after N seconds without traffic in either direction the configured text is
 * written to the shell (it reaches whatever program runs there - the user opted in).
 */
function startAntiIdle(session: TerminalSession, keepalive: ConnectionKeepalive) {
  stopAntiIdle(session);
  const antiIdle = keepalive.antiIdle;
  if (!antiIdle) {
    return;
  }
  session.antiIdleTimer = setInterval(() => {
    if (!session.stream || Date.now() - session.lastActivityAt < antiIdle.seconds * 1000) {
      return;
    }
    session.lastActivityAt = Date.now();
    session.stream.write(antiIdle.text);
  }, 1000);
}

/**
 * Latency for the status bar: every LATENCY_INTERVAL_MS a "keepalive@openssh.com" global request,
 * the same packet ssh2's keep-alive sends; the server answers it inside the SSH protocol, nothing
 * runs on the server. ssh2 has no public API for it: the reply pops the first callback of
 * client._callbacks (global-request replies come back in order), so ours is queued right before
 * the ping, like ssh2's own keep-alive does. Only one ping is ever outstanding; a server that never
 * answers just stops the measurements. Missing internals (another ssh2 version): no latency shown.
 */
function startLatencyPings(sessionId: string, session: TerminalSession) {
  stopLatencyPings(session);
  const client = session.client as unknown as { _callbacks?: Array<(failed: boolean) => void>; _protocol?: { ping?: () => void } };
  const ping = () => {
    if (sessions.get(sessionId) !== session) {
      stopLatencyPings(session);
      return;
    }
    // A protected tab does not wait for the keep-alive (60 s x 3 by default) to notice a dead link: a
    // ping unanswered this long ends the connection, and the tab reconnects into its tmux session.
    if (session.protection && session.pingSentAt !== undefined && Date.now() - session.pingSentAt > PROTECTED_STALL_MS) {
      sendExit(sessionId, `No answer from the server for ${Math.round((Date.now() - session.pingSentAt) / 1000)} s - connection lost`, true);
      disconnectSession(sessionId);
      return;
    }
    if (session.pingSentAt !== undefined || !Array.isArray(client._callbacks) || typeof client._protocol?.ping !== "function") {
      return;
    }
    const sentAt = Date.now();
    session.pingSentAt = sentAt;
    client._callbacks.push(() => {
      session.info.latencyMs = Date.now() - sentAt;
      session.pingSentAt = undefined;
    });
    try {
      client._protocol.ping();
    } catch {
      client._callbacks.pop();
      session.pingSentAt = undefined;
    }
  };
  ping();
  session.latencyTimer = setInterval(ping, LATENCY_INTERVAL_MS);
}

function stopLatencyPings(session: TerminalSession) {
  if (session.latencyTimer) {
    clearInterval(session.latencyTimer);
    session.latencyTimer = undefined;
  }
}

function stopAntiIdle(session: TerminalSession) {
  if (session.antiIdleTimer) {
    clearInterval(session.antiIdleTimer);
    session.antiIdleTimer = undefined;
  }
}

function disconnectSession(sessionId: string) {
  const session = sessions.get(sessionId);

  if (!session) {
    return;
  }

  stopAntiIdle(session);
  stopLatencyPings(session);
  disconnectSftpSession(sessionId).catch(() => undefined);
  stopTerminalRecording(sessionId).catch(() => undefined);
  session.stream?.end();
  session.client.end();
  sessions.delete(sessionId);
}

async function disconnectSftpSession(sessionId: string) {
  const session = sftpSessions.get(sessionId);

  if (!session) {
    return;
  }

  sftpSessions.delete(sessionId);
  // Queued, running and paused transfers and remote files open for editing end with the
  // connection; listeners get a few seconds to remove temporary files over the still open channel.
  await Promise.race([
    notifySftpSessionClosed(sessionId, "closed", session.sftp),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);

  session.sftp.end();
  session.client.end();
}

export function getSftpSessionOrNull(sessionId: string) {
  return sftpSessions.get(sessionId) ?? null;
}

export function getSftpSession(sessionId: string) {
  const session = sftpSessions.get(sessionId);

  if (!session) {
    throw new Error("SFTP session is not connected.");
  }

  return session;
}

function connectSftpClient(sender: WebContents, host: Host, password: string, allowLegacy: boolean): Promise<SshClient> {
  return new Promise<SshClient>((resolve, reject) => {
    const client = new Client();
    let settled = false;

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      guard.stop();
      callback();
    };

    const guard = createConnectionGuard(sender, host, () => {
      settle(() => reject(new Error("SSH error: Timed out while waiting for handshake")));
      client.end();
    });

    client
      .on("ready", () => settle(() => resolve(client)))
      .on("keyboard-interactive", (_name, _instructions, _instructionsLang, prompts, finish) => {
        finish(prompts.length > 0 ? prompts.map(() => password) : []);
      })
      .on("error", (error) => {
        const rejection = guard.hostKeyRejection();
        if (rejection) {
          settle(() => reject(new Error(hostKeyRejectionMessage(rejection))));
          return;
        }
        if (!allowLegacy && isAlgorithmNegotiationError(error) && !settled) {
          settled = true;
          guard.stop();
          askForLegacyAlgorithms(sender, host, error).then((allowed) => {
            if (allowed) {
              connectSftpClient(sender, host, password, true).then(resolve, reject);
            } else {
              reject(new Error(`${formatSshError(error)} (the server only offers legacy algorithms)`));
            }
          });
          return;
        }
        settle(() => reject(new Error(formatSshError(error))));
      })
      .on("close", () => {
        settle(() => reject(new Error("SFTP connection closed before authentication completed.")));
      });

    client.connect({
      host: host.hostname,
      port: host.port,
      username: host.username,
      password,
      tryKeyboard: true,
      readyTimeout: 10 * 60_000,
      keepaliveInterval: 15_000,
      algorithms: allowLegacy ? legacyAlgorithms : modernAlgorithms,
      hostVerifier: guard.hostVerifier,
    });
  });
}

function openSftp(client: SshClient) {
  return new Promise<SftpClient>((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error) {
        reject(new Error(`SFTP error: ${error.message}`));
        return;
      }

      resolve(sftp);
    });
  });
}

function resolveRemotePath(sftp: SftpClient, remotePath: string) {
  return new Promise<string>((resolve, reject) => {
    sftp.realpath(remotePath || ".", (error, resolvedPath) => {
      if (error) {
        reject(new Error(`SFTP path error: ${error.message}`));
        return;
      }

      resolve(resolvedPath);
    });
  });
}

export function readRemoteDirectory(sftp: SftpClient, remotePath: string) {
  return new Promise<SftpEntry[]>((resolve, reject) => {
    sftp.readdir(remotePath, (error, entries) => {
      if (error) {
        reject(new Error(`SFTP list error: ${error.message}`));
        return;
      }

      resolve(entries
        .filter((entry) => entry.filename !== "." && entry.filename !== "..")
        .map((entry) => ({
          name: entry.filename,
          path: joinRemotePath(remotePath, entry.filename),
          type: getSftpEntryType(entry.attrs),
          size: entry.attrs.size,
          modifiedAt: entry.attrs.mtime * 1000,
          permissions: entry.attrs.mode & 0o7777,
          owner: ownerFromLongname(entry.longname),
        }))
        .sort(compareSftpEntries));
    });
  });
}

export function transferStream(source: Readable, target: Writable, totalBytes: number, onProgress: ((progress: SftpTransferProgress) => void) | undefined, errorPrefix: string, controller?: SftpTransferController) {
  return new Promise<void>((resolve, reject) => {
    let transferredBytes = 0;
    let settled = false;
    let lastProgressAt = 0;

    const emitProgress = (force = false) => {
      const now = Date.now();
      if (!force && now - lastProgressAt < 120) {
        return;
      }

      lastProgressAt = now;
      const normalizedTotalBytes = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0;
      const percent = normalizedTotalBytes > 0 ? Math.min(100, Math.floor((transferredBytes / normalizedTotalBytes) * 100)) : 0;
      onProgress?.({ transferredBytes, totalBytes: normalizedTotalBytes, percent });
    };

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      if (controller) {
        controller.cancel = () => undefined;
      }
      source.destroy();
      target.destroy();
      callback();
    };

    if (controller) {
      controller.cancel = () => {
        controller.canceled = true;
        settle(() => reject(new SftpTransferCanceledError()));
      };
    }

    source.on("data", (chunk: Buffer) => {
      transferredBytes += chunk.length;
      emitProgress();
    });

    source.on("error", (error) => {
      settle(() => reject(new Error(`${errorPrefix}: ${error.message}`)));
    });

    target.on("error", (error) => {
      settle(() => reject(new Error(`${errorPrefix}: ${error.message}`)));
    });

    const complete = () => {
      if (Number.isFinite(totalBytes) && totalBytes > 0) {
        transferredBytes = totalBytes;
      }
      emitProgress(true);
      settle(resolve);
    };

    let sourceEnded = false;
    source.on("end", () => {
      sourceEnded = true;
    });

    target.on("finish", complete);
    // ssh2's SFTP WriteStream (autoClose) destroys itself in _final, and Node does not emit
    // "finish" on a destroyed stream - uploads only ever get "close". It fires after every
    // write was acknowledged and the remote handle closed; errors and cancel settle first.
    // A close before the source was fully read means the channel went away mid-transfer.
    target.on("close", () => {
      if (sourceEnded) {
        complete();
      } else {
        settle(() => reject(new Error(`${errorPrefix}: connection closed before the transfer completed`)));
      }
    });

    emitProgress(true);
    source.pipe(target);
  });
}

function createRemoteDirectory(sftp: SftpClient, remotePath: string) {
  return new Promise<void>((resolve, reject) => {
    sftp.mkdir(remotePath, (error) => {
      if (error) {
        reject(new Error(`SFTP mkdir error: ${error.message}`));
        return;
      }

      resolve();
    });
  });
}

function renameRemoteEntry(sftp: SftpClient, sourcePath: string, targetPath: string) {
  return new Promise<void>((resolve, reject) => {
    sftp.rename(sourcePath, targetPath, (error) => {
      if (error) {
        reject(new Error(`SFTP rename error: ${error.message}`));
        return;
      }

      resolve();
    });
  });
}

function normalizeRemoteName(name: string) {
  const normalized = name.trim();

  if (!normalized || normalized === "." || normalized === ".." || normalized.includes("/") || normalized.includes("\\")) {
    throw new Error("Invalid remote name.");
  }

  return normalized;
}

function getRemoteDirectoryName(remotePath: string) {
  const normalized = remotePath.replace(/\\/g, "/").replace(/\/+$/g, "") || "/";
  const slashIndex = normalized.lastIndexOf("/");

  return slashIndex <= 0 ? "/" : normalized.slice(0, slashIndex);
}

async function readLocalDirectory(localPath?: string): Promise<LocalFileListResult> {
  const cwd = path.resolve(localPath && localPath.trim() ? localPath : os.homedir());
  const entries = await fs.readdir(cwd, { withFileTypes: true });
  const detailedEntries = await Promise.all(entries.map(async (entry): Promise<LocalFileEntry | null> => {
    const entryPath = path.join(cwd, entry.name);

    try {
      const stats = await fs.stat(entryPath);
      return {
        name: entry.name,
        path: entryPath,
        type: stats.isDirectory() ? "directory" : stats.isFile() ? "file" : "other",
        size: stats.size,
        modifiedAt: stats.mtimeMs,
      };
    } catch {
      return null;
    }
  }));

  return {
    cwd,
    entries: detailedEntries.filter((entry): entry is LocalFileEntry => entry !== null).sort(compareLocalFileEntries),
  };
}

function compareLocalFileEntries(left: LocalFileEntry, right: LocalFileEntry) {
  if (left.type === "directory" && right.type !== "directory") {
    return -1;
  }

  if (left.type !== "directory" && right.type === "directory") {
    return 1;
  }

  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

export function getSftpEntryType(attrs: SftpFileAttributes): SftpEntry["type"] {
  if (attrs.isDirectory()) {
    return "directory";
  }

  if (attrs.isFile()) {
    return "file";
  }

  if (attrs.isSymbolicLink()) {
    return "symlink";
  }

  return "other";
}

function compareSftpEntries(left: SftpEntry, right: SftpEntry) {
  if (left.type === "directory" && right.type !== "directory") {
    return -1;
  }

  if (left.type !== "directory" && right.type === "directory") {
    return 1;
  }

  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

/** "-rw-r--r--    1 oracle   oinstall ..." -> "oracle" (empty when the server sends no long name). */
function ownerFromLongname(longname: string | undefined) {
  const parts = (longname ?? "").trim().split(/\s+/);
  return parts.length >= 4 ? parts[2] : undefined;
}

export function joinRemotePath(directory: string, filename: string) {
  return path.posix.join(directory || "/", filename);
}

function isCurrentSession(sessionId: string, session: TerminalSession) {
  return sessions.get(sessionId) === session;
}

function flushPendingWrites(session: TerminalSession) {
  if (!session.stream || session.pendingWrites.length === 0) {
    return;
  }

  for (const data of session.pendingWrites) {
    session.stream.write(data);
  }

  session.pendingWrites = [];
}

function flushPendingResize(session: TerminalSession) {
  if (!session.stream || !session.pendingResize) {
    return;
  }

  const { cols, rows } = session.pendingResize;
  session.stream.setWindow(rows, cols, 0, 0);
  session.pendingResize = undefined;
}

function sendData(sessionId: string, data: string) {
  const session = sessions.get(sessionId);
  appendTerminalRecording(sessionId, "output", data);
  if (session) {
    safeSend(session.webContents, "terminal:data", { sessionId, data });
  }
}

/** `lost`: the connection dropped (or could not be made for a network reason) - a protected tab reconnects. */
function sendExit(sessionId: string, reason: string, lost = false) {
  const session = sessions.get(sessionId);

  if (!session || session.exitSent) {
    return;
  }

  session.exitSent = true;
  safeSend(session.webContents, "terminal:exit", { sessionId, reason, lost, protection: session.protection ?? null });
}

function sendProtection(sessionId: string, protection: SessionProtection | null, notice?: string) {
  const session = sessions.get(sessionId);
  if (session) {
    safeSend(session.webContents, "terminal:protection", { sessionId, protection, notice });
  }
}

/**
 * Worth trying again (a protected tab reconnects): everything but a refused login. Network errors come in
 * many shapes ("Connection lost before handshake", ECONNRESET, ETIMEDOUT...); host key and legacy
 * algorithm refusals never get here as lost.
 */
function isNetworkError(error: Error) {
  return !/authentication|permission denied|password/i.test(error.message);
}

function sendDirect(webContents: WebContents, sessionId: string, data: string) {
  safeSend(webContents, "terminal:data", { sessionId, data });
}

function sendDirectExit(webContents: WebContents, sessionId: string, reason: string) {
  safeSend(webContents, "terminal:exit", { sessionId, reason });
}

/**
 * The window may be gone: on quit it is destroyed first, then the SSH connections close and their
 * handlers report the exit ("Object has been destroyed" was an uncaught error in the main process).
 */
function safeSend(webContents: WebContents, channel: string, payload: unknown) {
  if (!webContents.isDestroyed()) {
    webContents.send(channel, payload);
  }
}

function formatSshError(error: Error) {
  if (error.message.includes("ECONNRESET")) {
    return "SSH error: read ECONNRESET. The remote host reset the connection before the shell opened; check host, port, VPN/network access, allowed auth method, and username/password.";
  }

  if (error.message.toLowerCase().includes("authentication")) {
    return `SSH authentication failed: ${error.message}`;
  }

  return `SSH error: ${error.message}`;
}
