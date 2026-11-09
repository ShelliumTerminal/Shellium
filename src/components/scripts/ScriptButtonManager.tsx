import { useEffect, useState } from "react";
import type { ClipboardEvent, CSSProperties, Dispatch, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, SetStateAction } from "react";
import { GripVertical, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { centerLargeDialogFrame, clampLargeDialogFrame, frameStyle, startFrameDrag } from "../../app/dialogFrame";
import type { DialogFrame } from "../../app/dialogFrame";
import {
  encodeLegacyScriptAsSendString,
  getScriptButtonStatusStyle,
  normalizeScriptButtonColor,
  normalizeSendStringInput,
  scriptButtonColorOptions,
} from "../../app/scriptButtonModel";
import type { CategoryDraft, ScriptButton, ScriptButtonDraft } from "../../app/scriptButtonModel";
import type { ScriptButtonLibraryState } from "../../app/useScriptButtonLibrary";
import { useEscapeLayer } from "../../app/escapeLayers";

type ScriptButtonManagerProps = {
  library: ScriptButtonLibraryState;
  /** Where the manager was last left (stored in the options); it opens centered at that size. */
  initialFrame: DialogFrame;
  onFrameChange(frame: DialogFrame): void;
  onButtonContextMenu(event: ReactMouseEvent, buttonId: string): void;
  onClose(): void;
};

/**
 * Widths of the categories and editor panes in px; the buttons list in the middle takes the rest.
 * The upper limits (32 % / 52 % of the body) match the clamp() in script-editor.css.
 */
type PaneWidths = { categories: number; editor: number };

const paneWidthsStorageKey = "shellium:scriptManagerPanes";
const defaultPaneWidths: PaneWidths = { categories: 200, editor: 340 };
const MIN_CATEGORIES = 160;
const MIN_BUTTONS = 200;
const MIN_EDITOR = 260;

function loadPaneWidths(): PaneWidths {
  try {
    const stored = JSON.parse(window.localStorage.getItem(paneWidthsStorageKey) ?? "null") as Partial<PaneWidths> | null;
    return {
      categories: typeof stored?.categories === "number" ? Math.max(MIN_CATEGORIES, stored.categories) : defaultPaneWidths.categories,
      editor: typeof stored?.editor === "number" ? Math.max(MIN_EDITOR, stored.editor) : defaultPaneWidths.editor,
    };
  } catch {
    return defaultPaneWidths;
  }
}

function savePaneWidths(widths: PaneWidths) {
  try {
    window.localStorage.setItem(paneWidthsStorageKey, JSON.stringify(widths));
  } catch {
    // per-viewer convenience only
  }
}

/** Multi-line pastes become one send string (line breaks turn into \r tokens). */
function pasteIntoSendString(
  event: ClipboardEvent<HTMLTextAreaElement>,
  setDraft: Dispatch<SetStateAction<ScriptButtonDraft>>,
) {
  const pastedText = event.clipboardData.getData("text");

  if (!/\r|\n/.test(pastedText)) {
    return;
  }

  event.preventDefault();
  const textarea = event.currentTarget;
  const selectionStart = textarea.selectionStart;
  const selectionEnd = textarea.selectionEnd;
  const normalizedText = normalizeSendStringInput(pastedText);
  const nextCursorPosition = selectionStart + normalizedText.length;

  setDraft((current) => ({
    ...current,
    script: `${current.script.slice(0, selectionStart)}${normalizedText}${current.script.slice(selectionEnd)}`,
  }));
  window.requestAnimationFrame(() => textarea.setSelectionRange(nextCursorPosition, nextCursorPosition));
}

const emptyButtonDraft: ScriptButtonDraft = { label: "", script: "", color: "green", showTooltip: true };

function draftFromButton(button: ScriptButton | null | undefined): ScriptButtonDraft {
  return button
    ? { label: button.label, script: encodeLegacyScriptAsSendString(button.script), color: button.color, showTooltip: button.showTooltip }
    : emptyButtonDraft;
}

/** Tools > Script Buttons: categories, buttons (drag to reorder) and the button editor. */
export default function ScriptButtonManager({ library, initialFrame, onFrameChange, onButtonContextMenu, onClose }: ScriptButtonManagerProps) {
  useEscapeLayer(onClose);
  const [frame, setFrame] = useState<DialogFrame>(() => centerLargeDialogFrame(initialFrame));
  const [scriptButtonDraft, setScriptButtonDraft] = useState<ScriptButtonDraft>(emptyButtonDraft);
  const [draggingScriptButtonId, setDraggingScriptButtonId] = useState<string | null>(null);
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft>({ name: "" });
  const [categoryEditName, setCategoryEditName] = useState("");
  const [scriptButtonEditDraft, setScriptButtonEditDraft] = useState<ScriptButtonDraft>(emptyButtonDraft);
  const [paneWidths, setPaneWidths] = useState<PaneWidths>(loadPaneWidths);

  const scriptButtonCategories = library.categories;
  const selectedScriptCategory = library.selectedCategory;
  const activeScriptButtons = library.activeButtons;
  const selectedScriptButton = library.selectedButton;
  const setSelectedScriptButtonId = library.setSelectedButtonId;
  const isCategoryEditDirty = Boolean(selectedScriptCategory && categoryEditName !== selectedScriptCategory.name);
  const selectedScriptButtonSendString = encodeLegacyScriptAsSendString(selectedScriptButton?.script ?? "");
  const isScriptButtonEditDirty = Boolean(selectedScriptButton && (scriptButtonEditDraft.label !== selectedScriptButton.label || scriptButtonEditDraft.script !== selectedScriptButtonSendString || scriptButtonEditDraft.color !== selectedScriptButton.color || scriptButtonEditDraft.showTooltip !== selectedScriptButton.showTooltip));

  useEffect(() => {
    onFrameChange(frame);
  }, [frame, onFrameChange]);

  /** Drags the border left (categories | buttons) or right (buttons | editor); double-click resets. */
  const startPaneResize = (event: ReactPointerEvent<HTMLButtonElement>, side: "categories" | "editor") => {
    const body = event.currentTarget.closest(".sb-body") as HTMLElement | null;
    const categories = body?.querySelector<HTMLElement>(".sb-categories");
    const editor = body?.querySelector<HTMLElement>(".sb-editor");
    if (!body || !categories || !editor || event.button !== 0) {
      return;
    }
    event.preventDefault();
    const bodyWidth = body.getBoundingClientRect().width;
    const start = { x: event.clientX, categories: categories.getBoundingClientRect().width, editor: editor.getBoundingClientRect().width };
    let latest = { categories: start.categories, editor: start.editor };
    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - start.x;
      latest = side === "categories"
        ? { ...latest, categories: Math.round(Math.max(MIN_CATEGORIES, Math.min(bodyWidth * 0.32, bodyWidth - start.editor - MIN_BUTTONS, start.categories + dx))) }
        : { ...latest, editor: Math.round(Math.max(MIN_EDITOR, Math.min(bodyWidth * 0.52, bodyWidth - start.categories - MIN_BUTTONS, start.editor - dx))) };
      setPaneWidths(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      savePaneWidths(latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const resetPaneWidth = (side: "categories" | "editor") => {
    const next = { ...paneWidths, [side]: defaultPaneWidths[side] };
    setPaneWidths(next);
    savePaneWidths(next);
  };

  useEffect(() => {
    const handleResize = () => setFrame((current) => clampLargeDialogFrame(current));
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    setCategoryEditName(selectedScriptCategory?.name ?? "");
  }, [selectedScriptCategory?.id, selectedScriptCategory?.name]);

  useEffect(() => {
    setScriptButtonEditDraft(draftFromButton(selectedScriptButton));
  }, [selectedScriptButton?.id, selectedScriptButton?.label, selectedScriptButton?.script, selectedScriptButton?.color, selectedScriptButton?.showTooltip]);

  const handleAddScriptCategory = () => {
    const name = categoryDraft.name.trim();

    if (!name) {
      return;
    }

    library.addCategory(name);
    setCategoryDraft({ name: "" });
  };

  const handleSaveScriptCategoryName = () => {
    if (!selectedScriptCategory || !isCategoryEditDirty) {
      return;
    }

    const nextName = categoryEditName.trim();

    if (!nextName) {
      setCategoryEditName(selectedScriptCategory.name);
      return;
    }

    library.renameCategory(selectedScriptCategory.id, nextName);
  };

  const handleRevertScriptCategoryName = () => {
    setCategoryEditName(selectedScriptCategory?.name ?? "");
  };

  const handleSaveScriptButtonEdit = () => {
    if (!selectedScriptButton || !isScriptButtonEditDirty) {
      return;
    }

    const nextLabel = scriptButtonEditDraft.label.trim();
    const nextScript = normalizeSendStringInput(scriptButtonEditDraft.script);

    if (!nextLabel || !nextScript.trim()) {
      setScriptButtonEditDraft(draftFromButton(selectedScriptButton));
      return;
    }

    library.updateButton(selectedScriptButton.id, { label: nextLabel, script: nextScript, color: scriptButtonEditDraft.color, showTooltip: scriptButtonEditDraft.showTooltip });
  };

  const handleRevertScriptButtonEdit = () => {
    setScriptButtonEditDraft(draftFromButton(selectedScriptButton));
  };

  const handleAddScriptButton = () => {
    const categoryId = selectedScriptCategory?.id;
    const label = scriptButtonDraft.label.trim();
    const script = normalizeSendStringInput(scriptButtonDraft.script);
    const color = normalizeScriptButtonColor(scriptButtonDraft.color);

    if (!categoryId || !label || !script.trim()) {
      return;
    }

    library.addButton(categoryId, { label, script, color, showTooltip: scriptButtonDraft.showTooltip });
    setScriptButtonDraft(emptyButtonDraft);
  };

  const handleScriptButtonListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (activeScriptButtons.length === 0 || !["ArrowDown", "ArrowUp", "Home", "End", "Enter"].includes(event.key)) {
      return;
    }

    event.preventDefault();
    const selectedIndex = selectedScriptButton
      ? activeScriptButtons.findIndex((button) => button.id === selectedScriptButton.id)
      : -1;

    let nextIndex = selectedIndex;

    if (event.key === "ArrowDown") {
      nextIndex = selectedIndex < 0 ? 0 : Math.min(activeScriptButtons.length - 1, selectedIndex + 1);
    } else if (event.key === "ArrowUp") {
      nextIndex = selectedIndex < 0 ? activeScriptButtons.length - 1 : Math.max(0, selectedIndex - 1);
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = activeScriptButtons.length - 1;
    } else if (event.key === "Enter" && selectedIndex < 0) {
      nextIndex = 0;
    }

    const nextButton = activeScriptButtons[nextIndex];

    if (nextButton) {
      setSelectedScriptButtonId(nextButton.id);
    }
  };

  const isEditingButton = Boolean(selectedScriptButton);
  const editorDraft = selectedScriptButton ? scriptButtonEditDraft : scriptButtonDraft;
  const setEditorDraft = selectedScriptButton ? setScriptButtonEditDraft : setScriptButtonDraft;
  const totalScriptButtons = scriptButtonCategories.reduce((total, category) => total + category.buttons.length, 0);
  const canAddButton = Boolean(selectedScriptCategory && scriptButtonDraft.label.trim() && scriptButtonDraft.script.trim());

  return (
    <section className="sb-overlay" aria-label="Script button manager">
      <div className="sb-dialog" role="dialog" aria-modal="true" aria-labelledby="script-button-editor-title" style={frameStyle(frame, true)}>
        <header className="sb-header" onPointerDown={(event) => startFrameDrag(event, frame, (next) => setFrame(clampLargeDialogFrame(next)))}>
          <div className="sb-title">
            <strong id="script-button-editor-title">Script Buttons</strong>
            <span>
              {totalScriptButtons === 1 ? "1 button" : `${totalScriptButtons} buttons`} in {scriptButtonCategories.length === 1 ? "1 category" : `${scriptButtonCategories.length} categories`} · drag to reorder
            </span>
          </div>
          <div className="sb-header-actions">
            <button type="button" className="sb-icon-btn" aria-label="Close" title="Close" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </header>
    
        <div className="sb-body" style={{ "--sb-categories-w": `${paneWidths.categories}px`, "--sb-editor-w": `${paneWidths.editor}px` } as CSSProperties}>
          <aside className="sb-categories" aria-label="Script button categories">
            <div className="sb-pane-label">Categories</div>
            <div className="sb-category-list" role="listbox" aria-label="Categories">
              {scriptButtonCategories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  role="option"
                  aria-selected={selectedScriptCategory?.id === category.id}
                  className={`sb-category${selectedScriptCategory?.id === category.id ? " selected" : ""}`}
                  onClick={() => {
                    library.setSelectedCategoryId(category.id);
                    setSelectedScriptButtonId(null);
                  }}
                >
                  <span className="sb-category-name">{category.name}</span>
                  <span className="sb-count">{category.buttons.length}</span>
                </button>
              ))}
            </div>
            <form
              className="sb-new-category"
              onSubmit={(event) => {
                event.preventDefault();
                handleAddScriptCategory();
              }}
            >
              <input
                className="sb-input"
                value={categoryDraft.name}
                placeholder="New category"
                aria-label="New script category name"
                onChange={(event) => setCategoryDraft({ name: event.target.value })}
              />
              <button type="submit" className="sb-icon-btn sb-icon-btn-boxed" title="Add category" aria-label="Add category" disabled={!categoryDraft.name.trim()}>
                <Plus size={15} />
              </button>
            </form>
          </aside>
    
          <button type="button" className="sb-resizer" aria-label="Resize categories" title="Drag to resize - double-click resets"
            onPointerDown={(event) => startPaneResize(event, "categories")} onDoubleClick={() => resetPaneWidth("categories")} />
          <div className="sb-buttons">
            {selectedScriptCategory ? (
              <div className="sb-category-head">
                <input
                  className="sb-category-title"
                  value={categoryEditName}
                  aria-label="Category name"
                  title="Rename category"
                  onChange={(event) => setCategoryEditName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && isCategoryEditDirty) {
                      handleSaveScriptCategoryName();
                    } else if (event.key === "Escape" && isCategoryEditDirty) {
                      event.preventDefault();
                      event.stopPropagation();
                      handleRevertScriptCategoryName();
                    }
                  }}
                />
                {isCategoryEditDirty ? (
                  <>
                    <button type="button" className="sh-btn sh-btn-ghost sh-btn-sm" onClick={handleRevertScriptCategoryName}>Cancel</button>
                    <button type="button" className="sh-btn sh-btn-primary sh-btn-sm" onClick={handleSaveScriptCategoryName}>Rename</button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="sb-icon-btn sb-icon-btn-danger"
                      title="Delete category"
                      aria-label="Delete category"
                      onClick={() => library.deleteCategory(selectedScriptCategory.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                    <button type="button" className="sh-btn sh-btn-secondary sh-btn-sm" onClick={() => setSelectedScriptButtonId(null)}>
                      <Plus size={14} />
                      New button
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="sb-category-head">
                <span className="sb-muted">Create a category to add buttons.</span>
              </div>
            )}
            <div className="sb-button-list" aria-label="Script buttons" tabIndex={0} onKeyDown={handleScriptButtonListKeyDown}>
              {library.error && <div className="sb-alert">{library.error}</div>}
              {selectedScriptCategory && activeScriptButtons.length === 0 && (
                <div className="sb-empty">No buttons in this category yet.</div>
              )}
              {activeScriptButtons.map((button, index) => (
                <button
                  className={`sb-row${selectedScriptButton?.id === button.id ? " selected" : ""}${draggingScriptButtonId === button.id ? " dragging" : ""}`}
                  key={button.id}
                  type="button"
                  draggable
                  title={button.label}
                  onClick={() => setSelectedScriptButtonId(button.id)}
                  onContextMenu={(event) => onButtonContextMenu(event, button.id)}
                  onDragStart={(event) => {
                    setDraggingScriptButtonId(button.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", button.id);
                  }}
                  onDragEnd={() => setDraggingScriptButtonId(null)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const sourceButtonId = event.dataTransfer.getData("text/plain") || draggingScriptButtonId;
                    if (sourceButtonId) {
                      library.moveButtonTo(sourceButtonId, index);
                    }
                    setDraggingScriptButtonId(null);
                  }}
                >
                  <GripVertical className="sb-grip" size={14} aria-hidden="true" />
                  <span className="sh-script-dot" style={getScriptButtonStatusStyle(button.color)} aria-hidden="true" />
                  <span className="sb-row-main">
                    <span className="sb-row-title">{button.label}</span>
                    <span className="sb-row-script">{button.script || "No send string"}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
    
          <button type="button" className="sb-resizer" aria-label="Resize editor" title="Drag to resize - double-click resets"
            onPointerDown={(event) => startPaneResize(event, "editor")} onDoubleClick={() => resetPaneWidth("editor")} />
          <form
            className="sb-editor"
            onSubmit={(event) => {
              event.preventDefault();
              if (isEditingButton) {
                if (isScriptButtonEditDirty) {
                  handleSaveScriptButtonEdit();
                }
              } else if (canAddButton) {
                handleAddScriptButton();
              }
            }}
          >
            <div className="sb-editor-scroll">
              <div className="sb-editor-head">
                <strong>{isEditingButton ? "Edit button" : "New button"}</strong>
                <span>{isEditingButton ? `In ${selectedScriptCategory?.name ?? ""}` : selectedScriptCategory ? `Adds to ${selectedScriptCategory.name}` : "Select a category first"}</span>
              </div>
    
              <label className="sb-field">
                <span>Label</span>
                <input
                  className="sb-input"
                  value={editorDraft.label}
                  placeholder="e.g. db_stat"
                  aria-label={isEditingButton ? "Script button label" : "New script button label"}
                  onChange={(event) => setEditorDraft((current) => ({ ...current, label: event.target.value }))}
                />
              </label>
    
              <div className="sb-field">
                <span>Color</span>
                <div className="sb-swatches" role="radiogroup" aria-label="Button color">
                  {scriptButtonColorOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={editorDraft.color === option.value}
                      aria-label={option.label}
                      title={option.label}
                      className={`sb-swatch${editorDraft.color === option.value ? " selected" : ""}`}
                      style={{ "--sb-swatch": option.color } as CSSProperties}
                      onClick={() => setEditorDraft((current) => ({ ...current, color: option.value }))}
                    />
                  ))}
                </div>
              </div>
    
              <label className="sb-field">
                <span>Send string</span>
                <textarea
                  className="sb-input sb-textarea"
                  value={editorDraft.script}
                  placeholder="Command with \r, \n, \t, \p tokens"
                  aria-label={isEditingButton ? "Script button send string" : "New script button send string"}
                  rows={6}
                  wrap="soft"
                  spellCheck={false}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                    }
                  }}
                  onPaste={(event) => pasteIntoSendString(event, setEditorDraft)}
                  onChange={(event) => setEditorDraft((current) => ({ ...current, script: event.target.value }))}
                />
              </label>
              <dl className="sb-tokens">
                <div><dt>\r</dt><dd>Enter</dd></div>
                <div><dt>\n</dt><dd>Newline</dd></div>
                <div><dt>\t</dt><dd>Tab</dd></div>
                <div><dt>\p</dt><dd>Pause 1 s</dd></div>
                <div><dt>\e</dt><dd>Escape</dd></div>
                <div><dt>\b</dt><dd>Backspace</dd></div>
              </dl>

              <label className="sb-check">
                <input
                  className="sh-switch"
                  type="checkbox"
                  role="switch"
                  checked={editorDraft.showTooltip}
                  onChange={(event) => setEditorDraft((current) => ({ ...current, showTooltip: event.target.checked }))}
                />
                <span>
                  Show the send string as a tooltip
                  <small>Turn off for buttons that type a password.</small>
                </span>
              </label>
    
              <div className="sb-field">
                <span>Preview</span>
                <div className="sb-preview">
                  <span className="sh-script" style={getScriptButtonStatusStyle(editorDraft.color)}>
                    <span className="sh-script-dot" aria-hidden="true" />
                    <span className="sh-script-label">{editorDraft.label.trim() || "Button"}</span>
                  </span>
                </div>
              </div>
            </div>
    
            <div className="sb-editor-actions">
              {isEditingButton && selectedScriptButton ? (
                <>
                  <button type="button" className="sh-btn sh-btn-danger-ghost sh-btn-sm" onClick={() => library.deleteButton(selectedScriptButton.id)}>
                    <Trash2 size={14} />
                    Delete
                  </button>
                  <span className="sb-spacer" />
                  <button type="button" className="sh-btn sh-btn-ghost sh-btn-sm" disabled={!isScriptButtonEditDirty} onClick={handleRevertScriptButtonEdit}>
                    <RotateCcw size={14} />
                    Revert
                  </button>
                  <button type="submit" className="sh-btn sh-btn-primary sh-btn-sm" disabled={!isScriptButtonEditDirty}>
                    Save
                  </button>
                </>
              ) : (
                <>
                  <span className="sb-spacer" />
                  <button type="submit" className="sh-btn sh-btn-primary sh-btn-sm" disabled={!canAddButton}>
                    <Plus size={14} />
                    Add button
                  </button>
                </>
              )}
            </div>
          </form>
        </div>
        <button
          className="sb-resize"
          type="button"
          aria-label="Resize script button manager"
          onPointerDown={(event) => startFrameDrag(event, frame, (next) => setFrame(clampLargeDialogFrame(next)), "resize")}
        />
      </div>
    </section>
  );
}
