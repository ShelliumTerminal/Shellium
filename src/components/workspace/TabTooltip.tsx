import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";

/** Below a tab strip, beside a left / right session list. */
export type TabTooltipSide = "bottom" | "left" | "right";

type TooltipState = { title: string; anchor: DOMRect; side: TabTooltipSide };

const SHOW_DELAY_MS = 500;
const GAP = 6;
const MARGIN = 8;

/**
 * Hovering a session tab shows its full name in a slim bubble after a short delay, so a name cut off
 * with "..." can still be read. Hidden on any click, wheel, resize or drag.
 * Rendered into the app root so it is themed and never clipped by the tab bar.
 */
export function useTabTooltip() {
  const [state, setState] = useState<TooltipState | null>(null);
  const timerRef = useRef<number | null>(null);

  const hide = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setState(null);
  }, []);

  const show = useCallback((title: string, element: HTMLElement, side: TabTooltipSide) => {
    hide();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (element.isConnected) {
        setState({ title, anchor: element.getBoundingClientRect(), side });
      }
    }, SHOW_DELAY_MS);
  }, [hide]);

  useEffect(() => {
    window.addEventListener("pointerdown", hide, true);
    window.addEventListener("wheel", hide, true);
    window.addEventListener("resize", hide);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      window.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("wheel", hide, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("blur", hide);
    };
  }, [hide]);

  /** Props for a tab: hover shows, leaving hides. `enabled` false (e.g. while dragging) shows nothing. */
  const bind = (title: string, side: TabTooltipSide, enabled = true) => ({
    onPointerEnter: (event: ReactPointerEvent<HTMLElement>) => {
      if (enabled && event.pointerType !== "touch") {
        show(title, event.currentTarget.closest<HTMLElement>(".sh-tab") ?? event.currentTarget, side);
      }
    },
    onPointerLeave: hide,
  });

  return { bind, hide, tooltip: state ? <TabTooltip {...state} /> : null };
}

function TabTooltip({ title, anchor, side }: TooltipState) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<CSSProperties>({ left: -9999, top: -9999 });
  const host = typeof document === "undefined" ? null : document.querySelector(".shellium-shell");

  useLayoutEffect(() => {
    const tip = ref.current;
    if (!tip) {
      return;
    }
    const { width, height } = tip.getBoundingClientRect();
    let left: number;
    let top: number;
    if (side === "bottom") {
      top = anchor.bottom + GAP;
      left = anchor.left;
    } else {
      const fitsLeft = anchor.left - GAP - width >= MARGIN;
      const fitsRight = anchor.right + GAP + width <= window.innerWidth - MARGIN;
      const right = side === "right" ? fitsRight || !fitsLeft : !fitsLeft && fitsRight;
      left = right ? anchor.right + GAP : anchor.left - GAP - width;
      top = anchor.top + (anchor.height - height) / 2;
    }
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - MARGIN - width));
    top = Math.max(MARGIN, Math.min(top, window.innerHeight - MARGIN - height));
    setPosition({ left, top });
  }, [anchor, side]);

  if (!host) {
    return null;
  }

  return createPortal(
    <div className="sh-tab-tooltip" role="tooltip" ref={ref} style={position}>
      {title}
    </div>,
    host,
  );
}
