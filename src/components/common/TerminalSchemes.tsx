import "../../styles/terminal-schemes.css";
import { createContext, useContext } from "react";
import type { CSSProperties } from "react";
import { builtInTerminalSchemes, defaultTerminalSchemeId, findTerminalScheme } from "./terminalSchemeModel";
import type { TerminalScheme } from "./terminalSchemeModel";

/** The schemes the user can pick (built-in + custom) and the default, for dialogs outside Options. */
export type TerminalSchemeSettings = { custom: TerminalScheme[]; defaultId: string };

export const TerminalSchemesContext = createContext<TerminalSchemeSettings>({ custom: [], defaultId: defaultTerminalSchemeId });

export function useTerminalSchemes() {
  return useContext(TerminalSchemesContext);
}

export function schemeName(id: string | undefined, custom: TerminalScheme[]) {
  return findTerminalScheme(id, custom)?.name ?? builtInTerminalSchemes[0].name;
}

/** A few lines of a DBA's terminal drawn in the scheme's colors. `large` adds more lines. */
export function SchemePreview({ scheme, large = false }: { scheme: TerminalScheme; large?: boolean }) {
  const [black, red, green, yellow, blue, magenta, cyan, , brightBlack] = scheme.ansi;
  const c = (color: string): CSSProperties => ({ color });
  return (
    <div className={large ? "ts-preview ts-preview-large" : "ts-preview"} style={{ background: scheme.background, color: scheme.foreground }} aria-hidden="true">
      <div><span style={c(green)}>oracle@db01</span>:<span style={c(blue)}>~</span>$ ls</div>
      <div><span style={c(blue)}>backup/</span>  <span style={c(green)}>check.sh</span>  alert.log</div>
      {large && <div><span style={c(brightBlack)}># 2026-10-06 14:32 tablespace check</span></div>}
      <div><span style={c(red)}>ORA-01555</span>: snapshot too old</div>
      {large && (
        <>
          <div><span style={c(yellow)}>WARNING</span> USERS at <span style={c(magenta)}>95.5%</span></div>
          <div><span style={c(green)}>+ added</span> <span style={c(red)}>- removed</span> <span style={c(cyan)}>@@ 12,7 @@</span></div>
        </>
      )}
      <div>
        SQL&gt; select * from <span style={{ background: scheme.selection }}>v$instance</span>
        <span className="ts-cursor" style={{ background: scheme.cursor }} />
      </div>
      <div className="ts-swatches">
        {scheme.ansi.map((color, index) => (
          <span key={index} style={{ background: color, boxShadow: color.toLowerCase() === scheme.background.toLowerCase() || color === black ? "inset 0 0 0 1px rgba(127,127,127,.35)" : undefined }} />
        ))}
      </div>
    </div>
  );
}

type SchemeSelectProps = {
  id?: string;
  value: string;
  onChange(value: string): void;
  /** First option, value "": e.g. "Same as environment · Shellium Production". */
  inheritLabel: string;
  className?: string;
  /** Custom schemes to list; default: the applied ones (Options passes its unsaved draft). */
  custom?: TerminalScheme[];
};

/** Select of every scheme, built-in and custom, with an "inherit" first option. */
export function SchemeSelect({ id, value, onChange, inheritLabel, className, custom: customOverride }: SchemeSelectProps) {
  const applied = useTerminalSchemes();
  const custom = customOverride ?? applied.custom;
  const known = value === "" || findTerminalScheme(value, custom);
  return (
    <select id={id} className={className} value={known ? value : ""} onChange={(event) => onChange(event.target.value)}>
      <option value="">{inheritLabel}</option>
      <optgroup label="Built-in">
        {builtInTerminalSchemes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </optgroup>
      {custom.length > 0 && (
        <optgroup label="Custom">
          {custom.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </optgroup>
      )}
    </select>
  );
}
