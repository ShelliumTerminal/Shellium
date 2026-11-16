import { useEffect, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { Bell, BellRing, CircleCheck, ChevronDown, Columns2, Home, Plus, Settings, ShieldCheck, X } from "lucide-react";
import { EnvironmentBadge, environmentStyle, useEnvironments } from "../common/environments";
import type { Session } from "../palette/types";
import { normalizeTerminalTabSize } from "../../app/appOptions";
import type { TerminalTabPosition } from "../../app/appOptions";
import { getSessionTitle } from "../../app/sessionModel";
import { useTabTooltip } from "./TabTooltip";

/** One tab: a session, or the panes of a split tab (the focused one names the tab). */
export type SessionTabItem = { id: string; panes: Session[]; focused: Session };

type SessionTabsProps = {
  tabs: SessionTabItem[];
  activeSessionId: string | null;
  /** Home is the shown page (no session active and the Options tab not shown). */
  isHomeActive: boolean;
  /** The Options tab when it is open: shown or not, with unsaved changes or not. */
  optionsTab: { active: boolean; dirty: boolean } | null;
  onSelectOptions(): void;
  onCloseOptions(): void;
  /** null = Home. */
  onSelect(sessionId: string | null): void;
  /** Closes the whole tab (all panes of a split tab). */
  onClose(sessionId: string): void;
  onContextMenu(event: ReactMouseEvent<HTMLDivElement>, sessionId: string): void;
  /** Drag to reorder: move the tab of `sourceId` next to the tab of `targetId`. */
  onMove(sourceId: string, targetId: string): void;
  /** A tab was grabbed (before it is selected): it may be dropped onto a pane of another tab. */
  onDragStart(sessionId: string): void;
  /** A drag ended - give the terminal its focus back. */
  onDragEnd(): void;
  position: TerminalTabPosition;
  /** Width of a left / right session list. */
  size: number;
  onResize(size: number): void;
  isQuickConnectOpen: boolean;
  onOpenQuickConnect(event: ReactMouseEvent<HTMLButtonElement>): void;
};

/** Home + one tab per session: a strip on top, or a resizable list on the left / right. */
export default function SessionTabs({
  tabs,
  activeSessionId,
  isHomeActive,
  optionsTab,
  onSelectOptions,
  onCloseOptions,
  onSelect,
  onClose,
  onContextMenu,
  onMove,
  onDragStart,
  onDragEnd,
  position,
  size,
  onResize,
  isQuickConnectOpen,
  onOpenQuickConnect,
}: SessionTabsProps) {
  const environments = useEnvironments();
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null);
  const tabsAsStrip = position === "top";
  const tabTooltip = useTabTooltip();
  const tooltipSide = tabsAsStrip ? "bottom" : position === "left" ? "right" : "left";

  useEffect(() => {
    if (!draggingSessionId) {
      return;
    }

    const stopDragging = () => {
      setDraggingSessionId(null);
      onDragEnd();
    };

    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("blur", stopDragging);
    return () => {
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("blur", stopDragging);
    };
  }, [draggingSessionId, onDragEnd]);

  const handleTabPointerDown = (event: ReactPointerEvent<HTMLDivElement>, sessionId: string) => {
    if (event.button !== 0 || event.target instanceof HTMLElement && event.target.closest(".sh-tab-close")) {
      return;
    }

    event.preventDefault();
    tabTooltip.hide();
    onDragStart(sessionId);
    onSelect(sessionId);
    setDraggingSessionId(sessionId);
  };

  const handleTabPointerEnter = (targetSessionId: string) => {
    if (!draggingSessionId || draggingSessionId === targetSessionId) {
      return;
    }

    onMove(draggingSessionId, targetSessionId);
  };

  const handleTabPointerUp = () => {
    if (draggingSessionId) {
      onDragEnd();
    }

    setDraggingSessionId(null);
  };

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (tabsAsStrip) {
      return;
    }

    event.preventDefault();
    document.documentElement.classList.add("sh-resizing");
    const startX = event.clientX;
    const startWidth = size;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      onResize(normalizeTerminalTabSize(position === "left" ? startWidth + delta : startWidth - delta));
    };

    const handlePointerUp = () => {
      document.documentElement.classList.remove("sh-resizing");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  return (
    <nav className={tabsAsStrip ? "sh-tabs sh-tabs-strip" : "sh-tabs sh-tabs-vertical"} aria-label="Open sessions">
      <button
        type="button"
        className={`sh-tab sh-tab-home${isHomeActive ? " active" : ""}`}
        title="Home"
        onClick={() => onSelect(null)}
      >
        <Home size={14} aria-hidden="true" />
        <span className="sh-tab-title">Home</span>
      </button>
      {optionsTab && (
        <div className={`sh-tab sh-tab-home sh-tab-options${optionsTab.active ? " active" : ""}`}>
          <button type="button" className="sh-tab-options-main" title={optionsTab.dirty ? "Options - unsaved changes" : "Options"} onClick={onSelectOptions}>
            <Settings size={14} aria-hidden="true" />
            <span className="sh-tab-title">Options</span>
            {optionsTab.dirty && <span className="sh-tab-options-dirty" aria-label="unsaved changes" />}
          </button>
          <button type="button" className="sh-tab-close" aria-label="Close Options" title="Close Options" onClick={onCloseOptions}>
            <X size={13} />
          </button>
        </div>
      )}
      {!tabsAsStrip && (
        <>
          <button type="button" className={`sh-tab-new-row${isQuickConnectOpen ? " open" : ""}`} onClick={onOpenQuickConnect}>
            <Plus size={15} aria-hidden="true" />
            <span>New session</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          <div className="sh-tabs-label">
            Open sessions <span>{tabs.length}</span>
          </div>
        </>
      )}
      {tabs.map((tab) => {
        const session = tab.focused;
        const isActive = tab.panes.some((pane) => pane.id === activeSessionId);
        const isDragging = tab.panes.some((pane) => pane.id === draggingSessionId);
        const paneEnvironments = tab.panes.map((pane) => pane.host.environmentId
          ? environments.find((environment) => environment.id === pane.host.environmentId) ?? null
          : null);
        // a split tab takes the color of a warning environment (Production) when any pane is in one
        const sessionEnvironment = paneEnvironments.find((environment) => environment?.warn)
          ?? paneEnvironments[tab.panes.indexOf(session)]
          ?? null;
        const isSplit = tab.panes.length > 1;
        const protectedPane = tab.panes.find((pane) => pane.protection);
        const hasActivity = !isActive && tab.panes.some((pane) => pane.hasUnreadActivity);
        const tooltip = isSplit ? tab.panes.map(getSessionTitle).join("  |  ") : getSessionTitle(session);

        return (
          <div
            key={tab.id}
            className={`sh-tab sh-tab-${session.status} ${hasActivity ? "has-activity" : ""} ${isActive ? "active" : ""} ${isDragging ? "dragging" : ""}${sessionEnvironment?.warn ? " sh-tab-warn" : ""}${tab.panes.some((pane) => pane.reconnecting) ? " sh-tab-reconnecting" : ""}${protectedPane ? " sh-tab-protected" : ""}`}
            style={sessionEnvironment ? environmentStyle(sessionEnvironment) : undefined}
            onPointerDown={(event) => handleTabPointerDown(event, session.id)}
            onPointerEnter={() => handleTabPointerEnter(session.id)}
            onPointerUp={handleTabPointerUp}
            onContextMenu={(event) => onContextMenu(event, session.id)}
          >
            <span className="sh-tab-dot" aria-hidden="true" />
            {protectedPane?.protection && (
              <span className="sh-tab-shield" title={protectedPane.reconnecting ? "Protected - reconnecting" : `Protected (${protectedPane.protection.tool} on the server)`}>
                <ShieldCheck size={13} aria-label="Protected" />
              </span>
            )}
            {tab.panes.some((pane) => pane.notifyWhenDone) && (
              <span className="sh-tab-notify" title="Notify When Done: waiting for the command to finish">
                <BellRing size={12} aria-label="Notify when done" />
              </span>
            )}
            {!isActive && tab.panes.some((pane) => pane.isDone) && (
              <span className="sh-tab-done" title="The command finished">
                <CircleCheck size={12} aria-label="Done" />
              </span>
            )}
            {!isActive && tab.panes.some((pane) => pane.hasBell) && (
              <span className="sh-tab-bell" title="The terminal rang its bell">
                <Bell size={12} aria-label="Bell" />
              </span>
            )}
            <button
              className="sh-tab-main"
              type="button"
              onClick={() => onSelect(session.id)}
              {...tabTooltip.bind(tooltip, tooltipSide, !draggingSessionId)}
            >
              <span className="sh-tab-title">{getSessionTitle(session)}</span>
            </button>
            {isSplit && (
              <span className="sh-tab-panes" title={`${tab.panes.length} panes`}>
                <Columns2 size={12} aria-hidden="true" />
                {tab.panes.length}
              </span>
            )}
            <EnvironmentBadge environmentId={sessionEnvironment?.id ?? session.host.environmentId} />
            <button
              className="sh-tab-close"
              onPointerDown={(event) => event.stopPropagation()}
              type="button"
              aria-label={`Close ${getSessionTitle(session)}`}
              onClick={(event) => {
                event.stopPropagation();
                onClose(session.id);
              }}
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
      {tabsAsStrip && (
        <button
          type="button"
          className={`sh-tab-new${isQuickConnectOpen ? " open" : ""}`}
          aria-label="New session"
          title="New session"
          onClick={onOpenQuickConnect}
        >
          <Plus size={15} />
          <ChevronDown size={13} />
        </button>
      )}
      {!tabsAsStrip && (
        <button
          className="sh-tabs-resizer"
          type="button"
          aria-label="Resize session list"
          onPointerDown={handleResizePointerDown}
        />
      )}
      {tabTooltip.tooltip}
    </nav>
  );
}
