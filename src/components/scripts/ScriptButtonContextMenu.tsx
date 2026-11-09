export type ScriptButtonContextMenuState = {
  buttonId: string;
  x: number;
  y: number;
};

type ScriptButtonContextMenuProps = {
  menu: ScriptButtonContextMenuState;
  onModify(): void;
  onMoveUp(): void;
  onMoveDown(): void;
  onRemove(): void;
};

/** Right-click menu of a script button (bar or manager). */
export default function ScriptButtonContextMenu({ menu, onModify, onMoveUp, onMoveDown, onRemove }: ScriptButtonContextMenuProps) {
  return (
    <div
      className="sh-context-menu"
      style={{ top: menu.y, left: menu.x }}
      role="menu"
      aria-label="Script button actions"
      onClick={(event) => event.stopPropagation()}
    >
      <button type="button" role="menuitem" onClick={onModify}>
        Modify
      </button>
      <button type="button" role="menuitem" onClick={onMoveUp}>
        Move Up
      </button>
      <button type="button" role="menuitem" onClick={onMoveDown}>
        Move Down
      </button>
      <button type="button" role="menuitem" onClick={onRemove}>
        Remove
      </button>
    </div>
  );
}
