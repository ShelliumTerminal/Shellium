import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { xtermTheme } from "../common/terminalSchemeModel";
import type { TerminalScheme } from "../common/terminalSchemeModel";
import { ChevronDown, ChevronUp, ClipboardPaste, FolderOpen, Search, SquareTerminal, X } from "lucide-react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import type { ILink } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import type { Session } from "../palette/types";
import "./terminal.css";
import SftpBrowser from "../files/SftpBrowser";
import { useAntiIdleDefaults } from "../common/AntiIdleFields";
import { resolveConnectionKeepalive } from "../common/antiIdleModel";
import type { SftpActivity } from "../files/SftpBrowser";
import { terminalFontStack } from "../../app/appOptions";
import type { TerminalSelectionStyle } from "../../app/appOptions";
import { setTerminalView } from "../../app/terminalViewStore";
import { useEscapeLayer } from "../../app/escapeLayers";
import ProtectionBar from "./ProtectionBar";
import { useSessionProtection } from "./useSessionProtection";
import { findTerminalLinks } from "./terminalLinks";
import type { TerminalLink } from "./terminalLinks";
import type { SessionProtection } from "../palette/types";

export type TerminalFontStyle = "regular" | "italic" | "bold" | "boldItalic";

/** Font of every terminal; colors come from the session's color scheme. */
export type TerminalAppearance = {
  fontFamily: string;
  fontStyle: TerminalFontStyle;
  fontSize: number;
};

export type SftpTransferActivity = {
  active: boolean;
  direction?: "download" | "upload";
  fileName?: string;
};

export type TerminalTranscriptRecordingActivity = {
  active: boolean;
  starting?: boolean;
  filePath?: string;
  /** When the recording started (status bar timer). */
  startedAt?: number;
};

export type TerminalPaneHandle = {
  copySelection(): void;
  pasteFromClipboard(): void;
  openFind(): void;
  openSftp(): void;
  saveTranscript(): void;
  toggleRecording(): void;
  disconnect(): void;
  focus(): void;
  /** Protected session: run the shell in tmux / screen on the server (or switch that off). */
  protect(): void;
  unprotect(): void;
};

type TerminalPaneProps = {
  session: Session;
  isActive: boolean;
  uiScale: number;
  terminalAppearance: TerminalAppearance;
  /** The session's color scheme (host > environment > default, resolved by the app). */
  terminalScheme: TerminalScheme;
  scrollback: number;
  selectionStyle: TerminalSelectionStyle;
  recordingDirectory: string;
  focusVersion: number;
  isInteractionBlocked: boolean;
  reconnectToken?: number;
  onStatusChange(sessionId: string, status: Session["status"]): void;
  onActivity(sessionId: string): void;
  /** The terminal rang its bell (BEL). */
  onBell(sessionId: string): void;
  onNotice(sessionId: string, message: string): void;
  onSftpTransferActivityChange(sessionId: string, activity: SftpTransferActivity): void;
  onTranscriptRecordingActivityChange(sessionId: string, activity: TerminalTranscriptRecordingActivity): void;
  onCloseSession(sessionId: string): void;
  onProtectionChange(sessionId: string, protection: SessionProtection | null): void;
  onReconnectingChange(sessionId: string, reconnecting: boolean): void;
  pasteDialogBounds: PasteDialogBounds;
  onPasteDialogBoundsChange(bounds: PasteDialogBounds): void;
};

type FindMatch = {
  line: number;
  column: number;
  length: number;
};

type TerminalSelectionPoint = {
  row: number;
  column: number;
};

type TerminalSelectionRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type TerminalSelectionRange = {
  anchor: TerminalSelectionPoint;
  focus: TerminalSelectionPoint;
};

export type PasteDialogBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type SftpCloseConfirmFrame = {
  left: number;
  top: number;
  width: number;
};


const pasteDialogViewportMargin = 16;

function createDefaultSftpCloseConfirmFrame(): SftpCloseConfirmFrame {
  const width = Math.min(440, Math.max(340, window.innerWidth - 32));

  return {
    left: Math.max(16, Math.round((window.innerWidth - width) / 2)),
    top: Math.max(16, Math.round((window.innerHeight - 176) / 2)),
    width,
  };
}

function clampSftpCloseConfirmFrame(frame: SftpCloseConfirmFrame): SftpCloseConfirmFrame {
  const viewportMargin = 12;
  const width = Math.min(Math.max(frame.width, 320), Math.max(320, window.innerWidth - viewportMargin * 2));

  return {
    ...frame,
    width,
    left: Math.min(Math.max(viewportMargin, frame.left), Math.max(viewportMargin, window.innerWidth - width - viewportMargin)),
    top: Math.min(Math.max(viewportMargin, frame.top), Math.max(viewportMargin, window.innerHeight - 176 - viewportMargin)),
  };
}

function getTerminalFontWeight(fontStyle: TerminalFontStyle) {
  return fontStyle === "bold" || fontStyle === "boldItalic" ? "bold" : "normal";
}



