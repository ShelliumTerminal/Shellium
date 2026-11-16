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
  /** Open tabs (a split tab counts once). */
  tabCount: number;
  /** Panes in the tab of `session` (1 = not split). */
  paneCount: number;
  maxPanes: number;
  onSplitRight(): void;
  onSplitDown(): void;
  onSplitWithSession(): void;
  onMoveToNewTab(): void;
  onCloseTab(): void;
  onRename(): void;
  onDuplicate(): void;
  onReconnect(): void;
  onToggleProtection(): void;
  onToggleNotifyWhenDone(): void;
  onDisconnect(): void;
  onClose(): void;
  onCloseOthers(): void;
};

/** Right-click menu of a session tab, or of one pane of a split tab (its title row). */
export default function TabContextMenu({ menu, session, tabCount, paneCount, maxPanes, onSplitRight, onSplitDown, onSplitWithSession, onMoveToNewTab, onCloseTab, onRename, onDuplicate, onReconnect, onToggleProtection, onToggleNotifyWhenDone, onDisconnect, onClose, onCloseOthers }: TabContextMenuProps) {
  const isSplit = paneCount > 1;
  const canSplit = paneCount < maxPanes;
  const splitTitle = canSplit ? undefined : `At most ${maxPanes} panes in a tab`;
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
      <div className="sh-menu-separator" role="separator" />
      <button type="button" role="menuitem" disabled={!canSplit} title={splitTitle ?? "The same host in a new pane beside this one (its own connection)"} onClick={onSplitRight}>
        Split Right
      </button>
      <button type="button" role="menuitem" disabled={!canSplit} title={splitTitle ?? "The same host in a new pane below this one (its own connection)"} onClick={onSplitDown}>
        Split Down
      </button>
      <button type="button" role="menuitem" disabled={!canSplit} title={splitTitle ?? "Choose a saved session for the new pane"} onClick={onSplitWithSession}>
        Split with Session…
      </button>
      {isSplit && (
        <button type="button" role="menuitem" onClick={onMoveToNewTab}>
          Move to New Tab
        </button>
      )}
      <div className="sh-menu-separator" role="separator" />
      <button type="button" role="menuitem" disabled={session.status === "connected"} onClick={onReconnect}>
        Reconnect
      </button>
      <button type="button" role="menuitem" disabled={session.status !== "connected"} onClick={onToggleProtection}>
        {session.protection ? "Stop Protection" : "Protect Session"}
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={Boolean(session.notifyWhenDone)}
        disabled={session.status !== "connected"}
        title="A notification when the running command (or the next one) finishes - its prompt is back"
        onClick={onToggleNotifyWhenDone}
      >
        {session.notifyWhenDone ? "\u2713 Notify When Done" : "Notify When Done"}
      </button>
      <button type="button" role="menuitem" disabled={session.status === "disconnected"} onClick={onDisconnect}>
        Disconnect
      </button>
      <div className="sh-menu-separator" role="separator" />
      {isSplit ? (
        <>
          <button type="button" role="menuitem" onClick={onClose}>
            Close Pane
          </button>
          <button type="button" role="menuitem" onClick={onCloseTab}>
            Close Tab ({paneCount} panes)
          </button>
        </>
      ) : (
        <button type="button" role="menuitem" onClick={onClose}>
          Close
        </button>
      )}
      <button type="button" role="menuitem" disabled={tabCount <= 1} onClick={onCloseOthers}>
        Close All Others
      </button>
    </div>
  );
}
