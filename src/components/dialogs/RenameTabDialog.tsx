import { useState } from "react";
import { X } from "lucide-react";
import { clampRenameTabFrame, createDefaultRenameTabFrame, frameStyle, useDialogFrame } from "../../app/dialogFrame";
import { useEscapeLayer } from "../../app/escapeLayers";

const createFrame = () => clampRenameTabFrame(createDefaultRenameTabFrame());

type RenameTabDialogProps = {
  initialValue: string;
  /** The new title; empty goes back to the host name. */
  onSubmit(value: string): void;
  onCancel(): void;
};

export default function RenameTabDialog({ initialValue, onSubmit, onCancel }: RenameTabDialogProps) {
  useEscapeLayer(onCancel);
  const { frame, onHeaderPointerDown } = useDialogFrame(createFrame, clampRenameTabFrame);
  const [value, setValue] = useState(initialValue);

  return (
    <section className="md-overlay" aria-label="Rename tab">
      <form
        className="md-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-tab-title"
        style={frameStyle(frame)}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(value);
        }}
      >
        <header className="md-header" onPointerDown={onHeaderPointerDown}>
          <div className="md-title">
            <h2 id="rename-tab-title">Rename tab</h2>
          </div>
          <button type="button" className="md-close" aria-label="Close" onClick={onCancel}>
            <X size={16} />
          </button>
        </header>
        <div className="md-body">
          <label className="md-field">
            <span>Tab name</span>
            <input
              className="md-input"
              value={value}
              autoFocus
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
        </div>
        <div className="md-actions">
          <button type="button" className="sh-btn sh-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="sh-btn sh-btn-primary">Rename</button>
        </div>
      </form>
    </section>
  );
}
