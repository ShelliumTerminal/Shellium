import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";
import { ShieldCheck, X } from "lucide-react";
import { EnvironmentBadge, environmentStyle, useEnvironments } from "../common/environments";
import type { Session } from "../palette/types";
import { getSessionTitle } from "../../app/sessionModel";
import { MAX_PANES, PANE_GAP as GAP, layoutTree, nearestEdge, paneStyle, tabSessionIds } from "../../app/splitLayout";
import type { PaneEdge, PaneLayout, PaneRect, SessionTab } from "../../app/splitLayout";

/**
 * A tab is being dragged in the tab list (it can be dropped onto a pane of another tab), or a pane
 * by its title row (`paneSessionId`: dropped onto another pane of its tab to move or swap it).
 */
export type TabDragState = {
  sourceTabId: string;
  /** The pane that was shown before the drag selected the dragged tab: the drop target's tab. */
  returnSessionId: string | null;
  paneSessionId?: string;
};

/** Where a dragged pane lands: next to the target pane, or "center" = the two swap places. */
export type PaneDropEdge = PaneEdge | "center";

/** Pointer travel (px) before pressing a pane's title row becomes a drag. */
const DRAG_THRESHOLD = 5;

type PaneHeaderProps = {
  session: Session;
  isFocused: boolean;
  onClose(sessionId: string): void;
  onContextMenu(event: ReactMouseEvent<HTMLDivElement>, sessionId: string): void;
  /** The title row was pressed and moved: the pane is being dragged. */
  onDragStart(sessionId: string): void;
};

/** Title row of a pane in a split tab: which host this is (environment color), close, right-click menu. */
export function PaneHeader({ session, isFocused, onClose, onContextMenu, onDragStart }: PaneHeaderProps) {
  const environments = useEnvironments();
  const environment = session.host.environmentId
    ? environments.find((item) => item.id === session.host.environmentId) ?? null
    : null;
  const title = getSessionTitle(session);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const stop = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("blur", stop);
    };
    const handleMove = (moveEvent: PointerEvent) => {
      if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) >= DRAG_THRESHOLD) {
        stop();
        onDragStart(session.id);
      }
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("blur", stop);
  };

  return (
    <div
      title="Drag to move this pane"
      onPointerDown={handlePointerDown}
      className={`sh-pane-head sh-tab-${session.status}${isFocused ? " focused" : ""}${environment?.warn ? " sh-pane-head-warn" : ""}`}
      style={environment ? environmentStyle(environment) : undefined}
      onContextMenu={(event) => onContextMenu(event, session.id)}
    >
      <span className="sh-tab-dot" aria-hidden="true" />
      {session.protection && (
        <span className="sh-pane-head-shield" title={`Protected (${session.protection.tool} on the server)`}>
          <ShieldCheck size={12} aria-label="Protected" />
        </span>
      )}
      <span className="sh-pane-head-title" title={title}>{title}</span>
      <EnvironmentBadge environmentId={session.host.environmentId} />
      <button
        type="button"
        className="sh-pane-head-close"
        aria-label={`Close pane ${title}`}
        title="Close pane (ends its session)"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onClose(session.id)}
      >
        <X size={12} />
      </button>
    </div>
  );
}

type SplitStageProps = {
  stageRef: RefObject<HTMLElement>;
  tabs: SessionTab[];
  /** The shown tab. */
  activeTab: SessionTab | null;
  /** Its layout when it has more than one pane. */
  layout: PaneLayout | null;
  onRatioChange(splitId: string, ratio: number): void;
  onResizeEnd(): void;
  drag: TabDragState | null;
  /** Shows the pane's tab in the stage (the drop target while a tab is dragged). */
  onShowSession(sessionId: string): void;
  onDrop(sourceTabId: string, targetSessionId: string, edge: PaneEdge): void;
  /** A pane dragged by its title row was dropped onto another pane. */
  onPaneDrop(sessionId: string, targetSessionId: string, edge: PaneDropEdge): void;
};

type DropTarget = { sessionId: string; edge: PaneDropEdge; rect: PaneRect; allowed: boolean };

/**
 * What lies over the panes of the stage: the dividers of a split tab, and while a tab is dragged in
 * the tab list, the drop zone that adds its panes to the shown tab.
 */
