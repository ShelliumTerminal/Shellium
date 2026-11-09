import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { encodeLegacyScriptAsSendString } from "../../app/scriptButtonModel";
import type { ScriptButton } from "../../app/scriptButtonModel";

/** Where the tooltip goes relative to the button: above / below a horizontal bar, beside a vertical one. */
export type ScriptTooltipSide = "top" | "bottom" | "left" | "right";

type TooltipState = { button: ScriptButton; anchor: DOMRect; side: ScriptTooltipSide };

const SHOW_DELAY_MS = 450;
const GAP = 8;
const MARGIN = 8;
const MAX_LINES = 24;

/** The send string as written in the editor, one line per line end (\r, \n, \r\n), tokens marked. */
function sendStringLines(button: ScriptButton) {
  const sendString = encodeLegacyScriptAsSendString(button.script);
  const lines: Array<Array<{ text: string; token: boolean }>> = [[]];
  const pattern = /\\(?:r\\n|[rntpeb\\])/gi;
  let last = 0;
  for (const match of sendString.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) {
      lines[lines.length - 1].push({ text: sendString.slice(last, index), token: false });
    }
    lines[lines.length - 1].push({ text: match[0], token: true });
    last = index + match[0].length;
    if (/^\\[rn]/i.test(match[0])) {
      lines.push([]);
    }
  }
  if (last < sendString.length) {
    lines[lines.length - 1].push({ text: sendString.slice(last), token: false });
  }
  if (lines.length > 1 && lines[lines.length - 1].length === 0) {
    lines.pop();
  }
  return lines;
}

/**
 * Hovering a script button shows its send string after a short delay (per button, see
 * ScriptButton.showTooltip). Rendered into the app root so it is themed and never clipped by the bar.
 */
export function useScriptButtonTooltip() {
  const [state, setState] = useState<TooltipState | null>(null);
  const timerRef = useRef<number | null>(null);

  const hide = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setState(null);
  }, []);

  const show = useCallback((button: ScriptButton, element: HTMLElement, side: ScriptTooltipSide) => {
    hide();
    if (!button.showTooltip) {
      return;
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (element.isConnected) {
        setState({ button, anchor: element.getBoundingClientRect(), side });
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

  /** Props for a script button: hover shows, leaving hides. */
  const bind = (button: ScriptButton, side: ScriptTooltipSide) => ({
    onPointerEnter: (event: ReactPointerEvent<HTMLElement>) => show(button, event.currentTarget, side),
    onPointerLeave: hide,
  });

  return { bind, hide, tooltip: state ? <ScriptButtonTooltip {...state} /> : null };
}

function ScriptButtonTooltip({ button, anchor, side }: TooltipState) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<CSSProperties>({ left: -9999, top: -9999 });
  const host = typeof document === "undefined" ? null : document.querySelector(".shellium-shell");
  const lines = sendStringLines(button);
  const shown = lines.slice(0, MAX_LINES);

  useLayoutEffect(() => {
    const tip = ref.current;
    if (!tip) {
      return;
    }
    const { width, height } = tip.getBoundingClientRect();
    const fitsAbove = anchor.top - GAP - height >= MARGIN;
    const fitsBelow = anchor.bottom + GAP + height <= window.innerHeight - MARGIN;
    const fitsLeft = anchor.left - GAP - width >= MARGIN;
    const fitsRight = anchor.right + GAP + width <= window.innerWidth - MARGIN;
    let left: number;
    let top: number;
    if (side === "top" || side === "bottom") {
      const below = side === "bottom" ? fitsBelow || !fitsAbove : !fitsAbove && fitsBelow;
      top = below ? anchor.bottom + GAP : anchor.top - GAP - height;
      left = anchor.left;
    } else {
      const right = side === "right" ? fitsRight || !fitsLeft : !fitsLeft && fitsRight;
      left = right ? anchor.right + GAP : anchor.left - GAP - width;
      top = anchor.top;
    }
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - MARGIN - width));
    top = Math.max(MARGIN, Math.min(top, window.innerHeight - MARGIN - height));
    setPosition({ left, top });
  }, [anchor, side]);

  if (!host) {
    return null;
  }

  return createPortal(
    <div className="sh-script-tooltip" role="tooltip" ref={ref} style={position}>
      <div className="sh-script-tooltip-label">{button.label}</div>
      <pre className="sh-script-tooltip-body">
        {shown.map((line, lineIndex) => (
          <div key={lineIndex}>
            {line.length === 0 ? " " : line.map((piece, pieceIndex) => (
              piece.token
                ? <span key={pieceIndex} className="sh-script-tooltip-token">{piece.text}</span>
                : <span key={pieceIndex}>{piece.text}</span>
            ))}
          </div>
        ))}
        {lines.length > shown.length && <div className="sh-script-tooltip-more">{lines.length - shown.length} more lines</div>}
      </pre>
    </div>,
    host,
  );
}
