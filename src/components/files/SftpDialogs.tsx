import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, Copy, KeyRound, Trash2, X } from "lucide-react";
import type { SftpConflictAction, SftpConflictDecision, SftpJob } from "../../shellium-env";
import { formatSize, formatTime, octal, permissionString } from "./fileModel";
import { useEscapeLayer } from "../../app/escapeLayers";

function Modal({ title, subtitle, icon, tone, onClose, children, actions, wide }: {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  tone?: "danger" | "warn";
  onClose(): void;
  children: ReactNode;
  actions: ReactNode;
  wide?: boolean;
}) {
  useEscapeLayer(onClose);
  // Take focus from the terminal behind (it would get the keys typed while the dialog is open).
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!dialogRef.current?.contains(document.activeElement)) {
      dialogRef.current?.focus();
    }
  }, []);

  return (
    <section className="md-overlay md-overlay-sftp ft-modal" aria-label={title}>
      <div ref={dialogRef} tabIndex={-1} className={"md-dialog ft-modal-dialog" + (wide ? " wide" : "")} role="dialog" aria-modal="true" aria-labelledby="ft-modal-title">
        <header className="md-header">
          <span className={"md-icon" + (tone ? ` md-icon-${tone}` : "")} aria-hidden="true">{icon}</span>
          <div className="md-title">
            <h2 id="ft-modal-title">{title}</h2>
            {subtitle && <p className="md-mono">{subtitle}</p>}
          </div>
          <button type="button" className="md-close" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="md-body">{children}</div>
        <div className="md-actions">{actions}</div>
      </div>
    </section>
  );
}

const ACTION_LABEL: Record<SftpConflictAction, string> = {
  overwrite: "Overwrite",
  rename: "Keep both",
  skip: "Skip",
};