export default function SplitStage({ stageRef, tabs, activeTab, layout, onRatioChange, onResizeEnd, drag, onShowSession, onDrop, onPaneDrop }: SplitStageProps) {
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!drag) {
      setDropTarget(null);
    }
  }, [drag]);

  useEffect(() => () => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
    }
  }, []);

  const startDividerDrag = (event: ReactPointerEvent<HTMLDivElement>, splitId: string, direction: "row" | "column", parent: PaneRect) => {
    const stage = stageRef.current;
    if (event.button !== 0 || !stage) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    document.documentElement.classList.add("sh-resizing", direction === "row" ? "sh-resizing-col" : "sh-resizing-row");
    const bounds = stage.getBoundingClientRect();
    let pending: number | null = null;

    const handleMove = (moveEvent: PointerEvent) => {
      const percent = direction === "row"
        ? ((moveEvent.clientX - bounds.left) / bounds.width) * 100
        : ((moveEvent.clientY - bounds.top) / bounds.height) * 100;
      pending = direction === "row"
        ? (percent - parent.left) / parent.width
        : (percent - parent.top) / parent.height;
      if (frameRef.current === null) {
        frameRef.current = window.requestAnimationFrame(() => {
          frameRef.current = null;
          if (pending !== null) {
            onRatioChange(splitId, pending);
          }
        });
      }
    };
    const handleUp = () => {
      document.documentElement.classList.remove("sh-resizing", "sh-resizing-col", "sh-resizing-row");
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("blur", handleUp);
      if (pending !== null) {
        onRatioChange(splitId, pending);
      }
      onResizeEnd();
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("blur", handleUp);
  };

  const sourceTab = drag ? tabs.find((tab) => tab.id === drag.sourceTabId) ?? null : null;
  const isPaneDrag = Boolean(drag?.paneSessionId);
  // a dragged tab drops into another tab; a dragged pane into its own tab
  const isTargetShown = Boolean(activeTab && sourceTab && (isPaneDrag ? activeTab.id === sourceTab.id : activeTab.id !== sourceTab.id));

  const handleOverlayEnter = () => {
    if (!drag || isPaneDrag || !sourceTab || isTargetShown || !drag.returnSessionId) {
      return;
    }
    // the drag selected the dragged tab: show the tab it can be dropped into
    if (!tabSessionIds(sourceTab).includes(drag.returnSessionId)) {
      onShowSession(drag.returnSessionId);
    }
  };

  const handleOverlayMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!activeTab || !sourceTab || !isTargetShown) {
      setDropTarget(null);
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 100;
    const y = ((event.clientY - bounds.top) / bounds.height) * 100;
    const pane = layoutTree(activeTab.root).panes.find(({ rect }) =>
      x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height);
    if (!pane || pane.sessionId === drag?.paneSessionId) {
      setDropTarget(null);
      return;
    }
    const { rect } = pane;
    const relX = (x - rect.left) / rect.width;
    const relY = (y - rect.top) / rect.height;
    // a pane dropped onto the middle of another swaps places with it
    const edge: PaneDropEdge = isPaneDrag && Math.abs(relX - 0.5) < 0.2 && Math.abs(relY - 0.5) < 0.2 ? "center" : nearestEdge(relX, relY);
    const half: PaneRect =
      edge === "center" ? { left: rect.left + rect.width * 0.2, top: rect.top + rect.height * 0.2, width: rect.width * 0.6, height: rect.height * 0.6 }
        : edge === "left" ? { ...rect, width: rect.width / 2 }
        : edge === "right" ? { ...rect, left: rect.left + rect.width / 2, width: rect.width / 2 }
          : edge === "top" ? { ...rect, height: rect.height / 2 }
            : { ...rect, top: rect.top + rect.height / 2, height: rect.height / 2 };
    const allowed = isPaneDrag || tabSessionIds(sourceTab).length + tabSessionIds(activeTab).length <= MAX_PANES;
    setDropTarget((current) =>
      current && current.sessionId === pane.sessionId && current.edge === edge && current.allowed === allowed
        ? current
        : { sessionId: pane.sessionId, edge, rect: half, allowed });
  };

  const handleOverlayUp = () => {
    if (drag && dropTarget?.allowed) {
      if (drag.paneSessionId) {
        onPaneDrop(drag.paneSessionId, dropTarget.sessionId, dropTarget.edge);
      } else if (dropTarget.edge !== "center") {
        onDrop(drag.sourceTabId, dropTarget.sessionId, dropTarget.edge);
      }
    }
    setDropTarget(null);
  };

  return (
    <>
      {layout?.dividers.map((divider) => (
        <div
          key={divider.splitId}
          className={`sh-split-divider sh-split-divider-${divider.direction}`}
          role="separator"
          aria-orientation={divider.direction === "row" ? "vertical" : "horizontal"}
          style={divider.direction === "row"
            ? { left: `calc(${divider.rect.left}% - ${GAP / 2}px)`, top: `${divider.rect.top}%`, width: GAP, height: `${divider.rect.height}%` }
            : { top: `calc(${divider.rect.top}% - ${GAP / 2}px)`, left: `${divider.rect.left}%`, height: GAP, width: `${divider.rect.width}%` }}
          onPointerDown={(event) => startDividerDrag(event, divider.splitId, divider.direction, divider.parent)}
        />
      ))}
      {drag && (
        <div
          className="sh-split-drop"
          onPointerEnter={handleOverlayEnter}
          onPointerMove={handleOverlayMove}
          onPointerLeave={() => setDropTarget(null)}
          onPointerUp={handleOverlayUp}
        >
          {dropTarget && (
            <div className={`sh-split-drop-zone${dropTarget.allowed ? "" : " refused"}`} style={paneStyle(dropTarget.rect)}>
              <span>{!dropTarget.allowed ? `At most ${MAX_PANES} panes in a tab` : dropTarget.edge === "center" ? "Drop to swap" : isPaneDrag ? "Drop to move here" : "Drop to split"}</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
