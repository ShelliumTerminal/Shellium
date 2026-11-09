import { Check, Copy, Pencil, Trash2 } from "lucide-react";
import { askConfirm } from "../../app/confirmDialog";
import { SchemePreview } from "../common/TerminalSchemes";
import { ansiColorNames, builtInTerminalSchemes, createCustomSchemeId, findTerminalScheme, maxCustomSchemes } from "../common/terminalSchemeModel";
import type { TerminalScheme } from "../common/terminalSchemeModel";

type TerminalSchemePickerProps = {
  selectedId: string;
  custom: TerminalScheme[];
  /** The custom scheme open in the editor, if any. */
  editingId: string | null;
  onSelect(id: string): void;
  onCustomChange(custom: TerminalScheme[]): void;
  onEdit(id: string | null): void;
};

const baseColors: { key: "background" | "foreground" | "cursor" | "selection"; label: string }[] = [
  { key: "background", label: "Background" },
  { key: "foreground", label: "Text" },
  { key: "cursor", label: "Cursor" },
  { key: "selection", label: "Selection" },
];

const ansiLabels = ["Black", "Red", "Green", "Yellow", "Blue", "Magenta", "Cyan", "White"];

/** Options > Terminal: the scheme gallery (Termius-style cards) and the editor for custom schemes. */
export function TerminalSchemePicker({ selectedId, custom, editingId, onSelect, onCustomChange, onEdit }: TerminalSchemePickerProps) {
  const selected = findTerminalScheme(selectedId, custom) ?? builtInTerminalSchemes[0];
  const editing = editingId ? custom.find((item) => item.id === editingId) ?? null : null;

  const customize = () => {
    const copy: TerminalScheme = { ...selected, ansi: [...selected.ansi], id: createCustomSchemeId(), name: `${selected.name} (custom)` };
    onCustomChange([...custom, copy]);
    onSelect(copy.id);
    onEdit(copy.id);
  };

  const update = (patch: Partial<TerminalScheme>) => {
    if (!editing) return;
    onCustomChange(custom.map((item) => (item.id === editing.id ? { ...item, ...patch } : item)));
  };

  const remove = async (scheme: TerminalScheme) => {
    const confirmed = await askConfirm({
      title: "Delete color scheme",
      body: `Delete "${scheme.name}"? Environments and hosts that use it switch to the default scheme.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    onCustomChange(custom.filter((item) => item.id !== scheme.id));
    if (selectedId === scheme.id) onSelect(builtInTerminalSchemes[0].id);
    if (editingId === scheme.id) onEdit(null);
  };

  const card = (scheme: TerminalScheme, isCustom: boolean) => {
    const isSelected = scheme.id === selected.id;
    return (
      <div key={scheme.id} className={`ts-card${isSelected ? " selected" : ""}`}>
        <button type="button" className="ts-card-main" aria-pressed={isSelected} onClick={() => onSelect(scheme.id)}>
          <SchemePreview scheme={scheme} />
          <span className="ts-card-name">
            {isSelected && <Check size={13} aria-hidden="true" />}
            {scheme.name}
          </span>
        </button>
        {isCustom && (
          <span className="ts-card-tools">
            <button type="button" aria-label={`Edit ${scheme.name}`} title="Edit" onClick={() => { onSelect(scheme.id); onEdit(scheme.id); }}>
              <Pencil size={12} />
            </button>
            <button type="button" aria-label={`Delete ${scheme.name}`} title="Delete" onClick={() => void remove(scheme)}>
              <Trash2 size={12} />
            </button>
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="ts-picker">
      <div className="ts-grid" role="group" aria-label="Color schemes">
        {builtInTerminalSchemes.map((scheme) => card(scheme, false))}
        {custom.map((scheme) => card(scheme, true))}
      </div>
      <div className="ts-actions">
        <button type="button" className="sh-btn sh-btn-secondary sh-btn-sm" onClick={customize} disabled={custom.length >= maxCustomSchemes}>
          <Copy size={14} />
          Customize "{selected.name}"
        </button>
        <span className="ts-hint">Copies the selected scheme so you can change its colors.</span>
      </div>

      {editing && (
        <div className="ts-editor" aria-label={`Edit ${editing.name}`}>
          <div className="ts-editor-fields">
            <label className="ts-name">
              <span>Name</span>
              <input className="op-input" value={editing.name} maxLength={40} onChange={(event) => update({ name: event.target.value })} />
            </label>
            <div className="ts-colors">
              {baseColors.map(({ key, label }) => (
                <label className="ts-color" key={key}>
                  <input type="color" value={editing[key]} aria-label={`${label} color`} onChange={(event) => update({ [key]: event.target.value })} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <div className="ts-ansi">
              <span className="ts-ansi-head" aria-hidden="true" />
              {ansiLabels.map((label) => <span key={label} className="ts-ansi-head">{label}</span>)}
              {(["Normal", "Bright"] as const).map((row, rowIndex) => (
                <div className="ts-ansi-row" key={row}>
                  <span className="ts-ansi-label">{row}</span>
                  {ansiLabels.map((label, column) => {
                    const index = rowIndex * 8 + column;
                    return (
                      <input
                        key={ansiColorNames[index]}
                        type="color"
                        value={editing.ansi[index]}
                        aria-label={`${row} ${label}`}
                        title={`${row} ${label}`}
                        onChange={(event) => update({ ansi: editing.ansi.map((color, i) => (i === index ? event.target.value : color)) })}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="ts-editor-actions">
              <button type="button" className="sh-btn sh-btn-ghost sh-btn-sm" onClick={() => onEdit(null)}>Done</button>
            </div>
          </div>
          <SchemePreview scheme={editing} large />
        </div>
      )}
    </div>
  );
}
