import { useSyncExternalStore } from "react";

/**
 * Size and cursor of each session's terminal, for the status bar. Kept outside React state: the
 * cursor moves with every bit of output, and only the status bar should re-render for it.
 */
export type TerminalView = { cols: number; rows: number; cursorRow: number; cursorCol: number };

const views = new Map<string, TerminalView>();
const listeners = new Set<() => void>();

export function setTerminalView(sessionId: string, view: TerminalView | null) {
  const current = views.get(sessionId);
  if (view === null) {
    if (!current) {
      return;
    }
    views.delete(sessionId);
  } else {
    if (current && current.cols === view.cols && current.rows === view.rows && current.cursorRow === view.cursorRow && current.cursorCol === view.cursorCol) {
      return;
    }
    views.set(sessionId, view);
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTerminalView(sessionId: string | null) {
  return useSyncExternalStore(subscribe, () => (sessionId ? views.get(sessionId) ?? null : null));
}
