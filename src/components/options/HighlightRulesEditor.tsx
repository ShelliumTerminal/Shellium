import { Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  compileHighlightRules,
  findHighlights,
  getPatternError,
  highlightColorHex,
  highlightColors,
  oracleHighlightRules,
} from "../terminal/terminalHighlights";
import type { HighlightColor, HighlightOptions, HighlightRule } from "../terminal/terminalHighlights";
import "../../styles/highlight-rules.css";

type HighlightRulesEditorProps = {
  value: HighlightOptions;
  onChange(value: HighlightOptions): void;
};

const previewText = "ORA-01555: snapshot too old   WARNING: low space   Recovery completed successfully   STATUS OPEN";

function newRuleId() {
  return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Options > Terminal > Highlight rules: the list, a switch for all of them and a live preview. */
export function HighlightRulesEditor({ value, onChange }: HighlightRulesEditorProps) {
  const updateRule = (id: string, patch: Partial<HighlightRule>) =>
    onChange({ ...value, rules: value.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)) });

  const preview = findHighlights(previewText, compileHighlightRules(value));
  const previewParts: Array<{ text: string; color?: HighlightColor }> = [];
  let position = 0;
  for (const match of preview) {
    previewParts.push({ text: previewText.slice(position, match.start) });
    previewParts.push({ text: previewText.slice(match.start, match.end), color: match.color });
    position = match.end;
  }
  previewParts.push({ text: previewText.slice(position) });

  return (
    <div className="hl-editor">
      <label className="hl-master">
        <input
          className="sh-switch"
          type="checkbox"
          role="switch"
          checked={value.enabled}
          onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
        />
        <span>Highlight matches in new output</span>
      </label>

      <div className={`hl-list${value.enabled ? "" : " is-off"}`}>
        {value.rules.map((rule) => {
          const error = getPatternError(rule.pattern);
          return (
            <div className="hl-rule" key={rule.id}>
              <input
                type="checkbox"
                className="hl-check"
                checked={rule.enabled}
                title={rule.enabled ? "On" : "Off"}
                aria-label="Rule on"
                onChange={(event) => updateRule(rule.id, { enabled: event.target.checked })}
              />
              <span className="hl-swatch" style={{ background: highlightColorHex(rule.color, []) }} aria-hidden="true" />
              <select
                className="op-select hl-color"
                value={rule.color}
                aria-label="Color"
                onChange={(event) => updateRule(rule.id, { color: event.target.value as HighlightColor })}
              >
                {highlightColors.map((color) => (
                  <option key={color} value={color}>{color[0].toUpperCase() + color.slice(1)}</option>
                ))}
              </select>
              <input
                className={`op-input op-input-mono hl-pattern${error ? " is-invalid" : ""}`}
                value={rule.pattern}
                spellCheck={false}
                placeholder="Regular expression, e.g. ORA-\d{5}"
                title={error ?? "Regular expression (JavaScript)"}
                aria-label="Pattern"
                aria-invalid={Boolean(error)}
                onChange={(event) => updateRule(rule.id, { pattern: event.target.value })}
              />
              <label className="hl-case" title="Match upper and lower case alike">
                <input
                  type="checkbox"
                  checked={rule.ignoreCase}
                  onChange={(event) => updateRule(rule.id, { ignoreCase: event.target.checked })}
                />
                Ignore case
              </label>
              <button
                type="button"
                className="op-env-delete"
                title="Delete rule"
                aria-label="Delete rule"
                onClick={() => onChange({ ...value, rules: value.rules.filter((item) => item.id !== rule.id) })}
              >
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}
        {value.rules.length === 0 && <p className="hl-empty">No rules. Add one, or put back the Oracle set.</p>}
      </div>

      <div className="hl-actions">
        <button
          type="button"
          className="sh-btn sh-btn-secondary sh-btn-sm"
          disabled={value.rules.length >= 50}
          onClick={() => onChange({ ...value, rules: [...value.rules, { id: newRuleId(), pattern: "", color: "yellow", ignoreCase: true, enabled: true }] })}
        >
          <Plus size={14} />
          Add rule
        </button>
        <button
          type="button"
          className="sh-btn sh-btn-secondary sh-btn-sm"
          title="Replace the list with the built-in Oracle rules"
          onClick={() => onChange({ ...value, rules: oracleHighlightRules })}
        >
          <RotateCcw size={14} />
          Oracle set
        </button>
      </div>

      <div className="hl-preview" aria-label="Preview">
        {previewParts.map((part, index) => (
          <span key={index} style={part.color ? { color: highlightColorHex(part.color, []) } : undefined}>{part.text}</span>
        ))}
      </div>
    </div>
  );
}