/** Files of a transfer that already exist at the target: overwrite, keep both or skip. */
export function ConflictDialog({ job, onSubmit, onCancelJob, onClose }: {
  job: SftpJob;
  onSubmit(decision: SftpConflictDecision): void;
  onCancelJob(): void;
  onClose(): void;
}) {
  const [defaultAction, setDefaultAction] = useState<SftpConflictAction>("skip");
  const [perItem, setPerItem] = useState<Record<string, SftpConflictAction>>({});
  const [backup, setBackup] = useState(job.backupDefault);
  const upload = job.direction === "upload";
  const count = job.conflicts.length;
  const overwriting = job.conflicts.some((conflict) => (perItem[conflict.id] ?? defaultAction) === "overwrite");

  return (
    <Modal
      title={`${count} file${count === 1 ? "" : "s"} already exist${count === 1 ? "s" : ""}`}
      subtitle={(upload ? "on the server in " : "in ") + job.targetDir}
      icon={<Copy size={18} />}
      tone="warn"
      wide
      onClose={onClose}
      actions={(
        <>
          <button type="button" className="sh-btn sh-btn-ghost md-actions-start" onClick={onCancelJob}>Cancel transfer</button>
          <button type="button" className="sh-btn sh-btn-ghost" onClick={onClose}>Later</button>
          <button
            type="button"
            className={"sh-btn " + (overwriting && !(upload && backup) ? "sh-btn-danger" : "sh-btn-primary")}
            onClick={() => onSubmit({ defaultAction, perItem, backup })}
          >
            Continue
          </button>
        </>
      )}
    >
      <div className="ft-choice" role="radiogroup" aria-label="For all files">
        <span>For all files:</span>
        {(["overwrite", "rename", "skip"] as const).map((action) => (
          <label key={action} className={defaultAction === action ? "selected" : ""}>
            <input type="radio" name="ft-default" checked={defaultAction === action} onChange={() => setDefaultAction(action)} />
            {ACTION_LABEL[action]}
          </label>
        ))}
      </div>
      <div className="ft-conflicts">
        <table>
          <thead>
            <tr><th>File</th><th>{upload ? "On the server" : "Here"}</th><th>{upload ? "Uploading" : "Downloading"}</th><th>Action</th></tr>
          </thead>
          <tbody>
            {job.conflicts.map((conflict) => {
              // Whole seconds: SFTP times have no milliseconds.
              const age = Math.sign(Math.floor(conflict.incoming.modifiedAt / 1000) - Math.floor(conflict.existing.modifiedAt / 1000));
              const ageLabel = age > 0 ? "newer" : age < 0 ? "older" : "same time";
              return (
                <tr key={conflict.id}>
                  <td className="ft-mono" title={conflict.relativePath}>{conflict.relativePath}</td>
                  <td>{formatSize(conflict.existing.size)}<small>{formatTime(conflict.existing.modifiedAt)}</small></td>
                  <td>
                    {formatSize(conflict.incoming.size)}
                    <small className={age > 0 ? "ft-newer" : undefined}>{formatTime(conflict.incoming.modifiedAt)} · {ageLabel}</small>
                  </td>
                  <td>
                    <select
                      className="ft-select"
                      value={perItem[conflict.id] ?? ""}
                      onChange={(event) => {
                        const value = event.target.value as SftpConflictAction | "";
                        setPerItem((current) => {
                          const next = { ...current };
                          if (value) next[conflict.id] = value; else delete next[conflict.id];
                          return next;
                        });
                      }}
                    >
                      <option value="">As above ({ACTION_LABEL[defaultAction]})</option>
                      <option value="overwrite">Overwrite</option>
                      <option value="rename">Keep both</option>
                      <option value="skip">Skip</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {upload && (
        <label className="md-check">
          <input className="sh-switch" type="checkbox" role="switch" checked={backup} onChange={(event) => setBackup(event.target.checked)} />
          <span>Keep overwritten files on the server as <code>name.bak-&lt;date&gt;</code></span>
        </label>
      )}
      <p className="md-text ft-note">
        {upload
          ? "New content is uploaded under a temporary name first; an existing file is replaced only after the upload completed, and keeps its permissions."
          : "Keep both saves the download as name (1).ext."}
      </p>
    </Modal>
  );
}

/** Confirms deleting remote files / folders, with what is inside them. */
export function DeleteDialog({ names, summary, error, busy, onConfirm, onClose }: {
  names: string[];
  summary: { files: number; folders: number; bytes: number } | null;
  error: string | null;
  busy: boolean;
  onConfirm(): void;
  onClose(): void;
}) {
  const [understood, setUnderstood] = useState(false);
  const hasFolders = (summary?.folders ?? 0) > 0;
  return (
    <Modal
      title={names.length === 1 ? `Delete ${names[0]}?` : `Delete ${names.length} items?`}
      icon={<Trash2 size={18} />}
      tone="danger"
      onClose={onClose}
      actions={(
        <>
          <button type="button" className="sh-btn sh-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="sh-btn sh-btn-danger" disabled={busy || !summary || (hasFolders && !understood)} onClick={onConfirm}>
            {busy ? "Deleting..." : "Delete"}
          </button>
        </>
      )}
    >
      {names.length > 1 && (
        <ul className="ft-delete-list">
          {names.slice(0, 8).map((name) => <li key={name} className="ft-mono">{name}</li>)}
          {names.length > 8 && <li>... and {names.length - 8} more</li>}
        </ul>
      )}
      <p className="md-text">
        {!summary && !error && "Counting what will be deleted..."}
        {summary && (
          <>
            This deletes <strong>{summary.files} file{summary.files === 1 ? "" : "s"}</strong>
            {hasFolders && <> in <strong>{summary.folders} folder{summary.folders === 1 ? "" : "s"}</strong></>}
            {summary.bytes > 0 && <> ({formatSize(summary.bytes)})</>} on the server. It cannot be undone.
          </>
        )}
      </p>
      {hasFolders && summary && (
        <label className="md-check">
          <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />
          <span>Delete the folders with everything in them</span>
        </label>
      )}
      {error && <div className="md-alert" role="alert">{error}</div>}
    </Modal>
  );
}

const WHO = [["Owner", 6], ["Group", 3], ["Others", 0]] as const;
const WHAT = [["Read", 4], ["Write", 2], ["Execute", 1]] as const;

/** chmod for the selected remote entries. */
export function ChmodDialog({ names, initial, error, busy, onApply, onClose }: {
  names: string[];
  initial: number;
  error: string | null;
  busy: boolean;
  onApply(mode: number): void;
  onClose(): void;
}) {
  const [mode, setMode] = useState(initial & 0o7777);
  const [text, setText] = useState(octal(initial));
  const update = (next: number) => {
    setMode(next);
    setText(octal(next));
  };
  const textValid = /^[0-7]{3,4}$/.test(text);

  return (
    <Modal
      title="Permissions"
      subtitle={names.length === 1 ? names[0] : `${names.length} items`}
      icon={<KeyRound size={18} />}
      onClose={onClose}
      actions={(
        <>
          <button type="button" className="sh-btn sh-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="sh-btn sh-btn-primary" disabled={busy || !textValid} onClick={() => onApply(mode)}>
            {busy ? "Applying..." : "Apply"}
          </button>
        </>
      )}
    >
      <table className="ft-chmod">
        <thead>
          <tr><th />{WHAT.map(([label]) => <th key={label}>{label}</th>)}</tr>
        </thead>
        <tbody>
          {WHO.map(([who, shift]) => (
            <tr key={who}>
              <th>{who}</th>
              {WHAT.map(([label, bit]) => {
                const mask = bit << shift;
                return (
                  <td key={label}>
                    <input
                      type="checkbox"
                      aria-label={`${who} ${label}`}
                      checked={(mode & mask) !== 0}
                      onChange={(event) => update(event.target.checked ? mode | mask : mode & ~mask)}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <label className="md-field">
        <span>Octal</span>
        <input
          className="md-input md-mono"
          value={text}
          maxLength={4}
          onChange={(event) => {
            setText(event.target.value);
            if (/^[0-7]{3,4}$/.test(event.target.value)) {
              setMode(parseInt(event.target.value, 8));
            }
          }}
        />
      </label>
      <p className="md-text ft-note">
        <span className="ft-mono">{permissionString(mode)}</span>
        {names.length > 1 && " · applied to every selected item (not to folder contents)"}
      </p>
      {(mode & 0o002) !== 0 && (
        <div className="ft-warn"><AlertTriangle size={14} aria-hidden="true" /> Everyone on the server will be able to change this.</div>
      )}
      {error && <div className="md-alert" role="alert">{error}</div>}
    </Modal>
  );
}
