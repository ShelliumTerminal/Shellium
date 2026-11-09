import { Check, Circle, Clipboard, Copy, FolderOpen, Lock, Moon, Search, SearchCode, Settings, Shield, ShieldCheck, Square, SquarePen, Sun } from "lucide-react";
import type { SessionProtection } from "../palette/types";
import type { ThemeMode } from "../../app/appOptions";
import { useEscapeLayer } from "../../app/escapeLayers";
import BrandMark, { BrandWordmark } from "../common/BrandMark";
import { connectShortcutKeys } from "../../app/platform";

export type AppMenuId = "file" | "edit" | "view" | "tools" | "help";

export type AppTitleBarActions = {
  connect(): void;
  exportData(): void;
  importData(): void;
  saveTranscript(): void;
  toggleRecording(): void;
  closeSession(): void;
  copy(): void;
  paste(): void;
  find(): void;
  manageButtons(): void;
  options(): void;
  sftp(): void;
  toggleTheme(): void;
  lock(): void;
  about(): void;
  /** Protect the active tab (tmux / screen on the server), or switch that off. */
  toggleProtection(): void;
  toggleProtectNewSessions(): void;
};

type AppTitleBarProps = {
  openMenu: AppMenuId | null;
  onOpenMenuChange(menu: AppMenuId | null): void;
  actions: AppTitleBarActions;
  hasActiveSession: boolean;
  isRecording: boolean;
  isRecordingStarting: boolean;
  /** A dialog is open over the terminal: Paste is not allowed. */
  isInteractionBlocked: boolean;
  theme: ThemeMode;
  canLock: boolean;
  activeProtection: SessionProtection | null;
  canProtect: boolean;
  protectNewSessions: boolean;
};

