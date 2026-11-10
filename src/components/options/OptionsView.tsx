import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Download, Flag, FolderOpen, LayoutGrid, Lock, Monitor, Palette, Plus, RotateCcw, ShieldCheck, SlidersHorizontal, SquareTerminal, Trash2, Type, Upload } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  createEnvironmentId,
  deriveEnvironmentBadge,
  environmentColors,
  environmentStyle,
  maxEnvironmentBadgeLength,
} from "../common/environments";
import type { Environment } from "../common/environments";
import KnownHostsPanel from "../security/KnownHostsPanel";
import { AntiIdleFields } from "../common/AntiIdleFields";
import { SchemeSelect, schemeName } from "../common/TerminalSchemes";
import { TerminalSchemePicker } from "./TerminalSchemePicker";
import { normalizeKeepaliveCountMax } from "../common/antiIdleModel";
import type { Folder } from "../palette/types";
import {
  defaultOptions,
  normalizeAppOptions,
  normalizeScriptButtonBarPosition,
  normalizeTerminalScrollback,
  normalizeTerminalTabPosition,
  normalizeTheme,
  normalizeUiFontSize,
  normalizeUiScale,
  scriptButtonBarPositions,
  terminalScrollbackOptions,
  terminalTabPositions,
  uiFontSizeOptions,
  uiScaleOptions,
} from "../../app/appOptions";
import type { AppOptions } from "../../app/appOptions";
import type { SecurityState } from "../../app/useSecurity";

type OptionsCategory = "general" | "appearance" | "terminal" | "environments" | "x11" | "scriptButtons" | "security";

const optionsCategories: Array<{ value: OptionsCategory; label: string; description: string; icon: LucideIcon }> = [
  { value: "general", label: "General", description: "Data locations, backup and session behavior.", icon: SlidersHorizontal },
  { value: "appearance", label: "Appearance", description: "Theme, scale and window layout.", icon: Palette },
  { value: "terminal", label: "Terminal", description: "Terminal font, scrollback and tabs.", icon: SquareTerminal },
  { value: "environments", label: "Environments", description: "Production, test and other environments you tag hosts with.", icon: Flag },
  { value: "x11", label: "X11", description: "Local X server used for X11 forwarding.", icon: Monitor },
  { value: "scriptButtons", label: "Script Buttons", description: "Script button bar placement.", icon: LayoutGrid },
  { value: "security", label: "Security", description: "Master password and encryption of local data.", icon: ShieldCheck },
];

/**
 * What "Reset to defaults" puts back per page. Only settings: the user's own data (environments,
 * custom color schemes, data / recording folders, the app password) is never reset.
 */
const resettableOptions: Record<OptionsCategory, Array<keyof AppOptions>> = {
  general: ["openDuplicateSessions", "sftpAutoResume", "startupAnimation"],
  appearance: ["theme", "uiScale", "uiFontSize"],
  terminal: ["terminalAppearance", "terminalSchemeId", "terminalScrollback", "terminalSelectionStyle", "terminalTabPosition", "terminalTabSize", "antiIdle", "keepaliveCountMax"],
  environments: [],
  x11: ["x11ServerMode", "x11ExecutablePath"],
  scriptButtons: ["scriptButtonBarPosition", "scriptButtonBarSize"],
  security: [],
};

/** The page last shown, so reopening Options returns to it. */
let lastCategory: OptionsCategory = "general";

type OptionsViewProps = {
  /** Applied options, to tell whether the draft has unsaved changes. */
  options: AppOptions;
  draft: AppOptions;
  setDraft: Dispatch<SetStateAction<AppOptions>>;
  /** Hidden while another tab is shown; stays mounted so the page and its state survive. */
  hidden: boolean;
  onApply(): void;
  onRevert(): void;
  dataDirectory: string;
  onChooseDataDirectory(): void;
  settingsError: string | null;
  setSettingsError(error: string | null): void;
  settingsNotice: string | null;
  onOpenFontDialog(): void;
  onOpenTransfer(mode: "export" | "import"): void;
  /** The connection tree, to count hosts per environment. */
  vaultFolders: Folder[];
  security: SecurityState;
};

