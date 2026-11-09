import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { withConnectionDatabase } from "./connectionsDb";
import { listKnownHosts, mergeKnownHosts, parseOpenSshKnownHosts, removeKnownHost } from "./knownHosts";
import type { OpenSshImportResult } from "./knownHosts";
import { getSecurityStatus } from "./security";

const require = createRequire(import.meta.url);
const { dialog, ipcMain } = require("electron") as typeof import("electron");

/** The trust store names every host the user connects to; keep it out of reach while locked. */
function assertUnlocked() {
  if (!getSecurityStatus().unlocked) {
    throw new Error("Unlock Shellium to manage trusted host keys.");
  }
}

export function registerKnownHostsHandlers() {
  ipcMain.handle("knownHosts:list", () => {
    assertUnlocked();
    return withConnectionDatabase(listKnownHosts, { persist: false });
  });

  ipcMain.handle("knownHosts:remove", (_event, id: unknown) => {
    assertUnlocked();
    if (typeof id !== "string" || !id) {
      throw new Error("Invalid host key id.");
    }
    return withConnectionDatabase((db) => removeKnownHost(db, id), { persist: true });
  });

  ipcMain.handle("knownHosts:importOpenSsh", async (): Promise<OpenSshImportResult> => {
    assertUnlocked();
    const defaultPath = path.join(os.homedir(), ".ssh", "known_hosts");
    const result = await dialog.showOpenDialog({
      title: "Import OpenSSH known_hosts",
      defaultPath: fs.existsSync(defaultPath) ? defaultPath : os.homedir(),
      properties: ["openFile", "showHiddenFiles"],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, added: 0, alreadyKnown: 0, conflicts: 0, skippedHashed: 0, skippedOther: 0 };
    }

    const filePath = result.filePaths[0];
    const parsed = parseOpenSshKnownHosts(fs.readFileSync(filePath, "utf8"));
    const merged = await withConnectionDatabase((db) => mergeKnownHosts(db, parsed.entries, "openssh-import"), { persist: true });
    return { canceled: false, filePath, ...merged, skippedHashed: parsed.skippedHashed, skippedOther: parsed.skippedOther };
  });
}
