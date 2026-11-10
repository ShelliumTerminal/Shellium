import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, Check, Download, FileLock2, FileSpreadsheet, FolderOpen, KeyRound, Undo2, Upload, X } from "lucide-react";
import type {
  TransferConflictDecision,
  TransferExportResult,
  TransferExportSources,
  TransferFieldMapping,
  TransferFolder,
  TransferImportPreview,
  TransferImportResult,
  TransferImportSelection,
  TransferImportSummary,
  TransferMappingInfo,
  TransferMappingTarget,
} from "../../shellium-env";
import { useEscapeLayer } from "../../app/escapeLayers";

const MIN_FILE_PASSWORD = 12;

type TransferWizardProps = {
  mode: "export" | "import";
  onClose(): void;
  /** After an import or its undo: reload settings, connections and script buttons. */
  onDataChanged(appOptions: unknown): void;
};

export function TransferWizard({ mode, onClose, onDataChanged }: TransferWizardProps) {
  useEscapeLayer(onClose);
  return (
    <section
      className="md-overlay md-overlay-prompt tw-overlay"
      aria-label={mode === "export" ? "Export" : "Import"}
    >
      {mode === "export" ? <ExportWizard onClose={onClose} /> : <ImportWizard onClose={onClose} onDataChanged={onDataChanged} />}
    </section>
  );
}

function errorText(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  // ipcRenderer.invoke wraps main-process errors as "Error invoking remote method 'x': Error: <message>".
  return message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, "") || fallback;
}

