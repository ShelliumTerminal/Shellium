import { useEffect } from "react";
import { HelpCircle, Trash2, X } from "lucide-react";
import { answerConfirm, cancelAllConfirms, useConfirmRequest } from "../../app/confirmDialog";
import type { ConfirmRequest } from "../../app/confirmDialog";
import { clampCloseConfirmFrame, createDefaultCloseConfirmFrame, frameStyle, useDialogFrame } from "../../app/dialogFrame";
import { useEscapeLayer } from "../../app/escapeLayers";

/** Shows askConfirm() requests (src/app/confirmDialog.ts). `blocked`: the lock screen is up. */
export default function ConfirmHost({ blocked }: { blocked: boolean }) {
  const request = useConfirmRequest();

  useEffect(() => {
    if (blocked) cancelAllConfirms();
  }, [blocked]);

  if (!request || blocked) return null;
  return <ConfirmDialog key={request.id} request={request} />;
}

function ConfirmDialog({ request }: { request: ConfirmRequest }) {
  const cancel = () => answerConfirm(request.id, false);
  useEscapeLayer(cancel);
  const { frame, onHeaderPointerDown } = useDialogFrame(createDefaultCloseConfirmFrame, clampCloseConfirmFrame);
  const danger = request.tone === "danger";

  return (
    <section className="md-overlay md-overlay-confirm" aria-label={request.title}>
      <form
        className="md-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        style={frameStyle(frame)}
        onSubmit={(event) => {
          event.preventDefault();
          answerConfirm(request.id, true);
        }}
      >
        <header className="md-header" onPointerDown={onHeaderPointerDown}>
          <span className={danger ? "md-icon md-icon-danger" : "md-icon"} aria-hidden="true">
            {danger ? <Trash2 size={18} /> : <HelpCircle size={18} />}
          </span>
          <div className="md-title">
            <h2 id="confirm-title">{request.title}</h2>
          </div>
          <button type="button" className="md-close" aria-label="Close" onClick={cancel}>
            <X size={16} />
          </button>
        </header>
        <div className="md-body">
          <p className="md-text" id="confirm-body">{request.body}</p>
        </div>
        <div className="md-actions">
          <button type="button" className="sh-btn sh-btn-ghost" autoFocus={danger} onClick={cancel}>
            Cancel
          </button>
          <button type="submit" className={danger ? "sh-btn sh-btn-danger" : "sh-btn sh-btn-primary"} autoFocus={!danger}>
            {request.confirmLabel}
          </button>
        </div>
      </form>
    </section>
  );
}
