import type { IDisposable, Terminal } from "@xterm/xterm";

/** DEC private modes that switch to the alternate screen: 47, 1047 and 1049 (1049 also saves the cursor). */
const ALTERNATE_SCREEN_MODES = new Set([47, 1047, 1049]);

const fullScreenTerminals = new WeakSet<Terminal>();

/**
 * Is a full-screen program (vi, less, top, mc) running? True while the program has switched to the
 * alternate screen, also when "keep full-screen output" keeps it on the normal screen - then xterm's
 * buffer type alone no longer tells.
 */
export function isFullScreenProgram(terminal: Terminal | null) {
  if (!terminal) {
    return false;
  }
  return terminal.buffer.active.type === "alternate" || fullScreenTerminals.has(terminal);
}

/**
 * Follows the alternate-screen switches, and while `keepOutput()` is true swallows them (SecureCRT's
 * behavior): the program draws on the normal screen, what it showed stays there after it exits, and
 * what was on screen before goes to the scrollback when it clears the screen (scrollOnEraseInDisplay).
 */
export function trackAlternateScreen(terminal: Terminal, keepOutput: () => boolean): IDisposable {
  const handle = (enable: boolean) => (params: (number | number[])[]) => {
    const modes = params.map((param) => (Array.isArray(param) ? param[0] : param));
    if (!modes.some((mode) => ALTERNATE_SCREEN_MODES.has(mode))) {
      return false;
    }
    if (enable) {
      fullScreenTerminals.add(terminal);
    } else {
      fullScreenTerminals.delete(terminal);
    }
    // A sequence that also sets other modes (rare) goes to xterm as it is.
    return keepOutput() && modes.every((mode) => ALTERNATE_SCREEN_MODES.has(mode));
  };

  const setDisposable = terminal.parser.registerCsiHandler({ prefix: "?", final: "h" }, handle(true));
  const resetDisposable = terminal.parser.registerCsiHandler({ prefix: "?", final: "l" }, handle(false));
  // A terminal reset (RIS, `reset`) leaves any full-screen program behind.
  const resetAllDisposable = terminal.parser.registerEscHandler({ final: "c" }, () => {
    fullScreenTerminals.delete(terminal);
    return false;
  });

  return {
    dispose() {
      setDisposable.dispose();
      resetDisposable.dispose();
      resetAllDisposable.dispose();
      fullScreenTerminals.delete(terminal);
    },
  };
}
