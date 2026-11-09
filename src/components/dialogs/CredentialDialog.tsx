import { KeyRound, X } from "lucide-react";
import type { Host } from "../palette/types";
import { clampCredentialDialogFrame, createDefaultCredentialDialogFrame, frameStyle, useDialogFrame } from "../../app/dialogFrame";
import { useEscapeLayer } from "../../app/escapeLayers";

const createFrame = () => clampCredentialDialogFrame(createDefaultCredentialDialogFrame());

export type CredentialPromptState = {
  host: Host;
  username: string;
  password: string;
  savePassword: boolean;
};

type CredentialDialogProps = {
  prompt: CredentialPromptState;
  error: string | null;
  onChange(prompt: CredentialPromptState): void;
  /** save = store the password in the vault; requirePassword = refuse an empty password. */
  onSubmit(save: boolean, requirePassword?: boolean): void;
  onCancel(): void;
};

/** Asks for the SSH password of a host that has none saved. */
export default function CredentialDialog({ prompt, error, onChange, onSubmit, onCancel }: CredentialDialogProps) {
  useEscapeLayer(onCancel);
  const { frame, onHeaderPointerDown } = useDialogFrame(createFrame, clampCredentialDialogFrame);

  return (
    <section className="md-overlay md-overlay-prompt" aria-label="Secure Shell credential prompt">
      <form
        className="md-dialog"
        style={frameStyle(frame)}
        role="dialog"
        aria-modal="true"
        aria-labelledby="credential-title"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(prompt.savePassword, true);
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="md-header" onPointerDown={onHeaderPointerDown}>
          <span className="md-icon" aria-hidden="true">
            <KeyRound size={18} />
          </span>
          <div className="md-title">
            <h2 id="credential-title">SSH password</h2>
            <p className="md-mono">{prompt.username || "user"}@{prompt.host.hostname}</p>
          </div>
          <button type="button" className="md-close" aria-label="Close" onClick={onCancel}>
            <X size={16} />
          </button>
        </header>
        <div className="md-body">
          <p className="md-text">No password is saved for <strong>{prompt.host.name}</strong>. Enter it to connect.</p>
          <label className="md-field">
            <span>Username</span>
            <input
              className="md-input md-mono"
              autoFocus={!prompt.username.trim()}
              value={prompt.username}
              spellCheck={false}
              onChange={(event) => onChange({ ...prompt, username: event.target.value })}
            />
          </label>
          <label className="md-field">
            <span>Password</span>
            <input
              className="md-input"
              autoFocus={Boolean(prompt.username.trim())}
              type="password"
              value={prompt.password}
              onChange={(event) => onChange({ ...prompt, password: event.target.value })}
            />
          </label>
          <label className="md-check">
            <input
              className="sh-switch"
              type="checkbox"
              role="switch"
              checked={prompt.savePassword}
              onChange={(event) => onChange({ ...prompt, savePassword: event.target.checked })}
            />
            <span>Save password in the vault</span>
          </label>
          {error && <div className="md-alert" role="alert">{error}</div>}
        </div>
        <div className="md-actions">
          <button
            type="button"
            className="sh-btn sh-btn-ghost md-actions-start"
            title="Connect without a password (key or keyboard-interactive authentication)"
            onClick={() => onSubmit(false)}
          >
            Skip
          </button>
          <button type="button" className="sh-btn sh-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="sh-btn sh-btn-primary">Connect</button>
        </div>
      </form>
    </section>
  );
}
