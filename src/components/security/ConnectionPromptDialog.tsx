import { AlertTriangle, Copy, ShieldAlert, ShieldQuestion } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ConnectionPrompt, ConnectionPromptDecision } from "../../shellium-env";
import "./connection-prompt.css";
import { useEscapeLayer } from "../../app/escapeLayers";

type Props = {
  prompt: ConnectionPrompt;
  queued: number;
  onDecide: (decision: ConnectionPromptDecision) => void;
};

/** Which host key file on the server shows the fingerprint to compare against. */
function serverKeyFile(keyType: string) {
  if (keyType === "ssh-ed25519") return "ssh_host_ed25519_key.pub";
  if (keyType.startsWith("ecdsa-")) return "ssh_host_ecdsa_key.pub";
  if (keyType === "ssh-dss") return "ssh_host_dsa_key.pub";
  return "ssh_host_rsa_key.pub";
}

function Fingerprint({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="cp-fingerprint">
      <code>{value}</code>
      <button
        type="button"
        className="cp-copy"
        title="Copy fingerprint"
        onClick={() => {
          void window.shellium?.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        <Copy size={13} />
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

export default function ConnectionPromptDialog({ prompt, queued, onDecide }: Props) {
  const [verifiedChange, setVerifiedChange] = useState(false);
  const safeButton = useRef<HTMLButtonElement>(null);
  const target = `${prompt.username}@${prompt.hostname}${prompt.port === 22 ? "" : `:${prompt.port}`}`;

  // Focus the safe choice, so a reflexive Enter never trusts a key or weakens crypto.
  useEffect(() => {
    setVerifiedChange(false);
    safeButton.current?.focus();
  }, [prompt.requestId]);

  // Escape is the safe answer (reject / cancel the connection).
  useEscapeLayer(() => onDecide("reject"));

  const tone = prompt.kind === "host-key-changed" ? "danger" : prompt.kind === "legacy-algorithms" ? "warn" : "info";
  const Icon = prompt.kind === "host-key-changed" ? ShieldAlert : prompt.kind === "legacy-algorithms" ? AlertTriangle : ShieldQuestion;

  return (
    <div className="cp-backdrop">
      <section className={`cp-dialog cp-${tone}`} role="alertdialog" aria-modal="true" aria-labelledby="cp-title">
        <header className="cp-header">
          <span className="cp-icon">
            <Icon size={20} />
          </span>
          <div>
            <h2 id="cp-title">
              {prompt.kind === "host-key-new" && "Verify the server's identity"}
              {prompt.kind === "host-key-changed" && "Warning: the server's host key has changed"}
              {prompt.kind === "legacy-algorithms" && "This server needs legacy SSH algorithms"}
            </h2>
            <p className="cp-target">
              <strong>{prompt.name}</strong> · <span className="cp-mono">{target}</span>
            </p>
          </div>
        </header>

        <div className="cp-body">
          {prompt.kind === "host-key-new" && (
            <>
              <p>
                Shellium has not connected to this server before. Make sure the fingerprint below matches the server's
                key before trusting it - this is what protects your password from an impostor server.
              </p>
              <dl className="cp-facts">
                <dt>Key type</dt>
                <dd className="cp-mono">{prompt.key.keyType}</dd>
                <dt>Fingerprint</dt>
                <dd>
                  <Fingerprint value={prompt.key.fingerprint} />
                </dd>
              </dl>
              <p className="cp-hint">
                On the server: <code>ssh-keygen -lf /etc/ssh/{serverKeyFile(prompt.key.keyType)}</code>
              </p>
            </>
          )}

          {prompt.kind === "host-key-changed" && (
            <>
              <p>
                The key this server presented does not match the one Shellium trusted before. The server may have been
                reinstalled or had its keys rotated - <strong>or someone may be intercepting the connection</strong>{" "}
                to capture your credentials. Nothing has been sent to the server.
              </p>
              <dl className="cp-facts">
                <dt>Trusted key</dt>
                <dd>
                  <span className="cp-mono cp-muted">{prompt.previous.keyType}</span>
                  <Fingerprint value={prompt.previous.fingerprint} />
                </dd>
                <dt>Presented now</dt>
                <dd>
                  <span className="cp-mono cp-muted">{prompt.key.keyType}</span>
                  <Fingerprint value={prompt.key.fingerprint} />
                </dd>
              </dl>
              <label className="cp-confirm">
                <input type="checkbox" checked={verifiedChange} onChange={(event) => setVerifiedChange(event.target.checked)} />
                <span>I have confirmed the new fingerprint with the server's owner</span>
              </label>
            </>
          )}

          {prompt.kind === "legacy-algorithms" && (
            <>
              <p>
                The server does not support any modern algorithm Shellium offers by default. Connecting needs outdated
                ones (SHA-1 key exchange, <code>ssh-rsa</code>/<code>ssh-dss</code> host keys or CBC ciphers), which
                are weaker against a determined attacker.
              </p>
              <p className="cp-hint cp-mono">{prompt.detail}</p>
              <p className="cp-hint">
                "Always" enables <em>Allow legacy SSH algorithms</em> for this host only. You can turn it off in the
                host's settings.
              </p>
            </>
          )}
        </div>

        <footer className="cp-footer">
          <span className="cp-queue">{queued > 0 ? `${queued} more waiting` : ""}</span>
          <div className="cp-actions">
            {prompt.kind === "host-key-new" && (
              <>
                <button ref={safeButton} type="button" className="sh-btn sh-btn-ghost" onClick={() => onDecide("reject")}>
                  Cancel
                </button>
                <button type="button" className="sh-btn sh-btn-secondary" onClick={() => onDecide("once")}>
                  Connect once
                </button>
                <button type="button" className="sh-btn sh-btn-primary" onClick={() => onDecide("trust")}>
                  Trust and connect
                </button>
              </>
            )}
            {prompt.kind === "host-key-changed" && (
              <>
                <button
                  type="button"
                  className="sh-btn sh-btn-danger"
                  disabled={!verifiedChange}
                  onClick={() => onDecide("trust")}
                >
                  Replace key and connect
                </button>
                <button ref={safeButton} type="button" className="sh-btn sh-btn-primary" onClick={() => onDecide("reject")}>
                  Cancel connection
                </button>
              </>
            )}
            {prompt.kind === "legacy-algorithms" && (
              <>
                <button ref={safeButton} type="button" className="sh-btn sh-btn-ghost" onClick={() => onDecide("reject")}>
                  Cancel
                </button>
                <button type="button" className="sh-btn sh-btn-secondary" onClick={() => onDecide("once")}>
                  Connect once
                </button>
                <button type="button" className="sh-btn sh-btn-primary" onClick={() => onDecide("always")}>
                  Always allow for this host
                </button>
              </>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
