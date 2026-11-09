import { useState } from "react";
import { X } from "lucide-react";
import { normalizeTerminalAppearance, terminalFontFamilies, terminalFontSizes, terminalFontStack, terminalFontStyles } from "../../app/appOptions";
import { clampFontDialogFrame, createDefaultFontDialogFrame, frameStyle, useDialogFrame } from "../../app/dialogFrame";
import type { TerminalAppearance } from "../terminal/TerminalPane";
import type { TerminalScheme } from "../common/terminalSchemeModel";
import { useEscapeLayer } from "../../app/escapeLayers";

type TerminalFontDialogProps = {
  initial: TerminalAppearance;
  /** Colors for the preview: the default color scheme. */
  scheme: TerminalScheme;
  onApply(appearance: TerminalAppearance): void;
  onCancel(): void;
};

/** Terminal font with a live preview (colors: Options > Terminal > Color scheme). Keeps its position. */
export default function TerminalFontDialog({ initial, scheme, onApply, onCancel }: TerminalFontDialogProps) {
  useEscapeLayer(onCancel);
  const { frame, onHeaderPointerDown } = useDialogFrame(createDefaultFontDialogFrame, clampFontDialogFrame, "terminal-font");
  const [draft, setDraft] = useState<TerminalAppearance>(initial);

  return (
    <section className="md-overlay md-overlay-top" aria-label="Terminal font settings">
          <form
            className="md-dialog fd-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="font-dialog-title"
            style={frameStyle(frame)}
            onSubmit={(event) => {
              event.preventDefault();
              onApply(normalizeTerminalAppearance(draft));
            }}
          >
            <header className="md-header" onPointerDown={onHeaderPointerDown}>
              <div className="md-title">
                <h2 id="font-dialog-title">Terminal font</h2>
                <p>Applies to every terminal session.</p>
              </div>
              <button type="button" className="md-close" aria-label="Close" onClick={onCancel}>
                <X size={16} />
              </button>
            </header>
            <div className="md-body fd-body">
              <div className="fd-column">
                <div className="md-field">
                  <span>Font</span>
                  <div className="fd-font-list" role="listbox" aria-label="Font">
                    {terminalFontFamilies.map((fontFamily) => (
                      <button
                        key={fontFamily}
                        type="button"
                        role="option"
                        aria-selected={draft.fontFamily === fontFamily}
                        className={`fd-font${draft.fontFamily === fontFamily ? " selected" : ""}`}
                        style={{ fontFamily: terminalFontStack(fontFamily) }}
                        onClick={() => setDraft((current) => ({ ...current, fontFamily }))}
                      >
                        {fontFamily}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="md-field">
                  <span>Style</span>
                  <div className="fd-segmented" role="radiogroup" aria-label="Font style">
                    {terminalFontStyles.map((fontStyle) => (
                      <button
                        key={fontStyle.value}
                        type="button"
                        role="radio"
                        aria-checked={draft.fontStyle === fontStyle.value}
                        className={draft.fontStyle === fontStyle.value ? "selected" : ""}
                        onClick={() => setDraft((current) => ({ ...current, fontStyle: fontStyle.value }))}
                      >
                        {fontStyle.label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="md-field">
                  <span>Size</span>
                  <select
                    className="md-input"
                    value={draft.fontSize}
                    onChange={(event) => setDraft((current) => ({ ...current, fontSize: Number(event.target.value) }))}
                  >
                    {terminalFontSizes.map((fontSize) => (
                      <option key={fontSize} value={fontSize}>
                        {fontSize} px
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="fd-column">
                <div className="md-field">
                  <span>Preview</span>
                  <div
                    className="fd-preview"
                    style={{
                      fontFamily: terminalFontStack(draft.fontFamily),
                      fontSize: draft.fontSize,
                      fontStyle: draft.fontStyle === "italic" || draft.fontStyle === "boldItalic" ? "italic" : "normal",
                      fontWeight: draft.fontStyle === "bold" || draft.fontStyle === "boldItalic" ? 700 : 400,
                      color: scheme.foreground,
                      background: scheme.background,
                    }}
                  >
                    <div className="fd-preview-dim">Last login: Fri Sep 26 09:12:44 from 10.40.1.25</div>
                    <div>[oracle@db01 ~]$ sqlplus / as sysdba</div>
                    <div>
                      SQL&gt; select status from <span style={{ background: scheme.selection }}>v$instance</span>;
                    </div>
                    <div>
                      SQL&gt; <span className="fd-preview-cursor" style={{ background: scheme.cursor }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="md-actions">
              <button type="button" className="sh-btn sh-btn-ghost" onClick={onCancel}>
                Cancel
              </button>
              <button type="submit" className="sh-btn sh-btn-primary">Apply</button>
            </div>
          </form>
        </section>
  );
}
