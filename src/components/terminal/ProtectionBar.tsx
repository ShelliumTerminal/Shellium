import { Loader2, RefreshCw, ShieldAlert, ShieldCheck, ShieldOff, X } from "lucide-react";
import type { ProtectionBarState } from "./useSessionProtection";
import type { SessionProtection } from "../palette/types";

type ProtectionBarProps = {
  state: ProtectionBarState;
  onStart(tool: SessionProtection["tool"], adopt?: SessionProtection, force?: boolean): void;
  onStop(force: boolean): void;
  onRetryNow(): void;
  onReconnect(): void;
  onStopRetrying(): void;
  onDismiss(): void;
};

/** The strip over a protected (or protecting) tab's terminal: questions, progress and the reconnect countdown. */
export default function ProtectionBar({ state, onStart, onStop, onRetryNow, onReconnect, onStopRetrying, onDismiss }: ProtectionBarProps) {
  if (state.kind === "busy") {
    return (
      <div className="pb-bar pb-info" role="status">
        <Loader2 className="pb-icon pb-spin" size={15} aria-hidden="true" />
        <span className="pb-text">{state.text}</span>
      </div>
    );
  }

  if (state.kind === "notice") {
    const Icon = state.tone === "ok" ? ShieldCheck : state.tone === "warn" ? ShieldAlert : ShieldOff;
    return (
      <div className={`pb-bar pb-${state.tone}`} role="status">
        <Icon className="pb-icon" size={15} aria-hidden="true" />
        <span className="pb-text">{state.text}</span>
        <button type="button" className="pb-close" aria-label="Close" onClick={onDismiss}><X size={13} /></button>
      </div>
    );
  }

  if (state.kind === "reconnecting") {
    const seconds = Math.max(0, Math.ceil((state.nextAt - Date.now()) / 1000));
    return (
      <div className="pb-bar pb-warn" role="status">
        <RefreshCw className="pb-icon pb-spin-slow" size={15} aria-hidden="true" />
        <span className="pb-text">
          <b>Connection lost.</b> The protected session keeps running on the server.{" "}
          {seconds > 0 ? <>Reconnecting in {seconds} s</> : <>Reconnecting…</>}
          <span className="pb-muted"> · attempt {state.attempt} · {state.reason}</span>
        </span>
        <button type="button" className="pb-btn pb-btn-primary" onClick={onRetryNow} disabled={seconds === 0}>Try now</button>
        <button type="button" className="pb-btn" onClick={onStopRetrying}>Stop</button>
      </div>
    );
  }

  if (state.kind === "gaveUp") {
    return (
      <div className="pb-bar pb-warn" role="status">
        <ShieldAlert className="pb-icon" size={15} aria-hidden="true" />
        <span className="pb-text">{state.reason}</span>
        <button type="button" className="pb-btn pb-btn-primary" onClick={onReconnect}>Reconnect</button>
        <button type="button" className="pb-close" aria-label="Close" onClick={onDismiss}><X size={13} /></button>
      </div>
    );
  }

  if (state.kind === "choose") {
    return (
      <div className="pb-bar pb-info pb-tall" role="dialog" aria-label="Protected sessions on this server">
        <ShieldCheck className="pb-icon" size={15} aria-hidden="true" />
        <div className="pb-text">
          <b>Protected sessions left on this server.</b> Go back into one, or start a new one:
          <div className="pb-choices">
            {state.orphans.map((o) => (
              <button key={o.name} type="button" className="pb-btn" onClick={() => onStart(o.tool, o)}>
                <span className="pb-mono">{o.name}</span>
                {o.command && <span className="pb-tag">{o.command}</span>}
              </button>
            ))}
            <button type="button" className="pb-btn pb-btn-primary" onClick={() => onStart(state.tool)}>New protected session</button>
          </div>
        </div>
        <button type="button" className="pb-close" aria-label="Cancel" onClick={onDismiss}><X size={13} /></button>
      </div>
    );
  }

  if (state.kind === "notAtPrompt") {
    return (
      <div className="pb-bar pb-warn" role="alertdialog" aria-label="Not at a shell prompt">
        <ShieldAlert className="pb-icon" size={15} aria-hidden="true" />
        <span className="pb-text">
          <b>The terminal does not look like a shell prompt</b> (sqlplus, vim… open?). Protection types a command into it:
          leave the program first. What already runs cannot be moved into protection.
        </span>
        <button type="button" className="pb-btn" onClick={() => onStart(state.tool, state.adopt, true)}>It is a prompt - go on</button>
        <button type="button" className="pb-btn pb-btn-primary" onClick={onDismiss}>Cancel</button>
      </div>
    );
  }

  // confirmStop
  return (
    <div className="pb-bar pb-danger" role="alertdialog" aria-label="End the protected session">
      <ShieldAlert className="pb-icon" size={15} aria-hidden="true" />
      <span className="pb-text">
        {state.running === "unknown"
          ? <><b>Something may still run in the protected session.</b> Switching protection off ends it.</>
          : <><b><span className="pb-mono">{state.running}</span> is running in the protected session.</b> Switching protection off ends it.</>}
      </span>
      <button type="button" className="pb-btn pb-btn-danger" onClick={() => onStop(true)}>End it</button>
      <button type="button" className="pb-btn pb-btn-primary" onClick={onDismiss}>Keep protection</button>
    </div>
  );
}
