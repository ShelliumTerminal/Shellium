import { Copy, FileInput, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { KnownHostListItem } from "../../shellium-env";
import { formatRelativeTime } from "../workspace/hostDirectory";
import { useEscapeLayer } from "../../app/escapeLayers";

function errorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  // ipcRenderer.invoke wraps main-process errors as "Error invoking remote method 'x': Error: <message>".
  return message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, "") || fallback;
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * Options > Security: the SSH host keys Shellium trusts (electron/knownHosts.ts). Changes here apply
 * immediately; they are not part of the Options draft.
 */
export default function KnownHostsPanel() {
  const [items, setItems] = useState<KnownHostListItem[] | null>(null);
  const [filter, setFilter] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  useEscapeLayer(() => setConfirmId(null), confirmId !== null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    window.shellium?.knownHosts.list()
      .then((list) => {
        setItems(list);
        setError(null);
      })
      .catch((reason: unknown) => setError(errorMessage(reason, "Trusted host keys could not be loaded.")));
  }, []);

  useEffect(load, [load]);

  const query = filter.trim().toLowerCase();
  const visible = useMemo(
    () => (items ?? []).filter((item) => !query || [item.hostname, `${item.hostname}:${item.port}`, item.keyType, item.fingerprint].some((value) => value.toLowerCase().includes(query))),
    [items, query],
  );

  const handleImport = async () => {
    setIsBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.shellium?.knownHosts.importOpenSsh();
      if (result && !result.canceled) {
        const parts = [`Imported ${plural(result.added, "key")}`];
        if (result.alreadyKnown) parts.push(`${result.alreadyKnown} already trusted`);
        if (result.conflicts) parts.push(`${result.conflicts} kept as is (Shellium already trusts a different key for that host)`);
        if (result.skippedHashed) parts.push(`${result.skippedHashed} hashed ${result.skippedHashed === 1 ? "entry" : "entries"} skipped (host name not recoverable)`);
        if (result.skippedOther) parts.push(`${result.skippedOther} wildcard or marker ${result.skippedOther === 1 ? "line" : "lines"} skipped`);
        setNotice(`${parts.join(" · ")}.`);
        load();
      }
    } catch (reason) {
      setError(errorMessage(reason, "The known_hosts file could not be imported."));
    } finally {
      setIsBusy(false);
    }
  };

  const handleRemove = async (item: KnownHostListItem) => {
    setError(null);
    setNotice(null);
    try {
      await window.shellium?.knownHosts.remove(item.id);
      setConfirmId(null);
      setNotice(`${item.hostname}:${item.port} is no longer trusted. Shellium will ask you to verify its key on the next connection.`);
      load();
    } catch (reason) {
      setError(errorMessage(reason, "The host key could not be removed."));
    }
  };

  const handleCopy = (item: KnownHostListItem) => {
    window.shellium?.clipboard.writeText(item.fingerprint).then(() => {
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId((current) => (current === item.id ? null : current)), 1500);
    }).catch(() => undefined);
  };

  return (
    <section className="op-kh" aria-label="Trusted host keys">
      <div className="op-row">
        <div className="op-row-text">
          <strong>Trusted host keys</strong>
          <span>
            Servers whose SSH host key you accepted. A server that later presents a different key is refused until you confirm it.
            Changes here apply immediately.
          </span>
        </div>
        <div className="op-row-control">
          <button className="sh-btn sh-btn-secondary sh-btn-sm" type="button" onClick={handleImport} disabled={isBusy}>
            <FileInput size={14} />
            Import from OpenSSH...
          </button>
        </div>
      </div>

      {error && <div className="op-alert op-alert-error">{error}</div>}
      {notice && <div className="op-alert op-alert-ok">{notice}</div>}

      <div className="op-kh-toolbar">
        <div className="op-kh-search">
          <Search size={14} aria-hidden="true" />
          <input value={filter} placeholder="Filter by host, key type or fingerprint" aria-label="Filter trusted host keys" spellCheck={false} onChange={(event) => setFilter(event.target.value)} />
        </div>
        <span className="op-kh-count">
          {items === null ? "Loading..." : query ? `${visible.length} of ${plural(items.length, "key")}` : plural(items.length, "key")}
        </span>
      </div>

      <div className="op-kh-list" role="list">
        {items !== null && visible.length === 0 && (
          <div className="op-kh-empty">
            {items.length === 0 ? "No trusted host keys yet. Keys are added when you accept a server at its first connection, or imported from OpenSSH." : "No keys match the filter."}
          </div>
        )}
        {visible.map((item) => (
          <div className={`op-kh-row${confirmId === item.id ? " confirming" : ""}`} role="listitem" key={item.id}>
            <div className="op-kh-main">
              <div className="op-kh-host">
                <strong>{item.hostname}</strong>
                {item.port !== 22 && <span className="op-kh-port">:{item.port}</span>}
                <span className="op-kh-type">{item.keyType}</span>
                {item.source === "openssh-import" && <span className="op-kh-source">OpenSSH import</span>}
                {item.source === "backup" && <span className="op-kh-source">From backup</span>}
              </div>
              <div className="op-kh-fingerprint">
                <code title={item.fingerprint}>{item.fingerprint}</code>
                <button type="button" className="op-kh-icon" title={copiedId === item.id ? "Copied" : "Copy fingerprint"} aria-label="Copy fingerprint" onClick={() => handleCopy(item)}>
                  <Copy size={13} />
                </button>
                {copiedId === item.id && <span className="op-kh-copied">Copied</span>}
              </div>
            </div>
            <span className="op-kh-seen" title={`Added ${new Date(item.addedAt).toLocaleString()} · last seen ${new Date(item.lastSeenAt).toLocaleString()}`}>
              {formatRelativeTime(Date.parse(item.lastSeenAt))}
            </span>
            {confirmId === item.id ? (
              <span className="op-kh-confirm">
                <button type="button" className="sh-btn sh-btn-ghost sh-btn-sm" onClick={() => setConfirmId(null)}>Cancel</button>
                <button type="button" className="sh-btn sh-btn-danger sh-btn-sm" onClick={() => handleRemove(item)}>Remove</button>
              </span>
            ) : (
              <button type="button" className="op-kh-icon op-kh-remove" title="Stop trusting this key" aria-label={`Remove ${item.hostname}:${item.port}`} onClick={() => setConfirmId(item.id)}>
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
