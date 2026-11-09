import type { WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { HostKeyInfo } from "./knownHosts";

const require = createRequire(import.meta.url);
const { ipcMain } = require("electron") as typeof import("electron");

/**
 * Security questions the SSH layer has to ask the user mid-handshake: an unknown or changed
 * host key, or a server that only speaks legacy algorithms. The main process waits for the
 * renderer's answer; no answer (window closed, timeout) always means "reject".
 */

export type ConnectionPromptTarget = {
  hostId: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
};

export type ConnectionPrompt =
  | ({ kind: "host-key-new"; key: HostKeyInfo } & ConnectionPromptTarget)
  | ({ kind: "host-key-changed"; key: HostKeyInfo; previous: HostKeyInfo } & ConnectionPromptTarget)
  | ({ kind: "legacy-algorithms"; detail: string } & ConnectionPromptTarget);

/**
 * host-key-*: "trust" = remember the key, "once" = accept for this connection only.
 * legacy-algorithms: "always" = remember for this host (the renderer persists it), "once".
 */
export type ConnectionPromptDecision = "trust" | "once" | "always" | "reject";

const promptTimeoutMs = 5 * 60_000;
const pending = new Map<string, (decision: ConnectionPromptDecision) => void>();

export function registerConnectionPromptHandlers() {
  ipcMain.handle("connectionPrompt:respond", async (_event, requestId: unknown, decision: unknown) => {
    const resolve = typeof requestId === "string" ? pending.get(requestId) : undefined;
    if (!resolve) {
      return;
    }
    const valid: ConnectionPromptDecision[] = ["trust", "once", "always", "reject"];
    resolve(valid.includes(decision as ConnectionPromptDecision) ? (decision as ConnectionPromptDecision) : "reject");
  });
}

export function askUser(webContents: WebContents, prompt: ConnectionPrompt): Promise<ConnectionPromptDecision> {
  if (webContents.isDestroyed()) {
    return Promise.resolve("reject");
  }

  const requestId = randomUUID();
  return new Promise((resolve) => {
    const finish = (decision: ConnectionPromptDecision) => {
      clearTimeout(timer);
      webContents.off("destroyed", onDestroyed);
      pending.delete(requestId);
      resolve(decision);
    };
    const onDestroyed = () => finish("reject");
    const timer = setTimeout(() => {
      if (!webContents.isDestroyed()) {
        webContents.send("connectionPrompt:cancel", requestId);
      }
      finish("reject");
    }, promptTimeoutMs);

    pending.set(requestId, finish);
    webContents.once("destroyed", onDestroyed);
    webContents.send("connectionPrompt:ask", { requestId, ...prompt });
  });
}
