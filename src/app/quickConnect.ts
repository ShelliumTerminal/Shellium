import type { Host } from "../components/palette/types";

/**
 * Quick connect: `user@host:port` typed in the connect palette's search opens a session to a host
 * that is not saved. Such a Host lives only in its session (id prefix below): nothing is written to
 * the vault and the password prompt does not offer to save it.
 */
const QUICK_CONNECT_PREFIX = "quick:";

export type QuickConnectTarget = { username: string; hostname: string; port: number };

// [user@]host[:port] - host is a name / IPv4 address, or an IPv6 address in brackets
const pattern = /^(?:([^@\s:]+)@)?(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)(?::(\d{1,5}))?$/;

/**
 * Reads `user@host`, `host:port`, `user@host:port` (an `ssh ` in front is allowed). A bare word is
 * not taken as a host - it is far more likely a search - unless it has a dot (`db01.corp.local`,
 * an IP address) or it is `localhost`.
 */
export function parseQuickConnect(text: string): QuickConnectTarget | null {
  const value = text.trim().replace(/^ssh\s+/i, "");
  const match = pattern.exec(value);
  if (!match) {
    return null;
  }
  const [, username = "", rawHost, rawPort] = match;
  const hostname = rawHost.startsWith("[") ? rawHost.slice(1, -1) : rawHost;
  const port = rawPort ? Number(rawPort) : 22;
  if (port < 1 || port > 65535) {
    return null;
  }
  if (!username && !rawPort && !hostname.includes(".") && hostname.toLowerCase() !== "localhost") {
    return null;
  }
  return { username, hostname, port };
}

export function formatQuickConnect(target: QuickConnectTarget) {
  const host = target.hostname.includes(":") ? `[${target.hostname}]` : target.hostname;
  return `${target.username ? `${target.username}@` : ""}${host}${target.port === 22 ? "" : `:${target.port}`}`;
}

export function quickConnectHost(target: QuickConnectTarget): Host {
  const label = formatQuickConnect(target);
  return {
    id: `${QUICK_CONNECT_PREFIX}${target.username}@${target.hostname}:${target.port}`,
    name: label,
    hostname: target.hostname,
    port: target.port,
    username: target.username,
  };
}

/** A host opened by quick connect (not in the vault). */
export function isQuickConnectHost(host: Pick<Host, "id">) {
  return host.id.startsWith(QUICK_CONNECT_PREFIX);
}
