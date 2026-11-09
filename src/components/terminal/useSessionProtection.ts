import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import type { SessionProtection } from "../palette/types";

/**
 * A protected tab (electron/sessionProtection.ts): switching protection on and off, and reconnecting on
 * its own after the connection drops - back into the same tmux session, the terminal and its scrollback
 * stay. Only protected tabs reconnect by themselves; others keep the manual Reconnect (owner's decision).
 */

export type ProtectionOrphan = SessionProtection & { command: string | null };

export type ProtectionBarState =
  | { kind: "busy"; text: string }
  | { kind: "notice"; tone: "ok" | "warn" | "info"; text: string }
  | { kind: "choose"; tool: SessionProtection["tool"]; orphans: ProtectionOrphan[] }
  | { kind: "notAtPrompt"; tool: SessionProtection["tool"]; adopt?: SessionProtection }
  | { kind: "confirmStop"; running: string }
  | { kind: "reconnecting"; attempt: number; nextAt: number; reason: string }
  | { kind: "gaveUp"; reason: string };

type ExitPayload = { sessionId: string; reason: string; lost?: boolean; protection?: SessionProtection | null };

const RETRY_SECONDS = [2, 5, 10, 15, 30];
// what a REPL's prompt looks like: typing the tmux command there would go to sqlplus, not to the shell
const PROGRAM_PROMPT = /^(SQL|RMAN|DGMGRL|ASMCMD|ADRCI|adrci|mysql|MariaDB \[.*\]|sqlite|ftp|sftp|irb.*|>>>|\.\.\.|In \[\d+\]|\w+=[#>]|\w+-[#>]|gdb|\(gdb\))\s*[>#:]?\s*$/i;

/** Is the cursor on a shell prompt (so the start command can be typed there)? */
export function atShellPrompt(terminal: Terminal | null) {
  if (!terminal) {
    return false;
  }
  const buffer = terminal.buffer.active;
  if (buffer.type === "alternate") {
    return false; // vim, less, top...
  }
  const line = buffer.getLine(buffer.baseY + buffer.cursorY)?.translateToString(true) ?? "";
  const before = line.slice(0, buffer.cursorX).replace(/\s+$/, "");
  if (!before || PROGRAM_PROMPT.test(before.trim())) {
    return false;
  }
  return /[$#%>]$/.test(before);
}

type Options = {
  sessionId: string;
  protection: SessionProtection | undefined;
  protectOnConnect: boolean | undefined;
  status: "connecting" | "connected" | "disconnected";
  terminalRef: MutableRefObject<Terminal | null>;
  /** Connects the tab again, keeping the terminal (set by TerminalPane's connection effect). */
  reconnectRef: MutableRefObject<(() => void) | null>;
  onProtectionChange(sessionId: string, protection: SessionProtection | null): void;
  onReconnectingChange(sessionId: string, reconnecting: boolean): void;
};

export function useSessionProtection({ sessionId, protection, protectOnConnect, status, terminalRef, reconnectRef, onProtectionChange, onReconnectingChange }: Options) {
  const [bar, setBar] = useState<ProtectionBarState | null>(null);
  const [, setTick] = useState(0);
  const protectionRef = useRef<SessionProtection | null>(protection ?? null);
  const firstConnectRef = useRef(true);
  const attemptRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const reconnectingRef = useRef(false);
  const lastModeRef = useRef<"attach" | "new" | null>(null);
  protectionRef.current = protection ?? protectionRef.current;

  const clearRetry = () => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  };

  const setReconnecting = useCallback((value: boolean) => {
    if (reconnectingRef.current !== value) {
      reconnectingRef.current = value;
      onReconnectingChange(sessionId, value);
    }
  }, [onReconnectingChange, sessionId]);

  const showNotice = useCallback((tone: "ok" | "warn" | "info", text: string, ms = 6000) => {
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    setBar({ kind: "notice", tone, text });
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = null;
      setBar((current) => (current?.kind === "notice" ? null : current));
    }, ms);
  }, []);

  const setProtection = useCallback((value: SessionProtection | null) => {
    protectionRef.current = value;
    onProtectionChange(sessionId, value);
  }, [onProtectionChange, sessionId]);

  /** What the next connect asks for: back into the protected session, or a new protected one. */
  const connectProtection = useCallback(() => {
    const first = firstConnectRef.current;
    firstConnectRef.current = false;
    if (protectionRef.current) {
      lastModeRef.current = "attach";
      return { mode: "attach" as const, ...protectionRef.current };
    }
    lastModeRef.current = first && protectOnConnect ? "new" : null;
    return first && protectOnConnect ? { mode: "new" as const } : undefined;
  }, [protectOnConnect]);

  const scheduleRetry = useCallback((reason: string) => {
    clearRetry();
    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    const delay = RETRY_SECONDS[Math.min(attempt - 1, RETRY_SECONDS.length - 1)] * 1000;
    setReconnecting(true);
    setBar({ kind: "reconnecting", attempt, nextAt: Date.now() + delay, reason });
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      terminalRef.current?.writeln(`\r\n[Reconnecting - attempt ${attempt}]`);
      reconnectRef.current?.();
    }, delay);
  }, [reconnectRef, setReconnecting, terminalRef]);

  const retryNow = useCallback(() => {
    if (retryTimerRef.current === null) {
      return;
    }
    clearRetry();
    terminalRef.current?.writeln(`\r\n[Reconnecting - attempt ${attemptRef.current}]`);
    reconnectRef.current?.();
  }, [reconnectRef, terminalRef]);

  /** From the "stopped" strip: try again now (and keep trying while the network is down). */
  const reconnectNow = useCallback(() => {
    clearRetry();
    attemptRef.current = 1;
    setReconnecting(true);
    setBar({ kind: "busy", text: "Reconnecting…" });
    terminalRef.current?.writeln("\r\n[Reconnecting]");
    reconnectRef.current?.();
  }, [reconnectRef, setReconnecting, terminalRef]);

  const stopRetrying = useCallback(() => {
    clearRetry();
    attemptRef.current = 0;
    setReconnecting(false);
    setBar({ kind: "gaveUp", reason: "Stopped. The protected session keeps running on the server; Reconnect goes back into it." });
  }, [setReconnecting]);

  /** Called with every exit of this tab; true when a protected tab took it over (reconnecting). */
  const handleExit = useCallback((payload: ExitPayload) => {
    const current = payload.protection ?? protectionRef.current;
    if (payload.lost && current) {
      protectionRef.current = current;
      scheduleRetry(payload.reason);
      return true;
    }
    if (reconnectingRef.current) {
      // not a network problem (password refused, host key...): trying again would not help
      clearRetry();
      attemptRef.current = 0;
      setReconnecting(false);
      setBar({ kind: "gaveUp", reason: `${payload.reason}. The protected session is still on the server; Reconnect goes back into it.` });
      return false;
    }
    if (current && !payload.lost && payload.reason === "Shell closed") {
      // the tmux session itself ended (exit typed in it)
      setProtection(null);
    }
    return false;
  }, [scheduleRetry, setProtection, setReconnecting]);

  // what the main process reports: protection started / ended / reattached
  useEffect(() => {
    return window.shellium?.terminal.onProtection((payload) => {
      if (payload.sessionId !== sessionId) {
        return;
      }
      const wasReconnecting = reconnectingRef.current;
      if (wasReconnecting) {
        attemptRef.current = 0;
        setReconnecting(false);
      }
      setProtection(payload.protection);
      if (payload.notice) {
        showNotice("warn", payload.notice, 12000);
      } else if (payload.protection && (wasReconnecting || lastModeRef.current === "attach")) {
        lastModeRef.current = null;
        showNotice("ok", "Reconnected - back in the protected session; what ran in it kept running.");
      } else if (payload.protection) {
        setBar((current) => (current?.kind === "busy" ? null : current));
        showNotice("ok", `Protected: this tab now runs in ${payload.protection.tool} on the server. A dropped connection reconnects and comes back here.`);
      } else {
        showNotice("info", "Protection is off: this tab is a plain shell again.");
      }
    });
  }, [sessionId, setProtection, setReconnecting, showNotice]);

  useEffect(() => () => {
    clearRetry();
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
  }, []);

  // the countdown of the reconnect bar
  useEffect(() => {
    if (bar?.kind !== "reconnecting") {
      return;
    }
    const timer = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [bar?.kind]);

  const startProtection = useCallback(async (tool: SessionProtection["tool"], adopt?: SessionProtection, force = false) => {
    if (!force && !atShellPrompt(terminalRef.current)) {
      setBar({ kind: "notAtPrompt", tool, adopt });
      return;
    }
    setBar({ kind: "busy", text: adopt ? `Attaching to ${adopt.name}…` : `Starting ${tool}…` });
    try {
      const target = adopt ?? { tool, name: await window.shellium!.terminal.protectionName(sessionId) };
      await window.shellium!.terminal.protectStart(sessionId, target, Boolean(adopt));
      terminalRef.current?.focus();
    } catch (error) {
      showNotice("warn", error instanceof Error ? error.message : "Could not protect the session", 10000);
    }
  }, [sessionId, showNotice, terminalRef]);

  const protect = useCallback(async () => {
    if (status !== "connected") {
      showNotice("warn", "Connect first: protection starts in a connected session.");
      return;
    }
    if (protectionRef.current) {
      return;
    }
    setBar({ kind: "busy", text: "Checking the server for tmux / screen…" });
    try {
      const probe = await window.shellium!.terminal.protectProbe(sessionId);
      if (!probe.tool) {
        showNotice("warn", "This server has neither tmux nor screen: the session cannot be protected. Ask for tmux to be installed.", 12000);
        return;
      }
      if (probe.orphans.length) {
        setBar({ kind: "choose", tool: probe.tool, orphans: probe.orphans });
        return;
      }
      await startProtection(probe.tool);
    } catch (error) {
      showNotice("warn", error instanceof Error ? error.message : "Could not check the server", 10000);
    }
  }, [sessionId, showNotice, startProtection, status]);

  const stopProtection = useCallback(async (force = false) => {
    if (!protectionRef.current) {
      return;
    }
    if (!force) {
      setBar({ kind: "busy", text: "Checking what runs in the protected session…" });
      try {
        const state = await window.shellium!.terminal.protectState(sessionId);
        if (state.running) {
          setBar({ kind: "confirmStop", running: state.running });
          return;
        }
      } catch {
        setBar({ kind: "confirmStop", running: "unknown" });
        return;
      }
    }
    setBar({ kind: "busy", text: "Ending the protected session…" });
    try {
      await window.shellium!.terminal.protectStop(sessionId);
    } catch (error) {
      showNotice("warn", error instanceof Error ? error.message : "Could not end the protected session", 10000);
    }
  }, [sessionId, showNotice]);

  const dismiss = useCallback(() => {
    setBar(null);
    terminalRef.current?.focus();
  }, [terminalRef]);

  return {
    bar,
    connectProtection,
    handleExit,
    protect,
    startProtection,
    stopProtection,
    retryNow,
    reconnectNow,
    stopRetrying,
    dismiss,
    showNotice,
  };
}
