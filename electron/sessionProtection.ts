/**
 * Protected sessions (owner's decision 2026-11-08): the shell of a tab runs inside tmux (screen when the
 * server has no tmux) on the server, so a dropped connection does not kill what runs in it. Shellium
 * reconnects on its own and attaches to the same tmux session again.
 *
 * - Every protected tab has its own tmux server (`tmux -L shellium-<id>`): it starts from that tab's
 *   shell, so the environment (ORACLE_SID...) and the folder stay, and our settings never touch the
 *   user's own tmux. Settings come from a throwaway config file, never from ~/.tmux.conf.
 * - Switched on in an open tab, the command is typed into the shell (it must be at a prompt); when the
 *   tmux session ends, the shell prints PROTECT_OFF_MARKER (an OSC sequence the terminal ignores), which
 *   the main process strips and reports.
 * - New protected sessions and reconnects start tmux through an exec channel with a pty instead of a
 *   shell: nothing is typed, the login profile runs inside tmux.
 * - Commands are kept to what /bin/sh and csh both read when typed (no variables, no 2>), and to options
 *   tmux 1.8 (RHEL 7) knows.
 * - tmux before 3.x always reads /etc/tmux.conf (-f only replaces ~/.tmux.conf). When that file cannot be
 *   read (e.g. readable by root only, tmux started as oracle), tmux shows the error by putting the new
 *   pane into copy mode, where typing does nothing. Right after new-session that mode is left with
 *   `send-keys -X cancel` (tmux 2.4+; a "q" there kills the 2.7 server while no client is attached) or,
 *   where -X is unknown (1.8), "q C-u": q leaves the mode and, when there was none, the shell's line
 *   discard erases it again. Tested on 1.8 and 2.7 with an unreadable /etc/tmux.conf and with none.
 * - The typed command reports the user it runs as (USER_MARKER). After `su - oracle` that is not the SSH
 *   login user, and exec channels (state, stop, reattach) run as the login user and cannot see that tmux
 *   server: the protection then carries `asUser`, stop goes through the terminal (the prefix key), the
 *   state is unknown, and a reconnect opens a plain shell with the command to attach again.
 */
import type { Readable } from "node:stream";

export type ProtectionTool = "tmux" | "screen";
/** `asUser`: started after su / sudo as this user, not the SSH login user (see the header). */
export type SessionProtection = { tool: ProtectionTool; name: string; asUser?: string };
/** How a connection opens its terminal: a fresh protected session or the one a dropped connection left. */
export type ProtectionOpen = SessionProtection & { mode: "new" | "attach" };

export type ProtectionProbe = {
  tool: ProtectionTool | null;
  /** Protected sessions left on the server (closed tab "left running", or another Shellium). */
  orphans: Array<SessionProtection & { command: string | null }>;
};

export const PROTECT_OFF_MARKER = "\x1b]7337;shellium-protect-off\x07";
/** Printed by the typed command before tmux / screen starts: the user the shell runs as. */
// eslint-disable-next-line no-control-regex -- matches an OSC sequence
export const USER_MARKER = /\x1b\]7337;shellium-protect-user;([A-Za-z0-9._-]{1,64})\x07/;
const USER_NAME = /^[A-Za-z0-9._-]{1,64}$/;

const SHELLS = new Set(["bash", "sh", "ksh", "ksh93", "mksh", "zsh", "dash", "tcsh", "csh", "fish", "-bash", "-sh", "-ksh", "-zsh"]);

const TMUX_CONFIG = [
  "set -g status off",
  "set -g history-limit 50000",
  "set -g escape-time 0",
  // no prefix key anybody presses by accident (Ctrl+B moves the cursor in bash); Shellium never needs it
  "set -g prefix F12",
  "unbind C-b",
  // no alternate screen: lines that scroll away land in the terminal's own scrollback (mouse wheel works)
  "set -ga terminal-overrides \",*:smcup@:rmcup@\"",
  "set -g set-titles off",
];

const SCREEN_CONFIG = [
  "startup_message off",
  "defscrollback 50000",
  // Ctrl+A is "beginning of line" in bash and sqlplus (rlwrap): screen gets Ctrl+^ instead
  "escape ^^^^",
  "termcapinfo xterm* ti@:te@",
  "vbell off",
];