/** Brand, application menus, host search and the toolbar on the right. */
export default function AppTitleBar({
  openMenu,
  onOpenMenuChange,
  actions,
  hasActiveSession,
  isRecording,
  isRecordingStarting,
  isInteractionBlocked,
  theme,
  canLock,
  activeProtection,
  canProtect,
  protectNewSessions,
}: AppTitleBarProps) {
  useEscapeLayer(() => onOpenMenuChange(null), openMenu !== null);
  const toggleMenu = (menuId: AppMenuId) => onOpenMenuChange(openMenu === menuId ? null : menuId);
  const run = (action: () => void) => {
    action();
    onOpenMenuChange(null);
  };
  const recordingLabel = isRecordingStarting ? "Starting Terminal Recording..." : isRecording ? "Stop Terminal Recording" : "Start Terminal Recording";
  const themeLabel = theme === "light" ? "Switch to dark theme" : "Switch to light theme";

  return (
    <header className="sh-chrome" onClick={(event) => event.stopPropagation()}>
      <div className="sh-titlebar">
        <div className="sh-brand">
          <span className="sh-brand-mark" aria-hidden="true">
            <BrandMark size={24} blink />
          </span>
          <span className="sh-brand-word">
            <BrandWordmark height={14} />
          </span>
        </div>
        <nav className="sh-menubar" aria-label="Application menu">
          <div className="sh-menu-group">
            <button type="button" className={openMenu === "file" ? "active" : ""} onClick={() => toggleMenu("file")}>
              File
            </button>
            {openMenu === "file" && (
              <div className="sh-menu-popover">
                <button type="button" onClick={() => run(actions.connect)}>Connect...</button>
                <button type="button" onClick={() => run(actions.exportData)}>Export...</button>
                <button type="button" onClick={() => run(actions.importData)}>Import...</button>
                <button type="button" disabled={!hasActiveSession} onClick={() => run(actions.saveTranscript)}>Save Terminal Output...</button>
                <button type="button" disabled={!hasActiveSession || isRecordingStarting} onClick={() => run(actions.toggleRecording)}>{recordingLabel}</button>
                <button type="button" disabled={!hasActiveSession} onClick={() => run(actions.closeSession)}>Close Session</button>
              </div>
            )}
          </div>
          <div className="sh-menu-group">
            <button type="button" className={openMenu === "edit" ? "active" : ""} onClick={() => toggleMenu("edit")}>
              Edit
            </button>
            {openMenu === "edit" && (
              <div className="sh-menu-popover">
                <button type="button" disabled={!hasActiveSession} onClick={() => run(actions.copy)}>Copy</button>
                <button type="button" disabled={!hasActiveSession || isInteractionBlocked} onClick={() => run(actions.paste)}>Paste</button>
                <button type="button" disabled={!hasActiveSession} onClick={() => run(actions.find)}>Find</button>
              </div>
            )}
          </div>
          <div className="sh-menu-group">
            <button type="button" className={openMenu === "view" ? "active" : ""} onClick={() => toggleMenu("view")}>
              View
            </button>
            {openMenu === "view" && (
              <div className="sh-menu-popover">
                <button type="button" disabled>No view actions</button>
              </div>
            )}
          </div>
          <div className="sh-menu-group">
            <button type="button" className={openMenu === "tools" ? "active" : ""} onClick={() => toggleMenu("tools")}>
              Tools
            </button>
            {openMenu === "tools" && (
              <div className="sh-menu-popover">
                <button type="button" disabled={!canProtect} onClick={() => run(actions.toggleProtection)}>
                  {activeProtection ? "Stop Protecting This Session" : "Protect This Session"}
                </button>
                <button type="button" className="sh-menu-check" onClick={() => run(actions.toggleProtectNewSessions)}>
                  <span className="sh-menu-check-mark" aria-hidden="true">{protectNewSessions && <Check size={13} />}</span>
                  Protect New Sessions
                </button>
                <div className="sh-menu-separator" aria-hidden="true" />
                <button type="button" onClick={() => run(actions.manageButtons)}>Script Buttons...</button>
                <button type="button" onClick={() => run(actions.options)}>Options...</button>
              </div>
            )}
          </div>
          <div className="sh-menu-group">
            <button type="button" className={openMenu === "help" ? "active" : ""} onClick={() => toggleMenu("help")}>
              Help
            </button>
            {openMenu === "help" && (
              <div className="sh-menu-popover sh-menu-popover-right">
                <button type="button" onClick={() => run(actions.about)}>About Shellium</button>
              </div>
            )}
          </div>
        </nav>
        <button type="button" className="sh-command-search" onClick={actions.connect}>
          <Search size={14} />
          <span>Search hosts and connect…</span>
          {connectShortcutKeys.map((key) => <kbd key={key}>{key}</kbd>)}
        </button>
        <div className="sh-titlebar-actions">
          <button type="button" className="sh-icon-btn" title="Copy the selection" aria-label="Copy" onClick={actions.copy} disabled={!hasActiveSession}>
            <Copy size={16} />
          </button>
          <button type="button" className="sh-icon-btn" title="Paste into the terminal" aria-label="Paste" onClick={actions.paste} disabled={!hasActiveSession || isInteractionBlocked}>
            <Clipboard size={16} />
          </button>
          <button type="button" className="sh-icon-btn" title="Find in the terminal" aria-label="Find" onClick={actions.find} disabled={!hasActiveSession}>
            <SearchCode size={16} />
          </button>
          <span className="sh-divider" aria-hidden="true" />
          <button type="button" className="sh-tool" onClick={actions.sftp} disabled={!hasActiveSession}>
            <FolderOpen size={15} />
            SFTP
          </button>
          <button
            type="button"
            className={"sh-tool sh-tool-record" + (isRecording ? " is-recording" : "")}
            onClick={actions.toggleRecording}
            disabled={!hasActiveSession || isRecordingStarting}
          >
            {isRecording ? <Square size={13} /> : <Circle size={14} />}
            {isRecordingStarting ? "Starting…" : isRecording ? "Stop recording" : "Record"}
          </button>
          <button type="button" className="sh-tool" onClick={actions.manageButtons}>
            <SquarePen size={15} />
            Scripts
          </button>
          <span className="sh-divider" aria-hidden="true" />
          <button
            type="button"
            className={"sh-tool sh-tool-protect" + (activeProtection ? " is-protected" : "")}
            onClick={actions.toggleProtection}
            disabled={!activeProtection && !canProtect}
            title={activeProtection
              ? `Protected: this tab runs in ${activeProtection.tool} on the server (${activeProtection.name}). A dropped connection reconnects and comes back. Click to stop protecting it.`
              : "Protect this session: its shell runs in tmux (or screen) on the server, so a dropped connection does not kill what runs in it."}
          >
            {activeProtection ? <ShieldCheck size={15} /> : <Shield size={15} />}
            {activeProtection ? "Protected" : "Protect"}
          </button>
          {protectNewSessions && (
            <button
              type="button"
              className="sh-protect-all"
              onClick={actions.toggleProtectNewSessions}
              title="New tabs open protected. Click to switch that off."
            >
              <ShieldCheck size={12} aria-hidden="true" />
              New tabs protected
            </button>
          )}
          <span className="sh-divider" aria-hidden="true" />
          <button type="button" className="sh-icon-btn" title={themeLabel} aria-label={themeLabel} onClick={actions.toggleTheme}>
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </button>
          <button type="button" className="sh-icon-btn" title="Options" aria-label="Options" onClick={actions.options}>
            <Settings size={16} />
          </button>
          <button type="button" className="sh-icon-btn" title="Lock Shellium" aria-label="Lock Shellium" onClick={actions.lock} disabled={!canLock}>
            <Lock size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}