/**
 * Tools > Options, shown as a tab next to Home: edits a draft of the options; Apply commits it,
 * Revert drops it, "Reset to defaults" puts one page's settings back into the draft.
 */
export default function OptionsView({
  options,
  draft,
  setDraft,
  hidden,
  onApply,
  onRevert,
  dataDirectory,
  onChooseDataDirectory,
  settingsError,
  setSettingsError,
  settingsNotice,
  onOpenFontDialog,
  onOpenTransfer,
  vaultFolders,
  security,
}: OptionsViewProps) {
  const [category, setCategory] = useState<OptionsCategory>(lastCategory);
  const [editingSchemeId, setEditingSchemeId] = useState<string | null>(null);
  const isDirty = JSON.stringify(normalizeAppOptions(draft)) !== JSON.stringify(normalizeAppOptions(options));

  const resetKeys = resettableOptions[category];
  const isAtDefaults = resetKeys.every((key) => JSON.stringify(draft[key]) === JSON.stringify(defaultOptions[key]));
  const resetCategory = () => {
    setDraft((current) => {
      const next = { ...current } as Record<keyof AppOptions, unknown>;
      resetKeys.forEach((key) => {
        next[key] = structuredClone(defaultOptions[key]);
      });
      return next as AppOptions;
    });
    setEditingSchemeId(null);
  };

  const selectCategory = (value: OptionsCategory) => {
    lastCategory = value;
    setCategory(value);
  };

  const environmentHostCounts = (() => {
    const counts = new Map<string, number>();
    const walk = (folders: Folder[]) => folders.forEach((folder) => {
      (folder.hosts ?? []).forEach((host) => {
        if (host.environmentId) {
          counts.set(host.environmentId, (counts.get(host.environmentId) ?? 0) + 1);
        }
      });
      walk(folder.folders ?? []);
    });
    walk(vaultFolders);
    return counts;
  })();

  const updateEnvironmentDraft = (environmentId: string, changes: Partial<Environment>) => {
    setDraft((current) => ({
      ...current,
      environments: current.environments.map((environment) => environment.id === environmentId ? { ...environment, ...changes } : environment),
    }));
  };

  const chooseXServerExecutable = () => {
    setSettingsError(null);
    window.shellium?.settings.chooseXServerExecutable()
      .then((result) => {
        if (!result.canceled && result.filePath) {
          setDraft((current) => ({
            ...current,
            x11ServerMode: "manual",
            x11ExecutablePath: result.filePath ?? "",
          }));
        }
      })
      .catch((error: unknown) => {
        setSettingsError(error instanceof Error ? error.message : "X server executable could not be selected.");
      });
  };

  const chooseTerminalRecordingDirectory = () => {
    setSettingsError(null);
    window.shellium?.settings.chooseTerminalRecordingDirectory(draft.terminalRecordingDirectory)
      .then((result) => {
        if (!result.canceled && result.filePath) {
          setDraft((current) => ({ ...current, terminalRecordingDirectory: result.filePath ?? "" }));
        }
      })
      .catch((error: unknown) => {
        setSettingsError(error instanceof Error ? error.message : "Terminal recording folder could not be selected.");
      });
  };

  return (
    <section className="op-page" aria-label="Options" hidden={hidden}>
        <div className="op-body">
          <nav className="op-nav" aria-label="Options categories">
            <div className="op-title">
              <strong>Options</strong>
              <span>Changes take effect when you click Apply.</span>
            </div>
            {optionsCategories.map(({ value, label, icon: CategoryIcon }) => (
              <button
                key={value}
                type="button"
                className={`op-nav-item${category === value ? " active" : ""}`}
                aria-current={category === value ? "page" : undefined}
                onClick={() => selectCategory(value)}
              >
                <CategoryIcon size={15} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="op-main">
          <div className="op-content">
            <div className="op-content-inner">
            {optionsCategories.filter((item) => item.value === category).map((item) => (
              <div className="op-section-head" key={item.value}>
                <div>
                  <h3>{item.label}</h3>
                  <p>{item.description}</p>
                </div>
                {resetKeys.length > 0 && (
                  <button className="sh-btn sh-btn-secondary sh-btn-sm" type="button" onClick={resetCategory} disabled={isAtDefaults}
                    title={isAtDefaults ? "This page already has the default settings" : `Put the ${item.label} settings back to their defaults - nothing changes until you click Apply`}>
                    <RotateCcw size={14} />
                    Reset to defaults
                  </button>
                )}
              </div>
            ))}
    
            {category === "general" && (
              <>
                <div className="op-row">
                  <div className="op-row-text">
                    <strong>Local data folder</strong>
                    <span>Where connections, settings and known hosts are stored.</span>
                    <code className="op-path">{dataDirectory || "Loading data folder..."}</code>
                  </div>
                  <div className="op-row-control">
                    <button className="sh-btn sh-btn-secondary sh-btn-sm" type="button" onClick={onChooseDataDirectory}>
                      <FolderOpen size={14} />
                      Choose...
                    </button>
                  </div>
                </div>
                <div className="op-row">
                  <div className="op-row-text">
                    <strong>Terminal recording folder</strong>
                    <span>Session recordings are written here.</span>
                    <code className={`op-path${draft.terminalRecordingDirectory ? "" : " is-empty"}`}>
                      {draft.terminalRecordingDirectory || "Not configured"}
                    </code>
                  </div>
                  <div className="op-row-control">
                    <button className="sh-btn sh-btn-secondary sh-btn-sm" type="button" onClick={chooseTerminalRecordingDirectory}>
                      <FolderOpen size={14} />
                      Choose...
                    </button>
                  </div>
                </div>
                <div className="op-row">
                  <div className="op-row-text">
                    <strong>Export / import</strong>
                    <span>Move connections, script buttons and settings to another Shellium in an encrypted file, or hosts to / from CSV.</span>
                  </div>
                  <div className="op-row-control">
                    <button className="sh-btn sh-btn-secondary sh-btn-sm" type="button" onClick={() => onOpenTransfer("export")}>
                      <Download size={14} />
                      Export...
                    </button>
                    <button className="sh-btn sh-btn-secondary sh-btn-sm" type="button" onClick={() => onOpenTransfer("import")}>
                      <Upload size={14} />
                      Import...
                    </button>
                  </div>
                </div>
                {settingsError && <div className="op-alert op-alert-error">{settingsError}</div>}
                {settingsNotice && <div className="op-alert op-alert-ok">{settingsNotice}</div>}
                <label className="op-row">
                  <span className="op-row-text">
                    <strong>Open duplicate sessions</strong>
                    <span>Connect creates a new tab even when the host already has an open session.</span>
                  </span>
                  <span className="op-row-control">
                    <input
                      className="sh-switch"
                      type="checkbox"
                      role="switch"
                      checked={draft.openDuplicateSessions}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          openDuplicateSessions: event.target.checked,
                        }))
                      }
                    />
                  </span>
                </label>
                <label className="op-row">
                  <span className="op-row-text">
                    <strong>Resume transfers after reconnecting</strong>
                    <span>When a session reconnects, SFTP transfers paused by the lost connection continue on their own. Transfers you paused stay paused.</span>
                  </span>
                  <span className="op-row-control">
                    <input
                      className="sh-switch"
                      type="checkbox"
                      role="switch"
                      checked={draft.sftpAutoResume}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          sftpAutoResume: event.target.checked,
                        }))
                      }
                    />
                  </span>
                </label>
                <label className="op-row">
                  <span className="op-row-text">
                    <strong>Animate the password screen</strong>
                    <span>A short SSH handshake opens onto the Shellium title once when the password screen opens. Off, or when the system asks for reduced motion, the title is shown still.</span>
                  </span>
                  <span className="op-row-control">
                    <input
                      className="sh-switch"
                      type="checkbox"
                      role="switch"
                      checked={draft.startupAnimation}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          startupAnimation: event.target.checked,
                        }))
                      }
                    />
                  </span>
                </label>
              </>
            )}
    
            {category === "appearance" && (
              <>
                <label className="op-row">
                  <span className="op-row-text">
                    <strong>Theme</strong>
                    <span>Application color mode.</span>
                  </span>
                  <span className="op-row-control">
                    <select
                      className="op-select"
                      value={draft.theme}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          theme: normalizeTheme(event.target.value),
                        }))
                      }
                    >
                      <option value="dark">Dark</option>
                      <option value="light">Light</option>
                    </select>
                  </span>
                </label>
                <label className="op-row">
                  <span className="op-row-text">
                    <strong>UI scale</strong>
                    <span>Scale the full interface, including terminal text and dialogs.</span>
                  </span>
                  <span className="op-row-control">
                    <select
                      className="op-select"
                      value={draft.uiScale}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          uiScale: normalizeUiScale(Number(event.target.value)),
                        }))
                      }
                    >
                      {uiScaleOptions.map((scale) => (
                        <option key={scale} value={scale}>
                          {Math.round(scale * 100)}%
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
                <label className="op-row">
                  <span className="op-row-text">
                    <strong>UI font size</strong>
                    <span>Non-terminal text: tabs, dialogs, buttons, labels and menus.</span>
                  </span>
                  <span className="op-row-control">
                    <select
                      className="op-select"
                      value={draft.uiFontSize}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          uiFontSize: normalizeUiFontSize(Number(event.target.value)),
                        }))
                      }
                    >
                      {uiFontSizeOptions.map((fontSize) => (
                        <option key={fontSize} value={fontSize}>
                          {fontSize}px
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
              </>
            )}
    
            {category === "terminal" && (
              <>
                <div className="op-row op-row-stack">
                  <div className="op-row-text">
                    <strong>Color scheme</strong>
                    <span>
                      Default for every session. An environment (Options &gt; Environments) or a host (connect dialog &gt;
                      Terminal colors) can use its own, e.g. a red-tinted scheme for production.
                    </span>
                  </div>
                  <TerminalSchemePicker
                    selectedId={draft.terminalSchemeId}
                    custom={draft.customTerminalSchemes}
                    editingId={editingSchemeId}
                    onSelect={(terminalSchemeId) => setDraft((current) => ({ ...current, terminalSchemeId }))}
                    onCustomChange={(customTerminalSchemes) => setDraft((current) => ({ ...current, customTerminalSchemes }))}
                    onEdit={setEditingSchemeId}
                  />
                </div>
                <div className="op-row">
                  <div className="op-row-text">
                    <strong>Terminal font</strong>
                    <span>Font family, style and size.</span>
                  </div>
                  <div className="op-row-control">
                    <button className="sh-btn sh-btn-secondary sh-btn-sm" type="button" onClick={onOpenFontDialog}>
                      <Type size={14} />
                      Terminal Font...
                    </button>
                  </div>
                </div>
                <label className="op-row">
                  <span className="op-row-text">
                    <strong>Scrollback buffer</strong>
                    <span>Output kept for scrolling up. Higher values use more memory.</span>
                  </span>
                  <span className="op-row-control">
                    <select
                      className="op-select"
                      value={draft.terminalScrollback}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          terminalScrollback: normalizeTerminalScrollback(Number(event.target.value)),
                        }))
                      }
                    >
                      {terminalScrollbackOptions.map((scrollback) => (
                        <option key={scrollback} value={scrollback}>
                          {scrollback.toLocaleString()} lines
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
                <label className="op-row">
                  <span className="op-row-text">
                    <strong>Selection</strong>
                    <span>How selected text looks: inverted colors, or a colored highlight.</span>
                  </span>
                  <span className="op-row-control">
                    <select
                      className="op-select"
                      value={draft.terminalSelectionStyle}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          terminalSelectionStyle: event.target.value === "highlight" ? "highlight" : "inverse",
                        }))
                      }
                    >
                      <option value="inverse">Inverse colors</option>
                      <option value="highlight">Highlight</option>
                    </select>
                  </span>
                </label>
                <label className="op-row">
                  <span className="op-row-text">
                    <strong>Tab position</strong>
                    <span>Top shows a tab strip; left or right shows a resizable session list.</span>
                  </span>
                  <span className="op-row-control">
                    <select
                      className="op-select"
                      value={draft.terminalTabPosition}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          terminalTabPosition: normalizeTerminalTabPosition(event.target.value),
                        }))
                      }
                    >
                      {terminalTabPositions.map((position) => (
                        <option key={position.value} value={position.value}>
                          {position.label}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
                <div className="op-row op-row-stack">
                  <div className="op-row-text">
                    <strong>Anti-idle (default)</strong>
                    <span>For every host without its own settings (connect dialog &gt; Anti-idle).</span>
                  </div>
                  <AntiIdleFields
                    value={draft.antiIdle}
                    onChange={(patch) => setDraft((current) => ({ ...current, antiIdle: { ...current.antiIdle, ...patch } }))}
                  />
                </div>
                <label className="op-row">
                  <span className="op-row-text">
                    <strong>Close after unanswered NO-OPs</strong>
                    <span>
                      A connection is given up after this many keep-alives without an answer
                      {draft.antiIdle.noopEnabled && Number.isFinite(draft.antiIdle.noopSeconds)
                        ? ` (about ${Math.round((draft.antiIdle.noopSeconds * draft.keepaliveCountMax) / 60 * 10) / 10} min with ${draft.antiIdle.noopSeconds} s NO-OP)`
                        : ""}
                      . Applies to all hosts.
                    </span>
                  </span>
                  <span className="op-row-control">
                    <select
                      className="op-select"
                      value={draft.keepaliveCountMax}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, keepaliveCountMax: normalizeKeepaliveCountMax(Number(event.target.value)) }))
                      }
                    >
                      {[1, 2, 3, 5, 10, 20, 30].map((count) => (
                        <option key={count} value={count}>{count}</option>
                      ))}
                    </select>
                  </span>
                </label>
              </>
            )}
    
            {category === "environments" && (
              <>
                <div className="op-alert op-alert-info">
                  Assign an environment to a host in the connect dialog (Connection › Environment). Its badge shows on the
                  host and on session tabs; with the warning banner on, sessions get a colored banner above the terminal.
                </div>
                {draft.environments.map((environment) => {
                  const hostCount = environmentHostCounts.get(environment.id) ?? 0;
    
                  return (
                    <div className="op-env" key={environment.id}>
                      <div className="op-env-main">
                        <span className="sh-env op-env-preview" style={environmentStyle(environment)}>
                          {environment.badge || deriveEnvironmentBadge(environment.name) || "NEW"}
                        </span>
                        <label className="op-env-field op-env-name">
                          <span>Name</span>
                          <input
                            className="op-input"
                            value={environment.name}
                            placeholder="e.g. Production"
                            spellCheck={false}
                            autoFocus={!environment.name}
                            onChange={(event) => {
                              const name = event.target.value;
                              // Keep an auto-derived badge in step with the name until the user edits the badge.
                              const followsName = !environment.badge || environment.badge === deriveEnvironmentBadge(environment.name);
                              updateEnvironmentDraft(environment.id, followsName ? { name, badge: deriveEnvironmentBadge(name) } : { name });
                            }}
                          />
                        </label>
                        <label className="op-env-field op-env-badge">
                          <span>Badge</span>
                          <input
                            className="op-input"
                            value={environment.badge}
                            maxLength={maxEnvironmentBadgeLength}
                            placeholder="PROD"
                            onChange={(event) => updateEnvironmentDraft(environment.id, { badge: event.target.value.toUpperCase() })}
                          />
                        </label>
                        <button
                          type="button"
                          className="op-env-delete"
                          title={hostCount > 0 ? `Delete - ${hostCount} host${hostCount === 1 ? "" : "s"} will have no environment` : "Delete environment"}
                          aria-label={`Delete ${environment.name || "environment"}`}
                          onClick={() => setDraft((current) => ({
                            ...current,
                            environments: current.environments.filter((item) => item.id !== environment.id),
                          }))}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                      <div className="op-env-meta">
                        <div className="op-env-colors" role="radiogroup" aria-label="Color">
                          {environmentColors.map((color) => (
                            <button
                              key={color}
                              type="button"
                              role="radio"
                              aria-checked={environment.color === color}
                              aria-label={color}
                              title={color}
                              className={`op-env-color${environment.color === color ? " selected" : ""}`}
                              style={environmentStyle({ color })}
                              onClick={() => updateEnvironmentDraft(environment.id, { color })}
                            />
                          ))}
                        </div>
                        <label className="op-env-warn">
                          <input
                            className="sh-switch"
                            type="checkbox"
                            role="switch"
                            checked={environment.warn}
                            onChange={(event) => updateEnvironmentDraft(environment.id, { warn: event.target.checked })}
                          />
                          <span>Warning banner</span>
                        </label>
                        <label className="op-env-scheme">
                          <span>Terminal colors</span>
                          <SchemeSelect
                            className="op-select"
                            value={environment.terminalSchemeId ?? ""}
                            custom={draft.customTerminalSchemes}
                            inheritLabel={`Default · ${schemeName(draft.terminalSchemeId, draft.customTerminalSchemes)}`}
                            onChange={(terminalSchemeId) => updateEnvironmentDraft(environment.id, { terminalSchemeId: terminalSchemeId || undefined })}
                          />
                        </label>
                        <span className="op-env-usage">{hostCount === 1 ? "1 host" : `${hostCount} hosts`}</span>
                      </div>
                    </div>
                  );
                })}
                {draft.environments.length === 0 && (
                  <div className="op-alert op-alert-info">No environments. Hosts show no badge until you add one.</div>
                )}
                <div>
                  <button
                    type="button"
                    className="sh-btn sh-btn-secondary sh-btn-sm"
                    onClick={() => setDraft((current) => {
                      const usedColors = new Set(current.environments.map((item) => item.color));
                      const color = environmentColors.find((item) => !usedColors.has(item)) ?? "grey";
    
                      return {
                        ...current,
                        environments: [...current.environments, { id: createEnvironmentId(), name: "", badge: "", color, warn: false }],
                      };
                    })}
                  >
                    <Plus size={14} />
                    Add environment
                  </button>
                </div>
              </>
            )}
    
            {category === "x11" && (
              <>
                <label className="op-row">
                  <span className="op-row-text">
                    <strong>Local X server</strong>
                    <span>Device-level setting used by every session with X11 forwarding enabled.</span>
                  </span>
                  <span className="op-row-control">
                    <select
                      className="op-select"
                      value={draft.x11ServerMode}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        x11ServerMode: event.target.value === "manual" ? "manual" : "auto",
                      }))}
                    >
                      <option value="auto">Auto detect (recommended)</option>
                      <option value="manual">Manual executable</option>
                    </select>
                  </span>
                </label>
                {draft.x11ServerMode === "manual" && (
                  <div className="op-row">
                    <div className="op-row-text">
                      <strong>X server executable</strong>
                      <code className={`op-path${draft.x11ExecutablePath ? "" : " is-empty"}`}>
                        {draft.x11ExecutablePath || "No executable selected"}
                      </code>
                    </div>
                    <div className="op-row-control">
                      {draft.x11ExecutablePath && (
                        <button className="sh-btn sh-btn-ghost sh-btn-sm" type="button" onClick={() => setDraft((current) => ({ ...current, x11ExecutablePath: "" }))}>
                          Clear
                        </button>
                      )}
                      <button className="sh-btn sh-btn-secondary sh-btn-sm" type="button" onClick={chooseXServerExecutable}>
                        <FolderOpen size={14} />
                        Browse...
                      </button>
                    </div>
                  </div>
                )}
                <div className="op-alert op-alert-info">
                  Auto detect checks running displays first, then standard VcXsrv/Xming locations on Windows and XQuartz on macOS.
                </div>
                {settingsError && <div className="op-alert op-alert-error">{settingsError}</div>}
              </>
            )}
    
            {category === "scriptButtons" && (
              <label className="op-row">
                <span className="op-row-text">
                  <strong>Script button bar</strong>
                  <span>Where the script button bar is docked on the main screen.</span>
                </span>
                <span className="op-row-control">
                  <select
                    className="op-select"
                    value={draft.scriptButtonBarPosition}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        scriptButtonBarPosition: normalizeScriptButtonBarPosition(event.target.value),
                      }))
                    }
                  >
                    {scriptButtonBarPositions.map((position) => (
                      <option key={position.value} value={position.value}>
                        {position.label}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
            )}
    
            {category === "security" && (
              <>
                <div className="op-row">
                  <div className="op-row-text">
                    <strong>Data protection</strong>
                    <span>Saved hosts and script commands are encrypted and require the master password before Shellium data loads.</span>
                  </div>
                  <div className="op-row-control">
                    {security.status?.enabled ? (
                      <>
                        <span className={`op-badge ${security.status.unlocked ? "op-badge-ok" : "op-badge-warn"}`}>
                          {security.status.unlocked ? "Unlocked" : "Locked"}
                        </span>
                        <button className="sh-btn sh-btn-secondary sh-btn-sm" type="button" onClick={security.lock} disabled={!security.status.unlocked || security.isBusy}>
                          <Lock size={14} />
                          Lock Now
                        </button>
                      </>
                    ) : (
                      <span className="op-badge op-badge-warn">Not enabled</span>
                    )}
                  </div>
                </div>
                {!security.status?.enabled && (
                  <form
                    className="op-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      security.setup();
                    }}
                  >
                    <label className="op-field">
                      <span>Master password</span>
                      <input
                        className="op-input"
                        type="password"
                        value={security.password}
                        autoComplete="new-password"
                        onChange={(event) => security.setPassword(event.target.value)}
                      />
                    </label>
                    <label className="op-field">
                      <span>Confirm master password</span>
                      <input
                        className="op-input"
                        type="password"
                        value={security.confirmPassword}
                        autoComplete="new-password"
                        onChange={(event) => security.setConfirmPassword(event.target.value)}
                      />
                    </label>
                    <div className="op-form-actions">
                      <button className="sh-btn sh-btn-primary sh-btn-sm" type="submit" disabled={security.isBusy}>
                        <ShieldCheck size={14} />
                        Enable Protection
                      </button>
                    </div>
                  </form>
                )}
                {security.error && <div className="op-alert op-alert-error">{security.error}</div>}
                {security.notice && <div className="op-alert op-alert-ok">{security.notice}</div>}
                {security.status?.unlocked && <KnownHostsPanel />}
              </>
            )}
            </div>
          </div>
          <footer className="op-footer">
            <span className={"op-footer-status" + (isDirty ? " is-dirty" : "")}>{isDirty ? "Unsaved changes" : "All changes applied"}</span>
            <button className="sh-btn sh-btn-secondary" type="button" onClick={onRevert} disabled={!isDirty}
              title="Drop the unsaved changes">
              Revert
            </button>
            <button className="sh-btn sh-btn-primary" type="button" onClick={onApply} disabled={!isDirty}>
              Apply
            </button>
          </footer>
        </div>
      </div>
    </section>
  );
}