function normalizePasteTextForDialog(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizePasteTextForTerminal(text: string) {
  return normalizePasteTextForDialog(text).replace(/\n/g, "\r");
}

/** Lines the paste sends: blank lines count, a final line break only ends the last line. */
function countPasteLines(text: string) {
  return normalizePasteTextForDialog(text).replace(/\n$/, "").split("\n").length;
}

/** Lines with visible content - typed input (Alt+Enter, IME) is not mistaken for a paste. */
function countContentLines(text: string) {
  return normalizePasteTextForDialog(text).replace(/\n+$/, "").split("\n").length;
}

const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";

const TerminalPane = forwardRef<TerminalPaneHandle, TerminalPaneProps>(function TerminalPane({ session, isActive, uiScale, terminalAppearance, terminalScheme, scrollback, selectionStyle, recordingDirectory, focusVersion, isInteractionBlocked, reconnectToken = 0, onStatusChange, onActivity, onBell, onNotice, onSftpTransferActivityChange, onTranscriptRecordingActivityChange, onCloseSession, onProtectionChange, onReconnectingChange, pasteDialogBounds: storedPasteDialogBounds, onPasteDialogBoundsChange }, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const reconnectRef = useRef<(() => void) | null>(null);
  const protection = useSessionProtection({
    sessionId: session.id,
    protection: session.protection,
    protectOnConnect: session.protectOnConnect,
    status: session.status,
    terminalRef,
    reconnectRef,
    onProtectionChange,
    onReconnectingChange,
  });
  // the connection effect must not run again when these change
  const protectionApiRef = useRef(protection);
  protectionApiRef.current = protection;
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastDimensionsRef = useRef({ cols: 0, rows: 0 });
  const syncTerminalSizeRef = useRef<((force?: boolean) => void) | null>(null);
  const copySelectionRef = useRef<() => void>(() => undefined);
  const pasteFromClipboardRef = useRef<() => void>(() => undefined);
  const openFindRef = useRef<() => void>(() => undefined);
  const saveTranscriptRef = useRef<() => void>(() => undefined);
  const toggleRecordingRef = useRef<() => void>(() => undefined);
  const isTranscriptRecordingRef = useRef(false);
  const isTranscriptRecordingStartingRef = useRef(false);
  const disconnectRef = useRef<() => void>(() => undefined);
  const pasteDialogRef = useRef<HTMLDivElement | null>(null);
  const storedPasteDialogBoundsRef = useRef(storedPasteDialogBounds);
  const customSelectionRef = useRef<TerminalSelectionRange | null>(null);
  const isCustomSelectingRef = useRef(false);
  const suppressNextDoubleClickUntilRef = useRef(0);
  const customClickTrackerRef = useRef({ lastAt: 0, row: -1, count: 0 });
  const findPanelRef = useRef<HTMLFormElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const findMatchIndexRef = useRef(-1);
  const terminalAppearanceRef = useRef(terminalAppearance);
  const isInteractionBlockedRef = useRef(isInteractionBlocked);
  const [pendingPaste, setPendingPaste] = useState<string | null>(null);
  const [customSelectionRects, setCustomSelectionRects] = useState<TerminalSelectionRect[]>([]);
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findStatus, setFindStatus] = useState("");
  const [isFindCaseSensitive, setIsFindCaseSensitive] = useState(false);
  const [isTranscriptRecording, setIsTranscriptRecording] = useState(false);
  const [isTranscriptRecordingStarting, setIsTranscriptRecordingStarting] = useState(false);
  const [transcriptRecordingPath, setTranscriptRecordingPath] = useState("");
  const [isSftpOpen, setIsSftpOpen] = useState(false);
  const [activeTerminalView, setActiveTerminalView] = useState<"terminal" | "sftp">("terminal");
  const activeTerminalViewRef = useRef(activeTerminalView);
  activeTerminalViewRef.current = activeTerminalView;
  const [pendingSftpCloseConfirm, setPendingSftpCloseConfirm] = useState(false);
  const [sftpCloseConfirmFrame, setSftpCloseConfirmFrame] = useState<SftpCloseConfirmFrame>(() => createDefaultSftpCloseConfirmFrame());
  const [sftpActivity, setSftpActivity] = useState<SftpActivity>({ active: false });
  const [sftpReveal, setSftpReveal] = useState<{ path: string; seq: number } | null>(null);
  const onBellRef = useRef(onBell);
  onBellRef.current = onBell;
  const sftpForwardedActivityRef = useRef<SftpActivity>({ active: false });
  const pendingPasteRef = useRef<string | null>(pendingPaste);
  const antiIdleDefaults = useAntiIdleDefaults();
  const antiIdleDefaultsRef = useRef(antiIdleDefaults);
  antiIdleDefaultsRef.current = antiIdleDefaults;
  const [pasteDialogBounds, setPasteDialogBounds] = useState(storedPasteDialogBounds);

  terminalAppearanceRef.current = terminalAppearance;
  const terminalSchemeRef = useRef(terminalScheme);
  terminalSchemeRef.current = terminalScheme;
  isInteractionBlockedRef.current = isInteractionBlocked;
  isTranscriptRecordingRef.current = isTranscriptRecording;
  isTranscriptRecordingStartingRef.current = isTranscriptRecordingStarting;
  pendingPasteRef.current = pendingPaste;
  storedPasteDialogBoundsRef.current = storedPasteDialogBounds;

  useEffect(() => {
    setPasteDialogBounds(storedPasteDialogBounds);
  }, [storedPasteDialogBounds]);

  useImperativeHandle(ref, () => ({
    protect() {
      void protectionApiRef.current.protect();
    },
    unprotect() {
      void protectionApiRef.current.stopProtection();
    },
    copySelection() {
      copySelectionRef.current();
    },
    pasteFromClipboard() {
      pasteFromClipboardRef.current();
    },
    openFind() {
      openFindRef.current();
    },
    openSftp() {
      openSftpPanel();
    },
    saveTranscript() {
      saveTranscriptRef.current();
    },
    toggleRecording() {
      toggleRecordingRef.current();
    },
    disconnect() {
      disconnectRef.current();
    },
    focus() {
      terminalRef.current?.focus();
    },
  }), []);

  const openFindPanel = useCallback(() => {
    setIsFindOpen(true);
    window.setTimeout(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    }, 0);
  }, []);

  openFindRef.current = openFindPanel;

  const closeFindPanel = () => {
    setIsFindOpen(false);
    setFindStatus("");
    terminalRef.current?.focus();
  };

  const markTranscriptRecordingStopped = () => {
    if (!isTranscriptRecordingRef.current) {
      return;
    }

    isTranscriptRecordingRef.current = false;
    setIsTranscriptRecording(false);
    setTranscriptRecordingPath("");
    onTranscriptRecordingActivityChange(session.id, { active: false });
  };

  disconnectRef.current = () => {
    window.shellium?.terminal.disconnect(session.id).catch(() => undefined);
    window.shellium?.sftp.disconnect(session.id).catch(() => undefined);
    markTranscriptRecordingStopped();
    setIsSftpOpen(false);
    terminalRef.current?.writeln("\r\n[Disconnected]");
    onStatusChange(session.id, "disconnected");
    if (session.protection) {
      protection.showNotice("info", "Disconnected. The protected session keeps running on the server; Reconnect (tab menu) goes back into it.", 12000);
    }
  };

  const getLineText = (lineIndex: number) => terminalRef.current?.buffer.active.getLine(lineIndex)?.translateToString(true) ?? "";

  const getTerminalTranscript = () => {
    const terminal = terminalRef.current;

    if (!terminal) {
      return "";
    }

    const lines: string[] = [];

    for (let line = 0; line < terminal.buffer.active.length; line += 1) {
      lines.push(terminal.buffer.active.getLine(line)?.translateToString(true) ?? "");
    }

    while (lines.length > 0 && lines[lines.length - 1].trim().length === 0) {
      lines.pop();
    }

    return lines.join("\n");
  };

  const saveTerminalTranscript = () => {
    const transcript = getTerminalTranscript();

    if (!transcript.trim()) {
      onNotice(session.id, "No terminal output to save");
      return;
    }

    window.shellium?.terminal.saveTranscript({
      title: session.title?.trim() || session.host.name,
      transcript,
    })
      .then((result) => {
        if (!result?.canceled && result?.filePath) {
          onNotice(session.id, "Transcript saved: " + result.filePath);
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Terminal transcript could not be saved.";
        onNotice(session.id, "Transcript save failed: " + message);
      });
  };

  saveTranscriptRef.current = saveTerminalTranscript;

  const startTranscriptRecording = () => {
    if (isTranscriptRecordingStartingRef.current) {
      return;
    }
    isTranscriptRecordingStartingRef.current = true;
    setIsTranscriptRecordingStarting(true);
    onTranscriptRecordingActivityChange(session.id, { active: false, starting: true });

    window.shellium?.terminal.startRecording({
      sessionId: session.id,
      title: session.title?.trim() || session.host.name,
      directoryPath: recordingDirectory,
    })
      .then((result) => {
        if (result?.canceled) {
          onTranscriptRecordingActivityChange(session.id, { active: false, starting: false });
          return;
        }

        isTranscriptRecordingRef.current = true;
        setIsTranscriptRecording(true);
        setTranscriptRecordingPath(result?.filePath ?? "");
        onTranscriptRecordingActivityChange(session.id, { active: true, starting: false, filePath: result?.filePath, startedAt: Date.now() });
        onNotice(session.id, "Recording started" + (result?.filePath ? ": " + result.filePath : ""));
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Terminal recording could not be started.";
        onTranscriptRecordingActivityChange(session.id, { active: false, starting: false });
        onNotice(session.id, "Recording start failed: " + message);
      })
      .finally(() => {
        isTranscriptRecordingStartingRef.current = false;
        setIsTranscriptRecordingStarting(false);
      });
  };

  const stopTranscriptRecording = () => {
    window.shellium?.terminal.stopRecording(session.id)
      .then((result) => {
        isTranscriptRecordingRef.current = false;
        setIsTranscriptRecording(false);
        setTranscriptRecordingPath("");
        onTranscriptRecordingActivityChange(session.id, { active: false, starting: false });
        onNotice(session.id, "Recording stopped" + (result?.filePath ? ": " + result.filePath : ""));
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Terminal recording could not be stopped.";
        onNotice(session.id, "Recording stop failed: " + message);
      });
  };

  const toggleTranscriptRecording = () => {
    if (isTranscriptRecordingRef.current) {
      stopTranscriptRecording();
      return;
    }

    startTranscriptRecording();
  };

  toggleRecordingRef.current = toggleTranscriptRecording;
  void transcriptRecordingPath;
  const collectFindMatches = (query: string) => {
    const terminal = terminalRef.current;
    const matches: FindMatch[] = [];
    const needle = isFindCaseSensitive ? query : query.toLowerCase();

    if (!terminal || !needle) {
      return matches;
    }

    for (let line = 0; line < terminal.buffer.active.length; line += 1) {
      const rawLineText = getLineText(line);
      const haystack = isFindCaseSensitive ? rawLineText : rawLineText.toLowerCase();
      let column = haystack.indexOf(needle);

      while (column !== -1) {
        matches.push({ line, column, length: query.length });
        column = haystack.indexOf(needle, column + Math.max(needle.length, 1));
      }
    }

    return matches;
  };

  const revealFindMatch = (match: FindMatch) => {
    const terminal = terminalRef.current;

    if (!terminal) {
      return;
    }

    terminal.scrollToLine(match.line);
    window.setTimeout(() => {
      const row = Math.max(0, Math.min(terminal.rows - 1, match.line - terminal.buffer.active.viewportY));
      terminal.select(match.column, row, match.length);
      findInputRef.current?.focus({ preventScroll: true });
    }, 0);
  };

  const findInTerminal = (direction: 1 | -1 = 1) => {
    const query = findQuery.trim();

    if (!query) {
      setFindStatus("");
      findMatchIndexRef.current = -1;
      return;
    }

    const matches = collectFindMatches(query);

    if (matches.length === 0) {
      setFindStatus("No matches");
      findMatchIndexRef.current = -1;
      return;
    }

    const nextIndex = direction > 0
      ? (findMatchIndexRef.current + 1) % matches.length
      : (findMatchIndexRef.current <= 0 ? matches.length - 1 : findMatchIndexRef.current - 1);

    findMatchIndexRef.current = nextIndex;
    revealFindMatch(matches[nextIndex]);
    setFindStatus(`${nextIndex + 1} of ${matches.length}`);
  };
  const writeToTerminal = (text: string) => {
    if (!text) {
      return;
    }

    terminalRef.current?.scrollToBottom();
    window.shellium?.terminal.write(session.id, text);
  };

  const handleSftpActivityChange = useCallback((activity: SftpActivity) => {
    setSftpActivity((current) => current.active === activity.active && current.direction === activity.direction
      && current.fileName === activity.fileName && current.unsavedEdits === activity.unsavedEdits ? current : activity);
    // The app only tracks running transfers (quit / close-tab confirmation); skip updates that do not change them.
    const forwarded = sftpForwardedActivityRef.current;
    if (forwarded.active !== activity.active || forwarded.direction !== activity.direction || forwarded.fileName !== activity.fileName) {
      sftpForwardedActivityRef.current = activity;
      onSftpTransferActivityChange(session.id, { active: activity.active, direction: activity.direction, fileName: activity.fileName });
    }
  }, [onSftpTransferActivityChange, session.id]);

  const closeSftpPanel = useCallback(() => {
    // Disconnecting also cancels queued transfers and closes files open for editing (main process).
    window.shellium?.sftp.disconnect(session.id).catch(() => undefined);
    setIsSftpOpen(false);
    setActiveTerminalView("terminal");
    setSftpActivity({ active: false });
    sftpForwardedActivityRef.current = { active: false };
    onSftpTransferActivityChange(session.id, { active: false });
    terminalRef.current?.focus();
  }, [onSftpTransferActivityChange, session.id]);

  const openSftpPanel = () => {
    setIsSftpOpen(true);
    setActiveTerminalView("sftp");
  };

  // Ctrl+click on a link in the output (terminalLinks.ts): web addresses go to the browser, paths to SFTP.
  const openTerminalLinkRef = useRef<(link: TerminalLink) => void>(() => undefined);
  openTerminalLinkRef.current = (link) => {
    if (link.kind === "url") {
      window.shellium?.app.openExternal(link.text).catch((error: unknown) => {
        onNotice(session.id, `Could not open ${link.text}: ${error instanceof Error ? error.message : String(error)}`);
      });
      return;
    }

    setIsSftpOpen(true);
    setActiveTerminalView("sftp");
    setSftpReveal((current) => ({ path: link.text, seq: (current?.seq ?? 0) + 1 }));
  };

  const requestCloseSftpPanel = () => {
    if (sftpActivity.active || sftpActivity.unsavedEdits) {
      setSftpCloseConfirmFrame(createDefaultSftpCloseConfirmFrame());
      setPendingSftpCloseConfirm(true);
      return;
    }

    closeSftpPanel();
  };

  const cancelSftpCloseConfirm = () => {
    setPendingSftpCloseConfirm(false);
  };
  useEscapeLayer(cancelSftpCloseConfirm, pendingSftpCloseConfirm);

  const confirmSftpClose = () => {
    setPendingSftpCloseConfirm(false);
    closeSftpPanel();
  };

  const handleSftpCloseConfirmDragPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || event.target instanceof HTMLElement && event.target.closest("button, input, textarea, select")) {
      return;
    }

    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startFrame = sftpCloseConfirmFrame;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setSftpCloseConfirmFrame(clampSftpCloseConfirmFrame({
        ...startFrame,
        left: startFrame.left + moveEvent.clientX - startX,
        top: startFrame.top + moveEvent.clientY - startY,
      }));
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const getActiveSftpTransferCloseMessage = () => {
    if (!sftpActivity.active && sftpActivity.unsavedEdits) {
      return sftpActivity.unsavedEdits === 1
        ? "A file you edited has changes that are not uploaded. Closing this view deletes the local copy. Are you sure?"
        : `${sftpActivity.unsavedEdits} files you edited have changes that are not uploaded. Closing this view deletes the local copies. Are you sure?`;
    }

    if (sftpActivity.direction === "upload") {
      return "An upload is in progress or queued. Closing this view will interrupt it. Are you sure?";
    }

    if (sftpActivity.direction === "download") {
      return "A download is in progress or queued. Closing this view will interrupt it. Are you sure?";
    }

    return "A file transfer is currently in progress. Closing this view will interrupt the transfer. Are you sure?";
  };

  const handleConfirmPaste = () => {
    if (pendingPaste) {
      writeToTerminal(normalizePasteTextForTerminal(pendingPaste));
    }

    setPendingPaste(null);
    terminalRef.current?.focus();
  };

  const handleCancelPaste = () => {
    setPendingPaste(null);
    terminalRef.current?.focus();
  };
  useEscapeLayer(handleCancelPaste, pendingPaste !== null);

  const getPasteDialogViewportSize = useCallback(() => {
    const rect = pasteDialogRef.current?.parentElement?.getBoundingClientRect() ?? containerRef.current?.parentElement?.getBoundingClientRect();

    return {
      width: rect?.width ?? window.innerWidth,
      height: rect?.height ?? window.innerHeight,
    };
  }, []);

  const clampPasteDialogBounds = useCallback((bounds: PasteDialogBounds): PasteDialogBounds => {
    const viewport = getPasteDialogViewportSize();
    const maxWidth = Math.max(320, viewport.width - pasteDialogViewportMargin * 2);
    const maxHeight = Math.max(240, viewport.height - pasteDialogViewportMargin * 2);
    const width = Math.min(maxWidth, Math.max(420, bounds.width));
    const height = Math.min(maxHeight, Math.max(300, bounds.height));
    const maxLeft = Math.max(pasteDialogViewportMargin, viewport.width - width - pasteDialogViewportMargin);
    const maxTop = Math.max(pasteDialogViewportMargin, viewport.height - height - pasteDialogViewportMargin);

    return {
      left: Math.min(maxLeft, Math.max(pasteDialogViewportMargin, bounds.left)),
      top: Math.min(maxTop, Math.max(pasteDialogViewportMargin, bounds.top)),
      width,
      height,
    };
  }, [getPasteDialogViewportSize]);

  const centerPasteDialogBounds = useCallback((bounds: PasteDialogBounds): PasteDialogBounds => {
    const viewport = getPasteDialogViewportSize();
    const clamped = clampPasteDialogBounds({
      ...bounds,
      left: 0,
      top: 0,
    });

    return clampPasteDialogBounds({
      ...clamped,
      left: Math.round((viewport.width - clamped.width) / 2),
      top: Math.round((viewport.height - clamped.height) / 2),
    });
  }, [clampPasteDialogBounds, getPasteDialogViewportSize]);


  const handlePasteDialogHeaderPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.target instanceof HTMLElement && event.target.closest("button")) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    const startBounds = pasteDialogBounds;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setPasteDialogBounds(clampPasteDialogBounds({
        ...startBounds,
        left: startBounds.left + moveEvent.clientX - startX,
        top: startBounds.top + moveEvent.clientY - startY,
      }));
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      syncPasteDialogBounds();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  };

  const syncPasteDialogBounds = () => {
    const dialogRect = pasteDialogRef.current?.getBoundingClientRect();
    const viewportRect = pasteDialogRef.current?.parentElement?.getBoundingClientRect();

    if (!dialogRect || !viewportRect) {
      return;
    }

    const nextBounds = clampPasteDialogBounds({
      left: dialogRect.left - viewportRect.left,
      top: dialogRect.top - viewportRect.top,
      width: dialogRect.width,
      height: dialogRect.height,
    });
    setPasteDialogBounds(nextBounds);
    onPasteDialogBoundsChange(nextBounds);
  };
  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const container = containerRef.current;
    const initialAppearance = terminalAppearanceRef.current;
    const terminal = new Terminal({
      cursorBlink: true,
      // xterm's default hollow box lost its top and bottom edges on some screens ("| |")
      cursorInactiveStyle: "none",
      convertEol: true,
      // terminal.unicode (Unicode 11 widths) is a proposed API in xterm 6
      allowProposedApi: true,
      fontFamily: terminalFontStack(initialAppearance.fontFamily),
      fontSize: initialAppearance.fontSize,
      fontWeight: getTerminalFontWeight(initialAppearance.fontStyle),
      fontWeightBold: "bold",
      lineHeight: 1.15,
      scrollback,
      theme: xtermTheme(terminalSchemeRef.current),
    });
    const fitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Unicode 11 character widths: emoji and other wide characters take the two cells the server
    // expects, so columns and box drawing after them stay aligned.
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = "11";

    // Drawn on the GPU (WebGL): far less CPU for fast output (tail -f, long query results). Without
    // WebGL2, or when the context is lost (driver reset, too many tabs), xterm's DOM renderer takes over.
    let webglAddon: WebglAddon | null = null;
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        addon.dispose();
        webglAddon = null;
      });
      terminal.loadAddon(addon);
      webglAddon = addon;
    } catch {
      webglAddon = null;
    }
    // Glyphs are cached in a texture: redraw them once the bundled fonts have loaded.
    const handleFontsLoaded = () => webglAddon?.clearTextureAtlas();
    document.fonts?.addEventListener("loadingdone", handleFontsLoaded);

    const bellDisposable = terminal.onBell(() => onBellRef.current(session.id));

    const writeClipboardText = (text: string) => {
      window.shellium?.clipboard.writeText(text).catch(() => undefined);
      navigator.clipboard?.writeText(text).catch(() => undefined);
    };

    const readClipboardText = async () => {
      const electronText = await window.shellium?.clipboard.readText();

      if (electronText) {
        return electronText;
      }

      try {
        return await navigator.clipboard?.readText() ?? "";
      } catch {
        return "";
      }
    };

    const hasMeaningfulSelection = (selection: string) => selection.replace(/[\s\u00a0]/g, "").length > 0;

    const normalizeSelectionText = (selection: string) => {
      const lines = selection.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").map((line) => line.trimEnd());

      while (lines.length > 0 && !hasMeaningfulSelection(lines[lines.length - 1])) {
        lines.pop();
      }

      return lines.join("\n");
    };

    const getLineText = (lineIndex: number) => terminal.buffer.active.getLine(lineIndex)?.translateToString(true) ?? "";
    const getLineTextLength = (lineIndex: number) => getLineText(lineIndex).length;

    const getOrderedSelection = () => {
      const selection = customSelectionRef.current;

      if (!selection) {
        return null;
      }

      const { anchor, focus } = selection;
      const isForward = anchor.row < focus.row || (anchor.row === focus.row && anchor.column <= focus.column);
      return isForward ? { start: anchor, end: focus } : { start: focus, end: anchor };
    };

    const getCustomSelectionText = () => {
      const range = getOrderedSelection();

      if (!range) {
        return "";
      }

      const lines: string[] = [];

      for (let row = range.start.row; row <= range.end.row; row += 1) {
        const line = getLineText(row);
        const startColumn = row === range.start.row ? range.start.column : 0;
        const endColumn = row === range.end.row ? range.end.column : line.length;

        if (endColumn > startColumn) {
          lines.push(line.slice(startColumn, Math.min(endColumn, line.length)).trimEnd());
        }
      }

      return normalizeSelectionText(lines.join("\n"));
    };

    const copySelectionToClipboard = () => {
      const selection = getCustomSelectionText() || normalizeSelectionText(terminal.getSelection());

      if (selection && hasMeaningfulSelection(selection)) {
        writeClipboardText(selection);
      }
    };

    const scheduleSelectionCopy = () => {
      window.setTimeout(copySelectionToClipboard, 0);
      window.setTimeout(copySelectionToClipboard, 40);
      window.setTimeout(copySelectionToClipboard, 120);
    };

    const handleSelectionChange = () => {
      const selection = terminal.getSelection();

      if (selection && !hasMeaningfulSelection(selection)) {
        terminal.clearSelection();
      }
    };

    /**
     * Every paste ends here (right / middle click, Ctrl+Shift+V, Shift+Insert, Win+V, the toolbar).
     * Text without a line break is typed straight away. Anything with a line break - even one line
     * followed by a blank line - opens the review dialog exactly as copied: nothing is dropped and
     * nothing runs before the user confirms.
     */
    const handlePastedText = (text: string) => {
      const normalized = normalizePasteTextForDialog(text);
      if (!normalized) {
        return;
      }

      terminal.scrollToBottom();
      if (normalized.includes("\n")) {
        setPasteDialogBounds(centerPasteDialogBounds(storedPasteDialogBoundsRef.current));
        setPendingPaste(normalized);
        return;
      }

      window.shellium?.terminal.write(session.id, normalized);
    };

    const writeTerminalInput = (text: string) => {
      if (!text) {
        return;
      }

      // xterm's own paste (only if one slips past the paste listener below) arrives wrapped in
      // bracketed-paste markers when the remote shell enabled that mode.
      if (text.startsWith(BRACKETED_PASTE_START) && text.endsWith(BRACKETED_PASTE_END)) {
        handlePastedText(text.slice(BRACKETED_PASTE_START.length, -BRACKETED_PASTE_END.length));
        return;
      }

      if (text.length > 1 && countContentLines(text) > 1) {
        handlePastedText(text);
        return;
      }

      window.shellium?.terminal.write(session.id, text);
    };

    const pasteFromClipboard = () => {
      readClipboardText().then(handlePastedText).catch(() => undefined);
    };

    copySelectionRef.current = copySelectionToClipboard;
    pasteFromClipboardRef.current = pasteFromClipboard;

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") {
        return true;
      }

      const key = event.key.toLowerCase();
      const modifier = event.ctrlKey || event.metaKey;
      const isCopy = modifier && event.shiftKey && key === "c";
      const isPaste = (modifier && event.shiftKey && key === "v")
        || (event.shiftKey && !modifier && !event.altKey && event.key === "Insert");
      const isFind = modifier && key === "f";

      // Returning false only stops xterm; the browser would still run its own default for the key.
      // For Shift+Insert / Ctrl+Shift+V that is a native paste into xterm's textarea, whose "paste"
      // event (handled below for Win+V) typed a one-line clipboard a second time.
      if (isCopy) {
        event.preventDefault();
        copySelectionToClipboard();
        return false;
      }

      if (isPaste) {
        event.preventDefault();
        pasteFromClipboard();
        return false;
      }

      if (isFind) {
        event.preventDefault();
        openFindPanel();
        return false;
      }

      if (event.key === "PageUp") {
        terminal.scrollPages(-1);
        return false;
      }

      if (event.key === "PageDown") {
        terminal.scrollPages(1);
        return false;
      }

      return true;
    });

    const dataDisposable = terminal.onData((data) => {
      writeTerminalInput(data);
    });

    const disposeData = window.shellium?.terminal.onData((payload) => {
      if (payload.sessionId === session.id) {
        terminal.write(payload.data);
        onActivity(session.id);
      }
    });

    const disposeExit = window.shellium?.terminal.onExit((payload) => {
      if (payload.sessionId === session.id) {
        markTranscriptRecordingStopped();
        terminal.writeln(`\r\n[${payload.reason}]`);
        onStatusChange(session.id, "disconnected");
        protectionApiRef.current.handleExit(payload);
      }
    });

    const getTerminalCellFromPointer = (event: MouseEvent | PointerEvent) => {
      const screen = container.querySelector<HTMLElement>(".xterm-screen");

      if (!screen || terminal.cols === 0 || terminal.rows === 0) {
        return null;
      }

      const screenRect = screen.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      if (event.clientX < containerRect.left || event.clientX > containerRect.right || event.clientY < containerRect.top || event.clientY > containerRect.bottom) {
        return null;
      }

      const cellWidth = screenRect.width / terminal.cols;
      const cellHeight = screenRect.height / terminal.rows;

      if (!Number.isFinite(cellWidth) || !Number.isFinite(cellHeight) || cellWidth <= 0 || cellHeight <= 0) {
        return null;
      }

      const rawColumn = Math.floor((event.clientX - screenRect.left) / cellWidth);
      const rawRow = Math.floor((event.clientY - screenRect.top) / cellHeight);

      return {
        column: Math.max(0, Math.min(terminal.cols - 1, rawColumn)),
        row: Math.max(0, Math.min(terminal.rows - 1, rawRow)),
      };
    };

    const getSelectablePointFromPointer = (event: MouseEvent | PointerEvent, anchor?: TerminalSelectionPoint) => {
      const cell = getTerminalCellFromPointer(event);

      if (!cell) {
        return null;
      }

      const row = terminal.buffer.active.viewportY + cell.row;
      const lineLength = getLineTextLength(row);

      if (lineLength === 0) {
        return { row, column: 0 };
      }

      if (!anchor) {
        return { row, column: Math.min(cell.column, lineLength) };
      }

      const isBackward = row < anchor.row || (row === anchor.row && cell.column < anchor.column);
      const column = isBackward ? Math.min(cell.column, lineLength - 1) : Math.min(cell.column + 1, lineLength);
      return { row, column };
    };

    // Links (terminalLinks.ts) are found in the logical line: rows the terminal wrapped are joined, so a
    // long path or address that runs over two rows is still one link. cells[i] is the cell of text[i].
    const getLogicalLine = (row: number) => {
      const buffer = terminal.buffer.active;
      let first = row;
      while (first > 0 && buffer.getLine(first)?.isWrapped && row - first < 64) {
        first -= 1;
      }

      let text = "";
      const cells: Array<{ row: number; x: number }> = [];
      for (let lineRow = first; lineRow < buffer.length && lineRow - first < 128; lineRow += 1) {
        const line = buffer.getLine(lineRow);
        if (!line || (lineRow > first && !line.isWrapped)) {
          break;
        }
        for (let x = 0; x < line.length; x += 1) {
          const cell = line.getCell(x);
          if (!cell || cell.getWidth() === 0) {
            continue;
          }
          const chars = cell.getChars() || " ";
          for (let index = 0; index < chars.length; index += 1) {
            cells.push({ row: lineRow, x });
          }
          text += chars;
        }
      }

      return { text, cells };
    };

    const getLinksOnRow = (row: number) => {
      const { text, cells } = getLogicalLine(row);
      return findTerminalLinks(text).flatMap((link) => {
        const start = cells[link.start];
        const end = cells[link.end - 1];
        return start && end && start.row <= row && end.row >= row ? [{ link, start, end }] : [];
      });
    };

    const getLinkAtCell = (row: number, x: number) => getLinksOnRow(row).find(({ start, end }) =>
      (row > start.row || x >= start.x) && (row < end.row || x <= end.x))?.link ?? null;

    // Links open with Ctrl+click (Cmd+click on a Mac) only: a plain click still selects text. While the
    // key is held over a link it is underlined and the pointer becomes a hand.
    const isMac = window.shellium?.app.platform === "darwin";
    const isLinkModifier = (event: { ctrlKey: boolean; metaKey: boolean }) => (isMac ? event.metaKey : event.ctrlKey);
    const linkModifierName = isMac ? "Cmd" : "Ctrl";
    let hoveredLink: { ilink: ILink; link: TerminalLink } | null = null;
    let isLinkModifierHeld = false;
    const syncLinkHover = () => {
      const armed = Boolean(hoveredLink) && isLinkModifierHeld;
      container.classList.toggle("terminal-link-armed", armed);
      if (hoveredLink?.ilink.decorations) {
        hoveredLink.ilink.decorations.underline = armed;
        hoveredLink.ilink.decorations.pointerCursor = armed;
      }
      container.title = hoveredLink
        ? `${linkModifierName}+click: ${hoveredLink.link.kind === "url" ? "open in the browser" : "show in SFTP"}`
        : "";
    };
    const handleLinkModifierKey = (event: KeyboardEvent) => {
      if (isLinkModifier(event) !== isLinkModifierHeld) {
        isLinkModifierHeld = isLinkModifier(event);
        syncLinkHover();
      }
    };
    const handleLinkWindowBlur = () => {
      isLinkModifierHeld = false;
      syncLinkHover();
    };

    const linkProviderDisposable = terminal.registerLinkProvider({
      provideLinks(bufferLineNumber, callback) {
        const row = bufferLineNumber - 1;
        const links = getLinksOnRow(row).map(({ link, start, end }): ILink => {
          const ilink: ILink = {
            text: link.text,
            range: { start: { x: start.x + 1, y: start.row + 1 }, end: { x: end.x + 1, y: end.row + 1 } },
            decorations: { underline: isLinkModifierHeld, pointerCursor: isLinkModifierHeld },
            // Opened from handlePointerDown: the custom selection takes every left click first.
            activate: () => undefined,
            hover: (event) => {
              hoveredLink = { ilink, link };
              isLinkModifierHeld = isLinkModifier(event);
              // xterm swaps in its own (tracked) decorations right after this callback returns.
              queueMicrotask(syncLinkHover);
            },
            leave: () => {
              if (hoveredLink?.ilink === ilink) {
                hoveredLink = null;
                syncLinkHover();
              }
            },
          };
          return ilink;
        });
        callback(links.length > 0 ? links : undefined);
      },
    });
    window.addEventListener("keydown", handleLinkModifierKey, true);
    window.addEventListener("keyup", handleLinkModifierKey, true);
    window.addEventListener("blur", handleLinkWindowBlur);

    const buildSelectionRects = () => {
      const range = getOrderedSelection();
      const screen = container.querySelector<HTMLElement>(".xterm-screen");

      if (!range || !screen || terminal.cols === 0 || terminal.rows === 0) {
        return [];
      }

      const screenRect = screen.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const cellWidth = screenRect.width / terminal.cols;
      const cellHeight = screenRect.height / terminal.rows;

      if (!Number.isFinite(cellWidth) || !Number.isFinite(cellHeight) || cellWidth <= 0 || cellHeight <= 0) {
        return [];
      }

      const rects: TerminalSelectionRect[] = [];
      const topOffset = screenRect.top - containerRect.top;
      const leftOffset = screenRect.left - containerRect.left;

      for (let row = range.start.row; row <= range.end.row; row += 1) {
        const lineLength = getLineTextLength(row);
        const startColumn = row === range.start.row ? range.start.column : 0;
        const endColumn = row === range.end.row ? range.end.column : lineLength;
        const clippedEndColumn = Math.min(endColumn, lineLength);
        const screenRow = row - terminal.buffer.active.viewportY;

        if (screenRow < 0 || screenRow >= terminal.rows || clippedEndColumn <= startColumn) {
          continue;
        }

        rects.push({
          top: topOffset + screenRow * cellHeight,
          left: leftOffset + startColumn * cellWidth,
          width: (clippedEndColumn - startColumn) * cellWidth,
          height: cellHeight,
        });
      }

      return rects;
    };

    const syncCustomSelectionRects = () => {
      setCustomSelectionRects(buildSelectionRects());
    };

    const selectionDisposable = terminal.onSelectionChange(handleSelectionChange);
    const scrollDisposable = terminal.onScroll(syncCustomSelectionRects);

    const clearCustomSelection = () => {
      customSelectionRef.current = null;
      isCustomSelectingRef.current = false;
      setCustomSelectionRects([]);
    };

    const isFindPanelEventTarget = (target: EventTarget | null) => target instanceof Node && Boolean(findPanelRef.current?.contains(target));
    const isPasteDialogEventTarget = (target: EventTarget | null) => target instanceof Node && Boolean(pasteDialogRef.current?.contains(target));
    const isTerminalEventTarget = (target: EventTarget | null) => target instanceof Node && container.contains(target) && !isPasteDialogEventTarget(target) && !isFindPanelEventTarget(target);

    // xterm's own scrollbar (slider drag, click on the track) must get its pointer events: the
    // custom selection below captures every left click in the terminal on the document.
    const isScrollbarEventTarget = (target: EventTarget | null) =>
      target instanceof Element && Boolean(target.closest(".xterm-scrollable-element > .scrollbar"));

    const isTerminalPointerEvent = (event: MouseEvent | PointerEvent) => {
      if (isPasteDialogEventTarget(event.target) || isFindPanelEventTarget(event.target) || isScrollbarEventTarget(event.target)) {
        return false;
      }

      if (isInteractionBlockedRef.current || pendingPasteRef.current !== null) {
        return false;
      }

      if (isTerminalEventTarget(event.target)) {
        return true;
      }

      const rect = container.getBoundingClientRect();
      return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    };

    const getWordSelectionRange = (point: TerminalSelectionPoint) => {
      const lineText = getLineText(point.row);

      if (!lineText || point.column >= lineText.length || /\s/.test(lineText[point.column])) {
        return null;
      }

      let start = point.column;
      let end = point.column + 1;

      while (start > 0 && !/\s/.test(lineText[start - 1])) {
        start -= 1;
      }

      while (end < lineText.length && !/\s/.test(lineText[end])) {
        end += 1;
      }

      return { start, end };
    };

    const selectCustomRange = (row: number, startColumn: number, endColumn: number) => {
      if (endColumn <= startColumn) {
        clearCustomSelection();
        return;
      }

      terminal.clearSelection();
      customSelectionRef.current = {
        anchor: { row, column: startColumn },
        focus: { row, column: endColumn },
      };
      syncCustomSelectionRects();
      scheduleSelectionCopy();
    };

    const handleDoubleClick = (event: MouseEvent) => {
      if (Date.now() < suppressNextDoubleClickUntilRef.current) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }

      if (!isTerminalPointerEvent(event)) {
        return;
      }

      const point = getSelectablePointFromPointer(event);

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (!point) {
        clearCustomSelection();
        return;
      }

      if (event.detail >= 4) {
        selectCustomRange(point.row, 0, getLineTextLength(point.row));
        return;
      }

      const wordRange = getWordSelectionRange(point);

      if (!wordRange) {
        clearCustomSelection();
        return;
      }

      selectCustomRange(point.row, wordRange.start, wordRange.end);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !isTerminalPointerEvent(event)) {
        return;
      }

      if (isLinkModifier(event)) {
        const cell = getTerminalCellFromPointer(event);
        const link = cell ? getLinkAtCell(terminal.buffer.active.viewportY + cell.row, cell.column) : null;
        if (link) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          openTerminalLinkRef.current(link);
          return;
        }
      }

      const point = getSelectablePointFromPointer(event);
      const now = Date.now();

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      terminal.focus();
      terminal.clearSelection();

      if (!point) {
        customClickTrackerRef.current = { lastAt: 0, row: -1, count: 0 };
        clearCustomSelection();
        return;
      }

      const previousClick = customClickTrackerRef.current;
      const clickCount = previousClick.row === point.row && now - previousClick.lastAt <= 450 ? previousClick.count + 1 : 1;
      customClickTrackerRef.current = { lastAt: now, row: point.row, count: clickCount };

      if (clickCount >= 3) {
        isCustomSelectingRef.current = false;
        suppressNextDoubleClickUntilRef.current = now + 500;
        customClickTrackerRef.current = { lastAt: 0, row: -1, count: 0 };
        selectCustomRange(point.row, 0, getLineTextLength(point.row));
        return;
      }

      isCustomSelectingRef.current = true;
      customSelectionRef.current = { anchor: point, focus: point };
      syncCustomSelectionRects();
    };

    const handlePointerMove = (event: PointerEvent) => {
      const currentSelection = customSelectionRef.current;

      if (event.buttons !== 1 || !isCustomSelectingRef.current || !currentSelection) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const focus = getSelectablePointFromPointer(event, currentSelection.anchor);

      if (!focus) {
        return;
      }

      customSelectionRef.current = { ...currentSelection, focus };
      syncCustomSelectionRects();
    };

    const handleMouseUp = () => {
      if (isCustomSelectingRef.current) {
        isCustomSelectingRef.current = false;
        scheduleSelectionCopy();
      }
    };

    const handleContextMenu = (event: MouseEvent) => {
      if (!isTerminalPointerEvent(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (isInteractionBlockedRef.current || pendingPasteRef.current !== null) {
        return;
      }

      pasteFromClipboard();
      terminal.focus();
    };

    const handleAuxClick = (event: MouseEvent) => {
      if (event.button !== 1 || !isTerminalPointerEvent(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (isInteractionBlockedRef.current || pendingPasteRef.current !== null) {
        return;
      }

      pasteFromClipboard();
      terminal.focus();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    container.addEventListener("pointerdown", handlePointerDown, true);
    container.addEventListener("dblclick", handleDoubleClick, true);
    document.addEventListener("pointermove", handlePointerMove, true);
    document.addEventListener("mouseup", handleMouseUp, true);
    document.addEventListener("pointerup", handleMouseUp, true);
    // Pastes the browser delivers itself (Win+V clipboard history, IME / accessibility tools) take
    // the same path instead of xterm's, which would send several lines straight away.
    const handlePasteEvent = (event: ClipboardEvent) => {
      if (!isTerminalEventTarget(event.target)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (isInteractionBlockedRef.current || pendingPasteRef.current !== null) {
        return;
      }

      handlePastedText(event.clipboardData?.getData("text/plain") ?? "");
    };

    document.addEventListener("contextmenu", handleContextMenu, true);
    document.addEventListener("auxclick", handleAuxClick, true);
    container.addEventListener("paste", handlePasteEvent, true);
    lastDimensionsRef.current = { cols: terminal.cols, rows: terminal.rows };

    const connect = async () => {
      onStatusChange(session.id, "connecting");
      fitAddon.fit();
      lastDimensionsRef.current = { cols: terminal.cols, rows: terminal.rows };
      await window.shellium?.terminal.connect({
        sessionId: session.id,
        host: session.host,
        cols: terminal.cols || 80,
        rows: terminal.rows || 24,
        // The host's own anti-idle settings, else the Options default (read at connect time).
        keepalive: resolveConnectionKeepalive(session.host.antiIdle, antiIdleDefaultsRef.current.antiIdle, antiIdleDefaultsRef.current.keepaliveCountMax),
        // a protected tab goes back into its tmux session; a new tab with "Protect new sessions" starts one
        protection: protectionApiRef.current.connectProtection(),
      });
      onStatusChange(session.id, "connected");
    };
    // a protected tab that lost its connection reconnects here, keeping this terminal and its scrollback
    reconnectRef.current = () => {
      connect().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "SSH connection failed";
        terminal.writeln(`\r\n${message}`);
        onStatusChange(session.id, "disconnected");
      });
    };

    const connectFrame = window.requestAnimationFrame(() => {
      connect().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "SSH connection failed";
        terminal.writeln(`\r\n${message}`);
        onStatusChange(session.id, "disconnected");
      });
    });
    let resizeFrame: number | null = null;

    const syncTerminalSize = (force = false) => {
      resizeFrame = null;

      if (container.clientWidth === 0 || container.clientHeight === 0) {
        return;
      }

      const dimensions = fitAddon.proposeDimensions();

      if (!dimensions) {
        return;
      }

      if (!force && dimensions.cols === lastDimensionsRef.current.cols && dimensions.rows === lastDimensionsRef.current.rows) {
        return;
      }

      fitAddon.fit();
      lastDimensionsRef.current = { cols: terminal.cols, rows: terminal.rows };
      window.shellium?.terminal.resize(session.id, terminal.cols, terminal.rows);
      setCustomSelectionRects(buildSelectionRects());
    };
    syncTerminalSizeRef.current = syncTerminalSize;

    const scheduleResize = () => {
      if (resizeFrame !== null) {
        return;
      }

      resizeFrame = window.requestAnimationFrame(() => syncTerminalSize());
    };

    const resizeObserver = new ResizeObserver(scheduleResize);
    resizeObserver.observe(container);
    window.addEventListener("resize", scheduleResize);

    // Size and cursor for the status bar, at most once a frame.
    let viewFrame: number | null = null;
    const publishView = () => {
      if (viewFrame !== null) {
        return;
      }
      viewFrame = window.requestAnimationFrame(() => {
        viewFrame = null;
        const buffer = terminal.buffer.active;
        setTerminalView(session.id, { cols: terminal.cols, rows: terminal.rows, cursorRow: buffer.cursorY + 1, cursorCol: buffer.cursorX + 1 });
      });
    };
    const cursorDisposable = terminal.onCursorMove(publishView);
    const viewResizeDisposable = terminal.onResize(publishView);
    publishView();

    return () => {
      window.shellium?.sftp.disconnect(session.id).catch(() => undefined);
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
      }
      window.cancelAnimationFrame(connectFrame);
      dataDisposable.dispose();
      cursorDisposable.dispose();
      viewResizeDisposable.dispose();
      if (viewFrame !== null) {
        window.cancelAnimationFrame(viewFrame);
      }
      setTerminalView(session.id, null);
      selectionDisposable.dispose();
      scrollDisposable.dispose();
      disposeData?.();
      disposeExit?.();
      syncTerminalSizeRef.current = null;
      window.removeEventListener("resize", scheduleResize);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      container.removeEventListener("pointerdown", handlePointerDown, true);
      container.removeEventListener("dblclick", handleDoubleClick, true);
      document.removeEventListener("pointermove", handlePointerMove, true);
      document.removeEventListener("mouseup", handleMouseUp, true);
      document.removeEventListener("pointerup", handleMouseUp, true);
      document.removeEventListener("contextmenu", handleContextMenu, true);
      document.removeEventListener("auxclick", handleAuxClick, true);
      container.removeEventListener("paste", handlePasteEvent, true);
      window.removeEventListener("keydown", handleLinkModifierKey, true);
      window.removeEventListener("keyup", handleLinkModifierKey, true);
      window.removeEventListener("blur", handleLinkWindowBlur);
      document.fonts?.removeEventListener("loadingdone", handleFontsLoaded);
      linkProviderDisposable.dispose();
      bellDisposable.dispose();
      markTranscriptRecordingStopped();
      window.shellium?.terminal.disconnect(session.id);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [onActivity, onStatusChange, onTranscriptRecordingActivityChange, reconnectToken, session.id, session.host]);



  useEffect(() => {
    const terminal = terminalRef.current;

    if (!terminal) {
      return;
    }

    terminal.options.scrollback = scrollback;
  }, [scrollback]);
  useEffect(() => {
    const terminal = terminalRef.current;

    if (!terminal) {
      return;
    }

    terminal.options.fontFamily = terminalFontStack(terminalAppearance.fontFamily);
    terminal.options.fontSize = terminalAppearance.fontSize;
    terminal.options.fontWeight = getTerminalFontWeight(terminalAppearance.fontStyle);
    terminal.options.fontWeightBold = "bold";
    syncTerminalSizeRef.current?.(true);
  }, [
    terminalAppearance,
    terminalAppearance.fontFamily,
    terminalAppearance.fontSize,
    terminalAppearance.fontStyle,
  ]);
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = xtermTheme(terminalScheme);
    }
  }, [terminalScheme]);
  useEffect(() => {
    if (!isActive) {
      return;
    }

    const terminal = terminalRef.current;
    let secondFrame: number | null = null;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        syncTerminalSizeRef.current?.(true);
      });
    });

    // Not while the SFTP view is shown: keys typed there would land in the hidden terminal.
    if (activeTerminalViewRef.current !== "sftp") {
      terminal?.focus();
    }

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) {
        window.cancelAnimationFrame(secondFrame);
      }
    };
  }, [focusVersion, isActive, session.id, uiScale]);

  return (
    <div
      className={"terminal-pane" + (isSftpOpen ? " terminal-pane-sftp-tabs" : "") + (isSftpOpen && activeTerminalView === "sftp" ? " ft-mode" : "")}
      aria-label={`${session.host.name} terminal`}
      style={{ "--sh-terminal-bg": terminalScheme.background, "--sh-term-selection": terminalScheme.selection } as CSSProperties}
    >
      {isSftpOpen && (
        <nav className="ft-tabs" aria-label="Terminal views">
          <div className={"ft-tab" + (activeTerminalView === "terminal" ? " active" : "")}>
            <button type="button" className="ft-tab-main" onClick={() => setActiveTerminalView("terminal")}>
              <SquareTerminal aria-hidden="true" size={14} />
              Terminal
            </button>
            <button type="button" className="ft-tab-close" aria-label="Close terminal" title="Close terminal (ends the session)" onClick={() => onCloseSession(session.id)}>
              <X aria-hidden="true" size={12} />
            </button>
          </div>
          <div className={"ft-tab" + (activeTerminalView === "sftp" ? " active" : "")}>
            <button type="button" className="ft-tab-main" onClick={() => setActiveTerminalView("sftp")}>
              <FolderOpen aria-hidden="true" size={14} />
              SFTP
            </button>
            <button type="button" className="ft-tab-close" aria-label="Close SFTP" title="Close SFTP" onClick={requestCloseSftpPanel}>
              <X aria-hidden="true" size={12} />
            </button>
          </div>
        </nav>
      )}
      <div className={"terminal-viewport-shell" + (isSftpOpen && activeTerminalView !== "terminal" ? " terminal-viewport-shell-hidden" : "")}>
        {activeTerminalView === "terminal" && (
          <div className="terminal-inline-actions" aria-label="Terminal actions">
            <button type="button" onClick={() => copySelectionRef.current()} disabled={isInteractionBlocked}>Copy</button>
            <button type="button" onClick={() => pasteFromClipboardRef.current()} disabled={isInteractionBlocked}>Paste</button>
            <button type="button" onClick={() => openFindRef.current()} disabled={isInteractionBlocked}>Find</button>
          </div>
        )}
        <div className="terminal-viewport" ref={containerRef} />
        {protection.bar && activeTerminalView === "terminal" && (
          <ProtectionBar
            state={protection.bar}
            onStart={(tool, adopt, force) => void protection.startProtection(tool, adopt, force)}
            onStop={(force) => void protection.stopProtection(force)}
            onRetryNow={protection.retryNow}
            onReconnect={protection.reconnectNow}
            onStopRetrying={protection.stopRetrying}
            onDismiss={protection.dismiss}
          />
        )}
        {customSelectionRects.length > 0 && (
          <div className={`terminal-custom-selection terminal-selection-${selectionStyle}`} aria-hidden="true">
            {customSelectionRects.map((rect, index) => (
              <span
                key={`${rect.top}-${rect.left}-${rect.width}-${index}`}
                style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
              />
            ))}
          </div>
        )}
      </div>
      {isSftpOpen && (
        <SftpBrowser session={session} hidden={activeTerminalView !== "sftp"} onActivityChange={handleSftpActivityChange} reveal={sftpReveal} />
      )}
      {pendingSftpCloseConfirm && (
        <section className="md-overlay md-overlay-sftp" aria-label="SFTP close confirmation">
          <form
            className="md-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="sftp-close-title"
            style={{ left: sftpCloseConfirmFrame.left, top: sftpCloseConfirmFrame.top, width: sftpCloseConfirmFrame.width }}
            onSubmit={(event) => {
              event.preventDefault();
              confirmSftpClose();
            }}
          >
            <header className="md-header" onPointerDown={handleSftpCloseConfirmDragPointerDown}>
              <span className="md-icon md-icon-danger" aria-hidden="true">
                <X size={18} />
              </span>
              <div className="md-title">
                <h2 id="sftp-close-title">Close SFTP</h2>
              </div>
              <button type="button" className="md-close" aria-label="Close" onClick={cancelSftpCloseConfirm}>
                <X size={16} />
              </button>
            </header>
            <div className="md-body">
              <p className="md-text">{getActiveSftpTransferCloseMessage()}</p>
            </div>
            <div className="md-actions">
              <button type="button" className="sh-btn sh-btn-ghost" onClick={cancelSftpCloseConfirm}>
                Cancel
              </button>
              <button type="submit" className="sh-btn sh-btn-danger" autoFocus>Close</button>
            </div>
          </form>
        </section>
      )}
      {isFindOpen && (
        <form
          ref={findPanelRef}
          className="tf-bar"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            findInTerminal(1);
          }}
        >
          <Search className="tf-icon" aria-hidden="true" size={14} />
          <input
            ref={findInputRef}
            value={findQuery}
            placeholder="Find in terminal"
            aria-label="Find in terminal"
            spellCheck={false}
            onChange={(event) => {
              setFindQuery(event.target.value);
              setFindStatus("");
              findMatchIndexRef.current = -1;
            }}
            onKeyDown={(event) => {
              event.stopPropagation();

              if (event.key === "Escape") {
                event.preventDefault();
                closeFindPanel();
                return;
              }

              if (event.key === "Enter") {
                event.preventDefault();
                findInTerminal(event.shiftKey ? -1 : 1);
              }
            }}
          />
          {findStatus && <span className="tf-status">{findStatus}</span>}
          <button
            type="button"
            className={"tf-btn tf-case" + (isFindCaseSensitive ? " active" : "")}
            aria-pressed={isFindCaseSensitive}
            title="Match case"
            aria-label="Match case"
            onClick={() => {
              setIsFindCaseSensitive((current) => !current);
              setFindStatus("");
              findMatchIndexRef.current = -1;
            }}
          >
            Aa
          </button>
          <span className="tf-sep" aria-hidden="true" />
          <button type="button" className="tf-btn" onClick={() => findInTerminal(-1)} disabled={!findQuery.trim()} title="Previous match (Shift+Enter)" aria-label="Previous match">
            <ChevronUp aria-hidden="true" size={15} />
          </button>
          <button type="submit" className="tf-btn" disabled={!findQuery.trim()} title="Next match (Enter)" aria-label="Next match">
            <ChevronDown aria-hidden="true" size={15} />
          </button>
          <button type="button" className="tf-btn" aria-label="Close find" title="Close (Esc)" onClick={closeFindPanel}>
            <X aria-hidden="true" size={15} />
          </button>
        </form>
      )}
      {pendingPaste !== null && (
        <section className="md-overlay md-overlay-local" aria-label="Confirm multi-line paste">
          <div
            className="md-dialog md-dialog-resizable"
            ref={pasteDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="paste-confirm-title"
            style={{
              left: pasteDialogBounds.left,
              top: pasteDialogBounds.top,
              width: pasteDialogBounds.width,
              height: pasteDialogBounds.height,
            } as CSSProperties}
            onPointerUp={syncPasteDialogBounds}
          >
            <header className="md-header" onPointerDown={handlePasteDialogHeaderPointerDown}>
              <span className="md-icon md-icon-warn" aria-hidden="true">
                <ClipboardPaste size={18} />
              </span>
              <div className="md-title">
                <h2 id="paste-confirm-title">Paste {countPasteLines(pendingPaste)} line{countPasteLines(pendingPaste) === 1 ? "" : "s"}?</h2>
                <p>Each line is sent to the session as if typed. Review or edit before pasting.</p>
              </div>
              <button type="button" className="md-close" aria-label="Close" onClick={handleCancelPaste}>
                <X size={16} />
              </button>
            </header>
            <div className="md-body md-body-fill">
              <textarea
                className="md-input md-mono md-textarea-fill"
                aria-label="Clipboard contents"
                value={pendingPaste}
                spellCheck={false}
                onChange={(event) => setPendingPaste(normalizePasteTextForDialog(event.target.value))}
                autoFocus
              />
            </div>
            <div className="md-actions">
              <span className="md-actions-start md-actions-note">
                {pendingPaste.endsWith("\n")
                  ? "Ends with a line break - the last line is sent with Enter."
                  : "No line break at the end - the last line waits at the prompt."}
              </span>
              <button type="button" className="sh-btn sh-btn-ghost" onClick={handleCancelPaste}>Cancel</button>
              <button type="button" className="sh-btn sh-btn-primary" onClick={handleConfirmPaste}>Paste</button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
});

export default TerminalPane;