function plural(count: number, word: string) {
  if (count === 1) return `${count} ${word}`;
  return `${count} ${/[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`}`;
}

function Frame({ icon, title, subtitle, onClose, children, actions }: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  onClose(): void;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="md-dialog tw-dialog" role="dialog" aria-modal="true" aria-labelledby="tw-title">
      <header className="md-header">
        <span className="md-icon" aria-hidden="true">{icon}</span>
        <div className="md-title">
          <h2 id="tw-title">{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button type="button" className="md-close" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <div className="md-body tw-body">{children}</div>
      <div className="md-actions">{actions}</div>
    </div>
  );
}

function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="tw-steps" aria-label="Steps">
      {steps.map((step, index) => (
        <li key={step} className={index === current ? "current" : index < current ? "done" : ""}>
          <span className="tw-step-dot">{index < current ? <Check size={11} /> : index + 1}</span>
          {step}
        </li>
      ))}
    </ol>
  );
}

function CheckRow({ checked, disabled, onChange, label, detail }: {
  checked: boolean;
  disabled?: boolean;
  onChange(checked: boolean): void;
  label: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <label className={disabled ? "tw-check disabled" : "tw-check"}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="tw-check-text">
        <span>{label}</span>
        {detail && <small>{detail}</small>}
      </span>
    </label>
  );
}

/** Folder checklist: a checked folder takes everything under it. `selected` holds the top-most checked ids. */
function FolderPicker({ folders, selected, onChange }: { folders: TransferFolder[]; selected: Set<string>; onChange(next: Set<string>): void }) {
  const collectIds = (list: TransferFolder[]): string[] => list.flatMap((f) => [f.id, ...collectIds(f.folders)]);
  const allSelected = folders.length > 0 && folders.every((f) => selected.has(f.id));

  const toggle = (folder: TransferFolder, checked: boolean) => {
    const next = new Set(selected);
    collectIds(folder.folders).forEach((id) => next.delete(id));
    if (checked) next.add(folder.id);
    else next.delete(folder.id);
    onChange(next);
  };

  const renderLevel = (list: TransferFolder[], depth: number, inherited: boolean): ReactNode =>
    list.map((folder) => {
      const checked = inherited || selected.has(folder.id);
      return (
        <div key={folder.id}>
          <label className="tw-folder" style={{ paddingLeft: 8 + depth * 18 }}>
            <input type="checkbox" checked={checked} disabled={inherited} onChange={(event) => toggle(folder, event.target.checked)} />
            <FolderOpen size={14} aria-hidden="true" />
            <span className="tw-folder-name">{folder.name}</span>
            <span className="tw-count">{folder.hostCount}</span>
          </label>
          {renderLevel(folder.folders, depth + 1, checked)}
        </div>
      );
    });

  return (
    <div className="tw-tree">
      <label className="tw-folder tw-folder-all">
        <input type="checkbox" checked={allSelected} onChange={(event) => onChange(new Set(event.target.checked ? folders.map((f) => f.id) : []))} />
        <span className="tw-folder-name">All folders</span>
      </label>
      {renderLevel(folders, 0, false)}
    </div>
  );
}

function countSelectedHosts(folders: TransferFolder[], selected: Set<string>): number {
  return folders.reduce((total, folder) => total + (selected.has(folder.id) ? folder.hostCount : countSelectedHosts(folder.folders, selected)), 0);
}

/** undefined = everything (keeps the file / tree complete, including folders added later). */
function folderSelection(folders: TransferFolder[], selected: Set<string>): string[] | undefined {
  return folders.every((f) => selected.has(f.id)) ? undefined : [...selected];
}

function PasswordMeter({ value }: { value: string }) {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
  const score = value.length < MIN_FILE_PASSWORD ? 0 : value.length >= 20 || classes >= 3 ? 2 : 1;
  const labels = [`At least ${MIN_FILE_PASSWORD} characters`, "Acceptable", "Strong"];
  return (
    <div className={`tw-meter tw-meter-${score}`}>
      <span className="tw-meter-bar"><span /></span>
      <small>{labels[score]}</small>
    </div>
  );
}

// ------------------------------------------------------------------------------------------ export

type ExportStep = "format" | "content" | "password" | "done";

function ExportWizard({ onClose }: { onClose(): void }) {
  const api = window.shellium?.transfer;
  const [step, setStep] = useState<ExportStep>("format");
  const [format, setFormat] = useState<"shellium" | "csv">("shellium");
  const [sources, setSources] = useState<TransferExportSources | null>(null);
  const [folders, setFolders] = useState<Set<string>>(new Set());
  const [connections, setConnections] = useState(true);
  const [includePasswords, setIncludePasswords] = useState(false);
  const [categories, setCategories] = useState<Set<string>>(new Set());
  const [environments, setEnvironments] = useState(true);
  const [settings, setSettings] = useState(true);
  const [knownHosts, setKnownHosts] = useState(true);
  const [delimiter, setDelimiter] = useState<"," | ";">(",");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransferExportResult & { csvHosts?: number } | null>(null);

  useEffect(() => {
    api?.exportSources()
      .then((data) => {
        setSources(data);
        setFolders(new Set(data.folders.map((f) => f.id)));
        setCategories(new Set(data.scriptCategories.map((c) => c.id)));
      })
      .catch((e: unknown) => setError(errorText(e, "Could not read what there is to export.")));
  }, [api]);

  const hostCount = sources ? countSelectedHosts(sources.folders, folders) : 0;
  const nothingSelected = format === "csv"
    ? hostCount === 0
    : !(connections && folders.size > 0) && categories.size === 0 && !environments && !settings && !knownHosts;

  const exportShellium = () => {
    if (!api || !sources) return;
    if (password.length < MIN_FILE_PASSWORD) {
      setError(`The file password must be at least ${MIN_FILE_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    api.exportFile({
      connections: connections && folders.size > 0,
      folderIds: folderSelection(sources.folders, folders),
      includePasswords: connections && includePasswords,
      scriptCategoryIds: [...categories],
      environments,
      settings,
      knownHosts,
    }, password)
      .then((res) => {
        if (!res.canceled) {
          setPassword("");
          setConfirm("");
          setResult(res);
          setStep("done");
        }
      })
      .catch((e: unknown) => setError(errorText(e, "Export failed.")))
      .finally(() => setBusy(false));
  };

  const exportCsv = () => {
    if (!api || !sources) return;
    setBusy(true);
    setError(null);
    api.exportCsv(folderSelection(sources.folders, folders), delimiter)
      .then((res) => {
        if (!res.canceled) {
          setResult({ canceled: false, filePath: res.filePath, csvHosts: res.hostCount });
          setStep("done");
        }
      })
      .catch((e: unknown) => setError(errorText(e, "Export failed.")))
      .finally(() => setBusy(false));
  };

  const steps = format === "shellium" ? ["Format", "Contents", "Password", "Done"] : ["Format", "Hosts", "Done"];
  const stepIndex = format === "shellium"
    ? ["format", "content", "password", "done"].indexOf(step)
    : ["format", "content", "done"].indexOf(step);

  let body: ReactNode;
  let actions: ReactNode;

  if (step === "format") {
    body = (
      <div className="tw-choices">
        <button type="button" className={format === "shellium" ? "tw-choice selected" : "tw-choice"} onClick={() => setFormat("shellium")}>
          <FileLock2 size={22} aria-hidden="true" />
          <span>
            <strong>Shellium file (.shellium)</strong>
            <small>Everything you choose, encrypted with a password. Only Shellium can open it - no other program can read what is inside. For moving to another Shellium.</small>
          </span>
        </button>
        <button type="button" className={format === "csv" ? "tw-choice selected" : "tw-choice"} onClick={() => setFormat("csv")}>
          <FileSpreadsheet size={22} aria-hidden="true" />
          <span>
            <strong>CSV (hosts only)</strong>
            <small>Name, host, port, username, folder, environment, tags, description. Plain text for Excel or other tools - never passwords.</small>
          </span>
        </button>
      </div>
    );
    actions = (
      <>
        <button type="button" className="sh-btn sh-btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="sh-btn sh-btn-primary" disabled={!sources} onClick={() => setStep("content")}>Next</button>
      </>
    );
  } else if (step === "content" && sources) {
    body = format === "csv" ? (
      <>
        <FolderPicker folders={sources.folders} selected={folders} onChange={setFolders} />
        <div className="tw-inline">
          <span>Separator</span>
          <select className="md-input tw-select" value={delimiter} onChange={(event) => setDelimiter(event.target.value === ";" ? ";" : ",")}>
            <option value=",">Comma ( , )</option>
            <option value=";">Semicolon ( ; ) - Excel with Turkish / European settings</option>
          </select>
        </div>
        <div className="tw-note tw-note-warn">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>A CSV file is not encrypted: anyone who gets it can read the host list.</span>
        </div>
      </>
    ) : (
      <>
        <CheckRow
          checked={connections}
          onChange={setConnections}
          label="Connections"
          detail={`${plural(hostCount, "host")} in the selected folders`}
        />
        {connections && (
          <div className="tw-indent">
            <FolderPicker folders={sources.folders} selected={folders} onChange={setFolders} />
            <label className="tw-switch-row">
              <input type="checkbox" role="switch" className="sh-switch" checked={includePasswords} onChange={(event) => setIncludePasswords(event.target.checked)} />
              <span>
                <strong>Include saved passwords</strong>
                <small>
                  {!sources.hasPasswords
                    ? "No host has a saved password."
                    : includePasswords
                      ? "Saved passwords go into the encrypted file."
                      : "Hosts are exported without passwords; they are asked for on first connect."}
                </small>
              </span>
            </label>
            {includePasswords && (
              <div className="tw-note tw-note-warn">
                <AlertTriangle size={14} aria-hidden="true" />
                <span>The file will hold server passwords. It is encrypted, but anyone with the file and its password can connect to these servers.</span>
              </div>
            )}
          </div>
        )}
        <div className="tw-group">
          <span className="tw-group-title">Script buttons</span>
          {sources.scriptCategories.map((category) => (
            <CheckRow
              key={category.id}
              checked={categories.has(category.id)}
              onChange={(checked) => {
                const next = new Set(categories);
                if (checked) next.add(category.id);
                else next.delete(category.id);
                setCategories(next);
              }}
              label={category.name}
              detail={plural(category.buttonCount, "button")}
            />
          ))}
        </div>
        <div className="tw-group">
          <span className="tw-group-title">Other</span>
          <CheckRow checked={environments} onChange={setEnvironments} label="Environments" detail={`${plural(sources.environmentCount, "environment")} (hosts keep theirs either way)`} />
          <CheckRow checked={settings} onChange={setSettings} label="Options" detail="Terminal, appearance and behavior settings" />
          <CheckRow checked={knownHosts} onChange={setKnownHosts} label="Trusted host keys" detail={plural(sources.knownHostCount, "key")} />
        </div>
      </>
    );
    actions = (
      <>
        <button type="button" className="sh-btn sh-btn-ghost md-actions-start" onClick={() => setStep("format")}>Back</button>
        <button type="button" className="sh-btn sh-btn-ghost" onClick={onClose}>Cancel</button>
        {format === "csv" ? (
          <button type="button" className="sh-btn sh-btn-primary" disabled={nothingSelected || busy} onClick={exportCsv}>
            <Download size={14} /> Export CSV...
          </button>
        ) : (
          <button type="button" className="sh-btn sh-btn-primary" disabled={nothingSelected} onClick={() => setStep("password")}>Next</button>
        )}
      </>
    );
  } else if (step === "password") {
    body = (
      <form
        className="tw-form"
        id="tw-password-form"
        onSubmit={(event) => {
          event.preventDefault();
          exportShellium();
        }}
      >
        <p className="md-text">
          The file is encrypted with this password. Shellium does not keep it and cannot recover it: without it the file cannot be opened.
        </p>
        <label className="md-field">
          <span>File password</span>
          <input className="md-input" type="password" autoFocus value={password} onChange={(event) => { setPassword(event.target.value); setError(null); }} />
        </label>
        <PasswordMeter value={password} />
        <label className="md-field">
          <span>Repeat password</span>
          <input className="md-input" type="password" value={confirm} onChange={(event) => { setConfirm(event.target.value); setError(null); }} />
        </label>
      </form>
    );
    actions = (
      <>
        <button type="button" className="sh-btn sh-btn-ghost md-actions-start" onClick={() => setStep("content")}>Back</button>
        <button type="button" className="sh-btn sh-btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" form="tw-password-form" className="sh-btn sh-btn-primary" disabled={busy}>
          <Download size={14} /> {busy ? "Encrypting..." : "Export..."}
        </button>
      </>
    );
  } else if (step === "done" && result) {
    body = (
      <div className="tw-done">
        <span className="tw-done-icon"><Check size={20} /></span>
        <div>
          <strong>Export complete</strong>
          <p className="tw-path">{result.filePath}</p>
          <ul className="tw-list">
            {result.csvHosts !== undefined && <li>{plural(result.csvHosts, "host")}</li>}
            {result.hostCount !== undefined && <li>{plural(result.hostCount, "host")}, {result.includesPasswords ? "saved passwords included" : "no passwords"}</li>}
            {!!result.scriptButtonCount && <li>{plural(result.scriptButtonCount, "script button")}</li>}
            {!!result.environmentCount && <li>{plural(result.environmentCount, "environment")}</li>}
            {result.settings && <li>Options</li>}
            {!!result.knownHostCount && <li>{plural(result.knownHostCount, "trusted host key")}</li>}
          </ul>
        </div>
      </div>
    );
    actions = <button type="button" className="sh-btn sh-btn-primary" onClick={onClose}>Close</button>;
  } else {
    body = <p className="md-text">Loading...</p>;
    actions = <button type="button" className="sh-btn sh-btn-ghost" onClick={onClose}>Cancel</button>;
  }

  return (
    <Frame icon={<Download size={18} />} title="Export" subtitle={format === "shellium" ? "Shellium file (encrypted)" : "CSV (hosts only)"} onClose={onClose} actions={actions}>
      <Steps steps={steps} current={stepIndex} />
      {body}
      {error && <div className="md-alert" role="alert">{error}</div>}
    </Frame>
  );
}

