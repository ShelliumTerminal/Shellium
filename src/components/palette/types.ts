import type { AntiIdleOptions } from "../common/antiIdleModel";

export type HostX11Options = {
  enabled?: boolean;
  autoStart?: boolean;
  serverMode?: "auto" | "custom";
  serverCommand?: string;
  displayHost?: string;
  displayNumber?: number;
  screen?: number;
  trusted?: boolean;
};

export type Host = {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  password?: string;
  description?: string;
  tags?: string[];
  x11?: HostX11Options;
  /** Allow SHA-1 key exchange, ssh-rsa/ssh-dss host keys and CBC ciphers for old servers. */
  legacyAlgorithms?: boolean;
  /** Id of an environment defined in Options > Environments. */
  environmentId?: string;
  /** Pinned on the Home tab and in the quick-connect menu. */
  favorite?: boolean;
  /** Own anti-idle settings (keep-alive / anti-idle string); absent = the Options default. */
  antiIdle?: AntiIdleOptions;
  /** Own terminal color scheme; absent = the environment's scheme or the Options default. */
  terminalSchemeId?: string;
};

export type Folder = {
  id: string;
  name: string;
  folders?: Folder[];
  hosts?: Host[];
};

export type SelectedNode =
  | { type: "folder"; id: string }
  | { type: "host"; id: string };

export type Session = {
  id: string;
  host: Host;
  title?: string;
  status: "connecting" | "connected" | "disconnected";
  reconnectToken?: number;
  hasUnreadActivity?: boolean;
  /** The terminal rang its bell while the tab was in the background (shown until the tab is opened). */
  hasBell?: boolean;
  /** Notify When Done (tab menu): a notification when the running (or next) command finishes. */
  notifyWhenDone?: boolean;
  /** The watched command finished while the tab was in the background (shown until it is opened). */
  isDone?: boolean;
  /** The shell runs in this tmux / screen session on the server (protected session). */
  protection?: SessionProtection;
  /** Start protected (Protect new sessions was on when the tab opened). */
  protectOnConnect?: boolean;
  /** A protected tab lost its connection and reconnects on its own. */
  reconnecting?: boolean;
};

/** `asUser`: started after su / sudo as this user (electron/sessionProtection.ts). */
export type SessionProtection = { tool: "tmux" | "screen"; name: string; asUser?: string };
