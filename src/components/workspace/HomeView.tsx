import { Search, Star } from "lucide-react";
import { useMemo, useState } from "react";
import type { KeyboardEvent } from "react";

import { EnvironmentBadge, environmentStyle, useEnvironments } from "../common/environments";
import type { Host, Session } from "../palette/types";
import { formatRelativeTime, matchesHost } from "./hostDirectory";
import type { DirectoryHost, RecentConnection } from "./hostDirectory";
import { connectShortcutKeys } from "../../app/platform";

type HomeViewProps = {
  hosts: DirectoryHost[];
  recent: RecentConnection[];
  sessions: Session[];
  onConnect: (host: Host) => void;
  onSwitchToSession: (sessionId: string) => void;
  onOpenHostManager: () => void;
};

const maxResults = 60;
const maxRecentRows = 8;

/** Landing tab: search every host, filter by environment, favorites and recent connections. */
export default function HomeView({ hosts, recent, sessions, onConnect, onSwitchToSession, onOpenHostManager }: HomeViewProps) {
  const environments = useEnvironments();
  const [query, setQuery] = useState("");
  const [environmentFilter, setEnvironmentFilter] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const normalizedQuery = query.trim().toLowerCase();

  const sessionByHostId = useMemo(() => {
    const map = new Map<string, Session>();
    sessions.forEach((session) => {
      if (!map.has(session.host.id)) {
        map.set(session.host.id, session);
      }
    });
    return map;
  }, [sessions]);

  const environmentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    hosts.forEach(({ host }) => {
      if (host.environmentId && environments.some((environment) => environment.id === host.environmentId)) {
        counts.set(host.environmentId, (counts.get(host.environmentId) ?? 0) + 1);
      }
    });
    return counts;
  }, [environments, hosts]);

  const isFiltering = Boolean(normalizedQuery || environmentFilter);
  const results = useMemo(() => {
    if (!isFiltering) {
      return [];
    }

    return hosts
      .filter((entry) => !environmentFilter || entry.host.environmentId === environmentFilter)
      .filter((entry) => matchesHost(entry, normalizedQuery, environments))
      .slice(0, maxResults);
  }, [environmentFilter, environments, hosts, isFiltering, normalizedQuery]);

  const favorites = useMemo(() => hosts.filter(({ host }) => host.favorite), [hosts]);
  const recentRows = useMemo(() => {
    const byId = new Map(hosts.map((entry) => [entry.host.id, entry]));
    return recent
      .map((item) => ({ entry: byId.get(item.hostId), connectedAt: item.connectedAt }))
      .filter((item): item is { entry: DirectoryHost; connectedAt: number } => Boolean(item.entry))
      .slice(0, maxRecentRows);
  }, [hosts, recent]);

  const open = (host: Host) => {
    const session = sessionByHostId.get(host.id);

    if (session) {
      onSwitchToSession(session.id);
    } else {
      onConnect(host);
    }
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length > 0) {
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setHighlight((current) => (current + direction + results.length) % results.length);
      }
    } else if (event.key === "Enter") {
      const entry = results[Math.min(highlight, results.length - 1)];
      if (entry) {
        event.preventDefault();
        open(entry.host);
      }
    } else if (event.key === "Escape" && (query || environmentFilter)) {
      event.preventDefault();
      setQuery("");
      setEnvironmentFilter(null);
    }
  };

  const actionLabel = (host: Host) => (sessionByHostId.has(host.id) ? "Switch" : "Connect");

  return (
    <section className="hm" aria-label="Home">
      <div className="hm-inner">
        <header className="hm-head">
          <h1>Home</h1>
          <p>
            {hosts.length === 1 ? "1 host" : `${hosts.length} hosts`} · {sessions.length === 1 ? "1 open session" : `${sessions.length} open sessions`}
          </p>
        </header>

        <div className="hm-search">
          <Search size={17} aria-hidden="true" />
          <input
            autoFocus
            value={query}
            placeholder="Search host, IP, user, tag, folder or environment"
            aria-label="Search hosts"
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
            }}
            onKeyDown={handleSearchKeyDown}
          />
          <span className="hm-search-hint">{isFiltering ? `${results.length}${results.length === maxResults ? "+" : ""} ${results.length === 1 ? "match" : "matches"} · Enter to open` : "Enter to connect"}</span>
        </div>

        {environments.length > 0 && (
          <div className="hm-filters" role="group" aria-label="Filter by environment">
            <button type="button" className={`hm-filter${environmentFilter === null ? " on" : ""}`} onClick={() => setEnvironmentFilter(null)}>
              All <b>{hosts.length}</b>
            </button>
            {environments.map((environment) => {
              const count = environmentCounts.get(environment.id) ?? 0;
              return (
                <button
                  key={environment.id}
                  type="button"
                  className={`hm-filter${environmentFilter === environment.id ? " on" : ""}${count === 0 ? " empty" : ""}`}
                  style={environmentStyle(environment)}
                  title={environment.name}
                  aria-pressed={environmentFilter === environment.id}
                  onClick={() => {
                    setEnvironmentFilter((current) => (current === environment.id ? null : environment.id));
                    setHighlight(0);
                  }}
                >
                  <span className="hm-filter-dot" aria-hidden="true" />
                  {environment.badge}
                  <b>{count}</b>
                </button>
              );
            })}
          </div>
        )}

        {isFiltering ? (
          <section className="hm-section">
            {results.length === 0 ? (
              <div className="hm-empty">No hosts match. <button type="button" onClick={onOpenHostManager}>Open the host manager</button> to add one.</div>
            ) : (
              <div className="hm-results" role="listbox" aria-label="Matching hosts">
                {results.map((entry, index) => (
                  <button
                    key={entry.host.id}
                    type="button"
                    role="option"
                    aria-selected={index === highlight}
                    className={`hm-result${index === highlight ? " active" : ""}`}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => open(entry.host)}
                  >
                    <span className={`hm-dot${sessionByHostId.get(entry.host.id)?.status === "connected" ? " live" : ""}`} aria-hidden="true" />
                    <span className="hm-host">
                      <span className="hm-host-name">{entry.host.name}</span>
                      <span className="hm-host-meta">{entry.host.username ? `${entry.host.username}@` : ""}{entry.host.hostname}</span>
                    </span>
                    <EnvironmentBadge environmentId={entry.host.environmentId} />
                    <span className="hm-path">{entry.folderPath}</span>
                    <span className="hm-action">{actionLabel(entry.host)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : (
          <>
            <section className="hm-section">
              <div className="hm-section-title">
                <h2>Favorites</h2>
                <button type="button" onClick={onOpenHostManager}>Host manager</button>
              </div>
              {favorites.length === 0 ? (
                <div className="hm-empty">
                  <Star size={15} aria-hidden="true" />
                  Star a host in the host manager ({connectShortcutKeys.map((key) => <kbd key={key}>{key}</kbd>)}) to pin it here.
                </div>
              ) : (
                <div className="hm-cards">
                  {favorites.map((entry) => {
                    const session = sessionByHostId.get(entry.host.id);
                    return (
                      <button key={entry.host.id} type="button" className="hm-card" onClick={() => open(entry.host)}>
                        <span className="hm-card-top">
                          <span className={`hm-dot${session?.status === "connected" ? " live" : ""}`} aria-hidden="true" />
                          <span className="hm-host-name" title={entry.host.name}>{entry.host.name}</span>
                          <EnvironmentBadge environmentId={entry.host.environmentId} />
                        </span>
                        <span className="hm-host-meta">{entry.host.username ? `${entry.host.username}@` : ""}{entry.host.hostname}</span>
                        <span className="hm-card-foot">
                          <span>{session ? (session.status === "connected" ? "Connected" : session.status === "connecting" ? "Connecting" : "Disconnected") : entry.folderPath}</span>
                          <b>{actionLabel(entry.host)} →</b>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="hm-section">
              <div className="hm-section-title">
                <h2>Recent connections</h2>
              </div>
              {recentRows.length === 0 ? (
                <div className="hm-empty">Hosts you connect to will be listed here.</div>
              ) : (
                <table className="hm-table">
                  <thead>
                    <tr>
                      <th>Host</th>
                      <th>Environment</th>
                      <th>User</th>
                      <th>Folder</th>
                      <th>Last connected</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {recentRows.map(({ entry, connectedAt }) => (
                      <tr key={entry.host.id} onDoubleClick={() => open(entry.host)}>
                        <td>
                          <span className="hm-host-name">{entry.host.name}</span>
                        </td>
                        <td><EnvironmentBadge environmentId={entry.host.environmentId} /></td>
                        <td className="hm-mono">{entry.host.username}</td>
                        <td className="hm-muted">{entry.folderPath}</td>
                        <td className="hm-muted">{formatRelativeTime(connectedAt)}</td>
                        <td className="hm-cell-action">
                          <button type="button" className="sh-btn sh-btn-secondary sh-btn-sm" onClick={() => open(entry.host)}>{actionLabel(entry.host)}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </div>
    </section>
  );
}