export function protectionName(sessionId: string) {
  const id = sessionId.replace(/[^A-Za-z0-9]/g, "").slice(-10) || "session";
  return `shellium-${id}`;
}

export function isValidProtection(value: unknown): value is SessionProtection {
  const v = value as SessionProtection | undefined;
  return Boolean(v && (v.tool === "tmux" || v.tool === "screen") && /^shellium-[A-Za-z0-9]{1,40}$/.test(v.name)
    && (v.asUser === undefined || USER_NAME.test(v.asUser)));
}

/** A string for `sh -c`, also when the login shell that passes it on is csh. */
export function shQuote(text: string) {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function configFile(name: string) {
  return `/tmp/.${name}.conf`;
}

function writeConfig(lines: string[], file: string) {
  return `printf '%s\\n' ${lines.map((line) => `'${line}'`).join(" ")} > ${file}`;
}

/** Leaves the copy mode tmux opens to show config errors (see the header). */
function leaveErrorMode(name: string) {
  // in sh -c: the 2> and || must not reach a csh login shell
  return `sh -c ${shQuote(`tmux -L ${name} send-keys -t main -X cancel 2>/dev/null || tmux -L ${name} send-keys -t main q C-u`)}`;
}

// backquotes, not $(): csh reads them too
const reportUser = "printf '\\033]7337;shellium-protect-user;%s\\007' `id -un`";

/** Typed into the tab's shell (at a prompt): start tmux / screen there and attach; the marker when it ends. */
export function typedStartCommand(p: SessionProtection) {
  const file = configFile(p.name);
  const off = "printf '\\033]7337;shellium-protect-off\\007'";
  if (p.tool === "tmux") {
    return ` ${reportUser}; ${writeConfig(TMUX_CONFIG, file)}; tmux -L ${p.name} -f ${file} new-session -d -s main; rm -f ${file}; ${leaveErrorMode(p.name)}; tmux -L ${p.name} attach -d -t main; ${off}`;
  }
  return ` ${reportUser}; ${writeConfig(SCREEN_CONFIG, file)}; screen -c ${file} -S ${p.name} -d -m; screen -c ${file} -d -r ${p.name}; rm -f ${file}; ${off}`;
}

/** Typed into the tab's shell: attach to a session left on the server. */
export function typedAttachCommand(p: SessionProtection) {
  const off = "printf '\\033]7337;shellium-protect-off\\007'";
  return p.tool === "tmux"
    ? ` ${reportUser}; tmux -L ${p.name} attach -d -t main; ${off}`
    : ` ${reportUser}; screen -d -r ${p.name}; ${off}`;
}

/**
 * Keys that end the session from inside (prefix key, command prompt, command): for a session another user
 * owns. Written one part at a time (STOP_KEY_GAP_MS apart): tmux 2.7 given all of it in one read does not
 * open the prompt, and the command lands in the shell.
 */
export function stopKeys(p: SessionProtection) {
  // F12 is the tmux prefix (TMUX_CONFIG); Ctrl+^ the screen escape (SCREEN_CONFIG)
  return p.tool === "tmux" ? ["\x1b[24~", ":", "kill-server\r"] : ["\x1e", ":", "quit\r"];
}

export const STOP_KEY_GAP_MS = 300;

/** How to get back into a session started as another user, for messages. */
export function attachHint(p: SessionProtection) {
  const attach = p.tool === "tmux" ? `tmux -L ${p.name} attach` : `screen -r ${p.name}`;
  return `su - ${p.asUser}, then ${attach}`;
}

/** The command of an exec channel with a pty (new protected session or reattach after a drop). */
export function execCommand(p: ProtectionOpen) {
  const file = configFile(p.name);
  let script: string;
  if (p.tool === "tmux") {
    script = p.mode === "attach"
      ? `exec tmux -L ${p.name} attach -d -t main`
      : `${writeConfig(TMUX_CONFIG, file)}; tmux -L ${p.name} -f ${file} new-session -d -s main; rm -f ${file}; ${leaveErrorMode(p.name)}; exec tmux -L ${p.name} attach -d -t main`;
  } else {
    script = p.mode === "attach"
      ? `exec screen -d -r ${p.name}`
      : `${writeConfig(SCREEN_CONFIG, file)}; screen -c ${file} -S ${p.name} -d -m; screen -c ${file} -d -r ${p.name}; rm -f ${file}`;
  }
  return `/bin/sh -c ${shQuote(script)}`;
}

export const PROBE_COMMAND = `/bin/sh -c ${shQuote([
  "command -v tmux >/dev/null 2>&1 && echo 'TOOL tmux'",
  "command -v screen >/dev/null 2>&1 && echo 'TOOL screen'",
  // tmux keeps one socket per server in /tmp/tmux-<uid>; a stale socket answers nothing and is skipped
  "for s in $(ls \"${TMUX_TMPDIR:-/tmp}/tmux-$(id -u)\" 2>/dev/null | grep '^shellium-'); do c=$(tmux -L \"$s\" list-panes -a -F '#{pane_current_command}' 2>/dev/null | head -n 1) && [ -n \"$c\" ] && echo \"ORPHAN tmux $s $c\"; done",
  "screen -ls 2>/dev/null | grep -o '[0-9][0-9]*\\.shellium-[A-Za-z0-9]*' | sed 's/^[0-9]*\\.//' | while read s; do echo \"ORPHAN screen $s -\"; done",
  "true",
].join("; "))}`;

export function parseProbe(output: string): ProtectionProbe {
  const tools: ProtectionTool[] = [];
  const orphans: ProtectionProbe["orphans"] = [];
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === "TOOL" && (parts[1] === "tmux" || parts[1] === "screen")) {
      tools.push(parts[1]);
    } else if (parts[0] === "ORPHAN" && (parts[1] === "tmux" || parts[1] === "screen") && isValidProtection({ tool: parts[1], name: parts[2] })) {
      orphans.push({ tool: parts[1], name: parts[2], command: parts[3] && parts[3] !== "-" ? parts[3] : null });
    }
  }
  return { tool: tools.includes("tmux") ? "tmux" : tools.includes("screen") ? "screen" : null, orphans };
}

