import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import { getSettingsPath, writePrivateFile } from "./storageConfig";

type SecuritySettings = {
  enabled?: boolean;
  salt?: string;
  verifier?: string;
  localKey?: string;
  keyBinding?: "local-user";
};

type SettingsFile = {
  version?: number;
  security?: SecuritySettings;
  [key: string]: unknown;
};

type SecurityStatus = {
  enabled: boolean;
  unlocked: boolean;
};

type SecurityCallback = () => Promise<void> | void;

const require = createRequire(import.meta.url);
const { ipcMain, safeStorage } = require("electron") as typeof import("electron");

const encryptedPrefix = "shellium-sec:v1:";
const verifierPlainText = "shellium-security-verifier";
/**
 * Written by the app's former names - ShellV ("shellv-sec:v1:") and RShell ("rshell-sec:v1:"):
 * still read, never written. They are shorter than the current prefix, so every reader strips the
 * prefix that actually matched (see `encryptedPrefixOf`).
 */
const legacyEncryptedPrefixes = ["shellv-sec:v1:", "rshell-sec:v1:"];
const legacyVerifierPlainTexts = ["shellv-security-verifier", "rshell-security-verifier"];

function isKnownVerifier(value: string) {
  return value === verifierPlainText || legacyVerifierPlainTexts.includes(value);
}

/** The prefix `value` starts with (current or legacy), or null when it is not encrypted. */
function encryptedPrefixOf(value: string) {
  return [encryptedPrefix, ...legacyEncryptedPrefixes].find((prefix) => value.startsWith(prefix)) ?? null;
}
const keyLength = 32;
let activeKey: Buffer | null = null;
let legacyDecryptKeys: Buffer[] = [];

export function registerSecurityHandlers(onSecurityEnabled: SecurityCallback, onSecurityLocked: SecurityCallback = () => undefined) {
  ipcMain.handle("security:status", async (): Promise<SecurityStatus> => getSecurityStatus());

  ipcMain.handle("security:setup", async (_event, password: unknown) => {
    const normalizedPassword = normalizePassword(password);
    const salt = crypto.randomBytes(16).toString("base64");
    const localKey = createLocalKey();
    const key = deriveBoundKey(normalizedPassword, salt, localKey);
    const settings = readSettings();

    activeKey = key;
    legacyDecryptKeys = [];
    writeSettings({
      ...settings,
      security: {
        enabled: true,
        salt,
        localKey: protectLocalKey(localKey),
        keyBinding: "local-user",
        verifier: encryptWithKey(verifierPlainText, key),
      },
    });

    await onSecurityEnabled();
    return getSecurityStatus();
  });

  ipcMain.handle("security:unlock", async (_event, password: unknown) => {
    const normalizedPassword = normalizePassword(password);
    const security = getSecuritySettings();

    if (!security.enabled) {
      return getSecurityStatus();
    }

    if (!security.salt || !security.verifier) {
      throw new Error("Security settings are incomplete.");
    }

    const legacyKey = deriveKey(normalizedPassword, security.salt);

    if (!security.localKey) {
      const verifier = decryptVerifier(security.verifier, legacyKey);

      if (!isKnownVerifier(verifier)) {
        throw new Error("Master password is incorrect.");
      }

      const localKey = createLocalKey();
      const key = deriveBoundKey(normalizedPassword, security.salt, localKey);
      const settings = readSettings();

      activeKey = key;
      legacyDecryptKeys = [legacyKey];
      writeSettings({
        ...settings,
        security: {
          enabled: true,
          salt: security.salt,
          localKey: protectLocalKey(localKey),
          keyBinding: "local-user",
          verifier: encryptWithKey(verifierPlainText, key),
        },
      });

      await onSecurityEnabled();
      legacyDecryptKeys = [];
      return getSecurityStatus();
    }

    const key = deriveBoundKey(normalizedPassword, security.salt, unprotectLocalKey(security.localKey));
    const verifier = decryptVerifier(security.verifier, key);

    if (!isKnownVerifier(verifier)) {
      throw new Error("Master password is incorrect.");
    }

    activeKey = key;
    legacyDecryptKeys = [];
    return getSecurityStatus();
  });

  ipcMain.handle("security:lock", async () => {
    activeKey = null;
    legacyDecryptKeys = [];
    await onSecurityLocked();
    return getSecurityStatus();
  });
}

export function resetSecuritySession() {
  activeKey = null;
  legacyDecryptKeys = [];
}

/**
 * Saved data is only ever readable with the app password: until one is set, Shellium is not
 * "unlocked" and nothing (connections, scripts, host keys) can be read or written.
 */
export function getSecurityStatus(): SecurityStatus {
  return {
    enabled: Boolean(getSecuritySettings().enabled),
    unlocked: Boolean(getSecuritySettings().enabled) && activeKey !== null,
  };
}

export function encryptSensitiveValue(value: string | null) {
  if (value === null || value === "") {
    return value;
  }

  if (isEncryptedValue(value)) {
    return value;
  }

  return encryptWithKey(value, getActiveKey());
}

export function decryptSensitiveValue(value: string | null) {
  if (value === null || value === "") {
    return value;
  }

  if (!isEncryptedValue(value)) {
    return value;
  }

  return decryptSensitiveEncryptedValue(value);
}

/** The connection database is written to disk encrypted, never as a plain SQLite file. */
export function encryptDatabaseData(data: Uint8Array) {
  return Buffer.from(encryptWithKey(Buffer.from(data).toString("base64"), getActiveKey()), "utf8");
}

