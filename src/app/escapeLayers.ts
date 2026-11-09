import { useEffect, useRef } from "react";

/**
 * Escape closes only the topmost window. Every dialog, menu or overlay registers itself while it is
 * open (`useEscapeLayer`); layers stack in the order they opened, and one window-level listener
 * calls the top one. A component that handles Escape itself (clearing a search box, cancelling an
 * inline edit) calls `event.preventDefault()`, and the layers leave that keystroke alone. With no
 * window open, Escape in the terminal goes to the remote side (vim); with one open it closes it even
 * if the terminal behind still has focus (caught before xterm sees the key).
 */

type Layer = { onEscape: () => void };

const layers: Layer[] = [];
let emptyHandler: (() => void) | null = null;
let listening = false;

function isTerminalTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(".xterm"));
}

/** Capture phase: a window is open but the terminal behind it has focus - xterm must not get the key. */
function handleTerminalKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape" && layers.length > 0 && isTerminalTarget(event.target)) {
    handleKeyDown(event);
  }
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) {
    return;
  }

  const top = layers[layers.length - 1];
  if (!top) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  top.onEscape();

  // Back to the terminal once the last window is gone (not earlier: a focused terminal would
  // swallow the next Escape meant for the window underneath).
  window.setTimeout(() => {
    if (layers.length === 0) {
      emptyHandler?.();
    }
  }, 50);
}

/** Registers a window while `active`; `onEscape` is what Escape does when it is the topmost one. */
export function useEscapeLayer(onEscape: () => void, active = true) {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) {
      return;
    }

    if (!listening) {
      window.addEventListener("keydown", handleTerminalKeyDown, true);
      window.addEventListener("keydown", handleKeyDown);
      listening = true;
    }

    const layer: Layer = { onEscape: () => onEscapeRef.current() };
    layers.push(layer);
    return () => {
      const index = layers.indexOf(layer);
      if (index >= 0) {
        layers.splice(index, 1);
      }
    };
  }, [active]);
}

/** Called after Escape closed the last open window (the app focuses the terminal). */
export function setEscapeLayersEmptyHandler(handler: (() => void) | null) {
  emptyHandler = handler;
}
