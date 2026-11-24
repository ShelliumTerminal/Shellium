import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { formatDuration } from "./app/formatDuration";

import ConnectionPalette from "./components/palette/ConnectionPalette";
import { EnvironmentsContext, environmentStyle } from "./components/common/environments";
import { AntiIdleDefaultsContext } from "./components/common/AntiIdleFields";
import { TerminalSchemesContext } from "./components/common/TerminalSchemes";
import { resolveTerminalScheme } from "./components/common/terminalSchemeModel";
import ConnectionPromptDialog from "./components/security/ConnectionPromptDialog";
import LockScreen from "./components/security/LockScreen";
import ConfirmHost from "./components/dialogs/ConfirmDialog";
import AboutDialog from "./components/dialogs/AboutDialog";
import HomeView from "./components/workspace/HomeView";
import QuickConnectMenu from "./components/workspace/QuickConnectMenu";
import AppTitleBar from "./components/workspace/AppTitleBar";
import type { AppMenuId } from "./components/workspace/AppTitleBar";
import SessionTabs from "./components/workspace/SessionTabs";
import StatusBar from "./components/workspace/StatusBar";
import TabContextMenu from "./components/workspace/TabContextMenu";
import type { TabContextMenuState } from "./components/workspace/TabContextMenu";
import { loadRecentConnections, recordRecentConnection } from "./components/workspace/hostDirectory";
import type { RecentConnection } from "./components/workspace/hostDirectory";
import { loadConnectionFolders, saveConnectionFolders } from "./components/palette/connectionStorage";
import { findHostById, updateHost as updateConnectionHost } from "./components/palette/treeUtils";
import type { Folder, Host, Session, SessionProtection } from "./components/palette/types";
import TerminalPane from "./components/terminal/TerminalPane";
import type { SftpTransferActivity, TerminalAppearance, TerminalPaneHandle, TerminalTranscriptRecordingActivity } from "./components/terminal/TerminalPane";
import OptionsView from "./components/options/OptionsView";
import ScriptBar from "./components/scripts/ScriptBar";
import ScriptButtonManager from "./components/scripts/ScriptButtonManager";
import ScriptButtonContextMenu from "./components/scripts/ScriptButtonContextMenu";
import EditContextMenu from "./components/common/EditContextMenu";
import type { ScriptButtonContextMenuState } from "./components/scripts/ScriptButtonContextMenu";
import CloseConfirmDialog from "./components/dialogs/CloseConfirmDialog";
import RenameTabDialog from "./components/dialogs/RenameTabDialog";
import CredentialDialog from "./components/dialogs/CredentialDialog";
import type { CredentialPromptState } from "./components/dialogs/CredentialDialog";
import TerminalFontDialog from "./components/dialogs/TerminalFontDialog";
import { TransferWizard } from "./components/transfer/TransferWizard";
import type { ConnectionPrompt, ConnectionPromptDecision } from "./shellium-env";
import { areDialogFramesEqual, defaultOptions, loadLegacyOptions, normalizeAppOptions } from "./app/appOptions";
import type { AppOptions } from "./app/appOptions";
import type { DialogFrame } from "./app/dialogFrame";
import { prepareScriptForTerminal } from "./app/scriptButtonModel";
import type { ScriptButton } from "./app/scriptButtonModel";
import { collectVaultHosts, getSessionTitle } from "./app/sessionModel";
import type { PendingCloseState, VaultHostSearchResult } from "./app/sessionModel";
import { MAX_PANES, detachPane, findTabOf, layoutTree, mergeTab, movePane, moveTab, paneStyle, reconcileTabs, replacePane, setSplitRatio, setTabFocus, splitPane, swapPanes, tabSessionIds } from "./app/splitLayout";
import type { PaneEdge, SessionTab } from "./app/splitLayout";
import SplitStage, { PaneHeader } from "./components/workspace/SplitStage";
import { isQuickConnectHost } from "./app/quickConnect";
import type { PaneDropEdge, TabDragState } from "./components/workspace/SplitStage";
import { useScriptButtonLibrary } from "./app/useScriptButtonLibrary";
import { useSecurity } from "./app/useSecurity";
import { useSftpAutoResume } from "./app/useSftpAutoResume";
import { askConfirm } from "./app/confirmDialog";
import { openSupportMail } from "./app/supportMail";
import { setEscapeLayersEmptyHandler, useEscapeLayer } from "./app/escapeLayers";
import { isConnectShortcut } from "./app/platform";

type RenameTabState = {
  sessionId: string;
  value: string;
};

type SftpTransferRegistry = Record<string, SftpTransferActivity>;
type TerminalTranscriptRecordingRegistry = Record<string, TerminalTranscriptRecordingActivity>;

const quickConnectWidth = 380;

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable=true]"));
}

/**
 * The application shell: sessions and tabs, options, and which dialog is open. The parts live in
 * components/ (workspace, options, scripts, dialogs, security) and the models / hooks in app/.
 */