/** What runs in the protected session now: null = only the shell (idle); "unknown" for screen. */
export function stateCommand(p: SessionProtection) {
  return p.tool === "tmux"
    ? `/bin/sh -c ${shQuote(`tmux -L ${p.name} list-panes -a -F '#{pane_current_command}' 2>/dev/null`)}`
    : `/bin/sh -c ${shQuote(`screen -ls ${p.name} >/dev/null 2>&1 && echo '?'`)}`;
}

export function parseState(p: SessionProtection, output: string): { alive: boolean; running: string | null } {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) {
    return { alive: false, running: null };
  }
  if (p.tool === "screen") {
    return { alive: true, running: "unknown" };
  }
  const busy = lines.find((cmd) => !SHELLS.has(cmd));
  return { alive: true, running: busy ?? null };
}

export function stopCommand(p: SessionProtection) {
  return p.tool === "tmux"
    ? `/bin/sh -c ${shQuote(`tmux -L ${p.name} kill-server 2>/dev/null; true`)}`
    : `/bin/sh -c ${shQuote(`screen -S ${p.name} -X quit 2>/dev/null; true`)}`;
}

type ExecStream = {
  on(event: "data", listener: (chunk: Buffer) => void): unknown;
  on(event: "close", listener: () => void): unknown;
};

type ExecClient = {
  exec(command: string, options: Record<string, unknown>, callback: (error: Error | undefined, stream: ExecStream) => void): void;
};

/** Runs a command on an exec channel (no pty) of an open connection; stdout, at most `timeoutMs`. */
export function runExec(client: ExecClient, command: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = "";
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        reject(new Error("The server did not answer in time"));
      }
    }, timeoutMs);
    try {
      client.exec(command, {}, (error, stream) => {
        if (error) {
          done = true;
          clearTimeout(timer);
          reject(error);
          return;
        }
        stream.on("data", (chunk: Buffer) => {
          out += chunk.toString("utf8");
        });
        (stream as unknown as { stderr?: Readable }).stderr?.on("data", () => undefined);
        stream.on("close", () => {
          if (!done) {
            done = true;
            clearTimeout(timer);
            resolve(out);
          }
        });
      });
    } catch (error) {
      clearTimeout(timer);
      reject(error as Error);
    }
  });
}