export function decryptDatabaseData(data: Buffer) {
  if (data.length === 0) {
    return undefined;
  }

  if (isEncryptedBuffer(data)) {
    return Buffer.from(decryptSensitiveEncryptedValue(data.toString("utf8")), "base64");
  }

  // A plain SQLite file from an older version: readable once unlocked, so it can be re-saved encrypted.
  getActiveKey();
  return data;
}

function normalizePassword(value: unknown) {
  if (typeof value !== "string" || value.length < 8) {
    throw new Error("Master password must be at least 8 characters.");
  }

  return value;
}

function getActiveKey() {
  if (!activeKey) {
    throw new Error(getSecuritySettings().enabled
      ? "Shellium security is locked. Unlock with the master password."
      : "Set an app password first. Shellium does not store data without encryption.");
  }

  return activeKey;
}

function isEncryptedValue(value: string) {
  return encryptedPrefixOf(value) !== null;
}

function isEncryptedBuffer(value: Buffer) {
  return encryptedPrefixOf(value.subarray(0, encryptedPrefix.length).toString("utf8")) !== null;
}

function deriveKey(password: string, salt: string) {
  return crypto.scryptSync(password, Buffer.from(salt, "base64"), keyLength);
}

function deriveBoundKey(password: string, salt: string, localKey: Buffer) {
  return crypto.scryptSync(password, Buffer.concat([Buffer.from(salt, "base64"), localKey]), keyLength);
}

function createLocalKey() {
  assertLocalProtectionAvailable();
  return crypto.randomBytes(keyLength);
}

function protectLocalKey(localKey: Buffer) {
  assertLocalProtectionAvailable();

  try {
    return safeStorage.encryptString(localKey.toString("base64")).toString("base64");
  } catch (error) {
    // macOS / Linux: the user can refuse the Keychain / keyring access prompt.
    if (process.platform === "win32") {
      throw error;
    }
    throw new Error(keyringRefusedMessage());
  }
}

function unprotectLocalKey(value: string) {
  assertLocalProtectionAvailable();

  try {
    return Buffer.from(safeStorage.decryptString(Buffer.from(value, "base64")), "base64");
  } catch {
    // Windows (DPAPI) never asks, so a failure there means another user or computer. On macOS / Linux
    // the same failure also follows a refused access prompt, so both causes are named.
    throw new Error(process.platform === "win32"
      ? "Shellium security key is bound to another user account or computer. This data cannot be unlocked here."
      : `Shellium could not read its key from the ${keyringName()}. If you were asked for access, allow it and try again; `
        + "otherwise this data belongs to another user account or computer and cannot be unlocked here.");
  }
}

function keyringName() {
  return process.platform === "darwin" ? "macOS Keychain" : "system keyring (GNOME Keyring / KWallet)";
}

function keyringRefusedMessage() {
  return `The ${keyringName()} is locked or Shellium was not allowed to use it. Unlock it, allow access when asked, and try again.`;
}

/**
 * The local key is protected by the OS: DPAPI on Windows, Keychain on macOS, the Secret Service
 * (GNOME Keyring / KWallet) on Linux. Without a keyring, Electron on Linux falls back to
 * "basic_text" - a hard-coded key that binds nothing to the user - so Shellium refuses to run on it.
 */
function assertLocalProtectionAvailable() {
  if (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text") {
    throw new Error(
      "No system keyring found. Shellium needs GNOME Keyring or KWallet to protect its data key. "
      + "Install and unlock one, or start Shellium with --password-store=gnome-libsecret (or kwallet5 / kwallet6).",
    );
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(process.platform === "win32"
      ? "Local OS encryption is not available. Shellium cannot protect saved secrets on this machine."
      : keyringRefusedMessage());
  }
}

function encryptWithKey(value: string, key: Buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${encryptedPrefix}${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptVerifier(value: string, key: Buffer) {
  try {
    return decryptWithKey(value, key);
  } catch {
    throw new Error("Master password is incorrect.");
  }
}

function decryptSensitiveEncryptedValue(value: string) {
  const keys = [getActiveKey(), ...legacyDecryptKeys];
  let lastError: unknown = null;

  for (const key of keys) {
    try {
      return decryptWithKey(value, key);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Encrypted value could not be decrypted.");
}

function decryptWithKey(value: string, key: Buffer) {
  if (!isEncryptedValue(value)) {
    return value;
  }

  const parts = value.slice((encryptedPrefixOf(value) ?? encryptedPrefix).length).split(":");

  if (parts.length !== 3) {
    throw new Error("Encrypted value is invalid.");
  }

  const [ivText, tagText, encryptedText] = parts;
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64"));
  decipher.setAuthTag(Buffer.from(tagText, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function getSecuritySettings() {
  const settings = readSettings();
  return typeof settings.security === "object" && settings.security !== null ? settings.security : {};
}

function readSettings(): SettingsFile {
  const settingsPath = getSettingsPath();

  if (!fs.existsSync(settingsPath)) {
    return { version: 1 };
  }

  try {
    return JSON.parse(fs.readFileSync(settingsPath, "utf8")) as SettingsFile;
  } catch {
    return { version: 1 };
  }
}

function writeSettings(settings: SettingsFile) {
  writePrivateFile(getSettingsPath(), JSON.stringify({ ...settings, version: 1 }, null, 2));
}
