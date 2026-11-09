import { Power, X } from "lucide-react";
import type { ReactNode } from "react";
import { clampCloseConfirmFrame, createDefaultCloseConfirmFrame, frameStyle, useDialogFrame } from "../../app/dialogFrame";
import { useEscapeLayer } from "../../app/escapeLayers";

type CloseConfirmDialogProps = {
  title: string;
  body: string;
  /** Closing the app (Quit) rather than tabs. */
  isApp: boolean;
  onConfirm(): void;
  onCancel(): void;
  /** More content under the text (protected sessions: what happens to them on the server). */
  extra?: ReactNode;
  confirmDisabled?: boolean;
};

/** Confirms closing a tab, the other tabs, or Shellium itself. */
export default function CloseConfirmDialog({ title, body, isApp, onConfirm, onCancel, extra, confirmDisabled }: CloseConfirmDialogProps) {
  useEscapeLayer(onCancel);
  const { frame, onHeaderPointerDown } = useDialogFrame(createDefaultCloseConfirmFrame, clampCloseConfirmFrame);

  return (
    <section className="md-overlay" aria-label="Close tab confirmation">
      <form
        className="md-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="close-confirm-title"
        style={frameStyle(frame)}
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <header className="md-header" onPointerDown={onHeaderPointerDown}>
          <span className="md-icon md-icon-danger" aria-hidden="true">
            {isApp ? <Power size={18} /> : <X size={18} />}
          </span>
          <div className="md-title">
            <h2 id="close-confirm-title">{title}</h2>
          </div>
          <button type="button" className="md-close" aria-label="Close" onClick={onCancel}>
            <X size={16} />
          </button>
        </header>
        <div className="md-body">
          <p className="md-text">{body}</p>
          {extra}
        </div>
        <div className="md-actions">
          <button type="button" className="sh-btn sh-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="sh-btn sh-btn-danger" autoFocus disabled={confirmDisabled}>{isApp ? "Quit" : "Close"}</button>
        </div>
      </form>
    </section>
  );
}
