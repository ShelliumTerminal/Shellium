import { useState } from "react";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Check, ChevronDown, ChevronUp, CircleSlash, Loader2, Pause, Play, X } from "lucide-react";
import type { SftpJob } from "../../shellium-env";
import { formatDuration, formatSize } from "./fileModel";

type TransferQueueProps = {
  jobs: SftpJob[];
  onCancel(jobId: string): void;
  onPause(jobId: string): void;
  onResume(jobId: string): void;
  onResolve(job: SftpJob): void;
  onClearFinished(): void;
};

const STATUS_LABEL: Record<SftpJob["status"], string> = {
  planning: "Checking",
  conflicts: "Needs a decision",
  queued: "Queued",
  running: "Transferring",
  paused: "Paused",
  done: "Done",
  error: "Failed",
  canceled: "Canceled",
};

/** Upload / download jobs of this session, newest last; collapsible. */
export default function TransferQueue({ jobs, onCancel, onPause, onResume, onResolve, onClearFinished }: TransferQueueProps) {
  const [collapsed, setCollapsed] = useState(false);
  if (jobs.length === 0) {
    return null;
  }
  const active = jobs.filter((job) => !["done", "error", "canceled"].includes(job.status));
  const finished = jobs.length - active.length;
  const waiting = jobs.find((job) => job.status === "conflicts");

  return (
    <section className={"ft-queue" + (collapsed ? " collapsed" : "")} aria-label="Transfers">
      <header className="ft-queue-head">
        <button type="button" className="ft-queue-toggle" onClick={() => setCollapsed((current) => !current)} aria-expanded={!collapsed}>
          {collapsed ? <ChevronUp aria-hidden="true" size={14} /> : <ChevronDown aria-hidden="true" size={14} />}
          Transfers
          <span className="ft-queue-count">{active.length > 0 ? `${active.length} active` : `${jobs.length} finished`}</span>
        </button>
        {waiting && collapsed && (
          <button type="button" className="sh-btn sh-btn-primary sh-btn-sm" onClick={() => onResolve(waiting)}>Decide</button>
        )}
        {finished > 0 && (
          <button type="button" className="sh-btn sh-btn-ghost sh-btn-sm" onClick={onClearFinished}>Clear finished</button>
        )}
      </header>
      {!collapsed && (
        <ul className="ft-queue-list">
          {jobs.map((job) => {
            const percent = job.totalBytes > 0 ? Math.min(100, Math.floor((job.transferredBytes / job.totalBytes) * 100)) : job.status === "done" ? 100 : 0;
            const speed = job.bytesPerSecond ?? 0;
            const eta = speed > 0 && job.status === "running" ? (job.totalBytes - job.transferredBytes) / speed : null;
            const isActive = !["done", "error", "canceled"].includes(job.status);
            return (
              <li key={job.id} className={`ft-job ft-job-${job.status}`}>
                <span className="ft-job-icon" aria-hidden="true">
                  {job.status === "running" || job.status === "planning" ? <Loader2 className="ft-spin" size={14} />
                    : job.status === "done" ? <Check size={14} />
                      : job.status === "error" ? <AlertTriangle size={14} />
                        : job.status === "canceled" ? <CircleSlash size={14} />
                          : job.status === "paused" ? <Pause size={14} />
                          : job.direction === "upload" ? <ArrowUpFromLine size={14} /> : <ArrowDownToLine size={14} />}
                </span>
                <div className="ft-job-main">
                  <div className="ft-job-line">
                    <strong title={job.label}>{job.direction === "upload" ? "Upload" : "Download"} {job.label}</strong>
                    <span className="ft-job-status">{STATUS_LABEL[job.status]}</span>
                  </div>
                  <div className="ft-job-meta" title={job.targetDir}>
                    {job.totalFiles > 0 && `${job.doneFiles}/${job.totalFiles} files · `}
                    {job.totalBytes > 0 && `${formatSize(job.transferredBytes)} / ${formatSize(job.totalBytes)}`}
                    {job.status === "running" && speed > 0 && ` · ${formatSize(speed)}/s · ETA ${formatDuration(eta)}`}
                    {job.status === "running" && job.currentFile && ` · ${job.currentFile}`}
                    {(job.status !== "running" || !job.currentFile) && job.message && ` ${job.totalFiles > 0 || job.totalBytes > 0 ? "· " : ""}${job.message}`}
                  </div>
                  {(job.status === "running" || job.status === "paused" || job.status === "done") && job.totalBytes > 0 && (
                    <div className="ft-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                      <span style={{ width: `${percent}%` }} />
                    </div>
                  )}
                </div>
                {job.status === "conflicts" && (
                  <button type="button" className="sh-btn sh-btn-primary sh-btn-sm" onClick={() => onResolve(job)}>Decide</button>
                )}
                {(job.status === "running" || job.status === "queued" || job.status === "planning") && (
                  <button type="button" className="ft-tool" title="Pause - continues where it stopped" aria-label={`Pause ${job.label}`} onClick={() => onPause(job.id)}>
                    <Pause aria-hidden="true" size={14} />
                  </button>
                )}
                {job.status === "paused" && (
                  <button type="button" className="ft-tool ft-tool-start" title="Start - continue where it stopped" aria-label={`Start ${job.label}`} onClick={() => onResume(job.id)}>
                    <Play aria-hidden="true" size={14} />
                  </button>
                )}
                {isActive && (
                  <button type="button" className="ft-tool" title="Cancel transfer" aria-label={`Cancel ${job.label}`} onClick={() => onCancel(job.id)}>
                    <X aria-hidden="true" size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
