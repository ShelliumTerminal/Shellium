import { useEffect, useState } from "react";
import { Circle, Clock3, Gauge, Lock } from "lucide-react";
import type { Session } from "../palette/types";
import { useTerminalView } from "../../app/terminalViewStore";
import { getSessionTitle } from "../../app/sessionModel";
import { EnvironmentBadge } from "../common/environments";
import { connectShortcutLabel } from "../../app/platform";
import SftpTransferStatus from "./SftpTransferStatus";

type SessionInfo = Awaited<ReturnType<NonNullable<typeof window.shellium>["terminal"]["info"]>>;

type StatusBarProps = {
  activeSession: Session | null;
  sessions: Session[];
  /** Last notice of the active terminal (e.g. "Recording saved to ..."). */
  notice: string;
  /** Opens the SFTP tab of a session (clicking the transfer). */
  onOpenSftp: (sessionId: string) => void;
  /** Recording of the active session (started time while it runs). */
  recordingStartedAt?: number;
  onStopRecording: () => void;
};

function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hh = String(Math.floor((total % 86_400) / 3600)).padStart(2, "0");
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${days > 0 ? `${days}d ` : ""}${hh}:${mm}:${ss}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

const shortAlgorithm = (name?: string) => (name ? name.replace(/@openssh\.com$/, "") : "");

function connectionDetails(info: NonNullable<SessionInfo>) {
  const aead = /gcm|chacha20-poly1305/.test(info.cipher ?? "");
  return [
    info.serverSoftware && `Server: ${info.serverSoftware}`,
    info.kex && `Key exchange: ${info.kex}`,
    info.hostKeyType && `Host key: ${info.hostKeyType} ${info.hostKeyFingerprint ?? ""}`.trim(),
    info.cipher && `Cipher: ${info.cipher}`,
    `MAC: ${aead ? "built into the cipher" : info.mac || "-"}`,
    `Compression: ${info.compression || "none"}`,
  ].filter(Boolean).join("\n");
}

/**
 * Bottom bar. Left: the active session (state, name, environment, user@host:port, X11, time connected,
 * latency, protocol, traffic) and SFTP
 * transfers; right: recording, terminal type, size and cursor, session count. Connection numbers
 * come from the main process once a second (terminal:info); size / cursor from terminalViewStore.
 * Lower-priority items hide first in a narrow window (container queries in shell.css).
 */
export default function StatusBar({ activeSession, sessions, notice, onOpenSftp, recordingStartedAt, onStopRecording }: StatusBarProps) {
  const sessionId = activeSession?.id ?? null;
  const isConnected = activeSession?.status === "connected";
  const view = useTerminalView(sessionId);
  const [info, setInfo] = useState<SessionInfo>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setInfo(null);
    if (!sessionId || !isConnected) {
      return;
    }
    let cancelled = false;
    const load = () => {
      window.shellium?.terminal.info(sessionId).then((next) => {
        if (!cancelled) {
          setInfo(next);
          setNow(Date.now());
        }
      }).catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sessionId, isConnected]);

  useEffect(() => {
    if (recordingStartedAt === undefined || isConnected) {
      return;
    }
    // the recording timer still ticks when the info poll does not run
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [recordingStartedAt, isConnected]);

  const latency = info?.latencyMs;
  const latencyTone = latency === undefined ? "" : latency >= 250 ? " sh-status-bad" : latency >= 100 ? " sh-status-slow" : "";

  return (
    <footer className="sh-statusbar" aria-label="Session status">
      <span className={`sh-status-item sh-status-main sh-status-${activeSession?.status ?? "idle"}`}>
        <span className="sh-status-dot" aria-hidden="true" />
        {activeSession
          ? activeSession.status === "connected" ? "Connected" : activeSession.status === "connecting" ? "Connecting" : "Disconnected"
          : "Ready"}
      </span>
      {activeSession && (
        <>
          <span className="sh-status-item sh-status-session" title={getSessionTitle(activeSession)}>{getSessionTitle(activeSession)}</span>
          <EnvironmentBadge environmentId={activeSession.host.environmentId} />
          <span className="sh-status-item sh-status-endpoint">
            {activeSession.host.username ? `${activeSession.host.username}@` : ""}{activeSession.host.hostname}:{activeSession.host.port || 22}
          </span>
          <span className="sh-status-item sh-status-p2">{activeSession.host.x11?.enabled ? "X11 on" : "X11 off"}</span>
          {activeSession.host.legacyAlgorithms && (
            <span className="sh-status-item sh-status-p1 sh-status-slow" title="This host uses older SSH algorithms (host settings, SSH security)">Legacy SSH</span>
          )}
        </>
      )}
      {info?.connectedAt !== undefined && (
        <span className="sh-status-item sh-status-p1" title="Connected for">
          <Clock3 size={12} aria-hidden="true" />
          {formatDuration(now - info.connectedAt)}
        </span>
      )}
      {info && (
        <span className={`sh-status-item sh-status-p1${latencyTone}`} title="Round trip to the server (SSH keep-alive, every 10 s)">
          <Gauge size={12} aria-hidden="true" />
          {latency === undefined ? "– ms" : `${latency} ms`}
        </span>
      )}
      {info?.cipher && (
        <span className="sh-status-item sh-status-p2" title={connectionDetails(info)}>
          <Lock size={12} aria-hidden="true" />
          SSH2 · {shortAlgorithm(info.cipher)}
        </span>
      )}
      {info && (
        <span className="sh-status-item sh-status-p3" title={`Received ${info.bytesIn.toLocaleString()} bytes, sent ${info.bytesOut.toLocaleString()} bytes`}>
          ↓ {formatBytes(info.bytesIn)} ↑ {formatBytes(info.bytesOut)}
        </span>
      )}
      <SftpTransferStatus activeSessionId={sessionId} sessions={sessions} onOpenSftp={onOpenSftp} />
      <span className="sh-status-notice" role="status" title={notice || undefined}>
        {notice}
      </span>
      {recordingStartedAt !== undefined && (
        <button type="button" className="sh-status-item sh-status-rec" title="Recording this session - click to stop" onClick={onStopRecording}>
          <Circle size={9} aria-hidden="true" />
          REC {formatDuration(now - recordingStartedAt)}
        </button>
      )}
      {activeSession && view && (
        <>
          <span className="sh-status-item sh-status-p3">{info?.term ?? "xterm-256color"} · UTF-8</span>
          <span className="sh-status-item sh-status-p2" title="Terminal size: columns × rows">{view.cols}×{view.rows}</span>
          <span className="sh-status-item sh-status-p2 sh-status-cursor" title="Cursor: line and column on the screen">Ln {view.cursorRow}, Col {view.cursorCol}</span>
        </>
      )}
      <span className="sh-status-item sh-status-p1">{sessions.length} session{sessions.length === 1 ? "" : "s"}</span>
      {!activeSession && <span className="sh-status-item sh-status-hint">{connectShortcutLabel} connect</span>}
    </footer>
  );
}
