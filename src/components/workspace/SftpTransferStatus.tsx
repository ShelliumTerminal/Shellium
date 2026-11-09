import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Loader2, Pause, Play, X } from "lucide-react";
import type { SftpJob } from "../../shellium-env";
import type { Session } from "../palette/types";
import { errorText, formatDuration, formatSize } from "../files/fileModel";
import { withSftpConnection } from "../files/sftpConnection";

type SftpTransferStatusProps = {
  activeSessionId: string | null;
  sessions: Session[];
  /** Switches to that session and shows its SFTP tab. */
  onOpenSftp: (sessionId: string) => void;
};

const FINISHED: SftpJob["status"][] = ["done", "error", "canceled"];
/** Which job the status bar leads with when a session has several. */
const LEAD_ORDER: SftpJob["status"][] = ["conflicts", "running", "planning", "queued", "paused"];

/**
 * The running SFTP transfer in the status bar, so it stays visible from the Terminal tab and from
 * other sessions. The active session's transfers come first; otherwise the first other session
 * with one is shown with its name. Listens to the same `sftp:jobs` events as the SFTP queue.
 */
export default function SftpTransferStatus({ activeSessionId, sessions, onOpenSftp }: SftpTransferStatusProps) {
  const [jobsBySession, setJobsBySession] = useState<Record<string, SftpJob[]>>({});
  const [actionError, setActionError] = useState("");

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  useEffect(() => {
    const api = window.shellium?.sftp;
    const apply = (sessionId: string, jobs: SftpJob[]) => {
      setJobsBySession((current) => {
        const active = jobs.filter((job) => !FINISHED.includes(job.status));
        if (active.length === 0) {
          if (!(sessionId in current)) {
            return current;
          }
          const rest = { ...current };
          delete rest[sessionId];
          return rest;
        }
        return { ...current, [sessionId]: active };
      });
    };
    // Safety net: a window that was hidden or minimized catches up when it is shown again.
    const refresh = () => {
      if (document.visibilityState === "visible") {
        sessionsRef.current.forEach((session) => {
          api?.listJobs(session.id).then((jobs) => apply(session.id, jobs)).catch(() => undefined);
        });
      }
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    const off = api?.onJobs((payload) => apply(payload.sessionId, payload.jobs));
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      off?.();
    };
  }, []);

  const openSessionIds = new Set(sessions.map((session) => session.id));
  const sessionId = activeSessionId && jobsBySession[activeSessionId]
    ? activeSessionId
    : Object.keys(jobsBySession).find((id) => openSessionIds.has(id));
  if (!sessionId) {
    return null;
  }

  const jobs = jobsBySession[sessionId];
  const lead = [...jobs].sort((a, b) => LEAD_ORDER.indexOf(a.status) - LEAD_ORDER.indexOf(b.status))[0];
  const others = jobs.length - 1;
  const session = sessions.find((item) => item.id === sessionId);
  const sessionLabel = sessionId === activeSessionId ? "" : `${session?.title || session?.host.name || "Other session"}: `;
  const verb = lead.direction === "upload" ? "Uploading" : "Downloading";

  const percent = lead.totalBytes > 0 ? Math.min(100, Math.floor((lead.transferredBytes / lead.totalBytes) * 100)) : 0;
  const speed = lead.bytesPerSecond ?? 0;
  const eta = speed > 0 ? (lead.totalBytes - lead.transferredBytes) / speed : null;
  const api = window.shellium?.sftp;
  const act = (run: () => Promise<unknown>) => {
    setActionError("");
    run().catch((error) => setActionError(errorText(error)));
  };

  let text: string;
  if (lead.status === "conflicts") {
    text = `${lead.direction === "upload" ? "Upload" : "Download"} ${lead.label} needs a decision - open the SFTP tab`;
  } else if (lead.status === "running") {
    text = `${verb} ${lead.currentFile ?? lead.label}`
      + (lead.totalFiles > 1 ? ` · ${lead.doneFiles}/${lead.totalFiles} files` : "")
      + (lead.totalBytes > 0 ? ` · ${percent}%` : "")
      + (speed > 0 ? ` · ${formatSize(speed)}/s · ETA ${formatDuration(eta)}` : "");
  } else if (lead.status === "paused") {
    text = `${lead.direction === "upload" ? "Upload" : "Download"} ${lead.label}`
      + (lead.totalBytes > 0 ? ` · ${percent}%` : "")
      + ` · ${lead.message ?? "Paused"}`;
  } else if (lead.status === "planning") {
    text = `Checking ${lead.label}`;
  } else {
    text = `${verb} ${lead.label} - queued`;
  }
  text = sessionLabel + text + (others > 0 ? ` · +${others} more` : "") + (actionError ? ` - ${actionError}` : "");
  const canPause = lead.status === "running" || lead.status === "queued" || lead.status === "planning";

  return (
    <span className={`sh-status-item sh-status-transfer sh-status-transfer-${lead.status}`}>
      <button type="button" className="sh-status-transfer-open" title={`${text} - click to open the SFTP tab`}
        onClick={() => onOpenSftp(sessionId)}>
        {lead.status === "conflicts" ? <AlertTriangle aria-hidden="true" size={12} />
          : lead.status === "running" || lead.status === "planning" ? <Loader2 className="ft-spin" aria-hidden="true" size={12} />
            : lead.status === "paused" ? <Pause aria-hidden="true" size={12} />
            : lead.direction === "upload" ? <ArrowUpFromLine aria-hidden="true" size={12} /> : <ArrowDownToLine aria-hidden="true" size={12} />}
        {(lead.status === "running" || lead.status === "paused") && lead.totalBytes > 0 && (
          <span className="sh-status-progress" aria-hidden="true"><span style={{ width: `${percent}%` }} /></span>
        )}
        <span className="sh-status-transfer-text">{text}</span>
      </button>
      {api && canPause && (
        <button type="button" className="sh-status-btn" title="Pause - continues where it stopped" aria-label={`Pause ${lead.label}`}
          onClick={() => act(() => api.pauseJob(lead.id))}>
          <Pause aria-hidden="true" size={12} />
        </button>
      )}
      {api && lead.status === "paused" && session && (
        <button type="button" className="sh-status-btn sh-status-btn-start" title="Start - continue where it stopped" aria-label={`Start ${lead.label}`}
          onClick={() => act(() => withSftpConnection(session, () => api.resumeJob(lead.id)))}>
          <Play aria-hidden="true" size={12} />
        </button>
      )}
      {api && (
        <button type="button" className="sh-status-btn" title="Cancel transfer" aria-label={`Cancel ${lead.label}`}
          onClick={() => act(() => api.cancelJob(lead.id))}>
          <X aria-hidden="true" size={12} />
        </button>
      )}
    </span>
  );
}
