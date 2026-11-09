/** process.platform of the main process, exposed by preload ("win32", "darwin", "linux"). */
export const isMac = typeof window !== "undefined" && window.shellium?.app.platform === "darwin";

/**
 * Connect dialog shortcut (S for session): Alt+S, Cmd+S on macOS (Option+S types "ß" there).
 * Owner, 2026-11-09: it was Alt+B, which took word-back (readline M-b) away from the terminal; M-s has
 * no readline binding. Not Ctrl+S: nano saves with it, emacs with C-x C-s, mc and bash search with it.
 * Matched by the physical key (`code`), like the check in electron/main.ts.
 */
export const connectShortcutKeys = isMac ? ["⌘", "S"] : ["Alt", "S"];
export const connectShortcutLabel = isMac ? "⌘S" : "Alt+S";

export function isConnectShortcut(event: KeyboardEvent) {
  if (event.code !== "KeyS" || event.shiftKey || event.ctrlKey) {
    return false;
  }
  return isMac ? event.metaKey && !event.altKey : event.altKey && !event.metaKey;
}
