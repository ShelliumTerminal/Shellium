import { createContext, useContext } from "react";

import "../../styles/anti-idle.css";
import {
  ANTI_IDLE_NOOP_RANGE,
  ANTI_IDLE_STRING_MAX_LENGTH,
  ANTI_IDLE_STRING_RANGE,
  defaultAntiIdle,
  defaultKeepaliveCountMax,
} from "./antiIdleModel";
import type { AntiIdleOptions } from "./antiIdleModel";

export type AntiIdleDefaults = { antiIdle: AntiIdleOptions; keepaliveCountMax: number };

/** The Options default (Options > Terminal); hosts without their own settings use it. */
export const AntiIdleDefaultsContext = createContext<AntiIdleDefaults>({
  antiIdle: defaultAntiIdle,
  keepaliveCountMax: defaultKeepaliveCountMax,
});

export function useAntiIdleDefaults() {
  return useContext(AntiIdleDefaultsContext);
}

type AntiIdleFieldsProps = {
  value: AntiIdleOptions;
  onChange: (patch: Partial<AntiIdleOptions>) => void;
  disabled?: boolean;
};

/** "Anti-idle" box: protocol NO-OP (SSH keep-alive) and an optional anti-idle string. */
export function AntiIdleFields({ value, onChange, disabled = false }: AntiIdleFieldsProps) {
  const seconds = (raw: string) => (raw === "" ? Number.NaN : Number(raw));

  return (
    <div className="ai-box" role="group" aria-label="Anti-idle">
      <div className="ai-row">
        <label className="ai-check">
          <input type="checkbox" checked={value.noopEnabled} disabled={disabled} onChange={(event) => onChange({ noopEnabled: event.target.checked })} />
          <span>Send protocol NO-OP</span>
        </label>
        <span className="ai-spacer" aria-hidden="true" />
        <span className="ai-word">every</span>
        <input
          className="ai-number"
          type="number"
          aria-label="NO-OP interval in seconds"
          min={ANTI_IDLE_NOOP_RANGE.min}
          max={ANTI_IDLE_NOOP_RANGE.max}
          value={Number.isNaN(value.noopSeconds) ? "" : value.noopSeconds}
          disabled={disabled || !value.noopEnabled}
          onChange={(event) => onChange({ noopSeconds: seconds(event.target.value) })}
        />
        <span className="ai-word">seconds</span>
      </div>
      <div className="ai-row">
        <label className="ai-check">
          <input type="checkbox" checked={value.stringEnabled} disabled={disabled} onChange={(event) => onChange({ stringEnabled: event.target.checked })} />
          <span>Send string</span>
        </label>
        <input
          className="ai-text"
          aria-label="Anti-idle string"
          value={value.stringText}
          maxLength={ANTI_IDLE_STRING_MAX_LENGTH}
          spellCheck={false}
          placeholder="e.g. a space"
          disabled={disabled || !value.stringEnabled}
          onChange={(event) => onChange({ stringText: event.target.value })}
        />
        <span className="ai-word">every</span>
        <input
          className="ai-number"
          type="number"
          aria-label="Anti-idle string interval in seconds"
          min={ANTI_IDLE_STRING_RANGE.min}
          max={ANTI_IDLE_STRING_RANGE.max}
          value={Number.isNaN(value.stringSeconds) ? "" : value.stringSeconds}
          disabled={disabled || !value.stringEnabled}
          onChange={(event) => onChange({ stringSeconds: seconds(event.target.value) })}
        />
        <span className="ai-word">seconds</span>
      </div>
      {value.stringEnabled && !value.stringText && !disabled && <p className="ai-warn">Enter the text to send, or the string stays off.</p>}
      <p className="ai-hint">
        NO-OP is an SSH keep-alive: it never reaches the shell, and a connection that stops answering is closed (the
        tab turns red, no automatic reconnect). The string is typed into whatever runs in the session - sqlplus, vim
        - after that many seconds without traffic. Escapes: \r \n \t.
      </p>
    </div>
  );
}
