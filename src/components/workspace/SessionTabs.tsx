import { useEffect, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, Home, Plus, Settings, ShieldCheck, X } from "lucide-react";
import { EnvironmentBadge, environmentStyle, useEnvironments } from "../common/environments";
import type { Session } from "../palette/types";
import { normalizeTerminalTabSize } from "../../app/appOptions";
import type { TerminalTabPosition } from "../../app/appOptions";
import { getSessionTitle } from "../../app/sessionModel";
import { useTabTooltip } from "./TabTooltip";

type SessionTabsProps = {
  sessions: Session[];
  activeSessionId: string | null;
  /** Home is the shown page (no session active and the Options tab not shown). */
  isHomeActive: boolean;
  /** The Options tab when it is open: shown or not, with unsaved changes or not. */
  optionsTab: { active: boolean; dirty: boolean } | null;
  onSelectOptions(): void;
  onCloseOptions(): void;
  /** null = Home. */
  onSelect(sessionId: string | null): void;
  onClose(sessionId: string): void;
  onContextMenu(event: ReactMouseEvent<HTMLDivElement>, sessionId: string): void;
  /** Drag to reorder: move `sourceId` next to `targetId`. */
  onMove(sourceId: string, targetId: string): void;
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
  sessions,
  activeSessionId,
  isHomeActive,
  optionsTab,
  onSelectOptions,
  onCloseOptions,
  onSelect,
  onClose,
  onContextMenu,
  onMove,
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
            Open sessions <span>{sessions.length}</span>
          </div>
        </>
      )}
      {sessions.map((session) => {
        const sessionEnvironment = session.host.environmentId
          ? environments.find((environment) => environment.id === session.host.environmentId) ?? null
          : null;

        return (
          <div
            key={session.id}
            className={`sh-tab sh-tab-${session.status} ${session.hasUnreadActivity && session.id !== activeSessionId ? "has-activity" : ""} ${session.id === activeSessionId ? "active" : ""} ${session.id === draggingSessionId ? "dragging" : ""}${sessionEnvironment?.warn ? " sh-tab-warn" : ""}${session.reconnecting ? " sh-tab-reconnecting" : ""}${session.protection ? " sh-tab-protected" : ""}`}
            style={sessionEnvironment ? environmentStyle(sessionEnvironment) : undefined}
            onPointerDown={(event) => handleTabPointerDown(event, session.id)}
            onPointerEnter={() => handleTabPointerEnter(session.id)}
            onPointerUp={handleTabPointerUp}
            onContextMenu={(event) => onContextMenu(event, session.id)}
          >
            <span className="sh-tab-dot" aria-hidden="true" />
            {session.protection && (
              <span className="sh-tab-shield" title={session.reconnecting ? "Protected - reconnecting" : `Protected (${session.protection.tool} on the server)`}>
                <ShieldCheck size={13} aria-label="Protected" />
              </span>
            )}
            <button
              className="sh-tab-main"
              type="button"
              onClick={() => onSelect(session.id)}
              {...tabTooltip.bind(getSessionTitle(session), tooltipSide, !draggingSessionId)}
            >
              <span className="sh-tab-title">{getSessionTitle(session)}</span>
            </button>
            <EnvironmentBadge environmentId={session.host.environmentId} />
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
