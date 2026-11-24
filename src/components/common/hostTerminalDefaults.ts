import { createContext, useContext } from "react";
import type { BackspaceKey } from "./hostTerminalModel";

/** Options > Terminal > Backspace sends: what a host without its own Backspace setting uses. */
export const BackspaceDefaultContext = createContext<BackspaceKey>("del");

export function useBackspaceDefault() {
  return useContext(BackspaceDefaultContext);
}

export function backspaceLabel(key: BackspaceKey) {
  return key === "ctrl-h" ? "Ctrl+H (^H)" : "DEL (^?)";
}