function App() {
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  /** The Options tab is open (it stays open while another tab is shown). */
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  /** Without an active session the stage shows Home or the Options tab. */
  const [stageView, setStageView] = useState<"home" | "options">("home");
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [openAppMenu, setOpenAppMenu] = useState<AppMenuId | null>(null);
  const [options, setOptions] = useState<AppOptions>(defaultOptions);
  const antiIdleDefaults = useMemo(
    () => ({ antiIdle: options.antiIdle, keepaliveCountMax: options.keepaliveCountMax }),
    [options.antiIdle, options.keepaliveCountMax],
  );
  const terminalSchemeSettings = useMemo(
    () => ({ custom: options.customTerminalSchemes, defaultId: options.terminalSchemeId }),
    [options.customTerminalSchemes, options.terminalSchemeId],
  );
  /** A session's colors: the host's own scheme > its environment's > the default (live, not fixed at connect). */
  const schemeForHost = useCallback(
    (host: Session["host"]) => resolveTerminalScheme(
      host.terminalSchemeId,
      options.environments.find((environment) => environment.id === host.environmentId)?.terminalSchemeId,
      options.terminalSchemeId,
      options.customTerminalSchemes,
    ),
    [options.environments, options.terminalSchemeId, options.customTerminalSchemes],
  );
  const [optionsDraft, setOptionsDraft] = useState<AppOptions>(defaultOptions);
  const [sessions, setSessions] = useState<Session[]>([]);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const liveHostIds = sessions.filter((session) => session.status === "connected").map((session) => session.host.id);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // Split view: a tab is a layout of 1-4 sessions (panes). `tabs` always matches `sessions`.
  const [tabsState, setTabsState] = useState<SessionTab[]>([]);
  const tabs = useMemo(() => reconcileTabs(tabsState, sessions.map((session) => session.id)), [tabsState, sessions]);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  useEffect(() => {
    if (tabs !== tabsState) {
      setTabsState(tabs);
    }
  }, [tabs, tabsState]);
  const activeTab = activeSessionId ? findTabOf(tabs, activeSessionId) : null;
  /** The panes on screen: every session of the active tab. */
  const visibleSessionIds = useMemo(() => (activeTab ? tabSessionIds(activeTab) : []), [activeTab]);
  const visibleSessionIdsRef = useRef<string[]>(visibleSessionIds);
  visibleSessionIdsRef.current = visibleSessionIds;
  /** "Split with Session…": the next session opened from the palette goes next to this pane. */
  const pendingSplitRef = useRef<{ sessionId: string; edge: PaneEdge } | null>(null);
  const [tabDrag, setTabDrag] = useState<TabDragState | null>(null);
  const stageRef = useRef<HTMLElement>(null);
  const splitLayout = useMemo(() => (activeTab && activeTab.root.kind === "split" ? layoutTree(activeTab.root) : null), [activeTab]);
  const paneRects = useMemo(() => new Map(splitLayout?.panes.map((pane) => [pane.sessionId, pane.rect]) ?? []), [splitLayout]);
  const [vaultHosts, setVaultHosts] = useState<VaultHostSearchResult[]>([]);
  const [vaultFolders, setVaultFolders] = useState<Folder[]>([]);
  const [recentConnections, setRecentConnections] = useState<RecentConnection[]>(() => loadRecentConnections());
  const [quickConnectPosition, setQuickConnectPosition] = useState<{ left: number; top: number } | null>(null);
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  const terminalPaneRefs = useRef<Map<string, TerminalPaneHandle>>(new Map());
  const [terminalFocusVersion, setTerminalFocusVersion] = useState(0);
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null);
  const [scriptButtonContextMenu, setScriptButtonContextMenu] = useState<ScriptButtonContextMenuState | null>(null);
  const [isScriptButtonOverflowMenuOpen, setIsScriptButtonOverflowMenuOpen] = useState(false);
  const [isScriptButtonEditorOpen, setIsScriptButtonEditorOpen] = useState(false);
  const [renameTab, setRenameTab] = useState<RenameTabState | null>(null);
  const [pendingClose, setPendingClose] = useState<PendingCloseState | null>(null);
  // protected tabs among the ones being closed: what runs in them, and whether to end them on the server
  const [closeProtection, setCloseProtection] = useState<{
    checking: boolean;
    tabs: Array<{ sessionId: string; title: string; running: string | null; reachable: boolean }>;
    endThem: boolean;
  } | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [sftpTransferRegistry, setSftpTransferRegistry] = useState<SftpTransferRegistry>({});
  const [terminalTranscriptRecordingRegistry, setTerminalTranscriptRecordingRegistry] = useState<TerminalTranscriptRecordingRegistry>({});
  const [terminalNotices, setTerminalNotices] = useState<Record<string, string>>({});
  const [fontDialog, setFontDialog] = useState<TerminalAppearance | null>(null);
  const [isSettingsLoaded, setIsSettingsLoaded] = useState(false);
  const [credentialPrompt, setCredentialPrompt] = useState<CredentialPromptState | null>(null);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [transferWizard, setTransferWizard] = useState<"export" | "import" | null>(null);
  const [dataDirectory, setDataDirectory] = useState("");
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [storageRevision, setStorageRevision] = useState(0);
  // Host key / legacy algorithm questions from the SSH layer, answered one at a time.
  const [connectionPrompts, setConnectionPrompts] = useState<ConnectionPrompt[]>([]);

  const reloadStorage = useCallback(() => setStorageRevision((current) => current + 1), []);
  const security = useSecurity(storageRevision, reloadStorage);
  useSftpAutoResume(sessions, options.sftpAutoResume);
  const canUseSecureData = security.canUseSecureData;
  const scripts = useScriptButtonLibrary(canUseSecureData, storageRevision);

  useEffect(() => {
    const disposeAsk = window.shellium?.connectionPrompt.onAsk((prompt) => {
      setConnectionPrompts((current) => [...current, prompt]);
    });
    const disposeCancel = window.shellium?.connectionPrompt.onCancel((requestId) => {
      setConnectionPrompts((current) => current.filter((prompt) => prompt.requestId !== requestId));
    });
    return () => {
      disposeAsk?.();
      disposeCancel?.();
    };
  }, []);

  const handleConnectionPromptDecision = useCallback((prompt: ConnectionPrompt, decision: ConnectionPromptDecision) => {
    setConnectionPrompts((current) => current.filter((item) => item.requestId !== prompt.requestId));
    void window.shellium?.connectionPrompt.respond(prompt.requestId, decision);

    if (prompt.kind === "legacy-algorithms" && decision === "always") {
      // Persist on the saved host so future connections use legacy algorithms without asking.
      loadConnectionFolders()
        .then((folders) => {
          const host = findHostById(folders, prompt.hostId);
          return host ? saveConnectionFolders(updateConnectionHost(folders, { ...host, legacyAlgorithms: true })) : null;
        })
        .then((saved) => {
          if (saved) {
            setStorageRevision((current) => current + 1);
          }
        })
        .catch(() => undefined);
    }
  }, []);

  activeSessionIdRef.current = activeSessionId;
  const shellStyle = { "--sh-ui-font-size": `${options.uiFontSize}px` } as CSSProperties;
  const findEnvironment = (environmentId: string | undefined) =>
    environmentId ? options.environments.find((environment) => environment.id === environmentId) ?? null : null;
  const isSecurityGateVisible = security.isStatusLoading || security.isSetupRequired || security.isLocked;
  const isTerminalInteractionBlocked = !canUseSecureData || isPaletteOpen || Boolean(renameTab) || Boolean(pendingClose) || Boolean(fontDialog) || Boolean(credentialPrompt) || Boolean(transferWizard) || isScriptButtonEditorOpen || Boolean(scriptButtonContextMenu) || isScriptButtonOverflowMenuOpen || isAboutOpen || connectionPrompts.length > 0;
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const activeEnvironment = activeSession ? findEnvironment(activeSession.host.environmentId) : null;

  const activeTranscriptRecordingActivity = activeSessionId ? terminalTranscriptRecordingRegistry[activeSessionId] : undefined;
  const isActiveTerminalRecording = Boolean(activeTranscriptRecordingActivity?.active);
  const isActiveTerminalRecordingStarting = Boolean(activeTranscriptRecordingActivity?.starting);
  const canAutoRefocusTerminalRef = useRef(false);
  canAutoRefocusTerminalRef.current = Boolean(
    activeSessionId &&
    canUseSecureData &&
    !isTerminalInteractionBlocked &&
    !openAppMenu &&
    !tabContextMenu
  );

  const openConnectionPalette = () => {
    setIsPaletteOpen(true);
  };

  const isOptionsActive = isOptionsOpen && activeSessionId === null && stageView === "options";
  const isOptionsDirty = isOptionsOpen && JSON.stringify(normalizeAppOptions(optionsDraft)) !== JSON.stringify(normalizeAppOptions(options));
  /** Options as they were when the draft last matched them (see the effect below). */
  const optionsBaselineRef = useRef(options);

  /** Opens the Options tab, or switches to it (keeping its unsaved changes) when it is open. */
  const openOptionsPanel = () => {
    if (!isOptionsOpen) {
      setOptionsDraft(options);
      optionsBaselineRef.current = options;
      setIsOptionsOpen(true);
    }
    setActiveSessionId(null);
    setStageView("options");
  };

  const showHome = () => {
    setActiveSessionId(null);
    setStageView("home");
  };

  const handleSelectTab = (sessionId: string | null) => {
    if (sessionId === null) {
      showHome();
    } else {
      setActiveSessionId(sessionId);
    }
  };

  const closeOptionsPanel = async () => {
    if (isOptionsDirty && !(await askConfirm({
      title: "Discard unsaved changes?",
      body: "The Options tab has changes that were not applied. Closing it drops them.",
      confirmLabel: "Discard",
      tone: "danger",
    }))) {
      return;
    }
    setIsOptionsOpen(false);
    setOptionsDraft(options);
    setStageView("home");
  };

  // Options can change while the tab is open (theme button, tab width, imports...). Settings the user
  // has not touched in the draft follow them, so Apply never puts back a stale value; settings the
  // user changed keep the user's value.
  useEffect(() => {
    if (!isOptionsOpen) {
      optionsBaselineRef.current = options;
      return;
    }
    const baseline = optionsBaselineRef.current;
    optionsBaselineRef.current = options;
    if (baseline === options) {
      return;
    }
    setOptionsDraft((draft) => {
      const next = { ...draft } as Record<keyof AppOptions, unknown>;
      let changed = false;
      (Object.keys(options) as Array<keyof AppOptions>).forEach((key) => {
        if (JSON.stringify(draft[key]) === JSON.stringify(baseline[key]) && JSON.stringify(draft[key]) !== JSON.stringify(options[key])) {
          next[key] = options[key];
          changed = true;
        }
      });
      return changed ? next as AppOptions : draft;
    });
  }, [options, isOptionsOpen]);

  const toggleConnectionPalette = () => {
    if (!canUseSecureData) {
      return;
    }

    setIsPaletteOpen((current) => !current);
  };
  const contextSession = tabContextMenu
    ? sessions.find((session) => session.id === tabContextMenu.sessionId) ?? null
    : null;
  // The palette edits the connection store directly; reload the vault whenever it closes -
  // by Cancel / Esc or by connecting - so the sidebar and host counts are not stale.
  const wasPaletteOpenRef = useRef(false);
  useEffect(() => {
    if (wasPaletteOpenRef.current && !isPaletteOpen) {
      setStorageRevision((current) => current + 1);
    }

    wasPaletteOpenRef.current = isPaletteOpen;
  }, [isPaletteOpen]);

  useEffect(() => {
    if (!canUseSecureData) {
      return;
    }

    let isMounted = true;

    loadConnectionFolders()
      .then((folders) => {
        if (isMounted) {
          setVaultHosts(collectVaultHosts(folders));
          setVaultFolders(folders);
        }
      })
      .catch(() => {
        if (isMounted) {
          setVaultHosts([]);
          setVaultFolders([]);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [canUseSecureData, storageRevision]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }

    setTabsState((current) => setTabFocus(reconcileTabs(current, sessionsRef.current.map((session) => session.id)), activeSessionId));
    // every pane of the shown tab is being looked at
    const visible = new Set(visibleSessionIdsRef.current);
    visible.add(activeSessionId);
    setSessions((current) => current.some((session) => visible.has(session.id) && (session.hasUnreadActivity || session.hasBell || session.isDone))
      ? current.map((session) =>
        visible.has(session.id) && (session.hasUnreadActivity || session.hasBell || session.isDone)
          ? { ...session, hasUnreadActivity: false, hasBell: false, isDone: false }
          : session)
      : current);
  }, [activeSessionId, activeTab?.id]);

  useEffect(() => {
    let isMounted = true;

    window.shellium?.settings.get()
      .then((result) => {
        if (!isMounted) {
          return;
        }

        const nextOptions = result.settings.appOptions !== undefined
          ? normalizeAppOptions(result.settings.appOptions)
          : loadLegacyOptions() ?? defaultOptions;

        setOptions(nextOptions);
        setOptionsDraft(nextOptions);
        setDataDirectory(result.dataDirectory);
        setIsSettingsLoaded(true);
        setSettingsError(null);

        if (result.settings.appOptions === undefined) {
          window.shellium?.settings.saveAppOptions(nextOptions).catch(() => undefined);
        }
      })
      .catch((error: unknown) => {
        if (!isMounted) {
          return;
        }

        const fallbackOptions = loadLegacyOptions() ?? defaultOptions;
        setOptions(fallbackOptions);
        setOptionsDraft(fallbackOptions);
        setIsSettingsLoaded(true);
        setSettingsError(error instanceof Error ? error.message : "Settings could not be loaded.");
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isSettingsLoaded) {
      return;
    }

    window.shellium?.settings.saveAppOptions(options).catch((error: unknown) => {
      setSettingsError(error instanceof Error ? error.message : "Settings could not be saved.");
    });
  }, [isSettingsLoaded, options]);

  useEffect(() => {
    window.shellium?.app.setZoomFactor(options.uiScale);
  }, [options.uiScale]);

  useEffect(() => {
    const unsubscribe = window.shellium?.app.onCloseRequest?.(() => {
      const hasActiveTransfer = Object.values(sftpTransferRegistry).some((activity) => activity.active);
      const hasOpenTerminalSession = sessions.some((session) => session.status !== "disconnected");

      if (hasActiveTransfer || hasOpenTerminalSession) {
        setPendingClose({ kind: "app" });
        return;
      }

      window.shellium?.app.confirmClose();
    });

    return () => unsubscribe?.();
  }, [sftpTransferRegistry, sessions]);

  useEffect(() => {
    const unsubscribe = window.shellium?.app.onShortcut((shortcut) => {
      if (shortcut === "connect") {
        toggleConnectionPalette();
      }
    });

    return () => unsubscribe?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseSecureData]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isConnectShortcut(event)) {
        event.preventDefault();
        toggleConnectionPalette();
      }

    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseSecureData]);

  // Escape closes only the topmost window (src/app/escapeLayers.ts); these menus have no hook of their own.
  useEscapeLayer(() => setTabContextMenu(null), tabContextMenu !== null);
  useEscapeLayer(() => setScriptButtonContextMenu(null), scriptButtonContextMenu !== null);
  useEffect(() => {
    setEscapeLayersEmptyHandler(() => setTerminalFocusVersion((current) => current + 1));
    return () => setEscapeLayersEmptyHandler(null);
  }, []);

  useEffect(() => {
    if (!tabContextMenu) {
      return;
    }

    const closeMenu = () => setTabContextMenu(null);

    window.addEventListener("click", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [tabContextMenu]);

  useEffect(() => {
    if (!scriptButtonContextMenu) {
      return;
    }

    const closeMenu = () => setScriptButtonContextMenu(null);

    window.addEventListener("click", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [scriptButtonContextMenu]);

  const createSession = (host: Host, title?: string): Session => ({
    id: `${host.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    host,
    title,
    status: "connecting",
    reconnectToken: 0,
    hasUnreadActivity: false,
    protectOnConnect: options.protectNewSessions,
  });

  /**
   * A session that is over and holds nothing: shell closed or disconnected, not reconnecting, not
   * protected (its tmux / screen still runs on the server), no SFTP transfer. Closes without asking;
   * Connect may replace it.
   */
  const isClosedSession = (session: Session) =>
    session.status === "disconnected" && !session.reconnecting && !session.protection && !sftpTransferRegistry[session.id]?.active;

  /** A new session (own SSH connection) for `host`, as a new pane next to `targetId`. */
  const openSessionInSplit = (host: Host, targetId: string, edge: PaneEdge) => {
    const tab = findTabOf(tabsRef.current, targetId);
    if (!tab || tabSessionIds(tab).length >= MAX_PANES) {
      return false;
    }
    const session = createSession(host);
    setSessions((current) => [...current, session]);
    setTabsState(splitPane(tabsRef.current, targetId, session.id, edge));
    setActiveSessionId(session.id);
    return true;
  };

  const openSession = (host: Host) => {
    if (!isQuickConnectHost(host)) {
      setRecentConnections((current) => recordRecentConnection(current, host.id));
    }

    const pendingSplit = pendingSplitRef.current;
    pendingSplitRef.current = null;
    if (pendingSplit && openSessionInSplit(host, pendingSplit.sessionId, pendingSplit.edge)) {
      setIsPaletteOpen(false);
      return;
    }

    if (!options.openDuplicateSessions) {
      // the open one, else a closed one of the same host (that one reconnects)
      const sameHost = sessions.filter((session) => session.host.id === host.id);
      const existingSession = sameHost.find((session) => !isClosedSession(session)) ?? sameHost[0];

      if (existingSession) {
        setIsPaletteOpen(false);
        if (isClosedSession(existingSession)) {
          reconnectSession(existingSession.id);
        } else {
          setActiveSessionId(existingSession.id);
        }
        return;
      }
    }

    const session = createSession(host);
    const active = sessions.find((item) => item.id === activeSessionId);

    if (options.replaceClosedTab && active && isClosedSession(active)) {
      // the new session takes the closed one's place (its tab, or its pane in a split tab)
      clearTranscriptRecordingActivities([active.id]);
      setSessions((current) => [...current.filter((item) => item.id !== active.id), session]);
      setTabsState(replacePane(tabsRef.current, active.id, session.id));
    } else {
      setSessions((current) => [...current, session]);
    }
    setActiveSessionId(session.id);
    setIsPaletteOpen(false);
  };

  const handleConnect = (host: Host) => {
    setIsPaletteOpen(false);

    if (host.username.trim() && (host.password ?? "").length > 0) {
      openSession(host);
      return;
    }

    setCredentialError(null);
    setCredentialPrompt({
      host,
      username: host.username,
      password: host.password ?? "",
      savePassword: false,
    });
  };

  const handleCredentialPromptCancel = () => {
    pendingSplitRef.current = null;
    setCredentialPrompt(null);
    setCredentialError(null);
    refocusTerminal();
  };

  const handleCredentialPromptSubmit = (shouldSave: boolean, requirePassword = false) => {
    if (!credentialPrompt) {
      return;
    }

    const username = credentialPrompt.username.trim();
    const password = credentialPrompt.password;

    if (!username) {
      setCredentialError("Username is required.");
      return;
    }

    if ((requirePassword || shouldSave) && !password) {
      setCredentialError("Password is required.");
      return;
    }

    const nextHost: Host = {
      ...credentialPrompt.host,
      username,
      password: password || undefined,
    };

    if (!shouldSave || isQuickConnectHost(nextHost)) {
      setCredentialPrompt(null);
      setCredentialError(null);
      openSession(nextHost);
      return;
    }

    loadConnectionFolders()
      .then((folders) => saveConnectionFolders(updateConnectionHost(folders, nextHost)))
      .then(() => {
        setStorageRevision((current) => current + 1);
        setCredentialPrompt(null);
        setCredentialError(null);
        openSession(nextHost);
      })
      .catch((error: unknown) => {
        setCredentialError(error instanceof Error ? error.message : "Credentials could not be saved.");
      });
  };
  const refocusTerminal = () => {
    window.setTimeout(() => setTerminalFocusVersion((current) => current + 1), 0);
  };
  const bumpTerminalFocus = useCallback(() => setTerminalFocusVersion((current) => current + 1), []);
  const updateSessionStatus = useCallback((sessionId: string, status: Session["status"]) => {
    setSessions((current) => {
      let changed = false;
      const nextSessions = current.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        const hasUnreadActivity = status === "disconnected" ? session.hasUnreadActivity : false;

        if (session.status === status && session.hasUnreadActivity === hasUnreadActivity) {
          return session;
        }

        changed = true;
        return { ...session, status, hasUnreadActivity };
      });

      return changed ? nextSessions : current;
    });
  }, []);

  const markSessionActivity = useCallback((sessionId: string) => {
    if (sessionId === activeSessionIdRef.current || visibleSessionIdsRef.current.includes(sessionId)) {
      return;
    }

    setSessions((current) => {
      let changed = false;
      const nextSessions = current.map((session) => {
        if (session.id !== sessionId || session.hasUnreadActivity) {
          return session;
        }

        changed = true;
        return { ...session, hasUnreadActivity: true };
      });

      return changed ? nextSessions : current;
    });
  }, []);

  /** Bell (BEL, e.g. `make; echo -e '\a'`): a background tab shows a bell, a background window flashes. */
  const markSessionBell = useCallback((sessionId: string) => {
    window.shellium?.app.requestAttention();
    if (sessionId === activeSessionIdRef.current || visibleSessionIdsRef.current.includes(sessionId)) {
      return;
    }

    setSessions((current) => current.some((session) => session.id === sessionId && !session.hasBell)
      ? current.map((session) => session.id === sessionId ? { ...session, hasBell: true } : session)
      : current);
  }, []);

  /**
   * Notify When Done: the watched command's prompt is back. Unless the user is looking at that tab,
   * a Windows notification (click: back to the tab) and a check mark on the tab. One-shot.
   */
  const handleCommandDone = useCallback((sessionId: string, info: { command: string; durationMs: number }) => {
    const session = sessionsRef.current.find((item) => item.id === sessionId);
    if (!session) {
      return;
    }
    const isWatched = document.hasFocus() && (sessionId === activeSessionIdRef.current || visibleSessionIdsRef.current.includes(sessionId));
    setSessions((current) => current.map((item) =>
      item.id === sessionId ? { ...item, notifyWhenDone: false, isDone: !isWatched } : item));
    if (isWatched) {
      return;
    }
    window.shellium?.app.requestAttention();
    try {
      const notification = new Notification(`${getSessionTitle(session)}: done`, {
        body: `${info.command || "The command"} finished after ${formatDuration(info.durationMs)}.`,
        tag: `shellium-done-${sessionId}`,
      });
      notification.onclick = () => {
        window.shellium?.app.focusWindow();
        setActiveSessionId(sessionId);
      };
    } catch {
      // notifications blocked by the system: the flashing taskbar button and the tab mark remain
    }
  }, []);

  const handleToggleNotifyWhenDone = (sessionId: string) => {
    setTabContextMenu(null);
    setSessions((current) => current.map((item) =>
      item.id === sessionId ? { ...item, notifyWhenDone: !item.notifyWhenDone, isDone: false } : item));
  };

  const handleProtectionChange = useCallback((sessionId: string, protection: SessionProtection | null) => {
    setSessions((current) => current.map((session) =>
      session.id === sessionId ? { ...session, protection: protection ?? undefined } : session));
  }, []);

  const handleReconnectingChange = useCallback((sessionId: string, reconnecting: boolean) => {
    setSessions((current) => current.map((session) =>
      session.id === sessionId && Boolean(session.reconnecting) !== reconnecting ? { ...session, reconnecting } : session));
  }, []);

  const handleToggleProtection = (sessionId: string) => {
    const session = sessions.find((item) => item.id === sessionId);
    const pane = terminalPaneRefs.current.get(sessionId);
    setTabContextMenu(null);
    if (!session || !pane) {
      return;
    }
    setActiveSessionId(sessionId);
    if (session.protection) {
      pane.unprotect();
    } else {
      pane.protect();
    }
  };

  const reconnectSession = (sessionId: string) => {
    setSessions((current) => current.map((session) =>
      session.id === sessionId
        ? {
            ...session,
            status: "connecting",
            hasUnreadActivity: false,
            reconnectToken: (session.reconnectToken ?? 0) + 1,
          }
        : session,
    ));
    setActiveSessionId(sessionId);
    refocusTerminal();
  };

  const handleReconnectSession = (sessionId: string) => {
    const session = sessions.find((item) => item.id === sessionId);

    if (session?.status !== "connected") {
      reconnectSession(sessionId);
    }

    setTabContextMenu(null);
  };

  const handleSftpTransferActivityChange = useCallback((sessionId: string, activity: SftpTransferActivity) => {
    setSftpTransferRegistry((current) => {
      if (!activity.active) {
        const rest = { ...current };
        delete rest[sessionId];
        return rest;
      }

      return { ...current, [sessionId]: activity };
    });
  }, []);

  const handleTerminalNotice = useCallback((sessionId: string, message: string) => {
    setTerminalNotices((current) => ({ ...current, [sessionId]: message }));
  }, []);

  const handleTranscriptRecordingActivityChange = useCallback((sessionId: string, activity: TerminalTranscriptRecordingActivity) => {
    setTerminalTranscriptRecordingRegistry((current) => {
      if (!activity.active && !activity.starting) {
        const rest = { ...current };
        delete rest[sessionId];
        return rest;
      }

      return { ...current, [sessionId]: activity };
    });
  }, []);

  const handleDisconnectSession = (sessionId: string) => {
    terminalPaneRefs.current.get(sessionId)?.disconnect();
    setTabContextMenu(null);
  };

  const clearTranscriptRecordingActivities = (sessionIds: string[]) => {
    setTerminalNotices((current) => {
      const next = { ...current };
      sessionIds.forEach((sessionId) => delete next[sessionId]);
      return next;
    });
    setTerminalTranscriptRecordingRegistry((current) => {
      const next = { ...current };
      sessionIds.forEach((sessionId) => delete next[sessionId]);
      return next;
    });
  };

  const closeSessionIds = (sessionIds: string[]) => {
    clearTranscriptRecordingActivities(sessionIds);
    const closeIds = new Set(sessionIds);
    const remainingSessions = sessions.filter((session) => !closeIds.has(session.id));
    const remainingTabs = reconcileTabs(tabsRef.current, remainingSessions.map((session) => session.id));

    setSessions(remainingSessions);
    setTabsState(remainingTabs);

    if (activeSessionId && closeIds.has(activeSessionId)) {
      // another pane of the same tab, else the tab that took its place, else the one before it
      const oldIndex = tabsRef.current.findIndex((tab) => tabSessionIds(tab).includes(activeSessionId));
      const sameTab = remainingTabs.find((tab) => tab.id === tabsRef.current[oldIndex]?.id);
      const nextTab = sameTab ?? remainingTabs[Math.min(Math.max(oldIndex, 0), remainingTabs.length - 1)];
      setActiveSessionId(nextTab?.focusedSessionId ?? null);
    }
  };

  const handleCloseSession = (sessionId: string) => {
    const session = sessions.find((item) => item.id === sessionId);

    if (!session) {
      return;
    }

    setTabContextMenu(null);
    if (isClosedSession(session)) {
      // nothing left to lose (exit typed, connection gone): no question
      closeSessionIds([sessionId]);
      refocusTerminal();
      return;
    }

    const tab = findTabOf(tabsRef.current, sessionId);
    setPendingClose({ kind: "single", sessionId, title: getSessionTitle(session), isPane: Boolean(tab && tabSessionIds(tab).length > 1) });
  };

  /** The tab's close button: the whole tab, every pane of a split tab. */
  const handleCloseTab = (sessionId: string) => {
    const tab = findTabOf(tabsRef.current, sessionId);
    const ids = tab ? tabSessionIds(tab) : [sessionId];

    if (ids.length <= 1) {
      handleCloseSession(sessionId);
      return;
    }

    setTabContextMenu(null);
    if (ids.every((id) => sessions.some((session) => session.id === id && isClosedSession(session)))) {
      closeSessionIds(ids);
      refocusTerminal();
      return;
    }

    const focused = sessions.find((session) => session.id === tab?.focusedSessionId);
    setPendingClose({ kind: "tab", sessionIds: ids, title: focused ? getSessionTitle(focused) : "" });
  };

  const handleCloseOtherSessions = (sessionId: string) => {
    const ownTab = findTabOf(tabsRef.current, sessionId);
    const otherTabs = tabsRef.current.filter((tab) => tab !== ownTab);

    if (!ownTab || otherTabs.length === 0) {
      setTabContextMenu(null);
      return;
    }

    setPendingClose({ kind: "others", sessionId, sessionIds: otherTabs.flatMap(tabSessionIds), count: otherTabs.length });
    setTabContextMenu(null);
  };

  const getClosingSessionIds = (closeState: PendingCloseState) => {
    if (closeState.kind === "single") {
      return [closeState.sessionId];
    }

    if (closeState.kind === "others" || closeState.kind === "tab") {
      return closeState.sessionIds;
    }

    return sessions.map((session) => session.id);
  };

  const getCloseTransferActivity = (closeState: PendingCloseState) => {
    return getClosingSessionIds(closeState)
      .map((sessionId) => sftpTransferRegistry[sessionId])
      .find((activity) => activity?.active) ?? null;
  };

  const getOpenTerminalSessionCount = (closeState: PendingCloseState) => {
    const closingSessionIds = new Set(getClosingSessionIds(closeState));

    return sessions.filter((session) => closingSessionIds.has(session.id) && session.status !== "disconnected").length;
  };

  const getCloseConfirmTitle = (closeState: PendingCloseState) => {
    if (closeState.kind === "app") {
      return "Quit Shellium";
    }

    if (closeState.kind === "others") {
      return "Close Tabs";
    }

    return closeState.kind === "single" && closeState.isPane ? "Close Pane" : "Close Tab";
  };

  const getCloseConfirmBody = (closeState: PendingCloseState) => {
    const transferActivity = getCloseTransferActivity(closeState);

    if (transferActivity?.direction === "upload") {
      return "An upload is currently in progress. Closing will interrupt the upload. Are you sure?";
    }

    if (transferActivity?.direction === "download") {
      return "A download is currently in progress. Closing will interrupt the download. Are you sure?";
    }

    if (transferActivity) {
      return "A file transfer is currently in progress. Closing will interrupt the transfer. Are you sure?";
    }

    if (closeState.kind === "single") {
      return closeState.isPane ? `Close pane "${closeState.title}"? Its session ends.` : `Close tab "${closeState.title}"?`;
    }

    if (closeState.kind === "tab") {
      return `Close tab "${closeState.title}" and all ${closeState.sessionIds.length} of its panes?`;
    }

    if (closeState.kind === "others") {
      return `Close ${closeState.count} other tab${closeState.count === 1 ? "" : "s"}?`;
    }

    const openTerminalSessionCount = getOpenTerminalSessionCount(closeState);

    if (openTerminalSessionCount > 0) {
      return `There ${openTerminalSessionCount === 1 ? "is" : "are"} ${openTerminalSessionCount} active terminal session${openTerminalSessionCount === 1 ? "" : "s"}. Closing Shellium will disconnect ${openTerminalSessionCount === 1 ? "it" : "them"}. Are you sure?`;
    }

    return "Close Shellium?";
  };

  useEffect(() => {
    if (!pendingClose) {
      setCloseProtection(null);
      return;
    }
    const ids = new Set(getClosingSessionIds(pendingClose));
    const closing = sessions.filter((session) => ids.has(session.id) && session.protection);
    if (!closing.length) {
      setCloseProtection(null);
      return;
    }
    let cancelled = false;
    setCloseProtection({ checking: true, tabs: [], endThem: false });
    const withTimeout = <T,>(promise: Promise<T>) => Promise.race([promise, new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("timeout")), 4000))]);
    void Promise.all(closing.map(async (session) => {
      const title = getSessionTitle(session);
      if (session.status !== "connected") {
        return { sessionId: session.id, title, running: null, reachable: false };
      }
      try {
        const state = await withTimeout(window.shellium!.terminal.protectState(session.id));
        return { sessionId: session.id, title, running: state.running, reachable: true };
      } catch {
        return { sessionId: session.id, title, running: "unknown", reachable: true };
      }
    })).then((tabs) => {
      if (!cancelled) {
        // end them by default only when nothing runs in any of them
        setCloseProtection({ checking: false, tabs, endThem: tabs.every((tab) => tab.reachable && !tab.running) });
      }
    });
    return () => {
      cancelled = true;
    };
    // the sessions at the moment the dialog opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingClose]);

  const renderCloseProtection = () => {
    if (!closeProtection) {
      return null;
    }
    if (closeProtection.checking) {
      return <p className="md-text md-protect-note">Checking the protected session{pendingClose?.kind === "single" ? "" : "s"} on the server…</p>;
    }
    const reachable = closeProtection.tabs.filter((tab) => tab.reachable);
    const busy = closeProtection.tabs.filter((tab) => tab.running);
    return (
      <div className="md-protect">
        <p className="md-text md-protect-note">
          {closeProtection.tabs.length === 1 ? "This tab is protected" : `${closeProtection.tabs.length} of these tabs are protected`}: its shell runs in tmux / screen on the server.
          {busy.length > 0 && (
            <> Still running: {busy.map((tab) => <b key={tab.sessionId}>{tab.running === "unknown" ? `something in ${tab.title}` : `${tab.running} (${tab.title})`}</b>).reduce<ReactNode[]>((all, item, index) => (index ? [...all, ", ", item] : [item]), [])}.</>
          )}
          {" "}Left running, it can be taken over again later: Protect on a tab of the same server offers it.
        </p>
        {reachable.length > 0 && (
          <label className="md-check">
            <input
              type="checkbox"
              checked={closeProtection.endThem}
              onChange={(event) => setCloseProtection({ ...closeProtection, endThem: event.target.checked })}
            />
            End the protected session{reachable.length === 1 ? "" : "s"} on the server too{busy.length ? " (stops what runs in it)" : ""}
          </label>
        )}
      </div>
    );
  };

  const handleCancelClose = () => {
    setPendingClose(null);
    refocusTerminal();
  };

  const handleConfirmClose = async () => {
    if (!pendingClose || isClosing) {
      return;
    }
    if (closeProtection?.endThem) {
      setIsClosing(true);
      await Promise.all(closeProtection.tabs.filter((tab) => tab.reachable).map((tab) =>
        Promise.race([
          window.shellium!.terminal.protectStop(tab.sessionId).catch(() => undefined),
          new Promise((resolve) => window.setTimeout(resolve, 4000)),
        ])));
      setIsClosing(false);
    }

    if (pendingClose.kind === "single") {
      closeSessionIds([pendingClose.sessionId]);
    } else if (pendingClose.kind === "tab") {
      closeSessionIds(pendingClose.sessionIds);
    } else if (pendingClose.kind === "others") {
      closeSessionIds(pendingClose.sessionIds);
      setActiveSessionId(pendingClose.sessionId);
    } else {
      clearTranscriptRecordingActivities(sessions.map((session) => session.id));
      window.shellium?.app.confirmClose();
    }

    setPendingClose(null);
    refocusTerminal();
  };

  const handleDuplicateSession = (sessionId: string) => {
    const session = sessions.find((item) => item.id === sessionId);

    if (!session || session.status === "disconnected") {
      setTabContextMenu(null);
      return;
    }

    const duplicate = createSession(session.host, `${getSessionTitle(session)} copy`);
    setSessions((current) => [...current, duplicate]);
    setActiveSessionId(duplicate.id);
    setTabContextMenu(null);
  };

  /** Split Right / Split Down: the same host again, in a new pane with its own connection. */
  const handleSplitSession = (sessionId: string, edge: PaneEdge) => {
    setTabContextMenu(null);
    const session = sessions.find((item) => item.id === sessionId);
    if (session) {
      openSessionInSplit(session.host, sessionId, edge);
    }
  };

  /** Split with Session…: pick the host in the connect palette; it opens next to this pane. */
  const handleSplitWithSession = (sessionId: string) => {
    setTabContextMenu(null);
    const surface = document.querySelector<HTMLElement>(`[data-pane-session="${CSS.escape(sessionId)}"]`);
    // the longer side of the pane is split
    const edge: PaneEdge = surface && surface.clientHeight > surface.clientWidth ? "bottom" : "right";
    pendingSplitRef.current = { sessionId, edge };
    setIsPaletteOpen(true);
  };

  const handleDetachPane = (sessionId: string) => {
    setTabContextMenu(null);
    setTabsState(detachPane(tabsRef.current, sessionId));
    setActiveSessionId(sessionId);
    refocusTerminal();
  };

  const handleTabDragStart = (sessionId: string) => {
    const sourceTab = findTabOf(tabsRef.current, sessionId);
    if (sourceTab) {
      setTabDrag({ sourceTabId: sourceTab.id, returnSessionId: activeSessionIdRef.current });
    }
  };

  const handleTabDragEnd = () => {
    setTabDrag(null);
    bumpTerminalFocus();
  };

  /** A pane's title row was pressed and moved: drag the pane within its tab. */
  const handlePaneDragStart = (sessionId: string) => {
    const tab = findTabOf(tabsRef.current, sessionId);
    if (tab) {
      setActiveSessionId(sessionId);
      setTabDrag({ sourceTabId: tab.id, returnSessionId: null, paneSessionId: sessionId });
    }
  };

  // a pane drag ends wherever the button is released (the drop itself is handled by SplitStage first)
  useEffect(() => {
    if (!tabDrag?.paneSessionId) {
      return;
    }
    document.documentElement.classList.add("sh-dragging-pane");
    const end = () => {
      setTabDrag(null);
      bumpTerminalFocus();
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("blur", end);
    return () => {
      document.documentElement.classList.remove("sh-dragging-pane");
      window.removeEventListener("pointerup", end);
      window.removeEventListener("blur", end);
    };
  }, [tabDrag, bumpTerminalFocus]);

  const handlePaneDrop = (sessionId: string, targetSessionId: string, edge: PaneDropEdge) => {
    setTabsState(edge === "center"
      ? swapPanes(tabsRef.current, sessionId, targetSessionId)
      : movePane(tabsRef.current, sessionId, targetSessionId, edge));
    setActiveSessionId(sessionId);
  };

  /** A tab dropped onto a pane of the shown tab: its panes join that tab on the `edge` side. */
  const handleTabDrop = (sourceTabId: string, targetSessionId: string, edge: PaneEdge) => {
    const source = tabsRef.current.find((tab) => tab.id === sourceTabId);
    const next = mergeTab(tabsRef.current, sourceTabId, targetSessionId, edge);
    if (source && next !== tabsRef.current) {
      setTabsState(next);
      setActiveSessionId(source.focusedSessionId);
    }
  };

  const handleRenameSession = (sessionId: string) => {
    const session = sessions.find((item) => item.id === sessionId);

    if (!session) {
      return;
    }

    setRenameTab({ sessionId, value: getSessionTitle(session) });
    setTabContextMenu(null);
  };

  const handleSubmitRename = (value: string) => {
    if (!renameTab) {
      return;
    }

    const normalizedTitle = value.trim();
    setSessions((current) =>
      current.map((item) =>
        item.id === renameTab.sessionId
          ? { ...item, title: normalizedTitle.length > 0 ? normalizedTitle : undefined }
          : item,
      ),
    );
    setRenameTab(null);
  };

  const handleOpenFontDialog = () => {
    setFontDialog((isOptionsActive ? optionsDraft : options).terminalAppearance);
  };

  const handleApplyFontDialog = (terminalAppearance: TerminalAppearance) => {
    if (isOptionsActive) {
      setOptionsDraft((current) => ({ ...current, terminalAppearance }));
    } else {
      setOptions((current) => ({ ...current, terminalAppearance }));
    }

    setFontDialog(null);
  };

  const handleApplyOptions = () => {
    const nextOptions = normalizeAppOptions(optionsDraft);
    optionsBaselineRef.current = nextOptions;
    setOptions(nextOptions);
    setOptionsDraft(nextOptions);
  };

  const handleRevertOptions = () => {
    setOptionsDraft(options);
  };

  const handleChooseDataDirectory = () => {
    setSettingsNotice(null);
    setSettingsError(null);

    window.shellium?.settings.chooseDataDirectory()
      .then((result) => {
        if (result.canceled) {
          return;
        }

        const nextOptions = normalizeAppOptions(result.settings.appOptions ?? options);
        setDataDirectory(result.dataDirectory);
        setOptions(nextOptions);
        setOptionsDraft(nextOptions);
        setStorageRevision((current) => current + 1);
        setSettingsNotice("Shellium data folder updated. Connections and settings are now loaded from the selected folder.");
      })
      .catch((error: unknown) => {
        setSettingsError(error instanceof Error ? error.message : "Data folder could not be changed.");
      });
  };

  const openTransferWizard = (mode: "export" | "import") => {
    setSettingsNotice(null);
    setSettingsError(null);
    setTransferWizard(mode);
  };

  /** An import (or its undo) rewrote connections, script buttons and maybe options: reload them. */
  const handleTransferDataChanged = (appOptions: unknown) => {
    window.shellium?.settings.get()
      .then((settingsResult) => {
        const nextOptions = normalizeAppOptions(settingsResult.settings.appOptions ?? appOptions ?? options);
        setDataDirectory(settingsResult.dataDirectory ?? dataDirectory);
        setOptions(nextOptions);
        setOptionsDraft(nextOptions);
      })
      .catch(() => undefined)
      .finally(() => {
        setIsPaletteOpen(false);
        setStorageRevision((current) => current + 1);
      });
  };

  const handleRunScriptButton = (button: ScriptButton) => {
    if (!activeSession) {
      return;
    }

    const sendParts = prepareScriptForTerminal(button.script);

    if (sendParts.length === 0) {
      return;
    }

    const sessionId = activeSession.id;

    // line by line in the main process, each line after the server answered (sendScript)
    const pane = terminalPaneRefs.current.get(sessionId);
    pane?.beginScript();
    void window.shellium?.terminal.sendScript(sessionId, sendParts).catch(() => undefined).finally(() => pane?.endScript());
    setTerminalFocusVersion((current) => current + 1);
  };

  const openScriptButtonEditor = () => {
    setIsScriptButtonEditorOpen(true);
  };

  const handleScriptButtonContextMenu = (event: ReactMouseEvent, buttonId: string) => {
    event.preventDefault();
    setScriptButtonContextMenu({ buttonId, x: event.clientX, y: event.clientY });
  };

  /** The manager's position and size are kept in the options (settings.json). */
  const handleScriptEditorFrameChange = useCallback((frame: DialogFrame) => {
    setOptions((current) => (
      areDialogFramesEqual(current.scriptButtonEditorFrame, frame)
        ? current
        : { ...current, scriptButtonEditorFrame: frame }
    ));
  }, []);

  const openQuickConnect = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();

    if (quickConnectPosition) {
      setQuickConnectPosition(null);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const position = options.terminalTabPosition;
    setQuickConnectPosition(
      position === "left" ? { left: rect.right + 8, top: rect.top }
        : position === "right" ? { left: rect.left - quickConnectWidth - 8, top: rect.top }
          : { left: Math.max(8, Math.min(rect.left, window.innerWidth - quickConnectWidth - 8)), top: rect.bottom + 6 },
    );
  };
  const closeQuickConnect = useCallback(() => setQuickConnectPosition(null), []);

  useEffect(() => {
    const handleScriptShortcut = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || isEditableTarget(event.target)) {
        return;
      }

      // By physical key: on macOS Option+1 types a character ("¡"), so event.key is not the digit.
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code)?.[1];
      if (!digit) {
        return;
      }

      const button = scripts.activeButtons[Number(digit) - 1];

      if (!button) {
        return;
      }

      event.preventDefault();
      handleRunScriptButton(button);
    };

    window.addEventListener("keydown", handleScriptShortcut);
    return () => window.removeEventListener("keydown", handleScriptShortcut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession, scripts.activeButtons]);

  const moveSessionAcrossTarget = useCallback((sourceSessionId: string, targetSessionId: string) => {
    setTabsState(moveTab(tabsRef.current, sourceSessionId, targetSessionId));
  }, []);

  const getActiveTerminalPane = () => activeSessionId ? terminalPaneRefs.current.get(activeSessionId) ?? null : null;

  const handleToolbarCopy = () => {
    getActiveTerminalPane()?.copySelection();
    refocusTerminal();
  };

  const handleToolbarPaste = () => {
    getActiveTerminalPane()?.pasteFromClipboard();
    refocusTerminal();
  };

  const handleToolbarFind = () => {
    getActiveTerminalPane()?.openFind();
  };

  const handleToolbarSftp = () => {
    getActiveTerminalPane()?.openSftp();
  };

  const handleOpenSessionSftp = (sessionId: string) => {
    setActiveSessionId(sessionId);
    terminalPaneRefs.current.get(sessionId)?.openSftp();
  };

  const handleToolbarToggleRecording = () => {
    getActiveTerminalPane()?.toggleRecording();
  };

  const isEditableElement = (element: Element | null) => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    return Boolean(element.closest("input, textarea, select, [contenteditable='true']"));
  };

  const handleShellPointerUpCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !(event.target instanceof HTMLElement)) {
      return;
    }

    if (isEditableElement(event.target)) {
      return;
    }

    window.setTimeout(() => {
      if (!canAutoRefocusTerminalRef.current || isEditableElement(document.activeElement)) {
        return;
      }

      getActiveTerminalPane()?.focus();
    }, 0);
  };

  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const tabItems = tabs.flatMap((tab) => {
    const panes = tabSessionIds(tab).map((id) => sessionById.get(id)).filter((session): session is Session => Boolean(session));
    const focused = sessionById.get(tab.focusedSessionId) ?? panes[0];
    return focused ? [{ id: tab.id, panes, focused }] : [];
  });
  const contextTab = tabContextMenu ? findTabOf(tabs, tabContextMenu.sessionId) : null;
  const contextPaneCount = contextTab ? tabSessionIds(contextTab).length : 1;

  const handleTabContextMenu = (event: ReactMouseEvent<HTMLDivElement>, sessionId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setActiveSessionId(sessionId);
    setTabContextMenu({
      sessionId,
      x: event.clientX,
      y: event.clientY,
    });
  };

  // A click in another pane of the split tab focuses it. On the window in the capture phase: the
  // terminal's own pointer handlers (document, capture) stop the event before React sees it.
  useEffect(() => {
    if (!splitLayout) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const surface = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-pane-session]") : null;
      const sessionId = surface?.dataset.paneSession;
      if (sessionId && sessionId !== activeSessionIdRef.current && visibleSessionIdsRef.current.includes(sessionId)) {
        setActiveSessionId(sessionId);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [splitLayout]);

  const tabsAsStrip = options.terminalTabPosition === "top";
  const sessionTabsNode = (
    <SessionTabs
      tabs={tabItems}
      activeSessionId={activeSessionId}
      isHomeActive={activeSessionId === null && stageView === "home"}
      optionsTab={isOptionsOpen ? { active: isOptionsActive, dirty: isOptionsDirty } : null}
      onSelectOptions={openOptionsPanel}
      onCloseOptions={() => { void closeOptionsPanel(); }}
      onSelect={handleSelectTab}
      onClose={handleCloseTab}
      onContextMenu={handleTabContextMenu}
      onMove={moveSessionAcrossTarget}
      onDragStart={handleTabDragStart}
      onDragEnd={handleTabDragEnd}
      position={options.terminalTabPosition}
      size={options.terminalTabSize}
      onResize={(terminalTabSize) => setOptions((current) => ({ ...current, terminalTabSize }))}
      isQuickConnectOpen={Boolean(quickConnectPosition)}
      onOpenQuickConnect={openQuickConnect}
    />
  );

  return (
    <EnvironmentsContext.Provider value={options.environments}>
    <AntiIdleDefaultsContext.Provider value={antiIdleDefaults}>
    <TerminalSchemesContext.Provider value={terminalSchemeSettings}>
    <div
      className="shellium-shell"
      data-theme={options.theme}
      style={shellStyle}
      onPointerUpCapture={handleShellPointerUpCapture}
      onClick={() => openAppMenu && setOpenAppMenu(null)}
    >
      <AppTitleBar
        openMenu={openAppMenu}
        onOpenMenuChange={setOpenAppMenu}
        hasActiveSession={Boolean(activeSession)}
        isRecording={isActiveTerminalRecording}
        isRecordingStarting={isActiveTerminalRecordingStarting}
        isInteractionBlocked={isTerminalInteractionBlocked}
        theme={options.theme}
        canLock={Boolean(security.status?.unlocked) && !security.isBusy}
        actions={{
          connect: openConnectionPalette,
          exportData: () => openTransferWizard("export"),
          importData: () => openTransferWizard("import"),
          saveTranscript: () => getActiveTerminalPane()?.saveTranscript(),
          toggleRecording: handleToolbarToggleRecording,
          closeSession: () => activeSessionId && handleCloseSession(activeSessionId),
          copy: handleToolbarCopy,
          paste: handleToolbarPaste,
          find: handleToolbarFind,
          manageButtons: openScriptButtonEditor,
          options: openOptionsPanel,
          sftp: handleToolbarSftp,
          toggleTheme: () => setOptions((current) => ({ ...current, theme: current.theme === "light" ? "dark" : "light" })),
          lock: security.lock,
          about: () => setIsAboutOpen(true),
          reportBug: () => void openSupportMail("bug"),
          sendFeedback: () => void openSupportMail("feedback"),
          toggleProtection: () => activeSessionId && handleToggleProtection(activeSessionId),
          toggleProtectNewSessions: () => setOptions((current) => ({ ...current, protectNewSessions: !current.protectNewSessions })),
        }}
        activeProtection={activeSession?.protection ?? null}
        canProtect={activeSession?.status === "connected"}
        protectNewSessions={options.protectNewSessions}
      />
      {tabContextMenu && contextSession && (
        <TabContextMenu
          menu={tabContextMenu}
          session={contextSession}
          tabCount={tabs.length}
          paneCount={contextPaneCount}
          maxPanes={MAX_PANES}
          onSplitRight={() => handleSplitSession(tabContextMenu.sessionId, "right")}
          onSplitDown={() => handleSplitSession(tabContextMenu.sessionId, "bottom")}
          onSplitWithSession={() => handleSplitWithSession(tabContextMenu.sessionId)}
          onMoveToNewTab={() => handleDetachPane(tabContextMenu.sessionId)}
          onCloseTab={() => handleCloseTab(tabContextMenu.sessionId)}
          onRename={() => handleRenameSession(tabContextMenu.sessionId)}
          onDuplicate={() => handleDuplicateSession(tabContextMenu.sessionId)}
          onReconnect={() => handleReconnectSession(tabContextMenu.sessionId)}
          onToggleProtection={() => handleToggleProtection(tabContextMenu.sessionId)}
          onToggleNotifyWhenDone={() => handleToggleNotifyWhenDone(tabContextMenu.sessionId)}
          onDisconnect={() => handleDisconnectSession(tabContextMenu.sessionId)}
          onClose={() => handleCloseSession(tabContextMenu.sessionId)}
          onCloseOthers={() => handleCloseOtherSessions(tabContextMenu.sessionId)}
        />
      )}

      {pendingClose && (
        <CloseConfirmDialog
          title={getCloseConfirmTitle(pendingClose)}
          body={getCloseConfirmBody(pendingClose)}
          isApp={pendingClose.kind === "app"}
          onConfirm={() => void handleConfirmClose()}
          onCancel={handleCancelClose}
          extra={renderCloseProtection()}
          confirmDisabled={isClosing || Boolean(closeProtection?.checking)}
        />
      )}

      {renameTab && (
        <RenameTabDialog initialValue={renameTab.value} onSubmit={handleSubmitRename} onCancel={() => setRenameTab(null)} />
      )}
      {fontDialog && (
        <TerminalFontDialog
          initial={fontDialog}
          scheme={resolveTerminalScheme(undefined, undefined, (isOptionsActive ? optionsDraft : options).terminalSchemeId, (isOptionsActive ? optionsDraft : options).customTerminalSchemes)}
          onApply={handleApplyFontDialog}
          onCancel={() => setFontDialog(null)}
        />
      )}

      <div
        className={`sh-modern sh-modern-tabs-${options.terminalTabPosition}`}
        style={{ "--sidebar-w": `${options.terminalTabSize}px`, "--sh-terminal-bg": (activeSession ? schemeForHost(activeSession.host) : resolveTerminalScheme(undefined, undefined, options.terminalSchemeId, options.customTerminalSchemes)).background } as CSSProperties}
      >
        {tabsAsStrip && sessionTabsNode}
        <div className="sh-modern-split">
          {!tabsAsStrip && sessionTabsNode}
          <div className="sh-main">
            {activeEnvironment?.warn && (
              <div className="sh-env-banner" role="note" style={environmentStyle(activeEnvironment)}>
                <ShieldAlert size={15} aria-hidden="true" />
                <strong>{activeEnvironment.name}</strong>
                <span>Commands in this session run on a {activeEnvironment.name.toLowerCase()} system.</span>
              </div>
            )}
            <div className={`sh-main-body sh-body-bar-${options.scriptButtonBarPosition}${activeSession ? "" : " sh-main-body-home"}`}>
              {activeSession && (
                <ScriptBar
                  library={scripts}
                  position={options.scriptButtonBarPosition}
                  size={options.scriptButtonBarSize}
                  onResize={(scriptButtonBarSize) => setOptions((current) => ({ ...current, scriptButtonBarSize }))}
                  disabled={!activeSession}
                  onRun={handleRunScriptButton}
                  onButtonContextMenu={handleScriptButtonContextMenu}
                  isOverflowOpen={isScriptButtonOverflowMenuOpen}
                  onOverflowOpenChange={setIsScriptButtonOverflowMenuOpen}
                />
              )}
              <main className={"sh-main-stage" + (splitLayout ? " sh-main-stage-split" : "")} ref={stageRef}>
                {sessions.map((session) => {
                  const paneRect = paneRects.get(session.id);
                  return (
                  <section
                    key={session.id}
                    className={"sh-surface" + (paneRect ? " sh-surface-pane" : "") + (paneRect && session.id === activeSessionId ? " sh-surface-focused" : "")}
                    data-pane-session={session.id}
                    hidden={!visibleSessionIds.includes(session.id)}
                    style={paneRect ? paneStyle(paneRect) : undefined}
                  >
                    {paneRect && (
                      <PaneHeader
                        session={session}
                        isFocused={session.id === activeSessionId}
                        onClose={handleCloseSession}
                        onContextMenu={handleTabContextMenu}
                        onDragStart={handlePaneDragStart}
                      />
                    )}
                    <TerminalPane
                      ref={(pane) => {
                        if (pane) {
                          terminalPaneRefs.current.set(session.id, pane);
                        } else {
                          terminalPaneRefs.current.delete(session.id);
                        }
                      }}
                      session={session}
                      isActive={session.id === activeSessionId}
                      uiScale={options.uiScale}
                      terminalAppearance={options.terminalAppearance}
                      terminalScheme={schemeForHost(session.host)}
                      scrollback={options.terminalScrollback}
                      selectionStyle={options.terminalSelectionStyle}
                      wordDelimiters={options.terminalWordDelimiters}
                      scrollOnOutput={options.terminalScrollOnOutput}
                      keepFullScreenOutput={options.terminalKeepFullScreenOutput}
                      backspaceKey={options.terminalBackspaceKey}
                      highlights={options.terminalHighlights}
                      onCommandDone={handleCommandDone}
                      recordingDirectory={options.terminalRecordingDirectory}
                      focusVersion={terminalFocusVersion}
                      isInteractionBlocked={isTerminalInteractionBlocked}
                      reconnectToken={session.reconnectToken}
                      onStatusChange={updateSessionStatus}
                      onActivity={markSessionActivity}
                      onBell={markSessionBell}
                      onNotice={handleTerminalNotice}
                      onSftpTransferActivityChange={handleSftpTransferActivityChange}
                      onTranscriptRecordingActivityChange={handleTranscriptRecordingActivityChange}
                      onCloseSession={handleCloseSession}
                      onProtectionChange={handleProtectionChange}
                      onReconnectingChange={handleReconnectingChange}
                      pasteDialogBounds={options.pasteDialogBounds}
                      onPasteDialogBoundsChange={(bounds) => setOptions((current) => ({ ...current, pasteDialogBounds: bounds }))}
                    />
                  </section>
                  );
                })}
                <SplitStage
                  stageRef={stageRef}
                  tabs={tabs}
                  activeTab={activeTab}
                  layout={splitLayout}
                  onRatioChange={(splitId, ratio) => setTabsState(setSplitRatio(tabsRef.current, splitId, ratio))}
                  onResizeEnd={bumpTerminalFocus}
                  drag={tabDrag}
                  onShowSession={setActiveSessionId}
                  onDrop={handleTabDrop}
                  onPaneDrop={handlePaneDrop}
                />
                {isOptionsOpen && (
                  <OptionsView
                    hidden={!isOptionsActive}
                    options={options}
                    draft={optionsDraft}
                    setDraft={setOptionsDraft}
                    onApply={handleApplyOptions}
                    onRevert={handleRevertOptions}
                    dataDirectory={dataDirectory}
                    onChooseDataDirectory={handleChooseDataDirectory}
                    settingsError={settingsError}
                    setSettingsError={setSettingsError}
                    settingsNotice={settingsNotice}
                    onOpenFontDialog={handleOpenFontDialog}
                    onOpenTransfer={openTransferWizard}
                    vaultFolders={vaultFolders}
                    security={security}
                  />
                )}
                {activeSessionId === null && stageView === "home" && (
                  <HomeView
                    hosts={vaultHosts}
                    recent={recentConnections}
                    sessions={sessions}
                    onConnect={handleConnect}
                    onSwitchToSession={setActiveSessionId}
                    onOpenHostManager={openConnectionPalette}
                  />
                )}
              </main>
            </div>
          </div>
        </div>
      </div>
      {quickConnectPosition && (
        <QuickConnectMenu
          hosts={vaultHosts}
          recent={recentConnections}
          sessions={sessions}
          position={quickConnectPosition}
          onConnect={handleConnect}
          onSwitchToSession={setActiveSessionId}
          onOpenHostManager={openConnectionPalette}
          onClose={closeQuickConnect}
        />
      )}

      {scriptButtonContextMenu && (
        <ScriptButtonContextMenu
          menu={scriptButtonContextMenu}
          onModify={() => {
            scripts.setSelectedButtonId(scriptButtonContextMenu.buttonId);
            setScriptButtonContextMenu(null);
            openScriptButtonEditor();
          }}
          onMoveUp={() => {
            scripts.moveButton(scriptButtonContextMenu.buttonId, -1);
            setScriptButtonContextMenu(null);
          }}
          onMoveDown={() => {
            scripts.moveButton(scriptButtonContextMenu.buttonId, 1);
            setScriptButtonContextMenu(null);
          }}
          onRemove={() => {
            scripts.deleteButton(scriptButtonContextMenu.buttonId);
            setScriptButtonContextMenu(null);
          }}
        />
      )}

      {isScriptButtonEditorOpen && (
        <ScriptButtonManager
          library={scripts}
          initialFrame={options.scriptButtonEditorFrame}
          onFrameChange={handleScriptEditorFrameChange}
          onButtonContextMenu={handleScriptButtonContextMenu}
          onClose={() => setIsScriptButtonEditorOpen(false)}
        />
      )}
      <StatusBar
        activeSession={activeSession}
        sessions={sessions}
        notice={activeSessionId ? terminalNotices[activeSessionId] ?? "" : ""}
        onOpenSftp={handleOpenSessionSftp}
        recordingStartedAt={activeTranscriptRecordingActivity?.active ? activeTranscriptRecordingActivity.startedAt ?? Date.now() : undefined}
        onStopRecording={handleToolbarToggleRecording}
      />

      {isSecurityGateVisible && <LockScreen security={security} animateBrand={isSettingsLoaded ? options.startupAnimation : null} />}
      {isPaletteOpen && canUseSecureData && (
        <ConnectionPalette
          key={storageRevision}
          onClose={() => {
            pendingSplitRef.current = null;
            setIsPaletteOpen(false);
          }}
          onConnect={handleConnect}
          liveHostIds={liveHostIds}
        />
      )}

      {connectionPrompts.length > 0 && (
        <ConnectionPromptDialog
          key={connectionPrompts[0].requestId}
          prompt={connectionPrompts[0]}
          queued={connectionPrompts.length - 1}
          onDecide={(decision) => handleConnectionPromptDecision(connectionPrompts[0], decision)}
        />
      )}

      {credentialPrompt && (
        <CredentialDialog
          prompt={credentialPrompt}
          error={credentialError}
          onChange={(next) => {
            setCredentialPrompt(next);
            setCredentialError(null);
          }}
          onSubmit={handleCredentialPromptSubmit}
          onCancel={handleCredentialPromptCancel}
        />
      )}
      {transferWizard && (
        <TransferWizard mode={transferWizard} onClose={() => setTransferWizard(null)} onDataChanged={handleTransferDataChanged} />
      )}
      {isAboutOpen && !isSecurityGateVisible && <AboutDialog onClose={() => setIsAboutOpen(false)} />}
      <ConfirmHost blocked={isSecurityGateVisible} />
      <EditContextMenu />
    </div>
    </TerminalSchemesContext.Provider>
    </AntiIdleDefaultsContext.Provider>
    </EnvironmentsContext.Provider>
  );
}

export default App;
