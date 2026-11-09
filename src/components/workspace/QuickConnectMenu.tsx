import { Clock, Search, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";

import { EnvironmentBadge, useEnvironments } from "../common/environments";
import type { Host, Session } from "../palette/types";
import { formatRelativeTime, matchesHost } from "./hostDirectory";
import type { DirectoryHost, RecentConnection } from "./hostDirectory";
import { useEscapeLayer } from "../../app/escapeLayers";
import { connectShortcutKeys } from "../../app/platform";

type QuickConnectMenuProps = {
  hosts: DirectoryHost[];
  recent: RecentConnection[];
  sessions: Session[];
  /** Viewport position of the menu's top-left corner (fixed positioning). */
  position: { left: number; top: number };
  onConnect: (host: Host) => void;
  onSwitchToSession: (sessionId: string) => void;
  onOpenHostManager: () => void;
  onClose: () => void;
};

type MenuItem = {
  entry: DirectoryHost;
  kind: "favorite" | "recent" | "match";
  connectedAt?: number;
};

const maxItemsPerSection = 6;
const maxMatches = 8;

/** The "+ ▾" menu next to the session tabs: favorites, recent hosts and a quick search. */
export default function QuickConnectMenu({ hosts, recent, sessions, position, onConnect, onSwitchToSession, onOpenHostManager, onClose }: QuickConnectMenuProps) {
  useEscapeLayer(onClose);
  const environments = useEnvironments();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const normalizedQuery = query.trim().toLowerCase();

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [onClose]);

  const items = useMemo((): MenuItem[] => {
    if (normalizedQuery) {
      return hosts.filter((entry) => matchesHost(entry, normalizedQuery, environments)).slice(0, maxMatches).map((entry) => ({ entry, kind: "match" }));
    }

    const byId = new Map(hosts.map((entry) => [entry.host.id, entry]));
    const favorites = hosts.filter(({ host }) => host.favorite).slice(0, maxItemsPerSection).map((entry): MenuItem => ({ entry, kind: "favorite" }));
    const favoriteIds = new Set(favorites.map((item) => item.entry.host.id));
    const recentItems = recent
      .filter((item) => !favoriteIds.has(item.hostId))
      .map((item): MenuItem | null => {
        const entry = byId.get(item.hostId);
        return entry ? { entry, kind: "recent", connectedAt: item.connectedAt } : null;
      })
      .filter((item): item is MenuItem => item !== null)
      .slice(0, maxItemsPerSection);

    return [...favorites, ...recentItems];
  }, [environments, hosts, normalizedQuery, recent]);

  const open = (host: Host) => {
    const session = sessions.find((item) => item.host.id === host.id);
    onClose();

    if (session) {
      onSwitchToSession(session.id);
    } else {
      onConnect(host);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && items.length > 0) {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((current) => (current + direction + items.length) % items.length);
    } else if (event.key === "Enter" && items[highlight]) {
      event.preventDefault();
      open(items[highlight].entry.host);
    }
  };

  const renderItem = (item: MenuItem, index: number) => (
    <button
      key={`${item.kind}-${item.entry.host.id}`}
      type="button"
      role="option"
      aria-selected={index === highlight}
      className={`qc-item${index === highlight ? " active" : ""}`}
      onMouseEnter={() => setHighlight(index)}
      onClick={() => open(item.entry.host)}
    >
      {item.kind === "favorite" ? <Star className="qc-icon qc-icon-star" size={14} aria-hidden="true" />
        : item.kind === "recent" ? <Clock className="qc-icon" size={14} aria-hidden="true" />
          : <span className="qc-icon" aria-hidden="true" />}
      <span className="qc-host">
        <span className="qc-host-name">{item.entry.host.name}</span>
        <span className="qc-host-meta">{item.entry.host.username ? `${item.entry.host.username}@` : ""}{item.entry.host.hostname}</span>
      </span>
      <EnvironmentBadge environmentId={item.entry.host.environmentId} />
      {item.kind === "recent" && item.connectedAt !== undefined && <span className="qc-when">{formatRelativeTime(item.connectedAt)}</span>}
    </button>
  );

  const favoriteItems = items.filter((item) => item.kind === "favorite");
  const recentItems = items.filter((item) => item.kind === "recent");

  return (
    <div className="qc-menu" ref={menuRef} role="dialog" aria-label="Quick connect" style={{ left: position.left, top: position.top } as CSSProperties}>
      <div className="qc-search">
        <Search size={15} aria-hidden="true" />
        <input
          autoFocus
          value={query}
          placeholder="Connect to…"
          aria-label="Search hosts"
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlight(0);
          }}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div className="qc-body" role="listbox" aria-label="Hosts">
        {normalizedQuery ? (
          items.length > 0 ? items.map(renderItem) : <div className="qc-empty">No matching hosts</div>
        ) : items.length === 0 ? (
          <div className="qc-empty">No favorites or recent hosts yet. Type to search all {hosts.length} hosts.</div>
        ) : (
          <>
            {favoriteItems.length > 0 && <div className="qc-label">Favorites</div>}
            {favoriteItems.map((item) => renderItem(item, items.indexOf(item)))}
            {recentItems.length > 0 && <div className="qc-label">Recent</div>}
            {recentItems.map((item) => renderItem(item, items.indexOf(item)))}
          </>
        )}
      </div>
      <button
        type="button"
        className="qc-foot"
        onClick={() => {
          onClose();
          onOpenHostManager();
        }}
      >
        <span>{hosts.length === 1 ? "1 host" : `${hosts.length} hosts`}</span>
        <span className="qc-foot-link">Open host manager {connectShortcutKeys.map((key) => <kbd key={key}>{key}</kbd>)}</span>
      </button>
    </div>
  );
}
