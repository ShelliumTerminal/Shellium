import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEscapeLayer } from "../../app/escapeLayers";
import { isMac } from "../../app/platform";

type EditCommand = "cut" | "copy" | "paste" | "selectAll";

type MenuState = {
  x: number;
  y: number;
  /** null: selected page text (Copy only). */
  field: HTMLInputElement | HTMLTextAreaElement | HTMLElement | null;
  canCut: boolean;
  canCopy: boolean;
  canPaste: boolean;
};

const TEXT_INPUT_TYPES = new Set(["", "text", "search", "password", "email", "url", "tel", "number"]);
const MARGIN = 8;

function editableField(target: EventTarget | null) {
  if (target instanceof HTMLTextAreaElement) {
    return target;
  }
  if (target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type)) {
    return target;
  }
  if (target instanceof HTMLElement && target.isContentEditable) {
    return target;
  }
  return null;
}

function fieldSelection(field: HTMLElement) {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    try {
      return (field.selectionStart ?? 0) !== (field.selectionEnd ?? 0);
    } catch {
      return false; // number inputs have no selection API
    }
  }
  return Boolean(window.getSelection()?.toString());
}

const shortcut = (key: string) => (isMac ? `⌘${key}` : `Ctrl+${key}`);

/**
 * Right-click menu for text fields (Cut / Copy / Paste / Select All) and selected page text (Copy),
 * themed like the other menus; a native menu would follow the OS theme instead of the app's.
 * It only opens when nothing else handled the right click: the terminal (paste) and our own menus
 * (tabs, script buttons, SFTP) cancel the contextmenu event first. The commands run in the main
 * process on the focused field (webContents.cut / copy / paste / selectAll); the menu keeps the
 * focus and selection in the field by never taking focus itself.
 */
export default function EditContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setMenu(null), []);

  useEscapeLayer(close, menu !== null);

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const field = editableField(event.target);
      if (field) {
        event.preventDefault();
        const secret = field instanceof HTMLInputElement && field.type === "password";
        const readOnly = (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && (field.readOnly || field.disabled);
        const selected = fieldSelection(field);
        if (document.activeElement !== field) {
          field.focus();
        }
        setMenu({ x: event.clientX, y: event.clientY, field, canCut: selected && !secret && !readOnly, canCopy: selected && !secret, canPaste: !readOnly });
        return;
      }
      if (window.getSelection()?.toString().trim()) {
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY, field: null, canCut: false, canCopy: true, canPaste: false });
        return;
      }
      setMenu(null);
    };
    window.addEventListener("contextmenu", handleContextMenu);
    return () => window.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  useEffect(() => {
    if (!menu) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node && ref.current?.contains(event.target))) {
        close();
      }
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu, close]);

  useLayoutEffect(() => {
    if (!menu || !ref.current) {
      setPosition(null);
      return;
    }
    const { width, height } = ref.current.getBoundingClientRect();
    setPosition({
      left: Math.max(MARGIN, Math.min(menu.x, window.innerWidth - MARGIN - width)),
      top: Math.max(MARGIN, Math.min(menu.y, window.innerHeight - MARGIN - height)),
    });
  }, [menu]);

  if (!menu) {
    return null;
  }

  const run = (command: EditCommand) => {
    menu.field?.focus();
    window.shellium?.app.edit(command);
    close();
  };

  const item = (command: EditCommand, label: string, key: string, enabled: boolean) => (
    <button type="button" role="menuitem" disabled={!enabled} onClick={() => run(command)}>
      {label}
      <span className="sh-menu-shortcut">{shortcut(key)}</span>
    </button>
  );

  return (
    <div
      className="sh-context-menu sh-edit-menu"
      role="menu"
      aria-label="Edit"
      ref={ref}
      style={position ?? { left: menu.x, top: menu.y, visibility: "hidden" }}
      // keep the focus (and the selection) in the field
      onMouseDown={(event) => event.preventDefault()}
    >
      {menu.field ? (
        <>
          {item("cut", "Cut", "X", menu.canCut)}
          {item("copy", "Copy", "C", menu.canCopy)}
          {item("paste", "Paste", "V", menu.canPaste)}
          <span className="sh-menu-separator" role="separator" />
          {item("selectAll", "Select All", "A", true)}
        </>
      ) : (
        item("copy", "Copy", "C", true)
      )}
    </div>
  );
}
