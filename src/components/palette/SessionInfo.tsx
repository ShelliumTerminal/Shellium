import { useEffect, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";

import { ChevronRight, Folder as FolderIcon, FolderPlus, Plus, Server, SquareTerminal, Star, Trash2, X } from "lucide-react";

import { useEnvironments } from "../common/environments";
import { AntiIdleFields, useAntiIdleDefaults } from "../common/AntiIdleFields";
import { defaultAntiIdle, normalizeAntiIdle } from "../common/antiIdleModel";
import type { AntiIdleOptions } from "../common/antiIdleModel";
import { SchemePreview, SchemeSelect, useTerminalSchemes } from "../common/TerminalSchemes";
import { resolveTerminalScheme } from "../common/terminalSchemeModel";
import type { Folder, Host } from "./types";

type AuthMode = "password" | "ask";

type HostDraft = {
  name: string;
  hostname: string;
  port: string;
  username: string;
  authMode: AuthMode;
  password: string;
  description: string;
  tags: string[];
  x11Enabled: boolean;
  x11AutoStart: boolean;
  x11ServerMode: "auto" | "custom";
  x11ServerCommand: string;
  x11DisplayHost: string;
  x11DisplayNumber: string;
  x11Screen: string;
  legacyAlgorithms: boolean;
  environmentId: string;
  favorite: boolean;
  /** Off = the host follows the anti-idle default in Options. */
  antiIdleCustom: boolean;
  antiIdle: AntiIdleOptions;
  /** "" = follow the environment / Options default. */
  terminalSchemeId: string;
};

type SessionInfoProps = {
  mode: SessionInfoMode;
  onModeChange: (mode: SessionInfoMode) => void;
  selectedFolder: Folder | null;
  selectedHost: Host | null;
  selectedPath: string;
  targetFolderId: string | null;
  targetFolderPath: string;
  isSelectedHostLive: boolean;
  footerSlot: HTMLElement | null;
  onClose: () => void;
  onConnect: (host: Host) => void;
  onCreateFolder: (parentFolderId: string | null, name: string) => void;
  onCreateHost: (parentFolderId: string, host: Omit<Host, "id">) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onUpdateHost: (host: Host) => void;
  onDeleteFolder: (folderId: string) => void;
  onDeleteHost: (hostId: string) => void;
};

export type SessionInfoMode = "create-folder" | "create-host" | null;

const emptyHostDraft: HostDraft = {
  name: "",
  hostname: "",
  port: "22",
  username: "",
  authMode: "password",
  password: "",
  description: "",
  tags: [],
  x11Enabled: false,
  x11AutoStart: false,
  x11ServerMode: "auto",
  x11ServerCommand: "",
  x11DisplayHost: "127.0.0.1",
  x11DisplayNumber: "0",
  x11Screen: "0",
  legacyAlgorithms: false,
  environmentId: "",
  favorite: false,
  antiIdleCustom: false,
  antiIdle: defaultAntiIdle,
  terminalSchemeId: "",
};

const hostFormId = "pl-host-form";
const folderFormId = "pl-folder-form";

function hostToDraft(host: Host): HostDraft {
  return {
    name: host.name,
    hostname: host.hostname,
    port: String(host.port),
    username: host.username,
    authMode: host.password ? "password" : "ask",
    password: host.password ?? "",
    description: host.description ?? "",
    tags: host.tags ?? [],
    x11Enabled: Boolean(host.x11?.enabled),
    x11AutoStart: Boolean(host.x11?.autoStart),
    x11ServerMode: host.x11?.serverMode === "custom" || host.x11?.serverCommand ? "custom" : "auto",
    x11ServerCommand: host.x11?.serverCommand ?? "",
    x11DisplayHost: host.x11?.displayHost ?? "127.0.0.1",
    x11DisplayNumber: String(host.x11?.displayNumber ?? 0),
    x11Screen: String(host.x11?.screen ?? 0),
    legacyAlgorithms: Boolean(host.legacyAlgorithms),
    environmentId: host.environmentId ?? "",
    favorite: Boolean(host.favorite),
    antiIdleCustom: Boolean(host.antiIdle),
    antiIdle: host.antiIdle ?? defaultAntiIdle,
    terminalSchemeId: host.terminalSchemeId ?? "",
  };
}

function draftToHostFields(draft: HostDraft): Omit<Host, "id"> {
  return {
    name: draft.name.trim(),
    hostname: draft.hostname.trim(),
    port: Number(draft.port) || 22,
    username: draft.username.trim(),
    password: draft.authMode === "password" && draft.password ? draft.password : undefined,
    description: draft.description.trim() || undefined,
    tags: draft.tags,
    x11: draft.x11Enabled
      ? {
          enabled: true,
          autoStart: draft.x11AutoStart,
          serverMode: draft.x11ServerMode,
          serverCommand: draft.x11ServerMode === "custom" ? draft.x11ServerCommand.trim() || undefined : undefined,
          displayHost: draft.x11DisplayHost.trim() || "127.0.0.1",
          displayNumber: Number(draft.x11DisplayNumber) || 0,
          screen: Number(draft.x11Screen) || 0,
        }
      : undefined,
    legacyAlgorithms: draft.legacyAlgorithms || undefined,
    environmentId: draft.environmentId || undefined,
    favorite: draft.favorite || undefined,
    antiIdle: draft.antiIdleCustom ? normalizeAntiIdle(draft.antiIdle) : undefined,
    terminalSchemeId: draft.terminalSchemeId || undefined,
  };
}

/** For "unsaved changes": anti-idle values hidden behind "use the default" are not a change. */
function comparableDraft(draft: HostDraft): HostDraft {
  return draft.antiIdleCustom ? draft : { ...draft, antiIdle: defaultAntiIdle };
}

function isDraftValid(draft: HostDraft) {
  return Boolean(draft.name.trim() && draft.hostname.trim());
}

function countHosts(folder: Folder): number {
  return (folder.hosts?.length ?? 0) + (folder.folders ?? []).reduce((total, child) => total + countHosts(child), 0);
}


export default function SessionInfo({
  mode,
  onModeChange,
  selectedFolder,
  selectedHost,
  selectedPath,
  targetFolderId,
  targetFolderPath,
  isSelectedHostLive,
  footerSlot,
  onClose,
  onConnect,
  onCreateFolder,
  onCreateHost,
  onRenameFolder,
  onUpdateHost,
  onDeleteFolder,
  onDeleteHost,
}: SessionInfoProps) {
  const [newFolderName, setNewFolderName] = useState("New Folder");
  const [folderName, setFolderName] = useState("");
  const [newHostDraft, setNewHostDraft] = useState<HostDraft>({ ...emptyHostDraft });
  const [editHostDraft, setEditHostDraft] = useState<HostDraft>({ ...emptyHostDraft });

  useEffect(() => {
    setFolderName(selectedFolder?.name ?? "");
  }, [selectedFolder?.id, selectedFolder?.name]);

  // Reset the form only when another host is selected: the favorite star saves on its own,
  // and that must not throw away unsaved edits in the form.
  useEffect(() => {
    if (selectedHost) {
      setEditHostDraft(hostToDraft(selectedHost));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHost?.id]);

  const updateNewHostDraft = (changes: Partial<HostDraft>) => {
    setNewHostDraft((current) => ({ ...current, ...changes }));
  };

  const updateEditHostDraft = (changes: Partial<HostDraft>) => {
    setEditHostDraft((current) => ({ ...current, ...changes }));
  };

  const handleCreateFolder = (event?: FormEvent) => {
    event?.preventDefault();
    const name = newFolderName.trim();
    if (!name) {
      return;
    }

    onCreateFolder(selectedFolder?.id ?? null, name);
    setNewFolderName("New Folder");
    onModeChange(null);
  };

  const handleCreateHost = (event?: FormEvent) => {
    event?.preventDefault();
    if (!targetFolderId || !isDraftValid(newHostDraft)) {
      return;
    }

    onCreateHost(targetFolderId, draftToHostFields(newHostDraft));
    setNewHostDraft({ ...emptyHostDraft });
    onModeChange(null);
  };

  const handleRenameFolder = (event?: FormEvent) => {
    event?.preventDefault();
    if (selectedFolder && folderName.trim()) {
      onRenameFolder(selectedFolder.id, folderName.trim());
    }
  };

  const buildEditedHost = () => {
    if (!selectedHost || !isDraftValid(editHostDraft)) {
      return null;
    }

    return { ...draftToHostFields(editHostDraft), id: selectedHost.id };
  };

  const handleSaveHost = (event?: FormEvent) => {
    event?.preventDefault();
    const host = buildEditedHost();

    if (host) {
      onUpdateHost(host);
    }
  };

  const handleConnectHost = () => {
    const host = buildEditedHost();

    if (!host) {
      return;
    }

    onUpdateHost(host);
    onConnect(host);
  };

  const isHostDirty = selectedHost
    ? JSON.stringify(comparableDraft(editHostDraft)) !== JSON.stringify(comparableDraft(hostToDraft(selectedHost)))
    : false;

  let body: ReactNode;
  let footer: ReactNode;

  if (mode === "create-folder") {
    body = (
      <form id={folderFormId} className="pl-editor" onSubmit={handleCreateFolder}>
        <EditorTitle icon={<FolderPlus size={20} />} title="New folder" subtitle={selectedFolder ? `Inside ${selectedPath}` : "Top level"} />
        <section className="pl-section">
          <div className="pl-section-label">Folder</div>
          <label className="pl-field">
            <span>Name</span>
            <input autoFocus value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} />
          </label>
        </section>
      </form>
    );
    footer = (
      <>
        <button type="button" className="sh-btn sh-btn-ghost" onClick={() => onModeChange(null)}>Cancel</button>
        <button type="submit" form={folderFormId} className="sh-btn sh-btn-primary" disabled={!newFolderName.trim()}>Create folder</button>
      </>
    );
  } else if (mode === "create-host") {
    body = (
      <form id={hostFormId} className="pl-editor" onSubmit={handleCreateHost}>
        <EditorTitle
          icon={<Plus size={20} />}
          title={newHostDraft.name.trim() || "New connection"}
          subtitle={targetFolderPath ? `In ${targetFolderPath}` : "Create a folder first"}
        />
        <HostFields draft={newHostDraft} onChange={updateNewHostDraft} autoFocus />
      </form>
    );
    footer = (
      <>
        <button type="button" className="sh-btn sh-btn-ghost" onClick={() => onModeChange(null)}>Cancel</button>
        <button type="submit" form={hostFormId} className="sh-btn sh-btn-primary" disabled={!targetFolderId || !isDraftValid(newHostDraft)}>
          Create connection
        </button>
      </>
    );
  } else if (selectedHost) {
    body = (
      <form id={hostFormId} className="pl-editor" onSubmit={handleSaveHost}>
        <EditorTitle
          icon={<Server size={20} />}
          title={editHostDraft.name.trim() || selectedHost.name}
          subtitle={
            <>
              {selectedPath}
              {isSelectedHostLive && <span className="pl-live-note"> · connected</span>}
            </>
          }
          action={
            <>
              <button
                type="button"
                className={`pl-icon-btn pl-icon-btn-star${editHostDraft.favorite ? " active" : ""}`}
                title={editHostDraft.favorite ? "Remove from favorites" : "Add to favorites"}
                aria-label={editHostDraft.favorite ? "Remove from favorites" : "Add to favorites"}
                aria-pressed={editHostDraft.favorite}
                onClick={() => {
                  const favorite = !editHostDraft.favorite;
                  updateEditHostDraft({ favorite });
                  onUpdateHost({ ...selectedHost, favorite: favorite || undefined });
                }}
              >
                <Star size={15} />
              </button>
              <button type="button" className="pl-icon-btn pl-icon-btn-danger" title="Delete connection" aria-label="Delete connection" onClick={() => onDeleteHost(selectedHost.id)}>
                <Trash2 size={15} />
              </button>
            </>
          }
        />
        <HostFields draft={editHostDraft} onChange={updateEditHostDraft} />
      </form>
    );
    footer = (
      <>
        <button type="button" className="sh-btn sh-btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" form={hostFormId} className="sh-btn sh-btn-secondary" disabled={!isHostDirty || !isDraftValid(editHostDraft)}>Save</button>
        <button type="button" className="sh-btn sh-btn-primary" disabled={!isDraftValid(editHostDraft)} onClick={handleConnectHost}>
          <SquareTerminal size={15} />
          Connect
        </button>
      </>
    );
  } else if (selectedFolder) {
    const hostCount = countHosts(selectedFolder);

    body = (
      <form id={folderFormId} className="pl-editor" onSubmit={handleRenameFolder}>
        <EditorTitle
          icon={<FolderIcon size={20} />}
          title={selectedFolder.name}
          subtitle={`${selectedPath} · ${hostCount === 1 ? "1 host" : `${hostCount} hosts`}`}
          action={
            <button type="button" className="pl-icon-btn pl-icon-btn-danger" title="Delete folder" aria-label="Delete folder" onClick={() => onDeleteFolder(selectedFolder.id)}>
              <Trash2 size={15} />
            </button>
          }
        />
        <section className="pl-section">
          <div className="pl-section-label">Folder</div>
          <label className="pl-field">
            <span>Name</span>
            <input value={folderName} onChange={(event) => setFolderName(event.target.value)} />
          </label>
        </section>
      </form>
    );
    footer = (
      <>
        <button type="button" className="sh-btn sh-btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" form={folderFormId} className="sh-btn sh-btn-primary" disabled={!folderName.trim() || folderName.trim() === selectedFolder.name}>
          Rename
        </button>
      </>
    );
  } else {
    body = (
      <div className="pl-empty">
        <span className="pl-empty-icon" aria-hidden="true">
          <Server size={22} />
        </span>
        <h2>No host selected</h2>
        <p>Pick a host on the left to edit it, or double-click to connect.</p>
        <div className="pl-empty-actions">
          <button type="button" className="sh-btn sh-btn-secondary sh-btn-sm" onClick={() => onModeChange("create-folder")}>
            <FolderPlus size={14} />
            New folder
          </button>
          <button type="button" className="sh-btn sh-btn-secondary sh-btn-sm" disabled={!targetFolderId} onClick={() => onModeChange("create-host")}>
            <Plus size={14} />
            New connection
          </button>
        </div>
      </div>
    );
    footer = <button type="button" className="sh-btn sh-btn-ghost" onClick={onClose}>Close</button>;
  }

  return (
    <>
      {body}
      {footerSlot && createPortal(footer, footerSlot)}
    </>
  );
}

type EditorTitleProps = {
  icon: ReactNode;
  title: string;
  subtitle: ReactNode;
  action?: ReactNode;
};

function EditorTitle({ icon, title, subtitle, action }: EditorTitleProps) {
  return (
    <div className="pl-editor-title">
      <span className="pl-avatar" aria-hidden="true">{icon}</span>
      <div className="pl-editor-heading">
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

/**
 * A host option group below Description: a header that folds it open, closed whenever the dialog
 * is opened (owner's request). The summary on the right tells the current setting while closed.
 */
function FoldSection({ label, summary, children }: { label: string; summary: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <section className={"pl-section pl-fold" + (open ? " open" : "")}>
      <button type="button" className="pl-fold-head" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <ChevronRight className="pl-fold-chevron" aria-hidden="true" size={14} />
        <span className="pl-fold-label">{label}</span>
        <span className="pl-fold-summary">{summary}</span>
      </button>
      {open && <div className="pl-fold-body">{children}</div>}
    </section>
  );
}

type HostFieldsProps = {
  draft: HostDraft;
  autoFocus?: boolean;
  onChange: (changes: Partial<HostDraft>) => void;
};

function HostFields({ draft, autoFocus, onChange }: HostFieldsProps) {
  const environments = useEnvironments();

  return (
    <>
      <section className="pl-section">
        <div className="pl-section-label">Connection</div>
        <div className="pl-grid">
          <label className="pl-field">
            <span>Display name</span>
            <input autoFocus={autoFocus} value={draft.name} onChange={(event) => onChange({ name: event.target.value })} />
          </label>
          <label className="pl-field">
            <span>Environment</span>
            <select value={draft.environmentId} onChange={(event) => onChange({ environmentId: event.target.value })}>
              <option value="">None</option>
              {environments.map((environment) => (
                <option key={environment.id} value={environment.id}>
                  {environment.name} ({environment.badge})
                </option>
              ))}
            </select>
          </label>
          <label className="pl-field">
            <span>Hostname / IP</span>
            <input className="pl-mono" value={draft.hostname} spellCheck={false} onChange={(event) => onChange({ hostname: event.target.value })} />
          </label>
          <label className="pl-field">
            <span>Port</span>
            <input className="pl-mono" value={draft.port} inputMode="numeric" onChange={(event) => onChange({ port: event.target.value })} />
          </label>
          <label className="pl-field">
            <span>Username</span>
            <input className="pl-mono" value={draft.username} spellCheck={false} onChange={(event) => onChange({ username: event.target.value })} />
          </label>
          <label className="pl-field">
            <span>Authentication</span>
            <select value={draft.authMode} onChange={(event) => onChange({ authMode: event.target.value === "ask" ? "ask" : "password" })}>
              <option value="password">Password (saved in vault)</option>
              <option value="ask">Ask every time</option>
            </select>
          </label>
          {draft.authMode === "password" && (
            <label className="pl-field pl-span-2">
              <span>Password</span>
              <input
                type="password"
                value={draft.password}
                autoComplete="new-password"
                placeholder="Leave empty to be asked on connect"
                onChange={(event) => onChange({ password: event.target.value })}
              />
            </label>
          )}
          <div className="pl-field pl-span-2">
            <span>Tags</span>
            <TagInput tags={draft.tags} onChange={(tags) => onChange({ tags })} />
          </div>
          <label className="pl-field pl-span-2">
            <span>Description</span>
            <textarea value={draft.description} rows={2} onChange={(event) => onChange({ description: event.target.value })} />
          </label>
        </div>
      </section>

      <FoldSection label="X11 forwarding" summary={draft.x11Enabled ? "On" : "Off"}>
        <label className="pl-toggle-row">
          <span>
            <strong>Enable X11 forwarding</strong>
            <span>Forward graphical apps (e.g. runInstaller, dbca) to the local X server.</span>
          </span>
          <input className="sh-switch" type="checkbox" role="switch" checked={draft.x11Enabled} onChange={(event) => onChange({ x11Enabled: event.target.checked })} />
        </label>
        {draft.x11Enabled && (
          <div className="pl-subfields">
            <label className="pl-toggle-row">
              <span>
                <strong>Start local X server before connect</strong>
                <span>Uses the local X server configured in Options &gt; X11.</span>
              </span>
              <input className="sh-switch" type="checkbox" role="switch" checked={draft.x11AutoStart} onChange={(event) => onChange({ x11AutoStart: event.target.checked })} />
            </label>
            <div className="pl-grid pl-grid-3">
              <label className="pl-field">
                <span>Display host</span>
                <input className="pl-mono" value={draft.x11DisplayHost} onChange={(event) => onChange({ x11DisplayHost: event.target.value })} />
              </label>
              <label className="pl-field">
                <span>Display</span>
                <input className="pl-mono" value={draft.x11DisplayNumber} inputMode="numeric" onChange={(event) => onChange({ x11DisplayNumber: event.target.value })} />
              </label>
              <label className="pl-field">
                <span>Screen</span>
                <input className="pl-mono" value={draft.x11Screen} inputMode="numeric" onChange={(event) => onChange({ x11Screen: event.target.value })} />
              </label>
            </div>
          </div>
        )}
      </FoldSection>

      <TerminalColorsSection draft={draft} onChange={onChange} />

      <AntiIdleSection draft={draft} onChange={onChange} />

      <FoldSection label="SSH security" summary={draft.legacyAlgorithms ? "Legacy algorithms allowed" : "Modern algorithms"}>
        <label className="pl-toggle-row">
          <span>
            <strong>Allow legacy SSH algorithms</strong>
            <span>
              SHA-1 key exchange, ssh-rsa / ssh-dss host keys and CBC ciphers. Only for old servers that support
              nothing newer - Shellium asks when a server needs them.
            </span>
          </span>
          <input className="sh-switch" type="checkbox" role="switch" checked={draft.legacyAlgorithms} onChange={(event) => onChange({ legacyAlgorithms: event.target.checked })} />
        </label>
      </FoldSection>
    </>
  );
}

function TerminalColorsSection({ draft, onChange }: { draft: HostDraft; onChange: (patch: Partial<HostDraft>) => void }) {
  const { custom, defaultId } = useTerminalSchemes();
  const environments = useEnvironments();
  const environment = environments.find((item) => item.id === draft.environmentId);
  const inherited = resolveTerminalScheme(undefined, environment?.terminalSchemeId, defaultId, custom);
  const effective = resolveTerminalScheme(draft.terminalSchemeId || undefined, environment?.terminalSchemeId, defaultId, custom);
  const source = environment?.terminalSchemeId && inherited.id === environment.terminalSchemeId ? `${environment.name} environment` : "Options default";

  return (
    <FoldSection label="Terminal colors" summary={draft.terminalSchemeId ? effective.name : `${effective.name} (${source})`}>
      <div className="pl-scheme">
        <label className="pl-field">
          <span>Color scheme</span>
          <SchemeSelect
            value={draft.terminalSchemeId}
            onChange={(terminalSchemeId) => onChange({ terminalSchemeId })}
            inheritLabel={`Same as ${source} · ${inherited.name}`}
          />
          <small className="pl-hint">Takes effect for new sessions of this host. Production hosts can get a scheme of their own in Options › Environments.</small>
        </label>
        <SchemePreview scheme={effective} />
      </div>
    </FoldSection>
  );
}

function AntiIdleSection({ draft, onChange }: { draft: HostDraft; onChange: (patch: Partial<HostDraft>) => void }) {
  const defaults = useAntiIdleDefaults();

  return (
    <FoldSection label="Anti-idle" summary={draft.antiIdleCustom ? "Own settings" : "Default from Options"}>
      <label className="pl-toggle-row">
        <span>
          <strong>Use the default from Options</strong>
          <span>Options &gt; Terminal &gt; Anti-idle. Turn off to give this host its own keep-alive settings.</span>
        </span>
        <input
          className="sh-switch"
          type="checkbox"
          role="switch"
          checked={!draft.antiIdleCustom}
          // Own settings start from the current default.
          onChange={(event) => onChange(event.target.checked ? { antiIdleCustom: false } : { antiIdleCustom: true, antiIdle: defaults.antiIdle })}
        />
      </label>
      <AntiIdleFields
        value={draft.antiIdleCustom ? draft.antiIdle : defaults.antiIdle}
        disabled={!draft.antiIdleCustom}
        onChange={(patch) => onChange({ antiIdle: { ...draft.antiIdle, ...patch } })}
      />
    </FoldSection>
  );
}

type TagInputProps = {
  tags: string[];
  onChange: (tags: string[]) => void;
};

function TagInput({ tags, onChange }: TagInputProps) {
  const [text, setText] = useState("");

  const commit = () => {
    const additions = text.split(",").map((tag) => tag.trim()).filter((tag) => tag && !tags.includes(tag));

    if (additions.length > 0) {
      onChange([...tags, ...additions]);
    }

    setText("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit();
    } else if (event.key === "Backspace" && !text && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div className="pl-tag-input">
      {tags.map((tag) => (
        <span className="pl-tag" key={tag}>
          {tag}
          <button type="button" aria-label={`Remove tag ${tag}`} onClick={() => onChange(tags.filter((item) => item !== tag))}>
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        value={text}
        placeholder={tags.length ? "Add tag" : "Add tag (Enter or comma)"}
        aria-label="Add tag"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
      />
    </div>
  );
}
