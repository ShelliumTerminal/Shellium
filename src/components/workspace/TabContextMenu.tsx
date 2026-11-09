import type { Session } from "../palette/types";
import { getSessionTitle } from "../../app/sessionModel";

export type TabContextMenuState = {
  sessionId: string;
  x: number;
  y: number;
};

type TabContextMenuProps = {
  menu: TabContextMenuState;
  session: Session;
  sessionCount: number;
  onRename(): void;
  onDuplicate(): void;
  onReconnect(): void;
  onToggleProtection(): void;
  onDisconnect(): void;
  onClose(): void;
  onCloseOthers(): void;
};

/** Right-click menu of a session tab. */
export default function TabContextMenu({ menu, session, sessionCount, onRename, onDuplicate, onReconnect, onToggleProtection, onDisconnect, onClose, onCloseOthers }: TabContextMenuProps) {
  return (
    <div
      className="sh-context-menu"
      role="menu"
      aria-label={`${getSessionTitle(session)} tab actions`}
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
    >
      <button type="button" role="menuitem" onClick={onRename}>
        Rename
      </button>
      <button type="button" role="menuitem" disabled={session.status === "disconnected"} onClick={onDuplicate}>
        Clone Session
      </button>
      <button type="button" role="menuitem" disabled={session.status === "connected"} onClick={onReconnect}>
        Reconnect
      </button>
      <button type="button" role="menuitem" disabled={session.status !== "connected"} onClick={onToggleProtection}>
        {session.protection ? "Stop Protection" : "Protect Session"}
      </button>
      <button type="button" role="menuitem" disabled={session.status === "disconnected"} onClick={onDisconnect}>
        Disconnect
      </button>
      <button type="button" role="menuitem" onClick={onClose}>
        Close
      </button>
      <button type="button" role="menuitem" disabled={sessionCount <= 1} onClick={onCloseOthers}>
        Close All Others
      </button>
    </div>
  );
}
