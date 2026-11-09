import { useSyncExternalStore } from "react";

/**
 * Themed replacement for window.confirm (which in Electron is a native, unthemed message box that
 * blocks the renderer). Call askConfirm() from anywhere; <ConfirmHost /> in App.tsx shows the
 * requests one at a time, and each resolves true (confirmed) or false (cancelled / Escape / lock).
 */

export type ConfirmOptions = {
  title: string;
  body: string;
  confirmLabel: string;
  /** danger: red confirm button, and Cancel gets the focus so Enter never deletes by accident. */
  tone?: "danger" | "default";
};

export type ConfirmRequest = ConfirmOptions & { id: number; resolve(confirmed: boolean): void };

let queue: ConfirmRequest[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    queue = [...queue, { ...options, id: nextId++, resolve }];
    emit();
  });
}

/** Answers a request and shows the next one. */
export function answerConfirm(id: number, confirmed: boolean) {
  const request = queue.find((item) => item.id === id);
  if (!request) return;
  queue = queue.filter((item) => item.id !== id);
  emit();
  request.resolve(confirmed);
}

/** Cancels every open request (Shellium locked). */
export function cancelAllConfirms() {
  if (queue.length === 0) return;
  const pending = queue;
  queue = [];
  emit();
  pending.forEach((request) => request.resolve(false));
}

export function useConfirmRequest(): ConfirmRequest | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => queue[0] ?? null,
  );
}