// ------------------------------------------------------------------------------------------ import

type ImportStep = "choose" | "password" | "map" | "content" | "preview" | "done";

const KIND_LABEL = { shellium: "Shellium file", legacy: "RShell backup (.rshellbak)", csv: "CSV", xml: "XML" } as const;

/** Rows of the mapping step, in the order shown. */
const MAP_ROWS: { target: Exclude<TransferMappingTarget, "folder">; label: string; hint: string }[] = [
  { target: "host", label: "Host", hint: "Required: host name or IP address" },
  { target: "username", label: "Username", hint: "Empty ones get the default below" },
  { target: "port", label: "Port", hint: "Empty = 22" },
  { target: "name", label: "Name", hint: "Empty = the host" },
  { target: "description", label: "Description", hint: "" },
  { target: "tags", label: "Tags", hint: "Split at , ; |" },
  { target: "environment", label: "Environment", hint: "Matched by name; missing ones are added" },
  { target: "protocol", label: "Protocol", hint: "Entries that are not SSH (RDP, Telnet...) are left out" },
];

const HOST_FIELD_LABEL = { name: "name", description: "description", tags: "tags", environment: "environment", options: "connection options (X11, anti-idle, legacy algorithms)", password: "the password" } as const;

function listText(items: string[]) {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function ImportWizard({ onClose, onDataChanged }: { onClose(): void; onDataChanged(appOptions: unknown): void }) {
  const api = window.shellium?.transfer;
  const [step, setStep] = useState<ImportStep>("choose");
  const [token, setToken] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [password, setPassword] = useState("");
  const [summary, setSummary] = useState<TransferImportSummary | null>(null);
  const [mappingInfo, setMappingInfo] = useState<TransferMappingInfo | null>(null);
  const [mapping, setMapping] = useState<TransferFieldMapping>({ folder: "", defaultUsername: "" });
  const [localFolders, setLocalFolders] = useState<TransferFolder[]>([]);
  const [folders, setFolders] = useState<Set<string>>(new Set());
  const [connections, setConnections] = useState(true);
  const [categories, setCategories] = useState<Set<string>>(new Set());
  const [environments, setEnvironments] = useState(true);
  const [settings, setSettings] = useState(false);
  const [knownHosts, setKnownHosts] = useState(true);
  const [modeReplace, setModeReplace] = useState(false);
  const [targetFolderId, setTargetFolderId] = useState("");
  const [preview, setPreview] = useState<TransferImportPreview | null>(null);
  const [hostDecision, setHostDecision] = useState<TransferConflictDecision | null>(null);
  const [scriptDecision, setScriptDecision] = useState<TransferConflictDecision | null>(null);
  const [result, setResult] = useState<TransferImportResult | null>(null);
  const [undone, setUndone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The decrypted file (and the undo point) live in the main process until this wizard closes.
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;
  useEffect(() => () => {
    void api?.discard(tokenRef.current ?? undefined);
  }, [api]);

  useEffect(() => {
    api?.exportSources().then((data) => setLocalFolders(data.folders)).catch(() => setLocalFolders([]));
  }, [api]);

  const acceptSummary = (data: TransferImportSummary) => {
    setSummary(data);
    setFolders(new Set(data.connections?.folders.map((f) => f.id) ?? []));
    setConnections(!!data.connections && data.connections.hostCount > 0);
    setCategories(new Set(data.scriptCategories?.map((c) => c.id) ?? []));
    setEnvironments(data.environments.length > 0);
    setSettings(false);
    setKnownHosts(data.knownHostCount > 0);
    setModeReplace(false);
    setStep("content");
  };

  const chooseFile = () => {
    if (!api) return;
    setBusy(true);
    setError(null);
    api.openImport()
      .then((res) => {
        if (res.canceled) return;
        if (token) void api.discard(token);
        setToken(res.token);
        setFileName(res.fileName);
        setMappingInfo(res.mapping ?? null);
        if (res.mapping) {
          setMapping({ ...res.mapping.suggested, folder: res.mapping.folderFromTree ? "#tree" : res.mapping.suggested.folder ?? "", defaultUsername: "" });
          setStep("map");
        } else if (res.needsPassword) {
          setPassword("");
          setStep("password");
        } else if (res.summary) {
          acceptSummary(res.summary);
        }
      })
      .catch((e: unknown) => setError(errorText(e, "The file could not be opened.")))
      .finally(() => setBusy(false));
  };

  const unlock = () => {
    if (!api || !token) return;
    setBusy(true);
    setError(null);
    api.unlockImport(token, password)
      .then((data) => {
        setPassword("");
        acceptSummary(data);
      })
      .catch((e: unknown) => setError(errorText(e, "Wrong password, or the file is damaged.")))
      .finally(() => setBusy(false));
  };

  const applyMapping = () => {
    if (!api || !token) return;
    setBusy(true);
    setError(null);
    api.mapImport(token, mapping)
      .then(acceptSummary)
      .catch((e: unknown) => setError(errorText(e, "The file could not be read with these fields.")))
      .finally(() => setBusy(false));
  };

  const selection = (): TransferImportSelection => ({
    connections: connections && folders.size > 0,
    folderIds: summary?.connections ? folderSelection(summary.connections.folders, folders) : undefined,
    scriptCategoryIds: [...categories],
    environments,
    settings,
    knownHosts,
    mode: modeReplace ? "replace" : "merge",
    targetFolderId: modeReplace ? null : targetFolderId || null,
  });

  const loadPreview = () => {
    if (!api || !token) return;
    setBusy(true);
    setError(null);
    api.previewImport(token, selection())
      .then((data) => {
        setPreview(data);
        setHostDecision(null);
        setScriptDecision(null);
        setStep("preview");
      })
      .catch((e: unknown) => setError(errorText(e, "Could not compare the file with this Shellium.")))
      .finally(() => setBusy(false));
  };

  const apply = () => {
    if (!api || !token) return;
    setBusy(true);
    setError(null);
    api.applyImport(token, selection(), { hosts: hostDecision ?? "skip", scripts: scriptDecision ?? "skip" })
      .then((res) => {
        setResult(res);
        setToken(null);
        setStep("done");
        onDataChanged(res.settings.appOptions);
      })
      .catch((e: unknown) => setError(`${errorText(e, "Import failed.")} Nothing was changed.`))
      .finally(() => setBusy(false));
  };

  const undo = () => {
    if (!api) return;
    setBusy(true);
    setError(null);
    api.undoImport()
      .then((res) => {
        setUndone(true);
        onDataChanged(res.settings.appOptions);
      })
      .catch((e: unknown) => setError(errorText(e, "The import could not be undone.")))
      .finally(() => setBusy(false));
  };

  // A host list (CSV / XML) only merges: it has no script buttons or options to restore.
  const isHostList = summary?.kind === "csv" || summary?.kind === "xml";
  const steps = mappingInfo ? ["File", "Fields", "Contents", "Review", "Done"] : ["File", "Contents", "Review", "Done"];
  const stepIndex = mappingInfo
    ? { choose: 0, password: 0, map: 1, content: 2, preview: 3, done: 4 }[step]
    : { choose: 0, password: 0, map: 0, content: 1, preview: 2, done: 3 }[step];
  const sourceLabel = summary ? KIND_LABEL[summary.kind] : "";
  const hostCount = summary?.connections ? countSelectedHosts(summary.connections.folders, folders) : 0;
  const nothingSelected = !(connections && folders.size > 0) && categories.size === 0 && !(environments && (summary?.environments.length ?? 0) > 0) && !settings && !knownHosts;
  const hostConflicts = preview?.mode === "merge" ? preview.hosts.conflicts.length : 0;
  const scriptConflicts = preview?.mode === "merge" ? preview.scripts.conflicts.length : 0;
  const undecided = (hostConflicts > 0 && !hostDecision) || (scriptConflicts > 0 && !scriptDecision);

  const flatLocalFolders = useMemo(() => {
    const out: { id: string; label: string }[] = [];
    const walk = (list: TransferFolder[], prefix: string) => list.forEach((f) => {
      out.push({ id: f.id, label: prefix + f.name });
      walk(f.folders, `${prefix}${f.name} / `);
    });
    walk(localFolders, "");
    return out;
  }, [localFolders]);

  let body: ReactNode;
  let actions: ReactNode;

  if (step === "choose") {
    body = (
      <div className="tw-choose">
        <p className="md-text">
          Import a <strong>Shellium file</strong> (.shellium), an <strong>RShell export</strong> (.rshell) or older backup (.rshellbak), a <strong>CSV</strong> host list
          with the columns name, host, port, username, folder, environment, tags, description, or another tool&apos;s <strong>XML</strong> export.
          You choose what to take and see conflicts before anything changes.
        </p>
        <button type="button" className="sh-btn sh-btn-primary" disabled={busy} onClick={chooseFile}>
          <FolderOpen size={14} /> Choose file...
        </button>
      </div>
    );
    actions = <button type="button" className="sh-btn sh-btn-ghost" onClick={onClose}>Cancel</button>;
  } else if (step === "password") {
    body = (
      <form
        className="tw-form"
        id="tw-unlock-form"
        onSubmit={(event) => {
          event.preventDefault();
          unlock();
        }}
      >
        <p className="md-text"><strong>{fileName}</strong> is encrypted. Enter the password it was exported with.</p>
        <label className="md-field">
          <span>File password</span>
          <input className="md-input" type="password" autoFocus value={password} onChange={(event) => { setPassword(event.target.value); setError(null); }} />
        </label>
      </form>
    );
    actions = (
      <>
        <button type="button" className="sh-btn sh-btn-ghost md-actions-start" onClick={() => setStep("choose")}>Back</button>
        <button type="button" className="sh-btn sh-btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" form="tw-unlock-form" className="sh-btn sh-btn-primary" disabled={busy || !password}>{busy ? "Decrypting..." : "Open"}</button>
      </>
    );
  } else if (step === "map" && mappingInfo) {
    const fieldByKey = new Map(mappingInfo.fields.map((field) => [field.key, field]));
    const samples = (key: string | undefined) => (key ? fieldByKey.get(key)?.samples.join(", ") ?? "" : "");
    const fieldOptions = mappingInfo.fields.map((field) => (
      <option key={field.key} value={field.key}>{field.key} ({field.filled}/{mappingInfo.recordCount})</option>
    ));
    body = (
      <>
        <p className="tw-file">
          <strong>{fileName}</strong> · Fields of the file · {plural(mappingInfo.recordCount, "entry")} with a host
        </p>
        <p className="md-text">
          Choose which field of the file goes where. Likely fields are filled in; check them.
        </p>
        <div className="tw-map" role="group" aria-label="Field mapping">
          {MAP_ROWS.map((row) => (
            <div className="tw-map-row" key={row.target}>
              <label htmlFor={`tw-map-${row.target}`}>
                {row.label}
                {row.hint && <small>{row.hint}</small>}
              </label>
              <select
                id={`tw-map-${row.target}`}
                className="md-input tw-select"
                value={mapping[row.target] ?? ""}
                onChange={(event) => setMapping({ ...mapping, [row.target]: event.target.value || undefined })}
              >
                <option value="">{row.target === "host" ? "Choose a field" : "Not used"}</option>
                {fieldOptions}
              </select>
              <span className="tw-map-sample" title={samples(mapping[row.target])}>{samples(mapping[row.target])}</span>
            </div>
          ))}
          <div className="tw-map-row">
            <label htmlFor="tw-map-folder">Folders</label>
            <select id="tw-map-folder" className="md-input tw-select" value={mapping.folder} onChange={(event) => setMapping({ ...mapping, folder: event.target.value })}>
              {mappingInfo.folderFromTree && <option value="#tree">The file&apos;s folder structure</option>}
              <option value="">No folders (all into &quot;Imported&quot;)</option>
              {fieldOptions}
            </select>
            <span className="tw-map-sample">
              {mapping.folder === "#tree" ? (mappingInfo.hasFolders ? "As in the file" : "The file has no folders") : samples(mapping.folder || undefined)}
            </span>
          </div>
          <div className="tw-map-row">
            <label htmlFor="tw-map-user">Default username<small>For entries without one</small></label>
            <input
              id="tw-map-user"
              className="md-input tw-select"
              value={mapping.defaultUsername}
              placeholder="e.g. oracle"
              spellCheck={false}
              onChange={(event) => setMapping({ ...mapping, defaultUsername: event.target.value })}
            />
            <span className="tw-map-sample" />
          </div>
        </div>
        <div className="tw-note">
          <KeyRound size={14} aria-hidden="true" />
          <span>Passwords are never read from the file (other tools encrypt them with their own keys). Shellium asks for the password when you connect.</span>
        </div>
      </>
    );
    actions = (
      <>
        <button type="button" className="sh-btn sh-btn-ghost md-actions-start" onClick={() => setStep("choose")}>Other file</button>
        <button type="button" className="sh-btn sh-btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="sh-btn sh-btn-primary" disabled={busy || !mapping.host} onClick={applyMapping}>{busy ? "Reading..." : "Next"}</button>
      </>
    );
  } else if (step === "content" && summary) {
    body = (
      <>
        <p className="tw-file">
          <strong>{fileName}</strong> · {sourceLabel}
          {summary.exportedAt && ` · exported ${new Date(summary.exportedAt).toLocaleString()}`}
        </p>
        {summary.issues.length > 0 && (
          <details className="tw-note tw-note-warn tw-issues">
            <summary>
              <AlertTriangle size={14} aria-hidden="true" /> {plural(summary.issues.length, summary.kind === "csv" ? "row" : "entry")} cannot be imported and will be left out
            </summary>
            <ul>
              {summary.issues.slice(0, 50).map((issue, index) => (
                <li key={index}>{issue.line ? `Line ${issue.line}` : issue.where}: {issue.message}</li>
              ))}
              {summary.issues.length > 50 && <li>... and {summary.issues.length - 50} more</li>}
            </ul>
          </details>
        )}
        {summary.connections && (
          <>
            <CheckRow
              checked={connections}
              onChange={setConnections}
              label="Connections"
              detail={`${plural(hostCount, "host")} selected${summary.connections.includesPasswords ? " · the file has saved passwords" : " · no passwords in the file"}`}
            />
            {connections && (
              <div className="tw-indent">
                <FolderPicker folders={summary.connections.folders} selected={folders} onChange={setFolders} />
              </div>
            )}
          </>
        )}
        {summary.scriptCategories && summary.scriptCategories.length > 0 && (
          <div className="tw-group">
            <span className="tw-group-title">Script buttons</span>
            {summary.scriptCategories.map((category) => (
              <CheckRow
                key={category.id}
                checked={categories.has(category.id)}
                onChange={(checked) => {
                  const next = new Set(categories);
                  if (checked) next.add(category.id);
                  else next.delete(category.id);
                  setCategories(next);
                }}
                label={category.name}
                detail={plural(category.buttonCount, "button")}
              />
            ))}
          </div>
        )}
        {(summary.environments.length > 0 || summary.settings || summary.knownHostCount > 0) && (
          <div className="tw-group">
            <span className="tw-group-title">Other</span>
            {summary.environments.length > 0 && (
              <CheckRow
                checked={environments}
                onChange={setEnvironments}
                label="Environments"
                detail={`${summary.environments.map((env) => env.name).join(", ")} - matched by name; ones used by imported hosts are added anyway`}
              />
            )}
            {summary.settings && (
              <CheckRow checked={settings} onChange={setSettings} label="Options" detail="Replaces this Shellium's options (environments are merged, not replaced)" />
            )}
            {summary.knownHostCount > 0 && (
              <CheckRow checked={knownHosts} onChange={setKnownHosts} label="Trusted host keys" detail={`${plural(summary.knownHostCount, "key")} - a key this device already trusts is never replaced`} />
            )}
          </div>
        )}
        {!isHostList && (
          <div className="tw-group">
            <span className="tw-group-title">How</span>
            <label className="tw-radio">
              <input type="radio" name="tw-mode" checked={!modeReplace} onChange={() => setModeReplace(false)} />
              <span><strong>Merge</strong><small>Add to what is here. Folders with the same name are merged; you decide about conflicts on the next page.</small></span>
            </label>
            <label className="tw-radio">
              <input type="radio" name="tw-mode" checked={modeReplace} onChange={() => setModeReplace(true)} />
              <span><strong>Replace</strong><small>The selected connections and script buttons replace everything here (restore on a new machine).</small></span>
            </label>
          </div>
        )}
        {!modeReplace && connections && flatLocalFolders.length > 0 && (
          <div className="tw-inline">
            <span>Put folders under</span>
            <select className="md-input tw-select" value={targetFolderId} onChange={(event) => setTargetFolderId(event.target.value)}>
              <option value="">Top level</option>
              {flatLocalFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.label}</option>)}
            </select>
          </div>
        )}
      </>
    );
    actions = (
      <>
        {mappingInfo ? (
          <button type="button" className="sh-btn sh-btn-ghost md-actions-start" onClick={() => setStep("map")}>Back</button>
        ) : (
          <button type="button" className="sh-btn sh-btn-ghost md-actions-start" onClick={() => setStep("choose")}>Other file</button>
        )}
        <button type="button" className="sh-btn sh-btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="sh-btn sh-btn-primary" disabled={busy || nothingSelected} onClick={loadPreview}>Next</button>
      </>
    );
  } else if (step === "preview" && preview) {
    body = (
      <>
        {preview.mode === "replace" && (
          <div className="tw-note tw-note-danger">
            <AlertTriangle size={14} aria-hidden="true" />
            <span>
              {preview.hosts.replacedCount > 0 && `All ${plural(preview.hosts.replacedCount, "host")} here will be replaced by the ${preview.hosts.new} from the file. `}
              {preview.scripts.replacedCount > 0 && `All ${plural(preview.scripts.replacedCount, "script button")} here will be replaced by the ${preview.scripts.new} from the file. `}
              Saved passwords of hosts that are in both are kept when the file has none.
            </span>
          </div>
        )}
        {preview.mode === "merge" && (
          <ul className="tw-list">
            {connections && (
              <li>
                <strong>{plural(preview.hosts.new, "new host")}</strong>
                {preview.hosts.unchanged > 0 && ` · ${preview.hosts.unchanged} already here, identical`}
                {preview.hosts.duplicatesInFile > 0 && ` · ${preview.hosts.duplicatesInFile} listed twice in the file (first one used)`}
              </li>
            )}
            {categories.size > 0 && (
              <li>
                <strong>{plural(preview.scripts.new, "new script button")}</strong>
                {preview.scripts.unchanged > 0 && ` · ${preview.scripts.unchanged} already here, identical`}
              </li>
            )}
          </ul>
        )}
        {hostConflicts > 0 && (
          <ConflictBlock
            title={`${plural(hostConflicts, "host")} already exist${hostConflicts === 1 ? "s" : ""} with different settings`}
            hint={preview.hostUpdates.length > 0
              ? `Same host, port and username. Update overwrites ${listText(preview.hostUpdates.map((field) => HOST_FIELD_LABEL[field]))} from the file; everything else stays (folder, favorite, saved password, options the file does not have).`
              : "Same host, port and username."}
            decision={hostDecision}
            onDecision={setHostDecision}
          >
            <table className="tw-table">
              <thead>
                <tr><th>Here</th><th>In the file</th><th>Connection</th><th>Differs</th></tr>
              </thead>
              <tbody>
                {preview.hosts.conflicts.map((c) => (
                  <tr key={`${c.hostname}|${c.port}|${c.username}`}>
                    <td>{c.existingName}<small>{c.existingPath}</small></td>
                    <td>{c.name}<small>{c.importedPath}</small></td>
                    <td className="tw-mono">{c.username}@{c.hostname}{c.port !== 22 ? `:${c.port}` : ""}</td>
                    <td className="tw-diff">{c.differences.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ConflictBlock>
        )}
        {scriptConflicts > 0 && (
          <ConflictBlock
            title={`${plural(scriptConflicts, "script button")} already exist${scriptConflicts === 1 ? "s" : ""} with a different script`}
            hint="Same category and label. Update overwrites the script and its color."
            decision={scriptDecision}
            onDecision={setScriptDecision}
          >
            <ul className="tw-list tw-list-compact">
              {preview.scripts.conflicts.map((c) => <li key={`${c.category}|${c.label}`}>{c.category} › {c.label}</li>)}
            </ul>
          </ConflictBlock>
        )}
        <ul className="tw-list">
          {preview.newEnvironments.length > 0 && <li>New environments: {preview.newEnvironments.join(", ")}</li>}
          {preview.knownHosts && (
            <li>
              Trusted host keys: {preview.knownHosts.added} new, {preview.knownHosts.alreadyKnown} already trusted
              {preview.knownHosts.conflicts > 0 && `, ${preview.knownHosts.conflicts} kept (this device trusts a different key)`}
            </li>
          )}
          {preview.settings && <li>Options will be replaced</li>}
        </ul>
      </>
    );
    actions = (
      <>
        <button type="button" className="sh-btn sh-btn-ghost md-actions-start" onClick={() => setStep("content")}>Back</button>
        <button type="button" className="sh-btn sh-btn-ghost" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className={preview.mode === "replace" ? "sh-btn sh-btn-danger" : "sh-btn sh-btn-primary"}
          disabled={busy || undecided}
          title={undecided ? "Choose what to do with the conflicts first" : undefined}
          onClick={apply}
        >
          <Upload size={14} /> {busy ? "Importing..." : preview.mode === "replace" ? "Replace" : "Import"}
        </button>
      </>
    );
  } else if (step === "done" && result) {
    body = (
      <div className="tw-done">
        <span className="tw-done-icon"><Check size={20} /></span>
        <div>
          <strong>{undone ? "Import undone" : "Import complete"}</strong>
          {undone ? (
            <p className="md-text">Connections, script buttons, trusted keys and options are back to how they were before the import.</p>
          ) : (
            <ul className="tw-list">
              {(result.hostsAdded + result.hostsUpdated + result.hostsSkipped) > 0 && (
                <li>Hosts: {result.hostsAdded} added{result.hostsUpdated > 0 && `, ${result.hostsUpdated} updated`}{result.hostsSkipped > 0 && `, ${result.hostsSkipped} skipped`}</li>
              )}
              {(result.scriptsAdded + result.scriptsUpdated + result.scriptsSkipped) > 0 && (
                <li>Script buttons: {result.scriptsAdded} added{result.scriptsUpdated > 0 && `, ${result.scriptsUpdated} updated`}{result.scriptsSkipped > 0 && `, ${result.scriptsSkipped} skipped`}</li>
              )}
              {result.environmentsAdded.length > 0 && <li>Environments added: {result.environmentsAdded.join(", ")}</li>}
              {result.knownHosts && <li>Trusted host keys: {result.knownHosts.added} added{result.knownHosts.conflicts > 0 && `, ${result.knownHosts.conflicts} kept`}</li>}
              {preview?.settings && <li>Options replaced</li>}
            </ul>
          )}
        </div>
      </div>
    );
    actions = (
      <>
        {!undone && (
          <button type="button" className="sh-btn sh-btn-ghost md-actions-start" disabled={busy} onClick={undo}>
            <Undo2 size={14} /> Undo import
          </button>
        )}
        <button type="button" className="sh-btn sh-btn-primary" onClick={onClose}>Close</button>
      </>
    );
  } else {
    body = null;
    actions = <button type="button" className="sh-btn sh-btn-ghost" onClick={onClose}>Cancel</button>;
  }

  return (
    <Frame icon={<Upload size={18} />} title="Import" subtitle={fileName || undefined} onClose={onClose} actions={actions}>
      <Steps steps={steps} current={stepIndex} />
      {body}
      {error && <div className="md-alert" role="alert">{error}</div>}
    </Frame>
  );
}

function ConflictBlock({ title, hint, decision, onDecision, children }: {
  title: string;
  hint: string;
  decision: TransferConflictDecision | null;
  onDecision(decision: TransferConflictDecision): void;
  children: ReactNode;
}) {
  return (
    <div className="tw-conflict">
      <div className="tw-conflict-head">
        <AlertTriangle size={15} aria-hidden="true" />
        <div>
          <strong>{title}</strong>
          <small>{hint}</small>
        </div>
      </div>
      <div className="tw-conflict-list">{children}</div>
      <div className="tw-conflict-question" role="radiogroup" aria-label="What to do with them">
        <span>What should happen to them?</span>
        <button type="button" role="radio" aria-checked={decision === "skip"} className={decision === "skip" ? "selected" : ""} onClick={() => onDecision("skip")}>
          Skip - keep mine
        </button>
        <button type="button" role="radio" aria-checked={decision === "update"} className={decision === "update" ? "selected" : ""} onClick={() => onDecision("update")}>
          Update from the file
        </button>
      </div>
    </div>
  );
}
