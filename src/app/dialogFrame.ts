import { useEffect, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

/** Position and size of a movable dialog (left / top / width / height in CSS px). */
export type DialogFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function createDefaultCloseConfirmFrame(): DialogFrame {
  const width = Math.min(440, Math.max(340, window.innerWidth - 32));
  const height = 176;

  return {
    x: Math.max(16, Math.round((window.innerWidth - width) / 2)),
    y: Math.max(16, Math.round((window.innerHeight - height) / 2)),
    width,
    height,
  };
}

export function createDefaultRenameTabFrame(): DialogFrame {
  const width = Math.min(420, Math.max(340, window.innerWidth - 32));
  const height = 166;

  return {
    x: Math.max(16, Math.round((window.innerWidth - width) / 2)),
    y: Math.max(16, Math.round((window.innerHeight - height) / 2)),
    width,
    height,
  };
}

export function createDefaultCredentialDialogFrame(): DialogFrame {
  return {
    x: Math.max(16, Math.round((window.innerWidth - 360) / 2)),
    y: Math.max(16, Math.round((window.innerHeight - 260) / 2)),
    width: 360,
    height: 0,
  };
}

export function createDefaultFontDialogFrame(): DialogFrame {
  const width = Math.min(720, Math.max(420, window.innerWidth - 32));

  return {
    x: Math.max(16, Math.round((window.innerWidth - width) / 2)),
    y: Math.max(48, Math.round((window.innerHeight - 520) / 2)),
    width,
    height: 0,
  };
}
export function createDefaultScriptEditorFrame(): DialogFrame {
  const width = Math.min(960, Math.max(720, window.innerWidth - 32));
  const height = Math.min(640, Math.max(420, window.innerHeight - 96));

  return {
    x: Math.max(16, Math.round((window.innerWidth - width) / 2)),
    y: Math.max(48, Math.round((window.innerHeight - height) / 2)),
    width,
    height,
  };
}

export function clampCloseConfirmFrame(frame: DialogFrame): DialogFrame {
  const viewportMargin = 12;
  const width = Math.min(Math.max(frame.width || 340, 320), Math.max(320, window.innerWidth - viewportMargin * 2));
  const height = frame.height || 176;

  return {
    ...frame,
    width,
    height,
    x: Math.min(Math.max(viewportMargin, frame.x), Math.max(viewportMargin, window.innerWidth - width - viewportMargin)),
    y: Math.min(Math.max(viewportMargin, frame.y), Math.max(viewportMargin, window.innerHeight - height - viewportMargin)),
  };
}

export function clampRenameTabFrame(frame: DialogFrame): DialogFrame {
  const viewportMargin = 12;
  const width = Math.min(Math.max(frame.width || 340, 320), Math.max(320, window.innerWidth - viewportMargin * 2));
  const height = frame.height || 166;

  return {
    ...frame,
    width,
    height,
    x: Math.min(Math.max(viewportMargin, frame.x), Math.max(viewportMargin, window.innerWidth - width - viewportMargin)),
    y: Math.min(Math.max(viewportMargin, frame.y), Math.max(viewportMargin, window.innerHeight - height - viewportMargin)),
  };
}


export function clampCredentialDialogFrame(frame: DialogFrame): DialogFrame {
  const width = Math.min(360, Math.max(320, window.innerWidth - 24));

  return {
    ...frame,
    width,
    height: 0,
    x: Math.min(Math.max(8, frame.x), Math.max(8, window.innerWidth - width - 8)),
    y: Math.min(Math.max(8, frame.y), Math.max(8, window.innerHeight - 220)),
  };
}

export function clampFontDialogFrame(frame: DialogFrame): DialogFrame {
  const width = Math.min(Math.max(frame.width, 420), Math.max(420, window.innerWidth - 24));

  return {
    ...frame,
    width,
    height: 0,
    x: Math.min(Math.max(8, frame.x), Math.max(8, window.innerWidth - width - 8)),
    y: Math.min(Math.max(8, frame.y), Math.max(8, window.innerHeight - 430)),
  };
}
export function clampLargeDialogFrame(frame: DialogFrame): DialogFrame {
  const width = Math.min(Math.max(frame.width, 640), Math.max(640, window.innerWidth - 24));
  const height = Math.min(Math.max(frame.height, 360), Math.max(360, window.innerHeight - 24));

  return {
    width,
    height,
    x: Math.min(Math.max(8, frame.x), Math.max(8, window.innerWidth - width - 8)),
    y: Math.min(Math.max(8, frame.y), Math.max(8, window.innerHeight - height - 8)),
  };
}

export function centerLargeDialogFrame(frame: DialogFrame): DialogFrame {
  const sizedFrame = clampLargeDialogFrame({ ...frame, x: 8, y: 8 });

  return clampLargeDialogFrame({
    ...sizedFrame,
    x: Math.round((window.innerWidth - sizedFrame.width) / 2),
    y: Math.round((window.innerHeight - sizedFrame.height) / 2),
  });
}


/**
 * Moves a dialog while the pointer is held on its header. Clicks on controls inside the header
 * (close button, inputs) do not start a drag.
 */
export function startFrameDrag(
  event: ReactPointerEvent<HTMLElement>,
  startFrame: DialogFrame,
  onMove: (frame: DialogFrame) => void,
  mode: "move" | "resize" = "move",
) {
  if (mode === "move" && (event.button !== 0 || event.target instanceof HTMLElement && event.target.closest("button, input, textarea, select"))) {
    return;
  }

  event.preventDefault();
  if (mode === "resize") {
    event.stopPropagation();
  }
  const startX = event.clientX;
  const startY = event.clientY;

  const handlePointerMove = (moveEvent: PointerEvent) => {
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;
    onMove(mode === "move"
      ? { ...startFrame, x: startFrame.x + dx, y: startFrame.y + dy }
      : { ...startFrame, width: startFrame.width + dx, height: startFrame.height + dy });
  };

  const handlePointerUp = () => {
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
  };

  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerUp);
}

const rememberedFrames = new Map<string, DialogFrame>();

/**
 * Frame state for a movable dialog: starts from `create()` each time the dialog mounts, or - with
 * `rememberKey` - where the user left it last time (for the app's lifetime). Pulled back on-screen
 * when the window shrinks.
 */
export function useDialogFrame(create: () => DialogFrame, clamp: (frame: DialogFrame) => DialogFrame, rememberKey?: string) {
  const [frame, setFrame] = useState<DialogFrame>(() => {
    const remembered = rememberKey ? rememberedFrames.get(rememberKey) : undefined;
    return remembered ? clamp(remembered) : create();
  });

  useEffect(() => {
    if (rememberKey) {
      rememberedFrames.set(rememberKey, frame);
    }
  }, [frame, rememberKey]);

  useEffect(() => {
    const handleResize = () => setFrame((current) => clamp(current));
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [clamp]);

  const onHeaderPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    startFrameDrag(event, frame, (next) => setFrame(clamp(next)));
  };

  return { frame, setFrame, onHeaderPointerDown };
}

/** Inline position for a dialog; `withHeight` for the resizable ones. */
export function frameStyle(frame: DialogFrame, withHeight = false): CSSProperties {
  return withHeight
    ? { left: frame.x, top: frame.y, width: frame.width, height: frame.height }
    : { left: frame.x, top: frame.y, width: frame.width };
}
